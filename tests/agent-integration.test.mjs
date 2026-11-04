import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {saveProvider,availableModels} from '../server/providers.mjs';
import {put,messages} from '../server/store.mjs';
import {newSession,runTurn} from '../server/engine.mjs';
import {builtin,executeTool,resolveApproval} from '../server/tools.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {WORKSPACE} from '../server/config.mjs';
const json=(res,x)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(x));};
const sse=(res,objects)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});for(const o of objects)res.write('data: '+JSON.stringify(o)+'\n\n');res.end('data: [DONE]\n\n');};
test('independent agent runtime streams reasoning, invokes real tools and persists results',{timeout:12000},async()=>{
 let completions=0;
 const fake=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models')return json(res,{data:[{id:'mock-reasoning-llm'}]});
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);assert.equal(request.model,'mock-reasoning-llm');
  completions++;
  if(completions===1){
   assert.ok(request.tools.some(t=>t.function.name==='workspace_list'));
   sse(res,[{choices:[{delta:{tool_calls:[{index:0,id:'tool_1',type:'function',function:{name:'workspace_list',arguments:'{"path":""}'}}]}}]}]);
  }else{
   assert.ok(request.messages.some(m=>m.role==='tool'&&m.tool_call_id==='tool_1'));
   sse(res,[{choices:[{delta:{reasoning_content:'목록을 확인했습니다. '}}]},{choices:[{delta:{content:'작업공간의 파일 목록을 확인했습니다.'}}]}]);
  }
 });
 fake.listen(0,'127.0.0.1');await once(fake,'listening');
 try{
  const id='ci_mock_'+crypto.randomUUID().replaceAll('-','');
  saveProvider({id,name:'CI Mock Provider',kind:'openai',baseUrl:'http://127.0.0.1:'+fake.address().port+'/v1',local:true,enabled:true});
  const modelList=await availableModels(id);assert.equal(modelList[0].id,'mock-reasoning-llm');
  const agent=put('agent',{name:'Test Agent',providerId:id,model:'mock-reasoning-llm',systemPrompt:'Use tools precisely.'});
  const session=newSession({agentId:agent.id,providerId:id,model:'mock-reasoning-llm'});
  const events=[];
  const result=await runTurn({sessionId:session.id,input:'List files in the workspace',reasoningLanguage:'ko',onEvent:x=>events.push(x)});
  assert.equal(result.content,'작업공간의 파일 목록을 확인했습니다.');
  assert.equal(result.reasoning,'목록을 확인했습니다. ');
  assert.equal(completions,2);
  const stored=messages(session.id);
  assert.deepEqual(stored.map(m=>m.role),['user','assistant','tool','assistant']);
  assert.ok(events.find(x=>x.type==='reasoning'));
  assert.ok(events.find(x=>x.type==='tool_end'));
  assert.ok(events.find(x=>x.type==='done'));
 }finally{await new Promise(r=>fake.close(r));}
});
test('computer tool permissions and workspace boundaries are enforced',{timeout:12000},async()=>{
 const filename='ci-approval-'+crypto.randomUUID()+'.txt';
 const tool=builtin.find(t=>t.name==='workspace_write');
 let approved=false;
 const output=await executeTool(tool,{path:filename,content:'verified approval'},event=>{
  if(event.type==='approval'){approved=resolveApproval(event.id,true);}
 });
 assert.equal(approved,true);
 assert.equal(output.written,filename);
 assert.equal(await fs.readFile(path.join(WORKSPACE,filename),'utf8'),'verified approval');
 await fs.unlink(path.join(WORKSPACE,filename));
 await assert.rejects(()=>executeTool(builtin.find(t=>t.name==='workspace_read'),{path:'../outside.txt'}),/Outside workspace/);
});
