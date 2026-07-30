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

## Hosted AI agent

The optional `agents` profile runs the existing Buzz ACP harness and Codex
adapter on the server. Generate a separate Nostr keypair for it, fill
`VARVIK_AGENT_PRIVATE_KEY`, `VARVIK_AGENT_PUBKEY`, and either `CODEX_API_KEY`
or `OPENAI_API_KEY`, then:

```bash
./run.sh start-agents
```

To reuse an existing ChatGPT/Codex login instead, set
`VARVIK_CODEX_AUTH_FILE` to the absolute path of its `auth.json` and run:

```bash
./run.sh start-agents-chatgpt
```

That file is mounted read-only and seeds `buzz-agent-codex-data` with mode
`0600` on first startup. The dedicated volume preserves token refreshes across
container upgrades. To deliberately replace the login, remove that volume and
start the agent again. Use this only on a server you control: the hosted agent
necessarily receives the credential needed to call Codex. The credential is
never served to browser clients.

The container registers the agent as a relay member and publishes its agent
profile. An owner/admin then opens a channel in the browser and adds the hosted
agent to that channel. Mentioning `@VarVik AI` sends work to the server runtime.
The browser itself never receives the OpenAI key and never runs shell or file
tools.

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
