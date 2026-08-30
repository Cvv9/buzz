//! Agent-global runtime defaults applied only at a quiescent turn boundary.

use buzz_core::hosted_agent_runtime::{CatalogDigest, RuntimeSelection, RuntimeSelectionMethod};

/// Fixed controller-facing failure code; adapter details stay local.
pub const RUNTIME_APPLY_FAILED_CODE: &str = "runtime_apply_failed";

/// One complete, atomic runtime revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingRuntimeRevision {
    pub revision: u64,
    pub selection: RuntimeSelection,
    pub method: RuntimeSelectionMethod,
    pub catalog_digest: CatalogDigest,
}

impl PendingRuntimeRevision {
    /// Exact adapter selection ID applied to every fresh session.
    pub fn exact_selection_id(&self) -> &str {
        match &self.method {
            RuntimeSelectionMethod::ConfigOption { option_value, .. } => option_value,
            RuntimeSelectionMethod::SetModel { model_id } => model_id,
        }
    }
}

/// Pool dispatch state for runtime reconciliation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeDefaultsState {
    Current,
    Quiescing,
    Applying,
}

/// Result of accepting a controller revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeRevisionDisposition {
    Quiescing,
    ReadyToApply,
    SupersededQuiescing,
    SupersededApplying,
    Idempotent,
    Stale,
}

/// Revision application result did not match the current pending revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaleRuntimeApplyResult;

/// Redacted failure returned to the controller after a probe rolls back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("{code}")]
pub struct RuntimeApplyFailure {
    pub code: &'static str,
}

impl RuntimeApplyFailure {
    pub const fn failed() -> Self {
        Self {
            code: RUNTIME_APPLY_FAILED_CODE,
        }
    }
}

/// Effective and pending agent-global runtime defaults.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeDefaults {
    state: RuntimeDefaultsState,
    effective: Option<PendingRuntimeRevision>,
    pending: Option<PendingRuntimeRevision>,
}

impl RuntimeDefaults {
    pub fn new(effective: Option<PendingRuntimeRevision>) -> Self {
        Self {
            state: RuntimeDefaultsState::Current,
            effective,
            pending: None,
        }
    }

    pub fn state(&self) -> RuntimeDefaultsState {
        self.state
    }

    pub fn effective(&self) -> Option<&PendingRuntimeRevision> {
        self.effective.as_ref()
    }

    pub fn pending(&self) -> Option<&PendingRuntimeRevision> {
        self.pending.as_ref()
    }

    pub fn dispatch_allowed(&self) -> bool {
        self.state == RuntimeDefaultsState::Current
    }

    pub fn request(
        &mut self,
        revision: PendingRuntimeRevision,
        active_turns: usize,
    ) -> RuntimeRevisionDisposition {
        if let Some(current) = self.pending.as_ref().or(self.effective.as_ref()) {
            if revision.revision < current.revision {
                return RuntimeRevisionDisposition::Stale;
            }
            if revision.revision == current.revision {
                return if revision == *current {
                    RuntimeRevisionDisposition::Idempotent
                } else {
                    RuntimeRevisionDisposition::Stale
                };
            }
        }

        let prior_state = self.state;
        self.pending = Some(revision);
        self.state = if active_turns == 0 {
            RuntimeDefaultsState::Applying
        } else {
            RuntimeDefaultsState::Quiescing
        };

        match prior_state {
            RuntimeDefaultsState::Quiescing => RuntimeRevisionDisposition::SupersededQuiescing,
            RuntimeDefaultsState::Applying => RuntimeRevisionDisposition::SupersededApplying,
            RuntimeDefaultsState::Current if active_turns == 0 => {
                RuntimeRevisionDisposition::ReadyToApply
            }
            RuntimeDefaultsState::Current => RuntimeRevisionDisposition::Quiescing,
        }
    }

    pub fn active_turns_changed(&mut self, active_turns: usize) -> bool {
        if self.state == RuntimeDefaultsState::Quiescing && active_turns == 0 {
            self.state = RuntimeDefaultsState::Applying;
            true
        } else {
            false
        }
    }

    pub fn mark_applied(&mut self, revision: u64) -> Result<(), StaleRuntimeApplyResult> {
        if self.state != RuntimeDefaultsState::Applying
            || self.pending.as_ref().map(|pending| pending.revision) != Some(revision)
        {
            return Err(StaleRuntimeApplyResult);
        }
        self.effective = self.pending.take();
        self.state = RuntimeDefaultsState::Current;
        Ok(())
    }

