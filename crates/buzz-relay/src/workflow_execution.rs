//! Supervised workflow control-plane ingress and durable delivery.
use crate::{
    handlers::ingest::{IngestError, IngestResult},
    state::AppState,
};
use buzz_core::{
    workflow_execution::{ExecutionControl, ExecutionOperation, PROTOCOL_VERSION},
    TenantContext,
};
use buzz_db::workflow_execution::exact_tag;
use nostr::Event;
use std::sync::Arc;

/// Strict shared parser for ordinary ingress and the revoked-agent stop exception.
pub(crate) fn parse_control(
    tenant: &TenantContext,
    event: &Event,
) -> Result<ExecutionControl, IngestError> {
    let reject = || IngestError::Rejected("invalid: workflow execution envelope".into());
    let control: ExecutionControl = serde_json::from_str(&event.content).map_err(|_| reject())?;
    let now = chrono::Utc::now().timestamp();
    let timestamp = i64::try_from(event.created_at.as_secs()).unwrap_or(i64::MAX);
    if control.version != PROTOCOL_VERSION
        || control.community_id != *tenant.community().as_uuid()
        || control.agent_pubkey != event.pubkey.to_hex()
        || control.instance_id.is_nil()
        || timestamp > now + 5
        || timestamp < now - 90
        || !exact_tag(event, "p", &control.agent_pubkey)
    {
        return Err(reject());
    }
    let context = match &control.operation {
        ExecutionOperation::Capability {
            runtime_profile,
            max_turn_duration_secs,
        } => {
            if runtime_profile != "linux-uids-v1" || !(1..=604800).contains(max_turn_duration_secs)
            {
                return Err(reject());
            }
            None
        }
        ExecutionOperation::Claim {
            run_id,
            task_id,
            channel_id,
            revision,
            ephemeral_pubkey,
        } => {
            if *revision < 1
                || ephemeral_pubkey == &control.agent_pubkey
                || ephemeral_pubkey.len() != 64
                || !ephemeral_pubkey
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err(reject());
            }
            Some((*run_id, *task_id, *channel_id, None))
        }
        ExecutionOperation::RecoverClaim { .. } => {
            let (run, task, channel) =
                buzz_core::workflow_execution::recovery_claim_scope(&control).ok_or_else(reject)?;
            Some((run, task, channel, None))
        }
        ExecutionOperation::Started {
            run_id,
            task_id,
            channel_id,
            grant_id,
            ordinal,
        }
        | ExecutionOperation::Finished {
            run_id,
            task_id,
            channel_id,
            grant_id,
            ordinal,
            ..
        }
        | ExecutionOperation::Stopped {
            run_id,
            task_id,
            channel_id,
            grant_id,
            ordinal,
            ..
        } => {
            if *ordinal < 1 || grant_id.is_nil() {
                return Err(reject());
            }
            if let ExecutionOperation::Finished {
                result_event_id, ..
            } = &control.operation
            {
                if result_event_id.len() != 64
                    || !result_event_id
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                {
                    return Err(reject());
                }
            }
            Some((*run_id, *task_id, *channel_id, Some(*grant_id)))
        }
    };
    let expected = if let Some((run, task, channel, grant)) = context {
        if [run, task, channel].iter().any(uuid::Uuid::is_nil)
            || !exact_tag(event, "h", &channel.to_string())
            || !exact_tag(event, "workflow-run", &run.to_string())
            || !exact_tag(event, "workflow-task", &task.to_string())
            || grant.is_some_and(|g| !exact_tag(event, "workflow-grant", &g.to_string()))
        {
            return Err(reject());
        }
        if grant.is_some() {
            5
        } else {
            4
        }
    } else {
        1
    };
    if event.tags.len() != expected {
        return Err(reject());
    }
    Ok(control)
}

pub(crate) async fn handle_control(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: &Event,
) -> Result<IngestResult, IngestError> {
    if serde_json::from_str::<serde_json::Value>(&event.content)
        .ok()
        .is_some_and(|v| v.get("controller_pubkey").is_some())
    {
        return crate::workflow_recovery::handle_recovery(tenant, state, event).await;
    }
    let control = parse_control(tenant, event)?;
    let receipt = state
        .db
        .workflow_execution_control(tenant.community(), event, &control, &state.relay_keypair)
        .await
        .map_err(|e| IngestError::Internal(format!("error: execution ledger: {e}")))?;
    let payload =
        serde_json::to_value(&receipt).map_err(|e| IngestError::Internal(e.to_string()))?;
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: receipt.accepted,
        message: format!("response:{payload}"),
    })
}

/// Run durable outbox retries and cancellation reconciliation. No provider calls
/// occur in the relay; a signed grant is the only authority to start a child.
pub async fn run_workers(state: Arc<AppState>) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        if let Err(error) = flush_outbox(&state).await {
            tracing::warn!(%error,"workflow execution reconciliation failed");
        }
    }
}

