import type { CommunityAppearance } from "./community-theme";
import {
  DESKTOP_THEME_CATALOG,
  type DesktopThemePalette,
} from "./generated-desktop-theme-catalog.ts";

export function canonicalDesktopThemeName(theme: string): string {
  return DESKTOP_THEME_CATALOG[theme] ? theme : "buzz";
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

export const DESKTOP_THEME_VARIABLE_NAMES = Object.keys(
  DESKTOP_THEME_CATALOG.buzz.vars,
);
