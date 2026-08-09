import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9pAAAAABJRU5ErkJggg==",
  "base64",
);

test("workspace composer uploads imeta attachments and renders protected media", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const viewerPubkey = getPublicKey(secretKey);
  const sha256 = createHash("sha256").update(png).digest("hex");
  const url = `http://127.0.0.1:4173/media/${sha256}.png`;
  let uploadAuthorized = false;
  await installWorkspaceRelayMock(page, viewerPubkey);
  await page.route("**/upload", async (route) => {
    const request = route.request();
    uploadAuthorized =
      request.headers().authorization?.startsWith("Nostr ") === true &&
      request.headers()["x-sha-256"] === sha256;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url,
        sha256,
        size: png.length,
        type: "image/png",
        uploaded: 1,
      }),
    });
  });
  await page.route(`**/media/${sha256}.png`, async (route) => {
    expect(route.request().headers().authorization).toMatch(/^Nostr /);
    await route.fulfill({ contentType: "image/png", body: png });
  });

  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page
    .getByLabel("Password", { exact: true })
    .fill("media-test-password");
  await page.getByLabel("Confirm password").fill("media-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByLabel("Message general")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "plan.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByText("1 KB · ready")).toBeVisible();
  await page.getByLabel("Message general").fill("Attached plan");
  await page.getByLabel("Send message").click();
  await expect.poll(() => uploadAuthorized).toBe(true);

  const published = await page.evaluate(() =>
    (
      window as typeof window & {
        __BUZZ_WEB_E2E_PUBLISHED__: Array<{
          content: string;
          kind: number;
          tags: string[][];
        }>;
      }
    ).__BUZZ_WEB_E2E_PUBLISHED__.find((event) => event.kind === 9),
  );
  expect(published?.content).toContain(`![image](${url})`);
  expect(published?.tags).toContainEqual([
    "imeta",
    `url ${url}`,
    "m image/png",
    `x ${sha256}`,
    `size ${png.length}`,
    "filename plan.png",
  ]);

  await page.evaluate(
    ({ mediaUrl, mediaHash }) => {
      const helpers = window as typeof window & {
        __BUZZ_WEB_E2E_EMIT__: (event: unknown) => void;
        __BUZZ_WEB_E2E_EVENT__: (
          kind: number,
          pubkey: string,
          tags: string[][],
          content: string,
          suffix: string,
        ) => unknown;
      };
      helpers.__BUZZ_WEB_E2E_EMIT__(
        helpers.__BUZZ_WEB_E2E_EVENT__(
          9,
          "b".repeat(64),
          [
            ["h", "general"],
            [
              "imeta",
              `url ${mediaUrl}`,
              "m image/png",
              `x ${mediaHash}`,
              "size 70",
              "filename plan.png",
            ],
          ],
          `![image](${mediaUrl})`,
          "media-message",
        ),
      );
    },
    { mediaUrl: url, mediaHash: sha256 },
  );
  const preview = page.getByRole("button", { name: "Open plan.png" }).last();
  await expect(preview).toBeVisible();
  await preview.click();
  const dialog = page.getByRole("dialog", { name: "Preview plan.png" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const close = dialog.getByRole("button", { name: "Close preview" });
  await expect(close).toBeFocused();
  await close.click();
  await expect(preview).toBeFocused();
});
