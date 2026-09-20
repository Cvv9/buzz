//! Typed controller-only recovery builder.
use crate::SdkError;
use buzz_core::workflow_recovery::ControllerRecoveryControl;
use nostr::{EventBuilder, Kind, Tag};

/// Construct a stop attestation; the trusted controller signs the returned builder.
pub fn build_workflow_recovery(
    control: &ControllerRecoveryControl,
) -> Result<EventBuilder, SdkError> {
    control
        .validate(control.observed_at)
        .map_err(|e| SdkError::InvalidInput(e.into()))?;
    let tags = [
        ("p", control.target_agent.as_str()),
        ("workflow-recovery", control.evidence_id.as_str()),
    ]
    .into_iter()
    .map(|(k, v)| Tag::parse([k, v]).map_err(|e| SdkError::InvalidTag(e.to_string())))
    .collect::<Result<Vec<_>, _>>()?;
    Ok(EventBuilder::new(
        Kind::Custom(buzz_core::kind::KIND_WORKFLOW_EXECUTION_CONTROL as u16),
        serde_json::to_string(control).map_err(|e| SdkError::InvalidInput(e.to_string()))?,
    )
    .tags(tags))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::workflow_recovery::RecoveryOperation;
    #[test]
    fn workflow_recovery_builder_binds_target_and_evidence_without_agent_privilege() {
        let signer = nostr::Keys::generate();
        let target = nostr::Keys::generate();
        let control = ControllerRecoveryControl {
            version: 1,
            community_id: uuid::Uuid::new_v4(),
            controller_pubkey: signer.public_key().to_hex(),
            target_agent: target.public_key().to_hex(),
            container_id: "a".repeat(64),
            evidence_id: "b".repeat(64),
            observed_at: 1000,
            container_started_at: 800,
            container_finished_at: 990,
            operation: RecoveryOperation::VerifiedAttemptStopped {
                run_id: uuid::Uuid::new_v4(),
                task_id: uuid::Uuid::new_v4(),
                grant_id: uuid::Uuid::new_v4(),
                instance_id: uuid::Uuid::new_v4(),
                channel_id: uuid::Uuid::new_v4(),
                ordinal: 1,
            },
        };
        let event = build_workflow_recovery(&control)
            .unwrap()
            .sign_with_keys(&signer)
            .unwrap();
        assert_eq!(event.kind.as_u16(), 46040);
        assert_eq!(event.tags.len(), 2);
        assert_eq!(
            event.tags.iter().next().unwrap().as_slice(),
            ["p", &target.public_key().to_hex()]
        );
        assert!(event.verify().is_ok());
        let mut invalid = control;
        invalid.target_agent = invalid.controller_pubkey.clone();
        assert!(build_workflow_recovery(&invalid).is_err());
    }
}
