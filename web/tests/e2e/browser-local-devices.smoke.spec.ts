import { expect, test } from "@playwright/test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  derivePairingSessionId,
  pairingHex,
  parsePairingUri,
} from "../../src/features/pairing/pairing-policy";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

for (const scenario of [
  "abort",
  "legacy-abort",
  "sent-abort",
  "correct-code",
  "five-wrong-codes",
] as const) {
  test(`phone pairing source handles ${scenario} over signed encrypted events`, async ({
    page,
  }) => {
    const secret = generateSecretKey();
    await installWorkspaceRelayMock(page, getPublicKey(secret));
    let subscriptionId = "";
    const messages: Array<{
      type: string;
      payload?: string;
      payload_type?: string;
      remaining_attempts?: number;
    }> = [];
    const phoneSecret = generateSecretKey();
    let sourcePubkey = "";
    await page.exposeFunction("__PAIRING_SEND__", (raw: string) => {
      const frame = JSON.parse(String(raw));
      if (frame[0] === "REQ") subscriptionId = frame[1];
      if (frame[0] === "EVENT") {
        messages.push(
          JSON.parse(
            nip44.decrypt(
              frame[1].content,
              nip44.utils.getConversationKey(phoneSecret, sourcePubkey),
            ),
          ),
        );
      }
    });
    await page.route("http://127.0.0.1:4173/", async (route) => {
      if (route.request().headers().accept === "application/nostr+json") {
        await route.fulfill({
          contentType: "application/nostr+json",
          body: JSON.stringify({
            pairing_relay_url: "ws://127.0.0.1:4173/phone-pairing",
          }),
        });
      } else await route.continue();
    });
    await page.goto("/");
    await page.getByLabel("Display name").fill("Pairing QA");
    await page.getByLabel("Recovery key").fill(nsecEncode(secret));
    await page
      .getByLabel("Password", { exact: true })
      .fill("pairing-test-password");
    await page.getByLabel("Confirm password").fill("pairing-test-password");
    await page
      .getByRole("button", { name: "Sign in with recovery key" })
      .click();
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    await page.goto("/pairing");
    await page.evaluate(() => {
      const callbacks = window as typeof window & {
        __PAIRING_SEND__: (raw: string) => Promise<void>;
        __PAIRING_RECEIVE__: (raw: string) => void;
      };
      class PairingSocket extends EventTarget {
        readyState = 0;
        constructor() {
          super();
          callbacks.__PAIRING_RECEIVE__ = (raw) =>
            this.dispatchEvent(new MessageEvent("message", { data: raw }));
          window.setTimeout(() => {
            this.readyState = 1;
            this.dispatchEvent(new Event("open"));
          }, 0);
        }
        send(raw: string) {
          void callbacks.__PAIRING_SEND__(raw);
        }
        close() {
          this.readyState = 3;
          this.dispatchEvent(new Event("close"));
        }
      }
      window.WebSocket = new Proxy(window.WebSocket, {
        construct(target, args) {
          return Reflect.construct(
            String(args[0]).includes("/phone-pairing") ? PairingSocket : target,
            args,
          );
        },
      });
    });
    await page
      .getByRole("button", { name: "Create one-time pairing code" })
      .click();
    await expect(page.getByTestId("pairing-qr")).toBeVisible();
    const qr = parsePairingUri(
      await page.getByLabel("One-time pairing code").inputValue(),
    );
    sourcePubkey = qr.sourcePubkey;
    await expect.poll(() => subscriptionId).not.toBe("");
    const send = async (message: Record<string, unknown>) => {
      const event = finalizeEvent(
        {
          kind: 24134,
          tags: [["p", sourcePubkey]],
          created_at: Math.floor(Date.now() / 1000),
          content: nip44.encrypt(
            JSON.stringify(message),
            nip44.utils.getConversationKey(phoneSecret, sourcePubkey),
          ),
        },
        phoneSecret,
      );
      await page.evaluate(
        (raw) =>
          (
            window as typeof window & {
              __PAIRING_RECEIVE__: (raw: string) => void;
            }
          ).__PAIRING_RECEIVE__(raw),
        JSON.stringify(["EVENT", subscriptionId, event]),
      );
    };
    await send({
      type: "offer",
      session_id: pairingHex(await derivePairingSessionId(qr.sessionSecret)),
      version: 1,
      ...(scenario === "legacy-abort"
        ? {}
        : { confirmation: "desktop-code-v1" }),
    });
    const instruction = page.getByText(
      scenario === "legacy-abort"
        ? "Compare this code with the target device"
        : "Type this code into the Buzz app on your phone",
    );
    await expect(instruction).toBeVisible();
    expect(messages.some((message) => message.type === "payload")).toBe(false);
    if (scenario === "abort" || scenario === "legacy-abort") {
      await send({ type: "abort", reason: "user_denied" });
    } else if (scenario === "sent-abort") {
      const code = (
        await instruction.locator("..").locator("p").nth(1).textContent()
      )?.trim();
      await send({ type: "code-submit", code, request_id: "sent-abort" });
      await expect
        .poll(() => messages.some((message) => message.type === "payload"))
        .toBe(true);
      await send({ type: "abort", reason: "user_denied" });
    } else if (scenario === "correct-code") {
      const code = (
        await instruction.locator("..").locator("p").nth(1).textContent()
      )?.trim();
      await send({ type: "code-submit", code, request_id: "correct" });
      await expect
        .poll(() => messages.some((message) => message.type === "payload"))
        .toBe(true);
      const payload = messages.find((message) => message.type === "payload");
      expect(payload?.payload_type).toBe("custom");
      const identity = JSON.parse(payload?.payload ?? "{}");
      // Boolean comparisons keep recovery material out of assertion diagnostics.
      expect(identity.nsec === nsecEncode(secret)).toBe(true);
      expect(identity.pubkey === getPublicKey(secret)).toBe(true);
      expect(identity.relayUrl).toBe("http://127.0.0.1:4173");
    } else {
      for (let attempt = 1; attempt <= 5; attempt++) {
        await send({
          type: "code-submit",
          code: "not-a-code",
          request_id: String(attempt),
        });
        await expect
          .poll(
            () =>
              messages.filter((message) => message.type === "code-rejected")
                .length,
          )
          .toBe(attempt);
      }
      await expect(page.getByRole("alert")).toHaveText(
        "Too many incorrect codes. Create a new pairing code and try again.",
      );
      expect(messages.at(-1)?.remaining_attempts).toBe(0);
      expect(messages.some((message) => message.type === "payload")).toBe(
        false,
      );
    }
    if (
      scenario === "abort" ||
      scenario === "legacy-abort" ||
      scenario === "sent-abort"
    ) {
      await expect(page.getByRole("alert")).toHaveText(
        "The target cancelled pairing.",
      );
      await expect(instruction).toHaveCount(0);
      await expect(page.getByTestId("pairing-qr")).toHaveCount(0);
    }
  });
}

