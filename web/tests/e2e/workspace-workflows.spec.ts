import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
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
