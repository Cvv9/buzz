import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
const source = readFileSync(new URL('../agent-entrypoint.sh', import.meta.url), 'utf8');
// Execute the exact production credential preparation functions in disposable
// homes. UID transitions and the complete entrypoint are covered by image smoke.
const functions = source.slice(source.indexOf('normalize_codex_api_key() {'), source.indexOf('extract_profile_model_catalog() {'));
for (const apiKeyName of ['CODEX_API_KEY', 'OPENAI_API_KEY']) {
  test(`${apiKeyName} discards stale ordinary and manual subscription copies`, () => {
    const temporary = mkdtempSync(resolve(tmpdir(), 'buzz-agent-api-auth-'));
    try {
      const ordinary = resolve(temporary, 'ordinary'), manual = resolve(temporary, 'manual');
      for (const home of [ordinary, manual]) {
        mkdirSync(resolve(home, '.codex'), { recursive: true });
        writeFileSync(resolve(home, '.codex/auth.json'), '{"tokens":{"access_token":"stale-fixture"}}');
      }
      const env = { ...process.env }; delete env.CODEX_API_KEY; delete env.OPENAI_API_KEY;
      env[apiKeyName] = 'dummy-api-fixture';
      const script = `${functions}\nnormalize_codex_api_key\nprepare_codex_auth "$1" "$2" "$3"\nprintf '%s' "$OPENAI_API_KEY"`;
      assert.equal(execFileSync(process.env.BUZZ_TEST_SH ?? 'sh', ['-c', script, 'auth-test', ordinary, manual, resolve(temporary, 'no-source')], { env, encoding: 'utf8' }), 'dummy-api-fixture');
      for (const home of [ordinary, manual]) assert.equal(existsSync(resolve(home, '.codex/auth.json')), false);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
}
test('an explicit API key remains authoritative over its alias', () => {
  const output = execFileSync('sh', ['-c', `${functions}\nnormalize_codex_api_key\nprintf '%s' "$OPENAI_API_KEY"`], {
    encoding:'utf8', env:{...process.env,OPENAI_API_KEY:'explicit-fixture',CODEX_API_KEY:'alias-fixture'},
  });
  assert.equal(output, 'explicit-fixture');
});
