import { Download, FileText, LoaderCircle, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { downloadProtectedMedia, fetchProtectedMedia } from "../browser-media";
import {
  type ParsedMedia,
  isPreviewableMedia,
  isSafeRelayMediaUrl,
  parseImetaTags,
  sanitizeMediaFilename,
} from "../media-policy";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";

function attachmentName(media: ParsedMedia): string {
  return sanitizeMediaFilename(media.filename ?? "") ?? "attachment";
}

function useProtectedObjectUrl(media: ParsedMedia): {
  url: string | null;
  loading: boolean;
  failed: boolean;
} {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(isPreviewableMedia(media.type));
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!isPreviewableMedia(media.type)) {
      setUrl(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setLoading(true);
    setFailed(false);
    void fetchProtectedMedia(media.url)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!disposed) setUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.type, media.url]);

  return { url, loading, failed };
}

function MediaAttachment({
  media,
  onOpen,
}: {
  media: ParsedMedia;
  onOpen: (media: ParsedMedia, url: string, trigger: HTMLElement) => void;
}) {
  const { url, loading, failed } = useProtectedObjectUrl(media);
  const [downloading, setDownloading] = React.useState(false);
  const safe = isSafeRelayMediaUrl(media.url, relayHttpBaseUrl());
  const download = async () => {
    if (!safe || downloading) return;
    setDownloading(true);
    try {
      await downloadProtectedMedia(media.url, attachmentName(media));
    } catch (error) {
      toast.error("Attachment could not be downloaded", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDownloading(false);
    }
  };

  if (!safe) {
    return (
      <p className="text-xs text-muted-foreground">
        An attachment from an untrusted media host was not displayed.
      </p>
    );
  }

  if (media.type.startsWith("image/") && url) {
    return (
      <button
        aria-label={`Open ${attachmentName(media)}`}
        className="block max-w-full overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={(event) => onOpen(media, url, event.currentTarget)}
      >
        <img
          alt={attachmentName(media)}
          className="max-h-80 max-w-full rounded-md object-contain"
          src={url}
        />
      </button>
    );
  }
  if (media.type === "video/mp4" && url) {
    return (
      <video className="max-h-96 max-w-full rounded-md" controls src={url}>
        <track kind="captions" label="No captions available" />
      </video>
    );
  }
  if (loading) {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <LoaderCircle className="size-3 animate-spin" /> Loading attachment…
      </p>
    );
  }
  return (
    <div className="flex max-w-sm items-center gap-2 rounded-md bg-muted px-3 py-2">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">
        {attachmentName(media)}
      </span>
      <Button
        aria-label={`Download ${attachmentName(media)}`}
        disabled={downloading}
        size="sm"
        type="button"
        variant="ghost"
        onClick={download}
      >
        <Download />
        {failed ? "Download" : downloading ? "Preparing" : "Download"}
      </Button>
    </div>
  );
}

/** Authenticated image/video/file surface for NIP-92 imeta message tags. */
export function WorkspaceMediaGallery({ tags }: { tags: string[][] }) {
  const media = React.useMemo(() => parseImetaTags(tags), [tags]);
  const [lightbox, setLightbox] = React.useState<{
    media: ParsedMedia;
    url: string;
    returnFocus: HTMLElement;
  } | null>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!lightbox) return;
    closeButtonRef.current?.focus();
    const trigger = lightbox.returnFocus;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      trigger.focus();
    };
  }, [lightbox]);

  if (media.length === 0) return null;
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {media.map((attachment) => (
          <MediaAttachment
            key={`${attachment.sha256}:${attachment.url}`}
            media={attachment}
            onOpen={(openedMedia, url, returnFocus) =>
              setLightbox({ media: openedMedia, url, returnFocus })
            }
          />
        ))}
      </div>
      {lightbox ? (
        <div
          aria-label={`Preview ${attachmentName(lightbox.media)}`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 p-6"
          role="dialog"
        >
          <img
            alt={attachmentName(lightbox.media)}
            className="max-h-full max-w-full rounded-md object-contain"
            src={lightbox.url}
          />
          <button
            aria-label="Close preview"
            className="absolute right-4 top-4 rounded-md bg-background/90 p-2 text-foreground hover:bg-background"
            ref={closeButtonRef}
            type="button"
            onClick={() => setLightbox(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
    </>
  );
}
