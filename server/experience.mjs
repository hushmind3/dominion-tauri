import {createHash} from 'node:crypto';
import {all,get,put} from './store.mjs';

// Durable execution feedback. Model prose alone is never a verified result.
const clean=(value,limit=420)=>String(value??'')
 .replace(/(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+\S+|AIza[A-Za-z0-9_-]{20,})/g,'[REDACTED]')
 .replace(/\s+/g,' ').trim().slice(0,limit);
const words=value=>[...new Set(clean(value,1000).toLowerCase().match(/[가-힣a-z0-9_]{2,}/g)||[])];
const relevance=(query,entry)=>{
 const q=words(query),seen=new Set(words(entry.task+' '+entry.reason+' '+entry.strategy));
 return q.length?q.reduce((n,w)=>n+(seen.has(w)?1:0),0)/Math.sqrt(q.length):0;
};
export function recordExperience({task,source='runtime',status,reason='',strategy='',evidence=[],agentId='',verified=false}={}){
 const title=clean(task,500);
 if(!title||!['completed','failed','needs_review','budget_exceeded'].includes(status))return null;
 const observed=(Array.isArray(evidence)?evidence:[]).filter(x=>x&&x.name).slice(0,16)
  .map(x=>({name:clean(x.name,100),status:x.status==='failed'?'failed':'completed'}));
 if(!observed.length&&!reason&&!verified)return null;
 const row={task:title,source:clean(source,30),status,reason:clean(reason,500),
  strategy:clean(strategy,400),evidence:observed,agentId:clean(agentId,120),verified:verified===true};
 const signature=[row.task,row.source,row.status,row.reason,row.strategy,
  row.evidence.map(e=>e.name+':'+e.status).join('|')].join('|');
 const id='experience:'+createHash('sha256').update(signature).digest('hex').slice(0,32);
 const previous=get('experience',id);
 return put('experience',{...row,id,occurrences:(previous?.occurrences||0)+1,
  createdAt:previous?.createdAt||new Date().toISOString(),lastSeenAt:new Date().toISOString()});
}
export function relevantExperiences(task,{limit=4,agentId=''}={}){
 return all('experience')
  .filter(x=>!x.agentId||!agentId||x.agentId===agentId)
  .map(x=>({...x,score:relevance(task,x)})).filter(x=>x.score>0)
  .sort((a,b)=>b.score-a.score||Number(b.verified)-Number(a.verified))
  .slice(0,Math.max(0,Math.min(8,limit)));
}
// Strategy-level scoring: count how each approach actually ended, not just recall it.
const normalizeStrategy=value=>clean(value,220).toLowerCase().replace(/\s+/g,' ').trim();
export function strategyStats(){
 const map=new Map();
 for(const row of all('experience')){
  const key=normalizeStrategy(row.strategy||'');
  if(!key)continue;
  const entry=map.get(key)||{strategy:String(row.strategy||'').slice(0,220),attempts:0,successes:0,failures:0,reviewed:0,lastSeenAt:''};
  entry.attempts+=1;
  if(row.status==='completed'){entry.successes+=1;if(row.verified)entry.reviewed+=1;}
  else entry.failures+=1;
  if(!entry.lastSeenAt||String(row.lastSeenAt||'')>entry.lastSeenAt)entry.lastSeenAt=String(row.lastSeenAt||'');
  map.set(key,entry);
 }
 return [...map.values()]
  .map(x=>({...x,successRate:x.attempts?Number((x.successes/x.attempts).toFixed(3)):0}))
  .sort((a,b)=>b.successRate-a.successRate||b.attempts-a.attempts);
}
// Strategies that repeatedly work are promoted; repeatedly failing ones are retired.
export function strategyGuidance({minAttempts=2}={}){
 const stats=strategyStats().filter(x=>x.attempts>=minAttempts);
 return {
  preferred:stats.filter(x=>x.successRate>=0.6).slice(0,3),
  retired:stats.filter(x=>x.successRate<0.4).slice(0,3),
  measured:stats.length,
 };
}
export function experienceHints(task,{agentId='',limit=4}={}){
 const evidence=relevantExperiences(task,{agentId,limit}).map(x=>
  '- Task: '+x.task+'; outcome: '+x.status+'; independently reviewed: '+x.verified+
  (x.reason?'; feedback: '+x.reason:'')+
  (x.strategy?'; approach: '+x.strategy:'')+
  (x.evidence.length?'; tool evidence: '+x.evidence.map(t=>t.name+' ('+t.status+')').join(', '):'')
 ).join('\n');
 const guidance=strategyGuidance();
 const lines=[];
 if(guidance.preferred.length)lines.push('Proven approaches (keep using):\n'+guidance.preferred.map(x=>
  '- '+x.strategy+' — '+Math.round(x.successRate*100)+'% success over '+x.attempts+' runs').join('\n'));
 if(guidance.retired.length)lines.push('Retired approaches (do not repeat without a new reason):\n'+guidance.retired.map(x=>
  '- '+x.strategy+' — failed '+x.failures+' of '+x.attempts+' runs').join('\n'));
 return [evidence,lines.join('\n')].filter(Boolean).join('\n\n').slice(0,2400);
}
