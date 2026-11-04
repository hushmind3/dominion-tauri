import {buildCompatMessages,parseCompatAction,discoverCompatibleTools,likelyRequiresTools,requestedToolEffect,successfulToolEvidence,validateToolArguments} from './tool-compat.mjs';
// Shared runtime for chat, agents, meetings and workflows.
// A workflow may call this runtime, but the runtime knows nothing about goals or plans.
const clamp=(n,min,max,fallback)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Math.trunc(Number(n)))):fallback;
const abortError=()=>Object.assign(Error('Execution cancelled'),{code:'CANCELLED'});
export class ExecutionRuntime {
  #sessions=new Map();
  #runs=new Map();
  constructor({complete,discoverTools,invokeTool,readHistory,convertMessage,saveMessage,saveRun,saveOperation,getToolMode,onOutcome}){
    Object.assign(this,{complete,discoverTools,invokeTool,readHistory,convertMessage,saveMessage,saveRun,saveOperation,getToolMode,onOutcome});
  }
  isActive(sessionId){return this.#sessions.has(sessionId);}
  active(){return [...this.#runs.values()].map(x=>({runId:x.id,sessionId:x.sessionId,status:x.status}));}
  cancel(id){
    const run=this.#runs.get(id)||this.#sessions.get(id);
    if(!run)return false;
    run.controller.abort(abortError());
    return true;
  }
  async execute({sessionId,agentId,providerId,model,system,onEvent=()=>{},signal,toolsEnabled=true,speakerLabels=false,
    reasoningEffort,thinking,limits={}}){
    if(this.#sessions.has(sessionId))throw Error('Session is already running');
    const controller=new AbortController(),start=Date.now(),runId=crypto.randomUUID();
     let task='',toolOutcomes=[];
    const maxIterations=clamp(limits.maxIterations,1,64,16);
    const maxToolCalls=clamp(limits.maxToolCalls,1,512,64);
    const maxElapsedMs=clamp(limits.maxElapsedMs,1000,86400000,900000);
    const maxTokens=clamp(limits.maxTokens,100,2000000,100000);
    const run={id:runId,sessionId,agentId,providerId,model,status:'running',startedAt:new Date().toISOString(),
      updatedAt:new Date().toISOString(),iterations:0,modelCalls:0,toolCalls:0,tokens:0,reason:'',controller};
    const persisted=()=>{const {controller:_,...data}=run;this.saveRun({...data,updatedAt:new Date().toISOString()});};
    const emit=(type,detail={})=>{persisted();onEvent({type,runId,sessionId,...detail});};
    const check=()=>{
      if(controller.signal.aborted)throw controller.signal.reason||abortError();
      if(Date.now()-start>maxElapsedMs||run.tokens>=maxTokens||run.toolCalls>maxToolCalls)throw Object.assign(Error('Execution budget exceeded'),{code:'BUDGET'});
    };
    const deadline=setTimeout(()=>controller.abort(Object.assign(Error('Execution time budget exceeded'),{code:'BUDGET'})),maxElapsedMs);
    deadline.unref?.();
    const externalAbort=()=>controller.abort(signal?.reason||abortError());
    if(signal?.aborted)externalAbort();
    else signal?.addEventListener('abort',externalAbort,{once:true});
    this.#sessions.set(sessionId,run);this.#runs.set(runId,run);
    try{
      check();emit('runtime.started');
      // A persisted unanswered tool call may have had side effects before a crash.
      // Never repeat such calls automatically when a session resumes.
      const prior=this.readHistory(sessionId);
      const answered=new Set(prior.filter(x=>x.role==='tool').map(x=>x.tool_call_id));
      const outstanding=prior.filter(x=>x.role==='assistant').flatMap(x=>x.tool_calls||[])
        .filter(x=>!answered.has(x.id));
      if(outstanding.length)throw Object.assign(Error('Unresolved tool calls require review before resuming'),{code:'INTERRUPTED'});
      const latestUser=prior.filter(x=>x.role==='user').at(-1)?.content||'';
       task=latestUser;
      const evidenceRequired=likelyRequiresTools(latestUser);
      const requiredEffect=requestedToolEffect(latestUser);
      const tools=await this.discoverTools(toolsEnabled);
      check();
      if(evidenceRequired&&!tools.length)throw Error('This action needs tools, but no execution tools are enabled');
      let assistant=null,toolMode=tools.length?(this.getToolMode?.(providerId,model)||'auto'):'native';
      if(!['auto','native','compat'].includes(toolMode))toolMode='auto';
      const extraTools=[],compatTools=[{name:'tool_discover',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}},...tools];
      let feedback='',repairs=0,successfulWork=0;
      for(let iteration=0;iteration<maxIterations;iteration++){
        check();run.iterations=iteration+1;
        const nativeHistory=[{role:'system',content:system+(feedback?'\n\nTool execution correction: '+feedback:'')},...this.readHistory(sessionId).map(x=>this.convertMessage(x,speakerLabels))];
        const messages=toolMode==='compat'?buildCompatMessages({system,history:nativeHistory.slice(1),tools,extra:extraTools,feedback}):nativeHistory;
        emit('runtime.model_started',{iteration:iteration+1,toolMode});
        const call=mode=>this.complete({providerId,model,messages:mode==='compat'?buildCompatMessages({system,history:nativeHistory.slice(1),tools,extra:extraTools,feedback}):messages,
          tools:mode==='compat'?[]:tools,signal:controller.signal,reasoningEffort,thinking,
          onEvent:e=>{if(!controller.signal.aborted&&!(e.type==='text'&&(mode==='compat'||(evidenceRequired&&successfulWork===0))))onEvent(e);}});
        let reply;
        try{reply=await call(toolMode);}
        catch(error){
          if(toolMode!=='auto'||!/(tools|function|400|422|unsupported)/i.test(String(error?.message||error)))throw error;
          toolMode='compat';
          emit('runtime.tool_protocol_fallback',{reason:'Provider does not support native tool calling'});
          reply=await call(toolMode);
        }
        check();
        run.modelCalls++;
        run.tokens+=Number(reply.usage?.total_tokens||Number(reply.usage?.prompt_tokens||0)+Number(reply.usage?.completion_tokens||0))||0;
        const rawContent=String(reply.content||'');
        if(!reply.tool_calls?.length&&tools.length){
          const action=parseCompatAction(rawContent,compatTools);
          if(action.kind==='tool'){
            reply={...reply,content:'',tool_calls:[{id:runId+':compat:'+iteration,type:'function',function:{name:action.name,arguments:JSON.stringify(action.arguments)}}]};
            feedback='';repairs=0;
          }else if(toolMode==='compat'){
            if(action.kind==='invalid'){
              feedback=action.reason;
              emit('runtime.action_repair',{reason:feedback,attempt:++repairs});
              if(repairs>=3)throw Error('The model could not produce a valid tool action: '+feedback);
              continue;
            }
            reply={...reply,content:action.content,tool_calls:[]};
          }else if(toolMode==='auto'&&evidenceRequired&&successfulWork===0){
            toolMode='compat';feedback='Use a real tool for the requested operation, not an unverified claim.';
            emit('runtime.tool_protocol_fallback',{reason:'Tool action was requested but model did not call a tool'});
            continue;
          }
        }
        if(!reply.tool_calls?.length&&evidenceRequired&&successfulWork===0){
          feedback='The requested action has no successful matching tool evidence ('+requiredEffect+'). Discovery, read-only calls for mutations, and failed commands do not count.';
          emit('runtime.action_repair',{reason:feedback,attempt:++repairs});
          if(repairs>=3)throw Error('Cannot verify execution: '+feedback);
          if(toolMode==='auto')toolMode='compat';
          continue;
        }
        if(!reply.tool_calls?.length&&toolMode==='compat')onEvent({type:'text',text:reply.content,runId});
        feedback='';repairs=0;
        assistant=this.saveMessage({session_id:sessionId,role:'assistant',content:reply.content,
          reasoning:reply.reasoning_content,tool_calls:reply.tool_calls?.length?reply.tool_calls:null,agent_id:agentId});
        onEvent({type:'assistant_saved',message:assistant,usage:reply.usage,runId});
        emit('runtime.model_finished',{iteration:iteration+1,toolCalls:reply.tool_calls?.length||0,toolMode});
        if(!reply.tool_calls?.length){run.status='completed';emit('runtime.completed');onEvent({type:'done',sessionId,usage:reply.usage,runId});return assistant;}
        for(const [index,call] of reply.tool_calls.entries()){
          check();
          if(run.toolCalls>=maxToolCalls)throw Object.assign(Error('Tool call limit exceeded'),{code:'BUDGET'});
          const callId=call.id||runId+':'+iteration+':'+index;
          const tool=compatTools.find(x=>x.name===call.function?.name);
          this.saveOperation({id:runId+':'+callId,runId,sessionId,callId,tool:call.function?.name||'',status:'started',startedAt:new Date().toISOString()});
          emit('runtime.tool_started',{name:call.function?.name,callId});
          let output;
          try{
            if(!tool)throw Error('Tool not enabled: '+call.function?.name);
            const args=JSON.parse(call.function?.arguments||'{}');
            const argumentError=validateToolArguments(tool,args);
            if(argumentError)throw Error('Invalid tool arguments: '+argumentError);
            onEvent({type:'tool_start',name:tool.name,args,callId});
            if(tool.name==='tool_discover'){
              output={tools:discoverCompatibleTools(tools,args.query)};
              for(const result of output.tools)if(!extraTools.includes(result.name))extraTools.push(result.name);
            }else output=await this.invokeTool(tool,args,onEvent,{signal:controller.signal,runId,callId});
            const succeeded=successfulToolEvidence(tool.name,output);
            this.saveOperation({id:runId+':'+callId,runId,sessionId,callId,tool:tool.name,status:succeeded?'completed':'failed',reason:succeeded?'':'Tool returned an unsuccessful result',finishedAt:new Date().toISOString()});
            if(succeeded)onEvent({type:'tool_end',name:tool.name,callId,result:output});
            else onEvent({type:'tool_error',name:tool.name,callId,error:'Tool returned an unsuccessful result'});
          }catch(error){
            const message=String(error?.message||error);
            output={error:message};
            this.saveOperation({id:runId+':'+callId,runId,sessionId,callId,tool:call.function?.name||'',status:controller.signal.aborted?'uncertain':'failed',reason:message,finishedAt:new Date().toISOString()});
            onEvent({type:'tool_error',name:call.function?.name,callId,error:message});
          }
          if(successfulToolEvidence(tool?.name,output,requiredEffect))successfulWork++;
          // Store tool output even if cancellation arrives just after the call completes.
          this.saveMessage({session_id:sessionId,role:'tool',tool_call_id:callId,
            content:typeof output==='string'?output:JSON.stringify(output).slice(0,30000)});
          toolOutcomes.push({name:call.function?.name||'',status:successfulToolEvidence(tool?.name,output)?'completed':'failed'});

          run.toolCalls++;
          emit('runtime.tool_finished',{name:call.function?.name,callId,error:!successfulToolEvidence(tool?.name,output)});
          check();
        }
      }
      throw Object.assign(Error('Model iteration limit reached'),{code:'LIMIT'});
    }catch(error){
      run.status=error?.code==='BUDGET'||controller.signal.reason?.code==='BUDGET'?'budget_exceeded':controller.signal.aborted?'cancelled':
        error?.code==='INTERRUPTED'?'needs_review':'failed';
      run.reason=String(error?.message||error).slice(0,1000);
      emit('runtime.'+run.status,{reason:run.reason});
      throw error;
    }finally{
      clearTimeout(deadline);
      signal?.removeEventListener('abort',externalAbort);
      run.finishedAt=new Date().toISOString();persisted();
       if(toolOutcomes.length){try{this.onOutcome?.({task,run,toolOutcomes});}catch{}}
      this.#sessions.delete(sessionId);this.#runs.delete(runId);
    }
  }
}