pub(crate) async fn flush_outbox(state: &Arc<AppState>) -> Result<(), String> {
    for (community, id, event) in state
        .db
        .workflow_execution_sweep(&state.relay_keypair)
        .await
        .map_err(|e| e.to_string())?
    {
        let Some(host) = state
            .db
            .lookup_community_host(community)
            .await
            .map_err(|e| e.to_string())?
        else {
            continue;
        };
        let tenant = TenantContext::resolved(community, host);
        if !buzz_deletion::store(&state.db)
            .is_serving_active(community)
            .await
            .map_err(|e| e.to_string())?
        {
            continue;
        }
        let channel = event
            .tags
            .iter()
            .find(|t| t.as_slice().first().is_some_and(|k| k == "h"))
            .and_then(|t| t.as_slice().get(1))
            .and_then(|v| uuid::Uuid::parse_str(v).ok());
        let (stored, inserted) = state
            .db
            .insert_event_with_thread_metadata(community, &event, channel, None)
            .await
            .map_err(|e| e.to_string())?;
        let kind = buzz_core::kind::event_kind_u32(&event);
        crate::handlers::event::dispatch_persistent_event_inner(
            &tenant,
            state,
            &stored,
            kind,
            &event.pubkey.to_hex(),
            inserted,
            None,
        )
        .await;
        state
            .db
            .workflow_outbox_delivered(
                community,
                id,
                kind == buzz_core::kind::KIND_WORKFLOW_RUN_STATUS
                    || (kind == buzz_core::kind::KIND_WORKFLOW_AGENT_TASK
                        && !exact_tag(&event, "workflow-protocol", "1")),
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::CommunityId;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    use uuid::Uuid;
    #[test]
    fn workflow_execution_control_rejects_conflicting_tags_and_wrong_identity() {
        let agent = Keys::generate();
        let community = CommunityId::from_uuid(Uuid::new_v4());
        let tenant = TenantContext::resolved(community, "isolated.test");
        let control = ExecutionControl {
            version: 1,
            community_id: *community.as_uuid(),
            agent_pubkey: agent.public_key().to_hex(),
            instance_id: Uuid::new_v4(),
            operation: ExecutionOperation::Claim {
                run_id: Uuid::new_v4(),
                task_id: Uuid::new_v4(),
                channel_id: Uuid::new_v4(),
                revision: 1,
                ephemeral_pubkey: Keys::generate().public_key().to_hex(),
            },
        };
        let event = buzz_sdk::build_workflow_execution_control(&control)
            .unwrap()
            .sign_with_keys(&agent)
            .unwrap();
        assert!(parse_control(&tenant, &event).is_ok());
        let old_claim = buzz_sdk::build_workflow_execution_control(&control)
            .unwrap()
            .custom_created_at(nostr::Timestamp::from_secs(1))
            .sign_with_keys(&agent)
            .unwrap();
        let recovery = ExecutionControl {
            operation: ExecutionOperation::RecoverClaim {
                signed_claim: old_claim.clone(),
            },
            ..control.clone()
        };
        let recovered = buzz_sdk::build_workflow_execution_control(&recovery)
            .unwrap()
            .sign_with_keys(&agent)
            .unwrap();
        assert!(parse_control(&tenant, &recovered).is_ok());
        let stale_recovery = buzz_sdk::build_workflow_execution_control(&recovery)
            .unwrap()
            .custom_created_at(nostr::Timestamp::from_secs(1))
            .sign_with_keys(&agent)
            .unwrap();
        assert!(parse_control(&tenant, &stale_recovery).is_err());
        let mut forged = old_claim;
        forged.content.push(' ');
        let bad_recovery = ExecutionControl {
            operation: ExecutionOperation::RecoverClaim {
                signed_claim: forged,
            },
            ..control.clone()
        };
        assert!(buzz_sdk::build_workflow_execution_control(&bad_recovery).is_err());
        let bad_recovery_event = EventBuilder::new(
            Kind::Custom(46040),
            serde_json::to_string(&bad_recovery).unwrap(),
        )
        .tags(recovered.tags.clone())
        .allow_self_tagging()
        .sign_with_keys(&agent)
        .unwrap();
        assert!(parse_control(&tenant, &bad_recovery_event).is_err());

        let conflicting = buzz_sdk::build_workflow_execution_control(&control)
            .unwrap()
            .tags([Tag::parse(["h", &Uuid::new_v4().to_string()]).unwrap()])
            .sign_with_keys(&agent)
            .unwrap();
        assert!(parse_control(&tenant, &conflicting).is_err());
        let wrong = buzz_sdk::build_workflow_execution_control(&control)
            .unwrap()
            .sign_with_keys(&Keys::generate())
            .unwrap();
        assert!(parse_control(&tenant, &wrong).is_err());
        let foreign =
            TenantContext::resolved(CommunityId::from_uuid(Uuid::new_v4()), "foreign.test");
        assert!(parse_control(&foreign, &event).is_err());
        let legacy=EventBuilder::new(Kind::Custom(46040),serde_json::json!({"version":1,"community_id":community.as_uuid(),"agent_pubkey":agent.public_key().to_hex(),"instance_id":Uuid::new_v4(),"operation":{"op":"capability"}}).to_string()).sign_with_keys(&agent).unwrap();
        assert!(parse_control(&tenant, &legacy).is_err());
    }
}
