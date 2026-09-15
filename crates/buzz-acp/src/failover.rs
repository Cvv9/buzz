//! Harness-generic provider failover.
//!
//! When the primary agent process (e.g. `codex-acp` running under a ChatGPT
//! subscription login) starts returning errors that indicate a usage/rate
//! limit rather than a transient application bug, the harness can switch
//! newly spawned agents to an alternate provider (e.g. an API-billed model)
//! until a cooldown elapses, then switch back.
//!
//! This module is pure and harness-agnostic: it knows nothing about ACP,
//! Codex, or Azure specifically. The Codex/Azure Foundry wiring lives in
//! `deploy/compose/agent-entrypoint.sh`, which sets the env vars this module
//! reads via [`crate::config::Config`].

use std::time::{Duration, Instant};

use crate::config::Config;

/// Static (config-derived) policy describing how and when to fail over to an
/// alternate provider.
///
/// A policy with empty `agent_args`, empty `env`, and `model: None` is
/// considered disabled — see [`FailoverPolicy::enabled`].
#[derive(Debug, Clone, Default)]
pub struct FailoverPolicy {
    /// Extra CLI args appended after the primary `agent_args` when spawning
    /// in failover mode.
    pub agent_args: Vec<String>,
    /// Extra env vars injected only when spawning in failover mode. Wins over
    /// a same-keyed entry from `persona_env_vars` when composed in
    /// [`spawn_plan`].
    pub env: Vec<(String, String)>,
    /// Desired model while in failover mode. `None` leaves model selection to
    /// `agent_args`/the adapter default — `set_model` is skipped in that case.
    pub model: Option<String>,
    /// Lowercased, trimmed substrings matched against the lowercased error
    /// message to detect a usage/rate-limit style failure.
    pub triggers: Vec<String>,
    /// Number of consecutive trigger matches required before activating
    /// failover. Must be `>= 1`.
    pub threshold: u32,
    /// How long the harness stays on the failover provider before returning
    /// to primary. `None` means stay on failover until process restart.
    pub cooldown: Option<Duration>,
}

impl FailoverPolicy {
    /// Whether this policy actually changes anything when activated. A
    /// policy with no extra args, no extra env, and no model override is a
    /// no-op even if triggers/threshold/cooldown are configured.
    pub fn enabled(&self) -> bool {
        !self.agent_args.is_empty() || !self.env.is_empty() || self.model.is_some()
    }
}

/// Per-process runtime state tracking whether the harness is currently in
/// failover mode.
#[derive(Debug, Default)]
pub struct FailoverState {
    consecutive_matches: u32,
    active_since: Option<Instant>,
}

/// Outcome of observing one application-error outcome against the policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailoverDecision {
    /// The error was not counted (policy disabled, or message did not match
    /// any trigger).
    Ignored,
    /// The error matched a trigger; `n` consecutive matches so far, below
    /// threshold.
    Counted(u32),
    /// The error matched a trigger and pushed the consecutive count to the
    /// threshold — failover activates now.
    Activate,
    /// The error matched a trigger, but failover was already active.
    AlreadyActive,
}

impl FailoverState {
    /// Whether the harness is currently spawning/keeping agents on the
    /// failover provider.
    pub fn is_active(&self) -> bool {
        self.active_since.is_some()
    }

    /// Record a successful turn. Resets the consecutive-trigger-match streak
    /// so an isolated error doesn't accumulate toward activation across
    /// unrelated successes.
    pub fn observe_success(&mut self) {
        self.consecutive_matches = 0;
    }

    /// Record an application-error turn outcome and decide whether it moves
    /// the state toward (or confirms) failover activation.
    pub fn observe_error(
        &mut self,
        policy: &FailoverPolicy,
        message: &str,
        now: Instant,
    ) -> FailoverDecision {
        if !policy.enabled() {
            return FailoverDecision::Ignored;
        }
        let lower = message.to_ascii_lowercase();
        let matched = policy.triggers.iter().any(|t| lower.contains(t.as_str()));
        if !matched {
            self.consecutive_matches = 0;
            return FailoverDecision::Ignored;
        }
        if self.is_active() {
            return FailoverDecision::AlreadyActive;
        }
        self.consecutive_matches += 1;
        if self.consecutive_matches >= policy.threshold.max(1) {
            self.active_since = Some(now);
            FailoverDecision::Activate
        } else {
            FailoverDecision::Counted(self.consecutive_matches)
        }
    }

