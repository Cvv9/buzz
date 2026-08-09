import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  CUSTOM_EMOJI_SET_D_TAG,
  KIND_EMOJI_LIST,
  KIND_EMOJI_SET,
  type CustomEmoji,
  buildCustomEmojiSet,
  unionCustomEmoji,
} from "./custom-emoji-policy";
import {
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";

const PUBKEY_RE = /^[0-9a-f]{64}$/i;

function memberScope(pubkeys: readonly string[]) {
  return [
    ...new Set(
      pubkeys
        .map((pubkey) => pubkey.trim().toLowerCase())
        .filter((pubkey) => PUBKEY_RE.test(pubkey)),
    ),
  ]
    .sort()
    .slice(0, 500);
}

function scopeKey(pubkeys: readonly string[]) {
  return memberScope(pubkeys).join(",");
}

export function customEmojiPaletteQueryKey(memberPubkeys: readonly string[]) {
  return ["custom-emoji-palette", scopeKey(memberPubkeys)] as const;
}

export function ownCustomEmojiQueryKey(pubkey: string) {
  return ["custom-emoji-own", pubkey.trim().toLowerCase()] as const;
}

/** Read the current member-authored NIP-30 lists and Buzz emoji-set heads. */
export async function listCustomEmojiPalette(memberPubkeys: readonly string[]) {
  const authors = memberScope(memberPubkeys);
  if (authors.length === 0) return [];
  const [lists, sets] = await Promise.all([
    queryEvents(relayWsUrl(), {
      kinds: [KIND_EMOJI_LIST],
      authors,
      limit: 500,
    }),
    queryEvents(relayWsUrl(), {
      kinds: [KIND_EMOJI_SET],
      authors,
      "#d": [CUSTOM_EMOJI_SET_D_TAG],
      limit: 500,
    }),
  ]);
  return unionCustomEmoji([...lists, ...sets]);
}

async function listOwnCustomEmoji(pubkey: string) {
  const author = pubkey.trim().toLowerCase();
  if (!PUBKEY_RE.test(author)) return [];
  const events = await queryEvents(relayWsUrl(), {
    kinds: [KIND_EMOJI_SET],
    authors: [author],
    "#d": [CUSTOM_EMOJI_SET_D_TAG],
    limit: 20,
  });
  return unionCustomEmoji(events);
}

function subscribeToCustomEmoji(
  memberPubkeys: readonly string[],
  onRefresh: () => void,
) {
  const authors = memberScope(memberPubkeys);
  if (authors.length === 0) return () => undefined;
  const filterStatus = (status: "connecting" | "live" | "closed") => {
    if (status === "live") onRefresh();
  };
  const stopLists = subscribeEvents(
    relayWsUrl(),
    {
      kinds: [KIND_EMOJI_LIST],
      authors,
      since: Math.floor(Date.now() / 1_000),
    },
    onRefresh,
    filterStatus,
  );
  const stopSets = subscribeEvents(
    relayWsUrl(),
    {
      kinds: [KIND_EMOJI_SET],
      authors,
      "#d": [CUSTOM_EMOJI_SET_D_TAG],
      since: Math.floor(Date.now() / 1_000),
    },
    onRefresh,
    filterStatus,
  );
  return () => {
    stopLists();
    stopSets();
  };
}

/** Initial fetch plus bounded live invalidation for the visible member palette. */
export function useCustomEmojiPalette(memberPubkeys: readonly string[]) {
  const queryClient = useQueryClient();
  const scopedMembers = React.useMemo(
    () => memberScope(memberPubkeys),
    [memberPubkeys],
  );
  const membersKey = scopedMembers.join(",");
  const key = React.useMemo(
    () => ["custom-emoji-palette", membersKey] as const,
    [membersKey],
  );
  const query = useQuery({
    queryKey: key,
    queryFn: () => listCustomEmojiPalette(scopedMembers),
    enabled: scopedMembers.length > 0,
    staleTime: 60_000,
  });
  React.useEffect(() => {
    const members = membersKey ? membersKey.split(",") : [];
    if (members.length === 0) return;
    return subscribeToCustomEmoji(members, () => {
      void queryClient.invalidateQueries({ queryKey: key });
    });
  }, [key, membersKey, queryClient]);
  return query;
}

function useOwnCustomEmoji(pubkey: string) {
  const key = ownCustomEmojiQueryKey(pubkey);
  return useQuery({
    queryKey: key,
    queryFn: () => listOwnCustomEmoji(pubkey),
    enabled: PUBKEY_RE.test(pubkey),
    staleTime: 30_000,
  });
}

async function publishOwnCustomEmojiSet(
  pubkey: string,
  emojis: readonly CustomEmoji[],
) {
  if (!PUBKEY_RE.test(pubkey)) throw new Error("Unlock an identity first.");
  return publishEvent(relayWsUrl(), buildCustomEmojiSet(emojis));
}

/** Own-set management remains a parameterized-replaceable 30030 event. */
export function useOwnCustomEmojiSet(pubkey: string) {
  const queryClient = useQueryClient();
  const own = useOwnCustomEmoji(pubkey);
  const save = useMutation({
    mutationFn: (emojis: readonly CustomEmoji[]) =>
      publishOwnCustomEmojiSet(pubkey, emojis),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ownCustomEmojiQueryKey(pubkey),
      });
      void queryClient.invalidateQueries({
        queryKey: ["custom-emoji-palette"],
      });
    },
  });
  return { ...own, save };
}
