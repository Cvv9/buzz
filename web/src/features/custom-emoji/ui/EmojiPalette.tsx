import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

/** Loaded only when the user opens the full emoji palette. */
export default function EmojiPalette({
  onSelect,
}: {
  onSelect: (value: string) => void;
}) {
  return (
    <Picker
      autoFocus
      data={data}
      maxFrequentRows={2}
      onEmojiSelect={(emoji: { native?: string }) => {
        if (emoji.native) onSelect(emoji.native);
      }}
      perLine={8}
      previewPosition="none"
      set="native"
      skinTonePosition="search"
      theme="auto"
    />
  );
}
