import test from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../server/store.mjs';
import {createGoal,runGoal,goalEvents} from '../server/harness.mjs';
test('a goal with an executable action never succeeds on model prose alone',async()=>{
 const run=createGoal({goal:'Build a website project and deploy it',budget:{maxRepairs:0,maxReplans:0}});
 try{
  const result=await runGoal(run.id,{
   plan:async()=>({steps:[{id:'fake',prompt:'Explain the launch',requiresTools:false}]}),
   execute:async()=>({content:'Already deployed.',toolCalls:0,evidence:[]}),
   review:async()=>({passed:true,reason:'LLM thinks it is done',mode:'independent-model'})
  });
  assert.equal(result.status,'needs_review');
  assert.match(result.reason,/no confirmed tool/);
  assert.ok(!goalEvents(run.id).some(e=>e.type==='workflow.completed'));
 }finally{
  db.prepare('DELETE FROM harness_events WHERE run_id=?').run(run.id);
  db.prepare('DELETE FROM harness_runs WHERE id=?').run(run.id);
 }
});

test('a reviewer cannot approve a mutation with only read-only or discovery evidence',async()=>{
 for(const evidence of [[{name:'workspace_list'}],[{name:'tool_discover'}],[]]){
  const run=createGoal({goal:'Create an artifact and verify it',budget:{maxRepairs:0,maxReplans:0}});
  let reviewerCalled=false;
  try{
   const result=await runGoal(run.id,{
    plan:async()=>({steps:[{id:'write',prompt:'Create a file in the workspace',requiresTools:true}]}),
    execute:async()=>({content:'File created.',toolCalls:1,evidence}),
    review:async()=>{reviewerCalled=true;return {passed:true,mode:'independent-model'};}
   });
   assert.equal(result.status,'needs_review');
   assert.match(result.reason,/matching successful tool evidence/);
   assert.equal(reviewerCalled,false,'Invalid evidence must be rejected before the reviewer');
   assert.ok(!goalEvents(run.id).some(e=>e.type==='workflow.completed'));
  }finally{
   db.prepare('DELETE FROM harness_events WHERE run_id=?').run(run.id);
   db.prepare('DELETE FROM harness_runs WHERE id=?').run(run.id);
  }
 }
});
