# backend/utils/media_utils.py
import os
import time
import subprocess
import shutil
import requests
from PIL import Image
import pillow_heif
from fastapi import UploadFile
from config import ENHANCED_DIR, YOUCAM_API_KEY, ALBUMS_DIR

pillow_heif.register_heif_opener()

YCE_BASE_URL = "https://yce-api-01.makeupar.com"


async def save_media_file(
    upload_file: UploadFile,
    save_folder: str,
    index: int,
    relative_url_prefix: str
) -> tuple[str, str]:
    """업로드된 미디어를 최적화 저장 후 (파일명, URL) 반환"""
    orig_name = upload_file.filename or f"media_{index}"
    _, ext = os.path.splitext(orig_name)
    ext_lower = ext.lower()

    video_exts = {".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"}
    if upload_file.content_type.startswith("video/") or ext_lower in video_exts:
        saved_filename = f"video_{index}.mp4"
        temp_input_path = os.path.join(save_folder, f"temp_{index}{ext_lower}")
        final_output_path = os.path.join(save_folder, saved_filename)

        with open(temp_input_path, "wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)

        try:
            cmd = [
                "ffmpeg", "-y", "-i", temp_input_path,
                "-vcodec", "libx264", "-crf", "24",
                "-preset", "fast", "-acodec", "aac",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                final_output_path
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            if os.path.exists(temp_input_path):
                os.remove(temp_input_path)
        except Exception:
            if os.path.exists(temp_input_path):
                os.rename(temp_input_path, final_output_path)

        url = f"http://localhost:8000/albums/{relative_url_prefix}/{saved_filename}"
        return saved_filename, url

    saved_filename = f"image_{index}.jpg"
    final_output_path = os.path.join(save_folder, saved_filename)

    try:
        image = Image.open(upload_file.file)
        if image.mode in ("RGBA", "P"):
            image = image.convert("RGB")

        max_dim = 1600
        if max(image.width, image.height) > max_dim:
            image.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

        image.save(final_output_path, "JPEG", quality=85, optimize=True)
    except Exception:
        upload_file.file.seek(0)
        with open(final_output_path, "wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)

    url = f"http://localhost:8000/albums/{relative_url_prefix}/{saved_filename}"
    return saved_filename, url


def enhance_image_with_youcam(input_image_path: str, album_id: str) -> str:
    """
    YouCam Official S2S RESTful API:
    1. File API (JSON) 메타데이터 전송 -> S3 presigned URL & file_id 발급
    2. S3로 이미지 바이너리 PUT 전송
    3. /task/enhance (scale: 2) 작업 생성
    4. Task Status 폴링 후 완료 시 결과 다운로드
    5. 공용 enhanced 폴더 및 해당 앨범 실제 폴더에 동시 저장
    """
    if not os.path.exists(input_image_path):
        raise FileNotFoundError(f"원본 이미지를 찾을 수 없습니다: {input_image_path}")

    if not YOUCAM_API_KEY:
        raise ValueError("YOUCAM_API_KEY가 설정되지 않았습니다. config.py를 확인해주세요.")

    auth_headers = {
        "Authorization": f"Bearer {YOUCAM_API_KEY.strip()}",
        "Content-Type": "application/json"
    }

    # -------------------------------------------------------------
    # [Step 1] File API 호출: 메타데이터 전송 후 S3 URL 발급
    # -------------------------------------------------------------
    file_api_url = f"{YCE_BASE_URL}/s2s/v2.0/file"
    file_name = os.path.basename(input_image_path)
    file_size = os.path.getsize(input_image_path)

    file_api_payload = {
        "files": [
            {
                "file_name": file_name,
                "content_type": "image/jpeg",
                "file_size": file_size
            }
        ]
    }

    print(f"[YouCam AI] Step 1. File Upload URL 요청: {file_api_url} (size: {file_size} bytes)")
    file_res = requests.post(file_api_url, headers=auth_headers, json=file_api_payload, timeout=20)

    if not file_res.ok:
        raise Exception(f"YouCam File API 오류 (HTTP {file_res.status_code}): {file_res.text}")

    file_data = file_res.json()
    files_arr = file_data.get("data", {}).get("files", []) or file_data.get("files", [])
    if not files_arr:
        raise Exception(f"YouCam file_id/requests 파싱 실패: {file_data}")

    first_file = files_arr[0]
    file_id = first_file.get("file_id")
    reqs = first_file.get("requests", [])
    upload_url = reqs[0].get("url") if isinstance(reqs, list) and len(reqs) > 0 else None
    req_headers = reqs[0].get("headers", {"Content-Type": "image/jpeg"}) if isinstance(reqs, list) and len(reqs) > 0 else {"Content-Type": "image/jpeg"}

    if not file_id or not upload_url:
        raise Exception(f"YouCam file_id 또는 upload_url 획득 실패: {file_data}")

    print(f"[YouCam AI] Step 1 완료 -> file_id: {file_id}")

    # -------------------------------------------------------------
    # [Step 2] 발급된 S3 Presigned URL로 원본 이미지 바이너리 PUT 전송
    # -------------------------------------------------------------
    print(f"[YouCam AI] Step 2. S3 스토리지 바이너리 PUT 전송...")
    with open(input_image_path, "rb") as f:
        img_bytes = f.read()

    put_res = requests.put(upload_url, data=img_bytes, headers=req_headers, timeout=40)
    if not put_res.ok:
        raise Exception(f"YouCam S3 업로드 실패 (HTTP {put_res.status_code}): {put_res.text}")

    print(f"[YouCam AI] Step 2 완료")

    # -------------------------------------------------------------
    # [Step 3] AI Enhance Task 생성 (scale: 2)
    # -------------------------------------------------------------
    task_endpoint = f"{YCE_BASE_URL}/s2s/v2.0/task/enhance"
    task_payload = {
        "src_file_id": file_id,
        "scale": 2
    }

    print(f"[YouCam AI] Step 3. AI 작업 생성 요청: {task_endpoint}")
    task_res = requests.post(task_endpoint, headers=auth_headers, json=task_payload, timeout=20)

    if not task_res.ok:
        raise Exception(f"YouCam Task 생성 오류 (HTTP {task_res.status_code}): {task_res.text}")

    task_data = task_res.json()
    task_id = (
        task_data.get("task_id")
        or task_data.get("data", {}).get("task_id")
        or task_data.get("id")
    )
    if not task_id:
        raise Exception(f"YouCam Task ID 획득 실패: {task_data}")

    print(f"[YouCam AI] Step 3 완료 -> Task ID: {task_id}")

    # -------------------------------------------------------------
    # [Step 4] 작업 상태 폴링 (최대 35초 대기)
    # -------------------------------------------------------------
    poll_endpoint = f"{task_endpoint}/{task_id}"
    final_result_url = None

    for attempt in range(35):
        time.sleep(1.0)
        poll_res = requests.get(poll_endpoint, headers=auth_headers, timeout=15)
        if not poll_res.ok:
            continue

        poll_json = poll_res.json()
        status = str(
            poll_json.get("task_status")
            or poll_json.get("data", {}).get("task_status")
            or poll_json.get("status")
            or ""
        ).lower()

        if status in ("success", "completed"):
            data_field = poll_json.get("data", {})
            results_field = data_field.get("results") if isinstance(data_field, dict) else poll_json.get("results")

            if isinstance(results_field, dict):
                final_result_url = results_field.get("url")
            elif isinstance(results_field, list) and len(results_field) > 0:
                final_result_url = results_field[0].get("url")

            if not final_result_url:
                final_result_url = (
                    data_field.get("result_url")
                    or data_field.get("url")
                    or poll_json.get("result_url")
                    or poll_json.get("output_url")
                )
            break
        elif status in ("error", "failed"):
            raise Exception(f"YouCam AI 작업 처리 실패: {poll_json}")

    if not final_result_url:
        raise Exception(f"YouCam AI 처리 시간 초과 또는 결과 URL 누락: {poll_json}")

    # -------------------------------------------------------------
    # [Step 5] 최종 개선 결과 다운로드 및 이중 저장
    # -------------------------------------------------------------
    print(f"[YouCam AI] Step 5. 고화질 결과 다운로드: {final_result_url}")
    enhanced_dl_res = requests.get(final_result_url, timeout=30)
    if not enhanced_dl_res.ok:
        raise Exception(f"YouCam 결과 이미지 다운로드 실패 (HTTP {enhanced_dl_res.status_code})")

    timestamp = int(time.time() * 1000)
    enhanced_filename = f"{album_id}_enhanced_{timestamp}.jpg"

    # 1) 공용 ENHANCED_DIR 에 저장 (/enhanced/... 서빙용)
    enhanced_save_path = os.path.join(ENHANCED_DIR, enhanced_filename)
    with open(enhanced_save_path, "wb") as out_file:
        out_file.write(enhanced_dl_res.content)

    # 2) 🌟 해당 앨범 실제 폴더에도 동일 파일명으로 복사 저장 (/albums/... 서빙용)
    album_dir = os.path.dirname(input_image_path)
    if os.path.exists(album_dir) and os.path.isdir(album_dir):
        album_target_path = os.path.join(album_dir, enhanced_filename)
        with open(album_target_path, "wb") as out_file:
            out_file.write(enhanced_dl_res.content)

    print(f"[YouCam AI] 화질 개선 완료 -> {enhanced_save_path}")
    return f"http://localhost:8000/enhanced/{enhanced_filename}"