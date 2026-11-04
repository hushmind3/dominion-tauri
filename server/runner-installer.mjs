import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {DATA} from './config.mjs';

const RELEASES='https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10';
const tarCommand=()=>process.platform==='win32'?path.join(process.env.SystemRoot||process.env.windir||'C:\\Windows','System32','tar.exe'):'tar';
const MAX_ASSET_BYTES=2_000_000_000;
const SUPPORTED_ARCH=['x64','arm64'];
const executableName=platform=>platform==='win32'?'llama-server.exe':'llama-server';
const labelFor=({platform,arch,backend})=>{
 if(platform==='win32'&&arch==='x64')return backend==='cuda'?'Windows NVIDIA CUDA 12.4':'Windows CPU';
 if(platform==='win32'&&arch==='arm64'&&backend==='cpu')return 'Windows ARM CPU';
 if(platform==='darwin'&&SUPPORTED_ARCH.includes(arch)&&backend==='cpu')return 'macOS '+arch+' (Metal)';
 if(platform==='linux'&&arch==='x64'&&backend==='cpu')return 'Ubuntu Linux x64 CPU';
 throw Error('No official llama.cpp binary is supported for this platform/backend');
};
export function selectReleaseBundle(releases,{platform,arch,backend}){
 labelFor({platform,arch,backend});
 const pairs=platform==='win32'?
  backend==='cuda'?[
   /^llama-b\d+-bin-win-cuda-12\.4-x64\.zip$/,
   /^cudart-llama-bin-win-cuda-12\.4-x64\.zip$/
  ]:[new RegExp('^llama-b\\d+-bin-win-cpu-'+arch+'\\.zip$')]:
  platform==='darwin'?[new RegExp('^llama-b\\d+-bin-macos-'+arch+'\\.tar\\.gz$')]:
  [/^llama-b\d+-bin-ubuntu-x64\.tar\.gz$/];
 for(const release of releases||[]){
  if(!/^b\d+$/.test(release.tag_name||'')||release.draft)continue;
  const assets=pairs.map(regex=>(release.assets||[]).find(a=>regex.test(a.name)));
  if(assets.some(a=>!a))continue;
  if(assets.some(a=>!Number.isSafeInteger(a.size)||a.size<=0||a.size>MAX_ASSET_BYTES||
    !/^sha256:[0-9a-f]{64}$/i.test(a.digest||'')||
    !String(a.browser_download_url||'').startsWith('https://github.com/ggml-org/llama.cpp/releases/download/'+release.tag_name+'/')))
    continue;
  return {tag:release.tag_name,backend,platform,arch,assets:assets.map(a=>({name:a.name,url:a.browser_download_url,size:a.size,digest:a.digest}))};
 }
 throw Error('No signed-by-hash official llama.cpp release assets match this platform');
}
const runCommand=(cmd,args,opts={})=>new Promise((resolve,reject)=>{
 const child=spawn(cmd,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...opts});
 let output='';
 for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>{output=(output+String(data)).slice(-3000);});
 child.on('error',reject);
 child.on('close',code=>code===0?resolve(output):reject(Error(cmd+' exited '+code+': '+output)));
});
async function locate(root,filename,depth=0){
 if(depth>5)return null;
 for(const entry of await fsp.readdir(root,{withFileTypes:true})){
  const target=path.join(root,entry.name);
  if(entry.isSymbolicLink())continue;
  if(entry.isFile()&&entry.name===filename)return target;
  if(entry.isDirectory()){const found=await locate(target,filename,depth+1);if(found)return found;}
 }
 return null;
}
async function collectDlls(root,found=[],depth=0){
 if(depth>5)return found;
 for(const entry of await fsp.readdir(root,{withFileTypes:true})){
  if(entry.isSymbolicLink())continue;
  const file=path.join(root,entry.name);
  if(entry.isDirectory())await collectDlls(file,found,depth+1);
  else if(entry.isFile()&&/\.dll$/i.test(entry.name))found.push(file);
 }
 return found;
}
export class LlamaInstaller{
 constructor({root=path.join(DATA,'engines','llama.cpp'),fetcher=globalThis.fetch,platform=process.platform,arch=process.arch}={}){
  this.root=root;this.fetcher=fetcher;this.platform=platform;this.arch=arch;
  this.progress={status:'idle',backend:'',downloaded:0,total:0,error:'',tag:''};
  this.pending=null;
 }
 status(){return {...this.progress};}
 current(){
  try{
   const manifest=JSON.parse(fs.readFileSync(path.join(this.root,'active.json'),'utf8'));
   if(manifest.platform!==this.platform||manifest.arch!==this.arch)return null;
   if(!manifest.relative||path.isAbsolute(manifest.relative)||manifest.relative.split(/[\\/]/).includes('..'))return null;
   const binary=path.resolve(this.root,manifest.relative);
   if(!binary.startsWith(path.resolve(this.root)+path.sep)||!fs.existsSync(binary))return null;
   return {...manifest,command:binary};
  }catch{return null;}
 }
 begin({backend='cpu'}={},onReady){
  labelFor({platform:this.platform,arch:this.arch,backend});
  if(this.pending){
   if(onReady)void this.pending.then(()=>{if(this.progress.status==='ready')return onReady(this.current());}).catch(()=>{});
   return this.status();
  }
  this.progress={status:'checking',backend,downloaded:0,total:0,error:'',tag:''};
  this.pending=(async()=>{
   try{
    const info=await this.install({backend});
    this.progress={...this.progress,status:'ready',tag:info.tag};
    if(onReady)await onReady(info);
   }catch(error){
    this.progress={...this.progress,status:'failed',error:String(error?.message||error)};
   }finally{this.pending=null;}
  })();
  return this.status();
 }
 async install({backend='cpu'}={}){
  labelFor({platform:this.platform,arch:this.arch,backend});
  const current=this.current();
  if(current?.backend===backend){
   const check=spawnSync(current.command,['--version'],{timeout:5000,stdio:'ignore',windowsHide:true});
   if(check.status===0){this.progress={...this.progress,status:'ready',tag:current.tag};return current;}
  }
  await fsp.mkdir(this.root,{recursive:true,mode:0o700});
  const response=await this.fetcher(RELEASES,{headers:{'User-Agent':'DOMINION-Local-Installer','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('GitHub release metadata HTTP '+response.status);
  const bundle=selectReleaseBundle(await response.json(),{platform:this.platform,arch:this.arch,backend});
  const total=bundle.assets.reduce((sum,asset)=>sum+asset.size,0);
  this.progress={status:'downloading',backend,tag:bundle.tag,downloaded:0,total,error:'',file:''};
  const temporary=await fsp.mkdtemp(path.join(this.root,'.install-'));
  const stage=path.join(temporary,'extracted');
  const versionDir=path.join(this.root,bundle.tag+'-'+backend+'-'+this.platform+'-'+this.arch);
  try{
   await fsp.mkdir(stage,{recursive:true});
   for(const asset of bundle.assets){
    const archive=path.join(temporary,asset.name);
    this.progress.file=asset.name;
    const download=await this.fetcher(asset.url,{headers:{'User-Agent':'DOMINION-Local-Installer'},signal:AbortSignal.timeout(600000)});
    if(!download.ok||!download.body)throw Error('Download failed: '+asset.name+' HTTP '+download.status);
    let received=0;const hash=createHash('sha256');
    await pipeline(Readable.fromWeb(download.body),new Transform({transform(chunk,_enc,done){
     received+=chunk.length;
     if(received>asset.size||received>MAX_ASSET_BYTES)return done(Error('Download exceeded signed asset size'));
     hash.update(chunk);done(null,chunk);
    }}),fs.createWriteStream(archive));
    if(received!==asset.size)throw Error('Incomplete download: '+asset.name);
    if('sha256:'+hash.digest('hex')!==asset.digest.toLowerCase())throw Error('SHA-256 mismatch: '+asset.name);
    this.progress.downloaded+=received;
    this.progress.status='extracting';this.progress.file=asset.name;
    await runCommand(tarCommand(),['-xf',archive,'-C',stage]);
    await fsp.rm(archive,{force:true});
    this.progress.status='downloading';
   }
   this.progress.status='verifying';
   const exe=await locate(stage,executableName(this.platform));
   if(!exe)throw Error('Official archive did not contain '+executableName(this.platform));
   const dir=path.dirname(exe);
   if(this.platform==='win32'){
    for(const dll of await collectDlls(stage)){
     const dst=path.join(dir,path.basename(dll));
     if(dll!==dst&&!fs.existsSync(dst))await fsp.copyFile(dll,dst);
    }
   }else await fsp.chmod(exe,0o755);
   const result=spawnSync(exe,['--version'],{timeout:12000,encoding:'utf8',windowsHide:true});
   if(result.status!==0)throw Error('Downloaded llama-server cannot start: '+String(result.stderr||result.error?.message||result.stdout||'unknown error').slice(0,900));
   await fsp.rm(versionDir,{recursive:true,force:true});
   await fsp.rename(stage,versionDir);
   const relative=path.relative(this.root,path.join(versionDir,path.relative(stage,exe)));
   const manifest={tag:bundle.tag,backend,platform:this.platform,arch:this.arch,relative,source:'ggml-org/llama.cpp',
    files:bundle.assets.map(a=>({name:a.name,digest:a.digest,size:a.size})),installedAt:new Date().toISOString()};
   const manifestTmp=path.join(this.root,'active-'+process.pid+'.tmp');
   await fsp.writeFile(manifestTmp,JSON.stringify(manifest,null,2));
   await fsp.rename(manifestTmp,path.join(this.root,'active.json'));
   return this.current();
  }finally{await fsp.rm(temporary,{recursive:true,force:true});}
 }
}
export const llamaInstaller=new LlamaInstaller();
