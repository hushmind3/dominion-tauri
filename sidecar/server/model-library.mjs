import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {DATA} from './config.mjs';

const REPO=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const HEX=/^[0-9a-f]{24}$/;
const MAX_TREE_PAGES=12;
const quantFrom=name=>{
 const matches=name.toUpperCase().match(/(?:^|[-_.])(IQ[1-4](?:_[A-Z0-9]+)*|Q[1-8](?:_[A-Z0-9]+)*|TQ[12]|F16|BF16|FP16|FP8)(?=[-_.]|$)/g);
 return matches?.at(-1)?.replace(/^[-_.]/,'')||'';
};
const safely=(s)=>typeof s==='string'&&s.length<400&&!s.includes('\\')&&!s.includes('\0')&&!s.startsWith('/')&&s.split('/').every(x=>x&&x!=='.'&&x!=='..');
// Parameter count from the repository name (e.g. "Llama-3.2-3B-Instruct" -> 3).
const paramsFrom=value=>{
 // "35B-A3B" is a 35B MoE with 3B active: the active count must not pass a size filter.
 const matches=[...String(value||'').matchAll(/(?<![aA])(\d+(?:\.\d+)?)\s*[bB](?![A-Za-z0-9])/g)].map(m=>Number(m[1])).filter(n=>n>=0.1&&n<=2000);
 return matches.length?Math.max(...matches):0;
};
function groupsFor(files,tags=[],repo=''){
 const ggufs=files.filter(x=>/\.gguf$/i.test(x.path));
 const groups=new Map();
 for(const f of ggufs){
  const stem=f.path.replace(/-\d{5}-of-\d{5}\.gguf$/i,'.gguf');
  const arr=groups.get(stem)||[];arr.push(f);groups.set(stem,arr);
 }
 const options=[...groups].map(([key,list])=>{
  const size=list.reduce((n,x)=>n+x.size,0), quant=quantFrom(key);
  return {id:'gguf:'+key,format:'gguf',label:quant||path.basename(key),quantization:quant,bytes:size,files:list.map(x=>x.path),shards:list.length};
 }).filter(x=>x.bytes>0);
 const isMlx=/mlx/i.test(repo)||tags.some(t=>/^(mlx|library_name:mlx|mlx-lm)$|mlx/i.test(t));
 const weights=files.filter(f=>/\.safetensors$/i.test(f.path)&&!/(optimizer|training|adapter)/i.test(f.path));
 if(isMlx&&weights.length){
  const extras=files.filter(f=>/^(config\.json|generation_config\.json|tokenizer[^/]*|special_tokens_map\.json|vocab\.[^/]+|merges\.txt|preprocessor_config\.json|processor_config\.json|chat_template\.jinja|model\.safetensors\.index\.json)$/i.test(f.path));
  const chosen=[...weights,...extras];
  options.push({id:'mlx:all',format:'mlx',label:'MLX · model snapshot',quantization:quantFrom(repo)||'Repository',bytes:chosen.reduce((n,x)=>n+x.size,0),files:chosen.map(x=>x.path),shards:weights.length});
 }
 return options.sort((a,b)=>a.bytes-b.bytes);
}
const jsonResponse=async(res,source)=>{
 if(!res.ok)throw Error(source+' HTTP '+res.status);
 return res.json();
};
export class ModelLibrary{
 constructor({root=path.join(DATA,'models'),hub='https://huggingface.co',fetcher=globalThis.fetch}={}){
  this.root=root;this.hub=hub.replace(/\/$/,'');this.fetcher=fetcher;this.jobs=new Map();this.descriptions=new Map();
  fs.mkdirSync(root,{recursive:true,mode:0o700});
 }
 url(repo,route=''){
  if(!REPO.test(repo))throw Error('Invalid Hugging Face repository');
  return this.hub+'/'+route+repo.split('/').map(encodeURIComponent).join('/');
 }
 async catalog({q='',format='',sort='downloads',limit=80,chatOnly=true,maxParams=0}={}){
  const search=String(q).trim().slice(0,120);
  const max=Math.min(500,Math.max(20,Number(limit)||80));
  const order=['downloads','likes','lastModified'].includes(sort)?sort:'downloads';
  const terms=search?[search]:format==='gguf'?['GGUF']:format==='mlx'?['mlx']:['GGUF','mlx'];
  // A size filter must look past the top-download list: fetch a wider window, then trim.
  const fetchLimit=Number(maxParams)>0?Math.min(500,max*8):max;
  const groups=await Promise.all(terms.map(async term=>{
   const u=new URL(this.hub+'/api/models');
   u.searchParams.set('limit',String(fetchLimit));u.searchParams.set('sort',order);
   u.searchParams.set('direction','-1');u.searchParams.set('search',term);
   return jsonResponse(await this.fetcher(u,{signal:AbortSignal.timeout(20000)}),'Hugging Face');
  }));
  const map=new Map();
  for(const x of groups.flat()){
   if(!x.id||!REPO.test(x.id))continue;
   const tagText=x.id+' '+(x.tags||[]).join(' ');
   if(format==='gguf'&&!/gguf/i.test(tagText))continue;
   if(format==='mlx'&&!/mlx/i.test(tagText))continue;
   const task=String(x.pipeline_tag||'').toLowerCase();
   const hay=task+' '+tagText.toLowerCase();
   const isChat=/text-generation|conversational|image-text-to-text|any-to-any/i.test(hay)&&!/text-to-speech|text-to-image|image-to-image|automatic-speech-recognition|feature-extraction|sentence-similarity|reranker|audio-classification/i.test(hay);
   if(chatOnly&&!isChat)continue;
   if(!search&&!/(gguf|mlx)/i.test(tagText))continue;
   if(!map.has(x.id))map.set(x.id,x);
  }
  const sizeLimit=Number(maxParams)>0?Number(maxParams):0;
  const items=[...map.values()].filter(x=>!sizeLimit||paramsFrom(x.id)&&paramsFrom(x.id)<=sizeLimit).sort((a,b)=>{
   if(order==='params')return (paramsFrom(a.id)||9999)-(paramsFrom(b.id)||9999);
   if(order==='lastModified')return String(b.lastModified||'').localeCompare(String(a.lastModified||''));
   return Number(b[order]||0)-Number(a[order]||0);
  }).slice(0,max).map(x=>this._summary(x));
  await Promise.allSettled(items.filter(item=>!item.description).slice(0,32).map(async item=>{
   item.description=await this._description(item.id);
  }));
  return items;
 }
 _summary(x){
  const tags=x.tags||[];
  return {id:x.id,author:x.id.split('/')[0]||'',name:x.id.split('/').pop()||x.id,downloads:x.downloads||0,likes:x.likes||0,updatedAt:x.lastModified||'',createdAt:x.createdAt||'',task:x.pipeline_tag||'',library:x.library_name||'',tags:tags.slice(0,22),
   gated:Boolean(x.gated),description:String(x.cardData?.description||x.cardData?.summary||x.description||'').slice(0,500),
   capabilities:{vision:tags.some(t=>/image-text-to-text|vision|visual-question-answering/i.test(t)),tools:tags.some(t=>/tool-use|function-calling|tool-calling/i.test(t)),reasoning:tags.some(t=>/reasoning|thinking/i.test(t))}};
 }
 async _description(repo){
  const cached=this.descriptions.get(repo);
  if(cached&&Date.now()-cached.at<10*60*1000)return cached.text;
  try{
   const url=this.hub+'/'+repo.split('/').map(encodeURIComponent).join('/')+'/raw/main/README.md';
   const response=await this.fetcher(url,{signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw Error('README HTTP '+response.status);
   let text=await response.text();
   text=text.replace(/^---[\s\S]*?---/,'');
   text=text.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/<[^>]+>/g,' ');
   const paragraph=text.split('\n').map(line=>line.trim()).find(line=>line&&!line.startsWith('#')&&!line.startsWith('|')&&!line.startsWith('-')&&!line.startsWith('>')&&!line.startsWith('```'))||'';
   const clean=paragraph.replace(/[*_`[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,400);
   this.descriptions.set(repo,{at:Date.now(),text:clean});
   return clean;
  }catch{
   this.descriptions.set(repo,{at:Date.now(),text:''});
   return '';
  }
 }
 async _tree(repo,revision){
  const base=this.url(repo,'api/models/')+'/tree/'+encodeURIComponent(revision)+'?recursive=true&expand=false';
  let current=base,files=[],pages=0;
  while(current&&pages++<MAX_TREE_PAGES){
   const r=await this.fetcher(current,{signal:AbortSignal.timeout(25000)});
   const rows=await jsonResponse(r,'Model files');
   files.push(...rows.filter(x=>x.type==='file'&&safely(x.path)).map(x=>({path:x.path,size:Number(x.size||x.lfs?.size||0)})));
   const link=r.headers?.get('link')||'';
   const next=link.match(/<([^>]+)>;\s*rel="next"/);
   if(!next)break;
   const u=new URL(next[1],this.hub);
   if(u.origin!==new URL(this.hub).origin)break;
   current=u.toString();
  }
  return files;
 }
 async detail(repo){
  if(!REPO.test(repo))throw Error('Invalid Hugging Face repository');
  const r=await this.fetcher(this.url(repo,'api/models/'),{signal:AbortSignal.timeout(15000)});
  const item=await jsonResponse(r,'Model metadata');
  const revision=/^[0-9a-f]{40}$/.test(item.sha||'')?item.sha:'main';
  const files=await this._tree(repo,revision);
  let readme='';
  try{
   const res=await this.fetcher(this.url(repo,'')+'/raw/'+revision+'/README.md',{signal:AbortSignal.timeout(7000)});
   if(res.ok)readme=(await res.text()).slice(0,14000);
  }catch{}
  const summary=this._summary(item);
  const cleaned=readme.replace(/^---[\s\S]*?---/,'').replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/<[^>]+>/g,' ').split('\n').map(line=>line.trim()).find(line=>line&&!line.startsWith('#')&&!line.startsWith('|')&&!line.startsWith('-')&&!line.startsWith('>')&&!line.startsWith('```'))||'';
  return {...summary,description:summary.description||cleaned.replace(/[*_`[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,500),revision,architecture:item.config?.model_type||item.cardData?.base_model||'',license:item.cardData?.license||'',readme,options:groupsFor(files,item.tags||[],repo)};
 }
 _key(repo,revision,optionId){return createHash('sha256').update(repo+'|'+revision+'|'+optionId).digest('hex').slice(0,24);}
 _view(job){const {controller,promise,...data}=job;return {...data};}
 jobsList(){return [...this.jobs.values()].map(x=>this._view(x));}
 job(id){const x=this.jobs.get(id);if(!x)throw Error('Download job not found');return this._view(x);}
 _dir(id){if(!HEX.test(id))throw Error('Invalid model ID');return path.join(this.root,id);}
 async installed(){
  const entries=await fsp.readdir(this.root,{withFileTypes:true});
  const list=[];
  for(const entry of entries.filter(x=>x.isDirectory()&&HEX.test(x.name))){
   try{const manifest=JSON.parse(await fsp.readFile(path.join(this._dir(entry.name),'manifest.json'),'utf8'));if(manifest.status==='installed')list.push({...manifest,id:entry.name});}catch{}
  }
  return list.sort((a,b)=>String(b.installedAt).localeCompare(String(a.installedAt)));
 }
 async download({repo,optionId}){
  const detail=await this.detail(repo);
  const option=detail.options.find(x=>x.id===optionId);
  if(!option)throw Error('Select an available GGUF or MLX variant');
  if(detail.gated)throw Error('This repository requires Hugging Face access approval');
  if(!option.files.length||!option.bytes)throw Error('No downloadable weight files');
  const id=this._key(repo,detail.revision,option.id);
  const target=this._dir(id);
  try{
   const manifest=JSON.parse(await fsp.readFile(path.join(target,'manifest.json'),'utf8'));
   if(manifest.status==='installed')return {id,status:'installed',repo,optionId,downloaded:option.bytes,total:option.bytes};
  }catch{}
  let job=this.jobs.get(id);
  if(job&&['downloading','resolving'].includes(job.status))return this._view(job);
  if(job?.promise)await job.promise.catch(()=>{});
  job={id,repo,revision:detail.revision,optionId,option,format:option.format,label:option.label,status:'resolving',downloaded:0,total:option.bytes,current:'',error:'',createdAt:new Date().toISOString()};
  this.jobs.set(id,job);
  job.controller=new AbortController();
  job.promise=this._run(job);
  return this._view(job);
 }
 async _run(job){
  try{
   const target=this._dir(job.id);
   await fsp.mkdir(target,{recursive:true,mode:0o700});
   const files=job.option.files;
   const sizes=await this._tree(job.repo,job.revision);
   const known=new Map(sizes.map(x=>[x.path,x.size]));
   job.total=files.reduce((sum,x)=>sum+(known.get(x)||0),0);
   job.downloaded=0;
   for(const name of files){
    if(!safely(name))throw Error('Invalid repository file path');
    const targetFile=path.resolve(target,name);
    if(!targetFile.startsWith(target+path.sep))throw Error('Model path escaped the library');
    const expected=known.get(name)||0;
    let complete=0;
    try{const stat=await fsp.stat(targetFile);if(expected&&stat.size===expected)complete=expected;}catch{}
    job.downloaded+=complete;
    if(!complete){try{const partial=await fsp.stat(targetFile+'.part');job.downloaded+=Math.min(partial.size,expected||partial.size);}catch{}}
   }
   job.status='downloading';
   for(const name of files){
    if(job.controller.signal.aborted)throw Error('Download interrupted');
    job.current=name;
    const expected=known.get(name)||0;
    const dest=path.resolve(target,name);
    await fsp.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
    try{const stat=await fsp.stat(dest);if(expected&&stat.size===expected)continue;}catch{}
    await this._downloadFile(job,name,dest,expected);
   }
   const manifest={status:'installed',repo:job.repo,revision:job.revision,optionId:job.optionId,format:job.format,label:job.label,files,bytes:job.total,installedAt:new Date().toISOString()};
   await fsp.writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2));
   job.status='completed';job.downloaded=job.total;job.current='';
  }catch(e){
   if(!['paused','cancelled'].includes(job.status)){job.status='failed';job.error=String(e.message||e);}
  }
 }
 async _downloadFile(job,name,dest,expected){
  const partial=dest+'.part';
  let offset=0;try{offset=(await fsp.stat(partial)).size;}catch{}
  if(expected&&offset>expected){job.downloaded-=Math.min(offset,expected);await fsp.rm(partial,{force:true});offset=0;}
  if(expected&&offset===expected){await fsp.rename(partial,dest);return;}
  const headers=offset?{Range:'bytes='+offset+'-'}:{};
  const u=this.url(job.repo,'')+'/resolve/'+job.revision+'/'+name.split('/').map(encodeURIComponent).join('/');
  const response=await this.fetcher(u,{headers,signal:job.controller.signal,redirect:'follow'});
  if(!response.ok||(![200,206].includes(response.status)))throw Error('Download HTTP '+response.status+' ('+name+')');
  if(offset&&response.status!==206){job.downloaded-=offset;offset=0;await fsp.rm(partial,{force:true});}
  const range=response.headers?.get('content-range');
  if(offset&&response.status===206&&range&&!range.startsWith('bytes '+offset+'-'))throw Error('Incorrect resume range for '+name);
  const source=response.body;
  if(!source)throw Error('Empty download stream');
  const writer=fs.createWriteStream(partial,{flags:offset?'a':'w'});
  let written=offset;
  try{
   for await(const chunk of source){
    if(job.controller.signal.aborted)throw Error('Download interrupted');
    const buf=Buffer.from(chunk);
    if(!writer.write(buf))await once(writer,'drain');
    written+=buf.length;
    job.downloaded+=buf.length;
   }
   await new Promise((resolve,reject)=>writer.end(err=>err?reject(err):resolve()));
  }catch(e){writer.destroy();throw e;}
  if(expected&&written!==expected)throw Error('Incomplete file '+name+': '+written+'/'+expected);
  await fsp.rename(partial,dest);
 }
 async control(id,action){
  const job=this.jobs.get(id);
  if(!job)throw Error('Download job not found');
  if(action==='pause'||action==='cancel'){
   if(['downloading','resolving'].includes(job.status)){
    job.status=action==='pause'?'paused':'cancelled';
    job.controller.abort();
   }
   return this._view(job);
  }
  if(action==='resume'){
   if(!['paused','failed','cancelled'].includes(job.status))return this._view(job);
   if(job.promise)await job.promise.catch(()=>{});
   job.status='resolving';job.error='';job.controller=new AbortController();job.promise=this._run(job);
   return this._view(job);
  }
  throw Error('Unknown download action');
 }
 async remove(id){
  if(!HEX.test(id))throw Error('Invalid model ID');
  const dir=this._dir(id);
  try{await fsp.access(path.join(dir,'manifest.json'));}catch{throw Error('Model not installed');}
  await fsp.rm(dir,{recursive:true,force:true});return {ok:true};
 }

 async importLocal({filePath}={}){
  const value=String(filePath||'').trim();
  if(!value||value.includes('\0'))throw Error('Select an existing model file or directory on the gateway computer');
  const absolute=path.resolve(value);
  const source=await fsp.stat(absolute);
  let format,files,bytes;
  if(source.isFile()&&/\.gguf$/i.test(absolute)){
   const fd=await fsp.open(absolute,'r');
   try{
    const magic=Buffer.alloc(4);
    const result=await fd.read(magic,0,4,0);
    if(result.bytesRead!==4||magic.toString('ascii')!=='GGUF')throw Error('File is not a valid GGUF container');
   }finally{await fd.close();}
   format='gguf';files=[path.basename(absolute)];bytes=source.size;
  }else if(source.isDirectory()){
   const entries=await fsp.readdir(absolute,{withFileTypes:true});
   if(!entries.some(x=>x.name==='config.json'&&x.isFile())||
      !entries.some(x=>/\.safetensors$/i.test(x.name)&&x.isFile()))
    throw Error('MLX directory requires config.json and .safetensors weights');
   format='mlx';files=entries.filter(x=>x.isFile()&&(/\.safetensors$|\.json$|tokenizer|\.txt$|\.jinja$/i.test(x.name))).map(x=>x.name);
   bytes=0;for(const name of files)bytes+=(await fsp.stat(path.join(absolute,name))).size;
  }else throw Error('Choose a .gguf file or a directory containing MLX weights');
  const id=createHash('sha256').update('external|'+absolute).digest('hex').slice(0,24);
  const folder=this._dir(id);
  await fsp.mkdir(folder,{recursive:true,mode:0o700});
  const manifest={status:'installed',source:'external',externalPath:absolute,
   repo:'Local / '+path.basename(absolute),revision:'local',optionId:'local:'+format,format,
   label:path.basename(absolute),files,bytes,installedAt:new Date().toISOString()};
  await fsp.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2));
  return {...manifest,id};
 }
 async find(id){
  const found=(await this.installed()).find(x=>x.id===id);
  if(!found)throw Error('Installed model not found');
  return {...found,folder:this._dir(id)};
 }
}
export const modelLibrary=new ModelLibrary();
