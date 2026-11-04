import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DESKTOP=path.join(ROOT,'desktop');
const ELECTRON=process.platform==='win32'
 ? path.join(DESKTOP,'node_modules','electron','dist','electron.exe')
 : process.platform==='darwin'
  ? path.join(DESKTOP,'node_modules','electron','dist','Electron.app','Contents','MacOS','Electron')
  : path.join(DESKTOP,'node_modules','electron','dist','electron');

if(!fs.existsSync(ELECTRON)){
 console.error('Electron binary not found. Run: npm --prefix desktop install');
 process.exit(1);
}

const children=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let stopping=false;

function track(child,label){
 children.push(child);
 child.on('exit',(code,signal)=>{
  if(stopping)return;
  console.error('['+label+'] exited',code,signal);
  shutdown(code??1);
 });
 return child;
}

function killTree(child){
 if(!child||child.killed)return;
 try{
  if(process.platform==='win32'&&child.pid){
   spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  }else{
   child.kill('SIGTERM');
  }
 }catch{}
}

function shutdown(code=0){
 if(stopping)return;
 stopping=true;
 for(const child of children.slice().reverse())killTree(child);
 setTimeout(()=>process.exit(code),300);
}

async function waitFor(url,label,timeout=90000){
 const end=Date.now()+timeout;
 while(Date.now()<end){
  try{const response=await fetch(url,{signal:AbortSignal.timeout(1500)});if(response.ok)return}catch{}
  await sleep(300);
 }
 throw Error(label+' did not start: '+url);
}

process.on('SIGINT',()=>shutdown(0));
process.on('SIGTERM',()=>shutdown(0));
process.on('exit',()=>{if(!stopping)for(const child of children)killTree(child);});

try{
 const env={...process.env,DOMINION_PORT:'4317',DOMINION_HOST:'127.0.0.1'};
 track(spawn(process.execPath,['--watch','server/index.mjs'],{cwd:ROOT,stdio:'inherit',env}),'gateway');
 track(spawn(process.execPath,[path.join(ROOT,'node_modules','vite','bin','vite.js'),'--host','127.0.0.1'],{cwd:ROOT,stdio:'inherit',env}),'vite');
 await waitFor('http://127.0.0.1:4317/api/health','DOMINION gateway');
 await waitFor('http://127.0.0.1:5173/','Vite');
 console.log('DOMINION dev: Vite http://127.0.0.1:5173 · gateway http://127.0.0.1:4317');
 const electron=track(spawn(ELECTRON,[DESKTOP],{cwd:ROOT,stdio:'inherit',env:{...env,DOMINION_DEV_URL:'http://127.0.0.1:5173'}}),'electron');
 electron.on('exit',code=>shutdown(code??0));
}catch(error){
 console.error(String(error?.message||error));
 shutdown(1);
}
