//! Isolated Postgres admission and replay regressions.
use super::*;
use buzz_core::channel::{ChannelType, ChannelVisibility, MemberRole};
use sha2::{Digest, Sha256};
struct Fixture {
    db: Db,
    community: CommunityId,
    owner: Keys,
    relay: Keys,
    workflow: Uuid,
    hash: Vec<u8>,
    task: ManualTaskSpec,
}
async fn fixture() -> Fixture {
    let url = std::env::var("DATABASE_URL").expect("explicit isolated DATABASE_URL required");
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(12)
        .connect(&url)
        .await
        .unwrap();
    crate::migration::run_migrations(&pool).await.unwrap();
    let db = Db::from_pool(pool);
    let owner = Keys::generate();
    let agent = Keys::generate();
    let community = match db
        .create_community_with_owner(
            &format!("manual-{}.test", Uuid::new_v4()),
            &owner.public_key().to_hex(),
        )
        .await
        .unwrap()
    {
        crate::CreateCommunityWithOwnerResult::Created(record) => record.id,
        other => panic!("unexpected {other:?}"),
    };
    db.ensure_user(community, &owner.public_key().to_bytes())
        .await
        .unwrap();
    db.ensure_user(community, &agent.public_key().to_bytes())
        .await
        .unwrap();
    db.set_agent_owner(
        community,
        &agent.public_key().to_bytes(),
        &owner.public_key().to_bytes(),
    )
    .await
    .unwrap();
    let channel = db
        .create_channel(
            community,
            "manual",
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            &owner.public_key().to_bytes(),
            None,
        )
        .await
        .unwrap();
    db.add_member(
        community,
        channel.id,
        &agent.public_key().to_bytes(),
        MemberRole::Bot,
        Some(&owner.public_key().to_bytes()),
    )
    .await
    .unwrap();
    let task = ManualTaskSpec {
        step_id: "brief".into(),
        agent_pubkey: agent.public_key().to_hex(),
        channel_id: channel.id,
        text: "Produce the isolated test result".into(),
    };
    let definition=serde_json::json!({"name":"Daily brief","enabled":true,"trigger":{"on":"schedule","cron":"0 9 * * *"},"steps":[{"id":task.step_id,"action":"send_message","text":task.text,"agent_targets":[task.agent_pubkey]}]}).to_string();
    let hash = Sha256::digest(definition.as_bytes()).to_vec();
    let workflow = Uuid::new_v4();
    db.upsert_workflow(
        community,
        workflow,
        Some(channel.id),
        &owner.public_key().to_bytes(),
        "Daily brief",
        &definition,
        &hash,
    )
    .await
    .unwrap();
    sqlx::query("INSERT INTO workflow_execution_capabilities(community_id,agent_pubkey,instance_id,protocol_version,expires_at) VALUES($1,$2,$3,1,NOW()+interval '90 seconds')")
        .bind(community.as_uuid()).bind(agent.public_key().to_bytes().as_slice()).bind(Uuid::new_v4()).execute(&db.pool).await.unwrap();
    Fixture {
        db,
        community,
        owner,
        relay: Keys::generate(),
        workflow,
        hash,
        task,
    }
}
fn command(f: &Fixture) -> Event {
    EventBuilder::new(Kind::from(46020), "")
        .tags([
            Tag::parse(["d", &f.workflow.to_string()]).unwrap(),
            Tag::parse(["nonce", &Uuid::new_v4().to_string()]).unwrap(),
        ])
        .sign_with_keys(&f.owner)
        .unwrap()
}
async fn admit(f: &Fixture, event: &Event) -> ManualDecision {
    f.db.admit_manual_workflow(
        f.community,
        f.workflow,
        event,
        &f.hash,
        None,
        std::slice::from_ref(&f.task),
        None,
        &f.relay,
    )
    .await
    .unwrap()
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_100_concurrent_commands_charge_once_and_replay_outbox() {
    let f = std::sync::Arc::new(fixture().await);
    let mut tasks = Vec::new();
    for _ in 0..100 {
        let f = f.clone();
        tasks.push(tokio::spawn(async move {
            let event = command(&f);
            let decision = admit(&f, &event).await;
            (event, decision)
        }));
    }
    let mut accepted = Vec::new();
    for task in tasks {
        let (event, decision) = task.await.unwrap();
        if decision.accepted {
            accepted.push((event, decision));
        }
    }
    assert_eq!(accepted.len(), 1);
    let (event, original) = &accepted[0];
    // Reconstruct DB handle as after a process restart, before any publish.
    let restarted = Db::from_pool(f.db.pool.clone());
    let replay = restarted
        .admit_manual_workflow(
            f.community,
            f.workflow,
            event,
            &f.hash,
            None,
            std::slice::from_ref(&f.task),
            None,
            &f.relay,
        )
        .await
        .unwrap();
    assert_eq!(replay.run_id, original.run_id);
    let rows:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT COUNT(*) FROM workflow_runs WHERE community_id=$1 AND origin='manual'),(SELECT COUNT(*) FROM workflow_run_outbox WHERE community_id=$1 AND delivered_at IS NULL),(SELECT COUNT(*) FROM workflow_manual_requests WHERE community_id=$1)")
        .bind(f.community.as_uuid()).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(rows, (1, 1, 100));
    let stored: serde_json::Value =
        sqlx::query_scalar("SELECT signed_event FROM workflow_run_outbox WHERE community_id=$1")
            .bind(f.community.as_uuid())
            .fetch_one(&f.db.pool)
            .await
            .unwrap();
    let task: Event = serde_json::from_value(stored).unwrap();
    task.verify().unwrap();
    assert_eq!(task.pubkey, f.relay.public_key());
    assert_eq!(task.kind.as_u16(), 46008);
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_permissions_tenant_and_definition_fail_closed() {
    let f = fixture().await;
    let other = Keys::generate();
    let forged = EventBuilder::new(Kind::from(46020), "")
        .sign_with_keys(&other)
        .unwrap();
    assert!(matches!(
        f.db.admit_manual_workflow(
            f.community,
            f.workflow,
            &forged,
            &f.hash,
            None,
            std::slice::from_ref(&f.task),
            None,
            &f.relay
        )
        .await,
        Err(DbError::AccessDenied(_))
    ));
    assert!(f
        .db
        .admit_manual_workflow(
            CommunityId::from_uuid(Uuid::new_v4()),
            f.workflow,
            &command(&f),
            &f.hash,
            None,
            std::slice::from_ref(&f.task),
            None,
            &f.relay
        )
        .await
        .is_err());
    let changed =
        f.db.admit_manual_workflow(
            f.community,
            f.workflow,
            &command(&f),
            &f.hash,
            Some("stale"),
            std::slice::from_ref(&f.task),
            None,
            &f.relay,
        )
        .await
        .unwrap();
    assert_eq!(changed.reason.as_deref(), Some("definition_changed"));
    let unsupported =
        f.db.admit_manual_workflow(
            f.community,
            f.workflow,
            &command(&f),
            &f.hash,
            None,
            &[],
            Some("unsupported_manual_profile"),
            &f.relay,
        )
        .await
        .unwrap();
    assert_eq!(
        unsupported.reason.as_deref(),
        Some("unsupported_manual_profile")
    );
    sqlx::query("UPDATE workflows SET enabled=FALSE WHERE community_id=$1 AND id=$2")
        .bind(f.community.as_uuid())
        .bind(f.workflow)
        .execute(&f.db.pool)
        .await
        .unwrap();
    assert_eq!(
        admit(&f, &command(&f)).await.reason.as_deref(),
        Some("workflow_disabled")
    );
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM workflow_run_outbox WHERE community_id=$1")
            .bind(f.community.as_uuid())
            .fetch_one(&f.db.pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_exact_owner_and_channel_intersection() {
    let f = fixture().await;
    sqlx::query("UPDATE relay_members SET role='admin' WHERE community_id=$1 AND pubkey=$2")
        .bind(f.community.as_uuid())
        .bind(f.owner.public_key().to_hex())
        .execute(&f.db.pool)
        .await
        .unwrap();
    assert!(matches!(
        f.db.admit_manual_workflow(
            f.community,
            f.workflow,
            &command(&f),
            &f.hash,
            None,
            std::slice::from_ref(&f.task),
            None,
            &f.relay
        )
        .await,
        Err(DbError::AccessDenied(_))
    ));
    sqlx::query("UPDATE relay_members SET role='owner' WHERE community_id=$1 AND pubkey=$2")
        .bind(f.community.as_uuid())
        .bind(f.owner.public_key().to_hex())
        .execute(&f.db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE channel_members SET removed_at=NOW() WHERE community_id=$1 AND pubkey=$2")
        .bind(f.community.as_uuid())
        .bind(f.owner.public_key().to_bytes().as_slice())
        .execute(&f.db.pool)
        .await
        .unwrap();
    assert!(f
        .db
        .admit_manual_workflow(
            f.community,
            f.workflow,
            &command(&f),
            &f.hash,
            None,
            std::slice::from_ref(&f.task),
            None,
            &f.relay
        )
        .await
        .is_err());
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_scheduled_race_has_one_winner_and_keeps_anchor() {
    let f = fixture().await;
    let at = Utc::now();
    let event = command(&f);
    let (manual, scheduled) = tokio::join!(
        admit(&f, &event),
        f.db.claim_scheduled_workflow_fire(f.community, f.workflow, at)
    );
    let scheduled = scheduled.unwrap();
    assert_ne!(manual.accepted, scheduled.is_some());
    let outcome:String=sqlx::query_scalar("SELECT outcome FROM scheduled_workflow_fires WHERE community_id=$1 AND workflow_id=$2 AND scheduled_for=$3").bind(f.community.as_uuid()).bind(f.workflow).bind(at).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(
        outcome,
        if manual.accepted {
            "skipped_active"
        } else {
            "started"
        }
    );
    assert_eq!(
        f.db.latest_scheduled_workflow_fire(f.community, f.workflow)
            .await
            .unwrap()
            .unwrap()
            .timestamp(),
        at.timestamp()
    );
    assert!(f
        .db
        .claim_scheduled_workflow_fire(f.community, f.workflow, at)
        .await
        .unwrap()
        .is_none());
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_failed_runs_consume_cooldown_and_rolling_limit() {
    let f = fixture().await;
    for index in 0..3 {
        let decision = admit(&f, &command(&f)).await;
        assert!(decision.accepted, "{decision:?}");
        sqlx::query("UPDATE workflow_runs SET status='failed',execution_state='failed' WHERE community_id=$1 AND id=$2").bind(f.community.as_uuid()).bind(decision.run_id).execute(&f.db.pool).await.unwrap();
        assert_eq!(
            admit(&f, &command(&f)).await.reason.as_deref(),
            Some(if index == 2 {
                "workflow_daily_limit"
            } else {
                "workflow_cooldown"
            })
        );
        sqlx::query("UPDATE workflow_runs SET accepted_at=accepted_at-interval '16 minutes' WHERE community_id=$1").bind(f.community.as_uuid()).execute(&f.db.pool).await.unwrap();
    }
    let blocked = admit(&f, &command(&f)).await;
    assert_eq!(blocked.reason.as_deref(), Some("workflow_daily_limit"));
    assert_eq!(blocked.limits.remaining_workflow, 0);
    assert!(blocked.limits.next_eligible_at.is_some());
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_renaming_preserves_binding_and_stale_runner_blocks() {
    let f = fixture().await;
    sqlx::query(
        "UPDATE users SET display_name='Renamed agent' WHERE community_id=$1 AND pubkey=$2",
    )
    .bind(f.community.as_uuid())
    .bind(hex::decode(&f.task.agent_pubkey).unwrap())
    .execute(&f.db.pool)
    .await
    .unwrap();
    let bound: Vec<u8> = sqlx::query_scalar(
        "SELECT agent_pubkey FROM workflow_agent_bindings WHERE community_id=$1 AND workflow_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(f.workflow)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(hex::encode(bound), f.task.agent_pubkey);
    sqlx::query("UPDATE workflow_execution_capabilities SET expires_at=NOW()-interval '1 second' WHERE community_id=$1").bind(f.community.as_uuid()).execute(&f.db.pool).await.unwrap();
    let blocked = admit(&f, &command(&f)).await;
    assert_eq!(blocked.reason.as_deref(), Some("runner_unavailable"));
    assert_eq!(blocked.limits.remaining_workflow, 3);
}
async fn sibling(f: &Fixture, same_agent: bool) -> Fixture {
    let mut task = f.task.clone();
    if !same_agent {
        let agent = Keys::generate();
        task.agent_pubkey = agent.public_key().to_hex();
        f.db.ensure_user(f.community, &agent.public_key().to_bytes())
            .await
            .unwrap();
        f.db.set_agent_owner(
            f.community,
            &agent.public_key().to_bytes(),
            &f.owner.public_key().to_bytes(),
        )
        .await
        .unwrap();
        f.db.add_member(
            f.community,
            task.channel_id,
            &agent.public_key().to_bytes(),
            MemberRole::Bot,
            Some(&f.owner.public_key().to_bytes()),
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO workflow_execution_capabilities(community_id,agent_pubkey,instance_id,protocol_version,expires_at) VALUES($1,$2,$3,1,NOW()+interval '90 seconds')").bind(f.community.as_uuid()).bind(agent.public_key().to_bytes().as_slice()).bind(Uuid::new_v4()).execute(&f.db.pool).await.unwrap();
    }
    let definition=serde_json::json!({"name":"Another brief","trigger":{"on":"schedule","cron":"0 9 * * *"},"steps":[{"id":task.step_id,"action":"send_message","text":task.text,"agent_targets":[task.agent_pubkey]}]}).to_string();
    let hash = Sha256::digest(definition.as_bytes()).to_vec();
    let workflow = Uuid::new_v4();
    f.db.upsert_workflow(
        f.community,
        workflow,
        Some(task.channel_id),
        &f.owner.public_key().to_bytes(),
        "Another brief",
        &definition,
        &hash,
    )
    .await
    .unwrap();
    Fixture {
        db: f.db.clone(),
        community: f.community,
        owner: f.owner.clone(),
        relay: f.relay.clone(),
        workflow,
        hash,
        task,
    }
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_shared_agent_and_community_concurrency_caps() {
    let f = fixture().await;
    let shared = sibling(&f, true).await;
    assert!(admit(&f, &command(&f)).await.accepted);
    assert_eq!(
        admit(&shared, &command(&shared)).await.reason.as_deref(),
        Some("agent_active_limit")
    );
    let mut candidates = Vec::new();
    for _ in 0..6 {
        candidates.push(std::sync::Arc::new(sibling(&f, false).await));
    }
    let mut requests = Vec::new();
    for index in 0..100 {
        let candidate = candidates[index % 6].clone();
        requests.push(tokio::spawn(async move {
            admit(&candidate, &command(&candidate)).await
        }));
    }
    let mut accepted = 0;
    for request in requests {
        if request.await.unwrap().accepted {
            accepted += 1;
        }
    }
    assert_eq!(accepted, 1, "only the second community slot is available");
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT COUNT(*) FROM workflow_runs WHERE community_id=$1 AND origin='manual'),(SELECT COUNT(*) FROM workflow_run_outbox WHERE community_id=$1)").bind(f.community.as_uuid()).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(counts, (2, 2), "rejections create no extra tasks/outbox");
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_community_rolling_ten_across_workflows() {
    let f = fixture().await;
    for _ in 0..10 {
        let next = sibling(&f, false).await;
        let result = admit(&next, &command(&next)).await;
        assert!(result.accepted, "{result:?}");
        sqlx::query("UPDATE workflow_runs SET execution_state='failed',status='failed' WHERE community_id=$1 AND id=$2").bind(f.community.as_uuid()).bind(result.run_id).execute(&f.db.pool).await.unwrap();
    }
    let last = sibling(&f, false).await;
    let result = admit(&last, &command(&last)).await;
    assert_eq!(result.reason.as_deref(), Some("community_daily_limit"));
    assert_eq!(result.limits.remaining_community, 0);
    assert_eq!(result.limits.remaining_workflow, 3);
    assert!(result.limits.next_eligible_at.is_some());
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM workflow_run_outbox WHERE community_id=$1")
            .bind(f.community.as_uuid())
            .fetch_one(&f.db.pool)
            .await
            .unwrap();
    assert_eq!(count, 10);
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_exact_rolling_boundary_and_cooldown_projection() {
    let f = fixture().await;
    let accepted = admit(&f, &command(&f)).await;
    assert!(accepted.accepted);
    let now = Utc::now();
    sqlx::query("UPDATE workflow_runs SET accepted_at=$1,execution_state='failed',status='failed' WHERE community_id=$2").bind(now-Duration::hours(24)).bind(f.community.as_uuid()).execute(&f.db.pool).await.unwrap();
    let mut tx = f.db.begin_event_write_transaction().await.unwrap();
    let boundary = limits(&mut tx, f.community, f.workflow, now).await.unwrap();
    assert_eq!(boundary.remaining_workflow, 3);
    assert_eq!(boundary.remaining_community, 10);
    assert!(boundary.next_eligible_at.is_none());
    sqlx::query("UPDATE workflow_runs SET accepted_at=$1 WHERE community_id=$2")
        .bind(now - Duration::minutes(14))
        .bind(f.community.as_uuid())
        .execute(&mut *tx)
        .await
        .unwrap();
    let cooldown = limits(&mut tx, f.community, f.workflow, now).await.unwrap();
    assert_eq!(
        cooldown.next_eligible_at.unwrap().timestamp(),
        (now + Duration::minutes(1)).timestamp()
    );
    let at_boundary = limits(&mut tx, f.community, f.workflow, now + Duration::minutes(1))
        .await
        .unwrap();
    assert!(at_boundary.next_eligible_at.is_none());
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_delete_keeps_active_evidence_and_charged_allowance() {
    let f = fixture().await;
    let decision = admit(&f, &command(&f)).await;
    assert!(decision.accepted);
    let definition =
        f.db.get_workflow(f.community, f.workflow)
            .await
            .unwrap()
            .definition
            .to_string();
    f.db.delete_workflow_for_owner(f.community, f.workflow, &f.owner.public_key().to_bytes())
        .await
        .unwrap();
    let retained = f.db.get_workflow(f.community, f.workflow).await.unwrap();
    assert!(!retained.enabled);
    assert_eq!(
        f.db.workflow_manual_limits(f.community, f.workflow)
            .await
            .unwrap()
            .remaining_workflow,
        2
    );
    assert_eq!(
        f.db.workflow_actual_run(f.community, decision.run_id.unwrap())
            .await
            .unwrap()["execution_state"],
        "queued"
    );
    assert!(f
        .db
        .upsert_workflow(
            f.community,
            f.workflow,
            Some(f.task.channel_id),
            &f.owner.public_key().to_bytes(),
            "Recreated brief",
            &definition,
            &f.hash
        )
        .await
        .is_err());
    let replacement = sibling(&f, true).await;
    assert_eq!(
        admit(&replacement, &command(&replacement))
            .await
            .reason
            .as_deref(),
        Some("agent_active_limit")
    );
    let receipt: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workflow_manual_requests WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(decision.run_id)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(receipt, 1);
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_delete_preserves_unresolved_scheduled_only_execution_and_claims() {
    let f = fixture().await;
    let run =
        f.db.create_workflow_run(f.community, f.workflow, None, None)
            .await
            .unwrap();
    sqlx::query("UPDATE workflow_runs SET status='completed',execution_state='stalled',safe_error_code='legacy_execution_unknown' WHERE community_id=$1 AND id=$2").bind(f.community.as_uuid()).bind(run).execute(&f.db.pool).await.unwrap();
    f.db.delete_workflow_for_owner(f.community, f.workflow, &f.owner.public_key().to_bytes())
        .await
        .unwrap();
    let retained = f.db.get_workflow(f.community, f.workflow).await.unwrap();
    assert!(!retained.enabled);
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "stalled"
    );
    assert!(f
        .db
        .upsert_workflow(
            f.community,
            f.workflow,
            Some(f.task.channel_id),
            &f.owner.public_key().to_bytes(),
            "Revive",
            &retained.definition.to_string(),
            &f.hash
        )
        .await
        .is_err());
    let claim_only = sibling(&f, false).await;
    assert!(f
        .db
        .claim_scheduled_workflow_fire(f.community, claim_only.workflow, Utc::now())
        .await
        .unwrap()
        .is_some());
    f.db.delete_workflow_for_owner(
        f.community,
        claim_only.workflow,
        &f.owner.public_key().to_bytes(),
    )
    .await
    .unwrap();
    let retained =
        f.db.get_workflow(f.community, claim_only.workflow)
            .await
            .unwrap();
    assert!(!retained.enabled);
    let claims:i64=sqlx::query_scalar("SELECT COUNT(*) FROM scheduled_workflow_fires WHERE community_id=$1 AND workflow_id=$2 AND outcome='started' AND workflow_run_id IS NULL").bind(f.community.as_uuid()).bind(claim_only.workflow).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(claims, 1);
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_manual_rejected_request_replays_after_blocker_is_removed() {
    let f = fixture().await;
    sqlx::query("UPDATE workflows SET enabled=FALSE WHERE community_id=$1 AND id=$2")
        .bind(f.community.as_uuid())
        .bind(f.workflow)
        .execute(&f.db.pool)
        .await
        .unwrap();
    let event = command(&f);
    let rejected = admit(&f, &event).await;
    assert_eq!(rejected.reason.as_deref(), Some("workflow_disabled"));
    sqlx::query("UPDATE workflows SET enabled=TRUE WHERE community_id=$1 AND id=$2")
        .bind(f.community.as_uuid())
        .bind(f.workflow)
        .execute(&f.db.pool)
        .await
        .unwrap();
    let replay = admit(&f, &event).await;
    assert_eq!(
        serde_json::to_value(&rejected).unwrap(),
        serde_json::to_value(&replay).unwrap(),
        "the same signed request must retain its original rejection"
    );
    let rows: (i64, i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM workflow_runs WHERE community_id=$1),(SELECT COUNT(*) FROM workflow_run_outbox WHERE community_id=$1),(SELECT COUNT(*) FROM workflow_manual_requests WHERE community_id=$1)")
        .bind(f.community.as_uuid()).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(rows, (0, 0, 1));
    assert!(admit(&f, &command(&f)).await.accepted);
}

#[tokio::test]
#[ignore = "requires isolated Postgres and child-process termination"]
async fn workflow_manual_committed_outbox_survives_process_death_and_exact_replay() {
    const CHILD_PATH_ENV: &str = "BUZZ_MANUAL_CRASH_TEST_PUBLIC_FIXTURE";
    if let Ok(path) = std::env::var(CHILD_PATH_ENV) {
        let f = fixture().await;
        let event = command(&f);
        let decision = admit(&f, &event).await;
        assert!(decision.accepted);
        let signed: serde_json::Value = sqlx::query_scalar(
            "SELECT signed_event FROM workflow_run_outbox WHERE community_id=$1",
        )
        .bind(f.community.as_uuid())
        .fetch_one(&f.db.pool)
        .await
        .unwrap();
        // No private key leaves the child. The durable signed request suffices
        // for a retry, and the relay must not sign a second task on replay.
        let metadata = serde_json::json!({
            "community":f.community.as_uuid(), "workflow":f.workflow,
            "event":event, "hash":hex::encode(&f.hash), "task":f.task,
            "decision":decision, "signed_outbox":signed,
        });
        let pending = format!("{path}.pending");
        std::fs::write(&pending, serde_json::to_vec(&metadata).unwrap()).unwrap();
        std::fs::rename(pending, path).unwrap();
        // Deliberately leave a live process/pool after commit and before any
        // task publication; the parent kills and reaps this exact process.
        std::future::pending::<()>().await;
        return;
    }

    let path = std::env::temp_dir().join(format!("buzz-manual-crash-{}.json", Uuid::new_v4()));
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "workflow_manual::tests::workflow_manual_committed_outbox_survives_process_death_and_exact_replay",
        ])
        .env(CHILD_PATH_ENV, &path)
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let ready = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while !path.exists() {
            assert!(
                child.try_wait().unwrap().is_none(),
                "child exited before committing"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await;
    child.kill().unwrap();
    let status = child.wait().unwrap();
    assert!(ready.is_ok(), "child did not commit within 30 seconds");
    assert!(!status.success(), "child must die before publication");
    let metadata: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    std::fs::remove_file(path).unwrap();

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&std::env::var("DATABASE_URL").unwrap())
        .await
        .unwrap();
    let db = Db::from_pool(pool);
    let community =
        CommunityId::from_uuid(serde_json::from_value(metadata["community"].clone()).unwrap());
    let workflow: Uuid = serde_json::from_value(metadata["workflow"].clone()).unwrap();
    let event: Event = serde_json::from_value(metadata["event"].clone()).unwrap();
    let task: ManualTaskSpec = serde_json::from_value(metadata["task"].clone()).unwrap();
    let hash = hex::decode(metadata["hash"].as_str().unwrap()).unwrap();
    let replay = db
        .admit_manual_workflow(
            community,
            workflow,
            &event,
            &hash,
            None,
            &[task],
            None,
            &Keys::generate(),
        )
        .await
        .unwrap();
    assert_eq!(serde_json::to_value(replay).unwrap(), metadata["decision"]);
    let counts: (i64, i64, i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM workflow_runs WHERE community_id=$1 AND origin='manual'),(SELECT COUNT(*) FROM workflow_run_tasks WHERE community_id=$1),(SELECT COUNT(*) FROM workflow_run_outbox WHERE community_id=$1 AND delivered_at IS NULL),(SELECT COUNT(*) FROM events WHERE community_id=$1 AND id=$2)")
        .bind(community.as_uuid()).bind(event.id.as_bytes().as_slice()).fetch_one(&db.pool).await.unwrap();
    assert_eq!(counts, (1, 1, 1, 1));
    let signed: serde_json::Value =
        sqlx::query_scalar("SELECT signed_event FROM workflow_run_outbox WHERE community_id=$1")
            .bind(community.as_uuid())
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(signed, metadata["signed_outbox"]);
    let signed: Event = serde_json::from_value(signed).unwrap();
    signed.verify().unwrap();
    assert_eq!(signed.kind.as_u16(), 46008);
    let published: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE community_id=$1 AND id=$2")
            .bind(community.as_uuid())
            .bind(signed.id.as_bytes().as_slice())
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(published, 0, "the task remains durable unpublished intent");
}
