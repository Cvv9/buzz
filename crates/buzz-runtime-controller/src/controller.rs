//! Pure durable reconciliation and the relay transport adapter.

use std::time::Duration;

use anyhow::{Context, Result};
use buzz_core::hosted_agent_runtime::{
    AgentRuntimeAcknowledgment, HostedAgentRuntimeRequest, HostedAgentRuntimeStatus,
    HostedAgentRuntimeStatusSchema, RuntimeErrorCode, RuntimeSelection, RuntimeStatusState,
};
use buzz_core::kind::{
    KIND_AGENT_OBSERVER_FRAME, KIND_AGENT_PROFILE, KIND_HOSTED_AGENT_RUNTIME_REQUEST,
    KIND_HOSTED_AGENT_RUNTIME_STATUS,
};
use buzz_core::observer::{decrypt_observer_payload, encrypt_observer_payload};
use buzz_ws_client::{NostrWsConnection, RelayMessage};
use chrono::Utc;
use nostr::{Event, Keys, PublicKey};
use serde_json::{json, Value};
use thiserror::Error;

use crate::audit::{AuditAction, AuditEntry, AuditLog};
use crate::config::{AgentServiceMapping, ControllerConfig};
use crate::reconcile::{
    acknowledgment_matches, ApplyRuntimeDefaultsControl, RuntimeApplicationReceipt,
};
use crate::state_store::{ControllerState, RequestAcceptance, StateStore};

const REQUEST_FRESHNESS_SECS: i64 = 300;

/// Trusted event context that never comes from encrypted browser input.
pub struct RuntimeRequestContext<'a> {
    /// Verified request event author.
    pub author_pubkey: &'a str,
    /// Latest verified self-authored agent profile name.
    pub runtime_name: buzz_core::hosted_agent_runtime::RuntimeName,
    /// Whether an active runner subscription is known for immediate delivery.
    pub agent_online: bool,
}

/// Secret-free effects produced by pure reconciliation.
#[derive(Debug, Clone)]
pub enum ControllerEffect {
    /// Publish one controller-authored durable public status.
    PublishStatus(HostedAgentRuntimeStatus),
    /// Deliver one encrypted command to the allowlisted agent.
    SendControl {
        /// Public hosted agent identity only.
        agent_pubkey: String,
        /// Exact private command. The service mapping stays in config.
        control: ApplyRuntimeDefaultsControl,
    },
}

/// Fixed reconciliation rejection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ControllerError {
    /// Only the configured current community owner may request a change.
    #[error("owner_only")]
    OwnerOnly,
    /// Target is not in the fixed controller allowlist.
    #[error("unknown_agent")]
    UnknownAgent,
    /// Browser used a catalog revision that is no longer current.
    #[error("stale_catalog")]
    StaleCatalog,
    /// Model/effort does not have an exact private adapter binding.
    #[error("unsupported_selection")]
    UnsupportedSelection,
    /// State could not be durably reconciled.
    #[error("state_unavailable")]
    State,
}

/// Durable controller state machine.
pub struct Controller {
    config: ControllerConfig,
    store: StateStore,
    audit: AuditLog,
    state: ControllerState,
}

impl Controller {
    /// Load durable state for a validated controller configuration.
    pub fn open(config: ControllerConfig) -> Result<Self, ControllerError> {
        let store = StateStore::new(config.state_path());
        let mut state = store.load().map_err(|_| ControllerError::State)?;
        let bootstrap: Vec<_> = config
            .agent_pubkeys()
            .filter_map(|agent| {
                Some((
                    agent.to_owned(),
                    config.agent(agent)?.initial_runtime.clone(),
                    config.catalog_digest(agent)?.clone(),
                ))
            })
            .collect();
        for (agent, initial, digest) in bootstrap {
            store
                .bootstrap_agent(&mut state, &agent, initial, digest)
                .map_err(|_| ControllerError::State)?;
        }
        let audit = AuditLog::new(config.audit_path());
        Ok(Self {
            config,
            store,
            audit,
            state,
        })
    }

