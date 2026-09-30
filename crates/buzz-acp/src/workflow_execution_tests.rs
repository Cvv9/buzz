use super::*;

fn fixture() -> (Keys, Keys, Uuid, Task, ExecutionDecision) {
    let relay = Keys::generate();
    let agent = Keys::generate();
    let community = Uuid::new_v4();
    let task_id = Uuid::new_v4();
    let run = Uuid::new_v4();
    let channel = Uuid::new_v4();
    let workflow = Uuid::new_v4();
    let deadline = chrono::Utc::now().timestamp() + 1200;
    let fields = [
        ("p", agent.public_key().to_hex()),
        ("h", channel.to_string()),
        ("workflow-community", community.to_string()),
        ("workflow-protocol", "1".into()),
        ("workflow-origin", "manual".into()),
        ("workflow-task", task_id.to_string()),
        ("workflow-run", run.to_string()),
        ("buzz:workflow", workflow.to_string()),
        ("workflow-step", "report".into()),
        ("workflow-deadline", deadline.to_string()),
        ("workflow-definition", "ab".repeat(32)),
    ];
    let event = EventBuilder::new(Kind::from(46008), "Summarize the available evidence.")
        .tags(
            fields
                .into_iter()
                .map(|(k, v)| Tag::parse([k, &v]).unwrap()),
        )
        .sign_with_keys(&relay)
        .unwrap();
    let task = Task::parse(event, &relay.public_key(), &agent.public_key(), community).unwrap();
    let grant = ExecutionDecision {
        version: 1,
        community_id: community,
        agent_pubkey: agent.public_key().to_hex(),
        instance_id: Uuid::new_v4(),
        run_id: run,
        task_id,
        grant_id: Uuid::new_v4(),
        channel_id: channel,
        ordinal: 1,
        revision: 2,
        deadline,
        decision: DecisionKind::Grant,
    };
    (relay, agent, community, task, grant)
}
fn isolation() -> Isolation {
    Isolation {
        state_dir: "/tmp".into(),
        ordinary_home: "/tmp".into(),
        manual_home: "/tmp".into(),
        manual_workspace: "/tmp".into(),
        broker_gid: 1003,
    }
}
fn plan(failover: bool) -> SpawnPlan {
    SpawnPlan {
        args: vec![],
        env: vec![],
        model: None,
        failover,
    }
}
fn policy() -> FailoverPolicy {
    FailoverPolicy {
        model: Some("azure-foundry".into()),
        triggers: vec!["usage_limit".into(), "internal error".into()],
        ..Default::default()
    }
}

#[test]
fn task_signer_recipient_community_and_duplicate_tags_are_rejected() {
    let (relay, agent, community, task, _) = fixture();
    assert!(Task::parse(
        task.event.clone(),
        &Keys::generate().public_key(),
        &agent.public_key(),
        community
    )
    .is_err());
    assert!(Task::parse(
        task.event.clone(),
        &relay.public_key(),
        &Keys::generate().public_key(),
        community
    )
    .is_err());
    assert!(Task::parse(
        task.event.clone(),
        &relay.public_key(),
        &agent.public_key(),
        Uuid::new_v4()
    )
    .is_err());
    let mut tags = task.event.tags.clone().to_vec();
    tags.push(Tag::parse(["workflow-origin", "scheduled"]).unwrap());
    let duplicate = EventBuilder::new(task.event.kind, &task.event.content)
        .tags(tags)
        .sign_with_keys(&relay)
        .unwrap();
    assert!(Task::parse(
        duplicate,
        &relay.public_key(),
        &agent.public_key(),
        community
    )
    .is_err());
}

