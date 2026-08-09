export const KIND_EMOJI_LIST = 10030;
export const KIND_EMOJI_SET = 30030;
export const CUSTOM_EMOJI_SET_D_TAG = "buzz:custom-emoji";
/** Bound untrusted set/palette DOM work without changing relay storage. */
export const MAX_CUSTOM_EMOJI_PER_SET = 100;
export const MAX_CUSTOM_EMOJI_PALETTE = 200;

export type EmojiEvent = {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
};

export type CustomEmoji = { shortcode: string; url: string };

const SHORTCODE_RE = /^[a-z0-9_-]{1,64}$/;

export function normalizeEmojiShortcode(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/^:+|:+$/g, "")
    .toLowerCase();
  return SHORTCODE_RE.test(normalized) ? normalized : null;
}

/** Reject executable/data URLs and SVGs before an emoji reaches image rendering. */
export function isSafeEmojiImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (!url.hostname || url.username || url.password) return false;
    return !/\.svg$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function singleTagValue(event: EmojiEvent, name: string): string | undefined {
  const tags = event.tags.filter((tag) => tag[0] === name);
  return tags.length === 1 ? tags[0]?.[1] : undefined;
}

function isNewer(candidate: EmojiEvent, current: EmojiEvent | undefined) {
  return (
    !current ||
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id)
  );
}

/** Parse only safe NIP-30 `emoji` tags; a duplicate shortcode keeps first tag. */
export function emojiFromTags(tags: readonly string[][]): CustomEmoji[] {
  const result: CustomEmoji[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (result.length >= MAX_CUSTOM_EMOJI_PER_SET) break;
    const shortcode =
      tag[0] === "emoji" ? normalizeEmojiShortcode(tag[1] ?? "") : null;
    const url = tag[2];
    if (
      !shortcode ||
      !url ||
      !isSafeEmojiImageUrl(url) ||
      seen.has(shortcode)
    ) {
      continue;
    }
    seen.add(shortcode);
    result.push({ shortcode, url });
  }
  return result;
}

/**
 * Collapse replaceable heads first, then build a deterministic union across
 * member-owned lists. `30030` is restricted to Buzz's set d-tag; `10030` is
 * included for NIP-30 interoperability.
 */
export function unionCustomEmoji(events: readonly EmojiEvent[]): CustomEmoji[] {
  const heads = new Map<string, EmojiEvent>();
  for (const event of events) {
    const valid =
      event.kind === KIND_EMOJI_LIST ||
      (event.kind === KIND_EMOJI_SET &&
        singleTagValue(event, "d") === CUSTOM_EMOJI_SET_D_TAG);
    if (!valid) continue;
    const key = `${event.kind}:${event.pubkey.toLowerCase()}:${singleTagValue(event, "d") ?? ""}`;
    const current = heads.get(key);
    if (isNewer(event, current)) heads.set(key, event);
  }
  const palette = new Map<string, { emoji: CustomEmoji; event: EmojiEvent }>();
  for (const event of heads.values()) {
    for (const emoji of emojiFromTags(event.tags)) {
      const current = palette.get(emoji.shortcode);
      if (
        !current ||
        event.created_at > current.event.created_at ||
        (event.created_at === current.event.created_at &&
          `${event.id}:${emoji.url}` <
            `${current.event.id}:${current.emoji.url}`)
      ) {
        palette.set(emoji.shortcode, { emoji, event });
      }
    }
  }
  return [...palette.values()]
    .map(({ emoji }) => emoji)
    .sort((left, right) => left.shortcode.localeCompare(right.shortcode))
    .slice(0, MAX_CUSTOM_EMOJI_PALETTE);
}

/** Build a safe, parameterized-replaceable member set without publishing it. */
export function buildCustomEmojiSet(emojis: readonly CustomEmoji[]) {
  const normalized = new Map<string, string>();
  for (const emoji of emojis) {
    const shortcode = normalizeEmojiShortcode(emoji.shortcode);
    if (!shortcode || !isSafeEmojiImageUrl(emoji.url)) {
      throw new Error(
        "Custom emoji must have a safe name and http(s) image URL.",
      );
    }
    normalized.set(shortcode, emoji.url);
  }
  if (normalized.size > MAX_CUSTOM_EMOJI_PER_SET) {
    throw new Error(
      `Custom emoji sets are limited to ${MAX_CUSTOM_EMOJI_PER_SET} entries.`,
    );
  }
  return {
    kind: KIND_EMOJI_SET,
    content: "",
    tags: [
      ["d", CUSTOM_EMOJI_SET_D_TAG],
      ...[...normalized]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([shortcode, url]) => ["emoji", shortcode, url]),
    ],
  };
}

const SHORTCODE_SCAN = /:([a-z0-9_-]+):/gi;

/** Build self-contained NIP-30 tags for palette emoji used in outgoing content. */
export function buildCustomEmojiTags(
  content: string,
  palette: readonly CustomEmoji[],
): string[][] {
  const byShortcode = new Map(
    palette
      .filter((emoji) => isSafeEmojiImageUrl(emoji.url))
      .map((emoji) => [emoji.shortcode, emoji.url]),
  );
  const emitted = new Set<string>();
  const tags: string[][] = [];
  SHORTCODE_SCAN.lastIndex = 0;
  while (true) {
    const match = SHORTCODE_SCAN.exec(content);
    if (!match) break;
    const shortcode = match[1]?.toLowerCase();
    const url = shortcode ? byShortcode.get(shortcode) : undefined;
    if (!shortcode || !url || emitted.has(shortcode)) continue;
    emitted.add(shortcode);
    tags.push(["emoji", shortcode, url]);
  }
  return tags;
}

/** Resolve only an unambiguous, safe NIP-30 tag for a custom reaction. */
export function customEmojiFromReaction(
  emoji: string,
  tags: readonly string[][],
): CustomEmoji | null {
  const trimmed = emoji.trim();
  if (!trimmed.startsWith(":") || !trimmed.endsWith(":")) return null;
  const normalized = normalizeEmojiShortcode(trimmed);
  if (!normalized) return null;
  const matches = tags
    .filter((tag) => tag[0] === "emoji")
    .flatMap((tag) => {
      const shortcode = normalizeEmojiShortcode(tag[1] ?? "");
      const url = tag[2];
      return shortcode === normalized && url && isSafeEmojiImageUrl(url)
        ? [{ shortcode, url }]
        : [];
    });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
