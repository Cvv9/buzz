//! Strict, shared contracts for durable hosted-agent runtime control.
//!
//! These types are deliberately zero-I/O. The browser, relay, controller, and
//! agent runner use the same wire vocabulary, identifier validation, and
//! catalog digest so no surface can silently reinterpret a runtime request.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::num::NonZeroU64;
use thiserror::Error;
use uuid::{Uuid, Version};

const LOWER_HEX_32_BYTES: usize = 64;
const MAX_MODEL_ID_BYTES: usize = 128;
const MAX_RUNTIME_NAME_BYTES: usize = 128;

/// Errors raised while validating or canonicalizing runtime protocol data.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RuntimeProtocolError {
    /// A model family was repeated with conflicting immutable metadata.
    #[error("model family {0} has conflicting metadata")]
    ConflictingModelFamily(String),
    /// A family default effort is absent from its advertised effort list.
    #[error("model family {0} does not include its default effort")]
    MissingDefaultEffort(String),
    /// A private adapter binding references an unadvertised model/effort pair.
    #[error("adapter binding references an unadvertised selection")]
    UnadvertisedBinding,
    /// Canonical JSON serialization failed.
    #[error("catalog serialization failed: {0}")]
    Serialization(String),
}

/// Exact schema marker for an encrypted hosted-agent runtime request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HostedAgentRuntimeRequestSchema {
    /// Version 1 runtime request schema.
    #[serde(rename = "buzz.hosted-agent-runtime-request.v1")]
    V1,
}

/// Exact schema marker for a controller-authored runtime status snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HostedAgentRuntimeStatusSchema {
    /// Version 1 runtime status schema.
    #[serde(rename = "buzz.hosted-agent-runtime-status.v1")]
    V1,
}

/// Exact schema marker for an agent-signed runtime acknowledgment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentRuntimeAcknowledgmentSchema {
    /// Version 1 agent runtime acknowledgment schema.
    #[serde(rename = "buzz.agent-runtime.v1")]
    V1,
}

/// Canonical lowercase 32-byte public key used by runtime-control payloads.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RuntimePubkey(String);

impl RuntimePubkey {
    /// Return the canonical lowercase hexadecimal public key.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Canonical lowercase SHA-256 digest.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CatalogDigest(String);

impl CatalogDigest {
    /// Return the canonical lowercase digest.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Canonical lowercase Nostr event identifier.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RuntimeEventId(String);

impl RuntimeEventId {
    /// Return the canonical lowercase event identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

macro_rules! lowercase_hex_string {
    ($type:ty, $label:literal) => {
        impl Serialize for $type {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_str(&self.0)
            }
        }

        impl<'de> Deserialize<'de> for $type {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                if is_lower_hex_32(&value) {
                    Ok(Self(value))
                } else {
                    Err(serde::de::Error::custom(concat!(
                        $label,
                        " must be exactly 64 lowercase hexadecimal characters"
                    )))
                }
            }
        }
    };
}

lowercase_hex_string!(RuntimePubkey, "pubkey");
lowercase_hex_string!(CatalogDigest, "catalog digest");
lowercase_hex_string!(RuntimeEventId, "event id");

fn is_lower_hex_32(value: &str) -> bool {
    value.len() == LOWER_HEX_32_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Canonical UUID v4 request identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RuntimeRequestId(Uuid);

impl RuntimeRequestId {
    /// Return the parsed UUID.
    pub const fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}

impl Serialize for RuntimeRequestId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for RuntimeRequestId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        let parsed = Uuid::parse_str(&value).map_err(serde::de::Error::custom)?;
        if parsed.get_version() != Some(Version::Random) || parsed.to_string() != value {
            return Err(serde::de::Error::custom(
                "request_id must be a canonical lowercase UUID v4",
            ));
        }
        Ok(Self(parsed))
    }
}

/// Nonzero, monotonically increasing controller revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RuntimeRevision(NonZeroU64);

impl RuntimeRevision {
    /// Construct a revision when the supplied value is nonzero.
    pub const fn new(value: u64) -> Option<Self> {
        match NonZeroU64::new(value) {
            Some(value) => Some(Self(value)),
            None => None,
        }
    }

