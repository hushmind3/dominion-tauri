import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {modelLibrary} from './model-library.mjs';
import {saveProvider} from './providers.mjs';
import {llamaInstaller} from './runner-installer.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const binary=(name)=>{
 const r=spawnSync(name,['--version'],{timeout:2000,stdio:'ignore',windowsHide:true});
 return r.status===0;
};
const python=(name)=>{
 const r=spawnSync(name,['-c','import mlx_lm'],{timeout:3500,stdio:'ignore',windowsHide:true});
 return r.status===0;
};
async function freePort(){
 return new Promise((resolve,reject)=>{
  const server=createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   const {port}=server.address();server.close(()=>resolve(port));
  });
 });
}
class LocalRunner{
 constructor(){this.child=null;this.state={status:'idle'};this.launchToken=0;this.cachedCapabilities=null;this.cachedAt=0;}
 capabilities(){
  if(this.cachedCapabilities&&Date.now()-this.cachedAt<15000)return this.cachedCapabilities;
  const installed=llamaInstaller.current();
  const llama=process.env.DOMINION_LLAMA_SERVER||installed?.command||'llama-server';
  const py=process.env.DOMINION_MLX_PYTHON||'python3';
  const memory={total:os.totalmem(),free:os.freemem(),platform:process.platform,arch:process.arch};
  let gpu=null;
  const nvidia=spawnSync('nvidia-smi',['--query-gpu=memory.total,memory.free','--format=csv,noheader,nounits'],{timeout:2000,encoding:'utf8',windowsHide:true});
  if(nvidia.status===0){
   const row=String(nvidia.stdout||'').trim().split('\n')[0].split(',').map(x=>Number(x.trim())*1024*1024);
   if(row.length===2&&row.every(Number.isFinite))gpu={kind:'dedicated',total:row[0],free:row[1],source:'nvidia-smi'};
  }
  if(!gpu&&process.platform==='darwin'&&process.arch==='arm64')gpu={kind:'unified',total:memory.total,free:memory.free,source:'system memory (estimate)'};
  this.cachedCapabilities={gguf:{available:binary(llama),command:llama,backend:installed?.backend||'',installable:['win32','darwin','linux'].includes(process.platform)},
   mlx:{available:process.platform==='darwin'&&process.arch==='arm64'&&python(py),command:py},memory,gpu};
  this.cachedAt=Date.now();
  return this.cachedCapabilities;
 }
 status(){
  const setup=llamaInstaller.status();
  if(this.state.status==='installing'&&setup.status==='failed')return {...this.state,status:'error',error:setup.error,setup};
  return {...this.state,setup};
 }
 install({backend='cpu'}={}){
  const result=llamaInstaller.begin({backend},()=>{this.cachedAt=0;});
  return {setup:result};
 }
 async unload(){
  this.launchToken++;
  if(this.child){const child=this.child;this.child=null;child.kill('SIGTERM');}
  this.state={status:'idle'};
  saveProvider({id:'dominion-native',name:'DOMINION Local',kind:'openai',baseUrl:'http://127.0.0.1:11491/v1',local:true,enabled:false});
  return this.status();
 }
 async load({id,gpu=true,context=4096}){
  if(!/^[0-9a-f]{24}$/.test(id||''))throw Error('Invalid installed model ID');
  const model=await modelLibrary.find(id);
  const support=this.capabilities()[model.format];
  if(!support?.available){
   if(model.format==='gguf'&&support?.installable){
    const token=++this.launchToken;
    this.state={status:'installing',id,repo:model.repo,format:model.format,name:model.repo+' / '+model.label,error:''};
    const backend=gpu&&process.platform==='win32'&&process.arch==='x64'?'cuda':'cpu';
    llamaInstaller.begin({backend},async()=>{
     this.cachedAt=0;
     if(token===this.launchToken&&this.state.status==='installing')await this.load({id,gpu,context});
    });
    return this.status();
   }
   throw Error(model.format==='mlx'?'MLX-LM is not installed on this Apple Silicon Mac':'llama-server executable was not found');
  }
  const contextSize=Math.min(32768,Math.max(512,Number(context)||4096));
  await this.unload();
  const token=++this.launchToken;
  const port=await freePort();
  const name=model.repo+' / '+model.label;
  let cmd,args;
  if(model.format==='gguf'){
   const file=model.files.find(x=>/\.gguf$/i.test(x));
   if(!file)throw Error('GGUF weight file missing');
   const abs=model.source==='external'?model.externalPath:path.resolve(model.folder,file);
   if(model.source!=='external'&&!abs.startsWith(model.folder+path.sep))throw Error('Invalid model file path');
   cmd=support.command;args=['-m',abs,'--host','127.0.0.1','--port',String(port),'--alias',name,'-c',String(contextSize),'--gpu-layers',gpu?'auto':'0','--jinja','--reasoning-format','deepseek','--no-webui'];
  }else{
   cmd=support.command;args=['-m','mlx_lm.server','--model',model.source==='external'?model.externalPath:model.folder,'--host','127.0.0.1','--port',String(port)];
  }
  this.state={status:'loading',id,repo:model.repo,format:model.format,name,port,engine:model.format==='gguf'?'llama.cpp':'mlx-lm',error:''};
  let child;
  try{child=spawn(cmd,args,{cwd:process.cwd(),stdio:['ignore','pipe','pipe'],windowsHide:true});}
  catch(e){this.state={...this.state,status:'error',error:String(e.message||e)};throw e;}
  this.child=child;
  let logs='';
  const append=x=>{logs=(logs+x.toString()).slice(-2000);};
  child.stdout?.on('data',append);child.stderr?.on('data',append);
  child.once('error',e=>{if(token===this.launchToken)this.state={...this.state,status:'error',error:e.message};});
  child.once('exit',(code)=>{if(token===this.launchToken){this.child=null;if(this.state.status!=='idle')this.state={...this.state,status:'error',error:'Runtime exited ('+code+'). '+logs.slice(-500)};}});
  void (async()=>{
   for(let i=0;i<180;i++){
    if(token!==this.launchToken||child.exitCode!==null)return;
    try{
     const response=await fetch('http://127.0.0.1:'+port+'/v1/models',{signal:AbortSignal.timeout(1200)});
     if(response.ok){
      if(token!==this.launchToken)return;
      saveProvider({id:'dominion-native',name:'DOMINION Local',kind:'openai',baseUrl:'http://127.0.0.1:'+port+'/v1',local:true,enabled:true});
      this.state={...this.state,status:'ready'};return;
     }
    }catch{}
    await sleep(500);
   }
   if(token===this.launchToken){this.state={...this.state,status:'error',error:'Model startup timed out. '+logs.slice(-700)};child.kill('SIGTERM');}
  })().catch(e=>{if(token===this.launchToken)this.state={...this.state,status:'error',error:String(e.message||e)};});
  return this.status();
 }
}
export const localRunner=new LocalRunner();
