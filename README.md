# DOMINION

> **당신의 모델, 당신의 도구, 당신의 실행 환경.**
>
> 독립적으로 구현한 로컬 우선 범용 AI 워크스페이스 — React 19 / TypeScript / Tailwind CSS 4 / Node.js 24 / SQLite / MCP v2.

DOMINION은 LM Studio, OpenClaw, Hermes, OpenCode의 소스를 결합한 래퍼가 아닙니다. 모델 선택·대화·도구 실행·기억·에이전트 회의·메신저 연동·작업 큐·자동화의 **실행 로직은 이 저장소의 독립적인 코드**로 구현합니다. 외부 프로그램은 선택적으로 연결하는 도구 또는 모델 공급자입니다.

## 즉시 실행

요구 사항: **Node.js 24.12+**, npm, Git. macOS / Windows / Linux에서 Node 서버와 React 화면을 실행합니다.

```bash
git clone https://github.com/hushmind3/dominion.git
cd dominion
npm install
npm run dev
```

브라우저에서 **http://127.0.0.1:5173**을 여세요. 프로덕션 모드는 `npm run build && npm start`, 주소는 **http://127.0.0.1:4317**입니다.

기본 실행은 로컬입니다. `npm run dev`는 Node API 서버와 Vite 개발 서버를 동시에 실행합니다. 선택적 설정은 `.env.example`을 참고해 루트 `.env`를 만드세요. 데이터는 `runtime/`, 에이전트 작업 파일은 `workspace/`에 저장됩니다. 이 두 경로와 API 키는 Git에 업로드되지 않습니다.

**실제 모델 연결**

1. LM Studio 앱에서 모델을 설치·로드하고 **Local Server**를 시작합니다. 일반적인 OpenAI 호환 기본 주소는 `http://127.0.0.1:1234/v1`입니다.
2. 또는 Ollama를 켜고 `http://127.0.0.1:11434/v1`로 연결합니다.
3. DOMINION → **모델 허브**에서 연결 확인. **대화**에서 제공자/모델을 고른 후 메시지를 보내세요.
4. 클라우드 모델은 **모델 허브 → 제공자 추가**에서 OpenAI 호환 Base URL과 API Key를 설정합니다. 키는 로컬 서버의 AES-256-GCM 저장소에 보관됩니다.

5. Anthropic은 **제공자 추가 → Anthropic 네이티브**를 선택하면 `/v1/messages`, 스트리밍, 도구 호출을 어댑터 없이 직접 사용합니다.

## 현재 구현된 엔진

| 영역 | 동작하는 구현 |
| --- | --- |
| 대화 | 실제 OpenAI 호환 `/chat/completions` SSE 스트리밍, 토큰·추론 텍스트 표시, 세션 영속화, 모델 선택 |
| 모델 허브 | Hugging Face 검색·상세정보·README·실제 GGUF/MLX 버전 목록, Node 독립 다운로드·재개·삭제, 설치된 모델을 로컬 추론 엔진으로 실행 |
| 로컬/클라우드 | LM Studio, Ollama, OpenAI 호환 API 공급자 등록, 키 암호화, 모델 목록 조회 |
| 에이전트 | 인원 제한 없는 개별 에이전트 등록, 역할·시스템 프롬프트·모델 설정 |
| 회의 | 가변 참가자/라운드, 한 회의 세션에 발언 누적, 모델 기반 순차 토론 |
| 도구 | 실제 도구 호출 루프, 로컬 작업공간 파일 읽기·쓰기, 터미널 실행, SearXNG 검색, 기억/스킬 제안 |
| 소형 모델 실행 | 4B급 모델처럼 네이티브 함수 호출이 없는 경우에도 JSON 동작 프로토콜을 통해 도구 발견→실행→결과 반영을 반복. JSON 오류는 재요청, 실행 없는 완료 주장 검사 |
| MCP | 공식 MCP v2 클라이언트, stdio 및 Streamable HTTP 연결, 도구 발견·호출, Registry 검색, 설치·제거 UI |
| 기억 | SQLite에 지속 저장되는 명시적 기억 검색과 스킬 제안/승인·적용 |
| 메신저 | Telegram Bot API long polling, Discord Gateway WebSocket + REST 응답 |
| 인증 | GitHub/Google OAuth 앱 연결과 토큰 암호화, GitHub 읽기·YouTube 채널 API 기초 연결 |
| 자동화 | DB 기반 영속 작업 큐, 프로세스 재시작 시 복구, 반복 예약, 로그/감사 원장 |
| UI | React/TypeScript/Tailwind 4, 반응형 사이드바, 채팅 / 명령어 자동완성·키보드 실행, 모델·에이전트·회의·MCP·계정·작업 관리 |
| 보안 | 루프백 기본 바인딩, 원격 접근 토큰 필요, 도구 승인 게이트, 작업공간 경로 제한, 서버 전용 비밀저장소 |

