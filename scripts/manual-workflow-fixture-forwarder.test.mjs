import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { fixtureEndpoint, startForwarder } from './manual-workflow-fixture-forwarder.mjs';

const name = 'buzz-manual-ci-11111111-1111-4111-8111-111111111111';
const id = 'a'.repeat(64);
function documents() {
  return [
    { Id: 'owned-network', Name: name, Internal: true, Labels: { 'buzz.manual-test': name } },
    { Id: id, Name: `/${name}-postgres`, State: { Running: true }, Config: { Labels: { 'buzz.manual-test': name } },
      NetworkSettings: { Networks: { [name]: { NetworkID: 'owned-network', IPAddress: '172.22.0.2' } } } },
  ];
}

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  return server.address().port;
}
async function echo(port, content) {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  await once(socket, 'connect');
  const response = once(socket, 'data');
  socket.write(content);
  const [bytes] = await response;
  socket.destroy();
  return bytes.toString();
}

test('target derives only from exact owned internal network and running labeled container', () => {
  assert.deepEqual(fixtureEndpoint(name, id, 'postgres', ...documents()), { listenPort: 15441, targetPort: 5432, targetHost: '172.22.0.2' });
  for (const mutate of [
    (n) => { n.Internal = false; },
    (n) => { n.Name = 'different'; },
    (n) => { n.Labels = {}; },
    (_n, c) => { c.Id = 'b'.repeat(64); },
    (_n, c) => { c.Name = '/unowned'; },
    (_n, c) => { c.State.Running = false; },
    (_n, c) => { c.Config.Labels = {}; },
    (_n, c) => { c.NetworkSettings.Networks[name].NetworkID = 'different'; },
    (_n, c) => { c.NetworkSettings.Networks = {}; },
  ]) {
    const docs = documents(); mutate(...docs);
    assert.throws(() => fixtureEndpoint(name, id, 'postgres', ...docs));
  }
  for (const ip of ['8.8.8.8', '127.0.0.1', '169.254.169.254', '::1', 'localhost', '172.32.0.1', '192.169.0.1', '10.0.0.999']) {
    const docs = documents(); docs[1].NetworkSettings.Networks[name].IPAddress = ip;
    assert.throws(() => fixtureEndpoint(name, id, 'postgres', ...docs));
  }
  for (const ip of ['10.1.2.3', '172.16.0.2', '172.31.255.254', '192.168.1.2']) {
    const docs = documents(); docs[1].NetworkSettings.Networks[name].IPAddress = ip;
    assert.equal(fixtureEndpoint(name, id, 'postgres', ...docs).targetHost, ip);
  }
  assert.throws(() => fixtureEndpoint(name, id, 'arbitrary', ...documents()));
  assert.throws(() => fixtureEndpoint('external', id, 'postgres', ...documents()));
  assert.throws(() => fixtureEndpoint(name, 'container-name', 'postgres', ...documents()));
});

test('real loopback forwarding preserves bytes and rejects an occupied bind', { timeout: 5000 }, async (t) => {
  const target = net.createServer((socket) => socket.pipe(socket));
  const targetPort = await listen(target);
  t.after(() => target.close());
  const forwarder = await startForwarder({ listenPort: 0, targetHost: '127.0.0.1', targetPort });
  t.after(() => forwarder.close());
  assert.equal(await echo(forwarder.port, 'fixture-transport'), 'fixture-transport');
  await assert.rejects(startForwarder({ listenPort: forwarder.port, targetHost: '127.0.0.1', targetPort }), { code: 'EADDRINUSE' });
});

test('SIGTERM destroys owned active sockets and releases the port for reuse', { timeout: 5000 }, async (t) => {
  const target = net.createServer((socket) => socket.pipe(socket));
  const targetPort = await listen(target);
  t.after(() => target.close());
  const moduleUrl = new URL('./manual-workflow-fixture-forwarder.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { startForwarder } from ${JSON.stringify(moduleUrl)};
    const f = await startForwarder({ listenPort: 0, targetHost: '127.0.0.1', targetPort: ${targetPort} });
    process.once('SIGTERM', () => f.close().then(() => process.exit(0)));
    console.log(f.port);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const [data] = await once(child.stdout, 'data');
  const port = Number(data.toString().trim());
  const socket = net.createConnection({ host: '127.0.0.1', port });
  await once(socket, 'connect');
  const closed = once(socket, 'close');
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  assert.deepEqual(await exited, [0, null]);
  await closed;
  const reuse = net.createServer();
  await listen(reuse, port);
  await new Promise((resolve) => reuse.close(resolve));
});
