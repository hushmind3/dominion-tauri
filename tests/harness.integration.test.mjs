import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {WORKSPACE} from '../server/config.mjs';
import {db,get,put,remove} from '../server/store.mjs';
import {createGoal,runGoal,goalEvents} from '../server/harness.mjs';

function respond(res,delta,usage={total_tokens:16}){
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
 res.write('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:'stop'}],usage})+'\n\n');
 res.end('data: [DONE]\n\n');
}
function removeGoal(id){
 db.prepare('DELETE FROM harness_events WHERE run_id=?').run(id);
 db.prepare('DELETE FROM harness_runs WHERE id=?').run(id);
}
test('real mock SSE provider -> planned goal -> approved workspace tool -> independent review -> completed artifact',async()=>{
 const artifact='harness-e2e-'+crypto.randomUUID()+'.txt';
 const content='DOMINION real workspace integration result';
 const providerId='harness-mock-'+crypto.randomUUID();
 const executorId='harness-worker-'+crypto.randomUUID();
 const reviewerId='harness-reviewer-'+crypto.randomUUID();
 const calls=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const payload=JSON.parse(body);calls.push(payload);
  if(payload.model==='mock-planner')return respond(res,{content:JSON.stringify({steps:[{
   id:'write',name:'Write verified artifact',prompt:'Use workspace_write to create '+artifact,
   dependsOn:[],agentId:executorId,requiresTools:true,artifacts:[artifact]
  }]})});
  if(payload.model==='mock-worker'){
   if(payload.messages.some(m=>m.role==='tool'))return respond(res,{content:'The file was created through workspace_write.'});
   return respond(res,{tool_calls:[{index:0,id:'test-call-1',type:'function',function:{
    name:'workspace_write',arguments:JSON.stringify({path:artifact,content})
   }}]});
  }
  if(payload.model==='mock-reviewer')return respond(res,{content:'{"passed":true,"reason":"File and tool evidence present."}'});
  res.writeHead(400);res.end('Unexpected model '+payload.model);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 const oldPolicy=get('policy','default');
 put('provider',{id:providerId,name:'Harness test SSE',kind:'openai',local:true,enabled:true,baseUrl:'http://127.0.0.1:'+port+'/v1'});
 put('agent',{id:executorId,name:'Harness worker',providerId,model:'mock-worker',systemPrompt:'Execute specified work with tools.'});
 put('agent',{id:reviewerId,name:'Independent reviewer',providerId,model:'mock-reviewer',systemPrompt:'Review artifacts.'});
 put('policy',{id:'default',autoApproveAll:true,autoApproveMcp:false,autoApprove:[]});
 let run;
 try{
  run=createGoal({goal:'Write a file and verify its actual existence',
   planner:{providerId,model:'mock-planner'},
   executor:{agentId:executorId,providerId,model:'mock-worker'},
   reviewer:{agentId:reviewerId,providerId,model:'mock-reviewer'},
   budget:{maxModelCalls:15,maxSteps:3,maxRepairs:1}});
  const result=await runGoal(run.id);
  assert.equal(result.status,'completed',result.reason);
  assert.equal((await readFile(path.join(WORKSPACE,artifact),'utf8')),content);
  assert.equal(result.steps[0].reviewMode,'independent-model');
  assert.ok(result.usage.modelCalls>=4);
  assert.equal(result.usage.toolCalls,1);
  assert.deepEqual(calls.map(c=>c.model),['mock-planner','mock-worker','mock-worker','mock-reviewer']);
  assert.ok(calls[1].tools.some(t=>t.function.name==='workspace_write'));
  const events=goalEvents(run.id).map(e=>e.type);
  assert.ok(events.includes('tool.executed'));
  assert.ok(events.includes('review.passed'));
  assert.equal(events.at(-1),'workflow.completed');
 }finally{
  if(run)removeGoal(run.id);
  await unlink(path.join(WORKSPACE,artifact)).catch(()=>{});
  if(oldPolicy)put('policy',oldPolicy);else remove('policy','default');
  remove('provider',providerId);remove('agent',executorId);remove('agent',reviewerId);
  await new Promise(resolve=>server.close(resolve));
 }
});

