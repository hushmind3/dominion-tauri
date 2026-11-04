// DOMINION Room Runtime. Transport sees messages; room runtime owns context and turns.
import {get,put,writeMessage,log,bus} from './store.mjs';
import {newSession,runTurn} from './engine.mjs';
const active=new Map();
const keyFor=(channelId,conversationId)=>'channel:'+channelId+':'+conversationId;
const escapeRx=s=>s.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&');
function named(text,name){
 if(!name)return false;
 const pattern=new RegExp('(^|[\\s@\\[\\](){}:;,.!?，。！?])'+escapeRx(String(name).trim())+'(?=$|[\\s@\\[\\](){}:;,.!?，。！?])','iu');
 return pattern.test(text);
}
export function decideSpeakers(room,text,mode='all_or_named',records=[]){
 const people=(room.agentIds||[]).map(id=>records.find(a=>a.id===id)).filter(Boolean);
 if(!people.length)return [];
 if(mode==='round_robin')return [people[0]];
 const selected=people.filter(a=>[a.name,...(Array.isArray(a.aliases)?a.aliases:[])].some(s=>named(text,s)));
 if(selected.length)return selected;
 return mode==='named_only'?[]:people;
}
export function roomCommand(text){
 const value=String(text||'').trim();
 if(/^\/(?:stop|cancel)(?:@[a-zA-Z0-9_]+)?$/iu.test(value))return 'stop';
 if(/^\/(?:reset|new)(?:@[a-zA-Z0-9_]+)?$/iu.test(value))return 'reset';
 return null;
}
export function activeRoomStatus(channelId,conversationId){
 const key=keyFor(channelId,conversationId),running=active.get(key),binding=get('room_binding',key);
 return {active:Boolean(running),generation:binding?.generation||0,sessionId:binding?.sessionId||null,roomId:binding?.roomId||null};
}
export function stopRoomFlow(channelId,conversationId){
 const key=keyFor(channelId,conversationId),previous=active.get(key);
 if(previous){previous.controller.abort(new Error('Room turn stopped by user'));active.delete(key);}
 log('room.stop',{channelId,conversationId,stopped:Boolean(previous)});
 return Boolean(previous);
}
export function resetRoomFlow(channelId,conversationId){
 const key=keyFor(channelId,conversationId);
 stopRoomFlow(channelId,conversationId);
 const before=get('room_binding',key);
 const current=put('room_binding',{id:key,roomId:before?.roomId||null,sessionId:null,generation:(before?.generation||0)+1,turnIndex:0});
 log('room.reset',{channelId,conversationId,generation:current.generation});
 return {generation:current.generation};
}
function ensureSession(record,event,room){
 const key=keyFor(record.id,event.conversationId);
 let binding=get('room_binding',key);
 if(!binding||binding.roomId!==room.id||!binding.sessionId){
  const s=newSession({title:room.name+' · '+record.name+' · '+event.conversationId,agentId:room.agentIds[0],roomId:room.id});
  binding=put('room_binding',{id:key,roomId:room.id,sessionId:s.id,generation:binding?.generation||0,turnIndex:binding?.turnIndex||0});
 }
 return binding;
}
export async function runRoomIngress({record,event,onEvent=()=>{}}){
 const room=get('room',record.roomId);
 if(!room)throw Error('Configured room does not exist');
 if(!(room.agentIds||[]).length)throw Error('Room has no participants');
 const binding=ensureSession(record,event,room),key=keyFor(record.id,event.conversationId);
 if(active.has(key))throw Error('Room conversation already executing');
 const controller=new AbortController(),task={controller,generation:binding.generation,sessionId:binding.sessionId};
 active.set(key,task);
 const people=(room.agentIds||[]).map(id=>get('agent',id)).filter(Boolean);
 const policy=record.roomPolicy||'all_or_named';
 let selected=decideSpeakers(room,event.text,policy,people);
 if(policy==='round_robin'&&people.length)selected=[people[(binding.turnIndex||0)%people.length]];
 if(!selected.length){
  active.delete(key);
  await event.reply('해당 이름으로 등록된 참여자가 없습니다.');
  return {sessionId:binding.sessionId,count:0};
 }
 const rounds=Math.max(1,Math.min(4,Number(room.rounds)||1));
 const limit=Math.max(1,Math.min(60,Number(room.maxTurns)||12));
 const steps=Array.from({length:rounds},()=>selected).flat().slice(0,limit),outputs=[];
 try{
  writeMessage({session_id:binding.sessionId,role:'user',content:event.text});
  bus.emit('room_event',{type:'started',roomId:room.id,channelId:record.id,conversationId:event.conversationId,sessionId:binding.sessionId,steps:steps.length});
  for(let i=0;i<steps.length;i++){
   if(controller.signal.aborted||get('room_binding',key)?.generation!==task.generation)break;
   const agent=steps[i];
   onEvent({type:'speaker',name:agent.name,agentId:agent.id,round:Math.floor(i/selected.length)+1});
   bus.emit('room_event',{type:'speaker',roomId:room.id,channelId:record.id,agentId:agent.id,step:i+1,total:steps.length});
   try{
    // User input is persisted once; each model sees prior speakers with labels.
    const message=await runTurn({
     sessionId:binding.sessionId,agentId:agent.id,
     providerId:agent.providerId||record.providerId,model:agent.model||record.model,
     speakerLabels:true,signal:controller.signal,onEvent
    });
    if(controller.signal.aborted)break;
    const answer=message.content?.trim();
    if(answer){
     const line=agent.name+': '+answer;
     outputs.push({agentId:agent.id,name:agent.name,content:answer});
     if(record.kind!=='line')await event.reply(line);
    }
   }catch(error){
    if(controller.signal.aborted)break;
    log('room.turn_failed',{roomId:room.id,agentId:agent.id,error:String(error?.message||error).slice(0,180)});
    bus.emit('room_event',{type:'failed',roomId:room.id,agentId:agent.id});
   }
  }
  if(record.kind==='line'&&outputs.length&&!controller.signal.aborted){
   await event.reply(outputs.map(o=>o.name+': '+o.content).join('\n\n').slice(0,4800));
  }
  if(!controller.signal.aborted&&get('room_binding',key)?.generation===task.generation){
   put('room_binding',{...get('room_binding',key),turnIndex:(binding.turnIndex||0)+1});
  }
  log('room.ingress_completed',{roomId:room.id,channelId:record.id,sessionId:binding.sessionId,turns:outputs.length,aborted:controller.signal.aborted});
  bus.emit('room_event',{type:'complete',roomId:room.id,channelId:record.id,count:outputs.length});
  return {sessionId:binding.sessionId,count:outputs.length,aborted:controller.signal.aborted};
 }finally{if(active.get(key)===task)active.delete(key);}
}
