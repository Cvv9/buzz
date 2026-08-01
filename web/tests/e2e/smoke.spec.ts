import { createHash } from "node:crypto";
import { type Page, expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";

async function installWorkspaceRelayMock(page: Page, viewerPubkey: string) {
  await page.addInitScript(
    ({ pubkey }) => {
      const event = (
        kind: number,
        eventPubkey: string,
        tags: string[][],
        content = "",
        suffix = "0",
      ) => ({
        id: suffix.padStart(64, "0"),
        pubkey: eventPubkey,
        created_at: 1,
        kind,
        tags,
        content,
        sig: "0".repeat(128),
      });
      const agentEvents = Array.from({ length: 18 }, (_, index) => {
        const agentPubkey = (index + 1).toString(16).padStart(64, "0");
        return event(
          10100,
          agentPubkey,
          [],
          JSON.stringify({
            name: `Workspace Agent ${index + 1}`,
            access_tier: index < 6 ? "personal" : "shared",
          }),
          (index + 10).toString(16),
        );
      });

      class MockWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;
        readonly url: string;
        readyState = MockWebSocket.CONNECTING;
        private readonly listeners = new Map<
          string,
          Set<(event: Event) => void>
        >();

        constructor(url: string | URL) {
          this.url = String(url);
          window.setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.emit("open", new Event("open"));
          }, 0);
        }

        addEventListener(type: string, listener: EventListener) {
          const listeners = this.listeners.get(type) ?? new Set();
          listeners.add(listener);
          this.listeners.set(type, listeners);
        }

        removeEventListener(type: string, listener: EventListener) {
          this.listeners.get(type)?.delete(listener);
        }

        send(payload: string) {
          const envelope = JSON.parse(payload) as unknown[];
          if (envelope[0] !== "REQ") return;
          const subscriptionId = String(envelope[1]);
          const filter = (envelope[2] ?? {}) as { kinds?: number[] };
          const kinds = filter.kinds ?? [];
          let events: ReturnType<typeof event>[] = [];
          if (kinds.includes(39002)) {
            events = [
              event(
                39002,
                "f".repeat(64),
                [
                  ["d", "general"],
                  ["p", pubkey, "", "owner"],
                ],
                "",
                "1",
              ),
            ];
          } else if (kinds.length === 1 && kinds.includes(39000)) {
            events = [
              event(
                39000,
                "f".repeat(64),
                [
                  ["d", "general"],
                  ["name", "general"],
                ],
                "",
                "2",
              ),
            ];
          } else if (kinds.includes(10100) || kinds.includes(30177)) {
            events = agentEvents;
          }
          window.setTimeout(() => {
            for (const relayEvent of events) {
              this.emit(
                "message",
                new MessageEvent("message", {
                  data: JSON.stringify(["EVENT", subscriptionId, relayEvent]),
                }),
              );
            }
            this.emit(
              "message",
              new MessageEvent("message", {
                data: JSON.stringify(["EOSE", subscriptionId]),
              }),
            );
          }, 0);
        }

        close() {
          if (this.readyState === MockWebSocket.CLOSED) return;
          this.readyState = MockWebSocket.CLOSED;
          this.emit("close", new CloseEvent("close"));
        }

        private emit(type: string, event: Event) {
          for (const listener of this.listeners.get(type) ?? []) {
            listener.call(this, event);
          }
        }
      }

      window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    },
    { pubkey: viewerPubkey },
  );
}

test("home page opens at the employee sign-in boundary", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("VarVik Studios").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in to VarVik Studios" }),
  ).toBeVisible();
  await expect(page.getByLabel("Recovery key")).toBeVisible();
});

test("a recovery key is stored behind a password and locks on reload", async ({
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
  ).toBeVisible();

  await page.getByLabel("Password").fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Incorrect password. This Buzz account remains locked.",
  );

  await page.getByLabel("Password").fill("varvik-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Vikram" }),
  ).toBeHidden();

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
  await page.getByLabel("Password").fill("varvik-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
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
});

test("repository browser remains available at its own route", async ({
  page,
}) => {
  await page.goto("/repos");
  await expect(page.getByText("Repositories")).toBeVisible();
});