#[test]
fn signed_grant_rejects_copy_instance_third_attempt_wrong_task_and_deadline() {
    let (relay, agent, community, task, grant) = fixture();
    let event = buzz_sdk::build_workflow_execution_decision(&grant)
        .unwrap()
        .sign_with_keys(&relay)
        .unwrap();
    let verified =
        verified_decision(&event, &relay.public_key(), community, agent.public_key()).unwrap();
    assert!(validate_grant(
        &verified,
        &task,
        community,
        grant.instance_id,
        agent.public_key()
    )
    .is_ok());
    assert!(validate_grant(
        &verified,
        &task,
        community,
        Uuid::new_v4(),
        agent.public_key()
    )
    .is_err());
    for changed in [
        ExecutionDecision {
            ordinal: 3,
            ..grant.clone()
        },
        ExecutionDecision {
            task_id: Uuid::new_v4(),
            ..grant.clone()
        },
        ExecutionDecision {
            deadline: grant.deadline + 1,
            ..grant.clone()
        },
    ] {
        assert!(validate_grant(
            &changed,
            &task,
            community,
            grant.instance_id,
            agent.public_key()
        )
        .is_err());
    }
    let forged = EventBuilder::new(event.kind, &event.content)
        .tags(event.tags.to_vec())
        .sign_with_keys(&agent)
        .unwrap();
    assert!(
        verified_decision(&forged, &relay.public_key(), community, agent.public_key()).is_err()
    );
}

#[test]
fn signed_decision_requires_matching_tags() {
    let (relay, agent, community, _, grant) = fixture();
    let event = buzz_sdk::build_workflow_execution_decision(&grant)
        .unwrap()
        .sign_with_keys(&relay)
        .unwrap();
    let mut tags = event.tags.to_vec();
    tags.retain(|tag| tag.as_slice()[0] != "workflow-grant");
    tags.push(Tag::parse(["workflow-grant", &Uuid::new_v4().to_string()]).unwrap());
    let forged = EventBuilder::new(event.kind, &event.content)
        .tags(tags)
        .sign_with_keys(&relay)
        .unwrap();
    assert!(
        verified_decision(&forged, &relay.public_key(), community, agent.public_key()).is_err()
    );
}

#[test]
fn protocol_tasks_never_enter_conversation_batching_and_legacy_is_fenced() {
    let (_, _, _, task, _) = fixture();
    assert!(intercepts(&task.event, false));
    assert!(intercepts(&task.event, true));
    let key = Keys::generate();
    let legacy = EventBuilder::new(Kind::from(46008), "old")
        .sign_with_keys(&key)
        .unwrap();
    assert!(!intercepts(&legacy, false));
    assert!(intercepts(&legacy, true));
    let chat = EventBuilder::new(Kind::from(9), "ordinary")
        .sign_with_keys(&key)
        .unwrap();
    assert!(!intercepts(&chat, true));
}

#[test]
fn scoped_mcp_and_nested_config_remove_full_buzz_credentials() {
    let full = Keys::generate();
    let ephemeral = Keys::generate();
    let servers = vec![McpServer {
        name: "reader".into(),
        command: "buzz".into(),
        args: vec![],
        env: vec![
            EnvVar {
                name: "BUZZ_PRIVATE_KEY".into(),
                value: full.secret_key().to_secret_hex(),
            },
            EnvVar {
                name: "BUZZ_AUTH_TAG".into(),
                value: "owner-attestation".into(),
            },
            EnvVar {
                name: "DATABASE_URL".into(),
                value: "private".into(),
            },
        ],
    }];
    let scoped = scoped_mcp(&servers, &ephemeral, &full, true).unwrap();
    assert_eq!(scoped[0].env.len(), 1);
    assert_eq!(
        scoped[0].env[0].value,
        ephemeral.secret_key().to_secret_hex()
    );
    let mut config = serde_json::json!({"mcp_servers":{"nested":{"env":{"BUZZ_PRIVATE_KEY":"secret","REDIS_URL":"private","HOME":"/home/node","SAFE":"yes"}}},"model_provider":"azure-foundry"});
    scrub_nested(&mut config);
    assert_eq!(
        config["mcp_servers"]["nested"]["env"],
        serde_json::json!({"SAFE":"yes"})
    );
    assert_eq!(config["model_provider"], "azure-foundry");
    assert!(reject_full_credentials(
        &format!("token={}", full.secret_key().to_secret_hex()),
        &full
    )
    .is_err());
}

