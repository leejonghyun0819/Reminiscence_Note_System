# backend/routers/gemini.py
import os
import glob
import base64
import json
import re
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from urllib.parse import unquote

from services.gemini_service import (
    analyze_multimodal_memory,
    generate_memory_interview,
    generate_memory_interview_batch,
    build_curated_memory_note,
    detect_memory_mode,
    detect_memory_mode_batch,
)
from utils.file_utils import ALBUMS_DIR

router = APIRouter(prefix="/api/gemini", tags=["gemini"])

class ImageItem(BaseModel):
    base64: str
    mimeType: str = "image/jpeg"

class AnalyzeRequest(BaseModel):
    images: List[ImageItem] = []
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None

class InterviewRequest(BaseModel):
    images: List[ImageItem] = []

class AlbumInterviewRequest(BaseModel):
    memoryId: Optional[str] = None
    albumId: Optional[str] = None
    imageUrls: Optional[List[str]] = None

class QAPairItem(BaseModel):
    id: str
    category: Optional[str] = "기억의 열쇠"
    question: str
    answer: str

class FactsAndCluesPayload(BaseModel):
    estimatedEra: Optional[str] = "시기 미상"
    sceneFacts: Optional[str] = ""
    visualClues: Optional[List[str]] = []

class CurateRequest(BaseModel):
    factsAndClues: FactsAndCluesPayload
    qaPairs: List[QAPairItem]

@router.post("/detect-mode")
async def detect_mode_endpoint(req: InterviewRequest):
    try:
        if not req.images:
            return {"mode": "travel"}
        images_payload = [{"base64": img.base64, "mimeType": img.mimeType} for img in req.images]
        mode, _ = await detect_memory_mode_batch(images_payload)
        return {"mode": mode}
    except Exception as e:
        print(f"⚠️ [detect-mode 오류]: {e}")
        return {"mode": "travel"}

@router.post("/analyze")
@router.post("/analyze-multimodal")
async def analyze_memory_endpoint(req: AnalyzeRequest):
    try:
        if not req.images:
            raise HTTPException(status_code=400, detail="최소 1장 이상의 이미지가 필요합니다.")
        images_payload = [{"base64": img.base64, "mimeType": img.mimeType} for img in req.images]
        analysis_result = await analyze_multimodal_memory(
            images_data=images_payload,
            audio_base64=req.audio_base64,
            audio_mime=req.audio_mime
        )
        return {"success": True, "analysis": analysis_result}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [멀티모달 분석 오류]: {e}")
        raise HTTPException(status_code=500, detail=f"멀티모달 분석 실패: {str(e)}")

@router.post("/interview")
@router.post("/generate-interview")
async def generate_interview_endpoint(req: InterviewRequest):
    try:
        if not req.images:
            raise HTTPException(status_code=400, detail="질문을 도출할 이미지가 필요합니다.")
        images_payload = [{"base64": img.base64, "mimeType": img.mimeType} for img in req.images]
        interview_result = await generate_memory_interview(images_data=images_payload)
        return interview_result
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [인터뷰 생성 오류]: {e}")
        raise HTTPException(status_code=500, detail=f"인터뷰 생성 실패: {str(e)}")

