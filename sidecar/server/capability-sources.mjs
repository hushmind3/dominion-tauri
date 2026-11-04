// First-party dynamic feeds into the generic DOMINION capability kernel.
// These feeds expose resources already owned by the engine, not copied placeholders.
import {kernel} from './capability-kernel.mjs';
import './channel-registry.mjs'; // Load on-disk channel capabilities before building the aggregate inventory.
import {providers,availableModels} from './providers.mjs';
import {mcpServers,discoverMcp} from './mcp.mjs';
import {all,put,get} from './store.mjs';
import {builtin} from './tools.mjs';
import {oauthProviders,oauthCallbackBase,connections as oauthConnections} from './oauth.mjs';

const toolTitles={
 workspace_list:'워크스페이스 목록',workspace_read:'워크스페이스 읽기',workspace_write:'워크스페이스 쓰기',
 file_list:'폴더 목록',file_read:'파일 읽기',file_write:'파일 쓰기',
 shell_exec:'셸 명령 실행',terminal_exec:'프로그램 실행',
 web_search:'웹 검색',http_fetch:'웹 페이지 가져오기',
 account_status:'계정 상태',github_api:'GitHub API',youtube_search:'YouTube 검색',youtube_channels:'YouTube 채널',youtube_upload:'YouTube 업로드',
 memory_store:'기억 저장',memory_search:'기억 검색',skill_propose:'스킬 제안',
 dev_status:'개발 상태',dev_connect:'소스 연결',dev_setup:'의존성 설치',dev_list:'소스 목록',dev_read:'소스 읽기',dev_write:'소스 쓰기',dev_diff:'변경 비교',dev_test:'테스트 실행',dev_build:'UI 빌드',dev_package:'설치 파일 빌드',dev_preview_start:'미리보기 시작',dev_preview_stop:'미리보기 중지'
};
const toolDescKo={
 workspace_list:'워크스페이스의 파일과 폴더 목록을 봅니다.',
 workspace_read:'워크스페이스의 텍스트 파일을 읽습니다.',
 workspace_write:'워크스페이스에 파일을 씁니다. (워크스페이스 기준 경로만)',
 file_list:'컴퓨터의 아무 폴더나 절대 경로로 목록을 봅니다. (바탕화면·문서·다운로드 등)',
 file_read:'컴퓨터의 텍스트 파일을 절대 경로로 읽습니다.',
 file_write:'컴퓨터 어디든 파일을 만들거나 덮어씁니다. (바탕화면 등 워크스페이스 밖 포함)',
 shell_exec:'셸 명령을 실행하고 출력·오류를 돌려줍니다. 설치·네트워크·스크립트 작업에 사용합니다.',
 terminal_exec:'셸 없이 프로그램을 인자 배열로 실행합니다.',
 web_search:'현재 정보를 웹에서 검색합니다.',
 http_fetch:'URL을 가져와 읽을 수 있는 텍스트로 돌려줍니다.',
 account_status:'연결된 OAuth 계정과 사용 가능한 연동을 보여줍니다.',
 github_api:'연결된 GitHub 계정으로 REST API를 호출합니다. 쓰기 요청은 승인이 필요합니다.',
 youtube_search:'연결된 Google 계정으로 YouTube 영상을 검색합니다.',
 youtube_channels:'연결된 YouTube 채널과 통계를 봅니다.',
 youtube_upload:'로컬 영상을 YouTube에 업로드합니다. 승인과 업로드 권한이 필요합니다.',
 memory_store:'다음 대화에서 쓸 사실을 기억에 저장합니다.',
 memory_search:'저장된 지식에서 관련 내용을 찾습니다.',
 skill_propose:'재사용할 스킬 초안을 만들어 검토를 요청합니다.',
 dev_status:'연결된 소스 작업공간·의존성·변경 파일·미리보기·설치본 상태를 확인합니다.',
 dev_connect:'기존 소스 폴더를 연결하거나 저장소를 별도 작업공간으로 복제합니다.',
 dev_setup:'소스 작업공간의 개발 의존성을 설치합니다.',
 dev_list:'소스 작업공간의 파일 목록을 봅니다.',
 dev_read:'소스 파일을 읽습니다.',
 dev_write:'소스 파일을 수정합니다. 설치된 앱 리소스가 아니라 소스 작업공간에 씁니다.',
 dev_diff:'변경된 파일과 diff를 보여줍니다.',
 dev_test:'소스 테스트를 실행합니다.',
 dev_build:'React UI를 빌드합니다.',
 dev_package:'Windows 설치 파일 또는 macOS DMG를 만듭니다.',
 dev_preview_start:'소스 미리보기 서버를 켭니다.',
 dev_preview_stop:'소스 미리보기 서버를 끕니다.'
};
const cleanId=v=>String(v).replace(/[^a-zA-Z0-9_-]/g,'_').toLowerCase().slice(0,65);
kernel.feed('model',{
 list:()=>providers().map(x=>({
  id:cleanId(x.id),sourceId:x.id,name:x.name,description:x.description||x.baseUrl,
  status:x.enabled?'configured':'disabled',available:Boolean(x.enabled),
  features:[x.local?'local':'cloud',x.kind],fields:[],origin:'provider'
 })),
 execute:(id,op)=>{
  if(op!=='models')throw Error('Unsupported model provider operation');
  const original=providers().find(x=>cleanId(x.id)===id);if(!original)throw Error('Provider not found');
  return availableModels(original.id);
 }
});
kernel.feed('mcp',{
 list:()=>mcpServers().map(x=>({
  id:cleanId(x.id),sourceId:x.id,name:x.name,description:x.transport==='http'?x.url:x.command,
  status:x.enabled?'configured':'disabled',available:Boolean(x.enabled),
  features:[x.transport],fields:[],origin:'mcp'
 })),
 execute:async(id,op)=>{
  if(op!=='tools')throw Error('Unsupported MCP operation');
  const actual=mcpServers().find(x=>cleanId(x.id)===id);if(!actual)throw Error('MCP not found');
  return (await discoverMcp()).filter(x=>x.mcpId===actual.id);
 }
});
kernel.feed('skill',{
 list:()=>all('skill').map(x=>({
  id:cleanId(x.id),sourceId:x.id,name:x.name,description:String(x.instructions||'').slice(0,120),
  status:x.enabled?'enabled':'disabled',available:Boolean(x.enabled),features:['knowledge'],fields:[],origin:'skill'
 })),
 execute:(id,op,input)=>{
  if(op!=='activate'&&op!=='deactivate')throw Error('Unsupported skill operation');
  const entry=all('skill').find(x=>cleanId(x.id)===id);if(!entry)throw Error('Skill not found');
  return put('skill',{...entry,enabled:op==='activate'});
 }
});
kernel.feed('account',{
 list:()=>{const accounts=oauthConnections();return oauthProviders().map(x=>({
  id:x.id,name:x.id==='github'?'GitHub':'Google',description:'OAuth connector',
  status:x.configured?'configured':'requires_setup',available:Boolean(x.configured),connected:accounts.some(account=>account.provider===x.id),
  features:['oauth'],fields:[],origin:'oauth',callback:oauthCallbackBase()+'/api/oauth/'+x.id+'/callback'
 }))}
});
kernel.feed('tool',{
 list:()=>builtin.map(x=>({
  id:cleanId(x.name),name:toolTitles[x.name]||x.name,description:toolDescKo[x.name]||x.description||'',status:'ready',available:true,
  features:['agent_tool'],fields:[],origin:'builtin'
 }))
});
export const capabilityInventory=(family)=>{
 const rows=kernel.list(family);
 // Channel drivers report a verification stamp only after a real successful connection.
 for(const row of rows)if(row.namespace==='channel')row.verifiedAt=get('driver_health',row.id)?.lastConnectedAt||'';
 return rows;
};
export const capabilityExecute=(family,id,operation,input)=>kernel.invoke(family,id,operation,input);
