import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import {createTwoFilesPatch} from 'diff';
import {DATA,PORT,ROOT} from './config.mjs';
import {get,put,log} from './store.mjs';

const jobs=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const defaultSource=path.join(os.homedir(),'DOMINION Source','dominion');
let preview={status:'stopped',url:'',pid:0,port:0,error:'',logs:[]};
let previewChild=null;

export function devConfig(){
 const stored=get('dev_config','default')||{};
 return {
  sourceDir:path.resolve(String(stored.sourceDir||defaultSource)),
  repoUrl:String(stored.repoUrl||'https://github.com/hushmind3/dominion.git'),
  branch:String(stored.branch||'main'),
  previewPort:Number(stored.previewPort)||5174,
  autoCommit:Boolean(stored.autoCommit)
 };
}
function insideInstalledApp(dir){
 const resources=String(process.resourcesPath||'').trim();
 if(!resources)return false;
 const root=path.resolve(resources);
 return dir===root||dir.startsWith(root+path.sep);
}
export function saveDevConfig(input={}){
 const current=devConfig();
 const next={...current,...input};
 if(input.sourceDir){
  const resolved=path.resolve(String(input.sourceDir));
  if(!path.isAbsolute(resolved))throw Error('소스 폴더는 절대 경로여야 합니다.');
  if(insideInstalledApp(resolved))throw Error('설치된 앱 리소스 폴더는 소스 작업공간으로 사용할 수 없습니다.');
  next.sourceDir=resolved;
 }
 if(input.repoUrl){
  const url=new URL(String(input.repoUrl));
  if(!['http:','https:'].includes(url.protocol))throw Error('저장소 URL은 HTTP(S)여야 합니다.');
  next.repoUrl=url.toString().replace(/\/$/,'');
 }
 next.branch=String(next.branch||'main').trim()||'main';
 next.previewPort=Math.max(1024,Math.min(65535,Number(next.previewPort)||5174));
 put('dev_config',{id:'default',...next});
 log('dev.config',{sourceDir:next.sourceDir,repoUrl:next.repoUrl,branch:next.branch});
 return next;
}
function sourcePath(relative=''){
 const base=devConfig().sourceDir;
 const dest=path.resolve(base,String(relative||''));
 if(dest!==base&&!dest.startsWith(base+path.sep))throw Error('소스 작업공간 밖의 경로입니다.');
 return dest;
}
async function assertNoSymlink(target){
 let current=target;
 while(current!==path.dirname(current)){
  try{const stat=await fsp.lstat(current);if(stat.isSymbolicLink())throw Error('심볼릭 링크 경로는 사용할 수 없습니다.');}catch(error){if(error.code!=='ENOENT')throw error;}
  current=path.dirname(current);
 }
}
async function packageInfo(dir){
 try{const data=JSON.parse(await fsp.readFile(path.join(dir,'package.json'),'utf8'));return {version:data.version||'',name:data.name||''};}catch{return {version:'',name:''};}
}
async function changedRows(dir){
 const matrix=await git.statusMatrix({fs,dir});
 const rows=[];
 let headOid='';
 try{headOid=await git.resolveRef({fs,dir,ref:'HEAD'})}catch{}
 for(const row of matrix){
  const [filepath,head,workdir,stage]=row;
  if(head===workdir&&workdir===stage)continue;
  if(await git.isIgnored({fs,dir,filepath}).catch(()=>false))continue;
  if(head!==0&&workdir!==0&&headOid){
   try{
    const blob=await git.readBlob({fs,dir,oid:headOid,filepath});
    const before=Buffer.from(blob.blob),after=await fsp.readFile(path.join(dir,filepath));
    if(!before.includes(0)&&!after.includes(0)&&before.toString('utf8').replace(/\r\n/g,'\n')===after.toString('utf8').replace(/\r\n/g,'\n'))continue;
    if(before.equals(after))continue;
   }catch{}
  }
  rows.push(row);
 }
 return rows;
}
async function gitInfo(dir){
 if(!fs.existsSync(path.join(dir,'.git')))return {git:false,branch:'',commit:'',remote:'',dirty:0};
 try{
  const branch=await git.currentBranch({fs,dir,fullname:false})||'';
  const log=await git.log({fs,dir,depth:1});
  const remote=await git.getConfig({fs,dir,path:'remote.origin.url'}).catch(()=>'');
  const dirty=(await changedRows(dir)).length;
  return {git:true,branch,commit:log[0]?.oid||'',remote:remote||'',dirty};
 }catch(error){return {git:false,branch:'',commit:'',remote:'',dirty:0,error:String(error?.message||error)};}
}
export async function devStatus(){
 const config=devConfig();
 const exists=fs.existsSync(config.sourceDir);
 const info=exists?await packageInfo(config.sourceDir):{version:'',name:''};
 const gitState=exists?await gitInfo(config.sourceDir):{git:false,branch:'',commit:'',remote:'',dirty:0};
 const nodeModules=exists&&fs.existsSync(path.join(config.sourceDir,'node_modules'));
 const installer=await latestInstaller();
 return {
  config,exists,nodeModules,...info,...gitState,preview:{...preview,logs:preview.logs.slice(-80)},installer,
  platform:process.platform,arch:process.arch,appRoot:ROOT,installedExe:process.execPath
 };
}
export async function connectOrClone(input={}){
 const config=saveDevConfig(input);
 const dir=config.sourceDir;
 if(fs.existsSync(dir)&&fs.existsSync(path.join(dir,'package.json'))){
  log('dev.connect',{dir});
  return {cloned:false,...await devStatus()};
 }
 if(fs.existsSync(dir)){
  const entries=await fsp.readdir(dir);
  if(entries.length)throw Error('대상 폴더가 비어 있지 않고 DOMINION 소스도 아닙니다: '+dir);
 }
 await fsp.mkdir(path.dirname(dir),{recursive:true});
 log('dev.clone.start',{dir,repoUrl:config.repoUrl,branch:config.branch});
 await git.clone({fs,http,dir,url:config.repoUrl,ref:config.branch,singleBranch:true,depth:1});
 log('dev.clone.done',{dir});
 return {cloned:true,...await devStatus()};
}
function npmCli(){return path.join(ROOT,'node_modules','npm','bin','npm-cli.js');}
function nodeShimDir(){
 const dir=path.join(DATA,'bin');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const shim=path.join(dir,process.platform==='win32'?'node.cmd':'node');
 try{
  if(process.platform==='win32')fs.writeFileSync(shim,'@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"'+process.execPath+'" %*\r\n');
  else fs.writeFileSync(shim,'#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "'+process.execPath+'" "$@"\n',{mode:0o755});
 }catch{}
 return dir;
}
function devEnv(){
 const shim=nodeShimDir();
 const env={...process.env};
 for(const key of ['DOMINION_DATA','DOMINION_WORKSPACE','DOMINION_PORT','DOMINION_HOST','DOMINION_VERSION','DOMINION_ADMIN_TOKEN'])delete env[key];
 return {...env,ELECTRON_RUN_AS_NODE:'1',ELECTRON_NO_ASAR:'1',PATH:shim+path.delimiter+String(process.env.PATH||process.env.Path||''),npm_config_cache:path.join(DATA,'npm-cache'),npm_config_prefix:path.join(DATA,'npm-global'),npm_config_update_notifier:'false',DOMINION_DATA:path.join(DATA,'dev-run','data'),DOMINION_WORKSPACE:path.join(DATA,'dev-run','workspace'),DOMINION_PORT:'4318',DOMINION_HOST:'127.0.0.1'};
}
function runProcess(command,args,{cwd,onLog,timeout=900000,env:extraEnv}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,env:{...devEnv(),...extraEnv},stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
  let output='',settled=false;
  const append=data=>{const text=String(data);output=(output+text).slice(-120000);for(const line of text.split(/\r?\n/))if(line.trim())onLog?.(line.slice(0,2000));};
  child.stdout?.on('data',append);child.stderr?.on('data',append);
  const timer=setTimeout(()=>{if(settled)return;settled=true;stopTree(child);reject(Error('명령 시간 초과: '+command+' '+args.join(' ')));},timeout);timer.unref?.();
  child.on('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
  child.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);if(code===0)resolve({code,output});else reject(Error('명령 실패 ('+code+'): '+output.slice(-3000)));});
 });
}
function stopTree(child){
 if(!child?.pid)return;
 try{
  if(process.platform==='win32')spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
  else process.kill(-child.pid,'SIGTERM');
 }catch{}
}
function addLog(job,line){
 job.logs.push(String(line).slice(0,4000));
 if(job.logs.length>1200)job.logs.splice(0,job.logs.length-1200);
}
export function beginDevJob(kind,work){
 const job={id:crypto.randomUUID(),kind,status:'running',progress:0,logs:[],error:'',result:null,createdAt:new Date().toISOString(),finishedAt:''};
 jobs.set(job.id,job);
 void (async()=>{
  try{job.result=await work(line=>addLog(job,line));job.status='completed';job.progress=100;}
  catch(error){job.status='failed';job.error=String(error?.message||error);addLog(job,'ERROR: '+job.error);}
  finally{job.finishedAt=new Date().toISOString();}
 })();
 return job;
}
export function devJob(id){return jobs.get(String(id||''))||null;}
export function devJobs(){return [...jobs.values()].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,30);}
export async function waitDevJob(id,timeout=900000){
 const end=Date.now()+timeout;
 while(Date.now()<end){
  const job=devJob(id);if(!job)throw Error('작업을 찾을 수 없습니다.');
  if(job.status==='completed')return job;
  if(job.status==='failed')throw Error(job.error||'작업 실패');
  await sleep(300);
 }
 throw Error('작업 시간 초과');
}
function jobResult(job){return {id:job.id,kind:job.kind,status:job.status,logs:job.logs.slice(-120),error:job.error,result:job.result};}
function runNpm(kind,script,args=[],onLog){
 return beginDevJob(kind,async log=>{
  const source=devConfig().sourceDir;
  if(!fs.existsSync(path.join(source,'package.json')))throw Error('소스 작업공간에 package.json이 없습니다. 먼저 연결하거나 클론하세요.');
  log('$ npm '+script+(args.length?' '+args.join(' '):''));
  const result=await runProcess(process.execPath,[npmCli(),'run',script,...args],{cwd:source,onLog:log});
  return {script,exitCode:result.code};
 });
}
export function setupSource(){
 return beginDevJob('setup',async log=>{
  const source=devConfig().sourceDir;
  if(!fs.existsSync(path.join(source,'package.json')))throw Error('소스 작업공간에 package.json이 없습니다. 먼저 연결하거나 클론하세요.');
  const command=fs.existsSync(path.join(source,'package-lock.json'))?'ci':'install';
  log('$ npm '+command+' --no-audit --no-fund');
  const result=await runProcess(process.execPath,[npmCli(),command,'--no-audit','--no-fund'],{cwd:source,onLog:log,timeout:900000});
  return {command,exitCode:result.code};
 });
}
export function testSource(){return runNpm('test','test');}
export function buildSource(){return runNpm('build','build');}
export function packageSource(){
 return beginDevJob('package',async log=>{
  const source=devConfig().sourceDir;
  const modulePath=path.join(source,'node_modules','electron-builder');
  const config=path.join(source,'electron-builder.yml');
  if(!fs.existsSync(modulePath))throw Error('electron-builder가 소스 작업공간에 없습니다. 먼저 개발 환경 구성을 실행하세요.');
  const wrapper=path.join(DATA,'dev-package.cjs');
  fs.mkdirSync(path.dirname(wrapper),{recursive:true,mode:0o700});
  fs.writeFileSync(wrapper,[
   "delete process.env.ELECTRON_RUN_AS_NODE;",
   "const path=require('node:path');",
   "const eb=require(process.env.DOMINION_EB_MODULE);",
   "const source=process.cwd();",
   "const {Platform,Arch}=eb;",
   "const targets=process.platform==='darwin'?Platform.MAC.createTarget(['dmg'],Arch.arm64,Arch.x64):Platform.WINDOWS.createTarget(['nsis','portable'],Arch.x64);",
   "eb.build({targets,publish:'never',config:path.join(source,'electron-builder.yml')}).then(()=>process.exit(0)).catch(error=>{console.error(error?.stack||error);process.exit(1)});"
  ].join('\n'),'utf8');
  log('$ electron-builder (programmatic)');
  const result=await runProcess(process.execPath,[wrapper],{cwd:source,onLog:log,timeout:1800000,env:{DOMINION_EB_MODULE:modulePath}});
  const installer=await latestInstaller();
  if(!installer)throw Error('패키징은 끝났지만 설치 파일을 찾지 못했습니다.');
  return {...result,installer};
 });
}
export async function latestInstaller(){
 const dir=path.join(devConfig().sourceDir,'release');
 if(!fs.existsSync(dir))return null;
 const files=await fsp.readdir(dir);
 const candidates=files.filter(name=>process.platform==='darwin'?name.endsWith('.dmg'):name==='DOMINION-Setup.exe');
 if(!candidates.length)return null;
 const found=[];
 for(const name of candidates){const file=path.join(dir,name);const stat=await fsp.stat(file);found.push({name,path:file,bytes:stat.size,mtime:stat.mtime.toISOString()});}
 const arch=process.arch==='arm64'?'arm64':'x64';
 const preferred=process.platform==='darwin'?found.find(item=>item.name.includes(arch)):found[0];
 return preferred||found[0];
}
export async function previewStart(){
 if(previewChild&&preview.status==='running')return {...preview};
 const source=devConfig().sourceDir;
 const vite=path.join(source,'node_modules','vite','bin','vite.js');
 if(!fs.existsSync(vite))throw Error('소스 작업공간에 Vite가 없습니다. 먼저 개발 환경 구성을 실행하세요.');
 await previewStop();
 const port=await freePort();
 preview={status:'starting',url:'',pid:0,port,error:'',logs:[]};
 const child=spawn(process.execPath,[vite,'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:source,env:{...devEnv(),DOMINION_API_URL:'http://127.0.0.1:'+PORT},stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
 previewChild=child;preview.pid=child.pid||0;
 const append=data=>{const text=String(data);preview.logs.push(text.slice(0,2000));if(preview.logs.length>80)preview.logs.shift();};
 child.stdout?.on('data',append);child.stderr?.on('data',append);
 child.on('exit',code=>{if(previewChild===child){previewChild=null;preview={...preview,status:'stopped',pid:0,error:code?('Vite exited '+code):''};}});
 const url='http://127.0.0.1:'+port;
 for(let i=0;i<100;i++){
  try{const response=await fetch(url,{signal:AbortSignal.timeout(1500)});if(response.ok){preview={...preview,status:'running',url};return {...preview};}}catch{}
  await sleep(300);
 }
 preview={...preview,status:'error',error:'Vite preview did not start'};
 return {...preview};
}
export async function previewStop(){
 if(previewChild){stopTree(previewChild);previewChild=null;}
 preview={status:'stopped',url:'',pid:0,port:0,error:'',logs:[]};
 return {...preview};
}
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
export async function sourceDiff(){
 const config=devConfig();const dir=config.sourceDir;
 if(!fs.existsSync(path.join(dir,'.git')))throw Error('Git 저장소가 아닙니다.');
 const matrix=await changedRows(dir);
 const changes=[];let total=0;
 let headOid='';try{headOid=await git.resolveRef({fs,dir,ref:'HEAD'})}catch{}
 for(const [filepath,head,workdir,stage] of matrix){
  if(head===workdir&&workdir===stage)continue;
  const absolute=sourcePath(filepath);
  let before='';
  if(head!==0&&headOid){try{const blob=await git.readBlob({fs,dir,oid:headOid,filepath});before=Buffer.from(blob.blob).toString('utf8');}catch{}}
  let after='';
  if(workdir!==0){try{after=await fsp.readFile(absolute,'utf8');}catch{}}
  const patch=createTwoFilesPatch('a/'+filepath,'b/'+filepath,before,after,'','',{context:3});
  total+=patch.length;
  changes.push({path:filepath,status:workdir===0?'deleted':head===0?'added':'modified',patch:patch.slice(0,60000)});
  if(total>300000)break;
 }
 return {changes,count:changes.length,truncated:total>300000};
}
export async function sourceCommit(message){
 const dir=devConfig().sourceDir;
 if(!String(message||'').trim())throw Error('커밋 메시지가 필요합니다.');
 const matrix=await changedRows(dir);
 for(const [filepath,head,workdir] of matrix){
  if(head===1&&workdir===1)continue;
  if(workdir===0)await git.remove({fs,dir,filepath});
  else await git.add({fs,dir,filepath});
 }
 const oid=await git.commit({fs,dir,message:String(message).slice(0,500),author:{name:'DOMINION',email:'dominion@localhost'}});
 return {oid,branch:await git.currentBranch({fs,dir,fullname:false})};
}
export async function sourceList(relative=''){
 const dir=sourcePath(relative);
 await assertNoSymlink(dir);
 const entries=await fsp.readdir(dir,{withFileTypes:true});
 return Promise.all(entries.slice(0,500).map(async entry=>{
  const file=path.join(dir,entry.name);const stat=await fsp.stat(file).catch(()=>null);
  return {name:entry.name,type:entry.isDirectory()?'dir':'file',bytes:stat?.size||0};
 }));
}
export async function sourceRead(relative){
 const file=sourcePath(relative);await assertNoSymlink(file);
 const stat=await fsp.stat(file);if(!stat.isFile())throw Error('파일이 아닙니다.');if(stat.size>2_000_000)throw Error('파일이 너무 큽니다.');
 return {path:relative,content:await fsp.readFile(file,'utf8'),bytes:stat.size};
}
export async function sourceWrite(relative,content){
 const file=sourcePath(relative);await assertNoSymlink(path.dirname(file));
 await fsp.mkdir(path.dirname(file),{recursive:true});
 await fsp.writeFile(file,String(content??''),'utf8');
 const stat=await fsp.stat(file);
 log('dev.write',{path:relative,bytes:stat.size});
 return {path:relative,bytes:stat.size};
}
export async function validateUpdateInstaller(installer){
 const file=path.resolve(String(installer||''));
 const source=path.resolve(devConfig().sourceDir);
 if(!file.startsWith(source+path.sep))throw Error('소스 작업공간의 설치 파일만 적용할 수 있습니다.');
 if(!fs.existsSync(file))throw Error('설치 파일을 찾을 수 없습니다.');
 if(process.platform==='win32'&&!file.endsWith('DOMINION-Setup.exe'))throw Error('Windows 업데이트는 DOMINION-Setup.exe만 사용할 수 있습니다.');
 if(process.platform==='darwin'&&!file.endsWith('.dmg'))throw Error('macOS 업데이트는 DMG만 사용할 수 있습니다.');
 return {ok:true,installer:file,platform:process.platform};
}
export function devToolResult(job){return jobResult(job);}
