# backend/utils/file_utils.py
import os
import json
import sqlite3
import shutil
import re
import time
from typing import Optional, Dict, Any
from config import ALBUMS_DIR
from database import get_db_cursor

def row_to_memory_dict(row: sqlite3.Row) -> Dict[str, Any]:
    history_list = []
    if "history_json" in row.keys() and row["history_json"]:
        try:
            history_list = json.loads(row["history_json"])
        except Exception:
            pass

    return {
        "id": row["id"],
        "fileNames": json.loads(row["file_names_json"]),
        "imageUrls": json.loads(row["image_urls_json"]),
        "audioFileName": row["audio_file_name"],
        "audioUrl": row["audio_url"],
        "categoryFolder": row["category_folder"] or "미분류",
        "history": history_list,
        "analysis": {
            "title": row["title"],
            "location": row["location"],
            "yearEstimate": row["year_estimate"],
            "description": row["description"],
            "storyCaption": row["story_caption"],
            "audioTranscriptSummary": row["audio_transcript_summary"],
        }
    }

def find_album_folder_path(target_id: str) -> Optional[str]:
    if not target_id or target_id == "undefined":
        return None

    clean_id = target_id
    if clean_id.startswith("restored_"):
        clean_id = re.sub(r'_\d+$', '', clean_id.replace("restored_", ""))

    direct_path = os.path.join(ALBUMS_DIR, clean_id)
    if os.path.exists(os.path.join(direct_path, "album_meta.json")):
        return direct_path

    for root, _, files in os.walk(ALBUMS_DIR):
        if "album_meta.json" in files:
            folder_name = os.path.basename(root)
            if folder_name in (clean_id, target_id):
                return root
            try:
                with open(os.path.join(root, "album_meta.json"), "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    if meta.get("id") in (target_id, clean_id):
                        return root
            except Exception:
                pass
    return None

def read_album_meta(folder_path: str) -> Dict[str, Any]:
    meta_path = os.path.join(folder_path, "album_meta.json")
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def write_album_meta(folder_path: str, meta: Dict[str, Any]):
    meta_path = os.path.join(folder_path, "album_meta.json")
    try:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ 메타 파일 저장 실패 ({folder_path}): {e}")

def internal_move_single_album(album_id: str, target_folder: str) -> bool:
    target_folder = target_folder.strip() or "미분류"
    src_folder_path = find_album_folder_path(album_id)
    if not src_folder_path:
        return False

    folder_name = os.path.basename(src_folder_path)

    if target_folder == "미분류":
        dest_folder_path = os.path.join(ALBUMS_DIR, folder_name)
        new_url_prefix = f"{folder_name}"
    else:
        parent_dir = os.path.join(ALBUMS_DIR, target_folder)
        os.makedirs(parent_dir, exist_ok=True)
        dest_folder_path = os.path.join(parent_dir, folder_name)
        new_url_prefix = f"{target_folder}/{folder_name}"

    if os.path.abspath(src_folder_path) != os.path.abspath(dest_folder_path):
        shutil.move(src_folder_path, dest_folder_path)

    meta = read_album_meta(dest_folder_path)
    if meta:
        meta["categoryFolder"] = target_folder
        meta["imageUrls"] = [
            f"http://localhost:8000/albums/{new_url_prefix}/{os.path.basename(u.split('?')[0])}"
            for u in meta.get("imageUrls", [])
        ]
        if meta.get("audioUrl"):
            meta["audioUrl"] = f"http://localhost:8000/albums/{new_url_prefix}/{os.path.basename(meta['audioUrl'])}"

        write_album_meta(dest_folder_path, meta)

    with get_db_cursor() as cursor:
        cursor.execute("UPDATE memories SET category_folder = ? WHERE id = ?", (target_folder, album_id))

    return True

def restore_memory_from_meta(folder_path: str, cursor: sqlite3.Cursor) -> Optional[Dict[str, Any]]:
    meta = read_album_meta(folder_path)
    if not meta:
        return None

    folder_name = os.path.basename(folder_path)
    new_id = f"restored_{folder_name}_{int(time.time() * 1000)}"
    analysis = meta.get("analysis", {})
    file_names = meta.get("fileNames", [])
    image_urls = meta.get("imageUrls", [])
    audio_file_name = meta.get("audioFileName")
    audio_url = meta.get("audioUrl")
    category_folder = meta.get("categoryFolder", "미분류")
    history = meta.get("history", [])

    cursor.execute("""
        INSERT INTO memories (
            id, file_names_json, image_urls_json, audio_file_name, audio_url,
            title, location, year_estimate, description, story_caption, audio_transcript_summary, category_folder, history_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        new_id,
        json.dumps(file_names, ensure_ascii=False),
        json.dumps(image_urls, ensure_ascii=False),
        audio_file_name,
        audio_url,
        analysis.get("title", ""),
        analysis.get("location", ""),
        analysis.get("yearEstimate", ""),
        analysis.get("description", ""),
        analysis.get("storyCaption", ""),
        analysis.get("audioTranscriptSummary", ""),
        category_folder,
        json.dumps(history, ensure_ascii=False)
    ))

    return {
        "id": new_id,
        "fileNames": file_names,
        "imageUrls": image_urls,
        "audioFileName": audio_file_name,
        "audioUrl": audio_url,
        "categoryFolder": category_folder,
        "history": history,
        "analysis": analysis
    }