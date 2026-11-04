import {all,get,put,log,bus} from './store.mjs';
import {runMeeting,runTurn,newSession,learnFromSession} from './engine.mjs';
import {runWorkflow} from './workflows.mjs';
import {runGoal,recoverGoals,goal} from './harness.mjs';
let working=false;
export function enqueue(kind,input){
 if(!['meeting','prompt','workflow','goal','learn'].includes(kind))throw Error('Unsupported job');
 const job=put('job',{kind,input,status:'queued',createdAt:new Date().toISOString(),attempts:0});
 queueMicrotask(pump);return job;
}
async function pump(){
 if(working)return;working=true;
 try{
  while(true){
   const job=all('job').filter(x=>x.status==='queued').sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];
   if(!job)break;
   if(job.kind==='goal'&&goal(job.input?.goalId)?.status==='cancelled'){
    put('job',{...job,status:'cancelled',finishedAt:new Date().toISOString()});continue;
   }
   put('job',{...job,status:'running',startedAt:new Date().toISOString(),attempts:(job.attempts||0)+1});
   const events=[];
   const emit=e=>{const entry={jobId:job.id,...e};bus.emit('job_event',entry);if(events.length<200)events.push({type:e.type,at:Date.now()});};
   try{
    let result;
    if(job.kind==='meeting')result=await runMeeting(job.input.roomId,job.input.goal,emit);
    else if(job.kind==='goal')result=await runGoal(job.input.goalId);
    else if(job.kind==='learn')result=await learnFromSession(job.input.sessionId,{providerId:job.input.providerId,model:job.input.model,automatic:true});
    else if(job.kind==='workflow')result=await runWorkflow(job,emit);
    else{
     const id=job.input.sessionId||newSession({title:job.input.prompt?.slice(0,60)||'자동 작업',agentId:job.input.agentId}).id;
     const msg=await runTurn({sessionId:id,agentId:job.input.agentId,providerId:job.input.providerId,model:job.input.model,input:job.input.prompt,onEvent:emit});
     result={sessionId:id,messageId:msg.id};
    }
    const status=job.kind==='goal'?(result.status==='completed'?'completed':result.status):'completed';
    put('job',{...get('job',job.id),status,result,finishedAt:new Date().toISOString(),events});
    log('job.'+status,{jobId:job.id});
   }catch(e){
    const cancelled=job.kind==='goal'&&goal(job.input?.goalId)?.status==='cancelled';
    put('job',{...get('job',job.id),status:cancelled?'cancelled':'failed',error:String(e.message||e),finishedAt:new Date().toISOString(),events});
    log(cancelled?'job.cancelled':'job.failed',{jobId:job.id,error:String(e)});
   }
  }
 }finally{working=false;}
}
export function scheduleTick(){
 const now=Date.now();
 for(const s of all('automation').filter(x=>x.enabled&&x.nextAt&&new Date(x.nextAt).getTime()<=now)){
  if(!['prompt','meeting','workflow'].includes(s.kind))continue;
  enqueue(s.kind,s.input);
  put('automation',{...s,lastAt:new Date().toISOString(),nextAt:new Date(now+Math.max(1,Number(s.intervalMinutes)||1440)*60000).toISOString()});
 }
}
export function startJobs(){
 recoverGoals();
 for(const job of all('job').filter(x=>x.status==='running')){
  if(job.kind==='goal'&&goal(job.input?.goalId)?.status!=='queued')put('job',{...job,status:'needs_review',recovered:true});
  else put('job',{...job,status:'queued',recovered:true});
 }
 queueMicrotask(pump);
 setInterval(scheduleTick,30000).unref?.();scheduleTick();
}
