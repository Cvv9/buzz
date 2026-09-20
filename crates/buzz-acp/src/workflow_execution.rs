//! Dedicated, journaled workflow execution. No task enters conversation batching.
use crate::{
    acp::{AcpClient, AcpError, EnvVar, McpServer},
    config::Config,
    failover::{FailoverPolicy, SpawnPlan},
    relay::RestClient,
    runtime_defaults::PendingRuntimeRevision,
    workflow_isolation::Isolation,
    workflow_journal::{Attempt, Journal, Phase, ProcessIdentity, TaskRecord},
};
use anyhow::{bail, Context, Result};
use buzz_core::workflow_execution::{
    DecisionKind, ExecutionControl, ExecutionDecision, ExecutionOperation, StopReason,
    PROTOCOL_VERSION,
};
use nostr::{Event, EventBuilder, Keys, Kind, PublicKey, Tag};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{mpsc, watch, Mutex, Semaphore};
use uuid::Uuid;

const PATCH_HASH: &str = "eadb92f996c2bca4b1cd7c09a79fa80e817329d7ac0d79d39ce4aeaf752d842d";
const RPC_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Task {
    id: Uuid,
    run: Uuid,
    workflow: Uuid,
    channel: Uuid,
    step: String,
    origin: String,
    deadline: Option<i64>,
    revision: i64,
    event: Event,
}

fn tag(event: &Event, name: &str) -> Result<String> {
    let values: Vec<_> = event
        .tags
        .iter()
        .filter(|tag| tag.as_slice().first().map(String::as_str) == Some(name))
        .collect();
    if values.len() != 1 || values[0].as_slice().len() != 2 {
        bail!("ambiguous workflow envelope tag");
    }
    Ok(values[0].as_slice()[1].clone())
}

fn optional_tag(event: &Event, name: &str) -> Result<Option<String>> {
    if !event
        .tags
        .iter()
        .any(|value| value.as_slice().first().is_some_and(|key| key == name))
    {
        return Ok(None);
    }
    tag(event, name).map(Some)
}

impl Task {
    fn parse(event: Event, relay: &PublicKey, agent: &PublicKey, community: Uuid) -> Result<Self> {
        event.verify()?;
        if event.kind.as_u16() != 46008
            || event.pubkey != *relay
            || tag(&event, "p")? != agent.to_hex()
            || tag(&event, "workflow-protocol")? != "1"
            || tag(&event, "workflow-community")? != community.to_string()
        {
            bail!("untrusted workflow envelope");
        }
        let origin = tag(&event, "workflow-origin")?;
        if !matches!(origin.as_str(), "manual" | "scheduled" | "event") {
            bail!("invalid workflow origin");
        }
        let deadline = optional_tag(&event, "workflow-deadline")?
            .map(|value| value.parse())
            .transpose()?;
        if origin == "manual" && deadline.is_none() {
            bail!("manual task missing absolute deadline");
        }
        let revision = optional_tag(&event, "workflow-revision")?
            .map(|value| value.parse::<i64>())
            .transpose()?
            .unwrap_or(1);
        let hash = tag(&event, "workflow-definition")?;
        if revision < 1 || hex::decode(hash)?.len() != 32 || event.content.trim().is_empty() {
            bail!("invalid workflow task");
        }
        if event.created_at.as_secs() as i64 > chrono::Utc::now().timestamp() + 5 {
            bail!("future workflow event");
        }
        Ok(Self {
            id: tag(&event, "workflow-task")?.parse()?,
            run: tag(&event, "workflow-run")?.parse()?,
            workflow: tag(&event, "buzz:workflow")?.parse()?,
            channel: tag(&event, "h")?.parse()?,
            step: tag(&event, "workflow-step")?,
            origin,
            deadline,
            revision,
            event,
        })
    }
    fn expired(&self) -> bool {
        self.deadline
            .is_some_and(|deadline| deadline <= chrono::Utc::now().timestamp())
    }
}

struct Runtime {
    isolation: Isolation,
    rest: RestClient,
    keys: Keys,
    relay: PublicKey,
    community: Uuid,
    instance: Uuid,
    command: String,
    primary: SpawnPlan,
    fallback: SpawnPlan,
    policy: FailoverPolicy,
    mcp: Vec<McpServer>,
    relay_url: String,
    idle: Duration,
    system_prompt: Option<String>,
    max_turn: u64,
    journal: Mutex<Journal>,
    serial: Semaphore,
    busy: Arc<AtomicUsize>,
    stalled: AtomicBool,
    revisions: watch::Receiver<Option<PendingRuntimeRevision>>,
    requires_revision: bool,
    stop: watch::Sender<bool>,
}

pub(crate) struct WorkflowRuntime {
    incoming: mpsc::Sender<Event>,
    busy: Arc<AtomicUsize>,
    revision: watch::Sender<Option<PendingRuntimeRevision>>,
    stop: watch::Sender<bool>,
    worker: tokio::task::JoinHandle<()>,
}

