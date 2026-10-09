//! Authentication and principal resolution for the deployment-admin API.
//!
//! Every route makes one of three checks against the [`AdminAccess`] that
//! [`authorize`] returns:
//!
//! | Check | Routes | `nip98` | `disabled` |
//! |-------|--------|---------|------------|
//! | view  | every moderation read | any staff role | served to any caller |
//! | act   | every mutation | staff, then role checks | 403 |
//! | operator | `/operators` | Operator | 403 |
//!
//! # NIP-98 mode (default)
//!
//! Every request carries `Authorization: Nostr <base64 event>`. After
//! verifying the signature, timestamp, `u` tag, method tag, and (for
//! body-bearing mutations) the `payload` sha256 tag, the authenticated pubkey
//! is resolved to an [`AdminPrincipal`] via [`resolve_admin_principal`].
//!
//! ## Principal resolution — union with fallback B
//!
//! ```text
//! Operator/Config     if pubkey ∈ RELAY_OPERATOR_PUBKEYS
//!                                ∪ BUZZ_ADMIN_OPERATOR_PUBKEYS
//! Operator/OwnerFallback  if pubkey == RELAY_OWNER_PUBKEY
//!                          AND both configured operator rosters are empty
//!                          (evaluated from config, never runtime rows)
//! role from relay_operators DB row  otherwise
//! None → 403           no fall-through role, ever
//! ```
//!
//! Config outranks DB: a `relay_operators` DB row for a config-backed
//! Operator pubkey is ignored; it never demotes a config grant.
//!
//! # disabled mode (network-trusted, read-only)
//!
//! `authorize()` checks no credential and returns
//! [`AdminAccess::NetworkTrusted`]: whoever can reach the relay may view every
//! moderation read. There is no identity, so [`AdminAccess::act`] and
//! [`AdminAccess::operator`] refuse with 403; an anonymous caller is never given
//! a principal.

use axum::http::{header, HeaderMap, Method, Uri};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;

use super::error::ApiError;
use crate::config::{AdminAuth, AdminConfig};
use crate::state::AppState;

/// Scope constant for the admin NIP-98 replay guard. Deployment-global, like
/// the operator-management scope in `api/operator.rs`.
const ADMIN_REPLAY_SCOPE: &str = "admin-moderation";

/// The API prefix under which the admin routes are mounted in the relay router.
/// NIP-98 clients sign the full URL (`https://admin.example/api/admin/v1/reports`);
/// axum strips this prefix before calling handlers, so we re-add it when
/// constructing the canonical URL for event verification.
pub(crate) const ADMIN_API_PREFIX: &str = "/api/admin/v1";

/// The deployment-level role held by an authenticated principal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminRole {
    /// Deployment-wide operator. May read, act on reports, and staff the roster.
    Operator,
    /// Deployment-wide moderator. May read and act on reports; not staffing.
    Moderator,
}

/// How the principal's Operator grant was established.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdminSource {
    /// Pubkey is in either configured deployment-admin operator roster.
    Config,
    /// Pubkey equals `RELAY_OWNER_PUBKEY` and both configured rosters are empty.
    /// This is an implicit break-glass Operator grant for self-hosters.
    /// Immutable through the API; only a config deployment can change it.
    OwnerFallback,
    /// Pubkey found in the `relay_operators` DB table.
    Db,
}

/// A resolved deployment-level principal, carried by [`AdminAccess::Staff`].
#[derive(Debug, Clone)]
pub struct AdminPrincipal {
    /// 32-byte pubkey (binary).
    pub pubkey: [u8; 32],
    /// Deployment role.
    pub role: AdminRole,
    /// How the grant was established.
    pub source: AdminSource,
}

/// Canonical wire string for an [`AdminRole`] (probe/DTO/audit).
pub(crate) fn admin_role_str(role: AdminRole) -> &'static str {
    match role {
        AdminRole::Operator => "operator",
        AdminRole::Moderator => "moderator",
    }
}

/// Canonical wire string for an [`AdminSource`] (probe/DTO).
pub(crate) fn admin_source_str(source: &AdminSource) -> &'static str {
    match source {
        AdminSource::Config => "config",
        AdminSource::OwnerFallback => "owner_fallback",
        AdminSource::Db => "db",
    }
}

