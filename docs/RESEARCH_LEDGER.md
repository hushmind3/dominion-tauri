# DOMINION 조사 근거 장부 — 2026-11-03

**규칙: 원문 또는 공식 1차 출처 URL이 없는 조사 항목은 설계 근거로 인정하지 않습니다.** 외부 URL을 적었다는 사실과 실제 본문을 정독했다는 사실은 구분합니다. '직접 열어 비교'는 실제 원본 소스 내용을 확인한 경우에만 표시합니다. 문서 링크만 추가해 '조사 완료'라고 쓰지 않습니다.

| 조사 대상 | 공식/1차 출처 URL | 확인·차용한 개념 | DOMINION 반영 경로 | 검증 범위 |
|---|---|---|---|---|
| LM Studio + Hugging Face | https://lmstudio.ai/docs/app/api ; https://huggingface.co/docs/hub/api | 모델 REST 탐색·다운로드 API | server/providers.mjs, src/pages/Models.tsx | 코드 작성, 실기기 다운로드 미검증 |
| DeepSeek 호환 채팅 | https://api-docs.deepseek.com/api/create-chat-completion | OpenAI 호환 스트림·추론 필드 | server/providers.mjs, src/pages/Chat.tsx | Mock API 통합 테스트 |
| OpenCode | https://opencode.ai/docs/providers/ | 제공자 독립성/모델 선택 UI 참고 | server/providers.mjs, src/pages/Models.tsx | 개념 참고, 호환성 검증 아님 |
| Hermes Agent | https://github.com/NousResearch/hermes-agent | 메모리·스킬·도구 구조 비교 | server/engine.mjs, server/tools.mjs | 개념 참고, 코드 이식 없음 |
| OpenClaw 카탈로그 | https://github.com/openclaw/openclaw/blob/main/src/plugins/channel-catalog-registry.ts | 설치 기록/매니페스트 기반 채널 발견 | server/channel-registry.mjs | 원본 파일 직접 열어 비교 |
| OpenClaw 번들 읽기 | https://github.com/openclaw/openclaw/blob/main/src/channels/bundled-channel-catalog-read.ts | 번들/생성 카탈로그의 조회 구조 | server/channel-plugins/*/manifest.json | 원본 파일 직접 열어 비교 |
| OpenClaw 진입 계약 | https://github.com/openclaw/openclaw/blob/main/src/plugin-sdk/channel-entry-contract.ts | 플러그인별 진입 계약 개념 | server/channel-registry.mjs; channel-plugins/*/index.mjs | 원본 코드 경로 확인 |
| OpenClaw 설치 카탈로그 | https://github.com/openclaw/openclaw/blob/main/src/channels/plugins/catalog.ts | 설치 소스와 런타임 준비 상태 분리 | src/pages/Connections.tsx | 원본 코드 일부 직접 열어 비교 |
| Claude Code / Codex | https://code.claude.com/docs/en/mcp ; https://developers.openai.com/codex/mcp/ | MCP 도구 등록·호출 경험 비교 | server/mcp.mjs, src/pages/Extensions.tsx | 프로토콜 연결 코드 작성 |
| Playwright MCP | https://github.com/microsoft/playwright-mcp | 브라우저 컴퓨터 조작 어댑터 | src/pages/Extensions.tsx | MCP 등록 안내만, 직접 GUI 엔진 아님 |
| Orbit (사용자) | https://github.com/hushmind3/Orbit | 프로세스/관리 UI 분리 | server/index.mjs, src/App.tsx | README/구조 참고 |
| Continual Trading Agent (사용자) | https://github.com/hushmind3/continual-trading-agent | 모듈형 기록 체계 | server/store.mjs, server/jobs.mjs | README/구조 참고, 금융 코드는 복사하지 않음 |
| Hermes Desktop macOS (사용자) | https://github.com/hushmind3/hermes-desktop-macos | 페르소나/데스크톱 기능 비교 대상 | src/pages/Agents.tsx | 비공개 저장소 존재 확인, 상세 코드 감사 미완료 |
| OpenClaw (사용자) | https://github.com/hushmind3/openclaw | 사용자 설치/연동 상태 비교 대상 | server/channels.mjs | 비공개 저장소 존재 확인, 상세 코드 감사 미완료 |
| Hermes UI Collection (사용자) | https://github.com/hushmind3/hermes-ui-collection | UI 선호 비교 자료 | src/style.css | README/구조 참고 |
| Self Agent (사용자) | https://github.com/hushmind3/self-agent | 에이전트 작업 환경 비교 대상 | server/engine.mjs | README/구조 참고 |
| Project Zero (사용자) | https://github.com/hushmind3/project-zero | 독립 하네스 참조 | server/engine.mjs | README/구조 참고 |
| LLM Local Project (사용자) | https://github.com/hushmind3/llmlocalproject05 | 로컬 모델 비교 대상 | server/providers.mjs | README/구조 참고 |
| Kstock autotrader (사용자) | https://github.com/hushmind3/kstock-autotrader | 지속 작업·실행 원장 개념 | server/jobs.mjs | README/구조 참고 |
| FinRL-X-MoE (사용자) | https://github.com/hushmind3/FinRL-X-MoE | 실험 결과/실행 검증 참고 | tests/agent-integration.test.mjs | README/구조 참고 |

## 채널별 별도 조사표

메신저별 원문 출처, 카탈로그/드라이버 상태, 연결 요건은 [CHANNEL_RESEARCH.md](CHANNEL_RESEARCH.md)에 명시합니다. **공식 문서의 예제와 DOMINION 코드가 모두 존재하더라도 해당 플랫폼의 실제 계정에서 종단 간 연결을 검증했다는 의미는 아닙니다.**

## 구현과 주장 사이의 연결

- OpenClaw 원본 `channel-catalog-registry.ts`는 플러그인 발견 및 설치기록 정보를 사용합니다. DOMINION은 자체 `channel-registry.mjs`에서 `manifest.json`과 `index.mjs`를 파일시스템에서 발견하도록 새로 작성했습니다. 동일 코드나 기능 완성도를 주장하지 않습니다.
- `channels.mjs`는 실행 가능한 드라이버를 `channelDriver(kind)`로 조회합니다. 새 드라이버는 자체 플러그인 폴더를 추가할 수 있으며 코어의 채널 배열을 수정할 필요가 없습니다.
- `Connections.tsx`는 `/api/channels/catalog`를 조회하여 카드를 생성합니다. 코어에서 플러그인 ID를 직접 나열하지 않습니다.
- 준비되지 않은 채널은 `manifest.json`만 있어도 표시됩니다. 이 경우 `드라이버 미구현`으로 표시하고 연결/설치를 성공한 것처럼 표현하지 않습니다.
- 실제 모델 제공자·메신저 토큰·OAuth 앱을 사용한 로컬 테스트는 아직 수행하지 않았습니다.