    /// Return the integer revision.
    pub const fn get(self) -> u64 {
        self.0.get()
    }
}

impl Serialize for RuntimeRevision {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u64(self.get())
    }
}

impl<'de> Deserialize<'de> for RuntimeRevision {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u64::deserialize(deserializer)?;
        Self::new(value).ok_or_else(|| serde::de::Error::custom("revision must be nonzero"))
    }
}

/// Base runtime model identifier, excluding any effort suffix.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RuntimeModelId(String);

impl RuntimeModelId {
    /// Return the validated base model identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Serialize for RuntimeModelId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for RuntimeModelId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        let mut bytes = value.bytes();
        let valid_first = bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
        let valid_rest = bytes.all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'-' | b'_' | b'.' | b'/')
        });
        if value.len() > MAX_MODEL_ID_BYTES || !valid_first || !valid_rest {
            return Err(serde::de::Error::custom("invalid base model id"));
        }
        Ok(Self(value))
    }
}

/// Runtime-facing agent name applied at the same idle boundary as model/effort.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RuntimeName(String);

impl RuntimeName {
    /// Return the validated runtime name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Serialize for RuntimeName {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for RuntimeName {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value.is_empty()
            || value.len() > MAX_RUNTIME_NAME_BYTES
            || value.trim() != value
            || value.chars().any(char::is_control)
        {
            return Err(serde::de::Error::custom("invalid runtime name"));
        }
        Ok(Self(value))
    }
}

/// Supported reasoning effort for a model family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReasoningEffort {
    /// Low reasoning effort.
    Low,
    /// Medium reasoning effort.
    Medium,
    /// High reasoning effort.
    High,
    /// Extra-high reasoning effort.
    Xhigh,
    /// Maximum reasoning effort.
    Max,
    /// Ultra reasoning effort.
    Ultra,
}

/// Controller-visible runtime reconciliation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStatusState {
    /// No requested change differs from the effective runtime.
    Current,
    /// Change is durable but waiting for active work to finish.
    PendingBusy,
    /// Agent is applying the change to fresh sessions.
    Applying,
    /// Matching agent acknowledgment made the revision effective.
    Applied,
    /// Application failed and the prior effective runtime remains active.
    Failed,
}

/// Model, effort, and runtime name applied together as one default revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeSelection {
    /// Base model family ID.
    pub model: RuntimeModelId,
    /// Reasoning effort within the selected family.
    pub effort: ReasoningEffort,
    /// Runtime-facing agent name.
    pub runtime_name: RuntimeName,
}

/// Encrypted owner-authored request body delivered only to the pinned controller.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostedAgentRuntimeRequest {
    /// Exact request schema marker.
    pub schema: HostedAgentRuntimeRequestSchema,
    /// Idempotent UUID v4 shared with the event tag.
    pub request_id: RuntimeRequestId,
    /// Exact hosted-agent target.
    pub agent_pubkey: RuntimePubkey,
    /// Requested base model family.
    pub model: RuntimeModelId,
    /// Requested reasoning effort.
    pub effort: ReasoningEffort,
    /// Accepted presentation event when a runtime-name reconcile accompanies the request.
    pub presentation_event_id: Option<RuntimeEventId>,
    /// Digest of the signed normalized model catalog used by the browser.
    pub catalog_digest: CatalogDigest,
}

/// Agent-signed effective runtime acknowledgment embedded in kind `10100`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentRuntimeAcknowledgment {
    /// Exact acknowledgment schema marker.
    pub schema: AgentRuntimeAcknowledgmentSchema,
    /// Controller whose revision was applied.
    pub controller_pubkey: RuntimePubkey,
    /// Applied controller revision.
    pub revision: RuntimeRevision,
    /// Effective base model family.
    pub model: RuntimeModelId,
    /// Effective reasoning effort.
    pub effort: ReasoningEffort,
    /// Effective runtime-facing agent name.
    pub effective_name: RuntimeName,
    /// Digest of the exact catalog used for selection.
    pub catalog_digest: CatalogDigest,
}