    /// Validate and durably accept one owner request.
    pub fn accept_request(
        &mut self,
        request: &HostedAgentRuntimeRequest,
        context: RuntimeRequestContext<'_>,
    ) -> Result<Vec<ControllerEffect>, ControllerError> {
        if context.author_pubkey != self.config.owner_pubkey().as_str() {
            return Err(ControllerError::OwnerOnly);
        }
        let agent = request.agent_pubkey.as_str();
        let mapping = self
            .config
            .agent(agent)
            .ok_or(ControllerError::UnknownAgent)?;
        let digest = self
            .config
            .catalog_digest(agent)
            .ok_or(ControllerError::UnknownAgent)?;
        if request.catalog_digest != *digest {
            return Err(ControllerError::StaleCatalog);
        }
        let method = mapping
            .catalog
            .bindings
            .iter()
            .find(|binding| binding.model == request.model && binding.effort == request.effort)
            .map(|binding| binding.method.clone())
            .ok_or(ControllerError::UnsupportedSelection)?;
        let desired = RuntimeSelection {
            model: request.model.clone(),
            effort: request.effort,
            runtime_name: context.runtime_name,
        };
        let initial = mapping.initial_runtime.clone();
        let acceptance = self
            .store
            .accept_request(
                &mut self.state,
                agent,
                request.request_id,
                desired.clone(),
                request.catalog_digest.clone(),
                initial,
            )
            .map_err(|_| ControllerError::State)?;
        let revision = match acceptance {
            RequestAcceptance::Accepted(revision) => {
                self.append_audit(agent, revision, AuditAction::RequestAccepted, None);
                revision
            }
            RequestAcceptance::Idempotent(revision) => revision,
        };
        let mut effects = vec![ControllerEffect::PublishStatus(
            self.status(agent).ok_or(ControllerError::State)?,
        )];
        if context.agent_online {
            effects.push(ControllerEffect::SendControl {
                agent_pubkey: agent.to_owned(),
                control: ApplyRuntimeDefaultsControl::new(
                    revision,
                    desired,
                    method,
                    request.catalog_digest.clone(),
                ),
            });
        }
        Ok(effects)
    }

    /// Durably acknowledge a known owner request that fails a fixed catalog check.
    pub fn reject_request(
        &mut self,
        request: &HostedAgentRuntimeRequest,
        runtime_name: buzz_core::hosted_agent_runtime::RuntimeName,
        error: RuntimeErrorCode,
    ) -> Result<Vec<ControllerEffect>, ControllerError> {
        if !matches!(
            error,
            RuntimeErrorCode::StaleCatalog | RuntimeErrorCode::UnsupportedSelection
        ) {
            return Err(ControllerError::State);
        }
        let agent = request.agent_pubkey.as_str();
        let mapping = self
            .config
            .agent(agent)
            .ok_or(ControllerError::UnknownAgent)?;
        let digest = self
            .config
            .catalog_digest(agent)
            .ok_or(ControllerError::UnknownAgent)?
            .clone();
        let acceptance = self
            .store
            .accept_request(
                &mut self.state,
                agent,
                request.request_id,
                RuntimeSelection {
                    model: request.model.clone(),
                    effort: request.effort,
                    runtime_name,
                },
                digest,
                mapping.initial_runtime.clone(),
            )
            .map_err(|_| ControllerError::State)?;
        if matches!(acceptance, RequestAcceptance::Accepted(_)) {
            self.fail(agent, error)?;
        }
        self.status(agent)
            .map(|status| vec![ControllerEffect::PublishStatus(status)])
            .ok_or(ControllerError::State)
    }

    /// Re-emit every pending/applying command after controller or runner restart.
    pub fn pending_effects(&self) -> Vec<ControllerEffect> {
        self.state
            .agents
            .iter()
            .filter(|(_, state)| {
                matches!(
                    state.state,
                    RuntimeStatusState::PendingBusy | RuntimeStatusState::Applying
                )
            })
            .flat_map(|(agent, state)| {
                let Some(desired) = state.requested.clone() else {
                    return Vec::new();
                };
                let Some(mapping) = self.config.agent(agent) else {
                    return Vec::new();
                };
                let Some(method) = exact_method(mapping, &desired) else {
                    return Vec::new();
                };
                let Some(status) = self.status(agent) else {
                    return Vec::new();
                };
                vec![
                    ControllerEffect::PublishStatus(status),
                    ControllerEffect::SendControl {
                        agent_pubkey: agent.clone(),
                        control: ApplyRuntimeDefaultsControl::new(
                            state.revision,
                            desired,
                            method,
                            state.catalog_digest.clone(),
                        ),
                    },
                ]
            })
            .collect()
    }

    /// Record accepted command delivery without claiming the runner started applying.
    pub fn mark_control_sent(&mut self, agent: &str) -> Result<ControllerEffect, ControllerError> {
        if let Some(state) = self.state.agents.get(agent) {
            self.append_audit(agent, state.revision, AuditAction::ControlSent, None);
        }
        self.status(agent)
            .map(ControllerEffect::PublishStatus)
            .ok_or(ControllerError::State)
    }

