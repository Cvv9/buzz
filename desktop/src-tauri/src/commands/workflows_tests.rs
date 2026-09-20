// Tests for commands/workflows.rs — split into a sibling file to keep
// workflows.rs focused. These exercise the pure helpers (no relay): event →
// wire conversion, YAML definition parsing, name derivation, and the
// create/update record shaping.

use super::*;
use nostr::{EventBuilder, Keys, Kind, Tag};

/// Build a signed kind:30620 workflow definition event with the given YAML
/// content and d/h tags.
fn wf_event(d: &str, h: &str, yaml: &str) -> nostr::Event {
    let keys = Keys::generate();
    let tags: Vec<Tag> = [vec!["d", d], vec!["h", h]]
        .into_iter()
        .map(|t| Tag::parse(t).expect("parse tag"))
        .collect();
    EventBuilder::new(Kind::Custom(30620), yaml)
        .tags(tags)
        .sign_with_keys(&keys)
        .expect("sign")
}

const CHAN: &str = "11111111-1111-1111-1111-111111111111";
const WF: &str = "22222222-2222-2222-2222-222222222222";

const YAML: &str = "\
name: Greet on join
description: Says hi
enabled: true
trigger:
  on: message_posted
  filter: hello
steps:
  - id: reply
    action: post_message
";

#[test]
fn workflow_from_event_maps_all_fields() {
    let ev = wf_event(WF, CHAN, YAML);
    let wf = workflow_from_event(&ev);

    assert_eq!(wf.id, WF);
    assert_eq!(wf.revision, ev.id.to_hex());
    assert_eq!(wf.channel_id.as_deref(), Some(CHAN));
    assert_eq!(wf.owner_pubkey, ev.pubkey.to_hex());
    assert_eq!(wf.name, "Greet on join");
    assert_eq!(wf.status, "active");
    assert_eq!(wf.created_at, ev.created_at.as_secs() as i64);
    assert_eq!(wf.updated_at, ev.created_at.as_secs() as i64);
}

#[test]
fn definition_is_parsed_into_object_with_nested_fields() {
    let ev = wf_event(WF, CHAN, YAML);
    let wf = workflow_from_event(&ev);

    // The whole YAML document is preserved as a free-form object.
    let def = wf.definition.as_object().expect("definition is an object");
    assert_eq!(
        def.get("description").and_then(Value::as_str),
        Some("Says hi")
    );
    assert_eq!(def.get("enabled").and_then(Value::as_bool), Some(true));
    assert_eq!(
        wf.definition.pointer("/trigger/on").and_then(Value::as_str),
        Some("message_posted")
    );
    assert_eq!(
        wf.definition
            .pointer("/steps/0/action")
            .and_then(Value::as_str),
        Some("post_message")
    );
}

#[test]
fn name_falls_back_to_id_when_missing() {
    let yaml = "trigger:\n  on: schedule\n  cron: '* * * * *'\n";
    let ev = wf_event(WF, CHAN, yaml);
    let wf = workflow_from_event(&ev);
    assert_eq!(wf.name, WF);
}

#[test]
fn name_falls_back_to_id_when_blank() {
    let yaml = "name: '   '\ntrigger:\n  on: schedule\n";
    let ev = wf_event(WF, CHAN, yaml);
    let wf = workflow_from_event(&ev);
    assert_eq!(wf.name, WF);
}

#[test]
fn malformed_yaml_yields_empty_object_not_error() {
    // A broken workflow must not break the whole list — definition falls back
    // to an empty object and the name falls back to the id. (YAML is permissive,
    // so this uses an unterminated flow mapping that genuinely fails to parse.)
    let ev = wf_event(WF, CHAN, "{ name: oops, unterminated: [1, 2");
    let wf = workflow_from_event(&ev);
    assert_eq!(wf.definition, Value::Object(serde_json::Map::new()));
    assert_eq!(wf.name, WF);
}

#[test]
fn scalar_yaml_document_yields_empty_object() {
    // A bare scalar parses as valid YAML but isn't an object; treat as empty.
    let ev = wf_event(WF, CHAN, "just a string");
    let wf = workflow_from_event(&ev);
    assert_eq!(wf.definition, Value::Object(serde_json::Map::new()));
}

#[test]
fn tag_value_reads_d_and_h_and_misses_absent() {
    let ev = wf_event(WF, CHAN, YAML);
    assert_eq!(tag_value(&ev, "d").as_deref(), Some(WF));
    assert_eq!(tag_value(&ev, "h").as_deref(), Some(CHAN));
    assert_eq!(tag_value(&ev, "z"), None);
}

