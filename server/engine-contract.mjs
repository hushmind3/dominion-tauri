// Machine-checkable invariants for DOMINION task runs.
// Event history is append-only: completion must never replace evidence.
const terminal=new Set(['completed','failed','needs_review','budget_exceeded','cancelled']);
export function verifyRunTrace(run,events){
 const errors=[],trace=events.map(e=>e.type),last=trace.at(-1)||'';
 if(!trace.length||trace[0]!=='workflow.queued')errors.push('missing initial workflow.queued');
 if(run.status==='completed'){
  if(last!=='workflow.completed')errors.push('completed run must end in workflow.completed');
  if(!run.steps?.length||run.steps.some(x=>x.status!=='completed'))errors.push('completed run has incomplete steps');
 }
 if(run.status==='needs_review'&&last!=='workflow.needs_review'&&last!=='workflow.interrupted')
  errors.push('review-needed run has no corresponding terminal event');
 if(run.status==='cancelled'&&!trace.includes('workflow.cancelled'))errors.push('cancelled run has no cancellation event');
 if(run.status==='budget_exceeded'&&!trace.includes('budget.exceeded'))errors.push('budget cap absent from event trace');
 if(terminal.has(run.status)&&trace.includes('workflow.completed')&&run.status!=='completed')
  errors.push('non-complete run claims completion');
 const begun=new Map();
 for(const event of events){
  const stepId=event.data?.stepId;
  if(event.type==='step.started'&&stepId)begun.set(stepId,(begun.get(stepId)||0)+1);
  if(['step.completed','step.failed'].includes(event.type)&&stepId&&!begun.get(stepId))
   errors.push('step finished without a start: '+stepId);
  if(event.type==='tool.executed'&&!stepId)errors.push('tool evidence missing step ID');
 }
 for(const step of run.steps||[]){
  if(step.status==='completed'&&step.requiresTools&&!(step.evidence||[]).some(x=>x.name))
   errors.push('tool-required step lacks evidence: '+step.id);
  if(step.status==='completed'&&!(step.reviewMode||'').trim())
   errors.push('completed step has no review mode: '+step.id);
 }
 return {ok:errors.length===0,errors,runId:run.id,status:run.status,events:events.length};
}
