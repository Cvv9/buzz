import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";

const filters = JSON.parse(process.env.FILTER_OUTPUTS);
const runNativeApps =
  process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
  process.env.RUN_NATIVE_APPS === "true";
let runAll = false;
if (process.env.GITHUB_EVENT_NAME === "pull_request") {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const count = event.pull_request.changed_files;
  assert.ok(
    Number.isSafeInteger(count) && count >= 0,
    "Invalid PR changed_files",
  );
  // GitHub's PR-files endpoint returns at most 3,000 files. If the list may
  // be incomplete, select every enabled production suite; native-only suites
  // below still require the explicit manual opt-in.
  runAll = count >= 3000;
}
for (const key of ["rust", "desktop", "desktop-rust", "web", "mobile"]) {
  assert.ok(
    ["true", "false"].includes(filters[key]),
    `Invalid ${key} selection`,
  );
  const nativeOnly = ["desktop", "desktop-rust", "mobile"].includes(key);
  const selected = runAll || filters[key] === "true";
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${key}=${nativeOnly ? runNativeApps && selected : selected}\n`,
  );
}
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `run-native-apps=${runNativeApps}\n`,
);
