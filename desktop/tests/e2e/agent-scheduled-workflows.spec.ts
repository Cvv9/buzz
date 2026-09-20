import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import type { MockScheduledWorkflows } from "../../src/testing/e2eBridgeScheduledWorkflows";

const AGENT = "8f44f5ed".repeat(8);
const OWNER = "deadbeef".repeat(8);
const CHANNEL = "94a444a4-c0a3-5966-ab05-530c6ddc2301";
const WF = "22222222-2222-2222-2222-222222222222";
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workflow_id: WF,
    name: "Daily brief",
    definition_hash: "ab".repeat(32),
    agent_targets: [AGENT],
    channel_id: CHANNEL,
    schedule: { on: "schedule", cron: "0 9 * * *" },
    timezone: "UTC",
    next_scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    enabled: true,
    last_run: null,
    limits: {
      remaining_workflow: 3,
      remaining_community: 10,
      next_eligible_at: new Date().toISOString(),
      server_now: new Date().toISOString(),
    },
    block_reason: null,
    revision: 0,
    ...overrides,
  };
}
async function setup(
  page: Page,
  settings: MockScheduledWorkflows,
  role: "owner" | "admin" | "member" = "owner",
  skipCommunitySeed = false,
) {
  await installMockBridge(
    page,
    {
      relayRole: role,
      relayRequiresMembership: true,
      scheduledWorkflows: { ownerPubkey: OWNER, ...settings },
      relayAgents: [
        {
          pubkey: AGENT,
          name: "Lanaya",
          agentType: "codex",
          audience: "owner",
          ownerPubkey: OWNER,
          accessTier: "personal",
          channelNames: ["agents"],
          model: "gpt-5.5",
        },
      ],
    },
    { skipCommunitySeed },
  );
  await page.goto("/");
  await page.getByTestId("open-agents-view").click();
  await page.getByTestId(`hosted-agent-${AGENT}`).click();
  await page.getByTestId("user-profile-header-edit-agent").click();
  await expect(page.getByTestId("hosted-agent-edit-dialog")).toBeVisible();
}
async function countCommands(page: Page, command: string) {
  return page.evaluate(
    (name) =>
      window.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
        (item) => item.command === name,
      ).length ?? 0,
    command,
  );
}
async function payloads(page: Page, command: string) {
  return page.evaluate(
    (name) =>
      window.__BUZZ_E2E_COMMAND_PAYLOADS__
        ?.filter((item) => item.command === name)
        .map((item) => item.payload) ?? [],
    command,
  );
}

test("owner runs once with keyboard; actual queued state and limits replace dispatch guesses", async ({
  page,
}) => {
  await setup(page, { rows: [row()], prepareDelayMs: 300, submitDelayMs: 300 });
  await expect(page.getByTestId("agent-scheduled-workflows")).toContainText(
    "not a spending cap",
  );
  await page.getByTestId("hosted-agent-name").fill("Unsaved rename");
  const play = page.getByRole("button", {
    name: "Run now Daily brief",
    exact: true,
  });
  await expect(play).toBeEnabled();
  await play.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("workflow-actual-outcome")).toHaveText(
    "queued",
  );
  await expect(page.getByTestId(`scheduled-workflow-${WF}`)).toContainText(
    "2/3 workflow",
  );
  expect(await countCommands(page, "prepare_manual_workflow")).toBe(1);
  expect(await countCommands(page, "submit_manual_workflow")).toBe(1);
  await expect(page.getByTestId("hosted-agent-name")).toHaveValue(
    "Unsaved rename",
  );
  await expect(play).toBeDisabled();
  await waitForAnimations(page);
  await page.getByTestId("agent-scheduled-workflows").screenshot({
    path: "test-results/screenshots/agent-scheduled-queued.png",
  });
});