#[test]
fn workflow_record_shapes_save_inputs() {
    let wf = workflow_record(
        WF.to_string(),
        "revision-1".to_string(),
        Some(CHAN.to_string()),
        "deadbeef".to_string(),
        YAML,
        100,
        200,
    );
    assert_eq!(wf.id, WF);
    assert_eq!(wf.name, "Greet on join");
    assert_eq!(wf.owner_pubkey, "deadbeef");
    assert_eq!(wf.channel_id.as_deref(), Some(CHAN));
    assert_eq!(wf.created_at, 100);
    assert_eq!(wf.updated_at, 200);
    assert_eq!(wf.status, "active");
}

#[test]
fn save_wire_serializes_flat_with_optional_secret() {
    let workflow = workflow_record(
        WF.to_string(),
        "revision-1".to_string(),
        Some(CHAN.to_string()),
        "deadbeef".to_string(),
        YAML,
        1,
        1,
    );

    // With a secret: present, flattened alongside the workflow fields.
    let with = WorkflowSaveWire {
        workflow: workflow.clone(),
        webhook_secret: Some("s3cr3t".to_string()),
    };
    let v = serde_json::to_value(&with).expect("serialize");
    assert_eq!(v.get("id").and_then(Value::as_str), Some(WF));
    assert_eq!(v.get("name").and_then(Value::as_str), Some("Greet on join"));
    assert_eq!(
        v.get("webhook_secret").and_then(Value::as_str),
        Some("s3cr3t")
    );

    // Without a secret: the key is omitted entirely (frontend treats as null).
    let without = WorkflowSaveWire {
        workflow,
        webhook_secret: None,
    };
    let v = serde_json::to_value(&without).expect("serialize");
    assert!(v.get("webhook_secret").is_none());
    assert_eq!(v.get("id").and_then(Value::as_str), Some(WF));
}

#[test]
fn workflow_wire_serializes_with_snake_case_keys() {
    // Guard the wire contract the frontend's RawWorkflow depends on.
    let ev = wf_event(WF, CHAN, YAML);
    let v = serde_json::to_value(workflow_from_event(&ev)).expect("serialize");
    for key in [
        "id",
        "revision",
        "name",
        "owner_pubkey",
        "channel_id",
        "definition",
        "status",
        "created_at",
        "updated_at",
    ] {
        assert!(v.get(key).is_some(), "missing wire key: {key}");
    }
}

#[test]
fn multi_channel_workflow_query_uses_one_filter_per_channel() {
    let other_channel = "33333333-3333-3333-3333-333333333333";
    let filters = channel_workflow_filters(vec![CHAN.to_string(), other_channel.to_string()])
        .expect("valid channels");

    assert_eq!(filters.len(), 2);
    assert_eq!(
        filters[0],
        serde_json::json!({
            "kinds": [30620],
            "#h": [CHAN],
        })
    );
    assert_eq!(
        filters[1],
        serde_json::json!({
            "kinds": [30620],
            "#h": [other_channel],
        })
    );
}

#[test]
fn workflow_queries_respect_relay_explicit_channel_limit() {
    for (channel_count, expected_batch_sizes) in [
        (WORKFLOW_QUERY_CHANNEL_BATCH_SIZE, vec![128]),
        (WORKFLOW_QUERY_CHANNEL_BATCH_SIZE + 1, vec![128, 1]),
    ] {
        let channel_ids = (0..channel_count)
            .map(|index| uuid::Uuid::from_u128(index as u128 + 1).to_string())
            .collect();
        let batches = channel_workflow_filter_batches(channel_ids).expect("valid channels");

        assert_eq!(
            batches.iter().map(Vec::len).collect::<Vec<_>>(),
            expected_batch_sizes
        );
        assert!(batches.iter().flatten().all(|filter| filter["#h"]
            .as_array()
            .is_some_and(|values| values.len() == 1)));
    }
}

#[test]
fn workflow_query_results_are_deduplicated_by_event_id() {
    let first = wf_event(WF, CHAN, YAML);
    let second_workflow = "33333333-3333-3333-3333-333333333333";
    let second = wf_event(second_workflow, CHAN, YAML);
    let mut workflows = Vec::new();
    let mut seen_event_ids = HashSet::new();

    append_unique_workflows(
        &mut workflows,
        &mut seen_event_ids,
        &[first.clone(), second.clone()],
    );
    append_unique_workflows(&mut workflows, &mut seen_event_ids, &[first, second]);

    assert_eq!(workflows.len(), 2);
    assert_eq!(workflows[0].id, WF);
    assert_eq!(workflows[1].id, second_workflow);
}

#[test]
fn channel_workflow_filters_reject_malformed_or_blank_channel_ids() {
    for channel_id in ["not-a-uuid", "", "   "] {
        let error = channel_workflow_filters(vec![channel_id.to_string()])
            .expect_err("malformed channel id must fail before querying the relay");
        assert_eq!(error, "invalid channel id");
    }
}

