import { FileText, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { ComposerAttachment } from "../useComposerAttachments";
import { mediaType } from "../media-policy";

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ComposerAttachments({
  attachments,
  onRemove,
  onRetry,
}: {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
      {attachments.map((attachment) => {
        const type = mediaType(attachment.file);
        return (
          <div
            className="relative flex min-w-40 max-w-56 items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground"
            key={attachment.id}
          >
            {attachment.previewUrl && type.startsWith("image/") ? (
              <img
                alt=""
                className="size-9 rounded object-cover"
                src={attachment.previewUrl}
              />
            ) : attachment.previewUrl && type === "video/mp4" ? (
              <video
                className="size-9 rounded object-cover"
                muted
                preload="metadata"
                src={attachment.previewUrl}
              />
            ) : (
              <FileText className="size-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">
                {attachment.file.name}
              </p>
              {attachment.status === "uploading" ? (
                <p className="flex items-center gap-1">
                  <LoaderCircle className="size-3 animate-spin" />
                  Uploading
                  {attachment.progress ? ` ${attachment.progress}%` : "…"}
                </p>
              ) : attachment.status === "error" ? (
                <p className="truncate text-destructive">{attachment.error}</p>
              ) : (
                <p>{fileSize(attachment.file.size)} · ready</p>
              )}
            </div>
            {attachment.status === "error" ? (
              <button
                aria-label={`Retry ${attachment.file.name}`}
                className="rounded p-1 hover:bg-accent hover:text-accent-foreground"
                type="button"
                onClick={() => onRetry(attachment.id)}
              >
                <RotateCcw className="size-3.5" />
              </button>
            ) : null}
            <button
              aria-label={`Remove ${attachment.file.name}`}
              className="rounded p-1 hover:bg-accent hover:text-accent-foreground"
              type="button"
              onClick={() => onRemove(attachment.id)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
