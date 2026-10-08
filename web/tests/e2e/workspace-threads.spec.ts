import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("short replies appear inline and the focused thread panel resizes", async ({
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

  const inline = page.getByTestId(`thread-inline-${rootId}`);
  await expect(inline.getByText("A threaded reply")).toBeVisible();
  await expect(page.getByTestId(`thread-summary-${rootId}`)).toHaveCount(0);
  await page.getByTestId(`thread-reply-${rootId}`).click();
  await expect(page.getByRole("heading", { name: "Thread" })).toBeVisible();
  const panel = page.getByTestId("thread-panel");
  await expect(panel.getByText("A threaded reply")).toBeVisible();
  const handle = page.getByRole("separator", { name: "Resize thread panel" });
  await expect(handle).toHaveAttribute("aria-valuenow", "384");
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "408");
  expect((await panel.boundingBox())?.width).toBe(408);
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "320");

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
