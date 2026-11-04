import test from 'node:test';
import assert from 'node:assert/strict';
import {agents} from '../server/engine.mjs';
import {providers} from '../server/providers.mjs';
test('reading initial registries never creates records',()=>{
 const before={agents:agents().length,providers:providers().length};
 assert.deepEqual({agents:agents().length,providers:providers().length},before);
});
// Seedless by default.