impl WorkflowRuntime {
    pub async fn start(
        config: &Config,
        rest: RestClient,
        relay_self: Option<&str>,
    ) -> Result<Option<Self>> {
        let Some(isolation) = Isolation::configured()? else {
            return Ok(None);
        };
        isolation.verify().await?;
        verify_adapter(&config.agent_command)?;
        let community: Uuid = std::env::var("BUZZ_ACP_WORKFLOW_COMMUNITY_ID")
            .context("missing workflow community pin")?
            .parse()?;
        let relay = PublicKey::from_hex(
            &std::env::var("BUZZ_ACP_WORKFLOW_RELAY_PUBKEY")
                .context("missing workflow relay signer pin")?,
        )?;
        if relay_self != Some(relay.to_hex().as_str()) {
            bail!("workflow relay signer pin does not match connected relay");
        }
        let journal = Journal::open(&isolation.state_dir)?;
        let (incoming, rx) = mpsc::channel(64);
        let (revision, revisions) = watch::channel(None);
        let (stop, stop_rx) = watch::channel(false);
        let busy = Arc::new(AtomicUsize::new(0));
        let runtime = Arc::new(Runtime {
            isolation,
            rest,
            keys: config.keys.clone(),
            relay,
            community,
            instance: Uuid::new_v4(),
            command: config.agent_command.clone(),
            primary: crate::failover::spawn_plan(config, false),
            fallback: crate::failover::spawn_plan(config, true),
            policy: config.failover.clone(),
            mcp: crate::build_mcp_servers(config),
            relay_url: config.relay_url.clone(),
            idle: Duration::from_secs(config.idle_timeout_secs),
            system_prompt: config.system_prompt.clone(),
            max_turn: config.max_turn_duration_secs,
            journal: Mutex::new(journal),
            serial: Semaphore::new(1),
            busy: busy.clone(),
            stalled: AtomicBool::new(false),
            revisions,
            requires_revision: config.runtime_controller_pubkey.is_some(),
            stop: stop.clone(),
        });
        let worker = tokio::spawn(async move {
            if let Err(error) = runtime.serve(rx, stop_rx).await {
                tracing::error!("supervised workflow runtime stopped: {error}");
            }
        });
        Ok(Some(Self {
            incoming,
            busy,
            revision,
            stop,
            worker,
        }))
    }
    pub fn enqueue(&self, event: Event) {
        if self.incoming.try_send(event).is_err() {
            tracing::warn!("workflow receive queue full; durable relay outbox will redeliver");
        }
    }
    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst) > 0
    }
    pub fn update_revision(&self, revision: Option<PendingRuntimeRevision>) {
        self.revision.send_if_modified(|old| {
            if *old == revision {
                false
            } else {
                *old = revision;
                true
            }
        });
    }
    pub async fn shutdown(self) {
        let _ = self.stop.send(true);
        let _ = self.worker.await;
    }
}

/// Every protocol-v1 task is quarantined from the ordinary ten-retry queue,
/// including on unsupported native clients. Supervised profiles also fence old
/// ungranted tasks so rollout cannot resurrect untracked legacy work.
pub(crate) fn intercepts(event: &Event, supervisor: bool) -> bool {
    (event.kind.as_u16() == 46008
        && (supervisor
            || event.tags.iter().any(|t| {
                t.as_slice()
                    .first()
                    .is_some_and(|s| s == "workflow-protocol")
            })))
        || (supervisor && event.kind.as_u16() == 46041)
}

fn verify_adapter(command: &str) -> Result<()> {
    if crate::config::normalize_agent_command_identity(command) != "codex-acp" {
        bail!("workflow adapter has not passed structured-error certification");
    }
    let bundle =
        Path::new("/usr/local/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js");
    let selected = if Path::new(command).is_absolute() {
        std::path::PathBuf::from(command)
    } else {
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|p| p.join(command))
            .find(|p| p.is_file())
            .context("ACP binary missing")?
    };
    if std::fs::canonicalize(selected)? != std::fs::canonicalize(bundle)? {
        bail!("workflow adapter path does not match certified artifact");
    }
    let marker: serde_json::Value = serde_json::from_reader(std::fs::File::open(
        "/etc/buzz/codex-acp-terminal-errors.json",
    )?)?;
    if marker["patch"] != "terminal-errors-v1"
        || marker["version"] != "1.1.14"
        || marker["bundle_sha256"] != PATCH_HASH
        || hex::encode(Sha256::digest(std::fs::read(bundle)?)) != PATCH_HASH
    {
        bail!("workflow adapter structured-error artifact mismatch");
    }
    Ok(())
}

