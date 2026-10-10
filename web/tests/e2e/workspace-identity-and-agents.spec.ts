import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

test("archived conversations stay out of the active list and reopen through their menu", async ({
  page,
}) => {
  const secret = generateSecretKey(),
    viewer = getPublicKey(secret),
    peer = "2".repeat(64);
  const channel = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await installWorkspaceRelayMock(page, viewer, {
    workspaceEvents: [
      {
        kind: 39002,
        pubkey: "f".repeat(64),
        tags: [
          ["d", channel],
          ["p", viewer, "", "owner"],
          ["p", peer, "", "member"],
        ],
        content: "",
        suffix: "a1",
      },
      {
        kind: 39000,
        pubkey: "f".repeat(64),
        tags: [
          ["d", channel],
          ["name", "Vikram"],
          ["t", "dm"],
          ["private", "true"],
        ],
        content: "",
        suffix: "a2",
      },
      {
        kind: 0,
        pubkey: peer,
        tags: [],
        content: JSON.stringify({ display_name: "Vikram" }),
        suffix: "a3",
      },
      {
        kind: 30622,
        pubkey: "f".repeat(64),
        tags: [
          ["d", viewer],
          ["p", viewer],
          ["h", channel],
        ],
        content: "",
        suffix: "a4",
      },
    ],
  });
  await page.goto(`/?channel=${channel}`);
  await page.getByLabel("Display name").fill("Archive test");
  await page.getByLabel("Recovery key").fill(nsecEncode(secret));
  await page
    .getByLabel("Password", { exact: true })
    .fill("archive-test-password");
  await page.getByLabel("Confirm password").fill("archive-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  const sidebar = page.locator("aside");
  await expect(
    sidebar.getByText("Archived conversations", { exact: true }),
  ).toBeVisible();
  await expect(sidebar.getByText("Vikram", { exact: true })).toHaveCount(1);
  await sidebar.getByRole("button", { name: /Vikram Reopen/ }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__BUZZ_WEB_E2E_PUBLISHED__.some(
          (e: any) => e.kind === 41010,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ viewer }) => {
      const w = window as any;
      w.__BUZZ_WEB_E2E_EMIT__(
        w.__BUZZ_WEB_E2E_EVENT__(
          30622,
          "f".repeat(64),
          [
            ["d", viewer],
            ["p", viewer],
          ],
          "",
          "a5",
          20,
        ),
      );
    },
    { viewer },
  );
  const menu = sidebar.getByLabel("Conversation actions for Vikram");
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(
    sidebar.getByRole("button", { name: "Archive for me", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await menu.click();
  await sidebar
    .getByRole("button", { name: "Archive for me", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__BUZZ_WEB_E2E_PUBLISHED__.some(
          (e: any) => e.kind === 41012,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ viewer, channel }) => {
      const w = window as any;
      w.__BUZZ_WEB_E2E_EMIT__(
        w.__BUZZ_WEB_E2E_EVENT__(
          30622,
          "f".repeat(64),
          [
            ["d", viewer],
            ["p", viewer],
            ["h", channel],
          ],
          "",
          "a6",
          30,
        ),
      );
    },
    { viewer, channel },
  );
  await expect(
    sidebar.getByText("Archived conversations", { exact: true }),
  ).toBeVisible();
  await expect(sidebar.getByText("Vikram", { exact: true })).toHaveCount(1);
  await expect(menu).toHaveCount(0);
});

test("recipient picker retains hosted photos and labels integration services", async ({
  page,
}) => {
  const secret = generateSecretKey(),
    viewer = getPublicKey(secret),
    agent = "7".padStart(64, "0"),
    service = "8".repeat(64);
  const avatarUrl =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  await installWorkspaceRelayMock(page, viewer, {
    hostedAgentConfig: {
      agentPubkey: agent,
      name: "Sylar",
      avatarUrl,
      model: "gpt-5.6-terra",
    },
    workspaceEvents: [
      {
        kind: 13534,
        pubkey: "f".repeat(64),
        tags: [
          ["member", viewer, "owner"],
          ["member", agent, "member"],
          ["member", service, "member"],
        ],
        content: "",
        suffix: "b1",
        createdAt: 20,
      },
      {
        kind: 0,
        pubkey: service,
        tags: [],
        content: JSON.stringify({
          display_name: "Sylars",
          bot: true,
          service_type: "integration",
        }),
        suffix: "b2",
        createdAt: 20,
      },
    ],
  });
  await page.goto("/");
  await page.getByLabel("Display name").fill("Picker test");
  await page.getByLabel("Recovery key").fill(nsecEncode(secret));
  await page
    .getByLabel("Password", { exact: true })
    .fill("picker-test-password");
  await page.getByLabel("Confirm password").fill("picker-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByLabel("New direct message").click();
  const picker = page.getByTestId("new-message-page");
  await expect(
    picker.getByRole("button", { name: /^Sylar AI agent/ }).locator("img"),
  ).toHaveAttribute("src", avatarUrl);
  await expect(
    picker.getByRole("button", { name: /Sylars Integration service/ }),
  ).toBeDisabled();
  await expect(
    picker.getByLabel("Add Sylars to a group conversation"),
  ).toBeDisabled();
});

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
    .locator('a[href="/settings"]')
    .click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recovery key" }),
  ).toBeVisible();
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

test("the web agent page explains resources and lets the owner edit profile and channel access", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  await installWorkspaceRelayMock(page, getPublicKey(secretKey));
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page
    .getByLabel("Password", { exact: true })
    .fill("agent-admin-password");
  await page.getByLabel("Confirm password").fill("agent-admin-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();

  await page.locator('a[href="/settings"]').last().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await expect(page.getByTestId("workspace-agents")).toBeVisible();
  await page.getByTestId("agent-row-workspace-agent-7").click();
  await expect(
    page.getByRole("paragraph").filter({
      hasText:
        "Investigates market questions and returns source-backed findings.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Market Intelligence research")).toBeVisible();
  await expect(page.getByText("Public web sources")).toBeVisible();

  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("Name").fill("Opportunity Scout");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByLabel("general access for Opportunity Scout").click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              content: string;
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.filter(
          (relayEvent) => relayEvent.kind === 30180 || relayEvent.kind === 9000,
        ),
      ),
    )
    .toHaveLength(2);
  const published = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __BUZZ_WEB_E2E_PUBLISHED__: Array<{ kind: number; content: string }>;
        }
      ).__BUZZ_WEB_E2E_PUBLISHED__,
  );
  const config = published.find((relayEvent) => relayEvent.kind === 30180);
  expect(JSON.parse(config?.content ?? "{}")).toMatchObject({
    name: "Opportunity Scout",
  });
});

test("owner-edited hosted agent identity is shared across the web roster and mentions", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const viewerPubkey = getPublicKey(secretKey);
  const agentPubkey = "7".padStart(64, "0");
  const avatarUrl =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  await installWorkspaceRelayMock(page, viewerPubkey, {
    hostedAgentConfig: {
      agentPubkey,
      name: "Sylar",
      avatarUrl,
      model: "gpt-5.6-terra",
    },
  });
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page.getByLabel("Password", { exact: true }).fill("web-agent-config");
  await page.getByLabel("Confirm password").fill("web-agent-config");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();

  await expect(page.getByText(/^Sylar — /).first()).toBeVisible();
  await expect(
    page.getByText("Workspace Agent 7", { exact: true }),
  ).toHaveCount(0);

  const composer = page.getByLabel("Message general");
  await composer.fill("@Sylar check the deployment");
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
        kind: 9000,
        tags: [
          ["h", "general"],
          ["p", agentPubkey],
          ["role", "bot"],
        ],
      }),
      expect.objectContaining({
        kind: 9,
        tags: [
          ["h", "general"],
          ["p", agentPubkey],
        ],
      }),
    ]);
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
  await expect(page.getByText(/^Workspace Agent 1 — /)).toBeVisible();

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
