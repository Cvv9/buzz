import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const MOCK_PUBKEY = "deadbeef".repeat(8);

// Reminders has its own route. Tests should open it directly rather than rely
// on the Inbox filter menu, which is reserved for the decision Inbox.
async function gotoReminders(page: import("@playwright/test").Page) {
  await page.goto("/#/reminders");
  await expect(page).toHaveURL(/#\/reminders$/);
  await expect(page.getByTestId("home-inbox-reminders")).toBeVisible({
    timeout: 10_000,
  });
}

// The reminders query mounts (for the badge) before tests seed events, so a
// bare seed lands behind its cached empty result. Invalidate after seeding to
// force the refetch that picks up the mock events.
async function seedReminders(
  page: import("@playwright/test").Page,
  events: unknown[],
) {
  await page.evaluate((seeded) => {
    window.__BUZZ_E2E_SEED_MOCK_REMINDERS__?.(
      seeded as Parameters<
        NonNullable<typeof window.__BUZZ_E2E_SEED_MOCK_REMINDERS__>
      >[0],
    );
    window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
      queryKey: ["reminders"],
    });
  }, events);
}

function mockReminderEvent(opts: {
  id: string;
  dTag: string;
  content: string;
  notBefore: number;
  createdAt?: number;
}) {
  return {
    id: opts.id,
    pubkey: MOCK_PUBKEY,
    created_at: opts.createdAt ?? Math.floor(Date.now() / 1000) - 300,
    kind: 30300,
    tags: [
      ["d", opts.dTag],
      ["not_before", String(opts.notBefore)],
    ],
    content: opts.content,
    sig: "mocksig".repeat(20).slice(0, 128),
  };
}

test.describe("reminders", () => {
  test.beforeEach(async ({ page }) => {
    await installMockBridge(page);
  });

  test("01 — dedicated Reminders route shows the personal surface", async ({
    page,
  }) => {
    await gotoReminders(page);

    await expect(page.getByTestId("inbox-filter-trigger")).toHaveText(
      "Reminders",
    );
    await waitForAnimations(page);
  });

  test("02 — message action menu shows Remind me later", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");

    const messageRow = page.getByTestId("message-row").first();
    await messageRow.hover();

    const moreActionsButton = messageRow.getByRole("button", {
      name: "More actions",
    });
    await expect(moreActionsButton).toBeVisible();
    await moreActionsButton.click();

    const remindItem = page.getByRole("menuitem", {
      name: "Remind me later",
    });
    await expect(remindItem).toBeVisible();
    await waitForAnimations(page);
  });

  test("03 — Remind me later dialog with time presets", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");

    const messageRow = page.getByTestId("message-row").first();
    await messageRow.hover();

    const moreActionsButton = messageRow.getByRole("button", {
      name: "More actions",
    });
    await moreActionsButton.click();

    const remindItem = page.getByRole("menuitem", {
      name: "Remind me later",
    });
    await expect(remindItem).toBeVisible();
    await waitForAnimations(page);
    await remindItem.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Remind me later")).toBeVisible();
    await expect(dialog.getByText("In 30 minutes")).toBeVisible();
    await expect(dialog.getByText("Custom date & time")).toBeVisible();
    await waitForAnimations(page);
  });

  test("04 — Reminders panel empty state", async ({ page }) => {
    await gotoReminders(page);

    await expect(page.getByText("No reminders")).toBeVisible();
    await waitForAnimations(page);
  });

  test("05 — Reminders panel with active pending reminder", async ({
    page,
  }) => {
    await gotoReminders(page);

    // Seed a pending reminder due in the future
    const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
    const reminderContent = JSON.stringify({
      target: {
        eventId: "mock-general-welcome",
        channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
        preview: "Welcome to #general",
        authorPubkey: MOCK_PUBKEY,
      },
      note: "Follow up on this message",
      status: "pending",
    });

    await seedReminders(page, [
      mockReminderEvent({
        id: "reminder-active-01",
        dTag: "rem-active-01",
        content: reminderContent,
        notBefore: futureTimestamp,
      }),
    ]);

    await expect(
      page
        .getByTestId("home-reminder-item-rem-active-01")
        .getByText("Follow up on this message"),
    ).toBeVisible();
    await waitForAnimations(page);
  });

  test("06 — Reminders panel with fired/overdue reminder", async ({ page }) => {
    await gotoReminders(page);

    // Seed a reminder that has already fired (notBefore in the past)
    const pastTimestamp = Math.floor(Date.now() / 1000) - 7200;
    const overdueContent = JSON.stringify({
      target: {
        eventId: "mock-general-alice",
        channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
        preview: "Hey team — checking in.",
        authorPubkey:
          "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
      },
      note: "Reply to Alice",
      status: "pending",
    });

    // Also seed a future reminder so both states are visible
    const futureTimestamp = Math.floor(Date.now() / 1000) + 7200;
    const activeContent = JSON.stringify({
      target: {
        eventId: "mock-general-welcome",
        channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
        preview: "Welcome to #general",
        authorPubkey: MOCK_PUBKEY,
      },
      status: "pending",
    });

    await seedReminders(page, [
      mockReminderEvent({
        id: "reminder-overdue-01",
        dTag: "rem-overdue-01",
        content: overdueContent,
        notBefore: pastTimestamp,
      }),
      mockReminderEvent({
        id: "reminder-upcoming-01",
        dTag: "rem-upcoming-01",
        content: activeContent,
        notBefore: futureTimestamp,
      }),
    ]);

    await expect(
      page
        .getByTestId("home-reminder-item-rem-overdue-01")
        .getByText("Reply to Alice"),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("home-reminder-item-rem-overdue-01")
        .getByText("2h overdue"),
    ).toBeVisible();
    await waitForAnimations(page);
  });
});