#[tokio::test(start_paused = true)]
async fn queued_absolute_deadline_expires_without_acquiring_worker() {
    let serial = Semaphore::new(0);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(1200);
    let deadline_won =
        tokio::select! {_=wait_deadline(Some(deadline))=>true,_=serial.acquire()=>false};
    assert!(deadline_won);
    assert_eq!(serial.available_permits(), 0);
}

async fn fake(mode: &str) -> AcpClient {
    // Exercise the real JSON-RPC reader/writer and process-group lifecycle.
    let script = r#"while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
case "$line" in
 *'"method":"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n' "$id" ;;
 *'"method":"session/new"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"fake-workflow"}}\n' "$id" ;;
 *'"method":"session/prompt"'*)
  case "$FAKE_MODE" in
   error) printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32603,"message":"usage_limit internal error"}}\n' "$id" ;;
   hang) sleep 60 ;;
   *) printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"fake-workflow","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"usage_limit is quoted evidence, not a failure"}}}}\n'; printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id" ;;
  esac ;;
 *) if test -n "$id"; then printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id"; fi ;;
esac
done"#;
    AcpClient::spawn(
        "/bin/sh",
        &["-c".into(), script.into()],
        &[("FAKE_MODE".into(), mode.into())],
        false,
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn fake_acp_failure_selects_foundry_but_successful_prose_does_not() {
    let (_, _, _, task, _) = fixture();
    let boundary = isolation();
    let mut primary = fake("error").await;
    let error = execute_turn(
        &mut primary,
        &task,
        &boundary,
        TurnSettings {
            mcp: vec![],
            plan: &plan(false),
            revision: None,
            system_prompt: None,
            idle: Duration::from_secs(2),
            deadline: tokio::time::Instant::now() + Duration::from_secs(5),
        },
    )
    .await
    .unwrap_err();
    assert!(matches!(error, AcpError::AgentError { code: -32603, .. }));
    assert!(qualifies_for_fallback(Some(&error), &policy()));
    assert!(primary.shutdown_verified().await);
    let mut fallback = fake("success").await;
    let result = execute_turn(
        &mut fallback,
        &task,
        &boundary,
        TurnSettings {
            mcp: vec![],
            plan: &plan(true),
            revision: None,
            system_prompt: None,
            idle: Duration::from_secs(2),
            deadline: tokio::time::Instant::now() + Duration::from_secs(5),
        },
    )
    .await;
    assert!(matches!(result, Ok(crate::acp::StopReason::EndTurn)));
    assert!(fallback
        .take_captured_agent_message()
        .contains("usage_limit"));
    assert!(!qualifies_for_fallback(result.as_ref().err(), &policy()));
    assert!(fallback.shutdown_verified().await);
}

#[tokio::test]
async fn fake_acp_stalled_turn_is_deadlined_and_group_reaped() {
    let (_, _, _, task, _) = fixture();
    let mut child = fake("hang").await;
    let deadline = tokio::time::Instant::now() + Duration::from_millis(200);
    let result = tokio::time::timeout_at(
        deadline,
        execute_turn(
            &mut child,
            &task,
            &isolation(),
            TurnSettings {
                mcp: vec![],
                plan: &plan(false),
                revision: None,
                system_prompt: None,
                idle: Duration::from_secs(10),
                deadline,
            },
        ),
    )
    .await;
    assert!(result.is_err() || result.unwrap().is_err());
    assert!(child.shutdown_verified().await);
}

#[tokio::test]
async fn cancellation_ignores_old_instance_and_grant_copy() {
    let (_, _, _, _, grant) = fixture();
    let (tx, mut rx) = watch::channel(Some(ExecutionDecision {
        instance_id: Uuid::new_v4(),
        decision: DecisionKind::Cancel,
        ..grant.clone()
    }));
    assert!(
        tokio::time::timeout(Duration::from_millis(10), wait_cancel(&mut rx, &grant))
            .await
            .is_err()
    );
    tx.send(Some(ExecutionDecision {
        decision: DecisionKind::Cancel,
        ..grant.clone()
    }))
    .unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(10), wait_cancel(&mut rx, &grant))
            .await
            .is_ok()
    );
}

