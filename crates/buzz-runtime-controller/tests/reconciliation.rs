use buzz_core::hosted_agent_runtime::{
    AgentRuntimeAcknowledgment, HostedAgentRuntimeRequest, RuntimeStatusState,
};
use buzz_runtime_controller::controller::{Controller, ControllerEffect, RuntimeRequestContext};
use buzz_runtime_controller::ControllerConfig;
use nostr::Keys;
use serde_json::json;
use tempfile::TempDir;

struct Harness {
    _directory: TempDir,
    config_json: String,
    owner: String,
    agent: String,
}

impl Harness {
    fn new() -> Self {
        let directory = tempfile::tempdir().expect("tempdir");
        let controller = Keys::generate();
        let owner = "a".repeat(64);
        let agent = "b".repeat(64);
        let config_json = json!({
            "relay_url":"ws://127.0.0.1:3000",
            "controller_private_key":controller.secret_key().to_secret_hex(),
            "controller_pubkey":controller.public_key().to_hex(),
            "owner_pubkey":owner,
            "state_path":directory.path().join("state.json"),
            "audit_path":directory.path().join("audit.jsonl"),
            "agents":[{
                "agent_pubkey":agent,
                "service":"market-intelligence",
                "catalog":{
                    "model_families":[{
                        "id":"gpt-5.6-terra","name":"GPT-5.6-Terra","description":"Balanced",
                        "default_effort":"medium","efforts":["medium"]
                    },{
                        "id":"gpt-5.6-sol","name":"GPT-5.6-Sol","description":"Frontier",
                        "default_effort":"high","efforts":["high"]
                    }],
                    "bindings":[{
                        "model":"gpt-5.6-terra","effort":"medium",
                        "method":{"type":"set_model","model_id":"gpt-5.6-terra[medium]"}
                    },{
                        "model":"gpt-5.6-sol","effort":"high",
                        "method":{"type":"set_model","model_id":"gpt-5.6-sol[high]"}
                    }]
                },
                "initial_runtime":{
                    "model":"gpt-5.6-terra",
                    "effort":"medium",
                    "runtime_name":"Market Intelligence"
                }
            }]
        })
        .to_string();
        Self {
            _directory: directory,
            config_json,
            owner,
            agent,
        }
    }

    fn open(&self) -> Controller {
        Controller::open(ControllerConfig::from_json(&self.config_json).expect("config"))
            .expect("controller")
    }

    fn request(&self, controller: &Controller, id: &str) -> HostedAgentRuntimeRequest {
        let digest = controller
            .config()
            .catalog_digest(&self.agent)
            .expect("digest");
        serde_json::from_value(json!({
            "schema":"buzz.hosted-agent-runtime-request.v1",
            "request_id":id,
            "agent_pubkey":self.agent,
            "model":"gpt-5.6-sol",
            "effort":"high",
            "presentation_event_id":null,
            "catalog_digest":digest
        }))
        .expect("request")
    }

    fn context(&self, online: bool) -> RuntimeRequestContext<'_> {
        RuntimeRequestContext {
            author_pubkey: &self.owner,
            runtime_name: serde_json::from_value(json!("Market Intelligence")).expect("name"),
            agent_online: online,
        }
    }
}

#[test]
fn controller_and_runner_restart_replay_only_the_latest_durable_revision() {
    let harness = Harness::new();
    let mut controller = harness.open();
    let first = harness.request(&controller, "550e8400-e29b-41d4-a716-446655440000");
    let effects = controller
        .accept_request(&first, harness.context(false))
        .expect("offline accept");
    assert_eq!(effects.len(), 1);
    drop(controller);

    let mut restarted = harness.open();
    let effects = restarted.pending_effects();
    assert_eq!(effects.len(), 2);
    assert!(matches!(
        effects.as_slice(),
        [ControllerEffect::PublishStatus(status), ControllerEffect::SendControl { .. }]
            if status.revision.get() == 2 && status.state == RuntimeStatusState::PendingBusy
    ));

    let second = harness.request(&restarted, "550e8400-e29b-41d4-a716-446655440001");
    restarted
        .accept_request(&second, harness.context(true))
        .expect("supersede");
    let revision = restarted.status(&harness.agent).expect("status").revision;
    assert_eq!(revision.get(), 3);
    restarted
        .mark_runner_boundary(&harness.agent, revision, RuntimeStatusState::PendingBusy)
        .expect("pending receipt");
    restarted
        .mark_runner_boundary(&harness.agent, revision, RuntimeStatusState::Applying)
        .expect("applying receipt");

    let old_ack: AgentRuntimeAcknowledgment = serde_json::from_value(json!({
        "schema":"buzz.agent-runtime.v1",
        "controller_pubkey":restarted.config().controller_pubkey().expect("key").to_hex(),
        "revision":2,
        "model":"gpt-5.6-sol",
        "effort":"high",
        "effective_name":"Market Intelligence",
        "catalog_digest":restarted.config().catalog_digest(&harness.agent).expect("digest")
    }))
    .expect("old ack");
    restarted
        .reconcile_acknowledgment(&harness.agent, &old_ack)
        .expect("ignore stale ack");
    assert_eq!(
        restarted.status(&harness.agent).expect("status").state,
        RuntimeStatusState::Applying
    );

    let exact_ack: AgentRuntimeAcknowledgment = serde_json::from_value(json!({
        "schema":"buzz.agent-runtime.v1",
        "controller_pubkey":restarted.config().controller_pubkey().expect("key").to_hex(),
        "revision":3,
        "model":"gpt-5.6-sol",
        "effort":"high",
        "effective_name":"Market Intelligence",
        "catalog_digest":restarted.config().catalog_digest(&harness.agent).expect("digest")
    }))
    .expect("exact ack");
    restarted
        .reconcile_acknowledgment(&harness.agent, &exact_ack)
        .expect("apply exact ack");
    let status = restarted.status(&harness.agent).expect("status");
    assert_eq!(status.state, RuntimeStatusState::Applied);
    assert!(status.requested.is_none());
    assert_eq!(status.effective.model.as_str(), "gpt-5.6-sol");
}
