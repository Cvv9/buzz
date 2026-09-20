import { waitForAnimations } from "../../../desktop/tests/helpers/animations";
import { expect, test } from "@playwright/test";
import {
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  finalizeEvent,
} from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { parseWorkflowDefinition } from "../../src/features/workflows/workflow-policy";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

async function signIn(
  page: import("@playwright/test").Page,
  secret: Uint8Array,
) {
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secret));
  await page
    .getByLabel("Password", { exact: true })
    .fill("workflow-test-password");
  await page.getByLabel("Confirm password").fill("workflow-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.locator('a[href="/settings"]').last().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: "Workflows", exact: true }).click();
  await expect(page).toHaveURL("/workflows");
  await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible();
}

test("workflow definitions, automatic dispatch toggle, runs, and approvals use relay events", async ({
  page,
}) => {
  const secret = generateSecretKey();
  const viewerPubkey = getPublicKey(secret);
  const workflowChannelId = "11111111-1111-4111-8111-111111111111";
  await installWorkspaceRelayMock(page, viewerPubkey, { workflowChannelId });
  await signIn(page, secret);

  await page.getByLabel("Workflow channel").selectOption(workflowChannelId);
  await expect(
    page.getByRole("heading", { name: "Workflow builder" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Search the web/ })
    .first()
    .click();
  await page.getByLabel("Agent").selectOption({ label: "Workspace Agent 7" });
  await page
    .getByLabel("Instructions")
    .fill("Find the latest source-backed market signal for our launch.");

  await page.getByRole("button", { name: "Save workflow" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              tags: string[][];
              content: string;
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.find((event) => event.kind === 30620),
      ),
    )
    .toMatchObject({
      kind: 30620,
      tags: expect.arrayContaining([
        expect.arrayContaining(["d"]),
        ["h", workflowChannelId],
      ]),
    });
  const savedWorkflowYaml = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __BUZZ_WEB_E2E_PUBLISHED__: Array<{
            kind: number;
            content: string;
          }>;
        }
      ).__BUZZ_WEB_E2E_PUBLISHED__.find((event) => event.kind === 30620)
        ?.content ?? "",
  );
  expect(parseWorkflowDefinition(savedWorkflowYaml)).toMatchObject({
    trigger: { on: "message_posted" },
    enabled: true,
  });
  expect(savedWorkflowYaml).toContain(
    "@Workspace Agent 7 Search the web using current, source-linked information.",
  );
  await page.getByRole("link", { name: "New workflow" }).click();
  await expect(
    page.getByRole("heading", { name: "New workflow" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop automatic dispatch" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const events = (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              content: string;
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.filter((event) => event.kind === 30620);
        return events.at(-1)?.content;
      }),
    )
    .toContain("enabled: false");

  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              tags: string[][];
              content: string;
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.find((event) => event.kind === 46020),
      ),
    )
    .toMatchObject({ kind: 46020, content: "{}" });

  await page.getByRole("link", { name: "Workflows", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_HAS_KIND_SUBSCRIPTION__: (kind: number) => boolean;
          }
        ).__BUZZ_WEB_E2E_HAS_KIND_SUBSCRIPTION__(46010),
      ),
    )
    .toBe(true);
  await page.evaluate((pubkey) => {
    const helpers = window as typeof window & {
      __BUZZ_WEB_E2E_EMIT__: (event: unknown) => void;
      __BUZZ_WEB_E2E_EVENT__: (
        kind: number,
        pubkey: string,
        tags: string[][],
        content: string,
        suffix: string,
      ) => unknown;
    };
    helpers.__BUZZ_WEB_E2E_EMIT__(
      helpers.__BUZZ_WEB_E2E_EVENT__(
        46010,
        "d".repeat(64),
        [
          ["d", "e".repeat(64)],
          ["p", pubkey],
        ],
        "Approve production deployment?",
        "a".repeat(64),
      ),
    );
  }, viewerPubkey);
  await expect(page.getByText("Approve production deployment?")).toBeVisible();
  await page
    .getByTestId(`workflow-approval-${"a".repeat(64)}`)
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              tags: string[][];
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.find((event) => event.kind === 46030),
      ),
    )
    .toMatchObject({ kind: 46030, tags: [["d", "e".repeat(64)]] });
});

