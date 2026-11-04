# DOMINION Architecture · 2026-11-03

## 설계 원칙

1. **독립적 엔진**: 다른 에이전트 제품의 프로그램을 통째로 기동하거나 iframe으로 붙여 기본 동작으로 사용하지 않는다. 외부 인터페이스는 프로토콜 어댑터.
2. **범용성**: 특정 업무(투자, 코딩, 9명 봇 등)를 플랫폼 코어의 전제로 하지 않는다. 에이전트, 도구, 채널, 모델은 설정·DB 데이터.
3. **로컬 우선**: 별도 클라우드 계정 없이 게이트웨이와 UI가 기동. 모델 호출 시에만 공급자 필요.
4. **검증 가능한 실행**: 대화 스트림, 도구 승인, 실행 결과, 오류, 작업 상태를 별도로 기록. 가짜 모델 출력이나 가짜 결과를 만들지 않는다.
5. **확장 가능한 경계**: provider / MCP / tool / chat / job / gateway / memory / skills / connector 간 책임 분리.
6. **사용자 권한**: 도구 호출은 기본 승인제, 루프백 서버, 암호화된 비밀저장소. 자동 승인은 사용자가 별도 선택.

## 참고 자료와 검증 근거

개별 저장소와 공식 제품의 조사 근거는 [조사 근거 장부](RESEARCH_LEDGER.md)에 **출처 URL·반영 파일·검증 범위를 한 행씩** 기재했습니다. OpenClaw의 실제 플러그인 메타데이터 로딩·설치기록 코드를 직접 열어 확인한 후, 코드 복사 없이 자체 `channel-registry.mjs`로 구현했습니다.

메신저별 문서 URL과 드라이버/예정 상태는 [채널 조사표](CHANNEL_RESEARCH.md)에 있습니다. URL이 없는 행은 조사 완료로 표시하지 않습니다.

공개된 사용자 저장소의 **실제 실행 코드까지 열어 비교**한 기록은 [SOURCE_COMPARISON.md](SOURCE_COMPARISON.md)에 있습니다. 모델 일괄 지정·수신/실행 분리·대화 세대·메신저 메시지 중복 방지의 원본 경로와 자체 구현 경로, 테스트를 1:1로 연결했습니다.

## 공통 실행 엔진 (Execution Runtime)

**실행 엔진이 코어이며, 목표 관리나 워크플로는 호출자입니다.**

