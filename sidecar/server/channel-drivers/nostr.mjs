import crypto from 'node:crypto';
import {schnorr} from '@noble/curves/secp256k1.js';

// Nostr: kind-1 notes over relays, BIP-340 schnorr signatures.
const CHARSET='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Decode(value){
 const lower=String(value).trim().toLowerCase();
 const pos=lower.lastIndexOf('1');
 if(pos<1||pos+7>lower.length)throw Error('Invalid nsec');
 const data=[...lower.slice(pos+1,-6)].map(ch=>{
  const index=CHARSET.indexOf(ch);
  if(index<0)throw Error('Invalid nsec character');
  return index;
 });
 let bits=0,acc=0;const bytes=[];
 for(const value5 of data){
  acc=(acc<<5)|value5;bits+=5;
  while(bits>=8){bits-=8;bytes.push((acc>>bits)&0xff);}
 }
 return Buffer.from(bytes);
}
function privateKeyBytes(value){
 const raw=String(value||'').trim();
 if(/^[0-9a-fA-F]{64}$/.test(raw))return Buffer.from(raw,'hex');
 if(raw.toLowerCase().startsWith('nsec'))return bech32Decode(raw);
 throw Error('Nostr private key must be 64-char hex or nsec');
}
export function start({record,credentials,onMessage,onStatus}){
 const relays=String(record.relays||'').split(',').map(x=>x.trim()).filter(Boolean);
 const priv=privateKeyBytes(credentials.privateKey);
 const pubkey=Buffer.from(schnorr.getPublicKey(priv)).toString('hex');
 let active=true;
 const sockets=[];
 const seen=new Set();
 function build(content,tags){
  const event={pubkey,created_at:Math.floor(Date.now()/1000),kind:1,tags,content:String(content).slice(0,2000)};
  const serialized=JSON.stringify([0,event.pubkey,event.created_at,event.kind,event.tags,event.content]);
  event.id=crypto.createHash('sha256').update(serialized).digest('hex');
  event.sig=Buffer.from(schnorr.sign(Buffer.from(event.id,'hex'),priv)).toString('hex');
  return event;
 }
 function publish(event){
  const frame=JSON.stringify(['EVENT',event]);
  for(const ws of sockets)if(ws.readyState===1)ws.send(frame);
 }
 function subscribe(ws){
  const since=Math.floor(Date.now()/1000)-120;
  ws.send(JSON.stringify(['REQ','dominion',{kinds:[1],'#p':[pubkey],since,limit:20}]));
 }
 for(const url of relays){
  try{
   const ws=new WebSocket(url);
   sockets.push(ws);
   ws.addEventListener('open',()=>{subscribe(ws);onStatus('connected');});
   ws.addEventListener('message',async frame=>{
    let data;try{data=JSON.parse(frame.data);}catch{return;}
    if(!Array.isArray(data)||data[0]!=='EVENT')return;
    const event=data[2];
    if(!event?.id||event.pubkey===pubkey||seen.has(event.id))return;
    seen.add(event.id);
    try{
     await onMessage({conversationId:String(event.pubkey),text:event.content||'',isGroup:false,mention:true,
      senderId:String(event.pubkey),messageId:String(event.id),reply:async answer=>{
       const reply=build(answer,[['e',event.id],['p',event.pubkey]]);
       publish(reply);
      }});
    }catch(e){onStatus('error',e);}
   });
   ws.addEventListener('error',()=>onStatus('error',new Error('Nostr relay error: '+url)));
   ws.addEventListener('close',()=>{if(active)onStatus('reconnecting');});
  }catch(e){onStatus('error',e);}
 }
 if(!relays.length)onStatus('error',new Error('At least one relay URL is required'));
 return {stop(){active=false;for(const ws of sockets){try{ws.close();}catch{}}}};
}
