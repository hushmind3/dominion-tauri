import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {WORKSPACE} from '../server/config.mjs';
import {saveProvider} from '../server/providers.mjs';
import {newSession,runTurn} from '../server/engine.mjs';
import {get,put,remove} from '../server/store.mjs';

test('local 4B-style model executes a real filesystem request with no native tool calls',async()=>{
 const file='tiny-4b-'+crypto.randomUUID()+'.txt';
 const providerId='tiny-provider-'+crypto.randomUUID();
 const agentId='tiny-agent-'+crypto.randomUUID();
 const calls=[];
 const service=createServer(async(req,res)=>{
  let raw='';for await(const buf of req)raw+=buf;
  const input=JSON.parse(raw);calls.push(input);
  if(input.tools?.length){res.writeHead(400);res.end('Tool calling unavailable');return;}
  const hasResult=input.messages.some(m=>String(m.content).includes('[TOOL RESULT'));
  const answer=hasResult?JSON.stringify({action:'final',message:'파일 작성이 완료되었습니다.'}):
   JSON.stringify({action:'tool',name:'workspace_write',arguments:{path:file,content:'Written by the independent runtime'}});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write('data: '+JSON.stringify({choices:[{delta:{content:answer}}],usage:{total_tokens:25}})+'\n\n');
  res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve=>service.listen(0,'127.0.0.1',resolve));
 const oldPolicy=get('policy','default');
 const session=newSession({agentId,providerId,model:'tiny-4b'});
 saveProvider({id:providerId,name:'Tiny 4B mock',baseUrl:'http://127.0.0.1:'+service.address().port+'/v1',kind:'openai',local:true,enabled:true,toolMode:'compat'});
 put('agent',{id:agentId,name:'Tiny agent',systemPrompt:'Execute tasks through tools',providerId,model:'tiny-4b'});
 put('policy',{id:'default',autoApproveAll:true,autoApproveMcp:false,autoApprove:[]});
 try{
  const result=await runTurn({sessionId:session.id,input:'작업공간에 '+file+' 파일을 만들어 주세요.',autoLearning:false});
  assert.match(result.content,/완료되었습니다/);
  assert.equal(await readFile(path.join(WORKSPACE,file),'utf8'),'Written by the independent runtime');
  assert.equal(calls.length,2);
  assert.ok(calls.every(x=>!x.tools),'The tiny model must run without function calling.');
 }finally{
  if(oldPolicy)put('policy',oldPolicy);else remove('policy','default');
  remove('agent',agentId);remove('provider',providerId);remove('session',session.id);
  await unlink(path.join(WORKSPACE,file)).catch(()=>{});
  await new Promise(resolve=>service.close(resolve));
 }
});
