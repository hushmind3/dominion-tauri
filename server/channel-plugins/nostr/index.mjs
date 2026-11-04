import * as driver from '../../channel-drivers/nostr.mjs';

export default function activate(){
 return {...driver,async diagnose(record,credentials){
  const relays=String(record.relays||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!relays.length)return {verified:false,reason:'relay URL required'};
  return new Promise(resolve=>{
   const ws=new WebSocket(relays[0]);
   const timer=setTimeout(()=>{try{ws.close();}catch{}resolve({verified:false,reason:'timeout'});},9000);
   ws.addEventListener('open',()=>{clearTimeout(timer);ws.close();resolve({verified:true,relay:relays[0]});});
   ws.addEventListener('error',()=>{clearTimeout(timer);resolve({verified:false,reason:'relay unreachable'});});
  });
 }};
}
