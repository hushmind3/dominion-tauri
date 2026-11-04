import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {WORKSPACE} from './config.mjs';
import {all,get,put,log} from './store.mjs';
import {secretSet,secretGet,hasSecret} from './vault.mjs';

const jobs=new Map();
const execFileAsync=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const venvPython=dir=>{const candidates=process.platform==='win32'?[path.join(dir,'.venv','Scripts','python.exe')]:[path.join(dir,'.venv','bin','python3'),path.join(dir,'.venv','bin','python')];return candidates.find(file=>fs.existsSync(file))||candidates[0];};
let managedComfyPid=0;

const defaultComfyDir=()=>process.platform==='win32'?'C:\\ComfyUI':path.join(os.homedir(),'ComfyUI');
const cleanDir=value=>path.resolve(expandHome(String(value)).replace(/\/{2,}/g,'/'));
const expandHome=value=>String(value||'').replace(/^~(?=$|[\\/])/,os.homedir());
const invalidComfyDir=value=>{
 const raw=String(value||'');
 if(!raw)return true;
 const windowsPath=/^[A-Za-z]:[\\/]/.test(raw);
 const posixPath=raw.startsWith('/')||raw.startsWith('~');
 return process.platform==='win32'?!posixPath&&!windowsPath:windowsPath;
};
export function videoConfig(){
 const stored=get('video_config','default')||{};
 const engine=['comfyui','openai','custom','huggingface','replicate'].includes(stored.engine)?stored.engine:'comfyui';
 if(stored.comfyDir&&invalidComfyDir(stored.comfyDir)){
  stored.comfyDir=defaultComfyDir();
  put('video_config',{...stored,id:'default'});
 }
 const comfyDir=cleanDir(stored.comfyDir||defaultComfyDir());
 const comfyInstalled=fs.existsSync(path.join(comfyDir,'main.py'));
 return {
  engine,
  videoApiUrl:String(stored.videoApiUrl||'https://api.openai.com/v1').replace(/\/$/,''),
  videoModel:String(stored.videoModel||(engine==='huggingface'?'Wan-AI/Wan2.1-T2V-1.3B':'sora-2')),
  hasVideoKey:engine==='comfyui'?false:hasSecret('video:api'),
  comfyUrl:String(stored.comfyUrl||'http://127.0.0.1:8188').replace(/\/$/,''),
  comfyDir,
  installed:comfyInstalled,
  // Reuse the ComfyUI installation's own folders when it exists, so no path has to be chosen by hand.
  workflowDir:cleanDir(stored.workflowDir||(comfyInstalled?path.join(comfyDir,'user','default','workflows'):path.join(WORKSPACE,'video-workflows'))),
  outputDir:cleanDir(stored.outputDir||(comfyInstalled?path.join(comfyDir,'output'):path.join(os.homedir(),'Videos','DOMINION')))
 };
}
function ensureDirs(config){
 fs.mkdirSync(config.workflowDir,{recursive:true});
 fs.mkdirSync(config.outputDir,{recursive:true});
}
function workflowModel(file){
 try{
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const node of Object.values(data)){
   if(!node||typeof node!=='object')continue;
   if(node.class_type==='UNETLoader'&&node.inputs?.unet_name)return node.inputs.unet_name;
   if(node.class_type==='CheckpointLoaderSimple'&&node.inputs?.ckpt_name)return node.inputs.ckpt_name;
  }
 }catch{}
 return '';
}
export function videoWorkflows(){
 const config=videoConfig();ensureDirs(config);
 return fs.readdirSync(config.workflowDir,{withFileTypes:true}).filter(entry=>entry.isFile()&&/\.json$/i.test(entry.name)).map(entry=>{
  const file=path.join(config.workflowDir,entry.name);
  return {id:entry.name,name:entry.name.replace(/\.json$/i,''),bytes:fs.statSync(file).size,path:file,model:workflowModel(file)};
 }).sort((a,b)=>a.name.localeCompare(b.name));
}
function requiredModels(config,workflows){
 const base='https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files';
 const known={
  'wan2.1_t2v_1.3B_fp16.safetensors':base+'/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors',
  'umt5_xxl_fp8_e4m3fn_scaled.safetensors':base+'/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  'wan_2.1_vae.safetensors':base+'/vae/wan_2.1_vae.safetensors'
 };
 const found=new Map();
 for(const workflow of workflows){
  try{
   const data=JSON.parse(fs.readFileSync(workflow.path,'utf8'));
   for(const node of Object.values(data)){
    if(!node||typeof node!=='object')continue;
    if(node.class_type==='UNETLoader'&&node.inputs?.unet_name)found.set('diffusion:'+node.inputs.unet_name,{type:'diffusion',name:node.inputs.unet_name});
    if(node.class_type==='CLIPLoader'&&node.inputs?.clip_name)found.set('text:'+node.inputs.clip_name,{type:'text_encoder',name:node.inputs.clip_name});
    if(node.class_type==='VAELoader'&&node.inputs?.vae_name)found.set('vae:'+node.inputs.vae_name,{type:'vae',name:node.inputs.vae_name});
   }
  }catch{}
 }
 return [...found.values()].map(item=>{
  const folder=item.type==='diffusion'?'diffusion_models':item.type==='text_encoder'?'text_encoders':'vae';
  const file=path.join(config.comfyDir,'models',folder,item.name);
  const present=fs.existsSync(file);
  let sizeBytes=0;
  if(present){try{sizeBytes=fs.statSync(file).size}catch{}}
  return {...item,path:file,present,sizeBytes,download:known[item.name]||''};
 });
}
function installedVideoModels(config,workflows){
 const folders=[['diffusion_models','diffusion'],['checkpoints','checkpoint'],['unet','unet']];
 const items=[];
 for(const [folder,kind] of folders){
  const dir=path.join(config.comfyDir,'models',folder);
  if(!fs.existsSync(dir))continue;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   if(!entry.isFile()||!/\.(safetensors|ckpt|gguf|pt|pth)$/i.test(entry.name))continue;
   const file=path.join(dir,entry.name);
   let sizeBytes=0;
   try{sizeBytes=fs.statSync(file).size}catch{}
   items.push({name:entry.name,kind,folder,path:file,sizeBytes,usedBy:workflows.filter(workflow=>workflow.model===entry.name).map(workflow=>workflow.name)});
  }
 }
 return items.sort((a,b)=>a.name.localeCompare(b.name));
}
export async function videoStatus(){
 const config=videoConfig();ensureDirs(config);
 let comfy={reachable:false,error:''};
 try{
  const response=await fetch(config.comfyUrl+'/system_stats',{signal:AbortSignal.timeout(3000)});
  if(response.ok){comfy={reachable:true,data:await response.json(),error:''}}
  else comfy.error='HTTP '+response.status;
 }catch(error){comfy.error=String(error?.message||error)}
 const workflows=videoWorkflows();
 const models=requiredModels(config,workflows);
 const installedModels=installedVideoModels(config,workflows);
 return {config,comfy,installed:fs.existsSync(path.join(config.comfyDir,'main.py'))&&fs.existsSync(venvPython(config.comfyDir)),workflows,models,modelsReady:models.length>0&&models.every(model=>model.present),installedModels,jobs:videoJobs().slice(-12)};
}
function revealInShell(args){
 const explorer=path.join(process.env.WINDIR||'C:\\Windows','explorer.exe');
 const child=spawn(explorer,args,{detached:true,windowsHide:true,stdio:'ignore'});
 child.on('error',()=>{});
 child.unref();
}
export function openWorkflowFolder(){
 const dir=videoConfig().workflowDir;
 fs.mkdirSync(dir,{recursive:true});
 if(process.platform==='win32')revealInShell([dir]);
 else if(process.platform==='darwin')execFile('osascript',['-e','tell application "Finder" to open POSIX file "'+dir+'"; activate'],()=>{});
 else spawn('xdg-open',[dir],{detached:true,stdio:'ignore'}).unref();
 return {ok:true,path:dir};
}
export function openModelFolder(){
 const models=path.join(videoConfig().comfyDir,'models');
 fs.mkdirSync(models,{recursive:true});
 if(process.platform==='win32')revealInShell([models]);
 else if(process.platform==='darwin')execFile('osascript',['-e','tell application "Finder" to open POSIX file "'+models+'"; activate'],()=>{});
 else spawn('xdg-open',[models],{detached:true,stdio:'ignore'}).unref();
 return {ok:true,path:models};
}
export async function startComfyUI(){
 const config=videoConfig();
 try{const response=await fetch(config.comfyUrl+'/system_stats',{signal:AbortSignal.timeout(1500)});if(response.ok)return {started:false,already:true}}catch{}
 const python=venvPython(config.comfyDir);
 const main=path.join(config.comfyDir,'main.py');
 if(!fs.existsSync(python)||!fs.existsSync(main))throw Error('ComfyUI가 '+config.comfyDir+'에 설치되어 있지 않습니다.');
 const port=new URL(config.comfyUrl).port||'8188';
 const logFile=path.join(config.comfyDir,'comfyui.log');
 const logFd=fs.openSync(logFile,'a');
 const child=spawn(python,[main,'--listen','127.0.0.1','--port',port,'--lowvram','--preview-method','none'],{cwd:config.comfyDir,detached:true,windowsHide:true,stdio:['ignore',logFd,logFd]});
 fs.closeSync(logFd);
 child.unref();
 managedComfyPid=child.pid||0;
 put('video_config',{id:'default',...config,managedByApp:true,managedPid:managedComfyPid});
 log('video.comfy_started',{pid:child.pid,port});
 return {started:true,pid:child.pid,port};
}
function activeVideoJobs(){return videoJobs().filter(job=>['queued','running','downloading'].includes(job.status))}
async function comfyListenerPids(port){
 const pids=new Set();
 if(process.platform==='win32'){
  const {stdout}=await execFileAsync('netstat',['-ano','-p','tcp'],{windowsHide:true,maxBuffer:4*1024*1024});
  for(const line of stdout.split(/\r?\n/)){
   const cols=line.trim().split(/\s+/);
   if(String(cols[0]).toUpperCase()!=='TCP'||String(cols[3]).toUpperCase()!=='LISTENING')continue;
   const match=String(cols[1]||'').match(/:(\d+)$/);
   if(match&&Number(match[1])===Number(port)&&Number(cols[4]))pids.add(Number(cols[4]));
  }
 }else{
  try{const {stdout}=await execFileAsync('lsof',['-ti',`tcp:${port}`,'-sTCP:LISTEN']);for(const line of stdout.split(/\r?\n/))if(line.trim())pids.add(Number(line.trim()))}catch{}
 }
 return [...pids];
}
export async function stopComfyUI(options={}){
 if(!options.force&&activeVideoJobs().length)throw Error('생성 중인 작업이 있습니다. 작업이 끝난 뒤 종료하세요.');
 const config=videoConfig();
 const stored=get('video_config','default')||{};
 if(options.onlyManaged&&!stored.managedByApp)return {stopped:false,skipped:true,message:'앱에서 시작한 ComfyUI가 아닙니다.'};
 const port=Number(new URL(config.comfyUrl).port||8188);
 const pids=await comfyListenerPids(port);
 for(const pid of pids){
  try{
   if(process.platform==='win32')await execFileAsync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true});
   else process.kill(pid,'SIGTERM');
  }catch{}
 }
 if(managedComfyPid&&!pids.includes(managedComfyPid)){try{process.kill(managedComfyPid)}catch{}}
 for(let i=0;i<24;i++){
  try{const response=await fetch(config.comfyUrl+'/system_stats',{signal:AbortSignal.timeout(700)});if(!response.ok)break}catch{return finishStop(stored,pids.length)}
  await sleep(250);
 }
 return finishStop(stored,pids.length);
}
function finishStop(stored,count){
 managedComfyPid=0;
 try{put('video_config',{...stored,id:'default',managedByApp:false,managedPid:0})}catch{}
 log('video.comfy_stopped',{pids:count});
 return {stopped:true,pids:count};
}
export function saveVideoConfig(input={}){
 const current=videoConfig();
 const next={...current,...input};
 if(typeof input.videoApiKey==='string'&&input.videoApiKey.trim())secretSet('video:api',input.videoApiKey.trim());
 if(input.engine&&['comfyui','openai','custom','huggingface','replicate'].includes(input.engine))next.engine=input.engine;
 if(input.videoApiUrl)next.videoApiUrl=String(input.videoApiUrl).replace(/\/$/,'');
 if(input.videoModel)next.videoModel=String(input.videoModel);
 delete next.videoApiKey;
 if(input.comfyDir)next.comfyDir=cleanDir(input.comfyDir);
 if(input.workflowDir)next.workflowDir=cleanDir(input.workflowDir);
 if(input.outputDir)next.outputDir=cleanDir(input.outputDir);
 if(input.comfyUrl){
  const parsed=new URL(String(input.comfyUrl));
  if(!['http:','https:'].includes(parsed.protocol))throw Error('ComfyUI URL must be HTTP(S)');
  next.comfyUrl=parsed.toString().replace(/\/$/,'');
 }
 ensureDirs(next);
 put('video_config',{id:'default',...next});
 log('video.config_saved',{comfyUrl:next.comfyUrl,workflowDir:next.workflowDir});
 return videoStatus();
}
function replaceTokens(value,tokens){
 if(typeof value==='string'){
  const exact=value.match(/^\{\{\s*(width|height|frames|fps|seed)\s*\}\}$/i);
  if(exact)return tokens[exact[1].toLowerCase()];
  return value.replace(/\{\{\s*(prompt|negative|width|height|frames|fps|seed)\s*\}\}/gi,(_match,key)=>String(tokens[key.toLowerCase()]??''));
 }
 if(Array.isArray(value))return value.map(item=>replaceTokens(item,tokens));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replaceTokens(item,tokens)]));
 return value;
}
function hasPromptToken(value){
 if(typeof value==='string')return /\{\{\s*prompt\s*\}\}/i.test(value);
 if(Array.isArray(value))return value.some(hasPromptToken);
 if(value&&typeof value==='object')return Object.values(value).some(hasPromptToken);
 return false;
}
function findOutput(history){
 const outputs=history?.outputs||{};
 for(const node of Object.values(outputs)){
  for(const key of ['videos','gifs','images']){
   const file=(node?.[key]||[]).find(item=>/\.(mp4|webm|mov|gif|webp)$/i.test(item.filename||''));
   if(file)return {filename:file.filename,subfolder:file.subfolder||'',type:file.type||'output'};
  }
 }
 return null;
}
function slugify(value){
 return String(value||'').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,48)||'video';
}
function workflowFile(name){
 const config=videoConfig();ensureDirs(config);
 const file=path.resolve(config.workflowDir,String(name||''));
 if(!file.startsWith(config.workflowDir+path.sep)||!fs.existsSync(file))throw Error('Workflow file not found');
 return file;
}
function providerKeyFor(baseUrl){
 const target=String(baseUrl||'').replace(/\/$/,'');
 const match=all('provider').find(x=>String(x.baseUrl||'').replace(/\/$/,'')===target&&x.enabled);
 return match?String(secretGet('provider:'+match.id)||''):'';
}
function videoApiKey(config){return String(secretGet('video:api')||'')||providerKeyFor(config.videoApiUrl)}
async function apiRequest(config,pathname,options={}){
 const response=await fetch(config.videoApiUrl+pathname,{...options,headers:{Authorization:'Bearer '+videoApiKey(config),...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})},signal:AbortSignal.timeout(120000)});
 const text=await response.text();
 if(!response.ok)throw Error('영상 API '+response.status+': '+text.slice(0,400));
 try{return JSON.parse(text)}catch{return {}}
}
async function startHfVideoJob(input,config){
 const token=String(secretGet('video:api')||'');
 if(!token)throw Error('Hugging Face 토큰을 먼저 등록하세요.');
 const prompt=String(input.prompt||'').trim();
 if(!prompt)throw Error('영상 프롬프트를 입력하세요.');
 const now=new Date(),pad=value=>String(value).padStart(2,'0');
 const stamp=now.getFullYear()+pad(now.getMonth()+1)+pad(now.getDate())+'-'+pad(now.getHours())+pad(now.getMinutes());
 const job={id:crypto.randomUUID(),status:'running',progress:10,engine:'huggingface',workflow:'',title:String(input.title||prompt).slice(0,100),prompt:prompt.slice(0,300),
  width:Number(input.width)||720,height:Number(input.height)||1280,frames:0,fps:0,seed:0,seconds:Number(input.seconds)||4,
  filenameBase:stamp+'-'+slugify(String(input.title||prompt)),createdAt:new Date().toISOString()};
 jobs.set(job.id,job);put('video_job',job);
 try{
  const response=await fetch('https://api-inference.huggingface.co/models/'+config.videoModel,{
   method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','x-wait-for-model':'true'},
   body:JSON.stringify({inputs:prompt,parameters:{num_frames:Math.max(16,Math.round((Number(input.seconds)||4)*8))}}),
   signal:AbortSignal.timeout(10*60*1000)});
  if(!response.ok){
   let detail='';try{detail=JSON.stringify(await response.json()).slice(0,300)}catch{}
   throw Error('Hugging Face '+response.status+' '+detail);
  }
  const type=response.headers.get('content-type')||'';
  if(/json/i.test(type))throw Error('모델이 영상을 반환하지 않았습니다: '+(await response.text()).slice(0,200));
  const filename=job.filenameBase+'.mp4';
  const target=path.join(config.outputDir,filename);
  await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(target));
  job.status='completed';job.progress=100;job.filename=filename;job.path=target;job.bytes=fs.statSync(target).size;
  put('video_job',job);
  return job;
 }catch(error){job.status='failed';job.error=String(error?.message||error);put('video_job',job);throw error;}
}
async function startReplicateVideoJob(input,config){
 const token=String(secretGet('video:api')||'');
 if(!token)throw Error('Replicate API 토큰을 먼저 등록하세요.');
 const prompt=String(input.prompt||'').trim();
 if(!prompt)throw Error('영상 프롬프트를 입력하세요.');
 const model=String(config.videoModel||'').trim();
 if(!/^[\w.-]+\/[\w.-]+$/.test(model))throw Error('Replicate 모델을 owner/name 형식으로 입력하세요.');
 const now=new Date(),pad=v=>String(v).padStart(2,'0');
 const stamp=now.getFullYear()+pad(now.getMonth()+1)+pad(now.getDate())+'-'+pad(now.getHours())+pad(now.getMinutes());
 const job={id:crypto.randomUUID(),status:'running',progress:10,engine:'replicate',workflow:'',title:String(input.title||prompt).slice(0,100),prompt:prompt.slice(0,300),
  width:Number(input.width)||720,height:Number(input.height)||1280,frames:0,fps:0,seed:0,seconds:Number(input.seconds)||4,
  filenameBase:stamp+'-'+slugify(String(input.title||prompt)),createdAt:new Date().toISOString()};
 jobs.set(job.id,job);put('video_job',job);
 try{
  const created=await fetch('https://api.replicate.com/v1/models/'+model+'/predictions',{method:'POST',
   headers:{Authorization:'Token '+token,'Content-Type':'application/json','Prefer':'wait=5'},
   body:JSON.stringify({input:{prompt}}),signal:AbortSignal.timeout(120000)});
  const data=await created.json();
  if(!created.ok)throw Error('Replicate '+(data.detail||created.status));
  job.remoteId=data.id||'';
  put('video_job',job);
  void pollReplicateVideoJob(job,config,token);
  return job;
 }catch(error){job.status='failed';job.error=String(error?.message||error);put('video_job',job);throw error;}
}
async function pollReplicateVideoJob(job,config,token){
 const started=Date.now();
 while(Date.now()-started<45*60*1000){
  await sleep(5000);
  try{
   const response=await fetch('https://api.replicate.com/v1/predictions/'+job.remoteId,{headers:{Authorization:'Token '+token},signal:AbortSignal.timeout(30000)});
   const data=await response.json();
   if(data.status==='failed'||data.status==='canceled'){job.status='failed';job.error=String(data.error||'생성 실패');put('video_job',job);return}
   if(data.status==='succeeded'){
    const output=Array.isArray(data.output)?data.output[0]:data.output;
    if(!output)throw Error('결과 URL이 없습니다');
    const file=await fetch(output,{signal:AbortSignal.timeout(300000)});
    if(!file.ok)throw Error('결과 다운로드 HTTP '+file.status);
    const filename=job.filenameBase+'.mp4';
    const target=path.join(config.outputDir,filename);
    await pipeline(Readable.fromWeb(file.body),fs.createWriteStream(target));
    job.status='completed';job.progress=100;job.filename=filename;job.path=target;job.bytes=fs.statSync(target).size;
    put('video_job',job);return;
   }
   job.progress=Math.min(90,(job.progress||10)+3);put('video_job',job);
  }catch(error){job.error=String(error?.message||error);put('video_job',job);}
 }
 job.status='failed';job.error='시간 초과';put('video_job',job);
}
async function startApiVideoJob(input,config){
 if(!videoApiKey(config))throw Error('영상 엔진 API 키를 먼저 등록하거나 모델 제공자를 연결하세요.');
 const prompt=String(input.prompt||'').trim();
 if(!prompt)throw Error('영상 프롬프트를 입력하세요.');
 const width=Number(input.width)||720,height=Number(input.height)||1280;
 const seconds=Math.max(1,Math.min(60,Number(input.seconds)||4));
 const now=new Date(),pad=value=>String(value).padStart(2,'0');
 const stamp=now.getFullYear()+pad(now.getMonth()+1)+pad(now.getDate())+'-'+pad(now.getHours())+pad(now.getMinutes());
 const job={id:crypto.randomUUID(),status:'queued',progress:0,engine:config.engine,workflow:'',title:String(input.title||prompt).slice(0,100),prompt:prompt.slice(0,300),width,height,seconds,fps:0,frames:0,seed:0,
  filenameBase:stamp+'-'+slugify(String(input.title||prompt)),createdAt:new Date().toISOString()};
 jobs.set(job.id,job);put('video_job',job);
 try{
  const created=await apiRequest(config,'/videos',{method:'POST',body:JSON.stringify({model:config.videoModel,prompt,size:width+'x'+height,seconds})});
  job.remoteId=created.id||'';
  job.status=created.status==='completed'?'completed':'running';
  put('video_job',job);
  if(job.status!=='completed')void pollApiVideoJob(job,config);
  return job;
 }catch(error){job.status='failed';job.error=String(error?.message||error);put('video_job',job);throw error;}
}
async function pollApiVideoJob(job,config){
 const started=Date.now();
 while(Date.now()-started<45*60*1000){
  await sleep(5000);
  try{
   const state=await apiRequest(config,'/videos/'+encodeURIComponent(job.remoteId));
   const status=String(state.status||'').toLowerCase();
   if(state.progress!==undefined)job.progress=Number(state.progress)||job.progress;
   if(status==='failed'||status==='cancelled'){job.status='failed';job.error=state.error?.message||'영상 생성 실패';put('video_job',job);return}
   if(status==='completed'){
    const response=await fetch(config.videoApiUrl+'/videos/'+encodeURIComponent(job.remoteId)+'/content',{headers:{Authorization:'Bearer '+String(secretGet('video:api')||'')},signal:AbortSignal.timeout(300000)});
    if(!response.ok)throw Error('영상 다운로드 HTTP '+response.status);
    const filename=job.filenameBase+'.mp4';
    const target=path.join(config.outputDir,filename);
    await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(target));
    job.status='completed';job.progress=100;job.filename=filename;job.path=target;job.bytes=fs.statSync(target).size;
    put('video_job',job);return;
   }
   job.status='running';put('video_job',job);
  }catch(error){job.error=String(error?.message||error);put('video_job',job);}
 }
 job.status='failed';job.error='영상 생성 시간 초과';put('video_job',job);
}
export async function startVideoJob(input={}){
 const config=videoConfig();ensureDirs(config);
 if(config.engine==='huggingface')return startHfVideoJob(input,config);
 if(config.engine==='replicate')return startReplicateVideoJob(input,config);
 if(config.engine!=='comfyui')return startApiVideoJob(input,config);
 const file=workflowFile(input.workflow);
 const raw=JSON.parse(await fsp.readFile(file,'utf8'));
 if(!hasPromptToken(raw))throw Error('이 워크플로에는 {{prompt}} 자리표시자가 없습니다. ComfyUI에서 API 형식으로 저장한 JSON에 {{prompt}}, {{negative}}, {{width}}, {{height}}, {{frames}}, {{fps}}, {{seed}}를 넣어주세요.');
 const width=Number(input.width)||720,height=Number(input.height)||1280;
 const fps=Math.max(1,Math.min(60,Number(input.fps)||16));
 const seconds=Math.max(1,Math.min(9,Number(input.seconds)||4));
 const requestedFrames=Number(input.frames)||Math.round(fps*seconds);
 const frames=Math.max(1,Math.min(600,input.frames?requestedFrames:1+Math.max(0,Math.round((requestedFrames-1)/4))*4));
 const seed=Number.isFinite(Number(input.seed))&&Number(input.seed)>=0?Math.floor(Number(input.seed)):Math.floor(Math.random()*1e9);
 const workflow=replaceTokens(raw,{prompt:String(input.prompt||'').trim(),negative:String(input.negative||'').trim(),width,height,frames,fps,seed});
 const now=new Date(),pad=value=>String(value).padStart(2,'0');
 const stamp=now.getFullYear()+pad(now.getMonth()+1)+pad(now.getDate())+'-'+pad(now.getHours())+pad(now.getMinutes());
 const title=String(input.title||input.prompt||'영상').trim().slice(0,100);
 const job={id:crypto.randomUUID(),status:'queued',progress:0,workflow:path.basename(file),title,prompt:String(input.prompt||'').slice(0,300),width,height,frames,fps,seconds,seed,filenameBase:stamp+'-'+slugify(title),createdAt:new Date().toISOString(),error:'',result:null};
 jobs.set(job.id,job);put('video_job',job);
 const clientId=crypto.randomUUID();
 try{
  const response=await fetch(config.comfyUrl+'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:workflow,client_id:clientId}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok)throw Error('ComfyUI '+response.status+': '+JSON.stringify(data).slice(0,700));
  job.status='running';job.promptId=data.prompt_id;put('video_job',job);
  void pollJob(job,config);
  return job;
 }catch(error){
  job.status='failed';job.error=String(error?.message||error);put('video_job',job);throw error;
 }
}
async function pollJob(job,config){
 const deadline=Date.now()+20*60*1000;
 while(Date.now()<deadline){
  await sleep(2500);
  if(job.status==='cancelled')return;
  try{
   const response=await fetch(config.comfyUrl+'/history/'+encodeURIComponent(job.promptId),{signal:AbortSignal.timeout(10000)});
   if(!response.ok)continue;
   const data=await response.json();
   const entry=data[job.promptId];
   if(!entry)continue;
   const output=findOutput(entry);
   if(output){
    job.status='downloading';put('video_job',job);
    const remote=config.comfyUrl+'/view?'+new URLSearchParams({filename:output.filename,subfolder:output.subfolder,type:output.type}).toString();
    const filename=(job.filenameBase||job.id)+'-'+job.id.slice(0,6)+path.extname(output.filename);
    const local=path.join(config.outputDir,filename);
    const download=await fetch(remote,{signal:AbortSignal.timeout(120000)});
    if(!download.ok||!download.body)throw Error('결과 다운로드 실패: HTTP '+download.status);
    await pipeline(Readable.fromWeb(download.body),fs.createWriteStream(local));
    job.status='completed';job.progress=100;
    job.result={file:local,filename,url:'/api/video/files/'+encodeURIComponent(filename),remote};
    put('video_job',job);
    log('video.completed',{id:job.id,file:local});
    return;
   }
   if(entry.status?.status_str==='error'||entry.status?.completed===false&&entry.status?.messages?.some(message=>String(message?.[0]).includes('error')))throw Error('ComfyUI 실행 오류');
  }catch(error){
   if(job.status==='downloading'){job.status='failed';job.error=String(error?.message||error);put('video_job',job);return}
  }
 }
 job.status='failed';job.error='영상 생성 시간이 초과되었습니다 (20분)';put('video_job',job);
}
export function openVideoFile(file){
 const config=videoConfig();
 const target=path.resolve(String(file||''));
 if(!target.startsWith(config.outputDir+path.sep)||!fs.existsSync(target))throw Error('Video file not found');
 if(process.platform==='win32')revealInShell(['/select,'+target]);
 else if(process.platform==='darwin')spawn('open',['-R',target],{detached:true,stdio:'ignore'}).unref();
 else spawn('xdg-open',[path.dirname(target)],{detached:true,stdio:'ignore'}).unref();
 return {ok:true,path:target};
}
export function videoJob(id){return jobs.get(String(id||''))||get('video_job',String(id||''))||null}
export function videoJobs(){return all('video_job').sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))).slice(-20)}


