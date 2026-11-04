import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTraces} from '../server/trace-gate.mjs';
test('zero traces cannot pass the execution gate',()=>{
 const report=inspectTraces([],()=>[]);
 assert.equal(report.inspected,0);
 assert.equal(report.passed,0);
 assert.equal(report.ok,false);
 assert.equal(report.failed.length,1);
});
