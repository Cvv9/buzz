import type { CommunityAppearance } from "./community-theme.ts";
import {
  DESKTOP_THEME_CATALOG,
  type DesktopThemePalette,
} from "./generated-desktop-theme-catalog.ts";

export function canonicalDesktopThemeName(theme: string): string {
  return DESKTOP_THEME_CATALOG[theme] ? theme : "buzz";
}

export type DesktopAppearanceMode = "system" | "light" | "dark";

export const DESKTOP_THEME_NAMES = Object.freeze(
  Object.keys(DESKTOP_THEME_CATALOG),
);

export function isDesktopThemeName(theme: string): boolean {
  return theme in DESKTOP_THEME_CATALOG;
}

export function desktopThemePalette(theme: string): DesktopThemePalette {
  return DESKTOP_THEME_CATALOG[canonicalDesktopThemeName(theme)];
}

/** Mirrors desktop's `resolveSystemTheme` for the shared preference. */
export function resolveCommunityThemeName(
  appearance: CommunityAppearance,
  systemDark: boolean,
): string {
  const selectedTheme = canonicalDesktopThemeName(appearance.theme);
  const selectedPalette = DESKTOP_THEME_CATALOG[selectedTheme];
  if (!appearance.followSystem || selectedPalette.isDark === systemDark) {
    return selectedTheme;
  }
  return selectedPalette.pairedTheme ?? selectedTheme;
}

export function desktopThemeIsDark(theme: string): boolean {
  return desktopThemePalette(theme).isDark;
}

export function desktopThemePair(theme: string): string | null {
  return desktopThemePalette(theme).pairedTheme;
}

/**
 * Returns the same selectable set as desktop's appearance panel. System mode
 * exposes one representative (the light member) for each switchable pair.
 */
export function desktopThemesForMode(mode: DesktopAppearanceMode): string[] {
  return DESKTOP_THEME_NAMES.filter((theme) => {
    const palette = desktopThemePalette(theme);
    if (mode === "light") return !palette.isDark;
    if (mode === "dark") return palette.isDark;
    return !palette.isDark && palette.pairedTheme !== null;
  });
}

/**
 * Pick a valid catalog member when the user changes appearance mode. This
 * mirrors desktop: retain the current paired family when possible, otherwise
 * fall back to the first catalog theme that can satisfy the requested mode.
 */
export function desktopThemeForMode(
  theme: string,
  mode: DesktopAppearanceMode,
): string {
  const selected = canonicalDesktopThemeName(theme);
  const palette = desktopThemePalette(selected);
  if (mode === "system") {
    if (palette.pairedTheme) {
      return palette.isDark ? palette.pairedTheme : selected;
    }
  } else if (palette.isDark === (mode === "dark")) {
    return selected;
  } else if (palette.pairedTheme) {
    return palette.pairedTheme;
  }

  return desktopThemesForMode(mode)[0] ?? "buzz";
}

export function formatDesktopThemeLabel(theme: string): string {
  return canonicalDesktopThemeName(theme)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Present a paired light/dark catalog entry as one system-switchable family. */
export function formatDesktopThemeFamilyLabel(theme: string): string {
  const modeTokens = new Set([
    "light",
    "latte",
    "dawn",
    "lotus",
    "ochin",
    "lighter",
    "plus",
  ]);
  const canonical = canonicalDesktopThemeName(theme);
  const family = canonical
    .split("-")
    .filter((part) => !modeTokens.has(part))
    .join("-");
  return formatDesktopThemeLabel(family || canonical);
}

export function isBuzzDesktopTheme(theme: string): boolean {
  return theme === "buzz" || theme === "buzz-dark";
}

export const DESKTOP_THEME_VARIABLE_NAMES = Object.keys(
  DESKTOP_THEME_CATALOG.buzz.vars,
);
