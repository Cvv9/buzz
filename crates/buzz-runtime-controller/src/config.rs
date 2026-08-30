//! Strict, secret-safe controller configuration.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::{Path, PathBuf};

use buzz_core::hosted_agent_runtime::{
    normalized_catalog_digest, CatalogDigest, RuntimeCatalog, RuntimePubkey, RuntimeSelection,
};
use nostr::{Keys, PublicKey};
use serde::Deserialize;
use thiserror::Error;
use url::Url;
use zeroize::Zeroizing;

/// One private agent-to-runtime-service assignment.
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentServiceMapping {
    /// Hosted agent identity.
    pub agent_pubkey: RuntimePubkey,
    /// Private deployment service identifier. Never published or logged.
    pub service: String,
    /// Exact public catalog and private ACP bindings for this runner.
    pub catalog: RuntimeCatalog,
    /// Runtime known to be effective before the first controller revision.
    pub initial_runtime: RuntimeSelection,
}

impl fmt::Debug for AgentServiceMapping {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AgentServiceMapping")
            .field("agent_pubkey", &self.agent_pubkey.as_str())
            .field("service", &"[redacted]")
            .field("catalog", &"[redacted]")
            .field("initial_runtime", &"[redacted]")
            .finish()
    }
}

/// Validated controller configuration.
pub struct ControllerConfig {
    relay_url: String,
    controller_private_key: Zeroizing<String>,
    controller_pubkey: RuntimePubkey,
    owner_pubkey: RuntimePubkey,
    state_path: PathBuf,
    audit_path: PathBuf,
    agents: BTreeMap<String, AgentServiceMapping>,
    catalog_digests: BTreeMap<String, CatalogDigest>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ControllerConfigWire {
    relay_url: String,
    controller_private_key: String,
    controller_pubkey: RuntimePubkey,
    owner_pubkey: RuntimePubkey,
    state_path: PathBuf,
    audit_path: PathBuf,
    agents: Vec<AgentServiceMapping>,
}

/// Configuration validation failure.
#[derive(Debug, Error)]
pub enum ConfigError {
    /// Input is not strict controller JSON.
    #[error("invalid controller configuration: {0}")]
    Json(#[from] serde_json::Error),
    /// Relay URL must be an absolute WebSocket URL.
    #[error("relay_url must use ws or wss")]
    RelayUrl,
    /// Controller secret key is malformed.
    #[error("controller_private_key is invalid")]
    ControllerKey,
    /// Configured public pin does not belong to the controller secret.
    #[error("controller private key does not match controller_pubkey")]
    ControllerIdentity,
    /// A state or audit path is relative or both paths alias one another.
    #[error("state_path and audit_path must be distinct absolute paths")]
    Paths,
    /// The same hosted identity is mapped more than once.
    #[error("duplicate agent pubkey")]
    DuplicateAgent,
    /// The same private service identifier is mapped more than once.
    #[error("duplicate service identifier")]
    DuplicateService,
    /// A service identifier is not a bounded deployment-safe token.
    #[error("invalid service identifier")]
    Service,
    /// A catalog is internally inconsistent.
    #[error("invalid runtime catalog")]
    Catalog,
    /// The initial runtime is not backed by the configured catalog.
    #[error("initial runtime is not supported by the configured catalog")]
    InitialRuntime,
}

impl ControllerConfig {
    /// Parse and validate a complete JSON configuration document.
    pub fn from_json(json: &str) -> Result<Self, ConfigError> {
        let wire: ControllerConfigWire = serde_json::from_str(json)?;
        let parsed_url = Url::parse(&wire.relay_url).map_err(|_| ConfigError::RelayUrl)?;
        if !matches!(parsed_url.scheme(), "ws" | "wss") || parsed_url.host_str().is_none() {
            return Err(ConfigError::RelayUrl);
        }
        let controller_keys = Keys::parse(wire.controller_private_key.trim())
            .map_err(|_| ConfigError::ControllerKey)?;
        if controller_keys.public_key().to_hex() != wire.controller_pubkey.as_str() {
            return Err(ConfigError::ControllerIdentity);
        }
        if !absolute_distinct(&wire.state_path, &wire.audit_path) {
            return Err(ConfigError::Paths);
        }

        let mut agents = BTreeMap::new();
        let mut services = BTreeSet::new();
        let mut catalog_digests = BTreeMap::new();
        for mapping in wire.agents {
            let agent = mapping.agent_pubkey.as_str().to_owned();
            if agents.contains_key(&agent) {
                return Err(ConfigError::DuplicateAgent);
            }
            if !valid_service_identifier(&mapping.service) {
                return Err(ConfigError::Service);
            }
            if !services.insert(mapping.service.clone()) {
                return Err(ConfigError::DuplicateService);
            }
            let digest =
                normalized_catalog_digest(&mapping.catalog).map_err(|_| ConfigError::Catalog)?;
            let supported = mapping.catalog.bindings.iter().any(|binding| {
                binding.model == mapping.initial_runtime.model
                    && binding.effort == mapping.initial_runtime.effort
            });
            if !supported {
                return Err(ConfigError::InitialRuntime);
            }
            catalog_digests.insert(agent.clone(), digest);
            agents.insert(agent, mapping);
        }

        Ok(Self {
            relay_url: wire.relay_url,
            controller_private_key: Zeroizing::new(wire.controller_private_key),
            controller_pubkey: wire.controller_pubkey,
            owner_pubkey: wire.owner_pubkey,
            state_path: wire.state_path,
            audit_path: wire.audit_path,
            agents,
            catalog_digests,
        })
    }

