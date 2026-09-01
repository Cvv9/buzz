//! Canonicalize adapter-emitted model catalogs for hosted-agent runtime control.

use buzz_core::hosted_agent_runtime::{
    normalized_catalog_digest, CatalogDigest, ReasoningEffort, RuntimeBinding, RuntimeCatalog,
    RuntimeModelId, RuntimeProtocolError, RuntimeSelectionMethod,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

/// Legacy flat model entry retained for older profile consumers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CompatibilityModel {
    pub id: RuntimeModelId,
    pub name: String,
}

/// Adapter-reported selection that was active while probing the catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RuntimeCatalogDefault {
    pub model: RuntimeModelId,
    pub effort: ReasoningEffort,
}

/// Lower-priority exact adapter bindings hidden from the public catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RuntimeBindingConflict {
    pub model: RuntimeModelId,
    pub effort: ReasoningEffort,
    pub selected: RuntimeSelectionMethod,
    pub discarded: Vec<RuntimeSelectionMethod>,
}

/// Duplicate-free public catalog plus controller-private exact bindings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NormalizedRuntimeCatalog {
    pub compatibility_models: Vec<CompatibilityModel>,
    pub catalog: RuntimeCatalog,
    pub default_selection: Option<RuntimeCatalogDefault>,
    pub digest: CatalogDigest,
    pub binding_conflicts: Vec<RuntimeBindingConflict>,
}

