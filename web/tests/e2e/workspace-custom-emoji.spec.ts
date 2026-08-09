import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("workspace emoji set management inserts self-contained composer and reaction tags", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const viewerPubkey = getPublicKey(secretKey);
  await installWorkspaceRelayMock(page, viewerPubkey);
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page.getByLabel("Password", { exact: true }).fill("emoji-password");
  await page.getByLabel("Confirm password").fill("emoji-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByLabel("Message general")).toBeVisible();

  await page.getByLabel("Insert custom emoji").click();
  await page.getByLabel("Custom emoji name").fill("party");
  await page
    .getByLabel("Custom emoji image URL")
    .fill("https://example.test/party.png");
  await page.getByLabel("Save custom emoji").click();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              tags: string[][];
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.some((event) => event.kind === 30030),
      ),
    )
    .toBe(true);
  await expect(page.getByLabel("Use :party:")).toBeVisible();
  await page.getByLabel("Use :party:").click();
  await expect(page.getByLabel("Message general")).toHaveValue(":party:");
  await page.getByLabel("Send message").click();

  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              content: string;
              tags: string[][];
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.find(
          (event) => event.kind === 9 && event.content === ":party:",
        ),
      ),
    )
    .toMatchObject({
      tags: expect.arrayContaining([
        ["emoji", "party", "https://example.test/party.png"],
      ]),
    });
  const welcome = page
    .getByText("Welcome to Buzz")
    .locator("xpath=ancestor::article");
  await welcome.hover();
  await welcome.getByLabel("Choose custom reaction").click();
  await welcome.getByLabel("Use :party:").click();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              content: string;
              tags: string[][];
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.find(
          (event) => event.kind === 7 && event.content === ":party:",
        ),
      ),
    )
    .toMatchObject({
      tags: expect.arrayContaining([
        ["emoji", "party", "https://example.test/party.png"],
      ]),
    });
});
