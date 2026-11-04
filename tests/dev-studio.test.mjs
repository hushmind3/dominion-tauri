import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const base=await fs.mkdtemp(path.join(os.tmpdir(),'dominion-dev-studio-'));
process.env.DOMINION_DATA=path.join(base,'data');
process.env.DOMINION_WORKSPACE=path.join(base,'workspace');
const source=path.join(base,'source');
await fs.mkdir(path.join(source,'src'),{recursive:true});
await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'dominion',version:'0.2.8'}),'utf8');

const [{saveDevConfig,devStatus,sourceRead,sourceWrite,sourceList},{builtin,executeTool},{put,db}]=await Promise.all([
 import('../server/dev-studio.mjs'),
 import('../server/tools.mjs'),
 import('../server/store.mjs')
]);

test('dev tools are exposed and confined to the configured source workspace',async()=>{
 const names=builtin.map(tool=>tool.name);
 for(const name of ['dev_status','dev_connect','dev_setup','dev_read','dev_write','dev_test','dev_build','dev_package','dev_preview_start'])assert.ok(names.includes(name),name);
 assert.equal(saveDevConfig({sourceDir:source}).sourceDir,path.resolve(source));
 const status=await devStatus();
 assert.equal(status.exists,true);
 assert.equal(status.version,'0.2.8');
 const written=await sourceWrite('src/AppFixture.tsx','export const label = "self development";\n');
 assert.equal(written.path,'src/AppFixture.tsx');
 assert.match((await sourceRead('src/AppFixture.tsx')).content,/self development/);
 assert.ok((await sourceList('src')).some(entry=>entry.name==='AppFixture.tsx'));
 await assert.rejects(()=>sourceRead('../outside.txt'),/밖/);
});

test('agent can invoke dev_write through the built-in tool dispatcher',async()=>{
 put('policy',{id:'default',autoApproveAll:true,autoApproveMcp:false,autoApprove:[]});
 const tool=builtin.find(item=>item.name==='dev_write');
 assert.ok(tool,'dev_write missing');
 const result=await executeTool(tool,{path:'src/AgentEdit.tsx',content:'export const changed = true;\n'},()=>{});
 assert.equal(result.path,'src/AgentEdit.tsx');
 assert.match((await sourceRead('src/AgentEdit.tsx')).content,/changed = true/);
});

test.after(async()=>{
 try{db.close()}catch{}
 for(let i=0;i<20;i++){
  try{await fs.rm(base,{recursive:true,force:true});break}
  catch{await new Promise(resolve=>setTimeout(resolve,100));}
 }
});