### 중요: 무엇까지 연결되었나

- **실제 동작은 환경에 의존합니다.** 로컬 모델을 로드하지 않았거나 API 키가 없으면 답변을 만들어 내지 않습니다. 모델이 출력한 추론만 보여줍니다. '한국어 추론' 옵션은 한국어로 제공해 달라는 요청이지 자동 번역 기능이 아닙니다.
- **컴퓨터 제어**: 파일·터미널 도구는 자체 구현. 브라우저 클릭·스크린샷은 **Playwright MCP를 별도 등록**해 수행할 수 있습니다. 독립적인 화면 인식/마우스/키보드 실행 엔진 및 원격 데스크톱은 아직 구현하지 않았습니다.
- **MCP 등록**은 실제 실행 연결을 시도합니다. 설치된 패키지의 정상 작동 여부는 사용자 컴퓨터에서 확인해야 합니다. 외부 MCP 패키지의 권한과 출처를 검토하세요.
- **Google/YouTube**는 현재 OAuth 연결과 읽기 API 예제만 동작하도록 작성했습니다. 'Google 계정 하나로 모든 구글 서비스 쓰기'는 서비스별 OAuth 범위와 API 어댑터가 더 필요합니다.
- **무료 모델/API**는 각 공급자가 제공하는 무료 엔드포인트를 직접 연결할 수 있도록 만든 것이지 별도의 무료 API 크레딧을 발급하지 않습니다.
- **스케줄러**는 DOMINION 서버가 켜져 있을 때 실행됩니다. 컴퓨터 절전 중 작업을 이어서 처리하려면 상시 실행되는 별도 서버가 필요합니다.
- **결제·구독·크레딧 측정, Electron 패키징, 원격 멀티테넌트 서비스, 네이티브 컴퓨터-비전 조작**은 이 초기 실행 버전에 포함되지 않습니다. README에서 완성된 기능으로 표시하지 않습니다.

## 기본 에이전틱 실행 엔진 — 소형 로컬 모델도 사용

DOMINION은 모델이 OpenAI 네이티브 함수 호출을 지원해야만 파일·명령어·MCP를 실행할 수 있는 구조가 아닙니다.

