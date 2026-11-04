import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionRuntime} from '../server/execution-runtime.mjs';

function fixture(replies=[],initial=[]){
 const history=[...initial],runs=[],operations=[],events=[];
 const runtime=new ExecutionRuntime({
  complete:async()=>replies.shift(),
  discoverTools:async()=>[{name:'probe'}],
  invokeTool:async()=>({ok:true}),
  readHistory:()=>history,
  convertMessage:x=>x,
  saveMessage:m=>{history.push(m);return m;},
  saveRun:r=>runs.push({...r}),
  saveOperation:o=>operations.push({...o})
 });
 const run=(options={})=>runtime.execute({sessionId:'session-1',agentId:'agent-1',providerId:'mock',
  model:'model-1',system:'Test system',onEvent:e=>events.push(e),...options});
 return {runtime,run,runs,operations,events,history};
}
test('shared execution runtime persists a tool call and the final result',async()=>{
 const f=fixture([
  {content:'',tool_calls:[{id:'t1',function:{name:'probe',arguments:'{}'}}],usage:{total_tokens:12}},
  {content:'finished',tool_calls:[],usage:{total_tokens:8}}
 ]);
 const message=await f.run();
 assert.equal(message.content,'finished');
 assert.deepEqual(f.history.map(x=>x.role),['assistant','tool','assistant']);
 assert.equal(f.runs.at(-1).status,'completed');
 assert.equal(f.runs.at(-1).modelCalls,2);
 assert.equal(f.runs.at(-1).toolCalls,1);
 assert.equal(f.runs.at(-1).tokens,20);
 assert.equal(f.operations.at(-1).status,'completed');
 assert.ok(f.events.some(x=>x.type==='runtime.completed'));
});
test('engine cancellation interrupts an active inference run',async()=>{
 const f=fixture();
 f.runtime.complete=async({signal})=>new Promise((_,reject)=>{
  signal.addEventListener('abort',()=>reject(signal.reason||Error('aborted')),{once:true});
 });
 const promise=f.run();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.runtime.cancel('session-1'),true);
 await assert.rejects(promise,/cancel/i);
 assert.equal(f.runs.at(-1).status,'cancelled');
 assert.deepEqual(f.runtime.active(),[]);
});
test('uncertain tool effects are never replayed after a process interruption',async()=>{
 let called=false;
 const f=fixture([], [{role:'assistant',content:'',tool_calls:[{id:'previous',function:{name:'probe',arguments:'{}'}}]}]);
 f.runtime.complete=async()=>{called=true;throw Error('Should not reach model');};
 await assert.rejects(f.run(),/Unresolved tool calls/);
 assert.equal(called,false);
 assert.equal(f.runs.at(-1).status,'needs_review');
});
test('tool call limit does not block the concluding model response',async()=>{
 const f=fixture([
  {content:'',tool_calls:[{id:'t1',function:{name:'probe',arguments:'{}'}}]},
  {content:'final',tool_calls:[]}
 ]);
 const result=await f.run({limits:{maxToolCalls:1}});
 assert.equal(result.content,'final');
 assert.equal(f.runs.at(-1).status,'completed');
});
test('model loop budget terminates without silently marking success',async()=>{
 const f=fixture([
  {content:'',tool_calls:[{id:'t1',function:{name:'probe',arguments:'{}'}}]},
  {content:'',tool_calls:[{id:'t2',function:{name:'probe',arguments:'{}'}}]}
 ]);
 await assert.rejects(f.run({limits:{maxIterations:1}}),/iteration limit/);
 assert.equal(f.runs.at(-1).status,'failed');
});

test('native tool calls reject missing required arguments before any side effect',async()=>{
 const initial=[{role:'user',content:'작업공간에 native.txt 파일을 만들어 주세요.'}];
 const f=fixture([
  {content:'',tool_calls:[{id:'bad',function:{name:'workspace_write',arguments:'{"path":"native.txt"}'}}]},
  {content:'Saved the file.',tool_calls:[]},
  {content:'',tool_calls:[{id:'good',function:{name:'workspace_write',arguments:'{"path":"native.txt","content":"verified"}'}}]},
  {content:'Saved the file successfully.',tool_calls:[]}
 ],initial);
 const invocations=[];
 f.runtime.getToolMode=()=> 'native';
 f.runtime.discoverTools=async()=>[{name:'workspace_write',parameters:{
  type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false
 }}];
 f.runtime.invokeTool=async(_tool,args)=>{invocations.push(args);return {written:args.path};};
 const result=await f.run();
 assert.equal(result.content,'Saved the file successfully.');
 assert.equal(invocations.length,1,'Invalid arguments must never reach the tool');
 assert.equal(invocations[0].content,'verified');
 assert.equal(f.operations.filter(o=>o.callId==='bad').at(-1).status,'failed');
 assert.equal(f.operations.filter(o=>o.callId==='good').at(-1).status,'completed');
 assert.ok(f.events.some(e=>e.type==='runtime.action_repair'));
 assert.equal(f.runs.at(-1).status,'completed');
});
