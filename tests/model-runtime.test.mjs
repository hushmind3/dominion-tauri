import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(resolve=>{
 const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
});
test('native GGUF runtime starts without LM Studio, registers local provider, then unloads', {timeout:20000, skip: process.platform==='win32' ? 'POSIX shebang fixture is not a Windows executable' : false}, async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'dominion-native-runtime-'));
 const modelId='b'.repeat(24);
 const data=path.join(base,'state');
 const modelPath=path.join(data,'models',modelId);
 const exe=path.join(base,'fake-llama-server');
 const source=[
 '#!/usr/bin/env node',
 "const http=require('node:http');",
 "const args=process.argv.slice(2);",
 "if(args.includes('--version')){console.log('fake 1.0');process.exit(0)}",
 "const port=Number(args[args.indexOf('--port')+1]);",
 "const alias=args[args.indexOf('--alias')+1];",
 "http.createServer((req,res)=>{",
 " if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:alias}]}));return}",
 " if(req.url==='/v1/chat/completions'){res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'native-online'}}]})+'\\n\\ndata: [DONE]\\n\\n');return}",
 " res.writeHead(404);res.end('not found');",
 "}).listen(port,'127.0.0.1');"
 ].join('\n');
 try{
  await fsp.mkdir(modelPath,{recursive:true});
  await fsp.writeFile(exe,source,{mode:0o755});await fsp.chmod(exe,0o755);
  await fsp.writeFile(path.join(modelPath,'weights.Q4_K_M.gguf'),'GGUFTEST');
  await fsp.writeFile(path.join(modelPath,'manifest.json'),JSON.stringify({
   status:'installed',repo:'demo/native-gguf',revision:'a'.repeat(40),optionId:'gguf:weights.Q4_K_M.gguf',
   format:'gguf',label:'Q4_K_M',files:['weights.Q4_K_M.gguf'],bytes:8,installedAt:new Date().toISOString()
  }));
  const port=await freePort();
  const host='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['server/index.mjs'],{cwd:process.cwd(),env:{...process.env,DOMINION_DATA:data,DOMINION_WORKSPACE:path.join(base,'work'),DOMINION_PORT:String(port),DOMINION_HOST:'127.0.0.1',DOMINION_LLAMA_SERVER:exe},stdio:'pipe'});
  let stderr='';server.stderr.on('data',d=>stderr+=d.toString());
  try{
   for(let i=0;i<70;i++){try{if((await fetch(host+'/api/health')).ok)break}catch{}await sleep(100)}
   let r=await fetch(host+'/api/model-library/runtime');
   assert.equal(r.status,200);
   assert.equal((await r.json()).capabilities.gguf.available,true);
   r=await fetch(host+'/api/model-library/runtime/load',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:modelId})});
   assert.equal(r.status,200);
   let state={status:'loading'};
   for(let i=0;i<85;i++){
    state=await (await fetch(host+'/api/model-library/runtime')).json();
    if(state.status!=='loading')break;
    await sleep(100);
   }
   assert.equal(state.status,'ready',state.error||stderr);
   r=await fetch(host+'/api/providers/dominion-native/models');
   assert.equal(r.status,200);
   assert.ok((await r.json()).some(x=>x.id.includes('demo/native-gguf')));
   r=await fetch(host+'/api/model-library/runtime/unload',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   assert.equal((await r.json()).status,'idle');
   r=await fetch(host+'/api/providers');
   assert.equal((await r.json()).find(x=>x.id==='dominion-native').enabled,false);
  }finally{
   try{await fetch(host+'/api/model-library/runtime/unload',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch{}
   server.kill('SIGTERM');
  }
 }finally{fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