test("lost receipt retries identical signed bytes without charging another run", async ({
  page,
}) => {
  await setup(page, { rows: [row()], loseReceiptOnce: true });
  await page
    .getByRole("button", { name: "Run now Daily brief", exact: true })
    .click();
  await expect(
    page.getByText(
      "Outcome unconfirmed. Check status or retry this same request.",
    ),
  ).toBeVisible();
  const retry = page.getByRole("button", {
    name: "Retry same request for Daily brief",
    exact: true,
  });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(
    page.getByText("Run accepted. Refreshing actual status…"),
  ).toBeVisible();
  expect(await countCommands(page, "prepare_manual_workflow")).toBe(1);
  const sent = await payloads(page, "submit_manual_workflow");
  expect(sent).toHaveLength(2);
  expect(sent[0]).toEqual(sent[1]);
  await expect(page.getByTestId(`scheduled-workflow-${WF}`)).toContainText(
    "2/3 workflow",
  );
});

for (const role of ["admin", "member"] as const) {
  test(`${role} can edit presentation but cannot see scheduled owner controls`, async ({
    page,
  }) => {
    await setup(page, { rows: [row()] }, role);
    await expect(page.getByTestId("hosted-agent-name")).toBeVisible();
    await expect(page.getByTestId("agent-scheduled-workflows")).toHaveCount(0);
    expect(await countCommands(page, "get_agent_scheduled_workflows")).toBe(0);
  });
}

test("separates loading, error, and empty responses", async ({ page }) => {
  await setup(page, { rows: [], readDelayMs: 1200, readError: true });
  await expect(page.getByText("Loading scheduled workflows…")).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not refresh scheduled workflows" }),
  ).toBeVisible();
  await expect(
    page.getByText("No scheduled workflows are connected to this agent."),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const config = window.__BUZZ_E2E__?.mock?.scheduledWorkflows;
    if (config) {
      config.readError = false;
      config.readDelayMs = 0;
    }
  });
  await page
    .getByRole("button", { name: "Refresh scheduled workflows" })
    .click();
  await expect(
    page.getByText("No scheduled workflows are connected to this agent."),
  ).toBeVisible();
});

test("paused, unsupported, unknown and actual failed rows stay truthful across pagination", async ({
  page,
}) => {
  await setup(page, {
    pageSize: 2,
    rows: [
      row({
        name: "Paused brief",
        enabled: false,
        block_reason: "workflow_disabled",
      }),
      row({
        workflow_id: "33333333-3333-3333-3333-333333333333",
        name: "Unsupported brief",
        block_reason: "unsupported_manual_profile",
      }),
      row({
        workflow_id: "44444444-4444-4444-4444-444444444444",
        name: "Earlier brief",
        last_run: {
          id: WF,
          status: "completed",
          execution_state: "stalled",
          safe_error_code: "legacy_execution_unknown",
          revision: 1,
          results: [],
        },
        block_reason: "workflow_active",
      }),
    ],
  });
  await expect(
    page.getByRole("button", { name: "Run now Paused brief", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Run now Unsupported brief",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Load more workflows" }).click();
  await expect(
    page.getByText(
      "The earlier run’s outcome is unknown. Operator recovery is required.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("workflow-actual-outcome").last()).toHaveText(
    "stalled",
  );
});

test("offline does not queue and reconnect refreshes without sending a command", async ({
  page,
}) => {
  await setup(page, { rows: [row()] });
  const play = page.getByRole("button", {
    name: "Run now Daily brief",
    exact: true,
  });
  await expect(play).toBeEnabled();
  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.("disconnected"),
  );
  await expect(play).toBeDisabled();
  await expect(
    page.getByText(
      "Reconnect to load or run workflows. Nothing will be queued.",
    ),
  ).toBeVisible();
  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.("connected"),
  );
  await expect(play).toBeEnabled();
  expect(await countCommands(page, "prepare_manual_workflow")).toBe(0);
  expect(await countCommands(page, "submit_manual_workflow")).toBe(0);
});