test("invite requires age and legal consent before opening Buzz", async ({
  page,
}) => {
  await page.route("**/api/join-policy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        policy: {
          terms_markdown: "# Terms",
          privacy_markdown: "# Privacy",
          age_attestation_required: true,
          version: "policy-v1",
        },
      }),
    });
  });
  await page.route("https://api.github.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify([
        { draft: false, prerelease: false, assets: [] },
        {
          draft: false,
          prerelease: false,
          assets: [
            {
              name: "Buzz_0.4.9_aarch64.dmg",
              browser_download_url:
                "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_aarch64.dmg",
            },
            {
              name: "Buzz_0.4.9_x64.dmg",
              browser_download_url:
                "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_x64.dmg",
            },
            {
              name: "Buzz_0.4.9_amd64.AppImage",
              browser_download_url:
                "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_amd64.AppImage",
            },
            {
              name: "Buzz_0.4.9_x64-setup_alpha-unsigned.exe",
              browser_download_url:
                "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_x64-setup_alpha-unsigned.exe",
            },
          ],
        },
      ]),
    });
  });
  await page.goto("/invite/demo-code");

  await expect(
    page.getByRole("link", { name: "Download it now" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_x64-setup_alpha-unsigned.exe",
  );

  const ageConfirmation = page.getByLabel("I am 18 years of age or older.");
  const agreementConfirmation = page.getByLabel(
    "I agree to the Buzz Terms of Service and Privacy Policy.",
  );
  const acceptInvite = page.getByRole("button", {
    name: "Accept invite in Buzz",
  });

  await expect(ageConfirmation).toBeVisible();
  await expect(agreementConfirmation).toBeVisible();
  await expect(acceptInvite).toBeDisabled();

  const termsLink = page.getByRole("button", { name: "Terms of Service" });
  const privacyLink = page.getByRole("button", { name: "Privacy Policy" });
  await expect(termsLink).toHaveCSS("text-decoration-line", "none");
  await expect(privacyLink).toHaveCSS("text-decoration-line", "none");
  await termsLink.hover();
  await expect(termsLink).toHaveCSS("text-decoration-line", "underline");
  await page.mouse.move(0, 0);
  await privacyLink.hover();
  await expect(privacyLink).toHaveCSS("text-decoration-line", "underline");

  await page
    .locator("label")
    .filter({ hasText: "I am 18 years of age or older." })
    .click();
  await expect(ageConfirmation).toBeChecked();
  await expect(acceptInvite).toBeDisabled();
  await page
    .locator("label")
    .filter({
      hasText: "I agree to the Buzz Terms of Service and Privacy Policy.",
    })
    .click({ position: { x: 8, y: 8 } });
  await expect(agreementConfirmation).toBeChecked();
  await expect(acceptInvite).toBeEnabled();

  const consentBox = await page
    .getByTestId("invite-join-policy-notice")
    .boundingBox();
  const acceptButtonBox = await acceptInvite.boundingBox();
  expect(consentBox?.y).toBeLessThan(acceptButtonBox?.y ?? 0);
  expect(consentBox?.width).toBe(acceptButtonBox?.width);
});

test("invite can enroll a NIP-07 identity for browser access", async ({
  page,
}) => {
  const pubkey = "ab".repeat(32);
  await page.addInitScript((extensionPubkey) => {
    (
      window as Window & {
        nostr?: {
          getPublicKey(): Promise<string>;
          signEvent(
            event: Record<string, unknown>,
          ): Promise<Record<string, unknown>>;
        };
      }
    ).nostr = {
      async getPublicKey() {
        return extensionPubkey;
      },
      async signEvent(event) {
        return {
          ...event,
          id: "cd".repeat(32),
          pubkey: extensionPubkey,
          sig: "ef".repeat(64),
        };
      },
    };
  }, pubkey);
  await page.route("**/api/join-policy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ policy: null }),
    });
  });

  let claimObserved = false;
  await page.route("**/api/invites/claim", async (route) => {
    claimObserved = true;
    const request = route.request();
    const body = request.postData() ?? "";
    expect(JSON.parse(body)).toEqual({
      code: "browser-code",
    });

    const authorization = request.headers().authorization;
    expect(authorization).toMatch(/^Nostr /);
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    ) as {
      pubkey: string;
      tags: string[][];
    };
    expect(event.pubkey).toBe(pubkey);
    expect(event.tags).toContainEqual(["u", request.url()]);
    expect(event.tags).toContainEqual(["method", "POST"]);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "joined",
        community_id: "community-id",
        host: "127.0.0.1",
        role: "member",
      }),
    });
  });

  await page.goto("/invite/browser-code");
  await page.getByRole("button", { name: "Join in browser" }).click();
  await expect(page).toHaveURL("/");
  expect(claimObserved).toBe(true);
});

