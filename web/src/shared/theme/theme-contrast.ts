function luminance(hsl: string): number {
  const [hue, saturation, lightness] = hsl.split(/\s+/).map(Number.parseFloat);
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function readableText(text: string, surfaces: string[], dark: boolean): string {
  const backgrounds = surfaces.map(luminance);
  const passes = (candidate: string) => {
    const foreground = luminance(candidate);
    return backgrounds.every(
      (background) =>
        (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05) >=
        4.65,
    );
  };
  if (passes(text)) return text;
  const [hue, saturation, lightness] = text.split(/\s+/).map(Number.parseFloat);
  // Preserve the theme's hue and saturation; adjust only unreadable text.
  for (let step = 1; step <= 100; step++) {
    const next = lightness + ((dark ? 100 : 0) - lightness) * (step / 100);
    const candidate = `${hue} ${saturation}% ${next.toFixed(2)}%`;
    if (passes(candidate)) return candidate;
  }
  return dark ? "0 0% 100%" : "0 0% 0%";
}

/** Keep shared theme backgrounds while enforcing readable browser UI text. */
export function readableThemeVariables(
  source: Record<string, string>,
  dark: boolean,
): Record<string, string> {
  const vars = { ...source };
  const surfaces = [
    "background",
    "card",
    "popover",
    "muted",
    "accent",
    "secondary",
  ].map((name) => source[`--${name}`]);
  for (const name of [
    "foreground",
    "card-foreground",
    "popover-foreground",
    "muted-foreground",
    "accent-foreground",
    "secondary-foreground",
  ]) {
    vars[`--${name}`] = readableText(source[`--${name}`], surfaces, dark);
  }
  const sidebar = [source["--sidebar-background"], source["--sidebar-accent"]];
  for (const name of ["--sidebar-foreground", "--sidebar-accent-foreground"]) {
    vars[name] = readableText(source[name], sidebar, dark);
  }
  return vars;
}
