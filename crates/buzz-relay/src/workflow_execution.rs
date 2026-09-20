//! Supervised workflow control-plane ingress.
use crate::{
    handlers::ingest::{IngestError, IngestResult},
    state::AppState,
};
use buzz_core::{
    workflow_execution::{ExecutionControl, PROTOCOL_VERSION},
    TenantContext,
};
use nostr::Event;
use std::sync::Arc;

/// Validate control identity before accepting any runtime evidence. Phase one
/// deliberately fails closed: a safe isolated runner must be installed first.
pub(crate) async fn handle_control(
    tenant: &TenantContext,
    _state: &Arc<AppState>,
    event: &Event,
) -> Result<IngestResult, IngestError> {
    let control: ExecutionControl = serde_json::from_str(&event.content)
        .map_err(|_| IngestError::Rejected("invalid: workflow execution envelope".into()))?;
    let now = chrono::Utc::now().timestamp();
    let timestamp = i64::try_from(event.created_at.as_secs()).unwrap_or(i64::MAX);
    if control.version != PROTOCOL_VERSION
        || control.community_id != *tenant.community().as_uuid()
        || control.agent_pubkey != event.pubkey.to_hex()
        || timestamp > now + 5
        || timestamp < now - 90
    {
        return Err(IngestError::Rejected(
            "invalid: workflow execution identity or timestamp".into(),
        ));
    }
    Err(IngestError::Rejected(
        "restricted: supervised workflow execution is not available on this relay".into(),
    ))
}
