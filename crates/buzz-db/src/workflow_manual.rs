//! Durable, tenant-scoped workflow admission. All decisions use database time.
use crate::AdmittedTx;
use crate::{error::Result, Db, DbError};
use buzz_core::{kind::KIND_WORKFLOW_AGENT_TASK, CommunityId};
use chrono::{DateTime, Duration, Utc};
use nostr::{Event, EventBuilder, JsonUtil, Keys, Kind, Tag};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

/// Static task extracted from the owner-signed workflow definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualTaskSpec {
    /// Definition step identifier.
    pub step_id: String,
    /// Immutable agent public key.
    pub agent_pubkey: String,
    /// Fixed destination channel.
    pub channel_id: Uuid,
    /// Current instructions.
    pub text: String,
}
/// Authoritative projection of accepted manual allowances.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualLimits {
    /// Accepted starts still available for this workflow in the rolling day.
    pub remaining_workflow: i64,
    /// Accepted starts still available for this community in the rolling day.
    pub remaining_community: i64,
    /// Time eligibility; unknown while concurrency is blocked.
    pub next_eligible_at: Option<DateTime<Utc>>,
    /// Database clock used for projection.
    pub server_now: DateTime<Utc>,
}
/// Immutable receipt for one signed manual command (including rejections).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualDecision {
    /// Whether execution was durably admitted.
    pub accepted: bool,
    /// Accepted run identifier.
    pub run_id: Option<Uuid>,
    /// Stable rejection code, never provider diagnostics.
    pub reason: Option<String>,
    /// Current run revision at acceptance.
    pub revision: i64,
    /// Quota projection at decision time.
    pub limits: ManualLimits,
}

/// Serialize both scheduler claims and manual admission for one community.
pub(crate) async fn lock_admission(tx: &mut PgConnection, community: CommunityId) -> Result<()> {
    sqlx::query(
        "INSERT INTO workflow_admission_mutex(community_id) VALUES($1) ON CONFLICT DO NOTHING",
    )
    .bind(community.as_uuid())
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "SELECT community_id FROM workflow_admission_mutex WHERE community_id=$1 FOR UPDATE",
    )
    .bind(community.as_uuid())
    .fetch_one(&mut *tx)
    .await?;
    Ok(())
}

async fn limits(
    tx: &mut AdmittedTx,
    community: CommunityId,
    workflow: Uuid,
    now: DateTime<Utc>,
) -> Result<ManualLimits> {
    let times: Vec<(Uuid, DateTime<Utc>)> = sqlx::query_as("SELECT workflow_id,accepted_at FROM workflow_runs WHERE community_id=$1 AND origin='manual' AND accepted_at > $2 - interval '24 hours' AND accepted_at <= $2 ORDER BY accepted_at")
        .bind(community.as_uuid()).bind(now).fetch_all(tx.conn()).await?;
    let workflow_times: Vec<_> = times
        .iter()
        .filter(|(id, _)| *id == workflow)
        .map(|(_, at)| *at)
        .collect();
    let mut next = workflow_times.last().map(|at| *at + Duration::minutes(15));
    if workflow_times.len() >= 3 {
        next = next.max(
            workflow_times
                .get(workflow_times.len() - 3)
                .map(|at| *at + Duration::hours(24)),
        );
    }
    if times.len() >= 10 {
        next = next.max(
            times
                .get(times.len() - 10)
                .map(|(_, at)| *at + Duration::hours(24)),
        );
    }
    Ok(ManualLimits {
        remaining_workflow: (3 - workflow_times.len() as i64).max(0),
        remaining_community: (10 - times.len() as i64).max(0),
        next_eligible_at: next.filter(|at| *at > now),
        server_now: now,
    })
}

