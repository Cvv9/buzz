import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("a recovery key stays available on this device until explicitly locked", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const recoveryKey = nsecEncode(secretKey);
  await installWorkspaceRelayMock(page, getPublicKey(secretKey));
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(recoveryKey);
  await page
    .getByLabel("Password", { exact: true })
    .fill("varvik-test-password");
  await page.getByLabel("Confirm password").fill("varvik-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to VarVik Studios" }),
  ).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Vikram" }),
  ).toBeHidden();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();

  const hostedAgentsToggle = page.getByTestId("hosted-agents-toggle");
  const privateAgentsToggle = page.getByTestId(
    "agent-group-privateAgents-toggle",
  );
  await expect(hostedAgentsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(privateAgentsToggle).toHaveAttribute("aria-expanded", "true");
  await privateAgentsToggle.click();
  await expect(
    page.getByTestId("agent-group-privateAgents-content"),
  ).toBeHidden();
  await expect(
    page.getByTestId("agent-group-sharedAgents-content"),
  ).toBeVisible();
  await hostedAgentsToggle.click();
  await expect(page.getByTestId("hosted-agents-content")).toBeHidden();

  await page.reload();
  await expect(hostedAgentsToggle).toHaveAttribute("aria-expanded", "false");
  await hostedAgentsToggle.click();
  await expect(
    page.getByTestId("agent-group-privateAgents-content"),
  ).toBeHidden();
  await expect(
    page.getByTestId("agent-group-sharedAgents-content"),
  ).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 480 });
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  const layout = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(
      '[data-testid="workspace-shell"]',
    );
    const sidebarScroll = document.querySelector<HTMLElement>(
      '[data-testid="workspace-sidebar-scroll"]',
    );
    const chatPane = document.querySelector<HTMLElement>(
      '[data-testid="workspace-chat-pane"]',
    );
    if (!shell || !sidebarScroll || !chatPane) {
      throw new Error("Workspace layout regions were not rendered.");
    }
    const overflowProbe = document.createElement("div");
    overflowProbe.style.height = "1200px";
    overflowProbe.setAttribute("data-testid", "sidebar-overflow-probe");
    sidebarScroll.append(overflowProbe);
    sidebarScroll.scrollTop = 160;
    window.scrollTo(0, 160);
    return {
      chatBottom: chatPane.getBoundingClientRect().bottom,
      documentScrollHeight: document.documentElement.scrollHeight,
      shellHeight: shell.getBoundingClientRect().height,
      sidebarCanScroll: sidebarScroll.scrollHeight > sidebarScroll.clientHeight,
      sidebarScrollTop: sidebarScroll.scrollTop,
      viewportHeight: window.innerHeight,
      windowScrollY: window.scrollY,
    };
  });
  expect(layout.shellHeight).toBe(layout.viewportHeight);
  expect(layout.documentScrollHeight).toBeLessThanOrEqual(
    layout.viewportHeight + 1,
  );
  expect(layout.windowScrollY).toBe(0);
  expect(layout.sidebarCanScroll).toBe(true);
  expect(layout.sidebarScrollTop).toBeGreaterThan(0);
  expect(layout.chatBottom).toBeLessThanOrEqual(layout.viewportHeight);

  await page
    .getByTestId("workspace-sidebar")
    .getByRole("button", { name: /Vikram/ })
    .click();
  await expect(page.getByText("Browser identity")).toBeVisible();
  await page.getByRole("button", { name: "Lock and sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Vikram" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Vikram" }),
  ).toBeVisible();
  await page.getByLabel("Password").fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Incorrect password. This Buzz account remains locked.",
  );
  await page.getByLabel("Password").fill("varvik-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
});

test("mentioning an eligible hosted agent adds it before the message", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  await installWorkspaceRelayMock(page, getPublicKey(secretKey));
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page
    .getByLabel("Password", { exact: true })
    .fill("agent-mention-password");
  await page.getByLabel("Confirm password").fill("agent-mention-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();

  await expect(page.getByText("Workspace Agent 7")).toBeVisible();
  const composer = page.getByLabel("Message general");
  await composer.fill("@Research Agent investigate this request");
  await composer.press("Enter");
  const agentPubkey = "7".padStart(64, "0");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              tags: string[][];
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.filter(
          (relayEvent) => relayEvent.kind === 9000 || relayEvent.kind === 9,
        ),
      ),
    )
    .toHaveLength(2);
  const published = await page.evaluate(() =>
    (
      window as typeof window & {
        __BUZZ_WEB_E2E_PUBLISHED__: Array<{
          kind: number;
          tags: string[][];
        }>;
      }
    ).__BUZZ_WEB_E2E_PUBLISHED__.filter(
      (relayEvent) => relayEvent.kind === 9000 || relayEvent.kind === 9,
    ),
  );
  expect(published[0]).toMatchObject({
    kind: 9000,
    tags: [
      ["h", "general"],
      ["p", agentPubkey],
      ["role", "bot"],
    ],
  });
  expect(published[1]).toMatchObject({
    kind: 9,
    tags: [
      ["h", "general"],
      ["p", agentPubkey],
    ],
  });

  await composer.fill("@Workspace Agent 1 handle private work");
  await composer.press("Enter");
  await expect(
    page.getByText(
      /personal assistant and cannot be added to a shared channel/,
    ),
  ).toBeVisible();
});

test("an already-present personal agent remains mentionable", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const personalAgentPubkey = "1".padStart(64, "0");
  await installWorkspaceRelayMock(page, getPublicKey(secretKey), {
    generalMemberPubkeys: [personalAgentPubkey],
  });
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page
    .getByLabel("Password", { exact: true })
    .fill("personal-agent-password");
  await page.getByLabel("Confirm password").fill("personal-agent-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(
    page.getByText("Workspace Agent 1", { exact: true }),
  ).toBeVisible();

  const composer = page.getByLabel("Message general");
  await composer.fill("@Workspace Agent 1 handle my private work");
  await composer.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              tags: string[][];
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.filter(
          (relayEvent) => relayEvent.kind === 9000 || relayEvent.kind === 9,
        ),
      ),
    )
    .toEqual([
      expect.objectContaining({
        kind: 9,
        tags: [
          ["h", "general"],
          ["p", personalAgentPubkey],
        ],
      }),
    ]);
});
