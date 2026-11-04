import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {all,get,put,remove,log} from './store.mjs';
import {secretGet,secretSet} from './vault.mjs';
import {DATA,ROOT} from './config.mjs';
const sessions=new Map();
const label=x=>String(x).replace(/[^a-zA-Z0-9_]/g,'_').slice(0,35);
export const mcpServers=()=>all('mcp').map(x=>({...x,hasToken:Boolean(secretGet('mcp:'+x.id))}));
export function saveMcp(input){
 if(!input.name)throw Error('Server name required');
 if(!['http','stdio'].includes(input.transport))throw Error('Invalid MCP transport');
 if(input.transport==='http'&&!/^https?:\/\//.test(input.url||''))throw Error('MCP URL required');
 if(input.transport==='stdio'&&!input.command)throw Error('MCP executable required');
 const id=input.id||crypto.randomUUID();
 const v=put('mcp',{id,name:input.name,transport:input.transport,url:input.url||'',command:input.command||'',args:Array.isArray(input.args)?input.args:[],env:input.env||{},enabled:input.enabled!==false});
 if(typeof input.token==='string')secretSet('mcp:'+id,input.token);
 sessions.delete(id);log('mcp.saved',{id});return v;
}
export async function disconnectMcp(id){const old=sessions.get(id);sessions.delete(id);if(old)await old.close().catch(()=>{});}
function removePackageCache(command,args){
 if(process.platform==='win32')return;
 if(!/^npx(\.cmd)?$/i.test(String(command||'')))return;
 const pkg=(args||[]).map(String).find(a=>/^(@[\w.-]+\/)?[\w.-]+$/.test(a)&&!a.startsWith('-'));
 if(!pkg)return;
 const base=path.join(os.homedir(),'.npm','_npx');
 let dirs=[];
 try{dirs=fs.readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);}catch{return}
 for(const dir of dirs){
  const target=path.join(base,dir,'node_modules',pkg);
  if(fs.existsSync(target)){
   try{fs.rmSync(target,{recursive:true,force:true});log('mcp.cache_removed',{pkg,dir});}catch{}
  }
 }
}
export async function deleteMcp(id){
 const record=get('mcp',id);
 await disconnectMcp(id);
 if(record)removePackageCache(record.command,record.args);
 remove('mcp',id);
}
export function resolveStdioLaunch(record,baseEnv={...process.env}){
 const command=String(record?.command||'');
 const isNpx=process.platform==='win32'?/^npx(\.cmd)?$/i.test(command):command==='npx';
 if(isNpx){
  const cli=path.join(ROOT,'node_modules','npm','bin','npx-cli.js');
  if(fs.existsSync(cli)){
   const bin=path.join(DATA,'bin');
   try{fs.mkdirSync(bin,{recursive:true,mode:0o700});}catch{}
   const nodeShim=path.join(bin,process.platform==='win32'?'node.cmd':'node');
   try{
    if(process.platform==='win32')fs.writeFileSync(nodeShim,'@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"'+process.execPath+'" %*\r\n');
    else fs.writeFileSync(nodeShim,'#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "'+process.execPath+'" "$@"\n',{mode:0o755});
   }catch{}
   return {
    command:process.execPath,
    args:[cli,...(record.args||[])],
    env:{...baseEnv,ELECTRON_RUN_AS_NODE:'1',PATH:bin+path.delimiter+String(baseEnv.PATH||baseEnv.Path||''),npm_config_cache:path.join(DATA,'npm-cache'),npm_config_prefix:path.join(DATA,'npm-global'),npm_config_update_notifier:'false'}
   };
  }
 }
 return {command:record.command,args:record.args||[],env:{...baseEnv,...record.env}};
}
async function connect(record){
 const cached=sessions.get(record.id);if(cached)return cached;
 const {Client,StreamableHTTPClientTransport}=await import('@modelcontextprotocol/client');
 const client=new Client({name:'dominion',version:'0.1.0'});
 if(record.transport==='http'){
   const token=secretGet('mcp:'+record.id);
   await client.connect(new StreamableHTTPClientTransport(new URL(record.url),token?{requestInit:{headers:{Authorization:'Bearer '+token}}}:{}));
 }else{
   const {StdioClientTransport}=await import('@modelcontextprotocol/client/stdio');
   const baseEnv={...process.env,...record.env};
   const launch=resolveStdioLaunch(record,baseEnv);
   await client.connect(new StdioClientTransport({command:launch.command,args:launch.args,env:launch.env}));
 }
 sessions.set(record.id,client);return client;
}
export async function discoverMcp(){
 const result=[];
 for(const r of all('mcp').filter(x=>x.enabled)){
  try{const client=await connect(r);const found=await client.listTools();for(const t of found.tools||[])result.push({name:'mcp__'+label(r.id)+'__'+label(t.name),description:'['+r.name+'] '+(t.description||t.name),parameters:t.inputSchema||{type:'object',properties:{}},mcpId:r.id,originalName:t.name});}
  catch(e){result.push({error:String(e),mcpId:r.id,name:r.name});await disconnectMcp(r.id);}
 }
 return result;
}
export async function callMcp(tool,args){
 const r=get('mcp',tool.mcpId);if(!r||!r.enabled)throw Error('MCP unavailable');
 const client=await connect(r);const result=await client.callTool({name:tool.originalName,arguments:args});
 return result;
}