// Hugging Face video-model discovery for the in-app model picker.
export async function searchVideoModels({q='',limit=30}={}){
 const url=new URL('https://huggingface.co/api/models');
 url.searchParams.set('search',String(q||'wan').slice(0,80));
 url.searchParams.set('limit',String(Math.min(60,Math.max(6,Number(limit)||30))));
 url.searchParams.set('sort','downloads');
 url.searchParams.set('direction','-1');
 const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Hugging Face HTTP '+response.status);
 const rows=await response.json();
 return (Array.isArray(rows)?rows:[]).filter(x=>/video/i.test([x.pipeline_tag,...(x.tags||[])].join(' ')))
  .map(x=>({id:x.id,downloads:x.downloads||0,likes:x.likes||0,pipeline:x.pipeline_tag||'',
   url:'https://huggingface.co/'+x.id,tags:(x.tags||[]).filter(t=>/video|wan|ltx|hunyuan/i.test(t)).slice(0,4)}));
}


// --- Hugging Face video model browser + downloader -------------------------
const videoDownloads=new Map();
export async function videoRepoFiles(repo){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo||'')))throw Error('Invalid repository');
 const response=await fetch('https://huggingface.co/api/models/'+repo+'/tree/main?recursive=true',{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Hugging Face HTTP '+response.status);
 const rows=await response.json();
 return (Array.isArray(rows)?rows:[]).filter(x=>x.type==='file'&&/\.(safetensors|gguf|ckpt|pt|bin)$/i.test(x.path))
  .map(x=>({path:x.path,size:Number(x.size||x.lfs?.size||0)})).sort((a,b)=>b.size-a.size).slice(0,40);
}
export function videoDownloadJob(id){return videoDownloads.get(String(id||''))||null}
export function videoDownloadsList(){return [...videoDownloads.values()].slice(-20)}
export function startVideoDownload({repo,file}={}){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo||'')))throw Error('Invalid repository');
 if(!file||String(file).includes('..'))throw Error('Invalid file');
 const config=videoConfig();
 const modelsDir=path.join(config.comfyDir,'models');
 fs.mkdirSync(modelsDir,{recursive:true});
 const name=path.basename(String(file));
 const target=path.join(modelsDir,name);
 const id=crypto.randomUUID();
 const job={id,repo:String(repo),file:String(file),name,path:target,status:'downloading',downloaded:0,total:0,error:'',startedAt:new Date().toISOString()};
 videoDownloads.set(id,job);
 (async()=>{
  try{
   const response=await fetch('https://huggingface.co/'+job.repo+'/resolve/main/'+job.file.split('/').map(encodeURIComponent).join('/'),{signal:AbortSignal.timeout(60*60*1000)});
   if(!response.ok||!response.body)throw Error('다운로드 HTTP '+response.status);
   job.total=Number(response.headers.get('content-length')||0);
   const temp=target+'.part';
   const out=fs.createWriteStream(temp);
   const reader=Readable.fromWeb(response.body);
   let downloaded=0;
   reader.on('data',chunk=>{downloaded+=chunk.length;job.downloaded=downloaded;});
   await pipeline(reader,out);
   fs.renameSync(temp,target);
   job.status='completed';job.downloaded=job.total||downloaded;job.bytes=fs.statSync(target).size;put('video_model_download',{...job});
  }catch(error){job.status='failed';job.error=String(error?.message||error);}
 })();
 return job;
}