    /// Relay WebSocket URL.
    pub fn relay_url(&self) -> &str {
        &self.relay_url
    }

    /// Parse the controller signing identity without exposing its secret.
    pub fn controller_keys(&self) -> Result<Keys, ConfigError> {
        Keys::parse(self.controller_private_key.trim()).map_err(|_| ConfigError::ControllerKey)
    }

    /// Controller public key validated against the configured secret.
    pub fn controller_pubkey(&self) -> Result<PublicKey, ConfigError> {
        PublicKey::parse(self.controller_pubkey.as_str())
            .map_err(|_| ConfigError::ControllerIdentity)
    }

    /// Fixed current community owner.
    pub fn owner_pubkey(&self) -> &RuntimePubkey {
        &self.owner_pubkey
    }

    /// Root-readable durable state path.
    pub fn state_path(&self) -> &Path {
        &self.state_path
    }

    /// Root-readable append-only audit path.
    pub fn audit_path(&self) -> &Path {
        &self.audit_path
    }

    /// Private mapping for one allowlisted agent.
    pub fn agent(&self, pubkey: &str) -> Option<&AgentServiceMapping> {
        self.agents.get(pubkey)
    }

    /// All allowlisted agent public keys, without private service data.
    pub fn agent_pubkeys(&self) -> impl Iterator<Item = &str> {
        self.agents.keys().map(String::as_str)
    }

    /// Canonical digest for one agent's public catalog and private bindings.
    pub fn catalog_digest(&self, pubkey: &str) -> Option<&CatalogDigest> {
        self.catalog_digests.get(pubkey)
    }
}

impl fmt::Debug for ControllerConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ControllerConfig")
            .field("relay_url", &self.relay_url)
            .field("controller_private_key", &"[redacted]")
            .field("controller_pubkey", &self.controller_pubkey.as_str())
            .field("owner_pubkey", &self.owner_pubkey.as_str())
            .field("state_path", &self.state_path)
            .field("audit_path", &self.audit_path)
            .field("agent_count", &self.agents.len())
            .finish()
    }
}

fn absolute_distinct(state: &Path, audit: &Path) -> bool {
    state.is_absolute() && audit.is_absolute() && state != audit
}

fn valid_service_identifier(service: &str) -> bool {
    let mut bytes = service.bytes();
    let first = bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
    first
        && service.len() <= 63
        && bytes.all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;
    use serde_json::{json, Value};

    fn valid_config() -> Value {
        let controller = Keys::generate();
        json!({
            "relay_url": "wss://buzz.example.test",
            "controller_private_key": controller.secret_key().to_secret_hex(),
            "controller_pubkey": controller.public_key().to_hex(),
            "owner_pubkey": "a".repeat(64),
            "state_path": if cfg!(windows) { r"C:\buzz\runtime-state.json" } else { "/var/lib/buzz/runtime-state.json" },
            "audit_path": if cfg!(windows) { r"C:\buzz\runtime-audit.jsonl" } else { "/var/lib/buzz/runtime-audit.jsonl" },
            "agents": [{
                "agent_pubkey": "b".repeat(64),
                "service": "market-intelligence",
                "catalog": {
                    "model_families": [{
                        "id": "gpt-5.6-terra",
                        "name": "GPT-5.6-Terra",
                        "description": "Balanced",
                        "default_effort": "medium",
                        "efforts": ["medium", "high"]
                    }],
                    "bindings": [{
                        "model": "gpt-5.6-terra",
                        "effort": "medium",
                        "method": {"type":"set_model", "model_id":"gpt-5.6-terra[medium]"}
                    }]
                },
                "initial_runtime": {
                    "model": "gpt-5.6-terra",
                    "effort": "medium",
                    "runtime_name": "Market Intelligence"
                }
            }]
        })
    }

    #[test]
    fn parses_complete_fixed_configuration_and_redacts_private_values() {
        let raw = valid_config().to_string();
        let config = ControllerConfig::from_json(&raw).expect("config");
        assert_eq!(config.relay_url(), "wss://buzz.example.test");
        assert_eq!(
            config.agent_pubkeys().collect::<Vec<_>>(),
            vec!["b".repeat(64)]
        );
        let debug = format!("{config:?}");
        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains("market-intelligence"));
        assert!(!debug.contains("gpt-5.6-terra"));
    }

    #[test]
    fn rejects_unknown_relative_duplicate_and_invalid_service_configuration() {
        let mut unknown = valid_config();
        unknown["surprise"] = json!(true);
        assert!(ControllerConfig::from_json(&unknown.to_string()).is_err());

        let mut relative = valid_config();
        relative["state_path"] = json!("state.json");
        assert!(matches!(
            ControllerConfig::from_json(&relative.to_string()),
            Err(ConfigError::Paths)
        ));

        let mut duplicate = valid_config();
        let original = duplicate["agents"][0].clone();
        duplicate["agents"]
            .as_array_mut()
            .expect("agents")
            .push(original);
        assert!(matches!(
            ControllerConfig::from_json(&duplicate.to_string()),
            Err(ConfigError::DuplicateAgent)
        ));

        let mut service = valid_config();
        service["agents"][0]["service"] = json!("../../docker.sock");
        assert!(matches!(
            ControllerConfig::from_json(&service.to_string()),
            Err(ConfigError::Service)
        ));

        let mut mismatched = valid_config();
        mismatched["controller_pubkey"] = json!("d".repeat(64));
        assert!(matches!(
            ControllerConfig::from_json(&mismatched.to_string()),
            Err(ConfigError::ControllerIdentity)
        ));
    }
}
