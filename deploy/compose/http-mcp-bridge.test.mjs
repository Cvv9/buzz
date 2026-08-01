import assert from "node:assert/strict";
import test from "node:test";

import { forwardMcpMessage } from "./http-mcp-bridge.mjs";

test("forwards JSON-RPC with a bearer credential", async () => {
  let captured;
  const result = await forwardMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {
    token: "secret",
    url: "https://example.test/mcp",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), { status: 200 });
    },
  });

  assert.equal(captured.url, "https://example.test/mcp");
  assert.equal(captured.init.headers.authorization, "Bearer secret");
  assert.deepEqual(result, { jsonrpc: "2.0", id: 1, result: { tools: [] } });
});

test("does not answer a failed notification", async () => {
  const result = await forwardMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, {
    token: "secret",
    url: "https://example.test/mcp",
    fetchImpl: async () => new Response("no", { status: 500 }),
  });
  assert.equal(result, null);
});

test("does not expose the remote response body in errors", async () => {
  const result = await forwardMcpMessage({ jsonrpc: "2.0", id: 7, method: "tools/call" }, {
    token: "secret",
    url: "https://example.test/mcp",
    fetchImpl: async () => new Response("sensitive upstream detail", { status: 403 }),
  });
  assert.equal(result.error.message, "Remote MCP returned HTTP 403");
  assert.doesNotMatch(JSON.stringify(result), /sensitive/);
});
