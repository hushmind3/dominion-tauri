import {get,put} from '../store.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));

// Zulip: REST API + event queue long polling. No SDK required.
export function start({record,credentials,onMessage,onStatus}){
 const site=String(record.site||'').replace(/\/+$/,'');
 const email=String(record.email||'').trim();
 const key=credentials.apiKey;
 const auth='Basic '+Buffer.from(email+':'+key).toString('base64');
 let active=true,queueId=get('channel_cursor',record.id)?.queueId||'',lastEventId=get('channel_cursor',record.id)?.lastEventId||-1;
 const abort=new AbortController();
 async function api(path,options={}){
  const response=await fetch(site+'/api/v1'+path,{...options,headers:{Authorization:auth,'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(40000)])});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.result==='error')throw Error('Zulip: '+(data.msg||response.status));
  return data;
 }
 async function register(){
  const data=await api('/register',{method:'POST',body:JSON.stringify({event_types:['message'],apply_markdown:false})});
  queueId=data.queue_id||'';lastEventId=data.last_event_id??-1;
  if(queueId)put('channel_cursor',{id:record.id,queueId,lastEventId});
 }
 async function send(content,target){
  if(target.type==='stream')await api('/messages',{method:'POST',body:JSON.stringify({type:'stream',to:String(target.stream),topic:String(target.topic||'general'),content:String(content).slice(0,9000)})});
  else await api('/messages',{method:'POST',body:JSON.stringify({type:'direct',to:[String(target.email)],content:String(content).slice(0,9000)})});
 }
 (async()=>{
  while(active){
   try{
    if(!queueId){await register();onStatus('connected');}
    let params='?queue_id='+encodeURIComponent(queueId)+'&last_event_id='+encodeURIComponent(lastEventId)+'&dont_block=false';
    const data=await api('/events'+params);
    lastEventId=data.last_event_id??lastEventId;
    put('channel_cursor',{id:record.id,queueId,lastEventId});
    for(const event of data.events||[]){
     if(event.type==='heartbeat')continue;
     if(event.type!=='message')continue;
     const m=event.message||{};
     if(!m.content||m.sender_email===email)continue;
     const isStream=m.type==='stream';
     const target=isStream?{type:'stream',stream:m.display_recipient,topic:m.subject}:{type:'direct',email:m.sender_email};
     const conversationId=isStream?String(m.display_recipient)+'/'+String(m.subject||''):String(m.sender_email);
     const mention=String(m.content).includes('@'+email)||Boolean((m.flags||[]).includes('mentioned'));
     const handled=await onMessage({conversationId,text:m.content,isGroup:isStream,mention,senderId:String(m.sender_email),messageId:String(m.id),reply:answer=>send(answer,target)});
     if(handled===false)throw Error('Zulip processing failed; event retained for retry');
    }
   }catch(e){
    if(!active)break;
    const message=String(e?.message||e);
    onStatus('error',e);
    if(/BAD_EVENT_QUEUE_ID|queue/i.test(message)){queueId='';lastEventId=-1;}
    await delay(4000);
   }
  }
 })();
 return {stop(){active=false;abort.abort();}};
}
