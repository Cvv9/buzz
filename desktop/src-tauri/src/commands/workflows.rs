use std::collections::HashSet;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::{
    app_state::AppState,
    events,
    relay::{get_relay_json, parse_command_response, query_relay, submit_event},
};

// ── Wire shapes (snake_case, consumed by tauriWorkflows.ts) ──────────────────

/// A workflow definition as the desktop frontend expects it. Mirrors the
/// `RawWorkflow` type in `desktop/src/shared/api/tauriWorkflows.ts`.
///
/// The relay stores a workflow as a single kind:30620 event whose content is
/// the raw YAML. Everything the UI needs is derived from that event:
/// - `id` / `channel_id` from the `d` / `h` tags,
/// - `definition` from parsing the YAML body into a free-form object,
/// - `name` from `definition.name`,
/// - `owner_pubkey` / timestamps from the event itself.
///
/// `status` is always `"active"` here: the relay's disable/archive lifecycle is
/// not reflected back into the kind:30620 event, and the UI derives a
/// "disabled" display state from `definition.enabled` on its own
/// (`getWorkflowDisplayStatus`).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WorkflowWire {
    pub id: String,
    /// Event id of the current kind:30620 revision, used for conflict-protected updates.
    pub revision: String,
    pub name: String,
    pub owner_pubkey: String,
    pub channel_id: Option<String>,
    pub definition: Value,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Response shape for create/update. Mirrors `RawWorkflowSaveResponse` in the
/// frontend: a full workflow record plus an optional webhook secret (only
/// present for webhook-triggered workflows on creation).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WorkflowSaveWire {
    #[serde(flatten)]
    pub workflow: WorkflowWire,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_secret: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, Serialize, PartialEq)]
pub struct WorkflowRunCursorWire {
    pub before: String,
    pub before_id: String,
}

#[derive(Debug, Clone, serde::Deserialize, Serialize, PartialEq)]
pub struct WorkflowRunsWire {
    pub runs: Vec<Value>,
    pub next: Option<WorkflowRunCursorWire>,
}

#[derive(Debug, Clone, serde::Deserialize, Serialize, PartialEq)]
pub struct WorkflowApprovalsWire {
    pub approvals: Vec<Value>,
}

/// Canonical trigger acknowledgement consumed by the Desktop client.
///
/// The relay currently returns only `run_id`; the workflow id is the command
/// input and a newly-created run always begins pending. Keeping that adaptation
/// here prevents the frontend from guessing fields or confusing the trigger
/// event id with the persisted run id.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WorkflowTriggerWire {
    pub run_id: String,
    pub workflow_id: String,
    pub status: String,
}

#[derive(Debug, serde::Deserialize)]
struct WorkflowTriggerAck {
    run_id: String,
}

// ── Reads ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_channel_workflows(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkflowWire>, String> {
    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [30620],
            "#h": [channel_id],
        })],
    )
    .await?;

    Ok(events.iter().map(workflow_from_event).collect())
}

// Keep this aligned with the relay's aggregate explicit-`#h` request bound.
// Each filter below carries exactly one explicit value so old relays retain the
// known-compatible shape while current relays cannot reject large memberships.
const WORKFLOW_QUERY_CHANNEL_BATCH_SIZE: usize = 128;

