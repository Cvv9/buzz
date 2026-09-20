//! Versioned, strict execution control protocol for bounded workflow runs.
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Current supervised workflow protocol version.
pub const PROTOCOL_VERSION: u32 = 1;
/// Accepted manual lifetime, including queueing, in seconds.
pub const MANUAL_LIFETIME_SECONDS: i64 = 1200;
/// Per-workflow cooldown in seconds from accepted start.
pub const MANUAL_COOLDOWN_SECONDS: i64 = 900;
/// Total execution attempts across all tasks in a manual run.
pub const MANUAL_MAX_ATTEMPTS: i32 = 2;

/// Agent-signed control envelope. Tags must agree with this payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionControl {
    /// Protocol version, exactly one.
    pub version: u32,
    /// Must match the host-bound community.
    pub community_id: Uuid,
    /// Must match the event signer.
    pub agent_pubkey: String,
    /// Persistent runner process instance nonce.
    pub instance_id: Uuid,
    /// Typed control operation.
    pub operation: ExecutionOperation,
}

/// Operations accepted from a supervised runner.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum ExecutionOperation {
    /// Advertise safe runtime support. The relay fixes expiry at 90 seconds.
    Capability {
        /// Tested operating-system identity isolation profile.
        runtime_profile: String,
        /// Configured ordinary agent turn bound, in seconds.
        max_turn_duration_secs: u64,
    },
    /// Request permission immediately before starting an execution attempt.
    Claim {
        /// Durable run.
        run_id: Uuid,
        /// Durable task.
        task_id: Uuid,
        /// Destination channel.
        channel_id: Uuid,
        /// Expected run revision.
        revision: i64,
        /// Child-only read credential; never the agent key.
        ephemeral_pubkey: String,
    },
    /// Recover an original claim receipt only to prove its attempt stopped.
    RecoverClaim {
        /// Exact original signed claim; never reissued as a new claim.
        signed_claim: nostr::Event,
    },
    /// Confirm execution began under a durable grant.
    Started {
        /// Durable grant.
        grant_id: Uuid,
        /// Durable run.
        run_id: Uuid,
        /// Durable task.
        task_id: Uuid,
        /// Fixed destination.
        channel_id: Uuid,
        /// Granted ordinal.
        ordinal: i32,
    },
    /// Confirm successful execution with a stored signed result.
    Finished {
        /// Durable grant.
        grant_id: Uuid,
        /// Durable run.
        run_id: Uuid,
        /// Durable task.
        task_id: Uuid,
        /// Fixed destination.
        channel_id: Uuid,
        /// Granted ordinal.
        ordinal: i32,
        /// Final agent-authored kind 9 event.
        result_event_id: String,
    },
    /// Confirm the supervised process group has been reaped.
    Stopped {
        /// Durable grant.
        grant_id: Uuid,
        /// Durable run.
        run_id: Uuid,
        /// Durable task.
        task_id: Uuid,
        /// Fixed destination.
        channel_id: Uuid,
        /// Granted ordinal.
        ordinal: i32,
        /// Fixed safe reason, not provider stderr.
        reason: StopReason,
    },
}

/// Safe process stop classifications.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    /// Provider execution failed.
    ExecutionFailed,
    /// Absolute deadline was reached.
    DeadlineExceeded,
    /// Current permissions no longer authorize work.
    PermissionRevoked,
    /// Old process was positively verified stopped after restart.
    RecoveryStopped,
}

/// Relay-only single-use attempt decision, addressed to one runner instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionDecision {
    /// Protocol version.
    pub version: u32,
    /// Host-bound community.
    pub community_id: Uuid,
    /// Target agent.
    pub agent_pubkey: String,
    /// Exact granted runner instance.
    pub instance_id: Uuid,
    /// Durable run.
    pub run_id: Uuid,
    /// Durable task.
    pub task_id: Uuid,
    /// Durable grant.
    pub grant_id: Uuid,
    /// Fixed destination.
    pub channel_id: Uuid,
    /// Run-wide execution ordinal.
    pub ordinal: i32,
    /// Monotonic run revision.
    pub revision: i64,
    /// Absolute Unix timestamp deadline.
    pub deadline: i64,
    /// Grant or cancellation.
    pub decision: DecisionKind,
}

/// Relay decision operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionKind {
    /// Permission to start exactly once.
    Grant,
    /// Stop the supervised process.
    Cancel,
}

/// Relay-only invalidation; clients refresh authorized structured reads.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunStatusInvalidation {
    /// Protocol version.
    pub version: u32,
    /// Bound community.
    pub community_id: Uuid,
    /// Workflow identifier.
    pub workflow_id: Uuid,
    /// Run identifier.
    pub run_id: Uuid,
    /// Monotonic revision.
    pub revision: i64,
}

/// Verify an embedded original claim for recovery, without requiring freshness.
/// Returns its fixed run/task/channel scope. Recovery never authorizes execution.
pub fn recovery_claim_scope(control: &ExecutionControl) -> Option<(Uuid, Uuid, Uuid)> {
    let ExecutionOperation::RecoverClaim { signed_claim } = &control.operation else {
        return None;
    };
    if signed_claim.verify().is_err()
        || crate::kind::event_kind_u32(signed_claim) != crate::kind::KIND_WORKFLOW_EXECUTION_CONTROL
        || signed_claim.pubkey.to_hex() != control.agent_pubkey
        || control.version != PROTOCOL_VERSION
        || control.instance_id.is_nil()
    {
        return None;
    }
    let original: ExecutionControl = serde_json::from_str(&signed_claim.content).ok()?;
    if original.version != PROTOCOL_VERSION
        || original.community_id != control.community_id
        || original.agent_pubkey != control.agent_pubkey
        || original.instance_id != control.instance_id
    {
        return None;
    }
    let ExecutionOperation::Claim {
        run_id,
        task_id,
        channel_id,
        revision,
        ephemeral_pubkey,
    } = original.operation
    else {
        return None;
    };
    if [run_id, task_id, channel_id, control.community_id]
        .iter()
        .any(Uuid::is_nil)
        || revision < 1
        || ephemeral_pubkey == control.agent_pubkey
        || ephemeral_pubkey.len() != 64
        || !ephemeral_pubkey
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || signed_claim.tags.len() != 4
    {
        return None;
    }
    for (key, value) in [
        ("p", control.agent_pubkey.clone()),
        ("h", channel_id.to_string()),
        ("workflow-run", run_id.to_string()),
        ("workflow-task", task_id.to_string()),
    ] {
        let mut tags = signed_claim
            .tags
            .iter()
            .filter(|t| t.as_slice().first().is_some_and(|v| v == key));
        if tags
            .next()
            .is_none_or(|t| t.as_slice() != [key, value.as_str()])
            || tags.next().is_some()
        {
            return None;
        }
    }
    Some((run_id, task_id, channel_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workflow_manual_protocol_rejects_unknown_operation_fields() {
        let mut value = serde_json::json!({"version":1,"community_id":Uuid::new_v4(),"agent_pubkey":"a".repeat(64),"instance_id":Uuid::new_v4(),"operation":{"op":"capability","runtime_profile":"linux-uids-v1","max_turn_duration_secs":7200}});
        assert!(serde_json::from_value::<ExecutionControl>(value.clone()).is_ok());
        value["operation"]["trusted"] = true.into();
        assert!(serde_json::from_value::<ExecutionControl>(value).is_err());
    }
}