    /// Apply a revision-only runner boundary receipt to public status.
    pub fn mark_runner_boundary(
        &mut self,
        agent: &str,
        revision: buzz_core::hosted_agent_runtime::RuntimeRevision,
        state: RuntimeStatusState,
    ) -> Result<ControllerEffect, ControllerError> {
        if self.state.agents.get(agent).is_none_or(|current| {
            current.revision != revision
                || current.requested.is_none()
                || !matches!(
                    current.state,
                    RuntimeStatusState::PendingBusy | RuntimeStatusState::Applying
                )
        }) {
            return self
                .status(agent)
                .map(ControllerEffect::PublishStatus)
                .ok_or(ControllerError::State);
        }
        match state {
            RuntimeStatusState::PendingBusy => self
                .store
                .mark_pending(&mut self.state, agent)
                .map_err(|_| ControllerError::State)?,
            RuntimeStatusState::Applying => self
                .store
                .mark_applying(&mut self.state, agent)
                .map_err(|_| ControllerError::State)?,
            _ => return Err(ControllerError::State),
        }
        self.status(agent)
            .map(ControllerEffect::PublishStatus)
            .ok_or(ControllerError::State)
    }

    /// Accept only an exact agent-signed effective runtime acknowledgment.
    pub fn reconcile_acknowledgment(
        &mut self,
        agent: &str,
        acknowledgment: &AgentRuntimeAcknowledgment,
    ) -> Result<ControllerEffect, ControllerError> {
        let controller_pubkey = self
            .config
            .controller_pubkey()
            .map_err(|_| ControllerError::State)?
            .to_hex();
        let Some(current) = self.state.agents.get(agent) else {
            return Err(ControllerError::State);
        };
        let current_revision = current.revision;
        if acknowledgment.revision < current_revision {
            return self
                .status(agent)
                .map(ControllerEffect::PublishStatus)
                .ok_or(ControllerError::State);
        }
        if current.requested.is_none()
            && acknowledgment_matches(
                acknowledgment,
                &controller_pubkey,
                current.revision,
                &current.effective,
                &current.catalog_digest,
            )
        {
            return self
                .status(agent)
                .map(ControllerEffect::PublishStatus)
                .ok_or(ControllerError::State);
        }
        let matches = self.state.agents.get(agent).is_some_and(|state| {
            state.requested.as_ref().is_some_and(|desired| {
                acknowledgment_matches(
                    acknowledgment,
                    &controller_pubkey,
                    state.revision,
                    desired,
                    &state.catalog_digest,
                )
            })
        });
        if matches {
            self.store
                .mark_applied(&mut self.state, agent)
                .map_err(|_| ControllerError::State)?;
            if let Some(state) = self.state.agents.get(agent) {
                self.append_audit(agent, state.revision, AuditAction::Applied, None);
            }
        } else {
            self.fail(agent, RuntimeErrorCode::AcknowledgementMismatch)?;
        }
        self.status(agent)
            .map(ControllerEffect::PublishStatus)
            .ok_or(ControllerError::State)
    }

    /// Preserve the prior effective runtime and record a fixed failure code.
    pub fn fail(&mut self, agent: &str, error: RuntimeErrorCode) -> Result<(), ControllerError> {
        self.store
            .mark_failed(&mut self.state, agent, error)
            .map_err(|_| ControllerError::State)?;
        if let Some(state) = self.state.agents.get(agent) {
            self.append_audit(agent, state.revision, AuditAction::Failed, Some(error));
        }
        Ok(())
    }

    /// Read a strict secret-free public status for one agent.
    pub fn status(&self, agent: &str) -> Option<HostedAgentRuntimeStatus> {
        let state = self.state.agents.get(agent)?;
        let agent_pubkey = serde_json::from_value(Value::String(agent.to_owned())).ok()?;
        Some(HostedAgentRuntimeStatus {
            schema: HostedAgentRuntimeStatusSchema::V1,
            agent_pubkey,
            request_id: state.request_id,
            revision: state.revision,
            state: state.state,
            effective: state.effective.clone(),
            requested: state.requested.clone(),
            catalog_digest: state.catalog_digest.clone(),
            error: state.error.clone(),
        })
    }

    /// Borrow validated configuration for the transport adapter.
    pub fn config(&self) -> &ControllerConfig {
        &self.config
    }

    fn append_audit(
        &self,
        agent: &str,
        revision: buzz_core::hosted_agent_runtime::RuntimeRevision,
        action: AuditAction,
        error: Option<RuntimeErrorCode>,
    ) {
        let request_id = self
            .state
            .agents
            .get(agent)
            .and_then(|state| state.request_id)
            .map(|id| id.as_uuid().to_string());
        let _ = self.audit.append(&AuditEntry {
            at: Utc::now(),
            agent_pubkey: agent.to_owned(),
            revision,
            action,
            request_id,
            error,
        });
    }
}

fn exact_method(
    mapping: &AgentServiceMapping,
    desired: &RuntimeSelection,
) -> Option<buzz_core::hosted_agent_runtime::RuntimeSelectionMethod> {
    mapping
        .catalog
        .bindings
        .iter()
        .find(|binding| binding.model == desired.model && binding.effort == desired.effort)
        .map(|binding| binding.method.clone())
}

