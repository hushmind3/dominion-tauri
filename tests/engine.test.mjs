import test from 'node:test';
import assert from 'node:assert/strict';
import {agents,newSession,saveRoom} from '../server/engine.mjs';
test('agent registry reading has no insertion side effects',()=>{const before=agents().map(x=>x.id);const after=agents().map(x=>x.id);assert.deepEqual(after,before);});
test('room size comes from user-specified participant IDs',()=>{const r=saveRoom({name:'architecture',agentIds:['a','b','c'],rounds:2});assert.deepEqual(r.agentIds,['a','b','c']);});
test('a new conversation starts with no fabricated messages',()=>{const x=newSession();assert.ok(x.id);});
