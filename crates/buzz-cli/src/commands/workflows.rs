use sha2::{Digest, Sha256};

use crate::client::{
    extract_d_tag, extract_relay_response_field, normalize_write_response, print_create_response,
    BuzzClient,
};
use crate::error::CliError;
use crate::validate::{parse_uuid, read_or_stdin, sdk_err, validate_uuid};

// TODO(phase-4): Replace raw nostr::EventBuilder usage with buzz-sdk builder functions

/// List workflows in a channel — query kind:30620 workflow definition events.
pub async fn cmd_list_workflows(client: &BuzzClient, channel_id: &str) -> Result<(), CliError> {
    validate_uuid(channel_id)?;
    let filter = serde_json::json!({
        "kinds": [30620],
        "#h": [channel_id]
    });
    let resp = client.query(&filter).await?;
    let events: Vec<serde_json::Value> = serde_json::from_str(&resp).unwrap_or_default();
    let workflows: Vec<serde_json::Value> = events
        .iter()
        .map(|e| {
            serde_json::json!({
                "workflow_id": extract_d_tag(e),
                "content": e.get("content").and_then(|v| v.as_str()).unwrap_or(""),
                "created_at": e.get("created_at").and_then(|v| v.as_u64()).unwrap_or(0),
                "pubkey": e.get("pubkey").and_then(|v| v.as_str()).unwrap_or(""),
            })
        })
        .collect();
    let output = serde_json::to_string(&workflows).unwrap_or_default();
    println!("{output}");
    Ok(())
}

/// Get a single workflow definition.
pub async fn cmd_get_workflow(client: &BuzzClient, workflow_id: &str) -> Result<(), CliError> {
    validate_uuid(workflow_id)?;
    let filter = serde_json::json!({
        "kinds": [30620],
        "#d": [workflow_id]
    });
    let resp = client.query(&filter).await?;
    let events: Vec<serde_json::Value> = serde_json::from_str(&resp).unwrap_or_default();
    if let Some(e) = events.first() {
        let normalized = serde_json::json!({
            "workflow_id": extract_d_tag(e),
            "content": e.get("content").and_then(|v| v.as_str()).unwrap_or(""),
            "created_at": e.get("created_at").and_then(|v| v.as_u64()).unwrap_or(0),
            "pubkey": e.get("pubkey").and_then(|v| v.as_str()).unwrap_or(""),
        });
        println!("{normalized}");
    } else {
        println!("null");
    }
    Ok(())
}

fn workflow_runs_path(workflow_id: &str, limit: u32) -> String {
    format!("/workflows/{workflow_id}/runs?limit={limit}")
}

fn workflow_runs_from_response(response: &str) -> Result<serde_json::Value, CliError> {
    let payload: serde_json::Value = serde_json::from_str(response)
        .map_err(|error| CliError::Other(format!("invalid workflow runs response: {error}")))?;
    let runs = payload
        .get("runs")
        .filter(|value| value.is_array())
        .ok_or_else(|| CliError::Other("workflow runs response is missing a runs array".into()))?;
    Ok(runs.clone())
}

/// Get durable workflow run history from the relay-owned database read model.
pub async fn cmd_get_workflow_runs(
    client: &BuzzClient,
    workflow_id: &str,
    limit: Option<u32>,
) -> Result<(), CliError> {
    validate_uuid(workflow_id)?;
    let limit = limit.unwrap_or(20).min(100);
    let response = client
        .get_authed(&workflow_runs_path(workflow_id, limit))
        .await?;
    println!("{}", workflow_runs_from_response(&response)?);
    Ok(())
}

/// Create a workflow — sign and submit a kind:30620 event.
pub async fn cmd_create_workflow(
    client: &BuzzClient,
    channel_id: &str,
    yaml: &str,
) -> Result<(), CliError> {
    let channel_uuid = parse_uuid(channel_id)?;
    let yaml_definition = read_or_stdin(yaml)?;

    let workflow_id = uuid::Uuid::new_v4();
    let builder = buzz_sdk::build_workflow_def(channel_uuid, workflow_id, &yaml_definition)
        .map_err(sdk_err)?;
    let event = client.sign_event(builder)?;

    let resp = client.submit_event(event).await?;
    let final_workflow_id = extract_relay_response_field(&resp, "workflow_id")
        .unwrap_or_else(|| workflow_id.to_string());
    print_create_response(&resp, "workflow_id", &final_workflow_id);
    Ok(())
}

