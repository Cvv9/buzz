//! Transactional execution grants. Provider execution is never inferred from dispatch.
use crate::{error::Result, workflow_manual::lock_admission, Db, DbError};
use buzz_core::{workflow_execution::*, CommunityId};
use chrono::{DateTime, Utc};
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

/// Durable response to one signed control event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlReceipt {
    /// Whether the control operation was accepted.
    pub accepted: bool,
    /// Stable denial code without provider diagnostics.
    pub reason: Option<String>,
    /// Exact grant originally committed for a claim.
    pub decision: Option<ExecutionDecision>,
    /// Current revision for a safely re-signed stale claim.
    pub current_revision: Option<i64>,
    /// Exact persisted relay-signed grant, verifiable against the pinned relay.
    pub signed_event: Option<Event>,
}
impl ControlReceipt {
    fn accepted(decision: Option<ExecutionDecision>) -> Self {
        Self {
            accepted: true,
            reason: None,
            decision,
            current_revision: None,
            signed_event: None,
        }
    }
    fn denied(reason: &str) -> Self {
        Self {
            accepted: false,
            reason: Some(reason.into()),
            decision: None,
            current_revision: None,
            signed_event: None,
        }
    }
}

/// Child read identity, restricted to the granted task destination.
#[derive(Debug, Clone)]
pub struct WorkflowReadScope {
    /// Original agent used only for authorization of reads.
    pub agent_pubkey: Vec<u8>,
    /// Sole destination visible to this attempt.
    pub channel_id: Uuid,
    /// Accepted run owning this identity.
    pub run_id: Uuid,
}

fn invalid(message: impl ToString) -> DbError {
    DbError::InvalidData(message.to_string())
}

/// Require one exact, two-element tag. Duplicate or extra values are rejected.
pub fn exact_tag(event: &Event, key: &str, value: &str) -> bool {
    let mut matches = event
        .tags
        .iter()
        .filter(|tag| tag.as_slice().first().is_some_and(|v| v == key));
    matches
        .next()
        .is_some_and(|tag| tag.as_slice() == [key, value])
        && matches.next().is_none()
}

pub(crate) async fn enqueue(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    run: Uuid,
    event: &Event,
) -> Result<()> {
    sqlx::query("INSERT INTO workflow_run_outbox(community_id,id,run_id,event_id,signed_event) VALUES($1,$2,$3,$4,$5) ON CONFLICT(community_id,event_id) DO NOTHING")
        .bind(community.as_uuid()).bind(Uuid::new_v4()).bind(run).bind(event.id.as_bytes().as_slice()).bind(serde_json::to_value(event)?).execute(&mut **tx).await?;
    Ok(())
}
fn signed_decision(decision: &ExecutionDecision, keys: &Keys) -> Result<Event> {
    let tags = [
        ("p", decision.agent_pubkey.clone()),
        ("h", decision.channel_id.to_string()),
        ("workflow-run", decision.run_id.to_string()),
        ("workflow-task", decision.task_id.to_string()),
        ("workflow-grant", decision.grant_id.to_string()),
    ]
    .into_iter()
    .map(|(k, v)| Tag::parse([k, &v]).map_err(invalid))
    .collect::<Result<Vec<_>>>()?;
    EventBuilder::new(
        Kind::Custom(buzz_core::kind::KIND_WORKFLOW_EXECUTION_DECISION as u16),
        serde_json::to_string(decision)?,
    )
    .tags(tags)
    .sign_with_keys(keys)
    .map_err(invalid)
}

pub(crate) async fn invalidate(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    run: Uuid,
    keys: &Keys,
) -> Result<()> {
    let row = sqlx::query("SELECT r.workflow_id,r.revision,w.owner_pubkey,w.channel_id FROM workflow_runs r JOIN workflows w ON w.community_id=r.community_id AND w.id=r.workflow_id WHERE r.community_id=$1 AND r.id=$2")
        .bind(community.as_uuid()).bind(run).fetch_one(&mut **tx).await?;
    let Some(channel) = row.try_get::<Option<Uuid>, _>("channel_id")? else {
        return Ok(());
    };
    let status = RunStatusInvalidation {
        version: PROTOCOL_VERSION,
        community_id: *community.as_uuid(),
        workflow_id: row.try_get("workflow_id")?,
        run_id: run,
        revision: row.try_get("revision")?,
    };
    let tags = [
        ("p", hex::encode(row.try_get::<Vec<u8>, _>("owner_pubkey")?)),
        ("h", channel.to_string()),
        ("d", status.workflow_id.to_string()),
        ("workflow-run", run.to_string()),
    ]
    .into_iter()
    .map(|(k, v)| Tag::parse([k, &v]).map_err(invalid))
    .collect::<Result<Vec<_>>>()?;
    let event = EventBuilder::new(
        Kind::Custom(buzz_core::kind::KIND_WORKFLOW_RUN_STATUS as u16),
        serde_json::to_string(&status)?,
    )
    .tags(tags)
    .sign_with_keys(keys)
    .map_err(invalid)?;
    enqueue(tx, community, run, &event).await
}

/// Current permissions are evaluated from durable rows, never a membership cache.
pub(crate) async fn authorized(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    run: Uuid,
) -> Result<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_runs r JOIN workflows w ON w.community_id=r.community_id AND w.id=r.workflow_id WHERE r.community_id=$1 AND r.id=$2 AND w.enabled AND w.status='active' AND w.manual_deleted_at IS NULL AND w.definition_hash=r.definition_hash AND EXISTS(SELECT 1 FROM users owner_user WHERE owner_user.community_id=w.community_id AND owner_user.pubkey=w.owner_pubkey AND owner_user.deactivated_at IS NULL) AND EXISTS(SELECT 1 FROM relay_members rm WHERE rm.community_id=w.community_id AND rm.pubkey=encode(w.owner_pubkey,'hex')) AND NOT EXISTS(SELECT 1 FROM community_bans b WHERE b.community_id=w.community_id AND b.pubkey=w.owner_pubkey AND ((b.banned AND (b.ban_expires_at IS NULL OR b.ban_expires_at>clock_timestamp())) OR b.muted_until>clock_timestamp())) AND (r.origin<>'manual' OR (r.requester=w.owner_pubkey AND EXISTS(SELECT 1 FROM relay_members rm WHERE rm.community_id=w.community_id AND rm.pubkey=encode(w.owner_pubkey,'hex') AND rm.role='owner'))) AND NOT EXISTS(SELECT 1 FROM workflow_run_tasks t WHERE t.community_id=r.community_id AND t.run_id=r.id AND (EXISTS(SELECT 1 FROM community_bans b WHERE b.community_id=t.community_id AND b.pubkey=t.agent_pubkey AND ((b.banned AND (b.ban_expires_at IS NULL OR b.ban_expires_at>clock_timestamp())) OR b.muted_until>clock_timestamp())) OR NOT EXISTS(SELECT 1 FROM users u WHERE u.community_id=t.community_id AND u.pubkey=t.agent_pubkey AND u.agent_owner_pubkey=w.owner_pubkey AND u.deactivated_at IS NULL) OR NOT EXISTS(SELECT 1 FROM channels c WHERE c.community_id=t.community_id AND c.id=t.channel_id AND (r.origin<>'manual' OR c.channel_type<>'dm') AND c.archived_at IS NULL AND c.deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM channel_members m WHERE m.community_id=t.community_id AND m.channel_id=t.channel_id AND m.pubkey=t.agent_pubkey AND m.removed_at IS NULL) OR NOT EXISTS(SELECT 1 FROM channel_members m WHERE m.community_id=t.community_id AND m.channel_id=t.channel_id AND m.pubkey=w.owner_pubkey AND m.removed_at IS NULL))))")
        .bind(community.as_uuid()).bind(run).fetch_one(&mut **tx).await.map_err(Into::into)
}

