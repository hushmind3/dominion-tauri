import {equalSecret} from '../channel-security.mjs';
export function start({onStatus}){onStatus('webhook_ready');return {stop(){}};}
export function verifyChallenge(query,credentials){
 const mode=query.get('hub.mode'),token=query.get('hub.verify_token'),challenge=query.get('hub.challenge');
 if(mode!=='subscribe'||!equalSecret(token,credentials.verifyToken)||typeof challenge!=='string'||!/^[0-9]+$/.test(challenge))return null;
 return challenge;
}
export function inboundEvents(payload,{record,credentials,onMessage}){
 const jobs=[];
 for(const entry of payload?.entry||[]){
  for(const change of entry.changes||[]){
   const data=change.value||{};
   for(const message of data.messages||[]){
    if(message.type!=='text'||!message.text?.body||!message.from)continue;
    jobs.push(onMessage({conversationId:String(message.from),text:message.text.body,isGroup:false,mention:true,senderId:String(message.from),messageId:String(message.id||''),reply:async text=>{
      const version=record.graphVersion;
      const endpoint='https://graph.facebook.com/'+encodeURIComponent(version)+'/'+encodeURIComponent(record.phoneNumberId)+'/messages';
      const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+credentials.token,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:message.from,type:'text',text:{body:text.slice(0,4096)}}),signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('WhatsApp send HTTP '+response.status);
    }}));
   }
  }
 }
 return jobs;
}
