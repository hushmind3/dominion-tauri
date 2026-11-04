import {log} from '../store.mjs';
export function start({record,credentials,onMessage,onStatus}){
 let active=true,ws=null,retry=null;
 const base=new URL(record.bridgeUrl);
 const number=record.phoneNumber;
 const wsUrl=new URL('/v1/receive/'+encodeURIComponent(number),base);
 wsUrl.protocol=base.protocol==='https:'?'wss:':'ws:';
 function connect(){
  if(!active)return;
  ws=new WebSocket(wsUrl.toString(),credentials.token?{headers:{Authorization:'Bearer '+credentials.token}}:undefined);
  ws.addEventListener('open',()=>onStatus('connected'));
  ws.addEventListener('message',async frame=>{
   let data;try{data=JSON.parse(frame.data);}catch{return;}
   const entry=data.params?.result||data;
   const envelope=entry.envelope||entry;
   const payload=envelope.dataMessage||entry.dataMessage;
   if(!payload?.message||envelope.sourceNumber===number)return;
   const sender=String(envelope.sourceNumber||envelope.source||'');
   const groupId=payload.groupInfo?.groupId||'';
   const recipient=groupId||sender;
   if(!recipient)return;
   const isGroup=Boolean(groupId);
   const mention=(payload.mentions||[]).some(x=>x.number===number);
   try{
    await onMessage({conversationId:recipient,text:payload.message,isGroup,mention,senderId:sender,messageId:String(envelope.timestamp||''),reply:async text=>{
     const u=new URL('/v2/send',base);
     const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json',...(credentials.token?{Authorization:'Bearer '+credentials.token}:{})},body:JSON.stringify({number,message:text.slice(0,3000),recipients:[recipient]}),signal:AbortSignal.timeout(20000)});
     if(!r.ok)throw Error('signal-cli send HTTP '+r.status);
    }});
   }catch(e){log('channel.signal.message_error',{id:record.id,error:String(e)});}
  });
  ws.addEventListener('error',()=>onStatus('error',new Error('signal-cli WebSocket error')));
  ws.addEventListener('close',()=>{if(active){onStatus('reconnecting');retry=setTimeout(connect,4000);}});
 }
 connect();
 return {stop(){active=false;clearTimeout(retry);ws?.close();}};
}
