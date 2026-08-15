import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { init } from "emoji-mart";
import { Smile, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

// emoji-mart builds its searchable index synchronously inside `init`, which
// `<Picker>` calls on mount. Warm the index once at idle so the first popover
// open does not pay the full ~1.8k-emoji build; `init` is a no-op afterwards.
let warmStarted = false;
function warmEmojiIndex() {
  if (warmStarted) return;
  warmStarted = true;
  const warm = () => void init({ data });
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(warm, { timeout: 1_500 });
  } else {
    globalThis.setTimeout(warm, 250);
  }
}
warmEmojiIndex();

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
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
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
          <Picker
            autoFocus
            data={data}
            maxFrequentRows={2}
            onEmojiSelect={(emoji: { native?: string }) => {
              if (emoji.native) {
                onSelect(emoji.native);
                setOpen(false);
                triggerRef.current?.focus();
              }
            }}
            perLine={8}
            previewPosition="none"
            set="native"
            skinTonePosition="search"
            theme="auto"
          />
        </div>
      ) : null}
    </div>
  );
}