test("workflow builder gates runtime resources and unavailable approval paths", async ({
  page,
}) => {
  const secret = generateSecretKey();
  const viewerPubkey = getPublicKey(secret);
  await installWorkspaceRelayMock(page, viewerPubkey, {
    workflowChannelId: "22222222-2222-4222-8222-222222222222",
  });
  await signIn(page, secret);
  await expect(
    page.getByRole("heading", { name: "Workflow builder" }),
  ).toBeVisible();

  await expect(
    page.getByTestId("workflow-node-request_approval"),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Search the web/ }).click();
  await expect(page.getByLabel("Agent").locator("option")).toHaveText([
    "Choose an agent",
    "Workspace Agent 7",
  ]);

  await page.getByRole("button", { name: /Use a library tool/ }).click();
  await expect(
    page.getByLabel("Tool or skill name").locator("option"),
  ).toHaveText([
    "Choose a connected resource",
    "Market Intelligence research",
    "Public web sources",
  ]);

  await page.getByRole("button", { name: "View YAML" }).click();
  await page.getByLabel("Workflow YAML").fill(`name: Approval gate
trigger:
  on: message_posted
steps:
  - id: request
    action: request_approval
    from: "@owner"
    message: "Approve this change"
`);
  await expect(page.getByLabel("Workflow YAML")).toHaveValue(
    /action: request_approval/,
  );
  await page.getByRole("button", { name: "Save workflow" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "does not yet deliver approval requests end-to-end",
  );
});

const SCHEDULED_AGENT = "7".padStart(64, "0");
const SCHEDULED_ID = "33333333-3333-4333-8333-333333333333";
const SCHEDULED_CHANNEL = "11111111-1111-4111-8111-111111111111";
const SCHEDULED_HASH = "e".repeat(64);
const RESULT_ID = "f".repeat(64);

function scheduledRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    workflow_id: SCHEDULED_ID,
    name: "Morning brief",
    definition_hash: SCHEDULED_HASH,
    agent_targets: [SCHEDULED_AGENT],
    channel_id: SCHEDULED_CHANNEL,
    schedule: { on: "schedule", interval: "24h", cron: null },
    timezone: "UTC",
    next_scheduled_at: null,
    enabled: true,
    last_run: null,
    block_reason: null,
    revision: 0,
    limits: {
      remaining_workflow: 3,
      remaining_community: 10,
      next_eligible_at: null,
      server_now: now,
    },
    ...overrides,
  };
}
function runEvidence(
  state = "completed",
  overrides: Record<string, unknown> = {},
) {
  const now = new Date().toISOString();
  return {
    id: SCHEDULED_ID,
    execution_state: state,
    origin: "manual",
    requester: null,
    accepted_at: now,
    deadline_at: now,
    created_at: Math.floor(Date.now() / 1000),
    safe_error_code: null,
    revision: 2,
    results:
      state === "completed"
        ? [
            {
              channel_id: SCHEDULED_CHANNEL,
              event_id: RESULT_ID,
              url: "https://untrusted.invalid/",
            },
          ]
        : [],
    ...overrides,
  };
}
function manualBackend() {
  return {
    rows: [scheduledRow()],
    gets: 0,
    posts: [] as string[],
    bodies: [] as string[],
    accepted: 0,
    failGet: false,
    getStatus: 503,
    abortedPosts: 0,
    gate: null as Promise<void> | null,
    receipts: new Map<string, unknown>(),
  };
}
async function installManualBackend(
  page: import("@playwright/test").Page,
  viewer: string,
  backend: ReturnType<typeof manualBackend>,
) {
  await page.route("**/workflows?*", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("agent_pubkey"))
      return route.fallback();
    backend.gets += 1;
    const auth = JSON.parse(
      Buffer.from(
        route.request().headers().authorization.slice(6),
        "base64",
      ).toString(),
    );
    expect(auth.pubkey).toBe(viewer);
    expect(verifyEvent(auth)).toBe(true);
    expect(auth.tags).toContainEqual(["u", route.request().url()]);
    expect(auth.tags).toContainEqual(["method", "GET"]);
    if (
      new URL(route.request().url()).searchParams.get("agent_pubkey") !==
      SCHEDULED_AGENT
    ) {
      return route.fulfill({
        json: {
          workflows: [],
          next: null,
          server_now: new Date().toISOString(),
        },
      });
    }
    if (backend.gate) await backend.gate;
    if (backend.failGet)
      return route.fulfill({
        status: backend.getStatus,
        json: { error: "unavailable" },
      });
    await route.fulfill({
      json: {
        workflows: backend.rows,
        next: null,
        server_now: new Date().toISOString(),
      },
    });
  });
  await page.route("**/events", async (route) => {
    const body = route.request().postData() ?? "";
    const event = JSON.parse(body);
    if (event.kind !== 46020) return route.fallback();
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(viewer);
    expect(JSON.parse(event.content)).toEqual({
      expected_definition_hash: SCHEDULED_HASH,
    });
    expect(event.tags).toEqual([
      ["d", SCHEDULED_ID],
      ["request", expect.stringMatching(/^[0-9a-f-]{36}$/)],
    ]);
    const auth = JSON.parse(
      Buffer.from(
        route.request().headers().authorization.slice(6),
        "base64",
      ).toString(),
    );
    expect(auth.pubkey).toBe(viewer);
    expect(verifyEvent(auth)).toBe(true);
    expect(auth.tags).toContainEqual(["u", route.request().url()]);
    expect(auth.tags).toContainEqual(["method", "POST"]);
    backend.posts.push(event.id);
    backend.bodies.push(body);
    let receipt = backend.receipts.get(event.id);
    if (!receipt) {
      const accepted = backend.accepted === 0;
      if (accepted) backend.accepted += 1;
      const now = new Date().toISOString();
      const limits = {
        remaining_workflow: 2,
        remaining_community: 9,
        next_eligible_at: new Date(Date.now() + 900_000).toISOString(),
        server_now: now,
      };
      receipt = {
        accepted,
        run_id: accepted ? SCHEDULED_ID : null,
        reason: accepted ? null : "workflow_active",
        revision: 1,
        limits,
      };
      backend.receipts.set(event.id, receipt);
      backend.rows = [
        scheduledRow({
          last_run: runEvidence("running", { requester: viewer, revision: 1 }),
          revision: 1,
          block_reason: "workflow_active",
          limits,
        }),
      ];
    }
    if (backend.abortedPosts > 0) {
      backend.abortedPosts -= 1;
      return route.abort("connectionreset");
    }
    await route.fulfill({
      json: {
        event_id: event.id,
        accepted: (receipt as { accepted: boolean }).accepted,
        message: `response:${JSON.stringify(receipt)}`,
      },
    });
  });
}
async function openScheduledAgent(
  page: import("@playwright/test").Page,
  secret: Uint8Array,
  backend: ReturnType<typeof manualBackend>,
  role: "owner" | "admin" = "owner",
) {
  const viewer = getPublicKey(secret);
  await installWorkspaceRelayMock(page, viewer, {
    workflowChannelId: SCHEDULED_CHANNEL,
    communityRole: role,
  });
  await installManualBackend(page, viewer, backend);
  await signIn(page, secret);
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await page.locator('a[href="/settings"]').last().click();
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await page.getByTestId("agent-row-workspace-agent-7").click();
  await expect(page.getByTestId("agent-scheduled-workflows")).toBeVisible();
}

