import {all,get,put,log} from './store.mjs';
import {runTurn,newSession} from './engine.mjs';
export const workflows=()=>all('workflow');
export function saveWorkflow(data){
 if(!data||typeof data!=='object')throw Error('Workflow definition required');
 const name=String(data.name||'').trim();if(!name||name.length>120)throw Error('Workflow name required (max 120)');
 const steps=data.steps;if(!Array.isArray(steps)||steps.length<1||steps.length>30)throw Error('Workflow must contain 1 to 30 steps');
 const clean=steps.map((s,i)=>{
  const prompt=String(s.prompt||'').trim();
  if(!prompt||prompt.length>12000)throw Error('Workflow step '+(i+1)+' has an invalid prompt');
  return {id:String(s.id||crypto.randomUUID()),name:String(s.name||'Step '+(i+1)).slice(0,90),prompt,agentId:String(s.agentId||'general'),providerId:String(s.providerId||''),model:String(s.model||'')};
 });
 const current=data.id?get('workflow',data.id):null;
 return put('workflow',{id:data.id||crypto.randomUUID(),name,description:String(data.description||'').slice(0,500),steps:clean,createdAt:current?.createdAt||new Date().toISOString()});
}
export async function runWorkflow(job,emit){
 const workflow=get('workflow',job.input?.workflowId);
 if(!workflow)throw Error('Workflow not found');
 const payload=String(job.input?.input||'').slice(0,16000);
 const existing=job.workflowState||{};
 const outputs=Array.isArray(existing.outputs)?existing.outputs:[];
 const sessionId=existing.sessionId||newSession({title:'Workflow · '+workflow.name,agentId:workflow.steps[0]?.agentId}).id;
 for(let i=outputs.length;i<workflow.steps.length;i++){
  const step=workflow.steps[i];
  emit({type:'workflow_step_start',stepIndex:i,stepName:step.name});
  const last=outputs[outputs.length-1]?.content||'';
  const prompt=step.prompt.replaceAll('{{input}}',payload).replaceAll('{{previous}}',last);
  const message=await runTurn({sessionId,agentId:step.agentId,providerId:step.providerId,model:step.model,input:prompt,onEvent:emit});
  outputs.push({stepId:step.id,name:step.name,content:message.content,messageId:message.id});
  put('job',{...get('job',job.id),workflowState:{sessionId,outputs},stepIndex:i+1,stepTotal:workflow.steps.length});
  emit({type:'workflow_step_done',stepIndex:i,stepName:step.name});
 }
 log('workflow.completed',{workflowId:workflow.id,sessionId,steps:outputs.length});
 return {workflowId:workflow.id,sessionId,outputs};
}
