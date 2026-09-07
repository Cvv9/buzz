// VarVik's default navigation: team conversation first, private decisions next.
// This orders existing records only; relay metadata still controls grouping
// and membership. Unrecognized sections and rooms remain available.
const sectionOrder = ["general", "command center"];
const channelOrder: Record<string, string[]> = {
  general: [
    "general",
    "welcome",
    "team-introductions",
    "engineering",
    "product-development",
    "client-delivery",
    "customer-support",
    "people-support",
    "market-intelligence",
    "opportunities",
    "tech-radar",
  ],
  "command center": [
    "brief-varun",
    "sylars-control",
    "operations",
    "watchdog-alerts",
    "github-events",
    "security",
    "portfolio",
    "agent-lab",
  ],
};

function rank(order: string[], value: string): number {
  const index = order.indexOf(value);
  return index < 0 ? order.length : index;
}

export function compareWorkspaceChannels(
  left: { name: string; catalogSection: string },
  right: { name: string; catalogSection: string },
): number {
  const a = (left.catalogSection.trim() || "General").toLowerCase();
  const b = (right.catalogSection.trim() || "General").toLowerCase();
  const sectionDifference = rank(sectionOrder, a) - rank(sectionOrder, b);
  if (sectionDifference) return sectionDifference;
  if (a !== b) return a.localeCompare(b);
  const order = channelOrder[a] ?? [];
  return (
    rank(order, left.name.toLowerCase()) -
      rank(order, right.name.toLowerCase()) ||
    left.name.localeCompare(right.name)
  );
}
