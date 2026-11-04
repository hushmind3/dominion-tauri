import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {LlamaInstaller} from '../server/runner-installer.mjs';

test('Windows downloads, extracts, verifies and runs the real llama-server executable',
 {skip:process.platform!=='win32',timeout:600000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dominion-windows-llama-'));
 try{
  const installer=new LlamaInstaller({root,platform:'win32',arch:'x64'});
  const installed=await installer.install({backend:'cpu'});
  assert.ok(installed?.command,'Installer must return an actual executable path');
  assert.equal(installed.backend,'cpu');
  assert.ok(installed.command.endsWith('llama-server.exe'));
  const check=spawnSync(installed.command,['--version'],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(check.status,0,check.stderr||check.error?.message||'llama-server did not run');
  const manifest=JSON.parse(await fs.readFile(path.join(root,'active.json'),'utf8'));
  assert.ok(manifest.files.every(a=>a.digest.startsWith('sha256:')));
  assert.ok(installer.current()?.command===installed.command);
  console.log('Official Windows llama-server ready:',installed.tag,installed.command);
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300});}
});
