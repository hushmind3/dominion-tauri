import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createServer} from 'node:http';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){return new Promise((resolve,reject)=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p))});server.on('error',reject);});}
test('real gateway creates and retrieves agents, rooms, sessions and jobs', {timeout:40000}, async ()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'dominion-smoke-'));
 const p=await port(), url='http://127.0.0.1:'+p;
 const fake=createServer((req,res)=>{
  if(req.url==='/v1/models'){
   res.writeHead(200,{'Content-Type':'application/json'});
   res.end(JSON.stringify({data:[{id:'fixed-fixture-model'}]}));return;
  }
  if(req.url==='/v1/chat/completions'){
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   res.end('data: '+JSON.stringify({choices:[{delta:{content:'fixed fixture answer'}}]})+'\n\ndata: [DONE]\n\n');
   return;
  }
  res.writeHead(404);res.end();
 });
 await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));
 const child=spawn(process.execPath,['server/index.mjs'],{cwd:process.cwd(),env:{...process.env,DOMINION_DATA:path.join(base,'state'),DOMINION_WORKSPACE:path.join(base,'workspace'),DOMINION_PORT:String(p),DOMINION_HOST:'127.0.0.1'},stdio:'pipe'});
 let err='';child.stderr.on('data',d=>err+=d.toString());
 try{
  let ready=false;
  for(let i=0;i<90;i++){
   if(child.exitCode!==null)throw Error('Server exited: '+err);
   try{const r=await fetch(url+'/api/health');if(r.ok){ready=true;break}}catch{}
   await sleep(150);
  }
  assert.ok(ready,'Gateway did not start: '+err);
  let response=await fetch(url+'/api/status');assert.equal(response.status,200);const status=await response.json();assert.equal(status.agents,0);
  response=await fetch(url+'/api/providers');assert.equal(response.status,200);const providers=await response.json();assert.deepEqual(providers,[]);
  response=await fetch(url+'/api/agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'QA Agent',systemPrompt:'Independent testing'})});assert.equal(response.status,200);const agent=await response.json();assert.equal(agent.name,'QA Agent');
  response=await fetch(url+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Test Room',agentIds:[agent.id],rounds:2})});assert.equal(response.status,200);const room=await response.json();assert.equal(room.agentIds.length,1);
  response=await fetch(url+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);const session=await response.json();assert.ok(session.id);
  response=await fetch(url+'/api/sessions/'+session.id+'/messages');assert.deepEqual(await response.json(),[]);
  response=await fetch(url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.id,input:'Hello',providerId:'',model:''})});assert.equal(response.status,200);const stream=await response.text();assert.match(stream,/No active AI model found/);
  response=await fetch(url+'/api/capabilities');
  assert.equal(response.status,200);
  const capabilities=await response.json();
  assert.ok(capabilities.items.some(x=>x.namespace==='channel'&&x.id==='telegram'&&x.available));
  assert.ok(capabilities.items.some(x=>x.namespace==='channel'&&x.id==='nostr'&&!x.available));
  assert.ok(!capabilities.items.some(x=>x.namespace==='model'));
  response=await fetch(url+'/api/capabilities?family=channel');
  const channelCapabilities=await response.json();
  assert.ok(channelCapabilities.items.length>=26);
  assert.ok(channelCapabilities.items.every(x=>x.namespace==='channel'));
  response=await fetch(url+'/api/channels/catalog');
  assert.equal(response.status,200);
  assert.ok((await response.json()).length>=26);
  response=await fetch(url+'/api/model-library/installed');
  assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);
  response=await fetch(url+'/api/model-library/runtime');
  assert.equal(response.status,200);const runtime=await response.json();
  assert.equal(typeof runtime.capabilities.gguf.available,'boolean');
  response=await fetch(url+'/api/model-library/details?id=..%2Fprivate');
  assert.equal(response.status,400);
  response=await fetch(url+'/api/model-library/runtime/load',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"id":"invalid"}'});
  assert.equal(response.status,400);
  response=await fetch(url+'/api/approvals');assert.deepEqual(await response.json(),[]);
  response=await fetch(url+'/api/mcp');assert.deepEqual(await response.json(),[]);
  response=await fetch(url+'/api/policy');assert.equal((await response.json()).autoApproveAll,false);
  const source={name:'Isolated fixture',baseUrl:'http://127.0.0.1:'+fake.address().port+'/v1',enabled:true};
  response=await fetch(url+'/api/providers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(source)});
  assert.equal(response.status,200);
  const configured=await response.json();
  response=await fetch(url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   sessionId:session.id,input:'fixture prompt',providerId:configured.id,model:'fixed-fixture-model'
  })});
  assert.equal(response.status,200);
  assert.match(await response.text(),/fixed fixture answer/);
  response=await fetch(url+'/api/audit');assert.equal(response.status,200);
 }finally{child.kill('SIGTERM');await new Promise(resolve=>fake.close(resolve));fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