// Phase 2 — author + source at a glance, and click-to-navigate. Both cases
// seed a reminder targeting Alice's seeded message in #general (event
// `mock-general-alice`, channel `9a1657ac-…`), so the author resolves to
// "alice" and the channel label to "general" from the live profile/channel
// queries — no "Unknown channel" fallback.
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const ALICE_PUBKEY =
  "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f";

function aliceReminderContent() {
  return JSON.stringify({
    target: {
      eventId: "mock-general-alice",
      channelId: GENERAL_CHANNEL_ID,
      preview: "Hey team — checking in.",
      authorPubkey: ALICE_PUBKEY,
    },
    note: "Reply to Alice",
    status: "pending",
  });
}

test.describe("reminders personal surface badge", () => {
  test.beforeEach(async ({ page }) => {
    await installMockBridge(page);
  });

  test("09 — pending reminders stay on their surface and do not badge Inbox", async ({
    page,
  }) => {
    await gotoReminders(page);

    // A reminder belongs on the dedicated personal surface. It must not create
    // an approval-Inbox badge merely because it is due.
    const pastTimestamp = Math.floor(Date.now() / 1000) - 7200;
    await seedReminders(page, [
      mockReminderEvent({
        id: "reminder-navbadge-01",
        dTag: "rem-navbadge-01",
        content: aliceReminderContent(),
        notBefore: pastTimestamp,
      }),
    ]);

    await expect(
      page.getByTestId("home-reminder-item-rem-navbadge-01"),
    ).toBeVisible();
    await expect(page.getByTestId("inbox-filter-trigger")).toHaveAttribute(
      "aria-label",
      "Filter inbox: Reminders. 1 due reminder",
    );
    await expect(page.getByTestId("sidebar-home-count")).toHaveCount(0);
    await waitForAnimations(page);
  });
});

test.describe("reminders phase 2 — author, source, navigation", () => {
  test.beforeEach(async ({ page }) => {
    await installMockBridge(page);
  });

  test("07 — reminder row shows author and source channel", async ({
    page,
  }) => {
    await gotoReminders(page);

    const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
    await seedReminders(page, [
      mockReminderEvent({
        id: "reminder-phase2-source-01",
        dTag: "rem-phase2-source-01",
        content: aliceReminderContent(),
        notBefore: futureTimestamp,
      }),
    ]);

    // Author + source line resolves from the live profile/channel queries.
    // Scope to the reminders panel to avoid matching the "general" entry in
    // the sidebar channel list.
    const remindersPanel = page.getByTestId("home-inbox-reminders");
    await expect(
      remindersPanel.getByText("alice", { exact: true }),
    ).toBeVisible();
    await expect(
      remindersPanel.getByText("#general", { exact: true }),
    ).toBeVisible();
    await expect(remindersPanel.getByText("Reply to Alice")).toBeVisible();
    await waitForAnimations(page);
  });

  test("08 — clicking a reminder navigates to the message in context", async ({
    page,
  }) => {
    await gotoReminders(page);

    const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
    await seedReminders(page, [
      mockReminderEvent({
        id: "reminder-phase2-nav-01",
        dTag: "rem-phase2-nav-01",
        content: aliceReminderContent(),
        notBefore: futureTimestamp,
      }),
    ]);

    // Selecting a reminder keeps the list visible and opens its detail pane.
    // Navigation is an explicit action from that detail.
    await page
      .getByTestId("home-reminder-item-rem-phase2-nav-01")
      .getByRole("button")
      .first()
      .click();
    await page
      .getByTestId("home-reminder-detail")
      .getByRole("button", { name: "Open message" })
      .click();

    // Lands in the #general chat view with the target message in context.
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await expect(
      page.getByTestId("message-timeline").getByText("Hey team — checking in."),
    ).toBeVisible();
    await waitForAnimations(page);
  });
});
