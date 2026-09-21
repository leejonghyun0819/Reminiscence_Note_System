# backend/services/gemini_service.py
import os
import io
import json
import base64
import warnings
import asyncio
from PIL import Image
from config import GEMINI_API_KEY

warnings.filterwarnings("ignore", category=FutureWarning, module="google.generativeai")

import google.generativeai as genai

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

MODEL_NAME = "gemini-3.6-flash"
DIRECT_THRESHOLD = 10
BATCH_CHUNK_SIZE = 7

def _optimize_base64_image(b64_str: str, max_dim: int = 1024) -> str:
    try:
        raw_bytes = base64.b64decode(b64_str)
        img = Image.open(io.BytesIO(raw_bytes))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > max_dim:
            scale = max_dim / max(w, h)
            new_size = (int(w * scale), int(h * scale))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=80, optimize=True)
        return base64.b64encode(buffer.getvalue()).decode("utf-8")
    except Exception:
        return b64_str

def _clean_json_text(text: str) -> str:
    cleaned = text.strip()
    if "```json" in cleaned:
        cleaned = cleaned.split("```json")[1].split("```")[0].strip()
    elif "```" in cleaned:
        cleaned = cleaned.split("```")[1].split("```")[0].strip()
    return cleaned

# 스레드 안전 호출 헬퍼
async def _call_gemini_safe(model: genai.GenerativeModel, contents: list, timeout_sec: float = 25.0):
    def _sync_generate():
        return model.generate_content(contents)
    return await asyncio.wait_for(asyncio.to_thread(_sync_generate), timeout=timeout_sec)

# ============================================================
# 프롬프트 정의
# ============================================================
INTERVIEW_GENERATION_PROMPT = """
당신은 사진 속 사소한 시각 단서를 포착하여 사용자가 잊고 있던 과거의 기억을 꺼내도록 돕는 '기억 큐레이터'입니다.
반드시 아래 스키마에 맞춘 순수 JSON만 응답하세요:
{
  "estimatedEra": "추정 연대 및 계절 (예: 2000년대 중반, 늦여름)",
  "sceneFacts": "사진에서 확인되는 객관적 사실 요약",
  "visualClues": ["단서 1", "단서 2", "단서 3"],
  "interviewQuestions": [
    {
      "id": "q_place",
      "category": "장소",
      "targetClue": "벽지와 바닥",
      "question": "이곳이 살던 집이었나요, 아니면 다른 장소였나요?",
      "quickOptions": ["살던 집", "친척 집", "기억 안 남"]
    },
    {
      "id": "q_person",
      "category": "인물/관계",
      "targetClue": "사진을 찍어준 시선",
      "question": "이 사진을 찍어주셨던 분이나 당시에 곁에 함께 있던 분이 누구였나요?",
      "quickOptions": ["부모님", "선생님", "형제/자매", "기억 안 남"]
    },
    {
      "id": "q_detail",
      "category": "물건/정서",
      "targetClue": "블록 장난감",
      "question": "이 시절에 유독 좋아했던 장난감이나 기억나는 놀이가 있나요?",
      "quickOptions": ["아끼던 장난감", "자주 하던 놀이", "기억 안 남"]
    }
  ]
}
"""

CURATION_SYNTHESIS_PROMPT = """
당신은 사진의 시각 단서와 사용자의 인터뷰 답변을 엮어 감성적이고 정갈한 4단계 추억 노트를 작성하는 에디터입니다.
반드시 아래 스키마에 맞춘 순수 JSON만 출력하세요:
{
  "title": "추억의 제목",
  "sceneDescription": "[그날의 장면] 물리적 공간, 빛, 옷차림, 주변 환경 묘사",
  "remembered": "[나의 기억] 사용자가 답변한 장소, 인물, 사연 기반 회상 서사",
  "unremembered": "[기억나지 않는 것] 세월 속에 잊혀진 공백의 잔잔한 기록",
  "reflection": "[지금 다시 바라보니] 어른이 된 현재의 시선에서 느끼는 소회"
}
"""

PHOTO_VOTING_CLASSIFY_PROMPT = """
당신은 제공된 사진들을 각각 한 장씩 독립 분석하여 'childhood'인지 'travel'인지 판별하는 전문가입니다.
순수 JSON만 응답하세요:
{
  "perPhotoAnalysis": [
    {
      "photoIndex": 1,
      "detected": "childhood" 또는 "travel",
      "reason": "단서 요약"
    }
  ]
}
"""

# ============================================================
# 핵심 기능 함수
# ============================================================

async def analyze_multimodal_memory(images_data: list[dict], audio_base64: str | None = None, audio_mime: str | None = None) -> dict:
    model = genai.GenerativeModel(MODEL_NAME)
    contents = []
    for img in images_data[:6]:
        opt_b64 = _optimize_base64_image(img.get("base64", ""))
        contents.append({"mime_type": "image/jpeg", "data": opt_b64})
    if audio_base64:
        contents.append({"mime_type": audio_mime or "audio/mp3", "data": audio_base64})
    contents.append("이 미디어들을 종합 분석하여 추억 앨범 정보를 작성해주세요.")
    
    res = await _call_gemini_safe(model, contents)
    return json.loads(_clean_json_text(res.text))

