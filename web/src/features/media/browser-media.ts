import { makeBlossomGetAuthHeader } from "@/shared/lib/blossom-auth";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import {
  type MediaDescriptor,
  isSafeRelayMediaUrl,
  mediaType,
  sanitizeMediaFilename,
  validateMediaFile,
} from "./media-policy";

export type UploadProgress = (percent: number) => void;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Hash raw bytes before upload so the BUD-11 auth and request header bind them. */
export async function sha256File(file: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot securely hash attachments.");
  }
  return toHex(
    await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
  );
}

async function makeBlossomUploadAuthHeader(sha256: string): Promise<string> {
  const relay = new URL(relayHttpBaseUrl());
  const now = Math.floor(Date.now() / 1000);
  const event = await signNostrEvent(
    {
      kind: 24242,
      content: "Upload Buzz media",
      created_at: now,
      tags: [
        ["t", "upload"],
        ["x", sha256],
        ["server", relay.host],
        ["expiration", String(now + 300)],
      ],
    },
    { requireNip07: true },
  );
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

function mediaDescriptor(response: unknown, filename: string): MediaDescriptor {
  if (!response || typeof response !== "object") {
    throw new Error("The media service returned an invalid upload response.");
  }
  const value = response as Record<string, unknown>;
  if (
    typeof value.url !== "string" ||
    typeof value.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.sha256) ||
    typeof value.type !== "string" ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    typeof value.uploaded !== "number"
  ) {
    throw new Error(
      "The media service returned incomplete attachment metadata.",
    );
  }
  const safeFilename = sanitizeMediaFilename(filename);
  return {
    url: value.url,
    sha256: value.sha256,
    type: value.type.toLowerCase(),
    size: value.size,
    uploaded: value.uploaded,
    ...(typeof value.dim === "string" ? { dim: value.dim } : {}),
    ...(typeof value.blurhash === "string" ? { blurhash: value.blurhash } : {}),
    ...(typeof value.thumb === "string" ? { thumb: value.thumb } : {}),
    ...(typeof value.duration === "number" ? { duration: value.duration } : {}),
    ...(safeFilename ? { filename: safeFilename } : {}),
  };
}

function xhrUpload(
  file: File,
  authorization: string,
  sha256: string,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    request.open("PUT", `${relayHttpBaseUrl()}/upload`);
    request.responseType = "json";
    request.setRequestHeader("Authorization", authorization);
    request.setRequestHeader("X-SHA-256", sha256);
    request.setRequestHeader("Content-Type", mediaType(file));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => reject(new Error("The attachment upload failed."));
    request.onabort = () =>
      reject(new DOMException("Upload cancelled", "AbortError"));
    request.onload = () => {
      signal?.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300) {
        resolve(request.response);
        return;
      }
      const detail =
        typeof request.response === "object" &&
        request.response &&
        "message" in request.response &&
        typeof request.response.message === "string"
          ? request.response.message
          : "The media service rejected this attachment.";
      reject(new Error(detail));
    };
    request.send(file);
  });
}

/** Upload a browser File over the existing BUD-02 endpoint with byte progress. */
export async function uploadBrowserMedia(
  file: File,
  options: { onProgress?: UploadProgress; signal?: AbortSignal } = {},
): Promise<MediaDescriptor> {
  const validation = validateMediaFile(file);
  if (validation) throw new Error(validation);
  const sha256 = await sha256File(file);
  const authorization = await makeBlossomUploadAuthHeader(sha256);
  const response = await xhrUpload(
    file,
    authorization,
    sha256,
    options.onProgress,
    options.signal,
  );
  const descriptor = mediaDescriptor(response, file.name);
  if (
    descriptor.sha256 !== sha256 ||
    !isSafeRelayMediaUrl(descriptor.url, relayHttpBaseUrl())
  ) {
    throw new Error("The media service returned an untrusted attachment URL.");
  }
  return descriptor;
}

/** Fetch a protected relay blob without exposing its signed auth to other origins. */
export async function fetchProtectedMedia(url: string): Promise<Blob> {
  const relayBase = relayHttpBaseUrl();
  if (!isSafeRelayMediaUrl(url, relayBase)) {
    throw new Error("This attachment is not hosted by the current relay.");
  }
  const authorization = await makeBlossomGetAuthHeader(url, {
    requireDurableSigner: true,
  });
  const response = await fetch(url, {
    headers: { Authorization: authorization },
  });
  if (!response.ok) throw new Error("The attachment could not be retrieved.");
  return response.blob();
}

/** Download through an authenticated in-memory blob URL, then promptly revoke it. */
export async function downloadProtectedMedia(
  url: string,
  filename: string,
): Promise<void> {
  const blob = await fetchProtectedMedia(url);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = sanitizeMediaFilename(filename) ?? "attachment";
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

/** Read pasteboard file representations only after an explicit user gesture. */
export async function readClipboardMediaFiles(): Promise<File[]> {
  if (!navigator.clipboard?.read) {
    throw new Error("Pasting files from the clipboard is not available here.");
  }
  const clipboardItems = await navigator.clipboard.read();
  const files: File[] = [];
  for (const item of clipboardItems) {
    for (const type of item.types) {
      if (!type.startsWith("image/") && type !== "video/mp4") continue;
      const blob = await item.getType(type);
      const extension = type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
      files.push(
        new File([blob], `Pasted ${files.length + 1}.${extension}`, { type }),
      );
    }
  }
  return files;
}