    /// Check whether the configured cooldown has elapsed and, if so,
    /// deactivate failover and reset the trigger-match streak.
    ///
    /// Returns `true` when this call transitioned the state back to primary.
    /// A `None` cooldown never expires (stays on failover until process
    /// restart).
    pub fn expire_if_due(&mut self, policy: &FailoverPolicy, now: Instant) -> bool {
        let Some(active_since) = self.active_since else {
            return false;
        };
        let Some(cooldown) = policy.cooldown else {
            return false;
        };
        if now.duration_since(active_since) >= cooldown {
            self.active_since = None;
            self.consecutive_matches = 0;
            true
        } else {
            false
        }
    }
}

/// Concrete spawn parameters for a new agent process, composed from the
/// primary config and (when active) the failover policy.
#[derive(Debug, Clone)]
pub struct SpawnPlan {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub model: Option<String>,
    pub failover: bool,
}

/// Build the spawn parameters for a new agent process.
///
/// When `failover_active` is `false`, this is just the primary
/// `agent_args`/`persona_env_vars`/`model` from `config`. When `true`, the
/// failover policy's args are appended, its env vars are layered on top
/// (winning on a duplicate key), and its model (if any) replaces the primary
/// model.
pub fn spawn_plan(config: &Config, failover_active: bool) -> SpawnPlan {
    if !failover_active {
        return SpawnPlan {
            args: config.agent_args.clone(),
            env: config.persona_env_vars.clone(),
            model: config.model.clone(),
            failover: false,
        };
    }

    let policy = &config.failover;
    let mut args = config.agent_args.clone();
    args.extend(policy.agent_args.iter().cloned());

    let mut env = config.persona_env_vars.clone();
    for (key, value) in &policy.env {
        if let Some(existing) = env.iter_mut().find(|(k, _)| k == key) {
            existing.1 = value.clone();
        } else {
            env.push((key.clone(), value.clone()));
        }
    }

    SpawnPlan {
        args,
        env,
        model: policy.model.clone(),
        failover: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> FailoverPolicy {
        FailoverPolicy {
            agent_args: vec!["-c".into(), "model_provider=\"azure-foundry\"".into()],
            env: vec![("BUZZ_FAILOVER".into(), "1".into())],
            model: Some("azure-model".into()),
            triggers: vec!["usage_limit".into(), "internal error".into()],
            threshold: 2,
            cooldown: Some(Duration::from_secs(3600)),
        }
    }

    fn disabled_policy() -> FailoverPolicy {
        FailoverPolicy {
            agent_args: Vec::new(),
            env: Vec::new(),
            model: None,
            triggers: vec!["usage_limit".into()],
            threshold: 1,
            cooldown: Some(Duration::from_secs(60)),
        }
    }

    fn test_config(policy: FailoverPolicy) -> Config {
        let mut config = crate::config::test_support::minimal_config();
        config.agent_args = vec!["acp".into()];
        config.persona_env_vars = vec![("EXISTING".into(), "orig".into())];
        config.model = Some("primary-model".into());
        config.failover = policy;
        config
    }

    #[test]
    fn disabled_policy_never_activates() {
        let policy = disabled_policy();
        // Sanity: this fixture is in fact disabled.
        assert!(!policy.enabled());
        let mut state = FailoverState::default();
        let now = Instant::now();
        assert_eq!(
            state.observe_error(&policy, "usage_limit reached", now),
            FailoverDecision::Ignored
        );
        assert!(!state.is_active());
    }

    #[test]
    fn threshold_counts_and_activates() {
        let policy = policy();
        let mut state = FailoverState::default();
        let now = Instant::now();
        assert_eq!(
            state.observe_error(&policy, "hit usage_limit", now),
            FailoverDecision::Counted(1)
        );
        assert!(!state.is_active());
        assert_eq!(
            state.observe_error(&policy, "hit usage_limit again", now),
            FailoverDecision::Activate
        );
        assert!(state.is_active());
    }

    #[test]
    fn non_matching_error_resets_counter() {
        let policy = policy();
        let mut state = FailoverState::default();
        let now = Instant::now();
        assert_eq!(
            state.observe_error(&policy, "usage_limit reached", now),
            FailoverDecision::Counted(1)
        );
        assert_eq!(
            state.observe_error(&policy, "some unrelated error", now),
            FailoverDecision::Ignored
        );
        // Counter was reset — needs threshold consecutive matches again.
        assert_eq!(
            state.observe_error(&policy, "usage_limit reached", now),
            FailoverDecision::Counted(1)
        );
    }

    #[test]
    fn success_resets_counter() {
        let policy = policy();
        let mut state = FailoverState::default();
        let now = Instant::now();
        assert_eq!(
            state.observe_error(&policy, "usage_limit reached", now),
            FailoverDecision::Counted(1)
        );
        state.observe_success();
        assert_eq!(
            state.observe_error(&policy, "usage_limit reached", now),
            FailoverDecision::Counted(1)
        );
    }

    #[test]
    fn match_is_case_insensitive() {
        let policy = policy();
        let mut state = FailoverState::default();
        let now = Instant::now();
        assert_eq!(
            state.observe_error(&policy, "USAGE_LIMIT EXCEEDED", now),
            FailoverDecision::Counted(1)
        );
    }

    #[test]
    fn already_active_short_circuits() {
        let policy = policy();
        let mut state = FailoverState::default();
        let now = Instant::now();
        state.observe_error(&policy, "usage_limit", now);
        state.observe_error(&policy, "usage_limit", now);
        assert!(state.is_active());
        assert_eq!(
            state.observe_error(&policy, "usage_limit", now),
            FailoverDecision::AlreadyActive
        );
    }

    #[test]
    fn cooldown_expires_and_resets() {
        let policy = policy();
        let mut state = FailoverState::default();
        let now = Instant::now();
        state.observe_error(&policy, "usage_limit", now);
        state.observe_error(&policy, "usage_limit", now);
        assert!(state.is_active());

        // Not yet due.
        assert!(!state.expire_if_due(&policy, now + Duration::from_secs(10)));
        assert!(state.is_active());

        // Cooldown elapsed.
        assert!(state.expire_if_due(&policy, now + Duration::from_secs(3600)));
        assert!(!state.is_active());

        // Counter was reset too — needs a fresh threshold streak.
        assert_eq!(
            state.observe_error(&policy, "usage_limit", now),
            FailoverDecision::Counted(1)
        );
    }

    #[test]
    fn zero_cooldown_never_expires() {
        let mut policy = policy();
        policy.cooldown = None;
        let mut state = FailoverState::default();
        let now = Instant::now();
        state.observe_error(&policy, "usage_limit", now);
        state.observe_error(&policy, "usage_limit", now);
        assert!(state.is_active());
        assert!(!state.expire_if_due(&policy, now + Duration::from_secs(1_000_000)));
        assert!(state.is_active());
    }

    #[test]
    fn spawn_plan_primary_matches_config() {
        let config = test_config(policy());
        let plan = spawn_plan(&config, false);
        assert_eq!(plan.args, vec!["acp".to_string()]);
        assert_eq!(plan.env, vec![("EXISTING".to_string(), "orig".to_string())]);
        assert_eq!(plan.model.as_deref(), Some("primary-model"));
        assert!(!plan.failover);
    }

    #[test]
    fn spawn_plan_failover_appends_args_overrides_env_and_model() {
        let config = test_config(policy());
        let plan = spawn_plan(&config, true);
        assert_eq!(
            plan.args,
            vec![
                "acp".to_string(),
                "-c".to_string(),
                "model_provider=\"azure-foundry\"".to_string(),
            ]
        );
        assert_eq!(
            plan.env,
            vec![
                ("EXISTING".to_string(), "orig".to_string()),
                ("BUZZ_FAILOVER".to_string(), "1".to_string()),
            ]
        );
        assert_eq!(plan.model.as_deref(), Some("azure-model"));
        assert!(plan.failover);
    }

    #[test]
    fn spawn_plan_failover_env_overrides_duplicate_key() {
        let mut policy = policy();
        policy.env = vec![("EXISTING".into(), "overridden".into())];
        let config = test_config(policy);
        let plan = spawn_plan(&config, true);
        assert_eq!(
            plan.env,
            vec![("EXISTING".to_string(), "overridden".to_string())]
        );
    }

    /// End-to-end proof that a Codex failover switch produces a spawn env
    /// whose merged `CODEX_CONFIG` carries both the failover's own overrides
    /// (`model`, `model_provider`) and the network-access widening Buzz
    /// generates for every Codex spawn — even though `spawn_plan` replaces
    /// the persona-generated `CODEX_CONFIG` entry outright (same key,
    /// `MODEL_PROVIDER`/`CODEX_CONFIG` both come from the failover policy).
    /// `build_codex_config_env` forces `sandbox_workspace_write.network_access
    /// = true` unconditionally as its last merge step, so replacement (rather
    /// than appending a second `CODEX_CONFIG` entry) is sufficient here.
    #[test]
    fn spawn_plan_failover_env_produces_working_codex_config_merge() {
        let mut config = crate::config::test_support::minimal_config();
        config.agent_command = "codex-acp".into();
        config.agent_args = Vec::new();
        config.has_generated_codex_config = true;
        config.persona_env_vars = vec![(
            "CODEX_CONFIG".into(),
            r#"{"sandbox_workspace_write":{"network_access":true}}"#.into(),
        )];
        // Mirrors what `deploy/compose/agent-entrypoint.sh` builds: the
        // azure-foundry provider is defined inline via CODEX_CONFIG's own
        // `model_providers` map rather than a `~/.codex/config.toml` edit,
        // since production mounts that file read-only.
        config.failover = FailoverPolicy {
            agent_args: Vec::new(),
            env: vec![
                ("MODEL_PROVIDER".into(), "azure-foundry".into()),
                (
                    "CODEX_CONFIG".into(),
                    serde_json::json!({
                        "model": "hermes-gpt-5-5",
                        "model_provider": "azure-foundry",
                        "model_providers": {
                            "azure-foundry": {
                                "name": "Azure Foundry (failover)",
                                "base_url": "https://resource.openai.azure.com/openai/v1",
                                "env_key": "AZURE_FOUNDRY_API_KEY",
                                "wire_api": "responses",
                            }
                        }
                    })
                    .to_string(),
                ),
            ],
            model: None,
            triggers: vec!["usage_limit".into()],
            threshold: 1,
            cooldown: None,
        };

        let plan = spawn_plan(&config, true);
        assert!(
            plan.env
                .iter()
                .any(|(k, v)| k == "MODEL_PROVIDER" && v == "azure-foundry"),
            "MODEL_PROVIDER must reach the spawn env: {:?}",
            plan.env
        );

        let merged = crate::acp::build_codex_config_env(&plan.env, None, true)
            .expect("build_codex_config_env should not error")
            .expect("has_generated_codex_config=true must produce a merged CODEX_CONFIG");
        let merged: serde_json::Value =
            serde_json::from_str(&merged).expect("merged CODEX_CONFIG is valid JSON");

        assert_eq!(merged["model"], "hermes-gpt-5-5");
        assert_eq!(merged["model_provider"], "azure-foundry");
        assert_eq!(
            merged["sandbox_workspace_write"]["network_access"],
            serde_json::Value::Bool(true)
        );
        // The nested provider definition must survive the merge unchanged —
        // this is what lets Codex load the provider without a config.toml edit.
        let provider = &merged["model_providers"]["azure-foundry"];
        assert_eq!(
            provider["base_url"],
            "https://resource.openai.azure.com/openai/v1"
        );
        assert_eq!(provider["env_key"], "AZURE_FOUNDRY_API_KEY");
        assert_eq!(provider["wire_api"], "responses");
    }
}
