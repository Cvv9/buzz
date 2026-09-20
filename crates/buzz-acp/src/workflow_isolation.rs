//! Linux supervisor/worker boundary for supervised workflow execution.
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{bail, Context, Result};

pub(crate) const PROFILE: &str = "linux-uids-v1";

#[derive(Clone, Debug)]
pub(crate) struct Isolation {
    pub state_dir: PathBuf,
    pub ordinary_home: PathBuf,
    pub manual_home: PathBuf,
    pub manual_workspace: PathBuf,
    pub broker_gid: u32,
}

impl Isolation {
    pub fn configured() -> Result<Option<Self>> {
        match std::env::var("BUZZ_ACP_SUPERVISOR_PROFILE") {
            Err(_) => return Ok(None),
            Ok(value) if value == PROFILE => {}
            Ok(_) => bail!("unsupported supervisor profile"),
        }
        let path = |key: &str, default: &str| {
            PathBuf::from(std::env::var(key).unwrap_or_else(|_| default.into()))
        };
        let result = Self {
            state_dir: path(
                "BUZZ_ACP_WORKFLOW_STATE_DIR",
                "/var/lib/buzz-harness/workflow-runs",
            ),
            ordinary_home: path("BUZZ_ACP_ORDINARY_HOME", "/home/node"),
            manual_home: path("BUZZ_ACP_MANUAL_HOME", "/home/buzz-manual"),
            manual_workspace: path("BUZZ_ACP_MANUAL_WORKSPACE", "/home/buzz-manual/workspace"),
            broker_gid: std::env::var("BUZZ_ACP_BROKER_GID")
                .unwrap_or_else(|_| "1003".into())
                .parse()?,
        };
        if result.broker_gid != 1003 || !result.manual_workspace.starts_with(&result.manual_home) {
            bail!("invalid workflow isolation paths or broker group");
        }
        for path in [
            &result.state_dir,
            &result.ordinary_home,
            &result.manual_home,
            &result.manual_workspace,
        ] {
            if !path.is_absolute()
                || path
                    .components()
                    .any(|part| matches!(part, std::path::Component::ParentDir))
            {
                bail!("workflow isolation paths must be absolute and canonical");
            }
        }
        Ok(Some(result))
    }

    /// All children, including catalog/auth helpers, drop supervisor privileges.
    pub fn command(&self, command: &str, args: &[String], manual: bool) -> tokio::process::Command {
        let uid = if manual { "1002" } else { "1000" };
        let mut child = tokio::process::Command::new("/usr/bin/setpriv");
        let cwd = if manual {
            &self.manual_workspace
        } else {
            &self.ordinary_home
        };
        child
            .args([
                "--reuid",
                uid,
                "--regid",
                "1003",
                "--clear-groups",
                "--inh-caps=-all",
                "--ambient-caps=-all",
                "--no-new-privs",
                "--",
                "/bin/sh",
                "-c",
                "cd \"$1\" || exit 125; shift; exec \"$@\"",
                "buzz-worker",
            ])
            .arg(cwd)
            .arg(command)
            .args(args)
            .env_clear()
            .current_dir("/");
        child
    }

    pub fn environment(
        &self,
        inherited: impl IntoIterator<Item = (String, String)>,
        manual: bool,
    ) -> BTreeMap<String, String> {
        let mut result: BTreeMap<_, _> = inherited
            .into_iter()
            .filter(|(key, _)| !manual || permitted_env(key, true))
            .collect();
        let home = if manual {
            &self.manual_home
        } else {
            &self.ordinary_home
        };
        result.insert("HOME".into(), home.to_string_lossy().into_owned());
        result.insert(
            "XDG_CONFIG_HOME".into(),
            home.join(".config").to_string_lossy().into_owned(),
        );
        result.insert(
            "CODEX_HOME".into(),
            home.join(".codex").to_string_lossy().into_owned(),
        );
        result.insert(
            "USER".into(),
            if manual { "buzz-manual" } else { "node" }.into(),
        );
        result.insert(
            "LOGNAME".into(),
            if manual { "buzz-manual" } else { "node" }.into(),
        );
        result
    }

