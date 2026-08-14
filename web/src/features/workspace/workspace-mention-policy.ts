export type MentionCandidate = {
  pubkey: string;
  name: string;
  aliases?: string[];
  picture?: string;
  isAgent?: boolean;
};

export type ActiveMention = { start: number; query: string };

const MAX_MENTION_QUERY_LENGTH = 48;

/**
 * Locate the `@mention` the caret currently sits inside, if any.
 *
 * Only the text before the caret is considered. The character preceding the
 * `@` must be start-of-text or whitespace (so `a@b` in an email is not
 * treated as a mention), and the query itself must not contain another `@`,
 * a newline, two consecutive spaces, a leading space, or exceed
 * `MAX_MENTION_QUERY_LENGTH` characters.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): ActiveMention | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start === -1) return null;
  const precedingChar = start === 0 ? null : before[start - 1];
  if (precedingChar !== null && !/\s/.test(precedingChar)) return null;
  const query = before.slice(start + 1);
  if (
    query.includes("@") ||
    query.includes("\n") ||
    query.includes("  ") ||
    query.startsWith(" ") ||
    query.length > MAX_MENTION_QUERY_LENGTH
  ) {
    return null;
  }
  return { start, query };
}

/**
 * Filter and rank mention candidates against a query.
 *
 * Matches are case-insensitive against a candidate's name and aliases.
 * Prefix matches (name/alias or a whitespace-separated word within it
 * starting with the query) rank above substring-only matches; order within
 * each rank is preserved from the input. Candidates are deduplicated by
 * lowercased pubkey, keeping the first occurrence.
 */
export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string,
  limit = 8,
): MentionCandidate[] {
  const loweredQuery = query.toLowerCase();
  const seen = new Set<string>();
  const prefixMatches: MentionCandidate[] = [];
  const substringMatches: MentionCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.pubkey.toLowerCase();
    if (seen.has(key)) continue;
    const names = [candidate.name, ...(candidate.aliases ?? [])].filter(
      Boolean,
    );
    if (loweredQuery === "") {
      seen.add(key);
      prefixMatches.push(candidate);
      continue;
    }
    let isPrefixMatch = false;
    let isSubstringMatch = false;
    for (const name of names) {
      const loweredName = name.toLowerCase();
      if (loweredName.startsWith(loweredQuery)) {
        isPrefixMatch = true;
        break;
      }
      if (
        loweredName.split(/\s+/).some((word) => word.startsWith(loweredQuery))
      ) {
        isPrefixMatch = true;
        break;
      }
      if (loweredName.includes(loweredQuery)) isSubstringMatch = true;
    }
    if (isPrefixMatch) {
      seen.add(key);
      prefixMatches.push(candidate);
    } else if (isSubstringMatch) {
      seen.add(key);
      substringMatches.push(candidate);
    }
  }
  return [...prefixMatches, ...substringMatches].slice(0, limit);
}

/** Replace the active mention query with the selected candidate's name. */
export function applyMentionSelection(
  text: string,
  mention: ActiveMention,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `;
  const nextText = `${text.slice(0, mention.start)}${inserted}${text.slice(caret)}`;
  return { text: nextText, caret: mention.start + inserted.length };
}

/**
 * Extract the pubkeys of candidates whose name or an alias is mentioned in
 * `content`, matched as a case-insensitive `@name` substring scan.
 */
export function extractMentionPubkeys(
  content: string,
  candidates: MentionCandidate[],
): string[] {
  const lowered = content.toLowerCase();
  const seen = new Set<string>();
  const mentions: string[] = [];
  for (const candidate of candidates) {
    const names = [candidate.name, ...(candidate.aliases ?? [])].filter(
      Boolean,
    );
    const isMentioned = names.some((name) =>
      lowered.includes(`@${name.toLowerCase()}`),
    );
    if (!isMentioned) continue;
    const key = candidate.pubkey.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push(candidate.pubkey);
  }
  return mentions;
}