// Settings mutation goes through the real browser signer and generic HTTP Nostr bridge.
test("scheduled settings double-click and lost acknowledgement reuse one signed request independent of name edits", async ({
  page,
}) => {
  const backend = manualBackend();
  backend.abortedPosts = 1;
  const secret = generateSecretKey();
  await openScheduledAgent(page, secret, backend);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Unsaved new name");
  const run = page.getByRole("button", {
    name: "Run now Morning brief",
    exact: true,
  });
  await expect(run).toBeEnabled();
  await run.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => backend.posts.length).toBe(2);
  expect(new Set(backend.posts).size).toBe(1);
  expect(backend.bodies[0]).toBe(backend.bodies[1]);
  expect(backend.accepted).toBe(1);
  await page.evaluate(
    ({ viewer, agent }) => {
      const helpers = window as typeof window & {
        __BUZZ_WEB_E2E_RECEIVE__: (event: unknown) => void;
        __BUZZ_WEB_E2E_EVENT__: (...args: unknown[]) => unknown;
      };
      helpers.__BUZZ_WEB_E2E_RECEIVE__(
        helpers.__BUZZ_WEB_E2E_EVENT__(
          30180,
          viewer,
          [["d", agent]],
          JSON.stringify({
            schema: "buzz.hosted-agent-config.v1",
            agent_pubkey: agent,
            name: "Renamed Agent",
            avatar_url: null,
            model: null,
          }),
          "renamed-agent",
          Math.floor(Date.now() / 1000),
        ),
      );
    },
    { viewer: getPublicKey(secret), agent: SCHEDULED_AGENT },
  );
  await expect(page.getByTestId("agent-row-renamed-agent")).toBeVisible();
  await expect(page.getByText("Last actual outcome: running")).toBeVisible();
  await expect(run).toBeDisabled();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved new name",
  );
  await expect(
    page.getByText(/These are execution limits, not a spending cap/),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & {
          __BUZZ_WEB_E2E_PUBLISHED__: { kind: number }[];
        }
      ).__BUZZ_WEB_E2E_PUBLISHED__.filter((event) => event.kind === 30180),
    ),
  ).toHaveLength(0);
});

test("uncertain request is retained for explicit same-event retry and reconnect never resubmits it", async ({
  page,
}) => {
  const backend = manualBackend();
  backend.abortedPosts = 2;
  await openScheduledAgent(page, generateSecretKey(), backend);
  await page
    .getByRole("button", { name: "Run now Morning brief", exact: true })
    .click();
  const retry = page.getByRole("button", {
    name: "Retry same request for Morning brief",
  });
  await expect(retry).toBeEnabled();
  expect(backend.posts).toHaveLength(2);
  const before = backend.gets;
  await page.evaluate(() =>
    (
      window as typeof window & { __BUZZ_WEB_E2E_DISCONNECT__: () => void }
    ).__BUZZ_WEB_E2E_DISCONNECT__(),
  );
  await expect.poll(() => backend.gets).toBeGreaterThan(before);
  await expect(retry).toBeEnabled();
  expect(backend.posts).toHaveLength(2);
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => backend.posts.length).toBe(3);
  expect(new Set(backend.posts).size).toBe(1);
  expect(backend.accepted).toBe(1);
});

test("two clients use separate requests while the relay admits only one", async ({
  page,
  browser,
}) => {
  const backend = manualBackend();
  const secret = generateSecretKey();
  await openScheduledAgent(page, secret, backend);
  const otherContext = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
  });
  const other = await otherContext.newPage();
  try {
    await openScheduledAgent(other, secret, backend);
    const first = page.getByRole("button", {
      name: "Run now Morning brief",
      exact: true,
    });
    const second = other.getByRole("button", {
      name: "Run now Morning brief",
      exact: true,
    });
    await expect(first).toBeEnabled();
    await expect(second).toBeEnabled();
    await Promise.all([first.click(), second.click()]);
    await expect.poll(() => backend.posts.length).toBe(2);
    expect(new Set(backend.posts).size).toBe(2);
    expect(backend.accepted).toBe(1);
    await expect(first).toBeDisabled();
    await expect(second).toBeDisabled();
    const texts = await Promise.all([
      page.getByTestId("agent-scheduled-workflows").innerText(),
      other.getByTestId("agent-scheduled-workflows").innerText(),
    ]);
    expect(texts.join(" ")).toContain("Not started:");
  } finally {
    await otherContext.close();
  }
});

