// Actual pinned ACP + native Codex, UID1002, production-shaped read MCP config.
// Local deterministic MCP servers only; no model turn or provider spend.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createInterface } from 'node:readline';
const source=fs.readFileSync(process.argv[2]??'/manual-config.toml','utf8');
const expected={project_intelligence:['knowledge_get_freshness'],sylars_control:['sylars_list_tasks'],work_projection:['work_list']};
const calls=new Map(Object.keys(expected).map(name=>[name,new Set()]));
const server=http.createServer(async(req,res)=>{
  const name=req.url.slice(1);
  if(!expected[name] || req.headers.authorization!==`Bearer fixture-${name}-read`) {res.writeHead(403);res.end();return;}
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  let text='';for await(const chunk of req)text+=chunk;
  const rpc=JSON.parse(text);calls.get(name).add(rpc.method);
  if(rpc.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
  let result;
  if(rpc.method==='initialize')result={protocolVersion:rpc.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name,version:'1'}};
  else if(rpc.method==='tools/list')result={tools:expected[name].map(name=>({name,description:'Read-only fixture',inputSchema:{type:'object',properties:{}}}))};
  else if(rpc.method==='tools/call' && expected[name].includes(rpc.params.name))result={content:[{type:'text',text:'Read fixture evidence'}]};
  else {res.writeHead(403);res.end();return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let config=source.replace('https://forge.varunc.com/integrations/project-intelligence/mcp',`${base}/project_intelligence`).replace('https://forge.varunc.com/integrations/sylars/mcp',`${base}/sylars_control`).replace('https://forge.varunc.com/integrations/ledger/mcp',`${base}/work_projection`);
assert.ok(!config.includes('sylars_submit_task'));
assert.ok(!config.includes('SYLARS_CONTROL_API_TOKEN'));
config='model = "gpt-5.1-codex-mini"\nmodel_provider = "fixture"\n'+config+`\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "${base}/provider/v1"\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\n`;
for(const path of ['/home/buzz-manual','/home/buzz-manual/.codex','/home/buzz-manual/workspace']) {fs.mkdirSync(path,{recursive:true});fs.chownSync(path,1002,1002);fs.chmodSync(path,0o700);}
fs.writeFileSync('/home/buzz-manual/.codex/config.toml',config,{mode:0o444});
const child=spawn('setpriv',['--reuid=1002','--regid=1003','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/bin/sh','-c','cd "$1"; shift; exec "$@"','buzz-worker','/home/buzz-manual/workspace','codex-acp'],{cwd:'/',detached:true,env:{PATH:process.env.PATH,HOME:'/home/buzz-manual',CODEX_HOME:'/home/buzz-manual/.codex',OPENAI_API_KEY:'dummy-no-provider-turn',PROJECT_INTELLIGENCE_READ_TOKEN:'fixture-project_intelligence-read',LEDGER_READ_TOKEN:'fixture-work_projection-read',SYLARS_CONTROL_READ_TOKEN:'fixture-sylars_control-read'},stdio:['pipe','pipe','pipe']});
let stderr='',next=0;const pending=new Map();child.stderr.on('data',v=>stderr+=v);
createInterface({input:child.stdout}).on('line',line=>{const value=JSON.parse(line);const resolve=pending.get(value.id);if(resolve){pending.delete(value.id);resolve(value);}});
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>reject(new Error(`${method} timeout: ${stderr}`)),45000);pending.set(id,value=>{clearTimeout(timer);resolve(value);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
try {
  const initialized=await request('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'manual-mcp-session',version:'1'}});assert.ok(initialized.result,JSON.stringify(initialized));
  const session=await request('session/new',{cwd:'/home/buzz-manual/workspace',mcpServers:[]});assert.ok(session.result,JSON.stringify(session)+stderr);
  // Native startup initializes configured MCP servers asynchronously.
  const deadline=Date.now()+15000;
  while(Date.now()<deadline && [...calls.values()].some(methods=>!methods.has('tools/list')))await new Promise(resolve=>setTimeout(resolve,50));
  for(const [name,methods] of calls){assert.ok(methods.has('initialize'),`${name} initialize missing: ${stderr}`);assert.ok(methods.has('tools/list'),`${name} discovery missing: ${stderr}`);}
  assert.ok(session.result.sessionId);
  console.log(JSON.stringify({uid:1002,actualNativeSession:true,discovered:[...calls.keys()],providerTurns:0}));
}finally{try{process.kill(-child.pid,'SIGKILL');}catch{} server.close();}
