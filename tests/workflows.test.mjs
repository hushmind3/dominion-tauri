import test from 'node:test';
import assert from 'node:assert/strict';
import {saveWorkflow,workflows} from '../server/workflows.mjs';
import {remove} from '../server/store.mjs';
test('workflow steps are data-defined and persist with no fixed count',()=>{
 const f=saveWorkflow({name:'QA Workflow',steps:[{name:'Research',prompt:'Research {{input}}'},{name:'Review',prompt:'Check {{previous}}'},{name:'Report',prompt:'Summarize'}]});
 assert.equal(f.steps.length,3);
 assert.ok(workflows().some(x=>x.id===f.id));
 remove('workflow',f.id);
});
test('workflow requires valid steps and forbids phantom success',()=>{
 assert.throws(()=>saveWorkflow({name:'bad',steps:[]}),/1 to 30/);
 assert.throws(()=>saveWorkflow({name:'bad',steps:[{name:'x',prompt:''}]}),/invalid prompt/);
});
