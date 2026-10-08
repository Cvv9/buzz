//! Isolated relay + CLI transport proof. No provider or real ACP is connected.
//! Requires explicit DATABASE_URL, RELAY_URL and BUZZ_TEST_CLI.
use base64::{engine::general_purpose::STANDARD, Engine};
use buzz_core::{
    channel::{ChannelType, ChannelVisibility, MemberRole},
    workflow_execution::*,
    CommunityId,
};
use buzz_test_client::BuzzTestClient;
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use uuid::Uuid;

fn auth(keys: &Keys, url: &str, method: &str, body: &str) -> String {
    let event = EventBuilder::new(Kind::Custom(27235), "")
        .tags([
            Tag::parse(["u", url]).unwrap(),
            Tag::parse(["method", method]).unwrap(),
            Tag::parse(["payload", &hex::encode(Sha256::digest(body.as_bytes()))]).unwrap(),
            Tag::parse(["nonce", &Uuid::new_v4().to_string()]).unwrap(),
        ])
        .sign_with_keys(keys)
        .unwrap();
    format!(
        "Nostr {}",
        STANDARD.encode(serde_json::to_vec(&event).unwrap())
    )
}
async fn request(base: &str, path: &str, keys: &Keys, body: &Value) -> reqwest::Response {
    let url = format!("{base}{path}");
    let text = body.to_string();
    let parsed = url::Url::parse(&url).unwrap();
    let host = parsed.host_str().unwrap();
    let client = if host.ends_with(".manual.test") {
        // Each recovery fixture gets its own quota namespace, still pinned to
        // loopback regardless of DNS/proxy configuration.
        reqwest::Client::builder()
            .no_proxy()
            .resolve(
                host,
                std::net::SocketAddr::from(([127, 0, 0, 1], parsed.port().unwrap())),
            )
            .build()
            .unwrap()
    } else {
        reqwest::Client::new()
    };
    client
        .post(&url)
        .header("authorization", auth(keys, &url, "POST", &text))
        .body(text)
        .send()
        .await
        .unwrap()
}
async fn submit(base: &str, keys: &Keys, event: &Event) -> Value {
    let response = request(base, "/events", keys, &serde_json::to_value(event).unwrap()).await;
    let status = response.status();
    let text = response.text().await.unwrap();
    assert!(status.is_success(), "{status}: {text}");
    serde_json::from_str(&text).unwrap()
}
async fn operation(
    base: &str,
    agent: &Keys,
    community: CommunityId,
    instance: Uuid,
    operation: ExecutionOperation,
) -> Value {
    let control = ExecutionControl {
        version: 1,
        community_id: *community.as_uuid(),
        agent_pubkey: agent.public_key().to_hex(),
        instance_id: instance,
        operation,
    };
    let event = buzz_sdk::build_workflow_execution_control(&control)
        .unwrap()
        .sign_with_keys(agent)
        .unwrap();
    let receipt = submit(base, agent, &event).await;
    serde_json::from_str(
        receipt["message"]
            .as_str()
            .unwrap()
            .strip_prefix("response:")
            .unwrap(),
    )
    .unwrap()
}
#[tokio::test]
#[ignore = "requires explicit isolated relay, Postgres, Redis and built CLI"]
async fn e2e_workflow_manual_scoped_cli_ws_and_completion() {
    let relay = std::env::var("RELAY_URL").expect("explicit isolated RELAY_URL");
    let base = relay
        .replace("ws://", "http://")
        .trim_end_matches('/')
        .to_string();
    assert!(
        base.starts_with("http://127.0.0.1:"),
        "never run against a production relay"
    );
    let host = {
        let parsed = url::Url::parse(&base).unwrap();
        format!("{}:{}", parsed.host_str().unwrap(), parsed.port().unwrap())
    };
    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("isolated DB"))
        .await
        .unwrap();
    let db = buzz_db::Db::from_pool(pool.clone());
    let owner = Keys::generate();
    let agent = Keys::generate();
    let instance = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO communities(id,host) VALUES($1,$2) ON CONFLICT(lower(host)) DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(&host)
    .execute(&pool)
    .await
    .unwrap();
    let community = db
        .lookup_community_by_host(&host)
        .await
        .unwrap()
        .unwrap()
        .id;
    db.add_relay_member(community, &owner.public_key().to_hex(), "owner", None)
        .await
        .unwrap();
    db.ensure_user(community, owner.public_key().as_bytes())
        .await
        .unwrap();
    db.ensure_user(community, agent.public_key().as_bytes())
        .await
        .unwrap();
    db.add_relay_member(community, &agent.public_key().to_hex(), "member", None)
        .await
        .unwrap();
    db.set_agent_owner(
        community,
        agent.public_key().as_bytes(),
        owner.public_key().as_bytes(),
    )
    .await
    .unwrap();
    let channel = db
        .create_channel(
            community,
            &format!("manual-e2e-{}", Uuid::new_v4()),
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            owner.public_key().as_bytes(),
            None,
        )
        .await
        .unwrap();
    db.add_member(
        community,
        channel.id,
        agent.public_key().as_bytes(),
        MemberRole::Bot,
        Some(owner.public_key().as_bytes()),
    )
    .await
    .unwrap();
    // These relay-signed metadata fixtures exercise the real CLI's #p then #d queries.
    let relay_keys = Keys::parse(&format!("{:064x}", 1)).unwrap();
    for (kind, tags) in [
        (
            39000,
            vec![
                Tag::parse(["d", &channel.id.to_string()]).unwrap(),
                Tag::parse(["name", &channel.name]).unwrap(),
            ],
        ),
        (
            39002,
            vec![
                Tag::parse(["d", &channel.id.to_string()]).unwrap(),
                Tag::parse(["p", &agent.public_key().to_hex()]).unwrap(),
            ],
        ),
    ] {
        let event = EventBuilder::new(Kind::Custom(kind), "")
            .tags(tags)
            .sign_with_keys(&relay_keys)
            .unwrap();
        db.insert_event_with_thread_metadata(community, &event, None, None)
            .await
            .unwrap();
    }
    let info: Value = reqwest::Client::new()
        .get(&base)
        .header("accept", "application/nostr+json")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let relay_pubkey = info["self"].as_str().unwrap();
    assert_eq!(relay_pubkey, relay_keys.public_key().to_hex());
    let capability = operation(
        &base,
        &agent,
        community,
        instance,
        ExecutionOperation::Capability {
            runtime_profile: "linux-uids-v1".into(),
            max_turn_duration_secs: 7200,
        },
    )
    .await;
    assert_eq!(capability["accepted"], true);
    let source = EventBuilder::new(
        Kind::Custom(9),
        "Fixture source visible only in assigned channel",
    )
    .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
    .sign_with_keys(&owner)
    .unwrap();
    assert_eq!(submit(&base, &owner, &source).await["accepted"], true);
    let workflow = Uuid::new_v4();
    let definition=json!({"name":"Isolated manual E2E","enabled":true,"trigger":{"on":"schedule","cron":"0 0 1 1 *"},"steps":[{"id":"brief","action":"send_message","text":"Read the assigned channel and produce the fixture brief.","agent_targets":[agent.public_key().to_hex()]}]}).to_string();
    db.upsert_workflow(
        community,
        workflow,
        Some(channel.id),
        owner.public_key().as_bytes(),
        "Isolated manual E2E",
        &definition,
        &Sha256::digest(definition.as_bytes()),
    )
    .await
    .unwrap();
    let trigger = buzz_sdk::build_workflow_manual_trigger(workflow, None, &serde_json::Map::new())
        .unwrap()
        .sign_with_keys(&owner)
        .unwrap();
    let accepted = submit(&base, &owner, &trigger).await;
    assert_eq!(accepted["accepted"], true);
    let admitted: Value = serde_json::from_str(
        accepted["message"]
            .as_str()
            .unwrap()
            .strip_prefix("response:")
            .unwrap(),
    )
    .unwrap();
    let run = Uuid::parse_str(admitted["run_id"].as_str().unwrap()).unwrap();
    let task: Uuid = sqlx::query_scalar(
        "SELECT task_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2",
    )
    .bind(community.as_uuid())
    .bind(run)
    .fetch_one(&pool)
    .await
    .unwrap();
    let ephemeral = Keys::generate();
    let receipt = operation(
        &base,
        &agent,
        community,
        instance,
        ExecutionOperation::Claim {
            run_id: run,
            task_id: task,
            channel_id: channel.id,
            revision: 1,
            ephemeral_pubkey: ephemeral.public_key().to_hex(),
        },
    )
    .await;
    assert_eq!(receipt["accepted"], true, "{receipt}");
    let grant: ExecutionDecision = serde_json::from_value(receipt["decision"].clone()).unwrap();
    let signed: Event = serde_json::from_value(receipt["signed_event"].clone()).unwrap();
    assert!(signed.verify().is_ok());
    assert_eq!(signed.pubkey.to_hex(), relay_pubkey);
    assert_eq!(
        operation(
            &base,
            &agent,
            community,
            instance,
            ExecutionOperation::Started {
                grant_id: grant.grant_id,
                run_id: run,
                task_id: task,
                channel_id: channel.id,
                ordinal: grant.ordinal
            }
        )
        .await["accepted"],
        true
    );
    let cli = std::env::var("BUZZ_TEST_CLI").expect("path to built isolated buzz CLI");
    let output = tokio::process::Command::new(&cli)
        .args(["--format", "compact", "channels", "list", "--member"])
        .env("BUZZ_RELAY_URL", &relay)
        .env("BUZZ_PRIVATE_KEY", ephemeral.secret_key().to_secret_hex())
        .env_remove("BUZZ_AUTH_TAG")
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stdout).contains(&channel.id.to_string()),
        "CLI lost destination: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    let messages = tokio::process::Command::new(&cli)
        .args([
            "--format",
            "compact",
            "messages",
            "get",
            "--channel",
            &channel.id.to_string(),
            "--kinds",
            "9",
        ])
        .env("BUZZ_RELAY_URL", &relay)
        .env("BUZZ_PRIVATE_KEY", ephemeral.secret_key().to_secret_hex())
        .env_remove("BUZZ_AUTH_TAG")
        .output()
        .await
        .unwrap();
    assert!(
        messages.status.success(),
        "{}",
        String::from_utf8_lossy(&messages.stderr)
    );
    assert!(String::from_utf8_lossy(&messages.stdout).contains("Fixture source visible"));
    let materialized: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE community_id=$1 AND pubkey=$2)",
    )
    .bind(community.as_uuid())
    .bind(ephemeral.public_key().as_bytes().as_slice())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!materialized, "child must not acquire ordinary membership");
    let denied = request(
        &base,
        "/query",
        &ephemeral,
        &json!([{"kinds":[9],"#h":[Uuid::new_v4()]}]),
    )
    .await;
    assert_eq!(denied.status(), 403);
    let write = EventBuilder::new(Kind::Custom(9), "must not publish")
        .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
        .sign_with_keys(&ephemeral)
        .unwrap();
    assert_eq!(
        request(
            &base,
            "/events",
            &ephemeral,
            &serde_json::to_value(&write).unwrap()
        )
        .await
        .status(),
        403
    );
    let mut ws = BuzzTestClient::connect(&relay, &ephemeral).await.unwrap();
    assert!(!ws.send_event(write).await.unwrap().accepted);
    ws.subscribe(
        "scope",
        vec![serde_json::from_value(json!({"kinds":[39000],"#d":[channel.id]})).unwrap()],
    )
    .await
    .unwrap();
    let metadata = ws
        .collect_until_eose("scope", Duration::from_secs(5))
        .await
        .unwrap();
    assert_eq!(metadata.len(), 1);
    let downstream = Uuid::new_v4();
    let definition="name: Chain suppression fixture\ntrigger:\n  on: message_posted\nsteps:\n  - id: announce\n    action: send_message\n    text: Downstream fixture announcement\n";
    let event = buzz_sdk::build_workflow_def(channel.id, downstream, definition)
        .unwrap()
        .sign_with_keys(&owner)
        .unwrap();
    assert_eq!(submit(&base, &owner, &event).await["accepted"], true);
    let task_event_id:Vec<u8>=sqlx::query_scalar("SELECT task_event_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND task_id=$3").bind(community.as_uuid()).bind(run).bind(task).fetch_one(&pool).await.unwrap();
    let result = EventBuilder::new(Kind::Custom(9), "Isolated complete result")
        .tags([
            Tag::parse(["h", &channel.id.to_string()]).unwrap(),
            Tag::parse(["workflow-result", &hex::encode(task_event_id)]).unwrap(),
            Tag::parse(["workflow-origin", "manual"]).unwrap(),
            Tag::parse(["workflow-run", &run.to_string()]).unwrap(),
            Tag::parse(["workflow-task", &task.to_string()]).unwrap(),
            Tag::parse(["workflow-grant", &grant.grant_id.to_string()]).unwrap(),
            Tag::parse(["workflow-instance", &instance.to_string()]).unwrap(),
            Tag::parse(["workflow-ordinal", &grant.ordinal.to_string()]).unwrap(),
        ])
        .sign_with_keys(&agent)
        .unwrap();
    assert_eq!(submit(&base, &agent, &result).await["accepted"], true);
    assert_eq!(
        operation(
            &base,
            &agent,
            community,
            instance,
            ExecutionOperation::Finished {
                grant_id: grant.grant_id,
                run_id: run,
                task_id: task,
                channel_id: channel.id,
                ordinal: grant.ordinal,
                result_event_id: result.id.to_hex()
            }
        )
        .await["accepted"],
        true
    );
    assert_eq!(
        db.workflow_actual_run(community, run).await.unwrap()["execution_state"],
        "completed"
    );
    assert_eq!(
        request(
            &base,
            "/query",
            &ephemeral,
            &json!([{"kinds":[9],"#h":[channel.id]}])
        )
        .await
        .status(),
        403
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    let chained: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workflow_runs WHERE community_id=$1 AND workflow_id=$2",
    )
    .bind(community.as_uuid())
    .bind(downstream)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(chained, 0, "manual result started an automated workflow");
    let normal = EventBuilder::new(
        Kind::Custom(9),
        "Normal conversation still triggers ordinary workflow",
    )
    .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
    .sign_with_keys(&owner)
    .unwrap();
    assert_eq!(submit(&base, &owner, &normal).await["accepted"], true);
    let mut ordinary = 0;
    for _ in 0..50 {
        ordinary = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM workflow_runs WHERE community_id=$1 AND workflow_id=$2",
        )
        .bind(community.as_uuid())
        .bind(downstream)
        .fetch_one(&pool)
        .await
        .unwrap();
        if ordinary > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(
        ordinary, 1,
        "normal conversation positive control did not trigger"
    );
}

