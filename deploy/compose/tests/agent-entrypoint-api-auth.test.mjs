import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, "../../..");
const entrypoint = resolve(root, "deploy/compose/agent-entrypoint.sh");
const shell = process.env.BUZZ_TEST_SH ?? "sh";

function executable(path, source) {
  writeFileSync(path, source, { encoding: "utf8", mode: 0o755 });
  chmodSync(path, 0o755);
}

test("API-key startup discards a stale copied Codex subscription session", () => {
  const temporary = mkdtempSync(resolve(tmpdir(), "buzz-agent-api-auth-"));
  try {
    const bin = resolve(temporary, "bin");
    const codexHome = resolve(temporary, ".codex");
    mkdirSync(bin);
    mkdirSync(codexHome);
    const staleAuth = resolve(codexHome, "auth.json");
    writeFileSync(staleAuth, '{"tokens":{"access_token":"personal-session"}}\n');

    executable(resolve(bin, "id"), "#!/bin/sh\necho 1000\n");
    executable(resolve(bin, "buzz"), "#!/bin/sh\nexit 0\n");
    executable(
      resolve(bin, "buzz-acp"),
      "#!/bin/sh\nif [ \"${1:-}\" = models ]; then printf '{\\\"canonical\\\":{}}'; fi\nexit 0\n",
    );

    execFileSync(shell, [entrypoint], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
        HOME: temporary,
        OPENAI_API_KEY: "sk-proj_1234567890abcdefghijklmnopqrstuv",
        VARVIK_AGENT_PUBKEY: "a".repeat(64),
        BUZZ_PRIVATE_KEY: "b".repeat(64),
        BUZZ_ACP_SKIP_MEMBER_BOOTSTRAP: "true",
      },
    });

    assert.equal(existsSync(staleAuth), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
