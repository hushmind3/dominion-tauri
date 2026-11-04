export function start({onStatus}){onStatus('webhook_ready');return {stop(){}};}
export function inboundEvents(payload,{record,credentials,onMessage}){
 const jobs=[];
 for(const item of payload?.events||[]){
  if(item.type!=='message'||item.message?.type!=='text'||!item.message.text||!item.replyToken)continue;
  const source=item.source||{};
  const groupId=source.groupId||source.roomId;
  const conversationId=String(groupId||source.userId||'');
  if(!conversationId)continue;
  const isGroup=Boolean(groupId);
  const mention=Boolean(item.message.mention?.mentionees?.length);
  jobs.push(onMessage({conversationId,text:item.message.text,isGroup,mention,senderId:String(source.userId||''),messageId:String(item.webhookEventId||item.message.id||''),reply:async text=>{
    const response=await fetch('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{Authorization:'Bearer '+credentials.token,'Content-Type':'application/json'},body:JSON.stringify({replyToken:item.replyToken,messages:[{type:'text',text:text.slice(0,5000)}]}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('LINE reply HTTP '+response.status);
   }}));
 }
 return jobs;
}