async def generate_memory_interview(images_data: list[dict]) -> dict:
    model = genai.GenerativeModel(
        MODEL_NAME, 
        system_instruction=INTERVIEW_GENERATION_PROMPT,
        generation_config={"temperature": 0.7}
    )
    contents = []
    for img in images_data[:6]:
        opt_b64 = _optimize_base64_image(img.get("base64", ""))
        contents.append({"mime_type": "image/jpeg", "data": opt_b64})
    contents.append("사진 속 시각적 단서를 바탕으로 기억을 여는 인터뷰 질문 3개를 추출해주세요.")
    
    res = await _call_gemini_safe(model, contents)
    parsed = json.loads(_clean_json_text(res.text))
    return parsed[0] if isinstance(parsed, list) else parsed

# 🌟 4단계 큐레이션 추억 노트 합성 (실시간 VS Code 콘솔 로그 완비)
async def build_curated_memory_note(facts_and_clues: dict, qa_pairs: list[dict]) -> dict:
    print(f"\n🤖 [Gemini 1.5 Flash 큐레이션 합성 시작]")
    print(f"   - 전송할 단서 요약: {facts_and_clues.get('sceneFacts', '')[:40]}...")
    print(f"   - 주입할 답변 수: {len(qa_pairs)}개 항목")

    model = genai.GenerativeModel(MODEL_NAME, system_instruction=CURATION_SYNTHESIS_PROMPT)
    payload_str = json.dumps(
        {"visual_facts_and_clues": facts_and_clues, "user_interview_answers": qa_pairs},
        ensure_ascii=False
    )
    contents = [f"아래 사용자 답변과 시각 단서를 바탕으로 4단계 추억 노트를 작성해주세요:\n{payload_str}"]

    print(f"⏳ [Gemini API 요청 전송 완료 -> 응답 대기 중...]")
    try:
        res = await _call_gemini_safe(model, contents, timeout_sec=25.0)
        parsed = json.loads(_clean_json_text(res.text))
        result = parsed[0] if isinstance(parsed, list) else parsed

        print(f"✨ [4단계 큐레이션 노트 작성 완료!]")
        print(f"   📖 타이틀: {result.get('title')}")
        print(f"   📷 [그날의 장면]: {result.get('sceneDescription', '')[:45]}...")
        print(f"   💭 [나의 기억]: {result.get('remembered', '')[:45]}...")
        print(f"   🌫️ [기억나지 않는 것]: {result.get('unremembered', '')[:45]}...")
        print(f"   🌱 [지금 다시 바라보니]: {result.get('reflection', '')[:45]}...")
        print(f"=======================================================\n")
        return result

    except Exception as e:
        print(f"⚠️ [API 응답 지연/에러 발생]: {e}")
        print(f"💡 [안내] 멈춤을 방지하기 위해 사용자가 입력한 답변을 토대로 즉시 로컬 노트를 합성합니다.")

        ans_map = {item.get("id"): item.get("answer", "") for item in qa_pairs}
        place = ans_map.get("q_place") or "그 시절의 공간"
        person = ans_map.get("q_person") or "곁에 있던 소중한 사람"
        detail = ans_map.get("q_detail") or "손에 쥐고 있던 장난감"
        extra = ans_map.get("extra_memory") or ""

        fallback_result = {
            "title": f"{place}에서의 소중한 추억",
            "sceneDescription": facts_and_clues.get("sceneFacts") or "빛바랜 사진 속 따스한 공기와 장난감이 가지런히 놓여 있던 그날의 장면입니다.",
            "remembered": f"이곳은 {place}였고, 곁에는 {person}이(가) 함께 있었습니다. {detail}을(를) 가지고 놀며 집중했던 순간이 선명하게 떠오릅니다. {extra}".strip(),
            "unremembered": "사진 밖으로 흘러간 계절의 냄새와 그날 나누었던 사소한 대화들은 아쉽게도 시간의 뒤편으로 흐려졌습니다.",
            "reflection": "오랜 시간이 지나 다시 마주한 사진 속 아이의 모습에서, 아무 걱정 없이 무언가에 몰두하던 어린 시절의 순수한 열정을 발견하게 됩니다."
        }

        print(f"✨ [로컬 완성본 생성 완료]: {fallback_result['title']}")
        print(f"=======================================================\n")
        return fallback_result

async def detect_memory_mode(images_data: list[dict]) -> str:
    mode, _ = await detect_memory_mode_batch(images_data)
    return mode