/// Run the authenticated relay reconciliation loop until the connection fails.
pub async fn run_relay_loop(controller: &mut Controller) -> Result<()> {
    let keys = controller
        .config()
        .controller_keys()
        .context("controller key")?;
    let controller_pubkey = keys.public_key().to_hex();
    let mut connection =
        NostrWsConnection::connect_authenticated(controller.config().relay_url(), &keys, None)
            .await
            .context("connect controller")?;
    let agents: Vec<_> = controller
        .config()
        .agent_pubkeys()
        .map(str::to_owned)
        .collect();
    let since = Utc::now()
        .timestamp()
        .saturating_sub(REQUEST_FRESHNESS_SECS);
    connection
        .send_raw(&json!(["REQ", "runtime-profiles", {
            "kinds": [KIND_AGENT_PROFILE],
            "authors": &agents
        }]))
        .await?;

    // Replay authoritative self-authored profiles before accepting ephemeral
    // browser requests. Otherwise a request racing controller startup could be
    // dropped merely because its runtime name/profile event had not replayed.
    let mut profiles = std::collections::BTreeMap::<String, AgentProfileSnapshot>::new();
    loop {
        match connection.next_event(Duration::from_secs(45)).await? {
            RelayMessage::Event {
                subscription_id,
                event,
            } if subscription_id == "runtime-profiles" => {
                ingest_profile(controller, &mut connection, &keys, &mut profiles, &event).await?;
            }
            RelayMessage::Eose { subscription_id } if subscription_id == "runtime-profiles" => {
                break;
            }
            RelayMessage::Closed { message, .. } => {
                anyhow::bail!("profile subscription closed: {message}")
            }
            RelayMessage::Notice { message } => anyhow::bail!("relay notice: {message}"),
            _ => {}
        }
    }

    connection
        .send_raw(&json!(["REQ", "runtime-requests", {
            "kinds": [KIND_HOSTED_AGENT_RUNTIME_REQUEST],
            "#p": [controller_pubkey],
            "since": since
        }]))
        .await?;
    connection
        .send_raw(&json!(["REQ", "runtime-receipts", {
            "kinds": [KIND_AGENT_OBSERVER_FRAME],
            "authors": &agents,
            "#p": [keys.public_key().to_hex()],
            "#frame": ["telemetry"],
            "since": since
        }]))
        .await?;
    connection
        .send_raw(&json!(["REQ", "runtime-status", {
            "kinds": [KIND_HOSTED_AGENT_RUNTIME_STATUS],
            "authors": [keys.public_key().to_hex()]
        }]))
        .await?;

    let mut replayed = false;
    loop {
        match connection.next_event(Duration::from_secs(45)).await {
            Ok(RelayMessage::Event {
                subscription_id,
                event,
            }) => match subscription_id.as_str() {
                "runtime-requests" => {
                    if let Some((request, name)) =
                        decode_request(controller, &keys, &event, &profiles)
                    {
                        let runtime_name = name.clone();
                        let effects = controller.accept_request(
                            &request,
                            RuntimeRequestContext {
                                author_pubkey: &event.pubkey.to_hex(),
                                runtime_name: name,
                                agent_online: true,
                            },
                        );
                        match effects {
                            Ok(effects) => {
                                publish_effects(controller, &mut connection, &keys, effects)
                                    .await?;
                            }
                            Err(ControllerError::StaleCatalog) => {
                                let effects = controller.reject_request(
                                    &request,
                                    runtime_name,
                                    RuntimeErrorCode::StaleCatalog,
                                )?;
                                publish_effects(controller, &mut connection, &keys, effects)
                                    .await?;
                            }
                            Err(ControllerError::UnsupportedSelection) => {
                                let effects = controller.reject_request(
                                    &request,
                                    runtime_name,
                                    RuntimeErrorCode::UnsupportedSelection,
                                )?;
                                publish_effects(controller, &mut connection, &keys, effects)
                                    .await?;
                            }
                            Err(_) => {}
                        }
                    }
                }
                "runtime-profiles" => {
                    ingest_profile(controller, &mut connection, &keys, &mut profiles, &event)
                        .await?;
                }
                "runtime-receipts" => {
                    handle_receipt(controller, &keys, &event, &mut connection).await?;
                }
                _ => {}
            },
            Ok(RelayMessage::Eose { subscription_id }) => {
                if subscription_id == "runtime-status" && !replayed {
                    replayed = true;
                    publish_effects(
                        controller,
                        &mut connection,
                        &keys,
                        controller.pending_effects(),
                    )
                    .await?;
                }
            }
            Ok(RelayMessage::Closed { message, .. }) => {
                anyhow::bail!("subscription closed: {message}")
            }
            Ok(RelayMessage::Notice { message }) => anyhow::bail!("relay notice: {message}"),
            Ok(_) => {}
            Err(error) => return Err(error).context("runtime controller relay loop"),
        }
    }
}