#[test]
fn final_result_is_agent_signed_and_correlated_to_exact_grant() {
    let (_, agent, _, task, grant) = fixture();
    let event = result_event(&agent, &task, &grant, "finished").unwrap();
    event.verify().unwrap();
    assert_eq!(event.pubkey, agent.public_key());
    assert_eq!(event.kind.as_u16(), 9);
    assert!(
        buzz_core::workflow_execution::workflow_reply_tags(&event.tags)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        tag(&event, "workflow-grant").unwrap(),
        grant.grant_id.to_string()
    );
    assert_eq!(
        tag(&event, "workflow-instance").unwrap(),
        grant.instance_id.to_string()
    );
    assert_eq!(
        tag(&event, "workflow-result").unwrap(),
        task.event.id.to_hex()
    );
}

#[test]
fn event_workflow_results_preserve_signed_direct_and_nested_reply_markers() {
    let (relay, agent, community, task, grant) = fixture();
    let parent = "a".repeat(64);
    let root = "b".repeat(64);
    for ancestry in [
        vec![Tag::parse(["e", &parent, "", "reply"]).unwrap()],
        vec![
            Tag::parse(["e", &root, "", "root"]).unwrap(),
            Tag::parse(["e", &parent, "", "reply"]).unwrap(),
        ],
    ] {
        let mut tags = task.event.tags.clone().to_vec();
        tags.retain(|tag| tag.as_slice()[0] != "workflow-origin");
        tags.push(Tag::parse(["workflow-origin", "event"]).unwrap());
        tags.extend(ancestry.clone());
        let signed = EventBuilder::new(task.event.kind, &task.event.content)
            .tags(tags)
            .sign_with_keys(&relay)
            .unwrap();
        let parsed =
            Task::parse(signed, &relay.public_key(), &agent.public_key(), community).unwrap();
        let result = result_event(&agent, &parsed, &grant, "Threaded result").unwrap();
        result.verify().unwrap();
        assert_eq!(
            buzz_core::workflow_execution::workflow_reply_tags(&result.tags).unwrap(),
            ancestry
        );
        assert_eq!(
            tag(&result, "workflow-result").unwrap(),
            parsed.event.id.to_hex()
        );
    }
}

#[test]
fn workflow_tasks_reject_ambiguous_malformed_and_untrusted_reply_ancestry() {
    let (relay, agent, community, task, _) = fixture();
    let parent = "a".repeat(64);
    for (origin, ancestry) in [
        (
            "event",
            vec![Tag::parse(["e", "bad", "", "reply"]).unwrap()],
        ),
        (
            "event",
            vec![Tag::parse(["e", &parent, "", "root"]).unwrap()],
        ),
        (
            "event",
            vec![Tag::parse(["e", &parent, "", "reply"]).unwrap(); 2],
        ),
        (
            "manual",
            vec![Tag::parse(["e", &parent, "", "reply"]).unwrap()],
        ),
        (
            "scheduled",
            vec![Tag::parse(["e", &parent, "", "reply"]).unwrap()],
        ),
    ] {
        let mut tags = task.event.tags.clone().to_vec();
        tags.retain(|tag| tag.as_slice()[0] != "workflow-origin");
        tags.push(Tag::parse(["workflow-origin", origin]).unwrap());
        tags.extend(ancestry);
        let signed = EventBuilder::new(task.event.kind, &task.event.content)
            .tags(tags)
            .sign_with_keys(&relay)
            .unwrap();
        assert!(Task::parse(signed, &relay.public_key(), &agent.public_key(), community).is_err());
    }
    let mut tags = task.event.tags.clone().to_vec();
    tags.retain(|tag| tag.as_slice()[0] != "workflow-origin");
    tags.push(Tag::parse(["workflow-origin", "event"]).unwrap());
    tags.push(Tag::parse(["e", &parent, "", "reply"]).unwrap());
    let forged = EventBuilder::new(task.event.kind, &task.event.content)
        .tags(tags)
        .sign_with_keys(&agent)
        .unwrap();
    assert!(Task::parse(forged, &relay.public_key(), &agent.public_key(), community).is_err());
}

