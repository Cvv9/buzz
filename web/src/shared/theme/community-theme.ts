export type CommunityAppearance = {
  version: 1;
  theme: string;
  accent: string;
  followSystem: boolean;
};

export const COMMUNITY_THEME_KIND = 30078;
export const COMMUNITY_THEME_D_TAG = "community-theme";

export function isCommunityAppearance(
  value: unknown,
): value is CommunityAppearance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.theme === "string" &&
    candidate.theme.length > 0 &&
    typeof candidate.accent === "string" &&
    (candidate.accent === "neutral" ||
      /^#[0-9a-f]{6}$/i.test(candidate.accent)) &&
    typeof candidate.followSystem === "boolean"
  );
}

/** Prefer the newest NIP-78 state; break timestamp ties by event id. */
export function isNewerCommunityThemeCoordinate(
  candidate: { createdAt: number; eventId: string },
  current: { createdAt: number; eventId: string },
): boolean {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt &&
      (current.eventId === "" || candidate.eventId < current.eventId))
  );
}
