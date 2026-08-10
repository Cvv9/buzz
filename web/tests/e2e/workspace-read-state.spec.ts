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
  await page.addInitScript(() => {
    localStorage.removeItem("buzz.web.active-channel");
  });
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page
    .getByLabel("Password", { exact: true })
    .fill("read-state-password");
  await page.getByLabel("Confirm password").fill("read-state-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByRole("button", { name: "general", exact: true }).click();
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();

  await expect(
    page.getByTestId("workspace-sidebar").getByText(/^Channels\s+\d+$/, {
      exact: true,
    }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "random", exact: true }).click();
  await page.evaluate((ownPubkey) => {
    const helpers = window as typeof window & {
      __BUZZ_WEB_E2E_RECEIVE__: (event: unknown) => void;
      __BUZZ_WEB_E2E_EVENT__: (
        kind: number,
        pubkey: string,
        tags: string[][],
        content: string,
        suffix: string,
        createdAt: number,
      ) => unknown;
    };
    for (let index = 0; index < 40; index += 1) {
      helpers.__BUZZ_WEB_E2E_RECEIVE__(
        helpers.__BUZZ_WEB_E2E_EVENT__(
          9,
          ownPubkey,
          [["h", "random"]],
          `Previously read ${index + 1}`,
          `history-${index}`,
          100 + index,
        ),
      );
    }
  }, viewerPubkey);
  await page.getByRole("button", { name: "general", exact: true }).click();
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();

  await page.evaluate(() => {
    const helpers = window as typeof window & {
      __BUZZ_WEB_E2E_RECEIVE__: (event: unknown) => void;
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
      ["unread-one", 200],
      ["unread-two", 201],
    ] as const) {
      helpers.__BUZZ_WEB_E2E_RECEIVE__(
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
    page.getByText("Unread unread-one", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByTestId("workspace-timeline")
        .getAttribute("data-anchor-applied"),
    )
    .toBe("unread");
  const anchorState = await page
    .getByTestId("workspace-timeline")
    .evaluate((timeline) => ({
      anchorApplied: timeline.dataset.anchorApplied ?? "",
      anchorMessageId: timeline.dataset.anchorMessageId ?? "",
      clientHeight: timeline.clientHeight,
      firstUnreadMessageId: timeline.dataset.firstUnreadMessageId ?? "",
      scrollHeight: timeline.scrollHeight,
      scrollTop: timeline.scrollTop,
    }));
  expect(anchorState.anchorApplied).toBe("unread");
  expect(anchorState.anchorMessageId).toBe("unread-one".padStart(64, "0"));
  expect(anchorState.scrollHeight).toBeGreaterThan(anchorState.clientHeight);
  expect(anchorState.scrollTop).toBeGreaterThan(0);
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
  await page.addInitScript(() => {
    localStorage.removeItem("buzz.web.active-channel");
  });
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
  await page.getByRole("button", { name: "general", exact: true }).click();
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();
  await page.waitForTimeout(100);

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
      __BUZZ_WEB_E2E_RECEIVE__: (event: unknown) => void;
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
      helpers.__BUZZ_WEB_E2E_RECEIVE__(
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
  expect(
    await page.evaluate(() => localStorage.getItem("buzz.web.active-channel")),
  ).toBe("general");

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
