#!/usr/bin/env node
// Narrow patch for the pinned ACP adapter: terminal provider errors must fail
// session/prompt, rather than silently resolving with prose plus end_turn.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const upstreamSha256 = '9634b5457e44d55471d0969bcc5a2a1d4cbb83ba637eaf023d34d2e975fd7db8';
const needle = '      this.failure = this.sessionState.authConfigured ? RequestError.internalError(this.createTurnErrorData(params.error)) : RequestError.authRequired(this.createTurnErrorData(params.error), params.error.message);\n    }\n    return createAgentTextMessageChunk';
const replacement = '      this.failure = this.sessionState.authConfigured ? RequestError.internalError(this.createTurnErrorData(params.error)) : RequestError.authRequired(this.createTurnErrorData(params.error), params.error.message);\n    } else {\n      this.failure = RequestError.internalError(this.createTurnErrorData(params.error));\n    }\n    return createAgentTextMessageChunk';
const completionNeedle = '      case "turn/completed":\n        await this.flushPendingPlanUpdates();';
const completionReplacement = '      case "turn/completed":\n        if (notification.params.turn.status === "failed" && !this.failure) {\n          this.failure = RequestError.internalError(this.createTurnErrorData(notification.params.turn.error ?? { message: "Codex turn failed", codexErrorInfo: null, additionalDetails: null }));\n        }\n        await this.flushPendingPlanUpdates();';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function patchBundle(source) {
  if (sha256(source) !== upstreamSha256 || source.split(needle).length !== 2 || source.split(completionNeedle).length !== 2) {
    throw new Error('Unexpected codex-acp 1.1.14 bundle: refusing an unverified patch');
  }
  return source.replace(needle, replacement).replace(completionNeedle, completionReplacement);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? '/usr/local/lib/node_modules/@agentclientprotocol/codex-acp';
  const marker = process.argv[3] ?? '/etc/buzz/codex-acp-terminal-errors.json';
  if (JSON.parse(readFileSync(resolve(root, 'package.json'))).version !== '1.1.14') throw new Error('Unexpected adapter version');
  const path = resolve(root, 'dist/index.js');
  const patched = patchBundle(readFileSync(path, 'utf8'));
  writeFileSync(path, patched);
  writeFileSync(marker, JSON.stringify({ patch: 'terminal-errors-v1', version: '1.1.14', bundle_sha256: sha256(patched) }) + '\n', { mode: 0o444 });
}
