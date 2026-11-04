import test from 'node:test';
import assert from 'node:assert/strict';
import {CapabilityKernel} from '../server/capability-kernel.mjs';
import {capabilityInventory} from '../server/capability-sources.mjs';
import {providers} from '../server/providers.mjs';
test('generic kernel accepts independent domains without product-specific registrations',async()=>{
 const hub=new CapabilityKernel();
 hub.define('example',{id:'sample',name:'Sample',features:['search'],fields:[]},{echo:async x=>({echo:x})});
 hub.define('example',{id:'catalog',name:'Not installed',features:[]});
 hub.feed('dynamic',{list:()=>[{id:'live',name:'From live database',available:true}]});
 const list=hub.list();
 assert.equal(list.length,3);
 assert.deepEqual(await hub.invoke('example','sample','echo',{x:7}),{echo:{x:7}});
 await assert.rejects(()=>hub.invoke('example','catalog','echo',{}),/unavailable/);
 assert.equal(hub.list('dynamic')[0].name,'From live database');
 assert.throws(()=>hub.define('example',{id:'sample',name:'duplicate'}),/Duplicate/);
});
test('live platform inventory joins channels, model providers, MCP and tools without duplicate placeholders',()=>{
 const items=capabilityInventory();
 assert.ok(items.some(x=>x.namespace==='channel'&&x.id==='telegram'));
 assert.equal(items.filter(x=>x.namespace==='model').length,providers().length);
 assert.ok(items.some(x=>x.namespace==='tool'&&x.id==='workspace_read'));
 assert.ok(items.every(x=>Boolean(x.name)&&Boolean(x.namespace)));
});
