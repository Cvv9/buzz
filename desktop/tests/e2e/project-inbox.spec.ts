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
  const repositoryCardBody = page
    .getByTestId("repository-card-buzz")
    .getByTestId("projects-grid-card-body");
  const repositoryCardBodyBounds = await repositoryCardBody.boundingBox();
  expect(repositoryCardBodyBounds).not.toBeNull();
  await page.mouse.click(
    (repositoryCardBodyBounds?.x ?? 0) +
      (repositoryCardBodyBounds?.width ?? 0) / 2,
    (repositoryCardBodyBounds?.y ?? 0) +
      (repositoryCardBodyBounds?.height ?? 0) / 2,
  );
  await page.getByRole("tab", { name: "Review" }).click();

  const alicePullRequest = page
    .getByTestId("project-pull-request-row")
    .filter({
      has: page.getByRole("button", { name: "alice", exact: true }),
    })
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

  const detail = page
    .getByTestId("project-workspace-panel")
    .locator(":scope > [data-project-detail-panel]:visible");
  const layout = detail.locator(":scope > .grid");

  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/project-pull-request/01-pull-request-detail.png",
  });

  // Metadata phrases may wrap between items but must never compress
  // individual phrases into word-wide columns.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(() =>
      layout.evaluate(
        (element) =>
          getComputedStyle(element)
            .gridTemplateColumns.split(" ")
            .filter(Boolean).length,
      ),
    )
    .toBe(1);
  await expect(
    detail.getByRole("button", {
      name: "Open author-claimed origin channel #general",
    }),
  ).toBeVisible();
  const metadataPhrases = detail.locator("[data-project-metadata-phrase]");
  await expect(metadataPhrases).not.toHaveCount(0);
  const phraseLayouts = await metadataPhrases.evaluateAll((phrases) =>
    phrases.map((phrase) => {
      const style = getComputedStyle(phrase);
      return {
        height: phrase.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    }),
  );
  for (const phrase of phraseLayouts) {
    expect(phrase.height).toBeLessThanOrEqual(phrase.lineHeight * 1.5);
  }
  await waitForAnimations(page);
  await detail.screenshot({
    path: "test-results/project-inbox/02-pull-request-detail-wide.png",
  });
});
