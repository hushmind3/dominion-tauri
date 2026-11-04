import * as driver from '../../channel-drivers/twitch.mjs';
export default function activate(){
 return {...driver,async diagnose(record,c){
  const r=await fetch('https://api.twitch.tv/helix/users?login='+encodeURIComponent(record.username||''),{
   headers:{'Client-Id':record.clientId||'','Authorization':'Bearer '+c.token},signal:AbortSignal.timeout(9000)});
  return {verified:r.ok,httpStatus:r.status};
 }};
}
