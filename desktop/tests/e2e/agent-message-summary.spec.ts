import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

test("machine-heavy agent messages show a human summary by default", async ({
  page,
}) => {
  const agentPubkey = TEST_IDENTITIES.tyler.pubkey;
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agentPubkey,
        name: "Sylars Work Manager",
        status: "running",
        channelNames: ["engineering"],
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("channel-engineering").click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "engineering",
          }) ?? false,
      ),
    )
    .toBe(true);

  const raw = `Actionable alert routed to Sylars Kind: ci-autofix Severity: error Source job: ci-autofix You may diagnose, edit scoped code, and run tests.
Alert findings: [{"action":"issue","url":"https://github.com/acme/clinical-api/issues/92","modelUsage":{"inputTokens":3954},"session_id":"83399480"}]
Report: Scanned 36 repo(s), handled 3 new CI failure(s) (mode: issue).
- Issue for acme/clinical-api (large) — https://github.com/acme/clinical-api/issues/92 Cannot be determined with confidence because the CI payload has no usable diagnostics. ${"dependency output ".repeat(70)}
- Deferred acme/insurance-portal until the model provider is available: provider 500: {"total_cost_usd":0.15,"content_filter":{"violence":{"filtered":false}}}`;

  await page.evaluate(
    ({ content, pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "engineering",
        content,
        pubkey,
      });
    },
    { content: raw, pubkey: agentPubkey },
  );

  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "Actionable alert routed to Sylars" });
  await expect(row).toContainText("Scanned 36 repositories");
  await expect(row).toContainText("usable CI diagnostics were unavailable");
  const rawDetails = row.locator("details pre");
  await expect(rawDetails).not.toBeVisible();
  await expect(rawDetails).toContainText("session_id");
  await expect(rawDetails).toContainText("total_cost_usd");

  await waitForAnimations(page);
  await row.screenshot({
    path: "test-results/agent-message-summary/readable-summary.png",
  });

  await row.getByText("Show raw details").click();
  await expect(rawDetails).toBeVisible();
});
