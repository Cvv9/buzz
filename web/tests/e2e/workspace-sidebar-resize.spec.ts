import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("sidebar drag and keyboard resize persist while mobile remains a drawer", async ({
  page,
}) => {
  const secret = generateSecretKey();
  await installWorkspaceRelayMock(page, getPublicKey(secret));
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secret));
  await page
    .getByLabel("Password", { exact: true })
    .fill("varvik-test-password");
  await page.getByLabel("Confirm password").fill("varvik-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  const sidebar = page.getByTestId("workspace-sidebar");
  const handle = page.getByRole("separator", {
    name: "Resize workspace sidebar",
  });
  await expect(handle).toHaveAttribute("aria-valuenow", "272");
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize handle is missing");
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + 200);
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "372");
  expect((await sidebar.boundingBox())?.width).toBe(372);
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", "372");
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "396");
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "224");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(handle).toBeHidden();
  expect((await sidebar.boundingBox())?.width).toBeCloseTo(272, 3);
});