async fn ingest_profile(
    controller: &mut Controller,
    connection: &mut NostrWsConnection,
    keys: &Keys,
    profiles: &mut std::collections::BTreeMap<String, AgentProfileSnapshot>,
    event: &Event,
) -> Result<()> {
    if buzz_core::verify_event(event).is_err() {
        return Ok(());
    }
    let agent = event.pubkey.to_hex();
    if controller.config().agent(&agent).is_none() {
        return Ok(());
    }
    let Ok(snapshot) = AgentProfileSnapshot::parse(event) else {
        return Ok(());
    };
    if let Some(ack) = snapshot.runtime.as_ref() {
        if controller.status(&agent).is_some() {
            let effect = controller
                .reconcile_acknowledgment(&agent, ack)
                .context("reconcile profile acknowledgment")?;
            publish_effects(controller, connection, keys, vec![effect]).await?;
        }
    }
    profiles.insert(agent, snapshot);
    Ok(())
}

#[derive(Default)]
struct AgentProfileSnapshot {
    event_id: String,
    name: Option<buzz_core::hosted_agent_runtime::RuntimeName>,
    runtime: Option<AgentRuntimeAcknowledgment>,
}

impl AgentProfileSnapshot {
    fn parse(event: &Event) -> Result<Self> {
        let content: Value = serde_json::from_str(&event.content).context("profile JSON")?;
        let object = content.as_object().context("profile object")?;
        let name = object
            .get("display_name")
            .or_else(|| object.get("name"))
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .context("profile name")?;
        let runtime = object
            .get("runtime")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .context("profile runtime")?;
        Ok(Self {
            event_id: event.id.to_hex(),
            name,
            runtime,
        })
    }
}

fn decode_request(
    controller: &Controller,
    keys: &Keys,
    event: &Event,
    profiles: &std::collections::BTreeMap<String, AgentProfileSnapshot>,
) -> Option<(
    HostedAgentRuntimeRequest,
    buzz_core::hosted_agent_runtime::RuntimeName,
)> {
    let now = Utc::now().timestamp();
    if buzz_core::verify_event(event).is_err()
        || event.kind.as_u16() as u32 != KIND_HOSTED_AGENT_RUNTIME_REQUEST
        || event.pubkey.to_hex() != controller.config().owner_pubkey().as_str()
        || (event.created_at.as_secs() as i64 - now).unsigned_abs() > REQUEST_FRESHNESS_SECS as u64
    {
        return None;
    }
    let request: HostedAgentRuntimeRequest = decrypt_observer_payload(keys, event).ok()?;
    if !request_envelope_matches(event, keys, &request, now) {
        return None;
    }
    let profile = profiles.get(request.agent_pubkey.as_str())?;
    if request
        .presentation_event_id
        .as_ref()
        .is_some_and(|event_id| event_id.as_str() != profile.event_id)
    {
        return None;
    }
    let name = profile.name.clone()?;
    Some((request, name))
}

fn request_envelope_matches(
    event: &Event,
    controller_keys: &Keys,
    request: &HostedAgentRuntimeRequest,
    now: i64,
) -> bool {
    if event.tags.len() != 4 {
        return false;
    }
    let exact = |name: &str| -> Option<&str> {
        let mut values = event.tags.iter().filter_map(|tag| {
            let parts = tag.as_slice();
            (parts.first().is_some_and(|value| value == name) && parts.len() == 2)
                .then(|| parts[1].as_str())
        });
        let value = values.next()?;
        values.next().is_none().then_some(value)
    };
    let expiration = exact("expiration").and_then(|value| value.parse::<i64>().ok());
    let controller_pubkey = controller_keys.public_key().to_hex();
    let request_id = request.request_id.as_uuid().to_string();
    exact("p") == Some(controller_pubkey.as_str())
        && exact("agent") == Some(request.agent_pubkey.as_str())
        && exact("request") == Some(request_id.as_str())
        && expiration.is_some_and(|value| value >= now && value <= now + REQUEST_FRESHNESS_SECS)
}

