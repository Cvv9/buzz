import * as React from "react";
import type { CustomEmoji } from "../custom-emoji-policy";
import { fetchProtectedMedia } from "@/features/media/browser-media";
import { isSafeRelayMediaUrl } from "@/features/media/media-policy";
import { cn } from "@/shared/lib/cn";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

function useCustomEmojiSource(url: string) {
  const relayMedia = isSafeRelayMediaUrl(url, relayHttpBaseUrl());
  const [source, setSource] = React.useState(relayMedia ? null : url);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!relayMedia) {
      setSource(url);
      setFailed(false);
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    setSource(null);
    setFailed(false);
    void fetchProtectedMedia(url)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!disposed) setSource(objectUrl);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [relayMedia, url]);

  return { failed, source };
}

/** Safe custom-emoji presentation, including authenticated current-relay media. */
export function CustomEmojiImage({
  emoji,
  className,
}: {
  emoji: CustomEmoji;
  className?: string;
}) {
  const { source, failed } = useCustomEmojiSource(emoji.url);
  const label = `:${emoji.shortcode}:`;
  if (!source || failed) {
    return <span>{label}</span>;
  }
  return (
    <img
      alt={label}
      className={cn(
        "inline-block size-5 object-contain align-text-bottom",
        className,
      )}
      draggable={false}
      referrerPolicy="no-referrer"
      src={source}
    />
  );
}
