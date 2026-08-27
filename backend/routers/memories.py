# backend/routers/memories.py
import os
import json
import time
import shutil
from typing import Optional, List
from urllib.parse import urlparse
from fastapi import APIRouter, File, UploadFile, Form, HTTPException

from config import ALBUMS_DIR
from database import get_db_cursor
from models import UpdateMemoryRequest, SwapImageRequest, DeleteImageRequest, AppendImageRequest
from utils.media_utils import save_media_file, enhance_image_with_youcam
from utils.file_utils import (
    row_to_memory_dict,
    find_album_folder_path,
    read_album_meta,
    write_album_meta,
)

router = APIRouter(prefix="/api/memories", tags=["Memories"])


@router.get("")
def get_all_memories():
    """모든 추억 앨범 목록 조회"""
    with get_db_cursor() as cursor:
        cursor.execute("SELECT * FROM memories ORDER BY created_at DESC")
        rows = cursor.fetchall()
        return [row_to_memory_dict(r) for r in rows]


@router.post("")
async def create_multi_memory(
    id: str = Form(...),
    analysisJson: str = Form(...),
    imageFiles: List[UploadFile] = File(...),
    audioFile: Optional[UploadFile] = File(None),
    categoryFolder: str = Form("미분류")
):
    """새로운 멀티모달 추억 앨범 생성 및 디스크/DB 저장"""
    try:
        raw = json.loads(analysisJson)

        if isinstance(raw, list):
            target = raw[0] if len(raw) > 0 and isinstance(raw[0], dict) else {}
        elif isinstance(raw, dict):
            target = raw.get("analysis", raw) if isinstance(raw.get("analysis"), dict) else raw
        else:
            target = {}

        title = target.get("title") or target.get("albumTitle") or "추억의 순간"
        location = target.get("location") or target.get("place") or "장소 미상"
        year_estimate = target.get("yearEstimate") or target.get("year_estimate") or target.get("date") or "시기 미상"
        description = target.get("description") or target.get("summary") or ""
        story_caption = target.get("storyCaption") or target.get("story_caption") or target.get("caption") or ""
        audio_transcript_summary = target.get("audioTranscriptSummary") or target.get("audio_transcript_summary") or ""

        analysis_dict = {
            "title": title,
            "location": location,
            "yearEstimate": year_estimate,
            "description": description,
            "storyCaption": story_caption,
            "audioTranscriptSummary": audio_transcript_summary,
        }

        if categoryFolder and categoryFolder != "미분류":
            parent_dir = os.path.join(ALBUMS_DIR, categoryFolder)
            os.makedirs(parent_dir, exist_ok=True)
            album_folder = os.path.join(parent_dir, id)
            relative_url_prefix = f"{categoryFolder}/{id}"
        else:
            album_folder = os.path.join(ALBUMS_DIR, id)
            relative_url_prefix = f"{id}"

        os.makedirs(album_folder, exist_ok=True)

        file_names = []
        image_urls = []

        for idx, img_file in enumerate(imageFiles):
            fname, furl = await save_media_file(img_file, album_folder, idx, relative_url_prefix)
            file_names.append(fname)
            image_urls.append(furl)

        audio_url = None
        audio_file_name = None
        if audioFile:
            audio_file_name = audioFile.filename
            a_ext = os.path.splitext(audio_file_name)[1] or ".mp3"
            a_saved_name = f"audio{a_ext}"
            a_save_path = os.path.join(album_folder, a_saved_name)
            with open(a_save_path, "wb") as buffer:
                shutil.copyfileobj(audioFile.file, buffer)
            audio_url = f"http://localhost:8000/albums/{relative_url_prefix}/{a_saved_name}"

        initial_history = [{
            "version": 1,
            "timestamp": int(time.time() * 1000),
            "title": title,
            "location": location,
            "yearEstimate": year_estimate,
            "description": description,
            "storyCaption": story_caption
        }]

        album_meta = {
            "id": id,
            "fileNames": file_names,
            "imageUrls": image_urls,
            "audioFileName": audio_file_name,
            "audioUrl": audio_url,
            "categoryFolder": categoryFolder,
            "analysis": analysis_dict,
            "history": initial_history,
            "createdAt": int(os.path.getmtime(album_folder) * 1000)
        }
        write_album_meta(album_folder, album_meta)

        with get_db_cursor() as cursor:
            cursor.execute("""
                INSERT INTO memories (
                    id, file_names_json, image_urls_json, audio_file_name, audio_url,
                    title, location, year_estimate, description, story_caption, audio_transcript_summary, category_folder, history_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                id,
                json.dumps(file_names, ensure_ascii=False),
                json.dumps(image_urls, ensure_ascii=False),
                audio_file_name,
                audio_url,
                title,
                location,
                year_estimate,
                description,
                story_caption,
                audio_transcript_summary,
                categoryFolder,
                json.dumps(initial_history, ensure_ascii=False)
            ))

        return {
            "id": id,
            "fileNames": file_names,
            "imageUrls": image_urls,
            "audioFileName": audio_file_name,
            "audioUrl": audio_url,
            "categoryFolder": categoryFolder,
            "history": initial_history,
            "analysis": analysis_dict
        }
    except Exception as e:
        print(f"Error creating multi-memory: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{memory_id}/append-files")
async def append_files_to_memory(
    memory_id: str,
    newImageFiles: List[UploadFile] = File(...)
):
    """기존 추억 앨범에 사진/동영상 추가"""
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM memories WHERE id = ?", (memory_id,))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Memory not found")

            current_file_names = json.loads(row["file_names_json"])
            current_image_urls = json.loads(row["image_urls_json"])

        album_folder_path = find_album_folder_path(memory_id)
        if not album_folder_path or not os.path.exists(album_folder_path):
            raise HTTPException(status_code=404, detail="Album directory not found")

        rel_path = os.path.relpath(album_folder_path, ALBUMS_DIR).replace("\\", "/")
        start_idx = len(current_image_urls)

        for idx_offset, img_file in enumerate(newImageFiles):
            fname, furl = await save_media_file(img_file, album_folder_path, start_idx + idx_offset, rel_path)
            current_file_names.append(fname)
            current_image_urls.append(furl)

        with get_db_cursor() as cursor:
            cursor.execute(
                "UPDATE memories SET file_names_json = ?, image_urls_json = ? WHERE id = ?",
                (json.dumps(current_file_names, ensure_ascii=False), json.dumps(current_image_urls, ensure_ascii=False), memory_id)
            )

        meta = read_album_meta(album_folder_path)
        if meta:
            meta["fileNames"] = current_file_names
            meta["imageUrls"] = current_image_urls
            write_album_meta(album_folder_path, meta)

        return {
            "status": "success",
            "fileNames": current_file_names,
            "imageUrls": current_image_urls
        }
    except Exception as e:
        print(f"Error appending files: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{memory_id}")
def update_memory(memory_id: str, payload: UpdateMemoryRequest):
    """추억 앨범 텍스트 정보 업데이트 및 버전 히스토리 자동 생성"""
    old_history = []
    with get_db_cursor() as cursor:
        cursor.execute("SELECT * FROM memories WHERE id = ?", (memory_id,))
        row = cursor.fetchone()

        if row:
            if "history_json" in row.keys() and row["history_json"]:
                try:
                    old_history = json.loads(row["history_json"])
                except Exception:
                    pass

            is_same = (
                (payload.title is None or payload.title == row["title"]) and
                (payload.location is None or payload.location == row["location"]) and
                (payload.yearEstimate is None or payload.yearEstimate == row["year_estimate"]) and
                (payload.description is None or payload.description == row["description"]) and
                (payload.storyCaption is None or payload.storyCaption == row["story_caption"])
            )

            if not is_same and (row["title"] or row["description"] or row["story_caption"]):
                last_item = old_history[-1] if old_history else None
                is_duplicate_with_last = False
                if last_item:
                    if (
                        last_item.get("title") == (row["title"] or "") and
                        last_item.get("location") == (row["location"] or "") and
                        last_item.get("yearEstimate") == (row["year_estimate"] or "") and
                        last_item.get("description") == (row["description"] or "") and
                        last_item.get("storyCaption") == (row["story_caption"] or "")
                    ):
                        is_duplicate_with_last = True

                if not is_duplicate_with_last:
                    old_history.append({
                        "version": len(old_history) + 1,
                        "timestamp": int(time.time() * 1000),
                        "title": row["title"] or "",
                        "location": row["location"] or "",
                        "yearEstimate": row["year_estimate"] or "",
                        "description": row["description"] or "",
                        "storyCaption": row["story_caption"] or ""
                    })

            update_fields = ["history_json = ?"]
            values = [json.dumps(old_history, ensure_ascii=False)]

            if payload.title is not None: update_fields.append("title = ?"); values.append(payload.title)
            if payload.location is not None: update_fields.append("location = ?"); values.append(payload.location)
            if payload.yearEstimate is not None: update_fields.append("year_estimate = ?"); values.append(payload.yearEstimate)
            if payload.description is not None: update_fields.append("description = ?"); values.append(payload.description)
            if payload.storyCaption is not None: update_fields.append("story_caption = ?"); values.append(payload.storyCaption)
            if payload.categoryFolder is not None: update_fields.append("category_folder = ?"); values.append(payload.categoryFolder)

            values.append(memory_id)
            cursor.execute(f"UPDATE memories SET {', '.join(update_fields)} WHERE id = ?", tuple(values))

    album_folder_path = find_album_folder_path(memory_id)
    if album_folder_path:
        meta = read_album_meta(album_folder_path)
        if not row and "history" in meta:
            old_history = meta.get("history", [])

        an = meta.get("analysis", {})
        if payload.title is not None: an["title"] = payload.title
        if payload.location is not None: an["location"] = payload.location
        if payload.yearEstimate is not None: an["yearEstimate"] = payload.yearEstimate
        if payload.description is not None: an["description"] = payload.description
        if payload.storyCaption is not None: an["storyCaption"] = payload.storyCaption
        if payload.categoryFolder is not None: meta["categoryFolder"] = payload.categoryFolder
        meta["analysis"] = an
        meta["history"] = old_history

        write_album_meta(album_folder_path, meta)

    return {"status": "success", "history": old_history}


@router.post("/{memory_id}/enhance-image")
async def enhance_single_image(
    memory_id: str,
    targetImageUrl: str = Form(...)
):
    """YouCam AI API를 호출하여 개별 사진 화질 개선"""
    try:
        parsed = urlparse(targetImageUrl)
        rel_path = parsed.path.lstrip("/")
        local_file_path = os.path.join(os.path.dirname(ALBUMS_DIR), rel_path)

        if not os.path.exists(local_file_path):
            alt_path = os.path.join(ALBUMS_DIR, os.path.basename(rel_path))
            if os.path.exists(alt_path):
                local_file_path = alt_path
            else:
                raise HTTPException(status_code=404, detail="서버에 해당 원본 파일이 존재하지 않습니다.")

        new_enhanced_url = enhance_image_with_youcam(local_file_path, memory_id)

        return {
            "status": "success",
            "oldUrl": targetImageUrl,
            "newUrl": new_enhanced_url
        }
    except Exception as e:
        print(f"YouCam 화질 개선 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{memory_id}/swap-image")
def swap_memory_image(memory_id: str, payload: SwapImageRequest):
    """AI 개선본 사진으로 원본 이미지 교체 반영"""
    with get_db_cursor() as cursor:
        cursor.execute("SELECT image_urls_json FROM memories WHERE id = ?", (memory_id,))
        row = cursor.fetchone()
        if row:
            urls = json.loads(row["image_urls_json"])
            urls = [payload.newUrl if u == payload.oldUrl else u for u in urls]
            cursor.execute("UPDATE memories SET image_urls_json = ? WHERE id = ?", (json.dumps(urls, ensure_ascii=False), memory_id))

    album_folder_path = find_album_folder_path(memory_id)
    if album_folder_path:
        meta = read_album_meta(album_folder_path)
        if meta:
            meta["imageUrls"] = [payload.newUrl if u == payload.oldUrl else u for u in meta.get("imageUrls", [])]
            write_album_meta(album_folder_path, meta)

    return {"status": "success"}


@router.post("/{memory_id}/append-image-url")
def append_single_image_url(memory_id: str, payload: AppendImageRequest):
    """기존 원본을 유지하면서 AI 개선본 사진을 앨범에 새 사진으로 추가"""
    with get_db_cursor() as cursor:
        cursor.execute("SELECT image_urls_json, file_names_json FROM memories WHERE id = ?", (memory_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Memory not found")

        urls = json.loads(row["image_urls_json"])
        fnames = json.loads(row["file_names_json"])

        urls.append(payload.imageUrl)
        fnames.append(os.path.basename(payload.imageUrl))

        cursor.execute(
            "UPDATE memories SET image_urls_json = ?, file_names_json = ? WHERE id = ?",
            (json.dumps(urls, ensure_ascii=False), json.dumps(fnames, ensure_ascii=False), memory_id)
        )

    album_folder_path = find_album_folder_path(memory_id)
    if album_folder_path:
        meta = read_album_meta(album_folder_path)
        if meta:
            meta["imageUrls"] = urls
            meta["fileNames"] = fnames
            write_album_meta(album_folder_path, meta)

    return {"status": "success", "imageUrls": urls, "fileNames": fnames}


@router.delete("/{memory_id}/image")
def delete_single_album_image(memory_id: str, payload: DeleteImageRequest):
    """앨범 내 특정 사진/동영상 개별 삭제"""
    target_url = payload.targetImageUrl
    with get_db_cursor() as cursor:
        cursor.execute("SELECT * FROM memories WHERE id = ?", (memory_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Memory not found")

        urls = json.loads(row["image_urls_json"])
        fnames = json.loads(row["file_names_json"])

        if len(urls) <= 1:
            raise HTTPException(status_code=400, detail="앨범에는 최소 1장 이상의 사진이 남아있어야 합니다.")

        try:
            target_idx = urls.index(target_url)
            urls.pop(target_idx)
            if target_idx < len(fnames):
                fnames.pop(target_idx)
        except ValueError:
            pass

        cursor.execute(
            "UPDATE memories SET image_urls_json = ?, file_names_json = ? WHERE id = ?",
            (json.dumps(urls, ensure_ascii=False), json.dumps(fnames, ensure_ascii=False), memory_id)
        )

    album_folder_path = find_album_folder_path(memory_id)
    if album_folder_path:
        meta = read_album_meta(album_folder_path)
        if meta:
            meta["imageUrls"] = urls
            meta["fileNames"] = fnames
            write_album_meta(album_folder_path, meta)

    return {"status": "success", "imageUrls": urls, "fileNames": fnames}


@router.delete("/{memory_id}/history/{version}")
def delete_history_version(memory_id: str, version: int):
    """특정 분석 버전 히스토리 삭제 및 버전 번호 순차 자동 재정렬 (1, 2, 3...)"""
    old_history = []
    with get_db_cursor() as cursor:
        cursor.execute("SELECT * FROM memories WHERE id = ?", (memory_id,))
        row = cursor.fetchone()
        if row and "history_json" in row.keys() and row["history_json"]:
            try:
                old_history = json.loads(row["history_json"])
            except Exception:
                pass

    album_folder_path = find_album_folder_path(memory_id)
    if not old_history and album_folder_path:
        meta = read_album_meta(album_folder_path)
        old_history = meta.get("history", [])

    filtered = [v for v in old_history if int(v.get("version", 0)) != int(version)]
    new_history = [{**item, "version": idx + 1} for idx, item in enumerate(filtered)]

    if row:
        with get_db_cursor() as cursor:
            cursor.execute("UPDATE memories SET history_json = ? WHERE id = ?", (json.dumps(new_history, ensure_ascii=False), memory_id))

    if album_folder_path:
        meta = read_album_meta(album_folder_path)
        if meta:
            meta["history"] = new_history
            write_album_meta(album_folder_path, meta)

    return {"status": "success", "history": new_history}


@router.delete("/{memory_id}")
def delete_memory(memory_id: str):
    """작업 목록에서 특정 앨범 제외 (DB 레코드만 삭제)"""
    with get_db_cursor() as cursor:
        cursor.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    return {"status": "deleted"}


@router.delete("")
def clear_active_memories():
    """현재 작업 목록 전체 비우기"""
    with get_db_cursor() as cursor:
        cursor.execute("DELETE FROM memories")
    return {"status": "success"}