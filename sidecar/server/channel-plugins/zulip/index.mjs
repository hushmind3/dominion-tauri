import * as driver from '../../channel-drivers/zulip.mjs';
export default function activate(){
 return {...driver,async diagnose(record,c){
  const site=String(record.site||'').replace(/\/+$/,'');
  const auth='Basic '+Buffer.from(String(record.email||'')+':'+c.apiKey).toString('base64');
  const r=await fetch(site+'/api/v1/users/me',{headers:{Authorization:auth},signal:AbortSignal.timeout(9000)});
  return {verified:r.ok,httpStatus:r.status};
 }};
}
