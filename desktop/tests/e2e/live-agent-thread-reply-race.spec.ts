import { expect, test } from "@playwright/test";

import { TEST_IDENTITIES, installMockBridge } from "../helpers/bridge";

const CHANNEL = "general";
const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const STALE_HEAD_DELAY_MS = 1_500;

type MockEvent = { id: string };

async function waitForMockLiveSubscription(
  page: import("@playwright/test").Page,
  kind?: number,
) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ channelName, expectedKind }) =>
          (
            window as Window & {
              __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                channelName: string;
                kind?: number;
              }) => boolean;
            }
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName,
            kind: expectedKind,
          }) ?? false,
        { channelName: CHANNEL, expectedKind: kind },
      ),
    )
    .toBe(true);
}

async function emitRoot(page: import("@playwright/test").Page) {
  return page.evaluate((channelName) => {
    const root = (
      window as Window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          createdAt: number;
        }) => MockEvent;
      }
    ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName,
      content: "Ask the research agent for the market summary.",
      createdAt: 1_700_000_000,
    });
    if (!root) throw new Error("Mock message emitter is not installed.");
    return root;
  }, CHANNEL);
}

test("a direct agent reply survives a stale head fetch and clears thread typing", async ({
  page,
}) => {
  await installMockBridge(page, {
    searchProfiles: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        displayName: "Mirana",
        isAgent: true,
      },
    ],
  });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function",
      ),
    )
    .toBe(true);

  const root = await emitRoot(page);
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText(CHANNEL);
  await waitForMockLiveSubscription(page);
  await waitForMockLiveSubscription(page, 20_002);

  const rootRow = page.locator(`[data-message-id="${root.id}"]`);
  await expect(rootRow).toBeVisible();
  await rootRow.hover();
  await rootRow.getByRole("button", { name: "Reply" }).click();
  const threadPanel = page.getByTestId("message-thread-panel");
  await expect(threadPanel).toBeVisible();

  // Start a refresh that has already read the reply-free head window, then
  // hold its response. This reproduces the production ordering where a live
  // agent answer can arrive while a stale head read is in flight.
  await page.evaluate(
    ({ delayMs, channelId }) => {
      const testWindow = window as Window & {
        __BUZZ_E2E__?: { mock?: Record<string, unknown> };
        __BUZZ_E2E_QUERY_CLIENT__?: {
          invalidateQueries: (input: {
            queryKey: readonly string[];
            exact: boolean;
            refetchType: "active";
          }) => Promise<void>;
        };
        __CHANNEL_WINDOW_INFLIGHT__?: number;
      };
      testWindow.__BUZZ_E2E__ = {
        ...testWindow.__BUZZ_E2E__,
        mock: {
          ...testWindow.__BUZZ_E2E__?.mock,
          channelWindowHeadSnapshotDelayMs: delayMs,
        },
      };
      testWindow.__CHANNEL_WINDOW_INFLIGHT__ = 0;
      void testWindow.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
        queryKey: ["channel-messages", channelId],
        exact: true,
        refetchType: "active",
      });
    },
    { delayMs: STALE_HEAD_DELAY_MS, channelId: CHANNEL_ID },
  );

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __CHANNEL_WINDOW_INFLIGHT__?: number })
            .__CHANNEL_WINDOW_INFLIGHT__ ?? 0,
      ),
    )
    .toBeGreaterThan(0);

  const liveCreatedAt = Math.floor(Date.now() / 1_000);

  await page.evaluate(
    ({ channelName, rootId, agentPubkey, createdAt }) => {
      (
        window as Window & {
          __BUZZ_E2E_EMIT_MOCK_TYPING__?: (input: {
            channelName: string;
            pubkey: string;
            threadHeadId: string;
            createdAt: number;
          }) => unknown;
        }
      ).__BUZZ_E2E_EMIT_MOCK_TYPING__?.({
        channelName,
        pubkey: agentPubkey,
        threadHeadId: rootId,
        createdAt,
      });
    },
    {
      channelName: CHANNEL,
      rootId: root.id,
      agentPubkey: TEST_IDENTITIES.alice.pubkey,
      createdAt: liveCreatedAt,
    },
  );
  const agentActivityTrigger = threadPanel.getByTestId(
    "bot-activity-composer-trigger",
  );
  await expect(agentActivityTrigger).toBeVisible();

  await page.evaluate(
    ({ channelName, rootId, agentPubkey, createdAt }) => {
      const mockWindow = window as Window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          parentEventId?: string;
          pubkey?: string;
          kind?: number;
          createdAt: number;
          extraTags?: string[][];
        }) => MockEvent;
      };
      mockWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName,
        content: "India market research: two cited demand signals are ready.",
        parentEventId: rootId,
        pubkey: agentPubkey,
        kind: 9,
        createdAt: createdAt + 1,
      });
      // The relay independently broadcasts a thread recount. It must not be
      // discarded when the in-flight head response later lands.
      mockWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName,
        content: JSON.stringify({
          reply_count: 1,
          descendant_count: 1,
          last_reply_at: createdAt + 1,
          participants: [agentPubkey],
        }),
        pubkey: agentPubkey,
        kind: 39_005,
        createdAt: createdAt + 2,
        extraTags: [
          ["e", rootId],
          ["d", rootId],
        ],
      });
    },
    {
      channelName: CHANNEL,
      rootId: root.id,
      agentPubkey: TEST_IDENTITIES.alice.pubkey,
      createdAt: liveCreatedAt,
    },
  );

  // These assertions run while the stale page is deliberately blocked: no
  // refresh or page reload is allowed to make the agent answer appear.
  await expect(threadPanel).toContainText(
    "India market research: two cited demand signals are ready.",
  );
  await expect(
    page.locator(
      `[data-testid="message-thread-summary"][data-thread-head-id="${root.id}"]`,
    ),
  ).toContainText("1 reply");
  await expect(agentActivityTrigger).toHaveCount(0);

  // Let the stale snapshot finish and prove it cannot erase the live answer or
  // the relay-pushed summary after the request race resolves.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __CHANNEL_WINDOW_INFLIGHT__?: number })
            .__CHANNEL_WINDOW_INFLIGHT__ ?? 0,
      ),
    )
    .toBe(0);
  await expect(threadPanel).toContainText(
    "India market research: two cited demand signals are ready.",
  );
  await expect(
    page.locator(
      `[data-testid="message-thread-summary"][data-thread-head-id="${root.id}"]`,
    ),
  ).toContainText("1 reply");
});
