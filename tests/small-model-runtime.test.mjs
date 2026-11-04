import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionRuntime} from '../server/execution-runtime.mjs';
import {buildCompatMessages,parseCompatAction,likelyRequiresTools,discoverCompatibleTools} from '../server/tool-compat.mjs';

const tools=[
 {name:'workspace_list',description:'List files',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}},
 {name:'workspace_write',description:'Write a file',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content']}},
 {name:'mcp__git__list',description:'List git branches',parameters:{type:'object',properties:{repo:{type:'string'}},required:['repo']}}
];
function fixture({responses=[],mode='compat',failure=false}={}){
 const events=[],history=[{role:'user',content:'작업공간에 note.txt 파일을 만들어 주세요.'}],calls=[],operations=[],runs=[];
 const runtime=new ExecutionRuntime({
  complete:async input=>{
   calls.push(input);
   if(failure&&calls.length===1&&input.tools.length)throw Error('400 tools field is not supported');
   const response=responses.shift();
   if(!response)throw Error('Unexpected extra model call');
   return {role:'assistant',content:response,tool_calls:[],usage:{total_tokens:20}};
  },
  discoverTools:async()=>tools,
  invokeTool:async(tool,args)=>({tool:tool.name,args,ok:true}),
  readHistory:()=>history,
  convertMessage:x=>x,
  saveMessage:msg=>{const rec={...msg,id:crypto.randomUUID()};history.push(rec);return rec;},
  saveOperation:op=>operations.push(op),
  saveRun:run=>runs.push(run),
  getToolMode:()=>mode
 });
 const run=()=>runtime.execute({sessionId:'s',agentId:'a',providerId:'local',model:'4b-quantized',system:'Assistant for Korean tasks',onEvent:e=>events.push(e)});
 return {run,runtime,events,history,calls,operations,runs};
}
test('4B-compatible protocol runs real tool step and reports confirmed result',async()=>{
 const f=fixture({responses:[
  '{"action":"tool","name":"workspace_write","arguments":{"path":"note.txt","content":"hello"}}',
  '{"action":"final","message":"note.txt 파일을 작성했습니다."}'
 ]});
 const result=await f.run();
 assert.match(result.content,/작성했습니다/);
 assert.equal(f.calls.length,2);
 assert.ok(f.calls.every(c=>c.tools.length===0),'No native tool calling request must reach the model');
 assert.equal(f.history.filter(x=>x.role==='tool').length,1);
 assert.equal(f.runs.at(-1).status,'completed');
 assert.equal(f.runs.at(-1).toolCalls,1);
 assert.ok(f.calls[1].messages.some(m=>m.content.includes('TOOL RESULT')));
});
test('strict tool schema prevents unsupported commands or invalid arguments',()=>{
 assert.equal(parseCompatAction('{"action":"tool","name":"delete_everything","arguments":{}}',tools).kind,'invalid');
 assert.equal(parseCompatAction('{"action":"tool","name":"workspace_write","arguments":{"path":"a"}}',tools).kind,'invalid');
 assert.equal(parseCompatAction('{"action":"tool","name":"workspace_write","arguments":{"path":"a","content":"x"}}',tools).kind,'tool');
});
test('small model receives feedback instead of falsely succeeding with no tool work',async()=>{
 const f=fixture({responses:[
  '{"action":"final","message":"File created."}',
  '{"action":"tool","name":"workspace_write","arguments":{"path":"note.txt","content":"ok"}}',
  '{"action":"final","message":"작성했습니다."}'
 ]});
 await f.run();
 assert.equal(f.runs.at(-1).toolCalls,1);
 assert.ok(f.events.some(x=>x.type==='runtime.action_repair'));
});
test('native function call rejection downgrades automatically to text tool protocol',async()=>{
 const f=fixture({mode:'auto',failure:true,responses:[
  '{"action":"tool","name":"workspace_write","arguments":{"path":"note.txt","content":"ok"}}',
  '{"action":"final","message":"작성했습니다."}'
 ]});
 await f.run();
 assert.equal(f.calls[0].tools.length,tools.length);
 assert.equal(f.calls[1].tools.length,0);
 assert.equal(f.runs.at(-1).status,'completed');
 assert.ok(f.events.some(x=>x.type==='runtime.tool_protocol_fallback'));
});
test('tool discovery makes large external MCP catalogue accessible to tiny models',async()=>{
 const f=fixture({responses:[
  '{"action":"tool","name":"tool_discover","arguments":{"query":"git"}}',
  '{"action":"tool","name":"mcp__git__list","arguments":{"repo":"test"}}',
  '{"action":"final","message":"브랜치를 확인했습니다."}'
 ]});
 f.history[0].content='git 브랜치 목록을 조회해 주세요.';
 await f.run();
 assert.equal(f.runs.at(-1).toolCalls,2);
 assert.ok(f.calls[2].messages[0].content.includes('mcp__git__list'));
 assert.deepEqual(discoverCompatibleTools(tools,'git')[0].name,'mcp__git__list');
});
test('discovery alone is not evidence that an actual file was created',async()=>{
 const f=fixture({responses:[
  '{"action":"tool","name":"tool_discover","arguments":{"query":"workspace_write"}}',
  '{"action":"final","message":"파일을 만들었습니다."}',
  '{"action":"tool","name":"workspace_write","arguments":{"path":"note.txt","content":"ok"}}',
  '{"action":"final","message":"파일을 만들었습니다."}'
 ]});
 await f.run();
 assert.equal(f.runs.at(-1).status,'completed');
 assert.ok(f.events.some(x=>x.type==='runtime.action_repair'));
 assert.equal(f.runs.at(-1).toolCalls,2);
});
test('malformed local model output cannot trigger an unverified success',async()=>{
 const f=fixture({responses:['I created it already.','Still done','Everything is ready']});
 await assert.rejects(f.run(),/could not produce a valid tool action|Cannot verify execution/);
 assert.equal(f.runs.at(-1).status,'failed');
 assert.equal(f.runs.at(-1).toolCalls,0);
});
test('ordinary Korean questions remain answerable without forcing tools',async()=>{
 const f=fixture({responses:['{"action":"final","message":"안녕하세요."}']});
 f.history[0].content='안녕하세요?';
 const result=await f.run();
 assert.equal(result.content,'안녕하세요.');
 assert.equal(likelyRequiresTools('안녕하세요?'),false);
 assert.ok(buildCompatMessages({system:'',history:[],tools}).length>=1);
});