async fn receipt_peer(
    responses: Vec<(u16, serde_json::Value)>,
) -> (String, tokio::task::JoinHandle<Vec<Event>>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let peer = tokio::spawn(async move {
        let mut events = vec![];
        for (status, response) in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut data = vec![];
            let mut buffer = [0u8; 4096];
            let header_end = loop {
                let n = stream.read(&mut buffer).await.unwrap();
                assert!(n > 0);
                data.extend_from_slice(&buffer[..n]);
                if let Some(end) = data.windows(4).position(|v| v == b"\r\n\r\n") {
                    break end + 4;
                }
            };
            let length = String::from_utf8_lossy(&data[..header_end])
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse::<usize>().unwrap())
                })
                .unwrap();
            while data.len() < header_end + length {
                let n = stream.read(&mut buffer).await.unwrap();
                assert!(n > 0);
                data.extend_from_slice(&buffer[..n]);
            }
            events.push(
                serde_json::from_slice::<Event>(&data[header_end..header_end + length]).unwrap(),
            );
            let body = response.to_string();
            let wire=format!("HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
            stream.write_all(wire.as_bytes()).await.unwrap();
        }
        events
    });
    (url, peer)
}

fn receipt_runtime(url: String, successful_result: bool) -> (Runtime, Uuid, std::path::PathBuf) {
    let (relay, agent, community, task, grant) = fixture();
    let directory = std::env::temp_dir().join(format!("buzz-receipts-{}", Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    let mut journal = Journal::open(&directory).unwrap();
    let result = successful_result.then(|| result_event(&agent, &task, &grant, "OK").unwrap());
    let operation = if let Some(result) = &result {
        ExecutionOperation::Finished {
            run_id: task.run,
            task_id: task.id,
            channel_id: task.channel,
            grant_id: grant.grant_id,
            ordinal: grant.ordinal,
            result_event_id: result.id.to_hex(),
        }
    } else {
        stop_operation(&grant, StopReason::ExecutionFailed)
    };
    let control = ExecutionControl {
        version: 1,
        community_id: community,
        agent_pubkey: agent.public_key().to_hex(),
        instance_id: grant.instance_id,
        operation,
    };
    let receipt = buzz_sdk::build_workflow_execution_control(&control)
        .unwrap()
        .sign_with_keys(&agent)
        .unwrap();
    journal.tasks.insert(
        task.id,
        TaskRecord {
            event: task.event,
            attempts: vec![Attempt {
                claim: receipt.clone(),
                grant: Some(grant.clone()),
                phase: Phase::Stopped,
                process: None,
                result,
                pending_receipt: Some(receipt),
            }],
            terminal: false,
            fallback: true,
        },
    );
    journal.save().unwrap();
    let (_, revisions) = watch::channel(None);
    let (stop, _) = watch::channel(false);
    (
        Runtime {
            isolation: isolation(),
            rest: RestClient {
                http: reqwest::Client::new(),
                base_url: url,
                keys: agent.clone(),
                auth_tag_json: None,
            },
            keys: agent,
            relay: relay.public_key(),
            community,
            instance: grant.instance_id,
            command: "unused".into(),
            primary: plan(false),
            fallback: plan(true),
            policy: policy(),
            mcp: vec![],
            relay_url: "unused".into(),
            idle: Duration::from_secs(1),
            system_prompt: None,
            max_turn: 60,
            journal: Mutex::new(journal),
            serial: Semaphore::new(1),
            busy: Arc::new(AtomicUsize::new(0)),
            stalled: AtomicBool::new(false),
            revisions,
            requires_revision: false,
            stop,
        },
        task.id,
        directory,
    )
}

#[tokio::test]
async fn rejected_result_still_acknowledges_exact_verified_stop() {
    let (url, peer) = receipt_peer(vec![
        (403, serde_json::json!({"error":"forbidden"})),
        (200, serde_json::json!({"accepted":true})),
    ])
    .await;
    let (runtime, id, path) = receipt_runtime(url, true);
    runtime.retry_receipts().await.unwrap();
    let events = peer.await.unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].kind.as_u16(), 9);
    let stopped: ExecutionControl = serde_json::from_str(&events[1].content).unwrap();
    assert!(matches!(
        stopped.operation,
        ExecutionOperation::Stopped { .. }
    ));
    let journal = runtime.journal.lock().await;
    assert_eq!(journal.tasks[&id].attempts[0].phase, Phase::Done);
    assert!(journal.tasks[&id].terminal);
    assert!(journal.tasks[&id].attempts[0].result.is_none());
    drop(journal);
    drop(runtime);
    std::fs::remove_dir_all(path).unwrap();
}

