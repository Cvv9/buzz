import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { patchBundle, sha256 } from '../patch-codex-acp.mjs';

const packageRoot = process.env.BUZZ_TEST_CODEX_ACP_PACKAGE ?? '/usr/local/lib/node_modules/@agentclientprotocol/codex-acp';
const source = readFileSync(resolve(packageRoot, 'dist/index.js'), 'utf8');
const expectedPatched = 'eadb92f996c2bca4b1cd7c09a79fa80e817329d7ac0d79d39ce4aeaf752d842d';
const patched = sha256(source) === expectedPatched ? source : patchBundle(source);
assert.equal(sha256(patched), expectedPatched);
// Execute the actual pinned bundle's event handler, not a rewritten classifier.
const start = patched.indexOf('  async createErrorEvent(params) {');
const end = patched.indexOf('  isAuthenticationRequiredError(', start);
const method = patched.slice(start, end).trim();
const handler = new Function('RequestError', 'createAgentTextMessageChunk', `return ({${method}}).createErrorEvent`)(
  { internalError: data => ({ code: -32603, data }), authRequired: (data, message) => ({ code: -32000, data, message }) },
  text => ({ sessionUpdate: 'agent_message_chunk', text }),
);
const completionStart = patched.indexOf('        const error52 = eventHandler.getFailure();');
const completionEnd = patched.indexOf('        };', completionStart) + '        };'.length;
const completeBranch = new Function('eventHandler', 'sessionState', patched.slice(completionStart, completionEnd));
const complete = state => completeBranch.call({ buildPromptUsage: () => null, buildQuotaMeta: () => null }, { getFailure: () => state.failure }, {});
function context(authConfigured = true) {
  return { failure: null, sessionState: { authConfigured },
    createTurnErrorData: error => ({ codexErrorInfo: error.codexErrorInfo }),
    createCodexSessionInfoUpdate: update => ({ update }),
    isAuthenticationRequiredError: info => info === 'unauthorized' || info?.httpConnectionFailed?.httpStatusCode === 401 };
}
for (const info of ['usageLimitExceeded', { httpConnectionFailed: { httpStatusCode: 429 } }, { responseStreamConnectionFailed: { httpStatusCode: 503 } }, null, 'unknown']) {
  test(`terminal error yields structured failure: ${JSON.stringify(info)}`, async () => {
    const state = context();
    await handler.call(state, { error: { codexErrorInfo: info, message: 'fixture only' }, willRetry: false, turnId: 'turn' });
    assert.equal(state.failure.code, -32603);
    assert.throws(() => complete(state), error => error.code === -32603);
    assert.deepEqual(state.failure.data.codexErrorInfo, info);
  });
}
test('retry notifications do not prematurely terminate a turn', async () => {
  const state = context();
  const update = await handler.call(state, { error: { codexErrorInfo: 'unknown', message: 'retrying' }, willRetry: true, turnId: 'turn' });
  assert.equal(state.failure, null);
  assert.equal(update.update.error.willRetry, true);
});
test('401 preserves the adapter authentication-required distinction', async () => {
  const state = context(false);
  await handler.call(state, { error: { codexErrorInfo: 'unauthorized', message: 'fixture auth' }, willRetry: false });
  assert.equal(state.failure.code, -32000);
});
test('a normal turn retains the unchanged success branch', () => {
  assert.equal(context().failure, null);
  assert.equal(complete(context()).stopReason, 'end_turn');
});
test('patch refuses any unexpected source bytes', () => {
  assert.throws(() => patchBundle(source + '\n'), /unverified patch/);
});

const failedStart = patched.indexOf('        if (notification.params.turn.status === "failed" && !this.failure) {');
const failedEnd = patched.indexOf('        await this.flushPendingPlanUpdates();', failedStart);
const completeNotification = new Function('notification', 'RequestError', patched.slice(failedStart, failedEnd));
for (const error of [null, { message: 'fixture', codexErrorInfo: 'unknown' }]) {
  test(`failed completion without an error notification fails: ${JSON.stringify(error)}`, () => {
    const state = context();
    completeNotification.call(state, { params: { turn: { status: 'failed', error } } }, { internalError: data => ({ code: -32603, data }) });
    assert.throws(() => complete(state), failure => failure.code === -32603);
  });
}
test('failed completion preserves an earlier authentication failure', () => {
  const state = context(false);
  state.failure = { code: -32000 };
  completeNotification.call(state, { params: { turn: { status: 'failed', error: null } } }, {});
  assert.equal(state.failure.code, -32000);
});