/// Fetch workflows across many channels using bounded relay round-trips.
///
/// The Workflows overview screen previously issued one `get_channel_workflows`
/// query per member channel (`Promise.all` fanout in `WorkflowsView`), i.e. N
/// relay POSTs. This sends one single-channel filter per channel, in requests of
/// at most 128 filters. Using one multi-value `#h` filter is equivalent under
/// NIP-01, but older relays incorrectly narrowed that shape to its first
/// channel. Each `WorkflowWire` carries its own `channel_id` (from the event's
/// `h` tag), so the frontend can still group results by channel. Neither this
/// nor the per-channel command sets a `limit`, so batching does not change
/// result completeness. Results are deduplicated by signed event ID in case a
/// caller supplies duplicate channel IDs.
#[tauri::command]
pub async fn get_channels_workflows(
    channel_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<WorkflowWire>, String> {
    let filter_batches = channel_workflow_filter_batches(channel_ids)?;
    let mut seen_event_ids = HashSet::new();
    let mut workflows = Vec::new();

    for filters in filter_batches {
        let events = query_relay(&state, &filters).await?;
        append_unique_workflows(&mut workflows, &mut seen_event_ids, &events);
    }

    Ok(workflows)
}

fn append_unique_workflows(
    workflows: &mut Vec<WorkflowWire>,
    seen_event_ids: &mut HashSet<nostr::EventId>,
    events: &[nostr::Event],
) {
    workflows.extend(
        events
            .iter()
            .filter(|event| seen_event_ids.insert(event.id))
            .map(workflow_from_event),
    );
}

fn channel_workflow_filter_batches(channel_ids: Vec<String>) -> Result<Vec<Vec<Value>>, String> {
    let filters = channel_workflow_filters(channel_ids)?;
    Ok(filters
        .chunks(WORKFLOW_QUERY_CHANNEL_BATCH_SIZE)
        .map(<[Value]>::to_vec)
        .collect())
}

fn channel_workflow_filters(channel_ids: Vec<String>) -> Result<Vec<Value>, String> {
    channel_ids
        .into_iter()
        .map(|channel_id| {
            let channel_id = uuid::Uuid::parse_str(channel_id.trim())
                .map_err(|_| "invalid channel id".to_string())?;
            Ok(serde_json::json!({
                "kinds": [30620],
                "#h": [channel_id.to_string()],
            }))
        })
        .collect()
}

#[tauri::command]
pub async fn get_workflow(
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<WorkflowWire, String> {
    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [30620],
            "#d": [workflow_id],
            "limit": 1
        })],
    )
    .await?;

    events
        .first()
        .map(workflow_from_event)
        .ok_or_else(|| "workflow not found".to_string())
}

#[tauri::command]
pub async fn get_workflow_runs(
    workflow_id: String,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<WorkflowRunsWire, String> {
    let workflow_id =
        uuid::Uuid::parse_str(&workflow_id).map_err(|_| "invalid workflow id".to_string())?;
    let limit = limit.unwrap_or(20).clamp(1, 100);
    get_relay_json(
        &state,
        &format!("/workflows/{workflow_id}/runs?limit={limit}"),
    )
    .await
}

// ── Writes ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_workflow(
    channel_id: String,
    yaml_definition: String,
    state: State<'_, AppState>,
) -> Result<WorkflowSaveWire, String> {
    let workflow_id = uuid::Uuid::new_v4().to_string();
    let builder =
        events::build_workflow_definition(&workflow_id, &channel_id, &yaml_definition, None)?;
    let result = submit_event(builder, &state).await?;

    // The relay returns `webhook_secret` in the OK response message for
    // webhook-triggered workflows. Everything else in the save record is built
    // locally from the inputs we already hold — the relay's create response
    // only carries `{ workflow_id, webhook_secret? }`.
    let webhook_secret = parse_command_response::<Value>(&result.message)
        .ok()
        .and_then(|v| {
            v.get("webhook_secret")
                .and_then(Value::as_str)
                .map(str::to_string)
        });

    let now = now_secs();
    let workflow = workflow_record(
        workflow_id,
        result.event_id,
        Some(channel_id),
        current_pubkey_hex(&state)?,
        &yaml_definition,
        now,
        now,
    );

    Ok(WorkflowSaveWire {
        workflow,
        webhook_secret,
    })
}

#[tauri::command]
pub async fn update_workflow(
    workflow_id: String,
    yaml_definition: String,
    expected_revision: String,
    state: State<'_, AppState>,
) -> Result<WorkflowSaveWire, String> {
    // Find the channel id (and creation time) from the existing workflow event
    // so the new event carries the same `h` tag — kind:30620 is replaceable by
    // (pubkey, d-tag).
    let prior = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [30620],
            "#d": [workflow_id.clone()],
            "limit": 1
        })],
    )
    .await?;

    let prior_event = prior
        .first()
        .ok_or_else(|| "workflow not found".to_string())?;
    if prior_event.id.to_hex() != expected_revision {
        return Err("workflow changed since it was loaded; refresh and try again".to_string());
    }
    let channel_id = tag_value(prior_event, "h").ok_or_else(|| "workflow not found".to_string())?;
    let created_at = prior_event.created_at.as_secs() as i64;

    let builder = events::build_workflow_definition(
        &workflow_id,
        &channel_id,
        &yaml_definition,
        Some(&expected_revision),
    )?;
    let result = submit_event(builder, &state).await?;

    let updated_at = now_secs();
    let workflow = workflow_record(
        workflow_id,
        result.event_id,
        Some(channel_id),
        current_pubkey_hex(&state)?,
        &yaml_definition,
        created_at,
        updated_at,
    );

    Ok(WorkflowSaveWire {
        workflow,
        // Updates never rotate the webhook secret.
        webhook_secret: None,
    })
}

