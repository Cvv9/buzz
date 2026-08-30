import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

function read(relativePath) {
  return readFileSync(`${repoRoot}/${relativePath}`, "utf8");
}

const surfaceMap = read("docs/agent-surface-map.md");

function declaredRoutes(source) {
  return [
    "/",
    ...[...source.matchAll(/route\(\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    ),
  ];
}

test("agent surface map inventories every declared desktop and web route", () => {
  const routeSources = [
    read("desktop/src/app/routes.ts"),
    read("web/src/app/routes.ts"),
  ];

  for (const route of new Set(routeSources.flatMap(declaredRoutes))) {
    assert.equal(
      surfaceMap.includes(`\`${route}\``),
      true,
      `docs/agent-surface-map.md must classify route ${route}`,
    );
  }
});

test("desktop mention and search surfaces share the canonical access policy", () => {
  const mentionSource = read(
    "desktop/src/features/messages/lib/useMentions.ts",
  );
  const searchSource = read("desktop/src/features/search/useSearchResults.ts");

  assert.match(
    mentionSource,
    /getMentionableAgentPubkeys/,
    "mentions must delegate to the canonical mentionable-agent projection",
  );
  assert.match(
    searchSource,
    /relayAgentIsSharedWithUser/,
    "global search must use relayAgentIsSharedWithUser",
  );

  assert.doesNotMatch(
    searchSource,
    /\.respondTo\s*[!=]==?\s*["']anyone["']/,
    "global search must not recreate agent access policy inline",
  );
});

test("historical Inbox presentation overlays the current hosted directory", () => {
  const homeSource = read("desktop/src/features/home/ui/HomeView.tsx");
  assert.match(homeSource, /useRelayAgentDirectory/);
  assert.match(homeSource, /overlayHostedAgentProfiles/);
  assert.match(
    surfaceMap,
    /historical events change presentation without being rewritten/i,
  );
});

test("desktop and web hosted configuration readers remain represented", () => {
  const desktopReader = [
    read("desktop/src-tauri/src/commands/agent_discovery.rs"),
    read("desktop/src-tauri/src/commands/agent_discovery/relay_directory.rs"),
  ].join("\n");
  const webReader = read("web/src/features/workspace/workspace-api.ts");

  for (const [surface, source] of [
    ["desktop", desktopReader],
    ["web", webReader],
  ]) {
    assert.match(
      source,
      /KIND_HOSTED_AGENT_CONFIG/,
      `${surface} must read hosted-agent configuration`,
    );
    assert.match(
      source,
      /KIND_MANAGED_AGENT/,
      `${surface} must retain the old-relay compatibility reader`,
    );
  }
});

test("desktop treats hosted runtime as a web-managed compatibility surface", () => {
  const editor = read(
    "desktop/src/features/agents/ui/HostedAgentEditDialog.tsx",
  );
  const presentation = read(
    "desktop/src/features/agents/lib/hostedAgentPresentation.ts",
  );

  assert.match(editor, /Runtime settings are managed in Buzz on the web/);
  assert.doesNotMatch(editor, /switchManagedAgentModel/);
  assert.match(presentation, /agent\.runtime/);
  assert.match(surfaceMap, /Desktop[\s\S]*read-only[\s\S]*web/i);
});
