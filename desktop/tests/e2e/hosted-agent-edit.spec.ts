import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const HOSTED_AGENT_PUBKEY = "8f44f5ed".repeat(8);
const MOCK_OWNER_PUBKEY = "deadbeef".repeat(8);

test("admin can edit a hosted agent identity and advertised model", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayAgents: [
      {
        pubkey: HOSTED_AGENT_PUBKEY,
        name: "Lanaya",
        agentType: "codex",
        avatarUrl: "https://relay.example/lanaya.png",
        audience: "owner",
        ownerPubkey: MOCK_OWNER_PUBKEY,
        accessTier: "personal",
        channelNames: ["agents"],
        model: "gpt-5.5",
        models: [
          { id: "gpt-5.5", name: "GPT-5.5" },
          { id: "gpt-5.4", name: "GPT-5.4" },
        ],
      },
    ],
  });

  await page.goto("/");
  await page.getByTestId("open-agents-view").click();
  await page.getByTestId(`hosted-agent-${HOSTED_AGENT_PUBKEY}`).click();

  const profile = page.getByTestId("user-profile-panel");
  await expect(profile).toContainText("Lanaya");
  await page.getByTestId("user-profile-header-edit-agent").click();

  const dialog = page.getByTestId("hosted-agent-edit-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("hosted-agent-name")).toHaveValue("Lanaya");
  await expect(page.getByTestId("hosted-agent-model")).toHaveValue("gpt-5.5");
  await expect(
    page.getByTestId("hosted-agent-model").locator("option"),
  ).toHaveText([
    "Runtime default",
    "Opus",
    "Fable",
    "Sol",
    "Luna",
    "Terra",
    "GPT-5.5",
    "GPT-5.4",
    "Custom model…",
  ]);

  await waitForAnimations(page);
  await dialog.screenshot({
    path: "test-results/screenshots/hosted-agent-edit.png",
  });
});
