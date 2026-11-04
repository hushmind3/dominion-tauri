// DOMINION Capability Kernel — independent integration runtime.
// A capability consists of a data manifest and an optional executable adapter.
// The kernel knows no provider names, services, messaging platforms or MCP names.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const ID=/^[a-z0-9][a-z0-9_-]{0,64}$/;
const KEY=/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
export function validateDescriptor(namespace,source){
 if(!ID.test(namespace)||!source||!ID.test(source.id)||typeof source.name!=='string'||!source.name.trim())throw Error('Invalid capability descriptor');
 if(source.fields!==undefined&&(!Array.isArray(source.fields)||source.fields.some(x=>!x||!KEY.test(x.key)||typeof x.type!=='string')))throw Error('Invalid descriptor fields: '+source.id);
 if(source.features!==undefined&&!Array.isArray(source.features))throw Error('Invalid descriptor features: '+source.id);
 return {...source,namespace,fields:source.fields||[],features:source.features||[]};
}
export class CapabilityKernel{
 #records=new Map();
 #feeds=new Map();
 #errors=new Map();
 // This extension point is intentionally not tied to a particular protocol.
 // Adapters return an operation surface, e.g. {start, stop, diagnose}.
 define(namespace,manifest,adapter=null){
  const desc=validateDescriptor(namespace,manifest);
  const key=namespace+':'+desc.id;
  if(this.#records.has(key))throw Error('Duplicate capability: '+key);
  if(adapter!==null&&(typeof adapter!=='object'||Array.isArray(adapter)))throw Error('Capability adapter must be an object');
  this.#records.set(key,{descriptor:{...desc,available:Boolean(adapter),status:adapter?'ready':'catalog'},adapter});
  return this.get(namespace,desc.id);
 }
 attach(namespace,id,adapter){
  const entry=this.#records.get(namespace+':'+id);
  if(!entry)throw Error('Cannot attach unknown capability: '+namespace+':'+id);
  if(!adapter||typeof adapter!=='object'||Array.isArray(adapter))throw Error('Capability adapter must be an object');
  entry.adapter=adapter;
  entry.descriptor={...entry.descriptor,available:true,status:'ready'};
 }
 // Some domains (e.g. models and installed MCP servers) already live in SQLite.
 // A feed exposes their real current records without copying them into this registry.
 feed(namespace,{list,execute}){
  if(!ID.test(namespace)||typeof list!=='function')throw Error('Invalid live feed');
  if(this.#feeds.has(namespace))throw Error('Duplicate feed: '+namespace);
  this.#feeds.set(namespace,{list,execute});
 }
 async discover(namespace,roots,{accept,contract}={}){
  let installed=0;
  for(const root of roots){
   let dirs=[];
   try{dirs=await fs.readdir(root,{withFileTypes:true});}
   catch(e){if(e.code==='ENOENT')continue;throw e;}
   for(const dir of dirs.filter(x=>x.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){
    const folder=path.join(root,dir.name),file=path.join(folder,'manifest.json'),entry=path.join(folder,'index.mjs');
    try{
     const data=JSON.parse(await fs.readFile(file,'utf8'));
     if(data.id!==dir.name)throw Error('Manifest folder and ID differ');
     if(accept)accept(data);
     this.define(namespace,data);
     try{
      await fs.access(entry);
     }catch(e){if(e.code==='ENOENT')continue;throw e;}
     const imported=await import(pathToFileURL(entry).href);
     if(typeof imported.default!=='function')throw Error('Extension must export default activate(context)');
     const adapter=await imported.default({namespace,descriptor:this.get(namespace,data.id)});
     if(contract)contract(adapter,data);
     this.attach(namespace,data.id,adapter);
     installed++;
    }catch(e){this.#errors.set(namespace+':'+dir.name,String(e.message||e).slice(0,320));}
   }
  }
  return installed;
 }
 list(namespace){
  const all=[...this.#records.values()].map(x=>({...x.descriptor}));
  if(!namespace||this.#feeds.has(namespace)){
   const feeds=[...this.#feeds.entries()].filter(([n])=>!namespace||n===namespace);
   for(const [n,feed] of feeds){
    const values=feed.list();
    if(!Array.isArray(values))throw Error('Invalid capability feed: '+n);
    all.push(...values.map(v=>validateDescriptor(n,v)));
   }
  }
  return namespace?all.filter(x=>x.namespace===namespace):all;
 }
 get(namespace,id){
  return this.#records.get(namespace+':'+id)?.descriptor||null;
 }
 adapter(namespace,id){return this.#records.get(namespace+':'+id)?.adapter||null;}
 async invoke(namespace,id,operation,input={},context={}){
  if(!KEY.test(operation))throw Error('Invalid operation');
  const feed=this.#feeds.get(namespace);
  if(feed){
   if(typeof feed.execute!=='function')throw Error('Capability feed is read-only: '+namespace);
   return feed.execute(id,operation,input,context);
  }
  const adapter=this.adapter(namespace,id);
  if(!adapter)throw Error('Capability adapter unavailable: '+namespace+':'+id);
  if(typeof adapter[operation]!=='function')throw Error('Operation unavailable: '+operation);
  return adapter[operation](input,context);
 }
 errors(){return Object.fromEntries(this.#errors);}
}
export const kernel=new CapabilityKernel();
