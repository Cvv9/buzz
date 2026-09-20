#!/usr/bin/env node
/** Actual isolated relay → Linux harness → patched ACP adapter acceptance test.
 * Usage: DATABASE_URL=postgres://.../buzz_manual_tests_v3 node scripts/test-manual-workflow-harness.mjs IMAGE
 * Requires the isolated relay on 55341 and existing web dependencies. Never uses provider credentials.
 * Leaves its scoped DB evidence and Docker state volume; always stops its own container.
 */
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(root,'web/package.json'));
const {finalizeEvent,getPublicKey,verifyEvent}=require('nostr-tools');
const image=process.argv[2]; assert(image,'IMAGE argument required');
const database=process.env.DATABASE_URL; assert(database,'explicit isolated DATABASE_URL required');
const db=new URL(database);
assert(['127.0.0.1','localhost'].includes(db.hostname) && db.port==='55441' && /^\/buzz_manual_tests_v\d+$/.test(db.pathname),'only isolated local manual-workflow database permitted');
const port=55341, host='host.docker.internal', authority=`${host}:${port}`;
const remote=`http://${authority}`;
const bytes=hex=>Uint8Array.from(Buffer.from(hex,'hex'));
// Public fixture keys only. Unique owner/agent avoid interference with other tests.
const ownerKey=bytes(createHash('sha256').update(randomUUID()).digest('hex'));
const agentKey=bytes(createHash('sha256').update(randomUUID()).digest('hex'));
const owner=getPublicKey(ownerKey),agent=getPublicKey(agentKey);
const relay=getPublicKey(bytes('0'.repeat(63)+'1'));
const channel=randomUUID(),workflow=randomUUID();
const suffix=randomUUID().slice(0,8),name=`buzz-manual-harness-${suffix}`,volume=`${name}-state`;
const artifacts=mkdtempSync(join(tmpdir(),`${name}-`));
const sql=q=>execFileSync('psql',[database,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim();
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000}).trim();
const sign=(key,kind,tags,content)=>finalizeEvent({kind,tags,content,created_at:Math.floor(Date.now()/1000)},key);
const hash=body=>createHash('sha256').update(body).digest('hex');
async function localRequest(path,method,headers,body='') {
  return new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{...headers,Host:authority,...(body?{'Content-Length':Buffer.byteLength(body)}:{})}},response=>{
      let data='';response.setEncoding('utf8');response.on('data',chunk=>data+=chunk);response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(data)});}catch(error){reject(error);}});
    });
    req.setTimeout(10000,()=>req.destroy(new Error('fixture HTTP timeout')));req.on('error',reject);req.end(body);
  });
}
async function request(path,key,body,method='POST') {
  const text=body===undefined?'':JSON.stringify(body);
  const tags=[['u',remote+path],['method',method]];if(text)tags.push(['payload',hash(text)]);
  const auth=sign(key,27235,tags,'');
  const response=await localRequest(path,method,{'Content-Type':'application/json',Authorization:`Nostr ${Buffer.from(JSON.stringify(auth)).toString('base64')}`},text);
  const result=response.body;assert(response.status>=200 && response.status<300,`HTTP ${response.status}: ${JSON.stringify(result)}`);return result;
}
const payload=value=>typeof value.message==='string' && value.message.startsWith('response:')?JSON.parse(value.message.slice(9)):value;
async function publish(event,key=ownerKey) {const value=await request('/events',key,event);assert.equal(value.accepted,true,JSON.stringify(value));return payload(value);}
async function until(label,condition,seconds=90) {
  const end=Date.now()+seconds*1000;
  while(Date.now()<end){const value=await condition();if(value)return value;await new Promise(r=>setTimeout(r,500));}
  throw new Error(`Timed out: ${label}`);
}
let community,runId;
try {
  // Host mapping is shared, but every identity/channel/workflow/run is fixture-unique.
  sql(`INSERT INTO communities(host) VALUES('${authority}') ON CONFLICT(lower(host)) DO NOTHING`);
  community=sql(`SELECT id FROM communities WHERE lower(host)='${authority}'`);assert.match(community,/^[0-9a-f-]{36}$/);
  sql(`INSERT INTO users(community_id,pubkey,display_name) VALUES('${community}',decode('${owner}','hex'),'Harness fixture owner');
    INSERT INTO users(community_id,pubkey,display_name,agent_type,agent_owner_pubkey) VALUES('${community}',decode('${agent}','hex'),'Harness fixture agent','acp',decode('${owner}','hex'));
    INSERT INTO relay_members(community_id,pubkey,role) VALUES('${community}','${owner}','owner'),('${community}','${agent}','member');
    INSERT INTO channels(community_id,id,name,channel_type,visibility,created_by) VALUES('${community}','${channel}','harness-${suffix}','stream','private',decode('${owner}','hex'));
    INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES('${community}','${channel}',decode('${owner}','hex'),'owner'),('${community}','${channel}',decode('${agent}','hex'),'bot');`);
  const metadata=(await localRequest('/info','GET',{Accept:'application/nostr+json'})).body;
  assert.equal(metadata.self,relay,'relay must use the documented public fixture signing key');
  const definition={name:`Harness full chain ${suffix}`,enabled:true,trigger:{on:'schedule',cron:'0 0 1 1 *'},steps:[{id:'brief',action:'send_message',text:'Produce the controlled fixture answer.',agent_targets:[agent]}]};
  await publish(sign(ownerKey,30620,[['d',workflow],['h',channel]],JSON.stringify(definition)));
  const definitionHash=sql(`SELECT encode(definition_hash,'hex') FROM workflows WHERE community_id='${community}' AND id='${workflow}'`);
  writeFileSync(join(artifacts,'start.sh'),`#!/bin/sh\nset -eu\n/usr/local/bin/agent-runtime-init >/dev/null\nexport HOME=/var/lib/buzz-harness\ncd "$HOME"\nexec setpriv --reuid=1001 --regid=1001 --clear-groups --inh-caps=-all,+setuid,+setgid,+kill --ambient-caps=-all,+setuid,+setgid,+kill --no-new-privs buzz-acp\n`,{mode:0o755});
  const env={BUZZ_PRIVATE_KEY:Buffer.from(agentKey).toString('hex'),VARVIK_AGENT_PUBKEY:agent,BUZZ_RELAY_URL:`ws://${authority}`,BUZZ_ACP_AGENT_COMMAND:'codex-acp',BUZZ_ACP_LAZY_POOL:'true',BUZZ_ACP_KINDS:'46008',BUZZ_ACP_NO_MEMORY:'true',BUZZ_ACP_NO_PRESENCE:'true',BUZZ_ACP_NO_TYPING:'true',BUZZ_ACP_AGENT_OWNER:owner,BUZZ_ACP_SUPERVISOR_PROFILE:'linux-uids-v1',BUZZ_ACP_WORKFLOW_COMMUNITY_ID:community,BUZZ_ACP_WORKFLOW_RELAY_PUBKEY:relay,BUZZ_ACP_MAX_TURN_DURATION:'60',BUZZ_ACP_IDLE_TIMEOUT:'10',BUZZ_ACP_FAILOVER_TRIGGERS:'usage_limit,internal error',BUZZ_ACP_FAILOVER_ENV:JSON.stringify({MODEL_PROVIDER:'azure-foundry',CODEX_CONFIG:JSON.stringify({model:'fixture-model',model_provider:'azure-foundry'})}),CODEX_PATH:'/fixture/fake-codex-app-server.mjs',OPENAI_API_KEY:'local-fixture-not-a-provider-key',RUST_LOG:'buzz_acp=debug'};
  writeFileSync(join(artifacts,'runner.env'),Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
  docker('volume','create',volume);
  docker('run','-d','--name',name,'--init','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--tmpfs','/home/node:rw,nosuid,nodev,size=256m','--tmpfs','/home/buzz-manual:rw,nosuid,nodev,size=256m','--tmpfs','/run/buzz-auth:rw,nosuid,nodev,size=1m','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','DAC_OVERRIDE','--cap-add','FOWNER','--cap-add','SETUID','--cap-add','SETGID','--cap-add','KILL','--security-opt','no-new-privileges:true','--env-file',join(artifacts,'runner.env'),'-v',`${volume}:/var/lib/buzz-harness`,'-v',`${artifacts}/start.sh:/start.sh:ro`,'-v',`${root}/deploy/compose/tests:/fixture:ro`,'--entrypoint','/bin/sh',image,'/start.sh');
  await until('verified harness capability',()=>sql(`SELECT count(*) FROM workflow_execution_capabilities WHERE community_id='${community}' AND encode(agent_pubkey,'hex')='${agent}' AND expires_at>NOW()`)==='1');
  const trigger=sign(ownerKey,46020,[['d',workflow]],JSON.stringify({expected_definition_hash:definitionHash}));
  const admitted=await publish(trigger);assert.equal(admitted.accepted,true,JSON.stringify(admitted));runId=admitted.run_id;assert.match(runId,/^[0-9a-f-]{36}$/);
  await until('completed full execution',()=>{
    const state=sql(`SELECT execution_state FROM workflow_runs WHERE community_id='${community}' AND id='${runId}'`);
    assert(!['failed','timed_out','stalled'].includes(state),`unexpected terminal state ${state}`);return state==='completed';
  });
  const attempts=JSON.parse(sql(`SELECT coalesce(json_agg(x ORDER BY ordinal),'[]') FROM (SELECT ordinal,stopped_at IS NOT NULL AS stopped,outcome,grant_decision FROM workflow_run_attempts WHERE community_id='${community}' AND run_id='${runId}')x`));
  assert.equal(attempts.length,2,'exactly primary and fallback grants');assert(attempts.every(a=>a.stopped),'both process stops verified');
  const result=await request('/query',ownerKey,[{kinds:[9],'#h':[channel],limit:100}]);
  const rows=Array.isArray(result)?result:result.events;assert(Array.isArray(rows),JSON.stringify(result));
  const final=rows.find(event=>event.content==='FIXTURE_OK' && event.tags.some(t=>t[0]==='workflow-run' && t[1]===runId));assert(final,'missing exact successful fixture output');
  assert.equal(final.pubkey,agent);assert.equal(final.tags.find(t=>t[0]==='workflow-ordinal')?.[1],'2');
  // Stored relay-signed grants, not local counters, justify the execution count.
  const grants=JSON.parse(sql(`SELECT coalesce(json_agg(signed_event),'[]') FROM workflow_run_outbox WHERE community_id='${community}' AND run_id='${runId}' AND (signed_event->>'kind')::int=46041`));
  assert.equal(grants.length,2,'two durable signed grant envelopes');
  for(const event of grants){assert(verifyEvent(event));assert.equal(event.pubkey,relay);const decision=JSON.parse(event.content);assert.equal(decision.run_id,runId);assert([1,2].includes(decision.ordinal));}
  const escaped=docker('exec',name,'/bin/sh','-c','pid=$(cat /home/buzz-manual/workspace/fixture-escaped-pid); test -n "$pid"; if test -e "/proc/$pid/stat"; then state=$(sed "s/.*) //" "/proc/$pid/stat" | cut -d " " -f 1); test "$state" = Z; fi; printf "escaped child %s stopped\\n" "$pid"');
  assert.match(escaped,/escaped child [0-9]+ stopped/);
  const replay=await publish(trigger);assert.equal(replay.run_id,runId);
  docker('restart','--time','10',name);
  await new Promise(r=>setTimeout(r,8000));
  assert.equal(sql(`SELECT count(*) FROM workflow_run_attempts WHERE community_id='${community}' AND run_id='${runId}'`),'2','restart/replay must not create attempt 3');
  assert.equal(sql(`SELECT execution_state FROM workflow_runs WHERE community_id='${community}' AND id='${runId}'`),'completed');
  let eventRunId;
  if(process.argv.includes('--event-origin')) {
    const eventWorkflow=randomUUID(),eventText=`EVENT_FIXTURE_${suffix}`;
    await publish(sign(ownerKey,30620,[['d',eventWorkflow],['h',channel]],JSON.stringify({name:`Event fixture ${suffix}`,enabled:true,trigger:{on:'message_posted',filter:`trigger_text == "${eventText}"`},steps:[{id:'event_brief',action:'send_message',text:'Produce the controlled event fixture.',agent_targets:[agent]}]})));
    await publish(sign(ownerKey,9,[['h',channel]],eventText));
    eventRunId=await until('event workflow admitted',()=>sql(`SELECT id FROM workflow_runs WHERE community_id='${community}' AND workflow_id='${eventWorkflow}' ORDER BY created_at DESC LIMIT 1`));
    await until('event workflow completed',()=>sql(`SELECT execution_state FROM workflow_runs WHERE community_id='${community}' AND id='${eventRunId}'`)==='completed');
    assert.equal(sql(`SELECT origin||':'||(deadline_at IS NULL)::text FROM workflow_runs WHERE community_id='${community}' AND id='${eventRunId}'`),'event:true');
    assert.equal(sql(`SELECT count(*) FROM workflow_run_credentials WHERE community_id='${community}' AND run_id='${eventRunId}'`),'0','ordinary event retains full identity instead of manual read credential');
    const eventResult=await request('/query',ownerKey,[{kinds:[9],'#h':[channel],limit:100}]);
    assert(eventResult.some(event=>event.content==='FIXTURE_OK' && event.tags.some(tag=>tag[0]==='workflow-run' && tag[1]===eventRunId)),'fresh event-origin agent workflow must execute');
  }
  const evidence={image,community,workflow,runId,eventRunId,agent,channel,attempts:attempts.map(({ordinal,stopped,outcome})=>({ordinal,stopped,outcome})),result:final.id,escapedStop:escaped,artifactDirectory:artifacts,volume};
  writeFileSync(join(artifacts,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:'PASS',...evidence},null,2));
} finally {
  try{writeFileSync(join(artifacts,'runner.log'),docker('logs',name));}catch{}
  try{docker('stop','--time','10',name);}catch{}
  console.error(`Harness evidence: ${artifacts}; container ${name}; volume ${volume}; run ${runId??'not admitted'}`);
}
