import type { CustomEmoji } from "./custom-emoji-policy";

type MarkdownNode = {
  alt?: string;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
  type?: string;
  url?: string;
  value?: string;
};

function shortcodePattern(emoji: readonly CustomEmoji[]) {
  const shortcodes = [...new Set(emoji.map((item) => item.shortcode))]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map((shortcode) => shortcode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return shortcodes.length
    ? new RegExp(`:(?:${shortcodes.join("|")}):`, "gi")
    : null;
}

function skipEmojiReplacement(node: MarkdownNode) {
  return (
    node.type === "link" || node.type === "code" || node.type === "inlineCode"
  );
}

function replaceText(
  text: string,
  pattern: RegExp,
  byShortcode: ReadonlyMap<string, string>,
): MarkdownNode[] {
  pattern.lastIndex = 0;
  const nodes: MarkdownNode[] = [];
  let lastIndex = 0;
  while (true) {
    const match = pattern.exec(text);
    if (!match) break;
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    const shortcode = match[0].slice(1, -1).toLowerCase();
    const url = byShortcode.get(shortcode);
    nodes.push(
      url
        ? {
            type: "image",
            value: `:${shortcode}:`,
            alt: `:${shortcode}:`,
            url,
          }
        : { type: "text", value: match[0] },
    );
    lastIndex = match.index + match[0].length;
  }
  if (nodes.length === 0) return [{ type: "text", value: text }];
  if (lastIndex < text.length)
    nodes.push({ type: "text", value: text.slice(lastIndex) });
  return nodes;
}

function walk(
  node: MarkdownNode,
  pattern: RegExp,
  byShortcode: ReadonlyMap<string, string>,
) {
  if (!node.children || skipEmojiReplacement(node)) return;
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    if (!child) continue;
    if (child.type === "text" && typeof child.value === "string") {
      const replacement = replaceText(child.value, pattern, byShortcode);
      if (replacement.length !== 1 || replacement[0]?.type !== "text") {
        node.children.splice(index, 1, ...replacement);
      }
    } else {
      walk(child, pattern, byShortcode);
    }
  }
}

/** Remark transform: self-contained NIP-30 tags become safe custom nodes. */
export function remarkCustomEmoji(emoji: readonly CustomEmoji[]) {
  const safeEmoji = emoji.filter((item) => item.shortcode && item.url);
  const pattern = shortcodePattern(safeEmoji);
  const byShortcode = new Map(
    safeEmoji.map((item) => [item.shortcode, item.url]),
  );
  return () => (tree: MarkdownNode) => {
    if (pattern) walk(tree, pattern, byShortcode);
  };
}
