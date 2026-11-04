import test from 'node:test';
import assert from 'node:assert/strict';
import {likelyRequiresTools,requestedToolEffect,successfulToolEvidence} from '../server/tool-compat.mjs';
import {ExecutionRuntime} from '../server/execution-runtime.mjs';

test('external actions require real matching tool evidence rather than any mutation',()=>{
 const task='유튜브에 이 영상 업로드해줘';
 assert.equal(likelyRequiresTools(task),true);
 assert.equal(requestedToolEffect(task),'publication');
 assert.equal(successfulToolEvidence('memory_store',{id:'m1'},'publication'),false);
 assert.equal(successfulToolEvidence('workspace_write',{written:'video.mp4'},'publication'),false);
 assert.equal(successfulToolEvidence('youtube_upload',{id:'video123'},'publication'),true);
 assert.equal(successfulToolEvidence('workspace_list',{files:[]},'filesystem'),false);
 assert.equal(successfulToolEvidence('memory_store',{id:'m1'},'filesystem'),false);
 assert.equal(successfulToolEvidence('workspace_write',{written:'a.txt'},'filesystem'),true);
 assert.equal(likelyRequiresTools('유튜브 업로드 방법을 설명해 주세요'),false);
});
test('upload claim cannot finish after only a memory-write tool',async()=>{
 const history=[{role:'user',content:'유튜브에 이 영상 업로드해줘'}],records=[];
 const replies=[
  {content:'',tool_calls:[{id:'m1',function:{name:'memory_store',arguments:'{"text":"video uploaded"}'}}]},
  {content:'업로드 완료했습니다.',tool_calls:[]},
  {content:'업로드 완료했습니다.',tool_calls:[]},
  {content:'업로드 완료했습니다.',tool_calls:[]}
 ];
 const runtime=new ExecutionRuntime({
  complete:async()=>replies.shift(),
  discoverTools:async()=>[{name:'memory_store',parameters:{type:'object',properties:{text:{type:'string'}},required:['text']}}],
  invokeTool:async()=>({id:'m1'}),
  readHistory:()=>history,convertMessage:x=>x,
  saveMessage:m=>{history.push(m);return m;},
  saveRun:r=>records.push(r),saveOperation:()=>{},getToolMode:()=> 'native'
 });
 await assert.rejects(runtime.execute({sessionId:'test-upload',agentId:'a',providerId:'test',model:'test',system:'test'}),/Cannot verify execution/);
 assert.equal(records.at(-1).status,'failed');
});
