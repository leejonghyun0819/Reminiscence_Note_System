# backend/routers/folders.py
import os
import sqlite3
import shutil
from fastapi import APIRouter, HTTPException
from config import ALBUMS_DIR
from database import get_db_cursor
from models import CreateFolderRequest

router = APIRouter(prefix="/api/folders", tags=["Folders"])

@router.get("")
def get_folders():
    with get_db_cursor() as cursor:
        cursor.execute("SELECT name FROM folders ORDER BY created_at ASC")
        rows = cursor.fetchall()
        db_folders = [r["name"] for r in rows]

    disk_folders = set(db_folders)
    if os.path.exists(ALBUMS_DIR):
        for item in os.listdir(ALBUMS_DIR):
            # 🌟 'enhanced' 시스템 폴더는 사용자 카테고리 폴더 목록에서 제외
            if item == "enhanced":
                continue
            full_p = os.path.join(ALBUMS_DIR, item)
            if os.path.isdir(full_p) and not os.path.exists(os.path.join(full_p, "album_meta.json")):
                disk_folders.add(item)

    return sorted(list(disk_folders))

@router.post("")
def create_folder(payload: CreateFolderRequest):
    folder_name = payload.name.strip()
    if not folder_name:
        raise HTTPException(status_code=400, detail="폴더 이름을 입력해주세요.")
    if folder_name.lower() == "enhanced":
        raise HTTPException(status_code=400, detail="'enhanced'는 시스템 예약 폴더명입니다.")

    os.makedirs(os.path.join(ALBUMS_DIR, folder_name), exist_ok=True)

    with get_db_cursor() as cursor:
        try:
            cursor.execute("INSERT INTO folders (name) VALUES (?)", (folder_name,))
        except sqlite3.IntegrityError:
            pass

    return {"status": "success", "folder": folder_name}

@router.delete("/{folder_name}")
def delete_folder(folder_name: str):
    if folder_name.lower() == "enhanced":
        raise HTTPException(status_code=400, detail="시스템 예약 폴더는 삭제할 수 없습니다.")

    folder_path = os.path.join(ALBUMS_DIR, folder_name)
    if os.path.exists(folder_path) and os.path.isdir(folder_path):
        for sub_item in os.listdir(folder_path):
            sub_path = os.path.join(folder_path, sub_item)
            dest_path = os.path.join(ALBUMS_DIR, sub_item)
            if os.path.isdir(sub_path):
                shutil.move(sub_path, dest_path)
        try:
            os.rmdir(folder_path)
        except Exception:
            pass

    with get_db_cursor() as cursor:
        cursor.execute("DELETE FROM folders WHERE name = ?", (folder_name,))
        cursor.execute("UPDATE memories SET category_folder = '미분류' WHERE category_folder = ?", (folder_name,))

    return {"status": "success"}