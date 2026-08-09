/** Browser-side limits mirror the relay defaults and fail before any upload. */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
/** Bound DOM work and protected fetches for an untrusted relay event. */
export const MAX_RENDERED_MEDIA_ATTACHMENTS = 20;

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const ACTIVE_FILE_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/html",
  "text/javascript",
]);

const MEDIA_PATH = /^\/media\/([0-9a-f]{64})(?:\.[a-z0-9]+)+$/i;

export type MediaFile = {
  name: string;
  size: number;
  type: string;
};

export type MediaDescriptor = {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
  dim?: string;
  blurhash?: string;
  thumb?: string;
  duration?: number;
  filename?: string;
};

export type ParsedMedia = Omit<MediaDescriptor, "uploaded">;

export function mediaType(file: Pick<MediaFile, "type">): string {
  return file.type.trim().toLowerCase() || "application/octet-stream";
}

export function isPreviewableMedia(type: string): boolean {
  return IMAGE_TYPES.has(type) || type === "video/mp4";
}

export function validateMediaFile(file: MediaFile): string | null {
  const type = mediaType(file);
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "Empty files cannot be attached.";
  }
  if (!sanitizeMediaFilename(file.name)) {
    return "This file name is not safe to attach.";
  }
  if (ACTIVE_FILE_TYPES.has(type)) {
    return "SVG, HTML, and script files cannot be attached.";
  }
  if (type.startsWith("video/") && type !== "video/mp4") {
    return "Only MP4 video attachments are supported in the browser.";
  }
  if (type.startsWith("audio/")) {
    return "Audio attachments are not yet supported in the browser.";
  }
  if (IMAGE_TYPES.has(type) && file.size > MAX_IMAGE_BYTES) {
    return "Images must be 50 MB or smaller.";
  }
  if (type === "video/mp4" && file.size > MAX_VIDEO_BYTES) {
    return "Videos must be 500 MB or smaller.";
  }
  if (!isPreviewableMedia(type) && file.size > MAX_FILE_BYTES) {
    return "Files must be 100 MB or smaller.";
  }
  return null;
}

/** Keep filename metadata presentation-safe before it enters a Nostr tag. */
export function sanitizeMediaFilename(filename: string): string | null {
  const basename = filename
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
  if (!basename || basename === "." || basename === "..") return null;
  return basename.slice(0, 240);
}

export function buildImetaTags(
  attachments: ReadonlyArray<MediaDescriptor>,
): string[][] {
  return attachments.map((attachment) => [
    "imeta",
    `url ${attachment.url}`,
    `m ${attachment.type}`,
    `x ${attachment.sha256}`,
    `size ${attachment.size}`,
    ...(attachment.dim ? [`dim ${attachment.dim}`] : []),
    ...(attachment.blurhash ? [`blurhash ${attachment.blurhash}`] : []),
    ...(attachment.thumb ? [`thumb ${attachment.thumb}`] : []),
    ...(attachment.duration != null ? [`duration ${attachment.duration}`] : []),
    ...(attachment.filename ? [`filename ${attachment.filename}`] : []),
  ]);
}

export function parseImetaTags(
  tags: ReadonlyArray<ReadonlyArray<string>>,
): ParsedMedia[] {
  const parsed: ParsedMedia[] = [];
  for (const tag of tags) {
    if (parsed.length >= MAX_RENDERED_MEDIA_ATTACHMENTS) break;
    if (tag[0] !== "imeta") continue;
    const fields = new Map<string, string>();
    for (const part of tag.slice(1)) {
      const separator = part.indexOf(" ");
      if (separator > 0)
        fields.set(part.slice(0, separator), part.slice(separator + 1));
    }
    const url = fields.get("url");
    const type = fields.get("m")?.toLowerCase();
    const sha256 = fields.get("x")?.toLowerCase();
    const size = Number(fields.get("size"));
    if (
      !url ||
      !type ||
      !sha256 ||
      !/^[0-9a-f]{64}$/.test(sha256) ||
      !Number.isSafeInteger(size) ||
      size <= 0
    ) {
      continue;
    }
    const filename = sanitizeMediaFilename(fields.get("filename") ?? "");
    parsed.push({
      url,
      type,
      sha256,
      size,
      ...(fields.get("dim") ? { dim: fields.get("dim") } : {}),
      ...(fields.get("blurhash") ? { blurhash: fields.get("blurhash") } : {}),
      ...(fields.get("thumb") ? { thumb: fields.get("thumb") } : {}),
      ...(Number.isFinite(Number(fields.get("duration")))
        ? { duration: Number(fields.get("duration")) }
        : {}),
      ...(filename ? { filename } : {}),
    });
  }
  return parsed;
}

function markdownLabel(filename: string | undefined, url: string): string {
  const fallback = url.split("/").pop() || "attachment";
  return (sanitizeMediaFilename(filename ?? "") ?? fallback).replace(
    /[\\[\]]/g,
    "\\$&",
  );
}

export function mediaMarkdown(attachment: MediaDescriptor): string {
  if (IMAGE_TYPES.has(attachment.type)) return `![image](${attachment.url})`;
  if (attachment.type === "video/mp4") return `![video](${attachment.url})`;
  return `[${markdownLabel(attachment.filename, attachment.url)}](${attachment.url})`;
}

export function buildOutgoingMediaMessage(
  body: string,
  attachments: ReadonlyArray<MediaDescriptor>,
): { content: string; mediaTags?: string[][] } {
  if (attachments.length === 0) return { content: body.trim() };
  return {
    content: [body.trim(), ...attachments.map(mediaMarkdown)]
      .filter(Boolean)
      .join("\n"),
    mediaTags: buildImetaTags(attachments),
  };
}

/**
 * The durable imeta metadata owns attachment rendering. Suppress only standalone
 * markdown lines for those exact URLs so react-markdown never makes an
 * unauthenticated or cross-origin media request before the safe viewer runs.
 */
export function stripAttachmentMarkdown(
  content: string,
  attachments: ReadonlyArray<Pick<ParsedMedia, "url">>,
): string {
  if (attachments.length === 0) return content;
  const urls = new Set(attachments.map((attachment) => attachment.url));
  return content
    .split("\n")
    .filter((line) => {
      const match = line.trim().match(/^!?(?:\[[^\]]*\])\(([^\s)]+)\)$/);
      return !match || !urls.has(match[1]);
    })
    .join("\n")
    .trim();
}

/** Do not send a signed read authorization header to any non-relay URL. */
export function isSafeRelayMediaUrl(url: string, relayBase: string): boolean {
  try {
    const media = new URL(url);
    const relay = new URL(relayBase);
    return media.origin === relay.origin && MEDIA_PATH.test(media.pathname);
  } catch {
    return false;
  }
}
