//! Relay authorization boundary for encrypted hosted-agent runtime requests.

use buzz_auth::{Nip98ReplayGuard, DEFAULT_REPLAY_TTL_SECS, MAX_REPLAY_TTL_SECS};
use buzz_core::kind::{KIND_AGENT_PROFILE, KIND_HOSTED_AGENT_RUNTIME_REQUEST};
use buzz_core::observer::content_looks_like_nip44;
use buzz_core::{CommunityId, TenantContext};
use nostr::{Event, EventId, PublicKey};
use sha2::{Digest, Sha256};
use uuid::{Uuid, Version};

use crate::hosted_agent_policy::{hosted_agent_action_authorized, HostedAgentAction};
use crate::state::AppState;

const REQUEST_FRESHNESS_SECS: u64 = 300;
const REQUEST_MAX_EXPIRATION_AHEAD_SECS: u64 = 300;
pub(crate) const RUNTIME_REQUEST_REPLAY_TTL_SECS: u64 = 600;

const _: () = assert!(RUNTIME_REQUEST_REPLAY_TTL_SECS >= DEFAULT_REPLAY_TTL_SECS);
const _: () = assert!(RUNTIME_REQUEST_REPLAY_TTL_SECS <= MAX_REPLAY_TTL_SECS);

/// Validated cleartext routing envelope for one encrypted runtime request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeRequestEnvelope {
    pub(crate) controller: PublicKey,
    pub(crate) agent: PublicKey,
    pub(crate) request_id: Uuid,
    pub(crate) expiration: u64,
}

fn exact_tag_value<'a>(event: &'a Event, name: &str) -> Result<&'a str, String> {
    let mut matching = event.tags.iter().filter_map(|tag| {
        let values = tag.as_slice();
        (values.first().map(String::as_str) == Some(name)).then_some(values)
    });
    let values = matching
        .next()
        .ok_or_else(|| format!("invalid: runtime request missing {name} tag"))?;
    if matching.next().is_some() || values.len() != 2 {
        return Err(format!(
            "invalid: runtime request must have exactly one two-part {name} tag"
        ));
    }
    Ok(values[1].as_str())
}

fn parse_lowercase_pubkey(value: &str, field: &str) -> Result<PublicKey, String> {
    let valid = value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if !valid {
        return Err(format!(
            "invalid: runtime request {field} must be a lowercase hex pubkey"
        ));
    }
    PublicKey::from_hex(value)
        .map_err(|_| format!("invalid: runtime request {field} must be a valid secp256k1 pubkey"))
}

/// Validate the relay-visible request envelope without decrypting its content.
pub(crate) fn validate_runtime_request_envelope(
    event: &Event,
    configured_controller_pubkey: Option<&str>,
    now: u64,
) -> Result<RuntimeRequestEnvelope, String> {
    if event.kind.as_u16() as u32 != KIND_HOSTED_AGENT_RUNTIME_REQUEST {
        return Err("invalid: not a hosted runtime request".into());
    }
    if event.tags.len() != 4 {
        return Err("invalid: runtime request must contain exactly four routing tags".into());
    }
    if !content_looks_like_nip44(&event.content) {
        return Err("invalid: runtime request content must be NIP-44 encrypted".into());
    }

    let configured_controller_pubkey = configured_controller_pubkey
        .ok_or_else(|| "restricted: hosted runtime control is disabled".to_string())?;
    let controller_raw = exact_tag_value(event, "p")?;
    if controller_raw != configured_controller_pubkey {
        return Err("restricted: runtime request is not addressed to the pinned controller".into());
    }
    let controller = parse_lowercase_pubkey(controller_raw, "controller")?;
    let agent = parse_lowercase_pubkey(exact_tag_value(event, "agent")?, "agent")?;

    let request_raw = exact_tag_value(event, "request")?;
    let request_id = Uuid::parse_str(request_raw)
        .map_err(|_| "invalid: runtime request tag must be a UUID v4".to_string())?;
    if request_id.get_version() != Some(Version::Random) || request_id.to_string() != request_raw {
        return Err("invalid: runtime request tag must be a canonical lowercase UUID v4".into());
    }

    let expiration_raw = exact_tag_value(event, "expiration")?;
    let expiration = expiration_raw
        .parse::<u64>()
        .map_err(|_| "invalid: runtime request expiration must be unix seconds".to_string())?;
    if expiration.to_string() != expiration_raw {
        return Err("invalid: runtime request expiration must be canonical unix seconds".into());
    }
    if expiration <= now {
        return Err("invalid: runtime request has expired".into());
    }
    if expiration > now.saturating_add(REQUEST_MAX_EXPIRATION_AHEAD_SECS) {
        return Err("invalid: runtime request expiration is more than five minutes ahead".into());
    }

    let created_at = event.created_at.as_secs();
    if created_at < now.saturating_sub(REQUEST_FRESHNESS_SECS)
        || created_at > now.saturating_add(REQUEST_FRESHNESS_SECS)
    {
        return Err("invalid: runtime request timestamp outside ±5 minute freshness window".into());
    }

    Ok(RuntimeRequestEnvelope {
        controller,
        agent,
        request_id,
        expiration,
    })
}

