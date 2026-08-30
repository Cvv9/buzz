//! Strict private controller/runner wire payloads and matching helpers.

use buzz_core::hosted_agent_runtime::{
    AgentRuntimeAcknowledgment, CatalogDigest, RuntimeErrorCode, RuntimeRevision, RuntimeSelection,
    RuntimeSelectionMethod,
};
use serde::{Deserialize, Serialize};
use std::fmt;

/// Exact encrypted command accepted by `buzz-acp`.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplyRuntimeDefaultsControl {
    #[serde(rename = "type")]
    command_type: ApplyRuntimeDefaultsType,
    /// Monotonic controller revision.
    pub revision: RuntimeRevision,
    /// Atomic model, effort, and runtime-facing name.
    pub selection: RuntimeSelection,
    /// Exact private adapter operation.
    pub method: RuntimeSelectionMethod,
    /// Catalog digest that binds public families and private operations.
    pub catalog_digest: CatalogDigest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum ApplyRuntimeDefaultsType {
    #[serde(rename = "apply_runtime_defaults")]
    ApplyRuntimeDefaults,
}

impl ApplyRuntimeDefaultsControl {
    /// Build one exact controller-to-runner command.
    pub fn new(
        revision: RuntimeRevision,
        selection: RuntimeSelection,
        method: RuntimeSelectionMethod,
        catalog_digest: CatalogDigest,
    ) -> Self {
        Self {
            command_type: ApplyRuntimeDefaultsType::ApplyRuntimeDefaults,
            revision,
            selection,
            method,
            catalog_digest,
        }
    }
}

impl fmt::Debug for ApplyRuntimeDefaultsControl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ApplyRuntimeDefaultsControl")
            .field("revision", &self.revision)
            .field("selection", &"[redacted]")
            .field("method", &"[redacted]")
            .field("catalog_digest", &"[redacted]")
            .finish()
    }
}

/// Exact encrypted runner-to-controller application receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum RuntimeApplicationReceipt {
    /// Runner accepted the revision but is draining active turns.
    #[serde(rename = "runtime_defaults_pending_busy")]
    PendingBusy {
        /// Queued revision.
        revision: RuntimeRevision,
    },
    /// Runner reached the idle boundary and started the fresh-session probe.
    #[serde(rename = "runtime_defaults_applying")]
    Applying {
        /// Applying revision.
        revision: RuntimeRevision,
    },
    /// Runner applied the revision and published the same signed profile ack.
    #[serde(rename = "runtime_defaults_applied")]
    Applied {
        /// Exact runtime acknowledgment.
        acknowledgment: AgentRuntimeAcknowledgment,
    },
    /// Runner rolled back and supplied only a fixed code.
    #[serde(rename = "runtime_defaults_failed")]
    Failed {
        /// Rejected revision.
        revision: RuntimeRevision,
        /// Fixed safe failure code.
        error: RuntimeErrorCode,
    },
}

/// Determine whether an acknowledgment exactly proves one desired revision.
pub fn acknowledgment_matches(
    acknowledgment: &AgentRuntimeAcknowledgment,
    controller_pubkey: &str,
    revision: RuntimeRevision,
    desired: &RuntimeSelection,
    digest: &CatalogDigest,
) -> bool {
    acknowledgment.controller_pubkey.as_str() == controller_pubkey
        && acknowledgment.revision == revision
        && acknowledgment.model == desired.model
        && acknowledgment.effort == desired.effort
        && acknowledgment.effective_name == desired.runtime_name
        && acknowledgment.catalog_digest == *digest
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn control_and_receipt_wire_shapes_reject_unknown_fields() {
        let control: ApplyRuntimeDefaultsControl = serde_json::from_value(json!({
            "type": "apply_runtime_defaults",
            "revision": 8,
            "selection": {
                "model": "gpt-5.6-sol",
                "effort": "high",
                "runtime_name": "Market Intelligence"
            },
            "method": {"type":"set_model", "model_id":"gpt-5.6-sol[high]"},
            "catalog_digest": "c".repeat(64)
        }))
        .expect("control");
        assert_eq!(control.revision.get(), 8);

        let mut invalid = serde_json::to_value(control).expect("value");
        invalid["service"] = json!("market-agent");
        assert!(serde_json::from_value::<ApplyRuntimeDefaultsControl>(invalid).is_err());
    }
}
