//! Inbound author policy and definition-time behavioral defaults.

use serde::{Deserialize, Serialize};

use super::AgentDefinition;

/// Who the agent should respond to. Defaults to `OwnerOnly`, which matches
/// the harness default → existing agents behave identically.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RespondTo {
    #[default]
    OwnerOnly,
    Allowlist,
    Anyone,
}

impl RespondTo {
    /// CLI/env wire string (matches `buzz-acp`'s `--respond-to`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OwnerOnly => "owner-only",
            Self::Allowlist => "allowlist",
            Self::Anyone => "anyone",
        }
    }

    /// Parse the NIP-AP wire string at the definition-to-instance boundary.
    pub fn parse_wire(value: &str) -> Result<Self, String> {
        match value {
            "owner-only" => Ok(Self::OwnerOnly),
            "allowlist" => Ok(Self::Allowlist),
            "anyone" => Ok(Self::Anyone),
            other => Err(format!(
                "definition respond_to '{other}' is not a recognized mode (expected 'owner-only', 'allowlist', or 'anyone')"
            )),
        }
    }
}

/// Validate and normalize a respond-to allowlist.
///
/// Rules mirror `buzz-acp/src/config.rs::validate_allowlist`: entries must be
/// 64-character hex pubkeys, duplicates are removed, and output is lowercase.
pub fn validate_respond_to_allowlist(input: &[String]) -> Result<Vec<String>, String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(input.len());
    for entry in input {
        let trimmed = entry.trim();
        if trimmed.len() != 64 || !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!(
                "invalid pubkey in respond-to allowlist: '{trimmed}' (must be 64 hex chars)"
            ));
        }
        let lower = trimmed.to_ascii_lowercase();
        if seen.insert(lower.clone()) {
            out.push(lower);
        }
    }
    Ok(out)
}

/// The behavioral fields resolved for a new instance at mint time.
#[derive(Debug, PartialEq, Eq)]
pub struct MintBehavioralDefaults {
    pub respond_to: RespondTo,
    pub respond_to_allowlist: Vec<String>,
    /// Validated (1..=32) when present; caller applies its own default.
    pub parallelism: Option<u32>,
}

/// Resolve the NIP-AP behavioral quad for a new instance.
///
/// Explicit input wins, then the linked definition's defaults, then client
/// defaults. Definition values are validated here because they arrived from the
/// relay rather than the local dialog.
pub fn resolve_mint_behavioral_defaults(
    input_respond_to: Option<RespondTo>,
    input_allowlist: Vec<String>,
    input_parallelism: Option<u32>,
    definition: Option<&AgentDefinition>,
) -> Result<MintBehavioralDefaults, String> {
    let (respond_to, respond_to_allowlist) = match input_respond_to {
        Some(mode) => (mode, input_allowlist),
        None => match definition.and_then(|d| d.respond_to.as_deref()) {
            Some(wire) => {
                let mode = RespondTo::parse_wire(wire)?;
                let list = if input_allowlist.is_empty() {
                    validate_respond_to_allowlist(
                        definition
                            .map(|d| d.respond_to_allowlist.as_slice())
                            .unwrap_or(&[]),
                    )
                    .map_err(|e| format!("definition respond-to allowlist is invalid: {e}"))?
                } else {
                    input_allowlist
                };
                (mode, list)
            }
            None => (RespondTo::default(), input_allowlist),
        },
    };
    if respond_to == RespondTo::Allowlist && respond_to_allowlist.is_empty() {
        return Err(
            "respond-to mode 'allowlist' requires at least one pubkey in the allowlist".to_string(),
        );
    }

    let parallelism = match input_parallelism {
        Some(count) if (1..=32).contains(&count) => Some(count),
        Some(count) => {
            return Err(format!(
                "parallelism {count} is out of range (must be between 1 and 32)"
            ))
        }
        None => match definition.and_then(|d| d.parallelism) {
            Some(count) if (1..=32).contains(&count) => Some(count),
            Some(count) => {
                return Err(format!(
                    "parallelism {count} on the linked agent definition is out of range (must be between 1 and 32)"
                ))
            }
            None => None,
        },
    };

    Ok(MintBehavioralDefaults {
        respond_to,
        respond_to_allowlist,
        parallelism,
    })
}
