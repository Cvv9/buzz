import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const ACTIVE_AGENT = TEST_IDENTITIES.alice.pubkey;
const STOPPED_AGENT = TEST_IDENTITIES.bob.pubkey;
const OTHER_OWNER_AGENT = TEST_IDENTITIES.charlie.pubkey;
const OUTSIDER = TEST_IDENTITIES.outsider.pubkey;
const INACCESSIBLE_AGENT = "f".repeat(64);

const EMPTY_USAGE = {
  inputTokens: { value: null, incomplete: false },
  outputTokens: { value: null, incomplete: false },
  totalTokens: { value: null, incomplete: false },
  estimatedCostUsd: { value: null, incomplete: false },
  cacheReadTokens: { value: null, incomplete: false },
  cacheWriteTokens: { value: null, incomplete: false },
  freshInputTokens: { value: null, incomplete: false },
};

const ARCHIVE_DISABLED_USAGE = {
  collectionEnabled: false,
  buckets: [],
  agents: [],
  coverage: {
    firstArchivedAt: null,
    lastArchivedAt: null,
    firstReportedAt: null,
    lastReportedAt: null,
    reportCount: 0,
    invalidReportCount: 0,
    hasUnknownUsage: false,
  },
  hasArchivedEvidence: null,
};

async function waitForFleetBridge(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () =>
      typeof (window as Window & { __BUZZ_E2E_SEED_ACTIVE_TURNS__?: unknown })
        .__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
}

test("My agents fleet keeps owner operations private and labels reported usage", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: ACTIVE_AGENT,
        name: "Atlas",
        status: "running",
      },
      {
        pubkey: STOPPED_AGENT,
        name: "Beacon",
        status: "stopped",
      },
      {
        pubkey: OTHER_OWNER_AGENT,
        name: "Checkpointer",
        status: "running",
        lastError: "private runtime detail",
      },
    ],
    relayAgents: [
      {
        pubkey: OUTSIDER,
        name: "Not mine",
        audience: "owner",
        ownerPubkey: OUTSIDER,
      },
    ],
    agentUsageSeries: {
      collectionEnabled: true,
      buckets: [],
      agents: [
        {
          agentPubkey: ACTIVE_AGENT,
          usage: {
            ...EMPTY_USAGE,
            totalTokens: { value: "1200", incomplete: false },
            estimatedCostUsd: { value: 0.0123, incomplete: false },
          },
          buckets: [],
          models: [
            {
              harness: "acp",
              model: "gpt-test",
              usage: EMPTY_USAGE,
              reportCount: 1,
              hasUnknownUsage: false,
            },
          ],
          reportCount: 1,
          hasUnknownUsage: false,
        },
      ],
      coverage: {
        firstArchivedAt: null,
        lastArchivedAt: null,
        firstReportedAt: null,
        lastReportedAt: null,
        reportCount: 1,
        invalidReportCount: 0,
        hasUnknownUsage: false,
      },
      hasArchivedEvidence: null,
    },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForFleetBridge(page);
  await page.evaluate((agentPubkey) => {
    (
      window as Window & {
        __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (input: {
          agentPubkey: string;
          channelId: string;
          turnId: string;
        }) => void;
      }
    ).__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
      agentPubkey,
      channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
      turnId: "fleet-turn",
    });
  }, ACTIVE_AGENT);

  await page.getByTestId("open-agents-view").click();

  const fleet = page.getByRole("region", { name: "My agents" });
  await expect(fleet.getByRole("heading", { name: "My agents" })).toBeVisible();
  await expect(fleet.getByRole("button", { name: "New agent" })).toBeVisible();
  await expect(fleet).toContainText("last 7 days");

  const atlas = page.getByTestId(`agent-fleet-row-${ACTIVE_AGENT}`);
  await expect(atlas).toContainText("Working");
  await expect(atlas).toContainText("Activity details unavailable");
  await expect(atlas).toContainText("Working for");
  await expect(atlas).toContainText("Model: gpt-test (reported)");
  await expect(atlas).toContainText("Tokens: 1.2k reported");
  await expect(atlas).toContainText("Cost: ~$0.0123 reported estimate");
  await expect(atlas).not.toContainText("general");

  expect(
    (await page.getByTestId("agent-defaults-button").boundingBox())?.height,
  ).toBeGreaterThanOrEqual(44);
  expect(
    (
      await page
        .getByRole("button", { name: "Stop running agents" })
        .boundingBox()
    )?.height,
  ).toBeGreaterThanOrEqual(44);

  if (process.env.BUZZ_CAPTURE_AGENT_FLEET === "1") {
    await waitForAnimations(page);
    await page.screenshot({
      path: "../.impeccable/evidence/agent-operations-fleet-wide.png",
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 720, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(page.getByTestId("agent-actions-menu-trigger")).toBeVisible();
  expect(
    (await page.getByTestId("agent-actions-menu-trigger").boundingBox())
      ?.height,
  ).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 720, height: 900 });
  if (process.env.BUZZ_CAPTURE_AGENT_FLEET === "1") {
    await waitForAnimations(page);
    await page.screenshot({
      path: "../.impeccable/evidence/agent-operations-fleet-narrow.png",
      fullPage: true,
    });
  }

  await page.evaluate((agentPubkey) => {
    (
      window as Window & {
        __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (input: {
          agentPubkey: string;
          channelId: string;
          turnId: string;
          kind: "turn_completed";
        }) => void;
      }
    ).__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
      agentPubkey,
      channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
      turnId: "fleet-turn",
      kind: "turn_completed",
    });
  }, ACTIVE_AGENT);
  await expect(atlas).toContainText("Idle");

  await expect(
    page.getByTestId(`agent-fleet-row-${OTHER_OWNER_AGENT}`),
  ).toContainText("Needs attention");
  await expect(page.getByTestId(`agent-fleet-row-${OUTSIDER}`)).toHaveCount(0);

  await fleet.getByRole("button", { name: "Stopped" }).click();
  await expect(
    page.getByTestId(`agent-fleet-row-${STOPPED_AGENT}`),
  ).toBeVisible();
  await expect(atlas).toHaveCount(0);

  const stoppedFilter = fleet.getByRole("button", { name: "Stopped" });
  expect((await stoppedFilter.boundingBox())?.height).toBeGreaterThanOrEqual(
    44,
  );
  expect(
    (await fleet.getByRole("button", { name: "New agent" }).boundingBox())
      ?.height,
  ).toBeGreaterThanOrEqual(44);
});