async fn handle_receipt(
    controller: &mut Controller,
    keys: &Keys,
    event: &Event,
    connection: &mut NostrWsConnection,
) -> Result<()> {
    if buzz_core::verify_event(event).is_err() {
        return Ok(());
    }
    let agent = event.pubkey.to_hex();
    if controller.config().agent(&agent).is_none() {
        return Ok(());
    }
    let receipt: RuntimeApplicationReceipt = match decrypt_observer_payload(keys, event) {
        Ok(receipt) => receipt,
        Err(_) => return Ok(()),
    };
    let effect = match receipt {
        RuntimeApplicationReceipt::PendingBusy { revision } => controller.mark_runner_boundary(
            agent.as_str(),
            revision,
            RuntimeStatusState::PendingBusy,
        )?,
        RuntimeApplicationReceipt::Applying { revision } => controller.mark_runner_boundary(
            agent.as_str(),
            revision,
            RuntimeStatusState::Applying,
        )?,
        RuntimeApplicationReceipt::Applied { acknowledgment } => {
            controller.reconcile_acknowledgment(&agent, &acknowledgment)?
        }
        RuntimeApplicationReceipt::Failed { revision, error } => {
            if controller.status(&agent).is_some_and(|status| {
                status.revision == revision
                    && status.requested.is_some()
                    && matches!(
                        status.state,
                        RuntimeStatusState::PendingBusy | RuntimeStatusState::Applying
                    )
            }) {
                controller.fail(&agent, error)?;
                ControllerEffect::PublishStatus(controller.status(&agent).context("failed status")?)
            } else {
                return Ok(());
            }
        }
    };
    publish_effects(controller, connection, keys, vec![effect]).await
}

