import net from 'node:net';
import tls from 'node:tls';

// IRC (RFC 1459 / IRCv3): plain TCP or TLS socket, no external SDK.
export function start({record,credentials,onMessage,onStatus}){
 const host=String(record.host||'').trim();
 const port=Number(record.port||6667);
 const nick=String(record.nick||'dominion').trim();
 const channel=String(record.channel||'').trim();
 const useTls=String(record.tls||'').toLowerCase()==='true';
 let active=true,socket=null,retry=null,buffer='',joined=false;
 function write(line){if(socket&&!socket.destroyed)socket.write(line+'\r\n');}
 function join(){
  if(joined||!channel)return;
  joined=true;
  for(const part of channel.split(',').map(x=>x.trim()).filter(Boolean))write('JOIN '+part);
 }
 function handle(line){
  if(/^PING\b/i.test(line)){write('PONG'+line.slice(4));return;}
  const match=line.match(/^:(\S+)\s+(\S+)\s*(.*)$/);
  if(!match){
   if(/^(\S+)\s+001\s/.test(line)){join();onStatus('connected');}
   return;
  }
  const [,prefix,command,rest]=match;
  if(command==='001'){join();onStatus('connected');return;}
  if(command==='PING'){write('PONG '+rest);return;}
  if(command!=='PRIVMSG')return;
  const split=rest.indexOf(' :');
  if(split<0)return;
  const target=rest.slice(0,split).trim(),text=rest.slice(split+2);
  if(!text)return;
  const sender=prefix.split('!')[0].split('@')[0];
  if(sender.toLowerCase()===nick.toLowerCase())return;
  const isGroup=target.startsWith('#')||target.startsWith('&');
  const conversationId=isGroup?target:sender;
  if(!conversationId)return;
  const mention=isGroup?(text.includes(nick)||text.startsWith(nick+':')):true;
  try{
   void onMessage({conversationId,text,isGroup,mention,senderId:sender,messageId:'',reply:async answer=>{
    const parts=String(answer).replace(/\r?\n/g,' ').match(/[\s\S]{1,400}/g)||[];
    for(const part of parts)write('PRIVMSG '+conversationId+' :'+part);
   }}).catch(e=>onStatus('error',e));
  }catch(e){onStatus('error',e);}
 }
 function connect(){
  if(!active)return;
  buffer='';joined=false;
  socket=useTls?tls.connect({host,port,servername:host,rejectUnauthorized:false}):net.connect({host,port});
  socket.setEncoding('utf8');
  const ready=()=>{
   if(credentials.password)write('PASS '+credentials.password);
   write('NICK '+nick);
   write('USER '+nick+' 0 * :DOMINION');
  };
  if(useTls)socket.once('secureConnect',ready);else socket.once('connect',ready);
  socket.on('data',chunk=>{
   buffer+=chunk;
   let index;
   while((index=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,index).replace(/\r$/,'');
    buffer=buffer.slice(index+1);
    if(line)handle(line);
   }
  });
  socket.on('error',e=>onStatus('error',e));
  socket.on('close',()=>{if(active){onStatus('reconnecting');retry=setTimeout(connect,5000);}});
 }
 if(!host||!channel){onStatus('error',new Error('IRC host and channel are required'));return {stop(){}};}
 connect();
 return {stop(){active=false;clearTimeout(retry);try{socket?.destroy();}catch{}}};
}
