import test from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../server/store.mjs';
import {createGoal,goal,goalEvents,runGoal,resumeGoal,recoverGoals} from '../server/harness.mjs';
function cleanup(id){
 db.prepare('DELETE FROM harness_events WHERE run_id=?').run(id);
 db.prepare('DELETE FROM harness_runs WHERE id=?').run(id);
}
test('goal plans dependencies, verifies evidence and persists its trace',async()=>{
 const item=createGoal({goal:'Create and verify a deliverable',budget:{maxRepairs:1}});
 try{
  const res=await runGoal(item.id,{
   plan:async()=>({steps:[
    {id:'draft',name:'Draft',prompt:'Draft a text result',dependsOn:[]},
    {id:'verify',name:'Verify',prompt:'Use a real tool',dependsOn:['draft'],requiresTools:true}
   ]}),
   execute:async(_run,step)=>({content:step.id==='draft'?'Written result':'Verified output',toolCalls:step.id==='draft'?0:1,evidence:step.id==='draft'?[]:[{name:'test'}]}),
   review:async(_run,step,result)=>({passed:step.id==='draft'||result.toolCalls>0,mode:'test'})
  });
  assert.equal(res.status,'completed');
  assert.equal(res.steps.length,2);
  assert.equal(res.steps[1].status,'completed');
  const trace=goalEvents(item.id).map(e=>e.type);
  assert.deepEqual(trace.filter(x=>['workflow.queued','workflow.planned','step.started','review.passed','workflow.completed'].includes(x)),
   ['workflow.queued','workflow.planned','step.started','review.passed','step.started','review.passed','workflow.completed']);
  assert.equal(goal(item.id).status,'completed');
 }finally{cleanup(item.id);}
});
test('rejections create a bounded repair, then hold for review',async()=>{
 const item=createGoal({goal:'Repair failed work',budget:{maxRepairs:1}});
 let attempts=0;
 try{
  const res=await runGoal(item.id,{
   plan:async()=>({steps:[{id:'s1',name:'Needs repair',prompt:'Make output',dependsOn:[]}]}),
   execute:async()=>{attempts++;return {content:'Unverified',toolCalls:0,evidence:[]};},
   review:async()=>({passed:false,reason:'Missing evidence',mode:'test'})
  });
  assert.equal(res.status,'needs_review');assert.equal(attempts,2);
  const t=goalEvents(item.id).map(e=>e.type);
  assert.equal(t.filter(x=>x==='repair.created').length,1);
  assert.ok(!t.includes('workflow.completed'));
  assert.equal(t.at(-1),'workflow.needs_review');
 }finally{cleanup(item.id);}
});
test('model call budget prevents starting any further step',async()=>{
 const item=createGoal({goal:'Enforce call budget',budget:{maxModelCalls:1}});
 try{
  db.prepare('UPDATE harness_runs SET data=? WHERE id=?').run(JSON.stringify({...item,usage:{...item.usage,modelCalls:1}}),item.id);
  const result=await runGoal(item.id,{
   plan:async()=>{throw Error('must never plan');},
   execute:async()=>{throw Error('must never run');}
  });
  assert.equal(result.status,'budget_exceeded');
  assert.ok(goalEvents(item.id).some(x=>x.type==='budget.exceeded'));
 }finally{cleanup(item.id);}
});
test('restart marks unfinished work for review rather than rerunning side effects',()=>{
 const item=createGoal({goal:'Persist side effects'});
 try{
  db.prepare('UPDATE harness_runs SET data=? WHERE id=?').run(JSON.stringify({...item,status:'running',steps:[{id:'s1',status:'running'}]}),item.id);
  recoverGoals();
  assert.equal(goal(item.id).status,'needs_review');
  assert.equal(goal(item.id).steps[0].status,'interrupted');
  assert.ok(goalEvents(item.id).some(e=>e.type==='workflow.interrupted'));
 }finally{cleanup(item.id);}
});
test('planner rejects invalid dependencies instead of reporting completion',async()=>{
 const item=createGoal({goal:'Guard against broken DAG'});
 try{
  const result=await runGoal(item.id,{plan:async()=>({steps:[{id:'a',prompt:'A',dependsOn:['missing']} ]})});
  assert.equal(result.status,'failed');
  assert.ok(goalEvents(item.id).some(e=>e.type==='workflow.failed'));
 }finally{cleanup(item.id);}
});
