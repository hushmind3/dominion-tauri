import fs from 'node:fs';
import path from 'node:path';
import { randomBytes,createCipheriv,createDecipheriv } from 'node:crypto';
import { DATA } from './config.mjs';
const KEY_FILE=path.join(DATA,'master.key'), VAULT_FILE=path.join(DATA,'vault.json');
if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE,randomBytes(32),{mode:0o600,flag:'wx'});
const key=fs.readFileSync(KEY_FILE);
if (key.length!==32) throw Error('Invalid local vault master key');
let entries={};
try{entries=JSON.parse(fs.readFileSync(VAULT_FILE,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
function persist(){const tmp=VAULT_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(entries),{mode:0o600});fs.renameSync(tmp,VAULT_FILE);}
export function secretSet(name,value){
  if(!/^[a-zA-Z0-9:_-]{1,128}$/.test(name))throw Error('Invalid secret name');
  if(!value){delete entries[name];persist();return;}
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
  const cipherText=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  entries[name]={iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),value:cipherText.toString('base64')};
  persist();
}
export function secretGet(name){
  const item=entries[name];if(!item)return '';
  const d=createDecipheriv('aes-256-gcm',key,Buffer.from(item.iv,'base64'));
  d.setAuthTag(Buffer.from(item.tag,'base64'));
  return Buffer.concat([d.update(Buffer.from(item.value,'base64')),d.final()]).toString('utf8');
}
export const hasSecret = name=>Boolean(entries[name]);