    pub fn mark_failed(&mut self, revision: u64) -> Result<&'static str, StaleRuntimeApplyResult> {
        if self.state != RuntimeDefaultsState::Applying
            || self.pending.as_ref().map(|pending| pending.revision) != Some(revision)
        {
            return Err(StaleRuntimeApplyResult);
        }
        self.pending = None;
        self.state = RuntimeDefaultsState::Current;
        Ok(RUNTIME_APPLY_FAILED_CODE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::hosted_agent_runtime::ReasoningEffort;
    use serde_json::json;

    fn revision(number: u64, model: &str, effort: ReasoningEffort) -> PendingRuntimeRevision {
        PendingRuntimeRevision {
            revision: number,
            selection: serde_json::from_value(json!({
                "model": model,
                "effort": effort,
                "runtime_name": "Market Intelligence"
            }))
            .expect("selection"),
            method: RuntimeSelectionMethod::SetModel {
                model_id: format!(
                    "{model}[{}]",
                    serde_json::to_value(effort)
                        .expect("effort")
                        .as_str()
                        .expect("effort string")
                ),
            },
            catalog_digest: serde_json::from_value(json!("a".repeat(64))).expect("digest"),
        }
    }

    #[test]
    fn waits_for_every_active_turn_without_cancelling_or_partial_apply() {
        let prior = revision(1, "gpt-5.6-terra", ReasoningEffort::Medium);
        let desired = revision(2, "gpt-5.6-sol", ReasoningEffort::High);
        let mut defaults = RuntimeDefaults::new(Some(prior.clone()));

        assert_eq!(
            defaults.request(desired.clone(), 2),
            RuntimeRevisionDisposition::Quiescing
        );
        assert_eq!(defaults.state(), RuntimeDefaultsState::Quiescing);
        assert!(!defaults.dispatch_allowed());
        assert_eq!(defaults.effective(), Some(&prior));
        assert_eq!(defaults.pending(), Some(&desired));
        assert!(!defaults.active_turns_changed(1));
        assert!(defaults.active_turns_changed(0));
        assert_eq!(defaults.state(), RuntimeDefaultsState::Applying);
        assert_eq!(defaults.effective(), Some(&prior));
    }

    #[test]
    fn idle_request_is_ready_and_model_effort_commit_atomically() {
        let prior = revision(1, "gpt-5.6-terra", ReasoningEffort::Low);
        let desired = revision(2, "gpt-5.6-sol", ReasoningEffort::Ultra);
        let mut defaults = RuntimeDefaults::new(Some(prior));

        assert_eq!(
            defaults.request(desired.clone(), 0),
            RuntimeRevisionDisposition::ReadyToApply
        );
        assert_eq!(defaults.effective().expect("prior").revision, 1);
        defaults.mark_applied(2).expect("apply");
        assert_eq!(defaults.state(), RuntimeDefaultsState::Current);
        assert_eq!(defaults.effective(), Some(&desired));
        assert_eq!(defaults.pending(), None);
        assert!(defaults.dispatch_allowed());
    }

    #[test]
    fn higher_revision_supersedes_and_stale_or_equal_is_idempotent() {
        let prior = revision(3, "gpt-5.6-terra", ReasoningEffort::Medium);
        let lower = revision(4, "gpt-5.6-sol", ReasoningEffort::Low);
        let higher = revision(5, "gpt-5.6-luna", ReasoningEffort::High);
        let mut defaults = RuntimeDefaults::new(Some(prior));

        defaults.request(lower, 1);
        assert_eq!(
            defaults.request(higher.clone(), 1),
            RuntimeRevisionDisposition::SupersededQuiescing
        );
        assert_eq!(
            defaults.request(higher.clone(), 1),
            RuntimeRevisionDisposition::Idempotent
        );
        assert_eq!(
            defaults.request(revision(2, "gpt-5.6-sol", ReasoningEffort::Ultra), 1),
            RuntimeRevisionDisposition::Stale
        );
        assert_eq!(defaults.pending(), Some(&higher));
    }

    #[test]
    fn probe_failure_rolls_back_and_resumes_dispatch_with_fixed_code() {
        let prior = revision(8, "gpt-5.6-terra", ReasoningEffort::Medium);
        let desired = revision(9, "gpt-5.6-sol", ReasoningEffort::Max);
        let mut defaults = RuntimeDefaults::new(Some(prior.clone()));
        defaults.request(desired, 0);

        assert_eq!(
            defaults.mark_failed(9).expect("matching failure"),
            RUNTIME_APPLY_FAILED_CODE
        );
        assert_eq!(defaults.effective(), Some(&prior));
        assert_eq!(defaults.pending(), None);
        assert_eq!(defaults.state(), RuntimeDefaultsState::Current);
        assert!(defaults.dispatch_allowed());
    }

    #[test]
    fn stale_apply_result_cannot_commit_or_rollback_newer_pending_revision() {
        let mut defaults = RuntimeDefaults::new(None);
        defaults.request(revision(10, "gpt-5.6-sol", ReasoningEffort::High), 0);
        assert_eq!(
            defaults.request(revision(11, "gpt-5.6-terra", ReasoningEffort::Xhigh), 0),
            RuntimeRevisionDisposition::SupersededApplying
        );

        assert_eq!(defaults.mark_applied(10), Err(StaleRuntimeApplyResult));
        assert_eq!(defaults.mark_failed(10), Err(StaleRuntimeApplyResult));
        assert_eq!(defaults.pending().expect("new pending").revision, 11);
    }
}
