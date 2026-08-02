import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("thread reply counts expand inline and open the panel only on double-click", async ({
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

  const replyCount = page.getByTestId(`thread-reply-count-${rootId}`);
  const inlineThread = page.getByTestId(`inline-thread-${rootId}`);
  await expect(replyCount).toHaveAttribute("aria-expanded", "false");

  await replyCount.click();
  await expect(inlineThread).toBeVisible();
  await expect(replyCount).toHaveAttribute("aria-expanded", "true");
  await expect(inlineThread.getByText("A threaded reply")).toBeVisible();
  await expect(inlineThread.getByLabel("Message general")).toBeVisible();

  await replyCount.click();
  await expect(inlineThread).toBeHidden();
  await expect(replyCount).toHaveAttribute("aria-expanded", "false");

  const rootArticle = page
    .getByText("Welcome to Buzz")
    .locator("xpath=ancestor::article");
  await rootArticle.hover();
  await rootArticle.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(inlineThread).toBeVisible();
  await inlineThread.getByRole("button", { name: "Cancel reply" }).click();
  await expect(inlineThread).toBeHidden();

  await replyCount.dblclick();
  await expect(page.getByRole("heading", { name: "Thread" })).toBeVisible();
  await expect(inlineThread).toBeHidden();
});
