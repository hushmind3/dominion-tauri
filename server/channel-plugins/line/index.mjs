import * as driver from '../../channel-drivers/line.mjs';
import {verifyWebhook} from '../../channel-security.mjs';
export default function activate(){
 return {...driver,verifySignature:(headers,raw,credentials)=>verifyWebhook('line',headers,raw,credentials),
  async diagnose(record,c){
   const r=await fetch('https://api.line.me/v2/bot/info',{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(9000)});
   return {verified:r.ok,httpStatus:r.status};
  }};
}
