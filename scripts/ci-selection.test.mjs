import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const reusableWorkflows = Object.fromEntries(
  ["_ci-rust.yml", "_ci-desktop.yml", "_ci-desktop-macos.yml", "_ci-clients.yml", "_ci-relay.yml"].map(
    (name) => [
      name,
      readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"),
    ],
  ),
);
const releaseWorkflows = Object.fromEntries(
  ["desktop-release-candidate.yml", "release.yml", "mobile-release-candidate.yml"].map(
    (name) => [
      name,
      readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"),
    ],
  ),
);
const scratch = mkdtempSync(join(tmpdir(), "buzz-ci-selection-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const actionSha = workflow.match(/uses: dorny\/paths-filter@([a-f0-9]{40})/)[1];
const filters = workflow
  .match(/ {10}filters: \|\r?\n([\s\S]*?)(?= {6}- name:)/)[1]
  .split("\n")
  .map((line) => line.slice(12))
  .join("\n");
// GitHub-hosted runners prepare pinned actions beside RUNNER_TEMP before any
// steps run. Reuse that bundle, without another download in the selection gate.
// Locally, point PATHS_FILTER_ACTION at dist/index.js from the pinned action.
const actionPath =
  process.env.PATHS_FILTER_ACTION ||
  (process.env.RUNNER_TEMP &&
    join(
      process.env.RUNNER_TEMP,
      "..",
      "_actions",
      "dorny",
      "paths-filter",
      actionSha,
      "dist",
      "index.js",
    ));
const hasPathsFilter = Boolean(actionPath && existsSync(actionPath));
assert.ok(
  hasPathsFilter || process.env.CI !== "true",
  `Set PATHS_FILTER_ACTION to the local dist/index.js from dorny/paths-filter@${actionSha}`,
);
const pathsFilterTest = hasPathsFilter ? test : test.skip;
async function runSelection(rawOutputs, eventName, runNativeApps = false, eventPath = "") {
  const selectedOutput = join(scratch, `selected-${Math.random()}`);
  await promisify(execFile)(
    process.execPath,
    [fileURLToPath(new URL("./ci-runtime-selection.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        FILTER_OUTPUTS: JSON.stringify(rawOutputs),
        RUN_NATIVE_APPS: String(runNativeApps),
        GITHUB_EVENT_NAME: eventName,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: selectedOutput,
      },
      timeout: 10000,
    },
  );
  return Object.fromEntries(
    readFileSync(selectedOutput, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
}
async function select(paths, pullRequest = false, apiStatus = 200) {
  const repo = mkdtempSync(join(scratch, "repo-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe", timeout: 10000 });
  git("init", "-q");
  // Fixture repositories must not inherit developer machine hooks.
  mkdirSync(join(repo, "empty-hooks"));
  git("config", "core.hooksPath", join(repo, "empty-hooks"));
  git(
    "-c",
    "user.name=CI fixture",
    "-c",
    "user.email=ci@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "fixture",
    "-s",
  );
  for (const path of paths) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), "fixture\n");
  }
  git("add", ".");
  let server;
  let apiUrl;
  const eventPath = join(scratch, `event-${repo.split("/").pop()}.json`);
  if (pullRequest) {
    const commit = (message) =>
      git(
        "-c",
        "user.name=CI fixture",
        "-c",
        "user.email=ci@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        message,
        "-s",
      );
    const base = git("rev-parse", "HEAD").toString().trim();
    commit("PR documentation or code");
    const head = git("rev-parse", "HEAD").toString().trim();
    git("checkout", "-qb", "upstream", base);
    const upstreamPath = "desktop/src/upstream-only.ts";
    mkdirSync(dirname(join(repo, upstreamPath)), { recursive: true });
    writeFileSync(join(repo, upstreamPath), "upstream change\n");
    git("add", upstreamPath);
    commit("Unrelated upstream desktop change");
    git(
      "-c",
      "user.name=CI fixture",
      "-c",
      "user.email=ci@example.com",
      "-c",
      "commit.gpgsign=false",
      "merge",
      "--no-ff",
      "-m",
      "Synthetic merge",
      head,
    );
    git("checkout", "--detach");
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 7809,
          changed_files: paths.length,
          base: { sha: base },
          head: { sha: head },
        },
        repository: { default_branch: "main" },
      }),
    );
    // Serve the PR file list, which intentionally excludes the newer base's code.
    server = createServer((request, response) => {
      assert.equal(
        request.url,
        "/repos/block/buzz/pulls/7809/files?per_page=100",
      );
      response.setHeader("Content-Type", "application/json");
      if (apiStatus !== 200) {
        response.writeHead(apiStatus);
        response.end(JSON.stringify({ message: "Fixture access denied" }));
        return;
      }
      response.end(
        JSON.stringify(
          paths
            .slice(0, 3000)
            .map((filename) => ({ filename, status: "added" })),
        ),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    apiUrl = `http://127.0.0.1:${server.address().port}`;
  }
  const output = join(repo, "action-output");
  writeFileSync(output, "");
  try {
    await promisify(execFile)(process.execPath, [actionPath], {
      cwd: repo,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        INPUT_BASE: pullRequest ? "" : "HEAD",
        INPUT_FILTERS: filters,
        // Resolve the workflow's token expression to a fixture token. Removing
        // it must reproduce the contaminated git comparison in the PR fixture.
        INPUT_TOKEN:
          pullRequest && /token: \$\{\{ github\.token \}\}/.test(workflow)
            ? "fixture-token"
            : "",
        INPUT_REF: "",
        GITHUB_EVENT_NAME: pullRequest ? "pull_request" : "",
        GITHUB_EVENT_PATH: pullRequest ? eventPath : "",
        GITHUB_REPOSITORY: "block/buzz",
        GITHUB_API_URL: apiUrl || "https://api.github.com",
        GITHUB_OUTPUT: output,
        "INPUT_PREDICATE-QUANTIFIER":
          workflow.match(/predicate-quantifier: ['"]?([\w-]+)/)?.[1] ?? "some",
      },
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
  const rawOutputs = Object.fromEntries(
    [
      ...readFileSync(output, "utf8").matchAll(
        /^(rust|desktop|desktop-rust|web|mobile)<<([^\n]+)\n(true|false)\n\2/gm,
      ),
    ].map(([, key, , value]) => [key, value]),
  );
  return runSelection(
    rawOutputs,
    pullRequest ? "pull_request" : "push",
    false,
    eventPath,
  );
}
const scenarios = [
  [
    "mobile source and tests",
    [
      "mobile/lib/features/age_gate/age_signal_provider.dart",
      "mobile/test/features/age_gate/age_signal_provider_test.dart",
    ],
    ["mobile"],
  ],
  ["mobile lockfile", ["mobile/pubspec.lock"], ["mobile"]],
  ["mobile release script", ["scripts/mobile-release.sh"], ["mobile"]],
  ["desktop", ["desktop/src/main.tsx"], ["desktop"]],
  ["Tauri", ["desktop/src-tauri/src/main.rs"], ["desktop", "desktop-rust"]],
  ["relay", ["crates/buzz-relay/src/main.rs"], ["rust"]],
  ["migration", ["migrations/123.sql"], ["rust"]],
  ["shared workflow", [".github/workflows/ci.yml"], ["rust", "web", "mobile"]],
  ["integration services", ["docker-compose.yml"], ["rust"]],
  ["CI integration images", ["docker-compose.ci.yml"], ["rust"]],
  [
    "mixed mobile and relay",
    ["mobile/lib/main.dart", "crates/buzz-core/src/lib.rs"],
    ["rust", "mobile"],
  ],
  [
    "mixed mobile and desktop",
    ["mobile/lib/main.dart", "desktop/src/main.tsx"],
    ["desktop", "mobile"],
  ],
  ["web", ["web/src/main.tsx"], ["web"]],
  ["documentation", ["README.md"], []],
  [
    "incident documentation",
    ["CONTEXT.md", "docs/mobile-push-suppression.md", "VISION_MOBILE.md"],
    [],
  ],
  [
    "nested docs directory",
    ["docs/mobile/design.md", "docs/nips/NIP-FI.md"],
    [],
  ],
  ["crate Markdown", ["crates/buzz-cli/README.md"], ["rust"]],
  ["desktop Markdown", ["desktop/README.md"], ["desktop"]],
  [
    "Tauri Markdown",
    ["desktop/src-tauri/README.md"],
    ["desktop", "desktop-rust"],
  ],
  ["web Markdown", ["web/docs/design.md"], ["web"]],
  ["mobile Markdown", ["mobile/test/README.md"], ["mobile"]],
  ["schema Markdown", ["schema/README.md"], ["rust"]],
  ["migration Markdown", ["migrations/README.md"], ["rust"]],
  [
    "mixed documentation and desktop",
    ["VISION_MOBILE.md", "docs/mobile/design.md", "desktop/src/main.tsx"],
    ["desktop"],
  ],
  [
    "mixed documentation and relay",
    ["docs/desktop/design.md", "crates/buzz-relay/src/lib.rs"],
    ["rust"],
  ],
  ["embedded ACP prompt", ["crates/buzz-acp/src/base_prompt.md"], ["rust"]],
  [
    "embedded Tauri skill",
    ["desktop/src-tauri/src/managed_agents/nest_skill.md"],
    ["desktop", "desktop-rust"],
  ],
];
for (const [name, paths, expected] of scenarios) {
  pathsFilterTest(`real paths-filter: ${name}`, async () => {
    const outputs = await select(paths);
    assert.equal(Object.keys(outputs).length, 6);
    assert.deepEqual(
      Object.keys(outputs)
        .filter((key) => outputs[key] === "true")
        .sort(),
      expected.filter((key) => !["desktop", "desktop-rust", "mobile"].includes(key)).sort(),
    );
  });
}

for (const [name, paths, expected] of [
  [
    "docs-only",
    ["CONTEXT.md", "docs/mobile-push-suppression.md", "VISION_MOBILE.md"],
    [],
  ],
  [
    "mixed mobile and Markdown",
    ["VISION_MOBILE.md", "mobile/lib/main.dart"],
    ["mobile"],
  ],
  [
    "mixed desktop and Markdown",
    ["CONTEXT.md", "desktop/src/main.tsx"],
    ["desktop"],
  ],
]) {
  pathsFilterTest(`PR file list ignores newer base changes: ${name}`, async () => {
    const outputs = await select(paths, true);
    assert.equal(Object.keys(outputs).length, 6);
    assert.deepEqual(
      Object.keys(outputs)
        .filter((key) => outputs[key] === "true")
        .sort(),
      expected.filter((key) => !["desktop", "desktop-rust", "mobile"].includes(key)).sort(),
    );
  });
}

test("workflow consumes guarded selection outputs", () => {
  const outputs = workflow.match(/ {4}outputs:\r?\n([\s\S]*?) {4}steps:/)[1];
  for (const key of ["rust", "desktop", "desktop-rust", "web", "mobile", "run-native-apps"]) {
    assert.ok(outputs.includes(`steps.selection.outputs.${key}`));
  }
  assert.match(workflow, /run_native_apps:[\s\S]*?type: boolean[\s\S]*?default: false/);
  assert.match(workflow, /RUN_NATIVE_APPS: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.run_native_apps \|\| false \}\}/);
});
test("manual native profile requires its explicit opt-in", async () => {
  const all = Object.fromEntries(
    ["rust", "desktop", "desktop-rust", "web", "mobile"].map((key) => [key, "true"]),
  );
  const defaults = await runSelection(all, "workflow_dispatch", false);
  assert.equal(defaults.rust, "true");
  assert.equal(defaults.web, "true");
  assert.equal(defaults["run-native-apps"], "false");
  for (const key of ["desktop", "desktop-rust", "mobile"]) {
    assert.equal(defaults[key], "false");
  }
  const native = await runSelection(all, "workflow_dispatch", true);
  assert.equal(native["run-native-apps"], "true");
  for (const key of ["desktop", "desktop-rust", "mobile"]) {
    assert.equal(native[key], "true");
  }
  const push = await runSelection(all, "push", true);
  assert.equal(push["run-native-apps"], "false");
  for (const key of ["desktop", "desktop-rust", "mobile"]) {
    assert.equal(push[key], "false");
  }
});
test("native reusable jobs are opt-in while relay artifacts stay in the server lane", () => {
  assert.ok(
    (workflow.match(/run_native_apps: \$\{\{ needs\.changes\.outputs\.run-native-apps == 'true' \}\}/g) ?? []).length >= 5,
  );
  assert.match(reusableWorkflows["_ci-rust.yml"], /if: inputs\.lane == 'required' && inputs\.run_native_apps && \(github\.event_name == 'push' \|\| inputs\.rust \|\| inputs\.desktop_rust\)/);
  assert.match(reusableWorkflows["_ci-rust.yml"], /rust-lint:[\s\S]*?if: inputs\.lane == 'required' && \(github\.event_name == 'push' \|\| inputs\.rust \|\| \(inputs\.run_native_apps && inputs\.desktop_rust\)\)/);
  assert.match(workflow, /name: Rust Lint\r?\n\s+if: always\(\) && \(needs\.changes\.result != 'success' \|\| github\.event_name == 'push' \|\| needs\.changes\.outputs\.rust == 'true' \|\| \(needs\.changes\.outputs\.run-native-apps == 'true' && needs\.changes\.outputs\.desktop-rust == 'true'\)\)/);
  assert.match(reusableWorkflows["_ci-desktop.yml"], /if: inputs\.run_native_apps &&/);
  assert.match(reusableWorkflows["_ci-desktop-macos.yml"], /if: inputs\.run_native_apps &&/);
  assert.match(reusableWorkflows["_ci-clients.yml"], /if: inputs\.lane == 'required' && inputs\.run_native_apps && \(github\.event_name == 'push' \|\| inputs\.mobile\)/);
  assert.match(reusableWorkflows["_ci-relay.yml"], /if: inputs\.lane == 'required' && inputs\.run_native_apps && \(github\.event_name == 'push' \|\| inputs\.desktop/);
  assert.match(workflow, /name: Relay Artifact Producer\r?\n[\s\S]*?if: github\.event_name == 'push' \|\| needs\.changes\.outputs\.rust == 'true'/);
  assert.match(workflow, /Manual Workflow Integration \(PostgreSQL 17\)/);
  for (const file of ["_ci-rust.yml", "_ci-desktop.yml", "_ci-desktop-macos.yml", "_ci-clients.yml", "_ci-relay.yml"]) {
    assert.match(reusableWorkflows[file], /run_native_apps:\r?\n\s+required: false\r?\n\s+type: boolean\r?\n\s+default: true/);
  }
});
test("independent desktop and mobile release workflows remain intact", () => {
  assert.match(releaseWorkflows["desktop-release-candidate.yml"], /startsWith\(github\.event\.pull_request\.head\.ref, 'version-bump\/'\)/);
  assert.match(releaseWorkflows["release.yml"], /tags:\r?\n\s+- 'desktop-v\[0-9\]\*'/);
  assert.match(releaseWorkflows["mobile-release-candidate.yml"], /workflow_dispatch:\r?\n\s+inputs:/);
  for (const workflow of Object.values(releaseWorkflows)) {
    assert.doesNotMatch(workflow, /run_native_apps/);
  }
});

for (const count of [2999, 3000, 3001]) {
  test(`runtime selection PR file-list ceiling: ${count} changed files`, async () => {
    const eventPath = join(scratch, `runtime-event-${count}.json`);
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { changed_files: count } }),
    );
    const rawOutputs = Object.fromEntries(
      ["rust", "desktop", "desktop-rust", "web", "mobile"].map((key) => [key, "false"]),
    );
    const outputs = await runSelection(rawOutputs, "pull_request", false, eventPath);
    const fallback = count >= 3000;
    assert.equal(outputs.rust, fallback ? "true" : "false");
    assert.equal(outputs.web, fallback ? "true" : "false");
    for (const key of ["desktop", "desktop-rust", "mobile"]) {
      assert.equal(outputs[key], "false");
    }
    assert.equal(outputs["run-native-apps"], "false");
  });

  pathsFilterTest(`PR file-list ceiling: ${count} changed files`, async () => {
    const paths = Array.from(
      { length: Math.min(count, 3000) },
      (_, i) => `docs/file-${i}.md`,
    );
    if (count > 3000) paths.push("desktop/src/omitted-by-api.ts");
    const outputs = await select(paths, true);
    assert.deepEqual(
      Object.keys(outputs)
        .filter((key) => outputs[key] === "true")
        .sort(),
      count >= 3000 ? ["rust", "web"] : [],
    );
  });
}

pathsFilterTest("PR API denial fails path selection instead of reporting no changes", async () => {
  await assert.rejects(select(["README.md"], true, 403), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout + error.stderr, /Fixture access denied/);
    return true;
  });
});