test("nonowner receives explanation without requesting protected summaries", async ({
  page,
}) => {
  const backend = manualBackend();
  await openScheduledAgent(page, generateSecretKey(), backend, "admin");
  await expect(
    page.getByText(
      "Only the current workspace owner can view and run scheduled agent workflows.",
    ),
  ).toBeVisible();
  expect(backend.gets).toBe(0);
  await expect(
    page.getByRole("button", { name: "Run now Morning brief" }),
  ).toHaveCount(0);
});

test("loading, errors, empty and unsupported summaries remain distinct and never enable execution", async ({
  page,
}) => {
  const backend = manualBackend();
  let release: () => void = () => undefined;
  backend.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await openScheduledAgent(page, generateSecretKey(), backend);
  await expect(page.getByText("Loading scheduled workflows…")).toBeVisible();
  backend.failGet = true;
  release();
  backend.gate = null;
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not load scheduled workflows" }),
  ).toBeVisible();
  backend.failGet = false;
  backend.rows = [];
  await page
    .getByRole("button", { name: "Refresh scheduled workflows" })
    .click();
  await expect(
    page.getByText("No scheduled workflows are associated with this agent."),
  ).toBeVisible();
  backend.rows = [scheduledRow({ block_reason: "unsupported_manual_profile" })];
  await page
    .getByRole("button", { name: "Refresh scheduled workflows" })
    .click();
  await expect(
    page.getByText("This workflow does not support manual execution."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run now Morning brief" }),
  ).toBeDisabled();
  expect(backend.posts).toHaveLength(0);
  backend.failGet = true;
  backend.getStatus = 403;
  await page
    .getByRole("button", { name: "Refresh scheduled workflows" })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Only the current workspace owner" }),
  ).toBeVisible();
  await expect(
    page.getByTestId(`scheduled-workflow-${SCHEDULED_ID}`),
  ).toHaveCount(0);
});

