import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("reminders are URL-addressable and publish an encrypted author-only event", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const viewerPubkey = getPublicKey(secretKey);
  await installWorkspaceRelayMock(page, viewerPubkey);
  await page.goto("/reminders");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page
    .getByLabel("Password", { exact: true })
    .fill("reminder-test-password");
  await page.getByLabel("Confirm password").fill("reminder-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("reminders-page")).toBeVisible();

  // The route must remain independently usable after a normal hard refresh;
  // it should not wait for the workspace channel catalog before rendering.
  await page.reload();
  await expect(page.getByTestId("reminders-page")).toBeVisible();
  await expect(page.getByText("Connecting to VarVik Studios…")).toHaveCount(0);

  await page.getByLabel("Remind me").fill("Review the private draft");
  await page.getByRole("button", { name: "Create reminder" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              content: string;
              pubkey: string;
              tags: string[][];
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.filter((event) => event.kind === 30300),
      ),
    )
    .toHaveLength(1);

  const reminder = await page.evaluate(() =>
    (
      window as typeof window & {
        __BUZZ_WEB_E2E_PUBLISHED__: Array<{
          kind: number;
          content: string;
          pubkey: string;
          tags: string[][];
        }>;
      }
    ).__BUZZ_WEB_E2E_PUBLISHED__.find((event) => event.kind === 30300),
  );
  expect(reminder).toMatchObject({ kind: 30300, pubkey: viewerPubkey });
  expect(reminder?.content).not.toContain("Review the private draft");
  expect(reminder?.tags).toEqual(
    expect.arrayContaining([
      expect.arrayContaining(["d"]),
      expect.arrayContaining(["not_before"]),
    ]),
  );
});