fn replay_scope(community: CommunityId, controller: &PublicKey) -> String {
    format!("hosted-runtime:{}:{}", community, controller.to_hex())
}

fn replay_event_id(controller: &PublicKey, request_id: Uuid) -> EventId {
    let mut hasher = Sha256::new();
    hasher.update(b"buzz.hosted-agent-runtime-request.v1\0");
    hasher.update(controller.to_bytes());
    hasher.update(request_id.as_bytes());
    EventId::from_byte_array(hasher.finalize().into())
}

async fn claim_runtime_request(
    replay: &dyn Nip98ReplayGuard,
    community: CommunityId,
    envelope: &RuntimeRequestEnvelope,
) -> Result<bool, String> {
    replay
        .try_mark_in_scope(
            &replay_scope(community, &envelope.controller),
            &replay_event_id(&envelope.controller, envelope.request_id),
            RUNTIME_REQUEST_REPLAY_TTL_SECS,
        )
        .await
        .map_err(|_| "error: runtime request replay check unavailable".to_string())
}

/// Confirm owner/target state and atomically claim the request UUID.
pub(crate) async fn authorize_hosted_agent_runtime_request(
    state: &AppState,
    tenant: &TenantContext,
    event: &Event,
    envelope: &RuntimeRequestEnvelope,
) -> Result<(), String> {
    let actor = event.pubkey.to_hex();
    let member = state
        .db
        .get_relay_member(tenant.community(), &actor)
        .await
        .map_err(|_| "error: runtime request owner lookup failed".to_string())?;
    let role = member.as_ref().map(|member| member.role.as_str());
    if !hosted_agent_action_authorized(HostedAgentAction::RuntimeRequest, role) {
        return Err("restricted: hosted runtime changes require the community owner".into());
    }

    let profile = state
        .db
        .get_latest_global_replaceable(
            tenant.community(),
            KIND_AGENT_PROFILE as i32,
            &envelope.agent.to_bytes(),
        )
        .await
        .map_err(|_| "error: runtime request agent lookup failed".to_string())?;
    if profile.is_none() {
        return Err("restricted: runtime target is not a current self-authored agent".into());
    }

    match claim_runtime_request(
        state.hosted_agent_runtime_replay.as_ref(),
        tenant.community(),
        envelope,
    )
    .await?
    {
        true => Ok(()),
        false => Err("invalid: runtime request UUID was already accepted".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_auth::error::AuthError;
    use buzz_pubsub::RedisNip98ReplayGuard;
    use deadpool_redis::{Config as RedisConfig, Runtime as RedisRuntime};
    use nostr::{Event, EventBuilder, Keys, Kind, Tag, Timestamp};
    use std::collections::HashMap;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};

    const NOW: u64 = 1_788_000_000;
    const REQUEST_ID: &str = "550e8400-e29b-41d4-a716-446655440000";

    fn request_event(
        owner: &Keys,
        controller: &Keys,
        agent: &Keys,
        created_at: u64,
        expiration: u64,
    ) -> Event {
        EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_HOSTED_AGENT_RUNTIME_REQUEST as u16),
            "A".repeat(buzz_core::observer::NIP44_MIN_CONTENT_LEN),
        )
        .tags([
            Tag::parse(["p", &controller.public_key().to_hex()]).expect("p"),
            Tag::parse(["agent", &agent.public_key().to_hex()]).expect("agent"),
            Tag::parse(["request", REQUEST_ID]).expect("request"),
            Tag::parse(["expiration", &expiration.to_string()]).expect("expiration"),
        ])
        .custom_created_at(Timestamp::from(created_at))
        .sign_with_keys(owner)
        .expect("sign")
    }

    #[test]
    fn runtime_request_envelope_accepts_only_the_exact_fresh_shape() {
        let owner = Keys::generate();
        let controller = Keys::generate();
        let agent = Keys::generate();
        let event = request_event(&owner, &controller, &agent, NOW, NOW + 300);

        let envelope =
            validate_runtime_request_envelope(&event, Some(&controller.public_key().to_hex()), NOW)
                .expect("valid envelope");
        assert_eq!(envelope.controller, controller.public_key());
        assert_eq!(envelope.agent, agent.public_key());
        assert_eq!(envelope.request_id.to_string(), REQUEST_ID);
        assert_eq!(envelope.expiration, NOW + 300);
    }

    #[test]
    fn runtime_request_envelope_rejects_tag_freshness_and_ciphertext_failures() {
        let owner = Keys::generate();
        let controller = Keys::generate();
        let agent = Keys::generate();
        let controller_hex = controller.public_key().to_hex();

        assert!(validate_runtime_request_envelope(
            &request_event(&owner, &controller, &agent, NOW - 301, NOW + 1),
            Some(&controller_hex),
            NOW
        )
        .is_err());
        assert!(validate_runtime_request_envelope(
            &request_event(&owner, &controller, &agent, NOW, NOW - 1),
            Some(&controller_hex),
            NOW
        )
        .is_err());
        assert!(validate_runtime_request_envelope(
            &request_event(&owner, &controller, &agent, NOW, NOW),
            Some(&controller_hex),
            NOW
        )
        .is_err());
        assert!(validate_runtime_request_envelope(
            &request_event(&owner, &controller, &agent, NOW, NOW + 301),
            Some(&controller_hex),
            NOW
        )
        .is_err());
        assert!(validate_runtime_request_envelope(
            &request_event(&owner, &controller, &agent, NOW, NOW + 1),
            Some(&Keys::generate().public_key().to_hex()),
            NOW
        )
        .is_err());
        assert!(validate_runtime_request_envelope(
            &request_event(&owner, &controller, &agent, NOW, NOW + 1),
            None,
            NOW
        )
        .is_err());

        let duplicate_tag = EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_HOSTED_AGENT_RUNTIME_REQUEST as u16),
            "A".repeat(buzz_core::observer::NIP44_MIN_CONTENT_LEN),
        )
        .tags([
            Tag::parse(["p", &controller_hex]).expect("p"),
            Tag::parse(["p", &controller_hex]).expect("duplicate p"),
            Tag::parse(["agent", &agent.public_key().to_hex()]).expect("agent"),
            Tag::parse(["request", REQUEST_ID]).expect("request"),
            Tag::parse(["expiration", &(NOW + 1).to_string()]).expect("expiration"),
        ])
        .custom_created_at(Timestamp::from(NOW))
        .sign_with_keys(&owner)
        .expect("sign duplicate");
        assert!(
            validate_runtime_request_envelope(&duplicate_tag, Some(&controller_hex), NOW).is_err()
        );

        let plaintext = EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_HOSTED_AGENT_RUNTIME_REQUEST as u16),
            "plaintext",
        )
        .tags([
            Tag::parse(["p", &controller_hex]).expect("p"),
            Tag::parse(["agent", &agent.public_key().to_hex()]).expect("agent"),
            Tag::parse(["request", REQUEST_ID]).expect("request"),
            Tag::parse(["expiration", &(NOW + 1).to_string()]).expect("expiration"),
        ])
        .custom_created_at(Timestamp::from(NOW))
        .sign_with_keys(&owner)
        .expect("sign plaintext");
        assert!(validate_runtime_request_envelope(&plaintext, Some(&controller_hex), NOW).is_err());
    }

    #[test]
    fn only_exact_community_owner_and_current_agent_authorize_runtime_requests() {
        let cases = [
            ("owner/current target", Some("owner"), true, true),
            ("owner/missing target", Some("owner"), false, false),
            ("admin", Some("admin"), true, false),
            (
                "declared owner but member role",
                Some("member"),
                true,
                false,
            ),
            ("agent itself", Some("agent"), true, false),
            ("ordinary member", Some("member"), true, false),
            ("cross-tenant actor", None, true, false),
        ];
        for (label, role, target_profile_present, expected) in cases {
            assert_eq!(
                hosted_agent_action_authorized(HostedAgentAction::RuntimeRequest, role)
                    && target_profile_present,
                expected,
                "{label}"
            );
        }
    }

    #[derive(Clone, Default)]
    struct SharedReplayGuard {
        now: Arc<std::sync::atomic::AtomicU64>,
        seen: Arc<Mutex<HashMap<String, u64>>>,
    }

    impl SharedReplayGuard {
        fn advance(&self, seconds: u64) {
            self.now
                .fetch_add(seconds, std::sync::atomic::Ordering::SeqCst);
        }
    }

    impl Nip98ReplayGuard for SharedReplayGuard {
        fn try_mark_in_scope<'a>(
            &'a self,
            scope: &'a str,
            event_id: &'a EventId,
            ttl_secs: u64,
        ) -> Pin<Box<dyn Future<Output = Result<bool, AuthError>> + Send + 'a>> {
            Box::pin(async move {
                let now = self.now.load(std::sync::atomic::Ordering::SeqCst);
                let key = format!("{scope}:{}", event_id.to_hex());
                let mut seen = self.seen.lock().expect("seen set");
                if seen.get(&key).is_some_and(|expires| *expires > now) {
                    return Ok(false);
                }
                seen.insert(key, now.saturating_add(ttl_secs));
                Ok(true)
            })
        }
    }

    #[tokio::test]
    async fn runtime_request_uuid_replay_is_shared_and_expires_at_bounded_ttl() {
        let owner = Keys::generate();
        let controller = Keys::generate();
        let agent = Keys::generate();
        let event = request_event(&owner, &controller, &agent, NOW, NOW + 300);
        let envelope =
            validate_runtime_request_envelope(&event, Some(&controller.public_key().to_hex()), NOW)
                .expect("envelope");
        let first_pod = SharedReplayGuard::default();
        let second_pod = first_pod.clone();
        let community = CommunityId::from_uuid(Uuid::new_v4());

        assert!(claim_runtime_request(&first_pod, community, &envelope)
            .await
            .expect("first claim"));
        assert!(!claim_runtime_request(&second_pod, community, &envelope)
            .await
            .expect("cross-pod replay"));

        second_pod.advance(RUNTIME_REQUEST_REPLAY_TTL_SECS);
        assert!(claim_runtime_request(&second_pod, community, &envelope)
            .await
            .expect("claim after TTL"));
    }

    #[tokio::test]
    #[ignore = "requires Redis"]
    async fn runtime_request_uuid_replay_is_atomic_across_redis_guards() {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
        let pool = RedisConfig::from_url(redis_url)
            .create_pool(Some(RedisRuntime::Tokio1))
            .expect("create Redis pool");
        let first_pod = RedisNip98ReplayGuard::new(pool.clone());
        let second_pod = RedisNip98ReplayGuard::new(pool);
        let controller = Keys::generate();
        let event = request_event(
            &Keys::generate(),
            &controller,
            &Keys::generate(),
            NOW,
            NOW + 300,
        );
        let envelope =
            validate_runtime_request_envelope(&event, Some(&controller.public_key().to_hex()), NOW)
                .expect("envelope");
        let community = CommunityId::from_uuid(Uuid::new_v4());

        assert!(claim_runtime_request(&first_pod, community, &envelope)
            .await
            .expect("first Redis claim"));
        assert!(!claim_runtime_request(&second_pod, community, &envelope)
            .await
            .expect("cross-pod Redis replay"));
    }
}