test("invite asks Safari users to choose their Mac download", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.5 Safari/605.1.15",
  });
  await context.addInitScript(() => {
    Object.defineProperties(navigator, {
      platform: { configurable: true, value: "MacIntel" },
      maxTouchPoints: { configurable: true, value: 0 },
      userAgentData: { configurable: true, value: undefined },
    });
  });
  const page = await context.newPage();
  await page.route("**/api/join-policy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ policy: null }),
    });
  });
  await page.route("https://api.github.com/**", async (route) => {
    await route.fulfill({ status: 500 });
  });

  await page.goto("/invite/demo-code");
  const download = page.getByRole("link", { name: "Download it now" });
  await expect(download).toHaveAttribute("aria-haspopup", "dialog");
  await download.click();

  const chooser = page.getByRole("dialog", {
    name: "Which Mac do you have?",
  });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole("link", { name: /Newer Mac/ })).toContainText(
    "2021 or later, or a late-2020 Mac with an Apple M1 chip",
  );
  await expect(chooser.getByRole("link", { name: /Older Mac/ })).toContainText(
    "2019 or earlier, or a 2020 Mac with an Intel processor",
  );
  await expect(chooser.getByText("About This Mac")).toBeVisible();

  const openedPagePromise = context.waitForEvent("page");
  await chooser.getByRole("link", { name: /Newer Mac/ }).click();
  const openedPage = await openedPagePromise;
  await expect(chooser).toBeHidden();
  await expect(openedPage).toHaveURL("https://github.com/block/buzz/releases");
  await expect(page).toHaveURL(/\/invite\/demo-code$/);
  await openedPage.close();

  await download.click();
  await expect(chooser).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chooser).toBeHidden();
  await expect(download).toBeFocused();
  await context.close();
});

test("invite download falls back for mobile and non-desktop devices", async ({
  browser,
}) => {
  const unsupportedDevices = [
    {
      name: "iPhone Safari",
      platform: "iPhone",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    },
    {
      name: "iPadOS desktop mode",
      platform: "MacIntel",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    },
    {
      name: "Android phone",
      platform: "Linux armv8l",
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 Mobile",
      maxTouchPoints: 5,
    },
    {
      name: "ChromeOS",
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16093.68.0) AppleWebKit/537.36",
      maxTouchPoints: 0,
    },
  ];

  for (const device of unsupportedDevices) {
    const context = await browser.newContext({ userAgent: device.userAgent });
    await context.addInitScript(({ platform, maxTouchPoints }) => {
      Object.defineProperties(navigator, {
        platform: { configurable: true, value: platform },
        maxTouchPoints: { configurable: true, value: maxTouchPoints },
        userAgentData: {
          configurable: true,
          value: { platform, mobile: maxTouchPoints > 0 },
        },
      });
    }, device);
    const page = await context.newPage();
    await page.route("**/api/join-policy", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ policy: null }),
      });
    });
    await page.route("https://api.github.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify([
          {
            draft: false,
            prerelease: false,
            assets: [
              {
                name: "Buzz_0.4.9_x64.dmg",
                browser_download_url:
                  "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_x64.dmg",
              },
              {
                name: "Buzz_0.4.9_amd64.AppImage",
                browser_download_url:
                  "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_amd64.AppImage",
              },
            ],
          },
        ]),
      });
    });

    await page.goto("/invite/demo-code");
    await expect(
      page.getByRole("link", { name: "Download it now" }),
      device.name,
    ).toHaveAttribute("href", "https://github.com/block/buzz/releases");
    await context.close();
  }
});