#[test]
fn channel_workflow_filters_accepts_empty_input() {
    assert_eq!(
        channel_workflow_filters(Vec::new()).expect("empty input is valid"),
        Vec::<Value>::new()
    );
}

#[test]
fn trigger_response_uses_persisted_run_id_contract() {
    let wire = trigger_wire_from_message(
        WF.to_string(),
        "response:{\"run_id\":\"33333333-3333-3333-3333-333333333333\"}",
    )
    .expect("parse trigger response");

    assert_eq!(wire.run_id, "33333333-3333-3333-3333-333333333333");
    assert_eq!(wire.workflow_id, WF);
    assert_eq!(wire.status, "pending");
    let value = serde_json::to_value(wire).expect("serialize trigger response");
    assert!(value.get("event_id").is_none());
}

#[test]
fn trigger_response_rejects_missing_or_empty_run_id() {
    assert!(trigger_wire_from_message(WF.to_string(), "response:{}").is_err());
    assert!(trigger_wire_from_message(WF.to_string(), "response:{\"run_id\":\"   \"}",).is_err());
}

#[test]
fn run_reads_serialize_to_backend_envelopes() {
    let runs = WorkflowRunsWire {
        runs: Vec::new(),
        next: None,
    };
    let approvals = WorkflowApprovalsWire {
        approvals: Vec::new(),
    };
    assert_eq!(
        serde_json::to_value(runs).expect("serialize runs"),
        serde_json::json!({ "runs": [], "next": null })
    );
    assert_eq!(
        serde_json::to_value(approvals).expect("serialize approvals"),
        serde_json::json!({ "approvals": [] })
    );
}

fn prepared_manual(keys: &Keys) -> PreparedManualWorkflow {
    let hash = "ab".repeat(32);
    PreparedManualWorkflow {
        scope: ManualWorkflowScope {
            relay_url: "wss://relay.test".into(),
            owner_pubkey: keys.public_key().to_hex(),
        },
        workflow_id: WF.into(),
        definition_hash: hash.clone(),
        event: events::build_manual_workflow_trigger(WF, &hash)
            .unwrap()
            .sign_with_keys(keys)
            .unwrap(),
    }
}

#[test]
fn manual_workflow_nonce_is_unique_and_retry_keeps_signed_bytes() {
    let keys = Keys::generate();
    let first = prepared_manual(&keys);
    let second = prepared_manual(&keys);
    validate_prepared_manual(&first).unwrap();
    validate_prepared_manual(&second).unwrap();
    assert_ne!(first.event.id, second.event.id);
    let bytes = serde_json::to_vec(&first).unwrap();
    let retry: PreparedManualWorkflow = serde_json::from_slice(&bytes).unwrap();
    validate_prepared_manual(&retry).unwrap();
    assert_eq!(bytes, serde_json::to_vec(&retry).unwrap());
    assert_eq!(first.event.id, retry.event.id);
    assert_eq!(
        serde_json::from_str::<Value>(&retry.event.content).unwrap(),
        serde_json::json!({"expected_definition_hash":"ab".repeat(32)})
    );
}

#[test]
fn manual_workflow_envelope_rejects_tampering_and_other_operations() {
    let keys = Keys::generate();
    let mut request = prepared_manual(&keys);
    request.definition_hash = "cd".repeat(32);
    assert!(validate_prepared_manual(&request).is_err());
    let mut request = prepared_manual(&keys);
    request.scope.owner_pubkey = Keys::generate().public_key().to_hex();
    assert!(validate_prepared_manual(&request).is_err());
    let mut request = prepared_manual(&keys);
    request.event = EventBuilder::new(Kind::Custom(46020), serde_json::json!({"expected_definition_hash":request.definition_hash,"extra":"side effect"}).to_string()).tags(request.event.tags.clone()).sign_with_keys(&keys).unwrap();
    assert!(validate_prepared_manual(&request).is_err());
    let mut request = prepared_manual(&keys);
    request.event = EventBuilder::new(Kind::Custom(40002), "write")
        .sign_with_keys(&keys)
        .unwrap();
    assert!(validate_prepared_manual(&request).is_err());
}

#[test]
fn manual_workflow_scope_refuses_either_identity_or_relay_change() {
    let scope = ManualWorkflowScope {
        relay_url: "wss://a.test/".into(),
        owner_pubkey: "ab".repeat(32),
    };
    check_manual_scope_values(&scope, "wss://a.test", &scope.owner_pubkey).unwrap();
    assert!(check_manual_scope_values(&scope, "wss://b.test", &scope.owner_pubkey).is_err());
    assert!(check_manual_scope_values(&scope, "wss://a.test", &"cd".repeat(32)).is_err());
}

