# backend/services/gemini_service.py
import json
import google.generativeai as genai
from config import GEMINI_API_KEY

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

MODEL_NAME = "gemini-3.6-flash"

SYSTEM_PROMPT = """
당신은 사진과 동영상 프레임, 음성 사연을 분석하여 소중한 추억을 기록하는 '추억 회상 어시스턴트'입니다.
제공된 미디어를 종합 분석하여 반드시 아래 JSON 구조로만 반환하세요:
{
  "title": "추억의 제목 (예: 1985년 가을 경주 수학여행)",
  "location": "추정되는 장소 (예: 경주 불국사)",
  "yearEstimate": "추정 시기 (예: 1980년대 중반)",
  "description": "사진과 영상 속 상황에 대한 객관적 요약",
  "storyCaption": "따뜻하고 감성적으로 풀어낸 회상 에세이",
  "audioTranscriptSummary": "음성 내용 요약 (없으면 빈 문자열)"
}
"""

def _clean_json_text(text: str) -> str:
    cleaned = text.strip()
    if "```json" in cleaned:
        cleaned = cleaned.split("```json")[1].split("```")[0].strip()
    elif "```" in cleaned:
        cleaned = cleaned.split("```")[1].split("```")[0].strip()
    return cleaned

async def analyze_multimodal_memory(images_data: list[dict], audio_base64: str | None = None, audio_mime: str | None = None) -> dict:
    """이미지/오디오를 기반으로 멀티모달 추억 분석 수행"""
    model = genai.GenerativeModel(MODEL_NAME, system_instruction=SYSTEM_PROMPT)
    
    contents = []
    for img in images_data:
        contents.append({
            "mime_type": img.get("mimeType", "image/jpeg"),
            "data": img.get("base64")
        })
        
    if audio_base64:
        contents.append({
            "mime_type": audio_mime or "audio/mp3",
            "data": audio_base64
        })
        
    contents.append("이 미디어들을 종합 분석하여 추억 앨범 정보를 JSON으로 작성해주세요.")
    
    response = model.generate_content(contents)
    return json.loads(_clean_json_text(response.text))

async def refine_memory(current_draft: dict, user_note: str) -> dict:
    """사용자 피드백을 반영하여 기존 분석 초안 수정"""
    model = genai.GenerativeModel(MODEL_NAME, system_instruction=SYSTEM_PROMPT)
    
    prompt = f"""
기존 추억 분석 결과:
{json.dumps(current_draft, ensure_ascii=False, indent=2)}

사용자 피드백/추가 기억:
"{user_note}"

위 피드백을 반영하여 사실관계를 수정하고, 사연을 더 풍성하게 다듬어 동일한 JSON 구조로 응답해주세요.
"""
    response = model.generate_content([prompt])
    return json.loads(_clean_json_text(response.text))