/// Fixed, secret-free runtime failure code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeErrorCode {
    /// Requested pair is not present in the validated catalog.
    UnsupportedSelection,
    /// Browser catalog digest no longer matches the agent catalog.
    StaleCatalog,
    /// Controller did not acknowledge the request inside the client deadline.
    ControllerUnavailable,
    /// Hosted agent is not currently available for application.
    AgentUnavailable,
    /// ACP adapter rejected an otherwise validated selection.
    AdapterRejected,
    /// Agent acknowledgment did not exactly match the desired revision.
    AcknowledgementMismatch,
    /// Fixed catch-all that exposes no implementation detail.
    InternalError,
}

impl RuntimeErrorCode {
    /// Return the only permitted user-facing message for this code.
    pub const fn message(self) -> &'static str {
        match self {
            Self::UnsupportedSelection => "This model and effort combination is not available.",
            Self::StaleCatalog => "The agent model catalog changed. Refresh and try again.",
            Self::ControllerUnavailable => "The runtime controller is unavailable. Try again.",
            Self::AgentUnavailable => "The agent is unavailable. The change remains pending.",
            Self::AdapterRejected => "The agent could not apply this model and effort combination.",
            Self::AcknowledgementMismatch => {
                "The agent did not confirm the requested runtime revision."
            }
            Self::InternalError => "The runtime change failed. Try again.",
        }
    }
}

/// Fixed, redacted error payload suitable for a public controller status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RedactedRuntimeError {
    /// Fixed safe error code.
    pub code: RuntimeErrorCode,
    /// Fixed user-facing message bound to [`Self::code`].
    pub message: String,
}

impl RedactedRuntimeError {
    /// Construct the canonical public error for a fixed code.
    pub fn new(code: RuntimeErrorCode) -> Self {
        Self {
            code,
            message: code.message().to_owned(),
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RedactedRuntimeErrorWire {
    code: RuntimeErrorCode,
    message: String,
}

impl<'de> Deserialize<'de> for RedactedRuntimeError {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = RedactedRuntimeErrorWire::deserialize(deserializer)?;
        if wire.message != wire.code.message() {
            return Err(serde::de::Error::custom(
                "runtime error message does not match its fixed code",
            ));
        }
        Ok(Self {
            code: wire.code,
            message: wire.message,
        })
    }
}

/// Public controller status snapshot for one hosted agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostedAgentRuntimeStatus {
    /// Exact status schema marker.
    pub schema: HostedAgentRuntimeStatusSchema,
    /// Hosted agent described by this `d`-tagged snapshot.
    pub agent_pubkey: RuntimePubkey,
    /// Request responsible for the pending/applied state, when one exists.
    pub request_id: Option<RuntimeRequestId>,
    /// Nonzero controller revision.
    pub revision: RuntimeRevision,
    /// Current reconciliation state.
    pub state: RuntimeStatusState,
    /// Last agent-acknowledged runtime selection.
    pub effective: RuntimeSelection,
    /// Desired selection while a change is pending or failed.
    pub requested: Option<RuntimeSelection>,
    /// Digest of the validated catalog for this revision.
    pub catalog_digest: CatalogDigest,
    /// Fixed redacted failure, present only for a failed state.
    pub error: Option<RedactedRuntimeError>,
}

/// One base model and its recognized reasoning-effort choices.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelFamily {
    /// Canonical base model ID.
    pub id: RuntimeModelId,
    /// Human-readable model name.
    pub name: String,
    /// Signed model description.
    pub description: String,
    /// Effort selected when the user has not chosen another supported value.
    pub default_effort: ReasoningEffort,
    /// Recognized effort choices supported by this exact adapter.
    pub efforts: Vec<ReasoningEffort>,
}

/// Exact ACP operation that applies one validated model/effort pair.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum RuntimeSelectionMethod {
    /// Stable ACP `session/set_config_option` binding.
    ConfigOption {
        /// Adapter-emitted model configuration ID.
        config_id: String,
        /// Exact adapter-emitted value for the selected pair.
        option_value: String,
    },
    /// Unstable ACP `session/set_model` binding.
    SetModel {
        /// Exact adapter-emitted selection ID.
        model_id: String,
    },
}

