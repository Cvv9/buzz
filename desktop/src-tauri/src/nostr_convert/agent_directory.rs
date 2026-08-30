//! Conversion and verification for relay-discovered agents.

use std::collections::{BTreeSet, HashMap};

use nostr::Event;

use crate::managed_agents::{
    agent_events::managed_agent_content_from_event, RelayAgentInfo, RespondTo,
};

use super::{agents_from_events, first_tag_value, profile_valid_oa_owner_pubkey, tags_named};

/// Collect valid agent pubkeys from kind:30177 `d` tags for follow-up relay
/// queries. Malformed tags are ignored so one hostile event cannot invalidate
/// the whole directory request.
pub fn managed_agent_pubkeys_from_events(events: &[Event]) -> std::collections::HashSet<String> {
    events
        .iter()
        .filter_map(|event| first_tag_value(event, "d"))
        .filter_map(|pubkey| nostr::PublicKey::from_hex(pubkey).ok())
        .map(|pubkey| pubkey.to_hex())
        .collect()
}

fn event_is_newer(candidate: &Event, previous: &Event) -> bool {
    candidate.created_at > previous.created_at
        || (candidate.created_at == previous.created_at && candidate.id < previous.id)
}

fn is_reasoning_effort(value: &str) -> bool {
    matches!(value, "low" | "medium" | "high" | "xhigh" | "max" | "ultra")
}

fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
}

fn runtime_acknowledgment_is_valid(runtime: &crate::managed_agents::RelayAgentRuntimeInfo) -> bool {
    runtime.schema == "buzz.agent-runtime.v1"
        && is_lower_hex_64(&runtime.controller_pubkey)
        && runtime.revision > 0
        && !runtime.model.trim().is_empty()
        && is_reasoning_effort(&runtime.effort)
        && !runtime.effective_name.trim().is_empty()
        && is_lower_hex_64(&runtime.catalog_digest)
}

fn relay_agents_from_legacy_events(events: &[Event]) -> Vec<RelayAgentInfo> {
    let mut latest: HashMap<String, &Event> = HashMap::new();
    for event in events {
        let pubkey = event.pubkey.to_hex();
        if latest
            .get(&pubkey)
            .is_none_or(|previous| event_is_newer(event, previous))
        {
            latest.insert(pubkey, event);
        }
    }

    latest
        .into_values()
        .filter_map(|event| {
            let value = agents_from_events(std::slice::from_ref(event));
            let mut agent: RelayAgentInfo =
                serde_json::from_value(value.get("agents")?.as_array()?.first()?.clone()).ok()?;
            let mut family_ids = BTreeSet::new();
            let mut family_labels = BTreeSet::new();
            agent.model_families.retain(|family| {
                let id = family.id.trim().to_string();
                let label = family.name.trim().to_ascii_lowercase();
                !id.is_empty()
                    && !label.is_empty()
                    && is_reasoning_effort(&family.default_effort)
                    && family
                        .efforts
                        .iter()
                        .all(|effort| is_reasoning_effort(effort))
                    && family.efforts.contains(&family.default_effort)
                    && family_ids.insert(id)
                    && family_labels.insert(label)
            });
            if !agent
                .runtime
                .as_ref()
                .is_some_and(runtime_acknowledgment_is_valid)
            {
                agent.runtime = None;
            }
            if let Some(runtime) = &agent.runtime {
                // `runtime` is the exact signed effective selection. The
                // top-level `model` remains only a flat compatibility field.
                agent.model = Some(runtime.model.clone());
            }
            // Legacy directory entries are not authenticated managed-policy
            // coordinates, so they must not drive the live 30177 watcher.
            agent.owner_pubkey = None;
            // Channel membership is authoritative only in relay-signed kind:39002.
            agent.channel_ids.clear();
            Some(agent)
        })
        .collect()
}

/// Merge self-authored kind:10100 runtime profiles with verified Desktop-managed
/// policy records. A verified managed coordinate reserves the agent identity even
/// when its current policy is malformed, so stale legacy permissions cannot win.
pub fn relay_agents_from_directory_events(
    directory_events: &[Event],
    managed_agent_events: &[Event],
    profile_events: &[Event],
) -> Vec<RelayAgentInfo> {
    let verified_policies = latest_verified_managed_policies(managed_agent_events, profile_events);
    let mut agents: HashMap<String, RelayAgentInfo> =
        relay_agents_from_legacy_events(directory_events)
            .into_iter()
            .map(|agent| (agent.pubkey.clone(), agent))
            .collect();
    for agent_pubkey in verified_policies.keys() {
        agents.remove(agent_pubkey);
    }
    for (agent_pubkey, event) in verified_policies {
        if let Some(agent) = relay_agent_from_managed_policy(&agent_pubkey, event) {
            agents.insert(agent_pubkey, agent);
        }
    }

    let mut agents: Vec<_> = agents.into_values().collect();
    agents.sort_by(|left, right| left.name.cmp(&right.name));
    agents
}

