import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {WORKSPACE} from './config.mjs';
import {all,get,put,log,bus} from './store.mjs';
import {discoverMcp,callMcp} from './mcp.mjs';
import {persistMemory,retrieveMemories} from './memory-retrieval.mjs';
import {connections,connectorCall,githubRequest,youtubeUpload} from './oauth.mjs';
import {devStatus,connectOrClone,setupSource,testSource,buildSource,packageSource,previewStart,previewStop,sourceDiff,sourceList,sourceRead,sourceWrite,waitDevJob} from './dev-studio.mjs';
// A cancelled MCP invocation may already have modified a remote system; the
// caller must journal the outcome as uncertain instead of treating it as undone.
export async function awaitOrAbort(promise,signal){
 if(!signal)return promise;
 signal.throwIfAborted();
 let abort;
 const interrupted=new Promise((_,reject)=>{abort=()=>reject(signal.reason||Error('Interrupted'));signal.addEventListener('abort',abort,{once:true});});
 try{return await Promise.race([promise,interrupted]);}
 finally{signal.removeEventListener('abort',abort);}
}
const params=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
export const builtin=[
 {name:'workspace_list',description:'List files and folders in the workspace',parameters:params({path:{type:'string',description:'Relative folder path'}})},
 {name:'workspace_read',description:'Read a UTF-8 file from the workspace',parameters:params({path:{type:'string'}},['path'])},
 {name:'workspace_write',description:'Write a UTF-8 file into the workspace (workspace-relative path only)',parameters:params({path:{type:'string'},content:{type:'string'}},['path','content']),approval:true},
 {name:'file_list',description:'List any folder on this computer using an absolute path (Desktop, Documents, Downloads, drives)',parameters:params({path:{type:'string',description:'Absolute folder path, for example /Users/name/Desktop'}},['path'])},
 {name:'file_read',description:'Read any UTF-8 text file on this computer using an absolute path',parameters:params({path:{type:'string',description:'Absolute file path'}},['path'])},
 {name:'file_write',description:'Create or overwrite a file anywhere on this computer using an absolute path. Use this for Desktop and other folders outside the workspace.',parameters:params({path:{type:'string',description:'Absolute file path'},content:{type:'string',description:'UTF-8 text content'}},['path','content']),approval:true},
 {name:'shell_exec',description:'Run a full shell command on this computer and return stdout/stderr. Use for real system operations, installs, network commands and scripting.',parameters:params({command:{type:'string',description:'Shell command line'},cwd:{type:'string',description:'Optional absolute working directory'}},['command']),approval:true},
 {name:'terminal_exec',description:'Run an executable with argument array in the workspace, without a shell',parameters:params({command:{type:'string'},args:{type:'array',items:{type:'string'}}},['command']),approval:true},
 {name:'web_search',description:'Search the public web for current information',parameters:params({query:{type:'string'}},['query'])},
 {name:'http_fetch',description:'Fetch a URL and return its readable text content',parameters:params({url:{type:'string',description:'HTTP or HTTPS URL'}},['url'])},
 {name:'account_status',description:'List OAuth accounts connected to this platform and the integrations available to the model',parameters:params({})},
 {name:'github_api',description:'Call the GitHub REST API as the connected GitHub account. Supports GET, POST, PATCH, PUT and DELETE with a path such as /user/repos or /repos/owner/name/issues. Write methods require approval.',parameters:params({method:{type:'string',enum:['GET','POST','PATCH','PUT','DELETE'],description:'HTTP method'},path:{type:'string',description:'GitHub API path beginning with /'},body:{type:'object',description:'Optional JSON body for write methods'}},['method','path'])},
 {name:'youtube_search',description:'Search YouTube videos using the connected Google account',parameters:params({query:{type:'string',description:'Search query'},maxResults:{type:'number',description:'1-50 results'}},['query'])},
 {name:'youtube_channels',description:'List the connected YouTube channels and statistics',parameters:params({})},
 {name:'youtube_upload',description:'Upload a local video file to YouTube as the connected Google account. Requires explicit approval and YouTube upload scope.',parameters:params({path:{type:'string',description:'Absolute local video file path'},title:{type:'string',description:'Video title'},description:{type:'string',description:'Video description'},privacyStatus:{type:'string',enum:['private','unlisted','public'],description:'Privacy status'},tags:{type:'array',items:{type:'string'},description:'Optional tags'}},['path','title']),approval:true},
 {name:'memory_store',description:'Save a concise durable fact for future sessions',parameters:params({text:{type:'string'},scope:{type:'string'}},['text'])},
 {name:'memory_search',description:'Find saved knowledge relevant to a topic',parameters:params({query:{type:'string'}},['query'])},
 {name:'skill_propose',description:'Draft a reusable skill for user review and installation',parameters:params({name:{type:'string'},instructions:{type:'string'}},['name','instructions'])},
 {name:'dev_status',description:'Check the connected DOMINION Git source workspace, installed dependencies, changed files, preview server and latest installer.',parameters:params({})},
 {name:'dev_connect',description:'Connect an existing DOMINION source checkout or clone the Git repository into a separate development workspace. Never edits the installed app resources.',parameters:params({sourceDir:{type:'string',description:'Absolute source directory outside the installed app'},repoUrl:{type:'string'},branch:{type:'string'}}),approval:true},
 {name:'dev_setup',description:'Install the source workspace development dependencies with the bundled npm runtime',parameters:params({}),approval:true},
 {name:'dev_list',description:'List files in the connected DOMINION source workspace',parameters:params({path:{type:'string'}})},
 {name:'dev_read',description:'Read a source file from the connected DOMINION workspace',parameters:params({path:{type:'string'}},['path'])},
 {name:'dev_write',description:'Write a source file in the connected DOMINION workspace. Use this for real UI and engine changes, not the installed app resources.',parameters:params({path:{type:'string'},content:{type:'string'}},['path','content']),approval:true},
 {name:'dev_diff',description:'Show changed files and unified diffs in the DOMINION source workspace',parameters:params({})},
 {name:'dev_test',description:'Run the DOMINION source test suite in the connected workspace',parameters:params({}),approval:true},
 {name:'dev_build',description:'Build the React UI from the connected DOMINION source workspace',parameters:params({}),approval:true},
 {name:'dev_package',description:'Build a new Windows installer or macOS DMG from the connected DOMINION source workspace',parameters:params({}),approval:true},
 {name:'dev_preview_start',description:'Start the source Vite dev server with HMR and return its preview URL',parameters:params({}),approval:true},
 {name:'dev_preview_stop',description:'Stop the source Vite dev server',parameters:params({})}
];
// SQLite stores the approval ledger; in-memory promises only wake live requests.
const pending=new Map();
export const approvals=()=>all('approval').filter(x=>x.status==='pending'||x.status==='interrupted');
export function recoverApprovals(){
 for(const record of all('approval').filter(x=>x.status==='pending')){
  put('approval',{...record,status:'interrupted',reason:'Restarted while awaiting approval; no tool will be replayed automatically'});
 }
}
export function resolveApproval(id,allow){
 const record=get('approval',id);
 if(!record||!['pending','interrupted'].includes(record.status))return false;
 const waiter=pending.get(id);
 if(!waiter){
  put('approval',{...record,status:'reviewed',decision:allow?'allow':'deny',reason:'No live execution. Resume the task manually.'});
  bus.emit('approval',{id,allowed:false,interrupted:true});
  return false;
 }
 waiter.resolve(Boolean(allow));return true;
}
async function allowed(tool,args,onEvent,signal,context={}){
 signal?.throwIfAborted();
 const policy=get('policy','default')||{};
 if((policy.autoApprove||[]).includes(tool.name)||policy.autoApproveAll===true)return true;
 const id=crypto.randomUUID();
 return new Promise(resolve=>{
  let settled=false;
  const finish=(ok,reason='')=>{
   if(settled)return;settled=true;
   clearTimeout(timeout);signal?.removeEventListener('abort',abort);
   pending.delete(id);
   put('approval',{...get('approval',id),status:reason==='cancelled'?'cancelled':reason==='timeout'?'expired':ok?'approved':'denied',decision:ok?'allow':'deny',resolvedAt:new Date().toISOString(),reason});
   resolve(Boolean(ok));bus.emit('approval',{id,allowed:Boolean(ok)});
  };
  const abort=()=>finish(false,'cancelled');
  const timeout=setTimeout(()=>finish(false,'timeout'),120000);timeout.unref?.();
  put('approval',{id,tool:tool.name,args,status:'pending',runId:context.runId||null,callId:context.callId||null,requestedAt:new Date().toISOString()});
  pending.set(id,{id,resolve:finish});
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();return;}
  onEvent?.({type:'approval',id,tool:tool.name,args});
  bus.emit('approval',{id,tool:tool.name,args,status:'pending'});
 });
}
async function workspacePath(p='',existing=false){
 const dest=path.resolve(WORKSPACE,String(p));
 if(dest!==WORKSPACE&&!dest.startsWith(WORKSPACE+path.sep))throw Error('Outside workspace');
 // Reject symlink escapes for existing ancestors as well as the destination.
 let current=dest;
 while(current!==WORKSPACE&&current!==path.dirname(current)){
  try{const stat=await fs.lstat(current);if(stat.isSymbolicLink())throw Error('Symlinks prohibited in workspace tools');}catch(e){if(e.code!=='ENOENT')throw e;}
  current=path.dirname(current);
 }
 if(existing)await fs.access(dest);return dest;
}
async function exec(command,args=[],signal){
 signal?.throwIfAborted();
 if(typeof command!=='string'||!/^[\w./:-]+$/.test(command))throw Error('Invalid executable');
 if(!Array.isArray(args)||args.length>40||args.some(x=>typeof x!=='string'))throw Error('Invalid arguments');
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:WORKSPACE,shell:false,windowsHide:true,env:systemEnv(),signal,
    detached:process.platform!=='win32'});
   // Terminate the spawned process group, not only the shell-free parent process.
   const stopTree=()=>{
    if(!child.pid)return;
    if(process.platform==='win32'){
     const killer=spawn(path.join(systemRoot,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});killer.on('error',()=>{});
    }else{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}
   };
   signal?.addEventListener('abort',stopTree,{once:true});
  let stdout='',stderr='',settled=false,timedOut=false;
  const finish=(error,result)=>{
   if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',stopTree);
   if(error)reject(error);else resolve(result);
  };
  const timer=setTimeout(()=>{timedOut=true;stopTree();},60000);timer.unref?.();
  child.stdout?.on('data',x=>stdout=(stdout+x).slice(-30000));
  child.stderr?.on('data',x=>stderr=(stderr+x).slice(-10000));
  child.on('error',error=>finish(error));
  child.on('close',code=>timedOut?finish(Error('Command timed out after 60 seconds')):finish(null,{exitCode:code,stdout,stderr}));
 });
}
function expandPath(value){
 const raw=String(value||'').trim();
 if(!raw)throw Error('Absolute path required');
 const expanded=raw.replace(/^~(?=$|[\\/])/,os.homedir());
 if(!path.isAbsolute(expanded))throw Error('Use an absolute path, for example /Users/name/Desktop/file.txt');
 return path.resolve(expanded);
}
const decodeEntities=text=>String(text).replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi,(m,e)=>{
 const key=e.toLowerCase();
 if(key==='amp')return '&';if(key==='lt')return '<';if(key==='gt')return '>';if(key==='quot')return '"';if(key==='apos')return "'";if(key==='nbsp')return ' ';
 if(key.startsWith('#x'))return String.fromCodePoint(parseInt(key.slice(2),16)||32);
 if(key.startsWith('#'))return String.fromCodePoint(parseInt(key.slice(1),10)||32);
 return m;
});
const stripHtml=html=>decodeEntities(String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<\/(?:p|div|li|h[1-6]|tr|br)>/gi,'\n').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n')).trim();
const webHeaders={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36','Accept-Language':'ko-KR,ko;q=0.9,en;q=0.8'};
const fetchSignal=signal=>signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000);
async function searchDuckDuckGo(query,signal){
 const response=await fetch('https://html.duckduckgo.com/html/?q='+encodeURIComponent(query),{headers:webHeaders,signal:fetchSignal(signal)});
 if(!response.ok)throw Error('DuckDuckGo HTTP '+response.status);
 const html=await response.text(),results=[],snippets=[];
 for(const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
  const attrs=match[1],inner=match[2];
  if(/result__snippet/.test(attrs)){snippets.push(stripHtml(inner));continue;}
  if(!/result__a/.test(attrs))continue;
  const href=decodeEntities((attrs.match(/href="([^"]+)"/i)||[])[1]||'');
  let url=href;
  try{const parsed=new URL(href,'https://duckduckgo.com');const uddg=parsed.searchParams.get('uddg');if(uddg)url=uddg;else url=parsed.toString();}catch{}
  const title=stripHtml(inner);
  if(title&&url)results.push({title,url,content:''});
 }
 results.forEach((item,index)=>{if(snippets[index])item.content=snippets[index]});
 return results.slice(0,10);
}
async function searchBing(query,signal){
 const response=await fetch('https://www.bing.com/search?q='+encodeURIComponent(query)+'&setlang=ko',{headers:webHeaders,signal:fetchSignal(signal)});
 if(!response.ok)throw Error('Bing HTTP '+response.status);
 const html=await response.text(),results=[];
 for(const match of html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/gi)){
  const block=match[0];
  const anchor=block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  if(!anchor)continue;
  const snippet=block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]||'';
  results.push({title:stripHtml(anchor[2]),url:decodeEntities(anchor[1]),content:stripHtml(snippet)});
 }
 return results.slice(0,10);
}
async function searchViaReader(query,signal){
 const response=await fetch('https://r.jina.ai/https://html.duckduckgo.com/html/?q='+encodeURIComponent(query),{headers:{Accept:'text/plain','User-Agent':webHeaders['User-Agent']},signal:fetchSignal(signal)});
 if(!response.ok)throw Error('Reader search HTTP '+response.status);
 const text=await response.text(),results=[];
 for(const match of text.matchAll(/^##\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gm)){
  let url=match[2];
  try{const parsed=new URL(url);const uddg=parsed.searchParams.get('uddg');if(uddg)url=uddg}catch{}
  const title=match[1].replace(/[*_`]/g,'').replace(/\s+/g,' ').trim();
  if(title&&url)results.push({title,url,content:''});
 }
 return results.slice(0,10);
}
function relevantResults(query,results){
 const terms=String(query).toLowerCase().split(/\s+/).filter(x=>x.length>2);
 if(!terms.length)return results;
 const matched=results.filter(item=>terms.some(term=>((item.title||'')+' '+(item.content||'')+' '+(item.url||'')).toLowerCase().includes(term)));
 return matched;
}
async function searchWeb(query,signal){
 const text=String(query||'').trim();if(!text)throw Error('Search query required');
 const searx=process.env.SEARXNG_URL;
 if(searx){
  try{
   const url=new URL('/search',searx);url.searchParams.set('q',text);url.searchParams.set('format','json');
   const response=await fetch(url,{headers:{...webHeaders,Accept:'application/json'},signal:fetchSignal(signal)});
   if(response.ok){const results=(await response.json()).results||[];if(results.length)return results.slice(0,10).map(x=>({title:x.title,url:x.url,content:x.content}))}
  }catch{}
 }
 const brave=process.env.BRAVE_API_KEY;
 if(brave){
  try{
   const response=await fetch('https://api.search.brave.com/res/v1/web/search?q='+encodeURIComponent(text)+'&count=10',{headers:{Accept:'application/json','X-Subscription-Token':brave},signal:fetchSignal(signal)});
   if(response.ok){const results=((await response.json()).web?.results||[]).map(x=>({title:x.title,url:x.url,content:x.description||''}));if(results.length)return results}
  }catch{}
 }
 try{const direct=relevantResults(text,await searchDuckDuckGo(text,signal));if(direct.length)return direct}catch{}
 try{const reader=relevantResults(text,await searchViaReader(text,signal));if(reader.length)return reader}catch{}
 try{const bing=relevantResults(text,await searchBing(text,signal));if(bing.length)return bing}catch{}
 throw Error('No web search results. Search providers are blocked on this network; set SEARXNG_URL or BRAVE_API_KEY for reliable search.');
}
async function fetchReadable(value,signal){
 let url;try{url=new URL(String(value||''))}catch{throw Error('Invalid URL')}
 if(!['http:','https:'].includes(url.protocol))throw Error('Only HTTP(S) URLs are supported');
 const response=await fetch(url,{headers:webHeaders,redirect:'follow',signal:fetchSignal(signal)});
 const type=response.headers.get('content-type')||'';
 let body=await response.text();
 if(body.length>1_000_000)body=body.slice(0,1_000_000);
 const text=/html|xml/i.test(type)?stripHtml(body):body;
 return {status:response.status,url:response.url,contentType:type,text:text.slice(0,30000)};
}
const systemRoot=process.env.SystemRoot||process.env.windir||'C:\\Windows';
const systemEnv=()=>process.platform==='win32'?{...process.env,PATH:[path.join(systemRoot,'System32'),systemRoot,path.join(systemRoot,'System32','Wbem'),process.env.PATH||''].filter(Boolean).join(';')}:process.env;
function runShell(command,{cwd,timeout=120000,signal}={}){
 return new Promise((resolve,reject)=>{
  if(typeof command!=='string'||!command.trim())return reject(Error('Command required'));
  const dir=cwd?expandPath(cwd):os.homedir();
  const shell=process.platform==='win32'?(process.env.ComSpec||path.join(systemRoot,'System32','cmd.exe')):'/bin/sh';
  const args=process.platform==='win32'?['/d','/s','/c',command]:['-c',command];
  const child=spawn(shell,args,{cwd:dir,env:systemEnv(),windowsHide:true,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  let stdout='',stderr='',settled=false;
  const stop=()=>{if(!child.pid)return;if(process.platform==='win32'){spawn(path.join(systemRoot,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}).on('error',()=>{})}else{try{process.kill(-child.pid,'SIGTERM')}catch{child.kill('SIGTERM')}}};
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value)};
  const abort=()=>{stop();finish(Object.assign(Error('Command cancelled'),{code:'CANCELLED'}))};
  if(signal?.aborted)return abort();
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout?.on('data',data=>{stdout=(stdout+String(data)).slice(-200000)});
  child.stderr?.on('data',data=>{stderr=(stderr+String(data)).slice(-100000)});
  child.on('error',error=>finish(error));
  const timer=setTimeout(()=>{stop();finish(Object.assign(Error('Command timed out after '+Math.round(timeout/1000)+' seconds'),{code:'TIMEOUT'}))},timeout);
  timer.unref?.();
  child.on('close',code=>finish(null,{exitCode:code,stdout,stderr,cwd:dir}));
 });
}
export async function toolsForModel(enabled=true){
 if(!enabled)return[];
 const external=await discoverMcp();
 return [...builtin,...external.filter(x=>x.parameters&&!x.error)];
}
export async function executeTool(tool,args,onEvent=()=>{},context={}){
 const signal=context.signal;signal?.throwIfAborted();
 if(tool.approval&&!(await allowed(tool,args,onEvent,signal,context)))throw Error('Tool execution denied or expired');
 if(tool.mcpId){
  // External MCP calls may cause side effects; first-time use requires permission.
  const policy=get('policy','default')||{};
  if(!policy.autoApproveMcp && !(await allowed({...tool,approval:true},args,onEvent,signal,context)))throw Error('MCP tool denied');
  signal?.throwIfAborted();
  const result=await awaitOrAbort(callMcp(tool,args),signal);
  signal?.throwIfAborted();return result;
 }
 let result;
 switch(tool.name){
  case 'workspace_list':{
   const folder=await workspacePath(args.path||'',true);
   result=(await fs.readdir(folder,{withFileTypes:true})).slice(0,300).map(x=>({name:x.name,type:x.isDirectory()?'directory':x.isFile()?'file':'other'}));break;
  }
  case 'workspace_read':{
   const file=await workspacePath(args.path,true);
   if((await fs.stat(file)).size>1048576)throw Error('File exceeds 1 MB read limit');
   result=await fs.readFile(file,'utf8');break;
  }
  case 'workspace_write':{
   const file=await workspacePath(args.path);if(file===WORKSPACE)throw Error('Choose a file');
   await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp-'+crypto.randomUUID();
   try{await fs.writeFile(tmp,String(args.content||''),{encoding:'utf8',signal});signal?.throwIfAborted();await fs.rename(tmp,file);}
   finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
   result={written:path.relative(WORKSPACE,file)};break;
  }
  case 'file_list':{
   const dir=expandPath(args.path);const entries=await fs.readdir(dir,{withFileTypes:true});
   result={path:dir,entries:entries.slice(0,500).map(x=>({name:x.name,type:x.isDirectory()?'directory':x.isFile()?'file':'other'}))};break;
  }
  case 'file_read':{
   const file=expandPath(args.path);const stat=await fs.stat(file);
   if(!stat.isFile())throw Error('Not a file: '+file);
   if(stat.size>2*1024*1024)throw Error('File exceeds 2 MB read limit');
   result={path:file,content:await fs.readFile(file,'utf8')};break;
  }
  case 'file_write':{
   const file=expandPath(args.path);await fs.mkdir(path.dirname(file),{recursive:true});
   const tmp=file+'.tmp-'+crypto.randomUUID();
   try{await fs.writeFile(tmp,String(args.content??''),{encoding:'utf8',signal});signal?.throwIfAborted();await fs.rename(tmp,file);}
   finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
   result={written:file,bytes:Buffer.byteLength(String(args.content??''),'utf8')};break;
  }
  case 'shell_exec':result=await runShell(String(args.command||''),{cwd:args.cwd,signal});break;
  case 'terminal_exec':result=await exec(args.command,args.args||[],signal);break;
  case 'web_search':result=await searchWeb(args.query,signal);break;
  case 'http_fetch':result=await fetchReadable(args.url,signal);break;
  case 'account_status':result=connections().map(account=>({provider:account.provider,displayName:account.displayName,scopes:account.scopes,connectedAt:account.createdAt||null}));break;
  case 'github_api':{
   const method=String(args.method||'GET').toUpperCase();
   if(method!=='GET'&&!(await allowed({...tool,approval:true},args,onEvent,signal,context)))throw Error('GitHub write approval denied');
   result=await githubRequest(method,args.path,args.body);
   break;
  }
  case 'youtube_search':result=await connectorCall('google','youtube_search',{q:args.query,maxResults:args.maxResults});break;
  case 'youtube_channels':result=await connectorCall('google','youtube_channels');break;
  case 'youtube_upload':result=await youtubeUpload({path:args.path,title:args.title,description:args.description,privacyStatus:args.privacyStatus,tags:args.tags});break;
  case 'memory_store':result=persistMemory({text:String(args.text).slice(0,1000),scope:String(args.scope||'shared'),source:'tool'});break;
  case 'memory_search':result=retrieveMemories(String(args.query),{limit:8});break;
  case 'skill_propose':result=put('skill',{name:String(args.name).slice(0,80),instructions:String(args.instructions).slice(0,12000),enabled:false,status:'proposed'});break;
  case 'dev_status':result=await devStatus();break;
  case 'dev_connect':result=await connectOrClone({sourceDir:args.sourceDir,repoUrl:args.repoUrl,branch:args.branch});break;
  case 'dev_setup':result=await waitDevJob(setupSource().id);break;
  case 'dev_test':result=await waitDevJob(testSource().id);break;
  case 'dev_build':result=await waitDevJob(buildSource().id);break;
  case 'dev_package':result=await waitDevJob(packageSource().id);break;
  case 'dev_preview_start':result=await previewStart();break;
  case 'dev_preview_stop':result=await previewStop();break;
  case 'dev_list':result=await sourceList(args.path||'');break;
  case 'dev_read':result=await sourceRead(args.path);break;
  case 'dev_write':result=await sourceWrite(args.path,args.content);break;
  case 'dev_diff':result=await sourceDiff();break;
  default:throw Error('Tool not found: '+tool.name);
 }
 log('tool.executed',{name:tool.name,args:tool.name==='memory_store'?{scope:args.scope}:args,resultPreview:JSON.stringify(result).slice(0,250)});
 return result;
}