#[tauri::command]
pub async fn delete_workflow(
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // The NIP-09 `a` coordinate must name the workflow's actual author, not
    // the caller: kind:30620 is addressable by (author, d-tag), and workflows
    // are commonly agent-created. Addressing the delete at the caller's own
    // pubkey targets a record that doesn't exist — the relay accepts the
    // kind:5 and deletes nothing.
    let prior = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [30620],
            "#d": [workflow_id.clone()],
            "limit": 1
        })],
    )
    .await?;
    let owner_pubkey = prior
        .first()
        .map(|ev| ev.pubkey.to_hex())
        .ok_or_else(|| "workflow not found".to_string())?;

    let builder = events::build_workflow_delete(&workflow_id, &owner_pubkey)?;
    submit_event(builder, &state).await?;
    Ok(())
}

#[tauri::command]
pub async fn trigger_workflow(
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<WorkflowTriggerWire, String> {
    let builder = events::build_workflow_trigger(&workflow_id)?;
    let result = submit_event(builder, &state).await?;
    trigger_wire_from_message(workflow_id, &result.message)
}

// ── Approvals ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_run_approvals(
    workflow_id: String,
    run_id: String,
    state: State<'_, AppState>,
) -> Result<WorkflowApprovalsWire, String> {
    let workflow_id =
        uuid::Uuid::parse_str(&workflow_id).map_err(|_| "invalid workflow id".to_string())?;
    let run_id =
        uuid::Uuid::parse_str(&run_id).map_err(|_| "invalid workflow run id".to_string())?;
    get_relay_json(
        &state,
        &format!("/workflows/{workflow_id}/runs/{run_id}/approvals"),
    )
    .await
}

#[tauri::command]
pub async fn grant_approval(
    token: String,
    note: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let builder = events::build_approval_grant(&token, note.as_deref())?;
    let result = submit_event(builder, &state).await?;
    Ok(serde_json::json!({ "event_id": result.event_id }))
}

#[tauri::command]
pub async fn deny_approval(
    token: String,
    note: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let builder = events::build_approval_deny(&token, note.as_deref())?;
    let result = submit_event(builder, &state).await?;
    Ok(serde_json::json!({ "event_id": result.event_id }))
}

// ── Helpers (pure, unit-tested in workflows_tests.rs) ─────────────────────────

fn trigger_wire_from_message(
    workflow_id: String,
    message: &str,
) -> Result<WorkflowTriggerWire, String> {
    let ack: WorkflowTriggerAck = parse_command_response(message)?;
    if ack.run_id.trim().is_empty() {
        return Err("workflow trigger response contained an empty run_id".to_string());
    }
    Ok(WorkflowTriggerWire {
        run_id: ack.run_id,
        workflow_id,
        status: "pending".to_string(),
    })
}

fn current_pubkey_hex(state: &AppState) -> Result<String, String> {
    let keys = state.keys.lock().map_err(|e| e.to_string())?;
    Ok(keys.public_key().to_hex())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// First value of the tag whose name matches `name` (e.g. `d`, `h`).
fn tag_value(ev: &nostr::Event, name: &str) -> Option<String> {
    ev.tags.iter().find_map(|t| {
        let s = t.as_slice();
        (s.len() >= 2 && s[0] == name).then(|| s[1].clone())
    })
}

/// Parse a workflow's YAML body into a free-form JSON object. The frontend
/// consumes `definition` as `Record<string, unknown>`, so we preserve the full
/// document. On parse failure (or a non-object document) we fall back to an
/// empty object rather than failing the whole list query — a single malformed
/// workflow must not break the page.
fn parse_definition(yaml: &str) -> Value {
    match serde_yaml::from_str::<Value>(yaml) {
        Ok(v @ Value::Object(_)) => v,
        _ => Value::Object(serde_json::Map::new()),
    }
}

/// Build a [`WorkflowWire`] record from its parts. Shared by the read path
/// (from a relay event) and the write path (from local inputs).
fn workflow_record(
    id: String,
    revision: String,
    channel_id: Option<String>,
    owner_pubkey: String,
    yaml_definition: &str,
    created_at: i64,
    updated_at: i64,
) -> WorkflowWire {
    let definition = parse_definition(yaml_definition);
    let name = definition
        .get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| id.clone());

    WorkflowWire {
        id,
        revision,
        name,
        owner_pubkey,
        channel_id,
        definition,
        status: "active".to_string(),
        created_at,
        updated_at,
    }
}

