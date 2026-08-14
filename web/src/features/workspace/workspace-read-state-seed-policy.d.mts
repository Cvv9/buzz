export function seedMarkerForAbsentChannel(args: {
  channelEvents: readonly { created_at: number; pubkey: string }[];
  pubkey: string;
  seededAt: number;
  storeExisted: boolean;
}): number | null;

export function resolveSeedHorizon(
  storedSeededAt: unknown,
  now: number,
): { seededAt: number; needsStamp: boolean };
