// Channel-specific validation, built on the protocol-agnostic DOMINION kernel.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DATA} from './config.mjs';
import {kernel} from './capability-kernel.mjs';

const folder=path.dirname(fileURLToPath(import.meta.url));
const fieldTypes=new Set(['secret','text','url']);
const modes=new Set(['polling','gateway','socket','webhook','external']);
function checkManifest(m){
 if(!modes.has(m.mode))throw Error('Unknown channel transport: '+m.id);
 if(!Array.isArray(m.fields)||!Array.isArray(m.features))throw Error('Channel fields/features required');
 if(m.fields.some(x=>!fieldTypes.has(x.type)||!x.label))throw Error('Invalid channel field: '+m.id);
 if(!/^https:\/\//.test(m.docs||''))throw Error('Official or first-party documentation URL required: '+m.id);
}
await kernel.discover('channel',[path.join(folder,'channel-plugins'),path.join(DATA,'channel-plugins')],{
 accept:checkManifest,
 contract:adapter=>{if(!adapter||typeof adapter.start!=='function')throw Error('Channel adapter must implement start(context)');}
});
export const listChannels=()=>kernel.list('channel');
export const channelManifest=id=>kernel.get('channel',id);
export const channelDriver=id=>kernel.adapter('channel',id);
export const registryErrors=()=>kernel.errors();
export function validateChannel(kind,record,credentials){
 const entry=channelManifest(kind);
 if(!entry)throw Error('Unknown channel type: '+kind);
 if(!entry.available||!channelDriver(kind))throw Error('Driver not installed: '+kind);
 const missing=entry.fields.filter(f=>f.required&&!(f.type==='secret'?credentials[f.key]:record[f.key])).map(f=>f.label);
 if(missing.length)throw Error('Missing configuration: '+missing.join(', '));
 for(const f of entry.fields.filter(f=>f.type==='url'&&record[f.key])){
  const u=new URL(record[f.key]);
  if(!['http:','https:'].includes(u.protocol))throw Error('Invalid '+f.label+' URL');
 }
 return true;
}
