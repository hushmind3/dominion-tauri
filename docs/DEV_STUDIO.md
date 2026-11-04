# 소스 개발 스튜디오

설치된 DOMINION에서 자기 React UI와 Node 실행엔진을 수정하기 위한 기능입니다. 설치된 앱의 `resources/app`은 절대 직접 수정하지 않습니다.

## 구조

- 설치 앱: `resources/app` (읽기 전용 취급)
- 소스 작업공간: 기본 `~/DOMINION Source/dominion`
- Git: `isomorphic-git`으로 클론·상태·커밋 (시스템 Git 불필요)
- 의존성: 앱에 포함된 npm CLI + Electron 내장 Node로 `npm ci`
- 미리보기: 소스의 Vite 개발 서버 + 설치 앱 게이트웨이 API 프록시
- 설치본: 소스의 `release/`에서 생성

## 사용 흐름

1. `고급 → 소스 개발`
2. 소스 폴더와 저장소 URL을 지정하고 **연결 / 클론**
3. **개발 환경 구성** (`npm ci`)
4. 에이전트에게 "DOMINION UI 수정해"라고 요청하거나 직접 파일을 수정
5. **테스트** → **UI 빌드**
6. **미리보기 시작** → **미리보기 열기** (HMR)
7. **설치 파일 생성**
8. **업데이트 적용** (설치 앱 재시작)

## 에이전트 도구

에이전트는 다음 도구를 사용할 수 있습니다.

- `dev_status`, `dev_connect`, `dev_setup`
- `dev_list`, `dev_read`, `dev_write`
- `dev_diff`, `dev_test`, `dev_build`, `dev_package`
- `dev_preview_start`, `dev_preview_stop`

`dev_write`, `dev_setup`, `dev_test`, `dev_build`, `dev_package`, `dev_preview_start`는 승인 정책을 따릅니다.

## 미리보기

- 설치 앱 게이트웨이는 계속 실행됩니다.
- 소스 Vite 서버는 별도 포트에서 실행됩니다.
- `vite.config.ts`의 `/api` 프록시는 `DOMINION_API_URL`을 사용합니다.
- 미리보기 창은 Electron IPC로 열리며 UI 수정이 HMR로 즉시 반영됩니다.

## 업데이트

- Windows: `DOMINION-Setup.exe`를 무인 설치 `/S`한 뒤 설치된 앱을 다시 시작합니다.
- macOS: DMG를 마운트해 현재 `.app` 번들을 같은 위치에 교체한 뒤 다시 엽니다.
- 업데이트 전에 테스트·빌드가 통과한 설치 파일만 사용합니다.
- 모델, 기억, 설정, API 키, 스킬, 작업공간은 `%APPDATA%\dominion-desktop` (macOS `~/Library/Application Support/dominion-desktop`)에 남아 업데이트와 독립적으로 보존됩니다.

## 주의

- 미서명 Windows/macOS 빌드는 SmartScreen/Gatekeeper 경고가 날 수 있습니다.
- macOS에서 `/Applications`가 관리자 권한을 요구하면 자동 교체가 실패할 수 있습니다.
- ComfyUI 영상 엔진은 선택형 외부 구성요소이며 소스 개발 업데이트와 별개입니다.

## 검증 기록 (Windows)

2026-11-04, 설치된 v0.2.7 앱에서 실제 수행:

1. 설치 앱의 소스 개발 API로 `src/pages/Developer.tsx`의 화면 제목과 `package.json` 버전을 수정
2. 설치 앱 안에서 `npm test` 실행 → 통과
3. 설치 앱 안에서 Vite UI 빌드 → 통과
4. 설치 앱 안에서 electron-builder로 `DOMINION-Setup.exe` v0.2.8 생성 → 통과
5. 설치 앱의 **업데이트 적용**으로 v0.2.8 설치 → helper 로그 `installer exit 0`, `started ...`
6. 자동 재시작 후 화면 제목 `소스 개발 스튜디오 v0.2.8` 확인
7. 세션 10개, MCP 3개 유지 확인

업데이트 로그: `%TEMP%\dominion-update.log`

macOS의 앱 내 업데이트 적용은 이 Windows 환경에서 실행 검증하지 못했습니다. DMG 빌드·마운트·스모크 테스트는 GitHub Actions에서 수행됩니다.
