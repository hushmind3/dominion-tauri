import crypto from 'node:crypto';
import * as driver from '../../channel-drivers/x.mjs';

function header(credentials,method,url,query={}){
 const enc=v=>encodeURIComponent(String(v)).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 const oauth={oauth_consumer_key:credentials.apiKey,oauth_nonce:crypto.randomBytes(16).toString('hex'),
  oauth_signature_method:'HMAC-SHA1',oauth_timestamp:String(Math.floor(Date.now()/1000)),
  oauth_token:credentials.accessToken,oauth_version:'1.0'};
 const params={...query,...oauth};
 const normalized=Object.keys(params).sort().map(k=>enc(k)+'='+enc(params[k])).join('&');
 const base=method+'&'+enc(url)+'&'+enc(normalized);
 oauth.oauth_signature=crypto.createHmac('sha1',enc(credentials.apiSecret)+'&'+enc(credentials.accessSecret)).update(base).digest('base64');
 return 'OAuth '+Object.keys(oauth).sort().map(k=>enc(k)+'="'+enc(oauth[k])+'"').join(', ');
}

export default function activate(){
 return {...driver,async diagnose(record,c){
  const url='https://api.x.com/2/users/me';
  const r=await fetch(url,{headers:{Authorization:header(c,'GET',url)},signal:AbortSignal.timeout(9000)});
  return {verified:r.ok,httpStatus:r.status};
 }};
}
