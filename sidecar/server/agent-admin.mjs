// Independent agent roster management. This does not assume a fixed team size.
import {all,get,put,log,db} from './store.mjs';
export function updateAgentModels({agentIds,providerId,model}={}){
 if(!Array.isArray(agentIds)||!agentIds.length||agentIds.length>500)throw Error('Select 1 to 500 agents');
 const ids=[...new Set(agentIds.map(String))];
 if(!providerId||!get('provider',String(providerId)))throw Error('Select an installed model provider');
 if(typeof model!=='string'||!model.trim()||model.length>250)throw Error('Select a model ID');
 const originals=ids.map(id=>{
  const agent=get('agent',id);
  if(!agent)throw Error('Agent not found: '+id);
  return agent;
 });
 const updated=[];
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const agent of originals)updated.push(put('agent',{...agent,providerId:String(providerId),model:model.trim()}));
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 log('agent.models_updated',{count:updated.length,agentIds:ids,providerId:String(providerId),model:model.trim()});
 return {count:updated.length,agents:updated.map(a=>({id:a.id,name:a.name,providerId:a.providerId,model:a.model}))};
}
export function normalizeAgentAliases(input){
 if(input==null)return [];
 if(!Array.isArray(input)||input.length>16)throw Error('Aliases must be a list of up to 16 names');
 const aliases=[...new Set(input.map(v=>String(v||'').trim()).filter(Boolean))];
 if(aliases.some(x=>x.length>60))throw Error('Alias too long');
 return aliases;
}
