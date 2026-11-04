import {get,put} from '../store.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export function start({record,credentials,onMessage,onStatus}){
 const base=record.homeserver.replace(/\/+$/,''),token=credentials.token,userId=record.userId;
 let active=true;
 const abort=new AbortController();
 let since=get('channel_cursor',record.id)?.since||'';
 async function matrix(url,options={}){
  const res=await fetch(base+'/_matrix/client/v3'+url,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(35000)])});
  if(!res.ok)throw Error('Matrix HTTP '+res.status);
  return res.json();
 }
 (async()=>{
  while(active){
   try{
    const url='/sync?timeout=25000'+(since?'&since='+encodeURIComponent(since):'');
    const batch=await matrix(url);
    onStatus('connected');
    const initial=!since;
    const nextSince=batch.next_batch||since;
    // First sync is a snapshot, not a new user message.
    if(initial){since=nextSince;if(since)put('channel_cursor',{id:record.id,since});continue;}
    for(const [roomId,room] of Object.entries(batch.rooms?.join||{})){
     for(const event of room.timeline?.events||[]){
      if(event.type!=='m.room.message'||event.sender===userId||event.content?.msgtype!=='m.text'||!event.content.body)continue;
      if(event.content?.['m.relates_to']?.rel_type==='m.replace')continue;
      const text=event.content.body;
      const mention=text.includes(userId)||(event.content['m.mentions']?.user_ids||[]).includes(userId);
      const handled=await onMessage({conversationId:roomId,text,isGroup:true,mention,senderId:event.sender,messageId:event.event_id,reply:async answer=>{
       const txn=crypto.randomUUID();
       await matrix('/rooms/'+encodeURIComponent(roomId)+'/send/m.room.message/'+txn,{method:'PUT',body:JSON.stringify({msgtype:'m.text',body:answer.slice(0,30000)})});
      }});
      if(handled===false)throw Error('Matrix processing failed; sync token retained for retry');
     }
    }
    since=nextSince;if(since)put('channel_cursor',{id:record.id,since});
   }catch(e){if(active){onStatus('error',e);await delay(4000);}}
  }
 })();
 return {stop(){active=false;abort.abort();}};
}
