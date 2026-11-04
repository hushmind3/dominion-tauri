import test from 'node:test';
import assert from 'node:assert/strict';
import {recordExperience,relevantExperiences,experienceHints} from '../server/experience.mjs';
import {get,remove} from '../server/store.mjs';
test('reviewed execution lessons persist, deduplicate, and are recalled for a related task',()=>{
 const keyword='lessonfixture'+crypto.randomUUID().replaceAll('-','');
 const task='Build '+keyword+' project';
 const first=recordExperience({task,source:'goal',status:'failed',reason:'Missing required file',evidence:[{name:'workspace_list'}]});
 const second=recordExperience({task,source:'goal',status:'failed',reason:'Missing required file',evidence:[{name:'workspace_list'}]});
 assert.equal(first.id,second.id);
 assert.equal(get('experience',first.id).occurrences,2);
 const verified=recordExperience({task,source:'goal',status:'completed',reason:'Recovered using workspace_write',
  evidence:[{name:'workspace_write'}],strategy:'Created file after reading feedback',verified:true});
 try{
  const hits=relevantExperiences('Review '+keyword+' project');
  assert.ok(hits.some(x=>x.id===verified.id));
  assert.match(experienceHints(keyword),/Recovered using workspace_write/);
  assert.equal(recordExperience({task:'a casual greeting',status:'completed'}),null);
 }finally{
  remove('experience',first.id);remove('experience',verified.id);
 }
});
