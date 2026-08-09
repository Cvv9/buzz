import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("browser-local archive, pairing, and preferences stay capability- and lock-gated", async ({
  page,
}) => {
  const secret = generateSecretKey();
  await installWorkspaceRelayMock(page, getPublicKey(secret));

  await page.goto("/offline");
  await expect(
    page.getByText(
      "Unlock a browser identity before reading or creating an encrypted offline archive.",
    ),
  ).toBeVisible();

  await page.goto("/");
  await page.getByLabel("Display name").fill("Browser local QA");
  await page.getByLabel("Recovery key").fill(nsecEncode(secret));
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-local-qa-password");
  await page.getByLabel("Confirm password").fill("browser-local-qa-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();

  await page.goto("/offline");
  await expect(
    page.getByRole("heading", { name: "Offline channel archive" }),
  ).toBeVisible();
  await page
    .getByLabel("Backup passphrase")
    .fill("browser-local-export-password");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download encrypted backup" }).click();
  expect((await download).suggestedFilename()).toBe(
    "buzz-offline-archive.encrypted.json",
  );

  await page.goto("/preferences");
  await expect(
    page.getByRole("heading", { name: "Notifications and accessibility" }),
  ).toBeVisible();
  await page.getByLabel("Reduce non-essential motion").check();
  await expect(page.locator("html")).toHaveAttribute(
    "data-buzz-reduced-motion",
    "true",
  );
  await page.getByLabel("Text size").selectOption("larger");
  await expect(page.locator("html")).toHaveAttribute(
    "data-buzz-font-scale",
    "larger",
  );

  await page.goto("/pairing");
  await expect(
    page.getByRole("heading", { name: "Pair this browser" }),
  ).toBeVisible();
  await page.getByLabel("Pairing code").fill("not-a-pairing-uri");
  await page.getByRole("button", { name: "Join pairing" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    /Pairing code must be a nostrpair:\/\/ URI/,
  );

  await page.goto("/");
  await page
    .getByTestId("workspace-sidebar")
    .locator('a[href="/settings"]')
    .click();
  await page.getByRole("button", { name: "Lock and sign out" }).click();
  await page.goto("/offline");
  await expect(
    page.getByText(
      "Unlock a browser identity before reading or creating an encrypted offline archive.",
    ),
  ).toBeVisible();
});
