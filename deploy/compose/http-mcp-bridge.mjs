#!/usr/bin/env node

import readline from "node:readline";

const DEFAULT_TIMEOUT_MS = 30_000;

export function requestError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function forwardMcpMessage(message, {
  fetchImpl = fetch,
  token = process.env.BUZZ_REMOTE_MCP_TOKEN || "",
  timeoutMs = Number(process.env.BUZZ_REMOTE_MCP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  url = process.env.BUZZ_REMOTE_MCP_URL || "",
} = {}) {
  const hasId = Object.hasOwn(message || {}, "id");
  if (!url || !/^https?:\/\//i.test(url)) {
    return hasId ? requestError(message.id, -32000, "Remote MCP URL is not configured") : null;
  }
  if (!token) {
    return hasId ? requestError(message.id, -32000, "Remote MCP credential is not configured") : null;
  }

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    if (!response.ok) {
      return hasId
        ? requestError(message.id, -32001, `Remote MCP returned HTTP ${response.status}`)
        : null;
    }
    if (!body.trim()) return null;
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return hasId
      ? requestError(message.id, -32002, `Remote MCP request failed: ${error.message}`)
      : null;
  }
}

export async function runBridge({ input = process.stdin, output = process.stdout } = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let pending = Promise.resolve();
  for await (const line of lines) {
    if (!line.trim()) continue;
    pending = pending.then(async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify(requestError(null, -32700, "Parse error"))}\n`);
        return;
      }
      const response = await forwardMcpMessage(message);
      if (response) output.write(`${JSON.stringify(response)}\n`);
    });
  }
  await pending;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await runBridge();
}