/// Update a workflow — sign and submit an updated kind:30620 event with same d-tag.
pub async fn cmd_update_workflow(
    client: &BuzzClient,
    channel_id: &str,
    workflow_id: &str,
    yaml: &str,
) -> Result<(), CliError> {
    let channel_uuid = parse_uuid(channel_id)?;
    let wf_uuid = parse_uuid(workflow_id)?;
    let yaml_definition = read_or_stdin(yaml)?;

    let filter = serde_json::json!({
        "kinds": [30620],
        "#d": [workflow_id]
    });
    let resp = client.query(&filter).await?;
    let events: Vec<serde_json::Value> = serde_json::from_str(&resp).unwrap_or_default();
    let expected_revision = events
        .first()
        .and_then(|event| event.get("id"))
        .and_then(|id| id.as_str())
        .ok_or_else(|| CliError::NotFound(format!("workflow {workflow_id} not found")))?;

    let builder =
        buzz_sdk::build_workflow_update(channel_uuid, wf_uuid, &yaml_definition, expected_revision)
            .map_err(sdk_err)?;
    let event = client.sign_event(builder)?;

    let resp = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&resp));
    Ok(())
}

/// Delete a workflow — sign and submit a kind:5 deletion event.
pub async fn cmd_delete_workflow(client: &BuzzClient, workflow_id: &str) -> Result<(), CliError> {
    let wf_uuid = parse_uuid(workflow_id)?;
    let keys = client.keys();

    let builder =
        buzz_sdk::build_workflow_delete(&keys.public_key().to_hex(), wf_uuid).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;

    let resp = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&resp));
    Ok(())
}

/// Trigger fresh bounded work. Sign once; BuzzClient retries the exact event
/// bytes while renewing only HTTP authentication, preserving admission identity.
pub async fn cmd_trigger_workflow(
    client: &BuzzClient,
    workflow_id: &str,
    inputs: Option<&str>,
    expected_definition_hash: Option<&str>,
) -> Result<(), CliError> {
    let workflow = parse_uuid(workflow_id)?;
    let inputs: serde_json::Value = serde_json::from_str(inputs.unwrap_or("{}"))
        .map_err(|e| CliError::Usage(format!("--inputs is not valid JSON: {e}")))?;
    let inputs = inputs
        .as_object()
        .ok_or_else(|| CliError::Usage("--inputs must be a JSON object".into()))?;
    let builder =
        buzz_sdk::build_workflow_manual_trigger(workflow, expected_definition_hash, inputs)
            .map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    // Keep the authoritative run id, revision and limits in the receipt.
    println!("{}", workflow_trigger_response(&response)?);
    Ok(())
}

fn workflow_trigger_response(response: &str) -> Result<serde_json::Value, CliError> {
    let mut value: serde_json::Value = serde_json::from_str(response)
        .map_err(|e| CliError::Other(format!("invalid workflow trigger response: {e}")))?;
    if let Some(receipt) = value
        .get("message")
        .and_then(serde_json::Value::as_str)
        .and_then(|m| m.strip_prefix("response:"))
    {
        let receipt: serde_json::Map<String, serde_json::Value> = serde_json::from_str(receipt)
            .map_err(|e| CliError::Other(format!("invalid workflow admission receipt: {e}")))?;
        if let Some(fields) = value.as_object_mut() {
            fields.extend(receipt);
        }
    }
    Ok(value)
}

fn scheduled_workflows_path(
    agent: &str,
    cursor: Option<&str>,
    limit: u32,
) -> Result<String, CliError> {
    let agent = nostr::PublicKey::from_hex(agent)
        .map_err(|_| CliError::Usage("--agent-pubkey must be a hex public key".into()))?;
    if !(1..=100).contains(&limit) {
        return Err(CliError::Usage("--limit must be between 1 and 100".into()));
    }
    let mut path = format!("/workflows?agent_pubkey={}&limit={limit}", agent.to_hex());
    if let Some(cursor) = cursor {
        path.push_str(&format!("&cursor={}", parse_uuid(cursor)?));
    }
    Ok(path)
}

/// Read one owner-authorized scheduled workflow page, preserving server limits
/// and the next-page cursor instead of treating the first page as exhaustive.
pub async fn cmd_scheduled_workflows(
    client: &BuzzClient,
    agent: &str,
    cursor: Option<&str>,
    limit: u32,
) -> Result<(), CliError> {
    let response = client
        .get_authed(&scheduled_workflows_path(agent, cursor, limit)?)
        .await?;
    println!("{response}");
    Ok(())
}