test("browser-local archive, pairing, and preferences stay capability- and lock-gated", async ({
  page,
}) => {
  const secret = generateSecretKey();
  await installWorkspaceRelayMock(page, getPublicKey(secret));

  await page.goto("/offline");
  await expect(
    page.getByText(
      "Unlock a browser identity before reading or creating an encrypted offline archive.",
    ),
  ).toBeVisible();

  await page.goto("/");
  await page.getByLabel("Display name").fill("Browser local QA");
  await page.getByLabel("Recovery key").fill(nsecEncode(secret));
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-local-qa-password");
  await page.getByLabel("Confirm password").fill("browser-local-qa-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();

  await page.goto("/offline");
  await expect(
    page.getByRole("heading", { name: "Offline channel archive" }),
  ).toBeVisible();
  await page
    .getByLabel("Backup passphrase")
    .fill("browser-local-export-password");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download encrypted backup" }).click();
  expect((await download).suggestedFilename()).toBe(
    "buzz-offline-archive.encrypted.json",
  );

  await page.goto("/preferences");
  await expect(
    page.getByRole("heading", { name: "Notifications and accessibility" }),
  ).toBeVisible();
  await page.getByLabel("Reduce non-essential motion").check();
  await expect(page.locator("html")).toHaveAttribute(
    "data-buzz-reduced-motion",
    "true",
  );
  await page.getByLabel("Text size").selectOption("larger");
  await expect(page.locator("html")).toHaveAttribute(
    "data-buzz-font-scale",
    "larger",
  );

  await page.goto("/pairing");
  await expect(
    page.getByRole("heading", { name: "Pair this browser" }),
  ).toBeVisible();
  await page.getByLabel("Pairing code").fill("not-a-pairing-uri");
  await page.getByRole("button", { name: "Join pairing" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    /Pairing code must be a nostrpair:\/\/ URI/,
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "BarcodeDetector", {
      configurable: true,
      value: undefined,
    });
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(String(input), window.location.href);
      if (url.origin === window.location.origin && url.pathname === "/") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              pairing_relay_url: "ws://127.0.0.1:4173/pairing",
            }),
            {
              headers: { "Content-Type": "application/nostr+json" },
              status: 200,
            },
          ),
        );
      }
      return originalFetch(input, init);
    };
  });
  await page.reload();
  await expect(
    page.getByText(
      "Camera QR scanning is unavailable in this browser. You can still paste a pairing code below.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create one-time pairing code" })
    .click();
  await expect(page.getByTestId("pairing-qr")).toBeVisible();
  await expect(page.getByText(/Expires in 2:00/)).toBeVisible();

  await page.goto("/");
  await page
    .getByTestId("workspace-sidebar")
    .locator('a[href="/settings"]')
    .click();
  await page.getByRole("button", { name: "Lock and sign out" }).click();
  await page.goto("/offline");
  await expect(
    page.getByText(
      "Unlock a browser identity before reading or creating an encrypted offline archive.",
    ),
  ).toBeVisible();
});
