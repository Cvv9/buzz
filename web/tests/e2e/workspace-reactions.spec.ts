import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("reactions toggle immediately, delete their exact event, and identify reactors", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const viewerPubkey = getPublicKey(secretKey);
  await installWorkspaceRelayMock(page, viewerPubkey);
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page
    .getByLabel("Password", { exact: true })
    .fill("reaction-test-password");
  await page.getByLabel("Confirm password").fill("reaction-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();

  const rootMessage = page
    .getByText("Welcome to Buzz")
    .locator("xpath=ancestor::article");
  const existingReaction = rootMessage.getByRole("button", {
    name: "👍 reaction from Workspace Agent 1; click to add your reaction",
  });
  await expect(existingReaction).toBeVisible();
  await existingReaction.hover();
  await expect(page.getByText("Reacted by Workspace Agent 1")).toBeVisible();

  await rootMessage.hover();
  await rootMessage.getByLabel("React with ✅").click();
  const ownReaction = rootMessage.getByRole("button", {
    name: "✅ reaction from You; click to remove your reaction",
  });
  await expect(ownReaction).toBeVisible();
  await ownReaction.hover();
  await expect(page.getByText("Reacted by You")).toBeVisible();

  // This follows the first click before its relay acknowledgement: the queued
  // removal looks up and deletes the authoritative kind-7 event once present.
  await ownReaction.click();
  await expect(ownReaction).toBeHidden();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              id: string;
              kind: number;
              tags: string[][];
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.filter(
          (published) => published.kind === 7 || published.kind === 5,
        ),
      ),
    )
    .toHaveLength(2);
  const [added, deleted] = await page.evaluate(() =>
    (
      window as typeof window & {
        __BUZZ_WEB_E2E_PUBLISHED__: Array<{
          id: string;
          kind: number;
          tags: string[][];
        }>;
      }
    ).__BUZZ_WEB_E2E_PUBLISHED__.filter(
      (published) => published.kind === 7 || published.kind === 5,
    ),
  );
  expect(added.kind).toBe(7);
  expect(deleted.kind).toBe(5);
  expect(deleted.tags).toContainEqual(["e", added.id]);
});