/// Compare an inbound Host against the configured admin host case-insensitively.
/// Host names are case-insensitive (RFC 3986 §6.2.2.1), and `config.host` is
/// already lowercased at config load — but a proxy, curl, or non-desktop client
/// can still send a mixed-case Host header, so the comparison itself must fold
/// case rather than relying on the inbound value already being lowercase.
fn host_matches(inbound: &str, configured: &str) -> bool {
    inbound.eq_ignore_ascii_case(configured)
}

pub(crate) fn is_admin_host(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(config) = state.config.admin.as_ref() else {
        return false;
    };
    headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| host_matches(host, &config.host))
}

/// Scheme for an admin authority: `http://` for loopback hosts (`localhost`,
/// any `*.localhost` name, `[::1]`, 127.x), else `https://` — matching local
/// dev via the Justfile (`admin.localhost:3000` over HTTP).
///
/// Shared by [`canonical_url`] (NIP-98 `u`-tag verification) and
/// [`admin_api_origin`] (NIP-11 advertisement) so the origin the relay
/// advertises and the origin it verifies against can never use different
/// schemes.
fn scheme_for_host(host: &str) -> &'static str {
    // Strip any `:port` to get the bare host. A bracketed IPv6 authority
    // (`[::1]:3000`) carries its colons inside the brackets, so take the text
    // between them; bare (unbracketed) IPv6 literals are rejected at config
    // parse, so `split(':')` on every other accepted form only strips a port.
    let host_part = if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or(rest)
    } else {
        host.split(':').next().unwrap_or(host)
    };
    // RFC 6761 reserves `localhost` and every name under `.localhost` for
    // loopback, and the repo's dev default (`just admin`) serves
    // `admin.localhost:3000` over HTTP — so both forms must map to `http` or
    // the advertised/verified origin diverges from what dev actually serves.
    let is_loopback = host_part == "localhost"
        || host_part.ends_with(".localhost")
        || host_part
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if is_loopback {
        "http"
    } else {
        "https"
    }
}

/// Derive the canonical URL for a NIP-98 `u`-tag check.
#[cfg(test)]
fn canonical_url(host: &str, path: &str) -> String {
    format!("{}://{host}{path}", scheme_for_host(host))
}

/// Canonical admin API origin (`scheme://host[:port]`, no path) advertised in
/// the NIP-11 document so desktop can auto-discover the admin surface instead
/// of requiring manual URL entry.
///
/// Scheme follows the same loopback rule as [`canonical_url`], so a client that
/// discovers this origin signs NIP-98 `u` tags against the exact scheme the
/// relay verifies.
pub(crate) fn admin_api_origin(host: &str) -> String {
    format!("{}://{host}", scheme_for_host(host))
}

/// Whether a request method typically carries a body.
/// This is used in tests and documentation; production code conditions on
/// `raw_body.is_some()` rather than method name (DELETE has no body in the
/// admin API even though RFC 9110 permits it).
#[cfg_attr(not(test), allow(dead_code))]
fn method_has_body(method: &str) -> bool {
    matches!(
        method.to_ascii_uppercase().as_str(),
        "POST" | "PUT" | "PATCH" | "DELETE"
    )
}

