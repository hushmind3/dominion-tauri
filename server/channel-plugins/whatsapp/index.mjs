import * as driver from '../../channel-drivers/whatsapp.mjs';
import {verifyWebhook} from '../../channel-security.mjs';
export default function activate(){
 return {...driver,verifySignature:(headers,raw,credentials)=>verifyWebhook('whatsapp',headers,raw,credentials),
  async diagnose(record,c){
   const url='https://graph.facebook.com/'+record.graphVersion+'/'+encodeURIComponent(record.phoneNumberId)+'?fields=display_phone_number,verified_name';
   const r=await fetch(url,{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(9000)});
   return {verified:r.ok,httpStatus:r.status};
  }};
}
