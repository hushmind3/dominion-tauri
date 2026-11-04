# 배포 안내

## 왜 다운로드 후 실행이 막히나

macOS는 서명되지 않은 앱을 기본적으로 차단합니다. 이 빌드는 **ad-hoc 서명**만 되어 있어서
다른 Mac에서 내려받으면 "확인되지 않은 개발자" 또는 "손상됨"으로 표시됩니다.

### 사용자 해결 방법 (서명 없이 배포할 때)

1. DMG를 열고 `DOMINION.app`을 `응용 프로그램`으로 복사
2. 앱을 **우클릭 → 열기** (한 번만 하면 이후 정상 실행)
3. 또는 터미널에서:
   ```bash
   xattr -dr com.apple.quarantine /Applications/DOMINION.app
   ```

### 근본 해결 (권장)

Apple Developer ID 인증서로 서명하고 notarization을 붙이면 경고 없이 실행됩니다.
GitHub Actions에서는 `CSC_LINK`, `CSC_KEY_PASSWORD` 시크릿을 설정하면 자동 서명됩니다.

## 플랫폼별 빌드 원칙

| 산출물 | 빌드 OS | 비고 |
|---|---|---|
| `.dmg` (macOS) | macOS | Windows에서 만들 수 없음 |
| `.exe` (Windows) | Windows | NSIS 설치본 + portable |
| `.AppImage` / `.deb` | Linux | |
| 소스 zip | 어디서나 | `npm install && npm run dev` |

`.github/workflows/build.yml`이 태그(`v*`) 또는 수동 실행 시 4종을 모두 만듭니다.

## 설치 후 소스 수정

이 앱은 `asar: false`로 패키징되어 설치 후에도 소스가 그대로 들어 있습니다.

```
/Applications/DOMINION.app/Contents/Resources/app/
  server/   ← 엔진
  src/      ← UI (빌드 전 원본)
  dist/     ← 빌드된 UI
```

- 엔진(`server/`)은 설치된 앱에서 바로 수정 후 재시작하면 반영됩니다
- UI(`src/`)를 고치려면 소스 zip을 받아 `npm install && npm run dev`로 실행하는 편이 낫습니다
