//! Authorized structured reads for workflow execution state.
//!
//! Runs and approvals are relay-owned database rows, not Nostr events. These
//! endpoints expose those read models without inventing synthetic events.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, RawQuery, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use buzz_core::TenantContext;

use crate::{
    api::{api_error, bridge, internal_error},
    state::AppState,
};

const DEFAULT_RUN_LIMIT: i64 = 20;
const MAX_RUN_LIMIT: i64 = 100;

/// Pagination query for workflow run history.
#[derive(Debug, Deserialize, Default)]
pub struct RunsQuery {
    before: Option<DateTime<Utc>>,
    before_id: Option<Uuid>,
    limit: Option<i64>,
}

fn request_path(path: &str, raw_query: Option<&str>) -> String {
    match raw_query {
        Some(query) if !query.is_empty() => format!("{path}?{query}"),
        _ => path.to_string(),
    }
}

async fn authorize_read_identity(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    path: &str,
    raw_query: Option<&str>,
) -> Result<(TenantContext, Vec<u8>), (StatusCode, Json<Value>)> {
    let raw_host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::NOT_FOUND,
                "relay: no community is configured for this host",
            )
        })?;

    let path_with_query = request_path(path, raw_query);
    let url = bridge::nip98_expected_url(&state.config.relay_url, &tenant, &path_with_query);
    let (pubkey, event_id_bytes) =
        bridge::verify_bridge_auth(headers, "GET", &url, None, state.config.require_auth_token)?;
    bridge::enforce_http_admission(state, &tenant, &pubkey).await?;
    bridge::check_nip98_replay(state, &tenant, event_id_bytes).await?;

    let pubkey_bytes = pubkey.to_bytes().to_vec();
    let auth_tag = headers
        .get("x-auth-tag")
        .and_then(|value| value.to_str().ok());
    super::relay_members::enforce_relay_membership(
        state,
        tenant.community(),
        &pubkey_bytes,
        auth_tag,
    )
    .await?;

    Ok((tenant, pubkey_bytes))
}

async fn authorize_workflow_read(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    path: &str,
    raw_query: Option<&str>,
    workflow_id: Uuid,
) -> Result<TenantContext, (StatusCode, Json<Value>)> {
    let (tenant, pubkey_bytes) = authorize_read_identity(state, headers, path, raw_query).await?;

    let workflow = state
        .db
        .get_workflow(tenant.community(), workflow_id)
        .await
        .map_err(|error| match error {
            buzz_db::error::DbError::NotFound(_) => {
                api_error(StatusCode::NOT_FOUND, "workflow not found")
            }
            other => internal_error(&format!("get workflow for run read: {other}")),
        })?;
    let channel_id = workflow
        .channel_id
        .ok_or_else(|| api_error(StatusCode::FORBIDDEN, "workflow is not channel-scoped"))?;
    let accessible = state
        .get_accessible_channel_ids_cached(tenant.community(), &pubkey_bytes)
        .await
        .map_err(|error| internal_error(&format!("workflow channel access lookup: {error}")))?;
    if !accessible.contains(&channel_id) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "workflow is not accessible",
        ));
    }

    Ok(tenant)
}

/// `GET /workflows/{workflow_id}/runs` — one authorized, keyset-paginated page.
pub async fn workflow_runs(
    State(state): State<Arc<AppState>>,
    Path(workflow_id): Path<Uuid>,
    headers: HeaderMap,
    RawQuery(raw_query): RawQuery,
    Query(query): Query<RunsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if query.before.is_some() != query.before_id.is_some() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "before and before_id must be supplied together",
        ));
    }
    let limit = query.limit.unwrap_or(DEFAULT_RUN_LIMIT);
    if !(1..=MAX_RUN_LIMIT).contains(&limit) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "limit must be between 1 and 100",
        ));
    }

    let path = format!("/workflows/{workflow_id}/runs");
    let tenant =
        authorize_workflow_read(&state, &headers, &path, raw_query.as_deref(), workflow_id).await?;
    let mut rows = state
        .db
        .list_workflow_runs_page(
            tenant.community(),
            workflow_id,
            query.before,
            query.before_id,
            limit + 1,
        )
        .await
        .map_err(|error| internal_error(&format!("list workflow runs: {error}")))?;

    let has_more = rows.len() > limit as usize;
    rows.truncate(limit as usize);
    let next = if has_more {
        rows.last().map(|last| {
            serde_json::json!({
                "before": last.created_at,
                "before_id": last.id,
            })
        })
    } else {
        None
    };

    let mut runs = Vec::with_capacity(rows.len());
    for row in &rows {
        runs.push(actual_run_json(&state, tenant.community(), row).await?);
    }
    Ok(Json(serde_json::json!({
        "runs": runs,
        "next": next,
    })))
}

