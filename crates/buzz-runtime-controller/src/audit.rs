//! Append-only, redacted controller audit records.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use buzz_core::hosted_agent_runtime::{RuntimeErrorCode, RuntimeRevision};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Secret-free append-only runtime audit entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AuditEntry {
    /// UTC observation time.
    pub at: DateTime<Utc>,
    /// Public hosted agent identity.
    pub agent_pubkey: String,
    /// Controller revision.
    pub revision: RuntimeRevision,
    /// Bounded action vocabulary.
    pub action: AuditAction,
    /// Canonical request UUID when the action belongs to a request.
    pub request_id: Option<String>,
    /// Fixed redacted failure code only.
    pub error: Option<RuntimeErrorCode>,
}

/// Bounded controller audit actions.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    /// Owner request became durable.
    RequestAccepted,
    /// Runtime control was emitted.
    ControlSent,
    /// Exact agent acknowledgment was accepted.
    Applied,
    /// Fixed-code application failure was recorded.
    Failed,
}

/// Append-only JSONL audit writer.
pub struct AuditLog {
    path: PathBuf,
}

impl AuditLog {
    /// Create a redacted audit log at an absolute path.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Append, flush, and sync exactly one record.
    pub fn append(&self, entry: &AuditEntry) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&self.path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))?;
        }
        serde_json::to_writer(&mut file, entry).map_err(io::Error::other)?;
        file.write_all(b"\n")?;
        file.sync_data()
    }

    /// Audit file path, useful for health/readiness checks.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn audit_is_append_only_jsonl_and_contains_no_private_runtime_data() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("audit.jsonl");
        let log = AuditLog::new(&path);
        let entry = AuditEntry {
            at: Utc::now(),
            agent_pubkey: "a".repeat(64),
            revision: RuntimeRevision::new(1).expect("revision"),
            action: AuditAction::RequestAccepted,
            request_id: Some("550e8400-e29b-41d4-a716-446655440000".into()),
            error: None,
        };
        log.append(&entry).expect("first");
        log.append(&entry).expect("second");
        let contents = fs::read_to_string(path).expect("audit");
        assert_eq!(contents.lines().count(), 2);
        assert!(!contents.contains("service"));
        assert!(!contents.contains("model"));
        assert!(!contents.contains("command"));
        assert!(!contents.contains("prompt"));
    }

    #[cfg(unix)]
    #[test]
    fn audit_file_is_owner_readable_only() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("audit.jsonl");
        let log = AuditLog::new(&path);
        let entry = AuditEntry {
            at: Utc::now(),
            agent_pubkey: "a".repeat(64),
            revision: RuntimeRevision::new(1).expect("revision"),
            action: AuditAction::ControlSent,
            request_id: None,
            error: None,
        };
        log.append(&entry).expect("append");
        let mode = fs::metadata(path).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
