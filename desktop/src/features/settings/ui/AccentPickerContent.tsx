import { Check } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { ACCENT_COLORS, NEUTRAL_ACCENT } from "@/shared/theme/ThemeProvider";

/** Accent swatch grid shared by animated and reduced-motion reveal paths. */
export function AccentPickerContent({
  accentColor,
  isDark,
  setAccentColor,
}: {
  accentColor: string;
  isDark: boolean;
  setAccentColor: (value: string) => void;
}) {
  return (
    <div className="shrink-0 px-1 pb-2 pt-1">
      <h3 className="mb-2 text-sm font-medium">Accent color</h3>
      <div className="flex flex-wrap gap-2 p-1">
        {ACCENT_COLORS.map((color) => {
          const isNeutral = color.value === NEUTRAL_ACCENT;
          const swatchColor = isNeutral
            ? "hsl(var(--foreground))"
            : color.value;
          const checkClassName =
            isNeutral && isDark ? "text-black" : "text-white";

          return (
            <button
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border border-border/50 transition-transform hover:scale-110",
                accentColor === color.value &&
                  "ring-2 ring-ring ring-offset-2 ring-offset-background",
              )}
              data-testid={`accent-color-${color.name.toLowerCase()}`}
              key={color.value}
              onClick={() => setAccentColor(color.value)}
              style={{ backgroundColor: swatchColor }}
              title={color.name}
              type="button"
            >
              {accentColor === color.value && (
                <Check className={cn("h-4 w-4", checkClassName)} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
