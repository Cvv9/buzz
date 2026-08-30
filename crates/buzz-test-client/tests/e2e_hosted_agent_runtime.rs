//! Relay-backed hosted-agent runtime reconciliation boundary.
//!
//! This is deliberately ignored because the relay must be started with the
//! same controller key supplied to the test and with an isolated Postgres and
//! Redis. The runbook in the repository `TESTING.md` has the exact setup.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use buzz_core::hosted_agent_runtime::{
    AgentRuntimeAcknowledgment, CatalogDigest, HostedAgentRuntimeRequest, ReasoningEffort,
    RuntimeErrorCode, RuntimeRevision, RuntimeStatusState,
};
use buzz_core::kind::{
    KIND_AGENT_OBSERVER_FRAME, KIND_AGENT_PROFILE, KIND_HOSTED_AGENT_RUNTIME_REQUEST,
    KIND_HOSTED_AGENT_RUNTIME_STATUS,
};
use buzz_core::observer::{decrypt_observer_payload, encrypt_observer_payload};
use buzz_runtime_controller::controller::run_relay_loop;
use buzz_runtime_controller::reconcile::{ApplyRuntimeDefaultsControl, RuntimeApplicationReceipt};
use buzz_runtime_controller::{Controller, ControllerConfig};
use buzz_test_client::{BuzzTestClient, RelayMessage, TestClientError};
use chrono::{DateTime, Utc};
use nostr::{Alphabet, Event, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Timestamp};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use tempfile::TempDir;
use tokio::task::JoinHandle;
use uuid::Uuid;

const CONTROLLER_SECRET_ENV: &str = "BUZZ_TEST_RUNTIME_CONTROLLER_PRIVATE_KEY";
const WAIT: Duration = Duration::from_secs(10);

struct RuntimeHarness {
    _directory: TempDir,
    relay_url: String,
    relay_http_url: String,
    pool: PgPool,
    owner: Keys,
    admin: Keys,
    member: Keys,
    controller: Keys,
    agent: Keys,
    cross_community_agent: Keys,
    config_json: String,
    catalog_digest: CatalogDigest,
}

impl RuntimeHarness {
    async fn from_environment() -> Self {
        let relay_url =
            std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://127.0.0.1:3030".to_owned());
        let relay_http_url = relay_url
            .replace("wss://", "https://")
            .replace("ws://", "http://")
            .trim_end_matches('/')
            .to_owned();
        let database_url = std::env::var("DATABASE_URL")
            .expect("DATABASE_URL must name an isolated runtime E2E database; see TESTING.md");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&database_url)
            .await
            .expect("connect to isolated runtime E2E Postgres");
        let controller = std::env::var(CONTROLLER_SECRET_ENV)
            .ok()
            .and_then(|secret| Keys::parse(&secret).ok())
            .unwrap_or_else(|| {
                panic!(
                    "{CONTROLLER_SECRET_ENV} must be the private key whose pubkey was pinned on the relay"
                )
            });
        let directory = tempfile::tempdir().expect("runtime controller state directory");
        let owner = Keys::generate();
        let admin = Keys::generate();
        let member = Keys::generate();
        let agent = Keys::generate();
        let cross_community_agent = Keys::generate();
        let config_json = json!({
            "relay_url": relay_url,
            "controller_private_key": controller.secret_key().to_secret_hex(),
            "controller_pubkey": controller.public_key().to_hex(),
            "owner_pubkey": owner.public_key().to_hex(),
            "state_path": directory.path().join("state.json"),
            "audit_path": directory.path().join("audit.jsonl"),
            "agents": [{
                "agent_pubkey": agent.public_key().to_hex(),
                "service": "runtime-e2e-agent",
                "catalog": {
                    "model_families": [{
                        "id": "gpt-5.6-terra",
                        "name": "GPT-5.6-Terra",
                        "description": "Balanced",
                        "default_effort": "medium",
                        "efforts": ["medium"]
                    }, {
                        "id": "gpt-5.6-sol",
                        "name": "GPT-5.6-Sol",
                        "description": "Frontier",
                        "default_effort": "high",
                        "efforts": ["high"]
                    }],
                    "bindings": [{
                        "model": "gpt-5.6-terra",
                        "effort": "medium",
                        "method": {
                            "type": "set_model",
                            "model_id": "gpt-5.6-terra[medium]"
                        }
                    }, {
                        "model": "gpt-5.6-sol",
                        "effort": "high",
                        "method": {
                            "type": "set_model",
                            "model_id": "gpt-5.6-sol[high]"
                        }
                    }]
                },
                "initial_runtime": {
                    "model": "gpt-5.6-terra",
                    "effort": "medium",
                    "runtime_name": "Market Intelligence"
                }
            }]
        })
        .to_string();
        let config = ControllerConfig::from_json(&config_json).expect("runtime E2E config");
        let catalog_digest = config
            .catalog_digest(&agent.public_key().to_hex())
            .expect("agent catalog digest")
            .clone();