/// Permission intersection, fetched inside admission/claim transaction without caches.
pub async fn check_manual_authority(
    tx: &mut AdmittedTx,
    community: CommunityId,
    requester: &[u8],
    channel: Uuid,
    targets: &[ManualTaskSpec],
) -> Result<bool> {
    let owner: Option<String> = sqlx::query_scalar("SELECT pubkey FROM relay_members WHERE community_id=$1 AND pubkey=$2 AND role='owner' FOR SHARE")
        .bind(community.as_uuid()).bind(hex::encode(requester)).fetch_optional(tx.conn()).await?;
    if owner.is_none() {
        return Ok(false);
    }
    let owner_member: Option<Vec<u8>> = sqlx::query_scalar("SELECT pubkey FROM channel_members WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3 AND removed_at IS NULL FOR SHARE")
        .bind(community.as_uuid()).bind(channel).bind(requester).fetch_optional(tx.conn()).await?;
    if owner_member.is_none() {
        return Ok(false);
    }
    let channel_exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM channels WHERE community_id=$1 AND id=$2 AND archived_at IS NULL AND deleted_at IS NULL FOR SHARE")
        .bind(community.as_uuid()).bind(channel).fetch_optional(tx.conn()).await?;
    if channel_exists.is_none() {
        return Ok(false);
    }
    for task in targets {
        if task.channel_id != channel {
            return Ok(false);
        }
        let key = hex::decode(&task.agent_pubkey)
            .map_err(|_| DbError::InvalidData("invalid target".into()))?;
        let agent: Option<Vec<u8>> = sqlx::query_scalar("SELECT pubkey FROM users WHERE community_id=$1 AND pubkey=$2 AND agent_owner_pubkey=$3 AND deactivated_at IS NULL FOR SHARE")
            .bind(community.as_uuid()).bind(&key).bind(requester).fetch_optional(tx.conn()).await?;
        let member: Option<Vec<u8>> = sqlx::query_scalar("SELECT pubkey FROM channel_members WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3 AND removed_at IS NULL FOR SHARE")
            .bind(community.as_uuid()).bind(channel).bind(&key).fetch_optional(tx.conn()).await?;
        if agent.is_none() || member.is_none() {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Shared admission/read evaluator. The caller owns current permission checks.
pub(crate) async fn evaluate_manual_limits(
    tx: &mut AdmittedTx,
    community: CommunityId,
    workflow_id: Uuid,
    tasks: &[ManualTaskSpec],
    now: DateTime<Utc>,
    mut reason: Option<&str>,
) -> Result<(Option<String>, ManualLimits)> {
    let mut allowance = limits(tx, community, workflow_id, now).await?;
    if reason.is_none() {
        let dm:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflows w JOIN channels c ON c.community_id=w.community_id AND c.id=w.channel_id WHERE w.community_id=$1 AND w.id=$2 AND c.channel_type='dm')").bind(community.as_uuid()).bind(workflow_id).fetch_one(tx.conn()).await?;
        if dm {
            reason = Some("unsupported_manual_destination");
        }
    }
    if reason.is_none() {
        let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_runs WHERE community_id=$1 AND workflow_id=$2 AND (execution_state IN ('queued','running','stalled') OR (execution_state IS NULL AND status IN ('pending','running','waiting_approval')))) OR EXISTS(SELECT 1 FROM scheduled_workflow_fires WHERE community_id=$1 AND workflow_id=$2 AND outcome='started' AND workflow_run_id IS NULL)")
                .bind(community.as_uuid()).bind(workflow_id).fetch_one(tx.conn()).await?;
        let manual_active: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflow_runs WHERE community_id=$1 AND origin='manual' AND execution_state IN ('queued','running','stalled')")
                .bind(community.as_uuid()).fetch_one(tx.conn()).await?;
        if active {
            reason = Some("workflow_active");
        } else if manual_active >= 2 {
            reason = Some("community_active_limit");
        }
        for task in tasks {
            let target = hex::decode(&task.agent_pubkey)
                .map_err(|_| DbError::InvalidData("target".into()))?;
            let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_run_tasks t JOIN workflow_runs r ON r.community_id=t.community_id AND r.id=t.run_id WHERE t.community_id=$1 AND t.agent_pubkey=$2 AND r.origin='manual' AND r.execution_state IN ('queued','running','stalled'))")
                    .bind(community.as_uuid()).bind(&target).fetch_one(tx.conn()).await?;
            if active && reason.is_none() {
                reason = Some("agent_active_limit");
            }
            let ready: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_execution_capabilities WHERE community_id=$1 AND agent_pubkey=$2 AND protocol_version=1 AND expires_at>$3)")
                    .bind(community.as_uuid()).bind(&target).bind(now).fetch_one(tx.conn()).await?;
            if !ready && reason.is_none() {
                reason = Some("runner_unavailable");
            }
        }
    }
    if reason.is_none() {
        reason = if allowance.remaining_workflow == 0 {
            Some("workflow_daily_limit")
        } else if allowance.remaining_community == 0 {
            Some("community_daily_limit")
        } else if allowance.next_eligible_at.is_some() {
            Some("workflow_cooldown")
        } else {
            None
        };
    }
    if matches!(
        reason,
        Some("workflow_active" | "community_active_limit" | "agent_active_limit")
    ) {
        allowance.next_eligible_at = None;
    }
    Ok((reason.map(str::to_owned), allowance))
}

