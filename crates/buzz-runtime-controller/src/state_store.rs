//! Crash-safe controller state with monotonic per-agent revisions.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use buzz_core::hosted_agent_runtime::{
    CatalogDigest, RedactedRuntimeError, RuntimeErrorCode, RuntimeRequestId, RuntimeRevision,
    RuntimeSelection, RuntimeStatusState,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const STATE_SCHEMA: &str = "buzz.runtime-controller-state.v1";

/// Complete durable state. Unknown fields fail closed during recovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControllerState {
    schema: String,
    /// Per-agent desired and effective runtime state.
    pub agents: BTreeMap<String, AgentRuntimeState>,
    /// Durable idempotency index keyed by canonical request UUID.
    pub requests: BTreeMap<String, RequestRecord>,
}

impl Default for ControllerState {
    fn default() -> Self {
        Self {
            schema: STATE_SCHEMA.to_owned(),
            agents: BTreeMap::new(),
            requests: BTreeMap::new(),
        }
    }
}

/// Durable runtime state for one hosted agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentRuntimeState {
    /// Latest controller revision.
    pub revision: RuntimeRevision,
    /// Current public reconciliation state.
    pub state: RuntimeStatusState,
    /// Last exactly acknowledged runtime selection.
    pub effective: RuntimeSelection,
    /// New desired runtime while pending, applying, or failed.
    pub requested: Option<RuntimeSelection>,
    /// Request owning this revision.
    pub request_id: Option<RuntimeRequestId>,
    /// Catalog digest bound to this revision.
    pub catalog_digest: CatalogDigest,
    /// Fixed public error, never provider output.
    pub error: Option<RedactedRuntimeError>,
}

/// One durable idempotency record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestRecord {
    /// Agent targeted by the original request.
    pub agent_pubkey: String,
    /// Revision allocated to the original request.
    pub revision: RuntimeRevision,
}

/// Result of durably accepting an idempotent request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestAcceptance {
    /// A new monotonic revision was persisted.
    Accepted(RuntimeRevision),
    /// This exact UUID was already accepted for the same agent.
    Idempotent(RuntimeRevision),
}

