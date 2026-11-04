import crypto from 'node:crypto';
import {get,put} from '../store.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));

// X / Twitter API v2 with OAuth 1.0a user-context signing (no SDK).
const enc=value=>encodeURIComponent(String(value)).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
function oauthHeader(method,url,credentials,extraQuery={}){
 const oauth={oauth_consumer_key:credentials.apiKey,oauth_nonce:crypto.randomBytes(16).toString('hex'),
  oauth_signature_method:'HMAC-SHA1',oauth_timestamp:String(Math.floor(Date.now()/1000)),
  oauth_token:credentials.accessToken,oauth_version:'1.0'};
 const params={...extraQuery,...oauth};
 const normalized=Object.keys(params).sort().map(k=>enc(k)+'='+enc(params[k])).join('&');
 const base=method.toUpperCase()+'&'+enc(url)+'&'+enc(normalized);
 const signingKey=enc(credentials.apiSecret)+'&'+enc(credentials.accessSecret);
 oauth.oauth_signature=crypto.createHmac('sha1',signingKey).update(base).digest('base64');
 return 'OAuth '+Object.keys(oauth).sort().map(k=>enc(k)+'="'+enc(oauth[k])+'"').join(', ');
}
async function signed(method,path,credentials,{query={},body}={}){
 const url='https://api.x.com'+path;
 const qs=Object.keys(query).length?'?'+Object.entries(query).map(([k,v])=>enc(k)+'='+enc(v)).join('&'):'';
 const headers={Authorization:oauthHeader(method,url,credentials,query)};
 if(body){headers['Content-Type']='application/json';}
 const response=await fetch(url+qs,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const text=await response.text();
 let data={};try{data=JSON.parse(text);}catch{data={raw:text.slice(0,300)};}
 if(!response.ok)throw Error('X API '+response.status+': '+JSON.stringify(data).slice(0,200));
 return data;
}
export function start({record,credentials,onMessage,onStatus}){
 let active=true,userId='',sinceId=get('channel_cursor',record.id)?.sinceId||'',retry=null;
 async function post(text,replyTo){
  const body={text:String(text).slice(0,270)};
  if(replyTo)body.reply={in_reply_to_tweet_id:replyTo};
  return signed('POST','/2/tweets',credentials,{body});
 }
 async function poll(){
  if(!active)return;
  try{
   if(!userId){const me=await signed('GET','/2/users/me',credentials);userId=me?.data?.id||'';onStatus('connected');}
   if(!userId)throw Error('X account id unavailable');
   const query={max_results:'10','tweet.fields':'author_id,conversation_id',expansions:'author_id','user.fields':'username'};
   if(sinceId)query.since_id=sinceId;
   const data=await signed('GET','/2/users/'+encodeURIComponent(userId)+'/mentions',credentials,{query});
   const authors=new Map((data.includes?.users||[]).map(u=>[u.id,u.username]));
   for(const tweet of (data.data||[]).slice().reverse()){
    if(tweet.author_id===userId)continue;
    const text=tweet.text||'';
    if(!text)continue;
    const username=authors.get(tweet.author_id)||String(tweet.author_id||'');
    await onMessage({conversationId:String(tweet.conversation_id||tweet.id),text,isGroup:true,mention:true,
     senderId:username,messageId:String(tweet.id),reply:answer=>post(answer,tweet.id)});
    if(!sinceId||BigInt(tweet.id)>BigInt(sinceId)){sinceId=tweet.id;put('channel_cursor',{id:record.id,sinceId});}
   }
  }catch(e){onStatus('error',e);}
  if(active)retry=setTimeout(poll,30000);
 }
 void poll();
 return {stop(){active=false;clearTimeout(retry);}};
}
