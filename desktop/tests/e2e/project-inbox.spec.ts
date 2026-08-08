import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

test("Buzz Git pull request renders and stays actionable in Projects", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "buzz-feature-overrides-v1",
      JSON.stringify({ projects: true }),
    );
  });
  await installMockBridge(page);
  await page.setViewportSize({ width: 1024, height: 720 });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-projects-view").click();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await page
    .locator(
      '[data-testid="repository-card-buzz"], [data-testid="repository-row-buzz"]',
    )
    .first()
    .click();
  await page.getByRole("tab", { name: "Pull Request" }).click();

  const alicePullRequest = page
    .getByTestId("project-pull-request-row")
    .filter({ hasText: "alice" })
    .first();
  await expect(alicePullRequest).toBeVisible({ timeout: 10_000 });
  // Pull requests have their own actionable Projects detail. They are not
  // approval requests, so a project notification must not be promoted into
  // the decision-only Inbox.
  await alicePullRequest.getByRole("button", { name: /^#/ }).click();
  await expect(
    page.getByRole("navigation", { name: "Project breadcrumb" }),
  ).toContainText("Pull Request");
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toBeVisible();
  const commentComposer = page.getByTestId(
    "project-pull-request-comment-composer",
  );
  await commentComposer
    .getByRole("button", { name: "Comment", exact: true })
    .click();
  await expect(
    page.getByRole("menuitemradio", { name: "Request changes" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Merge", exact: true }),
  ).toBeVisible();

  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/project-pull-request/01-pull-request-detail.png",
  });
});