/// Private mapping from a public pair to an exact ACP operation.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeBinding {
    /// Public base model family.
    pub model: RuntimeModelId,
    /// Public reasoning effort.
    pub effort: ReasoningEffort,
    /// Exact private ACP method and selection value.
    pub method: RuntimeSelectionMethod,
}

/// Public families plus private exact adapter bindings used for digesting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeCatalog {
    /// Public model families exposed to clients.
    pub model_families: Vec<ModelFamily>,
    /// Controller-only model/effort-to-ACP mappings.
    pub bindings: Vec<RuntimeBinding>,
}

#[derive(Debug)]
struct FamilyAccumulator {
    name: String,
    description: String,
    default_effort: ReasoningEffort,
    efforts: BTreeSet<ReasoningEffort>,
}

/// Compute SHA-256 over a deterministic, duplicate-free runtime catalog.
///
/// Families are keyed by base model ID, effort lists are sorted and deduped,
/// and exact private bindings are sorted and deduped. Conflicting metadata or
/// a binding outside the public catalog fails closed instead of letting input
/// order choose a different digest.
pub fn normalized_catalog_digest(
    catalog: &RuntimeCatalog,
) -> Result<CatalogDigest, RuntimeProtocolError> {
    let mut families: BTreeMap<RuntimeModelId, FamilyAccumulator> = BTreeMap::new();
    for family in &catalog.model_families {
        match families.get_mut(&family.id) {
            Some(existing) => {
                if existing.name != family.name
                    || existing.description != family.description
                    || existing.default_effort != family.default_effort
                {
                    return Err(RuntimeProtocolError::ConflictingModelFamily(
                        family.id.as_str().to_owned(),
                    ));
                }
                existing.efforts.extend(family.efforts.iter().copied());
            }
            None => {
                families.insert(
                    family.id.clone(),
                    FamilyAccumulator {
                        name: family.name.clone(),
                        description: family.description.clone(),
                        default_effort: family.default_effort,
                        efforts: family.efforts.iter().copied().collect(),
                    },
                );
            }
        }
    }

    let mut normalized_families = Vec::with_capacity(families.len());
    for (id, family) in families {
        if !family.efforts.contains(&family.default_effort) {
            return Err(RuntimeProtocolError::MissingDefaultEffort(
                id.as_str().to_owned(),
            ));
        }
        normalized_families.push(ModelFamily {
            id,
            name: family.name,
            description: family.description,
            default_effort: family.default_effort,
            efforts: family.efforts.into_iter().collect(),
        });
    }

    let normalized_bindings: Vec<_> = catalog
        .bindings
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    for binding in &normalized_bindings {
        let advertised = normalized_families
            .iter()
            .any(|family| family.id == binding.model && family.efforts.contains(&binding.effort));
        if !advertised {
            return Err(RuntimeProtocolError::UnadvertisedBinding);
        }
    }

    let normalized = RuntimeCatalog {
        model_families: normalized_families,
        bindings: normalized_bindings,
    };
    let bytes = serde_json::to_vec(&normalized)
        .map_err(|error| RuntimeProtocolError::Serialization(error.to_string()))?;
    Ok(CatalogDigest(hex::encode(Sha256::digest(bytes))))
}