/// Convert a kind:30620 workflow definition event into a [`WorkflowWire`].
fn workflow_from_event(ev: &nostr::Event) -> WorkflowWire {
    let id = tag_value(ev, "d").unwrap_or_default();
    let channel_id = tag_value(ev, "h");
    let ts = ev.created_at.as_secs() as i64;
    workflow_record(
        id,
        ev.id.to_hex(),
        channel_id,
        ev.pubkey.to_hex(),
        &ev.content,
        ts,
        ts,
    )
}

/// Active relay and identity captured by the settings surface.
#[derive(Debug, Clone, serde::Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ManualWorkflowScope {
    pub relay_url: String,
    pub owner_pubkey: String,
}

/// A signed request retained in memory for exact retries, never a private key.
#[derive(Debug, Clone, serde::Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedManualWorkflow {
    pub scope: ManualWorkflowScope,
    pub workflow_id: String,
    pub definition_hash: String,
    pub event: nostr::Event,
}

fn check_manual_scope_values(
    scope: &ManualWorkflowScope,
    relay_url: &str,
    owner_pubkey: &str,
) -> Result<(), String> {
    if crate::relay::relay_http_base_url(&scope.relay_url)
        != crate::relay::relay_http_base_url(relay_url)
        || scope.owner_pubkey != owner_pubkey
    {
        return Err("Workflow scope changed; refresh before trying again.".into());
    }
    Ok(())
}

fn manual_scope_keys(state: &AppState, scope: &ManualWorkflowScope) -> Result<nostr::Keys, String> {
    let keys = state.signing_keys()?;
    check_manual_scope_values(
        scope,
        &crate::relay::relay_ws_url_with_override(state),
        &keys.public_key().to_hex(),
    )?;
    Ok(keys)
}

fn validate_prepared_manual(request: &PreparedManualWorkflow) -> Result<(), String> {
    request
        .event
        .verify()
        .map_err(|_| "Invalid workflow signature.")?;
    let workflow =
        uuid::Uuid::parse_str(&request.workflow_id).map_err(|_| "Invalid workflow id.")?;
    if workflow.is_nil()
        || request.event.pubkey.to_hex() != request.scope.owner_pubkey
        || request.event.kind != nostr::Kind::Custom(46020)
    {
        return Err("Invalid workflow request identity or kind.".into());
    }
    nostr::EventId::from_hex(&request.definition_hash)
        .map_err(|_| "Invalid workflow definition hash.")?;
    let content: Value = serde_json::from_str(&request.event.content)
        .map_err(|_| "Invalid workflow request content.")?;
    if content != serde_json::json!({"expected_definition_hash":request.definition_hash}) {
        return Err("Invalid workflow request content.".into());
    }
    let tags: Vec<_> = request
        .event
        .tags
        .iter()
        .map(|tag| tag.as_slice())
        .collect();
    if tags.len() != 2
        || tags[0] != ["d", request.workflow_id.as_str()]
        || tags[1].len() != 2
        || tags[1][0] != "nonce"
        || uuid::Uuid::parse_str(&tags[1][1]).is_err()
    {
        return Err("Invalid workflow request tags.".into());
    }
    Ok(())
}

/// Fetch only authorized scheduled summaries under a captured relay/identity.
#[tauri::command]
pub async fn get_agent_scheduled_workflows(
    agent_pubkey: String,
    cursor: Option<String>,
    scope: ManualWorkflowScope,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let agent = nostr::PublicKey::from_hex(&agent_pubkey).map_err(|_| "Invalid agent pubkey.")?;
    let mut path = format!("/workflows?agent_pubkey={}&limit=20", agent.to_hex());
    if let Some(cursor) = cursor {
        let cursor = uuid::Uuid::parse_str(&cursor).map_err(|_| "Invalid workflow cursor.")?;
        path.push_str(&format!("&cursor={cursor}"));
    }
    manual_scoped_request(&state, &scope, reqwest::Method::GET, &path, None).await
}

/// Sign one fresh manual command. Subsequent retries submit this same envelope.
#[tauri::command]
pub async fn prepare_manual_workflow(
    workflow_id: String,
    definition_hash: String,
    scope: ManualWorkflowScope,
    state: State<'_, AppState>,
) -> Result<PreparedManualWorkflow, String> {
    let keys = manual_scope_keys(&state, &scope)?;
    let event = events::build_manual_workflow_trigger(&workflow_id, &definition_hash)?
        .sign_with_keys(&keys)
        .map_err(|_| "Could not sign workflow request.")?;
    let prepared = PreparedManualWorkflow {
        scope,
        workflow_id,
        definition_hash,
        event,
    };
    validate_prepared_manual(&prepared)?;
    manual_scope_keys(&state, &prepared.scope)?;
    Ok(prepared)
}

