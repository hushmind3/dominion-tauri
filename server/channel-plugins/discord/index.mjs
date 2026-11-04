import * as driver from '../../channel-drivers/discord.mjs';
export default function activate(){
 return {...driver,async diagnose(record,c){
  const r=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bot '+c.token},signal:AbortSignal.timeout(9000)});
  return {verified:r.ok,httpStatus:r.status};
 }};
}