#[test]
fn manual_workflow_receipt_retains_denial_and_allowance_without_guessing_state() {
    let limits = serde_json::json!({"remaining_workflow":0,"remaining_community":7,"next_eligible_at":null,"server_now":"2026-09-20T00:00:00Z"});
    let decision = serde_json::json!({"accepted":false,"run_id":null,"reason":"workflow_daily_limit","revision":0,"limits":limits});
    let response = serde_json::json!({"accepted":false,"event_id":"event","message":format!("response:{decision}")});
    assert_eq!(manual_receipt(&response, "event").unwrap(), decision);
    assert!(manual_receipt(&response, "different event").is_err());
    let accepted =
        serde_json::json!({"accepted":true,"run_id":WF,"reason":null,"revision":1,"limits":limits});
    let response = serde_json::json!({"accepted":true,"event_id":"event","message":format!("response:{accepted}")});
    let receipt = manual_receipt(&response, "event").unwrap();
    assert_eq!(receipt, accepted);
    assert!(receipt.get("status").is_none());
}

#[tokio::test]
async fn manual_workflow_wait_rechecks_scope_before_any_send() {
    use std::cell::Cell;
    let changed = Cell::new(false);
    let checks = Cell::new(0);
    let scope = ManualWorkflowScope {
        relay_url: "wss://a.test".into(),
        owner_pubkey: "ab".repeat(32),
    };
    let result = wait_for_manual_scope(
        || {
            checks.set(checks.get() + 1);
            check_manual_scope_values(
                &scope,
                if changed.get() {
                    "wss://b.test"
                } else {
                    "wss://a.test"
                },
                &scope.owner_pubkey,
            )
        },
        async {
            changed.set(true);
        },
    )
    .await;
    assert!(result.is_err());
    assert_eq!(checks.get(), 2);
    let waited = Cell::new(false);
    let result = wait_for_manual_scope(|| Err("wrong initial scope".into()), async {
        waited.set(true);
    })
    .await;
    assert!(result.is_err());
    assert!(!waited.get());
}

#[tokio::test(start_paused = true)]
async fn manual_workflow_rate_limit_never_queues_a_later_write() {
    let _serial = crate::relay_admission::TEST_SERIAL.lock().await;
    crate::relay_admission::reset_gate_for_workspace_change();
    manual_write_gate().unwrap();
    crate::relay_admission::activate_rate_limit(Some(300));
    let started = tokio::time::Instant::now();
    assert!(manual_write_gate().is_err());
    assert_eq!(tokio::time::Instant::now(), started);
    crate::relay_admission::reset_gate_for_workspace_change();
    manual_write_gate().unwrap();
}

#[tokio::test(start_paused = true)]
async fn manual_workflow_stalled_response_body_times_out() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0; 2048];
        let bytes_read = socket.read(&mut request).await.unwrap();
        assert!(bytes_read > 0);
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1024\r\nContent-Type: application/json\r\n\r\n{").await.unwrap();
        std::future::pending::<()>().await;
    });
    let response = reqwest::Client::new()
        .get(format!("http://{address}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let started = tokio::time::Instant::now();
    let result = manual_response_with_deadline(async {
        response
            .json::<Value>()
            .await
            .map_err(|error| error.to_string())
    })
    .await;
    assert!(result.unwrap_err().contains("retry the same request"));
    assert_eq!(started.elapsed(), std::time::Duration::from_secs(20));
    server.abort();
}

/// Boundary 9: the real scoped publisher rejects a NIP-49 backup before HTTP I/O.
#[tokio::test]
async fn manual_workflow_egress_blocks_key_backup() {
    let _serial = crate::relay_admission::TEST_SERIAL.lock().await;
    crate::relay_admission::reset_gate_for_workspace_change();
    let state = crate::app_state::build_app_state();
    let scope = ManualWorkflowScope {
        relay_url: "ws://127.0.0.1:9".into(), // No listener: a connection error is not a pass.
        owner_pubkey: state.signing_keys().unwrap().public_key().to_hex(),
    };
    *state.relay_url_override.lock().unwrap() = Some(scope.relay_url.clone());
    // NIP-49 spec vector, including its valid uppercase encoding.
    let backup = "ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p";
    for value in [backup.to_string(), backup.to_ascii_uppercase()] {
        let body = serde_json::to_vec(&serde_json::json!({"content": value})).unwrap();
        let err =
            manual_scoped_request(&state, &scope, reqwest::Method::POST, "/events", Some(body))
                .await
                .unwrap_err();
        assert!(err.contains("key-backup material"), "{err}");
        assert!(err.contains("manual workflow"), "{err}");
    }
}
