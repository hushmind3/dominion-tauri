import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {put,remove,messages,get} from '../server/store.mjs';
import {saveProvider} from '../server/providers.mjs';
import {runRoomIngress,resetRoomFlow,activeRoomStatus} from '../server/room-orchestrator.mjs';
const mockText=(res,text)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n');res.end('data: [DONE]\n\n');};
test('independent room ingress completes multiple speaker turns with isolated shared history, routing, and reset',{timeout:25000},async()=>{
 const requests=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  const data=JSON.parse(raw);requests.push(data);
  mockText(res,'Output from '+data.model);
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const prefix=crypto.randomUUID();
 const provider=saveProvider({id:'roommock_'+prefix.replaceAll('-',''),name:'Room Mock',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',enabled:true});
 const a=put('agent',{name:'Analyst',aliases:['분석'],providerId:provider.id,model:'model-a',systemPrompt:'Analyze.'});
 const b=put('agent',{name:'Editor',aliases:['편집'],providerId:provider.id,model:'model-b',systemPrompt:'Review.'});
 const room=put('room',{name:'Creative Study',agentIds:[a.id,b.id],rounds:1,maxTurns:8});
 const channel={id:'test-channel-'+prefix,name:'Test',kind:'telegram',roomId:room.id,roomPolicy:'all_or_named',providerId:'',model:''};
 const replies=[],event=(text,msgId)=>({conversationId:'room-conversation-'+prefix,text,isGroup:true,mention:false,messageId:msgId,reply:async x=>{replies.push(x);}});
 try{
  const first=await runRoomIngress({record:channel,event:event('Everyone, start now','one')});
  assert.equal(first.count,2);
  assert.equal(requests.length,2);
  assert.equal(requests[0].model,'model-a');
  assert.equal(requests[1].model,'model-b');
  assert.ok(requests[1].messages.some(x=>x.role==='assistant'&&x.content.includes('[Speaker: Analyst]')));
  assert.deepEqual(messages(first.sessionId).map(x=>x.role),['user','assistant','assistant']);
  assert.match(replies[0],/^Analyst: Output/);
  assert.match(replies[1],/^Editor: Output/);
  const targeted=await runRoomIngress({record:channel,event:event('편집, 다음 버전을 검토해 줘','two')});
  assert.equal(targeted.count,1);
  assert.equal(requests.length,3);
  assert.equal(requests[2].model,'model-b');
  assert.equal(activeRoomStatus(channel.id,'room-conversation-'+prefix).sessionId,first.sessionId);
  resetRoomFlow(channel.id,'room-conversation-'+prefix);
  const fresh=await runRoomIngress({record:channel,event:event('분석, 다시 시작','three')});
  assert.notEqual(fresh.sessionId,first.sessionId);
  assert.deepEqual(messages(fresh.sessionId).map(x=>x.role),['user','assistant']);
  assert.equal(first.count+targeted.count+fresh.count,4);
 }finally{
  await new Promise(r=>server.close(r));
  remove('agent',a.id);remove('agent',b.id);remove('room',room.id);remove('provider',provider.id);
 }
});
test('LINE message envelopes aggregate multiple speaker responses into a single reply call',{timeout:15000},async()=>{
 const server=http.createServer(async(req,res)=>{for await(const part of req)void part;mockText(res,'done');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const p=saveProvider({id:'line_mock_'+crypto.randomUUID().replaceAll('-',''),name:'Line Mock',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',enabled:true});
 const ids=[put('agent',{name:'A',providerId:p.id,model:'test',systemPrompt:'Hi'}),put('agent',{name:'B',providerId:p.id,model:'test',systemPrompt:'Hi'})];
 const room=put('room',{name:'Line Conversation',agentIds:ids.map(x=>x.id),rounds:1,maxTurns:8});
 const record={id:'line-test-'+crypto.randomUUID(),kind:'line',name:'Line',roomId:room.id,roomPolicy:'all_or_named'};
 const delivered=[];
 try{
  await runRoomIngress({record,event:{conversationId:'line_'+crypto.randomUUID(),text:'Hello',reply:async text=>delivered.push(text)}});
  assert.equal(delivered.length,1);
  assert.ok(delivered[0].includes('A: done')&&delivered[0].includes('B: done'));
 }finally{
  await new Promise(r=>server.close(r));ids.forEach(x=>remove('agent',x.id));remove('room',room.id);remove('provider',p.id);
 }
});
