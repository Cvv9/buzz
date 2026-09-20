//! Real isolated Postgres execution ledger regressions.
use super::*;
use crate::workflow_manual::{ManualDecision, ManualTaskSpec};
use buzz_core::channel::{ChannelType, ChannelVisibility, MemberRole};
use sha2::{Digest, Sha256};
struct Fixture {
    db: Db,
    community: CommunityId,
    owner: Keys,
    relay: Keys,
    agent: Keys,
    instance: Uuid,
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
    let instance = Uuid::new_v4();
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
        .bind(community.as_uuid()).bind(agent.public_key().to_bytes().as_slice()).bind(instance).execute(&db.pool).await.unwrap();
    Fixture {
        db,
        community,
        owner,
        relay: Keys::generate(),
        workflow,
        agent,
        instance,
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

async fn control(f: &Fixture, operation: ExecutionOperation) -> (Event, ControlReceipt) {
    let envelope = ExecutionControl {
        version: 1,
        community_id: *f.community.as_uuid(),
        agent_pubkey: f.agent.public_key().to_hex(),
        instance_id: f.instance,
        operation,
    };
    let event = EventBuilder::new(
        Kind::Custom(46040),
        serde_json::to_string(&envelope).unwrap(),
    )
    .tags([Tag::parse(["nonce", &Uuid::new_v4().to_string()]).unwrap()])
    .sign_with_keys(&f.agent)
    .unwrap();
    let result =
        f.db.workflow_execution_control(f.community, &event, &envelope, &f.relay)
            .await
            .unwrap();
    (event, result)
}
async fn run(f: &Fixture) -> (Uuid, Uuid) {
    let admitted = admit(f, &command(f)).await;
    let run = admitted.run_id.unwrap();
    let task = sqlx::query_scalar(
        "SELECT task_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    (run, task)
}
async fn claim_attempt(f: &Fixture, run: Uuid, task: Uuid) -> (Event, ControlReceipt, Keys) {
    let revision =
        sqlx::query_scalar("SELECT revision FROM workflow_runs WHERE community_id=$1 AND id=$2")
            .bind(f.community.as_uuid())
            .bind(run)
            .fetch_one(&f.db.pool)
            .await
            .unwrap();
    let ephemeral = Keys::generate();
    let (event, receipt) = control(
        f,
        ExecutionOperation::Claim {
            run_id: run,
            task_id: task,
            channel_id: f.task.channel_id,
            revision,
            ephemeral_pubkey: ephemeral.public_key().to_hex(),
        },
    )
    .await;
    (event, receipt, ephemeral)
}
fn stopped(d: &ExecutionDecision, reason: StopReason) -> ExecutionOperation {
    ExecutionOperation::Stopped {
        grant_id: d.grant_id,
        run_id: d.run_id,
        task_id: d.task_id,
        channel_id: d.channel_id,
        ordinal: d.ordinal,
        reason,
    }
}
fn started(d: &ExecutionDecision) -> ExecutionOperation {
    ExecutionOperation::Started {
        grant_id: d.grant_id,
        run_id: d.run_id,
        task_id: d.task_id,
        channel_id: d.channel_id,
        ordinal: d.ordinal,
    }
}
fn finished(d: &ExecutionDecision, event: &Event) -> ExecutionOperation {
    ExecutionOperation::Finished {
        grant_id: d.grant_id,
        run_id: d.run_id,
        task_id: d.task_id,
        channel_id: d.channel_id,
        ordinal: d.ordinal,
        result_event_id: event.id.to_hex(),
    }
}
async fn result_event(f: &Fixture, d: &ExecutionDecision) -> Event {
    let origin: String =
        sqlx::query_scalar("SELECT origin FROM workflow_runs WHERE community_id=$1 AND id=$2")
            .bind(f.community.as_uuid())
            .bind(d.run_id)
            .fetch_one(&f.db.pool)
            .await
            .unwrap();
    let event_id:Vec<u8>=sqlx::query_scalar("SELECT task_event_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND task_id=$3").bind(f.community.as_uuid()).bind(d.run_id).bind(d.task_id).fetch_one(&f.db.pool).await.unwrap();
    let tags = [
        ("h", d.channel_id.to_string()),
        ("workflow-result", hex::encode(event_id)),
        ("workflow-origin", origin),
        ("workflow-run", d.run_id.to_string()),
        ("workflow-task", d.task_id.to_string()),
        ("workflow-grant", d.grant_id.to_string()),
        ("workflow-ordinal", d.ordinal.to_string()),
        ("workflow-instance", d.instance_id.to_string()),
    ]
    .into_iter()
    .map(|(k, v)| Tag::parse([k, &v]).unwrap());
    EventBuilder::new(Kind::Custom(9), "Isolated successful brief")
        .tags(tags)
        .sign_with_keys(&f.agent)
        .unwrap()
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_claim_replay_stop_fence_and_two_attempt_ceiling() {
    let f = fixture().await;
    let (run, task) = run(&f).await;
    let (event, receipt, ephemeral) = claim_attempt(&f, run, task).await;
    assert!(receipt.accepted, "{:?}", receipt.reason);
    let d = receipt.decision.unwrap();
    assert_eq!(d.ordinal, 1);
    let signed = receipt.signed_event.unwrap();
    assert!(signed.verify().is_ok());
    assert_eq!(signed.pubkey, f.relay.public_key());
    let envelope = serde_json::from_str(&event.content).unwrap();
    let replay =
        f.db.workflow_execution_control(f.community, &event, &envelope, &f.relay)
            .await
            .unwrap();
    assert_eq!(replay.signed_event.unwrap().id, signed.id);
    assert!(f
        .db
        .workflow_read_scope(f.community, ephemeral.public_key().as_bytes())
        .await
        .unwrap()
        .is_some());
    let (_, blocked, _) = claim_attempt(&f, run, task).await;
    assert_eq!(blocked.reason.as_deref(), Some("stopped_pending"));
    assert!(
        control(&f, stopped(&d, StopReason::ExecutionFailed))
            .await
            .1
            .accepted
    );
    assert!(f
        .db
        .workflow_read_scope(f.community, ephemeral.public_key().as_bytes())
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        f.db.workflow_execution_control(f.community, &event, &envelope, &f.relay)
            .await
            .unwrap()
            .reason
            .as_deref(),
        Some("grant_inactive")
    );
    let (_, second, _) = claim_attempt(&f, run, task).await;
    let d2 = second.decision.unwrap();
    assert_eq!(d2.ordinal, 2);
    control(&f, stopped(&d2, StopReason::ExecutionFailed)).await;
    let (_, third, _) = claim_attempt(&f, run, task).await;
    assert!(!third.accepted);
    let actual = f.db.workflow_actual_run(f.community, run).await.unwrap();
    assert_eq!(actual["execution_state"], "failed");
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(count, 2);
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_success_requires_exact_stored_result_and_reaps() {
    let f = fixture().await;
    let (run, task) = run(&f).await;
    let (_, receipt, key) = claim_attempt(&f, run, task).await;
    let d = receipt.decision.unwrap();
    let result = result_event(&f, &d).await;
    assert!(!f
        .db
        .validate_workflow_result(f.community, &result)
        .await
        .unwrap());
    assert!(control(&f, started(&d)).await.1.accepted);
    let forged = EventBuilder::new(Kind::Custom(9), &result.content)
        .tags(
            result
                .tags
                .iter()
                .filter(|t| t.as_slice().first().is_none_or(|k| k != "workflow-result"))
                .cloned()
                .chain([Tag::parse(["workflow-result", &"f".repeat(64)]).unwrap()]),
        )
        .sign_with_keys(&f.agent)
        .unwrap();
    assert!(
        !f.db
            .validate_workflow_result(f.community, &forged)
            .await
            .unwrap(),
        "unrelated original task result reference must fail"
    );

    assert_eq!(
        control(&f, finished(&d, &result)).await.1.reason.as_deref(),
        Some("result_not_found")
    );
    assert!(f
        .db
        .validate_workflow_result(f.community, &result)
        .await
        .unwrap());
    f.db.insert_event_with_thread_metadata(f.community, &result, Some(d.channel_id), None)
        .await
        .unwrap();
    assert!(control(&f, finished(&d, &result)).await.1.accepted);
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "completed"
    );
    assert!(f
        .db
        .workflow_read_scope(f.community, key.public_key().as_bytes())
        .await
        .unwrap()
        .is_none());
    let stopped:bool=sqlx::query_scalar("SELECT stopped_at IS NOT NULL FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2 AND ordinal=1").bind(f.community.as_uuid()).bind(run).fetch_one(&f.db.pool).await.unwrap();
    assert!(stopped);
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_permission_revocation_and_deadline_keep_fence_until_stop() {
    let f = fixture().await;
    let (run, task) = run(&f).await;
    let (_, receipt, key) = claim_attempt(&f, run, task).await;
    let d = receipt.decision.unwrap();
    sqlx::query("UPDATE channel_members SET removed_at=NOW() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3").bind(f.community.as_uuid()).bind(d.channel_id).bind(f.agent.public_key().as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    assert!(f
        .db
        .workflow_read_scope(f.community, key.public_key().as_bytes())
        .await
        .unwrap()
        .is_none());
    let deliveries = f.db.workflow_execution_sweep(&f.relay).await.unwrap();
    assert!(deliveries
        .iter()
        .any(|(_, _, e)| e.kind.as_u16() == 46041 && e.content.contains("cancel")));
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "stalled"
    );
    let stop = stopped(&d, StopReason::PermissionRevoked);
    let envelope = ExecutionControl {
        version: 1,
        community_id: *f.community.as_uuid(),
        agent_pubkey: f.agent.public_key().to_hex(),
        instance_id: f.instance,
        operation: stop.clone(),
    };
    assert!(f
        .db
        .workflow_stop_authorized(f.community, &envelope)
        .await
        .unwrap());
    assert!(control(&f, stop).await.1.accepted);
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "failed"
    );
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_revision_instance_and_cross_tenant_fences() {
    let f = fixture().await;
    let (run, task) = run(&f).await;
    let (_, receipt, _) = claim_attempt(&f, run, task).await;
    let d = receipt.decision.unwrap();
    let envelope = ExecutionControl {
        version: 1,
        community_id: *f.community.as_uuid(),
        agent_pubkey: f.agent.public_key().to_hex(),
        instance_id: Uuid::new_v4(),
        operation: stopped(&d, StopReason::ExecutionFailed),
    };
    assert!(!f
        .db
        .workflow_stop_authorized(f.community, &envelope)
        .await
        .unwrap());
    assert!(!f
        .db
        .workflow_stop_authorized(CommunityId::from_uuid(Uuid::new_v4()), &envelope)
        .await
        .unwrap());
    control(&f, stopped(&d, StopReason::ExecutionFailed)).await;
    let (_, stale) = control(
        &f,
        ExecutionOperation::Claim {
            run_id: run,
            task_id: task,
            channel_id: d.channel_id,
            revision: 1,
            ephemeral_pubkey: Keys::generate().public_key().to_hex(),
        },
    )
    .await;
    assert_eq!(stale.reason.as_deref(), Some("revision_changed"));
    assert!(stale.current_revision.unwrap() > 1);
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_concurrent_claims_allocate_one_attempt() {
    let f = std::sync::Arc::new(fixture().await);
    let (run, task) = run(&f).await;
    let mut jobs = Vec::new();
    for _ in 0..100 {
        let f = f.clone();
        jobs.push(tokio::spawn(
            async move { claim_attempt(&f, run, task).await.1 },
        ));
    }
    let mut accepted = 0;
    for job in jobs {
        accepted += i32::from(job.await.unwrap().accepted);
    }
    assert_eq!(accepted, 1);
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_two_task_run_reserves_unattempted_task() {
    let f = fixture().await;
    let mut second = f.task.clone();
    second.step_id = "second".into();
    let receipt =
        f.db.admit_manual_workflow(
            f.community,
            f.workflow,
            &command(&f),
            &f.hash,
            None,
            &[f.task.clone(), second],
            None,
            &f.relay,
        )
        .await
        .unwrap();
    let run = receipt.run_id.unwrap();
    let tasks:Vec<Uuid>=sqlx::query_scalar("SELECT task_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 ORDER BY step_id").bind(f.community.as_uuid()).bind(run).fetch_all(&f.db.pool).await.unwrap();
    let (_, first, _) = claim_attempt(&f, run, tasks[0]).await;
    let d = first.decision.unwrap();
    control(&f, stopped(&d, StopReason::ExecutionFailed)).await;
    let (_, retry, _) = claim_attempt(&f, run, tasks[0]).await;
    assert_eq!(retry.reason.as_deref(), Some("no_more_attempts"));
    let (_, second, _) = claim_attempt(&f, run, tasks[1]).await;
    assert!(second.accepted);
    assert_eq!(second.decision.unwrap().ordinal, 2);
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_absolute_deadline_requires_verified_stop_and_never_regrants() {
    let f = fixture().await;
    let (run, task) = run(&f).await;
    let (_, receipt, key) = claim_attempt(&f, run, task).await;
    let d = receipt.decision.unwrap();
    sqlx::query("UPDATE workflow_runs SET deadline_at=clock_timestamp()-interval '1 second' WHERE community_id=$1 AND id=$2").bind(f.community.as_uuid()).bind(run).execute(&f.db.pool).await.unwrap();
    assert!(f
        .db
        .workflow_read_scope(f.community, key.public_key().as_bytes())
        .await
        .unwrap()
        .is_none());
    f.db.workflow_execution_sweep(&f.relay).await.unwrap();
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "stalled"
    );
    assert!(
        control(&f, stopped(&d, StopReason::DeadlineExceeded))
            .await
            .1
            .accepted
    );
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "timed_out"
    );
    assert!(!claim_attempt(&f, run, task).await.1.accepted);
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_scheduled_grant_preserves_configured_turn_and_single_target_task() {
    let f = fixture().await;
    let run =
        f.db.create_workflow_run(f.community, f.workflow, None, None)
            .await
            .unwrap();
    let legacy = EventBuilder::new(Kind::Custom(46008), &f.task.text)
        .sign_with_keys(&f.relay)
        .unwrap();
    let id =
        f.db.queue_supervised_workflow_tasks(
            f.community,
            run,
            &f.task.step_id,
            f.task.channel_id,
            std::slice::from_ref(&f.task.agent_pubkey),
            &legacy,
            &f.relay,
        )
        .await
        .unwrap()
        .unwrap();
    let task: Uuid = sqlx::query_scalar(
        "SELECT task_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    let (_, receipt, _) = claim_attempt(&f, run, task).await;
    let d = receipt.decision.unwrap();
    assert!(d.deadline - Utc::now().timestamp() >= 7790);
    let actual = f.db.workflow_actual_run(f.community, run).await.unwrap();
    assert!(actual["deadline_at"].is_null());
    let outbox: serde_json::Value = sqlx::query_scalar(
        "SELECT signed_event FROM workflow_run_outbox WHERE community_id=$1 AND event_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(hex::decode(id).unwrap())
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    let task: Event = serde_json::from_value(outbox).unwrap();
    assert!(exact_tag(
        &task,
        "workflow-community",
        &f.community.to_string()
    ));
    assert!(exact_tag(&task, "workflow-origin", "scheduled"));
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_manual_dm_destination_is_ineligible() {
    let f = fixture().await;
    sqlx::query("UPDATE channels SET channel_type='dm' WHERE community_id=$1 AND id=$2")
        .bind(f.community.as_uuid())
        .bind(f.task.channel_id)
        .execute(&f.db.pool)
        .await
        .unwrap();
    let receipt = admit(&f, &command(&f)).await;
    assert_eq!(
        receipt.reason.as_deref(),
        Some("unsupported_manual_destination")
    );
    assert!(!receipt.accepted);
    let (reason, _) = f
        .db
        .workflow_manual_eligibility(f.community, f.workflow, std::slice::from_ref(&f.task), None)
        .await
        .unwrap();
    assert_eq!(reason.as_deref(), Some("unsupported_manual_destination"));
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_new_tables_have_startup_serving_fences() {
    let f = fixture().await;
    f.db.deletion_store()
        .validate_serving_catalog()
        .await
        .unwrap();
    let missing:i64=sqlx::query_scalar("SELECT count(*) FROM pg_class c WHERE c.relname IN ('workflow_admission_mutex','workflow_agent_bindings','workflow_manual_requests','workflow_run_tasks','workflow_run_attempts','workflow_run_outbox','workflow_execution_capabilities','workflow_run_credentials','workflow_execution_receipts','workflow_recovery_receipts') AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='community_write_fence_' || c.relname AND NOT t.tgisinternal)").fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(missing, 0);
}

fn recovery_control(
    f: &Fixture,
    controller: &Keys,
    operation: buzz_core::workflow_recovery::RecoveryOperation,
) -> buzz_core::workflow_recovery::ControllerRecoveryControl {
    let now = Utc::now().timestamp();
    buzz_core::workflow_recovery::ControllerRecoveryControl {
        version: 1,
        community_id: *f.community.as_uuid(),
        controller_pubkey: controller.public_key().to_hex(),
        target_agent: f.agent.public_key().to_hex(),
        container_id: "c".repeat(64),
        evidence_id: hex::encode(Sha256::digest(Uuid::new_v4().as_bytes())),
        observed_at: now,
        container_started_at: now - 100,
        container_finished_at: now,
        operation,
    }
}
fn recovery_event(
    control: &buzz_core::workflow_recovery::ControllerRecoveryControl,
    controller: &Keys,
) -> Event {
    EventBuilder::new(Kind::Custom(46040), serde_json::to_string(control).unwrap())
        .tags([
            Tag::parse(["p", &control.target_agent]).unwrap(),
            Tag::parse(["workflow-recovery", &control.evidence_id]).unwrap(),
        ])
        .sign_with_keys(controller)
        .unwrap()
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_recovery_exact_stop_pin_tenant_binding_replay_and_revoked_permissions() {
    use buzz_core::workflow_recovery::RecoveryOperation;
    let f = fixture().await;
    let (run, task) = run(&f).await;
    let (_, receipt, credential) = claim_attempt(&f, run, task).await;
    let d = receipt.decision.unwrap();
    let controller = Keys::generate();
    let envelope = recovery_control(
        &f,
        &controller,
        RecoveryOperation::VerifiedAttemptStopped {
            run_id: run,
            task_id: task,
            grant_id: d.grant_id,
            instance_id: d.instance_id,
            channel_id: d.channel_id,
            ordinal: d.ordinal,
        },
    );
    let event = recovery_event(&envelope, &controller);
    let pin = controller.public_key().to_hex();
    assert!(
        !f.db
            .workflow_controller_recovery(
                f.community,
                &event,
                &envelope,
                &f.agent.public_key().to_hex(),
                &f.relay
            )
            .await
            .unwrap()
            .accepted
    );
    let other = CommunityId::from_uuid(Uuid::new_v4());
    assert!(
        !f.db
            .workflow_controller_recovery(other, &event, &envelope, &pin, &f.relay)
            .await
            .unwrap()
            .accepted
    );
    for failure in ["target", "grant", "instance", "future", "stop_before_claim"] {
        let mut bad = envelope.clone();
        bad.evidence_id = hex::encode(Sha256::digest(Uuid::new_v4().as_bytes()));
        match failure {
            "target" => bad.target_agent = Keys::generate().public_key().to_hex(),
            "grant" => {
                if let RecoveryOperation::VerifiedAttemptStopped { grant_id, .. } =
                    &mut bad.operation
                {
                    *grant_id = Uuid::new_v4()
                }
            }
            "instance" => {
                if let RecoveryOperation::VerifiedAttemptStopped { instance_id, .. } =
                    &mut bad.operation
                {
                    *instance_id = Uuid::new_v4()
                }
            }
            "future" => bad.observed_at += 300,
            _ => bad.container_finished_at -= 10,
        }
        let bad_event = recovery_event(&bad, &controller);
        assert!(
            !f.db
                .workflow_controller_recovery(f.community, &bad_event, &bad, &pin, &f.relay)
                .await
                .unwrap()
                .accepted,
            "{failure}"
        );
    }
    sqlx::query("UPDATE channel_members SET removed_at=NOW() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3").bind(f.community.as_uuid()).bind(d.channel_id).bind(f.agent.public_key().as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    assert!(
        f.db.workflow_controller_recovery(f.community, &event, &envelope, &pin, &f.relay)
            .await
            .unwrap()
            .accepted
    );
    assert!(
        f.db.workflow_controller_recovery(f.community, &event, &envelope, &pin, &f.relay)
            .await
            .unwrap()
            .accepted
    );
    assert!(f
        .db
        .workflow_read_scope(f.community, credential.public_key().as_bytes())
        .await
        .unwrap()
        .is_none());
    let mut replay = envelope.clone();
    replay.container_id = "e".repeat(64);
    assert_eq!(
        f.db.workflow_controller_recovery(
            f.community,
            &recovery_event(&replay, &controller),
            &replay,
            &pin,
            &f.relay
        )
        .await
        .unwrap()
        .reason
        .as_deref(),
        Some("recovery_evidence_replayed")
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "failed"
    );
    let audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_recovery_receipts WHERE community_id=$1 AND event_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(event.id.as_bytes().as_slice())
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(audits, 1);
}
#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_recovery_legacy_requires_persisted_ungranted_scheduled_evidence() {
    use buzz_core::workflow_recovery::{
        LegacyRecoveryClaim, LegacyRecoveryTask, RecoveryOperation,
    };
    let f = fixture().await;
    let (run, task) = run(&f).await;
    let controller = Keys::generate();
    let pin = controller.public_key().to_hex();
    let dispatch = EventBuilder::new(Kind::Custom(46008), "Historical scheduled task")
        .tags([
            Tag::parse(["p", &f.agent.public_key().to_hex()]).unwrap(),
            Tag::parse(["h", &f.task.channel_id.to_string()]).unwrap(),
            Tag::parse(["workflow-run", &run.to_string()]).unwrap(),
        ])
        .sign_with_keys(&f.relay)
        .unwrap();
    f.db.insert_event_with_thread_metadata(f.community, &dispatch, Some(f.task.channel_id), None)
        .await
        .unwrap();
    sqlx::query("UPDATE workflow_run_tasks SET state='stalled',task_event_id=$3 WHERE community_id=$1 AND run_id=$2").bind(f.community.as_uuid()).bind(run).bind(dispatch.id.as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    let op = RecoveryOperation::LegacyRecovery {
        tasks: vec![LegacyRecoveryTask {
            run_id: run,
            task_id: task,
            channel_id: f.task.channel_id,
            task_event_id: dispatch.id.to_hex(),
        }],
        claims: vec![],
    };
    let bad = recovery_control(&f, &controller, op.clone());
    assert!(
        !f.db
            .workflow_controller_recovery(
                f.community,
                &recovery_event(&bad, &controller),
                &bad,
                &pin,
                &f.relay
            )
            .await
            .unwrap()
            .accepted
    );
    sqlx::query("UPDATE workflow_runs SET origin='scheduled',dispatch_complete=true,status='completed',execution_state='stalled' WHERE community_id=$1 AND id=$2").bind(f.community.as_uuid()).bind(run).execute(&f.db.pool).await.unwrap();
    let good = recovery_control(&f, &controller, op);
    assert!(
        f.db.workflow_controller_recovery(
            f.community,
            &recovery_event(&good, &controller),
            &good,
            &pin,
            &f.relay
        )
        .await
        .unwrap()
        .accepted
    );
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "failed"
    );
    let unsupported = recovery_control(
        &f,
        &controller,
        RecoveryOperation::LegacyRecovery {
            tasks: vec![],
            claims: vec![LegacyRecoveryClaim {
                workflow_id: f.workflow,
                scheduled_for_micros: 1,
                claimed_at_micros: 1,
                definition_hash: hex::encode(&f.hash),
            }],
        },
    );
    assert_eq!(
        f.db.workflow_controller_recovery(
            f.community,
            &recovery_event(&unsupported, &controller),
            &unsupported,
            &pin,
            &f.relay
        )
        .await
        .unwrap()
        .reason
        .as_deref(),
        Some("unsupported_orphan_claim_evidence")
    );
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_event_origin_dispatch_grants_ordinary_retries_and_completes() {
    let f = fixture().await;
    let definition=serde_json::json!({"name":"Event brief","trigger":{"on":"message_posted"},"steps":[{"id":f.task.step_id,"action":"send_message","text":f.task.text,"agent_targets":[f.task.agent_pubkey]}]}).to_string();
    f.db.upsert_workflow(
        f.community,
        f.workflow,
        Some(f.task.channel_id),
        f.owner.public_key().as_bytes(),
        "Event brief",
        &definition,
        &Sha256::digest(definition.as_bytes()),
    )
    .await
    .unwrap();
    let run =
        f.db.create_workflow_run(f.community, f.workflow, None, None)
            .await
            .unwrap();
    let legacy = EventBuilder::new(Kind::Custom(46008), &f.task.text)
        .sign_with_keys(&f.relay)
        .unwrap();
    f.db.queue_supervised_workflow_tasks(
        f.community,
        run,
        &f.task.step_id,
        f.task.channel_id,
        std::slice::from_ref(&f.task.agent_pubkey),
        &legacy,
        &f.relay,
    )
    .await
    .unwrap()
    .unwrap();
    let row = sqlx::query(
        "SELECT task_id,task_event_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    let task: Uuid = row.get("task_id");
    let signed: serde_json::Value = sqlx::query_scalar(
        "SELECT signed_event FROM workflow_run_outbox WHERE community_id=$1 AND event_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(row.get::<Vec<u8>, _>("task_event_id"))
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    let event: Event = serde_json::from_value(signed).unwrap();
    assert!(exact_tag(&event, "workflow-origin", "event"));
    assert!(exact_tag(&event, "workflow-protocol", "1"));
    assert!(!event.tags.iter().any(|t| t
        .as_slice()
        .first()
        .is_some_and(|v| v == "workflow-deadline")));
    for ordinal in 1..=3 {
        let (_, receipt, key) = claim_attempt(&f, run, task).await;
        assert!(receipt.accepted, "{receipt:?}");
        let grant = receipt.decision.unwrap();
        assert_eq!(grant.ordinal, ordinal);
        assert!(grant.deadline - Utc::now().timestamp() >= 7790);
        assert!(
            !f.db
                .is_workflow_credential(key.public_key().as_bytes())
                .await
                .unwrap(),
            "ordinary execution must not register a manual scoped credential"
        );
        assert!(control(&f, started(&grant)).await.1.accepted);
        if ordinal < 3 {
            assert!(
                control(&f, stopped(&grant, StopReason::ExecutionFailed))
                    .await
                    .1
                    .accepted
            );
        } else {
            sqlx::query("UPDATE workflow_runs SET dispatch_complete=TRUE,status='completed' WHERE community_id=$1 AND id=$2").bind(f.community.as_uuid()).bind(run).execute(&f.db.pool).await.unwrap();
            let result = result_event(&f, &grant).await;
            assert!(f
                .db
                .validate_workflow_result(f.community, &result)
                .await
                .unwrap());
            f.db.insert_event_with_thread_metadata(
                f.community,
                &result,
                Some(grant.channel_id),
                None,
            )
            .await
            .unwrap();
            assert!(control(&f, finished(&grant, &result)).await.1.accepted);
        }
    }
    let actual = f.db.workflow_actual_run(f.community, run).await.unwrap();
    assert_eq!(actual["origin"], "event");
    assert_eq!(actual["execution_state"], "completed");
    assert!(actual["deadline_at"].is_null());
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_mixed_targets_split_delivery_and_retain_legacy_fence() {
    let mut f = fixture().await;
    let old = Keys::generate();
    f.db.ensure_user(f.community, old.public_key().as_bytes())
        .await
        .unwrap();
    f.db.set_agent_owner(
        f.community,
        old.public_key().as_bytes(),
        f.owner.public_key().as_bytes(),
    )
    .await
    .unwrap();
    f.db.add_member(
        f.community,
        f.task.channel_id,
        old.public_key().as_bytes(),
        MemberRole::Bot,
        Some(f.owner.public_key().as_bytes()),
    )
    .await
    .unwrap();
    let run =
        f.db.create_workflow_run(f.community, f.workflow, None, None)
            .await
            .unwrap();
    let legacy = EventBuilder::new(Kind::Custom(46008), &f.task.text)
        .sign_with_keys(&f.relay)
        .unwrap();
    let targets = vec![f.agent.public_key().to_hex(), old.public_key().to_hex()];
    let first =
        f.db.queue_supervised_workflow_tasks(
            f.community,
            run,
            &f.task.step_id,
            f.task.channel_id,
            &targets,
            &legacy,
            &f.relay,
        )
        .await
        .unwrap();
    assert!(first.is_some());
    let repeated =
        f.db.queue_supervised_workflow_tasks(
            f.community,
            run,
            &f.task.step_id,
            f.task.channel_id,
            &targets,
            &legacy,
            &f.relay,
        )
        .await
        .unwrap();
    assert_eq!(first, repeated);
    let events:Vec<serde_json::Value>=sqlx::query_scalar("SELECT signed_event FROM workflow_run_outbox WHERE community_id=$1 AND run_id=$2 AND signed_event->>'kind'='46008'").bind(f.community.as_uuid()).bind(run).fetch_all(&f.db.pool).await.unwrap();
    assert_eq!(events.len(), 2);
    for value in events {
        let event: Event = serde_json::from_value(value).unwrap();
        let ready = exact_tag(&event, "p", &f.agent.public_key().to_hex());
        assert_eq!(exact_tag(&event, "workflow-protocol", "1"), ready);
        assert_eq!(
            event
                .tags
                .iter()
                .filter(|t| t.as_slice().first().is_some_and(|v| v == "p"))
                .count(),
            1
        );
    }
    let task:Uuid=sqlx::query_scalar("SELECT task_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND agent_pubkey=$3").bind(f.community.as_uuid()).bind(run).bind(f.agent.public_key().as_bytes().as_slice()).fetch_one(&f.db.pool).await.unwrap();
    let (_, receipt, _) = claim_attempt(&f, run, task).await;
    let grant = receipt.decision.unwrap();
    control(&f, started(&grant)).await;
    sqlx::query("UPDATE workflow_runs SET dispatch_complete=TRUE,status='completed' WHERE community_id=$1 AND id=$2").bind(f.community.as_uuid()).bind(run).execute(&f.db.pool).await.unwrap();
    let result = result_event(&f, &grant).await;
    f.db.insert_event_with_thread_metadata(f.community, &result, Some(grant.channel_id), None)
        .await
        .unwrap();
    assert!(control(&f, finished(&grant, &result)).await.1.accepted);
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "stalled"
    );
    let legacy_task:Uuid=sqlx::query_scalar("SELECT task_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND agent_pubkey=$3").bind(f.community.as_uuid()).bind(run).bind(old.public_key().as_bytes().as_slice()).fetch_one(&f.db.pool).await.unwrap();
    f.agent = old;
    f.instance = Uuid::new_v4();
    control(
        &f,
        ExecutionOperation::Capability {
            runtime_profile: "linux-uids-v1".into(),
            max_turn_duration_secs: 7200,
        },
    )
    .await;
    assert_eq!(
        claim_attempt(&f, run, legacy_task)
            .await
            .1
            .reason
            .as_deref(),
        Some("legacy_execution_unknown"),
        "new capability must never unlock an old ungranted task"
    );
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_mixed_steps_keep_supervised_completion_live() {
    let f = fixture().await;
    let run =
        f.db.create_workflow_run(f.community, f.workflow, None, None)
            .await
            .unwrap();
    let legacy = EventBuilder::new(Kind::Custom(46008), "Legacy first step")
        .sign_with_keys(&f.relay)
        .unwrap();
    f.db.persist_scheduled_workflow_task(
        f.community,
        &legacy,
        f.task.channel_id,
        run,
        "legacy-first",
        std::slice::from_ref(&f.task.agent_pubkey),
    )
    .await
    .unwrap();
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "stalled"
    );
    f.db.queue_supervised_workflow_tasks(
        f.community,
        run,
        "supervised",
        f.task.channel_id,
        std::slice::from_ref(&f.task.agent_pubkey),
        &legacy,
        &f.relay,
    )
    .await
    .unwrap()
    .unwrap();
    let task:Uuid=sqlx::query_scalar("SELECT task_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND step_id='supervised'").bind(f.community.as_uuid()).bind(run).fetch_one(&f.db.pool).await.unwrap();
    let (_, receipt, _) = claim_attempt(&f, run, task).await;
    let grant = receipt.decision.unwrap();
    assert!(control(&f, started(&grant)).await.1.accepted);
    let legacy = EventBuilder::new(Kind::Custom(46008), "Legacy next step")
        .sign_with_keys(&f.relay)
        .unwrap();
    f.db.persist_scheduled_workflow_task(
        f.community,
        &legacy,
        f.task.channel_id,
        run,
        "legacy-last",
        std::slice::from_ref(&f.task.agent_pubkey),
    )
    .await
    .unwrap();
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "running"
    );
    sqlx::query("UPDATE workflow_runs SET dispatch_complete=TRUE,status='completed' WHERE community_id=$1 AND id=$2").bind(f.community.as_uuid()).bind(run).execute(&f.db.pool).await.unwrap();
    let result = result_event(&f, &grant).await;
    f.db.insert_event_with_thread_metadata(f.community, &result, Some(grant.channel_id), None)
        .await
        .unwrap();
    assert!(control(&f, finished(&grant, &result)).await.1.accepted);
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "stalled"
    );
}

async fn recovery_claim(f: &Fixture, run: Uuid, task: Uuid) -> (ExecutionControl, Event) {
    let revision: i64 =
        sqlx::query_scalar("SELECT revision FROM workflow_runs WHERE community_id=$1 AND id=$2")
            .bind(f.community.as_uuid())
            .bind(run)
            .fetch_one(&f.db.pool)
            .await
            .unwrap();
    let original = ExecutionControl {
        version: 1,
        community_id: *f.community.as_uuid(),
        agent_pubkey: f.agent.public_key().to_hex(),
        instance_id: f.instance,
        operation: ExecutionOperation::Claim {
            run_id: run,
            task_id: task,
            channel_id: f.task.channel_id,
            revision,
            ephemeral_pubkey: Keys::generate().public_key().to_hex(),
        },
    };
    let event = EventBuilder::new(
        Kind::Custom(46040),
        serde_json::to_string(&original).unwrap(),
    )
    .tags([
        Tag::parse(["p", &original.agent_pubkey]).unwrap(),
        Tag::parse(["h", &f.task.channel_id.to_string()]).unwrap(),
        Tag::parse(["workflow-run", &run.to_string()]).unwrap(),
        Tag::parse(["workflow-task", &task.to_string()]).unwrap(),
    ])
    .allow_self_tagging()
    .custom_created_at(nostr::Timestamp::from_secs(1))
    .sign_with_keys(&f.agent)
    .unwrap();
    (original, event)
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_recover_claim_preserves_expired_revoked_grant_only_for_stop() {
    let f = fixture().await;
    let (run, task) = run(&f).await;
    let (original, event) = recovery_claim(&f, run, task).await;
    let accepted =
        f.db.workflow_execution_control(f.community, &event, &original, &f.relay)
            .await
            .unwrap();
    assert!(accepted.accepted);
    let decision = accepted.decision.as_ref().unwrap();
    sqlx::query("UPDATE workflow_run_attempts SET deadline_at=clock_timestamp()-interval '1 second' WHERE community_id=$1 AND grant_id=$2").bind(f.community.as_uuid()).bind(decision.grant_id).execute(&f.db.pool).await.unwrap();
    sqlx::query("UPDATE channel_members SET removed_at=clock_timestamp() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3").bind(f.community.as_uuid()).bind(f.task.channel_id).bind(f.agent.public_key().as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    f.db.workflow_execution_sweep(&f.relay).await.unwrap();
    let operation = ExecutionOperation::RecoverClaim {
        signed_claim: event.clone(),
    };
    let envelope = ExecutionControl {
        operation: operation.clone(),
        ..original.clone()
    };
    assert!(f
        .db
        .workflow_stop_authorized(f.community, &envelope)
        .await
        .unwrap());
    let (recovery_event, recovered) = control(&f, operation).await;
    assert!(recovered.accepted);
    assert_eq!(
        serde_json::to_value(&recovered).unwrap(),
        serde_json::to_value(&accepted).unwrap()
    );
    assert_eq!(
        f.db.workflow_execution_control(f.community, &event, &original, &f.relay)
            .await
            .unwrap()
            .reason
            .as_deref(),
        Some("grant_inactive")
    );
    assert!(
        control(&f, stopped(decision, StopReason::RecoveryStopped))
            .await
            .1
            .accepted
    );
    let replay =
        f.db.workflow_execution_control(f.community, &recovery_event, &envelope, &f.relay)
            .await
            .unwrap();
    assert_eq!(
        replay.signed_event.unwrap().id,
        accepted.signed_event.unwrap().id
    );
    let attempts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(attempts, 1);
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_recover_absent_claim_tombstones_delayed_concurrent_requests() {
    let f = fixture().await;
    let (run, task) = run(&f).await;
    let (original, event) = recovery_claim(&f, run, task).await;
    let (_, recovered) = control(
        &f,
        ExecutionOperation::RecoverClaim {
            signed_claim: event.clone(),
        },
    )
    .await;
    assert!(recovered.accepted);
    assert_eq!(recovered.reason.as_deref(), Some("no_grant"));
    assert!(recovered.decision.is_none());
    let f = std::sync::Arc::new(f);
    let mut jobs = Vec::new();
    for _ in 0..25 {
        let f = f.clone();
        let event = event.clone();
        let original = original.clone();
        jobs.push(tokio::spawn(async move {
            f.db.workflow_execution_control(f.community, &event, &original, &f.relay)
                .await
                .unwrap()
        }));
    }
    for job in jobs {
        assert_eq!(
            job.await.unwrap().reason.as_deref(),
            Some("claim_recovered_without_grant")
        );
    }
    let attempts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(attempts, 0);
    let caps: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_execution_capabilities WHERE community_id=$1",
    )
    .bind(f.community.as_uuid())
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(caps, 1);
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_recover_claim_rejects_forgery_and_wrong_original_scope() {
    let f = fixture().await;
    let (run, task) = run(&f).await;
    let (_, event) = recovery_claim(&f, run, task).await;
    let mut forged = event.clone();
    forged.content.push(' ');
    assert_eq!(
        control(
            &f,
            ExecutionOperation::RecoverClaim {
                signed_claim: forged
            }
        )
        .await
        .1
        .reason
        .as_deref(),
        Some("invalid_recovery_claim")
    );
    let mut original: ExecutionControl = serde_json::from_str(&event.content).unwrap();
    original.instance_id = Uuid::new_v4();
    let wrong_instance = EventBuilder::new(event.kind, serde_json::to_string(&original).unwrap())
        .tags(event.tags.clone())
        .allow_self_tagging()
        .sign_with_keys(&f.agent)
        .unwrap();
    assert_eq!(
        control(
            &f,
            ExecutionOperation::RecoverClaim {
                signed_claim: wrong_instance
            }
        )
        .await
        .1
        .reason
        .as_deref(),
        Some("invalid_recovery_claim")
    );
    let (original, absent_task) = recovery_claim(&f, run, Uuid::new_v4()).await;
    let envelope = ExecutionControl {
        operation: ExecutionOperation::RecoverClaim {
            signed_claim: absent_task.clone(),
        },
        ..original
    };
    assert!(!f
        .db
        .workflow_stop_authorized(f.community, &envelope)
        .await
        .unwrap());
    assert_eq!(
        control(&f, envelope.operation).await.1.reason.as_deref(),
        Some("invalid_recovery_claim")
    );
    sqlx::query(
        "UPDATE workflow_run_tasks SET agent_pubkey=$3 WHERE community_id=$1 AND task_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(task)
    .bind(f.owner.public_key().as_bytes().as_slice())
    .execute(&f.db.pool)
    .await
    .unwrap();
    let original: ExecutionControl = serde_json::from_str(&event.content).unwrap();
    let envelope = ExecutionControl {
        operation: ExecutionOperation::RecoverClaim {
            signed_claim: event,
        },
        ..original
    };
    assert!(!f
        .db
        .workflow_stop_authorized(f.community, &envelope)
        .await
        .unwrap());
    assert_eq!(
        control(&f, envelope.operation).await.1.reason.as_deref(),
        Some("invalid_recovery_claim")
    );
    let receipts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_execution_receipts WHERE community_id=$1",
    )
    .bind(f.community.as_uuid())
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(receipts, 0);
}

async fn recovery_ordinary_run(f: &Fixture, origin: &str) -> (Uuid, Uuid) {
    if origin == "event" {
        let definition = serde_json::json!({"name":"Recovery event brief","trigger":{"on":"message_posted"},"steps":[{"id":f.task.step_id,"action":"send_message","text":f.task.text,"agent_targets":[f.task.agent_pubkey]}]}).to_string();
        f.db.upsert_workflow(
            f.community,
            f.workflow,
            Some(f.task.channel_id),
            f.owner.public_key().as_bytes(),
            "Recovery event brief",
            &definition,
            &Sha256::digest(definition.as_bytes()),
        )
        .await
        .unwrap();
    }
    let run =
        f.db.create_workflow_run(f.community, f.workflow, None, None)
            .await
            .unwrap();
    let legacy = EventBuilder::new(Kind::Custom(46008), &f.task.text)
        .sign_with_keys(&f.relay)
        .unwrap();
    f.db.queue_supervised_workflow_tasks(
        f.community,
        run,
        &f.task.step_id,
        f.task.channel_id,
        std::slice::from_ref(&f.task.agent_pubkey),
        &legacy,
        &f.relay,
    )
    .await
    .unwrap()
    .unwrap();
    sqlx::query("UPDATE workflow_runs SET dispatch_complete=TRUE,status='completed' WHERE community_id=$1 AND id=$2")
        .bind(f.community.as_uuid()).bind(run).execute(&f.db.pool).await.unwrap();
    let task: Uuid = sqlx::query_scalar(
        "SELECT task_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    let actual = f.db.workflow_actual_run(f.community, run).await.unwrap();
    assert_eq!(actual["origin"], origin);
    assert!(actual["deadline_at"].is_null());
    (run, task)
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_recover_no_grant_ordinary_run_finishes_without_execution() {
    for origin in ["scheduled", "event"] {
        let f = fixture().await;
        let (run, task) = recovery_ordinary_run(&f, origin).await;
        let (original, event) = recovery_claim(&f, run, task).await;
        let (_, recovered) = control(
            &f,
            ExecutionOperation::RecoverClaim {
                signed_claim: event.clone(),
            },
        )
        .await;
        assert!(recovered.accepted);
        assert_eq!(recovered.reason.as_deref(), Some("no_grant"));
        f.db.workflow_execution_sweep(&f.relay).await.unwrap();
        let actual = f.db.workflow_actual_run(f.community, run).await.unwrap();
        assert_eq!(
            actual["execution_state"], "failed",
            "{origin} must not remain queued forever after the runner retires a no-grant task"
        );
        let attempts: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
        )
        .bind(f.community.as_uuid())
        .bind(run)
        .fetch_one(&f.db.pool)
        .await
        .unwrap();
        assert_eq!(attempts, 0);
        assert_eq!(
            f.db.workflow_execution_control(f.community, &event, &original, &f.relay)
                .await
                .unwrap()
                .reason
                .as_deref(),
            Some("claim_recovered_without_grant")
        );
        assert!(!claim_attempt(&f, run, task).await.1.accepted);
    }
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_recover_no_grant_preserves_other_valid_attempt() {
    for origin in ["scheduled", "event"] {
        let f = fixture().await;
        let (run, task) = recovery_ordinary_run(&f, origin).await;
        let (_, absent_claim) = recovery_claim(&f, run, task).await;
        let (_, granted, _) = claim_attempt(&f, run, task).await;
        let grant = granted.decision.unwrap();
        let (_, recovered) = control(
            &f,
            ExecutionOperation::RecoverClaim {
                signed_claim: absent_claim,
            },
        )
        .await;
        assert!(recovered.accepted);
        assert_eq!(recovered.reason.as_deref(), Some("no_grant"));
        f.db.workflow_execution_sweep(&f.relay).await.unwrap();
        assert_eq!(
            f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
            "running"
        );
        let live: bool = sqlx::query_scalar("SELECT stopped_at IS NULL FROM workflow_run_attempts WHERE community_id=$1 AND grant_id=$2")
            .bind(f.community.as_uuid()).bind(grant.grant_id).fetch_one(&f.db.pool).await.unwrap();
        assert!(
            live,
            "{origin} recovery of a different claim must not cancel the valid attempt"
        );
        let cancel_count: i64 = sqlx::query_scalar("SELECT count(*) FROM workflow_run_outbox WHERE community_id=$1 AND run_id=$2 AND signed_event->>'kind'='46041' AND (signed_event->>'content')::jsonb->>'decision'='cancel'")
            .bind(f.community.as_uuid()).bind(run).fetch_one(&f.db.pool).await.unwrap();
        assert_eq!(cancel_count, 0);
    }
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_recover_denied_retry_after_verified_stop_finishes_task() {
    let f = fixture().await;
    let (run, task) = recovery_ordinary_run(&f, "event").await;
    let (_, granted, _) = claim_attempt(&f, run, task).await;
    assert!(
        control(
            &f,
            stopped(&granted.decision.unwrap(), StopReason::ExecutionFailed)
        )
        .await
        .1
        .accepted
    );
    let (original, event) = recovery_claim(&f, run, task).await;
    sqlx::query("UPDATE workflow_execution_capabilities SET expires_at=clock_timestamp()-interval '1 second' WHERE community_id=$1").bind(f.community.as_uuid()).execute(&f.db.pool).await.unwrap();
    let denied =
        f.db.workflow_execution_control(f.community, &event, &original, &f.relay)
            .await
            .unwrap();
    assert_eq!(denied.reason.as_deref(), Some("runner_unavailable"));
    let (_, recovered) = control(
        &f,
        ExecutionOperation::RecoverClaim {
            signed_claim: event,
        },
    )
    .await;
    assert_eq!(recovered.reason.as_deref(), Some("no_grant"));
    assert_eq!(
        f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
        "failed"
    );
    let attempts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(attempts, 1);
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_recover_no_grant_preserves_completed_and_unknown_tasks() {
    for state in ["completed", "stalled", "legacy_queued", "stalled_run"] {
        let f = fixture().await;
        let (run, task) = recovery_ordinary_run(&f, "scheduled").await;
        let (_, event) = recovery_claim(&f, run, task).await;
        let task_state = if matches!(state, "legacy_queued" | "stalled_run") {
            "queued"
        } else {
            state
        };
        sqlx::query("UPDATE workflow_run_tasks SET state=$3 WHERE community_id=$1 AND task_id=$2")
            .bind(f.community.as_uuid())
            .bind(task)
            .bind(task_state)
            .execute(&f.db.pool)
            .await
            .unwrap();
        if state == "legacy_queued" {
            sqlx::query("DELETE FROM workflow_run_outbox WHERE community_id=$1 AND run_id=$2")
                .bind(f.community.as_uuid())
                .bind(run)
                .execute(&f.db.pool)
                .await
                .unwrap();
        }
        if state == "stalled_run" {
            sqlx::query("UPDATE workflow_runs SET execution_state='stalled',safe_error_code='legacy_execution_unknown' WHERE community_id=$1 AND id=$2").bind(f.community.as_uuid()).bind(run).execute(&f.db.pool).await.unwrap();
        }
        let before = f.db.workflow_actual_run(f.community, run).await.unwrap();
        assert_eq!(
            control(
                &f,
                ExecutionOperation::RecoverClaim {
                    signed_claim: event
                }
            )
            .await
            .1
            .reason
            .as_deref(),
            Some("no_grant")
        );
        let after = f.db.workflow_actual_run(f.community, run).await.unwrap();
        assert_eq!(before, after, "must preserve {state} evidence");
        let after_task: String = sqlx::query_scalar(
            "SELECT state FROM workflow_run_tasks WHERE community_id=$1 AND task_id=$2",
        )
        .bind(f.community.as_uuid())
        .bind(task)
        .fetch_one(&f.db.pool)
        .await
        .unwrap();
        assert_eq!(after_task, task_state);
    }
}

#[tokio::test]
#[ignore = "requires isolated Postgres"]
async fn workflow_execution_recover_no_grant_races_different_claim_without_cancelling_winner() {
    let f = fixture().await;
    let (run, task) = recovery_ordinary_run(&f, "event").await;
    let (_, absent_claim) = recovery_claim(&f, run, task).await;
    let (recovery, claim) = tokio::join!(
        control(
            &f,
            ExecutionOperation::RecoverClaim {
                signed_claim: absent_claim
            }
        ),
        claim_attempt(&f, run, task)
    );
    assert_eq!(recovery.1.reason.as_deref(), Some("no_grant"));
    let actual = f.db.workflow_actual_run(f.community, run).await.unwrap();
    if claim.1.accepted {
        assert_eq!(actual["execution_state"], "running");
        let live: bool = sqlx::query_scalar("SELECT stopped_at IS NULL FROM workflow_run_attempts WHERE community_id=$1 AND grant_id=$2").bind(f.community.as_uuid()).bind(claim.1.decision.unwrap().grant_id).fetch_one(&f.db.pool).await.unwrap();
        assert!(live);
    } else {
        assert_eq!(actual["execution_state"], "failed");
        let attempts: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2",
        )
        .bind(f.community.as_uuid())
        .bind(run)
        .fetch_one(&f.db.pool)
        .await
        .unwrap();
        assert_eq!(attempts, 0);
    }
    let cancellations: i64 = sqlx::query_scalar("SELECT count(*) FROM workflow_run_outbox WHERE community_id=$1 AND run_id=$2 AND signed_event->>'kind'='46041' AND (signed_event->>'content')::jsonb->>'decision'='cancel'").bind(f.community.as_uuid()).bind(run).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(cancellations, 0);
}
