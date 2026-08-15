import { useEffect, useState } from "react";
import { makeBlossomGetAuthHeader } from "@/shared/lib/blossom-auth";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

// Media served from the relay's /media/ endpoint requires authorization, so a
// plain <img src> gets a 401 and renders as a broken image. Resolve those URLs
// through an authenticated fetch instead, once per URL for the whole tab. The
// object URLs stay alive for the session so every consumer (sidebar, message
// rows, mention popup, people list) shares one fetch per image.
const resolvedMediaUrls = new Map<string, Promise<string | null>>();

function isRelayMediaUrl(url: URL): boolean {
  if (!url.pathname.startsWith("/media/")) return false;
  if (url.origin === window.location.origin) return true;
  try {
    return url.origin === new URL(relayHttpBaseUrl()).origin;
  } catch {
    return false;
  }
}

function resolveRelayMediaUrl(href: string): Promise<string | null> {
  const pending = resolvedMediaUrls.get(href);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch(href, {
      headers: {
        Authorization: await makeBlossomGetAuthHeader(href, {
          requireDurableSigner: true,
        }),
      },
    });
    if (!response.ok) {
      throw new Error(`Relay media responded ${response.status}`);
    }
    return URL.createObjectURL(await response.blob());
  })().catch(() => {
    // Failures are not cached: a signer that unlocks later, or a transient
    // network error, should not permanently blank the avatar.
    resolvedMediaUrls.delete(href);
    return null;
  });
  resolvedMediaUrls.set(href, request);
  return request;
}

/**
 * Resolve a profile/emoji picture URL to something an <img> can display.
 * Non-relay URLs pass through untouched; relay `/media/` URLs are fetched
 * with authorization and served as cached object URLs.
 */
export function useAuthenticatedPicture(source?: string): string | undefined {
  const [resolved, setResolved] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setResolved(undefined);
    if (!source) return;
    let url: URL;
    try {
      url = new URL(source, window.location.origin);
    } catch {
      return;
    }
    if (!isRelayMediaUrl(url)) {
      setResolved(url.href);
      return;
    }
    void resolveRelayMediaUrl(url.href).then((objectUrl) => {
      if (!cancelled && objectUrl) setResolved(objectUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return resolved;
}
