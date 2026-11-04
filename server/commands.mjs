// Single command catalog for the web composer and connected chat channels.
// Transport adapters may format replies differently; command semantics are shared.
import definitions from '../shared/commands.json' with {type:'json'};
import {all,get,put} from './store.mjs';
import {newSession,renameSession,clearSession,forkSession,compactSession,activeExecutions,cancelExecution} from './engine.mjs';
import {createGoal,goal,cancelGoal} from './harness.mjs';
import {enqueue} from './jobs.mjs';
import {toolsForModel} from './tools.mjs';
import {resolveModel} from './model-router.mjs';
import {availableModels} from './providers.mjs';

export const commandDefinitions=definitions;
export function parseSlash(text){
 const parsed=String(text||'').trim().match(/^\/([a-z]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
 if(!parsed)return null;
 return {name:parsed[1].toLowerCase(),arg:(parsed[2]||'').trim()};
}
export async function channelCommand(record,event){
 const parsed=parseSlash(event.text);
 if(!parsed)return null;
 const {name,arg}=parsed;
 if(!definitions.some(x=>x.key===name))return '알 수 없는 명령어입니다. /help';
 const key=record.id+':'+event.conversationId;
 let session=all('session').find(x=>x.channelKey===key);
 const ensure=()=>{
  if(!session){
   const created=newSession({title:record.name+' · '+event.conversationId,agentId:record.agentId,providerId:record.providerId,model:record.model});
   session=put('session',{...created,channelKey:key});
  }
  return session;
 };
 if(name==='help')return definitions.map(x=>x.command+' · '+x.name).join('\n').slice(0,3900);
 if(name==='status'){
  const active=activeExecutions().filter(x=>x.sessionId===session?.id);
  const binding=get('channel_goal',key),task=binding?.goalId?goal(binding.goalId):null;
  return '세션: '+(session?.id?.slice(0,8)||'없음')+'\n실행: '+active.length+'건\n목표 작업: '+(task?.status||'없음');
 }
 if(name==='tools'){
  const tools=await toolsForModel();
  return '등록된 도구 '+tools.length+'개\n'+tools.map(x=>x.name).join(' · ').slice(0,3500);
 }
 if(name==='new'){
  if(session)put('session',{...session,channelKey:null});
  const created=newSession({title:record.name+' · '+event.conversationId,agentId:record.agentId,providerId:record.providerId,model:record.model});
  session=put('session',{...created,channelKey:key});
  return '새 세션을 만들었습니다: '+session.id.slice(0,8);
 }
 if(name==='history')return all('session').filter(x=>x.title?.startsWith(record.name+' · ')).slice(0,10).map(x=>x.id.slice(0,8)+' · '+x.title).join('\n')||'저장된 대화가 없습니다.';
 if(name==='stop'){
  let count=0;
  if(session&&cancelExecution(session.id))count++;
  const binding=get('channel_goal',key),task=binding?.goalId?goal(binding.goalId):null;
  if(task&&!['completed','failed','cancelled','needs_review','budget_exceeded'].includes(task.status)){cancelGoal(task.id);count++;}
  return count?'실행 중단을 요청했습니다.':'진행 중인 실행이 없습니다.';
 }
 if(name==='goal'){
  if(!arg)return '사용법: /goal 실행할 작업';
  const s=ensure();
  const task=createGoal({goal:arg,executor:{agentId:s.agentId,providerId:s.providerId,model:s.model}});
  put('channel_goal',{id:key,goalId:task.id});
  enqueue('goal',{goalId:task.id});
  return '자율 작업 등록: '+task.id.slice(0,8)+'\n/status로 상태를 확인하세요.';
 }
 const s=ensure();
 if(name==='name'){
  if(!arg)return '사용법: /name 새 이름';
  renameSession(s.id,arg);return '세션 이름을 변경했습니다.';
 }
 if(name==='clear'){clearSession(s.id);return '현재 세션의 대화 기록을 비웠습니다.';}
 if(name==='fork'){
  const next=forkSession(s.id);
  put('session',{...s,channelKey:null});session=put('session',{...next,channelKey:key});
  return '새 분기 세션: '+session.id.slice(0,8);
 }
 if(name==='compact'){
  const selected=await resolveModel({agentId:s.agentId,providerId:s.providerId,model:s.model});
  const result=await compactSession(s.id,selected);
  return '컨텍스트 압축: '+result.summarized+'개 메시지 요약';
 }
 if(name==='model'){
  if(!arg){
   const selected=await resolveModel({agentId:s.agentId,providerId:s.providerId,model:s.model});
   return '현재 모델: '+selected.providerId+' / '+selected.model;
  }
  const [providerId,requested]=arg.includes(':')?arg.split(/:(.+)/):[s.providerId||record.providerId,arg];
  if(!providerId)return '모델 제공자를 지정하세요: /model provider:model';
  const found=(await availableModels(providerId)).find(x=>x.id===requested);
  if(!found)return '사용할 수 없는 모델: '+requested;
  put('session',{...s,providerId,model:found.id});
  return '모델 변경: '+providerId+' / '+found.id;
 }
 if(name==='agent'){
  if(!arg)return all('agent').map(x=>x.id+' · '+x.name).join('\n').slice(0,3000);
  const agent=all('agent').find(x=>x.id===arg||x.name===arg);
  if(!agent)return '에이전트를 찾지 못했습니다: '+arg;
  put('session',{...s,agentId:agent.id,providerId:agent.providerId||s.providerId,model:agent.model||s.model});
  return '에이전트 변경: '+agent.name;
 }
 if(name==='memory')return '장기기억 '+all('memory').length+'건 · 상세 편집은 웹 작업공간에서 가능합니다.';
 if(name==='skills')return '스킬 '+all('skill').length+'건 · 상세 편집은 웹 작업공간에서 가능합니다.';
 if(name==='export')return '대화 내보내기는 DOMINION 웹 작업공간에서 실행할 수 있습니다.';
 if(name==='think')return '추론 표시 설정은 웹 채팅 화면에서 변경할 수 있습니다.';
 return '/'+name+' 화면은 DOMINION 웹 작업공간에서 열 수 있습니다.';
}
