import {all,get,put} from './store.mjs';

// Query-aware durable memory retrieval; no opaque recency-only prompt stuffing.
// Lexical + Hangul character n-gram ranking works offline and without API keys.
// It is intentionally not presented as semantic/vector embedding search.
const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const stop=new Set(['나는','내가','나의','저는','제가','대해','알려줘','알려주세요','뭐야','무엇','어떤','그거','있어','있는','하기','사용자','user','this','that','with','what','does','about','please']);
const aliases=[
 ['gpu','그래픽카드','그래픽 카드','vram','비디오메모리','그래픽메모리'],
 ['ram','램','메모리'],
 ['memory','기억','메모리'],
 ['ui','화면','인터페이스'],
 ['github','깃허브'],
 ['model','모델'],
 ['tool','도구']
];
export function memoryFeatures(value){
 const s=normalize(value),out=new Set();
 for(const token of (s.match(/[\p{L}\p{N}_]+/gu)||[])){
  if(stop.has(token)||token.length<2)continue;
  out.add('w:'+token);
  if(/[가-힣]/u.test(token)){
   for(let width=2;width<=3;width++)for(let i=0;i<=token.length-width;i++)
    out.add('k:'+token.slice(i,i+width));
  }
 }
 for(const group of aliases){
  if(group.some(x=>s.includes(x)))for(const word of group)out.add('a:'+group[0]);
 }
 return out;
}
const significant=value=>new Set((normalize(value).match(/[\p{L}\p{N}_]+/gu)||[]).filter(x=>x.length>1&&!stop.has(x)));
const numbers=value=>(normalize(value).match(/\d+(?:\.\d+)?/g)||[]).join(',');
const oppositeGroups=[['다크','라이트'],['켜기','끄기'],['활성화','비활성화'],['enabled','disabled'],['true','false'],['허용','금지']];
function contradictory(a,b){
 const x=normalize(a),y=normalize(b);
 const ax=numbers(a),by=numbers(b);
 const differentNumbers=ax&&by&&ax!==by;
 const opposite=oppositeGroups.some(([left,right])=>(x.includes(left)&&y.includes(right))||(x.includes(right)&&y.includes(left)));
 if(!differentNumbers&&!opposite)return false;
 const omitNumbers=s=>s.replace(/\d+(?:\.\d+)?/g,'').trim();
 const aa=memoryFeatures(omitNumbers(a)),bb=memoryFeatures(omitNumbers(b));
 const common=[...aa].filter(t=>bb.has(t)).length;
 return common>=3 && common/Math.max(1,Math.min(aa.size,bb.size))>=0.48;
}
export function persistMemory({text,scope='shared',source='manual',sessionId='',status='active',type='',importance=0}={}){
 const value=String(text??'').replace(/\s+/g,' ').trim().slice(0,1000);
 if(value.length<8||/\[REDACTED\]/.test(value))return {record:null,action:'skipped'};
 const ownScope=String(scope||'shared'),records=all('memory').filter(x=>(x.scope||'shared')===ownScope&&x.status!=='superseded');
 const duplicate=records.find(x=>normalize(x.text)===normalize(value));
 if(duplicate){
  const updated=put('memory',{...duplicate,seenCount:(duplicate.seenCount||1)+1,lastObservedAt:new Date().toISOString()});
  return {record:updated,action:'duplicate'};
 }
 const conflicts=records.filter(x=>x.status!=='needs_review'&&contradictory(x.text,value));
 if(conflicts.length){
  // Conflicting facts stay visible, but neither is silently fed into prompts.
  for(const old of conflicts)put('memory',{...old,status:'needs_review',reason:'Contradictory new memory candidate'});
 }
 const row=put('memory',{text:value,scope:ownScope,source,sessionId,type:String(type||''),importance:Number(importance)||0,status:conflicts.length?'needs_review':status,
  reason:conflicts.length?'Conflicts with prior memory: '+conflicts.map(x=>x.id).join(', '):'',
  seenCount:1,createdAt:new Date().toISOString()});
 return {record:row,action:conflicts.length?'conflict':'created'};
}
export function retrieveMemories(query,{agentId='',limit=8}={}){
 const rows=all('memory').filter(x=>(!x.status||x.status==='active')&&(!x.scope||x.scope==='shared'||x.scope===agentId));
 const queryFeatures=memoryFeatures(query);
 if(!queryFeatures.size)return [];
 const documents=rows.map(row=>({...row,_features:memoryFeatures(row.text)}));
 const frequencies=new Map();
 for(const doc of documents)for(const f of doc._features)frequencies.set(f,(frequencies.get(f)||0)+1);
 const N=documents.length;
 return documents.map(doc=>{
  let score=0,matches=0;
  for(const f of queryFeatures){
   if(!doc._features.has(f))continue;
   matches++;
   const idf=Math.log(1+(N-(frequencies.get(f)||0)+0.5)/((frequencies.get(f)||0)+0.5));
   score+=(f.startsWith('w:')?2.2:f.startsWith('a:')?1.5:0.4)*Math.max(0.1,idf);
  }
  return {...doc,score:score/Math.sqrt(queryFeatures.size),matches};
 }).filter(x=>x.matches>0&&x.score>0.04)
  .sort((a,b)=>b.score-a.score||String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))
  .slice(0,Math.max(0,Math.min(limit,20)))
  .map(({_features,...row})=>row);
}
const typeLabel={fact:'사실',preference:'선호',decision:'결정',procedure:'절차'};
export function memoryContext(query,{agentId='',limit=8}={}){
 return retrieveMemories(query,{agentId,limit})
  .map(x=>'- '+String(x.text).slice(0,900)+(x.type&&typeLabel[x.type]?' ('+typeLabel[x.type]+')':'')).join('\n').slice(0,4500);
}