        Self {
            _directory: directory,
            relay_url,
            relay_http_url,
            pool,
            owner,
            admin,
            member,
            controller,
            agent,
            cross_community_agent,
            config_json,
            catalog_digest,
        }
    }

    fn open_controller(&self) -> Controller {
        Controller::open(
            ControllerConfig::from_json(&self.config_json).expect("parse runtime E2E config"),
        )
        .expect("open runtime controller")
    }

    async fn run(self) {
        self.assert_relay_pin().await;
        self.seed_identities_and_cross_community_profile().await;

        let mut agent_client = BuzzTestClient::connect(&self.relay_url, &self.agent)
            .await
            .expect("connect agent");
        assert_accepted(
            agent_client
                .send_event(self.profile_event(None, 0))
                .await
                .expect("publish initial agent profile"),
            "initial agent profile",
        );

        let (mut controller_task, _ready) = self.start_controller().await;
        let mut owner_client = BuzzTestClient::connect(&self.relay_url, &self.owner)
            .await
            .expect("connect owner");
        let mut admin_client = BuzzTestClient::connect(&self.relay_url, &self.admin)
            .await
            .expect("connect admin");
        let mut member_client = BuzzTestClient::connect(&self.relay_url, &self.member)
            .await
            .expect("connect member");
        let mut viewer = BuzzTestClient::connect(&self.relay_url, &self.member)
            .await
            .expect("connect second status viewer");

        self.assert_controller_only_request_subscription(&mut member_client)
            .await;
        let status_sid = self.subscribe_status(&mut viewer).await;
        let control_sid = self.subscribe_controls(&mut agent_client).await;
        // The controller's bootstrap revision is a replaceable status. Start
        // owner mutations in the next Nostr timestamp second so a same-second
        // event-id tie cannot make the relay keep the bootstrap snapshot.
        wait_replaceable_tick().await;

        self.assert_wrong_controller_rejected(&mut owner_client)
            .await;
        self.assert_non_owner_rejected(&mut admin_client).await;
        self.assert_cross_community_target_rejected(&mut owner_client)
            .await;

        let stale = self.runtime_request_event(
            &self.owner,
            &self.controller,
            &self.agent,
            Uuid::new_v4(),
            digest(&"c".repeat(64)),
            ("gpt-5.6-sol", ReasoningEffort::High),
        );
        assert_accepted(
            owner_client
                .send_event(stale)
                .await
                .expect("send stale-catalog request"),
            "relay-valid stale-catalog request",
        );
        let stale_status = wait_status(
            &mut viewer,
            &status_sid,
            RuntimeStatusState::Failed,
            RuntimeRevision::new(2),
        )
        .await;
        assert_eq!(
            stale_status.error.as_ref().map(|error| error.code),
            Some(RuntimeErrorCode::StaleCatalog)
        );
        assert_eq!(stale_status.effective.model.as_str(), "gpt-5.6-terra");
        wait_replaceable_tick().await;

        let first_id = Uuid::new_v4();
        let first_request = self.runtime_request_event(
            &self.owner,
            &self.controller,
            &self.agent,
            first_id,
            self.catalog_digest.clone(),
            ("gpt-5.6-sol", ReasoningEffort::High),
        );
        assert_accepted(
            owner_client
                .send_event(first_request)
                .await
                .expect("send owner runtime request"),
            "owner runtime request",
        );
        let replay = self.runtime_request_event(
            &self.owner,
            &self.controller,
            &self.agent,
            first_id,
            self.catalog_digest.clone(),
            ("gpt-5.6-sol", ReasoningEffort::High),
        );
        assert_rejected_contains(
            owner_client
                .send_event(replay)
                .await
                .expect("send replayed owner request"),
            "already accepted",
            "replayed runtime request UUID",
        );

        let first_control = wait_control(&mut agent_client, &control_sid, &self.agent, 3).await;
        assert_eq!(first_control.selection.model.as_str(), "gpt-5.6-sol");
        assert_eq!(first_control.selection.effort, ReasoningEffort::High);
        let control_wire = serde_json::to_value(&first_control).expect("serialize control");
        assert_eq!(control_wire["type"], "apply_runtime_defaults");
        assert!(control_wire.get("cancel").is_none());

        self.send_receipt(
            &mut agent_client,
            RuntimeApplicationReceipt::PendingBusy {
                revision: first_control.revision,
            },
        )
        .await;
        let pending = wait_status(
            &mut viewer,
            &status_sid,
            RuntimeStatusState::PendingBusy,
            Some(first_control.revision),
        )
        .await;
        assert_eq!(pending.effective.model.as_str(), "gpt-5.6-terra");
        assert_eq!(
            pending
                .requested
                .as_ref()
                .map(|selection| selection.model.as_str()),
            Some("gpt-5.6-sol")
        );
        assert!(matches!(
            agent_client.recv_event(Duration::from_millis(250)).await,
            Err(TestClientError::Timeout)
        ));
        wait_replaceable_tick().await;

        self.send_receipt(
            &mut agent_client,
            RuntimeApplicationReceipt::Applying {
                revision: first_control.revision,
            },
        )
        .await;
        wait_status(
            &mut viewer,
            &status_sid,
            RuntimeStatusState::Applying,
            Some(first_control.revision),
        )
        .await;
        wait_replaceable_tick().await;

        self.send_receipt(
            &mut agent_client,
            RuntimeApplicationReceipt::Applied {
                acknowledgment: self.acknowledgment(
                    first_control.revision,
                    "gpt-5.6-terra",
                    ReasoningEffort::Medium,
                ),
            },
        )
        .await;
        let mismatch = wait_status(
            &mut viewer,
            &status_sid,
            RuntimeStatusState::Failed,
            Some(first_control.revision),
        )
        .await;
        assert_eq!(
            mismatch.error.as_ref().map(|error| error.code),
            Some(RuntimeErrorCode::AcknowledgementMismatch)
        );
        assert_eq!(mismatch.effective.model.as_str(), "gpt-5.6-terra");
        wait_replaceable_tick().await;

        let rollback_control = self
            .request_and_wait_control(
                &mut owner_client,
                &mut agent_client,
                &control_sid,
                4,
                "gpt-5.6-sol",
                ReasoningEffort::High,
            )
            .await;
        wait_replaceable_tick().await;
        self.send_receipt(
            &mut agent_client,
            RuntimeApplicationReceipt::Failed {
                revision: rollback_control.revision,
                error: RuntimeErrorCode::AdapterRejected,
            },
        )
        .await;
        let rolled_back = wait_status(
            &mut viewer,
            &status_sid,
            RuntimeStatusState::Failed,
            Some(rollback_control.revision),
        )
        .await;
        assert_eq!(
            rolled_back.error.as_ref().map(|error| error.code),
            Some(RuntimeErrorCode::AdapterRejected)
        );
        assert_eq!(rolled_back.effective.model.as_str(), "gpt-5.6-terra");
        assert_eq!(
            rolled_back
                .error
                .as_ref()
                .map(|error| error.message.as_str()),
            Some(RuntimeErrorCode::AdapterRejected.message())
        );
        wait_replaceable_tick().await;

        let success_control = self
            .request_and_wait_control(
                &mut owner_client,
                &mut agent_client,
                &control_sid,
                5,
                "gpt-5.6-sol",
                ReasoningEffort::High,
            )
            .await;
        wait_replaceable_tick().await;
        self.send_receipt(
            &mut agent_client,
            RuntimeApplicationReceipt::Applying {
                revision: success_control.revision,
            },
        )
        .await;
        wait_status(
            &mut viewer,
            &status_sid,
            RuntimeStatusState::Applying,
            Some(success_control.revision),
        )
        .await;
        wait_replaceable_tick().await;
        let success_ack = self.acknowledgment(
            success_control.revision,
            "gpt-5.6-sol",
            ReasoningEffort::High,
        );
        assert_accepted(
            agent_client
                .send_event(self.profile_event(Some(&success_ack), 1))
                .await
                .expect("publish exact signed runtime acknowledgment"),
            "exact signed runtime acknowledgment",
        );
        let applied = wait_status(
            &mut viewer,
            &status_sid,
            RuntimeStatusState::Applied,
            Some(success_control.revision),
        )
        .await;
        assert_eq!(applied.effective.model.as_str(), "gpt-5.6-sol");
        assert!(applied.requested.is_none());
        self.assert_single_replaced_status().await;

        stop_controller(controller_task).await;
        assert_eq!(
            self.open_controller()
                .status(&self.agent.public_key().to_hex())
                .expect("persisted applied status")
                .effective
                .model
                .as_str(),
            "gpt-5.6-sol"
        );

        let (restarted_task, _ready) = self.start_controller().await;
        controller_task = restarted_task;
        agent_client
            .disconnect()
            .await
            .expect("stop runner before queued request");
        wait_replaceable_tick().await;
        assert_accepted(
            owner_client
                .send_event(self.runtime_request_event(
                    &self.owner,
                    &self.controller,
                    &self.agent,
                    Uuid::new_v4(),
                    self.catalog_digest.clone(),
                    ("gpt-5.6-terra", ReasoningEffort::Medium),
                ))
                .await
                .expect("queue runtime request while runner is offline"),
            "offline runner request",
        );
        let revision_six = RuntimeRevision::new(6).expect("revision 6");
        let offline_pending = wait_status(
            &mut viewer,
            &status_sid,
            RuntimeStatusState::PendingBusy,
            Some(revision_six),
        )
        .await;
        assert_eq!(offline_pending.effective.model.as_str(), "gpt-5.6-sol");

        stop_controller(controller_task).await;
        let mut restarted_agent = BuzzTestClient::connect(&self.relay_url, &self.agent)
            .await
            .expect("restart runner");
        let restarted_control_sid = self.subscribe_controls(&mut restarted_agent).await;
        wait_replaceable_tick().await;
        let (final_controller_task, _ready) = self.start_controller().await;
        let replayed_control =
            wait_control(&mut restarted_agent, &restarted_control_sid, &self.agent, 6).await;
        assert_eq!(replayed_control.selection.model.as_str(), "gpt-5.6-terra");
        wait_replaceable_tick().await;
        self.send_receipt(
            &mut restarted_agent,
            RuntimeApplicationReceipt::Applying {
                revision: replayed_control.revision,
            },
        )
        .await;
        wait_status(
            &mut viewer,
            &status_sid,
            RuntimeStatusState::Applying,
            Some(replayed_control.revision),
        )
        .await;
        wait_replaceable_tick().await;
        let final_ack = self.acknowledgment(
            replayed_control.revision,
            "gpt-5.6-terra",
            ReasoningEffort::Medium,
        );
        assert_accepted(
            restarted_agent
                .send_event(self.profile_event(Some(&final_ack), 2))
                .await
                .expect("publish acknowledgment after runner restart"),
            "runner-restart acknowledgment",
        );
        let final_status = wait_status(
            &mut viewer,
            &status_sid,
            RuntimeStatusState::Applied,
            Some(replayed_control.revision),
        )
        .await;
        assert_eq!(final_status.effective.model.as_str(), "gpt-5.6-terra");
        assert_eq!(final_status.effective.effort, ReasoningEffort::Medium);
        stop_controller(final_controller_task).await;

        let final_persisted = self
            .open_controller()
            .status(&self.agent.public_key().to_hex())
            .expect("final persisted status");
        assert_eq!(final_persisted.state, RuntimeStatusState::Applied);
        assert_eq!(final_persisted.effective.model.as_str(), "gpt-5.6-terra");

        owner_client.disconnect().await.expect("disconnect owner");
        admin_client.disconnect().await.expect("disconnect admin");
        member_client.disconnect().await.expect("disconnect member");
        viewer.disconnect().await.expect("disconnect viewer");
        restarted_agent
            .disconnect()
            .await
            .expect("disconnect restarted runner");
    }

    async fn assert_relay_pin(&self) {
        let info: Value = reqwest::Client::new()
            .get(&self.relay_http_url)
            .header(reqwest::header::ACCEPT, "application/nostr+json")
            .send()
            .await
            .expect("fetch relay NIP-11")
            .error_for_status()
            .expect("relay NIP-11 status")
            .json()
            .await
            .expect("relay NIP-11 JSON");
        assert_eq!(
            info["buzz_hosted_agent_runtime"]["controller_pubkey"],
            self.controller.public_key().to_hex(),
            "relay must pin the test controller before the E2E starts"
        );
    }

    async fn seed_identities_and_cross_community_profile(&self) {
        let authority = relay_authority(&self.relay_http_url);
        let community = ensure_community(&self.pool, &authority).await;
        for (keys, role) in [
            (&self.owner, "owner"),
            (&self.admin, "admin"),
            (&self.member, "member"),
        ] {
            sqlx::query(
                "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
                 VALUES ($1, $2, $3, NULL) \
                 ON CONFLICT (community_id, pubkey) DO UPDATE SET role = $3, updated_at = now()",
            )
            .bind(community)
            .bind(keys.public_key().to_hex())
            .bind(role)
            .execute(&self.pool)
            .await
            .unwrap_or_else(|error| panic!("seed runtime E2E {role}: {error}"));
        }

        let other_host = format!("runtime-e2e-{}.invalid", Uuid::new_v4());
        let other_community = ensure_community(&self.pool, &other_host).await;
        let cross_profile = EventBuilder::new(
            Kind::Custom(KIND_AGENT_PROFILE as u16),
            json!({
                "name": "Cross Community Agent",
                "display_name": "Cross Community Agent"
            })
            .to_string(),
        )
        .sign_with_keys(&self.cross_community_agent)
        .expect("sign cross-community profile");
        insert_fixture_event(&self.pool, other_community, &cross_profile).await;
    }

    async fn start_controller(&self) -> (JoinHandle<Result<()>>, Arc<AtomicBool>) {
        let mut controller = self.open_controller();
        let ready = Arc::new(AtomicBool::new(false));
        let task_ready = Arc::clone(&ready);
        let task = tokio::spawn(async move {
            run_relay_loop(&mut controller, task_ready.as_ref())
                .await
                .context("runtime E2E controller loop")
        });
        let deadline = tokio::time::Instant::now() + WAIT;
        while !ready.load(Ordering::Acquire) {
            if task.is_finished() {
                let result = task.await.expect("controller task join");
                panic!("controller exited before readiness: {result:?}");
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "controller did not become ready within {WAIT:?}"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        (task, ready)
    }

    async fn assert_controller_only_request_subscription(&self, member: &mut BuzzTestClient) {
        let sid = format!("runtime-e2e-denied-{}", Uuid::new_v4());
        member
            .send_raw(&json!(["REQ", sid, {
                "kinds": [KIND_HOSTED_AGENT_RUNTIME_REQUEST],
                "#p": [self.controller.public_key().to_hex()]
            }]))
            .await
            .expect("send unauthorized runtime subscription");
        let deadline = tokio::time::Instant::now() + WAIT;
        loop {
            let remaining = deadline
                .checked_duration_since(tokio::time::Instant::now())
                .expect("runtime subscription rejection timeout");
            match member
                .recv_event(remaining)
                .await
                .expect("runtime subscription response")
            {
                RelayMessage::Closed {
                    subscription_id,
                    message,
                } if subscription_id == sid => {
                    assert!(message.contains("controller"));
                    return;
                }
                _ => {}
            }
        }
    }

    async fn subscribe_status(&self, viewer: &mut BuzzTestClient) -> String {
        let sid = format!("runtime-e2e-status-{}", Uuid::new_v4());
        let filter = Filter::new()
            .kind(Kind::Custom(KIND_HOSTED_AGENT_RUNTIME_STATUS as u16))
            .author(self.controller.public_key())
            .custom_tags(
                SingleLetterTag::lowercase(Alphabet::D),
                [self.agent.public_key().to_hex()],
            );
        viewer
            .subscribe(&sid, vec![filter])
            .await
            .expect("subscribe status viewer");
        viewer
            .collect_until_eose(&sid, WAIT)
            .await
            .expect("status viewer EOSE");
        sid
    }

    async fn subscribe_controls(&self, agent: &mut BuzzTestClient) -> String {
        let sid = format!("runtime-e2e-control-{}", Uuid::new_v4());
        agent
            .send_raw(&json!(["REQ", sid, {
                "kinds": [KIND_AGENT_OBSERVER_FRAME],
                "authors": [self.controller.public_key().to_hex()],
                "#p": [self.agent.public_key().to_hex()],
                "#agent": [self.agent.public_key().to_hex()],
                "#frame": ["control"],
                "since": Utc::now().timestamp().saturating_sub(5)
            }]))
            .await
            .expect("subscribe runner control stream");
        agent
            .collect_until_eose(&sid, WAIT)
            .await
            .expect("runner control EOSE");
        sid
    }

    async fn assert_wrong_controller_rejected(&self, owner: &mut BuzzTestClient) {
        let attacker = Keys::generate();
        let event = self.runtime_request_event(
            &self.owner,
            &attacker,
            &self.agent,
            Uuid::new_v4(),
            self.catalog_digest.clone(),
            ("gpt-5.6-sol", ReasoningEffort::High),
        );
        assert_rejected_contains(
            owner
                .send_event(event)
                .await
                .expect("send wrong-controller request"),
            "pinned controller",
            "wrong controller request",
        );
    }

    async fn assert_non_owner_rejected(&self, admin: &mut BuzzTestClient) {
        let event = self.runtime_request_event(
            &self.admin,
            &self.controller,
            &self.agent,
            Uuid::new_v4(),
            self.catalog_digest.clone(),
            ("gpt-5.6-sol", ReasoningEffort::High),
        );
        assert_rejected_contains(
            admin
                .send_event(event)
                .await
                .expect("send admin runtime request"),
            "community owner",
            "admin runtime mutation",
        );
    }

    async fn assert_cross_community_target_rejected(&self, owner: &mut BuzzTestClient) {
        let event = self.runtime_request_event(
            &self.owner,
            &self.controller,
            &self.cross_community_agent,
            Uuid::new_v4(),
            self.catalog_digest.clone(),
            ("gpt-5.6-sol", ReasoningEffort::High),
        );
        assert_rejected_contains(
            owner
                .send_event(event)
                .await
                .expect("send cross-community runtime request"),
            "current self-authored agent",
            "cross-community runtime target",
        );
    }

    fn runtime_request_event(
        &self,
        signer: &Keys,
        recipient: &Keys,
        target: &Keys,
        request_id: Uuid,
        catalog_digest: CatalogDigest,
        selection: (&str, ReasoningEffort),
    ) -> Event {
        let (model, effort) = selection;
        let request: HostedAgentRuntimeRequest = serde_json::from_value(json!({
            "schema": "buzz.hosted-agent-runtime-request.v1",
            "request_id": request_id.to_string(),
            "agent_pubkey": target.public_key().to_hex(),
            "model": model,
            "effort": effort,
            "presentation_event_id": null,
            "catalog_digest": catalog_digest
        }))
        .expect("valid runtime request");
        let encrypted = encrypt_observer_payload(signer, &recipient.public_key(), &request)
            .expect("encrypt runtime request");
        buzz_sdk::build_hosted_agent_runtime_request(
            &recipient.public_key().to_hex(),
            &request,
            Timestamp::now().as_secs() + 180,
            &encrypted,
        )
        .expect("build runtime request")
        .sign_with_keys(signer)
        .expect("sign runtime request")
    }

    async fn request_and_wait_control(
        &self,
        owner: &mut BuzzTestClient,
        agent: &mut BuzzTestClient,
        control_sid: &str,
        revision: u64,
        model: &str,
        effort: ReasoningEffort,
    ) -> ApplyRuntimeDefaultsControl {
        let event = self.runtime_request_event(
            &self.owner,
            &self.controller,
            &self.agent,
            Uuid::new_v4(),
            self.catalog_digest.clone(),
            (model, effort),
        );
        assert_accepted(
            owner
                .send_event(event)
                .await
                .expect("send owner runtime request"),
            "owner runtime request",
        );
        wait_control(agent, control_sid, &self.agent, revision).await
    }

    async fn send_receipt(&self, agent: &mut BuzzTestClient, receipt: RuntimeApplicationReceipt) {
        let encrypted =
            encrypt_observer_payload(&self.agent, &self.controller.public_key(), &receipt)
                .expect("encrypt runtime receipt");
        let event = buzz_sdk::build_hosted_runtime_receipt_frame(
            &self.controller.public_key().to_hex(),
            &self.agent.public_key().to_hex(),
            &encrypted,
        )
        .expect("build runtime receipt")
        .sign_with_keys(&self.agent)
        .expect("sign runtime receipt");
        assert_accepted(
            agent.send_event(event).await.expect("send runtime receipt"),
            "runtime receipt",
        );
    }

    fn acknowledgment(
        &self,
        revision: RuntimeRevision,
        model: &str,
        effort: ReasoningEffort,
    ) -> AgentRuntimeAcknowledgment {
        serde_json::from_value(json!({
            "schema": "buzz.agent-runtime.v1",
            "controller_pubkey": self.controller.public_key().to_hex(),
            "revision": revision,
            "model": model,
            "effort": effort,
            "effective_name": "Market Intelligence",
            "catalog_digest": self.catalog_digest
        }))
        .expect("valid runtime acknowledgment")
    }

    fn profile_event(
        &self,
        acknowledgment: Option<&AgentRuntimeAcknowledgment>,
        sequence: u64,
    ) -> Event {
        let existing = json!({
            "name": "Market Intelligence",
            "display_name": "Market Intelligence",
            "about": "Runtime boundary E2E agent"
        });
        let families: Vec<buzz_core::hosted_agent_runtime::ModelFamily> =
            serde_json::from_value(json!([{
                "id": "gpt-5.6-terra",
                "name": "GPT-5.6-Terra",
                "description": "Balanced",
                "default_effort": "medium",
                "efforts": ["medium"]
            }, {
                "id": "gpt-5.6-sol",
                "name": "GPT-5.6-Sol",
                "description": "Frontier",
                "default_effort": "high",
                "efforts": ["high"]
            }]))
            .expect("profile model families");
        let model = acknowledgment.map(|ack| &ack.model);
        buzz_sdk::build_agent_profile_with_runtime(
            existing.as_object().expect("profile object"),
            "Market Intelligence",
            model,
            &json!([
                {"id": "gpt-5.6-terra", "name": "GPT-5.6-Terra"},
                {"id": "gpt-5.6-sol", "name": "GPT-5.6-Sol"}
            ]),
            Some(&families),
            acknowledgment,
        )
        .expect("build agent runtime profile")
        .custom_created_at(Timestamp::from(Timestamp::now().as_secs() + sequence))
        .sign_with_keys(&self.agent)
        .expect("sign agent runtime profile")
    }

    async fn assert_single_replaced_status(&self) {
        let mut query = BuzzTestClient::connect(&self.relay_url, &self.member)
            .await
            .expect("connect status replacement query");
        let sid = format!("runtime-e2e-status-query-{}", Uuid::new_v4());
        let filter = Filter::new()
            .kind(Kind::Custom(KIND_HOSTED_AGENT_RUNTIME_STATUS as u16))
            .author(self.controller.public_key())
            .custom_tags(
                SingleLetterTag::lowercase(Alphabet::D),
                [self.agent.public_key().to_hex()],
            );
        query
            .subscribe(&sid, vec![filter])
            .await
            .expect("query runtime status");
        let events = query
            .collect_until_eose(&sid, WAIT)
            .await
            .expect("collect runtime status");
        assert_eq!(events.len(), 1, "runtime status must be NIP-33 replaceable");
        query.disconnect().await.expect("disconnect status query");
    }
}

async fn wait_control(
    client: &mut BuzzTestClient,
    sid: &str,
    agent: &Keys,
    revision: u64,
) -> ApplyRuntimeDefaultsControl {
    let deadline = tokio::time::Instant::now() + WAIT;
    loop {
        let remaining = deadline
            .checked_duration_since(tokio::time::Instant::now())
            .expect("runtime control timeout");
        let message = client.recv_event(remaining).await.unwrap_or_else(|error| {
            panic!("runtime control event while waiting for revision {revision}: {error}")
        });
        match message {
            RelayMessage::Event {
                subscription_id,
                event,
            } if subscription_id == sid => {
                let control: ApplyRuntimeDefaultsControl =
                    decrypt_observer_payload(agent, &event).expect("decrypt runtime control");
                if control.revision.get() == revision {
                    return control;
                }
            }
            RelayMessage::Closed { message, .. } => {
                panic!("runtime control subscription closed: {message}")
            }
            _ => {}
        }
    }
}

async fn wait_status(
    client: &mut BuzzTestClient,
    sid: &str,
    state: RuntimeStatusState,
    revision: Option<RuntimeRevision>,
) -> buzz_core::hosted_agent_runtime::HostedAgentRuntimeStatus {
    let deadline = tokio::time::Instant::now() + WAIT;
    loop {
        let remaining = deadline
            .checked_duration_since(tokio::time::Instant::now())
            .expect("runtime status timeout");
        let message = client.recv_event(remaining).await.unwrap_or_else(|error| {
            panic!(
                "runtime status event while waiting for {state:?} revision {revision:?}: {error}"
            )
        });
        match message {
            RelayMessage::Event {
                subscription_id,
                event,
            } if subscription_id == sid => {
                let status = serde_json::from_str::<
                    buzz_core::hosted_agent_runtime::HostedAgentRuntimeStatus,
                >(&event.content)
                .expect("strict runtime status");
                if status.state == state
                    && revision.is_none_or(|expected| status.revision == expected)
                {
                    return status;
                }
            }
            RelayMessage::Closed { message, .. } => {
                panic!("runtime status subscription closed: {message}")
            }
            _ => {}
        }
    }
}

async fn stop_controller(task: JoinHandle<Result<()>>) {
    task.abort();
    let _ = task.await;
}

async fn wait_replaceable_tick() {
    tokio::time::sleep(Duration::from_millis(1_100)).await;
}

fn assert_accepted(response: buzz_test_client::OkResponse, action: &str) {
    assert!(
        response.accepted,
        "relay rejected {action}: {}",
        response.message
    );
}

fn assert_rejected_contains(response: buzz_test_client::OkResponse, expected: &str, action: &str) {
    assert!(!response.accepted, "relay unexpectedly accepted {action}");
    assert!(
        response.message.contains(expected),
        "unexpected {action} rejection: {}",
        response.message
    );
}

fn digest(value: &str) -> CatalogDigest {
    serde_json::from_value(Value::String(value.to_owned())).expect("catalog digest")
}

fn relay_authority(http_url: &str) -> String {
    let url = url::Url::parse(http_url).expect("relay HTTP URL");
    url[url::Position::BeforeHost..url::Position::AfterPort].to_owned()
}

async fn ensure_community(pool: &PgPool, host: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO communities (id, host) VALUES ($1, $2) \
         ON CONFLICT (lower(host)) DO NOTHING",
    )
    .bind(id)
    .bind(host)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("seed runtime E2E community {host}: {error}"));
    sqlx::query("SELECT id FROM communities WHERE lower(host) = lower($1)")
        .bind(host)
        .fetch_one(pool)
        .await
        .expect("query runtime E2E community")
        .get("id")
}

async fn insert_fixture_event(pool: &PgPool, community: Uuid, event: &Event) {
    let created_at = DateTime::<Utc>::from_timestamp(event.created_at.as_secs() as i64, 0)
        .expect("fixture event timestamp");
    let tags = serde_json::to_value(&event.tags).expect("fixture event tags");
    sqlx::query(
        "INSERT INTO events \
         (community_id, id, pubkey, created_at, kind, tags, content, sig, received_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())",
    )
    .bind(community)
    .bind(event.id.as_bytes().to_vec())
    .bind(event.pubkey.to_bytes().to_vec())
    .bind(created_at)
    .bind(i32::from(event.kind.as_u16()))
    .bind(tags)
    .bind(&event.content)
    .bind(event.sig.serialize().to_vec())
    .execute(pool)
    .await
    .expect("insert cross-community profile fixture");
}

#[tokio::test]
#[ignore = "requires an isolated relay configured with the runtime-controller test key"]
async fn owner_runtime_change_is_private_busy_safe_and_restart_durable() {
    RuntimeHarness::from_environment().await.run().await;
}
