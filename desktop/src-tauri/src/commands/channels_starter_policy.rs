use crate::models::ChannelInfo;

pub(super) const STARTER_CHANNEL_NAMESPACE: uuid::Uuid =
    uuid::uuid!("3ce33bea-8f09-5f1b-9c85-8a7d2659e6b0");

/// How many distinct ids to try per starter channel before giving up. Bounded
/// so a relay that accepts creates but never serves their metadata fails fast
/// instead of seeding a channel per retry.
pub(super) const STARTER_CHANNEL_ID_ATTEMPTS: u32 = 3;

pub(super) struct StarterChannelSpec {
    pub(super) slug: &'static str,
    pub(super) name: &'static str,
    pub(super) description: &'static str,
}

pub(super) const STARTER_CHANNELS: &[StarterChannelSpec] = &[
    StarterChannelSpec {
        slug: "general",
        name: "general",
        description: "General conversation and community updates.",
    },
    StarterChannelSpec {
        slug: "welcome-everyone",
        name: "welcome-everyone",
        description: "Say hi, ask a question, or share what brought you here.",
    },
];

pub(super) fn normalize_channel_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

pub(super) fn starter_channel_uuid(relay_scope: &str, slug: &str) -> uuid::Uuid {
    let name = format!("starter-channel:v1:{}:{}", relay_scope.trim(), slug);
    uuid::Uuid::new_v5(&STARTER_CHANNEL_NAMESPACE, name.as_bytes())
}

/// Derive a starter channel's id for a given creation `attempt`.
///
/// Attempt 0 reproduces the original derivation, so an install that already
/// owns its starter channels keeps resolving them instead of creating a
/// second copy. Later attempts step to a fresh id: the relay dedupes channel
/// creates on `(community_id, id)`, so an id occupied by a row this identity
/// cannot read back — soft-deleted, archived, or private without membership —
/// is rejected as a duplicate *and* returns no kind:39000, which dead-ends
/// onboarding permanently because the id never changes between retries.
pub(super) fn starter_channel_uuid_for_attempt(
    relay_scope: &str,
    slug: &str,
    attempt: u32,
) -> uuid::Uuid {
    if attempt == 0 {
        return starter_channel_uuid(relay_scope, slug);
    }
    let name = format!(
        "starter-channel:v1:{}:{}#{}",
        relay_scope.trim(),
        slug,
        attempt
    );
    uuid::Uuid::new_v5(&STARTER_CHANNEL_NAMESPACE, name.as_bytes())
}

/// The starter channels still missing from `existing`, paired with the id to
/// create each one under on `attempt`.
pub(super) fn starter_channel_work_list(
    relay_scope: &str,
    existing: &[ChannelInfo],
    attempt: u32,
) -> Vec<(&'static StarterChannelSpec, uuid::Uuid)> {
    STARTER_CHANNELS
        .iter()
        .filter(|spec| {
            !existing
                .iter()
                .any(|channel| is_matching_starter_channel(channel, spec))
        })
        .map(|spec| {
            (
                spec,
                starter_channel_uuid_for_attempt(relay_scope, spec.slug, attempt),
            )
        })
        .collect()
}

// An accepted create with delayed metadata must not become a fresh create.
pub(super) fn starter_channel_creation_pending(
    channels: &[ChannelInfo],
    created_ids: &std::collections::HashSet<String>,
) -> bool {
    created_ids
        .iter()
        .any(|id| !channels.iter().any(|channel| channel.id == *id))
}

pub(super) fn is_duplicate_channel_rejection(error: &str) -> bool {
    error.contains("relay rejected event:") && error.contains("duplicate: channel already exists")
}

pub(super) fn is_matching_starter_channel(
    channel: &ChannelInfo,
    spec: &StarterChannelSpec,
) -> bool {
    normalize_channel_name(&channel.name) == normalize_channel_name(spec.name)
        && channel.channel_type == "stream"
        && channel.visibility == "open"
        && channel.archived_at.is_none()
}

pub(super) fn has_all_starter_channels(channels: &[ChannelInfo]) -> bool {
    STARTER_CHANNELS.iter().all(|spec| {
        channels
            .iter()
            .any(|channel| is_matching_starter_channel(channel, spec))
    })
}
