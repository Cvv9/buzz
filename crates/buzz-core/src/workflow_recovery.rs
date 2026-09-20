//! Trusted-controller stop attestations. These never authorize execution.
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Strict controller envelope, separate from agent execution controls.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControllerRecoveryControl {
    /// Protocol version, exactly one.
    pub version: u32,
    /// Host-bound community.
    pub community_id: Uuid,
    /// Pinned operator signer, distinct from the target agent.
    pub controller_pubkey: String,
    /// Exact stopped agent identity.
    pub target_agent: String,
    /// Immutable, full Docker container ID inspected by the operator.
    pub container_id: String,
    /// SHA256 of the bound, redacted operator evidence.
    pub evidence_id: String,
    /// Fresh inspection Unix timestamp.
    pub observed_at: i64,
    /// Docker container start Unix timestamp.
    pub container_started_at: i64,
    /// Docker container stop Unix timestamp.
    pub container_finished_at: i64,
    /// Exact records for which stop has been positively verified.
    pub operation: RecoveryOperation,
}

/// Recovery only clears explicitly bound unknown execution evidence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum RecoveryOperation {
    /// Old scheduled dispatches that never received supervised grants.
    LegacyRecovery {
        /// Exact ungranted tasks. No blanket run reset is supported.
        tasks: Vec<LegacyRecoveryTask>,
        /// Exact orphan scheduler claims, restricted to the stopped target.
        claims: Vec<LegacyRecoveryClaim>,
    },
    /// Stop an original exact grant after its PID namespace disappeared.
    VerifiedAttemptStopped {
        /// Durable run.
        run_id: Uuid,
        /// Durable task.
        task_id: Uuid,
        /// Durable original grant.
        grant_id: Uuid,
        /// Original runner instance.
        instance_id: Uuid,
        /// Original destination.
        channel_id: Uuid,
        /// Original attempt ordinal.
        ordinal: i32,
    },
}

/// Immutable scheduled dispatch selected by the trusted operator.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LegacyRecoveryTask {
    /// Original run.
    pub run_id: Uuid,
    /// Original task.
    pub task_id: Uuid,
    /// Original channel.
    pub channel_id: Uuid,
    /// Exact signed dispatch event ID.
    pub task_event_id: String,
}

/// An unlinked scheduled fire, identified by its complete primary key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LegacyRecoveryClaim {
    /// Workflow whose current immutable binding must match the sole target.
    pub workflow_id: Uuid,
    /// Original scheduled timestamp in microseconds since Unix epoch.
    pub scheduled_for_micros: i64,
    /// Expected original claim timestamp in microseconds since Unix epoch.
    pub claimed_at_micros: i64,
    /// Expected immutable definition hash.
    pub definition_hash: String,
}

impl ControllerRecoveryControl {
    /// Reject malformed or stale attestations before any recovery side effect.
    pub fn validate(&self, now: i64) -> Result<(), &'static str> {
        let hex = |s: &str| {
            s.len() == 64
                && s.bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        };
        if self.version != 1
            || self.community_id.is_nil()
            || ![
                &self.controller_pubkey,
                &self.target_agent,
                &self.container_id,
                &self.evidence_id,
            ]
            .into_iter()
            .all(|v| hex(v))
            || self.controller_pubkey == self.target_agent
            || self.observed_at > now + 5
            || self.observed_at < now - 90
            || self.container_started_at <= 0
            || self.container_finished_at < self.container_started_at
            || self.container_finished_at > self.observed_at
        {
            return Err("invalid_recovery_evidence");
        }
        match &self.operation {
            RecoveryOperation::VerifiedAttemptStopped {
                run_id,
                task_id,
                grant_id,
                instance_id,
                channel_id,
                ordinal,
            } => {
                if [run_id, task_id, grant_id, instance_id, channel_id]
                    .into_iter()
                    .any(|id| id.is_nil())
                    || *ordinal < 1
                {
                    return Err("invalid_recovery_binding");
                }
            }
            RecoveryOperation::LegacyRecovery { tasks, claims } => {
                if tasks.len() + claims.len() == 0 || tasks.len() + claims.len() > 50 {
                    return Err("invalid_recovery_binding");
                }
                let mut ids = std::collections::BTreeSet::new();
                for task in tasks {
                    if [task.run_id, task.task_id, task.channel_id]
                        .into_iter()
                        .any(|id| id.is_nil())
                        || !hex(&task.task_event_id)
                        || !ids.insert((task.run_id, task.task_id))
                    {
                        return Err("invalid_recovery_binding");
                    }
                }
                let mut fires = std::collections::BTreeSet::new();
                for claim in claims {
                    if claim.workflow_id.is_nil()
                        || claim.scheduled_for_micros <= 0
                        || claim.claimed_at_micros <= 0
                        || !hex(&claim.definition_hash)
                        || !fires.insert((claim.workflow_id, claim.scheduled_for_micros))
                    {
                        return Err("invalid_recovery_binding");
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_controller_recovery_rejects_unbound_and_future_evidence() {
        let mut value = serde_json::json!({"version":1,"community_id":Uuid::new_v4(),"controller_pubkey":"a".repeat(64),"target_agent":"b".repeat(64),"container_id":"c".repeat(64),"evidence_id":"d".repeat(64),"observed_at":1000,"container_started_at":800,"container_finished_at":990,"operation":{"op":"verified_attempt_stopped","run_id":Uuid::new_v4(),"task_id":Uuid::new_v4(),"grant_id":Uuid::new_v4(),"instance_id":Uuid::new_v4(),"channel_id":Uuid::new_v4(),"ordinal":1}});
        let control: ControllerRecoveryControl = serde_json::from_value(value.clone()).unwrap();
        assert!(control.validate(1000).is_ok());
        assert!(control.validate(900).is_err());
        assert!(control.validate(1200).is_err());
        value["operation"]["ignore_permissions"] = true.into();
        assert!(serde_json::from_value::<ControllerRecoveryControl>(value).is_err());
    }
}
