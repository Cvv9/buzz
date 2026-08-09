import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "smoke",
      testMatch: [
        "**/smoke.spec.ts",
        "**/browser-local-devices.smoke.spec.ts",
        "**/workspace-identity-and-agents.spec.ts",
        "**/workspace-appearance.spec.ts",
        "**/workspace-reminders.spec.ts",
        "**/workspace-reactions.spec.ts",
        "**/workspace-threads.spec.ts",
        "**/workspace-media.spec.ts",
        "**/workspace-custom-emoji.spec.ts",
        "**/workspace-huddles.spec.ts",
        "**/workspace-profiles-search.spec.ts",
        "**/workspace-workflows.spec.ts",
        "**/workspace-read-state.spec.ts",
        "**/projects.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: "pnpm exec vite preview --port 4173 --strictPort --host 127.0.0.1",
    cwd: ".",
    reuseExistingServer: !process.env.CI,
    url: "http://127.0.0.1:4173",
  },
});