/// Owner-only summary pagination. Cursor is the last returned workflow UUID.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduledQuery {
    agent_pubkey: String,
    cursor: Option<Uuid>,
    limit: Option<i64>,
}

/// `GET /workflows?agent_pubkey=...` — scheduled agent work and current allowance.
pub async fn agent_scheduled_workflows(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    RawQuery(raw_query): RawQuery,
    Query(query): Query<ScheduledQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let limit = query.limit.unwrap_or(DEFAULT_RUN_LIMIT);
    if !(1..=MAX_RUN_LIMIT).contains(&limit) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "limit must be between 1 and 100",
        ));
    }
    let agent = nostr::PublicKey::from_hex(&query.agent_pubkey).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "agent_pubkey must be a hex public key",
        )
    })?;
    let (tenant, requester) =
        authorize_read_identity(&state, &headers, "/workflows", raw_query.as_deref()).await?;
    let member = state
        .db
        .get_relay_member(tenant.community(), &hex::encode(&requester))
        .await
        .map_err(|e| internal_error(&format!("workflow owner lookup: {e}")))?;
    if member.as_ref().is_none_or(|m| m.role != "owner") {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "scheduled agent workflows require the community owner",
        ));
    }
    let mut rows = state
        .db
        .agent_scheduled_workflows_page(
            tenant.community(),
            &requester,
            &agent.to_bytes(),
            query.cursor,
            limit + 1,
        )
        .await
        .map_err(|e| internal_error(&format!("agent workflow summaries: {e}")))?;
    let has_more = rows.len() > limit as usize;
    rows.truncate(limit as usize);
    let next = if has_more {
        rows.last().map(|row| row.id)
    } else {
        None
    };
    let mut summaries = Vec::with_capacity(rows.len());
    // Obtain the same database clock even when the page is empty.
    let clock = state
        .db
        .workflow_manual_limits(tenant.community(), Uuid::nil())
        .await
        .map_err(|e| internal_error(&format!("workflow clock: {e}")))?;
    for row in rows {
        let Some(channel) = row.channel_id else {
            continue;
        };
        let def =
            serde_json::from_value::<buzz_workflow::schema::WorkflowDef>(row.definition.clone());
        let (tasks, mut profile_error) = match def.as_ref().ok().map(|d| d.manual_tasks(channel)) {
            Some(Ok(tasks)) => (
                tasks
                    .into_iter()
                    .map(|t| buzz_db::workflow_manual::ManualTaskSpec {
                        step_id: t.step_id,
                        agent_pubkey: t.agent_pubkey,
                        channel_id: t.channel_id,
                        text: t.text,
                    })
                    .collect::<Vec<_>>(),
                None,
            ),
            Some(Err(reason)) => (Vec::new(), Some(reason)),
            None => (Vec::new(), Some("unsupported_manual_profile")),
        };
        if !row.enabled || row.status != buzz_db::workflow::WorkflowStatus::Active {
            profile_error = Some("workflow_disabled");
        } else if row.owner_pubkey != requester {
            profile_error = Some("workflow_owner_required");
        } else {
            let mut tx = state
                .db
                .begin_transaction()
                .await
                .map_err(|e| internal_error(&e.to_string()))?;
            if !buzz_db::workflow_manual::check_manual_authority(
                &mut tx,
                tenant.community(),
                &requester,
                channel,
                &tasks,
            )
            .await
            .map_err(|e| internal_error(&format!("workflow authority: {e}")))?
            {
                profile_error = Some("permission_revoked");
            }
        }
        let (block_reason, limits) = state
            .db
            .workflow_manual_eligibility(tenant.community(), row.id, &tasks, profile_error)
            .await
            .map_err(|e| internal_error(&format!("workflow eligibility: {e}")))?;
        let last = state
            .db
            .list_workflow_runs_page(tenant.community(), row.id, None, None, 1)
            .await
            .map_err(|e| internal_error(&format!("workflow latest run: {e}")))?;
        let last_run = match last.first() {
            Some(run) => Some(summary_run_json(
                &actual_run_json(&state, tenant.community(), run).await?,
            )),
            None => None,
        };
        let anchor = state
            .db
            .latest_scheduled_workflow_fire(tenant.community(), row.id)
            .await
            .map_err(|e| internal_error(&format!("workflow schedule anchor: {e}")))?;
        let next_scheduled_at =
            if row.enabled && row.status == buzz_db::workflow::WorkflowStatus::Active {
                def.as_ref()
                    .ok()
                    .and_then(|d| d.next_scheduled_at(limits.server_now, anchor))
            } else {
                None
            };
        // Presentation-only target lists are derived from the signed definition.
        // They do not establish eligibility or authorize dispatch.
        let agent_targets: std::collections::BTreeSet<_> = row
            .definition
            .get("steps")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|s| s.get("agent_targets").and_then(Value::as_array))
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        let revision = last_run
            .as_ref()
            .and_then(|r| r.get("revision"))
            .cloned()
            .unwrap_or(0.into());
        summaries.push(serde_json::json!({
            "workflow_id":row.id,"name":row.name,"definition_hash":hex::encode(row.definition_hash),
            "agent_targets":agent_targets,"channel_id":channel,"schedule":row.definition.get("trigger"),
            "timezone":"UTC","next_scheduled_at":next_scheduled_at,"enabled":row.enabled,
            "last_run":last_run,"limits":limits,"block_reason":block_reason,"revision":revision,
        }));
    }
    Ok(Json(
        serde_json::json!({"workflows":summaries,"next":next,"server_now":clock.server_now}),
    ))
}