/// Catalog normalization failed closed.
#[derive(Debug, Error)]
pub enum RuntimeCatalogError {
    #[error("adapter model catalog contains an invalid model identifier: {0}")]
    InvalidModelId(String),
    #[error(transparent)]
    Protocol(#[from] RuntimeProtocolError),
}

#[derive(Debug, Clone)]
struct Candidate {
    model: RuntimeModelId,
    effort: ReasoningEffort,
    name: String,
    description: String,
    method: RuntimeSelectionMethod,
    source_priority: u8,
    is_current: bool,
}

/// Merge stable ACP config options and unstable model state into one catalog.
pub fn normalize_runtime_catalog(
    stable_config_options: &[Value],
    unstable_model_state: Option<&Value>,
) -> Result<NormalizedRuntimeCatalog, RuntimeCatalogError> {
    let mut candidates = stable_candidates(stable_config_options)?;
    candidates.extend(unstable_candidates(unstable_model_state)?);

    let mut by_selection: BTreeMap<(RuntimeModelId, ReasoningEffort), Vec<Candidate>> =
        BTreeMap::new();
    for candidate in candidates.iter().cloned() {
        by_selection
            .entry((candidate.model.clone(), candidate.effort))
            .or_default()
            .push(candidate);
    }

    let mut bindings = Vec::with_capacity(by_selection.len());
    let mut binding_conflicts = Vec::new();
    let mut selected_candidates = Vec::with_capacity(by_selection.len());
    for ((model, effort), group) in &mut by_selection {
        group.sort_by(|left, right| {
            (left.source_priority, &left.method).cmp(&(right.source_priority, &right.method))
        });
        group.dedup_by(|left, right| left.method == right.method);
        let selected = group.first().expect("catalog group is nonempty");
        selected_candidates.push(selected.clone());
        bindings.push(RuntimeBinding {
            model: model.clone(),
            effort: *effort,
            method: selected.method.clone(),
        });
        let discarded = group
            .iter()
            .skip(1)
            .map(|candidate| candidate.method.clone())
            .collect::<Vec<_>>();
        if !discarded.is_empty() {
            binding_conflicts.push(RuntimeBindingConflict {
                model: model.clone(),
                effort: *effort,
                selected: selected.method.clone(),
                discarded,
            });
        }
    }

    let mut family_candidates: BTreeMap<RuntimeModelId, Vec<Candidate>> = BTreeMap::new();
    for candidate in selected_candidates {
        family_candidates
            .entry(candidate.model.clone())
            .or_default()
            .push(candidate);
    }

    let mut model_families = Vec::with_capacity(family_candidates.len());
    for (model, mut family) in family_candidates {
        family.sort_by(|left, right| {
            (left.source_priority, &left.method).cmp(&(right.source_priority, &right.method))
        });
        let metadata = family.first().expect("catalog family is nonempty");
        let efforts = family
            .iter()
            .map(|candidate| candidate.effort)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let default_effort = candidates
            .iter()
            .filter(|candidate| candidate.model == model && candidate.is_current)
            .min_by(|left, right| {
                (left.source_priority, &left.method).cmp(&(right.source_priority, &right.method))
            })
            .map(|candidate| candidate.effort)
            .or_else(|| {
                efforts
                    .contains(&ReasoningEffort::Medium)
                    .then_some(ReasoningEffort::Medium)
            })
            .unwrap_or(efforts[0]);
        model_families.push(buzz_core::hosted_agent_runtime::ModelFamily {
            id: model,
            name: metadata.name.clone(),
            description: metadata.description.clone(),
            default_effort,
            efforts,
        });
    }

    let default_selection = candidates
        .iter()
        .filter(|candidate| candidate.is_current)
        .min_by(|left, right| {
            (left.source_priority, &left.method).cmp(&(right.source_priority, &right.method))
        })
        .map(|candidate| RuntimeCatalogDefault {
            model: candidate.model.clone(),
            effort: candidate.effort,
        });
    let compatibility_models = model_families
        .iter()
        .map(|family| CompatibilityModel {
            id: family.id.clone(),
            name: family.name.clone(),
        })
        .collect();
    let catalog = RuntimeCatalog {
        model_families,
        bindings,
    };
    let digest = normalized_catalog_digest(&catalog)?;

    Ok(NormalizedRuntimeCatalog {
        compatibility_models,
        catalog,
        default_selection,
        digest,
        binding_conflicts,
    })
}

fn stable_candidates(options: &[Value]) -> Result<Vec<Candidate>, RuntimeCatalogError> {
    let mut candidates = Vec::new();
    for config in options {
        let Some(config_id) = config
            .get("configId")
            .or_else(|| config.get("id"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let current = config.get("currentValue").and_then(Value::as_str);
        let config_description = config
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(values) = config.get("options").and_then(Value::as_array) else {
            continue;
        };
        for option in values {
            let Some(exact_id) = option.get("value").and_then(Value::as_str) else {
                continue;
            };
            let label = option
                .get("displayName")
                .or_else(|| option.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(exact_id);
            let description = option
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or(config_description);
            if let Some((model, effort, name)) = parse_selection(exact_id, label, true)? {
                candidates.push(Candidate {
                    model,
                    effort,
                    name,
                    description: description.to_owned(),
                    method: RuntimeSelectionMethod::ConfigOption {
                        config_id: config_id.to_owned(),
                        option_value: exact_id.to_owned(),
                    },
                    source_priority: 0,
                    is_current: current == Some(exact_id),
                });
            }
        }
    }
    Ok(candidates)
}

fn unstable_candidates(state: Option<&Value>) -> Result<Vec<Candidate>, RuntimeCatalogError> {
    let Some(state) = state else {
        return Ok(Vec::new());
    };
    let current = state.get("currentModelId").and_then(Value::as_str);
    let Some(models) = state.get("availableModels").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut candidates = Vec::new();
    for model in models {
        let Some(exact_id) = model.get("modelId").and_then(Value::as_str) else {
            continue;
        };
        let label = model
            .get("displayName")
            .or_else(|| model.get("name"))
            .and_then(Value::as_str)
            .unwrap_or(exact_id);
        let description = model
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if let Some((model, effort, name)) = parse_selection(exact_id, label, false)? {
            candidates.push(Candidate {
                model,
                effort,
                name,
                description: description.to_owned(),
                method: RuntimeSelectionMethod::SetModel {
                    model_id: exact_id.to_owned(),
                },
                source_priority: 1,
                is_current: current == Some(exact_id),
            });
        }
    }
    Ok(candidates)
}

fn parse_selection(
    exact_id: &str,
    label: &str,
    prefer_exact_id: bool,
) -> Result<Option<(RuntimeModelId, ReasoningEffort, String)>, RuntimeCatalogError> {
    if is_runtime_default(exact_id) || is_runtime_default(label) {
        return Ok(None);
    }

    let (id_base, id_effort) = match split_suffix(exact_id, '[', ']') {
        Some((base, token)) => match parse_effort(token) {
            Some(effort) => (Some(base), Some(effort)),
            None => return Ok(None),
        },
        None => (None, None),
    };
    let (label_base, label_effort) = match split_suffix(label, '(', ')') {
        Some((base, token)) if is_effort_like(token) => match parse_effort(token) {
            Some(effort) => (base.trim(), Some(effort)),
            None => return Ok(None),
        },
        _ => (label.trim(), None),
    };
    let effort = id_effort
        .or(label_effort)
        .unwrap_or(ReasoningEffort::Medium);
    // Stable config options expose the adapter's durable selection IDs. Keep
    // that ID even when its presentation label is a shorter alias, such as
    // `gpt-daybreak-blue-latest` displayed as `Daybreak Blue`. The unstable
    // list can use opaque legacy IDs, so it continues to canonicalize from its
    // label when no explicit effort suffix supplies a base model ID.
    let canonical_source = id_base.unwrap_or({
        if prefer_exact_id {
            exact_id
        } else {
            label_base
        }
    });
    let canonical = slug_model_id(canonical_source);
    if canonical.is_empty() {
        return Err(RuntimeCatalogError::InvalidModelId(exact_id.to_owned()));
    }
    let model = serde_json::from_value(Value::String(canonical.clone()))
        .map_err(|_| RuntimeCatalogError::InvalidModelId(canonical))?;
    let name = if label_base.is_empty() {
        canonical_source.to_owned()
    } else {
        label_base.to_owned()
    };
    Ok(Some((model, effort, name)))
}

fn split_suffix(value: &str, open: char, close: char) -> Option<(&str, &str)> {
    if !value.ends_with(close) {
        return None;
    }
    let index = value.rfind(open)?;
    Some((
        &value[..index],
        &value[index + open.len_utf8()..value.len() - close.len_utf8()],
    ))
}

fn parse_effort(value: &str) -> Option<ReasoningEffort> {
    match value.trim().to_ascii_lowercase().as_str() {
        "low" => Some(ReasoningEffort::Low),
        "medium" => Some(ReasoningEffort::Medium),
        "high" => Some(ReasoningEffort::High),
        "xhigh" | "extra high" | "extra-high" => Some(ReasoningEffort::Xhigh),
        "max" => Some(ReasoningEffort::Max),
        "ultra" => Some(ReasoningEffort::Ultra),
        _ => None,
    }
}

fn is_effort_like(value: &str) -> bool {
    parse_effort(value).is_some()
        || matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "none" | "minimal" | "auto" | "xxhigh"
        )
}

fn is_runtime_default(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "default" | "runtime default"
    )
}

fn slug_model_id(value: &str) -> String {
    let mut output = String::new();
    let mut separator_pending = false;
    for character in value.trim().to_ascii_lowercase().chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '/') {
            if separator_pending && !output.is_empty() {
                output.push('-');
            }
            output.push(character);
            separator_pending = false;
        } else {
            separator_pending = true;
        }
    }
    output.trim_end_matches('-').to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (Vec<Value>, Value) {
        let stable = vec![json!({
            "category": "model",
            "configId": "model",
            "currentValue": "gpt-5.6-sol[high]",
            "options": [
                {"value": "default", "displayName": "Runtime default"},
                {"value": "gpt-5.6-sol[low]", "displayName": "GPT-5.6-Sol (low)"},
                {"value": "gpt-5.6-sol[medium]", "displayName": "GPT-5.6-Sol (medium)"},
                {"value": "gpt-5.6-sol[high]", "displayName": "GPT-5.6-Sol (high)"},
                {"value": "gpt-5.6-sol[xhigh]", "displayName": "GPT-5.6-Sol (xhigh)"},
                {"value": "gpt-5.6-sol[max]", "displayName": "GPT-5.6-Sol (max)"},
                {"value": "gpt-5.6-sol[ultra]", "displayName": "GPT-5.6-Sol (ultra)"},
                {"value": "gpt-5.6-sol[minimal]", "displayName": "GPT-5.6-Sol (minimal)"},
                {"value": "gpt-3.5-turbo-16k", "displayName": "GPT-3.5-Turbo-16k"}
            ]
        })];
        let unstable = json!({
            "currentModelId": "legacy-gpt35-a",
            "availableModels": [
                {"modelId": "legacy-gpt35-a", "name": "GPT-3.5-Turbo-16k"},
                {"modelId": "legacy-gpt35-b", "displayName": "GPT-3.5-Turbo-16k"},
                {"modelId": "gpt-5.6-sol[high]", "name": "GPT-5.6-Sol (high)"}
            ]
        });
        (stable, unstable)
    }

