import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const gates = [
  "rust-lint",
  "unit-tests",
  "windows-rust",
  "desktop",
  "desktop-build-macos",
  "desktop-e2e-relay",
  "desktop-e2e-integration",
  "backend-integration",
  "postgres-tests",
  "relay-e2e",
  "web",
  "mobile",
  "security",
];
const nativeGates = new Set([
  "windows-rust",
  "desktop",
  "desktop-build-macos",
  "desktop-e2e-integration",
  "mobile",
]);
for (const gate of gates) {
  const body = workflow.match(
    new RegExp(`^  ${gate}:\\r?\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, "m"),
  )[1];
  const condition = body.match(/^ {4}if: ([^\r\n]+)$/m)[1];
  const runMatch = body.match(/^ {8}run: (?:\|\r?\n((?: {10}.*\r?\n?)+)|([^\r\n]+))$/m);
  const command = runMatch[1]
    ? runMatch[1].replace(/^ {10}/gm, "")
    : runMatch[2];
  const normalizedCommand = command.replace(/\r/g, "");
  // Gates may also require sibling job results (e.g. MANUAL_RESULT, ADMIN_RESULT).
  const extraResults = [...body.matchAll(/^ {10}(\w+_RESULT): /gm)]
    .map((m) => m[1])
    .filter((k) => k !== "SELECTION_RESULT" && k !== "RESULT");
  function shouldRun(
    selection,
    selected = false,
    event = "pull_request",
    artifacts = "skipped",
    nativeApps = false,
  ) {
    // These workflow conditions use only booleans, string equality and grouping.
    // Evaluate the actual expression after substituting its GitHub context values.
    assert.match(
      condition,
      /\balways\(\)/,
      "Required wrapper must override GitHub implicit success()",
    );
    const expression = condition
      .replace(/always\(\)/g, "true")
      .replace(
        /github\.event_name|needs\.[\w-]+\.(?:result|outputs\.[\w-]+)/g,
        (key) => {
          if (key === "github.event_name") return JSON.stringify(event);
          if (key === "needs.changes.result") return JSON.stringify(selection);
          if (key === "needs.changes.outputs.run-native-apps")
            return JSON.stringify(nativeApps ? "true" : "false");
          if (key === "needs.relay-artifacts-domain.result")
            return JSON.stringify(artifacts);
          assert.match(key, /^needs\.changes\.outputs\./);
          return JSON.stringify(selected ? "true" : "false");
        },
      );
    return runInNewContext(expression, {}, { timeout: 100 });
  }
  function check(selection, result, overrides = {}) {
    assert.match(body, /SELECTION_RESULT: \$\{\{ needs.changes.result \}\}/);
    assert.match(body, /RESULT: \$\{\{ needs\.[\w-]+\.outputs\.[\w_]+ \}\}/);
    return spawnSync("bash", ["-e", "-c", normalizedCommand], {
      env: {
        ...process.env,
        EVENT_NAME: "push",
        RUST_CHANGED: "true",
        ...Object.fromEntries(extraResults.map((k) => [k, "success"])),
        SELECTION_RESULT: selection,
        RESULT: result,
        ...overrides,
      },
      timeout: 1000,
    }).status;
  }
  test(`${gate}: selector failures run and fail the required check`, () => {
    for (const selection of ["failure", "cancelled", "skipped"]) {
      for (const artifacts of ["skipped", "success"]) {
        assert.equal(
          shouldRun(selection, false, "pull_request", artifacts),
          true,
        );
      }
      for (const result of ["", "skipped", "success"]) {
        assert.notEqual(check(selection, result), 0);
      }
    }
  });
  test(`${gate}: successful selection preserves path gating and suite results`, () => {
    assert.equal(shouldRun("success"), false);
    assert.equal(
      shouldRun("success", true, "pull_request", "success"),
      !nativeGates.has(gate),
    );
    assert.equal(
      shouldRun("success", false, "push", "success"),
      !nativeGates.has(gate),
    );
    if (nativeGates.has(gate)) {
      assert.equal(
        shouldRun("success", true, "workflow_dispatch", "success", true),
        true,
      );
    }
    assert.equal(check("success", "success"), 0);
    for (const result of ["", "failure", "cancelled", "skipped"]) {
      assert.notEqual(check("success", result), 0);
    }
    for (const key of extraResults) {
      for (const result of ["", "failure", "cancelled", "skipped"]) {
        assert.notEqual(check("success", "success", { [key]: result }), 0);
      }
    }
  });
}
