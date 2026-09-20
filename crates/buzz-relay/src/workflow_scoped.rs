//! Read-only, run-bound child identities. No ordinary membership is materialized.
use crate::state::AppState;
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::Engine;
use buzz_core::TenantContext;
use nostr::{Event, Filter};
use std::{collections::HashSet, sync::Arc};

/// Deny all other HTTP routes for a known child key, even after revocation.
/// Parsing here only denies access; the bridge still cryptographically verifies
/// NIP-98 before either allowed operation and evaluates its current scope.
pub(crate) async fn http_guard(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let key = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Nostr "))
        .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
        .and_then(|b| serde_json::from_slice::<Event>(&b).ok())
        .map(|e| e.pubkey);
    if let Some(key) = key {
        match state.db.is_workflow_credential(key.as_bytes()).await {
            Ok(false) => {}
            Ok(true)
                if request.method() == axum::http::Method::POST
                    && matches!(request.uri().path(), "/query" | "/count") => {}
            Ok(true) => {
                return (
                    StatusCode::FORBIDDEN,
                    "restricted: workflow read credential",
                )
                    .into_response()
            }
            Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        }
    }
    next.run(request).await
}

/// Bounded snapshot reads only: no live subscription can outlive its grant.
/// Membership #p=self is projected to the effective agent for the CLI's channel
/// discovery; all metadata d-tags remain confined to the task destination.
pub(crate) async fn snapshot(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    key: &[u8],
    filters: &[Filter],
) -> Result<Vec<Event>, String> {
    if filters.is_empty() || filters.len() > 16 {
        return Err("invalid: workflow query filters".into());
    }
    let scope = state
        .db
        .workflow_read_scope(tenant.community(), key)
        .await
        .map_err(|_| "error: workflow authorization")?
        .ok_or("restricted: workflow credential expired or revoked")?;
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for original in filters {
        let mut json = serde_json::to_value(original).map_err(|_| "invalid: filter")?;
        let kinds = json
            .get("kinds")
            .and_then(|v| v.as_array())
            .ok_or("restricted: explicit kinds required")?;
        if kinds.is_empty()
            || kinds.iter().any(|k| {
                !matches!(
                    k.as_u64(),
                    Some(1 | 7 | 9 | 30023 | 39000 | 39001 | 39002 | 40002 | 40003)
                )
            })
        {
            return Err("restricted: workflow channel read kinds".into());
        }
        let metadata = kinds
            .iter()
            .all(|k| matches!(k.as_u64(), Some(39000..=39002)));
        if !metadata
            && kinds
                .iter()
                .any(|k| matches!(k.as_u64(), Some(39000..=39002)))
        {
            return Err("invalid: separate metadata and messages filters".into());
        }
        for name in ["#h", "#d"] {
            if let Some(values) = json.get(name).and_then(|v| v.as_array()) {
                if values
                    .iter()
                    .any(|v| v.as_str() != Some(scope.channel_id.to_string().as_str()))
                {
                    return Err("restricted: workflow destination".into());
                }
            }
        }
        if metadata {
            json["#d"] = serde_json::json!([scope.channel_id.to_string()]);
            if let Some(values) = json.get("#p").and_then(|v| v.as_array()) {
                if values.len() != 1
                    || !values[0].as_str().is_some_and(|v| {
                        v == hex::encode(key) || v == hex::encode(&scope.agent_pubkey)
                    })
                {
                    return Err("restricted: workflow membership identity".into());
                }
                json["#p"] = serde_json::json!([hex::encode(&scope.agent_pubkey)]);
            }
        } else {
            json["#h"] = serde_json::json!([scope.channel_id.to_string()]);
        }
        let filter: Filter = serde_json::from_value(json).map_err(|_| "invalid: filter")?;
        let mut query = crate::handlers::req::build_event_query_from_filter(
            &filter,
            &scope.agent_pubkey,
            state,
            tenant.community(),
        )
        .await;
        if metadata {
            query.channel_id = None;
            query.channel_ids = None;
            query.d_tag = Some(scope.channel_id.to_string());
            query.d_tags = None;
        } else {
            query.channel_id = Some(scope.channel_id);
            query.channel_ids = Some(vec![scope.channel_id]);
            query.channel_ids_include_global = false;
        }
        query.limit = Some(query.limit.unwrap_or(100).clamp(1, 1000));
        for stored in state
            .db
            .query_events(&query)
            .await
            .map_err(|_| "error: workflow query")?
        {
            if buzz_core::filter::filters_match(std::slice::from_ref(&filter), &stored)
                && seen.insert(stored.event.id)
            {
                output.push(stored.event)
            }
        }
    }
    // Revocation/expiry during a database read is checked again before delivery.
    if state
        .db
        .workflow_read_scope(tenant.community(), key)
        .await
        .map_err(|_| "error: workflow authorization")?
        .is_none()
    {
        return Err("restricted: workflow credential revoked".into());
    }
    Ok(output)
}
