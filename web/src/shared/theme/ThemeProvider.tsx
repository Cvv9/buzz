import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CommunityAppearance } from "./community-theme";
import {
  DESKTOP_THEME_VARIABLE_NAMES,
  desktopThemeIsDark,
  desktopThemePalette,
  resolveCommunityThemeName,
} from "./desktop-theme";

export type { CommunityAppearance } from "./community-theme";

type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
  /** Legacy three-state control retained for the compact theme toggle. */
  theme: Theme;
  /** Selected desktop-compatible theme name, before follow-system resolution. */
  selectedThemeName: string;
  isDark: boolean;
  appearance: CommunityAppearance;
  setTheme: (theme: Theme) => void;
  applyAppearance: (appearance: CommunityAppearance) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const DEFAULT_COMMUNITY_APPEARANCE: CommunityAppearance = {
  version: 1,
  theme: "buzz",
  accent: "#3b82f6",
  followSystem: true,
};

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function isBuzzTheme(theme: string): boolean {
  return theme === "buzz" || theme === "buzz-dark";
}

function themeIsDark(themeName: string): boolean {
  return desktopThemeIsDark(themeName);
}

function toLegacyTheme(appearance: CommunityAppearance): Theme {
  if (appearance.followSystem) return "system";
  return themeIsDark(appearance.theme) ? "dark" : "light";
}

function hexToHsl(hex: string): string | null {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return null;
  const [red, green, blue] = match
    .slice(1)
    .map((part) => Number.parseInt(part, 16) / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return `0 0% ${(lightness * 100).toFixed(1)}%`;
  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return `${((hue * 60) % 360).toFixed(1)} ${(saturation * 100).toFixed(2)}% ${(lightness * 100).toFixed(1)}%`;
}

function contrastForeground(hex: string): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return "#ffffff";
  const [red, green, blue] = match
    .slice(1)
    .map((part) => Number.parseInt(part, 16));
  return (red * 0.299 + green * 0.587 + blue * 0.114) / 255 > 0.5
    ? "#000000"
    : "#ffffff";
}

function applyAccent(
  root: HTMLElement,
  accent: string,
  vars: Record<string, string>,
  useNeutralAccent: boolean,
) {
  const foreground = vars["--foreground"];
  const background = vars["--background"];
  if (useNeutralAccent || accent === "neutral") {
    root.style.setProperty("--primary", foreground);
    root.style.setProperty("--primary-foreground", background);
    root.style.setProperty("--sidebar-primary", foreground);
    root.style.setProperty("--sidebar-primary-foreground", background);
    return;
  }

  const accentHsl = hexToHsl(accent) ?? hexToHsl("#3b82f6");
  const foregroundHsl = hexToHsl(contrastForeground(accent)) ?? background;
  root.style.setProperty("--primary", accentHsl);
  root.style.setProperty("--primary-foreground", foregroundHsl);
  root.style.setProperty("--sidebar-primary", accentHsl);
  root.style.setProperty("--sidebar-primary-foreground", foregroundHsl);
}

function applyRootAppearance(themeName: string, accent: string) {
  const root = document.documentElement;
  const palette = desktopThemePalette(themeName);
  const isDark = palette.isDark;
  root.classList.remove("light", "dark");
  root.classList.add(isDark ? "dark" : "light");

  for (const name of DESKTOP_THEME_VARIABLE_NAMES) {
    const value = palette.vars[name];
    root.style.setProperty(name, value);
  }
  if (isBuzzTheme(themeName)) root.setAttribute("data-buzz-theme", themeName);
  else root.removeAttribute("data-buzz-theme");
  applyAccent(root, accent, palette.vars, isBuzzTheme(themeName));
  return isDark;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<CommunityAppearance>(
    DEFAULT_COMMUNITY_APPEARANCE,
  );
  const [systemDark, setSystemDark] = useState(getSystemDark);
  const themeName = resolveCommunityThemeName(appearance, systemDark);
  const isDark = themeIsDark(themeName);

  useEffect(() => {
    applyRootAppearance(themeName, appearance.accent);
  }, [appearance.accent, themeName]);

  useEffect(() => {
    if (!appearance.followSystem) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [appearance.followSystem]);

  const applyAppearance = useCallback((next: CommunityAppearance) => {
    setAppearance(next);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setAppearance((current) => {
      if (next === "system") return { ...current, followSystem: true };
      return {
        ...current,
        theme: next === "dark" ? "buzz-dark" : "buzz",
        followSystem: false,
      };
    });
  }, []);

  const value = useMemo(
    () => ({
      theme: toLegacyTheme(appearance),
      selectedThemeName: appearance.theme,
      isDark,
      appearance,
      setTheme,
      applyAppearance,
    }),
    [appearance, applyAppearance, isDark, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
