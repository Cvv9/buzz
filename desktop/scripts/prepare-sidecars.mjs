import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoDir = resolve(desktopDir, "..");
const binariesDir = join(desktopDir, "src-tauri", "binaries");
const packages = [
  ["buzz-acp", "buzz-acp"],
  ["buzz-agent", "buzz-agent"],
  ["buzz-dev-mcp", "buzz-dev-mcp"],
  ["git-credential-nostr", "git-credential-nostr"],
  ["buzz-cli", "buzz"],
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoDir,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoDir,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const rustcInfo = capture("rustc", ["-vV"]);
const hostLine = rustcInfo
  .split(/\r?\n/)
  .find((line) => line.startsWith("host: "));
const host = hostLine?.slice("host: ".length).trim();
if (!host) throw new Error("Could not determine the Rust host target.");

run("cargo", [
  "build",
  "--release",
  ...packages.flatMap(([packageName]) => ["-p", packageName]),
]);

const metadata = JSON.parse(
  capture("cargo", ["metadata", "--format-version", "1", "--no-deps"]),
);
const extension = host.includes("windows") ? ".exe" : "";
mkdirSync(binariesDir, { recursive: true });

for (const [, binaryName] of packages) {
  const source = join(
    metadata.target_directory,
    "release",
    `${binaryName}${extension}`,
  );
  const destination = join(binariesDir, `${binaryName}-${host}${extension}`);
  const sourceSize = statSync(source).size;
  if (sourceSize === 0) {
    throw new Error(`Refusing to bundle empty sidecar: ${source}`);
  }
  copyFileSync(source, destination);
  if (statSync(destination).size !== sourceSize) {
    throw new Error(`Sidecar copy verification failed: ${destination}`);
  }
}

console.log(`Prepared ${packages.length} non-empty sidecars for ${host}.`);