async fn publish_effects(
    controller: &mut Controller,
    connection: &mut NostrWsConnection,
    keys: &Keys,
    effects: Vec<ControllerEffect>,
) -> Result<()> {
    for effect in effects {
        match effect {
            ControllerEffect::PublishStatus(status) => {
                let event =
                    buzz_sdk::build_hosted_agent_runtime_status(&status)?.sign_with_keys(keys)?;
                let accepted = connection.send_event(event).await?;
                if !accepted.accepted {
                    anyhow::bail!("runtime status rejected")
                }
            }
            ControllerEffect::SendControl {
                agent_pubkey,
                control,
            } => {
                let recipient = PublicKey::parse(&agent_pubkey).context("agent public key")?;
                let encrypted = encrypt_observer_payload(keys, &recipient, &control)?;
                let event = buzz_sdk::build_hosted_runtime_control_frame(
                    &agent_pubkey,
                    &agent_pubkey,
                    &encrypted,
                )?
                .sign_with_keys(keys)?;
                let accepted = connection.send_event(event).await?;
                if accepted.accepted {
                    let status = controller.mark_control_sent(&agent_pubkey)?;
                    if let ControllerEffect::PublishStatus(status) = status {
                        let event = buzz_sdk::build_hosted_agent_runtime_status(&status)?
                            .sign_with_keys(keys)?;
                        let _ = connection.send_event(event).await?;
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ControllerConfig;
    use nostr::Keys;
    use serde_json::json;
    use tempfile::tempdir;

    struct Fixture {
        controller: Controller,
        owner: String,
        agent: String,
        digest: buzz_core::hosted_agent_runtime::CatalogDigest,
    }

    fn fixture() -> Fixture {
        let directory = tempdir().expect("tempdir").keep();
        let controller_keys = Keys::generate();
        let owner = "a".repeat(64);
        let agent = "b".repeat(64);
        let raw = json!({
            "relay_url":"ws://127.0.0.1:3000",
            "controller_private_key":controller_keys.secret_key().to_secret_hex(),
            "owner_pubkey":owner,
            "state_path":directory.join("state.json"),
            "audit_path":directory.join("audit.jsonl"),
            "agents":[{
                "agent_pubkey":agent,
                "service":"market-intelligence",
                "catalog":{
                    "model_families":[{
                        "id":"gpt-5.6-terra","name":"GPT-5.6-Terra","description":"Balanced",
                        "default_effort":"medium","efforts":["medium","high"]
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
                "initial_runtime":{"model":"gpt-5.6-terra","effort":"medium","runtime_name":"Market Intelligence"}
            }]
        });
        let config = ControllerConfig::from_json(&raw.to_string()).expect("config");
        let digest = config.catalog_digest(&agent).expect("digest").clone();
        Fixture {
            controller: Controller::open(config).expect("controller"),
            owner,
            agent,
            digest,
        }
    }

    fn request(fixture: &Fixture, request_id: &str) -> HostedAgentRuntimeRequest {
        serde_json::from_value(json!({
            "schema":"buzz.hosted-agent-runtime-request.v1",
            "request_id":request_id,
            "agent_pubkey":fixture.agent,
            "model":"gpt-5.6-sol",
            "effort":"high",
            "presentation_event_id":null,
            "catalog_digest":fixture.digest
        }))
        .expect("request")
    }

    fn name() -> buzz_core::hosted_agent_runtime::RuntimeName {
        serde_json::from_value(json!("Market Intelligence")).expect("name")
    }

    #[test]
    fn valid_request_is_durable_and_offline_request_stays_pending() {
        let mut fixture = fixture();
        let first_request = request(&fixture, "550e8400-e29b-41d4-a716-446655440000");
        let effects = fixture
            .controller
            .accept_request(
                &first_request,
                RuntimeRequestContext {
                    author_pubkey: &fixture.owner,
                    runtime_name: name(),
                    agent_online: false,
                },
            )
            .expect("accept");
        assert_eq!(effects.len(), 1);
        assert!(matches!(
            effects[0],
            ControllerEffect::PublishStatus(ref status)
                if status.state == RuntimeStatusState::PendingBusy
        ));
        assert_eq!(fixture.controller.pending_effects().len(), 2);
    }

    #[test]
    fn first_start_bootstrap_gets_an_exact_ack_and_opens_future_dispatch() {
        let mut fixture = fixture();
        let status = fixture
            .controller
            .status(&fixture.agent)
            .expect("bootstrap");
        assert_eq!(status.revision.get(), 1);
        assert_eq!(status.state, RuntimeStatusState::PendingBusy);
        assert_eq!(fixture.controller.pending_effects().len(), 2);
        let ack: AgentRuntimeAcknowledgment = serde_json::from_value(json!({
            "schema":"buzz.agent-runtime.v1",
            "controller_pubkey":fixture.controller.config().controller_pubkey().expect("key").to_hex(),
            "revision":1,
            "model":"gpt-5.6-terra",
            "effort":"medium",
            "effective_name":"Market Intelligence",
            "catalog_digest":fixture.digest
        }))
        .expect("ack");
        fixture
            .controller
            .reconcile_acknowledgment(&fixture.agent, &ack)
            .expect("apply bootstrap");
        let status = fixture.controller.status(&fixture.agent).expect("status");
        assert_eq!(status.state, RuntimeStatusState::Applied);
        assert!(status.requested.is_none());
        assert!(fixture.controller.pending_effects().is_empty());
    }

    #[test]
    fn controller_revalidates_exact_request_tags_payload_and_expiration() {
        let fixture = fixture();
        let controller_keys = fixture
            .controller
            .config()
            .controller_keys()
            .expect("controller keys");
        let owner = Keys::generate();
        let first_request = request(&fixture, "550e8400-e29b-41d4-a716-446655440000");
        let encrypted =
            encrypt_observer_payload(&owner, &controller_keys.public_key(), &first_request)
                .expect("encrypt");
        let now = Utc::now().timestamp();
        let event = buzz_sdk::build_hosted_agent_runtime_request(
            &controller_keys.public_key().to_hex(),
            &first_request,
            (now + 120) as u64,
            &encrypted,
        )
        .expect("builder")
        .custom_created_at(nostr::Timestamp::from(now as u64))
        .sign_with_keys(&owner)
        .expect("event");
        assert!(request_envelope_matches(
            &event,
            &controller_keys,
            &first_request,
            now
        ));

        let mismatched = request(&fixture, "550e8400-e29b-41d4-a716-446655440001");
        assert!(!request_envelope_matches(
            &event,
            &controller_keys,
            &mismatched,
            now
        ));

        let too_late = buzz_sdk::build_hosted_agent_runtime_request(
            &controller_keys.public_key().to_hex(),
            &first_request,
            (now + REQUEST_FRESHNESS_SECS + 1) as u64,
            &encrypted,
        )
        .expect("builder")
        .custom_created_at(nostr::Timestamp::from(now as u64))
        .sign_with_keys(&owner)
        .expect("event");
        assert!(!request_envelope_matches(
            &too_late,
            &controller_keys,
            &first_request,
            now
        ));
    }

    #[test]
    fn rejects_non_owner_stale_catalog_and_unsupported_selection() {
        let mut fixture = fixture();
        let mut request = request(&fixture, "550e8400-e29b-41d4-a716-446655440000");
        assert!(matches!(
            fixture.controller.accept_request(
                &request,
                RuntimeRequestContext {
                    author_pubkey: &"d".repeat(64),
                    runtime_name: name(),
                    agent_online: true
                }
            ),
            Err(ControllerError::OwnerOnly)
        ));
        request.catalog_digest = serde_json::from_value(json!("e".repeat(64))).expect("digest");
        assert!(matches!(
            fixture.controller.accept_request(
                &request,
                RuntimeRequestContext {
                    author_pubkey: &fixture.owner,
                    runtime_name: name(),
                    agent_online: true
                }
            ),
            Err(ControllerError::StaleCatalog)
        ));
        let effects = fixture
            .controller
            .reject_request(&request, name(), RuntimeErrorCode::StaleCatalog)
            .expect("fixed stale status");
        assert!(matches!(
            effects.as_slice(),
            [ControllerEffect::PublishStatus(status)]
                if status.state == RuntimeStatusState::Failed
                    && status.error.as_ref().is_some_and(|error| {
                        error.code == RuntimeErrorCode::StaleCatalog
                            && error.message == RuntimeErrorCode::StaleCatalog.message()
                    })
        ));

        let unsupported: HostedAgentRuntimeRequest = serde_json::from_value(json!({
            "schema":"buzz.hosted-agent-runtime-request.v1",
            "request_id":"550e8400-e29b-41d4-a716-446655440001",
            "agent_pubkey":fixture.agent,
            "model":"gpt-5.6-luna",
            "effort":"high",
            "presentation_event_id":null,
            "catalog_digest":fixture.digest
        }))
        .expect("unsupported request");
        assert!(matches!(
            fixture.controller.accept_request(
                &unsupported,
                RuntimeRequestContext {
                    author_pubkey: &fixture.owner,
                    runtime_name: name(),
                    agent_online: true
                }
            ),
            Err(ControllerError::UnsupportedSelection)
        ));
        fixture
            .controller
            .reject_request(&unsupported, name(), RuntimeErrorCode::UnsupportedSelection)
            .expect("fixed unsupported status");
        let status = fixture.controller.status(&fixture.agent).expect("status");
        assert_eq!(status.state, RuntimeStatusState::Failed);
        assert_eq!(
            status.error.expect("error").message,
            RuntimeErrorCode::UnsupportedSelection.message()
        );
    }

    #[test]
    fn higher_request_supersedes_pending_or_applying_and_restart_resends_latest() {
        let mut fixture = fixture();
        for (request_id, online) in [
            ("550e8400-e29b-41d4-a716-446655440000", true),
            ("550e8400-e29b-41d4-a716-446655440001", true),
        ] {
            let request = request(&fixture, request_id);
            fixture
                .controller
                .accept_request(
                    &request,
                    RuntimeRequestContext {
                        author_pubkey: &fixture.owner,
                        runtime_name: name(),
                        agent_online: online,
                    },
                )
                .expect("accept");
            fixture
                .controller
                .mark_control_sent(&fixture.agent)
                .expect("sent");
            let revision = fixture
                .controller
                .status(&fixture.agent)
                .expect("status")
                .revision;
            fixture
                .controller
                .mark_runner_boundary(&fixture.agent, revision, RuntimeStatusState::Applying)
                .expect("applying");
        }
        let status = fixture.controller.status(&fixture.agent).expect("status");
        assert_eq!(status.revision.get(), 3);
        assert_eq!(status.state, RuntimeStatusState::Applying);
        assert_eq!(fixture.controller.pending_effects().len(), 2);
    }

    #[test]
    fn only_exact_ack_applies_and_mismatch_uses_fixed_public_error() {
        let mut fixture = fixture();
        let first_request = request(&fixture, "550e8400-e29b-41d4-a716-446655440000");
        fixture
            .controller
            .accept_request(
                &first_request,
                RuntimeRequestContext {
                    author_pubkey: &fixture.owner,
                    runtime_name: name(),
                    agent_online: true,
                },
            )
            .expect("accept");
        let mut ack: AgentRuntimeAcknowledgment = serde_json::from_value(json!({
            "schema":"buzz.agent-runtime.v1",
            "controller_pubkey":fixture.controller.config().controller_pubkey().expect("key").to_hex(),
            "revision":2,
            "model":"gpt-5.6-sol",
            "effort":"high",
            "effective_name":"Wrong Name",
            "catalog_digest":fixture.digest
        }))
        .expect("ack");
        fixture
            .controller
            .reconcile_acknowledgment(&fixture.agent, &ack)
            .expect("mismatch status");
        let status = fixture.controller.status(&fixture.agent).expect("status");
        assert_eq!(status.state, RuntimeStatusState::Failed);
        assert_eq!(
            status.error.expect("error").message,
            RuntimeErrorCode::AcknowledgementMismatch.message()
        );

        let second = request(&fixture, "550e8400-e29b-41d4-a716-446655440001");
        fixture
            .controller
            .accept_request(
                &second,
                RuntimeRequestContext {
                    author_pubkey: &fixture.owner,
                    runtime_name: name(),
                    agent_online: true,
                },
            )
            .expect("second");
        ack = serde_json::from_value(json!({
            "schema":"buzz.agent-runtime.v1",
            "controller_pubkey":fixture.controller.config().controller_pubkey().expect("key").to_hex(),
            "revision":3,
            "model":"gpt-5.6-sol",
            "effort":"high",
            "effective_name":"Market Intelligence",
            "catalog_digest":fixture.digest
        }))
        .expect("ack");
        fixture
            .controller
            .reconcile_acknowledgment(&fixture.agent, &ack)
            .expect("apply");
        assert_eq!(
            fixture
                .controller
                .status(&fixture.agent)
                .expect("status")
                .state,
            RuntimeStatusState::Applied
        );
    }
}
