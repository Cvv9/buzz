# Buzz Docker Compose deployment

This is the single-node/VPS deployment bundle. It is intentionally separate from
the root `docker-compose.yml`, which remains local development infrastructure.

## Quick start

```bash
cd deploy/compose
cp .env.example .env
$EDITOR .env       # replace every CHANGE_ME value
./run.sh start
```

For a public VPS with automatic Let's Encrypt certificates:

```bash
cd deploy/compose
BUZZ_COMPOSE_TLS=true ./run.sh start
```

The bootstrap script should eventually replace manual `.env` editing for normal
users. It is responsible for generating stable secrets and, optionally, an owner
keypair.

The default stack serves one browser workspace at the deployment root and keeps
the repository browser at `/repos`. It does not provision or switch between
multiple communities.

## Hosted AI agents

The optional `agents` profile runs a small information-and-routing fleet through
the Buzz ACP harness and Codex adapter. Durable product and engineering work is
owned by the specialist team in Sylars Work Manager; Buzz does not duplicate
that execution roster.

- `Project Brain` — shared, read-only answers backed by Project Intelligence
- `Market Intelligence` — shared research intake backed by Sylar's dedicated
  MarketIntelligence specialist for durable multi-source work
- `People & Culture` — shared, opt-in welcomes, introductions, team rituals,
  and celebrations for explicitly verified milestones
- `Founder Chief of Staff` — Varun's private portfolio and Sylars coordinator
- `Operations Desk` — private Watchdog/CI incident intake and Sylars status
- one owner-scoped `Personal Assistant` per configured team member — private
  meetings, reminders, mentions, assigned-work retrieval, and daily briefs

Trend Radar is a scheduled integration rather than another always-on Codex
container. Sylars' `news-digest` job scrapes subscribed topics and posts one
synthesized briefing to a dedicated Buzz channel. The full article feed remains
in the Sylars dashboard.

Generation-ready visual briefs for this roster live in
[`AGENT_AVATAR_PROMPTS.md`](AGENT_AVATAR_PROMPTS.md).

The private agents publish owner-scoped directory metadata. The browser shows
them only when the signed-in pubkey matches `VARUN_PUBKEY` (falling back to
`RELAY_OWNER_PUBKEY`), and the ACP author gate accepts prompts only from that
owner. This is in addition to channel membership enforcement.

`Project Brain` receives only `PROJECT_INTELLIGENCE_READ_TOKEN`. `Market
Intelligence`, `Founder Chief of Staff`, and `Operations Desk` receive
`SYLARS_CONTROL_API_TOKEN`, which can submit, read, deny, or cancel tasks but
cannot approve machine-submitted work.
Their remote HTTP MCP endpoints are adapted to the agent's stdio-only MCP
transport by the bundled `buzz-http-mcp-bridge`; the bridge never logs tokens.

Each agent generates a stable Nostr identity in its own private named volume on
first startup. To use API billing, set either `CODEX_API_KEY` or
`OPENAI_API_KEY`, then:

```bash
./run.sh start-agents
```

`BUZZ_AGENT_RELAY_URL` must use the community's canonical public hostname so
host-derived routing selects the same community as browser clients. It defaults
to `RELAY_URL`; override it only when the agent needs a different reachable URL.

To reuse an existing ChatGPT/Codex login instead, set
`VARVIK_CODEX_AUTH_FILE` to the absolute path of its `auth.json` and run:

```bash
./run.sh start-agents-chatgpt
```

That file is mounted read-only and seeds each agent's dedicated state volume
with mode `0600` on first startup. Those volumes preserve agent identities and
token refreshes across container upgrades. To deliberately replace the login,
remove the affected `agent-*-codex` volume and start that agent again. Use this only
on a server you control: each hosted agent necessarily receives the credential
needed to call Codex. The credential is never served to browser clients.

Each container registers itself as a relay member and publishes its agent
profile. An owner/admin then opens a channel in the browser and adds the relevant
shared or admin agent. Mentioning an agent sends work to its server runtime. The
browser itself never receives the OpenAI credential and never runs shell or file
tools.

`People & Culture` is mention-driven by default. A membership or goal system may
also invoke it through a trusted Buzz workflow that supplies an explicit
`welcome` or `milestone` event. This keeps ordinary channel traffic quiet and
prevents an unverified metric from producing an automatic celebration.