// Auto-discover generated videos so the upload form never needs a typed path.
export function videoOutputs(){
 const config=videoConfig();
 fs.mkdirSync(config.outputDir,{recursive:true});
 let rows=[];
 try{rows=fs.readdirSync(config.outputDir,{withFileTypes:true});}catch{return []}
 return rows.filter(x=>x.isFile()&&/\.(mp4|mov|webm|mkv|m4v)$/i.test(x.name))
  .map(x=>{const full=path.join(config.outputDir,x.name);const stat=fs.statSync(full);return {file:full,name:x.name,bytes:stat.size,modified:stat.mtime.toISOString()}})
  .sort((a,b)=>b.modified.localeCompare(a.modified)).slice(0,50);
}


// Candidate folders so the UI can offer a dropdown instead of typed paths.
export function videoLocations(){
 const home=os.homedir();
 const comfyCandidates=[path.join(home,'ComfyUI'),path.join(home,'Documents','ComfyUI'),path.join(home,'Applications','ComfyUI'),path.join(home,'ComfyUI_windows_portable','ComfyUI'),'C:\\ComfyUI','/Applications/ComfyUI.app/Contents/Resources/ComfyUI'];
 const comfy=[...new Set(comfyCandidates.filter(dir=>{try{return fs.existsSync(path.join(dir,'main.py'))}catch{return false}}))];
 const config=videoConfig();
 const workflows=[...new Set([config.workflowDir,...comfy.map(dir=>path.join(dir,'user','default','workflows')),path.join(WORKSPACE,'video-workflows'),path.join(home,'Documents','DOMINION Workspace','video-workflows')].filter(Boolean))];
 const outputs=[...new Set([config.outputDir,...comfy.map(dir=>path.join(dir,'output')),path.join(home,'Videos','DOMINION'),path.join(home,'Movies','DOMINION')].filter(Boolean))];
 return {comfy,workflows,outputs,current:{comfyDir:config.comfyDir,workflowDir:config.workflowDir,outputDir:config.outputDir}};
}