    /// Check the real deployed UID/capability/filesystem boundary, never a flag alone.
    pub async fn verify(&self) -> Result<()> {
        if !cfg!(target_os = "linux") {
            bail!("manual workflows require verified Linux isolation");
        }
        let status = std::fs::read_to_string("/proc/self/status")?;
        if !status.lines().any(|line| {
            line.starts_with("Uid:") && line.split_whitespace().skip(1).all(|v| v == "1001")
        }) {
            bail!("workflow supervisor must run as UID1001");
        }
        for field in ["CapEff:", "CapPrm:", "CapAmb:"] {
            let value = status
                .lines()
                .find_map(|l| l.strip_prefix(field))
                .context("missing capability field")?
                .trim();
            if u64::from_str_radix(value, 16)? != 0xe0 {
                bail!("unexpected supervisor capabilities");
            }
        }
        private_directory(&self.state_dir, 1001)?;
        private_directory(&self.ordinary_home, 1000)?;
        private_directory(&self.manual_home, 1002)?;
        let supervisor = std::process::id().to_string();
        // This probe runs through exactly the privilege-dropping launch path.
        // It prints no environment values or credentials.
        let script = r#"set -eu
test "$(id -u)" = "$EXPECTED_UID"
test ! -r "/proc/$SUPERVISOR_PID/environ"
test ! -r /var/lib/buzz-harness/identity.env
if test "$EXPECTED_UID" = 1002; then
 test "$(stat -c '%a:%u' "$WORKFLOW_WORKSPACE")" = 700:1002
 test ! -r /home/node/.codex/auth.json
 test ! -r /home/node/.codex/varvik-agent-identity.env
 test ! -r /run/secrets/varvik-codex-auth.json
fi
while read name value rest; do
 case "$name" in CapInh:|CapPrm:|CapEff:|CapAmb:) test "$value" = 0000000000000000;; NoNewPrivs:) test "$value" = 1;; esac
done < /proc/self/status
"#;
        for manual in [false, true] {
            let mut command = self.command("/bin/sh", &["-c".into(), script.into()], manual);
            command
                .env("PATH", "/usr/local/bin:/usr/bin:/bin")
                .env("EXPECTED_UID", if manual { "1002" } else { "1000" })
                .env("WORKFLOW_WORKSPACE", &self.manual_workspace)
                .env("SUPERVISOR_PID", &supervisor);
            command.kill_on_drop(true);
            let output = tokio::time::timeout(Duration::from_secs(5), command.output()).await??;
            if !output.status.success() {
                bail!("worker isolation probe failed");
            }
        }
        Ok(())
    }
}

/// ACP session cwd must also be reachable after dropping the supervisor UID.
pub(crate) fn ordinary_working_directory() -> Result<PathBuf> {
    Ok(match Isolation::configured()? {
        Some(profile) => profile.ordinary_home,
        None => std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
    })
}

pub(crate) fn permitted_env(key: &str, manual: bool) -> bool {
    matches!(
        key,
        "PATH"
            | "LANG"
            | "LC_ALL"
            | "TERM"
            | "TZ"
            | "SSL_CERT_FILE"
            | "SSL_CERT_DIR"
            | "NODE_EXTRA_CA_CERTS"
            | "AZURE_FOUNDRY_API_KEY"
            | "OPENAI_API_KEY"
            | "OPENAI_BASE_URL"
            | "OPENAI_API_BASE"
            | "ANTHROPIC_API_KEY"
            | "ANTHROPIC_BASE_URL"
            | "MODEL_PROVIDER"
            | "CODEX_PATH"
            | "CODEX_CONFIG"
            | "GOOSE_PROVIDER"
            | "GOOSE_MODEL"
            | "GOOSE_MODE"
            | "BUZZ_AGENT_PROVIDER"
            | "SYLARS_CONTROL_READ_TOKEN"
            | "PROJECT_INTELLIGENCE_READ_TOKEN"
            | "LEDGER_READ_TOKEN"
            | "BUZZ_REMOTE_MCP_URL"
            | "BUZZ_REMOTE_MCP_TOKEN"
            | "BUZZ_REMOTE_MCP_TIMEOUT_MS"
            | "BUZZ_RELAY_URL"
            | "BUZZ_ACP_DISPLAY_NAME"
    ) || (!manual && matches!(key, "BUZZ_PRIVATE_KEY" | "BUZZ_AUTH_TAG"))
}

fn private_directory(path: &Path, uid: u32) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::symlink_metadata(path)?;
        if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o777 != 0o700 {
            bail!(
                "workflow directory ownership/mode mismatch: {}",
                path.display()
            );
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = (path, uid);
        bail!("unsupported isolation platform");
    }
}

