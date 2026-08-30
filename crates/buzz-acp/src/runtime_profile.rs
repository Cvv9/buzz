//! Signed effective-runtime acknowledgments for hosted agents.

use anyhow::{Context, Result};
use buzz_core::hosted_agent_runtime::{
    AgentRuntimeAcknowledgment, AgentRuntimeAcknowledgmentSchema, RuntimePubkey, RuntimeRevision,
};
use nostr::{Event, Keys};

use crate::relay::RestClient;
use crate::runtime_catalog::NormalizedRuntimeCatalog;
use crate::runtime_defaults::PendingRuntimeRevision;

/// Build the exact agent-signed acknowledgment payload for one applied revision.
pub fn runtime_acknowledgment(
    controller_pubkey: &str,
    revision: &PendingRuntimeRevision,
) -> Result<AgentRuntimeAcknowledgment> {
    let controller_pubkey: RuntimePubkey =
        serde_json::from_value(serde_json::Value::String(controller_pubkey.to_owned()))
            .context("invalid controller pubkey")?;
    let runtime_revision = RuntimeRevision::new(revision.revision).context("invalid revision")?;
    Ok(AgentRuntimeAcknowledgment {
        schema: AgentRuntimeAcknowledgmentSchema::V1,
        controller_pubkey,
        revision: runtime_revision,
        model: revision.selection.model.clone(),
        effort: revision.selection.effort,
        effective_name: revision.selection.runtime_name.clone(),
        catalog_digest: revision.catalog_digest.clone(),
    })
}

/// Query the complete current self-authored profile, merge runtime fields, and
/// publish a signed replaceable acknowledgment without truncating other fields.
pub async fn publish_runtime_acknowledgment(
    rest: &RestClient,
    keys: &Keys,
    catalog: &NormalizedRuntimeCatalog,
    acknowledgment: &AgentRuntimeAcknowledgment,
) -> Result<Event> {
    let existing = fetch_existing_profile(rest, keys).await?;
    let models = serde_json::to_value(&catalog.compatibility_models)
        .context("serialize compatibility models")?;
    let builder = buzz_sdk::build_agent_profile_with_runtime(
        &existing,
        acknowledgment.effective_name.as_str(),
        Some(&acknowledgment.model),
        &models,
        Some(&catalog.catalog.model_families),
        Some(acknowledgment),
    )
    .context("build runtime profile")?;
    let event = builder
        .sign_with_keys(keys)
        .context("sign runtime profile")?;
    rest.submit_event(&event)
        .await
        .context("publish runtime profile")?;
    Ok(event)
}

/// Fetch and verify the latest complete self-authored profile object.
pub async fn fetch_existing_profile(
    rest: &RestClient,
    keys: &Keys,
) -> Result<serde_json::Map<String, serde_json::Value>> {
    let filter = nostr::Filter::new()
        .kind(nostr::Kind::Custom(
            buzz_core::kind::KIND_AGENT_PROFILE as u16,
        ))
        .author(keys.public_key())
        .limit(1);
    let response = rest
        .query(std::slice::from_ref(&filter))
        .await
        .context("query current runtime profile")?;
    let Some(raw_event) = response.as_array().and_then(|events| events.first()) else {
        return Ok(serde_json::Map::new());
    };
    let event: Event =
        serde_json::from_value(raw_event.clone()).context("parse runtime profile")?;
    buzz_core::verify_event(&event).context("verify runtime profile")?;
    if event.pubkey != keys.public_key() {
        anyhow::bail!("runtime profile was not self-authored");
    }
    serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&event.content)
        .context("runtime profile content is not an object")
}

/// Read the strict effective-runtime acknowledgment from the self-authored profile.
pub async fn fetch_runtime_acknowledgment(
    rest: &RestClient,
    keys: &Keys,
) -> Result<Option<AgentRuntimeAcknowledgment>> {
    let profile = fetch_existing_profile(rest, keys).await?;
    profile
        .get("runtime")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .context("profile runtime acknowledgment is invalid")
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::hosted_agent_runtime::{CatalogDigest, RuntimeSelectionMethod};
    use serde_json::json;

    fn revision() -> PendingRuntimeRevision {
        PendingRuntimeRevision {
            revision: 12,
            selection: serde_json::from_value(json!({
                "model": "gpt-5.6-sol",
                "effort": "high",
                "runtime_name": "Market Intelligence"
            }))
            .expect("selection"),
            method: RuntimeSelectionMethod::SetModel {
                model_id: "gpt-5.6-sol[high]".into(),
            },
            catalog_digest: serde_json::from_value::<CatalogDigest>(json!("c".repeat(64)))
                .expect("digest"),
        }
    }

    #[test]
    fn acknowledgment_contains_every_exact_effective_field() {
        let controller = "b".repeat(64);
        let ack = runtime_acknowledgment(&controller, &revision()).expect("ack");
        let value = serde_json::to_value(ack).expect("serialize");

        assert_eq!(value["controller_pubkey"], controller);
        assert_eq!(value["revision"], 12);
        assert_eq!(value["model"], "gpt-5.6-sol");
        assert_eq!(value["effort"], "high");
        assert_eq!(value["effective_name"], "Market Intelligence");
        assert_eq!(value["catalog_digest"], "c".repeat(64));
    }

    #[test]
    fn profile_builder_preserves_all_presentation_and_compatibility_fields() {
        let existing = json!({
            "name": "Old",
            "display_name": "Old",
            "aliases": ["Intel"],
            "about": "Research",
            "resources": [{"type": "bookstack"}],
            "access": {"tier": "owner"},
            "avatar": "https://example.test/agent.png",
            "models": [{"id": "legacy", "name": "Legacy"}],
            "future": {"preserve": true}
        });
        let ack = runtime_acknowledgment(&"b".repeat(64), &revision()).expect("ack");
        let models = json!([{"id": "gpt-5.6-sol", "name": "GPT-5.6-Sol"}]);
        let event = buzz_sdk::build_agent_profile_with_runtime(
            existing.as_object().expect("object"),
            ack.effective_name.as_str(),
            Some(&ack.model),
            &models,
            None,
            Some(&ack),
        )
        .expect("builder")
        .sign_with_keys(&Keys::generate())
        .expect("sign");
        let merged: serde_json::Value = serde_json::from_str(&event.content).expect("content");

        for field in [
            "aliases",
            "about",
            "resources",
            "access",
            "avatar",
            "future",
        ] {
            assert_eq!(merged[field], existing[field], "preserve {field}");
        }
        assert_eq!(merged["models"], models);
        assert_eq!(merged["runtime"]["revision"], 12);
    }
}
