export type AgentMessageProjection = {
  content: string;
  rawDetailsHidden: boolean;
};

const MACHINE_PAYLOAD_MARKERS = [
  /<\/?UNTRUSTED_[A-Z_]+>/i,
  /\bprovider\s+\d{3}\s*:\s*\{/i,
  /\\"(?:content_filter|modelUsage|session_id|total_cost_usd)\\"/i,
  /"(?:content_filter|modelUsage|session_id|total_cost_usd)"\s*:/i,
  /\bAlert findings:\s*\[/i,
];

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clipped(value: string, maxLength = 220) {
  const compact = compactWhitespace(value);
  if (compact.length <= maxLength) return compact;
  const candidate = compact.slice(0, maxLength);
  const boundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, Math.max(boundary, maxLength - 30)).trim()}…`;
}

function alertHeading(content: string) {
  const match = content.match(
    /Actionable alert routed to\s+(.+?)\s+Kind:\s*([^\s]+)\s+Severity:\s*([^\s]+)\s+Source(?:\s+job)?:\s*([^\s]+)/i,
  );
  if (!match) return null;
  const [, recipient, kind, severity, source] = match;
  return [
    `**Actionable alert routed to ${compactWhitespace(recipient ?? "the assigned agent")}**`,
    `- ${kind ?? "Alert"} · ${severity ?? "unknown"} severity · source: ${source ?? "unknown"}`,
  ];
}

function reportSummary(content: string) {
  const match = content.match(
    /Report:\s*Scanned\s+(\d+)\s+repo\(s\),\s*handled\s+(\d+)\s+new\s+CI\s+failure\(s\)(?:\s*\(mode:\s*([^)]+)\))?/i,
  );
  if (!match) return null;
  const [, scanned, handled, mode] = match;
  return `- Scanned ${scanned} repositories and handled ${handled} new CI failures${mode ? ` in ${mode} mode` : ""}.`;
}

function issueSummaries(content: string) {
  const results: string[] = [];
  const issuePattern =
    /Issue for\s+([^\s]+)(?:\s+\([^)]+\))?\s+[—-]\s+(https?:\/\/[^\s]+)\s+([\s\S]*?)(?=(?:\n\s*[-*•]?\s*)?(?:Issue for|Deferred\s+[^\s]+\s+until)|$)/gi;
  for (const match of content.matchAll(issuePattern)) {
    const repo = match[1] ?? "Repository";
    const url = (match[2] ?? "").replace(/[),.;]+$/, "");
    const detail = match[3] ?? "";
    let summary: string;
    if (
      /no usable diagnostics|cannot be determined|unknown with certainty/i.test(
        detail,
      )
    ) {
      summary =
        "Diagnosis was inconclusive because usable CI diagnostics were unavailable.";
    } else {
      summary = clipped(detail.split(/(?<=[.!?])\s/)[0] ?? detail, 180);
    }
    results.push(
      `- [${repo}](${url}) — ${summary || "Issue created for review."}`,
    );
    if (results.length === 6) break;
  }
  return results;
}

function deferredSummaries(content: string) {
  const results: string[] = [];
  const deferredPattern =
    /Deferred\s+([^\s]+)\s+until the model provider is available/gi;
  for (const match of content.matchAll(deferredPattern)) {
    results.push(
      `- ${match[1] ?? "A repository"} — deferred while the model provider is unavailable; it can retry later.`,
    );
    if (results.length === 6) break;
  }
  return results;
}

function genericProjection(content: string) {
  const firstMarker = MACHINE_PAYLOAD_MARKERS.reduce((earliest, marker) => {
    const index = content.search(marker);
    return index >= 0 && (earliest < 0 || index < earliest) ? index : earliest;
  }, -1);
  const humanPrefix = content.slice(0, firstMarker < 0 ? 360 : firstMarker);
  const firstParagraph = humanPrefix
    .split(/\n\s*\n|\n(?=[-*•]\s)/)[0]
    ?.replace(
      /\b(?:After explicit Buzz approval|You may diagnose)[\s\S]*$/i,
      "",
    )
    .trim();
  return `${clipped(firstParagraph || "Agent update", 320)}\n\n_Technical payload hidden. Open raw details if you need it._`;
}

/**
 * Projects machine-heavy agent output into readable channel copy. The original
 * remains available behind an explicit disclosure in MessageRow.
 */
export function projectAgentMessage(content: string): AgentMessageProjection {
  const hasMachinePayload = MACHINE_PAYLOAD_MARKERS.some((marker) =>
    marker.test(content),
  );
  const hasOversizedLine = content
    .split(/\r?\n/)
    .some((line) => line.length > 700);
  if (!hasMachinePayload || (!hasOversizedLine && content.length < 1_200)) {
    return { content, rawDetailsHidden: false };
  }

  const lines = alertHeading(content) ?? [];
  const report = reportSummary(content);
  if (report) lines.push(report);
  lines.push(...issueSummaries(content), ...deferredSummaries(content));

  return {
    content: lines.length > 0 ? lines.join("\n") : genericProjection(content),
    rawDetailsHidden: true,
  };
}
