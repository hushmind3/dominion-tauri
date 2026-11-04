import * as driver from '../../channel-drivers/matrix.mjs';
export default function activate(){
 return {...driver,async diagnose(record,c){
  const r=await fetch(record.homeserver.replace(/\/+$/,'')+'/_matrix/client/v3/account/whoami',{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(9000)});
  return {verified:r.ok,httpStatus:r.status};
 }};
}
