import { ImagePlus, SmilePlus, Trash2, Upload, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { uploadBrowserMedia } from "@/features/media/browser-media";
import type { CustomEmoji } from "../custom-emoji-policy";
import { normalizeEmojiShortcode } from "../custom-emoji-policy";
import { useOwnCustomEmojiSet } from "../custom-emoji-api";
import { CustomEmojiImage } from "./CustomEmojiImage";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

export function EmojiSetManager({ pubkey }: { pubkey: string }) {
  const { data: ownEmoji = [], isPending, save } = useOwnCustomEmojiSet(pubkey);
  const [shortcode, setShortcode] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(
    null,
  );
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const saveEmoji = () => {
    const normalized = normalizeEmojiShortcode(shortcode);
    if (!normalized) {
      toast.error(
        "Use letters, numbers, hyphens, or underscores for the emoji name.",
      );
      return;
    }
    save.mutate(
      [
        ...ownEmoji.filter((emoji) => emoji.shortcode !== normalized),
        { shortcode: normalized, url: url.trim() },
      ],
      {
        onSuccess: () => {
          setShortcode("");
          setUrl("");
          setUploadError(null);
        },
        onError: (error) => {
          toast.error("Custom emoji could not be saved", {
            description: error instanceof Error ? error.message : undefined,
          });
        },
      },
    );
  };
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-xs font-medium">Your emoji set</p>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5">
        <input
          aria-label="Custom emoji name"
          className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          maxLength={64}
          placeholder="party_parrot"
          value={shortcode}
          onChange={(event) => setShortcode(event.target.value)}
        />
        <input
          aria-label="Custom emoji image URL"
          className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="https://…/emoji.png"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button
          aria-label="Save custom emoji"
          disabled={
            !shortcode.trim() ||
            !url.trim() ||
            save.isPending ||
            uploadProgress !== null
          }
          size="icon"
          type="button"
          variant="outline"
          onClick={saveEmoji}
        >
          <ImagePlus />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-within:outline-none focus-within:ring-1 focus-within:ring-ring">
          <Upload className="size-3.5" />
          {uploadProgress === null
            ? "Upload an image from this device"
            : `Uploading ${uploadProgress}%`}
          <input
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="sr-only"
            disabled={uploadProgress !== null || save.isPending}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setUploadError(null);
              setUploadProgress(0);
              void uploadBrowserMedia(file, { onProgress: setUploadProgress })
                .then((media) => {
                  setUrl(media.url);
                  toast.success("Emoji image uploaded", {
                    description: "Choose a shortcode, then save the emoji.",
                  });
                })
                .catch((error) =>
                  setUploadError(
                    error instanceof Error
                      ? error.message
                      : "The emoji image could not be uploaded.",
                  ),
                )
                .finally(() => setUploadProgress(null));
            }}
          />
        </label>
        <span className="text-xs text-muted-foreground">
          Or paste a secure image URL above.
        </span>
      </div>
      {uploadError ? (
        <p className="mt-2 text-xs text-destructive">{uploadError}</p>
      ) : null}
      {isPending ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Loading your emoji…
        </p>
      ) : ownEmoji.length ? (
        <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto">
          {ownEmoji.map((emoji) => (
            <li className="flex items-center gap-2" key={emoji.shortcode}>
              <CustomEmojiImage emoji={emoji} className="size-4" />
              <span className="min-w-0 flex-1 truncate text-xs">
                :{emoji.shortcode}:
              </span>
              <button
                aria-label={`Remove :${emoji.shortcode}:`}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                disabled={save.isPending}
                type="button"
                onClick={() =>
                  save.mutate(
                    ownEmoji.filter(
                      (candidate) => candidate.shortcode !== emoji.shortcode,
                    ),
                    {
                      onError: (error) => {
                        toast.error("Custom emoji could not be removed", {
                          description:
                            error instanceof Error ? error.message : undefined,
                        });
                      },
                    },
                  )
                }
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Compact, keyboard-dismissible palette for inserting or reacting with NIP-30 emoji. */
export function CustomEmojiPickerButton({
  emoji,
  label,
  managePubkey,
  placement = "top",
  onSelect,
}: {
  emoji: readonly CustomEmoji[];
  label: string;
  managePubkey?: string;
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
        <SmilePlus className="size-3.5" />
      </Button>
      {open ? (
        <div
          aria-label={label}
          className={cn(
            "absolute right-0 z-30 w-72 rounded-xl border border-border bg-popover p-3 shadow-lg",
            placement === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
          role="dialog"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">Custom emoji</p>
            <button
              aria-label="Close custom emoji picker"
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
          {emoji.length ? (
            <div className="mt-2 grid max-h-44 grid-cols-6 gap-1 overflow-y-auto">
              {emoji.map((item) => (
                <button
                  aria-label={`Use :${item.shortcode}:`}
                  className="flex size-9 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  key={item.shortcode}
                  type="button"
                  onClick={() => {
                    onSelect(`:${item.shortcode}:`);
                    setOpen(false);
                  }}
                >
                  <CustomEmojiImage emoji={item} />
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              No custom emoji are available in this workspace yet.
            </p>
          )}
          {managePubkey ? <EmojiSetManager pubkey={managePubkey} /> : null}
        </div>
      ) : null}
    </div>
  );
}
