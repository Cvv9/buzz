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
    .fill("profile-search-password");
  await page.getByLabel("Confirm password").fill("profile-search-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
}

test("web profile edits preserve kind 0 JSON and project live status events", async ({
  page,
}) => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  await installWorkspaceRelayMock(page, pubkey);
  await signIn(page, secret);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const hasSubscription = (
          window as typeof window & {
            __BUZZ_WEB_E2E_HAS_KIND_SUBSCRIPTION__: (kind: number) => boolean;
          }
        ).__BUZZ_WEB_E2E_HAS_KIND_SUBSCRIPTION__;
        return hasSubscription(9) && hasSubscription(30315);
      }),
    )
    .toBe(true);

  await page.evaluate((eventPubkey) => {
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
        eventPubkey,
        [["h", "general"]],
        "A message carrying my status",
        "400",
      ),
    );
  }, pubkey);
  await expect(page.getByText("A message carrying my status")).toBeVisible();
  await page.evaluate((eventPubkey) => {
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
        30315,
        eventPubkey,
        [
          ["d", "general"],
          ["emoji", "🛰️"],
        ],
        "Updated from desktop",
        "400-status",
      ),
    );
  }, pubkey);
  await expect(
    page.getByLabel("Current status: 🛰️ Updated from desktop"),
  ).toBeVisible();

  await page
    .getByTestId("workspace-sidebar")
    .locator('a[href="/settings"]')
    .click();
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save profile" }),
  ).toBeVisible();

  await page.evaluate((eventPubkey) => {
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
        30315,
        eventPubkey,
        [
          ["d", "general"],
          ["emoji", "🍜"],
        ],
        "At lunch",
        "401",
      ),
    );
  }, pubkey);
  await expect(page.getByText("At lunch")).toBeVisible();

  await page.getByLabel("Display name").fill("Vikram Sharma");
  await page.getByLabel("About").fill("Building browser parity.");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const published = (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              content: string;
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__;
        const events = published.filter((event) => event.kind === 0);
        const content = JSON.parse(events.at(-1)?.content ?? "{}");
        return (
          content.name === "Vikram Sharma" &&
          content.display_name === "Vikram Sharma" &&
          content.picture ===
            "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" &&
          content.about === "Building browser parity." &&
          content.custom_field === "preserve-me"
        );
      }),
    )
    .toBe(true);
  const profileContent = await page.evaluate(() => {
    const published = (
      window as typeof window & {
        __BUZZ_WEB_E2E_PUBLISHED__: Array<{ kind: number; content: string }>;
      }
    ).__BUZZ_WEB_E2E_PUBLISHED__;
    return JSON.parse(
      published.filter((event) => event.kind === 0).at(-1)?.content ?? "{}",
    );
  });
  expect(profileContent).toMatchObject({
    name: "Vikram Sharma",
    display_name: "Vikram Sharma",
    picture:
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    about: "Building browser parity.",
    custom_field: "preserve-me",
  });

  await page.getByLabel("Status emoji").fill("🛠️");
  await page.getByLabel("Status message").fill("Shipping profile parity");
  await page.getByRole("button", { name: "Set status" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              content: string;
              tags: string[][];
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.findLast((event) => event.kind === 30315),
      ),
    )
    .toMatchObject({
      kind: 30315,
      content: "Shipping profile parity",
      tags: [
        ["d", "general"],
        ["emoji", "🛠️"],
      ],
    });

  await page.getByRole("button", { name: "Clear status" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_PUBLISHED__: Array<{
              kind: number;
              content: string;
              tags: string[][];
            }>;
          }
        ).__BUZZ_WEB_E2E_PUBLISHED__.findLast((event) => event.kind === 30315),
      ),
    )
    .toMatchObject({
      kind: 30315,
      content: "",
      tags: [["d", "general"]],
    });
});

test("hosted agent presentation wins over a kind 0 profile on the profile route", async ({
  page,
}) => {
  const secret = generateSecretKey();
  const viewerPubkey = getPublicKey(secret);
  const agentPubkey = "7".padStart(64, "0");
  await installWorkspaceRelayMock(page, viewerPubkey, {
    hostedAgentConfig: {
      agentPubkey,
      name: "Sylar",
      avatarUrl: "https://example.test/sylar.png",
      model: "gpt-5.6-terra",
    },
  });
  await signIn(page, secret);
  await page.goto(`/profiles/${agentPubkey}`);
  await expect(page.getByRole("heading", { name: "Sylar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save profile" })).toHaveCount(
    0,
  );
});

test("global search sends bounded NIP-50 filters and provides thread navigation", async ({
  page,
}) => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const rootId = "d".repeat(64);
  await installWorkspaceRelayMock(page, pubkey, {
    searchEvents: [
      {
        kind: 40002,
        pubkey,
        tags: [
          ["h", "random"],
          ["e", rootId, "", "root"],
        ],
        content: "Launch decision confirmed",
        suffix: "501",
        createdAt: Math.floor(Date.now() / 1_000),
      },
    ],
  });
  await signIn(page, secret);
  await page.getByRole("link", { name: "Search workspace" }).click();
  await page.getByLabel("Search text").fill("launch");
  await page.getByLabel("Channel ID").fill("random");
  await page.getByLabel("Author public key").fill(pubkey);
  await page.getByLabel("After").fill("2020-01-01T00:00");
  await page.getByLabel("Before").fill("2030-01-01T00:00");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Launch decision confirmed")).toBeVisible();

  const filter = await page.evaluate(() =>
    (
      window as typeof window & {
        __BUZZ_WEB_E2E_LAST_SEARCH_FILTER__: () => Record<
          string,
          unknown
        > | null;
      }
    ).__BUZZ_WEB_E2E_LAST_SEARCH_FILTER__(),
  );
  expect(filter).toMatchObject({
    search: "launch",
    authors: [pubkey],
    "#h": ["random"],
  });
  expect(filter?.kinds).toEqual(
    expect.arrayContaining([9, 40002, 45001, 45003, 30617, 30621]),
  );
  expect(filter?.since).toEqual(expect.any(Number));
  expect(filter?.until).toEqual(expect.any(Number));

  await page.getByRole("link", { name: "Open channel thread" }).click();
  await expect(page).toHaveURL(`/?channel=random&thread=${rootId}`);
});