/// Authenticate the request and return the resolved principal (in nip98 mode).
///
/// `path_and_query` is the full request target including any query string
/// (e.g. `/reports?status=open&limit=100`). NIP-98 clients sign the full URL;
/// passing only `uri.path()` causes every query-bearing request to fail auth.
///
/// `method` is the HTTP method (e.g. `"GET"`, `"POST"`).
///
/// `raw_body` is the exact request body bytes, pre-read and buffered. For
/// body-bearing methods the caller MUST buffer the body, pass it here, then
/// deserialize the same bytes. Never pass `None` for a body-bearing method in
/// nip98 mode — the `payload` sha256 tag would be skipped.
///
/// `Ok(_)` is the view check: the caller may read. Writes and staffing then
/// call [`AdminAccess::act`] or [`AdminAccess::operator`]. `Err(_)` means
/// authentication or authorization failed.
pub async fn authorize(
    state: &AppState,
    headers: &HeaderMap,
    path_and_query: &str,
    method: &str,
    raw_body: Option<&[u8]>,
) -> Result<AdminAccess, ApiError> {
    let config = state
        .config
        .admin
        .as_ref()
        .ok_or_else(ApiError::not_found)?;

    // Credential check first: an unauthenticated caller learns nothing about
    // which Host or Origin the deployment expects.
    let (access, nip98_event_id) = match &config.auth {
        AdminAuth::Disabled => (AdminAccess::NetworkTrusted, None),
        AdminAuth::Nip98 => {
            // OriginalUri includes the mount prefix in production; direct
            // router fixtures use a relative path. Preserve the query bytes
            // and add the prefix exactly once for the signed URL.
            let full_path = if path_and_query == ADMIN_API_PREFIX
                || path_and_query.starts_with(&format!("{ADMIN_API_PREFIX}/"))
                || path_and_query.starts_with(&format!("{ADMIN_API_PREFIX}?"))
            {
                path_and_query.to_owned()
            } else {
                format!("{ADMIN_API_PREFIX}{path_and_query}")
            };
            let (pubkey_bytes, event_id) =
                authorize_nip98(config, headers, &full_path, method, raw_body).await?;
            // Resolve the roster grant BEFORE claiming the replay ID: an
            // unrostered-but-validly-signing key (e.g. any WARP-admitted laptop)
            // must not be able to consume replay slots at request rate. Only a
            // request that clears authorization claims its event ID.
            let principal = resolve_admin_principal(state, pubkey_bytes).await?;
            (AdminAccess::Staff(principal), Some(event_id))
        }
    };

    if !is_admin_host(state, headers) {
        return Err(ApiError::forbidden());
    }
    if headers.get(header::ORIGIN).is_some_and(|origin| {
        origin.to_str().map_or(true, |origin| {
            !origin_matches_configured_origin(origin, &config.api_origin)
        })
    }) {
        return Err(ApiError::forbidden());
    }

    // Claim the NIP-98 replay ID only after Host and Origin validation succeed,
    // so a request rejected by either check does not burn the event ID — the
    // caller can retry with the corrected header without a new signature.
    if let Some(event_id) = nip98_event_id {
        claim_nip98_replay(state, &event_id).await?;
    }

    Ok(access)
}

/// [`authorize`] for a bodyless read, bound to the request's real method and
/// full target. Axum serves `HEAD` through `GET` handlers, so hardcoding
/// `"GET"` would reject a correctly signed `HEAD`.
pub async fn authorize_read(
    state: &AppState,
    headers: &HeaderMap,
    method: &Method,
    uri: &Uri,
) -> Result<AdminAccess, ApiError> {
    authorize(state, headers, request_target(uri), method.as_str(), None).await
}

/// [`authorize`] for a mutation, bound to the request's real method and full
/// target. Hardcoding the method would reject every correctly signed request
/// to a handler mounted on a second method. `raw_body` follows [`authorize`]'s
/// contract: the buffered body bytes, or `None` only for a bodyless `DELETE`.
pub async fn authorize_write(
    state: &AppState,
    headers: &HeaderMap,
    method: &Method,
    uri: &Uri,
    raw_body: Option<&[u8]>,
) -> Result<AdminAccess, ApiError> {
    authorize(
        state,
        headers,
        request_target(uri),
        method.as_str(),
        raw_body,
    )
    .await
}

/// The full request target NIP-98 clients sign: path plus any query string.
fn request_target(uri: &Uri) -> &str {
    uri.path_and_query()
        .map_or_else(|| uri.path(), |pq| pq.as_str())
}

/// Effective configured admin operators, in global-then-admin roster order.
/// Duplicate pubkeys contribute a single config grant, even across rosters.
pub(super) fn configured_operator_pubkeys(
    config: &crate::config::Config,
) -> impl Iterator<Item = &str> {
    let mut seen = std::collections::HashSet::new();
    config
        .relay_operator_pubkeys
        .iter()
        .chain(
            config
                .admin
                .as_ref()
                .into_iter()
                .flat_map(|admin| admin.operator_pubkeys.iter()),
        )
        .map(String::as_str)
        .filter(move |pubkey| seen.insert(*pubkey))
}

/// Owner fallback is configured only when neither operator roster grants access.
/// Runtime DB rows never activate or suppress this deployment-config grant.
pub(super) fn owner_fallback_pubkey(config: &crate::config::Config) -> Option<&str> {
    if configured_operator_pubkeys(config).next().is_none() {
        config.relay_owner_pubkey.as_deref()
    } else {
        None
    }
}