/// State storage failure.
#[derive(Debug, Error)]
pub enum StateStoreError {
    /// Filesystem operation failed.
    #[error("runtime state I/O failed")]
    Io(#[from] io::Error),
    /// Existing state is truncated, tampered with, or from an unknown schema.
    #[error("runtime state is invalid")]
    Invalid,
    /// Request UUID was reused against another target.
    #[error("runtime request id conflict")]
    RequestConflict,
    /// Revision counter overflowed.
    #[error("runtime revision exhausted")]
    RevisionExhausted,
    /// Agent has no durable state.
    #[error("runtime agent state is missing")]
    MissingAgent,
}

/// Atomic JSON state store.
pub struct StateStore {
    path: PathBuf,
}

impl StateStore {
    /// Create a store for one absolute path.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Load only the complete canonical file. Sibling temp files are ignored.
    pub fn load(&self) -> Result<ControllerState, StateStoreError> {
        match fs::read(&self.path) {
            Ok(bytes) => {
                let state: ControllerState =
                    serde_json::from_slice(&bytes).map_err(|_| StateStoreError::Invalid)?;
                if state.schema != STATE_SCHEMA {
                    return Err(StateStoreError::Invalid);
                }
                Ok(state)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(ControllerState::default()),
            Err(error) => Err(StateStoreError::Io(error)),
        }
    }

    /// Persist one complete state with sibling-temp, fsync, rename, directory-fsync.
    pub fn persist(&self, state: &ControllerState) -> Result<(), StateStoreError> {
        let parent = self.path.parent().ok_or(StateStoreError::Invalid)?;
        fs::create_dir_all(parent)?;
        let temp = sibling_temp_path(&self.path);
        let bytes = serde_json::to_vec(state).map_err(|_| StateStoreError::Invalid)?;
        let mut file = secure_create(&temp)?;
        let write_result = (|| -> Result<(), StateStoreError> {
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temp, &self.path)?;
            sync_directory(parent)?;
            Ok(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        write_result
    }

    /// Allocate one durable monotonic revision or return its idempotent result.
    pub fn accept_request(
        &self,
        state: &mut ControllerState,
        agent_pubkey: &str,
        request_id: RuntimeRequestId,
        desired: RuntimeSelection,
        catalog_digest: CatalogDigest,
        initial_effective: RuntimeSelection,
    ) -> Result<RequestAcceptance, StateStoreError> {
        let request_key = request_id.as_uuid().to_string();
        if let Some(existing) = state.requests.get(&request_key) {
            if existing.agent_pubkey != agent_pubkey {
                return Err(StateStoreError::RequestConflict);
            }
            return Ok(RequestAcceptance::Idempotent(existing.revision));
        }

        let mut candidate = state.clone();
        let next = candidate
            .agents
            .get(agent_pubkey)
            .map_or(1, |current| current.revision.get().saturating_add(1));
        let revision = RuntimeRevision::new(next).ok_or(StateStoreError::RevisionExhausted)?;
        let effective = candidate
            .agents
            .get(agent_pubkey)
            .map_or(initial_effective, |current| current.effective.clone());
        candidate.agents.insert(
            agent_pubkey.to_owned(),
            AgentRuntimeState {
                revision,
                state: RuntimeStatusState::PendingBusy,
                effective,
                requested: Some(desired),
                request_id: Some(request_id),
                catalog_digest,
                error: None,
            },
        );
        candidate.requests.insert(
            request_key,
            RequestRecord {
                agent_pubkey: agent_pubkey.to_owned(),
                revision,
            },
        );
        self.persist(&candidate)?;
        *state = candidate;
        Ok(RequestAcceptance::Accepted(revision))
    }

    /// Seed one managed agent with an initial controller reconciliation revision.
    pub fn bootstrap_agent(
        &self,
        state: &mut ControllerState,
        agent_pubkey: &str,
        initial: RuntimeSelection,
        catalog_digest: CatalogDigest,
    ) -> Result<bool, StateStoreError> {
        if state.agents.contains_key(agent_pubkey) {
            return Ok(false);
        }
        let mut candidate = state.clone();
        candidate.agents.insert(
            agent_pubkey.to_owned(),
            AgentRuntimeState {
                revision: RuntimeRevision::new(1).ok_or(StateStoreError::RevisionExhausted)?,
                state: RuntimeStatusState::PendingBusy,
                effective: initial.clone(),
                requested: Some(initial),
                request_id: None,
                catalog_digest,
                error: None,
            },
        );
        self.persist(&candidate)?;
        *state = candidate;
        Ok(true)
    }

    /// Mark delivery/application started without changing the revision.
    pub fn mark_applying(
        &self,
        state: &mut ControllerState,
        agent_pubkey: &str,
    ) -> Result<(), StateStoreError> {
        let mut candidate = state.clone();
        let agent = candidate
            .agents
            .get_mut(agent_pubkey)
            .ok_or(StateStoreError::MissingAgent)?;
        agent.state = RuntimeStatusState::Applying;
        agent.error = None;
        self.persist(&candidate)?;
        *state = candidate;
        Ok(())
    }

    /// Confirm the runner is still draining active turns for this revision.
    pub fn mark_pending(
        &self,
        state: &mut ControllerState,
        agent_pubkey: &str,
    ) -> Result<(), StateStoreError> {
        let mut candidate = state.clone();
        let agent = candidate
            .agents
            .get_mut(agent_pubkey)
            .ok_or(StateStoreError::MissingAgent)?;
        agent.state = RuntimeStatusState::PendingBusy;
        agent.error = None;
        self.persist(&candidate)?;
        *state = candidate;
        Ok(())
    }

    /// Commit an exactly matching runtime acknowledgment.
    pub fn mark_applied(
        &self,
        state: &mut ControllerState,
        agent_pubkey: &str,
    ) -> Result<(), StateStoreError> {
        let mut candidate = state.clone();
        let agent = candidate
            .agents
            .get_mut(agent_pubkey)
            .ok_or(StateStoreError::MissingAgent)?;
        let requested = agent
            .requested
            .take()
            .ok_or(StateStoreError::MissingAgent)?;
        agent.effective = requested;
        agent.state = RuntimeStatusState::Applied;
        agent.error = None;
        self.persist(&candidate)?;
        *state = candidate;
        Ok(())
    }

    /// Preserve prior effective runtime and expose only a fixed failure.
    pub fn mark_failed(
        &self,
        state: &mut ControllerState,
        agent_pubkey: &str,
        code: RuntimeErrorCode,
    ) -> Result<(), StateStoreError> {
        let mut candidate = state.clone();
        let agent = candidate
            .agents
            .get_mut(agent_pubkey)
            .ok_or(StateStoreError::MissingAgent)?;
        agent.state = RuntimeStatusState::Failed;
        agent.error = Some(RedactedRuntimeError::new(code));
        self.persist(&candidate)?;
        *state = candidate;
        Ok(())
    }
}

fn sibling_temp_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_else(|| "runtime-state".into());
    name.push(format!(".tmp-{}", std::process::id()));
    path.with_file_name(name)
}

fn secure_create(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn request_id(value: &str) -> RuntimeRequestId {
        serde_json::from_value(json!(value)).expect("request id")
    }

    fn digest() -> CatalogDigest {
        serde_json::from_value(json!("c".repeat(64))).expect("digest")
    }

    fn selection(model: &str) -> RuntimeSelection {
        serde_json::from_value(json!({
            "model": model,
            "effort": "medium",
            "runtime_name": "Market Intelligence"
        }))
        .expect("selection")
    }

    #[test]
    fn revisions_are_monotonic_and_request_ids_are_durable_and_idempotent() {
        let directory = tempdir().expect("tempdir");
        let store = StateStore::new(directory.path().join("state.json"));
        let mut state = store.load().expect("load");
        let first = request_id("550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(
            store
                .accept_request(
                    &mut state,
                    &"a".repeat(64),
                    first,
                    selection("gpt-5.6-sol"),
                    digest(),
                    selection("gpt-5.6-terra"),
                )
                .expect("accept"),
            RequestAcceptance::Accepted(RuntimeRevision::new(1).expect("revision"))
        );
        assert_eq!(
            store
                .accept_request(
                    &mut state,
                    &"a".repeat(64),
                    first,
                    selection("gpt-5.6-sol"),
                    digest(),
                    selection("gpt-5.6-terra"),
                )
                .expect("idempotent"),
            RequestAcceptance::Idempotent(RuntimeRevision::new(1).expect("revision"))
        );
        let second = request_id("550e8400-e29b-41d4-a716-446655440001");
        let _ = store
            .accept_request(
                &mut state,
                &"a".repeat(64),
                second,
                selection("gpt-5.6-sol"),
                digest(),
                selection("gpt-5.6-terra"),
            )
            .expect("second");
        assert_eq!(state.agents[&"a".repeat(64)].revision.get(), 2);
        assert_eq!(store.load().expect("reload").requests.len(), 2);
    }

    #[test]
    fn complete_state_wins_and_partial_sibling_temp_is_ignored() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("state.json");
        let store = StateStore::new(&path);
        store.persist(&ControllerState::default()).expect("persist");
        fs::write(sibling_temp_path(&path), b"{partial").expect("partial temp");
        let recovered = store.load().expect("recover complete state");
        assert!(recovered.agents.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn state_file_is_owner_readable_only() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("state.json");
        StateStore::new(&path)
            .persist(&ControllerState::default())
            .expect("persist");
        let mode = fs::metadata(path).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