/// Publish exact prepared bytes and preserve both acceptance and denial receipts.
#[tauri::command]
pub async fn submit_manual_workflow(
    request: PreparedManualWorkflow,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    validate_prepared_manual(&request)?;
    let body = serde_json::to_vec(&request.event).map_err(|_| "Invalid workflow request.")?;
    let response = manual_scoped_request(
        &state,
        &request.scope,
        reqwest::Method::POST,
        "/events",
        Some(body),
    )
    .await?;
    manual_receipt(&response, &request.event.id.to_hex())
}

fn manual_receipt(response: &Value, event_id: &str) -> Result<Value, String> {
    if response.get("event_id").and_then(Value::as_str) != Some(event_id) {
        return Err("Workflow response identity mismatch; retry the same request.".into());
    }
    let message = response
        .get("message")
        .and_then(Value::as_str)
        .ok_or("Workflow response missing; retry the same request.")?;
    let receipt: Value = parse_command_response(message)
        .map_err(|_| "Workflow outcome unknown; check status or retry the same request.")?;
    let accepted = receipt
        .get("accepted")
        .and_then(Value::as_bool)
        .ok_or("Workflow outcome unknown; retry the same request.")?;
    if response.get("accepted").and_then(Value::as_bool) != Some(accepted)
        || receipt.get("revision").and_then(Value::as_i64).is_none()
        || !receipt.get("limits").is_some_and(Value::is_object)
        || (accepted
            && receipt
                .get("run_id")
                .and_then(Value::as_str)
                .and_then(|id| uuid::Uuid::parse_str(id).ok())
                .is_none())
        || (!accepted && receipt.get("reason").and_then(Value::as_str).is_none())
    {
        return Err("Workflow outcome unknown; retry the same request.".into());
    }
    Ok(receipt)
}

fn manual_write_gate() -> Result<(), String> {
    use futures_util::FutureExt;
    crate::relay_admission::wait_for_rate_limit()
        .now_or_never()
        .ok_or_else(|| "Workflow is rate limited. Retry this same request when connected.".into())
}

async fn wait_for_manual_scope(
    check: impl Fn() -> Result<(), String>,
    wait: impl std::future::Future<Output = ()>,
) -> Result<(), String> {
    check()?;
    wait.await;
    check()
}

// Bound the complete exchange, including a response body that stops arriving.
async fn manual_response_with_deadline(
    exchange: impl std::future::Future<Output = Result<Value, String>>,
) -> Result<Value, String> {
    tokio::time::timeout(std::time::Duration::from_secs(20), exchange)
        .await
        .map_err(|_| {
            "Workflow outcome unconfirmed after timeout. Check status or retry the same request."
                .to_string()
        })?
}

// This path deliberately captures the destination and signing identity BEFORE
// the admission wait, rechecks them afterwards, and never re-resolves the URL.
async fn manual_scoped_request(
    state: &AppState,
    scope: &ManualWorkflowScope,
    method: reqwest::Method,
    path: &str,
    body: Option<Vec<u8>>,
) -> Result<Value, String> {
    let keys = manual_scope_keys(state, scope)?;
    let url = format!(
        "{}{}",
        crate::relay::relay_http_base_url(&scope.relay_url),
        path
    );
    if method == reqwest::Method::POST {
        // Never turn a manual click into delayed background work.
        manual_write_gate()?;
        manual_scope_keys(state, scope)?;
    } else {
        wait_for_manual_scope(
            || manual_scope_keys(state, scope).map(|_| ()),
            crate::relay_admission::wait_for_rate_limit(),
        )
        .await?;
    }
    let bytes = body.unwrap_or_default();
    let auth = crate::relay::build_nip98_auth_header_for_keys(&keys, &method, &url, &bytes)?;
    crate::egress_guard::assert_no_key_backup_bytes(&bytes, "manual workflow")?;
    manual_response_with_deadline(async {
        let response = state
            .http_client
            .request(method, &url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .body(bytes)
            .send()
            .await
            .map_err(|_| {
                "Workflow request could not be confirmed. Check status before retrying."
            })?;
        manual_scope_keys(state, scope)?;
        if !response.status().is_success() {
            return Err(
                "Workflow request unavailable. Refresh access and retry the same request if needed."
                    .into(),
            );
        }
        let result = crate::relay::parse_json_response(response).await?;
        manual_scope_keys(state, scope)?;
        Ok(result)
    })
    .await
}

#[cfg(test)]
#[path = "workflows_tests.rs"]
mod tests;
