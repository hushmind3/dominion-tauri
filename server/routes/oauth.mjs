import {oauthProviders,oauthCallbackBase,oauthStart,saveOAuthApp,connections} from '../oauth.mjs';

export async function handleOAuthRoutes({url,method,res,json,body}){
 if(url==='/api/oauth/providers'&&method==='GET')return json(res,oauthProviders());
 const oauthApp=url.match(/^\/api\/oauth\/providers\/(github|google)$/);
 if(oauthApp&&method==='POST')return json(res,saveOAuthApp(oauthApp[1],await body(req)));
 if(url==='/api/oauth/connections'&&method==='GET')return json(res,connections());
 if(url.match(/^\/api\/oauth\/(github|google)\/start$/)&&method==='GET'){
  const provider=url.split('/')[3];
  return json(res,{url:oauthStart(provider,oauthCallbackBase())});
 }
 return false;
}
