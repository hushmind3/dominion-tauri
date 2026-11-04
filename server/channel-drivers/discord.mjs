import {log} from '../store.mjs';
export function start({record,credentials,onMessage,onStatus}){
 const token=credentials.token;
 let active=true,ws=null,heartbeat=null,retry=null,seq=null,botId='';
 const intents=(1<<0)|(1<<9)|(1<<12)|(1<<15);
 function connect(){
  if(!active)return;
  ws=new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
  ws.addEventListener('open',()=>onStatus('connecting'));
  ws.addEventListener('message',async event=>{
   let packet;try{packet=JSON.parse(event.data);}catch{return;}
   if(packet.s!=null)seq=packet.s;
   if(packet.op===10){
    clearInterval(heartbeat);
    heartbeat=setInterval(()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({op:1,d:seq}));},packet.d.heartbeat_interval);
    ws.send(JSON.stringify({op:2,d:{token,intents,properties:{os:process.platform,browser:'dominion',device:'dominion'}}}));
   }
   if(packet.t==='READY'){botId=packet.d.user?.id||'';onStatus('connected');}
   if(packet.op===7){ws.close();return;}
   if(packet.t!=='MESSAGE_CREATE')return;
   const m=packet.d;
   if(m.author?.bot||!m.content)return;
   const channel=String(m.channel_id);
   const mention=(m.mentions||[]).some(x=>x.id===botId);
   try{
    await onMessage({conversationId:channel,text:m.content,isGroup:Boolean(m.guild_id),mention,senderId:String(m.author?.id||''),messageId:String(m.id),reply:async text=>{
     const response=await fetch('https://discord.com/api/v10/channels/'+channel+'/messages',{method:'POST',headers:{Authorization:'Bot '+token,'Content-Type':'application/json'},body:JSON.stringify({content:text.slice(0,1900),message_reference:{message_id:m.id,fail_if_not_exists:false}}),signal:AbortSignal.timeout(16000)});
     if(!response.ok)throw Error('Discord send HTTP '+response.status);
    }});
   }catch(e){log('channel.discord.message_error',{id:record.id,error:String(e)});}
  });
  ws.addEventListener('error',()=>onStatus('error',new Error('Discord gateway connection error')));
  ws.addEventListener('close',()=>{clearInterval(heartbeat);if(active){onStatus('reconnecting');retry=setTimeout(connect,3500);}});
 }
 connect();
 return {stop(){active=false;clearInterval(heartbeat);clearTimeout(retry);ws?.close();}};
}
