# DOMINION 데스크톱 패키징

## 산출물

| 플랫폼 | 파일 | 비고 |
|---|---|---|
| Windows | `release/DOMINION-Setup.exe` | NSIS 설치형, 사용자 단위 설치 |
| Windows | `release/DOMINION-Portable.exe` | 설치 없이 실행 |
| macOS Apple Silicon | `release/DOMINION-<version>-arm64.dmg` | 미서명 |
| macOS Intel | `release/DOMINION-<version>-x64.dmg` | 미서명 |

```powershell
npm ci
npm run dist:win
```

```bash
npm ci
npm run dist:mac
```

`release/`는 `.gitignore` 대상이며 설치 파일을 Git에 커밋하지 않습니다.

## 독립 실행 구조

- Electron 45의 내장 Node(24.x)가 `server/index.mjs`를 `ELECTRON_RUN_AS_NODE`로 실행합니다.
- `asar: false`로 패키징해 게이트웨이가 `server/`, `shared/`, `dist/`, `node_modules/`를 일반 파일처럼 읽습니다.
- 시스템 Node/npm이 없어도 됩니다. MCP의 `npx` 실행은 앱에 포함된 `npm` CLI와 Electron Node로 대체됩니다.
- ComfyUI 영상 엔진은 용량이 큰 선택형 외부 구성요소라 설치 파일에 포함하지 않습니다. 기존처럼 별도 경로/URL로 연결합니다.

## 데이터 보존

설치·재설치·업데이트 시 아래 경로를 그대로 사용합니다.

- Windows: `%APPDATA%\dominion-desktop\runtime`
- macOS: `~/Library/Application Support/dominion-desktop/runtime`
- 작업공간: 사용자 문서 폴더의 `DOMINION Workspace`

SQLite DB, API 키, 설정, 기억, 스킬, 로컬 모델 캐시가 이 디렉터리에 남습니다. NSIS는 `deleteAppDataOnUninstall: false`입니다.

## 개발 모드와 HMR

```bash
npm ci
npm --prefix desktop install
npm run dev:desktop
```

- Vite: `http://127.0.0.1:5173` (React HMR)
- 게이트웨이: `http://127.0.0.1:4317`
- Electron은 Vite URL을 로드하므로 UI 수정이 즉시 반영됩니다.
- 설치형 앱을 다시 만들려면 `npm run dist:win` / `npm run dist:mac`을 다시 실행합니다.

## GitHub 자동 배포

`.github/workflows/release.yml`

- `v*` 태그 푸시 시 Windows/macOS 빌드
- Windows: 설치형·포터블 생성 후 **언팩 앱과 실제 설치 앱 모두 스모크 테스트**
- macOS: DMG를 마운트해 앱을 복사한 뒤 스모크 테스트
- 두 빌드가 성공하면 GitHub Releases에 `.exe`와 `.dmg` 업로드

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 서명 상태

현재 빌드는 **미서명**입니다.

- Windows: 코드 서명 인증서가 없어 SmartScreen 경고가 날 수 있습니다.
- macOS: `identity: null`, 공증(notarization) 없음. Gatekeeper가 차단할 수 있으며, 이 빌드를 서명본이라고 표시하지 않습니다.
- 정식 배포 시 Windows 인증서와 Apple Developer ID/공증 자격 증명을 CI 시크릿에 연결해야 합니다.

## 검증 기록

Windows 로컬 검증(2026-11-04):

- `DOMINION-Setup.exe` 무인 설치 성공
- 설치된 앱 실행, 창 표시, `/api/health` 응답 확인
- 설치된 앱에서 MCP 43개 도구 검색 성공 (Filesystem, Hugging Face, Playwright)
- 설치된 앱에서 로컬 GGUF 9B 모델 로드 후 추론 성공 (`3+4 = 7`)
- 앱 종료 후 게이트웨이 포트와 프로세스 종료 확인
- 재설치 후 세션 3개, MCP 3개, 프로바이더 1개, 로컬 모델 2개 유지 확인
- `DOMINION-Portable.exe` 실행·API 응답·종료 확인
- 설치된 앱 스모크 테스트: `ok=true`, Electron 45.2.1 / Node 24.22.1
- `npm run dev:desktop`으로 Vite 5173 + 게이트웨이 4317 + Electron HMR 창 실행 확인

macOS는 이 Windows 환경에서 실제 설치·실행 검증을 할 수 없습니다. GitHub Actions의 DMG 마운트·스모크 테스트 결과로만 확인하며, 서명/공증은 되어 있지 않습니다.