test("closing while preparing cancels dispatch without replay on reopening", async ({
  page,
}) => {
  await setup(page, { rows: [row()], prepareDelayMs: 1200 });
  await page
    .getByRole("button", { name: "Run now Daily brief", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForTimeout(1300);
  await page.getByTestId("user-profile-header-edit-agent").click();
  await expect(
    page.getByRole("button", { name: "Run now Daily brief", exact: true }),
  ).toBeEnabled();
  expect(await countCommands(page, "submit_manual_workflow")).toBe(0);
});

test("46042 invalidates summaries and only validated same-channel results navigate", async ({
  page,
}) => {
  await setup(page, { rows: [row()] });
  await expect(
    page.getByRole("button", { name: "Run now Daily brief", exact: true }),
  ).toBeEnabled();
  const before = await countCommands(page, "get_agent_scheduled_workflows");
  await page.evaluate(
    ({ wf, owner, channel }) => {
      const config = window.__BUZZ_E2E__?.mock?.scheduledWorkflows;
      if (config)
        config.rows[0].last_run = {
          id: wf,
          execution_state: "failed",
          safe_error_code: "provider_error",
          revision: 2,
          results: [
            {
              task_id: wf,
              channel_id: channel,
              event_id: "ab".repeat(32),
              url: "https://attacker.test",
            },
            {
              task_id: "other",
              channel_id: "00000000-0000-0000-0000-000000000000",
              event_id: "cd".repeat(32),
            },
          ],
        };
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "agents",
        content: JSON.stringify({
          version: 1,
          workflow_id: wf,
          run_id: wf,
          revision: 2,
        }),
        kind: 46042,
        extraTags: [
          ["p", owner],
          ["d", wf],
        ],
      });
    },
    { wf: WF, owner: OWNER, channel: CHANNEL },
  );
  await expect
    .poll(() => countCommands(page, "get_agent_scheduled_workflows"))
    .toBeGreaterThan(before);
  await expect(page.getByTestId("workflow-actual-outcome")).toHaveText(
    "failed",
  );
  await expect(
    page.getByRole("button", { name: "View result", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "View result", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`channels/${CHANNEL}.*messageId=${"ab".repeat(32)}`),
  );
});

test("identity change while preparing removes prior queries and cannot send the old request", async ({
  page,
}) => {
  await setup(page, { rows: [row()], prepareDelayMs: 1200 });
  await page
    .getByRole("button", { name: "Run now Daily brief", exact: true })
    .click();
  await page.evaluate(() => {
    const identity = {
      pubkey: "cd".repeat(32),
      displayName: "Changed identity",
    };
    const client = (
      window as unknown as {
        __BUZZ_E2E_QUERY_CLIENT__: import("@tanstack/react-query").QueryClient;
      }
    ).__BUZZ_E2E_QUERY_CLIENT__;
    client.setQueryData(["identity"], identity);
  });
  await page.waitForTimeout(1300);
  expect(await countCommands(page, "submit_manual_workflow")).toBe(0);
  const oldQueries = await page.evaluate((owner) => {
    const client = (
      window as unknown as {
        __BUZZ_E2E_QUERY_CLIENT__: import("@tanstack/react-query").QueryClient;
      }
    ).__BUZZ_E2E_QUERY_CLIENT__;
    return client
      .getQueryCache()
      .getAll()
      .filter(
        (query) =>
          query.queryKey[0] === "agent-scheduled-workflows" &&
          query.queryKey[3] === owner,
      ).length;
  }, OWNER);
  expect(oldQueries).toBe(0);
});

test("visible polling repairs a missed invalidation without inventing completion", async ({
  page,
}) => {
  await setup(page, {
    rows: [
      row({
        last_run: {
          id: WF,
          execution_state: "running",
          revision: 1,
          results: [],
        },
        block_reason: "workflow_active",
      }),
    ],
  });
  await expect(page.getByTestId("workflow-actual-outcome")).toHaveText(
    "running",
  );
  await page.evaluate((wf) => {
    const config = window.__BUZZ_E2E__?.mock?.scheduledWorkflows;
    if (config)
      config.rows[0].last_run = {
        id: wf,
        execution_state: "completed",
        revision: 2,
        results: [],
      };
  }, WF);
  await expect(page.getByTestId("workflow-actual-outcome")).toHaveText(
    "completed",
    { timeout: 18000 },
  );
});

test("eligible never-run workflow with no next-eligible timestamp says available now", async ({
  page,
}) => {
  const workflow = row();
  (workflow.limits as Record<string, unknown>).next_eligible_at = null;
  await setup(page, { rows: [workflow] });
  await expect(
    page.getByRole("button", { name: "Run now Daily brief", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId(`scheduled-workflow-${WF}`)).toContainText(
    "Available now",
  );
});

test("community switch during preparation sends nothing and removes the previous community summary", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "buzz-communities",
      JSON.stringify([
        {
          id: "workflow-alpha",
          name: "Alpha",
          relayUrl: "ws://localhost:3000",
          addedAt: "2026-09-20T00:00:00Z",
        },
        {
          id: "workflow-bravo",
          name: "Bravo",
          relayUrl: "ws://localhost:3001",
          addedAt: "2026-09-20T00:00:00Z",
        },
      ]),
    );
    localStorage.setItem("buzz-active-community-id", "workflow-alpha");
  });
  const alpha = row({ name: "Alpha-only brief" });
  await setup(
    page,
    {
      rows: [],
      rowsByRelay: {
        "ws://localhost:3000": [alpha],
        "ws://localhost:3001": [],
      },
      prepareDelayMs: 2500,
    },
    "owner",
    true,
  );
  await page
    .getByRole("button", { name: "Run now Alpha-only brief", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByTestId("community-rail-button-workflow-bravo").click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("buzz-active-community-id")),
    )
    .toBe("workflow-bravo");
  await page.getByTestId("open-agents-view").click();
  await page.getByTestId(`hosted-agent-${AGENT}`).click();
  await page.getByTestId("user-profile-header-edit-agent").click();
  await expect(
    page.getByText("No scheduled workflows are connected to this agent."),
  ).toBeVisible();
  await expect(page.getByTestId("agent-scheduled-workflows")).not.toContainText(
    "Alpha-only brief",
  );
  await page.waitForTimeout(2600);
  expect(await countCommands(page, "submit_manual_workflow")).toBe(0);
  const reads = (await payloads(
    page,
    "get_agent_scheduled_workflows",
  )) as Array<{ scope: { relay_url: string } }>;
  expect(
    reads.some((read) => read.scope.relay_url === "ws://localhost:3000"),
  ).toBe(true);
  expect(reads.at(-1)?.scope.relay_url).toBe("ws://localhost:3001");
});

test("focus alone refreshes a changed outcome before the polling interval", async ({
  page,
}) => {
  await setup(page, {
    rows: [
      row({
        last_run: {
          id: WF,
          execution_state: "running",
          revision: 1,
          results: [],
        },
        block_reason: "workflow_active",
      }),
    ],
  });
  await expect(page.getByTestId("workflow-actual-outcome")).toHaveText(
    "running",
  );
  const before = await countCommands(page, "get_agent_scheduled_workflows");
  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false,
    });
    window.dispatchEvent(new Event("blur"));
  });
  await page.waitForTimeout(100);
  await page.evaluate((wf) => {
    const config = window.__BUZZ_E2E__?.mock?.scheduledWorkflows;
    if (config)
      config.rows[0].last_run = {
        id: wf,
        execution_state: "completed",
        revision: 2,
        results: [],
      };
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => true,
    });
    window.dispatchEvent(new Event("focus"));
  }, WF);
  await expect(page.getByTestId("workflow-actual-outcome")).toHaveText(
    "completed",
    { timeout: 5000 },
  );
  expect(
    await countCommands(page, "get_agent_scheduled_workflows"),
  ).toBeGreaterThan(before);
});
