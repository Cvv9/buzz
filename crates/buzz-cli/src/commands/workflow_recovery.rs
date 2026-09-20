//! Trusted host operator workflow recovery. Never available to scoped workers.
use crate::{client::BuzzClient, error::CliError};
use buzz_core::workflow_recovery::{ControllerRecoveryControl, RecoveryOperation};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

fn fail(message: &str) -> CliError {
    CliError::Usage(message.into())
}
fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn timestamp(value: &Value, field: &str) -> Result<i64, CliError> {
    DateTime::parse_from_rfc3339(
        value[field]
            .as_str()
            .ok_or_else(|| fail("Docker stop timestamps missing"))?,
    )
    .map(|t| t.timestamp())
    .map_err(|_| fail("Invalid Docker stop timestamps"))
}
fn stopped_container(value: &Value, expected: &str) -> Result<(i64, i64), CliError> {
    if value["Id"].as_str() != Some(expected)
        || !hex64(expected)
        || value["State"]["Running"] != false
        || value["State"]["Restarting"] != false
        || value["State"]["Paused"] != false
        || value["State"]["Pid"] != 0
        || value["State"]["Status"].as_str() != Some("exited")
    {
        return Err(fail("Exact old container must be stopped (exited, no PID); unknown or running containers cannot be recovered"));
    }
    let start = timestamp(&value["State"], "StartedAt")?;
    let finish = timestamp(&value["State"], "FinishedAt")?;
    if start <= 0 || finish < start || finish > Utc::now().timestamp() {
        return Err(fail("Invalid stopped-container lifetime"));
    }
    Ok((start, finish))
}
fn inspect(container: &str) -> Result<Value, CliError> {
    let output = Command::new("docker")
        .args(["inspect", "--type", "container", container])
        .output()
        .map_err(|_| fail("Cannot inspect the specified Docker container"))?;
    if !output.status.success() {
        return Err(fail(
            "Docker container was not found; absence is not stop evidence",
        ));
    }
    let rows: Vec<Value> = serde_json::from_slice(&output.stdout)
        .map_err(|_| fail("Invalid Docker inspection response"))?;
    if rows.len() != 1 {
        return Err(fail("Ambiguous Docker container"));
    }
    rows.into_iter()
        .next()
        .ok_or_else(|| fail("Missing Docker container"))
}
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
#[cfg(unix)]
fn scratch() -> Result<Scratch, CliError> {
    use std::os::unix::fs::DirBuilderExt;
    let path = std::env::temp_dir().join(format!("buzz-recovery-{}", uuid::Uuid::new_v4()));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&path)
        .map_err(|_| fail("Cannot create private recovery directory"))?;
    Ok(Scratch(path))
}
#[cfg(not(unix))]
fn scratch() -> Result<Scratch, CliError> {
    Err(fail(
        "Recovery requires a trusted Unix Docker operator host",
    ))
}
fn copy_private(container: &str, source: &str, destination: &Path) -> Result<Vec<u8>, CliError> {
    let status = Command::new("docker")
        .args(["cp", &format!("{container}:{source}")])
        .arg(destination)
        .output()
        .map_err(|_| fail("Cannot copy protected container evidence"))?;
    if !status.status.success() {
        return Err(fail("Protected container evidence is unavailable"));
    }
    let meta = std::fs::symlink_metadata(destination)
        .map_err(|_| fail("Cannot inspect private evidence"))?;
    if !meta.is_file() || meta.len() > 16 * 1024 * 1024 {
        return Err(fail("Invalid private evidence file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(destination, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| fail("Cannot protect evidence file"))?;
    }
    std::fs::read(destination).map_err(|_| fail("Cannot read private evidence"))
}
fn identity_matches(bytes: &[u8], target: &str) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let mut secret = None;
    let mut public = None;
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else {
            return false;
        };
        if !hex64(value) {
            return false;
        }
        match key {
            "BUZZ_PRIVATE_KEY" if secret.is_none() => secret = Some(value),
            "VARVIK_AGENT_PUBKEY" if public.is_none() => public = Some(value),
            _ => return false,
        }
    }
    public == Some(target)
        && secret
            .and_then(|v| nostr::Keys::parse(v).ok())
            .is_some_and(|keys| keys.public_key().to_hex() == target)
}
fn journal_matches(journal: &Value, control: &ControllerRecoveryControl) -> bool {
    let RecoveryOperation::VerifiedAttemptStopped {
        run_id,
        task_id,
        grant_id,
        instance_id,
        channel_id,
        ordinal,
    } = &control.operation
    else {
        return true;
    };
    journal
        .get(task_id.to_string())
        .and_then(|t| t["attempts"].as_array())
        .is_some_and(|attempts| {
            attempts.iter().any(|a| {
                let g = &a["grant"];
                g["community_id"] == control.community_id.to_string()
                    && g["agent_pubkey"] == control.target_agent
                    && g["run_id"] == run_id.to_string()
                    && g["task_id"] == task_id.to_string()
                    && g["grant_id"] == grant_id.to_string()
                    && g["instance_id"] == instance_id.to_string()
                    && g["channel_id"] == channel_id.to_string()
                    && g["ordinal"] == *ordinal
            })
        })
}

