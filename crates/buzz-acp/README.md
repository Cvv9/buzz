# buzz-acp

For one prepared local task, use **`buzz-acp run --task <path|->`**. See
[Local task runner and version-1 task contract](TASKS.md). With no command,
`buzz-acp` remains the conversational service.


ACP harness that connects AI agents to Buzz. The harness listens for @mentions on the relay, prompts your agent, and the agent replies using the Buzz CLI.

```
Buzz Relay ──WS──→ buzz-acp ──stdio──→ Your Agent
                                               │
                                          Buzz CLI
                                       (send_message, etc.)
```

Supports any agent that speaks [ACP](https://agentclientprotocol.com/) over stdio: **goose**, **codex** (via [codex-acp](https://github.com/agentclientprotocol/codex-acp)), and **claude code** (via [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)).

## Prerequisites

- A running Buzz relay (`just relay` starts Docker services automatically, or use a hosted instance)
- A Nostr keypair for the agent (see [Generating Keys](#generating-keys))

Build:

```bash
cargo build --release -p buzz-acp
export PATH="$PWD/target/release:$PATH"
```

## Generating Keys

Each agent needs a Nostr keypair — this is the agent's identity in Buzz. Use `buzz-admin` to generate one:

```bash
cargo run -p buzz-admin -- generate-key
```

This prints a public and secret key pair as hex. **Save the secret key immediately — it is not stored and cannot be recovered.** Set `BUZZ_PRIVATE_KEY` to the secret key to act as this identity.

Then register the agent's public key as a relay member so it can read and publish:

```bash
BUZZ_RELAY_PRIVATE_KEY=<relay signing key> \
  cargo run -p buzz-admin -- add-member --pubkey <agent public key>
```

`add-member` publishes a kind:13534 membership event, so the relay needs a stable signing key: set `BUZZ_RELAY_PRIVATE_KEY` in the relay's environment (uncomment it in `.env`) and restart the relay before running this.

> **Running multiple agents?** Mint a separate keypair for each. Every agent needs its own identity.

## Channels

The harness discovers channels by querying the relay with the agent's authenticated identity.

By default, the harness discovers only channels the agent is a **member** of (`GET /api/channels?member=true`). When the agent is added to a new channel, the membership notification subscription auto-subscribes to it.

**Private channels** require explicit membership. The relay doesn't yet have a REST/event API for managing channel members — this is a known gap. For now, use `create_channel` via the Buzz CLI to create new channels (the creator is automatically a member).

## Quick Start (goose)

```bash
export BUZZ_PRIVATE_KEY="nsec1..."   # your agent's key (see "Generating Keys")
export BUZZ_RELAY_URL="ws://localhost:3000"
export GOOSE_MODE=auto

buzz-acp
```

That's it. The harness spawns `goose acp`, connects to the relay, discovers channels, and starts listening. When someone @mentions the agent, goose receives the message and can reply using the Buzz CLI that the harness configures automatically.

## Running with Codex

[codex-acp](https://github.com/agentclientprotocol/codex-acp) wraps OpenAI Codex in an ACP interface.

```bash
# Install the adapter (npm package — no Rust build required)
npm install -g @agentclientprotocol/codex-acp

# Run
export OPENAI_API_KEY="sk-..."   # required — use an OpenAI API key, not a ChatGPT subscription

buzz-acp
```

> **API key note:** `codex-acp` always attempts a ChatGPT WebSocket login first, which logs a `426 Upgrade Required` error. This is expected and non-fatal — it falls back to `OPENAI_API_KEY` automatically. Set `OPENAI_API_KEY` to ensure it has a working fallback.

## Running with Claude Code

[claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) wraps the Claude Agent SDK in an ACP interface.

```bash
# Install the current adapter package
npm install -g @agentclientprotocol/claude-agent-acp

# Run
export ANTHROPIC_API_KEY="sk-ant-..."
export BUZZ_ACP_AGENT_COMMAND="claude-agent-acp"

buzz-acp
```

Older installs that still expose `claude-code-acp` are also supported. `buzz-acp`
treats both Claude ACP command names as the same zero-arg runtime.

## Configuration

All configuration is via environment variables (or CLI flags — every env var has a matching flag).

### Core

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BUZZ_PRIVATE_KEY` | **yes** | — | Agent's Nostr private key (`nsec1...`). Used for relay auth and agent identity. |
| `BUZZ_RELAY_URL` | no | `ws://localhost:3000` | Relay WebSocket URL. |
| `BUZZ_ACP_AGENT_COMMAND` | no | `goose` | Agent binary to spawn. |
| `BUZZ_ACP_AGENT_ARGS` | no | `acp` | Agent arguments (comma-separated). |
| `BUZZ_ACP_MCP_COMMAND` | no | `""` (empty) | Path to an optional MCP server binary to provide to the agent subprocess. |
| `BUZZ_ACP_IDLE_TIMEOUT` | no | `620` | Idle timeout: max seconds of silence before cancelling a turn. Resets on any agent stdout activity. |
| `BUZZ_ACP_MAX_TURN_DURATION` | no | `7200` | Absolute wall-clock cap per turn (safety valve). |
| `BUZZ_API_TOKEN` | no | — | API token (required if relay enforces token auth). |

**Note:** `BUZZ_ACP_AGENT_ARGS` splits on commas. For args with values, use: `-c,key="value"`.

**Legacy env vars:** `BUZZ_ACP_PRIVATE_KEY`, `BUZZ_ACP_API_TOKEN`, and `BUZZ_ACP_TURN_TIMEOUT` (replaced by `BUZZ_ACP_IDLE_TIMEOUT`) are still accepted as fallbacks.

### Parallel Agents & Heartbeat

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--agents` | `BUZZ_ACP_AGENTS` | `1` | Number of agent subprocesses (1–32). |
| `--lazy-pool` | `BUZZ_ACP_LAZY_POOL` | `false` | Connect, subscribe, and queue accepted work before starting ACP/LLM subprocesses. The first accepted event wakes one pool initialization task; failures retry with bounded exponential backoff while work remains. |
| `--heartbeat-interval` | `BUZZ_ACP_HEARTBEAT_INTERVAL` | `0` | Seconds between heartbeat prompts. `0` = disabled. Must be `0` or ≥10 when enabled. |
| `--heartbeat-prompt` | `BUZZ_ACP_HEARTBEAT_PROMPT` | (built-in) | Custom heartbeat prompt text. Conflicts with `--heartbeat-prompt-file`. |
| `--heartbeat-prompt-file` | `BUZZ_ACP_HEARTBEAT_PROMPT_FILE` | — | Read heartbeat prompt from a file. Conflicts with `--heartbeat-prompt`. |

### Provider failover

The harness can automatically switch newly spawned agent processes to an
alternate provider when the primary one starts returning errors that look
like a usage/rate limit (rather than a transient bug), then switch back once
a cooldown elapses. This is harness-generic — it works with any adapter, not
just Codex — but the `deploy/compose/` bundle wires it specifically for a
ChatGPT-subscription `codex-acp` failing over to an Azure AI Foundry /
Azure OpenAI Responses endpoint (see [deploy/compose/README.md](../../deploy/compose/README.md)).

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--failover-agent-args` | `BUZZ_ACP_FAILOVER_AGENT_ARGS` | — | Extra CLI args appended to `--agent-args` only while running in failover mode (comma-separated, same splitting rules as `--agent-args`). Adapter-dependent — see the Codex note below. |
| `--failover-env` | `BUZZ_ACP_FAILOVER_ENV` | — | Extra env vars injected only in failover mode, as a **single JSON object string** (e.g. `{"MODEL_PROVIDER":"azure-foundry","CODEX_CONFIG":"{\"model\":\"x\"}"}`) — not comma-split `KEY=VALUE` pairs, because a value like a `CODEX_CONFIG` payload legitimately contains commas. Wins over a same-keyed persona env var. |
| `--failover-model` | `BUZZ_ACP_FAILOVER_MODEL` | — | Desired model while in failover mode. `None` leaves model selection to `--failover-agent-args` or the adapter default. |
| `--failover-triggers` | `BUZZ_ACP_FAILOVER_TRIGGERS` | `usage_limit,usage limit,rate_limit_exceeded,insufficient_quota,quota exceeded,too many requests,internal error` | Comma-separated, case-insensitive substrings matched against an application error message. |
| `--failover-threshold` | `BUZZ_ACP_FAILOVER_THRESHOLD` | `2` | Consecutive trigger-matching errors required before activating failover. Must be `>= 1`. |
| `--failover-cooldown-secs` | `BUZZ_ACP_FAILOVER_COOLDOWN_SECS` | `3600` | Seconds to stay on the failover provider before returning to primary. `0` disables the cooldown — stays on failover until process restart. |

Failover is **disabled** unless at least one of `--failover-agent-args`,
`--failover-env`, or `--failover-model` is set — the triggers/threshold/cooldown
alone don't do anything on their own.

**Semantics:**

- **Threshold / consecutive matches.** Only *consecutive* application-class
  errors that match a trigger count toward the threshold. A successful turn,
  or an error that doesn't match a trigger, resets the streak to zero.
- **Activation replaces the agent process.** When the threshold is hit, the
  harness spawns a fresh process with the failover args/env/model and shuts
  down the old one — this is a deliberate provider switch, not a crash, so it
  does not count against the crash-loop circuit breaker. In-flight ACP
  sessions on the replaced process are lost; the next turn on that channel
  starts a fresh session on the new process.
- **Cooldown / return to primary.** Once `--failover-cooldown-secs` elapses
  since activation, the harness returns to the primary provider the same
  way — idle failover agents are replaced on the next maintenance tick, and
  checked-out ones are replaced as soon as they finish their current turn.
  `0` means never time out automatically (stays on failover until the
  process is restarted).
- **Why `internal error` is a default trigger.** `codex-acp` surfaces a
  ChatGPT-subscription usage-limit hit as a bare JSON-RPC `-32603 Internal
  error`, indistinguishable at the message level from other internal errors.
  It's in the default trigger list so the common case works out of the box;
  operators who see false-positive failovers should narrow
  `--failover-triggers` to something more specific for their setup.

**`codex-acp` ignores CLI config flags.** The published `@agentclientprotocol/codex-acp`
adapter always spawns `codex app-server` as a bare command — it does not
accept `-c`/`--config`/`-m` flags. Config reaches Codex only via the
`CODEX_CONFIG` env var (a JSON object spread into the `thread/start` `config`
param) and the provider via the `MODEL_PROVIDER` env var, both inherited from
the harness's own environment. For Codex, use `--failover-env`, not
`--failover-agent-args`.

**Example — Codex on a ChatGPT subscription failing over to Azure AI Foundry:**

The `CODEX_CONFIG` value can define the provider inline via its own
`model_providers` map — no `~/.codex/config.toml` edit needed, which also
means this works when `config.toml` is mounted read-only (as it is in
production):

```bash
buzz-acp --agent-command codex-acp \
  --failover-env '{"MODEL_PROVIDER":"azure-foundry","CODEX_CONFIG":"{\"model\":\"hermes-gpt-5-5\",\"model_provider\":\"azure-foundry\",\"model_providers\":{\"azure-foundry\":{\"name\":\"Azure Foundry (failover)\",\"base_url\":\"https://<resource>.openai.azure.com/openai/v1\",\"env_key\":\"AZURE_FOUNDRY_API_KEY\",\"wire_api\":\"responses\",\"query_params\":{\"api-version\":\"2025-04-01-preview\"}}}}"}'
```

`deploy/compose/agent-entrypoint.sh` builds this JSON automatically from
`AZURE_FOUNDRY_*` env vars (using `node -e ... JSON.stringify(...)` so the
doubly-nested escaping is guaranteed correct) — see
[deploy/compose/README.md](../../deploy/compose/README.md).

### Inbound Author Gate

Controls which authors' events the harness forwards to the agent. Events from disallowed authors are silently dropped before reaching subscription rules.

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--respond-to` | `BUZZ_ACP_RESPOND_TO` | `owner-only` | Author gate mode: `owner-only`, `allowlist`, `anyone`, `nobody`. |
| `--respond-to-allowlist` | `BUZZ_ACP_RESPOND_TO_ALLOWLIST` | — | Comma-separated 64-char hex pubkeys (required when mode is `allowlist`). Owner is always implicitly included. |

**Modes:**

| Mode | Behavior |
|------|----------|
| `owner-only` | Forward only events from the agent's registered owner. If no owner is set, all events are dropped until the owner is resolved. |
| `allowlist` | Forward events from the listed pubkeys plus the owner. |
| `anyone` | Forward all events (no author filtering). |
| `nobody` | Drop all inbound events. Agent only acts on heartbeat prompts. |

Relay-signed workflow messages delegate to their recorded owner only when they
explicitly target this agent with authenticated workflow-mention provenance.
The owner tag means that owner scheduled the workflow; it does not claim that
the owner authored every word after template rendering. ACP verifies the
provenance against the relay's NIP-11 `self` key, then evaluates the owner under
the same author policy as ordinary messages. Legacy workflow messages and
workflow output without an explicit agent mention remain attributed to the relay
signer. `nobody` remains absolute.

The gate applies to **all** inbound events — @mentions, DMs, thread replies, and any event delivered by the relay. Owner control commands are checked **before** the gate, so the owner can still manage the harness regardless of mode:

| Command | Effect |
|---------|--------|
| `!shutdown` | Gracefully exits the harness. |
| `!cancel` | Cancels the current in-flight turn for the command's resolved session scope, if any. |
| `!rotate` | Rotates the ACP session for the command's resolved session scope. If a turn is in flight, it is cancelled and that scoped session is invalidated when the task returns; otherwise the cached scoped session is invalidated immediately. The next queued/received event in that scope starts a fresh session. |

Under the default `channel` policy, a session scope is the whole channel, so these commands retain their channel-wide behavior. Under the `thread` policy, post the command as a reply in the target thread so `!cancel` or `!rotate` affects only that thread. DMs remain one conversation scope. `!cancel` is a no-op when its scope is idle.

Owner control commands must be kind:9 stream messages from the owner, must have body exactly `!cancel`, `!rotate`, or `!shutdown` after trimming, and must mention this agent with a separate `p` tag. They are consumed by the harness instead of being forwarded to the agent. An inline `@Name` changes the body and does not match. With the Buzz CLI, target a thread while preserving the exact command body by passing the mention separately:

```bash
buzz messages send --channel <channel-id> --reply-to <thread-root-id> \
  --mention <agent-pubkey> --content '!cancel'
```

> **Note:** The default mode is `owner-only`. Agents without a registered `agent_owner_pubkey` will not respond to any events until the owner is resolved. Set `--respond-to anyone` to disable the gate entirely.

**Examples:**

```bash
# Default: only respond to owner
buzz-acp

# Respond to a team of three users (owner always included automatically)
buzz-acp --respond-to allowlist \
  --respond-to-allowlist "abc123...64hex,def456...64hex,789abc...64hex"

# Respond to anyone (open agent)
buzz-acp --respond-to anyone

# Broadcast-only: post on heartbeat, ignore all inbound events
buzz-acp --respond-to nobody --heartbeat-interval 300
```

### Configuration Examples

**Single agent, no heartbeat (default):**
```bash
buzz-acp
```

**Four agents, no heartbeat (high-throughput event processing):**
```bash
buzz-acp --agents 4
```

**Two agents with 5-minute heartbeat:**
```bash
buzz-acp --agents 2 --heartbeat-interval 300
```

**Custom heartbeat prompt:**
```bash
buzz-acp --agents 2 --heartbeat-interval 300 \
  --heartbeat-prompt "Check get_feed_actions() for pending approvals, then get_feed_mentions() for unanswered mentions. If nothing actionable, end your turn immediately."
```

### Shared Identity

All N agents authenticate as the **same Nostr bot identity** — users see one bot regardless of how many agents are running. The same channel is never processed by two agents simultaneously (the queue enforces this). Cross-channel message ordering is not guaranteed when N>1.

### Heartbeat Semantics

When `--heartbeat-interval` is set, the harness fires a prompt on an idle agent at the configured interval. Heartbeat rules:

- **Lower priority than queued events** — if events are pending, they are dispatched first.
- **Skipped when all agents are busy** — no queuing; the tick is simply dropped.
- **At most one heartbeat in flight globally** — the next tick is suppressed until the current one completes.
- **Default prompt** (when `--heartbeat-prompt` is not set) calls `get_feed_actions()` and `get_feed_mentions()` to surface pending work.

Heartbeat is designed for idle periods. Under sustained event load it will rarely fire — that's expected.

### Choosing N

Start with **N=2** for most deployments. Increase if queue depth grows under load. Each agent spawns its own MCP server subprocess, so resource usage scales approximately as N × (agent memory + MCP server memory). Maximum is 32.

## Forum Channels

By default, the ACP harness subscribes to stream message kinds (9, 46010, 40007). To receive forum events, opt in with `--kinds` and disable the mention filter (forum posts don't @mention agents):

**CLI flags:**
```bash
buzz-acp --kinds 9,46010,40007,45001,45002,45003 --no-mention-filter
```

**Or with `--subscribe all`:**
```bash
buzz-acp --subscribe all --kinds 9,46010,40007,45001,45002,45003
```

**Per-channel config:**
```toml
[channel.CHANNEL_UUID]
kinds = [9, 46010, 40007, 45001, 45002, 45003]
require_mention = false
```

Forum event kinds:
- **45001** — Forum post (thread root)
- **45002** — Vote on a post or comment
- **45003** — Comment reply on a forum post

> **Note:** Without `--no-mention-filter` (or `require_mention = false`), the default `subscribe=mentions` mode filters events that don't @mention the agent — forum posts will be invisible.

## How It Works

1. **Startup** — Spawns N agent subprocesses (default 1), sends ACP `initialize` to each, connects to the relay with NIP-42 auth.
2. **Channel discovery** — Queries the relay REST API for accessible channels, subscribes to each.
3. **Event loop** — Listens for @mention events (kind 9 with the agent's pubkey in a `#p` tag). Events queue per channel.
4. **Prompting** — When events are pending and no prompt is in flight for that channel, drains all queued events for the oldest channel into a single batched prompt via ACP `session/prompt`.
5. **Agent response** — The agent processes the prompt and uses the Buzz CLI (`send_message`, `get_messages`, etc.) to interact with Buzz.
6. **Recovery** — If the agent crashes, the harness respawns it. If the relay disconnects, the harness reconnects with a `since` filter to avoid missing events.
   If the inbound queue overflows, the harness attempts replay for affected
   subscriptions when capacity and relay quota permit, with at least five seconds
   between attempts. Recovery depends on available relay history and the consumer
   making progress; complete delivery is not guaranteed.

Each channel has at most one prompt in flight. Multiple channels can be processed concurrently when agents > 1.

> **Note:** On startup, the harness replays all unprocessed @mentions since the last run. Expect a burst of activity if there are stale events in the channel.

## Hosted runtime control

Set `BUZZ_ACP_RUNTIME_CONTROLLER_PUBKEY` to the pinned 64-character hex public
key of the hosted runtime controller. The runner then accepts model, reasoning
effort, and runtime-name revisions only as encrypted, signed controller frames.
Direct owner `switch_model` observer commands return
`managed_by_controller`; owner cancel and steer controls remain available.

A revision is agent-global. New work stops claiming adapter slots while any
active turns finish naturally, then model, effort, and runtime name apply
together to fresh sessions. Messages and scheduled workflow tasks continue to
enter the ordinary queue during that boundary. The runner publishes the exact
effective revision in its self-authored kind `10100` profile and sends an
encrypted receipt to the pinned controller. A failed adapter probe restores the
prior effective acknowledgment and resumes queued work with a fixed redacted
failure code.

Lazy runners wake for trusted controller commands. On restart, dispatch remains
gated until a matching controller status and self-authored acknowledgment prove
the current revision, or the controller replays a pending revision. The pinned
public key is not a credential; the controller private key must never be placed
in a runner container.

## Bring Your Own Harness (BYOH)

Buzz Desktop supports registering any ACP-speaking agent tool as a selectable runtime without a PR.

### How it works

**Tier-1 — compiled-in runtimes** (Goose, Claude Code, Codex, Buzz Agent): have auto-installers, auth probes, and first-class onboarding. Their IDs (`goose`, `claude`, `codex`, `buzz-agent`) are reserved and cannot be overridden.

**Tier-2 — preset catalog** (Cursor, Oh My Pi, Pi, Grok Build, OpenCode, Kimi Code, Amp, Hermes Agent, OpenClaw): static `HarnessDefinition` entries in `desktop/src-tauri/src/managed_agents/discovery/presets.rs` (`PRESET_HARNESSES`). They are always present in the runtime catalog, PATH-probed for availability, not editable or deletable by the user. Displayed with bundled logos; if not installed, a docs link appears instead.

> **Note — OpenClaw:** `openclaw acp` is a Gateway-backed bridge; PATH availability shows "Available" even when the OpenClaw Gateway daemon is not running. This is expected tier-2 semantics (same class as a preset with unconfigured auth). The Gateway URL is configured via `OPENCLAW_GATEWAY_URL` (or the equivalent env var from OpenClaw's docs) — set it in the agent's **env vars** in Edit Agent, not in the definition env (the preset definition carries no env entries). Note that `openclaw acp` executes tools inside the Gateway daemon, not the Desktop process, so Desktop-injected `BUZZ_*` env vars do NOT reach the execution locus unless you also set them on the Gateway's own environment.

**Tier-3 — user custom harnesses**: JSON files in `<app-data>/custom_harnesses/` that the user can create from the Settings UI or drop in directly. Each file describes one harness — no install scripts.

### Custom harness JSON schema

```json
{
  "id": "my-agent",
  "label": "My Agent",
  "command": "my-agent-bin",
  "args": ["acp"],
  "env": {
    "MY_AGENT_MODE": "acp"
  },
  "installInstructionsUrl": "https://example.com/docs",
  "installHint": "Download from example.com"
}
```

Fields:
- `id` — `[a-z0-9_][a-z0-9_-]*` (used as the runtime picker value and file name)
- `label` — human-readable name shown in the UI
- `command` — the executable name or absolute path (must be non-empty)
- `args` — optional default CLI arguments (array); instance-level args override this when non-empty
- `env` — optional environment variables injected at spawn time (definition env is a floor; user/persona/global env overrides it; Buzz-reserved keys like `BUZZ_MANAGED_AGENT` are always stripped and cannot be overridden)
- `installInstructionsUrl` / `installHint` — shown when the binary is not on PATH

Invalid files (bad JSON, unknown id, empty command) are skipped with a warning and do not break discovery for other entries.

### Security guarantees

- No install shell commands in preset or custom definitions — only the user's own PATH is consulted.
- `can_auto_install` is always `false` for preset and custom entries.
- No user-supplied icon URLs — icons are bundled assets keyed by id in `RuntimeIcon.tsx`.
- `BUZZ_MANAGED_AGENT` and other Buzz identity keys cannot be overridden by `env` in a custom definition; they are stripped before merging.

### Adding a preset (contributor guide)

To add a new runtime to the tier-2 gallery:

1. **Verify the ACP entrypoint** from the vendor's own documentation — do not rely on a PR description alone. Test with the actual binary.
2. **Add a `PresetHarness` entry** to the `PRESET_HARNESSES` slice in `desktop/src-tauri/src/managed_agents/discovery/presets.rs`. Fill `id`, `label`, `command`, `args`, `install_instructions_url`, `install_hint`, and `underlying_cli` when the command wraps a separately installed CLI. Preset ids are automatically reserved so custom JSON files cannot shadow them.
3. **Add a bundled logo** (64×64 PNG or optimised SVG) to `desktop/public/harness-logos/<id>.png` and add a corresponding entry to `PRESET_LOGOS` in `desktop/src/features/onboarding/ui/RuntimeIcon.tsx`. Record the source and license in `desktop/public/harness-logos/CREDITS.md`. Only bundle a mark whose upstream license permits redistribution; skipping this step is caught by `presetLogos.test.mjs`, which asserts every `PRESET_HARNESSES` id has a mapped logo that exists on disk.
4. Run `cargo test --lib` and `just desktop-typecheck` to verify everything compiles.

The built-in `BUILTIN_IDS` set (`goose`, `claude`, `codex`, `buzz-agent`, and all current preset ids) is the reserved namespace; every other id is available for custom harnesses.

## Using Any ACP Agent

The harness works with any agent that implements the [ACP spec](https://agentclientprotocol.com/) over stdio. The requirements are:

- Accept `initialize` and return a result
- Accept `session/new` with `mcpServers` and return a `sessionId`
- Accept `session/prompt` with a text message and stream `session/update` notifications
- Return a `stopReason` (`end_turn`, `cancelled`, `max_tokens`, etc.)

Set `BUZZ_ACP_AGENT_COMMAND` and `BUZZ_ACP_AGENT_ARGS` to point at your agent binary.

## Testing

See the [root TESTING.md](../../TESTING.md) for the full integration testing guide — automated test suites, multi-agent E2E testing via the ACP harness, and troubleshooting.

## License

Apache-2.0

## Git in coding runtimes

The harness configures agent authorship, Nostr commit/tag signing, and Git
credentials for native runtime shells and declared MCP servers. Author names
use `BUZZ_ACP_DISPLAY_NAME` (sanitized, with an npub fallback); email retains
the public key and relay host. Inherited author/committer name and email
overrides are cleared so native shells use the same agent attribution as MCP.
Credential helpers are scoped to the selected
relay's `/git` URLs. Existing `GIT_CONFIG_*` entries are preserved before the
harness's overrides, and the complete block is forwarded in `mcpServers[].env`
for agents that clear their MCP child environment.

`buzz-acp` includes both Git helpers as multicall personalities, so standalone
and remote launches need no separate signer installation. The harness creates
private helper aliases and a 0600 keyfile, keeps them alive across adapter
respawns, and removes them when it exits normally or completes graceful
shutdown. As with other temporary files, SIGKILL or a machine crash cannot run
cleanup. `BUZZ_PRIVATE_KEY` remains available to the Buzz CLI; adapters do not
receive the redundant `NOSTR_PRIVATE_KEY` variable. No global Git config is
modified. Standalone `buzz-dev-mcp` supplies utility aliases only; a non-Buzz
ACP client must supply any desired Git environment itself.
