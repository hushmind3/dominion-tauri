import test from 'node:test';
import assert from 'node:assert/strict';
import {persistMemory,retrieveMemories,memoryContext} from '../server/memory-retrieval.mjs';
import {get,remove} from '../server/store.mjs';

test('retrieval ranks relevant facts instead of injecting the latest unrelated facts',()=>{
 const suffix=crypto.randomUUID().replaceAll('-','');
 const topic='gpu'+suffix;
 const facts=[
  persistMemory({text:topic+' RTX 3070 VRAM 8GB',scope:'shared',source:'test'}).record,
  persistMemory({text:'Weekend cooking preference '+suffix,scope:'shared',source:'test'}).record,
  persistMemory({text:'Private agent note '+suffix,scope:'private-agent-'+suffix,source:'test'}).record
 ];
 try{
  const matches=retrieveMemories(topic+' 그래픽카드 메모리',{limit:5});
  assert.equal(matches[0]?.id,facts[0].id);
  assert.ok(!matches.some(x=>x.id===facts[1].id));
  assert.ok(!matches.some(x=>x.id===facts[2].id));
  assert.match(memoryContext(topic),/RTX 3070 VRAM 8GB/);
 }finally{for(const f of facts)remove('memory',f.id);}
});

test('memory extraction deduplicates facts and quarantines contradictory numeric values',()=>{
 const suffix=crypto.randomUUID().replaceAll('-','');
 const a=persistMemory({text:'Device '+suffix+' GPU VRAM 8GB',source:'test'}).record;
 const same=persistMemory({text:'Device '+suffix+' GPU VRAM 8GB',source:'test'});
 const revised=persistMemory({text:'Device '+suffix+' GPU VRAM 16GB',source:'test'});
 try{
  assert.equal(same.action,'duplicate');
  assert.equal(get('memory',a.id).seenCount,2);
  assert.equal(revised.action,'conflict');
  assert.equal(get('memory',a.id).status,'needs_review');
  assert.equal(revised.record.status,'needs_review');
  assert.ok(!retrieveMemories('Device '+suffix+' GPU VRAM',{limit:20}).some(x=>x.id===a.id||x.id===revised.record.id));
 }finally{remove('memory',a.id);if(revised.record)remove('memory',revised.record.id);}
});
