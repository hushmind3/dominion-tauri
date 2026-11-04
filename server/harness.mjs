import path from 'node:path';
import {stat} from 'node:fs/promises';
import {db,bus,all,get,put} from './store.mjs';
import {WORKSPACE} from './config.mjs';
import {newSession,runTurn} from './engine.mjs';
import {streamCompletion} from './providers.mjs';
import {likelyRequiresTools,requestedToolEffect,successfulToolEvidence} from './tool-compat.mjs';
import {resolveModel} from './model-router.mjs';
import {recordExperience,experienceHints} from './experience.mjs';
import {memoryContext} from './memory-retrieval.mjs';

// The run snapshot and event are committed together; the SSE bus is notification only.
db.exec(`CREATE TABLE IF NOT EXISTS harness_runs (
 id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS harness_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, type TEXT NOT NULL,
 data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 FOREIGN KEY(run_id) REFERENCES harness_runs(id)
);
CREATE INDEX IF NOT EXISTS harness_events_by_run ON harness_events(run_id,seq);`);

const terminal=new Set(['completed','failed','needs_review','budget_exceeded','cancelled']);
const activeGoals=new Map(); // Process-local cancellation handle for each durable goal.
const limits={maxSteps:8,maxRepairs:2,maxReplans:2,maxModelCalls:36,maxTokens:100000,maxElapsedMs:900000};
const limit=(v,floor,ceiling,defaultValue)=>Number.isFinite(Number(v))?Math.max(floor,Math.min(ceiling,Math.trunc(Number(v)))):defaultValue;
const clip=(s,n=6000)=>String(s||'').slice(0,n);
const snapshot=row=>row?JSON.parse(row.data):null;
export const goal=(id)=>snapshot(db.prepare('SELECT data FROM harness_runs WHERE id=?').get(id));
export const goals=()=>db.prepare('SELECT data FROM harness_runs ORDER BY updated_at DESC LIMIT 200').all().map(snapshot);
export const goalEvents=(id)=>db.prepare('SELECT seq,type,data,created_at AS createdAt FROM harness_events WHERE run_id=? ORDER BY seq').all(id).map(e=>({...e,data:JSON.parse(e.data)}));