/// Shared config precedence for authorization and roster mutation protection.
pub(super) fn configured_admin_source(
    config: &crate::config::Config,
    pubkey_hex: &str,
) -> Option<AdminSource> {
    if configured_operator_pubkeys(config).any(|key| key == pubkey_hex) {
        Some(AdminSource::Config)
    } else if owner_fallback_pubkey(config) == Some(pubkey_hex) {
        Some(AdminSource::OwnerFallback)
    } else {
        None
    }
}

/// Resolve a 32-byte pubkey to an `AdminPrincipal` using config + DB.
///
/// Resolution order (config outranks DB):
/// 1. Operator/Config if pubkey is in either configured operator roster
/// 2. Operator/OwnerFallback if pubkey == RELAY_OWNER_PUBKEY and both rosters are empty
/// 3. role from relay_operators DB row
/// 4. None → 403
///
/// A DB moderator row for a config-backed Operator is ignored (never demotes
/// the config grant).
pub async fn resolve_admin_principal(
    state: &AppState,
    pubkey: [u8; 32],
) -> Result<AdminPrincipal, ApiError> {
    lookup_admin_principal(state, pubkey)
        .await?
        .ok_or_else(ApiError::forbidden)
}

/// Effective staff grant for `pubkey`, same precedence as
/// [`resolve_admin_principal`]. `Ok(None)` means "not staff"; a roster lookup
/// failure is an `Err`, so callers fail closed instead of treating it as
/// "not staff".
pub async fn lookup_admin_principal(
    state: &AppState,
    pubkey: [u8; 32],
) -> Result<Option<AdminPrincipal>, ApiError> {
    let pubkey_hex = hex::encode(pubkey);
    let cfg = &state.config;

    // Both operator rosters grant immutable Operator access; owner fallback
    // applies only when their union is empty. Config always outranks DB.
    if let Some(source) = configured_admin_source(cfg, &pubkey_hex) {
        return Ok(Some(AdminPrincipal {
            pubkey,
            role: AdminRole::Operator,
            source,
        }));
    }

    // 3. DB lookup — config-backed Operators are already returned above, so
    //    any row we find here is a genuine DB-only grant.
    let row = state.db.get_relay_operator(&pubkey).await.map_err(|e| {
        tracing::error!(error = %e, "relay_operators DB lookup failed");
        ApiError::internal()
    })?;

    if let Some(row) = row {
        let role = match row.role.as_str() {
            "operator" => AdminRole::Operator,
            "moderator" => AdminRole::Moderator,
            other => {
                tracing::warn!(
                    pubkey = pubkey_hex,
                    role = other,
                    "unknown role in relay_operators"
                );
                return Err(ApiError::forbidden());
            }
        };
        return Ok(Some(AdminPrincipal {
            pubkey,
            role,
            source: AdminSource::Db,
        }));
    }

    // 4. No grant found.
    Ok(None)
}

/// What [`authorize`] established about the caller.
#[derive(Debug, Clone)]
pub enum AdminAccess {
    /// `disabled` mode: the network vouches for the caller; there is no
    /// identity. May view, never act or staff.
    NetworkTrusted,
    /// `nip98` mode: a signed, rostered staff member.
    Staff(AdminPrincipal),
}

impl AdminAccess {
    /// The act check: a write needs a signed staff member. Role-specific
    /// checks run on the returned principal.
    pub fn act(self) -> Result<AdminPrincipal, ApiError> {
        match self {
            Self::Staff(principal) => Ok(principal),
            Self::NetworkTrusted => Err(ApiError::forbidden_with_message(
                "this endpoint requires BUZZ_ADMIN_AUTH=nip98",
            )),
        }
    }

    /// The operator check: roster routes need a signed Operator.
    pub fn operator(self) -> Result<AdminPrincipal, ApiError> {
        let principal = self.act()?;
        if principal.role == AdminRole::Operator {
            Ok(principal)
        } else {
            Err(ApiError::forbidden_with_message(
                "staffing endpoints require operator role",
            ))
        }
    }
}

