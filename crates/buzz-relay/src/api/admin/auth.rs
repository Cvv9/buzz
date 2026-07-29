use axum::http::{header, HeaderMap};

use super::error::ApiError;
use crate::state::AppState;

const ADMIN_REPLAY_SCOPE: &str = "deployment-admin";

pub(crate) fn is_admin_host(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(config) = state.config.admin.as_ref() else {
        return false;
    };
    headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| host == config.host)
}

pub async fn authorize(
    state: &AppState,
    headers: &HeaderMap,
    method: &str,
    path_and_query: &str,
) -> Result<nostr::PublicKey, ApiError> {
    let config = state
        .config
        .admin
        .as_ref()
        .ok_or_else(ApiError::not_found)?;
    if !is_admin_host(state, headers) {
        return Err(ApiError::forbidden());
    }
    if headers.get(header::ORIGIN).is_some_and(|origin| {
        origin
            .to_str()
            .map_or(true, |origin| !origin_matches_host(origin, &config.host))
    }) {
        return Err(ApiError::forbidden());
    }
    let expected_url = format!("{}{}", config.api_origin, path_and_query);
    let (pubkey, event_id_bytes) =
        crate::api::bridge::verify_bridge_auth(headers, method, &expected_url, None, true)
            .map_err(|_| ApiError::forbidden())?;
    if !config
        .operator_pubkeys
        .iter()
        .any(|allowed| allowed == &pubkey.to_hex())
    {
        return Err(ApiError::forbidden());
    }
    let event_id = nostr::EventId::from_byte_array(event_id_bytes);
    match state
        .nip98_replay
        .try_mark_in_scope(
            ADMIN_REPLAY_SCOPE,
            &event_id,
            buzz_auth::DEFAULT_REPLAY_TTL_SECS,
        )
        .await
    {
        Ok(true) => {
            tracing::info!(operator_pubkey = %pubkey.to_hex(), %path_and_query, "admin API authorized");
            Ok(pubkey)
        }
        Ok(false) | Err(_) => Err(ApiError::forbidden()),
    }
}

fn origin_matches_host(origin: &str, host: &str) -> bool {
    origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"))
        == Some(host)
}

#[cfg(test)]
mod tests {
    use super::origin_matches_host;

    #[test]
    fn browser_origin_must_match_admin_host() {
        assert!(origin_matches_host(
            "https://admin.example.com",
            "admin.example.com"
        ));
        assert!(origin_matches_host(
            "http://admin.localhost:3000",
            "admin.localhost:3000"
        ));
        assert!(!origin_matches_host(
            "https://attacker.example",
            "admin.example.com"
        ));
        assert!(!origin_matches_host("null", "admin.example.com"));
    }
}