\`채팅 / 에이전트 / 회의 / 워크플로 / 자동화 → ExecutionRuntime → Model Adapter → Tool Dispatcher(MCP 포함) → Result Persistence → 다음 추론\`

- `server/tool-compat.mjs`는 네이티브 함수 호출이 없어도 작동하는 단일 JSON 행동 프로토콜, 제한된 도구 목록, 동적 tool_discover, 인수 검증, 오류 피드백 재시도를 제공한다.
- 로컬 로더/LM Studio/Ollama는 소형 모델 호환 실행이 기본이다. 네이티브 도구 호출 API에서는 미지원 응답이나 동작 미이행 시 호환 모드로 전환한다.
- 매 실행에 고유 run ID, 세션, 모델, 상태, 모델 호출/도구 호출/토큰 사용량을 저장한다.
- 모델 호출, 도구 승인 대기, 터미널, 웹 검색 및 파일 쓰기에 취소 신호를 전달한다.
- 기본 8회 모델 순환, 64회 도구 호출, 10만 토큰, 15분의 상한을 둔다. 상한은 제한된 범위 내에서 조절할 수 있다.
- 도구 실행 의도를 결과보다 먼저 기록하고, 비정상 종료 시 미완료 호출을 미확정으로 표시한다. 과거 세션의 미응답 도구 호출을 자동 재실행하지 않는다.
- UI의 실행 엔진 콘솔은 에이전트 작업을 큐에 등록하고 실제 실행 이력과 호출 기록을 조회한다.
- 취소는 가능한 하위 도구로 전파하지만 외부 MCP 및 원격 API의 이미 시작된 부작용을 되돌리는 트랜잭션은 아니다. OS 프로세스 격리도 후속 구현 범위다.

## 컴포넌트

- `server/store.mjs`: SQLite WAL, `records`, `messages`, `audit` 테이블, 이벤트 버스.
- `server/vault.mjs`: AES-256-GCM token vault. 256-bit master key는 `runtime/master.key`에 별도 보관.
- `server/providers.mjs`: 모델 목록, Hugging Face REST, LM Studio REST, OpenAI 호환 SSE.
- `server/mcp.mjs`: MCP v2 세션, HTTP/stdio 클라이언트, 도구 발견·호출.
- `server/tools.mjs`: 내장 tool schema, 승인, sandbox-like workspace path 제한, 실제 툴 실행.
- `server/execution-runtime.mjs`: 범용 실행 루프, 모델/도구 실행, 예산, 취소, 런타임 상태 체크포인트, 호출별 실행 장부. 특정 작업 유형을 알지 않는다.
- `server/engine.mjs`: 채팅/에이전트/회의실 진입점. 모든 모델 턴을 공통 Runtime에 위임하며 세션 중복 실행을 방지한다.
- `server/jobs.mjs`: persistent job queue, recovery, 일정 반복.
- `server/channels.mjs`: 채널별 독립 드라이버/공통 수신·작업 배분, room 연결, 메시지 중복 방지.
- `server/room-orchestrator.mjs`: 그룹 발언자 라우팅, 대화 세대, 취소, 화자별 모델·발언 기록.
- `server/agent-admin.mjs`: 동적 에이전트 로스터 및 원자적 모델 일괄 변경.
- `server/oauth.mjs`: Google/GitHub OAuth & 최소 읽기 연결.
- `server/index.mjs`: REST / SSE / 정적 파일.
- `src/pages/*`: API 연결형 React 컴포넌트, mock data 미사용.

## 알려진 초기 버전 한계

- SQLite 싱글 프로세스/서버 모델. 수천 명 동시 사용자용 다중 테넌시, Redis/PG, 분산 워커/요금측정 없음.
- 회의실은 순차 에이전트 발언 구조, 진정한 병렬성·비동기 자유발화/자발적 스케줄 변경은 차기 과제.
- 기억은 명시적 텍스트 매칭과 스킬 재사용. 의미 기반 장기기억, 자동 리플렉션, 자기 코드 개선·롤백·평가 루프는 미구현.
- Playwright MCP 연결로 UI 조작 기능을 가져올 수 있으나 플랫폼 고유 컴퓨터 비전·화면 탐지·보안 컨테이너는 아직 아님.
- GitHub OAuth 어댑터는 저장소 목록과 프로필 읽기. 커밋/이슈/PR 쓰기는 별도 도구 개발이 필요.
- YouTube OAuth는 읽기 스코프만 요청. 영상 업로드/댓글 수정 기능을 주장하지 않는다.
- HTTP MCP 연결은 토큰 Bearer; OAuth 연쇄 갱신·서버 목록 자동 인증은 후속 과제.
- LM Studio downloads에는 설치된 LM Studio 버전과 다운로드 API 활성 상태의 영향이 있다.

## 다음 독립 구현 우선순위

1. Node 실행 엔진 도구별 사전·사후 평가, 중단/재시작 가능한 task graph, 프로세스 격리 및 권한.
2. Chromium computer-use: 화면 캡처, UI 인식, 마우스/키보드, 네이티브 macOS/Windows 브리지.
3. agent reflection loop: 행동→검증→기억 후보→스킬 테스트→승인→롤백.
4. 공개 provider marketplace, OAuth scope 브로커, GitHub/Google/YouTube API 쓰기 액션.
5. Electron 설치파일 서명·배포 + 자동 업데이트 + 로컬/원격 노드.
6. SaaS 멀티테넌시, API 사용량 측정, 구독/크레딧/결제.