    #[test]
    fn canonicalizes_families_efforts_defaults_and_private_bindings() {
        let (stable, unstable) = fixture();
        let normalized = normalize_runtime_catalog(&stable, Some(&unstable)).expect("catalog");

        assert_eq!(normalized.catalog.model_families.len(), 2);
        let sol = normalized
            .catalog
            .model_families
            .iter()
            .find(|family| family.id.as_str() == "gpt-5.6-sol")
            .expect("sol family");
        assert_eq!(sol.name, "GPT-5.6-Sol");
        assert_eq!(sol.default_effort, ReasoningEffort::High);
        assert_eq!(
            sol.efforts,
            vec![
                ReasoningEffort::Low,
                ReasoningEffort::Medium,
                ReasoningEffort::High,
                ReasoningEffort::Xhigh,
                ReasoningEffort::Max,
                ReasoningEffort::Ultra,
            ]
        );
        assert_eq!(
            normalized.default_selection,
            Some(RuntimeCatalogDefault {
                model: serde_json::from_value(json!("gpt-5.6-sol")).expect("model id"),
                effort: ReasoningEffort::High,
            })
        );
        assert_eq!(normalized.catalog.bindings.len(), 7);
        assert_eq!(normalized.compatibility_models.len(), 2);
    }

    #[test]
    fn collapses_identical_labels_and_prefers_stable_exact_binding() {
        let (stable, unstable) = fixture();
        let normalized = normalize_runtime_catalog(&stable, Some(&unstable)).expect("catalog");

        let legacy = normalized
            .catalog
            .model_families
            .iter()
            .filter(|family| family.name == "GPT-3.5-Turbo-16k")
            .collect::<Vec<_>>();
        assert_eq!(legacy.len(), 1);
        assert_eq!(legacy[0].id.as_str(), "gpt-3.5-turbo-16k");

        let conflict = normalized
            .binding_conflicts
            .iter()
            .find(|conflict| conflict.model.as_str() == "gpt-3.5-turbo-16k")
            .expect("alias conflict");
        assert_eq!(
            conflict.selected,
            RuntimeSelectionMethod::ConfigOption {
                config_id: "model".into(),
                option_value: "gpt-3.5-turbo-16k".into(),
            }
        );
        assert_eq!(conflict.discarded.len(), 2);
    }

