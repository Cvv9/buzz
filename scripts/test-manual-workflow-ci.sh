#!/usr/bin/env bash
# Test exact release images against disposable PostgreSQL 17 and Redis.
# No builds, publication, real provider credentials, or existing services are used.
# Requires a native Linux Docker host; bridge IP routing is not Docker Desktop compatible.
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo "usage: $0 RELAY_IMAGE AGENT_IMAGE" >&2
  exit 2
fi
for tool in docker node psql curl; do command -v "$tool" >/dev/null; done
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
node --test scripts/manual-workflow-fixture-forwarder.test.mjs
# Fail before creating any Docker resources if another local fixture owns a port.
node --input-type=module <<'JS'
import net from 'node:net';
const servers=[];
try {
  for (const port of [15341,15441]) {
    const server=net.createServer(); servers.push(server);
    await new Promise((resolve,reject)=>server.once('error',reject).listen(port,'127.0.0.1',resolve));
  }
} finally { for(const server of servers) server.close(); }
JS
node -e 'require(require.resolve("nostr-tools", {paths:["./web"]}))'
relay_image=$(docker image inspect --format '{{.Id}}' "$1")
agent_image=$(docker image inspect --format '{{.Id}}' "$2")
for image in "$relay_image" "$agent_image"; do
  test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = linux/amd64
done
suffix=$(node -e 'console.log(require("node:crypto").randomUUID())')
name="buzz-manual-ci-$suffix"
artifacts=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/$name.XXXXXX")
if [ -n "${GITHUB_OUTPUT:-}" ]; then printf 'artifacts=%s\n' "$artifacts" >> "$GITHUB_OUTPUT"; fi
network=''
containers=()
forwarders=()
cleanup() {
  result=$?
  trap - EXIT INT TERM
  for pid in "${forwarders[@]-}"; do
    [ -n "$pid" ] || continue
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  if [ -n "$network" ]; then
    # Also reap a harness interrupted before its own finally block could run.
    while IFS= read -r id; do
      [ -n "$id" ] || continue
      docker stop --time 10 "$id" >/dev/null 2>&1 || true
      docker logs "$id" > "$artifacts/harness-$id.log" 2>&1 || true
      docker rm -f "$id" >/dev/null 2>&1 || true
    done < <(docker ps -aq --filter "label=buzz.manual-harness=$name" 2>/dev/null || true)
    while IFS= read -r volume; do
      [ -n "$volume" ] || continue
      docker volume rm "$volume" >/dev/null 2>&1 || true
    done < <(docker volume ls -q --filter "label=buzz.manual-harness=$name" 2>/dev/null || true)
  fi
  for id in "${containers[@]-}"; do
    [ -n "$id" ] || continue
    docker logs "$id" > "$artifacts/$id.log" 2>&1 || true
    docker inspect "$id" > "$artifacts/$id.json" 2>/dev/null || true
    docker rm -f "$id" >/dev/null 2>&1 || true
  done
  if [ -n "$network" ]; then docker network rm "$network" >/dev/null 2>&1 || true; fi
  printf 'Integration evidence: %s\n' "$artifacts" >&2
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
start_forwarder() {
  local id=$1 role=$2 pid
  node scripts/manual-workflow-fixture-forwarder.mjs "$name" "$id" "$role" > "$artifacts/$role-forwarder.log" 2>&1 &
  pid=$!
  forwarders+=("$pid")
  for _ in {1..100}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "Fixture $role forwarder failed; see $artifacts/$role-forwarder.log" >&2
      return 1
    fi
    if grep -q '"ready":true' "$artifacts/$role-forwarder.log"; then return 0; fi
    sleep 0.1
  done
  echo "Fixture $role forwarder did not start" >&2
  return 1
}
# Pull dependencies before attaching services to an egress-isolated network.
docker pull mirror.gcr.io/library/postgres:17-bookworm
docker pull mirror.gcr.io/library/redis:7-alpine
postgres_image=$(docker image inspect --format '{{.Id}}' mirror.gcr.io/library/postgres:17-bookworm)
redis_image=$(docker image inspect --format '{{.Id}}' mirror.gcr.io/library/redis:7-alpine)
printf 'relay=%s\nagent=%s\npostgres=%s\nredis=%s\n' "$relay_image" "$agent_image" "$postgres_image" "$redis_image" > "$artifacts/images.txt"
test -z "$(docker network ls --format '{{.Name}}' --filter "name=^$name$")"
test -z "$(docker ps -aq --filter "label=buzz.manual-harness=$name")"
test -z "$(docker volume ls -q --filter "label=buzz.manual-harness=$name")"
network=$(docker network create --internal --label "buzz.manual-test=$name" "$name")
postgres=$(docker create --name "$name-postgres" --label "buzz.manual-test=$name" --network "$network" --network-alias postgres \
  --tmpfs /var/lib/postgresql/data:rw,size=256m \
  -e POSTGRES_USER=buzz -e POSTGRES_PASSWORD=buzz_test_only -e POSTGRES_DB=buzz_manual_tests_v1 "$postgres_image")
containers+=("$postgres")
redis=$(docker create --name "$name-redis" --label "buzz.manual-test=$name" --network "$network" --network-alias redis \
  --tmpfs /data:rw,size=64m "$redis_image")
containers+=("$redis")
docker start "$postgres" "$redis" >/dev/null
start_forwarder "$postgres" postgres
export DATABASE_URL='postgres://buzz:buzz_test_only@127.0.0.1:15441/buzz_manual_tests_v1'
ready=false
for _ in {1..60}; do
  # The temporary init server accepts local sockets before the forwarded TCP
  # endpoint is ready. Probe the same authenticated URL used by the harness.
  if PGCONNECT_TIMEOUT=2 psql "$DATABASE_URL" -XAtw -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null 2>&1 \
    && docker exec "$redis" redis-cli ping | grep -qx PONG; then ready=true; break; fi
  sleep 1
done
$ready || { echo 'Fixture services did not become ready' >&2; exit 1; }
version=$(psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c 'SHOW server_version_num')
[[ "$version" =~ ^17[0-9]{4}$ ]] || { echo "Expected PostgreSQL 17, got $version" >&2; exit 1; }
printf 'server_version_num=%s\n' "$version" > "$artifacts/postgres-version.txt"
# Qualify the matching one-shot migrator before serving. The only database
# available to this container is the disposable fixture created above.
migrator=$(docker create --name "$name-migrate" --label "buzz.manual-test=$name" --network "$network" \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  -e DATABASE_URL=postgres://buzz:buzz_test_only@postgres:5432/buzz_manual_tests_v1 \
  --entrypoint /usr/local/bin/buzz-admin "$relay_image" migrate)
containers+=("$migrator")
for pass in first second; do
  timeout 60s docker start --attach "$migrator" > "$artifacts/migrator-$pass.log" 2>&1
  test "$(docker inspect --format '{{.State.ExitCode}}' "$migrator")" = 0
  psql "$DATABASE_URL" -XAtw -v ON_ERROR_STOP=1 -c \
    "SELECT version,success,encode(checksum,'hex') FROM _sqlx_migrations ORDER BY version" > "$artifacts/migrator-$pass-ledger.txt"
done
cmp "$artifacts/migrator-first-ledger.txt" "$artifacts/migrator-second-ledger.txt"
test "$(psql "$DATABASE_URL" -XAtw -v ON_ERROR_STOP=1 -c \
  'SELECT count(*)=65 AND max(version)=65 AND bool_and(success) FROM _sqlx_migrations')" = t
test "$(psql "$DATABASE_URL" -XAtw -v ON_ERROR_STOP=1 -c \
  "SELECT count(*)=2 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND c.relname IN ('personal_read_accounts','personal_read_frontiers') AND t.tgname='community_write_fence_'||c.relname AND p.proname='enforce_community_write_fence' AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=31")" = t
test "$(psql "$DATABASE_URL" -XAtw -v ON_ERROR_STOP=1 -c \
  "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='personal_read_accounts' AND column_name='started_at' AND data_type='timestamp with time zone' AND is_nullable='YES')")" = t
