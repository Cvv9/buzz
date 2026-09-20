import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
for(const fixture of ['failed-only-null','failed-only-error','429','503','unknown','success']) {
  const home=mkdtempSync('/tmp/buzz-acp-wire-');mkdirSync(resolve(home,'.codex'));
  const child=spawn('codex-acp',[],{env:{PATH:process.env.PATH,HOME:home,CODEX_PATH:resolve(here,'fake-codex-app-server.mjs'),BUZZ_WIRE_FIXTURE:fixture},stdio:['pipe','pipe','pipe']});
  const pending=new Map();let next=0,stderr='',message='';
  child.stderr.on('data',data=>{stderr+=data;});
  createInterface({input:child.stdout}).on('line',line=>{const value=JSON.parse(line);if(value.method==='session/update'&&value.params?.update?.content?.text)message+=value.params.update.content.text;const waiter=pending.get(value.id);if(waiter){pending.delete(value.id);waiter(value);}});
  const request=(method,params)=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>reject(new Error(`ACP ${method} timeout: ${stderr}`)),15000);pending.set(id,value=>{clearTimeout(timer);resolve(value);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  try {
    const initialized=await request('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'wire-smoke',version:'1'}});assert.ok(initialized.result,JSON.stringify(initialized));
    const created=await request('session/new',{cwd:home,mcpServers:[]});assert.ok(created.result,JSON.stringify(created)+stderr);
    const prompted=await request('session/prompt',{sessionId:created.result.sessionId,prompt:[{type:'text',text:'Controlled fixture'}]});
    if(fixture==='success'){assert.equal(prompted.result?.stopReason,'end_turn',JSON.stringify(prompted)+stderr);assert.ok(message.includes('FIXTURE_OK'));}
    else {assert.equal(prompted.error?.code,-32603,JSON.stringify(prompted)+stderr);assert.equal(prompted.result,undefined);}
    console.log(JSON.stringify({fixture,wireResult:prompted.error?'structured_error':'end_turn'}));
  } finally {child.kill('SIGKILL');rmSync(home,{recursive:true,force:true});}
}