test("unknown actual history, paused state, elapsed cooldown and verified results render safely", async ({
  page,
}, testInfo) => {
  const backend = manualBackend();
  backend.rows = [
    scheduledRow({
      enabled: false,
      block_reason: "workflow_disabled",
      last_run: runEvidence("unknown", {
        origin: "scheduled",
        accepted_at: null,
        deadline_at: null,
        status: "completed",
      }),
    }),
  ];
  await openScheduledAgent(page, generateSecretKey(), backend);
  await expect(
    page.getByText(
      "Last actual outcome: Unknown — no verified execution evidence",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run now Morning brief" }),
  ).toBeDisabled();
  backend.rows = [
    scheduledRow({
      block_reason: "workflow_cooldown",
      last_run: runEvidence(),
      limits: {
        remaining_workflow: 2,
        remaining_community: 9,
        next_eligible_at: "2000-01-01T00:00:00Z",
        server_now: new Date().toISOString(),
      },
    }),
  ];
  await page
    .getByRole("button", { name: "Refresh scheduled workflows" })
    .click();
  await expect(
    page.getByText(/Awaiting relay eligibility refresh/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run now Morning brief" }),
  ).toBeDisabled();
  const result = page.getByRole("link", { name: "View result", exact: true });
  await expect(result).toHaveAttribute(
    "href",
    `/?channel=${SCHEDULED_CHANNEL}&thread=${RESULT_ID}`,
  );
  expect(backend.posts).toHaveLength(0);
  await waitForAnimations(page);
  await page
    .getByTestId("agent-scheduled-workflows")
    .screenshot({ path: testInfo.outputPath("scheduled-workflows.png") });
});

test("offline activation cannot queue work and focus plus status invalidation refresh current summaries", async ({
  page,
  context,
}) => {
  const backend = manualBackend();
  const viewerSecret = generateSecretKey();
  const viewer = getPublicKey(viewerSecret);
  await openScheduledAgent(page, viewerSecret, backend);
  const run = page.getByRole("button", {
    name: "Run now Morning brief",
    exact: true,
  });
  await expect(run).toBeEnabled();
  await context.setOffline(true);
  await expect(run).toBeDisabled();
  await expect(
    page.getByText("Offline. No workflow requests are queued."),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(run).toBeEnabled();
  expect(backend.posts).toHaveLength(0);
  const before = backend.gets;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => backend.gets).toBeGreaterThan(before);
  backend.rows = [scheduledRow({ block_reason: "permission_revoked" })];
  await page.evaluate((viewer) => {
    const helpers = window as typeof window & {
      __BUZZ_WEB_E2E_EMIT__: (event: unknown) => void;
      __BUZZ_WEB_E2E_EVENT__: (...args: unknown[]) => unknown;
    };
    helpers.__BUZZ_WEB_E2E_EMIT__(
      helpers.__BUZZ_WEB_E2E_EVENT__(
        46042,
        "d".repeat(64),
        [
          ["p", viewer],
          ["d", "33333333-3333-4333-8333-333333333333"],
        ],
        "{}",
        "invalidation",
      ),
    );
  }, viewer);
  await expect(
    page.getByText(
      "Current agent or channel permissions do not allow this run.",
    ),
  ).toBeVisible();
  await expect(run).toBeDisabled();
});

test("visible 15-second polling repairs a missed update without starting work", async ({
  page,
}) => {
  const backend = manualBackend();
  await openScheduledAgent(page, generateSecretKey(), backend);
  await expect(
    page.getByRole("button", { name: "Run now Morning brief" }),
  ).toBeEnabled();
  backend.rows = [
    scheduledRow({
      block_reason: "workflow_active",
      last_run: runEvidence("running"),
    }),
  ];
  await expect(page.getByText("Last actual outcome: running")).toBeVisible({
    timeout: 20_000,
  });
  expect(backend.posts).toHaveLength(0);
});

test("a different extension signer cannot submit an owner workflow command", async ({
  page,
}) => {
  const backend = manualBackend();
  await openScheduledAgent(page, generateSecretKey(), backend);
  const otherSecret = generateSecretKey();
  await page.exposeFunction(
    "__WORKFLOW_SIGN__",
    (event: Parameters<typeof finalizeEvent>[0]) =>
      finalizeEvent(event, otherSecret),
  );
  await page.evaluate((pubkey) => {
    const runtime = window as typeof window & {
      __WORKFLOW_SIGN__: (event: unknown) => Promise<never>;
    };
    window.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: (event) => runtime.__WORKFLOW_SIGN__(event),
    };
  }, getPublicKey(otherSecret));
  await page.getByRole("button", { name: "Run now Morning brief" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "signing account does not match" })
      .first(),
  ).toBeVisible();
  expect(backend.posts).toHaveLength(0);
});

test("leaving the identity partition during signing cancels the command before transport", async ({
  page,
}) => {
  const backend = manualBackend();
  const secret = generateSecretKey();
  await openScheduledAgent(page, secret, backend);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signing = false;
  await page.exposeFunction(
    "__WORKFLOW_SIGN__",
    async (event: Parameters<typeof finalizeEvent>[0]) => {
      if (event.kind === 46020) {
        signing = true;
        await gate;
      }
      return finalizeEvent(event, secret);
    },
  );
  await page.evaluate((pubkey) => {
    const runtime = window as typeof window & {
      __WORKFLOW_SIGN__: (event: unknown) => Promise<never>;
    };
    window.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: (event) => runtime.__WORKFLOW_SIGN__(event),
    };
  }, getPublicKey(secret));
  await page.getByRole("button", { name: "Run now Morning brief" }).click();
  await expect.poll(() => signing).toBe(true);
  await page.locator('a[href="/settings"]').last().click();
  await page.getByRole("button", { name: "Lock and sign out" }).click();
  release();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Vikram" }),
  ).toBeVisible();
  expect(backend.posts).toHaveLength(0);
  await expect(page.getByTestId("agent-scheduled-workflows")).toHaveCount(0);
});
