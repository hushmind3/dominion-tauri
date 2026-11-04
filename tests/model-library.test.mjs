import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ModelLibrary} from '../server/model-library.mjs';

const revision='a'.repeat(40);
function fakeHub(){
 const bytes=new TextEncoder().encode('GGUF-DATA-1234567');
 const calls=[];
 const fetcher=async(input,opts={})=>{
  const u=new URL(String(input)),p=decodeURIComponent(u.pathname);
  calls.push({path:p,range:opts.headers?.Range,search:u.searchParams.get('search')});
  if(p==='/api/models')return Response.json([
   {id:'demo/Qwen-GGUF',downloads:2100,likes:90,lastModified:'2026-01-01',pipeline_tag:'text-generation',tags:['gguf','reasoning']},
   {id:'mlx-community/demo-2bit',downloads:110,likes:12,tags:['mlx']}
  ]);
  if(p==='/api/models/demo/Qwen-GGUF')return Response.json({id:'demo/Qwen-GGUF',sha:revision,downloads:2100,likes:90,tags:['gguf'],config:{model_type:'qwen3'}});
  if(p==='/api/models/mlx-community/demo-2bit')return Response.json({id:'mlx-community/demo-2bit',sha:revision,downloads:110,likes:12,tags:['mlx']});
  if(p.includes('/tree/')){
   if(p.includes('mlx-community/'))return Response.json([
    {type:'file',path:'config.json',size:12},{type:'file',path:'tokenizer.json',size:25},
    {type:'file',path:'model.safetensors',size:77},{type:'file',path:'README.md',size:20}]);
   return Response.json([{type:'file',path:'model.Q4_K_M.gguf',size:bytes.length},
    {type:'file',path:'../../escape.gguf',size:500},
    {type:'file',path:'README.md',size:25}]);
  }
  if(p.includes('/raw/'))return new Response('# Test model', {status:200});
  if(p.includes('/resolve/')){
   if(!p.endsWith('model.Q4_K_M.gguf'))throw Error('Unexpected file: '+p);
   const from=Number(opts.headers?.Range?.match(/^bytes=(\d+)-$/)?.[1]||0);
   return new Response(bytes.slice(from),{status:from?206:200,headers:{'Content-Length':String(bytes.length-from)}});
  }
  throw Error('Unknown fake API '+p);
 };
 return {fetcher,calls,bytes};
}
test('native catalog returns real repository fields and filters by format',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dominion-catalog-'));
 try{
  const fake=fakeHub();
  const m=new ModelLibrary({root,hub:'https://hf.test',fetcher:fake.fetcher});
  const chatOnly=await m.catalog();
  assert.equal(chatOnly.length,1);
  const all=await m.catalog({chatOnly:false});
  assert.deepEqual(fake.calls.filter(x=>x.path==='/api/models').map(x=>x.search),['GGUF','mlx','GGUF','mlx']);
  assert.equal(all.length,2);
  assert.equal(all[0].downloads,2100);
  assert.equal(all[0].capabilities.reasoning,true);
  const mlx=await m.catalog({format:'mlx',chatOnly:false});
  assert.deepEqual(mlx.map(x=>x.id),['mlx-community/demo-2bit']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('GGUF variants resolve exact bytes and download to own library, then delete',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dominion-download-'));
 try{
  const mock=fakeHub();
  const m=new ModelLibrary({root,hub:'https://hf.test',fetcher:mock.fetcher});
  const info=await m.detail('demo/Qwen-GGUF');
  assert.equal(info.architecture,'qwen3');
  assert.equal(info.options.length,1);
  assert.equal(info.options[0].quantization,'Q4_K_M');
  assert.equal(info.options[0].bytes,mock.bytes.length);
  assert.equal(info.options[0].files[0],'model.Q4_K_M.gguf');
  assert.equal(info.revision,revision);
  const job=await m.download({repo:'demo/Qwen-GGUF',optionId:info.options[0].id});
  await m.jobs.get(job.id).promise;
  assert.equal(m.job(job.id).status,'completed');
  const installed=await m.installed();
  assert.equal(installed.length,1);
  assert.equal(installed[0].bytes,mock.bytes.length);
  const disk=await fsp.readFile(path.join(root,job.id,'model.Q4_K_M.gguf'));
  assert.deepEqual(disk,Buffer.from(mock.bytes));
  assert.ok(mock.calls.some(x=>x.path.includes('/resolve/'+revision+'/')));
  const again=await m.download({repo:'demo/Qwen-GGUF',optionId:info.options[0].id});
  assert.equal(again.status,'installed');
  await m.remove(job.id);
  assert.deepEqual(await m.installed(),[]);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('MLX variant includes all weight and tokenizer files rather than one safetensors shard',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dominion-mlx-'));
 try{
  const m=new ModelLibrary({root,hub:'https://hf.test',fetcher:fakeHub().fetcher});
  const detail=await m.detail('mlx-community/demo-2bit');
  const option=detail.options.find(x=>x.format==='mlx');
  assert.ok(option);
  assert.deepEqual(new Set(option.files),new Set(['model.safetensors','config.json','tokenizer.json']));
  assert.equal(option.bytes,114);
  await assert.rejects(()=>m.detail('../private'),/Invalid Hugging Face repository/);
  await assert.rejects(()=>m.download({repo:'demo/Qwen-GGUF',optionId:'gguf:../../private'}),/Select an available/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('interrupted GGUF download resumes by byte Range without restarting',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dominion-resume-'));
 try{
  const mock=fakeHub();
  const m=new ModelLibrary({root,hub:'https://hf.test',fetcher:mock.fetcher});
  const detail=await m.detail('demo/Qwen-GGUF');
  const option=detail.options[0];
  const {createHash}=await import('node:crypto');
  const id=createHash('sha256').update(detail.id+'|'+detail.revision+'|'+option.id).digest('hex').slice(0,24);
  await fsp.mkdir(path.join(root,id),{recursive:true});
  await fsp.writeFile(path.join(root,id,'model.Q4_K_M.gguf.part'),Buffer.from(mock.bytes.slice(0,6)));
  const job=await m.download({repo:detail.id,optionId:option.id});
  await m.jobs.get(job.id).promise;
  assert.equal(job.id,id);
  assert.equal(m.job(id).status,'completed');
  assert.ok(mock.calls.some(x=>x.range==='bytes=6-'));
  assert.deepEqual(await fsp.readFile(path.join(root,id,'model.Q4_K_M.gguf')),Buffer.from(mock.bytes));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
