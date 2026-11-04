import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {LlamaInstaller,selectReleaseBundle} from '../server/runner-installer.mjs';

const digest='sha256:'+'a'.repeat(64);
const asset=(tag,name,size=40)=>({name,size,digest,browser_download_url:
 'https://github.com/ggml-org/llama.cpp/releases/download/'+tag+'/'+name});
test('Windows NVIDIA installer resolves the official CUDA binary AND matching runtime DLL archive',()=>{
 const r={tag_name:'b55555',draft:false,prerelease:true,assets:[
  asset('b55555','llama-b55555-bin-win-cpu-x64.zip'),
  asset('b55555','llama-b55555-bin-win-cuda-12.4-x64.zip'),
  asset('b55555','cudart-llama-bin-win-cuda-12.4-x64.zip')
 ]};
 const gpu=selectReleaseBundle([r],{platform:'win32',arch:'x64',backend:'cuda'});
 assert.equal(gpu.assets.length,2);
 assert.ok(gpu.assets.some(x=>x.name.includes('cudart-llama')));
 const cpu=selectReleaseBundle([r],{platform:'win32',arch:'x64',backend:'cpu'});
 assert.equal(cpu.assets.length,1);
 assert.match(cpu.assets[0].name,/win-cpu/);
 assert.throws(()=>selectReleaseBundle([{...r,assets:r.assets.slice(0,2)}],{platform:'win32',arch:'x64',backend:'cuda'}),/No signed-by-hash/);
});
test('official executable is downloaded, hash-checked, extracted and made active without external model services',{skip:process.platform!=='linux'},async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'dominion-installer-e2e-'));
 try{
  const bin=path.join(tmp,'pack');await fs.mkdir(bin);
  const executable=path.join(bin,'llama-server');
  await fs.writeFile(executable,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo "llama fixture"; exit 0; fi\nexit 1\n',{mode:0o755});
  const archive=path.join(tmp,'fixture.tar.gz');
  execFileSync('tar',['-czf',archive,'-C',bin,'llama-server']);
  const bytes=await fs.readFile(archive);
  const tag='b789';
  const name='llama-b789-bin-ubuntu-x64.tar.gz';
  const metadata={tag_name:tag,draft:false,prerelease:false,assets:[{
   ...asset(tag,name,bytes.length),digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')
  }]};
  const fetcher=async url=>{
   if(String(url).includes('/releases?'))return Response.json([metadata]);
   if(String(url)===metadata.assets[0].browser_download_url)return new Response(bytes,{status:200});
   throw Error('unexpected '+url);
  };
  const installer=new LlamaInstaller({root:path.join(tmp,'engines'),fetcher,platform:'linux',arch:'x64'});
  installer.begin({backend:'cpu'});
  await installer.pending;
  assert.equal(installer.status().status,'ready',installer.status().error);
  const active=installer.current();
  assert.equal(active.tag,tag);
  assert.equal(active.backend,'cpu');
  assert.equal(await fs.readFile(active.command,'utf8'),await fs.readFile(executable,'utf8'));
  assert.equal((await fs.readdir(path.join(tmp,'engines'))).filter(x=>x.startsWith('.install-')).length,0);
  const again=await installer.install({backend:'cpu'});
  assert.equal(again.command,active.command);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test('tampered download never becomes the active executable',{skip:process.platform!=='linux'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dominion-installer-badhash-'));
 try{
  const tag='b777',name='llama-b777-bin-ubuntu-x64.tar.gz';
  const meta={tag_name:tag,draft:false,prerelease:false,assets:[asset(tag,name,8)]};
  const fetcher=async url=>String(url).includes('/releases?')?Response.json([meta]):new Response('tampered',{status:200});
  const installer=new LlamaInstaller({root,fetcher,platform:'linux',arch:'x64'});
  installer.begin({backend:'cpu'});
  await installer.pending;
  assert.equal(installer.status().status,'failed');
  assert.match(installer.status().error,/SHA-256 mismatch/);
  assert.equal(installer.current(),null);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