// Agent settings is a summary surface, not the detailed workflow history.
// An old trace can contain webhook responses or previously visible destinations.
// Copy only safe execution evidence, even if the detailed read grows new fields.
fn summary_run_json(run: &Value) -> Value {
    let fields = [
        "id",
        "workflow_id",
        "execution_state",
        "safe_error_code",
        "origin",
        "requester",
        "created_at",
        "started_at",
        "completed_at",
        "accepted_at",
        "deadline_at",
        "revision",
        "results",
    ];
    Value::Object(
        fields
            .into_iter()
            .filter_map(|key| run.get(key).map(|value| (key.to_owned(), value.clone())))
            .collect(),
    )
}

async fn actual_run_json(
    state: &AppState,
    community: buzz_core::CommunityId,
    run: &buzz_db::workflow::WorkflowRunRecord,
) -> Result<Value, (StatusCode, Json<Value>)> {
    let actual = state
        .db
        .workflow_actual_run(community, run.id)
        .await
        .map_err(|e| internal_error(&format!("workflow execution state: {e}")))?;
    let mut value = run_json(run);
    if let (Some(target), Some(fields)) = (value.as_object_mut(), actual.as_object()) {
        target.extend(fields.clone());
    }
    value["results"] = serde_json::to_value(
        state
            .db
            .workflow_run_results(community, run.id)
            .await
            .map_err(|e| internal_error(&format!("workflow result links: {e}")))?,
    )
    .map_err(|e| internal_error(&e.to_string()))?;
    Ok(value)
}

/// `GET /workflows/{workflow_id}/runs/{run_id}/approvals` — approvals for a run.
pub async fn run_approvals(
    State(state): State<Arc<AppState>>,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/workflows/{workflow_id}/runs/{run_id}/approvals");
    let tenant = authorize_workflow_read(&state, &headers, &path, None, workflow_id).await?;

    let run = state
        .db
        .get_workflow_run(tenant.community(), run_id)
        .await
        .map_err(|error| match error {
            buzz_db::error::DbError::NotFound(_) => {
                api_error(StatusCode::NOT_FOUND, "workflow run not found")
            }
            other => internal_error(&format!("get workflow run for approval read: {other}")),
        })?;
    if run.workflow_id != workflow_id {
        return Err(api_error(StatusCode::NOT_FOUND, "workflow run not found"));
    }

    let approvals = state
        .db
        .get_run_approvals(tenant.community(), workflow_id, run_id)
        .await
        .map_err(|error| internal_error(&format!("list run approvals: {error}")))?;
    Ok(Json(serde_json::json!({
        "approvals": approvals.iter().map(approval_json).collect::<Vec<_>>(),
    })))
}

