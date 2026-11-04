import {all,get,put,log} from './store.mjs';
import {secretSet,secretGet,hasSecret} from './vault.mjs';
export const providers=()=>all('provider').map(p=>({...p,hasKey:hasSecret('provider:'+p.id)}));
export function saveProvider(data){
 if(!data.name||!data.baseUrl)throw Error('Provider name and base URL required');
 const url=new URL(data.baseUrl);if(!['http:','https:'].includes(url.protocol))throw Error('HTTP(S) required');
 const id=String(data.id||crypto.randomUUID());
 const old=get('provider',id);
 const kind=data.kind==='ollama'?'ollama':data.kind==='anthropic'?'anthropic':'openai';
 const value=put('provider',{id,name:String(data.name),baseUrl:url.toString().replace(/\/$/,''),kind,local:Boolean(data.local),enabled:data.enabled!==false,toolMode:['compat','native','auto'].includes(data.toolMode)?data.toolMode:old?.toolMode||(kind==='ollama'?'compat':kind==='anthropic'?'native':'auto'),description:String(data.description||''),createdAt:old?.createdAt});
 if(typeof data.apiKey==='string')secretSet('provider:'+id,data.apiKey);
 log('provider.saved',{providerId:id});return {...value,hasKey:hasSecret('provider:'+id)};
}
export function providerById(id){const p=get('provider',id);if(!p||!p.enabled)throw Error('Provider unavailable: '+id);return p;}
export async function availableModels(id){
 const p=providerById(id), key=secretGet('provider:'+id);
 if(p.kind==='anthropic'){
  const response=await fetch(p.baseUrl.replace(/\/$/,'')+'/models',{headers:{'x-api-key':key||'','anthropic-version':'2023-06-01'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error(p.name+' models HTTP '+response.status+': '+(await response.text()).slice(0,300));
  const json=await response.json();
  return (json.data||[]).map(m=>({id:m.id,name:m.display_name||m.id})).filter(m=>m.id);
 }
 const base=p.kind==='ollama'?new URL('/api/tags',p.baseUrl).toString():p.baseUrl+'/models';
 const response=await fetch(base,{headers:key?{Authorization:'Bearer '+key}: {},signal:AbortSignal.timeout(6500)});
 if(!response.ok)throw Error(p.name+' models HTTP '+response.status);
 const json=await response.json();
 return (p.kind==='ollama'?(json.models||[]).map(m=>({id:m.name,name:m.name,size:m.size})):
 (json.data||json.models||[]).map(m=>({id:m.id||m.name,name:m.id||m.name}))).filter(m=>m.id);
}
export async function streamCompletion({providerId,model,messages,tools=[],onEvent,signal,reasoningEffort,thinking}){
 const p=providerById(providerId),key=secretGet('provider:'+providerId);
 if(!model)throw Error('Choose a model first');
 if(p.kind==='anthropic')return streamAnthropic({provider:p,key,model,messages,tools,onEvent,signal,reasoningEffort});
 const body={model,messages,stream:true,stream_options:{include_usage:true}};
 if(tools.length)body.tools=tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}}));
 if(reasoningEffort)body.reasoning_effort=reasoningEffort;
 if(thinking===false)body.chat_template_kwargs={enable_thinking:false};
 const response=await fetch(p.baseUrl+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify(body),signal:signal||AbortSignal.timeout(300000)});
 if(!response.ok)throw Error(p.name+' '+response.status+': '+(await response.text()).slice(0,900));
 if(!response.body)throw Error('Provider returned an empty stream');
 const out={role:'assistant',content:'',reasoning_content:'',tool_calls:[],usage:null};
 const calls=new Map();
 const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
   let sep;
   while((sep=buffer.indexOf('\n\n'))!==-1){
    const block=buffer.slice(0,sep);buffer=buffer.slice(sep+2);
    const payload=block.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');
    if(!payload||payload==='[DONE]')continue;
    let piece;try{piece=JSON.parse(payload);}catch{continue;}
    if(piece.error)throw Error(JSON.stringify(piece.error));
    if(piece.usage)out.usage=piece.usage;
    const d=piece.choices?.[0]?.delta||{};
    if(d.content){out.content+=d.content;onEvent?.({type:'text',text:d.content});}
    const reason=d.reasoning_content||d.reasoning||'';
    if(reason){out.reasoning_content+=reason;onEvent?.({type:'reasoning',text:reason});}
    for(const tc of d.tool_calls||[]){
      const i=tc.index??0;const t=calls.get(i)||{id:'',type:'function',function:{name:'',arguments:''}};
      if(tc.id)t.id=tc.id;
      if(tc.function?.name)t.function.name+=tc.function.name;
      if(tc.function?.arguments)t.function.arguments+=tc.function.arguments;
      calls.set(i,t);
    }
   }
  }
 }finally{reader.releaseLock();}
 out.tool_calls=[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
 return out;
}
export function toAnthropicMessages(messages=[]){
 let system='';
 const out=[];
 const push=(role,blocks)=>{if(!blocks.length)return;const last=out.at(-1);if(last&&last.role===role)last.content.push(...blocks);else out.push({role,content:blocks})};
 for(const message of messages){
  if(message.role==='system'){
   if(typeof message.content==='string'&&message.content.trim())system+=(system?'\n\n':'')+message.content;
   continue;
  }
  if(message.role==='tool'){
   push('user',[{type:'tool_result',tool_use_id:message.tool_call_id||'',content:String(message.content??'')}]);
   continue;
  }
  if(message.role==='assistant'){
   const blocks=[];
   if(typeof message.content==='string'&&message.content.trim())blocks.push({type:'text',text:message.content});
   for(const call of message.tool_calls||[]){
    let input={};try{input=JSON.parse(call.function?.arguments||'{}')}catch{}
    blocks.push({type:'tool_use',id:call.id||('tool_'+crypto.randomUUID()),name:call.function?.name||'tool',input});
   }
   push('assistant',blocks);continue;
  }
  const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(part=>typeof part==='string'?part:part?.text||'').join('\n'):String(message.content??'');
  push('user',text?[{type:'text',text}]:[]);
 }
 return {system:system.trim(),messages:out};
}
export function toAnthropicTools(tools=[]){
 return tools.map(tool=>({name:tool.name,description:tool.description||'',input_schema:tool.parameters||{type:'object',properties:{}}}));
}
async function streamAnthropic({provider,key,model,messages,tools,onEvent,signal,reasoningEffort}){
 const translated=toAnthropicMessages(messages);
 const body={model,max_tokens:reasoningEffort?8192:4096,messages:translated.messages,stream:true};
 if(translated.system)body.system=translated.system;
 if(tools.length)body.tools=toAnthropicTools(tools);
 if(reasoningEffort){
  const budget=reasoningEffort==='low'?1024:reasoningEffort==='medium'?2048:4096;
  body.thinking={type:'enabled',budget_tokens:budget};
 }
 const response=await fetch(provider.baseUrl.replace(/\/$/,'')+'/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key||'','anthropic-version':'2023-06-01'},body:JSON.stringify(body),signal:signal||AbortSignal.timeout(300000)});
 if(!response.ok)throw Error(provider.name+' '+response.status+': '+(await response.text()).slice(0,900));
 if(!response.body)throw Error('Provider returned an empty stream');
 const out={role:'assistant',content:'',reasoning_content:'',tool_calls:[],usage:null};
 const blocks=new Map();let inputTokens=0,outputTokens=0;
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
   let separator;
   while((separator=buffer.indexOf('\n\n'))!==-1){
    const block=buffer.slice(0,separator);buffer=buffer.slice(separator+2);
    const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
    if(!data||data==='[DONE]')continue;
    let event;try{event=JSON.parse(data)}catch{continue}
    if(event.type==='message_start'){
     inputTokens=Number(event.message?.usage?.input_tokens||0);
     outputTokens=Number(event.message?.usage?.output_tokens||0);
    }else if(event.type==='content_block_start'){
     const content=event.content_block||{};
     if(content.type==='tool_use')blocks.set(event.index??0,{id:content.id||('tool_'+(event.index??0)),name:content.name||'tool',json:''});
     else blocks.set(event.index??0,{type:content.type});
    }else if(event.type==='content_block_delta'){
     const delta=event.delta||{};
     if(delta.type==='text_delta'&&delta.text){out.content+=delta.text;onEvent?.({type:'text',text:delta.text})}
     else if(delta.type==='thinking_delta'&&delta.thinking){out.reasoning_content+=delta.thinking;onEvent?.({type:'reasoning',text:delta.thinking})}
     else if(delta.type==='input_json_delta'){
      const entry=blocks.get(event.index??0)||{id:'tool_'+(event.index??0),name:'tool',json:''};
      entry.json+=delta.partial_json||'';blocks.set(event.index??0,entry);
     }
    }else if(event.type==='content_block_stop'){
     const entry=blocks.get(event.index??0);
     if(entry?.name){
      let input={};try{input=entry.json?JSON.parse(entry.json):{}}catch{}
      out.tool_calls.push({id:entry.id,type:'function',function:{name:entry.name,arguments:JSON.stringify(input)}});
     }
    }else if(event.type==='message_delta'){
     if(event.usage?.output_tokens!==undefined)outputTokens=Number(event.usage.output_tokens)||outputTokens;
    }else if(event.type==='error'){
     throw Error(event.error?.message||'Anthropic stream error');
    }
   }
  }
 }finally{reader.releaseLock()}
 out.usage={prompt_tokens:inputTokens,completion_tokens:outputTokens,total_tokens:inputTokens+outputTokens};
 return out;
}

// First-run convenience: if no provider is configured and a local OpenAI-compatible
// gateway is already running on this machine, register it instead of showing "no model".
export async function ensureLocalGateway({name='OpenCode Go',baseUrl='http://127.0.0.1:4399/v1'}={}){
 if(all('provider').length)return null;
 try{
  const response=await fetch(baseUrl.replace(/\/$/,'')+'/models',{signal:AbortSignal.timeout(2500)});
  if(!response.ok)return null;
  const data=await response.json();
  if(!Array.isArray(data?.data)||!data.data.length)return null;
  return saveProvider({name,baseUrl,kind:'openai',local:true,enabled:true,apiKey:'',description:'로컬 게이트웨이 자동 등록'});
 }catch{return null}
}
