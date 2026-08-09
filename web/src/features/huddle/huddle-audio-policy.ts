const AUDIO_SAMPLE_RATE = 48_000;

/** Preserve capture-time metadata when WebCodecs emits frames asynchronously. */
export function encodedHuddleFrameMetadata(
  timestampMicroseconds: number,
  levelsByTimestamp: ReadonlyMap<number, number>,
) {
  return {
    timestamp48k: Math.round(
      (timestampMicroseconds * AUDIO_SAMPLE_RATE) / 1_000_000,
    ),
    levelDbov: levelsByTimestamp.get(timestampMicroseconds) ?? -127,
  };
}
