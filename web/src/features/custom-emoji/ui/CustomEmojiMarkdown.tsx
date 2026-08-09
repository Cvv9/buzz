import type { ComponentPropsWithoutRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CustomEmoji } from "../custom-emoji-policy";
import { remarkCustomEmoji } from "../custom-emoji-markdown";
import { CustomEmojiImage } from "./CustomEmojiImage";

/** Markdown renderer that resolves only image URLs carried in validated NIP-30 tags. */
export function CustomEmojiMarkdown({
  content,
  emoji,
}: {
  content: string;
  emoji: readonly CustomEmoji[];
}) {
  const byUrl = new Map(emoji.map((item) => [item.url, item]));
  return (
    <Markdown
      components={{
        img: ({ src, alt, ...props }: ComponentPropsWithoutRef<"img">) => {
          const item = typeof src === "string" ? byUrl.get(src) : undefined;
          return item ? (
            <CustomEmojiImage emoji={item} />
          ) : (
            <img alt={alt ?? ""} src={src} {...props} />
          );
        },
      }}
      remarkPlugins={[remarkGfm, remarkCustomEmoji(emoji)]}
    >
      {content}
    </Markdown>
  );
}