#[cfg(target_os = "linux")]
fn manual_uid_at(process: &Path) -> Result<Option<bool>> {
    let status = match std::fs::read_to_string(process.join("status")) {
        Ok(status) => status,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let uids = status
        .lines()
        .find_map(|line| line.strip_prefix("Uid:"))
        .context("process UID unavailable")?;
    let values: Vec<u32> = uids
        .split_whitespace()
        .map(str::parse)
        .collect::<std::result::Result<_, _>>()?;
    if values.len() != 4 {
        bail!("invalid process UID status");
    }
    Ok(Some(values.contains(&1002)))
}

/// Manual workers cannot change UID. Sweep that dedicated UID to also stop
/// descendants which used setsid()/a separate process group. Never touch the
/// ordinary worker UID. Unknown /proc state keeps the run stalled.
pub(crate) async fn stop_manual_uid() -> bool {
    #[cfg(target_os = "linux")]
    {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(4800);
        loop {
            let Ok(entries) = std::fs::read_dir("/proc") else {
                return false;
            };
            let mut alive = false;
            for entry in entries {
                let Ok(entry) = entry else {
                    return false;
                };
                let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
                    continue;
                };
                match manual_uid_at(&entry.path()) {
                    Ok(Some(true)) => {}
                    Ok(_) => continue,
                    Err(_) => return false,
                }
                let identity = match crate::workflow_journal::ProcessIdentity::capture(pid) {
                    Ok(identity) => identity,
                    Err(_) if !entry.path().exists() => continue,
                    Err(_) => return false,
                };
                let stat = match std::fs::read_to_string(entry.path().join("stat")) {
                    Ok(stat) => stat,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(_) => return false,
                };
                // A zombie has no executing code; its direct parent is reaped
                // separately by AcpClient. Container init reaps adopted orphans.
                if stat
                    .rsplit_once(')')
                    .and_then(|(_, s)| s.split_whitespace().next())
                    == Some("Z")
                {
                    continue;
                }
                alive = true;
                if matches!(manual_uid_at(&entry.path()), Ok(Some(true)))
                    && crate::workflow_journal::ProcessIdentity::capture(pid)
                        .is_ok_and(|current| current.start_ticks == identity.start_ticks)
                {
                    let _ = nix::sys::signal::kill(
                        nix::unistd::Pid::from_raw(pid as i32),
                        nix::sys::signal::Signal::SIGKILL,
                    );
                }
            }
            if !alive {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manual_environment_never_inherits_unscoped_credentials_or_worker_home() {
        let isolation = Isolation {
            state_dir: "/var/lib/buzz-harness/workflow-runs".into(),
            ordinary_home: "/home/node".into(),
            manual_home: "/home/buzz-manual".into(),
            manual_workspace: "/home/buzz-manual/workspace".into(),
            broker_gid: 1003,
        };
        let env = isolation.environment(
            [
                ("BUZZ_PRIVATE_KEY", "full-key"),
                ("BUZZ_AUTH_TAG", "auth"),
                ("DATABASE_URL", "db"),
                ("REDIS_URL", "redis"),
                ("HOME", "/private"),
                ("CODEX_HOME", "/private/config"),
                ("OPENAI_API_KEY", "provider"),
                ("PROJECT_INTELLIGENCE_READ_TOKEN", "read-projects"),
                ("LEDGER_READ_TOKEN", "read-ledger"),
                ("SYLARS_CONTROL_API_TOKEN", "broad-control"),
                ("SYLARS_CONTROL_READ_TOKEN", "read-sylars"),
                ("PATH", "/usr/bin"),
            ]
            .map(|(k, v)| (k.into(), v.into())),
            true,
        );
        for key in [
            "BUZZ_PRIVATE_KEY",
            "BUZZ_AUTH_TAG",
            "DATABASE_URL",
            "REDIS_URL",
        ] {
            assert!(!env.contains_key(key));
        }
        assert_eq!(env["HOME"], "/home/buzz-manual");
        assert_eq!(env["CODEX_HOME"], "/home/buzz-manual/.codex");
        assert_eq!(env["OPENAI_API_KEY"], "provider");
        assert_eq!(env["PROJECT_INTELLIGENCE_READ_TOKEN"], "read-projects");
        assert_eq!(env["LEDGER_READ_TOKEN"], "read-ledger");
        assert!(!env.contains_key("SYLARS_CONTROL_API_TOKEN"));
        assert_eq!(env["SYLARS_CONTROL_READ_TOKEN"], "read-sylars");
        let ordinary = isolation.environment(
            [("SYLARS_CONTROL_API_TOKEN".into(), "broad-control".into())],
            false,
        );
        assert_eq!(ordinary["SYLARS_CONTROL_API_TOKEN"], "broad-control");
    }
}
