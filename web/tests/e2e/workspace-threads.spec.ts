import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("thread summary bar stays collapsed and opens the focused thread panel", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const viewerPubkey = getPublicKey(secretKey);
  const rootId = "6".padStart(64, "0");
  await installWorkspaceRelayMock(page, viewerPubkey);
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page
    .getByLabel("Password", { exact: true })
    .fill("thread-test-password");
  await page.getByLabel("Confirm password").fill("thread-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();

  const summaryBar = page.getByTestId(`thread-summary-${rootId}`);
  await expect(summaryBar).toBeVisible();
  await expect(summaryBar).toContainText("1 reply");

  // Replies stay collapsed — there is no inline thread section in the timeline.
  await expect(page.getByTestId(`inline-thread-${rootId}`)).toHaveCount(0);
  await expect(page.getByText("A threaded reply")).toHaveCount(0);

  // Clicking the summary bar opens the focused thread panel (not inline).
  await summaryBar.click();
  await expect(page.getByRole("heading", { name: "Thread" })).toBeVisible();
  await expect(page.getByText("A threaded reply")).toBeVisible();

  // The hover "Reply" action opens the same panel rather than an inline composer.
  await page.getByLabel("Close thread").click();
  await expect(page.getByRole("heading", { name: "Thread" })).toBeHidden();

  const rootArticle = page
    .getByText("Welcome to Buzz")
    .locator("xpath=ancestor::article");
  await rootArticle.hover();
  await rootArticle.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Thread" })).toBeVisible();
});