- **채팅 자체가 실행기입니다.** 자연어 입력 → 모델의 JSON 동작 지시 또는 네이티브 도구 호출 → 실행 엔진의 승인·도구 실행 → 실제 결과를 모델로 반환 → 다음 명령 또는 최종 답변. 별도 Goal 작성이나 수동 워크플로가 필수가 아닙니다.
- **소형 모델 호환 방식:** DOMINION Local, LM Studio, Ollama는 기본적으로 텍스트 기반 JSON 도구 프로토콜을 사용합니다. 기존에 저장한 제공자 설정도 해당 로컬 ID 및 작은 모델명으로 자동 호환 처리됩니다. 일반 API 제공자는 네이티브 도구 호출을 우선하고 미지원 응답 시 호환 방식으로 전환합니다.
- **가벼운 컨텍스트:** 소형 모델은 노출 도구 목록과 최근 대화 길이를 제한합니다. 필요한 외부 MCP 도구는 모델이 tool_discover로 찾아 이어서 호출합니다.
- **검증:** 네이티브 도구 호출이 없는 4B 유사 모의 서버로 실제 작업공간 파일 작성 통합 테스트를 수행했습니다. 실제 기기에서 내려받은 임의의 4B 모델이 모든 지시를 정확히 이해하고 실행한다는 보장은 아니며, 모델별 실행 적합성은 추가 검증 대상입니다.
- **슬래시 명령어:** 채팅 입력창에서 / 입력 시 검색 가능한 명령어가 나타납니다. Enter/Tab 선택, ↑↓ 이동, Esc 닫기. /status, /tools, /model, /agent, /stop, /new, /history, /compact, /export, /goal 등을 사용할 수 있습니다.

## 독립 모델 라이브러리 (GGUF / MLX)

DOMINION의 **모델 허브 → 모델 탐색**에서 Hugging Face의 공개 모델을 검색합니다. 검색 결과를 선택하면 GGUF 양자화 파일 또는 MLX 체크포인트 파일 묶음, 다운로드 용량, 리포지터리 README가 표시됩니다.

1. 원하는 형식·버전을 선택하고 **다운로드**합니다. Node 서버가 파일을 직접 받고 `runtime/models/<model-id>/`에 저장하며, 진행률과 **일시정지 / 재개 / 중단**을 지원합니다. 배포 파일의 원본 커밋 해시를 고정합니다.
2. **설치된 모델**에서 보유한 모델, 용량, 형식을 확인하거나 파일을 삭제합니다. 완료된 설치 목록은 서버 재시작 후에도 유지됩니다. 재시작 전에 중단된 다운로드는 같은 버전을 다시 선택하면 `.part` 파일을 이어받습니다.
3. **실행**을 누르면 로컬 추론 런타임을 실행한 뒤 `DOMINION Local` 제공자를 활성화합니다. 대화에서 해당 제공자와 모델을 선택해 사용할 수 있습니다.

모델 **다운로드·관리·UI는 LM Studio에 의존하지 않습니다.** 텍스트 생성 계산은 설치된 런타임을 사용합니다. GGUF는 `llama-server` (llama.cpp), MLX는 Apple Silicon의 `python3 -m mlx_lm.server` (`mlx-lm` 패키지) 실행 파일이 필요합니다. 찾지 못하면 DOMINION 화면에 실행 불가 상태가 표시되며 설치된 파일은 그대로 유지됩니다. 별도 바이너리가 필요한 추론 계산까지 Node 자체가 구현했다고 주장하지 않습니다.

환경변수 `DOMINION_LLAMA_SERVER`와 `DOMINION_MLX_PYTHON`으로 실행 파일 경로를 지정할 수 있습니다. 컨텍스트 길이, GGUF GPU 자동 오프로딩 여부는 모델 실행 전 지정할 수 있습니다. 모든 MLX 체크포인트의 실행 호환성, GPU 완전 오프로딩, 모델의 도구 사용 능력은 저장소 메타데이터만으로 보장되지 않습니다. 승인/인증이 필요한 gated 모델의 다운로드는 지원되지 않습니다.

## 명령

```bash
npm run dev          # Node API + Vite
npm run dev:server   # API만
npm run build        # React 생산 빌드
npm start            # dist/ 제공
npm test             # Node 테스트
npm run check        # TypeScript + Node 테스트 + 빌드
```

## 아키텍처

```text
React / Tailwind UI ── HTTP/SSE ──> Node API Gateway
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
               Agent Runtime        Provider Hub         Tool Bus
                    │                   │                   │
              Meeting / Jobs      Local / Cloud       MCP / Workspace
                    │                   │                   │
               SQLite Ledger     OpenAI compatible    Approval / Audit
                    │
              Memory / Skills / Encrypted Vault
                    │
            Telegram / Discord / OAuth
```

