// Native Linux CI only: Docker bridge addresses are reachable from its host.
// Docker Desktop's VM networking is not supported by this fixture transport.
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const roles = { postgres: [55441, 5432], relay: [55341, 55341] };

function privateIpv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// The destination must come from the exact labeled container on our isolated network.
export function fixtureEndpoint(name, id, role, network, container) {
  if (!/^buzz-manual-ci-[0-9a-f-]{36}$/.test(name) || !/^[0-9a-f]{64}$/.test(id) || !Object.hasOwn(roles, role)) {
    throw new Error('Invalid fixture identity or role');
  }
  const attachment = container?.NetworkSettings?.Networks?.[name];
  if (network?.Name !== name || network?.Internal !== true || !network.Id ||
      network.Labels?.['buzz.manual-test'] !== name || container?.Id !== id ||
      container.Name !== `/${name}-${role}` || container.State?.Running !== true ||
      container.Config?.Labels?.['buzz.manual-test'] !== name ||
      attachment?.NetworkID !== network.Id || !privateIpv4(attachment?.IPAddress ?? '')) {
    throw new Error('Fixture target is not a running owned container on its private network');
  }
  const [listenPort, targetPort] = roles[role];
  return { listenPort, targetPort, targetHost: attachment.IPAddress };
}

// Loopback binding is fixed, including when called from tests.
export async function startForwarder({ listenPort, targetPort, targetHost }) {
  const sockets = new Set();
  const server = net.createServer((incoming) => {
    const outgoing = net.createConnection({ host: targetHost, port: targetPort });
    for (const socket of [incoming, outgoing]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => { incoming.destroy(); outgoing.destroy(); });
    }
    incoming.on('close', () => outgoing.destroy());
    outgoing.on('close', () => incoming.destroy());
    incoming.pipe(outgoing).pipe(incoming);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', resolve);
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(resolve);
    }),
  };
}

async function main() {
  const [name, id, role, ...extra] = process.argv.slice(2);
  if (extra.length || !name || !id || !role) throw new Error('Expected network, container ID and role');
  const inspect = (args) => JSON.parse(execFileSync('docker', args, { encoding: 'utf8', timeout: 10000 }))[0];
  const endpoint = fixtureEndpoint(name, id, role,
    inspect(['network', 'inspect', name]), inspect(['inspect', id]));
  const forwarder = await startForwarder(endpoint);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void forwarder.close().then(() => process.exit(0));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.log(JSON.stringify({ ready: true, role, host: '127.0.0.1', port: forwarder.port }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`Fixture forwarding failed: ${error.message}`); process.exitCode = 1; });
}