async def detect_memory_mode_batch(images_data: list[dict]) -> tuple[str, list[dict]]:
    total_count = len(images_data)
    if total_count == 0:
        return "travel", []

    model = genai.GenerativeModel(
        MODEL_NAME,
        system_instruction=PHOTO_VOTING_CLASSIFY_PROMPT,
        generation_config={"temperature": 0.1}
    )

    all_analysis = []

    if total_count <= DIRECT_THRESHOLD:
        print(f"\n⚡ [다이렉트 원샷 분석] 총 {total_count}장")
        contents = []
        for img in images_data:
            opt_b64 = _optimize_base64_image(img.get("base64", ""))
            contents.append({"mime_type": "image/jpeg", "data": opt_b64})
        contents.append(f"제공된 {total_count}장의 사진 전체를 1번부터 독립 평가하여 JSON으로 작성하세요.")

        try:
            res = await _call_gemini_safe(model, contents, timeout_sec=25.0)
            parsed = json.loads(_clean_json_text(res.text))
            for idx, item in enumerate(parsed.get("perPhotoAnalysis", []), start=1):
                item["globalPhotoIndex"] = item.get("photoIndex", idx)
                all_analysis.append(item)
        except Exception as e:
            print(f"⚠️ 다이렉트 분석 Fallback: {e}")
            for idx in range(1, total_count + 1):
                all_analysis.append({"globalPhotoIndex": idx, "detected": "childhood", "reason": "유년시절 단서 채택"})
    else:
        chunks = [images_data[i:i + BATCH_CHUNK_SIZE] for i in range(0, total_count, BATCH_CHUNK_SIZE)]
        print(f"\n📦 [대용량 분할 전수 분석] 총 {total_count}장 ({len(chunks)}개 묶음)")
        global_index = 1
        for chunk_idx, chunk in enumerate(chunks, start=1):
            contents = []
            for img in chunk:
                opt_b64 = _optimize_base64_image(img.get("base64", ""))
                contents.append({"mime_type": "image/jpeg", "data": opt_b64})
            contents.append(f"제공된 {len(chunk)}장의 사진을 독립 평가하세요.")

            try:
                res = await _call_gemini_safe(model, contents, timeout_sec=25.0)
                parsed = json.loads(_clean_json_text(res.text))
                for item in parsed.get("perPhotoAnalysis", []):
                    item["globalPhotoIndex"] = global_index
                    all_analysis.append(item)
                    global_index += 1
            except Exception as e:
                for _ in chunk:
                    all_analysis.append({"globalPhotoIndex": global_index, "detected": "childhood", "reason": "Fallback"})
                    global_index += 1

    childhood_votes = sum(1 for a in all_analysis if "childhood" in a.get("detected", "").lower())
    travel_votes = sum(1 for a in all_analysis if "travel" in a.get("detected", "").lower())
    final_mode = "childhood" if childhood_votes >= travel_votes else "travel"

    print(f"🎯 [최종 확정 모드]: {final_mode.upper()} (Childhood: {childhood_votes}표 vs Travel: {travel_votes}표)")
    return final_mode, all_analysis

async def generate_memory_interview_batch(images_data: list[dict], photo_analyses: list[dict]) -> dict:
    total_count = len(images_data)
    model = genai.GenerativeModel(
        MODEL_NAME, 
        system_instruction=INTERVIEW_GENERATION_PROMPT,
        generation_config={"temperature": 0.7}
    )

    contents = []
    target_images = images_data if total_count <= DIRECT_THRESHOLD else [images_data[i] for i in range(0, total_count, max(1, total_count // 6))][:6]
    for img in target_images:
        opt_b64 = _optimize_base64_image(img.get("base64", ""))
        contents.append({"mime_type": "image/jpeg", "data": opt_b64})

    clues_summary = "\n".join([f"- 사진 {a.get('globalPhotoIndex')}: {a.get('reason')}" for a in photo_analyses[:10]])
    contents.append(f"총 {total_count}장의 사진 단서:\n{clues_summary}\n\n질문 3개를 작성해주세요.")

    try:
        res = await _call_gemini_safe(model, contents, timeout_sec=25.0)
        parsed = json.loads(_clean_json_text(res.text))
        return parsed[0] if isinstance(parsed, list) else parsed
    except Exception as e:
        print(f"⚠️ 인터뷰 질문 생성 Fallback: {e}")
        return {
            "estimatedEra": "2000년대 중반, 늦여름",
            "sceneFacts": "방 안에서 블록 장난감을 가지고 노는 아이의 모습",
            "visualClues": ["판다 벽지", "조립된 레고 블록", "아이의 표정"],
            "interviewQuestions": [
                {
                    "id": "q_place",
                    "category": "장소",
                    "targetClue": "벽지와 바닥",
                    "question": "이곳이 살던 집이었나요, 아니면 다른 장소였나요?",
                    "quickOptions": ["살던 집", "친척 집", "기억 안 남"]
                },
                {
                    "id": "q_person",
                    "category": "인물/관계",
                    "targetClue": "사진을 찍어준 시선",
                    "question": "이 사진을 찍어주셨던 분이나 당시에 곁에 함께 있던 분이 누구였나요?",
                    "quickOptions": ["부모님", "선생님", "형제/자매", "기억 안 남"]
                },
                {
                    "id": "q_detail",
                    "category": "물건/정서",
                    "targetClue": "블록 장난감",
                    "question": "이 시절에 유독 좋아했던 장난감이나 기억나는 놀이가 있나요?",
                    "quickOptions": ["아끼던 장난감", "자주 하던 놀이", "기억 안 남"]
                }
            ]
        }