자세한 구현 경계는 [아키텍처](docs/ARCHITECTURE.md), 실제 원문 링크가 있는 [조사 근거 장부](docs/RESEARCH_LEDGER.md), [26종 채널별 출처와 구현 상태](docs/CHANNEL_RESEARCH.md)를 참고하세요. 검증 상황은 [docs/STATUS.md](docs/STATUS.md)에 기록합니다.

## 라이선스와 저장소 취급

새로 작성한 DOMINION 코드입니다. 과거 개인 저장소 또는 제3자 제품의 코드/페르소나/토큰을 복사하지 않았습니다. 라이선스는 별도 결정 전까지 명시적인 재배포 허가를 하지 않습니다. 본 저장소는 공개 상태이므로 비밀번호, 토큰, 개인 메시지나 모델 파일을 커밋하지 마세요.

## Electron 데스크톱 설치본과 개발 모드

설치 파일은 electron-builder로 생성합니다.

```bash
npm ci
npm run dist:win    # release/DOMINION-Setup.exe, release/DOMINION-Portable.exe
npm run dist:mac    # release/DOMINION-<version>-arm64.dmg, ...-x64.dmg
```

- 설치형/포터블 모두 시스템 Node.js 없이 Electron 내장 Node로 게이트웨이를 실행합니다.
- MCP의 `npx`는 앱에 포함된 npm과 Electron Node를 사용합니다.
- 데이터는 `%APPDATA%\dominion-desktop\runtime` (Windows) 또는 `~/Library/Application Support/dominion-desktop/runtime` (macOS)에 보존됩니다.
- 작업공간은 사용자 문서 폴더의 `DOMINION Workspace`를 계속 사용합니다.

React HMR이 필요한 개발 모드:

```bash
npm ci
npm --prefix desktop install
npm run dev:desktop
```

Vite가 `127.0.0.1:5173`, 게이트웨이가 `127.0.0.1:4317`에서 실행되고 Electron은 Vite URL을 로드합니다.

`v*` 태그를 푸시하면 GitHub Actions가 Windows/macOS 설치본을 빌드해 GitHub Releases에 업로드합니다. 현재 빌드는 **미서명**이며 macOS 공증도 없습니다. 상세 내용과 검증 기록은 [docs/DESKTOP.md](docs/DESKTOP.md)를 참고하세요.

## 설치본에서 자기 소스 개발

설치된 앱은 `고급 → 소스 개발`에서 별도 Git 소스 작업공간을 연결/클론하고, 에이전트에게 UI·엔진 수정을 요청할 수 있습니다. 테스트, 빌드, Vite HMR 미리보기, 설치 파일 생성, 업데이트 적용까지 앱 안에서 수행합니다. 설치된 `resources/app`은 직접 수정하지 않습니다.

- 기본 소스 경로: `~/DOMINION Source/dominion`
- Git: 앱에 포함된 `isomorphic-git` 사용 (시스템 Git 불필요)
- 의존성: 앱에 포함된 npm + Electron Node 사용
- 상세: [docs/DEV_STUDIO.md](docs/DEV_STUDIO.md)

## 실제 사용자 저장소 비교와 적용

- [Hermes / OpenClaw 실제 소스 분석과 DOMINION 자체 구현 경로](docs/SOURCE_COMPARISON.md)
- 메신저 연결에서 로컬/클라우드 모델 호출을 분리한 독립 회의실 실행기: `server/room-orchestrator.mjs`
- 자유로운 화자 수, 이름/별칭 호출, 중단·세대 초기화, 모델 일괄 변경을 DB와 React UI에 연결했습니다.

참고 프로젝트의 사용자 계정 토큰·설정·브라우저 프로필·모델 가중치·대화 기록은 가져오지 않습니다.