/// Verify a stopped Docker container and exact journal, audit, then publish one control.
pub async fn recover(
    client: &BuzzClient,
    request: &str,
    container: &str,
    audit: &str,
) -> Result<(), CliError> {
    if !hex64(container) {
        return Err(fail(
            "Use the full immutable 64-character Docker container ID",
        ));
    }
    if client.auth_tag_owner_hex().is_some() {
        return Err(fail(
            "Recovery requires the pinned controller identity, not delegated authentication",
        ));
    }
    let input = std::fs::read(request).map_err(|_| fail("Cannot read recovery request"))?;
    let mut control: ControllerRecoveryControl =
        serde_json::from_slice(&input).map_err(|_| fail("Invalid strict recovery request JSON"))?;
    if control.controller_pubkey != client.keys().public_key().to_hex()
        || control.container_id != container
    {
        return Err(fail("Recovery request signer/container mismatch"));
    }
    let initial = inspect(container)?;
    let lifetime = stopped_container(&initial, container)?;
    let scratch = scratch()?;
    let identity = copy_private(
        container,
        "/var/lib/buzz-harness/identity.env",
        &scratch.0.join("identity.env"),
    )
    .or_else(|error| {
        if matches!(control.operation, RecoveryOperation::LegacyRecovery { .. }) {
            copy_private(
                container,
                "/home/node/.codex/varvik-agent-identity.env",
                &scratch.0.join("identity.env"),
            )
        } else {
            Err(error)
        }
    })?;
    if !identity_matches(&identity, &control.target_agent) {
        return Err(fail(
            "Stopped container identity does not match the target agent",
        ));
    }
    let journal_hash = if matches!(
        control.operation,
        RecoveryOperation::VerifiedAttemptStopped { .. }
    ) {
        let bytes = copy_private(
            container,
            "/var/lib/buzz-harness/workflow-runs/journal.json",
            &scratch.0.join("journal.json"),
        )?;
        let journal: Value =
            serde_json::from_slice(&bytes).map_err(|_| fail("Invalid protected journal"))?;
        if !journal_matches(&journal, &control) {
            return Err(fail(
                "Journal does not bind the exact original grant and runner instance",
            ));
        }
        Some(hex::encode(Sha256::digest(&bytes)))
    } else {
        None
    };
    if stopped_container(&inspect(container)?, container)? != lifetime {
        return Err(fail("Container state changed during verification"));
    }
    control.observed_at = Utc::now().timestamp();
    control.container_started_at = lifetime.0;
    control.container_finished_at = lifetime.1;
    let evidence = json!({"version":1,"community_id":control.community_id,"controller_pubkey":control.controller_pubkey,"target_agent":control.target_agent,"container_id":container,"observed_at":control.observed_at,"started_at":lifetime.0,"finished_at":lifetime.1,"journal_sha256":journal_hash,"operation":control.operation});
    control.evidence_id = hex::encode(Sha256::digest(
        serde_json::to_vec(&evidence).map_err(|_| fail("Cannot encode recovery evidence"))?,
    ));
    control.validate(control.observed_at).map_err(fail)?;
    let builder = buzz_sdk::workflow_recovery::build_workflow_recovery(&control)
        .map_err(|_| fail("Invalid recovery control"))?;
    let event = client.sign_event(builder)?;
    // An existing audit path is never overwritten. It contains no copied secrets.
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(audit)
        .map_err(|_| fail("Cannot create recovery audit; choose a new audit file"))?;
    use std::io::Write;
    file.write_all(
        serde_json::to_vec_pretty(&json!({"evidence":evidence,"signed_event":event}))
            .map_err(|_| fail("Cannot encode audit"))?
            .as_slice(),
    )
    .map_err(|_| fail("Cannot write recovery audit"))?;
    file.sync_all()
        .map_err(|_| fail("Cannot persist recovery audit"))?;
    drop(scratch);
    let response = client.submit_event(event).await?;
    println!("{response}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn running_unknown_restarted_containers_never_prove_stop() {
        let id = "a".repeat(64);
        let mut value = json!({"Id":id,"State":{"Running":false,"Restarting":false,"Paused":false,"Pid":0,"Status":"exited","StartedAt":"2026-01-01T00:00:00Z","FinishedAt":"2026-01-01T00:01:00Z"}});
        assert!(stopped_container(&value, &id).is_ok());
        for (field, bad) in [
            ("Running", json!(true)),
            ("Restarting", json!(true)),
            ("Pid", json!(42)),
            ("Status", json!("dead")),
        ] {
            let previous = value["State"][field].take();
            value["State"][field] = bad;
            assert!(stopped_container(&value, &id).is_err());
            value["State"][field] = previous;
        }
        assert!(stopped_container(&value, &"b".repeat(64)).is_err());
    }
    #[test]
    fn identity_is_data_and_never_executable_shell() {
        let keys = nostr::Keys::generate();
        let public = keys.public_key().to_hex();
        let value = format!(
            "VARVIK_AGENT_PUBKEY={}\nBUZZ_PRIVATE_KEY={}\n",
            public,
            keys.secret_key().to_secret_hex()
        );
        assert!(identity_matches(value.as_bytes(), &public));
        assert!(!identity_matches(
            format!("{value}$(touch /tmp/never)\n").as_bytes(),
            &public
        ));
        assert!(!identity_matches(value.as_bytes(), &"f".repeat(64)));
    }
    #[test]
    fn journal_requires_exact_original_scope_and_instance() {
        let run = uuid::Uuid::new_v4();
        let task = uuid::Uuid::new_v4();
        let grant = uuid::Uuid::new_v4();
        let instance = uuid::Uuid::new_v4();
        let channel = uuid::Uuid::new_v4();
        let community = uuid::Uuid::new_v4();
        let control = ControllerRecoveryControl {
            version: 1,
            community_id: community,
            controller_pubkey: "a".repeat(64),
            target_agent: "b".repeat(64),
            container_id: "c".repeat(64),
            evidence_id: "d".repeat(64),
            observed_at: 1000,
            container_started_at: 800,
            container_finished_at: 990,
            operation: RecoveryOperation::VerifiedAttemptStopped {
                run_id: run,
                task_id: task,
                grant_id: grant,
                instance_id: instance,
                channel_id: channel,
                ordinal: 1,
            },
        };
        let mut journal = json!({task.to_string():{"attempts":[{"grant":{"community_id":community,"agent_pubkey":"b".repeat(64),"run_id":run,"task_id":task,"grant_id":grant,"instance_id":instance,"channel_id":channel,"ordinal":1}}]}});
        assert!(journal_matches(&journal, &control));
        for key in [
            "run_id",
            "task_id",
            "grant_id",
            "instance_id",
            "channel_id",
            "community_id",
            "agent_pubkey",
            "ordinal",
        ] {
            let previous = journal[task.to_string()]["attempts"][0]["grant"][key].take();
            journal[task.to_string()]["attempts"][0]["grant"][key] = json!("mismatch");
            assert!(!journal_matches(&journal, &control), "{key}");
            journal[task.to_string()]["attempts"][0]["grant"][key] = previous;
        }
        assert!(!journal_matches(&json!({}), &control));
        // A real pre-grant-save crash retains the signed claim but no grant.
        // The current operator path also rejects that otherwise stopped runner.
        let agent = nostr::Keys::generate();
        let mut grantless_control = control.clone();
        grantless_control.target_agent = agent.public_key().to_hex();
        let claim = buzz_core::workflow_execution::ExecutionControl {
            version: 1,
            community_id: community,
            agent_pubkey: agent.public_key().to_hex(),
            instance_id: instance,
            operation: buzz_core::workflow_execution::ExecutionOperation::Claim {
                run_id: run,
                task_id: task,
                channel_id: channel,
                revision: 1,
                ephemeral_pubkey: nostr::Keys::generate().public_key().to_hex(),
            },
        };
        let signed_claim = buzz_sdk::build_workflow_execution_control(&claim)
            .unwrap()
            .sign_with_keys(&agent)
            .unwrap();
        let grantless = json!({task.to_string():{"attempts":[{
            "phase":"Claiming", "claim":signed_claim, "grant":null,
            "process":null, "result":null, "pending_receipt":null
        }]}});
        assert!(!journal_matches(&grantless, &grantless_control));
    }
}
