import test from 'node:test';
import assert from 'node:assert/strict';
import {db,get,put,remove} from '../server/store.mjs';
import {createGoal,goal,goalEvents,runGoal,cancelGoal} from '../server/harness.mjs';
import {builtin,executeTool,approvals,recoverApprovals,resolveApproval} from '../server/tools.mjs';

const dispose=id=>{
 db.prepare('DELETE FROM harness_events WHERE run_id=?').run(id);
 db.prepare('DELETE FROM harness_runs WHERE id=?').run(id);
};

test('user cancellation reaches in-flight goal executor through AbortSignal',async()=>{
 const task=createGoal({goal:'Cancel a hanging command',budget:{maxModelCalls:8}});
 let started;
 const startedPromise=new Promise(resolve=>{started=resolve;});
 try{
  const pending=runGoal(task.id,{
   plan:async()=>({steps:[{id:'hang',prompt:'Execute an action',dependsOn:[]}]}),
   execute:async(_task,_step,_feedback,signal)=>{
    started();
    await new Promise((_,reject)=>{
     if(signal.aborted)return reject(signal.reason);
     signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    });
   },
   review:async()=>({passed:true,mode:'test'})
  });
  await startedPromise;
  const cancelled=cancelGoal(task.id);
  assert.equal(cancelled.status,'cancelled');
  assert.equal((await pending).status,'cancelled');
  const events=goalEvents(task.id).map(x=>x.type);
  assert.ok(events.includes('step.started'));
  assert.ok(events.includes('workflow.cancelled'));
  assert.ok(!events.includes('workflow.completed'));
 }finally{dispose(task.id);}
});

test('strategy replanning preserves completed steps and replaces the rejected remainder',async()=>{
 const task=createGoal({goal:'Adaptive two-step delivery',budget:{maxRepairs:0,maxReplans:1}});
 let firstRuns=0,revision=0;
 try{
  const result=await runGoal(task.id,{
   plan:async()=>({steps:[
    {id:'stable',prompt:'Prepare context',dependsOn:[]},
    {id:'bad',prompt:'Use failed strategy',dependsOn:['stable']}
   ]}),
   execute:async(_r,step)=>{
    if(step.id==='stable')firstRuns++;
    return {content:step.id,toolCalls:0,evidence:[]};
   },
   review:async(_r,step)=>({passed:step.id!=='bad',reason:'Initial strategy is invalid',mode:'test'}),
   replan:async(_r,{reason,completed})=>{
    revision++;
    assert.match(reason,/invalid/);
    assert.deepEqual(completed.map(x=>x.id),['stable']);
    return {steps:[{id:'better',prompt:'Use changed strategy',dependsOn:['stable']}]};
   }
  });
  assert.equal(result.status,'completed',result.reason);
  assert.deepEqual(result.steps.map(x=>x.id),['stable','better']);
  assert.equal(firstRuns,1);
  assert.equal(revision,1);
  assert.ok(goalEvents(task.id).some(x=>x.type==='workflow.replanned'));
 }finally{dispose(task.id);}
});

test('planner cannot turn an explicit file action into a tool-free step',async()=>{
 const task=createGoal({goal:'Ensure verification cannot be weakened'});
 let requiresTools=false;
 try{
  const result=await runGoal(task.id,{
   plan:async()=>({steps:[{id:'s1',prompt:'작업공간에 verify.txt 파일을 만들어 주세요',requiresTools:false}]}),
   execute:async(_r,step)=>{requiresTools=step.requiresTools;return {content:'File written',toolCalls:1,evidence:[{name:'workspace_write'}]};},
   review:async()=>({passed:true,mode:'test'})
  });
  assert.equal(result.status,'completed');
  assert.equal(requiresTools,true);
 }finally{dispose(task.id);}
});

test('approval stays in SQLite, abort marks the decision, and crash recovery never executes it',async()=>{
 const policy=get('policy','default');
 put('policy',{id:'default',autoApprove:[],autoApproveAll:false,autoApproveMcp:false});
 const controller=new AbortController();
 let id;
 try{
  const pending=executeTool(builtin.find(t=>t.name==='workspace_write'),
   {path:'do-not-create-'+crypto.randomUUID()+'.txt',content:'no'},
   event=>{if(event.type==='approval')id=event.id;},
   {signal:controller.signal,runId:'test-run',callId:'test-call'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(id);
  assert.equal(get('approval',id).status,'pending');
  assert.equal(get('approval',id).runId,'test-run');
  controller.abort(Error('User cancelled'));
  await assert.rejects(pending,/denied|expired/);
  assert.equal(get('approval',id).status,'cancelled');
  const other='restarted-'+crypto.randomUUID();
  put('approval',{id:other,status:'pending',tool:'terminal_exec',args:{command:'echo'}});
  recoverApprovals();
  assert.equal(get('approval',other).status,'interrupted');
  assert.ok(approvals().some(x=>x.id===other));
  assert.equal(resolveApproval(other,true),false,'Old execution must not be revived');
  assert.equal(get('approval',other).status,'reviewed');
  remove('approval',other);
 }finally{
  if(id)remove('approval',id);
  if(policy)put('policy',policy);else remove('policy','default');
 }
});
