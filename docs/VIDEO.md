# 영상 생성 (ComfyUI + Wan 2.1)

영상 메뉴는 ComfyUI를 영상 엔진으로 사용합니다. 채팅 모델과 별개이며, 워크플로마다 사용하는 영상 모델이 다릅니다.

## 1. ComfyUI 설치

```powershell
git clone --depth 1 https://github.com/comfyanonymous/ComfyUI C:\ComfyUI
uv venv --python 3.12 C:\ComfyUI\.venv
uv pip install --python C:\ComfyUI\.venv\Scripts\python.exe torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
uv pip install --python C:\ComfyUI\.venv\Scripts\python.exe -r C:\ComfyUI\requirements.txt
```

## 2. Wan 2.1 1.3B 모델

```powershell
$base='https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files'
curl.exe -L --fail -o C:\ComfyUI\models\diffusion_models\wan2.1_t2v_1.3B_fp16.safetensors "$base/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors"
curl.exe -L --fail -o C:\ComfyUI\models\text_encoders\umt5_xxl_fp8_e4m3fn_scaled.safetensors "$base/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"
curl.exe -L --fail -o C:\ComfyUI\models\vae\wan_2.1_vae.safetensors "$base/vae/wan_2.1_vae.safetensors"
```

약 9.8GB입니다. 8GB VRAM에서는 `--lowvram`으로 실행하세요.

## 3. 워크플로

`examples/video-workflows/Wan 2.1 T2V 1.3B.json`을 아래 폴더에 복사합니다.

```
C:\Users\<사용자>\Documents\DOMINION Workspace\video-workflows\
```

워크플로는 ComfyUI의 **API 형식** JSON이며 아래 자리표시자를 지원합니다.

- `{{prompt}}`, `{{negative}}`
- `{{width}}`, `{{height}}`
- `{{frames}}`, `{{fps}}`, `{{seed}}`

## 4. 실행

1. 영상 제작 화면에서 **ComfyUI 시작**을 누릅니다. (또는 `C:\ComfyUI\.venv\Scripts\python.exe C:\ComfyUI\main.py --lowvram`)
2. 워크플로를 선택합니다.
3. 프롬프트와 화면 비율, 길이를 정합니다.
4. **영상 생성**을 누릅니다.
5. 완성된 결과를 미리 본 뒤 **업로드 폼에 채우기**로 YouTube 업로드로 넘깁니다.

결과 파일은 `C:\Users\<사용자>\Videos\DOMINION`에 `날짜-시간-제목-짧은ID.webm` 형식으로 저장됩니다. 영상 제목을 비우면 프롬프트가 파일 이름이 됩니다.

2초 480×832 세로 영상은 RTX 3070에서 약 2~3분 걸립니다.

## 5. 용량 · 종료 · 교체

- 이 PC의 `C:\ComfyUI` 폴더는 약 **14.5GB**입니다. (Wan 모델 9.2GB + Python/PyTorch 실행 환경 5.3GB)
- 이 폴더는 DOMINION 앱 배포본에 포함되지 않습니다. 앱과 별도로 이 PC에만 설치된 로컬 영상 엔진입니다.
- ComfyUI는 앱과 별도 프로세스입니다. 영상 제작 화면의 **ComfyUI 종료** 버튼으로 끌 수 있고, 앱에서 시작한 경우 앱을 종료할 때도 함께 종료됩니다.
- 필요 없으면 `C:\ComfyUI` 폴더를 삭제해도 채팅·모델·MCP 기능은 그대로 동작합니다. 영상 제작만 사용할 수 없게 됩니다.
- 다른 영상 엔진을 쓰려면 영상 제작 화면의 ComfyUI URL을 원격 ComfyUI 주소로 바꾸거나, `video-workflows` 폴더에 다른 모델의 API 워크플로를 추가하면 됩니다. 모델 파일은 워크플로가 참조하는 이름으로 `C:\ComfyUI\models` 아래에 넣으면 자동 인식됩니다.

## 6. 엔진·모델 조합 바꾸기

- ComfyUI 엔진의 **API 주소**와 **설치 폴더**는 영상 제작 화면의 `설정`에서 바꿀 수 있습니다. 다른 드라이브의 ComfyUI나 원격 ComfyUI 호환 서버도 같은 방식으로 연결됩니다.
- 영상 모델은 전역 고정 목록이 아닙니다. `models\diffusion_models`, `models\checkpoints`, `models\unet` 폴더를 실제로 스캔해 표시합니다.
- 모델·텍스트 인코더·VAE **조합은 워크플로 JSON 단위**로 저장됩니다. 다른 조합을 쓰려면 해당 조합의 워크플로를 `video-workflows` 폴더에 추가하세요.
- 설치된 모델 파일에 연결된 워크플로가 없으면 `조합 필요`로 표시되며, 그 모델만으로는 생성할 수 없습니다.
