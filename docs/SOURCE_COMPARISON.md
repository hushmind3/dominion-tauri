# DOMINION · 사용자 저장소 직접 소스 비교 (2026-11-03)

## 원칙

공식 자료와 실제 동작 코드를 열어 **제약과 실행 경로를 먼저 이해하고**, DOMINION의 자체 런타임으로 문제를 다시 해결합니다. 기능 목록만 베끼거나 원본 제품의 SDK/API 함수명을 그대로 플랫폼 계약으로 삼지 않습니다. 이 보고서는 읽은 소스, 도출한 요구, 직접 작성한 코드, 실제 검증을 분리해 기록합니다.

## 직접 읽은 소스와 독립 구현

| 원본 코드 (직접 열어 확인) | 원본에서 확인한 메커니즘·문제 | DOMINION 독자 구현 | 검증 |
|---|---|---|---|
| [Hermes room bridge 소스](https://github.com/hushmind3/hermes-desktop-macos/blob/main/plugins/telegram-room-bridge/__init__.py) | Telegram 전달 계층은 대화 맥락·턴 스케줄을 생성하지 않고 별도 그룹 런타임에 위임합니다. 전달 실패 시 마지막 cursor를 유지하고, /stop 요청을 그룹 런타임에 보냅니다 | `server/room-orchestrator.mjs`, `server/channels.mjs`, `server/channel-drivers/telegram.mjs` / `matrix.mjs` : 전송과 실행 분리, 수신 성공 후 cursor 기록 | `tests/room-integration.test.mjs`, `tests/room-orchestrator.test.mjs` |
| [Hermes 모델 일괄 관리 UI](https://github.com/hushmind3/hermes-desktop-macos/blob/main/desktop-plugins/all-bots-model/plugin.js) | 사용자 선택 로스터의 모델을 일괄 설정하고 제공자 목록과 모델 검색을 제공합니다 | `server/agent-admin.mjs`: 자체 SQLite 원자적 일괄 변경, `src/pages/Agents.tsx`: React 선택·모델 UI | `tests/agent-admin.test.mjs` |
| [사용자 OpenClaw 오케스트레이터](https://github.com/hushmind3/openclaw/blob/main/allchat_orchestrator.py) | 발화한 이름/멘션에 따라 화자 결정, 세션 generation 재설정, 오래된 발언 배제, 순차 전달, 실행 중 중단. 원본은 지정된 9인과 Discord/CLI 실행 경로가 고정되어 있습니다 | `server/room-orchestrator.mjs`: 개수·이름을 하드코딩하지 않고 저장된 room/agent 데이터를 사용, 채널별 대화 세대와 개별 세션, 이름/별칭 화자 선택, abort 기반 중단 | `tests/room-integration.test.mjs` |
| [사용자 OpenClaw Discord 구성·검증](https://github.com/hushmind3/openclaw/blob/main/docs/DISCORD-SETUP.md) | 단순히 한 채널로 9명 메시지를 전달하는 방식과 실제 다중 봇 구성이 달랐습니다 | 채널을 특정 room ID에 결속해 단일 수신 이벤트가 여러 실제 에이전트 실행을 유도; 단일 봇 자격증명으로 보낸 출력에는 발언자 이름을 부착 | Mock provider E2E, Messenger 실계정 E2E 미검증 |
| [사용자 OpenClaw Telegram 구성·검증](https://github.com/hushmind3/openclaw/blob/main/docs/TELEGRAM-SETUP.md) | 봇 토큰의 단일 polling 소유자 제약, 그룹 정책/멘션 설정, 브로드캐스트 연결 | 기존 `channels.mjs` 단일 채널 worker로 접근하고 room 자체는 별도 실행; 그룹의 멘션/자동 응답 여부는 저장된 채널 설정 | 단위·Mock API 검증, 실봇 미검증 |

### 자체 런타임의 차이

- 원본 소스, 설정, 바이너리, 데이터베이스, 토큰, SOUL 또는 사용자 대화 기록을 **복사·이식하지 않았습니다**.
- 고정된 Telegram/Discord, 지정된 에이전트 개수, 원본 OpenClaw CLI 프로세스, Hermes RPC 중 어느 것도 DOMINION 엔진의 필수 구성요소가 아닙니다.
- 채널은 전송만 담당하고, 실제 대화 상태·화자 선택·라운드·취소는 DOMINION의 범용 room 실행기가 맡습니다.
- 사용자 요청 1개는 대화에 1회 저장합니다. 각 에이전트 답변은 `agent_id`에 귀속되며 모델 입력에 이전 발언자의 이름을 명시합니다.
- `/reset`은 이전 대화를 파괴하지 않고 새 세대를 생성하며, `/stop`은 실행 중인 모델 요청을 AbortSignal로 중단합니다.
- `maxTurns`는 회의실에서 선택한 에이전트 수와 관계없이 실행 상한을 정합니다. 팀 규모를 9인으로 고정하지 않습니다.
- 인바운드 DB 원장으로 같은 메시지 ID의 중복 실행을 막고, Telegram/Matrix 수신 cursor는 처리한 뒤에 기록합니다.

### 검증 범위

CI에서 Node/React TypeScript 검사, 실제 로컬 HTTP API, 모의 OpenAI 호환 SSE 서버로 여러 화자의 모델 호출과 히스토리 분리, 초기화, LINE 1회 답장 제한, JSON/SQLite 영속성 검증을 수행했습니다. **실제 Telegram·Discord·LINE·WhatsApp 계정의 송수신은 아직 테스트하지 않았으며**, Bot Platform의 이벤트 재전송·권한·메시지 길이·요금 제한 등은 별도 실계정 통합 검증이 필요합니다.

아울러 현재 실행기는 `rounds`와 `maxTurns`로 묶인 순차 발언입니다. 상황에 따라 자기 판단으로 새 멤버를 초대하거나 끝없이 자발 토론하는 시스템, 조직 자율운영·자기학습 엔진이라고 주장하지 않습니다.
