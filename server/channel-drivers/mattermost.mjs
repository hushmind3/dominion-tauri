import {log} from '../store.mjs';

// Mattermost: REST v4 for sending, WebSocket for receiving.
export function start({record,credentials,onMessage,onStatus}){
 const base=String(record.baseUrl||'').replace(/\/+$/,'');
 const token=credentials.token;
 let active=true,ws=null,retry=null,botId='';
 async function api(path,options={}){
  const response=await fetch(base+'/api/v4'+path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(16000)});
  if(!response.ok)throw Error('Mattermost HTTP '+response.status);
  return response.json();
 }
 function connect(){
  if(!active)return;
  try{
   const url=base.replace(/^http/,'ws')+'/api/v4/websocket';
   ws=new WebSocket(url);
   ws.addEventListener('open',()=>{
    ws.send(JSON.stringify({seq:1,action:'authentication_challenge',data:{token}}));
    onStatus('connected');
   });
   ws.addEventListener('message',async frame=>{
    let packet;try{packet=JSON.parse(frame.data);}catch{return;}
    if(packet.event!=='posted'||!packet.data)return;
    let post;try{post=JSON.parse(packet.data.post||'{}');}catch{return;}
    if(!post.id||!post.message||post.user_id===botId||post.type)return;
    const channelName=String(packet.data.channel_name||'');
    const isGroup=!channelName.includes('__');
    const mention=(packet.data.mentions||[]).includes(botId)||post.message.includes('@'+String(packet.data.sender_name||''));
    try{
     await onMessage({conversationId:String(post.channel_id),text:post.message,isGroup,mention,senderId:String(post.user_id),messageId:String(post.id),reply:async text=>{
      await api('/posts',{method:'POST',body:JSON.stringify({channel_id:post.channel_id,message:String(text).slice(0,16000)})});
     }});
    }catch(e){log('channel.mattermost.message_error',{id:record.id,error:String(e)});}
   });
   ws.addEventListener('error',()=>onStatus('error',new Error('Mattermost WebSocket error')));
   ws.addEventListener('close',()=>{if(active){onStatus('reconnecting');retry=setTimeout(connect,4000);}});
  }catch(e){onStatus('error',e);if(active)retry=setTimeout(connect,6000);}
 }
 void (async()=>{
  try{const me=await api('/users/me');botId=me?.id||'';}catch(e){onStatus('error',e);}
  connect();
 })();
 return {stop(){active=false;clearTimeout(retry);try{ws?.close();}catch{}}};
}
