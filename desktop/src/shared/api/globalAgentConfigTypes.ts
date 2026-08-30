/**
 * Global agent configuration defaults applied to all local agents.
 *
 * Lowest user-settable layer — per-agent and persona values win on any key
 * collision. Mirrors the Rust `GlobalAgentConfig` struct.
 */
export type GlobalAgentConfig = {
  env_vars: Record<string, string>;
  provider: string | null;
  model: string | null;
  preferred_runtime: string | null;
};

/** Result returned by `set_global_agent_config`. */
export type GlobalAgentConfigSaveResult = {
  config: GlobalAgentConfig;
  restarted_count: number;
  failed_restart_count: number;
};
