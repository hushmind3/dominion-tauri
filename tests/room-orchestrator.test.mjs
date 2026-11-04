import test from 'node:test';
import assert from 'node:assert/strict';
import {decideSpeakers,roomCommand,resetRoomFlow,activeRoomStatus,stopRoomFlow} from '../server/room-orchestrator.mjs';
test('room routing uses arbitrary participant names and aliases',()=>{
 const agents=[{id:'a',name:'Research',aliases:['리서치']},{id:'b',name:'Review',aliases:['검토']},{id:'c',name:'Write',aliases:[]}];
 const room={agentIds:['a','b','c']};
 assert.deepEqual(decideSpeakers(room,'검토, 확인해 줘','all_or_named',agents).map(a=>a.id),['b']);
 assert.deepEqual(decideSpeakers(room,'Research Review 얘기해 주세요','all_or_named',agents).map(a=>a.id),['a','b']);
 assert.deepEqual(decideSpeakers(room,'hello','all_or_named',agents).map(a=>a.id),['a','b','c']);
 assert.deepEqual(decideSpeakers(room,'hello','named_only',agents),[]);
 assert.deepEqual(decideSpeakers(room,'Researching?','named_only',agents),[]);
 assert.deepEqual(decideSpeakers({agentIds:[]},'hello','all_or_named',agents),[]);
});
test('room commands and generations make resets deterministic',()=>{
 assert.equal(roomCommand('/reset'),'reset');
 assert.equal(roomCommand('/stop@mybot'),'stop');
 assert.equal(roomCommand('/cancel now'),null);
 const id=crypto.randomUUID(),conv=crypto.randomUUID();
 assert.equal(activeRoomStatus(id,conv).generation,0);
 assert.equal(resetRoomFlow(id,conv).generation,1);
 assert.equal(resetRoomFlow(id,conv).generation,2);
 assert.equal(stopRoomFlow(id,conv),false);
});
