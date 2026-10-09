/** Shared web presentation and runtime profile fields. */
export type WorkspaceProfile = {
  pubkey: string;
  name: string;
  aliases?: string[];
  picture?: string;
  avatarConfigured?: boolean;
  about?: string;
  isAgent?: boolean;
  isIntegration?: boolean;
  audience?: "community" | "owner";
  ownerPubkey?: string;
  accessTier?: "shared" | "personal" | "admin";
  model?: string;
  models?: import("./workspace-agent-models").WorkspaceAgentModel[];
  modelFamilies?: import("./workspace-agent-models").WorkspaceAgentModelFamily[];
  runtime?: import("./workspace-agent-runtime").WorkspaceAgentRuntimeProjection;
  runtimeCatalogDigest?: string;
  runtimeControllerPubkey?: string;
  runtimeStatusTrusted?: boolean;
  legacyHostedConfigModel?: string | null;
  resources?: string[];
};
