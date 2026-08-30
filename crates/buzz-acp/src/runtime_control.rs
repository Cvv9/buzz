//! Strict controller-to-runner runtime-control envelopes.

use buzz_core::hosted_agent_runtime::{
    AgentRuntimeAcknowledgment, CatalogDigest, RuntimeErrorCode, RuntimeRevision, RuntimeSelection,
    RuntimeSelectionMethod,
};
use buzz_core::kind::KIND_AGENT_OBSERVER_FRAME;
use buzz_core::observer::{
    decrypt_observer_payload, OBSERVER_AGENT_TAG, OBSERVER_FRAME_CONTROL, OBSERVER_FRAME_TAG,
};
use nostr::{Event, Keys, PublicKey};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::runtime_catalog::NormalizedRuntimeCatalog;
use crate::runtime_defaults::PendingRuntimeRevision;

/// Maximum age (seconds) for a runtime control frame.
pub const RUNTIME_CONTROL_FRESHNESS_SECS: i64 = 300;

/// Exact encrypted command accepted from the pinned controller.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplyRuntimeDefaultsControl {
    #[serde(rename = "type")]
    command_type: ApplyRuntimeDefaultsType,
    pub revision: RuntimeRevision,
    pub selection: RuntimeSelection,
    pub method: RuntimeSelectionMethod,
    pub catalog_digest: CatalogDigest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum ApplyRuntimeDefaultsType {
    #[serde(rename = "apply_runtime_defaults")]
    ApplyRuntimeDefaults,
}

impl ApplyRuntimeDefaultsControl {
    #[cfg(test)]
    fn new(
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

    /// Convert a validated wire command to the pool's atomic revision type.
    pub fn into_pending(self) -> PendingRuntimeRevision {
        PendingRuntimeRevision {
            revision: self.revision.get(),
            selection: self.selection,
            method: self.method,
            catalog_digest: self.catalog_digest,
        }
    }
}

/// Encrypted runner-to-controller receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum RuntimeApplicationReceipt {
    #[serde(rename = "runtime_defaults_pending_busy")]
    PendingBusy { revision: RuntimeRevision },
    #[serde(rename = "runtime_defaults_applying")]
    Applying { revision: RuntimeRevision },
    #[serde(rename = "runtime_defaults_applied")]
    Applied {
        acknowledgment: AgentRuntimeAcknowledgment,
    },
    #[serde(rename = "runtime_defaults_failed")]
    Failed {
        revision: RuntimeRevision,
        error: RuntimeErrorCode,
    },
}

/// Fixed validation failures safe to map to controller statuses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum RuntimeControlError {
    #[error("invalid_runtime_control")]
    Invalid,
    #[error("wrong_runtime_controller")]
    WrongController,
    #[error("stale_runtime_control")]
    Stale,
    #[error("stale_catalog")]
    StaleCatalog,
    #[error("unsupported_selection")]
    UnsupportedSelection,
}

/// Verify, decrypt, and bind one controller command to the current local catalog.
pub fn decode_runtime_control(
    keys: &Keys,
    event: &Event,
    controller: &PublicKey,
    catalog: &NormalizedRuntimeCatalog,
    now: i64,
) -> Result<PendingRuntimeRevision, RuntimeControlError> {
    prevalidate_runtime_control(keys, event, controller, now)?;
    let control: ApplyRuntimeDefaultsControl =
        decrypt_observer_payload(keys, event).map_err(|_| RuntimeControlError::Invalid)?;
    if control.catalog_digest != catalog.digest {
        return Err(RuntimeControlError::StaleCatalog);
    }
    let binding_matches = catalog.catalog.bindings.iter().any(|binding| {
        binding.model == control.selection.model
            && binding.effort == control.selection.effort
            && binding.method == control.method
    });
    if !binding_matches {
        return Err(RuntimeControlError::UnsupportedSelection);
    }
    Ok(control.into_pending())
}

/// Perform the checks that do not require an initialized ACP adapter. Lazy
/// runners use this before retaining a controller event that will trigger wake.
pub fn prevalidate_runtime_control(
    keys: &Keys,
    event: &Event,
    controller: &PublicKey,
    now: i64,
) -> Result<(), RuntimeControlError> {
    buzz_core::verify_event(event).map_err(|_| RuntimeControlError::Invalid)?;
    if event.pubkey != *controller {
        return Err(RuntimeControlError::WrongController);
    }
    if event.kind.as_u16() as u32 != KIND_AGENT_OBSERVER_FRAME
        || !has_tag(event, "p", &keys.public_key().to_hex())
        || !has_tag(event, OBSERVER_AGENT_TAG, &keys.public_key().to_hex())
        || !has_tag(event, OBSERVER_FRAME_TAG, OBSERVER_FRAME_CONTROL)
    {
        return Err(RuntimeControlError::Invalid);
    }
    let event_ts = event.created_at.as_secs() as i64;
    if (event_ts - now).unsigned_abs() > RUNTIME_CONTROL_FRESHNESS_SECS as u64 {
        return Err(RuntimeControlError::Stale);
    }

    Ok(())
}