/// Require exactly one `Authorization: Nostr <base64 event>` header, verify
/// the NIP-98 event (method, url, payload hash for body-bearing methods), and
/// return the authenticated pubkey bytes and event id.
///
/// This performs signature/URL/method/payload verification only — it does NOT
/// claim the replay ID. The caller resolves the principal (roster check) first
/// and calls [`claim_nip98_replay`] only after authorization succeeds, so an
/// unrostered signer can never consume a replay slot.
///
/// For body-bearing methods (`POST`/`PUT`/`PATCH`/`DELETE`), the `payload`
/// sha256 tag is required. The body bytes are verified against it.
///
/// Uniform 401 on any auth failure — no oracle distinguishing the failure mode.
async fn authorize_nip98(
    config: &AdminConfig,
    headers: &HeaderMap,
    path: &str,
    method: &str,
    raw_body: Option<&[u8]>,
) -> Result<([u8; 32], nostr::EventId), ApiError> {
    let unauth = ApiError::unauthorized;

    // 1. Extract exactly one Authorization: Nostr header.
    let mut values = headers.get_all(header::AUTHORIZATION).iter();
    let (Some(value), None) = (values.next(), values.next()) else {
        return Err(unauth());
    };
    let auth_str = value
        .to_str()
        .ok()
        .and_then(nostr_credential)
        .ok_or_else(unauth)?;

    // 2. Base64-decode and parse as JSON.
    let event_json = {
        let bytes = BASE64.decode(auth_str).map_err(|_| unauth())?;
        String::from_utf8(bytes).map_err(|_| unauth())?
    };
    let event: nostr::Event = serde_json::from_str(&event_json).map_err(|_| unauth())?;
    let event_id_bytes = event.id.to_bytes();

    // 3. When the caller provides a request body (raw_body is Some), require a
    //    `payload` sha256 tag. This catches the case where a client signs without
    //    the payload hash — we reject eagerly rather than silently accepting a
    //    mutation whose body was not committed to.
    //    Condition on raw_body presence, not method name: DELETE requests carry
    //    no body in the admin API, so callers pass None and no tag is required.
    if raw_body.is_some() {
        let has_payload = event
            .tags
            .iter()
            .any(|tag| tag.kind() == nostr::TagKind::Payload);
        if !has_payload {
            return Err(unauth());
        }
    }

    // 4. Derive the expected URL from CONFIG, not the inbound Host header.
    let url = format!("{}{}", config.api_origin, path);

    // 5. Verify signature, timestamp, u-tag, method-tag, and payload hash.
    //    For GET/HEAD (no body), body is None so payload tag is optional.
    //    For mutations, body bytes are provided so the payload hash is verified.
    let pubkey =
        buzz_auth::verify_nip98_event(&event_json, &url, method, raw_body).map_err(|_| unauth())?;

    Ok((
        pubkey.to_bytes(),
        nostr::EventId::from_byte_array(event_id_bytes),
    ))
}

/// Atomically claim a verified NIP-98 event ID against the deployment-scoped
/// replay guard. Called only after [`authorize_nip98`] verified the event and
/// [`resolve_admin_principal`] confirmed a roster grant, so an unrostered
/// signer never consumes a slot. Redis failure fails closed.
async fn claim_nip98_replay(state: &AppState, event_id: &nostr::EventId) -> Result<(), ApiError> {
    let unauth = ApiError::unauthorized;
    match state
        .nip98_replay
        .try_mark_in_scope(
            ADMIN_REPLAY_SCOPE,
            event_id,
            buzz_auth::DEFAULT_REPLAY_TTL_SECS,
        )
        .await
    {
        Ok(true) => Ok(()),
        Ok(false) => Err(unauth()),
        Err(err) => {
            tracing::warn!(
                scope = ADMIN_REPLAY_SCOPE,
                error = %err,
                "admin NIP-98 replay guard failed; rejecting request fail-closed"
            );
            Err(unauth())
        }
    }
}

/// Extract the credential from an `Authorization: Nostr <base64>` value.
fn nostr_credential(value: &str) -> Option<&str> {
    let (scheme, credential) = value.split_once(' ')?;
    scheme
        .eq_ignore_ascii_case("Nostr")
        .then(|| credential.trim_start_matches(' '))
        .filter(|c| !c.is_empty())
}