printf 'matching admin migrate: first run, idempotency, ledger65 and personal read fences PASS\n' > "$artifacts/migrator-qualification.txt"
relay=$(docker create --name "$name-relay" --label "buzz.manual-test=$name" --network "$network" --network-alias host.docker.internal \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  --tmpfs /var/lib/buzz:rw,nosuid,nodev,uid=1000,gid=1000,size=128m \
  -e DATABASE_URL=postgres://buzz:buzz_test_only@postgres:5432/buzz_manual_tests_v1 -e REDIS_URL=redis://redis:6379 \
  -e BUZZ_AUTO_MIGRATE=false -e BUZZ_BIND_ADDR=0.0.0.0:15341 -e RELAY_URL=ws://host.docker.internal:15341 \
  -e BUZZ_HEALTH_PORT=8080 -e BUZZ_REQUIRE_AUTH_TOKEN=true -e BUZZ_REQUIRE_RELAY_MEMBERSHIP=true \
  -e BUZZ_ALLOW_INSECURE_DEV_PUBKEY=false -e BUZZ_GIT_CONFORMANCE_PROBE=false \
  -e RELAY_OWNER_PUBKEY=79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798 \
  -e BUZZ_RELAY_PRIVATE_KEY=0000000000000000000000000000000000000000000000000000000000000001 \
  -e RUST_LOG=buzz_relay=info "$relay_image")
containers+=("$relay")
docker start "$relay" >/dev/null
start_forwarder "$relay" relay
ready=false
for _ in {1..90}; do
  if docker exec "$relay" curl -fsS http://127.0.0.1:8080/_readiness >/dev/null 2>&1; then ready=true; break; fi
  test "$(docker inspect --format '{{.State.Running}}' "$relay")" = true || break
  sleep 1
done
$ready || { echo 'Fixture relay did not become ready' >&2; exit 1; }
psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c 'SELECT version,success FROM _sqlx_migrations ORDER BY version' > "$artifacts/migrations.txt"
curl -fsS -H 'Host: host.docker.internal:15341' http://127.0.0.1:15341/info > "$artifacts/relay-info.json"
BUZZ_MANUAL_TEST_NETWORK="$name" BUZZ_MANUAL_TEST_ARTIFACT_ROOT="$artifacts" BUZZ_MANUAL_TEST_CLEANUP=1 \
  node scripts/test-manual-workflow-harness.mjs "$agent_image" --event-origin 2>&1 | tee "$artifacts/harness.log"
