// Run inside the built agent-runtime image (or clearly labelled runtime-base).
// Uses dummy identities only. Does not connect to Buzz or a model provider.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);
const script = '/smoke/agent-isolation-smoke.mjs';
const identity = '/var/lib/buzz-harness/identity.env';
const status = pid => Object.fromEntries(fs.readFileSync(`/proc/${pid}/status`, 'utf8').split('\n').map(line => line.split(/:\s+/)));
const runWorker = (uid, args, env = {}) => spawn('setpriv', [`--reuid=${uid}`, '--regid=1003', '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '/bin/sh', '-c', 'cd "$1"; shift; exec "$@"', 'buzz-worker', uid === 1000 ? '/home/node' : '/home/buzz-manual', 'node', script, ...args], {
  cwd: '/', env: { PATH: process.env.PATH, HOME: uid === 1000 ? '/home/node' : '/home/buzz-manual', ...env }, stdio: ['ignore','pipe','pipe'] });
async function wait(child) {
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 0, stderr); return stdout;
}
function denied(path) { assert.throws(() => fs.readFileSync(path), error => error.code === 'EACCES' || error.code === 'EPERM', `must deny ${path}`); }
function zeroCaps(pid) { for (const key of ['CapInh','CapPrm','CapEff','CapAmb']) assert.equal(status(pid)[key], '0000000000000000', `${pid} ${key}`); }
const mode = process.argv[2];
if (mode === 'ordinary') {
  zeroCaps(process.pid);
  fs.writeFileSync('/home/node/.codex/ordinary-private', 'dummy ordinary key');
  console.log(process.pid);
  setInterval(() => {}, 1000);
} else if (mode === 'worker') {
  assert.equal(process.getuid(), 1002); assert.equal(process.getgid(), 1003); zeroCaps(process.pid);
  for (const pid of [process.env.HARNESS_PID, process.env.ORDINARY_PID]) { denied(`/proc/${pid}/environ`); denied(`/proc/${pid}/mem`); }
  for (const path of [identity, '/home/node/.codex/ordinary-private']) denied(path);
  assert.equal(process.env.BUZZ_PRIVATE_KEY, 'dummy-scoped-only');
  assert.equal(process.env.DATABASE_URL, undefined); assert.equal(process.env.REDIS_URL, undefined);
  for (const fd of fs.readdirSync('/proc/self/fd')) {
    let path; try { path = fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { continue; }
    assert.ok(!path.startsWith('/var/lib/buzz-harness') && !path.startsWith('/home/node/'), `inherited private descriptor: ${path}`);
  }
  const token = await new Promise((resolve, reject) => {
    const req = http.request({ socketPath:'/run/buzz-auth/broker.sock', method:'POST', path:'/token' }, res => { let data='';res.on('data',v=>data+=v);res.on('end',()=>resolve(data)); }); req.on('error',reject);req.end('{}');
  });
  assert.equal(token, 'dummy-access-token');
  // Actual pinned ACP and its native Codex helper initialize under zero caps.
  const acp = spawn('codex-acp', [], { env: process.env, detached: true, stdio:['pipe','pipe','pipe'] });
  try {
    const initialized = new Promise((resolve, reject) => {
      let pending=''; acp.stdout.on('data', chunk => { pending += chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){try{const msg=JSON.parse(line);if(msg.id===1){assert.ok(msg.result,JSON.stringify(msg));resolve();}}catch(error){reject(error);}} });
      acp.on('error',reject);acp.on('exit',code=>reject(new Error(`ACP exited before initialize: ${code}`)));
    });
    acp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'isolation-smoke',version:'1'}}})+'\n');
    await Promise.race([initialized,new Promise((_,reject)=>setTimeout(()=>reject(new Error('ACP initialize timeout')),20000).unref())]);
    zeroCaps(acp.pid);
    let native = 0; const observed = [];
    for (const entry of fs.readdirSync('/proc').filter(value=>/^\d+$/.test(value))) {
      let stat;try{stat=status(entry);}catch{continue;}
      if (stat.Uid?.split(/\s+/)[0] !== '1002') continue;
      zeroCaps(entry); observed.push({pid:entry,name:stat.Name});
      // /proc/exe may be ptrace-restricted or point at the amd64 emulator.
      if (stat.Name === 'codex' && !stat.State.startsWith('Z')) {
        const processStat=fs.readFileSync(`/proc/${entry}/stat`,'utf8');
        const group=processStat.slice(processStat.lastIndexOf(') ')+2).split(' ')[2];
        if(Number(group)===acp.pid) native++;
      }
    }
    assert.ok(native > 0, `native Codex helper must be included in isolation evidence: ${JSON.stringify(observed)}`);
    console.log(JSON.stringify({provider:process.env.MODEL_PROVIDER ?? 'primary',uid:process.getuid(),broker:'accessible',privateIdentity:'denied',parentProc:'denied',workerCaps:'zero',nativeHelpers:native}));
  } finally { try { process.kill(-acp.pid,'SIGKILL'); } catch {} }
} else if (mode === 'harness') {
  assert.equal(process.getuid(),1001);
  for(const key of ['CapPrm','CapEff','CapAmb']) assert.equal(status(process.pid)[key],'00000000000000e0');
  const ordinary=runWorker(1000,['ordinary'],{BUZZ_PRIVATE_KEY:'dummy-full-agent-key'});
  const ordinaryPid=await new Promise((resolve,reject)=>{ordinary.stdout.once('data',data=>resolve(data.toString().trim()));ordinary.once('error',reject);});
  try {
    for(const provider of ['primary','azure-foundry']) {
      const config = provider === 'primary' ? {} : { MODEL_PROVIDER:'azure-foundry',CODEX_CONFIG:JSON.stringify({model:'smoke',model_provider:'azure-foundry',model_providers:{'azure-foundry':{name:'smoke',base_url:'https://invalid.example/openai/v1',env_key:'AZURE_FOUNDRY_API_KEY',wire_api:'responses'}}}),AZURE_FOUNDRY_API_KEY:'dummy-not-used' };
      const child=runWorker(1002,['worker'],{HARNESS_PID:String(process.pid),ORDINARY_PID:ordinaryPid,BUZZ_PRIVATE_KEY:'dummy-scoped-only',...config});
      process.stdout.write(await wait(child));
    }
  } finally { ordinary.kill('SIGKILL'); }
} else {
  assert.equal(process.getuid(),0);
  const marker=JSON.parse(fs.readFileSync('/etc/buzz/codex-acp-terminal-errors.json'));
  assert.equal(marker.bundle_sha256,createHash('sha256').update(fs.readFileSync('/usr/local/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js')).digest('hex'));
  fs.mkdirSync('/home/node/.codex',{recursive:true});
  const old='/home/node/.codex/varvik-agent-identity.env';
  const dummy=`VARVIK_AGENT_PUBKEY=${'a'.repeat(64)}\nBUZZ_PRIVATE_KEY=${'b'.repeat(64)}\n`;
  fs.writeFileSync(old,dummy,{mode:0o600});
  const first=execFileSync('/usr/local/bin/agent-runtime-init',{encoding:'utf8'});
  assert.equal(first.trim(),'a'.repeat(64)); assert.equal(fs.existsSync(old),false); assert.equal(fs.readFileSync(identity,'utf8'),dummy);
  assert.equal(fs.statSync(identity).mode & 0o777,0o600);
  assert.equal(fs.statSync('/var/lib/buzz-harness').mode & 0o777,0o700);
  assert.equal(execFileSync('/usr/local/bin/agent-runtime-init',{encoding:'utf8'}),first);
  fs.mkdirSync('/run/buzz-auth',{recursive:true});fs.chownSync('/run/buzz-auth',1000,1003);fs.chmodSync('/run/buzz-auth',0o2750);
  const server=http.createServer((req,res)=>res.end('dummy-access-token'));
  await new Promise(resolve=>server.listen('/run/buzz-auth/broker.sock',resolve));
  fs.chownSync('/run/buzz-auth/broker.sock',1000,1003);fs.chmodSync('/run/buzz-auth/broker.sock',0o660);
  try {
    const result=await execute('setpriv',['--reuid=1001','--regid=1001','--clear-groups','--inh-caps=-all,+setuid,+setgid,+kill','--ambient-caps=-all,+setuid,+setgid,+kill','--no-new-privs','node',script,'harness'],{cwd:'/var/lib/buzz-harness',env:{PATH:process.env.PATH,HOME:'/var/lib/buzz-harness',BUZZ_PRIVATE_KEY:'dummy-full-agent-key',DATABASE_URL:'dummy-db',REDIS_URL:'dummy-redis'},timeout:90000});
    process.stdout.write(result.stdout);
  } finally { server.close(); }
}