fn run_json(run: &buzz_db::workflow::WorkflowRunRecord) -> Value {
    serde_json::json!({
        "id": run.id,
        "workflow_id": run.workflow_id,
        "status": run.status,
        "current_step": run.current_step,
        "execution_trace": run.execution_trace,
        "started_at": run.started_at.map(|value| value.timestamp()),
        "completed_at": run.completed_at.map(|value| value.timestamp()),
        "error_code": run.error_code,
        "error_message": run.error_message,
        "created_at": run.created_at.timestamp(),
    })
}

fn approval_json(approval: &buzz_db::workflow::ApprovalRecord) -> Value {
    serde_json::json!({
        "approval_ref": hex::encode(&approval.token),
        "workflow_id": approval.workflow_id,
        "run_id": approval.run_id,
        "step_id": approval.step_id,
        "step_index": approval.step_index,
        "approver_spec": approval.approver_spec,
        "status": approval.status,
        "approver_pubkey": approval.approver_pubkey.as_ref().map(hex::encode),
        "note": approval.note,
        "expires_at": approval.expires_at,
        "created_at": approval.created_at.timestamp(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_summary_last_run_excludes_sensitive_detailed_history() {
        let detailed = serde_json::json!({
            "id":"run", "workflow_id":"workflow", "execution_state":"failed",
            "safe_error_code":"execution_failed", "origin":"manual", "requester":"owner",
            "created_at":100, "started_at":101, "completed_at":102, "accepted_at":"time",
            "deadline_at":"deadline", "revision":3,
            "results":[{"event_id":"verified-result","channel_id":"visible-channel"}],
            "execution_trace":[{"webhook_response":"SENTINEL_PRIVATE_RESPONSE","channel":"SENTINEL_OLD_DESTINATION"}],
            "error_message":"SENTINEL_PROVIDER_DIAGNOSTIC", "error_code":"SENTINEL_LEGACY_CODE",
            "status":"completed", "future_detail":"SENTINEL_NEW_FIELD"
        });
        let summary = summary_run_json(&detailed);
        assert!(!summary.to_string().contains("SENTINEL"));
        assert!(summary.get("execution_trace").is_none());
        assert!(summary.get("error_message").is_none());
        assert!(summary.get("status").is_none());
        assert_eq!(summary["execution_state"], "failed");
        assert_eq!(summary["safe_error_code"], "execution_failed");
        assert_eq!(summary["results"][0]["event_id"], "verified-result");
        // Projection leaves the legacy detailed read untouched.
        assert_eq!(
            detailed["execution_trace"][0]["webhook_response"],
            "SENTINEL_PRIVATE_RESPONSE"
        );
    }

    #[test]
    fn request_path_preserves_signed_query_verbatim() {
        assert_eq!(
            request_path("/workflows/id/runs", Some("limit=20&before_id=abc")),
            "/workflows/id/runs?limit=20&before_id=abc"
        );
        assert_eq!(
            request_path("/workflows/id/runs", None),
            "/workflows/id/runs"
        );
    }

    #[test]
    fn approval_wire_does_not_expose_hash_as_token() {
        let approval = buzz_db::workflow::ApprovalRecord {
            token: vec![0xab; 32],
            workflow_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
            step_id: "review".to_string(),
            step_index: 1,
            approver_spec: "any".to_string(),
            status: buzz_db::workflow::ApprovalStatus::Pending,
            approver_pubkey: None,
            note: None,
            expires_at: Utc::now(),
            created_at: Utc::now(),
        };
        let wire = approval_json(&approval);
        assert!(wire.get("token").is_none());
        assert_eq!(wire["approval_ref"], hex::encode([0xab; 32]));
    }
}