@router.post("/interview-from-album")
async def generate_interview_from_existing_album(req: AlbumInterviewRequest):
    try:
        raw_target_id = req.memoryId or req.albumId or ""
        print(f"\n==========================================")
        print(f"🔍 [기존 앨범 인터뷰 재분석 요청 수신] Raw Target ID: {raw_target_id}")

        clean_target_id = raw_target_id
        match = re.search(r"(album_\d+)", raw_target_id)
        if match:
            clean_target_id = match.group(1)

        image_files = []
        target_album_folder = None

        if os.path.exists(ALBUMS_DIR):
            for root, dirs, files in os.walk(ALBUMS_DIR):
                base = os.path.basename(root)
                if base == clean_target_id or base == raw_target_id:
                    target_album_folder = root
                    break
                if "album_meta.json" in files:
                    try:
                        with open(os.path.join(root, "album_meta.json"), "r", encoding="utf-8") as f:
                            meta = json.load(f)
                            m_id = str(meta.get("id", ""))
                            if m_id == clean_target_id or m_id == raw_target_id or (match and match.group(1) in m_id):
                                target_album_folder = root
                                break
                    except Exception:
                        pass

        if target_album_folder and os.path.exists(target_album_folder):
            print(f"📂 [대상 앨범 폴더 발견]: {target_album_folder}")
            for ext in ("*.jpg", "*.jpeg", "*.png", "*.webp", "*.JPG", "*.JPEG", "*.PNG", "*.WEBP"):
                image_files.extend(glob.glob(os.path.join(target_album_folder, ext)))

        if not image_files and req.imageUrls:
            for url in req.imageUrls:
                decoded_url = unquote(url).split("?")[0]
                path_part = ""
                if "/albums/" in decoded_url:
                    path_part = decoded_url.split("/albums/")[1].lstrip("/")
                elif "/api/media/" in decoded_url:
                    path_part = decoded_url.split("/api/media/")[1].lstrip("/")

                if path_part:
                    exact_path = os.path.join(ALBUMS_DIR, path_part)
                    if os.path.exists(exact_path) and os.path.isfile(exact_path):
                        image_files.append(exact_path)

        image_files = list(dict.fromkeys(image_files))

        if not image_files:
            raise HTTPException(status_code=404, detail=f"앨범({raw_target_id})의 사진 파일을 찾을 수 없습니다.")

        print(f"📸 [재분석 대상 이미지 파일 (총 {len(image_files)}장)]")
        images_payload = []
        for img_path in image_files:
            with open(img_path, "rb") as f:
                b64_data = base64.b64encode(f.read()).decode("utf-8")
                ext_name = os.path.splitext(img_path)[1].lower().replace(".", "")
                mime = "image/jpeg" if ext_name in ["jpg", "jpeg"] else f"image/{ext_name}"
                images_payload.append({"base64": b64_data, "mimeType": mime})

        detected_mode, photo_analyses = await detect_memory_mode_batch(images_data=images_payload)
        interview_result = await generate_memory_interview_batch(
            images_data=images_payload,
            photo_analyses=photo_analyses
        )
        interview_result["detectedMode"] = detected_mode
        return interview_result

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [interview-from-album 오류]: {e}")
        raise HTTPException(status_code=500, detail=f"과거 앨범 기반 인터뷰 생성 실패: {str(e)}")

# 🌟 4단계 큐레이션 추억 노트 합성 엔드포인트 (상세 터미널 로그 적용)
@router.post("/curate")
@router.post("/curate-note")
async def curate_memory_note_endpoint(req: CurateRequest):
    print(f"\n=======================================================")
    print(f"📥 [/api/gemini/curate 요청 수신]")
    print(f"📌 추정 연대: {req.factsAndClues.estimatedEra}")
    print(f"📌 시각적 사실: {req.factsAndClues.sceneFacts}")
    print(f"📝 사용자 인터뷰 답변 목록 (총 {len(req.qaPairs)}개):")
    for idx, qa in enumerate(req.qaPairs, start=1):
        print(f"   [{idx}] [{qa.category}] {qa.question}")
        print(f"       👉 답변: '{qa.answer}'")
    print(f"=======================================================")

    try:
        curated_note = await build_curated_memory_note(
            facts_and_clues=req.factsAndClues.model_dump() if hasattr(req.factsAndClues, 'model_dump') else req.factsAndClues.dict(),
            qa_pairs=[qa.model_dump() if hasattr(qa, 'model_dump') else qa.dict() for qa in req.qaPairs]
        )
        return curated_note
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [큐레이션 노트 합성 라우터 에러]: {e}")
        raise HTTPException(status_code=500, detail=f"추억 큐레이션 노트 합성 실패: {str(e)}")