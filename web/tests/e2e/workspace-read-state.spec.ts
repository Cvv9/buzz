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

test("unread badges survive Agents, Settings, and Reminders until their timeline is viewed", async ({
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
    .fill("navigation-read-state-password");
  await page
    .getByLabel("Confirm password")
    .fill("navigation-read-state-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_HAS_KIND_SUBSCRIPTION__: (kind: number) => boolean;
          }
        ).__BUZZ_WEB_E2E_HAS_KIND_SUBSCRIPTION__(9),
      ),
    )
    .toBe(true);

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
      ["route-unread-one", 20],
      ["route-unread-two", 21],
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

  const unreadRandom = page.getByRole("button", {
    name: "random, 2 unread messages",
  });
  await expect(unreadRandom).toBeVisible();

  await page.getByTestId("workspace-agents-button").click();
  await expect(page.getByTestId("workspace-agents")).toBeVisible();
  await expect(unreadRandom).toBeVisible();

  await page.locator('a[href="/settings"]').last().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.locator('a[href="/reminders"]').first().click();
  await expect(page.getByTestId("reminders-page")).toBeVisible();

  await page.getByLabel("Back to workspace").click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect(unreadRandom).toBeVisible();

  await unreadRandom.click();
  await expect(
    page.getByRole("button", { name: /random, \d+ unread messages?/ }),
  ).toHaveCount(0);
});
