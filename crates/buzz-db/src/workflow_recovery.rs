//! Audited, pinned-controller recovery; never substitutes age for stop evidence.
use crate::{
    workflow_execution::{acknowledge, invalidate, ControlReceipt},
    workflow_manual::lock_admission,
    Db, DbError,
};
use buzz_core::{
    workflow_execution::{ExecutionControl, ExecutionOperation, StopReason},
    workflow_recovery::{ControllerRecoveryControl, RecoveryOperation},
    CommunityId,
};
use chrono::{DateTime, Utc};
use nostr::{Event, Keys};
use sqlx::Row;

fn denied(reason: &str) -> ControlReceipt {
    ControlReceipt {
        accepted: false,
        reason: Some(reason.into()),
        decision: None,
        current_revision: None,
        signed_event: None,
    }
}
fn accepted() -> ControlReceipt {
    ControlReceipt {
        accepted: true,
        reason: None,
        decision: None,
        current_revision: None,
        signed_event: None,
    }
}
fn invalid(error: impl ToString) -> DbError {
    DbError::InvalidData(error.to_string())
}

impl Db {
    /// Apply an exact stop attestation and record its receipt in the same transaction.
    pub async fn workflow_controller_recovery(
        &self,
        community: CommunityId,
        event: &Event,
        control: &ControllerRecoveryControl,
        pinned_controller: &str,
        keys: &Keys,
    ) -> crate::error::Result<ControlReceipt> {
        if event.verify().is_err()
            || event.pubkey.to_hex() != pinned_controller
            || control.controller_pubkey != pinned_controller
            || control.community_id != *community.as_uuid()
            || serde_json::from_str::<serde_json::Value>(&event.content)?
                != serde_json::to_value(control)?
        {
            return Ok(denied("invalid_recovery_controller"));
        }
        let mut tx = self.begin_event_write_transaction().await?;
        self.deletion_store()
            .guard_transaction(&mut tx, community)
            .await?;
        lock_admission(&mut tx, community).await?;
        let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(&mut *tx)
            .await?;
        if control.validate(now.timestamp()).is_err()
            || event.created_at.as_secs() > (now.timestamp() + 5) as u64
            || event.created_at.as_secs() < (now.timestamp() - 90) as u64
        {
            return Ok(denied("invalid_recovery_evidence"));
        }
        if let Some(value) = sqlx::query_scalar::<_, serde_json::Value>("SELECT response FROM workflow_recovery_receipts WHERE community_id=$1 AND event_id=$2 AND controller_pubkey=$3")
            .bind(community.as_uuid()).bind(event.id.as_bytes().as_slice()).bind(event.pubkey.to_bytes().as_slice()).fetch_optional(&mut *tx).await? { return Ok(serde_json::from_value(value)?); }
        let evidence = hex::decode(&control.evidence_id).map_err(invalid)?;
        if sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM workflow_recovery_receipts WHERE community_id=$1 AND evidence_id=$2)").bind(community.as_uuid()).bind(&evidence).fetch_one(&mut *tx).await? { return Ok(denied("recovery_evidence_replayed")); }
        let agent = hex::decode(&control.target_agent).map_err(invalid)?;
        let receipt = match &control.operation {
            RecoveryOperation::VerifiedAttemptStopped {
                run_id,
                task_id,
                grant_id,
                instance_id,
                channel_id,
                ordinal,
            } => {
                let claimed: Option<DateTime<Utc>> = sqlx::query_scalar("SELECT a.claimed_at FROM workflow_run_attempts a JOIN workflow_run_tasks t ON t.community_id=a.community_id AND t.run_id=a.run_id AND t.task_id=a.task_id WHERE a.community_id=$1 AND a.run_id=$2 AND a.task_id=$3 AND a.grant_id=$4 AND a.instance_id=$5 AND a.ordinal=$6 AND t.channel_id=$7 AND t.agent_pubkey=$8 AND a.stopped_at IS NULL FOR UPDATE OF a,t")
                    .bind(community.as_uuid()).bind(run_id).bind(task_id).bind(grant_id).bind(instance_id).bind(ordinal).bind(channel_id).bind(&agent).fetch_optional(&mut *tx).await?;
                if claimed.is_none_or(|at| {
                    at.timestamp() < control.container_started_at
                        || at.timestamp() > control.container_finished_at
                }) {
                    denied("recovery_binding_mismatch")
                } else {
                    let original = ExecutionControl {
                        version: 1,
                        community_id: control.community_id,
                        agent_pubkey: control.target_agent.clone(),
                        instance_id: *instance_id,
                        operation: ExecutionOperation::Stopped {
                            grant_id: *grant_id,
                            run_id: *run_id,
                            task_id: *task_id,
                            channel_id: *channel_id,
                            ordinal: *ordinal,
                            reason: StopReason::RecoveryStopped,
                        },
                    };
                    acknowledge(
                        &mut tx,
                        community,
                        &original,
                        *grant_id,
                        *run_id,
                        *task_id,
                        *channel_id,
                        *ordinal,
                        None,
                        Some(&StopReason::RecoveryStopped),
                        keys,
                    )
                    .await?
                }
            }
            RecoveryOperation::LegacyRecovery { tasks, claims } => {
                // This schema has no immutable definition snapshot on orphan fires.
                // Current bindings cannot prove what a historical claim dispatched.
                if !claims.is_empty() {
                    denied("unsupported_orphan_claim_evidence")
                } else {
                    let mut valid = true;
                    for task in tasks {
                        let event_id = hex::decode(&task.task_event_id).map_err(invalid)?;
                        let row=sqlx::query("SELECT r.origin,r.dispatch_complete,r.status::text AS status,r.execution_state,e.pubkey,e.kind,e.tags,e.created_at FROM workflow_run_tasks t JOIN workflow_runs r ON r.community_id=t.community_id AND r.id=t.run_id JOIN events e ON e.community_id=t.community_id AND e.id=t.task_event_id WHERE t.community_id=$1 AND t.run_id=$2 AND t.task_id=$3 AND t.channel_id=$4 AND t.agent_pubkey=$5 AND t.task_event_id=$6 AND t.state='stalled' AND NOT EXISTS(SELECT 1 FROM workflow_run_attempts a WHERE a.community_id=t.community_id AND a.run_id=t.run_id AND a.task_id=t.task_id) FOR UPDATE OF t,r")
                            .bind(community.as_uuid()).bind(task.run_id).bind(task.task_id).bind(task.channel_id).bind(&agent).bind(event_id).fetch_optional(&mut *tx).await?;
                        let Some(row) = row else {
                            valid = false;
                            break;
                        };
                        let tags: Vec<Vec<String>> = serde_json::from_value(row.try_get("tags")?)?;
                        let exact = |key: &str, value: &str| {
                            let mut found =
                                tags.iter().filter(|t| t.first().is_some_and(|v| v == key));
                            found.next().is_some_and(|t| t.as_slice() == [key, value])
                                && found.next().is_none()
                        };
                        let created: DateTime<Utc> = row.try_get("created_at")?;
                        if row.try_get::<String, _>("origin")? != "scheduled"
                            || !row.try_get::<bool, _>("dispatch_complete")?
                            || row.try_get::<String, _>("status")? == "waiting_approval"
                            || row
                                .try_get::<Option<String>, _>("execution_state")?
                                .as_deref()
                                != Some("stalled")
                            || row.try_get::<Vec<u8>, _>("pubkey")? != keys.public_key().to_bytes()
                            || row.try_get::<i32, _>("kind")?
                                != buzz_core::kind::KIND_WORKFLOW_AGENT_TASK as i32
                            || !exact("workflow-run", &task.run_id.to_string())
                            || !exact("h", &task.channel_id.to_string())
                            || !tags
                                .iter()
                                .any(|t| t.as_slice() == ["p", &control.target_agent])
                            || created.timestamp() < control.container_started_at
                            || created.timestamp() > control.container_finished_at
                        {
                            valid = false;
                            break;
                        }
                    }
                    if !valid {
                        denied("unsupported_legacy_recovery_evidence")
                    } else {
                        let mut runs = std::collections::BTreeSet::new();
                        for task in tasks {
                            sqlx::query("UPDATE workflow_run_tasks SET state='failed' WHERE community_id=$1 AND run_id=$2 AND task_id=$3").bind(community.as_uuid()).bind(task.run_id).bind(task.task_id).execute(&mut *tx).await?;
                            runs.insert(task.run_id);
                        }
                        for run in runs {
                            // Other unresolved legacy targets retain the overlap fence.
                            let unresolved:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND state NOT IN ('completed','failed')) OR EXISTS(SELECT 1 FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2 AND stopped_at IS NULL)").bind(community.as_uuid()).bind(run).fetch_one(&mut *tx).await?;
                            if !unresolved {
                                sqlx::query("UPDATE workflow_runs SET execution_state='failed',safe_error_code='recovery_stopped' WHERE community_id=$1 AND id=$2").bind(community.as_uuid()).bind(run).execute(&mut *tx).await?;
                            }
                            sqlx::query("UPDATE workflow_runs SET revision=revision+1 WHERE community_id=$1 AND id=$2").bind(community.as_uuid()).bind(run).execute(&mut *tx).await?;
                            invalidate(&mut tx, community, run, keys).await?;
                        }
                        accepted()
                    }
                }
            }
        };
        sqlx::query("INSERT INTO workflow_recovery_receipts(community_id,event_id,controller_pubkey,target_agent,evidence_id,container_id,control,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(community.as_uuid()).bind(event.id.as_bytes().as_slice()).bind(event.pubkey.to_bytes().as_slice()).bind(agent).bind(evidence).bind(&control.container_id).bind(serde_json::to_value(control)?).bind(serde_json::to_value(&receipt)?).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(receipt)
    }
}