test('a successful directory listing cannot prove a requested file write',async()=>{
 const f=fixture({responses:[
  '{"action":"tool","name":"workspace_list","arguments":{"path":""}}',
  '{"action":"final","message":"파일을 작성했습니다."}',
  '{"action":"tool","name":"workspace_write","arguments":{"path":"note.txt","content":"done"}}',
  '{"action":"final","message":"작업이 완료되었습니다."}'
 ]});
 const result=await f.run();
 assert.equal(result.content,'작업이 완료되었습니다.');
 assert.equal(f.runs.at(-1).status,'completed');
 assert.equal(f.runs.at(-1).toolCalls,2);
 assert.ok(f.events.some(e=>e.type==='runtime.action_repair'));
});
test('unsuccessful tool output is recorded as failed and cannot verify completion',async()=>{
 const f=fixture({responses:[
  '{"action":"tool","name":"workspace_write","arguments":{"path":"note.txt","content":"attempt 1"}}',
  '{"action":"final","message":"완료했습니다."}',
  '{"action":"tool","name":"workspace_write","arguments":{"path":"note.txt","content":"attempt 2"}}',
  '{"action":"final","message":"두 번째 시도로 완료했습니다."}'
 ]});
 let attempts=0;
 f.runtime.invokeTool=async()=>++attempts===1?{exitCode:1,stderr:'Permission denied'}:{ok:true};
 const result=await f.run();
 assert.match(result.content,/두 번째 시도/);
 assert.equal(f.operations.filter(o=>o.callId===f.operations[0].callId).at(-1).status,'failed');
 assert.equal(f.operations.at(-1).status,'completed');
 assert.ok(f.events.some(e=>e.type==='tool_error'));
});
test('native model cannot falsely finish after a read-only tool call',async()=>{
 const f=fixture({mode:'native',responses:[
  '{"action":"tool","name":"workspace_list","arguments":{"path":""}}',
  'I created the file.', 'It is done.', 'Finished.'
 ]});
 await assert.rejects(f.run(),/Cannot verify execution/);
 assert.equal(f.runs.at(-1).status,'failed');
 assert.equal(f.runs.at(-1).toolCalls,1);
 assert.ok(!f.events.some(e=>e.type==='runtime.completed'));
});
test('action requests do not silently succeed when execution tools are disabled',async()=>{
 const f=fixture({responses:['{"action":"final","message":"완료"}']});
 f.runtime.discoverTools=async()=>[];
 await assert.rejects(f.run(),/no execution tools are enabled/);
 assert.equal(f.runs.at(-1).status,'failed');
});
