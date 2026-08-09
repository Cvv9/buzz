import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

async function signIn(
  page: import("@playwright/test").Page,
  secret: Uint8Array,
) {
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secret));
  await page
    .getByLabel("Password", { exact: true })
    .fill("project-test-password");
  await page.getByLabel("Confirm password").fill("project-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
}

test("NIP-MP projects and NIP-34 repository work items deep-link from relay events", async ({
  page,
}) => {
  const secret = generateSecretKey();
  const owner = getPublicKey(secret);
  const repositoryAddress = `30617:${owner}:buzz`;
  const projectAddress = `30621:${owner}:delivery`;
  const issueId = "1".repeat(64);
  await installWorkspaceRelayMock(page, owner);
  await signIn(page, secret);
  await page.evaluate(
    ({ owner, repositoryAddress, issueId }) => {
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
          30617,
          owner,
          [
            ["d", "buzz"],
            ["name", "Buzz"],
          ],
          "Repository browser",
          "2".repeat(64),
        ),
      );
      helpers.__BUZZ_WEB_E2E_EMIT__(
        helpers.__BUZZ_WEB_E2E_EVENT__(
          30621,
          owner,
          [
            ["d", "delivery"],
            ["name", "Delivery"],
            ["a", repositoryAddress],
          ],
          "Release tracking",
          "3".repeat(64),
        ),
      );
      helpers.__BUZZ_WEB_E2E_EMIT__(
        helpers.__BUZZ_WEB_E2E_EVENT__(
          1621,
          owner,
          [
            ["a", repositoryAddress],
            ["subject", "Ship the browser project view"],
          ],
          "Work item body",
          issueId,
        ),
      );
    },
    { owner, repositoryAddress, issueId },
  );
  await page.goto("/projects");
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();

  await expect(page.getByRole("link", { name: "Delivery" })).toBeVisible();
  await page.getByRole("link", { name: "Work items" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/repos/${encodeURIComponent(repositoryAddress)}/work-items`),
  );
  await expect(page.getByText("Ship the browser project view")).toBeVisible();
  await page
    .getByRole("link", { name: "Ship the browser project view" })
    .click();
  await expect(page).toHaveURL(new RegExp(issueId));
  await expect(page.getByText("Work item body").first()).toBeVisible();
  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("link", { name: "Delivery" })).toBeVisible();
  await page.getByRole("link", { name: "Delivery" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${encodeURIComponent(projectAddress)}`),
  );
  await expect(
    page.getByText(`Canonical project coordinate: ${projectAddress}`),
  ).toBeVisible();
});
