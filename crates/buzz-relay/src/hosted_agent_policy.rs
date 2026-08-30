//! Single authorization policy for mutations targeting hosted agents.

/// Hosted-agent mutation whose authority is being checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HostedAgentAction {
    /// Public name/avatar presentation update.
    PresentationUpdate,
    /// Encrypted model/effort/runtime-name request.
    RuntimeRequest,
    /// Add, remove, or change the hosted agent in a channel.
    ChannelMembershipMutation,
    /// Archive or delete the hosted identity.
    ArchiveDelete,
}

/// Authorize a mutation using only the current deployment-community role.
///
/// NIP-OA ownership, a profile-declared owner, channel roles, and event-claimed
/// roles deliberately never enter this decision. They remain valid for their
/// unrelated protocols, but cannot grant hosted-agent management authority.
pub(crate) fn hosted_agent_action_authorized(
    _action: HostedAgentAction,
    current_community_role: Option<&str>,
) -> bool {
    current_community_role == Some("owner")
}

/// Return whether `target_pubkey` currently has a self-authored hosted-agent
/// directory head in this community.
pub(crate) async fn is_current_hosted_agent(
    db: &buzz_db::Db,
    community_id: buzz_core::CommunityId,
    target_pubkey: &[u8],
) -> Result<bool, buzz_db::DbError> {
    Ok(db
        .get_latest_global_replaceable(
            community_id,
            buzz_core::kind::KIND_AGENT_PROFILE as i32,
            target_pubkey,
        )
        .await?
        .is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_hosted_action_requires_the_exact_current_community_owner() {
        let actions = [
            HostedAgentAction::PresentationUpdate,
            HostedAgentAction::RuntimeRequest,
            HostedAgentAction::ChannelMembershipMutation,
            HostedAgentAction::ArchiveDelete,
        ];
        let actors = [
            ("community owner", Some("owner"), true),
            ("community admin", Some("admin"), false),
            ("channel admin only", Some("member"), false),
            ("declared agent owner only", None, false),
            ("ordinary member", Some("member"), false),
            ("event-claimed owner role", None, false),
        ];

        for action in actions {
            for (label, current_role, expected) in actors {
                assert_eq!(
                    hosted_agent_action_authorized(action, current_role),
                    expected,
                    "{action:?}: {label}"
                );
            }
        }
    }
}
