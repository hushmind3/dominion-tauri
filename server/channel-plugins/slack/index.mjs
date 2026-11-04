import * as driver from '../../channel-drivers/slack.mjs';
export default function activate(){
 return {...driver,async diagnose(record,c){
  const r=await fetch('https://slack.com/api/auth.test',{method:'POST',headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(9000)});
  const j=await r.json();return {verified:r.ok&&j.ok===true,httpStatus:r.status};
 }};
}
