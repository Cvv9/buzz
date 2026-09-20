#!/usr/bin/env node
// Deterministic app-server protocol peer. No model/network requests.
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const threadId = 'fixture-thread';
const turn = { id:'fixture-turn',items:[],itemsView:'notLoaded',status:'inProgress',error:null,startedAt:1,completedAt:null,durationMs:null };
createInterface({input:process.stdin}).on('line', line => {
  const request=JSON.parse(line); if(request.id === undefined) return;
  let result;
  switch(request.method) {
    case 'initialize': result={userAgent:'fixture',platformFamily:'unix',platformOs:'linux',codexHome:`${process.env.HOME}/.codex`};break;
    case 'account/read': result={account:{type:'apiKey'},requiresOpenaiAuth:false};break;
    case 'config/read': result={config:{model:'fixture-model',model_provider:'openai',mcp_servers:{},features:{}},origins:{},layers:[]};break;
    case 'model/list': result={data:[{id:'fixture-model',model:'fixture-model',displayName:'Fixture',description:'Controlled fixture',hidden:false,isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium',description:'Medium'}],inputModalities:['text'],supportsPersonality:false}],nextCursor:null};break;
    case 'thread/start': result={thread:{id:threadId,createdAt:1,updatedAt:1,preview:'',modelProvider:'openai',cwd:process.env.HOME,source:'appServer',turns:[],status:{type:'idle'}},model:'fixture-model',modelProvider:'openai',cwd:process.env.HOME,approvalPolicy:'never',sandbox:{type:'dangerFullAccess'},reasoningEffort:'medium'};break;
    case 'skills/list': case 'mcpServerStatus/list': case 'collaborationMode/list': result={data:[],nextCursor:null};break;
    case 'account/rateLimits/read': result={rateLimits:null};break;
    case 'turn/start': {
      result={turn};
      setTimeout(()=>{
        const status=process.env.BUZZ_WIRE_FIXTURE ?? (process.env.MODEL_PROVIDER==='azure-foundry'?'success':'usage-limit');
        if(process.getuid?.()===1002 && process.env.MODEL_PROVIDER!=='azure-foundry') {
          const escaped=spawn('/bin/sleep',['300'],{detached:true,stdio:'ignore'});
          escaped.unref();
          writeFileSync('/home/buzz-manual/workspace/fixture-escaped-pid',String(escaped.pid),{mode:0o600});
        }
        let error=null;
        if(status !== 'success') {
          error={message:'Controlled provider fixture error',codexErrorInfo:status==='usage-limit'?'usageLimitExceeded':(status==='unknown'||status.startsWith('failed-only'))?null:{httpConnectionFailed:{httpStatusCode:Number(status)}},additionalDetails:null};
          if(!status.startsWith('failed-only')) send({method:'error',params:{threadId,turnId:turn.id,willRetry:false,error}});
        } else {
          send({method:'item/agentMessage/delta',params:{threadId,turnId:turn.id,itemId:'fixture-message',delta:'FIXTURE_OK'}});
        }
        send({method:'turn/completed',params:{threadId,turn:{...turn,status:status==='success'?'completed':'failed',error:status==='failed-only-null'?null:error,completedAt:2,durationMs:1}}});
      },30);break;
    }
    default:
      if(['skills/extraRoots/set','thread/settings/update','thread/unsubscribe'].includes(request.method)) result={};
      else { process.stderr.write(`Unexpected fixture operation: ${request.method}\n`);send({id:request.id,error:{code:-32601,message:'Unsupported fixture operation'}});return; }
  }
  send({id:request.id,result});
});