impl Db {
    /// Recognize even revoked/expired credentials globally, so they cannot fall
    /// through to ordinary member, public-relay, or another-tenant authorization.
    pub async fn is_workflow_credential(&self, key: &[u8]) -> Result<bool> {
        Ok(sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM workflow_run_credentials WHERE ephemeral_pubkey=$1)",
        )
        .bind(key)
        .fetch_one(&self.pool)
        .await?)
    }

    /// Return a live read scope, rechecking deadline, terminal state and access.
    pub async fn workflow_read_scope(
        &self,
        community: CommunityId,
        key: &[u8],
    ) -> Result<Option<WorkflowReadScope>> {
        let mut tx = self.begin_transaction().await?;
        self.deletion_store()
            .guard_transaction(&mut tx, community)
            .await?;
        let row=sqlx::query("SELECT c.run_id,c.agent_pubkey,t.channel_id FROM workflow_run_credentials c JOIN workflow_runs r ON r.community_id=c.community_id AND r.id=c.run_id JOIN workflow_run_attempts a ON a.community_id=c.community_id AND a.run_id=c.run_id AND a.ordinal=c.attempt_ordinal JOIN workflow_run_tasks t ON t.community_id=a.community_id AND t.run_id=a.run_id AND t.task_id=a.task_id WHERE c.community_id=$1 AND c.ephemeral_pubkey=$2 AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND (r.deadline_at IS NULL OR r.deadline_at>clock_timestamp()) AND a.deadline_at>clock_timestamp() AND r.execution_state IN ('queued','running') AND a.stopped_at IS NULL")
            .bind(community.as_uuid()).bind(key).fetch_optional(&mut *tx).await?;
        let Some(row) = row else { return Ok(None) };
        let run = row.try_get("run_id")?;
        if !authorized(&mut tx, community, run).await? {
            return Ok(None);
        }
        Ok(Some(WorkflowReadScope {
            agent_pubkey: row.try_get("agent_pubkey")?,
            channel_id: row.try_get("channel_id")?,
            run_id: run,
        }))
    }

    /// Apply one verified agent-signed operation under the shared admission lock.
    /// Replays return the committed receipt and cannot allocate another attempt.
    pub async fn workflow_execution_control(
        &self,
        community: CommunityId,
        event: &Event,
        control: &ExecutionControl,
        keys: &Keys,
    ) -> Result<ControlReceipt> {
        let recovering = matches!(control.operation, ExecutionOperation::RecoverClaim { .. });
        if recovering
            && (control.community_id != *community.as_uuid()
                || control.agent_pubkey != event.pubkey.to_hex()
                || recovery_claim_scope(control).is_none())
        {
            return Ok(ControlReceipt::denied("invalid_recovery_claim"));
        }
        let mut tx = self.begin_transaction().await?;
        self.deletion_store()
            .guard_transaction(&mut tx, community)
            .await?;
        lock_admission(&mut tx, community).await?;
        let agent = event.pubkey.to_bytes();
        if recovering {
            let Some((run, task, channel)) = recovery_claim_scope(control) else {
                return Ok(ControlReceipt::denied("invalid_recovery_claim"));
            };
            let bound: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND task_id=$3 AND channel_id=$4 AND agent_pubkey=$5)")
                .bind(community.as_uuid()).bind(run).bind(task).bind(channel).bind(agent.as_slice()).fetch_one(&mut *tx).await?;
            if !bound {
                return Ok(ControlReceipt::denied("invalid_recovery_claim"));
            }
        }
        let receipt:Option<serde_json::Value>=sqlx::query_scalar("SELECT response FROM workflow_execution_receipts WHERE community_id=$1 AND event_id=$2 AND agent_pubkey=$3").bind(community.as_uuid()).bind(event.id.as_bytes().as_slice()).bind(agent.as_slice()).fetch_optional(&mut *tx).await?;
        if let Some(receipt) = receipt {
            let receipt: ControlReceipt = serde_json::from_value(receipt)?;
            if let Some(decision) = receipt.decision.as_ref().filter(|_| !recovering) {
                let live:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_attempts a JOIN workflow_runs r ON r.community_id=a.community_id AND r.id=a.run_id WHERE a.community_id=$1 AND a.grant_id=$2 AND a.stopped_at IS NULL AND a.deadline_at>clock_timestamp() AND r.execution_state IN ('queued','running'))").bind(community.as_uuid()).bind(decision.grant_id).fetch_one(&mut *tx).await?;
                if !live || !authorized(&mut tx, community, decision.run_id).await? {
                    return Ok(ControlReceipt::denied("grant_inactive"));
                }
            }
            if recovering && receipt.accepted && receipt.reason.as_deref() == Some("no_grant") {
                finish_unclaimed_recovery(&mut tx, community, control, keys).await?;
                tx.commit().await?;
            }
            return Ok(receipt);
        }
        let receipt = match &control.operation {
            ExecutionOperation::RecoverClaim { signed_claim } => {
                let original: Option<serde_json::Value> = sqlx::query_scalar("SELECT response FROM workflow_execution_receipts WHERE community_id=$1 AND event_id=$2 AND agent_pubkey=$3")
                    .bind(community.as_uuid()).bind(signed_claim.id.as_bytes().as_slice()).bind(agent.as_slice()).fetch_optional(&mut *tx).await?;
                let receipt = match original {
                    Some(value) => {
                        let saved: ControlReceipt = serde_json::from_value(value)?;
                        if saved.accepted
                            && saved.decision.is_some()
                            && saved.signed_event.is_some()
                        {
                            saved
                        } else {
                            let mut receipt = ControlReceipt::accepted(None);
                            receipt.reason = Some("no_grant".into());
                            receipt
                        }
                    }
                    None => {
                        let tombstone = ControlReceipt::denied("claim_recovered_without_grant");
                        sqlx::query("INSERT INTO workflow_execution_receipts(community_id,event_id,agent_pubkey,response) VALUES($1,$2,$3,$4)")
                            .bind(community.as_uuid()).bind(signed_claim.id.as_bytes().as_slice()).bind(agent.as_slice()).bind(serde_json::to_value(tombstone)?).execute(&mut *tx).await?;
                        let mut receipt = ControlReceipt::accepted(None);
                        receipt.reason = Some("no_grant".into());
                        receipt
                    }
                };
                if receipt.reason.as_deref() == Some("no_grant") {
                    finish_unclaimed_recovery(&mut tx, community, control, keys).await?;
                }
                receipt
            }
            ExecutionOperation::Capability {
                runtime_profile,
                max_turn_duration_secs,
            } => {
                let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users u JOIN relay_members m ON m.community_id=u.community_id AND m.pubkey=encode(u.agent_owner_pubkey,'hex') WHERE u.community_id=$1 AND u.pubkey=$2 AND u.agent_owner_pubkey IS NOT NULL AND u.deactivated_at IS NULL)").bind(community.as_uuid()).bind(agent.as_slice()).fetch_one(&mut *tx).await?;
                if valid
                    && runtime_profile == "linux-uids-v1"
                    && (1..=604800).contains(max_turn_duration_secs)
                {
                    sqlx::query("INSERT INTO workflow_execution_capabilities(community_id,agent_pubkey,instance_id,protocol_version,expires_at,max_turn_duration_secs) VALUES($1,$2,$3,1,clock_timestamp()+interval '90 seconds',$4) ON CONFLICT(community_id,agent_pubkey) DO UPDATE SET instance_id=EXCLUDED.instance_id,expires_at=EXCLUDED.expires_at,max_turn_duration_secs=EXCLUDED.max_turn_duration_secs").bind(community.as_uuid()).bind(agent.as_slice()).bind(control.instance_id).bind(*max_turn_duration_secs as i64).execute(&mut *tx).await?;
                    ControlReceipt::accepted(None)
                } else {
                    ControlReceipt::denied("permission_revoked")
                }
            }
            ExecutionOperation::Claim {
                run_id,
                task_id,
                channel_id,
                revision,
                ephemeral_pubkey,
            } => {
                claim(
                    &mut tx,
                    community,
                    control,
                    *run_id,
                    *task_id,
                    *channel_id,
                    *revision,
                    ephemeral_pubkey,
                    keys,
                )
                .await?
            }
            ExecutionOperation::Started {
                grant_id,
                run_id,
                task_id,
                channel_id,
                ordinal,
            } => {
                acknowledge(
                    &mut tx,
                    community,
                    control,
                    *grant_id,
                    *run_id,
                    *task_id,
                    *channel_id,
                    *ordinal,
                    None,
                    None,
                    keys,
                )
                .await?
            }
            ExecutionOperation::Finished {
                grant_id,
                run_id,
                task_id,
                channel_id,
                ordinal,
                result_event_id,
            } => {
                acknowledge(
                    &mut tx,
                    community,
                    control,
                    *grant_id,
                    *run_id,
                    *task_id,
                    *channel_id,
                    *ordinal,
                    Some(result_event_id),
                    None,
                    keys,
                )
                .await?
            }
            ExecutionOperation::Stopped {
                grant_id,
                run_id,
                task_id,
                channel_id,
                ordinal,
                reason,
            } => {
                acknowledge(
                    &mut tx,
                    community,
                    control,
                    *grant_id,
                    *run_id,
                    *task_id,
                    *channel_id,
                    *ordinal,
                    None,
                    Some(reason),
                    keys,
                )
                .await?
            }
        };
        sqlx::query("INSERT INTO workflow_execution_receipts(community_id,event_id,agent_pubkey,response) VALUES($1,$2,$3,$4)").bind(community.as_uuid()).bind(event.id.as_bytes().as_slice()).bind(agent.as_slice()).bind(serde_json::to_value(&receipt)?).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(receipt)
    }
}

