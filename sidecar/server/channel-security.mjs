import {createHmac,timingSafeEqual} from 'node:crypto';
export function equalSecret(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
export function verifyHmac(raw,secret,signature,{prefix='',encoding='hex'}={}){
 if(!Buffer.isBuffer(raw)||!secret||!signature||typeof signature!=='string')return false;
 const digest=createHmac('sha256',secret).update(raw).digest(encoding);
 return equalSecret(prefix+digest,signature);
}
export function verifyWebhook(kind,headers,raw,credentials){
 if(kind==='line')return verifyHmac(raw,credentials.channelSecret,headers['x-line-signature'],{encoding:'base64'});
 if(kind==='whatsapp')return verifyHmac(raw,credentials.appSecret,headers['x-hub-signature-256'],{prefix:'sha256='});
 return false;
}
