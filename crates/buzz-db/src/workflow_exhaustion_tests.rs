//! Exhaustion uses accepted stop evidence, never a runner's local status.
use super::*;

async fn failed_attempts(f: &Fixture, run: Uuid, task: Uuid, count: usize) -> ExecutionDecision {
    let mut last = None;
    for _ in 0..count {
        let (_, receipt, _) = claim_attempt(f, run, task).await;
        assert!(receipt.accepted, "{:?}", receipt.reason);
        let grant = receipt.decision.unwrap();
        assert!(control(f, started(&grant)).await.1.accepted);
        assert!(
            control(f, stopped(&grant, StopReason::ExecutionFailed))
                .await
                .1
                .accepted
        );
        last = Some(grant);
    }
    last.unwrap()
}

async fn task_state(f: &Fixture, run: Uuid, task: Uuid) -> String {
    sqlx::query_scalar(
        "SELECT state FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND task_id=$3",
    )
    .bind(f.community.as_uuid())
    .bind(run)
    .bind(task)
    .fetch_one(&f.db.pool)
    .await
    .unwrap()
}

async fn restore_legacy_queue(f: &Fixture, run: Uuid, task: Uuid) {
    // Model the pre-fix relay's durable state; no attempt evidence is changed.
    sqlx::query("UPDATE workflow_run_tasks SET state='queued',attempt_count=0 WHERE community_id=$1 AND run_id=$2 AND task_id=$3")
        .bind(f.community.as_uuid()).bind(run).bind(task).execute(&f.db.pool).await.unwrap();
    sqlx::query("UPDATE workflow_runs SET execution_state='running',safe_error_code=NULL WHERE community_id=$1 AND id=$2")
        .bind(f.community.as_uuid()).bind(run).execute(&f.db.pool).await.unwrap();
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn ordinary_exhaustion_ten_stops_terminalize_nine_allow_retry() {
    for origin in ["scheduled", "event"] {
        let f = fixture().await;
        let (run, task) = recovery_ordinary_run(&f, origin).await;
        failed_attempts(&f, run, task, 9).await;
        assert_eq!(task_state(&f, run, task).await, "queued");
        let last = failed_attempts(&f, run, task, 1).await;
        assert_eq!(task_state(&f, run, task).await, "failed");
        let actual = f.db.workflow_actual_run(f.community, run).await.unwrap();
        assert_eq!(actual["execution_state"], "failed");
        assert_eq!(actual["safe_error_code"], "execution_failed");
        let before: Vec<(i32, Option<DateTime<Utc>>, Option<String>)> = sqlx::query_as("SELECT ordinal,stopped_at,outcome FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2 ORDER BY ordinal")
            .bind(f.community.as_uuid()).bind(run).fetch_all(&f.db.pool).await.unwrap();
        assert!(
            control(&f, stopped(&last, StopReason::RecoveryStopped))
                .await
                .1
                .accepted
        );
        restore_legacy_queue(&f, run, task).await;
        // A claim cannot allocate an eleventh attempt before the periodic sweep.
        let denied = claim_attempt(&f, run, task).await.1;
        assert!(!denied.accepted);
        assert_eq!(denied.reason.as_deref(), Some("no_more_attempts"));
        f.db.workflow_execution_sweep(&f.relay).await.unwrap();
        assert_eq!(task_state(&f, run, task).await, "failed");
        let revision: i64 = sqlx::query_scalar(
            "SELECT revision FROM workflow_runs WHERE community_id=$1 AND id=$2",
        )
        .bind(f.community.as_uuid())
        .bind(run)
        .fetch_one(&f.db.pool)
        .await
        .unwrap();
        f.db.workflow_execution_sweep(&f.relay).await.unwrap();
        let after_revision: i64 = sqlx::query_scalar(
            "SELECT revision FROM workflow_runs WHERE community_id=$1 AND id=$2",
        )
        .bind(f.community.as_uuid())
        .bind(run)
        .fetch_one(&f.db.pool)
        .await
        .unwrap();
        assert_eq!(revision, after_revision);
        let after: Vec<(i32, Option<DateTime<Utc>>, Option<String>)> = sqlx::query_as("SELECT ordinal,stopped_at,outcome FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2 ORDER BY ordinal")
            .bind(f.community.as_uuid()).bind(run).fetch_all(&f.db.pool).await.unwrap();
        assert_eq!(before, after);
    }
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn ordinary_exhaustion_refuses_unsettled_or_successful_evidence() {
    for counterexample in ["active", "unsettled", "unknown", "completed", "result"] {
        let f = fixture().await;
        let (run, task) = recovery_ordinary_run(&f, "event").await;
        let last = failed_attempts(&f, run, task, 10).await;
        restore_legacy_queue(&f, run, task).await;
        match counterexample {
            "active" => {
                sqlx::query("UPDATE workflow_run_attempts SET stopped_at=NULL,outcome=NULL WHERE community_id=$1 AND grant_id=$2")
                .bind(f.community.as_uuid()).bind(last.grant_id).execute(&f.db.pool).await.unwrap();
            }
            "unsettled" => {
                sqlx::query("UPDATE workflow_run_attempts SET outcome=NULL WHERE community_id=$1 AND grant_id=$2")
                .bind(f.community.as_uuid()).bind(last.grant_id).execute(&f.db.pool).await.unwrap();
            }
            "completed" => {
                sqlx::query("UPDATE workflow_run_attempts SET outcome='completed' WHERE community_id=$1 AND grant_id=$2")
                .bind(f.community.as_uuid()).bind(last.grant_id).execute(&f.db.pool).await.unwrap();
            }
            "unknown" => {
                sqlx::query("UPDATE workflow_run_attempts SET outcome='unknown' WHERE community_id=$1 AND grant_id=$2")
                .bind(f.community.as_uuid()).bind(last.grant_id).execute(&f.db.pool).await.unwrap();
            }
            "result" => {
                sqlx::query("UPDATE workflow_run_tasks SET result_event_id=$4 WHERE community_id=$1 AND run_id=$2 AND task_id=$3")
                .bind(f.community.as_uuid()).bind(run).bind(task).bind(vec![1_u8; 32]).execute(&f.db.pool).await.unwrap();
            }
            _ => unreachable!(),
        }
        f.db.workflow_execution_sweep(&f.relay).await.unwrap();
        assert_eq!(
            task_state(&f, run, task).await,
            "queued",
            "{counterexample}"
        );
        assert_eq!(
            f.db.workflow_actual_run(f.community, run).await.unwrap()["execution_state"],
            "running",
            "{counterexample}"
        );
    }
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn ordinary_exhaustion_ignores_cached_count_and_other_communities() {
    let f = fixture().await;
    let (run, task) = recovery_ordinary_run(&f, "scheduled").await;
    failed_attempts(&f, run, task, 9).await;
    sqlx::query("UPDATE workflow_run_tasks SET attempt_count=10 WHERE community_id=$1 AND run_id=$2 AND task_id=$3")
        .bind(f.community.as_uuid()).bind(run).bind(task).execute(&f.db.pool).await.unwrap();
    let mut tx =
        f.db.begin_event_write_transaction(f.community)
            .await
            .unwrap();
    lock_admission(tx.conn(), f.community).await.unwrap();
    assert!(reconcile(
        &mut tx,
        CommunityId::from_uuid(Uuid::new_v4()),
        run,
        &f.relay
    )
    .await
    .is_err());
    drop(tx);
    f.db.workflow_execution_sweep(&f.relay).await.unwrap();
    assert_eq!(task_state(&f, run, task).await, "queued");
    assert!(claim_attempt(&f, run, task).await.1.accepted);
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn ordinary_exhaustion_counts_tasks_separately_and_fences_racing_claim() {
    let f = fixture().await;
    let (run, task) = recovery_ordinary_run(&f, "event").await;
    failed_attempts(&f, run, task, 9).await;
    let other = Uuid::new_v4();
    sqlx::query("INSERT INTO workflow_run_tasks(community_id,run_id,task_id,step_id,agent_pubkey,channel_id,state) SELECT community_id,run_id,$4,'other',agent_pubkey,channel_id,'completed' FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND task_id=$3")
        .bind(f.community.as_uuid()).bind(run).bind(task).bind(other).execute(&f.db.pool).await.unwrap();
    // Stopped historical grants for another task must not spend this task's budget.
    sqlx::query("INSERT INTO workflow_run_attempts(community_id,run_id,ordinal,task_id,grant_id,instance_id,deadline_at,stopped_at,outcome) SELECT community_id,run_id,n,$4,gen_random_uuid(),instance_id,deadline_at,stopped_at,outcome FROM workflow_run_attempts CROSS JOIN generate_series(10,19) n WHERE community_id=$1 AND run_id=$2 AND task_id=$3 AND ordinal=1")
        .bind(f.community.as_uuid()).bind(run).bind(task).bind(other).execute(&f.db.pool).await.unwrap();
    let last = failed_attempts(&f, run, task, 1).await;
    assert_eq!(last.ordinal, 20);
    restore_legacy_queue(&f, run, task).await;
    let (claim, sweep) = tokio::join!(
        claim_attempt(&f, run, task),
        f.db.workflow_execution_sweep(&f.relay)
    );
    assert!(!claim.1.accepted);
    sweep.unwrap();
    assert_eq!(task_state(&f, run, task).await, "failed");
    assert_eq!(task_state(&f, run, other).await, "completed");
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflow_run_attempts WHERE community_id=$1 AND run_id=$2 AND task_id=$3")
        .bind(f.community.as_uuid()).bind(run).bind(task).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(count, 10);
}