// A runner receiving no_grant stops retrying this task. Close only known
// unstarted supervised work; another claim may already own a live attempt.
async fn finish_unclaimed_recovery(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    control: &ExecutionControl,
    keys: &Keys,
) -> Result<()> {
    let Some((run, task, _)) = recovery_claim_scope(control) else {
        return Err(invalid("invalid recovery claim"));
    };
    let row = sqlx::query("SELECT t.state,t.task_event_id,r.execution_state FROM workflow_runs r JOIN workflow_run_tasks t ON t.community_id=r.community_id AND t.run_id=r.id WHERE r.community_id=$1 AND r.id=$2 AND t.task_id=$3 FOR UPDATE OF r,t")
        .bind(community.as_uuid()).bind(run).bind(task).fetch_one(&mut **tx).await?;
    if row.try_get::<String, _>("state")? != "queued"
        || !matches!(
            row.try_get::<Option<String>, _>("execution_state")?
                .as_deref(),
            Some("queued" | "running")
        )
    {
        return Ok(());
    }
    let stoppable: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_outbox WHERE community_id=$1 AND run_id=$2 AND event_id=$4 AND signed_event->'tags' @> '[[\"workflow-protocol\",\"1\"]]'::jsonb) AND NOT EXISTS(SELECT 1 FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2 AND task_id=$3 AND stopped_at IS NULL)")
        .bind(community.as_uuid()).bind(run).bind(task).bind(row.try_get::<Option<Vec<u8>>, _>("task_event_id")?).fetch_one(&mut **tx).await?;
    if !stoppable {
        return Ok(());
    }
    sqlx::query("UPDATE workflow_run_tasks SET state='failed' WHERE community_id=$1 AND run_id=$2 AND task_id=$3")
        .bind(community.as_uuid()).bind(run).bind(task).execute(&mut **tx).await?;
    sqlx::query("UPDATE workflow_run_outbox SET acknowledged_at=COALESCE(acknowledged_at,clock_timestamp()) WHERE community_id=$1 AND run_id=$2 AND event_id=$3")
        .bind(community.as_uuid()).bind(run).bind(row.try_get::<Option<Vec<u8>>, _>("task_event_id")?).execute(&mut **tx).await?;
    reconcile(tx, community, run, keys).await?;
    sqlx::query("UPDATE workflow_runs SET revision=revision+1 WHERE community_id=$1 AND id=$2")
        .bind(community.as_uuid())
        .bind(run)
        .execute(&mut **tx)
        .await?;
    invalidate(tx, community, run, keys).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn claim(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    control: &ExecutionControl,
    run: Uuid,
    task: Uuid,
    channel: Uuid,
    revision: i64,
    ephemeral: &str,
    keys: &Keys,
) -> Result<ControlReceipt> {
    let agent = hex::decode(&control.agent_pubkey).map_err(invalid)?;
    let ephemeral = hex::decode(ephemeral).map_err(invalid)?;
    if ephemeral.len() != 32 || ephemeral == agent {
        return Ok(ControlReceipt::denied("invalid_credential"));
    }
    let row=sqlx::query("SELECT r.origin,r.execution_state,r.revision,r.deadline_at,t.state,t.task_event_id FROM workflow_runs r JOIN workflow_run_tasks t ON t.community_id=r.community_id AND t.run_id=r.id WHERE r.community_id=$1 AND r.id=$2 AND t.task_id=$3 AND t.agent_pubkey=$4 AND t.channel_id=$5 FOR UPDATE OF r,t")
        .bind(community.as_uuid()).bind(run).bind(task).bind(&agent).bind(channel).fetch_optional(&mut **tx).await?;
    let Some(row) = row else {
        return Ok(ControlReceipt::denied("task_not_found"));
    };
    let supervised:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_outbox WHERE community_id=$1 AND run_id=$2 AND event_id=$3 AND signed_event->'tags' @> '[[\"workflow-protocol\",\"1\"]]'::jsonb)").bind(community.as_uuid()).bind(run).bind(row.try_get::<Option<Vec<u8>>,_>("task_event_id")?).fetch_one(&mut **tx).await?;
    if !supervised {
        return Ok(ControlReceipt::denied("legacy_execution_unknown"));
    }
    // Same instance/credential retry returns its original durable grant, never a new ordinal.
    let existing:Option<serde_json::Value>=sqlx::query_scalar("SELECT a.grant_decision FROM workflow_run_attempts a JOIN workflow_runs r ON r.community_id=a.community_id AND r.id=a.run_id LEFT JOIN workflow_run_credentials c ON c.community_id=a.community_id AND c.run_id=a.run_id AND c.attempt_ordinal=a.ordinal WHERE a.community_id=$1 AND a.run_id=$2 AND a.task_id=$3 AND a.instance_id=$4 AND (r.origin<>'manual' OR c.ephemeral_pubkey=$5) AND a.stopped_at IS NULL")
        .bind(community.as_uuid()).bind(run).bind(task).bind(control.instance_id).bind(&ephemeral).fetch_optional(&mut **tx).await?;
    if !authorized(tx, community, run).await? {
        return Ok(ControlReceipt::denied("permission_revoked"));
    }
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut **tx)
        .await?;
    let deadline: Option<DateTime<Utc>> = row.try_get("deadline_at")?;
    let deadline = if row.try_get::<String, _>("origin")? == "manual" {
        let Some(deadline) = deadline.filter(|d| *d > now) else {
            return Ok(ControlReceipt::denied("deadline_exceeded"));
        };
        deadline
    } else {
        let seconds:Option<i64>=sqlx::query_scalar("SELECT max_turn_duration_secs FROM workflow_execution_capabilities WHERE community_id=$1 AND agent_pubkey=$2 AND instance_id=$3 AND expires_at>clock_timestamp()").bind(community.as_uuid()).bind(&agent).bind(control.instance_id).fetch_optional(&mut **tx).await?;
        let Some(seconds) = seconds else {
            return Ok(ControlReceipt::denied("runner_unavailable"));
        };
        // Ordinary ACP allows ten minutes for authentication/startup before its configured turn bound.
        now + chrono::Duration::seconds(seconds + 600)
    };
    if !matches!(
        row.try_get::<Option<String>, _>("execution_state")?
            .as_deref(),
        Some("queued" | "running")
    ) {
        return Ok(ControlReceipt::denied("run_inactive"));
    }
    if let Some(existing) = existing {
        let decision: ExecutionDecision = serde_json::from_value(existing)?;
        if decision.deadline <= now.timestamp() {
            return Ok(ControlReceipt::denied("deadline_exceeded"));
        }
        let signed:serde_json::Value=sqlx::query_scalar("SELECT signed_event FROM workflow_run_outbox WHERE community_id=$1 AND run_id=$2 AND signed_event->>'kind'='46041' AND (CASE WHEN signed_event->>'kind'='46041' THEN (signed_event->>'content')::jsonb ELSE '{}'::jsonb END)->>'grant_id'=$3 AND (CASE WHEN signed_event->>'kind'='46041' THEN (signed_event->>'content')::jsonb ELSE '{}'::jsonb END)->>'decision'='grant' LIMIT 1").bind(community.as_uuid()).bind(run).bind(decision.grant_id.to_string()).fetch_one(&mut **tx).await?;
        let mut receipt = ControlReceipt::accepted(Some(decision));
        receipt.signed_event = Some(serde_json::from_value(signed)?);
        return Ok(receipt);
    }
    if row.try_get::<String, _>("state")? == "completed" {
        return Ok(ControlReceipt::denied("task_completed"));
    }
    let pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2 AND task_id=$3 AND stopped_at IS NULL)").bind(community.as_uuid()).bind(run).bind(task).fetch_one(&mut **tx).await?;
    if pending {
        return Ok(ControlReceipt::denied("stopped_pending"));
    }
    let live:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_execution_capabilities WHERE community_id=$1 AND agent_pubkey=$2 AND instance_id=$3 AND expires_at>clock_timestamp())").bind(community.as_uuid()).bind(&agent).bind(control.instance_id).fetch_one(&mut **tx).await?;
    if !live {
        return Ok(ControlReceipt::denied("runner_unavailable"));
    }
    let current = row.try_get::<i64, _>("revision")?;
    if revision != current {
        let mut denied = ControlReceipt::denied("revision_changed");
        denied.current_revision = Some(current);
        return Ok(denied);
    }
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
    )
    .bind(community.as_uuid())
    .bind(run)
    .fetch_one(&mut **tx)
    .await?;
    let reserved:i64=sqlx::query_scalar("SELECT COUNT(*) FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND task_id<>$3 AND attempt_count=0 AND state<>'completed'").bind(community.as_uuid()).bind(run).bind(task).fetch_one(&mut **tx).await?;
    if row.try_get::<String, _>("origin")? == "manual"
        && count + reserved >= i64::from(MANUAL_MAX_ATTEMPTS)
    {
        return Ok(ControlReceipt::denied("no_more_attempts"));
    }
    if row.try_get::<String, _>("origin")? == "manual" {
        let used:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_credentials WHERE ephemeral_pubkey=$1) OR EXISTS(SELECT 1 FROM users WHERE pubkey=$1)").bind(&ephemeral).fetch_one(&mut **tx).await?;
        if used {
            return Ok(ControlReceipt::denied("credential_reused"));
        }
    }
    let ordinal = i32::try_from(count + 1).map_err(invalid)?;
    let revision:i64=sqlx::query_scalar("UPDATE workflow_runs SET revision=revision+1,execution_state='running' WHERE community_id=$1 AND id=$2 RETURNING revision").bind(community.as_uuid()).bind(run).fetch_one(&mut **tx).await?;
    let decision = ExecutionDecision {
        version: PROTOCOL_VERSION,
        community_id: *community.as_uuid(),
        agent_pubkey: control.agent_pubkey.clone(),
        instance_id: control.instance_id,
        run_id: run,
        task_id: task,
        grant_id: Uuid::new_v4(),
        channel_id: channel,
        ordinal,
        revision,
        deadline: deadline.timestamp(),
        decision: DecisionKind::Grant,
    };
    sqlx::query("INSERT INTO workflow_run_attempts(community_id,run_id,ordinal,task_id,grant_id,instance_id,deadline_at,grant_decision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(community.as_uuid()).bind(run).bind(ordinal).bind(task).bind(decision.grant_id).bind(control.instance_id).bind(deadline).bind(serde_json::to_value(&decision)?).execute(&mut **tx).await?;
    if row.try_get::<String, _>("origin")? == "manual" {
        sqlx::query("INSERT INTO workflow_run_credentials(community_id,ephemeral_pubkey,run_id,agent_pubkey,attempt_ordinal,expires_at) VALUES($1,$2,$3,$4,$5,$6)").bind(community.as_uuid()).bind(ephemeral).bind(run).bind(agent).bind(ordinal).bind(deadline).execute(&mut **tx).await?;
    }
    sqlx::query("UPDATE workflow_run_tasks SET attempt_count=attempt_count+1,runner_instance=$4,state='running' WHERE community_id=$1 AND run_id=$2 AND task_id=$3").bind(community.as_uuid()).bind(run).bind(task).bind(control.instance_id).execute(&mut **tx).await?;
    sqlx::query("UPDATE workflow_run_outbox SET acknowledged_at=clock_timestamp() WHERE community_id=$1 AND run_id=$2 AND event_id=$3").bind(community.as_uuid()).bind(run).bind(row.try_get::<Option<Vec<u8>>,_>("task_event_id")?).execute(&mut **tx).await?;
    let signed = signed_decision(&decision, keys)?;
    enqueue(tx, community, run, &signed).await?;
    invalidate(tx, community, run, keys).await?;
    let mut receipt = ControlReceipt::accepted(Some(decision));
    receipt.signed_event = Some(signed);
    Ok(receipt)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn acknowledge(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    control: &ExecutionControl,
    grant: Uuid,
    run: Uuid,
    task: Uuid,
    channel: Uuid,
    ordinal: i32,
    result: Option<&String>,
    stopped: Option<&StopReason>,
    keys: &Keys,
) -> Result<ControlReceipt> {
    let agent = hex::decode(&control.agent_pubkey).map_err(invalid)?;
    let row=sqlx::query("SELECT a.stopped_at,a.started_at,a.outcome,a.deadline_at,r.execution_state,t.task_event_id,r.origin FROM workflow_run_attempts a JOIN workflow_run_tasks t ON t.community_id=a.community_id AND t.run_id=a.run_id AND t.task_id=a.task_id JOIN workflow_runs r ON r.community_id=a.community_id AND r.id=a.run_id WHERE a.community_id=$1 AND a.run_id=$2 AND a.task_id=$3 AND a.grant_id=$4 AND a.ordinal=$5 AND a.instance_id=$6 AND t.agent_pubkey=$7 AND t.channel_id=$8 FOR UPDATE OF a,r,t")
        .bind(community.as_uuid()).bind(run).bind(task).bind(grant).bind(ordinal).bind(control.instance_id).bind(&agent).bind(channel).fetch_optional(&mut **tx).await?;
    let Some(row) = row else {
        return Ok(ControlReceipt::denied("grant_not_found"));
    };
    if row
        .try_get::<Option<DateTime<Utc>>, _>("stopped_at")?
        .is_some()
    {
        return Ok(if stopped.is_some() {
            ControlReceipt::accepted(None)
        } else {
            ControlReceipt::denied("attempt_stopped")
        });
    }
    // Stop acknowledgements are deliberately authorized by the original exact
    // grant even after the owner's membership, definition or channel is revoked.
    if stopped.is_none() {
        if !authorized(tx, community, run).await? {
            return Ok(ControlReceipt::denied("permission_revoked"));
        }
        let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(&mut **tx)
            .await?;
        if row.try_get::<DateTime<Utc>, _>("deadline_at")? <= now {
            return Ok(ControlReceipt::denied("deadline_exceeded"));
        }
        if !matches!(
            row.try_get::<Option<String>, _>("execution_state")?
                .as_deref(),
            Some("queued" | "running")
        ) {
            return Ok(ControlReceipt::denied("run_inactive"));
        }
    }
    if result.is_none() && stopped.is_none() {
        sqlx::query("UPDATE workflow_run_attempts SET started_at=COALESCE(started_at,clock_timestamp()) WHERE community_id=$1 AND run_id=$2 AND ordinal=$3").bind(community.as_uuid()).bind(run).bind(ordinal).execute(&mut **tx).await?;
    } else {
        if let Some(result) = result {
            if row
                .try_get::<Option<DateTime<Utc>>, _>("started_at")?
                .is_none()
            {
                return Ok(ControlReceipt::denied("attempt_not_started"));
            }
            let result_id = hex::decode(result).map_err(invalid)?;
            let stored=sqlx::query("SELECT pubkey,kind,tags FROM events WHERE community_id=$1 AND id=$2 AND deleted_at IS NULL LIMIT 1").bind(community.as_uuid()).bind(&result_id).fetch_optional(&mut **tx).await?;
            let Some(stored) = stored else {
                return Ok(ControlReceipt::denied("result_not_found"));
            };
            let tags: Vec<Vec<String>> = serde_json::from_value(stored.try_get("tags")?)?;
            let matches = |key: &str, value: &str| {
                let mut found = tags.iter().filter(|t| t.first().is_some_and(|k| k == key));
                found.next().is_some_and(|t| t.as_slice() == [key, value]) && found.next().is_none()
            };
            if stored.try_get::<Vec<u8>, _>("pubkey")? != agent
                || stored.try_get::<i32, _>("kind")? != 9
                || !matches("h", &channel.to_string())
                || !matches("workflow-run", &run.to_string())
                || !matches("workflow-task", &task.to_string())
                || !matches("workflow-grant", &grant.to_string())
                || !matches("workflow-ordinal", &ordinal.to_string())
                || !matches("workflow-instance", &control.instance_id.to_string())
                || !matches(
                    "workflow-result",
                    &hex::encode(
                        row.try_get::<Option<Vec<u8>>, _>("task_event_id")?
                            .unwrap_or_default(),
                    ),
                )
                || !matches("workflow-origin", &row.try_get::<String, _>("origin")?)
            {
                return Ok(ControlReceipt::denied("invalid_result"));
            }
            sqlx::query("UPDATE workflow_run_tasks SET state='completed',result_event_id=$4 WHERE community_id=$1 AND run_id=$2 AND task_id=$3").bind(community.as_uuid()).bind(run).bind(task).bind(result_id).execute(&mut **tx).await?;
        } else {
            let terminal = matches!(
                stopped,
                Some(
                    StopReason::DeadlineExceeded
                        | StopReason::PermissionRevoked
                        | StopReason::RecoveryStopped
                )
            );
            sqlx::query("UPDATE workflow_run_tasks SET state=$4 WHERE community_id=$1 AND run_id=$2 AND task_id=$3").bind(community.as_uuid()).bind(run).bind(task).bind(if terminal{"failed"}else{"queued"}).execute(&mut **tx).await?;
        }
        let outcome = if result.is_some() {
            "completed"
        } else {
            match stopped {
                Some(StopReason::DeadlineExceeded) => "deadline_exceeded",
                Some(StopReason::PermissionRevoked) => "permission_revoked",
                Some(StopReason::RecoveryStopped) => "recovery_stopped",
                _ => "execution_failed",
            }
        };
        sqlx::query("UPDATE workflow_run_attempts SET stopped_at=clock_timestamp(),outcome=$4 WHERE community_id=$1 AND run_id=$2 AND ordinal=$3").bind(community.as_uuid()).bind(run).bind(ordinal).bind(outcome).execute(&mut **tx).await?;
        sqlx::query("UPDATE workflow_run_credentials SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE community_id=$1 AND run_id=$2 AND attempt_ordinal=$3").bind(community.as_uuid()).bind(run).bind(ordinal).execute(&mut **tx).await?;
        reconcile(tx, community, run, keys).await?;
    }
    // Stop retrying this exact grant/cancel when the runner has acknowledged it.
    sqlx::query("UPDATE workflow_run_outbox SET acknowledged_at=clock_timestamp() WHERE community_id=$1 AND run_id=$2 AND signed_event->>'kind'='46041' AND signed_event->>'content' LIKE $3")
        .bind(community.as_uuid()).bind(run).bind(format!("%{grant}%")).execute(&mut **tx).await?;
    sqlx::query("UPDATE workflow_runs SET revision=revision+1 WHERE community_id=$1 AND id=$2")
        .bind(community.as_uuid())
        .bind(run)
        .execute(&mut **tx)
        .await?;
    invalidate(tx, community, run, keys).await?;
    Ok(ControlReceipt::accepted(None))
}

/// Aggregate actual evidence, retaining the active fence for unknown processes.
pub(crate) async fn reconcile(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    run: Uuid,
    keys: &Keys,
) -> Result<()> {
    let row=sqlx::query("SELECT origin,deadline_at,execution_state,dispatch_complete,revision,status::text AS status FROM workflow_runs WHERE community_id=$1 AND id=$2 FOR UPDATE").bind(community.as_uuid()).bind(run).fetch_one(&mut **tx).await?;
    if matches!(
        row.try_get::<Option<String>, _>("execution_state")?
            .as_deref(),
        Some("completed" | "failed" | "timed_out")
    ) {
        return Ok(());
    }
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut **tx)
        .await?;
    let deadline = row
        .try_get::<Option<DateTime<Utc>>, _>("deadline_at")?
        .is_some_and(|d| d <= now);
    let permission = !authorized(tx, community, run).await?;
    let tasks = sqlx::query(
        "SELECT state,attempt_count FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2",
    )
    .bind(community.as_uuid())
    .bind(run)
    .fetch_all(&mut **tx)
    .await?;
    let all_completed = !tasks.is_empty()
        && tasks
            .iter()
            .all(|t| t.get::<String, _>("state") == "completed");
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
    )
    .bind(community.as_uuid())
    .bind(run)
    .fetch_one(&mut **tx)
    .await?;
    let failed = matches!(
        row.try_get::<String, _>("status")?.as_str(),
        "failed" | "cancelled"
    ) || tasks
        .iter()
        .any(|t| t.get::<String, _>("state") == "failed")
        || (row.try_get::<String, _>("origin")? == "manual"
            && count >= 2
            && tasks
                .iter()
                .any(|t| t.get::<String, _>("state") == "queued"));
    let expired_attempt:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2 AND stopped_at IS NULL AND deadline_at<=clock_timestamp())").bind(community.as_uuid()).bind(run).fetch_one(&mut **tx).await?;
    let abort = deadline || permission || failed || expired_attempt;
    if abort {
        sqlx::query("UPDATE workflow_run_credentials SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE community_id=$1 AND run_id=$2").bind(community.as_uuid()).bind(run).execute(&mut **tx).await?;
        let pending=sqlx::query("SELECT grant_decision FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2 AND stopped_at IS NULL").bind(community.as_uuid()).bind(run).fetch_all(&mut **tx).await?;
        for attempt in &pending {
            let mut decision: ExecutionDecision =
                serde_json::from_value(attempt.try_get("grant_decision")?)?;
            let sent:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_outbox WHERE community_id=$1 AND run_id=$2 AND signed_event->>'kind'='46041' AND (CASE WHEN signed_event->>'kind'='46041' THEN (signed_event->>'content')::jsonb ELSE '{}'::jsonb END)->>'grant_id'=$3 AND (CASE WHEN signed_event->>'kind'='46041' THEN (signed_event->>'content')::jsonb ELSE '{}'::jsonb END)->>'decision'='cancel')").bind(community.as_uuid()).bind(run).bind(decision.grant_id.to_string()).fetch_one(&mut **tx).await?;
            if !sent {
                decision.decision = DecisionKind::Cancel;
                decision.revision = row.try_get::<i64, _>("revision")? + 1;
                enqueue(tx, community, run, &signed_decision(&decision, keys)?).await?;
            }
        }
        let state = if !pending.is_empty()
            || (row
                .try_get::<Option<String>, _>("execution_state")?
                .as_deref()
                == Some("stalled")
                && count == 0)
            || tasks.iter().any(|t| {
                t.get::<String, _>("state") == "stalled" && t.get::<i32, _>("attempt_count") == 0
            }) {
            "stalled"
        } else if deadline || expired_attempt {
            "timed_out"
        } else {
            "failed"
        };
        let error = if permission {
            "permission_revoked"
        } else if deadline || expired_attempt {
            "deadline_exceeded"
        } else {
            "execution_failed"
        };
        sqlx::query("UPDATE workflow_runs SET execution_state=$3,safe_error_code=$4,revision=revision+1 WHERE community_id=$1 AND id=$2 AND (execution_state IS DISTINCT FROM $3 OR safe_error_code IS DISTINCT FROM $4)").bind(community.as_uuid()).bind(run).bind(state).bind(error).execute(&mut **tx).await?;
    } else if tasks
        .iter()
        .any(|t| t.get::<String, _>("state") == "stalled" && t.get::<i32, _>("attempt_count") == 0)
        && tasks.iter().all(|t| {
            matches!(
                t.get::<String, _>("state").as_str(),
                "completed" | "stalled"
            )
        })
    {
        sqlx::query("UPDATE workflow_runs SET execution_state='stalled',safe_error_code='legacy_execution_unknown',revision=revision+1 WHERE community_id=$1 AND id=$2 AND execution_state IS DISTINCT FROM 'stalled'").bind(community.as_uuid()).bind(run).execute(&mut **tx).await?;
    } else if all_completed && row.try_get::<bool, _>("dispatch_complete")? {
        sqlx::query("UPDATE workflow_runs SET execution_state='completed',safe_error_code=NULL,revision=revision+1 WHERE community_id=$1 AND id=$2").bind(community.as_uuid()).bind(run).execute(&mut **tx).await?;
    }
    Ok(())
}

