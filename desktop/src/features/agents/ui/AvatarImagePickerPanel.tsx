import { Link2, UploadCloud } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { AVATAR_APPLY_MOTION_TRANSITION } from "./AgentCreationPreview.utils";
import { Button } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";

type AvatarImagePickerPanelProps = {
  assetLabel: string;
  disabled: boolean;
  hasAvatar: boolean;
  isUploading: boolean;
  onApplyUrl: () => void;
  onClearAvatar?: () => void;
  onClearUploadError: () => void;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onOpenUploadPicker: () => void;
  onRemoveAvatar: () => void;
  reduceMotion: boolean | null;
  uploadErrorMessage: string | null;
  urlDraft: string;
};

export function AvatarImagePickerPanel({
  assetLabel,
  disabled,
  hasAvatar,
  isUploading,
  onApplyUrl,
  onClearAvatar,
  onClearUploadError,
  onClose,
  onDraftChange,
  onOpenUploadPicker,
  onRemoveAvatar,
  reduceMotion,
  uploadErrorMessage,
  urlDraft,
}: AvatarImagePickerPanelProps) {
  return (
    <div className="grid gap-2.5">
      <button
        className="relative flex h-[80px] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-transparent bg-muted text-foreground transition-[background-color,border-color,box-shadow,color] duration-200 ease-out hover:bg-muted/80 disabled:opacity-60"
        disabled={disabled || isUploading}
        onClick={() => {
          onClearUploadError();
          onOpenUploadPicker();
        }}
        type="button"
      >
        {isUploading ? (
          <Spinner
            aria-hidden
            className="h-5 w-5 border-2 text-muted-foreground"
          />
        ) : (
          <UploadCloud className="h-5 w-5 text-muted-foreground" />
        )}
        <span className="text-xs font-medium text-muted-foreground">
          {isUploading ? "Uploading..." : "Drop or browse"}
        </span>
      </button>

      <div className="flex h-10 items-center gap-2.5 rounded-lg bg-muted px-3">
        <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <input
          autoCapitalize="none"
          autoCorrect="off"
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
          disabled={disabled || isUploading}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onApplyUrl();
            }
          }}
          placeholder="Paste a URL"
          spellCheck={false}
          type="url"
          value={urlDraft}
        />
        <AnimatePresence initial={false}>
          {urlDraft.trim().length > 0 ? (
            <motion.div
              animate={{ opacity: 1, scale: 1, width: "auto" }}
              className="overflow-hidden"
              exit={{ opacity: 0, scale: 0.96, width: 0 }}
              initial={{ opacity: 0, scale: 0.96, width: 0 }}
              key="apply-url"
              transition={
                reduceMotion ? { duration: 0 } : AVATAR_APPLY_MOTION_TRANSITION
              }
            >
              <Button
                className="h-6 px-2 text-2xs"
                disabled={disabled || isUploading}
                onClick={onApplyUrl}
                size="xs"
                type="button"
              >
                Apply
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {uploadErrorMessage ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {uploadErrorMessage}
        </p>
      ) : null}

      {hasAvatar && onClearAvatar ? (
        <button
          className="flex min-h-8 w-full items-center justify-center rounded-lg text-xs text-destructive outline-hidden transition-colors duration-150 ease-out hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled || isUploading}
          onClick={() => {
            onRemoveAvatar();
            onClose();
          }}
          type="button"
        >
          Remove {assetLabel}
        </button>
      ) : null}
    </div>
  );
}