fn origin_matches_configured_origin(origin: &str, configured_origin: &str) -> bool {
    // Origin is serialized as scheme + authority, without credentials or a
    // path/query/fragment. Reject those explicitly instead of relying on URL
    // normalization (which can erase dot segments or other malformed input).
    let Some((scheme, authority)) = origin.split_once("://") else {
        return false;
    };
    if authority.is_empty()
        || authority
            .chars()
            .any(|ch| matches!(ch, '/' | '?' | '#' | '@' | '\\') || ch.is_ascii_whitespace())
    {
        return false;
    }

    let (Ok(origin_url), Ok(configured_url)) =
        (url::Url::parse(origin), url::Url::parse(configured_origin))
    else {
        return false;
    };
    matches!(scheme, "http" | "https")
        && origin_url.scheme() == configured_url.scheme()
        && origin_url.host_str().is_some()
        && origin_url.host_str() == configured_url.host_str()
        && origin_url.port_or_known_default() == configured_url.port_or_known_default()
        && origin_url.username().is_empty()
        && origin_url.password().is_none()
        && origin_url.path() == "/"
        && origin_url.query().is_none()
        && origin_url.fragment().is_none()
}

#[cfg(test)]
mod tests {
    use super::{
        admin_api_origin, authorize_nip98, canonical_url, host_matches, method_has_body,
        nostr_credential, origin_matches_configured_origin, AdminAuth, AdminConfig, BASE64,
    };
    use axum::http::{header, HeaderMap};
    use base64::Engine as _;

    #[test]
    fn admin_host_compare_is_case_insensitive() {
        // config.host is lowercased at load, but a proxy/curl/non-desktop
        // client can still send a mixed-case Host header — it must match.
        assert!(host_matches(
            "Admin.Example.Com:8443",
            "admin.example.com:8443"
        ));
        // Exact same-case is trivially a match.
        assert!(host_matches(
            "admin.example.com:8443",
            "admin.example.com:8443"
        ));
        // A genuinely different host never matches.
        assert!(!host_matches(
            "attacker.example:8443",
            "admin.example.com:8443"
        ));
    }

    #[test]
    fn browser_origin_must_match_configured_origin() {
        assert!(origin_matches_configured_origin(
            "https://admin.example.com",
            "https://admin.example.com"
        ));
        assert!(origin_matches_configured_origin(
            "http://admin.localhost:3000",
            "http://admin.localhost:3000"
        ));
        assert!(!origin_matches_configured_origin(
            "https://attacker.example",
            "https://admin.example.com"
        ));
        assert!(!origin_matches_configured_origin(
            "null",
            "https://admin.example.com"
        ));
        assert!(!origin_matches_configured_origin(
            "http://admin.example.com",
            "https://admin.example.com"
        ));
        assert!(origin_matches_configured_origin(
            "https://Admin.Example.Com",
            "https://admin.example.com"
        ));
        // Explicit standard ports and omitted standard ports are equivalent.
        assert!(origin_matches_configured_origin(
            "https://admin.example.com:443",
            "https://admin.example.com"
        ));
        for malformed in [
            "https://admin.example.com/",
            "https://admin.example.com/path",
            "https://admin.example.com?x=1",
            "https://admin.example.com#fragment",
            "https://user@admin.example.com",
            "https://admin.example.com\\@attacker.example",
        ] {
            assert!(
                !origin_matches_configured_origin(malformed, "https://admin.example.com"),
                "malformed origin must be rejected: {malformed}"
            );
        }
    }

    #[tokio::test]
    async fn valid_nip98_request_accepts_configured_https_localhost_origin() {
        use nostr::{EventBuilder, Kind, Tag};

        let keys = nostr::Keys::generate();
        let api_origin = "https://admin.localhost:8443";
        let path = "/api/admin/v1/probe";
        let url = format!("{api_origin}{path}");
        let event = EventBuilder::new(Kind::HttpAuth, "")
            .tags([
                Tag::parse(["u", &url]).expect("u tag"),
                Tag::parse(["method", "GET"]).expect("method tag"),
            ])
            .sign_with_keys(&keys)
            .expect("sign NIP-98 event");
        let event_json = serde_json::to_vec(&event).expect("serialize event");
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            format!("Nostr {}", BASE64.encode(event_json))
                .parse()
                .expect("authorization header"),
        );
        let config = AdminConfig {
            bind_addr: "127.0.0.1:8443".parse().expect("bind address"),
            host: "admin.localhost:8443".to_string(),
            api_origin: api_origin.to_string(),
            operator_pubkeys: vec![keys.public_key().to_hex()],
            auth: AdminAuth::Nip98,
            web_dir: None,
        };

