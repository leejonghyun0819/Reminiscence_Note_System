# backend/routers/backup.py
import os
import shutil
from fastapi import APIRouter, HTTPException
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

@router.get("")
def get_backup_albums():
    albums_list = []
    if os.path.exists(ALBUMS_DIR):
        for root, _, files in os.walk(ALBUMS_DIR):
            # 🌟 enhanced 폴더 내부는 사용자 앨범 검색에서 제외
            if "enhanced" in root.split(os.sep):
                continue

            if "album_meta.json" in files:
                meta = read_album_meta(root)
                if meta:
                    folder_name = os.path.basename(root)
                    meta["id"] = meta.get("id") or folder_name
                    parent_name = os.path.basename(os.path.dirname(root))
                    if parent_name != "albums" and not meta.get("categoryFolder"):
                        meta["categoryFolder"] = parent_name
                    else:
                        meta["categoryFolder"] = meta.get("categoryFolder") or "미분류"
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
    folder_path = find_album_folder_path(album_id)
    if folder_path and os.path.exists(folder_path):
        shutil.rmtree(folder_path)
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Album not found")

@router.post("/batch-delete")
def batch_delete_backup_albums(payload: BatchAlbumIdsRequest):
    deleted_count = 0
    for album_id in payload.albumIds:
        folder_path = find_album_folder_path(album_id)
        if folder_path and os.path.exists(folder_path):
            try:
                shutil.rmtree(folder_path)
                deleted_count += 1
            except Exception as e:
                print(f"앨범 삭제 실패: {e}")
    return {"status": "success", "deletedCount": deleted_count}

@router.post("/{album_id}/restore")
def restore_backup_album(album_id: str):
    folder_path = find_album_folder_path(album_id)
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
            folder_path = find_album_folder_path(album_id)
            if not folder_path:
                continue
            try:
                item = restore_memory_from_meta(folder_path, cursor)
                if item:
                    restored_items.append(item)
            except Exception as e:
                print(f"앨범 일괄 복원 실패 ({album_id}): {e}")

    return {"status": "success", "restoredItems": restored_items}