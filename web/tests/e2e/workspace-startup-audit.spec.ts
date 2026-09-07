import { writeFile } from "node:fs/promises";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";
import { expect, test, type Page } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

declare global {
  interface Window {
    __BUZZ_WEB_E2E_TRANSPORT__: () => {
      socketCount: number;
      authCount: number;
      open: number;
    };
    __BUZZ_WEB_E2E_DISCONNECT__: () => void;
    __BUZZ_WEB_E2E_ADMISSION__: () => {
      admissionRejected: number;
      forcedThrottle: boolean;
      pending: number;
    };
  }
}

async function signIn(page: Page, enforceAdmission = false) {
  const secret = generateSecretKey();
  await installWorkspaceRelayMock(page, getPublicKey(secret), {
    enforceAdmission,
  });
  await page.goto("/");
  await page.getByLabel("Display name").fill("Audit user");
  await page.getByLabel("Recovery key").fill(nsecEncode(secret));
  await page
    .getByLabel("Password", { exact: true })
    .fill("audit-test-password");
  await page.getByLabel("Confirm password").fill("audit-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect(page.getByLabel("Message general")).toBeVisible();
}

test("reload shares one authenticated connection and reconnects live updates", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.reload();
  await expect(page.getByLabel("Message general")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__BUZZ_WEB_E2E_TRANSPORT__()))
    .toEqual({ socketCount: 1, authCount: 1, open: 1 });
  const metrics = await page.evaluate(() => ({
    scripts: performance
      .getEntriesByType("resource")
      .filter((entry) => /\.js$/.test(entry.name))
      .map((entry) => ({
        name: new URL(entry.name).pathname,
        decodedBytes: (entry as PerformanceResourceTiming).decodedBodySize,
      })),
    transport: window.__BUZZ_WEB_E2E_TRANSPORT__(),
  }));
  await writeFile(
    testInfo.outputPath("startup-metrics.json"),
    JSON.stringify(metrics, null, 2),
  );
  await testInfo.attach("startup-metrics", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  await page.evaluate(() => window.__BUZZ_WEB_E2E_DISCONNECT__());
  await expect
    .poll(() => page.evaluate(() => window.__BUZZ_WEB_E2E_TRANSPORT__().open))
    .toBe(1);
  await page.getByLabel("Message general").fill("Reconnect regression message");
  await page.getByLabel("Message general").press("Enter");
  await expect(
    page
      .getByTestId("workspace-timeline")
      .getByText("Reconnect regression message", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.__BUZZ_WEB_E2E_TRANSPORT__().socketCount),
    )
    .toBe(2);
});

test("locked saved channel does not request private messages before sign-in", async ({
  page,
}) => {
  await signIn(page);
  await page.locator('a[href="/settings"]').click();
  await page.getByRole("button", { name: "Lock and sign out" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__BUZZ_WEB_E2E_TRANSPORT__().open))
    .toBe(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Audit user" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__BUZZ_WEB_E2E_TRANSPORT__().socketCount),
  ).toBe(0);
  await page
    .getByLabel("Password", { exact: true })
    .fill("audit-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Message general")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.__BUZZ_WEB_E2E_TRANSPORT__().socketCount),
    )
    .toBe(1);
});

test("a storage read error offers retry without importing or replacing the saved account", async ({
  page,
}) => {
  await signIn(page);
  await page.evaluate(() =>
    sessionStorage.setItem("buzz.e2e.storage-failure", "true"),
  );
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);

    indexedDB.open = (...args: Parameters<IDBFactory["open"]>) => {
      if (
        sessionStorage.getItem("buzz.e2e.storage-failure") &&
        args[0] === "buzz-web-identity"
      ) {
        throw new DOMException(
          "Storage temporarily unavailable",
          "UnknownError",
        );
      }
      return original(...args);
    };
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Could not open your saved account" }),
  ).toBeVisible();
  await expect(page.getByLabel("Recovery key", { exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    sessionStorage.removeItem("buzz.e2e.storage-failure"),
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Message general")).toBeVisible();
});

test("a channel read failure never asks an existing member to create or join a workspace", async ({
  page,
}) => {
  await signIn(page);
  await page.evaluate(() =>
    sessionStorage.setItem("buzz.e2e.fail-query-kind", "39002"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Could not connect to your workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create first channel" }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    sessionStorage.removeItem("buzz.e2e.fail-query-kind"),
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Message general")).toBeVisible();
});

test("failed message reads show retry instead of claiming the conversation is empty", async ({
  page,
}) => {
  await signIn(page);
  await page.evaluate(() =>
    sessionStorage.setItem("buzz.e2e.fail-query-kind", "9"),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry messages" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Start the conversation/ }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    sessionStorage.removeItem("buzz.e2e.fail-query-kind"),
  );
  await page.getByRole("button", { name: "Retry messages" }).click();
  await expect(
    page.getByRole("button", { name: "Retry messages" }),
  ).toHaveCount(0);
});

test("mobile inbox, alerts and agents retain navigation; emoji is deferred", async ({
  page,
}, testInfo) => {
  const emojiRequests: string[] = [];
  page.on("request", (request) => {
    if (/EmojiPalette.*\.js/.test(request.url()))
      emojiRequests.push(request.url());
  });
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["Inbox", "Alerts", "AI agents"]) {
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page
      .getByTestId("workspace-sidebar")
      .getByRole("button", {
        name: name === "AI agents" ? /^AI agents/ : name,
        exact: name !== "AI agents",
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeVisible();
    if (name === "Inbox") {
      await waitForAnimations(page);
      await page.screenshot({ path: testInfo.outputPath("mobile-inbox.png") });
    }
  }
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByTestId("workspace-sidebar")
    .getByRole("button", { name: "general", exact: true })
    .click();
  expect(emojiRequests).toHaveLength(0);
  await page.getByRole("button", { name: "Insert emoji", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Insert emoji", exact: true })
      .getByRole("searchbox"),
  ).toBeVisible();
  expect(emojiRequests.length).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Insert emoji", exact: true }),
  ).toHaveCount(0);
});

test("sidebar navigation leaves the new-message route and survives reload", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole("button", { name: "New direct message", exact: true })
    .click();
  await expect(page).toHaveURL(/\/messages\/new$/);
  await page
    .getByTestId("workspace-sidebar")
    .getByRole("button", { name: "general", exact: true })
    .click();
  await expect(page.getByLabel("Message general")).toBeVisible();
  await expect(page).toHaveURL(/\?channel=/);
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await page
    .getByTestId("workspace-sidebar")
    .getByRole("button", { name: "general", exact: true })
    .click();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
});

test("startup retries relay admission hints without losing identity", async ({
  page,
}) => {
  await signIn(page, true);
  await page.reload();
  await expect(page.getByLabel("Message general")).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as {
              __BUZZ_WEB_E2E_HAS_KIND_SUBSCRIPTION__: (kind: number) => boolean;
            }
          ).__BUZZ_WEB_E2E_HAS_KIND_SUBSCRIPTION__(39002),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Could not connect to your workspace" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__BUZZ_WEB_E2E_ADMISSION__()),
  ).toMatchObject({ forcedThrottle: true });
  await expect
    .poll(
      () => page.evaluate(() => window.__BUZZ_WEB_E2E_ADMISSION__().pending),
      { timeout: 15_000 },
    )
    .toBe(0);
  expect(
    await page.evaluate(() => window.__BUZZ_WEB_E2E_TRANSPORT__()),
  ).toEqual({ socketCount: 1, authCount: 1, open: 1 });
});
