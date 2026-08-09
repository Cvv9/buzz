import { isDesktopThemeName } from "./desktop-theme.ts";

export type CommunityAppearance = {
  version: 1;
  theme: string;
  accent: string;
  followSystem: boolean;
};

export const COMMUNITY_THEME_KIND = 30078;
export const COMMUNITY_THEME_D_TAG = "community-theme";

/** Kept in lockstep with desktop's selectable `ACCENT_COLORS` catalog. */
export const COMMUNITY_ACCENT_COLORS = [
  { name: "Neutral", value: "neutral" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Green", value: "#22c55e" },
  { name: "Orange", value: "#f97316" },
  { name: "Red", value: "#ef4444" },
  { name: "Pink", value: "#ec4899" },
  { name: "Lilac", value: "#c0a2f1" },
  { name: "Purple", value: "#a855f7" },
  { name: "Indigo", value: "#6366f1" },
] as const;

const COMMUNITY_ACCENT_VALUES = new Set<string>(
  COMMUNITY_ACCENT_COLORS.map(({ value }) => value),
);

export function isCommunityAccent(accent: string): boolean {
  return COMMUNITY_ACCENT_VALUES.has(accent);
}

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
    isDesktopThemeName(candidate.theme) &&
    typeof candidate.accent === "string" &&
    isCommunityAccent(candidate.accent) &&
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