impl Db {
    /// Authenticate a stop against its original grant, or recovery of an exact
    /// signed claim. This exception grants no membership or execution permission.
    pub async fn workflow_stop_authorized(
        &self,
        community: CommunityId,
        control: &ExecutionControl,
    ) -> Result<bool> {
        if matches!(control.operation, ExecutionOperation::RecoverClaim { .. }) {
            if control.community_id != *community.as_uuid() {
                return Ok(false);
            }
            let Some((run, task, channel)) = recovery_claim_scope(control) else {
                return Ok(false);
            };
            let agent = hex::decode(&control.agent_pubkey).map_err(invalid)?;
            return Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND task_id=$3 AND channel_id=$4 AND agent_pubkey=$5)")
                .bind(community.as_uuid()).bind(run).bind(task).bind(channel).bind(agent).fetch_one(&self.pool).await?);
        }
        let ExecutionOperation::Stopped {
            grant_id,
            run_id,
            task_id,
            channel_id,
            ordinal,
            ..
        } = &control.operation
        else {
            return Ok(false);
        };
        let agent = hex::decode(&control.agent_pubkey).map_err(invalid)?;
        Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_attempts a JOIN workflow_run_tasks t ON t.community_id=a.community_id AND t.run_id=a.run_id AND t.task_id=a.task_id WHERE a.community_id=$1 AND a.run_id=$2 AND a.task_id=$3 AND a.grant_id=$4 AND a.ordinal=$5 AND a.instance_id=$6 AND t.agent_pubkey=$7 AND t.channel_id=$8)")
            .bind(community.as_uuid()).bind(run_id).bind(task_id).bind(grant_id).bind(ordinal).bind(control.instance_id).bind(agent).bind(channel_id).fetch_one(&self.pool).await?)
    }

    /// Validate result lineage before storage or publication; the supervisor
    /// signs it only after its process group has been reaped.
    pub async fn validate_workflow_result(
        &self,
        community: CommunityId,
        event: &Event,
    ) -> Result<bool> {
        let value = |key: &str| {
            event
                .tags
                .iter()
                .find(|t| t.as_slice().first().is_some_and(|k| k == key))
                .and_then(|t| t.as_slice().get(1))
                .map(String::as_str)
        };
        let Some(grant) = value("workflow-grant").and_then(|s| Uuid::parse_str(s).ok()) else {
            return Ok(false);
        };
        let row=sqlx::query("SELECT a.run_id,a.task_id,a.ordinal,a.instance_id,t.channel_id,t.task_event_id,r.origin,a.stopped_at,a.started_at,a.deadline_at,r.execution_state FROM workflow_run_attempts a JOIN workflow_run_tasks t ON t.community_id=a.community_id AND t.run_id=a.run_id AND t.task_id=a.task_id JOIN workflow_runs r ON r.community_id=a.community_id AND r.id=a.run_id WHERE a.community_id=$1 AND a.grant_id=$2 AND t.agent_pubkey=$3")
            .bind(community.as_uuid()).bind(grant).bind(event.pubkey.as_bytes().as_slice()).fetch_optional(&self.pool).await?;
        let Some(row) = row else { return Ok(false) };
        let run: Uuid = row.try_get("run_id")?;
        let mut tx = self.begin_transaction().await?;
        if !authorized(&mut tx, community, run).await? {
            return Ok(false);
        }
        let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(&mut *tx)
            .await?;
        if row
            .try_get::<Option<DateTime<Utc>>, _>("stopped_at")?
            .is_some()
            || row
                .try_get::<Option<DateTime<Utc>>, _>("started_at")?
                .is_none()
            || row.try_get::<DateTime<Utc>, _>("deadline_at")? <= now
            || row
                .try_get::<Option<String>, _>("execution_state")?
                .as_deref()
                != Some("running")
        {
            return Ok(false);
        }
        Ok(event.kind == Kind::Custom(9)
            && [
                (
                    "workflow-result",
                    hex::encode(
                        row.try_get::<Option<Vec<u8>>, _>("task_event_id")?
                            .unwrap_or_default(),
                    ),
                ),
                ("workflow-grant", grant.to_string()),
                ("workflow-run", run.to_string()),
                (
                    "workflow-task",
                    row.try_get::<Uuid, _>("task_id")?.to_string(),
                ),
                (
                    "workflow-instance",
                    row.try_get::<Uuid, _>("instance_id")?.to_string(),
                ),
                (
                    "workflow-ordinal",
                    row.try_get::<i32, _>("ordinal")?.to_string(),
                ),
                ("h", row.try_get::<Uuid, _>("channel_id")?.to_string()),
                ("workflow-origin", row.try_get::<String, _>("origin")?),
            ]
            .iter()
            .all(|(k, v)| exact_tag(event, k, v)))
    }
}

