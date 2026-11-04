import fs from 'node:fs';
import path from 'node:path';
import {get,put} from '../store.mjs';
import {DATA} from '../config.mjs';

export async function handleAgentRoutes({url,method,res,json,body}){
 if(url.match(/^\/api\/agents\/[^/]+\/avatar$/)&&method==='POST'){
  const id=url.split('/')[3];
  const agent=get('agent',id);
  if(!agent)throw Error('에이전트를 찾을 수 없습니다');
  const {image}=await body(req);
  const match=String(image||'').match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if(!match)throw Error('PNG/JPEG/WebP 이미지만 올릴 수 있습니다');
  const dir=path.join(DATA,'avatars');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,id+'.'+match[1]);
  fs.writeFileSync(file,Buffer.from(match[2],'base64'));
  const avatar='/api/agents/'+id+'/avatar?'+Date.now();
  put('agent',{...agent,avatar});
  return json(res,{ok:true,avatar});
 }
 if(url.match(/^\/api\/agents\/[^/]+\/avatar$/)&&method==='GET'){
  const id=url.split('/')[3];
  const agent=get('agent',id);
  const dir=path.join(DATA,'avatars');
  for(const ext of ['png','jpeg','webp']){
   const file=path.join(dir,id+'.'+ext);
   if(fs.existsSync(file)){
    res.writeHead(200,{'Content-Type':'image/'+ext,'Cache-Control':'no-cache'});
    res.end(fs.readFileSync(file));return;
   }
  }
  res.writeHead(404);res.end();return;
 }
 return false;
}