#[tokio::test]
#[ignore = "requires explicit membership-enforced isolated relay, Postgres and Redis"]
async fn e2e_workflow_recover_claim_after_revocation_is_receipt_only() {
    let relay = std::env::var("RELAY_URL").expect("explicit isolated RELAY_URL");
    let base = relay
        .replace("ws://", "http://")
        .trim_end_matches('/')
        .to_string();
    let parsed = url::Url::parse(&base).unwrap();
    assert_eq!(parsed.host_str(), Some("127.0.0.1"));
    assert_eq!(parsed.port(), Some(55341), "isolated QA relay only");
    let database = std::env::var("DATABASE_URL").expect("isolated DB");
    let db_url = url::Url::parse(&database).unwrap();
    assert_eq!(db_url.host_str(), Some("127.0.0.1"));
    assert_eq!(db_url.port(), Some(55441));
    assert!(db_url.path().starts_with("/buzz_manual_tests_v"));
    let pool = sqlx::PgPool::connect(&database).await.unwrap();
    let db = buzz_db::Db::from_pool(pool.clone());
    let host = format!(
        "recovery-{}.manual.test:{}",
        Uuid::new_v4(),
        parsed.port().unwrap()
    );
    let base = format!("http://{host}");
    sqlx::query(
        "INSERT INTO communities(id,host) VALUES($1,$2) ON CONFLICT(lower(host)) DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(&host)
    .execute(&pool)
    .await
    .unwrap();
    let community = db
        .lookup_community_by_host(&host)
        .await
        .unwrap()
        .unwrap()
        .id;
    let owner = Keys::generate();
    let agent = Keys::generate();
    for (identity, role) in [(&owner, "owner"), (&agent, "member")] {
        db.add_relay_member(community, &identity.public_key().to_hex(), role, None)
            .await
            .unwrap();
        db.ensure_user(community, identity.public_key().as_bytes())
            .await
            .unwrap();
    }
    db.set_agent_owner(
        community,
        agent.public_key().as_bytes(),
        owner.public_key().as_bytes(),
    )
    .await
    .unwrap();
    let channel = db
        .create_channel(
            community,
            &format!("recovery-{}", Uuid::new_v4()),
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            owner.public_key().as_bytes(),
            None,
        )
        .await
        .unwrap();
    db.add_member(
        community,
        channel.id,
        agent.public_key().as_bytes(),
        MemberRole::Bot,
        Some(owner.public_key().as_bytes()),
    )
    .await
    .unwrap();
    let instance = Uuid::new_v4();
    assert_eq!(
        operation(
            &base,
            &agent,
            community,
            instance,
            ExecutionOperation::Capability {
                runtime_profile: "linux-uids-v1".into(),
                max_turn_duration_secs: 7200,
            }
        )
        .await["accepted"],
        true
    );
    let workflow = Uuid::new_v4();
    let definition = json!({"name":"Recovery HTTP fixture","enabled":true,"trigger":{"on":"schedule","cron":"0 0 1 1 *"},"steps":[{"id":"brief","action":"send_message","text":"Recovery fixture only","agent_targets":[agent.public_key().to_hex()]}]}).to_string();
    db.upsert_workflow(
        community,
        workflow,
        Some(channel.id),
        owner.public_key().as_bytes(),
        "Recovery HTTP fixture",
        &definition,
        &Sha256::digest(definition.as_bytes()),
    )
    .await
    .unwrap();
    let trigger = buzz_sdk::build_workflow_manual_trigger(workflow, None, &serde_json::Map::new())
        .unwrap()
        .sign_with_keys(&owner)
        .unwrap();
    let admission = submit(&base, &owner, &trigger).await;
    let admission: Value = serde_json::from_str(
        admission["message"]
            .as_str()
            .unwrap()
            .strip_prefix("response:")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(admission["accepted"], true, "{admission}");
    let run = Uuid::parse_str(admission["run_id"].as_str().unwrap()).unwrap();
    let task: Uuid = sqlx::query_scalar(
        "SELECT task_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2",
    )
    .bind(community.as_uuid())
    .bind(run)
    .fetch_one(&pool)
    .await
    .unwrap();
    let claim = ExecutionControl {
        version: 1,
        community_id: *community.as_uuid(),
        agent_pubkey: agent.public_key().to_hex(),
        instance_id: instance,
        operation: ExecutionOperation::Claim {
            run_id: run,
            task_id: task,
            channel_id: channel.id,
            revision: 1,
            ephemeral_pubkey: Keys::generate().public_key().to_hex(),
        },
    };
    // Seed historical durable receipt through the real transaction, avoiding a
    // two-minute sleep. Only the embedded original Claim is older than 90 seconds.
    let saved_claim = buzz_sdk::build_workflow_execution_control(&claim)
        .unwrap()
        .custom_created_at(nostr::Timestamp::from(
            nostr::Timestamp::now().as_secs() - 120,
        ))
        .sign_with_keys(&agent)
        .unwrap();
    let relay_keys = Keys::parse(&format!("{:064x}", 1)).unwrap();
    let original = db
        .workflow_execution_control(community, &saved_claim, &claim, &relay_keys)
        .await
        .unwrap();
    assert!(original.accepted);
    let grant = original.decision.clone().unwrap();
    let signed_grant = original.signed_event.clone().unwrap();
    assert!(saved_claim.created_at.as_secs() + 90 < nostr::Timestamp::now().as_secs());

    sqlx::query("DELETE FROM relay_members WHERE community_id=$1 AND pubkey=$2")
        .bind(community.as_uuid())
        .bind(agent.public_key().to_hex())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE channel_members SET removed_at=NOW() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3")
        .bind(community.as_uuid()).bind(channel.id).bind(agent.public_key().as_bytes().as_slice()).execute(&pool).await.unwrap();
    sqlx::query("UPDATE workflow_run_attempts SET deadline_at=NOW()-interval '1 second' WHERE community_id=$1 AND run_id=$2")
        .bind(community.as_uuid()).bind(run).execute(&pool).await.unwrap();
    db.workflow_execution_sweep(&relay_keys).await.unwrap();
    assert_eq!(
        db.workflow_actual_run(community, run).await.unwrap()["execution_state"],
        "stalled"
    );

    // Neither the old claim nor an unrelated write is admitted after revocation.
    let write = EventBuilder::new(Kind::Custom(9), "must be denied")
        .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
        .sign_with_keys(&agent)
        .unwrap();
    assert_eq!(
        request(
            &base,
            "/events",
            &agent,
            &serde_json::to_value(write).unwrap()
        )
        .await
        .status(),
        403
    );
    assert_eq!(
        request(
            &base,
            "/events",
            &agent,
            &serde_json::to_value(&saved_claim).unwrap()
        )
        .await
        .status(),
        403
    );

    // Invalid target and invented scope must fail the narrow outer admission
    // exception, not reach the ledger and leave synthetic recovery receipts.
    for wrong_target in [true, false] {
        let outsider = Keys::generate();
        let signer = if wrong_target { &outsider } else { &agent };
        let mut invented = claim.clone();
        invented.agent_pubkey = signer.public_key().to_hex();
        if !wrong_target {
            if let ExecutionOperation::Claim {
                run_id, task_id, ..
            } = &mut invented.operation
            {
                *run_id = Uuid::new_v4();
                *task_id = Uuid::new_v4();
            }
        }
        let inner = buzz_sdk::build_workflow_execution_control(&invented)
            .unwrap()
            .sign_with_keys(signer)
            .unwrap();
        let outer = ExecutionControl {
            operation: ExecutionOperation::RecoverClaim {
                signed_claim: inner,
            },
            ..invented
        };
        let event = buzz_sdk::build_workflow_execution_control(&outer)
            .unwrap()
            .sign_with_keys(signer)
            .unwrap();
        assert_eq!(
            request(
                &base,
                "/events",
                signer,
                &serde_json::to_value(&event).unwrap()
            )
            .await
            .status(),
            403
        );
        let persisted: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workflow_execution_receipts WHERE community_id=$1 AND event_id=$2)")
            .bind(community.as_uuid()).bind(event.id.as_bytes().as_slice()).fetch_one(&pool).await.unwrap();
        assert!(!persisted, "invalid recovery reached the receipt ledger");
    }
    let recovered = operation(
        &base,
        &agent,
        community,
        instance,
        ExecutionOperation::RecoverClaim {
            signed_claim: saved_claim,
        },
    )
    .await;
    assert_eq!(recovered["accepted"], true, "{recovered}");
    assert_eq!(recovered["decision"], serde_json::to_value(&grant).unwrap());
    assert_eq!(
        recovered["signed_event"],
        serde_json::to_value(&signed_grant).unwrap()
    );
    assert_eq!(
        db.workflow_actual_run(community, run).await.unwrap()["execution_state"],
        "stalled",
        "receipt recovery alone must not release the lock"
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
    )
    .bind(community.as_uuid())
    .bind(run)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1, "receipt lookup allocated execution");
    assert_eq!(
        operation(
            &base,
            &agent,
            community,
            instance,
            ExecutionOperation::Stopped {
                run_id: run,
                task_id: task,
                channel_id: channel.id,
                grant_id: grant.grant_id,
                ordinal: grant.ordinal,
                reason: StopReason::RecoveryStopped,
            }
        )
        .await["accepted"],
        true
    );
    assert_eq!(
        db.workflow_actual_run(community, run).await.unwrap()["execution_state"],
        "failed"
    );
    let stopped: bool = sqlx::query_scalar("SELECT stopped_at IS NOT NULL FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2")
        .bind(community.as_uuid()).bind(run).fetch_one(&pool).await.unwrap();
    assert!(stopped);
}