#[tokio::test]
async fn transient_stopped_receipt_reconnect_releases_retry_without_new_budget() {
    let (url, peer) = receipt_peer(vec![
        (503, serde_json::json!({"error":"unavailable"})),
        (200, serde_json::json!({"accepted":true})),
    ])
    .await;
    let (runtime, id, path) = receipt_runtime(url, false);
    runtime.retry_receipts().await.unwrap();
    {
        let journal = runtime.journal.lock().await;
        assert!(!journal.tasks[&id].can_claim(true));
        assert_eq!(journal.tasks[&id].attempts.len(), 1);
    }
    runtime.retry_receipts().await.unwrap();
    {
        let journal = runtime.journal.lock().await;
        assert!(journal.tasks[&id].can_claim(true));
        assert_eq!(journal.tasks[&id].attempts.len(), 1);
        assert!(journal.tasks[&id].fallback);
    }
    let events = peer.await.unwrap();
    let controls: Vec<ExecutionControl> = events
        .iter()
        .map(|e| serde_json::from_str(&e.content).unwrap())
        .collect();
    assert_eq!(
        serde_json::to_value(&controls[0].operation).unwrap(),
        serde_json::to_value(&controls[1].operation).unwrap()
    );
    drop(runtime);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn fresh_event_and_scheduled_envelopes_keep_ordinary_duration_and_retry_budget() {
    let (relay, agent, community, task, grant) = fixture();
    for origin in ["scheduled", "event"] {
        let mut tags = task.event.tags.clone().to_vec();
        tags.retain(|tag| {
            !matches!(
                tag.as_slice()[0].as_str(),
                "workflow-origin" | "workflow-deadline"
            )
        });
        tags.push(Tag::parse(["workflow-origin", origin]).unwrap());
        let event = EventBuilder::new(task.event.kind, &task.event.content)
            .tags(tags)
            .sign_with_keys(&relay)
            .unwrap();
        let ordinary =
            Task::parse(event, &relay.public_key(), &agent.public_key(), community).unwrap();
        assert!(ordinary.deadline.is_none());
        assert!(!ordinary.expired());
        let third = ExecutionDecision {
            ordinal: 3,
            deadline: chrono::Utc::now().timestamp() + 7800,
            ..grant.clone()
        };
        assert!(validate_grant(
            &third,
            &ordinary,
            community,
            third.instance_id,
            agent.public_key()
        )
        .is_ok());
    }
}

#[tokio::test]
async fn rejected_finished_control_falls_back_to_verified_stop() {
    let (url, peer) = receipt_peer(vec![
        (200, serde_json::json!({"accepted":true})),
        (
            200,
            serde_json::json!({"accepted":false,"reason":"permission_revoked"}),
        ),
        (200, serde_json::json!({"accepted":true})),
    ])
    .await;
    let (runtime, id, path) = receipt_runtime(url, true);
    runtime.retry_receipts().await.unwrap();
    let events = peer.await.unwrap();
    assert_eq!(events.len(), 3);
    let control: ExecutionControl = serde_json::from_str(&events[2].content).unwrap();
    assert!(matches!(
        control.operation,
        ExecutionOperation::Stopped { .. }
    ));
    {
        let journal = runtime.journal.lock().await;
        assert_eq!(journal.tasks[&id].attempts[0].phase, Phase::Done);
        assert!(journal.tasks[&id].terminal);
    }
    drop(runtime);
    std::fs::remove_dir_all(path).unwrap();
}

async fn claim_crash_runtime(
    expired: bool,
) -> (
    Runtime,
    Uuid,
    std::path::PathBuf,
    Event,
    ExecutionDecision,
    Keys,
) {
    let (mut runtime, id, path) = receipt_runtime("http://unused".into(), false);
    let relay = Keys::generate();
    runtime.relay = relay.public_key();
    let claim;
    let mut grant;
    {
        let mut journal = runtime.journal.lock().await;
        let record = journal.tasks.get_mut(&id).unwrap();
        grant = record.attempts[0].grant.take().unwrap();
        if expired {
            grant.deadline = chrono::Utc::now().timestamp() - 10;
        }
        let mut tags = record.event.tags.clone().to_vec();
        tags.retain(|tag| tag.as_slice()[0] != "workflow-deadline");
        tags.push(Tag::parse(["workflow-deadline", &grant.deadline.to_string()]).unwrap());
        record.event = EventBuilder::new(record.event.kind, &record.event.content)
            .tags(tags)
            .sign_with_keys(&relay)
            .unwrap();
        let control = ExecutionControl {
            version: 1,
            community_id: runtime.community,
            agent_pubkey: runtime.keys.public_key().to_hex(),
            instance_id: grant.instance_id,
            operation: ExecutionOperation::Claim {
                run_id: grant.run_id,
                task_id: grant.task_id,
                channel_id: grant.channel_id,
                revision: 1,
                ephemeral_pubkey: Keys::generate().public_key().to_hex(),
            },
        };
        claim = buzz_sdk::build_workflow_execution_control(&control)
            .unwrap()
            .custom_created_at(nostr::Timestamp::from(
                (chrono::Utc::now().timestamp() - 300) as u64,
            ))
            .sign_with_keys(&runtime.keys)
            .unwrap();
        let attempt = &mut record.attempts[0];
        attempt.claim = claim.clone();
        attempt.phase = Phase::Claiming;
        attempt.pending_receipt = None;
        journal.save().unwrap();
    }
    runtime.instance = Uuid::new_v4();
    (runtime, id, path, claim, grant, relay)
}
fn recovered_receipt(grant: &ExecutionDecision, relay: &Keys) -> serde_json::Value {
    let event = buzz_sdk::build_workflow_execution_decision(grant)
        .unwrap()
        .sign_with_keys(relay)
        .unwrap();
    serde_json::json!({"accepted":true,"decision":grant,"signed_event":event})
}
fn assert_recovery_request(event: &Event, claim: &Event, old_instance: Uuid) {
    event.verify().unwrap();
    assert!(event.created_at.as_secs() > claim.created_at.as_secs());
    let control: ExecutionControl = serde_json::from_str(&event.content).unwrap();
    assert_eq!(control.instance_id, old_instance);
    let ExecutionOperation::RecoverClaim { signed_claim } = control.operation else {
        panic!("recovery must not replay ordinary Claim")
    };
    assert_eq!(signed_claim.id, claim.id);
    assert_eq!(signed_claim.sig, claim.sig);
}

#[tokio::test]
async fn grantless_claim_recovery_fetches_old_expired_grant_only_to_acknowledge_no_spawn() {
    let (mut runtime, id, path, claim, grant, relay) = claim_crash_runtime(true).await;
    let (url, peer) = receipt_peer(vec![
        (200, recovered_receipt(&grant, &relay)),
        (200, serde_json::json!({"accepted":true})),
    ])
    .await;
    runtime.rest.base_url = url;
    runtime.recover().await.unwrap();
    let requests = peer.await.unwrap();
    assert_eq!(requests.len(), 2);
    assert_recovery_request(&requests[0], &claim, grant.instance_id);
    let stopped: ExecutionControl = serde_json::from_str(&requests[1].content).unwrap();
    assert!(
        matches!(stopped.operation,ExecutionOperation::Stopped{grant_id,reason:StopReason::RecoveryStopped,..} if grant_id==grant.grant_id)
    );
    assert!(!runtime.recovery_pending().await);
    assert!(!runtime.stalled.load(Ordering::SeqCst));
    {
        let journal = runtime.journal.lock().await;
        let record = &journal.tasks[&id];
        assert!(record.terminal);
        assert!(!record.can_claim(true));
        assert_eq!(record.attempts.len(), 1);
        assert_eq!(record.attempts[0].phase, Phase::Done);
        assert_eq!(
            record.attempts[0].grant.as_ref().unwrap().grant_id,
            grant.grant_id
        );
        assert!(record.attempts[0].process.is_none());
    }
    drop(runtime);
    std::fs::remove_dir_all(path).unwrap();
}

#[tokio::test]
async fn grantless_claim_recovery_no_grant_tombstone_ends_task_without_allocating() {
    let (mut runtime, id, path, claim, grant, _) = claim_crash_runtime(false).await;
    let (url,peer)=receipt_peer(vec![(200,serde_json::json!({"accepted":true,"reason":"no_grant","decision":null,"signed_event":null}))]).await;
    runtime.rest.base_url = url;
    runtime.recover().await.unwrap();
    let requests = peer.await.unwrap();
    assert_eq!(requests.len(), 1);
    assert_recovery_request(&requests[0], &claim, grant.instance_id);
    assert!(!runtime.recovery_pending().await);
    {
        let journal = runtime.journal.lock().await;
        let record = &journal.tasks[&id];
        assert!(record.terminal);
        assert_eq!(record.attempts[0].phase, Phase::Done);
        assert!(record.attempts[0].grant.is_none());
        assert!(record.attempts[0].pending_receipt.is_none());
    }
    drop(runtime);
    std::fs::remove_dir_all(path).unwrap();
}

#[tokio::test]
async fn grantless_claim_recovery_retries_after_transport_failure_without_permanent_stall() {
    let (mut runtime, id, path, claim, grant, relay) = claim_crash_runtime(false).await;
    let (url, peer) = receipt_peer(vec![
        (503, serde_json::json!({"error":"offline"})),
        (200, recovered_receipt(&grant, &relay)),
        (200, serde_json::json!({"accepted":true})),
    ])
    .await;
    runtime.rest.base_url = url;
    runtime.recover().await.unwrap();
    assert!(runtime.recovery_pending().await);
    assert!(!runtime.stalled.load(Ordering::SeqCst));
    {
        let journal = runtime.journal.lock().await;
        assert_eq!(journal.tasks[&id].attempts[0].phase, Phase::RecoveringClaim);
        assert!(!journal.tasks[&id].can_claim(true));
    }
    runtime.retry_claim_recovery().await.unwrap();
    assert!(
        runtime.recovery_pending().await,
        "stop acknowledgement still required"
    );
    runtime.retry_receipts().await.unwrap();
    assert!(!runtime.recovery_pending().await);
    let requests = peer.await.unwrap();
    assert_eq!(requests.len(), 3);
    assert_recovery_request(&requests[0], &claim, grant.instance_id);
    assert_recovery_request(&requests[1], &claim, grant.instance_id);
    {
        let journal = runtime.journal.lock().await;
        assert_eq!(journal.tasks[&id].attempts.len(), 1);
        assert_eq!(journal.tasks[&id].attempts[0].phase, Phase::Done);
    }
    drop(runtime);
    std::fs::remove_dir_all(path).unwrap();
}

#[tokio::test]
async fn grantless_claim_recovery_rejects_mismatched_signed_receipt() {
    let (mut runtime, id, path, _, grant, relay) = claim_crash_runtime(false).await;
    let mismatched = ExecutionDecision {
        instance_id: Uuid::new_v4(),
        ..grant
    };
    let (url, peer) = receipt_peer(vec![(200, recovered_receipt(&mismatched, &relay))]).await;
    runtime.rest.base_url = url;
    runtime.recover().await.unwrap();
    peer.await.unwrap();
    assert!(runtime.recovery_pending().await);
    {
        let journal = runtime.journal.lock().await;
        assert_eq!(journal.tasks[&id].attempts[0].phase, Phase::RecoveringClaim);
        assert!(journal.tasks[&id].attempts[0].grant.is_none());
    }
    drop(runtime);
    std::fs::remove_dir_all(path).unwrap();
}
