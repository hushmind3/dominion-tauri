// Twitch chat: IRC over WebSocket (wss://irc-ws.chat.twitch.tv:443).
export function start({record,credentials,onMessage,onStatus}){
 const channel=String(record.channel||'').trim().replace(/^#/,'').toLowerCase();
 const username=String(record.username||'').trim().toLowerCase();
 const token=credentials.token;
 let active=true,ws=null,retry=null,botId=username;
 function send(line){if(ws&&ws.readyState===1)ws.send(line+'\r\n');}
 function connect(){
  if(!active)return;
  try{
   ws=new WebSocket('wss://irc-ws.chat.twitch.tv:443');
   ws.addEventListener('open',()=>{
    send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    send('PASS oauth:'+token);
    send('NICK '+username);
    if(channel)send('JOIN #'+channel);
   });
   ws.addEventListener('message',async frame=>{
    const lines=String(frame.data).split('\r\n').filter(Boolean);
    for(const line of lines){
     if(line.startsWith('PING')){send('PONG :tmi.twitch.tv');continue;}
     const tags={};
     let rest=line;
     if(rest.startsWith('@')){
      const space=rest.indexOf(' ');
      for(const pair of rest.slice(1,space).split(';')){
       const eq=pair.indexOf('=');tags[pair.slice(0,eq)]=pair.slice(eq+1);
      }
      rest=rest.slice(space+1);
     }
     const match=rest.match(/^:(\S+)!\S+@\S+ PRIVMSG (#\S+) :([\s\S]*)$/);
     if(!match)continue;
     const [,sender,target,text]=match;
     if(sender.toLowerCase()===botId)continue;
     try{
      await onMessage({conversationId:target,text,isGroup:true,mention:Boolean(tags['reply-parent-msg-id'])||text.toLowerCase().includes(botId),senderId:sender,messageId:tags.id||'',reply:async answer=>{
       for(const part of String(answer).match(/[\s\S]{1,450}/g)||[])send('PRIVMSG '+target+' :'+part.replace(/\r?\n/g,' '));
      }});
     }catch(e){onStatus('error',e);}
    }
   });
   ws.addEventListener('open',()=>onStatus('connected'));
   ws.addEventListener('error',()=>onStatus('error',new Error('Twitch IRC WebSocket error')));
   ws.addEventListener('close',()=>{if(active){onStatus('reconnecting');retry=setTimeout(connect,4000);}});
  }catch(e){onStatus('error',e);if(active)retry=setTimeout(connect,6000);}
 }
 connect();
 return {stop(){active=false;clearTimeout(retry);try{ws?.close();}catch{}}};
}
