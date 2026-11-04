import * as driver from '../../channel-drivers/mattermost.mjs';
export default function activate(){
 return {...driver,async diagnose(record,c){
  const base=String(record.baseUrl||'').replace(/\/+$/,'');
  const r=await fetch(base+'/api/v4/users/me',{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(9000)});
  return {verified:r.ok,httpStatus:r.status};
 }};
}
