import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ModelLibrary} from '../server/model-library.mjs';

test('existing GGUF files can be registered and removed without deleting the source',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'dominion-existing-'));
 const library=new ModelLibrary({root:path.join(tmp,'library')});
 const file=path.join(tmp,'sample.gguf');
 try{
  await fs.writeFile(file,Buffer.concat([Buffer.from('GGUF'),Buffer.alloc(1024)]));
  const item=await library.importLocal({filePath:file});
  assert.equal(item.format,'gguf');
  assert.equal(item.source,'external');
  assert.equal((await library.find(item.id)).externalPath,file);
  await library.remove(item.id);
  assert.equal((await fs.readFile(file)).subarray(0,4).toString(),'GGUF');
  await assert.rejects(library.importLocal({filePath:path.join(tmp,'missing.gguf')}));
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test('MLX directory import requires config and weights, and leaves original directory intact',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'dominion-mlx-existing-'));
 const dir=path.join(tmp,'model');
 const library=new ModelLibrary({root:path.join(tmp,'library')});
 try{
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir,'config.json'),'{}');
  await assert.rejects(library.importLocal({filePath:dir}),/safetensors/);
  await fs.writeFile(path.join(dir,'model.safetensors'),'weights');
  const item=await library.importLocal({filePath:dir});
  assert.equal(item.format,'mlx');
  assert.ok(item.files.includes('model.safetensors'));
  await library.remove(item.id);
  await fs.access(path.join(dir,'model.safetensors'));
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
