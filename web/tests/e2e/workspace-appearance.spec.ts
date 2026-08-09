import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { v2 as nip44 } from "nostr-tools/nip44";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("workspace appearance publishes the desktop-compatible encrypted coordinate", async ({
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
    .fill("appearance-test-password");
  await page.getByLabel("Confirm password").fill("appearance-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();

  const settingsLink = page
    .getByTestId("workspace-sidebar")
    .locator('a[href="/settings"]');
  await expect(settingsLink).toHaveCount(1);
  await expect(
    page.getByTestId("workspace-sidebar").getByText("View profile", {
      exact: true,
    }),
  ).toHaveCount(0);
  await settingsLink.click();
  await expect(page).toHaveURL("/settings");
  await expect(page.getByTestId("workspace-appearance-settings")).toBeVisible();

  const settingsRail = page.locator("nav").filter({
    has: page.getByText("Personal", { exact: true }),
  });
  await expect(
    settingsRail.getByRole("link", { name: "Profile" }),
  ).toHaveAttribute("href", `/profiles/${viewerPubkey}`);
  await expect(
    settingsRail.getByRole("link", { name: "Notifications & accessibility" }),
  ).toHaveAttribute("href", "/preferences");
  await expect(
    settingsRail.getByRole("link", { name: "Agents" }),
  ).toHaveAttribute("href", "/?view=agents");
  await expect(
    settingsRail.getByRole("link", { name: "Local archive" }),
  ).toHaveAttribute("href", "/offline");

  const publishedThemeEventCount = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __BUZZ_WEB_E2E_PUBLISHED__: Array<{
            kind: number;
            tags: string[][];
          }>;
        }
      ).__BUZZ_WEB_E2E_PUBLISHED__.filter(
        (event) =>
          event.kind === 30078 &&
          event.tags.some(
            (tag) => tag[0] === "d" && tag[1] === "community-theme",
          ),
      ).length,
  );

  await page.getByTestId("appearance-mode-dark").click();
  await page.getByTestId("workspace-theme-family").selectOption("github-dark");
  await page.getByTestId("appearance-accent-pink").click();

  await expect
    .poll(
      () =>
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
          ).__BUZZ_WEB_E2E_PUBLISHED__.filter(
            (event) =>
              event.kind === 30078 &&
              event.tags.some(
                (tag) => tag[0] === "d" && tag[1] === "community-theme",
              ),
          ),
        ),
      { timeout: 15_000 },
    )
    .toHaveLength(publishedThemeEventCount + 1);

  const published = await page.evaluate(() => {
    const events = (
      window as typeof window & {
        __BUZZ_WEB_E2E_PUBLISHED__: Array<{
          kind: number;
          content: string;
          pubkey: string;
          tags: string[][];
        }>;
      }
    ).__BUZZ_WEB_E2E_PUBLISHED__.filter(
      (event) =>
        event.kind === 30078 &&
        event.tags.some(
          (tag) => tag[0] === "d" && tag[1] === "community-theme",
        ),
    );
    return events.at(-1);
  });

  expect(published).toMatchObject({
    kind: 30078,
    pubkey: viewerPubkey,
  });
  expect(published?.tags).toContainEqual(["d", "community-theme"]);
  expect(published?.content).not.toContain("github-dark");

  const preference = JSON.parse(
    nip44.decrypt(
      published?.content ?? "",
      nip44.utils.getConversationKey(secretKey, viewerPubkey),
    ),
  ) as Record<string, unknown>;
  expect(preference).toEqual({
    version: 1,
    theme: "github-dark",
    accent: "#ec4899",
    followSystem: false,
  });
});
