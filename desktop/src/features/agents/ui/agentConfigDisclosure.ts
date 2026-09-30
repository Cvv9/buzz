/** Presentation policy for the global agent config field group. */
export type AgentConfigDisclosure =
  | "full"
  | "onboarding-essential"
  | "progressive-defaults";

// Canonical behaviors (formerly per-surface props; onboarding's values won
// every call and are now the only behavior). Design principle #4: require a
// provider before model/effort are editable; preserve credential env vars
// across provider switches; auto-select model on provider change.
export const autoSelectModelOnProviderChange = true;
export const disableModelSelectDuringDiscovery = false;
export const preserveCredentialEnvVarsOnProviderChange = true;
export const requireProviderForModelAndEffort = true;

/** The canonical behavior contract, exported for the contract test. */
export const CANONICAL_CONFIG_BEHAVIORS = {
  autoSelectModelOnProviderChange,
  disableModelSelectDuringDiscovery,
  preserveCredentialEnvVarsOnProviderChange,
  requireProviderForModelAndEffort,
} as const;

/** Disclosure preset → the eight visibility decisions it owns. */
export function resolveDisclosure(disclosure: AgentConfigDisclosure) {
  const full = disclosure !== "onboarding-essential";
  return {
    showAdvancedFields: full,
    showCustomModelOption: full,
    showCustomProviderOption: full,
    showDescriptions: full,
    showEffortField: true,
    showProviderPlaceholderOption: full,
    showRequiredIndicators: full,
    showUnavailableEffortOptions: full,
  } as const;
}

export function shouldRevealDependentConfigFields({
  disclosure,
  providerFieldVisible,
  providerValue,
}: {
  disclosure: AgentConfigDisclosure;
  providerFieldVisible: boolean;
  providerValue: string;
}): boolean {
  return (
    disclosure !== "progressive-defaults" ||
    !providerFieldVisible ||
    providerValue.trim().length > 0
  );
}

/** Discovery warnings bypass onboarding-essential so first-run failures remain visible. */
export function shouldShowModelStatusMessage(
  showDescriptions: boolean,
  status: { message: string; tone: string } | null,
): boolean {
  return showDescriptions || status !== null;
}

/** Optional harnesses omit Model only while discovery is loading or confirmed empty. */
export function shouldRenderModelControl({
  discoveredModelOptions,
  modelDiscoveryLoading,
  modelDiscoverySuccessfulEmpty,
  modelIsOptional,
  showCustomModelOption,
}: {
  discoveredModelOptions: readonly { id: string }[] | null;
  modelDiscoveryLoading: boolean;
  modelDiscoverySuccessfulEmpty: boolean;
  modelIsOptional: boolean;
  showCustomModelOption: boolean;
}): boolean {
  if (!modelIsOptional) return true;
  if (modelDiscoveryLoading) return false;
  const hasExplicitModel = (discoveredModelOptions ?? []).some(
    (option) => option.id.trim().length > 0,
  );
  if (hasExplicitModel) return true;
  if (showCustomModelOption) return true;
  return !modelDiscoverySuccessfulEmpty;
}
