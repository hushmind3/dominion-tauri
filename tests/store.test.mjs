import test from 'node:test';
import assert from 'node:assert/strict';
import {put,get,all,remove,writeMessage,messages} from '../server/store.mjs';
import {secretSet,secretGet} from '../server/vault.mjs';
test('SQLite records persist and can be removed',()=>{ const x=put('unit_test',{name:'hello'});assert.equal(get('unit_test',x.id).name,'hello');assert.ok(all('unit_test').some(r=>r.id===x.id));remove('unit_test',x.id);assert.equal(get('unit_test',x.id),null);});
test('conversations preserve tool messages',()=>{const id=crypto.randomUUID();writeMessage({session_id:id,role:'tool',content:'done',tool_call_id:'call1'});assert.equal(messages(id)[0].tool_call_id,'call1');});
test('vault roundtrips and erases a secret',()=>{secretSet('unit_secret','some-value');assert.equal(secretGet('unit_secret'),'some-value');secretSet('unit_secret','');assert.equal(secretGet('unit_secret'),'');});
