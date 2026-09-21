# backend/routers/backup.py
import os
import shutil
import json
from urllib.parse import unquote
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import ALBUMS_DIR
from database import get_db_cursor
from models import MoveFolderRequest, BatchMoveFoldersRequest, BatchAlbumIdsRequest
from utils.file_utils import (
    find_album_folder_path,
    read_album_meta,
    internal_move_single_album,
    restore_memory_from_meta,
)

router = APIRouter(prefix="/api/backup-albums", tags=["Backup"])

# ==============================================================================
# 안전한 앨범 폴더 경로 탐색 헬퍼 (Fallback 포함)
# ==============================================================================
def resolve_album_path(album_id: str) -> str:
    path = find_album_folder_path(album_id)
    if path and os.path.exists(path):
        return path

    if os.path.exists(ALBUMS_DIR):
        for root, _, files in os.walk(ALBUMS_DIR):
            if os.path.basename(root) == album_id:
                return root
            if "album_meta.json" in files:
                try:
                    with open(os.path.join(root, "album_meta.json"), "r", encoding="utf-8") as f:
                        meta = json.load(f)
                        if str(meta.get("id")) == str(album_id):
                            return root
                except Exception:
                    pass
    return ""

# ==============================================================================
# 파일명 변경 요청 스키마 및 엔드포인트
# ==============================================================================
class RenameAlbumFileRequest(BaseModel):
    oldFileName: str
    newFileName: str

@router.post("/{album_id}/rename-file")
def rename_backup_album_file(album_id: str, payload: RenameAlbumFileRequest):
    """
    백업 앨범 내부의 미디어 파일명 변경
    - URL 인코딩 및 파라미터 자동 정규화
    - 디스크 파일명 변경 (os.rename)
    - album_meta.json 및 DB 레코드 동기화
    """
    folder_path = resolve_album_path(album_id)
    if not folder_path or not os.path.exists(folder_path):
        raise HTTPException(status_code=404, detail=f"앨범 폴더를 찾을 수 없습니다. (ID: {album_id})")

    # URL 디코딩 및 순수 파일명 추출
    raw_old = unquote(payload.oldFileName.strip()).split("?")[0]
    raw_new = unquote(payload.newFileName.strip()).split("?")[0]

    old_name = os.path.basename(raw_old)
    new_name = os.path.basename(raw_new)

    if not old_name or not new_name:
        raise HTTPException(status_code=400, detail="유효한 파일명을 입력해주세요.")

    # 확장자 유지 보장
    old_ext = os.path.splitext(old_name)[1]
    if old_ext and not new_name.endswith(old_ext):
        new_name += old_ext

    old_file_path = os.path.join(folder_path, old_name)
    new_file_path = os.path.join(folder_path, new_name)

    if not os.path.exists(old_file_path):
        raise HTTPException(status_code=404, detail=f"대상 파일을 찾을 수 없습니다: {old_name}")

    if os.path.exists(new_file_path) and old_file_path != new_file_path:
        raise HTTPException(status_code=400, detail="이미 동일한 이름의 파일이 존재합니다.")

    try:
        # 1. 실제 물리 디스크 파일 이름 변경
        if old_file_path != new_file_path:
            os.rename(old_file_path, new_file_path)

        # 2. album_meta.json 동기화
        meta_path = os.path.join(folder_path, "album_meta.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta_data = json.load(f)

                if "media_files" in meta_data and isinstance(meta_data["media_files"], list):
                    meta_data["media_files"] = [
                        new_name if f == old_name else f for f in meta_data["media_files"]
                    ]

                if "imageUrls" in meta_data and isinstance(meta_data["imageUrls"], list):
                    meta_data["imageUrls"] = [
                        url.replace(old_name, new_name) if old_name in url else url
                        for url in meta_data["imageUrls"]
                    ]

                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta_data, f, ensure_ascii=False, indent=2)
            except Exception as meta_err:
                print(f"[Warning] album_meta.json 갱신 실패: {meta_err}")

        # 3. SQLite DB memories 테이블 동기화 (존재 시)
        try:
            with get_db_cursor() as cursor:
                cursor.execute("SELECT id, image_urls_json FROM memories WHERE id = ?", (album_id,))
                row = cursor.fetchone()
                if row and row["image_urls_json"]:
                    updated_urls = row["image_urls_json"].replace(old_name, new_name)
                    cursor.execute("UPDATE memories SET image_urls_json = ? WHERE id = ?", (updated_urls, album_id))
        except Exception:
            pass

        return {"status": "success", "oldFileName": old_name, "newFileName": new_name}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일명 변경 중 오류 발생: {str(e)}")