### Personal Companions and private morning briefs

The `personal-agents` profile provides one isolated identity and state volume
for each of the five team members:

- `Varun Companion` → `brief-varun`
- `Vikram Companion` → `brief-vikram`
- `Adhika Companion` → `brief-adhika`
- `Swathi Companion` → `brief-swathi`
- `Raja Companion` → `brief-raja`

Set `VARUN_PUBKEY`, `VIKRAM_PUBKEY`, `ADHIKA_PUBKEY`, `SWATHI_PUBKEY`, and
`RAJA_PUBKEY` in `.env`. Varun may omit `VARUN_PUBKEY` when
`RELAY_OWNER_PUBKEY` is his identity. Then start the personal fleet with one of:

```bash
./run.sh start-personal-agents
./run.sh start-personal-agents-chatgpt
```

On first start each Companion creates its private channel, makes its human owner
a channel owner, restricts its subscription to that channel, and disables
third-party channel additions. A heartbeat is aligned to 03:30 UTC (09:00 IST)
and posts only to that private channel. A brief reports only data available from
connected sources and must name missing sources rather than inventing tasks.

### Safety boundary

All hosted agents receive `agent-safety-policy.md` as team-owned instructions.
The Compose runtime is read-only, unprivileged, has no Docker socket, and mounts
no host repository. Its permission mode rejects requests to escape the normal
sandbox. Agents can investigate and prepare work in their isolated runtime, but
the deployment does not give them credentials to merge, deploy, stop services,
delete repositories, or administer infrastructure.

GitHub, Watchdog, and Sylars credentials are deliberately not part of this
bundle. Add those later through separate least-privilege connectors: read access
first, branch/draft-PR or ticket-update access second, and an owner approval gate
for any destructive or production-changing action. A model subscription is not
an authorization credential for those tools.

### Open the community in Buzz Desktop

In the browser workspace, open Settings and choose **Open in Buzz Desktop**.
The browser mints a one-use invite and opens a `buzz://join` link. Buzz Desktop
claims the invite using its own securely stored identity, adds the same relay as
a community, and switches to it. For a local install the relay is
`ws://localhost:3300`; on a server use its public `wss://` address.

## Production notes

- Requires Docker Compose v2.24.4 or newer; the TLS override uses Compose's
  `!reset` tag to remove the direct relay port when Caddy terminates HTTPS.
- Default `BUZZ_IMAGE` tracks `ghcr.io/block/buzz:main` for early testing. Pin it to `ghcr.io/block/buzz:sha-<7>` or a semver release tag for production once available.
- Keep `BUZZ_RELAY_PRIVATE_KEY`, `BUZZ_GIT_HOOK_HMAC_SECRET`, database/Redis,
  and S3 secrets stable across restarts.
- `RELAY_OWNER_PUBKEY` is intentionally not prefixed with `BUZZ_`; it must be a
  64-character hex Nostr pubkey when closed relay mode is enabled.
- `BUZZ_AUTO_MIGRATE` is opt-in. Set `BUZZ_AUTO_MIGRATE=true` or run
  `buzz-admin migrate` before starting the relay when bootstrapping a fresh
  database. Auto-migration requires an image that includes embedded SQLx
  migrations.
- The stack uses Postgres, Redis, MinIO, and a git data volume because
  those are real Buzz dependencies today. Minimal mode can simplify this later.
- The bundled Compose stack fixes the relay endpoint to `http://minio:9000` and
  `BUZZ_S3_ADDRESSING_STYLE=path`: Docker DNS resolves `minio`, not
  `<bucket>.minio`. It is not configurable for an external S3 provider through
  `.env`; use the Helm chart or a custom Compose configuration for providers
  such as new Railway Storage Buckets that require `virtual` addressing.

Run `./run.sh backup-hint` for the backup checklist.

## Validation

Before sharing an install link publicly, verify a fresh install with:

```bash
cd deploy/compose
cp .env.example .env
$EDITOR .env
./run.sh config
./run.sh start
curl -fsS "http://127.0.0.1:$(grep -E '^BUZZ_HTTP_PORT=' .env | cut -d= -f2-)/_liveness"
./run.sh status
```