function saveEvent(id,type,patch={},detail={}){
 let next,ev;
 db.exec('BEGIN IMMEDIATE');
 try{
  const current=goal(id);if(!current)throw Error('Goal not found');
  next={...current,...patch,updatedAt:new Date().toISOString()};
  db.prepare("UPDATE harness_runs SET data=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(next),id);
  const result=db.prepare('INSERT INTO harness_events(run_id,type,data) VALUES(?,?,?)').run(id,type,JSON.stringify(detail));
  ev={seq:Number(result.lastInsertRowid),runId:id,type,data:detail};
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 bus.emit('goal_event',ev);
 return next;
}
export function createGoal(input){
 const text=clip(input?.goal,12000).trim();if(!text)throw Error('Goal is required');
 const id=crypto.randomUUID(), now=new Date().toISOString();
 const options=input?.budget||{};
 const data={id,goal:text,status:'queued',createdAt:now,updatedAt:now,
  planner:input?.planner||{},executor:input?.executor||{},reviewer:input?.reviewer||{},
  budget:{
   maxSteps:limit(options.maxSteps,1,30,limits.maxSteps),
   maxRepairs:limit(options.maxRepairs,0,8,limits.maxRepairs),
    maxReplans:limit(options.maxReplans,0,4,limits.maxReplans),
   maxModelCalls:limit(options.maxModelCalls,1,200,limits.maxModelCalls),
   maxTokens:limit(options.maxTokens,100,2000000,limits.maxTokens),
   maxElapsedMs:limit(options.maxElapsedMs,1000,86400000,limits.maxElapsedMs)
  },
  usage:{modelCalls:0,tokens:0,toolCalls:0},plan:[],steps:[],replans:0,startedAt:null,summary:'',reason:'',reviewMode:'pending'};
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare('INSERT INTO harness_runs(id,data) VALUES(?,?)').run(id,JSON.stringify(data));
  db.prepare('INSERT INTO harness_events(run_id,type,data) VALUES(?,?,?)').run(id,'workflow.queued',JSON.stringify({goal:text}));
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 bus.emit('goal_event',{runId:id,type:'workflow.queued'});
 return data;
}
export function resumeGoal(id){
 const r=goal(id);
 if(!r||!['needs_review','interrupted'].includes(r.status))throw Error('Goal is not resumable');
 return saveEvent(id,'workflow.queued',{status:'queued',reason:'',steps:r.steps.map(x=>['failed','interrupted','running'].includes(x.status)?{...x,status:'pending',attempts:0}:x)},{resumed:true,userConfirmedReplay:true});
}
export function cancelGoal(id){
 const r=goal(id);if(!r||terminal.has(r.status))throw Error('Goal is not active');
 // Abort inference, approvals and subprocesses through their shared signal.
 const controller=activeGoals.get(id);
 if(controller&&!controller.signal.aborted)controller.abort(Object.assign(Error('Goal cancelled'),{code:'CANCELLED'}));
 return saveEvent(id,'workflow.cancelled',{status:'cancelled',reason:'Cancelled by user'});
}
function addUsage(id,usage={}){
 const r=goal(id),u=r.usage;
 const tokens=Number(usage?.total_tokens||((usage?.prompt_tokens||0)+(usage?.completion_tokens||0)))||0;
 return saveEvent(id,'usage.recorded',{usage:{...u,modelCalls:u.modelCalls+1,tokens:u.tokens+tokens}},{modelCalls:1,tokens});
}
function requireBudget(id){
 const r=goal(id);
 if(!r||r.status==='cancelled')throw Object.assign(Error('Goal cancelled'),{code:'CANCELLED'});
 activeGoals.get(id)?.signal.throwIfAborted();
 const u=r.usage,b=r.budget;
 const elapsed=Date.now()-new Date(r.startedAt||r.createdAt).getTime();
 if(u.modelCalls>=b.maxModelCalls||u.tokens>=b.maxTokens||elapsed>=b.maxElapsedMs){
  saveEvent(id,'budget.exceeded',{status:'budget_exceeded',reason:'Model calls, tokens or elapsed time limit'},{usage:u,budget:b,elapsed});
  const err=Error('Goal budget exceeded');err.code='BUDGET';throw err;
 }
}
function modelFor(config={},fallback={}){
 const ids=all('agent'),specified=ids.find(a=>a.id===config.agentId),
   candidate=specified||ids.find(a=>a.providerId&&a.model)||ids.find(a=>a.id==='general')||{};
 const providerId=config.providerId||specified?.providerId||fallback.providerId||candidate.providerId;
 const model=config.model||specified?.model||fallback.model||candidate.model;
 if(!providerId||!model)throw Error('Configure an agent model or supply providerId and model');
 return {agentId:specified?.id||candidate.id||'general',providerId,model};
}
function extractJson(raw){
 const value=clip(raw,30000).trim().replace(/^`{3}(?:json)?/i,'').replace(/`{3}$/,'').trim();
 try{return JSON.parse(value);}catch{
  const start=value.indexOf('{'),end=value.lastIndexOf('}');
  if(start<0||end<=start)throw Error('Planner did not produce a valid JSON plan');
  return JSON.parse(value.slice(start,end+1));
 }
}
function normalizePlan(raw,maxSteps,completedIds=[]){
 const data=Array.isArray(raw)?{steps:raw}:raw;
 if(!Array.isArray(data?.steps)||!data.steps.length||data.steps.length>maxSteps)throw Error('Invalid step count in plan');
 const ids=new Set(completedIds), steps=data.steps.map((s,i)=>{
  const id=String(s.id||'s'+(i+1)).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,30);
  if(!id||ids.has(id))throw Error('Duplicate or invalid step id');ids.add(id);
  if(!clip(s.prompt,6000).trim())throw Error('Plan step missing prompt');
  return {id,name:clip(s.name||id,90),prompt:clip(s.prompt,6000),dependsOn:Array.isArray(s.dependsOn)?s.dependsOn.map(String):[],
   agentId:clip(s.agentId,100),requiresTools:s.requiresTools===true||likelyRequiresTools(s.prompt),replanOnResult:s.replanOnResult===true,
   artifacts:Array.isArray(s.artifacts)?s.artifacts.filter(x=>typeof x==='string').slice(0,12):[],status:'pending',attempts:0,output:'',evidence:[]};
 });
 const byId=new Map(steps.map(s=>[s.id,s]));
 for(const s of steps)for(const dep of s.dependsOn)if(dep===s.id||(!byId.has(dep)&&!completedIds.includes(dep)))throw Error('Invalid dependency: '+dep);
 const seen=new Set(),active=new Set();
 function visit(id){if(active.has(id))throw Error('Cyclic plan');if(seen.has(id))return;active.add(id);
  for(const dep of byId.get(id).dependsOn)if(byId.has(dep))visit(dep);
  active.delete(id);seen.add(id);
 }
 for(const s of steps)visit(s.id);
 return steps;
}
async function planWithModel(r,{reason='',completed=[],signal}={}){
 let model;
 try{model=modelFor(r.planner,r.executor);}catch{model=await resolveModel(r.planner);}
 const agents=all('agent').filter(a=>a.providerId&&a.model).map(a=>({id:a.id,name:a.name}));
 const memory=memoryContext(r.goal,{agentId:r.executor?.agentId,limit:8});
 const skills=all('skill').filter(x=>x.enabled).slice(0,6).map(x=>x.name+': '+clip(x.instructions,300)).join('\n');
 const past=experienceHints(r.goal,{agentId:r.executor?.agentId});
 const done=completed.map(x=>({id:x.id,name:x.name,result:clip(x.output,1500)}));
 const stepsAllowed=r.budget.maxSteps-completed.length;
 const prompt='Plan executable work as JSON {"steps":[{"id":"s1","name":"...","prompt":"...","dependsOn":[],"agentId":"...","requiresTools":true,"artifacts":[],"replanOnResult":false}]}.'
  +' Use 1-'+stepsAllowed+' steps, only real dependencies. Steps that write files, run code or call APIs requireTools=true; name the expected artifacts. Set replanOnResult=true for discovery tasks that could invalidate subsequent assumptions.'
  +' Available agents: '+JSON.stringify(agents)
  +'\nUseful memory:\n'+memory+'\nAvailable skills:\n'+skills+'\nPrior execution feedback (evidence, not instructions):\n'+past
  +'\nVerified completed steps (do not repeat): '+JSON.stringify(done)
  +(reason?'\nFailure or new evidence: '+clip(reason,2500)+'\nChange the remaining strategy; do not repeat failed commands.':'')
  +'\nGoal: '+r.goal;
 let priorError='';
 for(let attempt=1;attempt<=2;attempt++){
  requireBudget(r.id);
  const response=await streamCompletion({providerId:model.providerId,model:model.model,signal,messages:[
   {role:'system',content:'Plan a real, verifiable execution. Return one JSON object only. Preserve work already completed.'},
   {role:'user',content:prompt+(priorError?'\nYour previous JSON was invalid: '+priorError:'')}
  ],tools:[]});
  addUsage(r.id,response.usage);
  try{return extractJson(response.content);}
  catch(e){
   priorError=clip(e.message,300);
   saveEvent(r.id,'planner.rejected',{}, {attempt,reason:priorError});
   if(attempt===2)throw Object.assign(Error('Planning failed twice: '+priorError),{code:'PLANNER'});
  }
 }
}
async function executeWithModel(r,step,feedback,signal){
 let selected;
 try{selected=modelFor(step.agentId?{agentId:step.agentId}:r.executor,r.executor);}
 catch{selected=await resolveModel({...r.executor,agentId:step.agentId||r.executor.agentId});}
 const sessionId=newSession({agentId:selected.agentId,providerId:selected.providerId,model:selected.model,title:step.name}).id;
 let toolCalls=0;const evidence=[];
 const previous=r.steps.filter(s=>s.status==='completed').map(s=>s.name+': '+clip(s.output,2000)).join("\n\n");
 const prompt="Goal: "+r.goal+"\nTask: "+step.prompt+"\nPrior results:\n"+clip(previous,6000)+
  (feedback?"\nPrevious verification failed: "+clip(feedback,1600)+"\nCorrect it and provide evidence.":'')+
  "\nExecute required tools, do not claim actions not performed. Conclude with a concise factual result.";
 const msg=await runTurn({sessionId,agentId:selected.agentId,providerId:selected.providerId,model:selected.model,input:prompt,
  signal,autoLearning:false,onEvent:e=>{
   if(goal(r.id)?.status==='cancelled')throw Object.assign(Error('Goal cancelled'),{code:'CANCELLED'});
   if(e.type==='assistant_saved'){addUsage(r.id,e.usage);requireBudget(r.id);}
   if(e.type==='tool_end'&&successfulToolEvidence(e.name,e.result,requestedToolEffect(step.prompt))){
    toolCalls++;const ev={name:e.name,callId:e.callId,output:clip(JSON.stringify(e.result),1000)};evidence.push(ev);
    saveEvent(r.id,'tool.executed',{}, {stepId:step.id,attempt:step.attempts,name:e.name,callId:e.callId});
   }
  }});
 return {content:clip(msg.content,30000),toolCalls,evidence,sessionId,executor:selected};
}
async function checkArtifacts(step){
 const findings=[];
 for(const relative of step.artifacts){
  const absolute=path.resolve(WORKSPACE,relative);
  if(!absolute.startsWith(WORKSPACE+path.sep))return {ok:false,reason:'Artifact outside workspace: '+relative};
  try{const s=await stat(absolute);if(!s.isFile()||s.size===0)throw Error('not a nonempty file');
   findings.push({path:relative,size:s.size});
  }catch{return {ok:false,reason:'Missing or empty artifact: '+relative};}
 }
 return {ok:true,findings};
}
async function reviewWithModel(r,step,result,signal){
 const files=await checkArtifacts(step);
 if(!files.ok)return {passed:false,reason:files.reason,mode:'deterministic'};
 if(step.requiresTools&&(!result.toolCalls||!result.evidence.some(x=>successfulToolEvidence(x.name,{},requestedToolEffect(step.prompt)))))
  return {passed:false,reason:'Required action has no matching successful tool evidence',mode:'deterministic'};
 if(!result.content.trim()&&files.findings.length===0)return {passed:false,reason:'No result or artifact',mode:'deterministic'};
 const reviewerConfig=r.reviewer||{};
 let reviewer=null;
 try{if(reviewerConfig.agentId||reviewerConfig.providerId)reviewer=modelFor(reviewerConfig);}catch{}
 const distinct=a=>a.providerId&&a.model&&(a.providerId!==result.executor?.providerId||a.model!==result.executor?.model);
 if(!reviewer||!distinct(reviewer)){
  const candidate=all('agent').find(distinct);
  reviewer=candidate?{agentId:candidate.id,providerId:candidate.providerId,model:candidate.model}:null;
 }
 if(!reviewer)return files.findings.length&&result.toolCalls>0
  ?{passed:true,reason:'File and tool were verified deterministically; no independent LLM was configured',mode:'artifact-evidence-only'}
  :{passed:false,reason:'Independent reviewer required for outputs without verifiable file artifacts',mode:'reviewer-required'};
 const prompt="Evaluate whether this output satisfies the task. Focus on evidence, not claims. Return JSON {\"passed\":true|false,\"reason\":\"...\"}.\nGoal: "+r.goal+"\nStep: "+step.prompt+"\nResult: "+clip(result.content,8000)+"\nTool evidence: "+JSON.stringify(result.evidence).slice(0,5000)+"\nArtifacts: "+JSON.stringify(files.findings);
 requireBudget(r.id);
 const response=await streamCompletion({providerId:reviewer.providerId,model:reviewer.model,signal,messages:[{role:'system',content:'You are an independent result reviewer. Output JSON only.'},{role:'user',content:prompt}],tools:[]});
 addUsage(r.id,response.usage);
 const answer=extractJson(response.content);
 return {passed:answer.passed===true,reason:clip(answer.reason||'',1600),mode:'independent-model'};
}
// Replanning replaces only unfinished work. Completed effects are immutable.
async function reviseRemaining(id,planner,reason,signal){
 const current=goal(id),completed=current.steps.filter(x=>x.status==='completed');
 const remaining=current.steps.filter(x=>x.status!=='completed');
 if(!planner||(current.replans||0)>=(current.budget.maxReplans??0)||!remaining.length)return false;
 const oldFingerprint=remaining.map(x=>x.prompt+'|'+x.dependsOn.join(',')).join(';');
 saveEvent(id,'replan.started',{status:'planning'},{reason:clip(reason,1200),completed:completed.map(x=>x.id)});
 try{
  requireBudget(id);
  const answer=await planner(goal(id),{reason,completed,signal});
  const proposed=normalizePlan(answer,current.budget.maxSteps-completed.length,completed.map(x=>x.id));
  const newFingerprint=proposed.map(x=>x.prompt+'|'+x.dependsOn.join(',')).join(';');
  if(oldFingerprint===newFingerprint)throw Error('The proposed strategy is identical to the rejected plan');
  const combined=[...completed,...proposed];
  saveEvent(id,'workflow.replanned',{
   status:'running',replans:(current.replans||0)+1,reason:'',steps:combined,
   plan:combined.map(({id,name,dependsOn,agentId})=>({id,name,dependsOn,agentId}))
  },{replaced:remaining.map(x=>x.id),newSteps:proposed.map(x=>x.id),reason:clip(reason,1200)});
  return true;
 }catch(e){
  if(goal(id)?.status==='cancelled'||e.code==='BUDGET'||e.code==='CANCELLED')throw e;
  saveEvent(id,'replan.rejected',{status:'running',replans:(current.replans||0)+1},{reason:clip(e.message,1200)});
  return false;
 }
}
function patchStep(id,stepId,changes,type,detail={}){
 const r=goal(id),steps=r.steps.map(s=>s.id===stepId?{...s,...changes}:s);
 return saveEvent(id,type,{steps}, {stepId,...detail});
}
export async function runGoal(id,deps={}){
 let r=goal(id);if(!r||r.status!=='queued')throw Error('Goal is not queued');
 if(activeGoals.has(id))throw Error('Goal is already running');
 const controller=new AbortController(),signal=controller.signal;
 activeGoals.set(id,controller);
 const planner=deps.plan||planWithModel,execute=deps.execute||executeWithModel,review=deps.review||reviewWithModel;
 const replan=deps.replan||(deps.plan?null:planWithModel);
 try{
  if(r.steps.length){
   r=saveEvent(id,'workflow.resumed',{status:'running',reason:''},{remaining:r.steps.filter(s=>s.status!=='completed').length});
  }else{
   r=saveEvent(id,'workflow.planning',{status:'planning',startedAt:r.startedAt||new Date().toISOString()});
   requireBudget(id);
   const steps=normalizePlan(await planner(goal(id),{signal}),r.budget.maxSteps);
   requireBudget(id);
   r=saveEvent(id,'workflow.planned',{status:'running',plan:steps.map(({id,name,dependsOn,agentId})=>({id,name,dependsOn,agentId})),steps},{count:steps.length});
  }
  while(true){
   r=goal(id);if(r.status==='cancelled')return r;
   const next=r.steps.find(s=>s.status==='pending'&&s.dependsOn.every(d=>r.steps.find(x=>x.id===d)?.status==='completed'));
   if(!next)break;
   let feedback='';
   for(let attempt=1;attempt<=r.budget.maxRepairs+1;attempt++){
    requireBudget(id);
    patchStep(id,next.id,{status:'running',attempts:attempt},'step.started',{attempt});
    const active=goal(id).steps.find(s=>s.id===next.id);
    let output;
    try{output=await execute(goal(id),active,feedback,signal);}
    catch(e){if(e.code==='BUDGET')throw e;output={content:'',toolCalls:0,evidence:[],error:String(e.message||e)};}
    requireBudget(id);
    const result={content:clip(output.content,30000),toolCalls:Number(output.toolCalls)||0,evidence:output.evidence||[],executor:output.executor||null};
    const usage=goal(id).usage;
    saveEvent(id,'step.result',{usage:{...usage,toolCalls:usage.toolCalls+result.toolCalls}},{stepId:next.id,attempt});
    saveEvent(id,'review.started',{status:'reviewing'},{stepId:next.id,attempt});
    let verdict;
    if(output.error)verdict={passed:false,reason:output.error,mode:'execution-error'};
    else if(active.requiresTools&&(!result.toolCalls||!result.evidence.some(x=>successfulToolEvidence(x.name,{},requestedToolEffect(active.prompt)))))
     verdict={passed:false,reason:'Required action has no matching successful tool evidence',mode:'deterministic'};
    else verdict=await review(goal(id),active,result,signal);
    requireBudget(id);
    if(verdict.passed){
     patchStep(id,next.id,{status:'completed',output:result.content,evidence:result.evidence,reviewMode:verdict.mode},'step.completed',{attempt});
     saveEvent(id,'review.passed',{status:'running',reviewMode:verdict.mode},{stepId:next.id,attempt,mode:verdict.mode});
      const earlier=goalEvents(id).filter(e=>e.type==='review.rejected'&&e.data?.stepId===next.id).map(e=>e.data.reason);
      recordExperience({task:active.prompt,source:'goal',status:'completed',
       reason:earlier.length?'Recovered after review feedback: '+earlier.at(-1):'Passed review: '+verdict.mode,
       strategy:result.content,evidence:result.evidence,agentId:active.agentId,
       verified:result.evidence.length>0&&verdict.mode!=='untrusted-reviewer'});
     if(active.replanOnResult){
      const remaining=goal(id).steps.some(s=>s.status==='pending');
      if(remaining)await reviseRemaining(id,replan,'New verified discovery: '+clip(result.content,1800),signal);
     }
     break;
    }
    feedback=clip(verdict.reason,1600)||'Verification rejected';
    recordExperience({task:active.prompt,source:'goal',status:'failed',reason:feedback,evidence:result.evidence,agentId:active.agentId});
    patchStep(id,next.id,{status:'failed',output:result.content,evidence:result.evidence,reason:feedback},'step.failed',{attempt,reason:feedback});
    saveEvent(id,'review.rejected',{status:'repairing',reason:feedback},{stepId:next.id,attempt,reason:feedback});
    if(attempt>r.budget.maxRepairs){
     if(await reviseRemaining(id,replan,feedback,signal))break;
     return saveEvent(id,'workflow.needs_review',{status:'needs_review',reason:feedback},{stepId:next.id,attempt});
    }
    saveEvent(id,'repair.created',{status:'running'},{stepId:next.id,attempt:attempt+1,reason:feedback});
   }
  }
  r=goal(id);
  if(r.steps.some(s=>s.status!=='completed'))return saveEvent(id,'workflow.needs_review',{status:'needs_review',reason:'Unresolved workflow dependencies'});
  // Action evidence is a goal-level invariant too: a dishonest or overconfident
  // planner cannot remove all executable actions and win via a prose review.
  const goalRequiresTools=likelyRequiresTools(r.goal)||/(?:구현|배포|설치|프로젝트.{0,30}만들|implement|deploy|build a (?:site|project|app)|create a (?:site|project|app))/i.test(r.goal);
  if(goalRequiresTools&&(r.usage.toolCalls||0)===0)
   return saveEvent(id,'workflow.needs_review',{status:'needs_review',reason:'The requested action has no confirmed tool execution evidence'});
  return saveEvent(id,'workflow.completed',{status:'completed',finishedAt:new Date().toISOString(),
   summary:r.steps.map(s=>s.name+': '+clip(s.output,2000)).join("\n\n"),reason:''},{stepCount:r.steps.length,usage:r.usage});
 }catch(e){
  const state=goal(id);
  if(e.code==='BUDGET'||state?.status==='budget_exceeded'||state?.status==='cancelled')return goal(id);
  if(e.code==='PLANNER')return saveEvent(id,'workflow.needs_review',{status:'needs_review',reason:clip(e.message,1500)});
  return saveEvent(id,'workflow.failed',{status:'failed',reason:clip(e.message||e,2000)},{error:clip(e.message||e,2000)});
 }finally{
  activeGoals.delete(id);
 }
}
export function recoverGoals(){
 for(const r of goals()){
  if(['planning','running','reviewing','repairing'].includes(r.status)){
   // A tool may have succeeded before the process died. Never replay it blindly.
   saveEvent(r.id,'workflow.interrupted',{status:'needs_review',reason:'Process stopped during execution; inspect external effects before resuming',
    steps:r.steps.map(s=>s.status==='running'?{...s,status:'interrupted'}:s)},{previous:r.status});
  }
 }
}
