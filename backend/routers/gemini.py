# backend/routers/gemini.py
import json
import base64
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from google import genai
from google.genai import types
from config import GEMINI_API_KEY

router = APIRouter(prefix="/api/gemini", tags=["Gemini AI"])

client = genai.Client(api_key=GEMINI_API_KEY)


class MediaItem(BaseModel):
    base64: str
    mimeType: Optional[str] = "image/jpeg"


class GeminiAnalyzeRequest(BaseModel):
    images: List[MediaItem]
    audio: Optional[MediaItem] = None
    userComment: Optional[str] = ""


@router.post("/analyze")
async def analyze_memory(payload: GeminiAnalyzeRequest):
    """멀티모달 데이터를 수신하여 Gemini 1.5로 정밀 분석 수행"""
    try:
        prompt_text = """
당신은 사진, 동영상 프레임, 음성 녹음 기록을 바탕으로 소중한 추억을 따뜻하게 복원하고 기록해 주는 AI 큐레이터입니다.
제공된 멀티모달 미디어를 종합 분석하여 반드시 아래 JSON 규격으로만 응답하세요:

{
  "title": "추억의 핵심을 나타내는 감성적이고 직관적인 앨범 제목 (15자 이내)",
  "location": "사진 속 배경 및 단서로 추정한 장소 (예: 제주도 협재해변, 경주 불국사 등)",
  "yearEstimate": "분위기/화질/옷차림 등으로 추정한 시기 (예: 2019년 여름, 2021년 가을 등)",
  "description": "사진과 영상 속 상황, 배경, 인물들의 모습을 2~3문장으로 담백하게 요약한 설명",
  "storyCaption": "당시의 감정과 분위기를 생생하게 살려주는 3~4문장의 따뜻한 감성 회상록 에세이",
  "audioTranscriptSummary": "음성 녹음 내용 요약 (없으면 빈 문자열)"
}
"""
        if payload.userComment:
            prompt_text += f'\n[사용자 추가 회상 메모]: "{payload.userComment}" (반드시 최우선 반영)'

        contents = [prompt_text]

        # 1. 이미지 바이너리 디코딩 첨부
        for img in payload.images:
            if not img.base64:
                continue
            raw_b64 = img.base64.split(",")[-1]
            try:
                img_bytes = base64.b64decode(raw_b64)
                if len(img_bytes) > 0:
                    contents.append(
                        types.Part.from_bytes(
                            data=img_bytes,
                            mime_type=img.mimeType or "image/jpeg"
                        )
                    )
            except Exception as e:
                print(f"이미지 디코딩 제외: {e}")

        # 2. 오디오 바이너리 디코딩 첨부
        if payload.audio and payload.audio.base64:
            raw_b64 = payload.audio.base64.split(",")[-1]
            try:
                audio_bytes = base64.b64decode(raw_b64)
                if len(audio_bytes) > 0:
                    contents.append(
                        types.Part.from_bytes(
                            data=audio_bytes,
                            mime_type=payload.audio.mimeType or "audio/mp3"
                        )
                    )
            except Exception as e:
                print(f"오디오 디코딩 제외: {e}")

        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )

        analysis_result = json.loads(response.text)
        return {"status": "success", "analysis": analysis_result}

    except Exception as e:
        print(f"Gemini 백엔드 분석 에러: {e}")
        raise HTTPException(status_code=500, detail=str(e))