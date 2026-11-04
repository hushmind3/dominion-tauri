import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRunTrace} from '../server/engine-contract.mjs';
import {parseSlash,commandDefinitions,channelCommand} from '../server/commands.mjs';
import {awaitOrAbort} from '../server/tools.mjs';
import {all,remove} from '../server/store.mjs';

test('execution contract accepts traced work and rejects fabricated tool outcomes',()=>{
 const valid={id:'good',status:'completed',steps:[{id:'write',status:'completed',requiresTools:true,evidence:[{name:'workspace_write'}],reviewMode:'independent-model'}]};
 const events=[{type:'workflow.queued'},{type:'workflow.planned'},{type:'step.started',data:{stepId:'write'}},{type:'tool.executed',data:{stepId:'write'}},{type:'step.completed',data:{stepId:'write'}},{type:'workflow.completed'}];
 assert.equal(verifyRunTrace(valid,events).ok,true);
 assert.equal(verifyRunTrace({...valid,steps:[{...valid.steps[0],evidence:[]}]},events).ok,false);
 assert.equal(verifyRunTrace(valid,events.slice(0,-1)).ok,false);
});

test('one command catalogue is used by all channels and the web composer',async()=>{
 assert.equal(commandDefinitions.length,21);
 assert.equal(parseSlash('/goal@DominionBot make a file').name,'goal');
 assert.equal(parseSlash('/goal@DominionBot make a file').arg,'make a file');
 assert.equal(parseSlash('hello'),null);
 const record={id:'command-fixture-'+crypto.randomUUID(),name:'Command fixture',agentId:'general',providerId:'',model:''};
 const conversationId='chat-'+crypto.randomUUID();
 const help=await channelCommand(record,{text:'/help',conversationId});
 assert.match(help,/\/goal/);
 const created=await channelCommand(record,{text:'/new',conversationId});
 assert.match(created,/새 세션/);
 const state=await channelCommand(record,{text:'/status',conversationId});
 assert.match(state,/세션:/);
 const key=record.id+':'+conversationId;
 for(const item of all('session').filter(x=>x.channelKey===key))remove('session',item.id);
});

test('external tool wait is interrupted without claiming a remote rollback',async()=>{
 const controller=new AbortController();
 const pending=awaitOrAbort(new Promise(()=>{}),controller.signal);
 controller.abort(Error('Interrupted by operator'));
 await assert.rejects(pending,/Interrupted by operator/);
});
