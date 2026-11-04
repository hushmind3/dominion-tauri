import {log} from '../store.mjs';
export function start({record,credentials,onMessage,onStatus}){
 const botToken=credentials.token,appToken=credentials.appToken;
 let active=true,ws=null,retry=null,botId='';
 async function slack(method,body={},token=botToken){
  const response=await fetch('https://slack.com/api/'+method,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok||!data.ok)throw Error('Slack '+method+': '+(data.error||response.status));
  return data;
 }
 async function connect(){
  if(!active)return;
  try{
   if(!botId){const auth=await slack('auth.test');botId=auth.user_id||'';}
   const connection=await slack('apps.connections.open',{},appToken);
   if(!active)return;
   ws=new WebSocket(connection.url);
   ws.addEventListener('open',()=>onStatus('connected'));
   ws.addEventListener('message',async frame=>{
    let envelope;try{envelope=JSON.parse(frame.data);}catch{return;}
    // Ack envelope immediately; the expensive model execution happens afterward.
    if(envelope.envelope_id&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({envelope_id:envelope.envelope_id}));
    if(!['events_api'].includes(envelope.type))return;
    const event=envelope.payload?.event;
    if(!event||!['message','app_mention'].includes(event.type)||event.bot_id||event.user===botId||event.subtype||!event.text)return;
    const isGroup=!['im','mpim'].includes(event.channel_type||'')&&event.channel?.startsWith('C');
    const mention=event.type==='app_mention'||event.text.includes('<@'+botId+'>');
    try{await onMessage({conversationId:String(event.channel),text:event.text,isGroup,mention,senderId:String(event.user),messageId:String(event.ts),reply:async text=>{await slack('chat.postMessage',{channel:event.channel,text:text.slice(0,3900),thread_ts:event.thread_ts||event.ts});}});}
    catch(e){log('channel.slack.message_error',{id:record.id,error:String(e)});}
   });
   ws.addEventListener('error',()=>onStatus('error',new Error('Slack Socket Mode connection error')));
   ws.addEventListener('close',()=>{if(active){onStatus('reconnecting');retry=setTimeout(connect,3500);}});
  }catch(e){onStatus('error',e);if(active)retry=setTimeout(connect,5000);}
 }
 void connect();
 return {stop(){active=false;clearTimeout(retry);ws?.close();}};
}