/// Resolve each agent's owner from its latest signed NIP-OA profile.
pub fn verified_agent_owners_from_profiles(events: &[Event]) -> HashMap<String, String> {
    let mut latest_profiles: HashMap<String, &Event> = HashMap::new();
    for profile in events {
        let agent_pubkey = profile.pubkey.to_hex();
        if latest_profiles
            .get(&agent_pubkey)
            .is_none_or(|previous| event_is_newer(profile, previous))
        {
            latest_profiles.insert(agent_pubkey, profile);
        }
    }
    latest_profiles
        .into_iter()
        .filter_map(|(agent_pubkey, profile)| {
            profile_valid_oa_owner_pubkey(profile).map(|owner| (agent_pubkey, owner))
        })
        .collect()
}

fn latest_verified_managed_policies<'a>(
    managed_agent_events: &'a [Event],
    profile_events: &[Event],
) -> HashMap<String, &'a Event> {
    let verified_owners = verified_agent_owners_from_profiles(profile_events);

    let mut latest: HashMap<String, &'a Event> = HashMap::new();
    for event in managed_agent_events {
        let Some(agent_pubkey) = first_tag_value(event, "d") else {
            continue;
        };
        if verified_owners.get(agent_pubkey) != Some(&event.pubkey.to_hex()) {
            continue;
        }
        if latest
            .get(agent_pubkey)
            .is_none_or(|previous| event_is_newer(event, previous))
        {
            latest.insert(agent_pubkey.to_string(), event);
        }
    }
    latest
}

fn relay_agent_from_managed_policy(agent_pubkey: &str, event: &Event) -> Option<RelayAgentInfo> {
    let content = managed_agent_content_from_event(event).ok()?;
    let owner_only = content.respond_to == RespondTo::OwnerOnly;
    Some(RelayAgentInfo {
        pubkey: agent_pubkey.to_string(),
        owner_pubkey: Some(event.pubkey.to_hex()),
        name: content.name,
        avatar_url: None,
        agent_type: "agent".to_string(),
        channels: Vec::new(),
        channel_ids: Vec::new(),
        capabilities: Vec::new(),
        status: "offline".to_string(),
        respond_to: Some(content.respond_to),
        respond_to_allowlist: content.respond_to_allowlist,
        audience: Some(if owner_only { "owner" } else { "community" }.to_string()),
        access_tier: Some(if owner_only { "personal" } else { "shared" }.to_string()),
        model: content.model,
        models: Vec::new(),
        model_families: Vec::new(),
        runtime: None,
    })
}

/// Build the relay agent directory from owner-authenticated managed-agent
/// records. A kind:30177 event is accepted only when its author matches the
/// owner cryptographically declared by the agent's latest kind:0 NIP-OA tag.
pub fn relay_agents_from_managed_agent_events(
    managed_agent_events: &[Event],
    profile_events: &[Event],
) -> Vec<RelayAgentInfo> {
    let mut agents: Vec<_> = latest_verified_managed_policies(managed_agent_events, profile_events)
        .into_iter()
        .filter_map(|(agent_pubkey, event)| relay_agent_from_managed_policy(&agent_pubkey, event))
        .collect();
    agents.sort_by(|left, right| left.name.cmp(&right.name));
    agents
}

/// Build a pubkey-to-channel-id candidate map from relay-signed membership
/// events. Only p-tags explicitly marked with the `bot` role are agents.
pub fn member_agent_channel_ids_from_events(
    events: &[Event],
    relay_pubkey: &str,
) -> HashMap<String, Vec<String>> {
    let mut channel_ids: HashMap<String, BTreeSet<String>> = HashMap::new();
    for event in events {
        if !event.pubkey.to_hex().eq_ignore_ascii_case(relay_pubkey) {
            continue;
        }
        let Some(channel_id) = first_tag_value(event, "d") else {
            continue;
        };
        for tag in tags_named(event, "p") {
            let (Some(pubkey), Some(role)) = (tag.get(1), tag.get(3)) else {
                continue;
            };
            if role != "bot" || nostr::PublicKey::from_hex(pubkey).is_err() {
                continue;
            }
            channel_ids
                .entry(pubkey.clone())
                .or_default()
                .insert(channel_id.to_string());
        }
    }

    channel_ids
        .into_iter()
        .map(|(pubkey, ids)| (pubkey, ids.into_iter().collect()))
        .collect()
}