impl Db {
    /// Queue ordinary event/scheduled agent tasks through the supervised protocol.
    /// Mixed targets receive separate signed supervised/legacy tasks. Legacy
    /// completion remains unknown; expired supervised capabilities fail closed.
    #[allow(clippy::too_many_arguments)]
    pub async fn queue_supervised_workflow_tasks(
        &self,
        community: CommunityId,
        run: Uuid,
        step: &str,
        channel: Uuid,
        targets: &[String],
        legacy: &Event,
        keys: &Keys,
    ) -> Result<Option<String>> {
        let mut tx = self.begin_transaction().await?;
        self.deletion_store()
            .guard_transaction(&mut tx, community)
            .await?;
        lock_admission(&mut tx, community).await?;
        let row=sqlx::query("SELECT r.origin,r.definition_hash,w.definition_hash AS current_hash,w.owner_pubkey,w.name,r.workflow_id FROM workflow_runs r JOIN workflows w ON w.community_id=r.community_id AND w.id=r.workflow_id WHERE r.community_id=$1 AND r.id=$2 FOR UPDATE OF r,w").bind(community.as_uuid()).bind(run).fetch_one(&mut *tx).await?;
        let origin = row.try_get::<String, _>("origin")?;
        if !matches!(origin.as_str(), "scheduled" | "event") {
            return Ok(None);
        }
        if row
            .try_get::<Option<Vec<u8>>, _>("definition_hash")?
            .as_ref()
            != Some(&row.try_get::<Vec<u8>, _>("current_hash")?)
        {
            return Err(DbError::AccessDenied("workflow definition changed".into()));
        }
        let mut supervised = 0;
        let mut ready_targets = std::collections::HashSet::new();
        for target in targets {
            let ready:Option<bool>=sqlx::query_scalar("SELECT expires_at>clock_timestamp() FROM workflow_execution_capabilities WHERE community_id=$1 AND agent_pubkey=$2").bind(community.as_uuid()).bind(hex::decode(target).map_err(invalid)?).fetch_optional(&mut *tx).await?;
            match ready {
                Some(true) => {
                    supervised += 1;
                    ready_targets.insert(target.clone());
                }
                Some(false) => {
                    return Err(DbError::AccessDenied(
                        "workflow_runner_unavailable: supervised capability expired".into(),
                    ))
                }
                None => {}
            }
        }
        if supervised == 0 {
            return Ok(None);
        }
        let mut first = None;
        for target in targets {
            let prior:Option<Vec<u8>>=sqlx::query_scalar("SELECT task_event_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND step_id=$3 AND agent_pubkey=$4").bind(community.as_uuid()).bind(run).bind(step).bind(hex::decode(target).map_err(invalid)?).fetch_optional(&mut *tx).await?;
            if let Some(prior) = prior {
                first.get_or_insert(hex::encode(prior));
                continue;
            }
            let task = Uuid::new_v4();
            let ready = ready_targets.contains(target);
            let mut values = vec![
                ("h", channel.to_string()),
                ("p", target.clone()),
                (
                    "actor",
                    hex::encode(row.try_get::<Vec<u8>, _>("owner_pubkey")?),
                ),
                (
                    "buzz:workflow",
                    row.try_get::<Uuid, _>("workflow_id")?.to_string(),
                ),
                ("workflow-name", row.try_get::<String, _>("name")?),
                ("workflow-run", run.to_string()),
                ("workflow-step", step.into()),
                ("workflow-task", task.to_string()),
                ("workflow-origin", origin.clone()),
                ("workflow-community", community.as_uuid().to_string()),
                (
                    "workflow-definition",
                    hex::encode(row.try_get::<Vec<u8>, _>("current_hash")?),
                ),
            ];
            if ready {
                values.push(("workflow-protocol", "1".into()));
            }
            let tags = values
                .into_iter()
                .map(|(k, v)| Tag::parse([k, &v]).map_err(invalid))
                .collect::<Result<Vec<_>>>()?;
            let event = EventBuilder::new(
                Kind::Custom(buzz_core::kind::KIND_WORKFLOW_AGENT_TASK as u16),
                &legacy.content,
            )
            .tags(tags)
            .sign_with_keys(keys)
            .map_err(invalid)?;
            sqlx::query("INSERT INTO workflow_run_tasks(community_id,run_id,task_id,step_id,agent_pubkey,channel_id,task_event_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(community.as_uuid()).bind(run).bind(task).bind(step).bind(hex::decode(target).map_err(invalid)?).bind(channel).bind(event.id.as_bytes().as_slice()).bind(if ready {"queued"} else {"stalled"}).execute(&mut *tx).await?;
            enqueue(&mut tx, community, run, &event).await?;
            first.get_or_insert(event.id.to_hex());
        }
        if !authorized(&mut tx, community, run).await? {
            return Err(DbError::AccessDenied(
                "ordinary workflow execution permissions".into(),
            ));
        }
        sqlx::query("UPDATE workflow_runs SET execution_state=CASE WHEN execution_state='stalled' AND safe_error_code IS DISTINCT FROM 'legacy_execution_unknown' THEN execution_state WHEN EXISTS(SELECT 1 FROM workflow_run_attempts a WHERE a.community_id=workflow_runs.community_id AND a.run_id=workflow_runs.id AND a.stopped_at IS NULL) THEN 'running' ELSE 'queued' END,revision=GREATEST(revision,1) WHERE community_id=$1 AND id=$2").bind(community.as_uuid()).bind(run).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(first)
    }

    /// Reconcile active execution and return exact outbox events due for retry.
    /// Community keys originate only from durable rows, not request parameters.
    pub async fn workflow_execution_sweep(
        &self,
        keys: &Keys,
    ) -> Result<Vec<(CommunityId, Uuid, Event)>> {
        let runs:Vec<(Uuid,Uuid)>=sqlx::query_as("SELECT community_id,id FROM workflow_runs WHERE execution_state IN ('queued','running','stalled') ORDER BY community_id,id").fetch_all(&self.pool).await?;
        for (community, run) in runs {
            let community = CommunityId::from_uuid(community);
            let mut tx = self.begin_transaction().await?;
            if self
                .deletion_store()
                .guard_transaction(&mut tx, community)
                .await
                .is_err()
            {
                continue;
            }
            lock_admission(&mut tx, community).await?;
            let before: i64 = sqlx::query_scalar(
                "SELECT revision FROM workflow_runs WHERE community_id=$1 AND id=$2",
            )
            .bind(community.as_uuid())
            .bind(run)
            .fetch_one(&mut *tx)
            .await?;
            reconcile(&mut tx, community, run, keys).await?;
            let after: i64 = sqlx::query_scalar(
                "SELECT revision FROM workflow_runs WHERE community_id=$1 AND id=$2",
            )
            .bind(community.as_uuid())
            .bind(run)
            .fetch_one(&mut *tx)
            .await?;
            if after != before {
                invalidate(&mut tx, community, run, keys).await?;
            }
            tx.commit().await?;
        }
        let rows=sqlx::query("SELECT o.community_id,o.id,o.signed_event FROM workflow_run_outbox o JOIN workflow_runs r ON r.community_id=o.community_id AND r.id=o.run_id WHERE o.acknowledged_at IS NULL AND (o.delivered_at IS NULL OR o.delivered_at<clock_timestamp()-interval '5 seconds') AND (o.signed_event->>'kind'='46042' OR (o.signed_event->>'kind'='46008' AND (r.execution_state IN ('queued','running') OR (r.execution_state='stalled' AND r.safe_error_code='legacy_execution_unknown' AND NOT o.signed_event->'tags' @> '[[\"workflow-protocol\",\"1\"]]'::jsonb))) OR (o.signed_event->>'kind'='46041' AND EXISTS(SELECT 1 FROM workflow_run_attempts a WHERE a.community_id=o.community_id AND a.run_id=o.run_id AND a.grant_id::text=(CASE WHEN o.signed_event->>'kind'='46041' THEN (o.signed_event->>'content')::jsonb ELSE '{}'::jsonb END)->>'grant_id' AND a.stopped_at IS NULL AND ((CASE WHEN o.signed_event->>'kind'='46041' THEN (o.signed_event->>'content')::jsonb ELSE '{}'::jsonb END)->>'decision'='cancel' OR (r.execution_state IN ('queued','running') AND a.deadline_at>clock_timestamp()))))) ORDER BY o.delivered_at NULLS FIRST LIMIT 100").fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|r| {
                Ok((
                    CommunityId::from_uuid(r.try_get("community_id")?),
                    r.try_get("id")?,
                    serde_json::from_value(r.try_get("signed_event")?)?,
                ))
            })
            .collect()
    }

    /// Record publication; command outbox entries remain retryable until acked.
    pub async fn workflow_outbox_delivered(
        &self,
        community: CommunityId,
        id: Uuid,
        status: bool,
    ) -> Result<()> {
        sqlx::query("UPDATE workflow_run_outbox SET delivered_at=clock_timestamp(),acknowledged_at=CASE WHEN $3 THEN clock_timestamp() ELSE acknowledged_at END WHERE community_id=$1 AND id=$2").bind(community.as_uuid()).bind(id).bind(status).execute(&self.pool).await?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "workflow_execution_tests.rs"]
mod tests;