# ==============================================================================
# 기존 백업 앨범 관리 라우터
# ==============================================================================
@router.get("")
def get_backup_albums():
    albums_list = []
    ROOT_CATEGORIES = ["유년시절", "여행"]

    if os.path.exists(ALBUMS_DIR):
        for root, _, files in os.walk(ALBUMS_DIR):
            if "enhanced" in root.split(os.sep):
                continue

            if "album_meta.json" in files:
                meta = read_album_meta(root)
                if meta:
                    folder_name = os.path.basename(root)
                    meta["id"] = meta.get("id") or folder_name

                    rel_parts = os.path.relpath(root, ALBUMS_DIR).split(os.sep)

                    detected_root = None
                    if len(rel_parts) >= 2 and rel_parts[0] in ROOT_CATEGORIES:
                        detected_root = rel_parts[0]
                        if not meta.get("categoryFolder"):
                            meta["categoryFolder"] = rel_parts[1]
                    else:
                        # 유년/여행 구조가 생기기 전에 만들어진 레거시 앨범은
                        # 임의로 여행으로 지정하지 않고 미분류 상태를 유지한다.
                        parent_name = os.path.basename(os.path.dirname(root))
                        if parent_name != "albums" and not meta.get("categoryFolder"):
                            meta["categoryFolder"] = parent_name
                        else:
                            meta["categoryFolder"] = meta.get("categoryFolder") or "미분류"

                    if not meta.get("mode") and detected_root:
                        meta["mode"] = "childhood" if detected_root == "유년시절" else "travel"
                    if not meta.get("rootCategory") and detected_root:
                        meta["rootCategory"] = detected_root

                    albums_list.append(meta)

    albums_list.sort(key=lambda x: x.get("createdAt", 0), reverse=True)
    return albums_list

@router.put("/{album_id}/move")
def move_backup_album_folder(album_id: str, payload: MoveFolderRequest):
    if not internal_move_single_album(album_id, payload.categoryFolder):
        raise HTTPException(status_code=404, detail="Album folder not found")
    return {"status": "success", "categoryFolder": payload.categoryFolder}

@router.post("/batch-move")
def batch_move_backup_albums(payload: BatchMoveFoldersRequest):
    moved_count = sum(1 for a_id in payload.albumIds if internal_move_single_album(a_id, payload.categoryFolder))
    return {"status": "success", "movedCount": moved_count, "categoryFolder": payload.categoryFolder}

@router.delete("/{album_id}")
def delete_single_backup_album(album_id: str):
    folder_path = resolve_album_path(album_id)
    if folder_path and os.path.exists(folder_path):
        shutil.rmtree(folder_path)
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Album not found")

@router.post("/batch-delete")
def batch_delete_backup_albums(payload: BatchAlbumIdsRequest):
    deleted_count = 0
    for album_id in payload.albumIds:
        folder_path = resolve_album_path(album_id)
        if folder_path and os.path.exists(folder_path):
            try:
                shutil.rmtree(folder_path)
                deleted_count += 1
            except Exception as e:
                print(f"앨범 삭제 실패: {e}")
    return {"status": "success", "deletedCount": deleted_count}

@router.post("/{album_id}/restore")
def restore_backup_album(album_id: str):
    folder_path = resolve_album_path(album_id)
    if not folder_path:
        raise HTTPException(status_code=404, detail="Album not found")

    with get_db_cursor() as cursor:
        restored_item = restore_memory_from_meta(folder_path, cursor)
        if not restored_item:
            raise HTTPException(status_code=500, detail="Failed to restore album meta")
        return {"status": "success", "restoredItem": restored_item}

@router.post("/batch-restore")
def batch_restore_backup_albums(payload: BatchAlbumIdsRequest):
    restored_items = []
    with get_db_cursor() as cursor:
        for album_id in payload.albumIds:
            folder_path = resolve_album_path(album_id)
            if not folder_path:
                continue
            try:
                item = restore_memory_from_meta(folder_path, cursor)
                if item:
                    restored_items.append(item)
            except Exception as e:
                print(f"앨범 일괄 복원 실패 ({album_id}): {e}")

    return {"status": "success", "restoredItems": restored_items}