    #[test]
    fn preserves_stable_model_ids_when_the_display_label_is_an_alias() {
        let stable = vec![json!({
            "category": "model",
            "id": "model",
            "currentValue": "gpt-daybreak-blue-latest",
            "options": [{
                "value": "gpt-daybreak-blue-latest",
                "name": "Daybreak Blue"
            }]
        })];
        let unstable = json!({
            "currentModelId": "gpt-daybreak-blue-latest[medium]",
            "availableModels": [{
                "modelId": "gpt-daybreak-blue-latest[medium]",
                "name": "Daybreak Blue (medium)"
            }]
        });

        let normalized = normalize_runtime_catalog(&stable, Some(&unstable)).expect("catalog");

        assert_eq!(normalized.catalog.model_families.len(), 1);
        assert_eq!(
            normalized.catalog.model_families[0].id.as_str(),
            "gpt-daybreak-blue-latest"
        );
        assert_eq!(normalized.catalog.bindings.len(), 1);
    }

    #[test]
    fn output_and_digest_are_deterministic_when_sources_are_reordered() {
        let (mut stable, mut unstable) = fixture();
        let first = normalize_runtime_catalog(&stable, Some(&unstable)).expect("first");
        stable.reverse();
        unstable["availableModels"]
            .as_array_mut()
            .expect("models")
            .reverse();
        let second = normalize_runtime_catalog(&stable, Some(&unstable)).expect("second");

        assert_eq!(first, second);
        assert_eq!(first.digest, second.digest);
    }
}