/// Approve or deny a workflow step — sign and submit a kind:46030 (grant) or 46031 (deny) event.
pub async fn cmd_approve_step(
    client: &BuzzClient,
    approval_token: &str,
    approved: bool,
    note: Option<&str>,
) -> Result<(), CliError> {
    validate_uuid(approval_token)?;

    let content = note.unwrap_or("");

    // The relay expects d-tag = hex(SHA256(token)), not the raw token UUID.
    let token_hash = hex::encode(Sha256::digest(approval_token.as_bytes()));
    let builder =
        buzz_sdk::build_workflow_approval(&token_hash, approved, content).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;

    let resp = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&resp));
    Ok(())
}

pub async fn dispatch(cmd: crate::WorkflowsCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::WorkflowsCmd;
    match cmd {
        WorkflowsCmd::Recover {
            request,
            container,
            audit,
        } => super::workflow_recovery::recover(client, &request, &container, &audit).await,
        WorkflowsCmd::Scheduled {
            agent_pubkey,
            cursor,
            limit,
        } => cmd_scheduled_workflows(client, &agent_pubkey, cursor.as_deref(), limit).await,
        WorkflowsCmd::List { channel } => cmd_list_workflows(client, &channel).await,
        WorkflowsCmd::Get { workflow } => cmd_get_workflow(client, &workflow).await,
        WorkflowsCmd::Create { channel, yaml } => {
            cmd_create_workflow(client, &channel, &yaml).await
        }
        WorkflowsCmd::Update {
            channel,
            workflow,
            yaml,
        } => cmd_update_workflow(client, &channel, &workflow, &yaml).await,
        WorkflowsCmd::Delete { workflow } => cmd_delete_workflow(client, &workflow).await,
        WorkflowsCmd::Trigger {
            workflow,
            inputs,
            expected_definition_hash,
        } => {
            cmd_trigger_workflow(
                client,
                &workflow,
                inputs.as_deref(),
                expected_definition_hash.as_deref(),
            )
            .await
        }
        WorkflowsCmd::Runs { workflow, limit } => {
            cmd_get_workflow_runs(client, &workflow, limit).await
        }
        WorkflowsCmd::Approve {
            token,
            approved,
            note,
        } => {
            // approved is already a bool — no parse_bool_flag needed
            cmd_approve_step(client, &token, approved, note.as_deref()).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_trigger_receipt_keeps_run_revision_and_authoritative_limits() {
        let receipt = serde_json::json!({"accepted":true,"run_id":"run","revision":1,"limits":{"remaining_workflow":2}});
        let response = serde_json::json!({"event_id":"event","accepted":true,"message":format!("response:{receipt}")});
        let actual = workflow_trigger_response(&response.to_string()).unwrap();
        assert_eq!(actual["event_id"], "event");
        assert_eq!(actual["run_id"], "run");
        assert_eq!(actual["revision"], 1);
        assert_eq!(actual["limits"]["remaining_workflow"], 2);
    }

    #[test]
    fn workflow_scheduled_path_validates_cursor_and_limit() {
        let key = nostr::Keys::generate().public_key().to_hex();
        let id = uuid::Uuid::new_v4();
        assert_eq!(
            scheduled_workflows_path(&key, Some(&id.to_string()), 10).unwrap(),
            format!("/workflows?agent_pubkey={key}&limit=10&cursor={id}")
        );
        assert!(scheduled_workflows_path(&key, Some("not-a-uuid"), 10).is_err());
        assert!(scheduled_workflows_path(&key, None, 101).is_err());
        assert!(scheduled_workflows_path("not-a-key", None, 10).is_err());
    }

    #[test]
    fn workflow_runs_path_targets_the_durable_relay_endpoint() {
        let workflow_id = "00000000-0000-0000-0000-000000000001";

        assert_eq!(
            workflow_runs_path(workflow_id, 25),
            "/workflows/00000000-0000-0000-0000-000000000001/runs?limit=25"
        );
    }

    #[test]
    fn workflow_runs_response_extracts_the_runs_array() {
        let runs = workflow_runs_from_response(
            r#"{"runs":[{"id":"run-1","status":"completed"}],"next":null}"#,
        )
        .expect("valid workflow runs response");

        assert_eq!(
            runs,
            serde_json::json!([{"id":"run-1","status":"completed"}])
        );
    }

    #[test]
    fn workflow_runs_response_rejects_a_missing_runs_array() {
        let error = workflow_runs_from_response(r#"{"next":null}"#)
            .expect_err("missing runs must not masquerade as an empty history");

        assert!(error.to_string().contains("runs array"));
    }
}
