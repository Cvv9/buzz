//! Recovery ingress accepts only the deployment-pinned controller.
use crate::{
    handlers::ingest::{IngestError, IngestResult},
    state::AppState,
};
use buzz_core::{workflow_recovery::ControllerRecoveryControl, TenantContext};
use buzz_db::workflow_execution::exact_tag;
use nostr::Event;
use std::sync::Arc;

/// Validate the complete controller envelope before any side effects.
pub(crate) fn parse_recovery(
    tenant: &TenantContext,
    event: &Event,
    pin: Option<&str>,
) -> Result<ControllerRecoveryControl, IngestError> {
    let reject = || IngestError::Rejected("invalid: workflow recovery envelope".into());
    let control: ControllerRecoveryControl =
        serde_json::from_str(&event.content).map_err(|_| reject())?;
    let now = chrono::Utc::now().timestamp();
    if pin != Some(event.pubkey.to_hex().as_str())
        || control.controller_pubkey != event.pubkey.to_hex()
    {
        return Err(IngestError::AuthFailed(
            "restricted: pinned recovery controller required".into(),
        ));
    }
    if control.community_id != *tenant.community().as_uuid()
        || control.validate(now).is_err()
        || event.created_at.as_secs() > (now + 5) as u64
        || event.created_at.as_secs() < (now - 90) as u64
        || event.tags.len() != 2
        || !exact_tag(event, "p", &control.target_agent)
        || !exact_tag(event, "workflow-recovery", &control.evidence_id)
    {
        return Err(reject());
    }
    Ok(control)
}

pub(crate) async fn handle_recovery(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: &Event,
) -> Result<IngestResult, IngestError> {
    let pin = state
        .config
        .hosted_agent_runtime_controller_pubkey
        .as_deref();
    let control = parse_recovery(tenant, event, pin)?;
    let receipt = state
        .db
        .workflow_controller_recovery(
            tenant.community(),
            event,
            &control,
            pin.unwrap_or_default(),
            &state.relay_keypair,
        )
        .await
        .map_err(|e| IngestError::Internal(format!("error: recovery ledger: {e}")))?;
    let payload =
        serde_json::to_value(&receipt).map_err(|e| IngestError::Internal(e.to_string()))?;
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: receipt.accepted,
        message: format!("response:{payload}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    #[test]
    fn recovery_requires_exact_pin_tenant_tags_and_fresh_evidence() {
        let controller = Keys::generate();
        let agent = Keys::generate();
        let community = buzz_core::CommunityId::from_uuid(uuid::Uuid::new_v4());
        let tenant = TenantContext::resolved(community, "recovery.test");
        let now = chrono::Utc::now().timestamp();
        let value = serde_json::json!({"version":1,"community_id":community.as_uuid(),"controller_pubkey":controller.public_key().to_hex(),"target_agent":agent.public_key().to_hex(),"container_id":"c".repeat(64),"evidence_id":"d".repeat(64),"observed_at":now,"container_started_at":now-100,"container_finished_at":now-1,"operation":{"op":"verified_attempt_stopped","run_id":uuid::Uuid::new_v4(),"task_id":uuid::Uuid::new_v4(),"grant_id":uuid::Uuid::new_v4(),"instance_id":uuid::Uuid::new_v4(),"channel_id":uuid::Uuid::new_v4(),"ordinal":1}});
        let event = EventBuilder::new(Kind::Custom(46040), value.to_string())
            .tags([
                Tag::parse(["p", &agent.public_key().to_hex()]).unwrap(),
                Tag::parse(["workflow-recovery", &"d".repeat(64)]).unwrap(),
            ])
            .sign_with_keys(&controller)
            .unwrap();
        assert!(parse_recovery(&tenant, &event, Some(&controller.public_key().to_hex())).is_ok());
        assert!(parse_recovery(&tenant, &event, None).is_err());
        assert!(parse_recovery(&tenant, &event, Some(&agent.public_key().to_hex())).is_err());
        let other = TenantContext::resolved(
            buzz_core::CommunityId::from_uuid(uuid::Uuid::new_v4()),
            "other.test",
        );
        assert!(parse_recovery(&other, &event, Some(&controller.public_key().to_hex())).is_err());
    }
}