fn has_tag(event: &Event, name: &str, value: &str) -> bool {
    event.tags.iter().any(|tag| {
        let values = tag.as_slice();
        values.first().is_some_and(|entry| entry == name)
            && values.get(1).is_some_and(|entry| entry == value)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::observer::encrypt_observer_payload;
    use nostr::Timestamp;
    use serde_json::json;

    use crate::runtime_catalog::normalize_runtime_catalog;

    fn catalog() -> NormalizedRuntimeCatalog {
        normalize_runtime_catalog(
            &[json!({
                "category": "model",
                "configId": "model",
                "currentValue": "gpt-5.6-terra[medium]",
                "options": [
                    {"value": "gpt-5.6-terra[medium]", "displayName": "GPT-5.6-Terra (medium)"},
                    {"value": "gpt-5.6-sol[high]", "displayName": "GPT-5.6-Sol (high)"}
                ]
            })],
            None,
        )
        .expect("catalog")
    }

    fn control_event(
        controller: &Keys,
        agent: &Keys,
        control: &ApplyRuntimeDefaultsControl,
        created_at: u64,
    ) -> Event {
        let encrypted = encrypt_observer_payload(controller, &agent.public_key(), control)
            .expect("encrypt control");
        buzz_sdk::build_hosted_runtime_control_frame(
            &agent.public_key().to_hex(),
            &agent.public_key().to_hex(),
            &encrypted,
        )
        .expect("frame")
        .custom_created_at(Timestamp::from(created_at))
        .sign_with_keys(controller)
        .expect("sign")
    }

    fn valid_control(catalog: &NormalizedRuntimeCatalog) -> ApplyRuntimeDefaultsControl {
        let selection: RuntimeSelection = serde_json::from_value(json!({
            "model": "gpt-5.6-sol",
            "effort": "high",
            "runtime_name": "Market Intelligence"
        }))
        .expect("selection");
        ApplyRuntimeDefaultsControl::new(
            RuntimeRevision::new(7).expect("revision"),
            selection,
            RuntimeSelectionMethod::ConfigOption {
                config_id: "model".into(),
                option_value: "gpt-5.6-sol[high]".into(),
            },
            catalog.digest.clone(),
        )
    }

    #[test]
    fn accepts_only_the_pinned_controller_and_exact_local_binding() {
        let agent = Keys::generate();
        let controller = Keys::generate();
        let attacker = Keys::generate();
        let catalog = catalog();
        let now = Timestamp::now().as_secs();
        let control = valid_control(&catalog);

        let accepted = decode_runtime_control(
            &agent,
            &control_event(&controller, &agent, &control, now),
            &controller.public_key(),
            &catalog,
            now as i64,
        )
        .expect("pinned controller accepted");
        assert_eq!(accepted.revision, 7);
        assert_eq!(accepted.exact_selection_id(), "gpt-5.6-sol[high]");

        let wrong = decode_runtime_control(
            &agent,
            &control_event(&attacker, &agent, &control, now),
            &controller.public_key(),
            &catalog,
            now as i64,
        );
        assert_eq!(wrong, Err(RuntimeControlError::WrongController));
    }

    #[test]
    fn rejects_stale_digest_stale_frame_and_unsupported_binding() {
        let agent = Keys::generate();
        let controller = Keys::generate();
        let catalog = catalog();
        let now = Timestamp::now().as_secs();

        let mut wrong_digest = valid_control(&catalog);
        wrong_digest.catalog_digest =
            serde_json::from_value(json!("a".repeat(64))).expect("other digest");
        assert_eq!(
            decode_runtime_control(
                &agent,
                &control_event(&controller, &agent, &wrong_digest, now),
                &controller.public_key(),
                &catalog,
                now as i64,
            ),
            Err(RuntimeControlError::StaleCatalog)
        );

        let mut wrong_binding = valid_control(&catalog);
        wrong_binding.method = RuntimeSelectionMethod::SetModel {
            model_id: "gpt-5.6-sol[high]".into(),
        };
        assert_eq!(
            decode_runtime_control(
                &agent,
                &control_event(&controller, &agent, &wrong_binding, now),
                &controller.public_key(),
                &catalog,
                now as i64,
            ),
            Err(RuntimeControlError::UnsupportedSelection)
        );

        let stale_time = now.saturating_sub((RUNTIME_CONTROL_FRESHNESS_SECS + 1) as u64);
        assert_eq!(
            decode_runtime_control(
                &agent,
                &control_event(&controller, &agent, &valid_control(&catalog), stale_time),
                &controller.public_key(),
                &catalog,
                now as i64,
            ),
            Err(RuntimeControlError::Stale)
        );
    }

    #[test]
    fn receipt_schema_is_exact_and_redacted() {
        let receipt = RuntimeApplicationReceipt::Failed {
            revision: RuntimeRevision::new(9).expect("revision"),
            error: RuntimeErrorCode::AdapterRejected,
        };
        let value = serde_json::to_value(&receipt).expect("serialize");
        assert_eq!(value["type"], "runtime_defaults_failed");
        assert_eq!(value["error"], "adapter_rejected");
        assert!(serde_json::from_value::<RuntimeApplicationReceipt>(json!({
            "type": "runtime_defaults_failed",
            "revision": 9,
            "error": "adapter_rejected",
            "raw": "private adapter detail"
        }))
        .is_err());
    }

    #[test]
    fn boundary_receipts_are_revision_only_and_strict() {
        let revision = RuntimeRevision::new(9).expect("revision");
        let pending = RuntimeApplicationReceipt::PendingBusy { revision };
        assert_eq!(
            serde_json::to_value(pending).expect("pending"),
            json!({"type":"runtime_defaults_pending_busy", "revision":9})
        );
        let applying = RuntimeApplicationReceipt::Applying { revision };
        assert_eq!(
            serde_json::to_value(applying).expect("applying"),
            json!({"type":"runtime_defaults_applying", "revision":9})
        );
        assert!(serde_json::from_value::<RuntimeApplicationReceipt>(json!({
            "type":"runtime_defaults_applying",
            "revision":9,
            "active_turns":0
        }))
        .is_err());
    }
}
