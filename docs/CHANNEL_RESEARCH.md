# 메신저·채널별 1차 문서 근거

카탈로그에는 **26종**이 표시되지만 드라이버 소스가 있는 것은 **7종**입니다. 준비된 7종도 계정·토큰 없이 실제 연결 검증이 끝났다는 뜻이 아닙니다. `드라이버 있음`은 `index.mjs`와 별도 어댑터의 존재만 표시합니다.

| 채널 | 공식 또는 프로젝트 1차 출처 | DOMINION 상태 | 조사/설계 메모 |
|---|---|---|---|
| telegram | https://core.telegram.org/bots/api | 드라이버 작성 · 현장 검증 전 | getUpdates / webhook 모두 공식 지원. DOMINION은 현재 polling 경로 작성 |
| discord | https://discord.com/developers/docs/topics/gateway | 드라이버 작성 · 현장 검증 전 | Gateway intents, 이벤트/REST 응답 |
| slack | https://docs.slack.dev/apis/events-api/using-socket-mode/ | 드라이버 작성 · 현장 검증 전 | Socket Mode connections.open과 ack |
| matrix | https://spec.matrix.org/latest/client-server-api/ | 드라이버 작성 · 현장 검증 전 | /sync, room send API |
| whatsapp | https://developers.facebook.com/docs/whatsapp/cloud-api/ | 드라이버 작성 · 현장 검증 전 | Cloud API messages/webhook; Meta 검증 |
| line | https://developers.line.biz/en/docs/messaging-api/receiving-messages/ | 드라이버 작성 · 현장 검증 전 | 서명 검증, 비동기 처리, 중복 webhookEventId |
| signal | https://github.com/bbernhard/signal-cli-rest-api | 드라이버 작성 · 현장 검증 전 | 비공식 브리지 REST/WebSocket |
| googlechat | https://developers.google.com/workspace/chat/overview | 카탈로그만 · 연결 불가 | Google Workspace Chat app |
| teams | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/what-are-bots | 카탈로그만 · 연결 불가 | Bot Framework |
| mattermost | https://developers.mattermost.com/integrate/reference/websocket-api/ | 카탈로그만 · 연결 불가 | Mattermost API |
| zulip | https://zulip.com/api/ | 카탈로그만 · 연결 불가 | Zulip API |
| rocketchat | https://developer.rocket.chat/apidocs | 카탈로그만 · 연결 불가 | Rocket.Chat API |
| irc | https://ircv3.net/ | 카탈로그만 · 연결 불가 | IRCv3 specification |
| twitch | https://dev.twitch.tv/docs/chat/ | 카탈로그만 · 연결 불가 | Twitch Chat API |
| imessage | https://github.com/openclaw/openclaw/blob/main/docs/channels/imessage.md | 카탈로그만 · 연결 불가 | OpenClaw iMessage channel source document |
| kakaotalk | https://i.kakao.com/docs | 카탈로그만 · 연결 불가 | Kakao i Open Builder docs |
| nostr | https://github.com/openclaw/openclaw/blob/main/docs/channels/nostr.md | 카탈로그만 · 연결 불가 | OpenClaw Nostr channel documentation |
| sms | https://github.com/openclaw/openclaw/blob/main/docs/channels/sms.md | 카탈로그만 · 연결 불가 | OpenClaw Twilio SMS channel documentation |
| feishu | https://github.com/openclaw/openclaw/blob/main/docs/channels/feishu.md | 카탈로그만 · 연결 불가 | OpenClaw Feishu channel documentation |
| nextcloud-talk | https://github.com/openclaw/openclaw/blob/main/docs/channels/nextcloud-talk.md | 카탈로그만 · 연결 불가 | Nextcloud Talk channel documentation |
| wechat | https://github.com/openclaw/openclaw/blob/main/docs/channels/wechat.md | 카탈로그만 · 연결 불가 | WeChat plugin source documentation |
| wecom | https://github.com/openclaw/openclaw/blob/main/docs/channels/wecom.md | 카탈로그만 · 연결 불가 | WeCom external plugin docs |
| zalo | https://github.com/openclaw/openclaw/blob/main/docs/channels/zalo.md | 카탈로그만 · 연결 불가 | Zalo setup docs |
| qqbot | https://github.com/openclaw/openclaw/blob/main/docs/channels/qqbot.md | 카탈로그만 · 연결 불가 | QQ Bot setup docs |
| synology-chat | https://github.com/openclaw/openclaw/blob/main/docs/channels/synology-chat.md | 카탈로그만 · 연결 불가 | Synology Chat webhook docs |
| x | https://github.com/openclaw/openclaw/blob/main/docs/channels/x.md | 카탈로그만 · 연결 불가 | X channel docs |

## 공통 흐름

`channel-plugins/*/manifest.json → channel-registry.mjs(파일 발견) → channel-plugins/*/index.mjs(드라이버 등록) → channels.mjs(공통 수신/라우팅/보관) → engine.mjs(에이전트 실행) → src/pages/Connections.tsx(카탈로그 조회)`

**현재 제한:** Telegram은 polling 구현, webhook 모드는 아직 없습니다. LINE 문서는 동일 `webhookEventId`가 중복될 수 있다고 명시하므로 영속 중복제거가 추가되어야 합니다. 일부 플랫폼(WhatsApp/LINE)은 실제 공개 HTTPS 엔드포인트가 필요합니다. Signal 브리지는 별도 서비스이며 공식 Signal API가 아닙니다.
