// Model routing is part of DOMINION, not a third-party agent runtime.
// Explicit selection > configured agent > an actually responding provider.
import {all} from './store.mjs';
import {availableModels} from './providers.mjs';
export async function resolveModel({agentId='',providerId='',model=''}={}){
 const enabled=all('provider').filter(x=>x.enabled),allowed=new Set(enabled.map(x=>x.id));
 if(providerId&&model){
  if(!allowed.has(providerId))throw Error('Provider disabled or unavailable: '+providerId);
  return {agentId:agentId||'general',providerId,model,source:'explicit'};
 }
 const agents=all('agent'),agent=agents.find(x=>x.id===agentId);
 if(!providerId&&agent?.providerId&&agent?.model&&allowed.has(agent.providerId))
  return {agentId:agent.id,providerId:agent.providerId,model:agent.model,source:'agent'};
 const configured=agents.find(x=>x.providerId&&x.model&&allowed.has(x.providerId));
 if(!providerId&&configured)return {agentId:configured.id,providerId:configured.providerId,model:configured.model,source:'configured'};
 const rank=x=>x.id==='dominion-native'?0:x.id==='lmstudio'?1:x.id==='ollama'?2:x.local?3:4;
 const candidates=[...enabled].sort((a,b)=>(a.id===providerId?-1:rank(a))-(b.id===providerId?-1:rank(b)));
 const checked=await Promise.allSettled(candidates.map(async provider=>({provider,models:await availableModels(provider.id)})));
 for(let i=0;i<candidates.length;i++){
  const result=checked[i];if(result.status!=='fulfilled'||!result.value.models.length)continue;
  const candidate=result.value.models.find(x=>x.id===model)||result.value.models[0];
  return {agentId:agentId||'general',providerId:candidates[i].id,model:candidate.id,source:'discovered'};
 }
 throw Error('No active AI model found. Load a local model or configure an API provider.');
}
