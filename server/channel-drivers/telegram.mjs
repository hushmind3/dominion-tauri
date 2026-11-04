import {get,put} from '../store.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export function start({record,credentials,onMessage,onStatus}){
 const token=credentials.token;
 let active=true;
 let offset=Number(get('channel_cursor',record.id)?.offset||0);
 const abort=new AbortController();
 const endpoint='https://api.telegram.org/bot'+token+'/';
 async function api(method,value){
  const r=await fetch(endpoint+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(40000)])});
  if(!r.ok)throw Error('Telegram API HTTP '+r.status);
  const x=await r.json();if(!x.ok)throw Error('Telegram: '+x.description);return x.result;
 }
 const loop=(async()=>{
  while(active){
   try{
    const updates=await api('getUpdates',{offset,timeout:25,allowed_updates:['message']});
    onStatus('connected');
    for(const update of updates){
     if(!active)break;
     const m=update.message;
     if(m?.text&&!m.from?.is_bot){
      const id=String(m.chat.id);
      const handled=await onMessage({conversationId:id,text:m.text,isGroup:m.chat.type!=='private',mention:/@\w+/.test(m.text),senderId:String(m.from?.id||''),messageId:String(m.message_id),reply:async text=>api('sendMessage',{chat_id:m.chat.id,text:text.slice(0,3900),reply_parameters:{message_id:m.message_id}})});
      if(handled===false)throw Error('Telegram processing failed; cursor retained for retry');
     }
     // Confirm the update only after its delivery path was handled.
     offset=update.update_id+1;
     put('channel_cursor',{id:record.id,offset});
    }
   }catch(e){
    if(active){onStatus('error',e);await delay(4000);}
   }
  }
 })();
 return {stop(){active=false;abort.abort();}};
}
