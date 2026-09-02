# backend/routers/gemini.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.gemini_service import analyze_multimodal_memory, refine_memory

router = APIRouter(prefix="/api/gemini", tags=["Gemini AI"])

class AnalyzeRequest(BaseModel):
    images: list[dict]
    audio_base64: str | None = None
    audio_mime: str | None = None

class RefineRequest(BaseModel):
    current_draft: dict
    user_note: str

@router.post("/analyze")
async def analyze_memory_endpoint(req: AnalyzeRequest):
    try:
        result = await analyze_multimodal_memory(req.images, req.audio_base64, req.audio_mime)
        return {"status": "success", "analysis": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/refine")
async def refine_memory_endpoint(req: RefineRequest):
    try:
        result = await refine_memory(req.current_draft, req.user_note)
        return {"status": "success", "refined": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))