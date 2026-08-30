import { expect, type Page, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

const AGENT = "7".padStart(64, "0");
const DIGEST = "c".repeat(64);

async function signInAndOpenAgents(page: Page, secretKey: Uint8Array) {
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page.getByLabel("Password", { exact: true }).fill("runtime-password");
  await page.getByLabel("Confirm password").fill("runtime-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.locator('a[href="/settings"]').last().click();
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await page.getByTestId("agent-row-workspace-agent-7").click();
}

async function publishedKinds(page: Page, kinds: number[]) {
  return page.evaluate((requestedKinds) => {
    const runtimeWindow = window as typeof window & {
      __BUZZ_WEB_E2E_PUBLISHED__: Array<{
        id: string;
        kind: number;
        content: string;
        tags: string[][];
      }>;
    };
    return runtimeWindow.__BUZZ_WEB_E2E_PUBLISHED__.filter((event) =>
      requestedKinds.includes(event.kind),
    );
  }, kinds);
}

async function emitRuntimeStatus(
  page: Page,
  controllerPubkey: string,
  state: "applying" | "applied",
  createdAt: number,
) {
  await page.evaluate(
    ({ agent, controller, digest, nextState, timestamp }) => {
      const runtimeWindow = window as typeof window & {
        __BUZZ_WEB_E2E_EVENT__: (
          kind: number,
          pubkey: string,
          tags: string[][],
          content: string,
          suffix: string,
          createdAt: number,
        ) => {
          id: string;
          pubkey: string;
          created_at: number;
          kind: number;
          tags: string[][];
          content: string;
          sig: string;
        };
        __BUZZ_WEB_E2E_RECEIVE__: (event: unknown) => void;
      };
      runtimeWindow.__BUZZ_WEB_E2E_RECEIVE__(
        runtimeWindow.__BUZZ_WEB_E2E_EVENT__(
          30181,
          controller,
          [["d", agent]],
          JSON.stringify({
            schema: "buzz.hosted-agent-runtime-status.v1",
            agent_pubkey: agent,
            request_id: "550e8400-e29b-41d4-a716-446655440000",
            revision: 5,
            state: nextState,
            effective: {
              model: "gpt-5.6-sol",
              effort: "high",
              runtime_name: "Workspace Agent 7",
            },
            requested:
              nextState === "applying"
                ? {
                    model: "gpt-5.6-terra",
                    effort: "xhigh",
                    runtime_name: "Workspace Agent 7",
                  }
                : null,
            catalog_digest: digest,
            error: null,
          }),
          `status-${timestamp}`,
          timestamp,
        ),
      );
    },
    {
      agent: AGENT,
      controller: controllerPubkey,
      digest: DIGEST,
      nextState: state,
      timestamp: createdAt,
    },
  );
}

test("owner changes one agent model and effort without changing its public profile", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const controllerPubkey = getPublicKey(generateSecretKey());
  await installWorkspaceRelayMock(page, getPublicKey(secretKey), {
    runtime: {
      agentPubkey: AGENT,
      controllerPubkey,
      catalogDigest: DIGEST,
      model: "gpt-5.6-sol",
      effort: "high",
      state: "pending_busy",
      requestedModel: "gpt-5.6-terra",
      requestedEffort: "medium",
    },
  });
  await signInAndOpenAgents(page, secretKey);

  await expect(page.getByTestId("agent-runtime-status")).toContainText(
    "Queued — applies after current work finishes",
  );
  await page.getByRole("button", { name: "Edit profile" }).click();
  const model = page.getByLabel("Model", { exact: true });
  const effort = page.getByLabel("Reasoning effort", { exact: true });
  await expect(model).toBeEnabled();
  await expect(effort).toBeEnabled();
  await expect(
    model.locator("option", { hasText: "GPT-3.5-Turbo-16k" }),
  ).toHaveCount(1);
  await model.selectOption("gpt-5.6-terra");
  await effort.selectOption("xhigh");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect
    .poll(async () => (await publishedKinds(page, [24201, 30180])).length)
    .toBe(1);
  const [request] = await publishedKinds(page, [24201, 30180]);
  expect(request.kind).toBe(24201);
  expect(request.tags.slice(0, 3)).toEqual([
    ["p", controllerPubkey],
    ["agent", AGENT],
    ["request", expect.any(String)],
  ]);
  expect(request.tags[3]?.[0]).toBe("expiration");
  expect(request.content).not.toContain("gpt-5.6-terra");

  await emitRuntimeStatus(page, controllerPubkey, "applying", 200);
  await expect(page.getByTestId("agent-runtime-status")).toContainText(
    "Applying to new sessions",
  );
  await emitRuntimeStatus(page, controllerPubkey, "applied", 300);
  await expect(page.getByTestId("agent-runtime-status")).toContainText(
    "Applied",
  );
});

test("owner rename publishes presentation first, preserves legacy model, and updates the live roster", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const controllerPubkey = getPublicKey(generateSecretKey());
  await installWorkspaceRelayMock(page, getPublicKey(secretKey), {
    hostedAgentConfig: {
      agentPubkey: AGENT,
      name: "Workspace Agent 7",
      avatarUrl: "",
      model: "gpt-3.5-turbo-16k",
    },
    runtime: {
      agentPubkey: AGENT,
      controllerPubkey,
      catalogDigest: DIGEST,
      model: "gpt-5.6-sol",
      effort: "high",
      state: "current",
    },
  });
  await signInAndOpenAgents(page, secretKey);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("Name").fill("Opportunity Scout");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect
    .poll(async () => (await publishedKinds(page, [30180, 24201])).length)
    .toBe(2);
  const writes = await publishedKinds(page, [30180, 24201]);
  expect(writes.map((event) => event.kind)).toEqual([30180, 24201]);
  expect(JSON.parse(writes[0]?.content ?? "{}")).toMatchObject({
    name: "Opportunity Scout",
    model: "gpt-3.5-turbo-16k",
  });
  await expect(page.getByText(/^Opportunity Scout — /).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^Opportunity Scout — /).first()).toBeVisible();
});

test("admins can inspect hosted runtime state but cannot change it", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  await installWorkspaceRelayMock(page, getPublicKey(secretKey), {
    communityRole: "admin",
    runtime: {
      agentPubkey: AGENT,
      controllerPubkey: getPublicKey(generateSecretKey()),
      catalogDigest: DIGEST,
      state: "current",
    },
  });
  await signInAndOpenAgents(page, secretKey);
  await expect(
    page.getByRole("button", { name: "Edit profile" }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Only the current community owner can change hosted agents.",
    ),
  ).toBeVisible();
});
