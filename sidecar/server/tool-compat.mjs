// Text action adapter for small local models without native function calling.
const clip=(v,n)=>String(v??'').slice(0,n);
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const builtins=new Set(['workspace_list','workspace_read','workspace_write','file_list','file_read','file_write','shell_exec','terminal_exec','web_search','http_fetch','account_status','github_api','youtube_search','youtube_channels','youtube_upload','memory_store','memory_search','skill_propose']);
const discover={name:'tool_discover',description:'Find available tools, including connected MCP integrations',parameters:{type:'object',properties:{query:{type:'string',description:'What to search for'}},required:['query']}};
const schema=t=>({name:t.name,description:clip(t.description||'',125),arguments:Object.fromEntries(Object.entries(t.parameters?.properties||{}).map(([key,value])=>[key,clip(value.description||value.type||'',80)])),required:t.parameters?.required||[]});
export const selectCompatTools=(tools=[],extra=[])=>[discover,...tools.filter(t=>builtins.has(t.name)||extra.includes(t.name))].slice(0,18);
export function discoverCompatibleTools(tools=[],query=''){
 const words=String(query).toLowerCase().split(/\s+/).filter(Boolean);
 const sorted=tools.map(t=>({t,score:words.reduce((s,w)=>s+(t.name.toLowerCase().includes(w)?3:0)+((t.description||'').toLowerCase().includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score);
 return sorted.filter(x=>x.score).concat(sorted.filter(x=>!x.score)).slice(0,12).map(x=>schema(x.t));
}
export function buildCompatMessages({system='',history=[],tools=[],extra=[],feedback=''}) {
 const lines=[
  'You are an AI assistant using a REAL tool executor, even if you cannot call functions natively.',
  'Return ONE JSON OBJECT only. No markdown, no commentary, no other text.',
  'To perform an action: {"action":"tool","name":"workspace_list","arguments":{"path":""}}',
  'To finish: {"action":"final","message":"Answer in the same language as the user."}',
  'Call ONE tool at a time. Wait for its actual result in the next message. Never claim actions succeeded without tool results.',
  'If a needed tool is not listed, call tool_discover with a short query and use its returned tool.',
  'Use only real tool names and argument keys. Prefer to act rather than merely describe actions.',
  'For Desktop, Documents, Downloads or any path outside the workspace, use file_write/file_list/file_read with an ABSOLUTE path. Never use workspace_write for those locations.',
  'For real system commands, installs or network operations, use shell_exec.',
  'TOOLS: '+JSON.stringify(selectCompatTools(tools,extra).map(schema)),
  'AGENT ROLE: '+clip(system,1700),
  ...(feedback?['FIX YOUR PRIOR OUTPUT: '+clip(feedback,1200)]:[])
 ];
 const last=history.slice(-10).map(m=>{
  if(m.role==='tool')return {role:'user',content:'[TOOL RESULT '+clip(m.tool_call_id,80)+'] '+clip(m.content,1000)};
  if(m.role==='assistant'&&m.tool_calls?.length)return {role:'assistant',content:'[TOOL CALL] '+m.tool_calls.map(c=>clip(c.function?.name,100)+' '+clip(c.function?.arguments,550)).join('\n')};
  return {role:m.role==='system'?'user':m.role,content:clip(m.content,2200)};
 });
 let remaining=7000;const short=[];
 for(let i=last.length-1;i>=0;i--){
  if(remaining<=0)break;
  const m=last[i],part=m.content.slice(-remaining);
  short.unshift({...m,content:part});remaining-=part.length;
 }
 return [{role:'system',content:lines.join('\n')},...short];
}
function extract(raw){
 const text=clip(raw,50000).trim();
 const candidates=[];
 let s=text;
 if(s.startsWith('\x60\x60\x60'))s=s.replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60\s*$/,'').trim();
 if(s.startsWith('<tool_call>'))s=s.replace(/^<tool_call>\s*/,'').replace(/\s*<\/tool_call>$/,'').trim();
 candidates.push(s);
 const fence=s.match(/\x60{3}(?:json)?\s*([\s\S]*?)\x60{3}/i);
 if(fence)candidates.push(fence[1].trim());
 const start=s.indexOf('{');
 if(start>=0){
  let depth=0,inString=false,escaped=false;
  for(let i=start;i<s.length;i++){
   const ch=s[i];
   if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue}
   if(ch==='"'){inString=true;continue}
   if(ch==='{')depth++;
   else if(ch==='}'){depth--;if(depth===0){candidates.push(s.slice(start,i+1));break}}
  }
 }
 for(const candidate of candidates){
  try{return JSON.parse(candidate)}catch{}
 }
 throw Error('No JSON object found');
}
export function validateToolArguments(tool,args){
 if(!isObject(args))return 'Tool arguments must be an object';
 const fields=tool.parameters?.properties||{},required=tool.parameters?.required||[];
 for(const key of required)if(!Object.hasOwn(args,key))return 'Missing required argument '+key;
 for(const [key,arg] of Object.entries(args)){
  const field=fields[key];
  if(!field){
   if(tool.parameters?.additionalProperties===true||isObject(tool.parameters?.additionalProperties))continue;
   return 'Unknown argument '+key+' for '+tool.name;
  }
  if(field.type==='string'&&typeof arg!=='string')return 'Argument '+key+' must be text';
  if(field.type==='array'&&!Array.isArray(arg))return 'Argument '+key+' must be an array';
  if(['number','integer'].includes(field.type)&&(typeof arg!=='number'||!Number.isFinite(arg)||(field.type==='integer'&&!Number.isInteger(arg))))return 'Argument '+key+' must be numeric';
  if(field.type==='boolean'&&typeof arg!=='boolean')return 'Argument '+key+' must be boolean';
  if(field.type==='object'&&!isObject(arg))return 'Argument '+key+' must be an object';
  if(Array.isArray(field.enum)&&!field.enum.includes(arg))return 'Unsupported value for argument '+key;
 }
 return '';
}
export function parseCompatAction(raw,tools=[]){
 let value;
 try{value=extract(raw);}catch{
  const text=clip(raw,8000).trim();
  if(text&&!text.startsWith('{')&&!text.startsWith('[')&&!text.startsWith('\x60'))return {kind:'final',content:text};
  return {kind:'invalid',reason:'Return exactly one valid JSON action (tool or final).'};
 }
 if(!isObject(value))return {kind:'invalid',reason:'Action must be a JSON object'};
 let argumentsValue=value.arguments??value.args??value.parameters??value.input;
 if(typeof argumentsValue==='string'){try{argumentsValue=JSON.parse(argumentsValue)}catch{}}
 const name=value.name??value.tool??value.tool_name;
 const action=value.action??(name? 'tool':undefined);
 if(action==='final'||action==='answer'||action==='respond'){
  const message=value.message??value.content??value.answer;
  if(typeof message!=='string'||!message.trim())return {kind:'invalid',reason:'final.message must be nonempty text'};
  return {kind:'final',content:message};
 }
 if(action!=='tool')return {kind:'invalid',reason:'action must be tool or final'};
 if(typeof name!=='string'||!isObject(argumentsValue))return {kind:'invalid',reason:'tool action requires a tool name and arguments object'};
 const tool=tools.find(t=>t.name===name);
 if(!tool)return {kind:'invalid',reason:'Unknown tool '+clip(name,100)+'. Use tool_discover if needed.'};
 const validationError=validateToolArguments(tool,argumentsValue);
 if(validationError)return {kind:'invalid',reason:validationError};
 return {kind:'tool',name:tool.name,arguments:argumentsValue};
}
// Distinguish the requested effect from a generic successful tool call.
// A saved memory or a directory listing must never prove a deployment or upload.
export function likelyRequiresTools(text){
 const s=String(text||'');
 const advice=/(?:어떻게|방법|설명|원리|차이|가능한가|can i|how to|how does)/i.test(s);
 const instruction=/(?:해줘|해주|해주세요|하라|시켜|진행|실행|올려|보내|배포해|구현해|만들어|upload|deploy|publish|send|execute|run |please do|do it)/i.test(s);
 if(advice&&!instruction)return false;
 return /(?:파일|폴더|디렉터리|코드|프로젝트|저장소|문서|로그|테스트|명령어|터미널|workspace|file|directory|repository|script|test).{0,45}(?:읽어|열어|보여|만들|생성|작성|수정|변경|삭제|실행|검사|확인해|정리해|찾아|저장|list|read|write|edit|create|delete|run|check)/i.test(s)
  ||/(?:만들|생성|작성|수정|변경|삭제|실행|검사|저장|열어|읽어).{0,35}(?:파일|폴더|디렉터리|코드|프로젝트|문서|로그|테스트|명령어|터미널)/i.test(s)
  ||/(?:유튜브|영상|게시물|깃허브|레포|서버|사이트|메일|이메일|메시지|계정|채널|앱|프로그램).{0,45}(?:업로드|배포|게시|발행|푸시|전송|발송|머지|수정|설치|삭제|연결|올려|보내)/i.test(s)
  ||/(?:업로드|배포|게시|발행|푸시|전송|발송|머지|설치|업데이트).{0,45}(?:해줘|해주|해주세요|하라|시켜|진행|올려|보내)/i.test(s)
  ||/(?:upload|deploy|publish|push|commit|send|install|execute|run)\b.{0,60}(?:to|on|into|now|please|it|this)/i.test(s);
}
export function requestedToolEffect(text=''){
 const request=String(text||'');
 if(/(?:업로드|배포|게시|발행|푸시|전송|발송|메일\s*보내|upload|deploy|publish|push|send|commit|merge|post\b)/i.test(request))return 'publication';
 if(/(?:기억|메모리|memory|스킬|skill).{0,30}(?:저장|추가|만들|수정|제안|save|store|create|update)|(?:저장|추가|만들|수정).{0,30}(?:기억|메모리|memory|스킬|skill)/i.test(request))return 'memory';
 if(/(?:파일|폴더|디렉터리|코드|프로젝트|저장소|문서|workspace|file|directory|repository|code).{0,45}(?:만들|생성|작성|수정|변경|삭제|저장|구현|create|write|edit|update|delete|remove|save|implement)|(?:만들|생성|작성|수정|변경|삭제|저장|구현).{0,45}(?:파일|폴더|코드|프로젝트|문서)/i.test(request))return 'filesystem';
 if(/(?:실행|구동|테스트|검증|빌드|명령|돌려|run|execute|test|verify|lint)/i.test(request))return 'execution';
 if(/(?:만들|생성|작성|수정|편집|변경|삭제|제거|설치|등록|구축|적용|고쳐|create|write|edit|update|delete|remove|install|save|build|implement|apply|patch)/i.test(request))return 'mutation';
 return 'observation';
}
export function successfulToolEvidence(name,output,effect='observation'){
 if(!name||name==='tool_discover'||output?.error||output?.isError===true||output?.ok===false||output?.success===false||
    (typeof output?.exitCode==='number'&&output.exitCode!==0))return false;
 const tool=String(name).toLowerCase();
 const executes=/(?:^|[_-])(?:run|exec|execute|test|verify|check|build|deploy|start|launch)(?:$|[_-])/.test(tool);
 const writes=/(?:^|[_-])(?:write|create|update|edit|patch|delete|remove|install|deploy|upload|save|send|commit|push|build|implement|apply|merge|modify|set|publish|post|put)(?:$|[_-])/.test(tool);
 const memory=tool==='memory_store'||tool==='skill_propose';
 if(effect==='memory')return memory;
 if(effect==='publication')return /(?:^|[_-])(?:deploy|upload|publish|post|send|commit|push|merge)(?:$|[_-])/.test(tool)||
    tool==='youtube_upload'||tool==='github_api'||tool==='shell_exec'||tool==='terminal_exec';
 if(effect==='filesystem')return tool==='workspace_write'||tool==='file_write'||tool==='dev_write'||
    tool==='shell_exec'||tool==='terminal_exec'||(writes&&!memory);
 if(effect==='mutation')return !memory&&(writes||tool==='workspace_write'||tool==='shell_exec'||tool==='terminal_exec');
 if(effect==='execution')return executes||tool==='shell_exec'||tool==='terminal_exec';
 return true;
}
