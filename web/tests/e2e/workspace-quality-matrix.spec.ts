import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";
import { DESKTOP_THEME_CATALOG } from "../../src/shared/theme/generated-desktop-theme-catalog";

async function signIn(page: Page) {
  const secret = generateSecretKey();
  await installWorkspaceRelayMock(page, getPublicKey(secret));
  await page.goto("/");
  await page.getByLabel("Display name").fill("Quality audit");
  await page.getByLabel("Recovery key").fill(nsecEncode(secret));
  await page
    .getByLabel("Password", { exact: true })
    .fill("quality-test-password");
  await page.getByLabel("Confirm password").fill("quality-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByLabel("Message general")).toBeVisible();
}

for (const [theme, palette] of Object.entries(DESKTOP_THEME_CATALOG)) {
  test(`theme and accessibility matrix: ${theme}`, async ({
    page,
  }, testInfo) => {
    await signIn(page);
    await page.goto("/settings");
    await page
      .getByTestId(`appearance-mode-${palette.isDark ? "dark" : "light"}`)
      .click();
    await page.getByTestId("workspace-theme-family").selectOption(theme);
    await page.goto("/?view=inbox");
    await expect(page.getByTestId("workspace-inbox")).toBeVisible();
    const findings: unknown[] = [];
    const scan = async (state: string) => {
      await page.evaluate(() => document.fonts.ready);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      findings.push(
        ...result.violations.map((violation) => ({
          state,
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
          })),
        })),
      );
    };
    await scan("empty-inbox");
    await page.getByRole("button", { name: /^AI agents/ }).click();
    await expect(
      page.getByRole("button", { name: "New agent", exact: true }),
    ).toBeVisible();
    await scan("populated-agents");
    await page.getByRole("button", { name: "New agent", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Connect a new agent" }),
    ).toBeVisible();
    await scan("agent-dialog");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Create channel", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Create a channel", exact: true }),
    ).toBeVisible();
    await scan("empty-form-disabled-submit");
    await page.keyboard.press("Tab");
    await scan("keyboard-focus");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Create channel", exact: true })
      .hover();
    await scan("hover");
    await page.evaluate(() =>
      sessionStorage.setItem("buzz.e2e.fail-query-kind", "9"),
    );
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Retry messages" }),
    ).toBeVisible();
    await scan("message-error");
    await page.evaluate(() => {
      sessionStorage.removeItem("buzz.e2e.fail-query-kind");
      sessionStorage.setItem("buzz.e2e.hold-query-kind", "9");
    });
    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    await expect(page.locator(".animate-pulse").first()).toBeVisible();
    await scan("message-loading");
    await testInfo.attach("accessibility-findings", {
      body: JSON.stringify(findings, null, 2),
      contentType: "application/json",
    });
    expect(findings).toEqual([]);
  });
}

for (const preference of ["system", "app"] as const) {
  test(`reduced motion preserves dialog interaction: ${preference}`, async ({
    page,
  }) => {
    if (preference === "system")
      await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page);
    if (preference === "app") {
      await page.evaluate(() =>
        document.documentElement.setAttribute(
          "data-buzz-reduced-motion",
          "true",
        ),
      );
    }
    await page
      .getByRole("button", { name: "Create channel", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Create a channel",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const moving = await dialog.evaluate((element) =>
      [element, ...element.querySelectorAll("*")]
        .flatMap((node) => node.getAnimations())
        .flatMap((animation) =>
          (animation.effect as KeyframeEffect).getKeyframes(),
        )
        .filter((frame) => frame.transform && frame.transform !== "none"),
    );
    expect(moving).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create channel", exact: true }),
    ).toBeFocused();
  });
}
