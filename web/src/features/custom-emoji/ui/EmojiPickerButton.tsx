import { Smile, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

// Keep the emoji dataset and search index off the startup path.
const EmojiPalette = React.lazy(() => import("./EmojiPalette"));

/**
 * Full Unicode emoji palette for composing and reacting. Custom workspace
 * emoji keep their own picker, which resolves relay-hosted images through an
 * authorized fetch that emoji-mart's plain <img> rendering cannot perform.
 */
export function EmojiPickerButton({
  label,
  placement = "top",
  onSelect,
}: {
  label: string;
  placement?: "top" | "bottom";
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [open]);

  return (
    <div className="relative">
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        ref={triggerRef}
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => setOpen((current) => !current)}
      >
        <Smile className="size-3.5" />
      </Button>
      {open ? (
        <div
          aria-label={label}
          className={cn(
            "absolute right-0 z-30 rounded-xl border border-border bg-popover shadow-lg",
            placement === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
          role="dialog"
        >
          <div className="flex items-center justify-end px-2 pt-1">
            <button
              aria-label="Close emoji picker"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <X className="size-3.5" />
            </button>
          </div>
          <React.Suspense
            fallback={
              <p className="p-4 text-sm text-muted-foreground" role="status">
                Loading emoji…
              </p>
            }
          >
            <EmojiPalette
              onSelect={(value) => {
                onSelect(value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            />
          </React.Suspense>
        </div>
      ) : null}
    </div>
  );
}
