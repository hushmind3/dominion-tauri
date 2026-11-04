// DOMINION-owned ingress: direct tool loop for ordinary chat, planned work for
// multi-stage implementation requests. All execution uses the same runTurn runtime.
import {get,put,writeMessage,bus} from './store.mjs';
import {runTurn} from './engine.mjs';
import {createGoal,goal,runGoal,cancelGoal} from './harness.mjs';

export function shouldPlan(input){
 const text=String(input||'').trim();
 if(text.length<14)return false;
 const action=/(?:만들|구현|개발|구축|작성|수정|배포|설치|테스트|검증|자동화|create|implement|build|deploy|develop|refactor)/i.test(text);
 if(!action)return false;
 const phases=(text.match(/(?:설계|계획|구현|개발|구축|테스트|검증|배포|설치|수정|연동|완성|부터|까지|design|implement|test|deploy|verify|integrate)/gi)||[]).length;
 return phases>=2&&/(?:프로젝트|시스템|서비스|웹사이트|앱|플랫폼|엔진|워크플로|자동화|project|system|website|application|platform|engine|workflow|전체|전부|완성)/i.test(text);
}
export async function runIntent({sessionId,agentId,providerId,model,input,onEvent=()=>{},...options}){
 if(!shouldPlan(input))return runTurn({sessionId,agentId,providerId,model,input,onEvent,...options});
 const session=get('session',sessionId);if(!session)throw Error('Session not found');
 const request=String(input).trim();
 writeMessage({session_id:sessionId,role:'user',content:request,agent_id:agentId});
 const task=createGoal({goal:request,executor:{agentId:agentId||session.agentId,providerId:providerId||session.providerId,model:model||session.model}});
 put('session_goal',{id:sessionId,goalId:task.id});
 const listener=event=>{
  if(event.runId===task.id)onEvent({type:'goal_progress',goalId:task.id,status:goal(task.id)?.status,event:event.type});
 };
 bus.on('goal_event',listener);
 let result;
 try{result=await runGoal(task.id);}
 finally{bus.off('goal_event',listener);}
 const answer=result.status==='completed'?result.summary:
  '실행 상태: '+result.status+'\n'+(result.reason||'결과 검토 또는 추가 설정이 필요합니다.')+
  '\n실행 기록: '+task.id;
 const message=writeMessage({session_id:sessionId,role:'assistant',content:answer,agent_id:agentId});
 onEvent({type:'assistant_saved',message,goalId:task.id});
 onEvent({type:'done',sessionId,goalId:task.id});
 return message;
}
export function cancelSessionIntent(sessionId){
 const current=get('session_goal',sessionId),run=current?.goalId?goal(current.goalId):null;
 if(!run||['completed','failed','cancelled','needs_review','budget_exceeded'].includes(run.status))return false;
 cancelGoal(run.id);return true;
}