impl Runtime {
    fn control(&self, instance: Uuid, operation: ExecutionOperation) -> Result<Event> {
        Ok(
            buzz_sdk::build_workflow_execution_control(&ExecutionControl {
                version: PROTOCOL_VERSION,
                community_id: self.community,
                agent_pubkey: self.keys.public_key().to_hex(),
                instance_id: instance,
                operation,
            })?
            .sign_with_keys(&self.keys)?,
        )
    }
    async fn submit(&self, event: &Event) -> Result<serde_json::Value> {
        let (status, value) =
            tokio::time::timeout(RPC_TIMEOUT, self.rest.submit_execution_receipt(event)).await??;
        if status == 429 || status >= 500 {
            bail!("workflow relay temporarily unavailable");
        }
        let message = value
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let mut payload = message
            .strip_prefix("response:")
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .unwrap_or_else(|| value.clone());
        if !payload.is_object() {
            payload = serde_json::json!({"accepted":false});
        }
        if !(200..300).contains(&status)
            || value.get("accepted").and_then(serde_json::Value::as_bool) != Some(true)
        {
            payload["accepted"] = false.into();
        }
        Ok(payload)
    }
    async fn receipt(&self, event: &Event) -> Result<()> {
        let result = self.submit(event).await?;
        if result.get("accepted").and_then(serde_json::Value::as_bool) == Some(false) {
            bail!("workflow receipt rejected");
        }
        Ok(())
    }
    async fn ready_to_renew(&self) -> bool {
        if verify_adapter(&self.command).is_err() {
            return false;
        }
        if self.busy.load(Ordering::SeqCst) > 0 {
            return true;
        }
        let Ok(_permit) = self.serial.try_acquire() else {
            return false;
        };
        self.isolation.verify().await.is_ok()
    }
    async fn serve(
        self: Arc<Self>,
        mut incoming: mpsc::Receiver<Event>,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<()> {
        self.recover().await?;
        let mut workers = tokio::task::JoinSet::new();
        let mut cancel = HashMap::<Uuid, watch::Sender<Option<ExecutionDecision>>>::new();
        let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
        let mut poll = tokio::time::interval(Duration::from_secs(3));
        let outcome: Result<()> = async {
        loop {
            let events = tokio::select! {
                _=shutdown.changed()=>break,
                _=heartbeat.tick()=>{
                    if !self.stalled.load(Ordering::SeqCst) && !self.recovery_pending().await && (!self.requires_revision || self.revisions.borrow().is_some()) {
                        // Revalidate mutable deployment files before refreshing readiness.
                        if self.ready_to_renew().await {
                            let event=self.control(self.instance,ExecutionOperation::Capability { runtime_profile: crate::workflow_isolation::PROFILE.into(), max_turn_duration_secs:self.max_turn })?;
                            if self.receipt(&event).await.is_err(){tracing::warn!("workflow capability renewal unavailable");}
                        }
                    }
                    self.retry_claim_recovery().await?;
                    self.retry_receipts().await?;
                    Vec::new()
                },
                _=poll.tick()=>{
                    // Repair missing WS delivery and receive relay cancellations even
                    // while a conversation is blocking the harness main loop.
                    let filter=serde_json::from_value(serde_json::json!({"kinds":[46008,46041],"#p":[self.keys.public_key().to_hex()],"since":chrono::Utc::now().timestamp()-86_400,"limit":200}))?;
                    match tokio::time::timeout(RPC_TIMEOUT,self.rest.query(&[filter])).await {
                        Ok(Ok(values))=>values.as_array().into_iter().flatten().filter_map(|v|serde_json::from_value(v.clone()).ok()).collect(),
                        _=>Vec::new(),
                    }
                },
                event=incoming.recv()=>match event{Some(event)=>vec![event],None=>break},
                result=workers.join_next(),if !workers.is_empty()=>{match result {Some(Ok(task_id))=>{cancel.remove(&task_id);},Some(Err(error))=>tracing::error!("workflow task panicked; journal retains execution lock: {error}"),None=>{}} Vec::new()},
            };
            for event in events {
                if event.kind.as_u16() == 46041 {
                    if let Ok(decision) = self.cancel_decision(&event) {
                        if let Some(sender) = cancel.get(&decision.task_id) {
                            let _ = sender.send(Some(decision));
                        }
                    }
                    continue;
                }
                let Ok(task) =
                    Task::parse(event, &self.relay, &self.keys.public_key(), self.community)
                else {
                    continue;
                };
                let mut journal = self.journal.lock().await;
                if cancel.contains_key(&task.id) {
                    continue;
                }
                if let Some(record) = journal.tasks.get(&task.id) {
                    if !record.can_claim(task.origin == "manual") {
                        continue;
                    }
                } else {
                    journal.tasks.insert(
                        task.id,
                        TaskRecord {
                            event: task.event.clone(),
                            attempts: Vec::new(),
                            terminal: task.expired(),
                            fallback: false,
                        },
                    );
                }
                journal.save()?;
                drop(journal);
                if task.expired() {
                    continue;
                }
                let (sender, receiver) = watch::channel(None);
                cancel.insert(task.id, sender);
                let runtime = self.clone();
                let stopped = shutdown.clone();
                workers.spawn(async move {
                    let task_id=task.id;
                    if let Err(error) = runtime.execute(task, receiver, stopped).await {
                        tracing::warn!("workflow execution retained for reconciliation: {error}");
                    }
                    task_id
                });
            }
        }
        Ok(())
        }.await;
        // On actor errors as well as normal shutdown, let workers observe the
        // stop signal and verify cleanup before dropping their JoinSet.
        let _ = self.stop.send(true);
        // Every active worker observes this same shutdown watch, cancels/reaps,
        // and journals evidence before the service task returns.
        while workers.join_next().await.is_some() {}
        outcome
    }
    fn cancel_decision(&self, event: &Event) -> Result<ExecutionDecision> {
        let decision =
            verified_decision(event, &self.relay, self.community, self.keys.public_key())?;
        if decision.instance_id != self.instance
            || !matches!(decision.decision, DecisionKind::Cancel)
        {
            bail!("untrusted workflow cancellation");
        }
        Ok(decision)
    }
    async fn recover(&self) -> Result<()> {
        let tasks = self.journal.lock().await.tasks.clone();
        for (id, record) in tasks {
            for (index, attempt) in record.attempts.iter().enumerate() {
                if matches!(attempt.phase, Phase::Done | Phase::Stopped) {
                    continue;
                }
                let Some(grant) = &attempt.grant else {
                    let mut journal = self.journal.lock().await;
                    let task = journal
                        .tasks
                        .get_mut(&id)
                        .context("missing claim recovery task")?;
                    task.terminal = true;
                    task.attempts[index].phase =
                        if matches!(attempt.phase, Phase::Claiming | Phase::RecoveringClaim)
                            && attempt.process.is_none()
                        {
                            Phase::RecoveringClaim
                        } else {
                            self.stalled.store(true, Ordering::SeqCst);
                            Phase::Stalled
                        };
                    journal.save()?;
                    continue;
                };
                let mut stopped = attempt.phase == Phase::Granted
                    || match &attempt.process {
                        Some(identity) => identity.verify_stopped().await,
                        None => false,
                    };
                if stopped
                    && tag(&record.event, "workflow-origin").is_ok_and(|origin| origin == "manual")
                    && attempt.phase != Phase::Granted
                {
                    stopped = crate::workflow_isolation::stop_manual_uid().await;
                }
                if !stopped {
                    self.stalled.store(true, Ordering::SeqCst);
                }
                let mut journal = self.journal.lock().await;
                let task = journal
                    .tasks
                    .get_mut(&id)
                    .context("missing recovery task")?;
                task.terminal = true;
                task.attempts[index].phase = if stopped {
                    Phase::Stopped
                } else {
                    Phase::Stalled
                };
                if stopped {
                    task.attempts[index].pending_receipt = Some(self.control(
                        grant.instance_id,
                        stop_operation(grant, StopReason::RecoveryStopped),
                    )?);
                }
                journal.save()?;
            }
        }
        self.retry_claim_recovery().await?;
        self.retry_receipts().await
    }

    async fn recovery_pending(&self) -> bool {
        self.journal
            .lock()
            .await
            .tasks
            .values()
            .flat_map(|task| &task.attempts)
            .any(|attempt| {
                attempt.phase == Phase::RecoveringClaim
                    || (attempt.phase == Phase::Stopped
                        && attempt
                            .grant
                            .as_ref()
                            .is_some_and(|grant| grant.instance_id != self.instance))
            })
    }

    async fn retry_claim_recovery(&self) -> Result<()> {
        let tasks = self.journal.lock().await.tasks.clone();
        for (id, record) in tasks {
            for (index, attempt) in record.attempts.iter().enumerate() {
                if attempt.phase != Phase::RecoveringClaim {
                    continue;
                }
                let grant = match self.recover_claim(&record, attempt).await {
                    Ok(grant) => grant,
                    Err(error) => {
                        tracing::warn!("workflow claim receipt recovery remains fenced: {error}");
                        continue;
                    }
                };
                let mut journal = self.journal.lock().await;
                if grant
                    .as_ref()
                    .is_some_and(|grant| !journal.grant_is_new(grant))
                {
                    continue;
                }
                let task = journal
                    .tasks
                    .get_mut(&id)
                    .context("missing recovered claim")?;
                task.terminal = true;
                let attempt = &mut task.attempts[index];
                if attempt.phase != Phase::RecoveringClaim {
                    continue;
                }
                attempt.pending_receipt = grant
                    .as_ref()
                    .map(|grant| {
                        self.control(
                            grant.instance_id,
                            stop_operation(grant, StopReason::RecoveryStopped),
                        )
                    })
                    .transpose()?;
                attempt.phase = if grant.is_some() {
                    Phase::Stopped
                } else {
                    Phase::Done
                };
                attempt.grant = grant;
                // A durable Claiming record precedes every launch transition.
                // This recovered receipt is proof of no execution, never a
                // capability to launch the old attempt or allocate a new one.
                journal.save()?;
            }
        }
        Ok(())
    }

    async fn recover_claim(
        &self,
        record: &TaskRecord,
        attempt: &Attempt,
    ) -> Result<Option<ExecutionDecision>> {
        let task = Task::parse(
            record.event.clone(),
            &self.relay,
            &self.keys.public_key(),
            self.community,
        )?;
        let original = verified_saved_claim(
            &attempt.claim,
            &task,
            self.community,
            self.keys.public_key(),
        )?;
        let request = self.control(
            original.instance_id,
            ExecutionOperation::RecoverClaim {
                signed_claim: attempt.claim.clone(),
            },
        )?;
        let response = self.submit(&request).await?;
        if response
            .get("accepted")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
        {
            bail!("claim recovery not acknowledged");
        }
        if response.get("reason").and_then(serde_json::Value::as_str) == Some("no_grant") {
            if response
                .get("decision")
                .is_some_and(|value| !value.is_null())
                || response
                    .get("signed_event")
                    .is_some_and(|value| !value.is_null())
            {
                bail!("ambiguous no-grant recovery receipt");
            }
            return Ok(None);
        }
        let signed: Event = serde_json::from_value(
            response
                .get("signed_event")
                .context("recovery missing signed grant")?
                .clone(),
        )?;
        let grant =
            verified_decision(&signed, &self.relay, self.community, self.keys.public_key())?;
        if response.get("decision") != Some(&serde_json::to_value(&grant)?)
            || grant.instance_id != original.instance_id
            || grant.run_id != task.run
            || grant.task_id != task.id
            || grant.channel_id != task.channel
            || !matches!(grant.decision, DecisionKind::Grant)
            || grant.ordinal < 1
            || grant.revision < 1
            || grant.deadline <= 0
            || (task.origin == "manual"
                && (grant.ordinal > 2 || Some(grant.deadline) != task.deadline))
        {
            bail!("recovered grant does not match saved claim");
        }
        Ok(Some(grant))
    }

    async fn retry_receipts(&self) -> Result<()> {
        let tasks = self.journal.lock().await.tasks.clone();
        for (id, record) in tasks {
            for (index, attempt) in record.attempts.iter().enumerate() {
                if attempt.phase != Phase::Stopped {
                    continue;
                }
                let mut completion_denied = false;
                if let Some(result) = &attempt.result {
                    match self.submit(result).await {
                        Ok(value) => {
                            completion_denied =
                                value.get("accepted").and_then(serde_json::Value::as_bool)
                                    == Some(false)
                        }
                        Err(_) => continue,
                    }
                }
                if !completion_denied {
                    if let Some(receipt) = &attempt.pending_receipt {
                        let control: ExecutionControl = serde_json::from_str(&receipt.content)?;
                        let finishing =
                            matches!(control.operation, ExecutionOperation::Finished { .. });
                        let receipt = self.control(control.instance_id, control.operation)?;
                        match self.submit(&receipt).await {
                            Ok(value)
                                if value.get("accepted").and_then(serde_json::Value::as_bool)
                                    == Some(false) =>
                            {
                                if finishing {
                                    completion_denied = true;
                                } else {
                                    continue;
                                }
                            }
                            Ok(_) => {}
                            Err(_) => continue,
                        }
                    }
                }
                if completion_denied {
                    let grant = attempt
                        .grant
                        .as_ref()
                        .context("stopped receipt missing grant")?;
                    let reason = if grant.deadline <= chrono::Utc::now().timestamp() {
                        StopReason::DeadlineExceeded
                    } else {
                        StopReason::ExecutionFailed
                    };
                    let stopped = self.control(grant.instance_id, stop_operation(grant, reason))?;
                    {
                        let mut journal = self.journal.lock().await;
                        let task = journal
                            .tasks
                            .get_mut(&id)
                            .context("missing denied completion")?;
                        task.terminal = true;
                        task.attempts[index].result = None;
                        task.attempts[index].pending_receipt = Some(stopped.clone());
                        journal.save()?;
                    }
                    // This narrowly authorized receipt remains valid after
                    // membership/deadline rejection; never lose proven stop.
                    if self.receipt(&stopped).await.is_err() {
                        continue;
                    }
                }
                let mut journal = self.journal.lock().await;
                let task = journal.tasks.get_mut(&id).context("missing receipt task")?;
                task.attempts[index].phase = Phase::Done;
                journal.save()?;
            }
        }
        Ok(())
    }
    async fn execute(
        self: Arc<Self>,
        mut task: Task,
        mut cancelled: watch::Receiver<Option<ExecutionDecision>>,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<()> {
        let queued_deadline = task.deadline.map(instant_for);
        let permit = tokio::select! { _=shutdown.changed()=>return Ok(()),_=wait_deadline(queued_deadline)=>{self.finish_local(task.id).await?;return Ok(());},permit=self.serial.acquire()=>permit?};
        struct Busy(Arc<AtomicUsize>);
        impl Drop for Busy {
            fn drop(&mut self) {
                self.0.fetch_sub(1, Ordering::SeqCst);
            }
        }
        let _permit = permit;
        let mut revisions = self.revisions.clone();
        while self.requires_revision && revisions.borrow().is_none() {
            tokio::select! {
                _=shutdown.changed()=>return Ok(()),
                _=wait_deadline(queued_deadline)=>{self.finish_local(task.id).await?;return Ok(());},
                changed=revisions.changed()=>{changed?;},
            }
        }
        self.busy.fetch_add(1, Ordering::SeqCst);
        let _busy = Busy(self.busy.clone());
        loop {
            if self.stalled.load(Ordering::SeqCst) || self.recovery_pending().await {
                return Ok(());
            }
            if task.expired() || *shutdown.borrow() {
                self.finish_local(task.id).await?;
                return Ok(());
            }
            let (count, fallback) = {
                let journal = self.journal.lock().await;
                let record = journal.tasks.get(&task.id).context("missing task")?;
                if !record.can_claim(task.origin == "manual") {
                    return Ok(());
                }
                (record.attempts.len(), record.fallback)
            };
            if count >= if task.origin == "manual" { 2 } else { 10 } {
                self.finish_local(task.id).await?;
                return Ok(());
            }
            let ephemeral = Keys::generate();
            let claim = self.control(
                self.instance,
                ExecutionOperation::Claim {
                    run_id: task.run,
                    task_id: task.id,
                    channel_id: task.channel,
                    revision: task.revision,
                    ephemeral_pubkey: ephemeral.public_key().to_hex(),
                },
            )?;
            {
                let mut journal = self.journal.lock().await;
                journal
                    .tasks
                    .get_mut(&task.id)
                    .context("task")?
                    .attempts
                    .push(Attempt {
                        claim: claim.clone(),
                        grant: None,
                        phase: Phase::Claiming,
                        process: None,
                        result: None,
                        pending_receipt: None,
                    });
                journal.save()?;
            }
            let mut claim = claim;
            let grant = loop {
                let response = tokio::select! {
                    _=shutdown.changed()=>return Ok(()),
                    _=wait_deadline(queued_deadline)=>return Ok(()),
                    response=self.submit(&claim)=>match response {
                        Ok(response)=>response,
                        Err(_)=>{tokio::time::sleep(Duration::from_millis(250)).await;continue;},
                    }
                };
                if response.get("reason").and_then(serde_json::Value::as_str)
                    == Some("revision_changed")
                {
                    task.revision = response
                        .get("current_revision")
                        .and_then(serde_json::Value::as_i64)
                        .context("missing current revision")?;
                    claim = self.control(
                        self.instance,
                        ExecutionOperation::Claim {
                            run_id: task.run,
                            task_id: task.id,
                            channel_id: task.channel,
                            revision: task.revision,
                            ephemeral_pubkey: ephemeral.public_key().to_hex(),
                        },
                    )?;
                    let mut journal = self.journal.lock().await;
                    journal.tasks.get_mut(&task.id).context("task")?.attempts[count].claim =
                        claim.clone();
                    journal.save()?;
                    continue;
                }
                if response
                    .get("accepted")
                    .and_then(serde_json::Value::as_bool)
                    == Some(false)
                {
                    self.finish_local(task.id).await?;
                    return Ok(());
                }
                let signed: Event = serde_json::from_value(
                    response
                        .get("signed_event")
                        .context("missing signed grant")?
                        .clone(),
                )?;
                let decision = verified_decision(
                    &signed,
                    &self.relay,
                    self.community,
                    self.keys.public_key(),
                )?;
                if response.get("decision") != Some(&serde_json::to_value(&decision)?) {
                    bail!("grant receipt differs from signed decision");
                }
                break decision;
            };
            validate_grant(
                &grant,
                &task,
                self.community,
                self.instance,
                self.keys.public_key(),
            )?;
            task.revision = grant.revision;
            {
                let mut journal = self.journal.lock().await;
                if !journal.grant_is_new(&grant) {
                    bail!("execution grant was already consumed");
                }
                let attempt = &mut journal.tasks.get_mut(&task.id).context("task")?.attempts[count];
                attempt.grant = Some(grant.clone());
                attempt.phase = Phase::Granted;
                journal.save()?;
            }
            let plan = if fallback {
                &self.fallback
            } else {
                &self.primary
            };
            let prepared = self
                .child_env(plan, &ephemeral, task.origin == "manual")
                .and_then(|env| {
                    scoped_mcp(&self.mcp, &ephemeral, &self.keys, task.origin == "manual")
                        .map(|mcp| (env, mcp))
                });
            let (env, mcp) = match prepared {
                Ok(prepared) => prepared,
                Err(_) => {
                    self.record_stopped(&task, count, &grant, StopReason::ExecutionFailed, None)
                        .await?;
                    self.finish_local(task.id).await?;
                    return Ok(());
                }
            };
            {
                let mut journal = self.journal.lock().await;
                journal.tasks.get_mut(&task.id).context("task")?.attempts[count].phase =
                    Phase::Starting;
                journal.save()?;
            }
            let mut child = match AcpClient::spawn_workflow(
                &self.command,
                &plan.args,
                &env,
                task.origin == "manual",
            )
            .await
            {
                Ok(child) => child,
                Err(_) => {
                    self.record_stopped(&task, count, &grant, StopReason::ExecutionFailed, None)
                        .await?;
                    if self.journal.lock().await.tasks[&task.id].attempts[count].phase
                        != Phase::Done
                    {
                        return Ok(());
                    }
                    continue;
                }
            };
            let recorded: Result<()> = async {
                let identity = ProcessIdentity::capture(
                    child.process_group_id().context("missing child PID")?,
                )?;
                let mut journal = self.journal.lock().await;
                let attempt = &mut journal.tasks.get_mut(&task.id).context("task")?.attempts[count];
                attempt.process = Some(identity);
                attempt.phase = Phase::Running;
                journal.save()
            }
            .await;
            if let Err(error) = recorded {
                self.stalled.store(true, Ordering::SeqCst);
                let _ = stop_child(&mut child, task.origin == "manual").await;
                return Err(error);
            }
            let deadline = instant_for(grant.deadline);
            let revision = self.revisions.borrow().clone();
            let started = self.control(
                self.instance,
                ExecutionOperation::Started {
                    run_id: task.run,
                    task_id: task.id,
                    channel_id: task.channel,
                    grant_id: grant.grant_id,
                    ordinal: grant.ordinal,
                },
            )?;
            let result = tokio::select! {
                biased;
                _=shutdown.changed()=>Err(AcpError::Protocol("supervisor stopping".into())),
                _=wait_cancel(&mut cancelled,&grant)=>Err(AcpError::Protocol("grant cancelled".into())),
                _=tokio::time::sleep_until(deadline)=>Err(AcpError::HardTimeout{silence:Duration::ZERO}),
                result=async {
                    self.receipt(&started).await.map_err(|_|AcpError::Protocol("start not acknowledged".into()))?;
                    execute_turn(&mut child,&task,&self.isolation,TurnSettings{mcp,plan,revision:revision.as_ref(),system_prompt:self.system_prompt.as_deref(),idle:self.idle,deadline}).await
                }=>result,
            };
            let output = child.take_captured_agent_message();
            if result.is_err() {
                let _ =
                    tokio::time::timeout(Duration::from_millis(100), child.cancel_workflow()).await;
            }
            let stopped = stop_child(&mut child, task.origin == "manual").await;
            if !stopped {
                self.stalled.store(true, Ordering::SeqCst);
                let mut journal = self.journal.lock().await;
                journal.tasks.get_mut(&task.id).context("task")?.attempts[count].phase =
                    Phase::Stalled;
                journal.save()?;
                return Ok(());
            }
            if matches!(result, Ok(crate::acp::StopReason::EndTurn)) && !output.trim().is_empty() {
                let result_event = result_event(&self.keys, &task, &grant, &output)?;
                self.record_stopped(
                    &task,
                    count,
                    &grant,
                    StopReason::ExecutionFailed,
                    Some(result_event),
                )
                .await?;
                self.finish_local(task.id).await?;
                return Ok(());
            }
            let reason = if chrono::Utc::now().timestamp() >= grant.deadline {
                StopReason::DeadlineExceeded
            } else if cancelled
                .borrow()
                .as_ref()
                .is_some_and(|d| d.grant_id == grant.grant_id)
            {
                StopReason::PermissionRevoked
            } else {
                StopReason::ExecutionFailed
            };
            let retry = matches!(reason, StopReason::ExecutionFailed) && !*shutdown.borrow();
            let use_fallback = qualifies_for_fallback(result.as_ref().err(), &self.policy);
            self.record_stopped(&task, count, &grant, reason, None)
                .await?;
            {
                let mut journal = self.journal.lock().await;
                let record = journal.tasks.get_mut(&task.id).context("task")?;
                record.fallback |= use_fallback;
                journal.save()?;
            }
            if !retry {
                self.finish_local(task.id).await?;
                return Ok(());
            }
            // Acknowledged stopping is mandatory before another claim. If the
            // relay is disconnected retain the receipt; never locally retry.
            let journal = self.journal.lock().await;
            if journal.tasks[&task.id].attempts[count].phase != Phase::Done {
                return Ok(());
            }
        }
    }
    async fn finish_local(&self, id: Uuid) -> Result<()> {
        let mut journal = self.journal.lock().await;
        journal.tasks.get_mut(&id).context("task")?.terminal = true;
        journal.save()
    }
    async fn record_stopped(
        &self,
        task: &Task,
        index: usize,
        grant: &ExecutionDecision,
        reason: StopReason,
        result: Option<Event>,
    ) -> Result<()> {
        let operation = match &result {
            Some(event) => ExecutionOperation::Finished {
                run_id: task.run,
                task_id: task.id,
                channel_id: task.channel,
                grant_id: grant.grant_id,
                ordinal: grant.ordinal,
                result_event_id: event.id.to_hex(),
            },
            None => stop_operation(grant, reason),
        };
        let receipt = self.control(grant.instance_id, operation)?;
        {
            let mut journal = self.journal.lock().await;
            let attempt = &mut journal.tasks.get_mut(&task.id).context("task")?.attempts[index];
            attempt.phase = Phase::Stopped;
            attempt.result = result;
            attempt.pending_receipt = Some(receipt);
            journal.save()?;
        }
        self.retry_receipts().await
    }
    fn child_env(
        &self,
        plan: &SpawnPlan,
        ephemeral: &Keys,
        manual: bool,
    ) -> Result<Vec<(String, String)>> {
        let mut env = self.isolation.environment(std::env::vars(), manual);
        // No parent/home adapter config is trusted on the manual path. Compose
        // the runtime's explicit generated/provider config and inspect nested data.
        if manual {
            env.remove("CODEX_CONFIG");
        }
        for (key, value) in &plan.env {
            if !manual || crate::workflow_isolation::permitted_env(key, true) {
                env.insert(key.clone(), value.clone());
            }
        }
        if manual {
            for argument in &plan.args {
                reject_full_credentials(argument, &self.keys)?;
            }
            for value in env.values() {
                reject_full_credentials(value, &self.keys)?;
            }
            if let Some(config) = env.get_mut("CODEX_CONFIG") {
                let mut value: serde_json::Value = serde_json::from_str(config)?;
                scrub_nested(&mut value);
                *config = value.to_string();
            }
        }
        env.insert(
            "BUZZ_PRIVATE_KEY".into(),
            if manual { ephemeral } else { &self.keys }
                .secret_key()
                .to_secret_hex(),
        );
        env.insert("BUZZ_RELAY_URL".into(), self.relay_url.clone());
        Ok(env.into_iter().collect())
    }
}

async fn stop_child(child: &mut AcpClient, manual: bool) -> bool {
    if manual {
        let (group, uid) = tokio::join!(
            child.shutdown_verified(),
            crate::workflow_isolation::stop_manual_uid()
        );
        group && uid
    } else {
        child.shutdown_verified().await
    }
}
async fn wait_deadline(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending::<()>().await,
    }
}
fn verified_decision(
    event: &Event,
    relay: &PublicKey,
    community: Uuid,
    agent: PublicKey,
) -> Result<ExecutionDecision> {
    event.verify()?;
    let decision: ExecutionDecision = serde_json::from_str(&event.content)?;
    if event.pubkey != *relay
        || event.kind.as_u16() != 46041
        || decision.version != PROTOCOL_VERSION
        || decision.community_id != community
        || decision.agent_pubkey != agent.to_hex()
    {
        bail!("untrusted execution decision");
    }
    for (name, value) in [
        ("p", agent.to_hex()),
        ("h", decision.channel_id.to_string()),
        ("workflow-run", decision.run_id.to_string()),
        ("workflow-task", decision.task_id.to_string()),
        ("workflow-grant", decision.grant_id.to_string()),
    ] {
        if tag(event, name)? != value {
            bail!("decision tags disagree with signed payload");
        }
    }
    Ok(decision)
}
fn instant_for(deadline: i64) -> tokio::time::Instant {
    tokio::time::Instant::now()
        + Duration::from_secs(
            deadline
                .saturating_sub(chrono::Utc::now().timestamp())
                .max(0) as u64,
        )
}
async fn wait_cancel(
    cancel: &mut watch::Receiver<Option<ExecutionDecision>>,
    grant: &ExecutionDecision,
) {
    loop {
        if cancel.borrow().as_ref().is_some_and(|d| {
            d.grant_id == grant.grant_id
                && d.instance_id == grant.instance_id
                && d.ordinal == grant.ordinal
        }) {
            return;
        }
        if cancel.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}
fn verified_saved_claim(
    event: &Event,
    task: &Task,
    community: Uuid,
    agent: PublicKey,
) -> Result<ExecutionControl> {
    event.verify()?;
    let control: ExecutionControl = serde_json::from_str(&event.content)?;
    if event.kind.as_u16() != 46040
        || event.pubkey != agent
        || control.version != PROTOCOL_VERSION
        || control.community_id != community
        || control.agent_pubkey != agent.to_hex()
        || control.instance_id.is_nil()
        || event.tags.len() != 4
    {
        bail!("invalid saved workflow claim");
    }
    let ExecutionOperation::Claim {
        run_id,
        task_id,
        channel_id,
        revision,
        ephemeral_pubkey,
    } = &control.operation
    else {
        bail!("saved operation is not a claim");
    };
    if *run_id != task.run
        || *task_id != task.id
        || *channel_id != task.channel
        || *revision < 1
        || ephemeral_pubkey == &agent.to_hex()
        || PublicKey::from_hex(ephemeral_pubkey).is_err()
    {
        bail!("saved claim does not match durable task");
    }
    for (key, value) in [
        ("p", agent.to_hex()),
        ("h", task.channel.to_string()),
        ("workflow-run", task.run.to_string()),
        ("workflow-task", task.id.to_string()),
    ] {
        if tag(event, key)? != value {
            bail!("saved claim tags disagree with payload");
        }
    }
    Ok(control)
}

fn validate_grant(
    grant: &ExecutionDecision,
    task: &Task,
    community: Uuid,
    instance: Uuid,
    agent: PublicKey,
) -> Result<()> {
    if grant.version != 1
        || grant.community_id != community
        || grant.instance_id != instance
        || grant.agent_pubkey != agent.to_hex()
        || grant.run_id != task.run
        || grant.task_id != task.id
        || grant.channel_id != task.channel
        || grant.ordinal < 1
        || (task.origin == "manual" && (grant.ordinal > 2 || Some(grant.deadline) != task.deadline))
        || !matches!(grant.decision, DecisionKind::Grant)
        || grant.deadline <= chrono::Utc::now().timestamp()
    {
        bail!("invalid or stale execution grant");
    }
    Ok(())
}
fn stop_operation(grant: &ExecutionDecision, reason: StopReason) -> ExecutionOperation {
    ExecutionOperation::Stopped {
        run_id: grant.run_id,
        task_id: grant.task_id,
        channel_id: grant.channel_id,
        grant_id: grant.grant_id,
        ordinal: grant.ordinal,
        reason,
    }
}
fn qualifies_for_fallback(error: Option<&AcpError>, policy: &FailoverPolicy) -> bool {
    // Only protocol errors carry machine failure evidence. Never classify prose
    // emitted as agent_message_chunk, even if it resembles a provider error.
    matches!(error,Some(AcpError::AgentError{message,..}) if policy.enabled() && policy.triggers.iter().any(|trigger|message.to_ascii_lowercase().contains(trigger)))
}
fn reject_full_credentials(value: &str, keys: &Keys) -> Result<()> {
    use nostr::ToBech32;
    if value.contains(&keys.secret_key().to_secret_hex())
        || value.contains(&keys.secret_key().to_bech32()?)
        || value.contains("/home/node")
        || value.contains("/var/lib/buzz-harness")
    {
        bail!("manual config contains an unscoped credential or private worker path");
    }
    Ok(())
}
fn scrub_nested(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            map.retain(|key, _| {
                !matches!(
                    key.to_ascii_uppercase().as_str(),
                    "BUZZ_PRIVATE_KEY"
                        | "BUZZ_AUTH_TAG"
                        | "DATABASE_URL"
                        | "REDIS_URL"
                        | "HOME"
                        | "CODEX_HOME"
                        | "XDG_CONFIG_HOME"
                )
            });
            for child in map.values_mut() {
                scrub_nested(child);
            }
        }
        serde_json::Value::Array(values) => {
            for child in values {
                scrub_nested(child);
            }
        }
        _ => {}
    }
}
fn scoped_mcp(
    servers: &[McpServer],
    ephemeral: &Keys,
    full: &Keys,
    manual: bool,
) -> Result<Vec<McpServer>> {
    if !manual {
        return Ok(servers.to_vec());
    }
    let mut servers = servers.to_vec();
    for server in &mut servers {
        reject_full_credentials(&server.command, full)?;
        for arg in &server.args {
            reject_full_credentials(arg, full)?;
        }
        server.env.retain(|entry| {
            !matches!(
                entry.name.as_str(),
                "BUZZ_PRIVATE_KEY"
                    | "BUZZ_AUTH_TAG"
                    | "DATABASE_URL"
                    | "REDIS_URL"
                    | "HOME"
                    | "CODEX_HOME"
                    | "XDG_CONFIG_HOME"
            )
        });
        for entry in &server.env {
            reject_full_credentials(&entry.value, full)?;
        }
        server.env.push(EnvVar {
            name: "BUZZ_PRIVATE_KEY".into(),
            value: ephemeral.secret_key().to_secret_hex(),
        });
    }
    Ok(servers)
}
struct TurnSettings<'a> {
    mcp: Vec<McpServer>,
    plan: &'a SpawnPlan,
    revision: Option<&'a PendingRuntimeRevision>,
    system_prompt: Option<&'a str>,
    idle: Duration,
    deadline: tokio::time::Instant,
}
async fn execute_turn(
    child: &mut AcpClient,
    task: &Task,
    isolation: &Isolation,
    settings: TurnSettings<'_>,
) -> Result<crate::acp::StopReason, AcpError> {
    let TurnSettings {
        mcp,
        plan,
        revision,
        system_prompt,
        idle,
        deadline,
    } = settings;
    child.initialize().await?;
    let cwd = if task.origin == "manual" {
        &isolation.manual_workspace
    } else {
        &isolation.ordinary_home
    };
    let session = child
        .session_new(
            &cwd.to_string_lossy(),
            mcp,
            system_prompt.map(crate::acp::SystemPromptTransport::Field),
            Some("Workflow execution"),
        )
        .await?;
    if !plan.failover {
        if let Some(revision) = revision {
            match &revision.method {
                buzz_core::hosted_agent_runtime::RuntimeSelectionMethod::ConfigOption {
                    config_id,
                    option_value,
                } => {
                    child
                        .session_set_config_option(&session, config_id, option_value)
                        .await?;
                }
                buzz_core::hosted_agent_runtime::RuntimeSelectionMethod::SetModel { model_id } => {
                    child.session_set_model(&session, model_id).await?;
                }
            }
        } else if let Some(model) = &plan.model {
            child.session_set_model(&session, model).await?;
        }
    } else if let Some(model) = &plan.model {
        child.session_set_model(&session, model).await?;
    }
    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
    if remaining.is_zero() {
        return Err(AcpError::HardTimeout {
            silence: Duration::ZERO,
        });
    }
    child
        .session_prompt_with_idle_timeout(
            &session,
            &task.event.content,
            idle.min(remaining),
            remaining,
        )
        .await
}
fn result_event(
    keys: &Keys,
    task: &Task,
    grant: &ExecutionDecision,
    output: &str,
) -> Result<Event> {
    let values = [
        ("h", task.channel.to_string()),
        ("workflow-result", task.event.id.to_hex()),
        ("buzz:workflow", task.workflow.to_string()),
        ("workflow-run", task.run.to_string()),
        ("workflow-task", task.id.to_string()),
        ("workflow-step", task.step.clone()),
        ("workflow-grant", grant.grant_id.to_string()),
        ("workflow-ordinal", grant.ordinal.to_string()),
        ("workflow-instance", grant.instance_id.to_string()),
        ("workflow-origin", task.origin.clone()),
    ];
    let tags: Result<Vec<_>, _> = values
        .into_iter()
        .map(|(key, value)| Tag::parse([key, &value]))
        .collect();
    Ok(EventBuilder::new(Kind::from(9), output)
        .tags(tags?)
        .sign_with_keys(keys)?)
}

#[cfg(test)]
#[path = "workflow_execution_tests.rs"]
mod tests;
