import * as driver from '../../channel-drivers/telegram.mjs';
export default function activate(){
 return {...driver,async diagnose(record,c){
  const r=await fetch('https://api.telegram.org/bot'+c.token+'/getMe',{signal:AbortSignal.timeout(9000)});
  const j=await r.json();return {verified:r.ok&&j.ok===true,httpStatus:r.status};
 }};
}
