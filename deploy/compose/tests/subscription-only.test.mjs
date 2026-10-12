import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = fileURLToPath(new URL('../agent-entrypoint.sh', import.meta.url));
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'sh';
const base = { ...process.env, BUZZ_SUBSCRIPTION_ONLY: 'true', BUZZ_AGENT_ENTRYPOINT_POLICY_ONLY: 'true' };

test('subscription-only startup strips legacy paid credentials and actual fallback fields', () => {
  const result = spawnSync(shell, [script], { encoding: 'utf8', env: { ...base,
    OPENAI_API_KEY: 'test-key', CODEX_API_KEY: 'test-key', ANTHROPIC_API_KEY: 'test-key',
    AZURE_FOUNDRY_API_KEY: 'test-key', AZURE_FOUNDRY_BASE_URL: 'https://example.invalid/',
    BUZZ_ACP_FAILOVER_ENV: '{"MODEL_PROVIDER":"azure-foundry"}',
    BUZZ_ACP_FAILOVER_AGENT_ARGS: '--provider paid', BUZZ_ACP_FAILOVER_MODEL: 'paid-model',
    MODEL_PROVIDER: 'azure-foundry', CODEX_CONFIG: '{"model":"gpt-6.1-sol","model_provider":"openai","model_reasoning_effort":"medium"}',
  } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { subscriptionOnly: true, paidFieldsPresent: false, provider: 'openai' });
  assert.equal(result.stdout.includes('test-key'), false);
});

test('subscription-only startup rejects a layered custom provider configuration', () => {
  for (const config of ['{"model_provider":"azure-foundry"}', '{"model_providers":{"paid":{"base_url":"https://example.invalid/"}}}', '{"forced_login_method":"api"}', 'invalid']) {
    const result = spawnSync(shell, [script], { encoding: 'utf8', env: { ...base, CODEX_CONFIG: config } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /built-in ChatGPT provider/);
  }
});

test('subscription-only authentication validation rejects mounted API credentials before copying', () => {
  const directory = mkdtempSync(join(tmpdir(), 'buzz-subscription-auth-'));
  try {
    const source = join(directory, 'auth.json');
    for (const auth of [
      { auth_mode: 'apikey', OPENAI_API_KEY: 'test-key' },
      { auth_mode: 'chatgpt', OPENAI_API_KEY: 'test-key', tokens: { access_token: 'test-token' } },
      { auth_mode: 'chatgpt', tokens: {} },
    ]) {
      writeFileSync(source, JSON.stringify(auth));
      const result = spawnSync(shell, [script], { encoding: 'utf8', env: { ...base,
        BUZZ_AGENT_ENTRYPOINT_POLICY_ONLY: 'false', BUZZ_AGENT_ENTRYPOINT_AUTH_ONLY: 'true', BUZZ_TEST_AUTH_SOURCE: source,
      } });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ChatGPT subscription authentication/);
      assert.equal(result.stdout.includes('test-key'), false);
    }
    writeFileSync(source, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'test-token' } }));
    const result = spawnSync(shell, [script], { encoding: 'utf8', env: { ...base,
      BUZZ_AGENT_ENTRYPOINT_POLICY_ONLY: 'false', BUZZ_AGENT_ENTRYPOINT_AUTH_ONLY: 'true', BUZZ_TEST_AUTH_SOURCE: source,
    } });
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(directory, { recursive: true }); }
});
