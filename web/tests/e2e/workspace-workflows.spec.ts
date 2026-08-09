import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
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
  await page.getByLabel("Open workflows").click();
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
  await page.waitForTimeout(150);
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
  await page.getByRole("button", { name: "Approve" }).click();
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
