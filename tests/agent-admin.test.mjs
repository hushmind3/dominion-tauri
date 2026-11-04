import test from 'node:test';
import assert from 'node:assert/strict';
import {put,get,remove} from '../server/store.mjs';
import {updateAgentModels,normalizeAgentAliases} from '../server/agent-admin.mjs';
test('any selection of agents can receive a model assignment without fixed roster',()=>{
 const p=put('provider',{name:'Bulk Test Provider',baseUrl:'http://127.0.0.1:7777/v1',enabled:true});
 const a=put('agent',{name:'Writer',providerId:'',model:'',aliases:[]});
 const b=put('agent',{name:'Designer',providerId:'',model:'',aliases:[]});
 try{
  const result=updateAgentModels({agentIds:[a.id,b.id],providerId:p.id,model:'model-for-both'});
  assert.equal(result.count,2);
  assert.equal(get('agent',a.id).model,'model-for-both');
  assert.equal(get('agent',b.id).providerId,p.id);
  assert.throws(()=>updateAgentModels({agentIds:[a.id,'missing'],providerId:p.id,model:'different'}),/not found/);
  assert.equal(get('agent',a.id).model,'model-for-both');
 }finally{remove('agent',a.id);remove('agent',b.id);remove('provider',p.id);}
});
test('aliases are normalized and validated',()=>{
 assert.deepEqual(normalizeAgentAliases(['Review','Review','검토']),['Review','검토']);
 assert.throws(()=>normalizeAgentAliases(Array(20).fill('x')),/16/);
});