impl Db {
    /// Atomically admit and sign fixed manual tasks, persist the command, charge
    /// allowance and write an outbox. The caller has verified the Nostr signature.
    /// `definition_hash` is the server-loaded definition used to derive `tasks`;
    /// `expected_hash` is the optional client revision, never a template value.
    #[allow(clippy::too_many_arguments)]
    pub async fn admit_manual_workflow(
        &self,
        community: CommunityId,
        workflow_id: Uuid,
        event: &Event,
        definition_hash: &[u8],
        expected_hash: Option<&str>,
        tasks: &[ManualTaskSpec],
        profile_error: Option<&str>,
        relay: &Keys,
    ) -> Result<ManualDecision> {
        let mut tx = self.begin_event_write_transaction(community).await?;
        lock_admission(tx.conn(), community).await?;
        let row = sqlx::query("SELECT owner_pubkey,channel_id,enabled,status::text AS status,definition_hash,definition,name,manual_deleted_at FROM workflows WHERE community_id=$1 AND id=$2 FOR UPDATE")
            .bind(community.as_uuid()).bind(workflow_id).fetch_optional(tx.conn()).await?
            .ok_or_else(|| DbError::NotFound("workflow not found".into()))?;
        let requester = event.pubkey.to_bytes();
        let owner: Vec<u8> = row.try_get("owner_pubkey")?;
        let channel: Option<Uuid> = row.try_get("channel_id")?;
        // Do not return another identity's receipt or quota projection.
        if owner != requester
            || !check_manual_authority(
                &mut tx,
                community,
                &requester,
                channel.ok_or_else(|| DbError::AccessDenied("workflow has no channel".into()))?,
                tasks,
            )
            .await?
        {
            return Err(DbError::AccessDenied("manual workflow requires current community and workflow owner with channel/target access".into()));
        }
        let receipt: Option<serde_json::Value> = sqlx::query_scalar("SELECT decision FROM workflow_manual_requests WHERE community_id=$1 AND request_event_id=$2 AND requester=$3")
            .bind(community.as_uuid()).bind(event.id.as_bytes().as_slice()).bind(requester.as_slice()).fetch_optional(tx.conn()).await?;
        if let Some(receipt) = receipt {
            return serde_json::from_value(receipt)
                .map_err(|e| DbError::InvalidData(e.to_string()));
        }
        let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(tx.conn())
            .await?;
        let hash: Vec<u8> = row.try_get("definition_hash")?;
        let mut reason = if !row.try_get::<bool, _>("enabled")?
            || row.try_get::<String, _>("status")? != "active"
            || row
                .try_get::<Option<DateTime<Utc>>, _>("manual_deleted_at")?
                .is_some()
        {
            Some("workflow_disabled")
        } else if hash != definition_hash
            || expected_hash.is_some_and(|expected| expected != hex::encode(&hash))
        {
            Some("definition_changed")
        } else {
            profile_error
        };
        if reason.is_none() && (tasks.is_empty() || tasks.len() > 2) {
            reason = Some("unsupported_manual_profile");
        }
        let (reason, mut allowance) =
            evaluate_manual_limits(&mut tx, community, workflow_id, tasks, now, reason).await?;
        let run_id = if reason.is_none() {
            Some(Uuid::new_v4())
        } else {
            None
        };
        if let Some(run_id) = run_id {
            let definition: serde_json::Value = row.try_get("definition")?;
            let deadline = now + Duration::minutes(20);
            // The command and all charged execution intent share this transaction.
            crate::event::insert_event_with_thread_metadata_tx(&mut tx, event, channel, None)
                .await?;
            sqlx::query("INSERT INTO workflow_runs(community_id,id,workflow_id,trigger_event_id,origin,requester,accepted_at,deadline_at,definition_hash,definition_snapshot,execution_state,dispatch_complete,revision) VALUES($1,$2,$3,$4,'manual',$5,$6,$7,$8,$9,'queued',TRUE,1)")
                .bind(community.as_uuid()).bind(run_id).bind(workflow_id).bind(event.id.as_bytes().as_slice()).bind(requester.as_slice()).bind(now).bind(deadline).bind(&hash).bind(definition).execute(tx.conn()).await?;
            for task in tasks {
                let task_id = Uuid::new_v4();
                let target = hex::decode(&task.agent_pubkey)
                    .map_err(|_| DbError::InvalidData("target".into()))?;
                let mut tags = Vec::new();
                for (key, value) in [
                    ("h", task.channel_id.to_string()),
                    ("p", task.agent_pubkey.clone()),
                    ("actor", hex::encode(requester)),
                    ("buzz:workflow", workflow_id.to_string()),
                    ("workflow-name", row.try_get::<String, _>("name")?),
                    ("workflow-run", run_id.to_string()),
                    ("workflow-step", task.step_id.clone()),
                    ("workflow-task", task_id.to_string()),
                    ("workflow-origin", "manual".into()),
                    ("workflow-community", community.as_uuid().to_string()),
                    ("workflow-protocol", "1".into()),
                    ("workflow-deadline", deadline.timestamp().to_string()),
                    ("workflow-definition", hex::encode(&hash)),
                ] {
                    tags.push(
                        Tag::parse([key, &value])
                            .map_err(|e| DbError::InvalidData(e.to_string()))?,
                    );
                }
                let signed =
                    EventBuilder::new(Kind::from(KIND_WORKFLOW_AGENT_TASK as u16), &task.text)
                        .tags(tags)
                        .sign_with_keys(relay)
                        .map_err(|e| DbError::InvalidData(e.to_string()))?;
                sqlx::query("INSERT INTO workflow_run_tasks(community_id,run_id,task_id,step_id,agent_pubkey,channel_id,task_event_id) VALUES($1,$2,$3,$4,$5,$6,$7)")
                    .bind(community.as_uuid()).bind(run_id).bind(task_id).bind(&task.step_id).bind(&target).bind(task.channel_id).bind(signed.id.as_bytes().as_slice()).execute(tx.conn()).await?;
                sqlx::query("INSERT INTO workflow_run_outbox(community_id,id,run_id,event_id,signed_event) VALUES($1,$2,$3,$4,$5)")
                    .bind(community.as_uuid()).bind(Uuid::new_v4()).bind(run_id).bind(signed.id.as_bytes().as_slice()).bind(serde_json::from_str::<serde_json::Value>(&signed.as_json()).map_err(|e|DbError::InvalidData(e.to_string()))?).execute(tx.conn()).await?;
            }
            allowance = limits(&mut tx, community, workflow_id, now).await?;
        }
        let decision = ManualDecision {
            accepted: run_id.is_some(),
            run_id,
            reason,
            revision: if run_id.is_some() { 1 } else { 0 },
            limits: allowance,
        };
        sqlx::query("INSERT INTO workflow_manual_requests(community_id,request_event_id,workflow_id,requester,decision,run_id) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(community.as_uuid()).bind(event.id.as_bytes().as_slice()).bind(workflow_id).bind(requester.as_slice()).bind(serde_json::to_value(&decision).map_err(|e|DbError::InvalidData(e.to_string()))?).bind(run_id).execute(tx.conn()).await?;
        tx.commit().await?;
        Ok(decision)
    }

    /// Evaluate the same limits as admission without charging or creating work.
    /// The HTTP caller must authorize reads before invoking this projection.
    pub async fn workflow_manual_eligibility(
        &self,
        community: CommunityId,
        workflow: Uuid,
        tasks: &[ManualTaskSpec],
        profile_error: Option<&str>,
    ) -> Result<(Option<String>, ManualLimits)> {
        let mut tx = self.begin_event_write_transaction(community).await?;
        lock_admission(tx.conn(), community).await?;
        let now = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(tx.conn())
            .await?;
        evaluate_manual_limits(&mut tx, community, workflow, tasks, now, profile_error).await
    }

    /// Current manual allowance from the same durable ledger used for admission.
    pub async fn workflow_manual_limits(
        &self,
        community: CommunityId,
        workflow: Uuid,
    ) -> Result<ManualLimits> {
        let mut tx = self.begin_event_write_transaction(community).await?;
        let now = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(tx.conn())
            .await?;
        limits(&mut tx, community, workflow, now).await
    }

    /// Actual execution evidence, separate from the legacy dispatch trace.
    pub async fn workflow_actual_run(
        &self,
        community: CommunityId,
        run: Uuid,
    ) -> Result<serde_json::Value> {
        let row=sqlx::query("SELECT origin,requester,accepted_at,deadline_at,execution_state,dispatch_complete,safe_error_code,revision FROM workflow_runs WHERE community_id=$1 AND id=$2")
            .bind(community.as_uuid()).bind(run).fetch_one(&self.pool).await?;
        Ok(
            serde_json::json!({"origin":row.try_get::<String,_>("origin")?,"requester":row.try_get::<Option<Vec<u8>>,_>("requester")?.map(hex::encode),"accepted_at":row.try_get::<Option<DateTime<Utc>>,_>("accepted_at")?,"deadline_at":row.try_get::<Option<DateTime<Utc>>,_>("deadline_at")?,"execution_state":row.try_get::<Option<String>,_>("execution_state")?.unwrap_or_else(||"unknown".into()),"dispatch_complete":row.try_get::<bool,_>("dispatch_complete")?,"safe_error_code":row.try_get::<Option<String>,_>("safe_error_code")?,"revision":row.try_get::<i64,_>("revision")?}),
        )
    }
}

impl Db {
    /// Persist a scheduled agent dispatch and its unresolved execution records
    /// together. Dispatch completion never unlocks a manually triggered overlap.
    #[allow(clippy::too_many_arguments)]
    pub async fn persist_scheduled_workflow_task(
        &self,
        community: CommunityId,
        event: &Event,
        channel: Uuid,
        run: Uuid,
        step: &str,
        targets: &[String],
    ) -> Result<(buzz_core::StoredEvent, bool)> {
        let mut tx = self.begin_event_write_transaction(community).await?;
        lock_admission(tx.conn(), community).await?;
        let row=sqlx::query("SELECT r.workflow_id,r.origin,r.definition_hash,w.definition_hash AS current_hash FROM workflow_runs r JOIN workflows w ON w.community_id=r.community_id AND w.id=r.workflow_id WHERE r.community_id=$1 AND r.id=$2 FOR UPDATE OF r,w")
            .bind(community.as_uuid()).bind(run).fetch_optional(tx.conn()).await?.ok_or_else(||DbError::NotFound("workflow run".into()))?;
        let original: Option<Vec<u8>> = row.try_get("definition_hash")?;
        let current: Vec<u8> = row.try_get("current_hash")?;
        if row.try_get::<String, _>("origin")? == "manual"
            || original.as_ref().is_some_and(|h| h != &current)
        {
            return Err(DbError::AccessDenied(
                "workflow definition changed or incorrect manual dispatch path".into(),
            ));
        }
        let stored =
            crate::event::insert_event_with_thread_metadata_tx(&mut tx, event, Some(channel), None)
                .await?;
        if stored.1 {
            for target in targets {
                let key = hex::decode(target).map_err(|_| DbError::InvalidData("target".into()))?;
                sqlx::query("INSERT INTO workflow_run_tasks(community_id,run_id,task_id,step_id,agent_pubkey,channel_id,task_event_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,'stalled') ON CONFLICT(community_id,run_id,step_id,agent_pubkey) DO NOTHING")
                    .bind(community.as_uuid()).bind(run).bind(Uuid::new_v4()).bind(step).bind(&key).bind(channel).bind(event.id.as_bytes().as_slice()).execute(tx.conn()).await?;
            }
            sqlx::query("UPDATE workflow_runs SET execution_state=CASE WHEN EXISTS(SELECT 1 FROM workflow_run_tasks t WHERE t.community_id=workflow_runs.community_id AND t.run_id=workflow_runs.id AND t.state IN ('queued','running')) THEN CASE WHEN execution_state='running' THEN 'running' ELSE 'queued' END ELSE 'stalled' END,safe_error_code='legacy_execution_unknown',revision=revision+1 WHERE community_id=$1 AND id=$2")
                .bind(community.as_uuid()).bind(run).execute(tx.conn()).await?;
        }
        tx.commit().await?;
        Ok(stored)
    }
}

#[cfg(test)]
#[path = "workflow_manual_tests.rs"]
mod workflow_manual_postgres_tests;
