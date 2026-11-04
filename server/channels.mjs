import {all,put,get,remove,log,bus,claimInbound,finishInbound} from './store.mjs';
import {secretSet,secretGet,hasSecret} from './vault.mjs';
import {newSession,runTurn} from './engine.mjs';
import {runIntent} from './native-intent.mjs';
import {roomCommand,runRoomIngress,stopRoomFlow,resetRoomFlow} from './room-orchestrator.mjs';
import {channelCatalog,channelDefinition,validateChannelConfiguration} from './channel-catalog.mjs';

import {channelDriver,registryErrors} from './channel-registry.mjs';
import {parseSlash,channelCommand} from './commands.mjs';
const workers=new Map();
const statuses=new Map();
const queues=new Map();
function safeError(error){return String(error?.message||error||'').replace(/(bot\d+:)[A-Za-z0-9_-]+/g,'$1[REDACTED]').slice(0,320);}
function emitStatus(id,status,error=''){
 const value={id,status,error:error?safeError(error):'',at:new Date().toISOString()};
 statuses.set(id,value);
 // Persist only a real successful connection: this is the evidence used to call a driver "verified".
 if(status==='connected'){put('channel_health',{id,lastConnectedAt:value.at,kind:get('channel',id)?.kind||''});
  const kind=get('channel',id)?.kind;
  if(kind)put('driver_health',{id:kind,lastConnectedAt:value.at,channelId:id});}
 bus.emit('channel_status',value);
 if(status==='error')log('channel.runtime_error',{id,error:value.error});
 return value;
}
export const catalog=()=>channelCatalog().map(entry=>({...entry,verifiedAt:get('driver_health',entry.id)?.lastConnectedAt||''}));
function secretKey(id,key){return 'channel:'+id+':'+key;}
export function credentialValues(record){
 const entry=channelDefinition(record.kind);
 const obj={};
 if(!entry)return obj;
 for(const f of entry.fields.filter(f=>f.type==='secret'))obj[f.key]=secretGet(secretKey(record.id,f.key))||(f.key==='token'?secretGet('channel:'+record.id):'');
 return obj;
}
export function channels(){
 return all('channel').map(record=>{
  const entry=channelDefinition(record.kind);
  const credentials=credentialValues(record);
  const required=entry?.fields?.filter(f=>f.required)||[];
  const missing=required.filter(f=>!(f.type==='secret'?credentials[f.key]:record[f.key])).map(f=>f.label);
  const health=get('channel_health',record.id)||null;
  return {...record,lastConnectedAt:health?.lastConnectedAt||'',credentialsPresent:Object.fromEntries((entry?.fields||[]).filter(f=>f.type==='secret').map(f=>[f.key,Boolean(credentials[f.key])])),hasToken:Boolean(credentials.token),configured:!missing.length,missing,status:statuses.get(record.id)?.status||(record.enabled?'not_started':'disabled'),runtimeError:statuses.get(record.id)?.error||'',driverAvailable:Boolean(entry?.available),webhookPath:entry?.mode==='webhook'?'/api/webhooks/'+record.id:null};
 });
}
export function channelById(id){return channels().find(x=>x.id===id)||null;}
export async function saveChannel(input){
 const entry=channelDefinition(input.kind);
 if(!entry)throw Error('Unknown channel type');
 if(!entry.available)throw Error('This channel has a catalog entry but no runtime driver yet');
 const id=input.id||crypto.randomUUID();
 const previous=get('channel',id);
 if(previous&&previous.kind!==entry.id)throw Error('To change the channel type, create a separate connection');
 const record={id,kind:entry.id,name:String(input.name||entry.name).slice(0,120),enabled:Boolean(input.enabled),roomId:String(input.roomId||''),roomPolicy:['all_or_named','named_only','round_robin'].includes(input.roomPolicy)?input.roomPolicy:'all_or_named',agentId:String(input.agentId||'general'),providerId:String(input.providerId||''),model:String(input.model||''),mentionOnly:input.mentionOnly!==false};
 for(const f of entry.fields.filter(f=>f.type!=='secret'))record[f.key]=input[f.key]===undefined?(previous?.[f.key]||''):String(input[f.key]||'').trim();
 const credentials=credentialValues(record);
 for(const f of entry.fields.filter(f=>f.type==='secret')){
  const changed=input[f.key];
  // An empty field means "keep existing", not erase it.
  if(typeof changed==='string'&&changed.trim())credentials[f.key]=changed.trim();
 }
 if(record.roomId&&!get('room',record.roomId))throw Error('Selected room does not exist');
 if(record.enabled)validateChannelConfiguration(entry.id,record,credentials);
 await stopChannel(id);
 put('channel',record);
 for(const f of entry.fields.filter(f=>f.type==='secret')){
  if(credentials[f.key])secretSet(secretKey(id,f.key),credentials[f.key]);
 }
 // Clear legacy token only once it has been migrated.
 if(secretGet('channel:'+id)&&credentials.token)secretSet('channel:'+id,'');
 log('channel.saved',{id,kind:entry.id,enabled:record.enabled});
 if(record.enabled)startChannel(id);
 else emitStatus(id,'disabled');
 return channelById(id);
}
export async function stopChannel(id){
 const worker=workers.get(id);workers.delete(id);
 if(worker){try{await worker.stop();}catch(error){log('channel.stop_error',{id,error:safeError(error)});}}
 emitStatus(id,'stopped');
 return true;
}
export async function deleteChannel(id){
 const record=get('channel',id);
 if(!record)return false;
 await stopChannel(id);
 for(const f of channelDefinition(record.kind)?.fields||[])if(f.type==='secret')secretSet(secretKey(id,f.key),'');
 secretSet('channel:'+id,'');
 remove('channel',id);
 remove('channel_cursor',id);
 statuses.delete(id);
 log('channel.deleted',{id,kind:record.kind});
 return true;
}
async function dispatch(record,event){
 if(!event?.text?.trim()||!event.conversationId)return true;
 const command=record.roomId?roomCommand(event.text):null;
 if(command){
  const eventKey=event.messageId?record.id+':'+event.conversationId+':'+event.messageId:null;
  if(eventKey&&!claimInbound(eventKey))return true;
  try{
   if(command==='stop'){
    const stopped=stopRoomFlow(record.id,event.conversationId);
    await event.reply(stopped?'진행 중인 회의실 응답을 중단했습니다.':'진행 중인 회의실 응답이 없습니다.');
   }else{
    const state=resetRoomFlow(record.id,event.conversationId);
    await event.reply('새 대화로 시작합니다. 이전 기록은 유지합니다. (세대 '+state.generation+')');
   }
   if(eventKey)finishInbound(eventKey,true);
  }catch(e){if(eventKey)finishInbound(eventKey,false);log('channel.command_error',{channelId:record.id,error:safeError(e)});return false;}
  return true;
 }
 const parsed=parseSlash(event.text);
 if(parsed){
  const eventKey=event.messageId?record.id+':'+event.conversationId+':'+event.messageId:null;
  if(eventKey&&!claimInbound(eventKey))return true;
  try{
   const response=await channelCommand(record,event);
   if(response!==null)await event.reply(response);
   if(eventKey)finishInbound(eventKey,true);
   return true;
  }catch(error){
   if(eventKey)finishInbound(eventKey,false);
   log('channel.command_error',{channelId:record.id,error:safeError(error)});
   return false;
  }
 }
 if(record.mentionOnly&&event.isGroup&&!event.mention)return true;
 const key=record.id+':'+event.conversationId;
 const run=async()=>{
  const current=get('channel',record.id);
  if(!current?.enabled)return true;
  const inboundId=event.messageId?record.id+':'+event.conversationId+':'+event.messageId:null;
  if(inboundId&&!claimInbound(inboundId)){log('channel.duplicate_skipped',{channelId:record.id});return true;}
  try{
   log('channel.received',{channelId:record.id,kind:record.kind,conversationId:event.conversationId,roomId:record.roomId||null});
   if(record.roomId){
    await runRoomIngress({record,event});
   }else{
    let session=all('session').find(s=>s.channelKey===key);
    if(!session){
     const s=newSession({title:record.name+' · '+event.conversationId,agentId:record.agentId,providerId:record.providerId,model:record.model});
     session=put('session',{...s,channelKey:key});
    }
    const assistant=await runIntent({sessionId:session.id,agentId:session.agentId||record.agentId,providerId:session.providerId||record.providerId,model:session.model||record.model,input:event.text});
    const output=assistant.content?.trim();
    if(output){await event.reply(output);log('channel.replied',{channelId:record.id,kind:record.kind,conversationId:event.conversationId});}
   }
   if(inboundId)finishInbound(inboundId,true);
   return true;
  }catch(error){if(inboundId)finishInbound(inboundId,false);log('channel.dispatch_error',{channelId:record.id,kind:record.kind,error:safeError(error)});return false;}
 };
 const prev=queues.get(key)||Promise.resolve();
 const next=prev.catch(()=>{}).then(run);
 queues.set(key,next);
 try{return await next;}finally{if(queues.get(key)===next)queues.delete(key);}
}
export function startChannel(id){
 const record=get('channel',id);if(!record?.enabled)return;
 const driver=channelDriver(record.kind);if(!driver){emitStatus(id,'unavailable');return;}
 const credentials=credentialValues(record);
 try{
  validateChannelConfiguration(record.kind,record,credentials);
  emitStatus(id,'starting');
  const worker=driver.start({record,credentials,onMessage:event=>dispatch(record,event),onStatus:(state,error)=>emitStatus(id,state,error)});
  workers.set(id,worker);
  log('channel.started',{id,kind:record.kind});
 }catch(error){emitStatus(id,'error',error);}
}
export function startChannels(){for(const record of all('channel').filter(x=>x.enabled))startChannel(record.id);}
export async function handleChannelWebhook(req,res,u){
 const match=u.pathname.match(/^\/api\/webhooks\/([a-f0-9-]{20,50})$/);
 if(!match)return false;
 const record=get('channel',match[1]);
 if(!record?.enabled||channelDefinition(record.kind)?.mode!=='webhook'){res.writeHead(404);res.end();return true;}
 const driver=channelDriver(record.kind),credentials=credentialValues(record);
 if(req.method==='GET'&&typeof driver?.verifyChallenge==='function'){
  const challenge=driver.verifyChallenge(u.searchParams,credentials);
  if(challenge===null){res.writeHead(403);res.end();return true;}
  res.writeHead(200,{'Content-Type':'text/plain'});res.end(challenge);return true;
 }
 if(req.method!=='POST'){res.writeHead(405);res.end();return true;}
 let bytes=0;const chunks=[];
 for await(const chunk of req){bytes+=chunk.length;if(bytes>1048576){res.writeHead(413);res.end();return true;}chunks.push(chunk);}
 const raw=Buffer.concat(chunks);
 if(typeof driver.verifySignature!=='function'||!driver.verifySignature(req.headers,raw,credentials)){res.writeHead(401);res.end();return true;}
 let payload;try{payload=JSON.parse(raw.toString('utf8'));}catch{res.writeHead(400);res.end();return true;}
 const tasks=driver.inboundEvents(payload,{record,credentials,onMessage:event=>dispatch(record,event)});
 res.writeHead(200,{'Content-Type':'text/plain'});res.end('ok');
 void Promise.allSettled(tasks).then(results=>{
  results.forEach(x=>{if(x.status==='rejected')log('channel.webhook_dispatch_error',{id:record.id,error:safeError(x.reason)});});
 });
 return true;
}
export async function diagnoseChannel(id){
 const record=get('channel',id);if(!record)throw Error('Channel not found');
 const credentials=credentialValues(record);
 validateChannelConfiguration(record.kind,record,credentials);
 const driver=channelDriver(record.kind);
 if(typeof driver?.diagnose!=='function')return {id,kind:record.kind,verified:false,status:statuses.get(id)?.status||'not_started',message:'No diagnostic probe provided by the channel plugin'};
 const probe=await driver.diagnose(record,credentials);
 log('channel.diagnosed',{id,kind:record.kind,verified:Boolean(probe.verified),httpStatus:probe.httpStatus||null});
 return {id,kind:record.kind,status:statuses.get(id)?.status||'not_started',...probe};
}