test("agents and workflows expose the selected page to assistive technology", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByTestId("open-agents-view").click();
  await expect(page.getByTestId("open-agents-view")).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByTestId("open-workflows-view").click();
  await expect(page.getByTestId("open-workflows-view")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("open-agents-view")).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("My agents recovers unavailable usage, explains archive state, and exposes inaccessible activity", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: INACCESSIBLE_AGENT,
        name: "Private archive agent",
        status: "stopped",
      },
    ],
    agentUsageSeries: ARCHIVE_DISABLED_USAGE,
    agentUsageSeriesError: "Local usage archive is temporarily unavailable",
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-agents-view").click();

  const fleet = page.getByRole("region", { name: "My agents" });
  await expect(fleet.getByText("Usage is unavailable")).toBeVisible();

  const privateAgent = page.getByTestId(
    `agent-fleet-row-${INACCESSIBLE_AGENT}`,
  );
  const activityButton = privateAgent.getByRole("button", {
    name: "View Private archive agent's activity unavailable",
  });
  const unavailableDescriptionId = `agent-fleet-activity-unavailable-${INACCESSIBLE_AGENT}`;
  await expect(activityButton).toBeDisabled();
  await expect(activityButton).toHaveAttribute(
    "aria-describedby",
    unavailableDescriptionId,
  );
  await expect(page.locator(`#${unavailableDescriptionId}`)).toHaveText(
    "Activity is available only in channels you can open.",
  );

  await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E__?: {
        mock?: { agentUsageSeriesError?: string };
      };
    };
    delete testWindow.__BUZZ_E2E__?.mock?.agentUsageSeriesError;
  });
  await fleet.getByRole("button", { name: "Retry" }).click();
  await expect(fleet.getByText("Usage is unavailable")).toHaveCount(0);
  await expect(
    fleet.getByText(
      "Turn metrics are not being archived on this device. Turn on metric archiving to retain reported usage here.",
    ),
  ).toBeVisible();

  await fleet.getByRole("button", { name: "Archive settings" }).click();
  await expect(page.getByTestId("settings-local-archive")).toBeVisible();
});