// Unified model list: everything already connected in Model Management.
const videoModelCache={at:0,items:[]};
const VIDEO_MODEL=/sora|veo\b|\bwan|ltx|kling|luma|runway|pika|hunyuan|hailuo|seedance|cogvideo|mochi|t2v|i2v|video/i;
export async function videoModelOptions(){
 if(Date.now()-videoModelCache.at<60000&&videoModelCache.items.length)return videoModelCache.items;
 const items=[];
 for(const provider of all('provider').filter(x=>x.enabled)){
  try{
   const response=await fetch(provider.baseUrl.replace(/\/$/,'')+'/models',{headers:{...(hasSecret('provider:'+provider.id)?{Authorization:'Bearer '+secretGet('provider:'+provider.id)}:{})},signal:AbortSignal.timeout(6000)});
   if(!response.ok)continue;
   const data=await response.json();
   for(const model of (data.data||[]).slice(0,80)){
    const id=String(model.id||'');
    if(!id||!VIDEO_MODEL.test(id))continue;
    items.push({value:provider.id+'::'+id,label:provider.name+' · '+id,provider:provider.id,model:id,baseUrl:provider.baseUrl});
   }
  }catch{}
 }
 try{
  for(const model of await searchVideoModels({q:'wan',limit:20}))items.push({value:'huggingface::'+model.id,label:'Hugging Face · '+model.id,provider:'huggingface',model:model.id,baseUrl:''});
 }catch{}
 videoModelCache.at=Date.now();videoModelCache.items=items;
 return items;
}
