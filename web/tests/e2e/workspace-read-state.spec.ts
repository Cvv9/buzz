import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("channel badges show the unread count and opening a channel advances its cursor", async ({
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
    .fill("read-state-password");
  await page.getByLabel("Confirm password").fill("read-state-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();

  await expect(
    page.getByTestId("workspace-sidebar").getByText(/^Channels\s+\d+$/, {
      exact: true,
    }),
  ).toHaveCount(0);

  await page.evaluate(() => {
    const helpers = window as typeof window & {
      __BUZZ_WEB_E2E_EMIT__: (event: unknown) => void;
      __BUZZ_WEB_E2E_EVENT__: (
        kind: number,
        pubkey: string,
        tags: string[][],
        content: string,
        suffix: string,
        createdAt: number,
      ) => unknown;
    };
    for (const [suffix, createdAt] of [
      ["unread-one", 10],
      ["unread-two", 11],
    ] as const) {
      helpers.__BUZZ_WEB_E2E_EMIT__(
        helpers.__BUZZ_WEB_E2E_EVENT__(
          9,
          "b".repeat(64),
          [["h", "random"]],
          `Unread ${suffix}`,
          suffix,
          createdAt,
        ),
      );
    }
  });

  const randomChannel = page.getByRole("button", {
    name: "random, 2 unread messages",
  });
  await expect(randomChannel).toBeVisible();
  await expect(randomChannel.getByText("2", { exact: true })).toBeVisible();

  await randomChannel.click();
  await expect(
    page.getByRole("button", { name: "random", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /random, \d+ unread messages?/ }),
  ).toHaveCount(0);
});