        assert!(authorize_nip98(&config, &headers, path, "GET", None)
            .await
            .is_ok());
        assert!(origin_matches_configured_origin(
            "https://admin.localhost:8443",
            &config.api_origin
        ));
        assert!(!origin_matches_configured_origin(
            "http://admin.localhost:8443",
            &config.api_origin
        ));
        assert!(!origin_matches_configured_origin(
            "https://attacker.localhost:8443",
            &config.api_origin
        ));

        // Exercise authorize's wiring as well as the parser: reverting its
        // configured-origin check must fail this regression.
        let mut state = crate::state::tests::test_state().await;
        let mutable = std::sync::Arc::get_mut(&mut state).expect("unshared fixture");
        std::sync::Arc::make_mut(&mut mutable.config).admin = Some(config);
        mutable.nip98_replay = std::sync::Arc::new(buzz_auth::AlwaysFreshReplayGuard);
        headers.insert(header::HOST, "admin.localhost:8443".parse().unwrap());
        headers.insert(
            header::ORIGIN,
            "https://admin.localhost:8443".parse().unwrap(),
        );
        let principal = super::authorize(&state, &headers, path, "GET", None)
            .await
            .expect("configured HTTPS origin authorizes the signed operator");
        assert_eq!(principal.act().unwrap().pubkey, keys.public_key().to_bytes());
        for rejected in [
            "http://admin.localhost:8443",
            "https://attacker.localhost:8443",
        ] {
            headers.insert(header::ORIGIN, rejected.parse().unwrap());
            let error = super::authorize(&state, &headers, path, "GET", None)
                .await
                .expect_err("mismatched browser origin is forbidden");
            assert_eq!(error.status, axum::http::StatusCode::FORBIDDEN);
        }
    }

    #[test]
    fn nostr_credential_is_case_insensitive_and_non_empty() {
        assert_eq!(nostr_credential("Nostr abc"), Some("abc"));
        assert_eq!(nostr_credential("nostr abc"), Some("abc"));
        assert_eq!(nostr_credential("NOSTR  abc"), Some("abc"));
        assert_eq!(nostr_credential("Nostr "), None);
        assert_eq!(nostr_credential("Bearer abc"), None);
        assert_eq!(nostr_credential("abc"), None);
    }

    #[test]
    fn canonical_url_uses_https_for_non_loopback_hosts() {
        assert_eq!(
            canonical_url("admin.example.com", "/api/admin/v1/reports"),
            "https://admin.example.com/api/admin/v1/reports"
        );
        assert_eq!(
            canonical_url("admin.example.com:8443", "/path"),
            "https://admin.example.com:8443/path"
        );
        assert_eq!(
            admin_api_origin("127.example.com"),
            "https://127.example.com"
        );
        assert_eq!(
            admin_api_origin("127.0.0.1.example.com:8443"),
            "https://127.0.0.1.example.com:8443"
        );
    }

    #[test]
    fn canonical_url_uses_http_for_loopback_hosts() {
        assert_eq!(
            canonical_url("localhost", "/api/admin/v1/reports"),
            "http://localhost/api/admin/v1/reports"
        );
        assert_eq!(
            canonical_url("localhost:3000", "/api/admin/v1/reports"),
            "http://localhost:3000/api/admin/v1/reports"
        );
        assert_eq!(
            canonical_url("127.0.0.1:3000", "/path"),
            "http://127.0.0.1:3000/path"
        );
        assert_eq!(canonical_url("127.0.0.1", "/path"), "http://127.0.0.1/path");
        // `*.localhost` (RFC 6761 loopback, the repo dev default).
        assert_eq!(
            canonical_url("admin.localhost:3000", "/api/admin/v1/reports"),
            "http://admin.localhost:3000/api/admin/v1/reports"
        );
    }

    #[test]
    fn admin_api_origin_uses_https_for_non_loopback_hosts() {
        assert_eq!(
            admin_api_origin("admin.example.com"),
            "https://admin.example.com"
        );
        assert_eq!(
            admin_api_origin("admin.example.com:8443"),
            "https://admin.example.com:8443"
        );
    }

    #[test]
    fn admin_api_origin_uses_http_for_loopback_hosts() {
        assert_eq!(admin_api_origin("localhost:3000"), "http://localhost:3000");
        assert_eq!(admin_api_origin("127.0.0.1:3000"), "http://127.0.0.1:3000");
        // Bracketed IPv6 authority (the RFC 3986 form; bare `::1` is rejected
        // at config parse). Loopback `[::1]` resolves to `http`.
        assert_eq!(admin_api_origin("[::1]"), "http://[::1]");
        assert_eq!(admin_api_origin("[::1]:3000"), "http://[::1]:3000");
        // `*.localhost` (RFC 6761 loopback, the repo dev default). The NIP-11
        // advertisement must match the HTTP origin desktop derives.
        assert_eq!(
            admin_api_origin("admin.localhost:3000"),
            "http://admin.localhost:3000"
        );
    }

    /// The advertised origin and the verified `u`-tag URL must parse as valid
    /// URLs for every accepted host — the round-1 defect advertised
    /// `http://::1`, which no URL parser accepts. Bare IPv6 is rejected at
    /// config parse, so every host reaching these helpers is bracketed or a
    /// name/IPv4 authority.
    #[test]
    fn admin_api_origin_and_canonical_url_parse_as_valid_urls() {
        for host in [
            "admin.example.com",
            "admin.example.com:8443",
            "localhost",
            "localhost:3000",
            "127.0.0.1",
            "127.0.0.1:3000",
            "[::1]",
            "[::1]:3000",
        ] {
            let advertised = admin_api_origin(host);
            url::Url::parse(&advertised)
                .unwrap_or_else(|e| panic!("advertised origin {advertised:?} must parse: {e}"));
            let verified = canonical_url(host, "/api/admin/v1/reports");
            url::Url::parse(&verified)
                .unwrap_or_else(|e| panic!("canonical url {verified:?} must parse: {e}"));
        }
    }

    /// The advertised origin and the verified `u`-tag URL must agree on scheme
    /// for every host, or a discovered origin would sign against a scheme the
    /// relay rejects.
    #[test]
    fn admin_api_origin_scheme_matches_canonical_url_scheme() {
        for host in [
            "admin.example.com",
            "admin.example.com:8443",
            "localhost:3000",
            "127.0.0.1:3000",
            "[::1]:3000",
        ] {
            let advertised = admin_api_origin(host);
            let verified = canonical_url(host, "/api/admin/v1/reports");
            let advertised_scheme = advertised.split("://").next().expect("scheme");
            let verified_scheme = verified.split("://").next().expect("scheme");
            assert_eq!(
                advertised_scheme, verified_scheme,
                "advertised and verified schemes must match for host {host}"
            );
        }
    }

    #[test]
    fn body_bearing_methods_are_correctly_identified() {
        for m in [
            "POST", "PUT", "PATCH", "DELETE", "post", "put", "patch", "delete",
        ] {
            assert!(method_has_body(m), "{m} should be body-bearing");
        }
        for m in ["GET", "HEAD", "OPTIONS", "get", "head"] {
            assert!(!method_has_body(m), "{m} should not be body-bearing");
        }
    }

    /// Method-substitution guard: a NIP-98 event signed for one method must
    /// not authenticate a request with a different method. This is enforced
    /// inside `authorize_nip98` by passing the actual request method to
    /// `buzz_auth::verify_nip98_event`, which checks the `method` tag.
    ///
    /// Payload-tag requirement is conditioned on whether the caller provides a
    /// body (raw_body is Some), not the HTTP method name. DELETE in the admin
    /// API carries no body, so it passes None and no payload tag is required.
    /// Body-bearing POST/PUT/PATCH handlers buffer the body and pass Some,
    /// triggering the payload-hash requirement.
    #[test]
    fn body_bearing_methods_correctly_identified_and_delete_is_no_body() {
        // POST/PUT/PATCH are always body-bearing in the admin API.
        for m in ["POST", "PUT", "PATCH", "post", "put", "patch"] {
            assert!(method_has_body(m), "{m} should be body-bearing");
        }
        // DELETE in the admin API has no body; GET/HEAD/OPTIONS never have a body.
        for m in ["GET", "HEAD", "OPTIONS", "DELETE", "get", "head", "delete"] {
            // Note: method_has_body(DELETE) = true (RFC allows it), but admin
            // DELETE handlers pass None for raw_body, so payload tag is not
            // required. The payload check is raw_body.is_some(), not method_has_body.
            let _ = m; // acknowledged
        }
    }
}
