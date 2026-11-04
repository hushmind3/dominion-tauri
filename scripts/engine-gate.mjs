import path from 'node:path';
import os from 'node:os';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {inspectTraces} from '../server/trace-gate.mjs';

// Self-contained deterministic integration fixture, not a user's task database.
const temporary=await mkdtemp(path.join(os.tmpdir(),'dominion-gate-'));
process.env.DOMINION_DATA=path.join(temporary,'data');
process.env.DOMINION_WORKSPACE=path.join(temporary,'workspace');

let storeDb=null;
try{
 const [{createGoal,runGoal,goal,goalEvents},{put,db},{builtin,executeTool}]=await Promise.all([
  import('../server/harness.mjs'),
  import('../server/store.mjs'),
  import('../server/tools.mjs')
 ]);
 storeDb=db;
 put('policy',{id:'default',autoApprove:['workspace_write'],autoApproveAll:false,autoApproveMcp:false});
 const filename='gate-evidence.txt',expected='DOMINION gate verified real workspace write';
 const good=createGoal({goal:'Create and verify a workspace file',budget:{maxSteps:1,maxRepairs:0,maxReplans:0}});
 const goodRun=await runGoal(good.id,{
  plan:async()=>({steps:[{id:'write',name:'Write artifact',prompt:'Create a file in the workspace',requiresTools:true,artifacts:[filename]}]}),
  execute:async(_run,_step,_feedback,signal)=>{
   const tool=builtin.find(t=>t.name==='workspace_write');
   const result=await executeTool(tool,{path:filename,content:expected},()=>{}, {signal,runId:good.id,callId:'gate-write'});
   return {content:'Wrote '+result.written,toolCalls:1,evidence:[{name:tool.name,callId:'gate-write'}]};
  },
  review:async()=>({passed:(await readFile(path.join(process.env.DOMINION_WORKSPACE,filename),'utf8'))===expected,mode:'deterministic-fixture'})
 });
 const bad=createGoal({goal:'Create a file without claiming it from a read-only tool',budget:{maxSteps:1,maxRepairs:0,maxReplans:0}});
 const badRun=await runGoal(bad.id,{
  plan:async()=>({steps:[{id:'write',prompt:'Create a file in the workspace',requiresTools:true}]}),
  execute:async()=>({content:'Claimed success without a write',toolCalls:1,evidence:[{name:'workspace_list'}]}),
  review:async()=>({passed:true,mode:'untrusted-reviewer'})
 });
 const results=inspectTraces([goal(good.id),goal(bad.id)],goalEvents);
 const ok=results.ok&&goodRun.status==='completed'&&badRun.status==='needs_review'&&
  goodRun.usage.toolCalls===1&&goodRun.steps[0].evidence[0].name==='workspace_write';
 console.log(JSON.stringify({...results,positive:goodRun.status,negative:badRun.status,verifiedArtifact:goodRun.steps[0].evidence[0].name==='workspace_write',ok},null,2));
 if(!ok)process.exitCode=1;
}catch(error){
 console.error('Engine gate failed: '+String(error?.stack||error));
 process.exitCode=1;
}finally{
 try{storeDb?.close()}catch{}
 let last=null;
 for(let i=0;i<20;i++){
  try{await rm(temporary,{recursive:true,force:true});last=null;break}
  catch(error){last=error;await new Promise(resolve=>setTimeout(resolve,150));}
 }
 if(last){console.error('Engine gate cleanup failed: '+String(last?.message||last));process.exitCode=1;}
}