impl fmt::Display for CatalogDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kind::{
        is_ephemeral, is_parameterized_replaceable, ALL_KINDS, KIND_HOSTED_AGENT_RUNTIME_REQUEST,
        KIND_HOSTED_AGENT_RUNTIME_STATUS,
    };
    use serde::de::DeserializeOwned;
    use serde_json::{json, Value};

    const AGENT_PUBKEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const CONTROLLER_PUBKEY: &str =
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const REQUEST_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
    const DIGEST: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    fn request_json() -> Value {
        json!({
            "schema": "buzz.hosted-agent-runtime-request.v1",
            "request_id": REQUEST_ID,
            "agent_pubkey": AGENT_PUBKEY,
            "model": "gpt-5.6-terra",
            "effort": "high",
            "presentation_event_id": null,
            "catalog_digest": DIGEST,
        })
    }

    fn selection_json() -> Value {
        json!({
            "model": "gpt-5.6-terra",
            "effort": "medium",
            "runtime_name": "Market Intelligence",
        })
    }

    fn status_json() -> Value {
        json!({
            "schema": "buzz.hosted-agent-runtime-status.v1",
            "agent_pubkey": AGENT_PUBKEY,
            "request_id": REQUEST_ID,
            "revision": 12,
            "state": "pending_busy",
            "effective": selection_json(),
            "requested": {
                "model": "gpt-5.6-sol",
                "effort": "high",
                "runtime_name": "Market Intelligence",
            },
            "catalog_digest": DIGEST,
            "error": null,
        })
    }

    fn acknowledgement_json() -> Value {
        json!({
            "schema": "buzz.agent-runtime.v1",
            "controller_pubkey": CONTROLLER_PUBKEY,
            "revision": 12,
            "model": "gpt-5.6-sol",
            "effort": "high",
            "effective_name": "Market Intelligence",
            "catalog_digest": DIGEST,
        })
    }

    fn family_json() -> Value {
        json!({
            "id": "gpt-5.6-sol",
            "name": "GPT-5.6-Sol",
            "description": "Latest frontier agentic coding model.",
            "default_effort": "medium",
            "efforts": ["low", "medium", "high", "xhigh", "max", "ultra"],
        })
    }

    fn redacted_error_json() -> Value {
        json!({
            "code": "unsupported_selection",
            "message": "This model and effort combination is not available.",
        })
    }

    fn assert_exact_round_trip<T>(value: Value)
    where
        T: DeserializeOwned + serde::Serialize,
    {
        let parsed: T = serde_json::from_value(value.clone()).expect("valid strict schema");
        assert_eq!(serde_json::to_value(parsed).expect("serialize"), value);
    }

    fn assert_unknown_field_rejected<T>(mut value: Value)
    where
        T: DeserializeOwned,
    {
        value
            .as_object_mut()
            .expect("object fixture")
            .insert("unexpected".into(), Value::Bool(true));
        assert!(serde_json::from_value::<T>(value).is_err());
    }

    #[test]
    fn runtime_kinds_have_exact_storage_classes_and_registry_entries() {
        assert_eq!(KIND_HOSTED_AGENT_RUNTIME_REQUEST, 24201);
        assert!(is_ephemeral(KIND_HOSTED_AGENT_RUNTIME_REQUEST));
        assert!(ALL_KINDS.contains(&KIND_HOSTED_AGENT_RUNTIME_REQUEST));

        assert_eq!(KIND_HOSTED_AGENT_RUNTIME_STATUS, 30181);
        assert!(is_parameterized_replaceable(
            KIND_HOSTED_AGENT_RUNTIME_STATUS
        ));
        assert!(ALL_KINDS.contains(&KIND_HOSTED_AGENT_RUNTIME_STATUS));
    }

    #[test]
    fn protocol_documents_round_trip_exactly_and_reject_unknown_fields() {
        assert_exact_round_trip::<HostedAgentRuntimeRequest>(request_json());
        assert_unknown_field_rejected::<HostedAgentRuntimeRequest>(request_json());

        assert_exact_round_trip::<HostedAgentRuntimeStatus>(status_json());
        assert_unknown_field_rejected::<HostedAgentRuntimeStatus>(status_json());

        assert_exact_round_trip::<AgentRuntimeAcknowledgment>(acknowledgement_json());
        assert_unknown_field_rejected::<AgentRuntimeAcknowledgment>(acknowledgement_json());

        assert_exact_round_trip::<RuntimeSelection>(selection_json());
        assert_unknown_field_rejected::<RuntimeSelection>(selection_json());

        assert_exact_round_trip::<ModelFamily>(family_json());
        assert_unknown_field_rejected::<ModelFamily>(family_json());

        assert_exact_round_trip::<RedactedRuntimeError>(redacted_error_json());
        assert_unknown_field_rejected::<RedactedRuntimeError>(redacted_error_json());
    }

    #[test]
    fn schemas_and_redacted_error_vocabulary_are_exact() {
        let mut wrong_request = request_json();
        wrong_request["schema"] = json!("buzz.hosted-agent-runtime-request.v2");
        assert!(serde_json::from_value::<HostedAgentRuntimeRequest>(wrong_request).is_err());

        let mut wrong_message = redacted_error_json();
        wrong_message["message"] = json!("raw adapter output");
        assert!(serde_json::from_value::<RedactedRuntimeError>(wrong_message).is_err());

        let mut wrong_code = redacted_error_json();
        wrong_code["code"] = json!("C:\\secret\\adapter.log");
        assert!(serde_json::from_value::<RedactedRuntimeError>(wrong_code).is_err());
    }

    #[test]
    fn reasoning_effort_accepts_only_the_six_wire_values() {
        for value in ["low", "medium", "high", "xhigh", "max", "ultra"] {
            let effort: ReasoningEffort =
                serde_json::from_value(json!(value)).expect("recognized effort");
            assert_eq!(
                serde_json::to_value(effort).expect("serialize"),
                json!(value)
            );
        }

        for value in ["", "minimal", "extra-high", "XHIGH", "ultra "] {
            assert!(serde_json::from_value::<ReasoningEffort>(json!(value)).is_err());
        }
    }

    #[test]
    fn runtime_status_accepts_only_the_five_wire_states() {
        for value in ["current", "pending_busy", "applying", "applied", "failed"] {
            let state: RuntimeStatusState =
                serde_json::from_value(json!(value)).expect("recognized state");
            assert_eq!(
                serde_json::to_value(state).expect("serialize"),
                json!(value)
            );
        }

        for value in ["pending", "busy", "complete", "FAILED", ""] {
            assert!(serde_json::from_value::<RuntimeStatusState>(json!(value)).is_err());
        }
    }

    #[test]
    fn identifiers_and_revisions_fail_closed() {
        for invalid in [
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
        ] {
            let mut request = request_json();
            request["agent_pubkey"] = json!(invalid);
            assert!(serde_json::from_value::<HostedAgentRuntimeRequest>(request).is_err());
        }

        for invalid in [
            "550e8400-e29b-11d4-a716-446655440000",
            "550E8400-E29B-41D4-A716-446655440000",
            "not-a-uuid",
        ] {
            let mut request = request_json();
            request["request_id"] = json!(invalid);
            assert!(serde_json::from_value::<HostedAgentRuntimeRequest>(request).is_err());
        }

        let mut status = status_json();
        status["revision"] = json!(0);
        assert!(serde_json::from_value::<HostedAgentRuntimeStatus>(status).is_err());
    }

    #[test]
    fn catalog_digest_is_order_and_duplicate_stable_but_binding_sensitive() {
        let family_a = family_json();
        let family_b = json!({
            "id": "gpt-5.6-terra",
            "name": "GPT-5.6-Terra",
            "description": "Balanced agentic coding model.",
            "default_effort": "medium",
            "efforts": ["high", "medium", "low"],
        });
        let binding_a = json!({
            "model": "gpt-5.6-sol",
            "effort": "high",
            "method": {
                "type": "config_option",
                "config_id": "model",
                "option_value": "gpt-5.6-sol[high]"
            }
        });
        let binding_b = json!({
            "model": "gpt-5.6-terra",
            "effort": "medium",
            "method": {
                "type": "set_model",
                "model_id": "gpt-5.6-terra[medium]"
            }
        });

        let catalog_one: RuntimeCatalog = serde_json::from_value(json!({
            "model_families": [family_a.clone(), family_b.clone(), family_a.clone()],
            "bindings": [binding_b.clone(), binding_a.clone(), binding_a.clone()]
        }))
        .expect("catalog one");
        let catalog_two: RuntimeCatalog = serde_json::from_value(json!({
            "model_families": [family_b, family_a],
            "bindings": [binding_a, binding_b]
        }))
        .expect("catalog two");

        let first = normalized_catalog_digest(&catalog_one).expect("first digest");
        let second = normalized_catalog_digest(&catalog_two).expect("second digest");
        assert_eq!(first, second);

        let mut changed: Value = serde_json::to_value(catalog_two).expect("catalog json");
        changed["bindings"][1]["method"]["model_id"] = json!("gpt-5.6-terra[high]");
        let changed: RuntimeCatalog = serde_json::from_value(changed).expect("changed catalog");
        assert_ne!(
            first,
            normalized_catalog_digest(&changed).expect("changed digest")
        );
    }
}
