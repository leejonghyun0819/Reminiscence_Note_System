# backend/services/gemini_service.py

import io
import json
import base64
import asyncio
import time
from typing import Optional, List

from PIL import Image
from pydantic import BaseModel, Field

from google import genai
from google.genai import types

from config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GEMINI_HTTP_TIMEOUT_MS,
    GEMINI_MAX_RETRIES,
    GEMINI_CLASSIFY_BATCH_SIZE,
    GEMINI_DIRECT_THRESHOLD,
)


# ============================================================
# 기본 설정
# ============================================================

MODEL_NAME = GEMINI_MODEL

DIRECT_THRESHOLD = GEMINI_DIRECT_THRESHOLD
BATCH_CHUNK_SIZE = GEMINI_CLASSIFY_BATCH_SIZE


# ============================================================
# Gemini Client
# ============================================================

_client: Optional[genai.Client] = None


def _get_client() -> genai.Client:

    global _client

    if _client is not None:
        return _client

    if not GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY가 설정되지 않았습니다. "
            "backend/.env 파일을 확인해주세요."
        )

    _client = genai.Client(
        api_key=GEMINI_API_KEY,
        http_options=types.HttpOptions(
            timeout=GEMINI_HTTP_TIMEOUT_MS
        )
    )

    return _client


# ============================================================
# Structured Output Schema
# ============================================================

class PhotoAnalysisItem(BaseModel):
    photoIndex: int
    detected: str
    reason: str


class PhotoClassificationResponse(BaseModel):
    perPhotoAnalysis: List[PhotoAnalysisItem]


class InterviewQuestion(BaseModel):
    id: str
    category: str
    targetClue: str = ""
    question: str
    quickOptions: List[str] = Field(
        default_factory=list
    )


class InterviewResponse(BaseModel):
    estimatedEra: str
    sceneFacts: str
    visualClues: List[str]
    interviewQuestions: List[InterviewQuestion]


class CuratedNoteResponse(BaseModel):
    title: str
    sceneDescription: str
    remembered: str
    unremembered: str
    reflection: str


class TravelAnalysisResponse(BaseModel):
    title: str
    location: str
    yearEstimate: str
    description: str
    storyCaption: str
    audioTranscriptSummary: str = ""


# ============================================================
# Image Utils
# ============================================================

def _optimize_base64_image(
    b64_str: str,
    max_dim: int = 1024
) -> bytes:

    try:

        raw_bytes = base64.b64decode(
            b64_str
        )

        image = Image.open(
            io.BytesIO(raw_bytes)
        )

        if image.mode not in (
            "RGB",
            "L"
        ):
            image = image.convert(
                "RGB"
            )

        width, height = image.size

        if max(
            width,
            height
        ) > max_dim:

            scale = (
                max_dim
                /
                max(
                    width,
                    height
                )
            )

            new_size = (
                int(
                    width * scale
                ),
                int(
                    height * scale
                )
            )

            image = image.resize(
                new_size,
                Image.Resampling.LANCZOS
            )

        buffer = io.BytesIO()

        image.save(
            buffer,
            format="JPEG",
            quality=80,
            optimize=True
        )

        return buffer.getvalue()

    except Exception as e:

        print(
            "⚠️ 이미지 최적화 실패. "
            "원본 binary 사용:"
            f" {type(e).__name__}: {e}"
        )

        return base64.b64decode(
            b64_str
        )


def _image_part(
    image_data: dict
) -> types.Part:

    binary = _optimize_base64_image(
        image_data.get(
            "base64",
            ""
        )
    )

    return types.Part.from_bytes(
        data=binary,
        mime_type="image/jpeg"
    )


def _audio_part(
    audio_base64: str,
    audio_mime: Optional[str]
) -> types.Part:

    binary = base64.b64decode(
        audio_base64
    )

    return types.Part.from_bytes(
        data=binary,
        mime_type=(
            audio_mime
            or "audio/mp3"
        )
    )


# ============================================================
# Gemini 공통 호출
# ============================================================

async def _generate_json(
    *,
    parts: List[types.Part],
    system_instruction: str,
    response_schema,
    operation_name: str,
    max_retries: Optional[int] = None,
) -> dict:

    client = _get_client()

    retry_count = (
        GEMINI_MAX_RETRIES
        if max_retries is None
        else max_retries
    )

    last_exception = None

    for attempt in range(
        retry_count + 1
    ):

        start_time = (
            time.perf_counter()
        )

        try:

            print(
                f"🤖 [{operation_name}] "
                f"Gemini 요청 시작 "
                f"(attempt {attempt + 1}/"
                f"{retry_count + 1})"
            )

            response = (
                await client.aio.models.generate_content(
                    model=MODEL_NAME,
                    contents=[
                        types.Content(
                            role="user",
                            parts=parts
                        )
                    ],
                    config=types.GenerateContentConfig(
                        system_instruction=(
                            system_instruction
                        ),
                        response_mime_type=(
                            "application/json"
                        ),
                        response_schema=(
                            response_schema
                        ),
                    ),
                )
            )

            elapsed = (
                time.perf_counter()
                - start_time
            )

            print(
                f"✅ [{operation_name}] "
                f"응답 완료: "
                f"{elapsed:.2f}초"
            )

            if (
                response.parsed
                is not None
            ):

                parsed = (
                    response.parsed
                )

                if isinstance(
                    parsed,
                    BaseModel
                ):

                    return parsed.model_dump()

                if isinstance(
                    parsed,
                    dict
                ):

                    return parsed

            if not response.text:

                raise ValueError(
                    "Gemini 응답의 text가 비어 있습니다."
                )

            return json.loads(
                response.text
            )

        except Exception as e:

            elapsed = (
                time.perf_counter()
                - start_time
            )

            last_exception = e

            print(
                f"⚠️ [{operation_name}] "
                f"Gemini 호출 실패"
            )

            print(
                f"   - attempt: "
                f"{attempt + 1}/"
                f"{retry_count + 1}"
            )

            print(
                f"   - elapsed: "
                f"{elapsed:.2f}초"
            )

            print(
                f"   - Exception Type: "
                f"{type(e).__name__}"
            )

            print(
                f"   - Exception repr: "
                f"{repr(e)}"
            )

            if (
                attempt
                >= retry_count
            ):
                break

            # 1초 → 2초 정도의 짧은 backoff
            backoff = min(
                1.0 * (
                    2 ** attempt
                ),
                3.0
            )

            print(
                f"   ↻ {backoff:.1f}초 후 재시도"
            )

            await asyncio.sleep(
                backoff
            )

    raise last_exception


# ============================================================
# Interview Prompt
# ============================================================

INTERVIEW_GENERATION_PROMPT = """
당신은 오래된 사진을 설명하는 AI가 아니라,
사진 속 시각적 단서를 이용해 사용자가 잊고 있던
자신의 실제 기억을 떠올리도록 돕는
'기억 인터뷰 큐레이터'입니다.

가장 중요한 목표는 다음과 같습니다.

"이 사진에서 무엇이 보이는가?"에서 끝나지 말고,

"사진 속 어떤 단서가 사용자의 실제 과거 이야기를
가장 잘 끌어낼 수 있는가?"

를 판단하세요.


[관찰과 추측]

사진에서 직접 확인되는 사실과
추정을 반드시 구분하세요.

예:

사진:
아이 + 케이크 + 성인

잘못된 분석:
"할머니와 생일파티를 하고 있다."

좋은 분석:
"어린아이와 성인 한 명이
케이크가 놓인 테이블 근처에 있다."

관계, 사건, 감정, 장소의 정체는
사진만으로 확정하지 마세요.


[질문의 목적]

질문은 사진 속 정보를 확인하기 위한 것이 아닙니다.

사진 밖에 존재하는 사용자의 경험을
끌어내기 위한 것입니다.

가능한 기억의 방향:

- 가족과 관계
- 친구
- 놀이
- 취미
- 좋아했던 물건
- 반복되던 일상
- 처음 경험한 사건
- 성장
- 학교
- 유치원
- 가족 행사
- 여행
- 음식
- 사진 전의 상황
- 사진 후의 상황
- 사진을 찍어준 사람
- 가족에게 들은 이야기
- 당시 자주 했던 행동
- 특정 장소의 기억
- 당시의 감각적 기억
- 현재까지 이어진 취향
- 현재와 어린 시절의 연결


[질문의 다양성]

장소 / 사람 / 물건 질문을
기계적으로 하나씩 만들지 마세요.

최종 질문 3개는 서로 다른 기억을 탐색해야 합니다.


[질문 후보]

최종 질문을 만들기 전에
내부적으로 최소 7개의 질문 후보를 고려하세요.

다음 기준으로 가장 가치 있는 3개를 선택하세요.

1. 사진 속 구체적인 단서가 있는가
2. 실제 기억을 떠올릴 가능성이 높은가
3. 다른 질문과 중복되지 않는가
4. 단순 사실보다 이야기를 얻을 수 있는가
5. 최종 추억 노트를 풍부하게 만들 수 있는가

후보 목록과 평가 과정은 출력하지 마세요.


[피해야 하는 질문]

가능하면 다음 질문 자체로 끝내지 마세요.

"여기가 어디인가요?"
"이 사람은 누구인가요?"
"무엇을 하고 있나요?"
"기분이 어땠나요?"


대신 구체적인 사진 단서를 사용하세요.

예:

"여러 사진에서 같은 작은 마당이 반복해서 보여요.
이곳에서 가족들과 자주 하던 일이 있었나요?"

"사진마다 같은 빨간 자전거가 등장해요.
이 자전거가 처음 생겼던 때나
특별히 기억나는 사건이 있나요?"


[여러 사진]

여러 장이면 다음을 비교하세요.

- 반복되는 사람
- 반복되는 공간
- 반복되는 물건
- 성장 변화
- 계절 변화
- 반복되는 행동
- 사진 사이의 시간 흐름

반복되는 요소는
강한 기억 단서로 취급하세요.


[sceneFacts]

사진에서 직접 확인 가능한 사실만
2~4문장으로 작성하세요.


[visualClues]

단순 물체 목록이 아니라
기억을 자극할 가능성이 높은 구체적인 단서를
3~6개 작성하세요.

나쁜 예:

"사람"
"집"
"자전거"

좋은 예:

"여러 사진에서 반복해서 등장하는 빨간 어린이 자전거"
"아이 가까이에 반복적으로 등장하는 동일한 성인"
"낮은 담장과 작은 마당"


[quickOptions]

3~5개 정도의 자연스러운 선택지를 제공합니다.

가능하면 마지막에는
"기억 안 남"을 포함하세요.

사진만으로 확인되지 않는 사실을
선택지에서 확정하지 마세요.


[중요]

사진에서 보이는 것을 다시 묻는 질문보다,
사진 밖의 이야기를 얻는 질문을 우선하세요.

사용자의 기억을 모델이 대신 만들어내지 마세요.
"""


# ============================================================
# Curation Prompt
# ============================================================

CURATION_SYNTHESIS_PROMPT = """
당신은 사진의 시각 단서와
사용자가 직접 말한 인터뷰 답변을 이용해
한 사람의 실제 추억을 기록하는
'추억 에디터'입니다.

목표는 감성적인 소설을 작성하는 것이 아닙니다.

다른 사람에게는 존재하지 않는
사용자 개인의 구체적인 기록을 작성하세요.


[정보 우선순위]

1순위:
사용자가 직접 말한 내용

2순위:
사진에서 직접 확인되는 사실

3순위:
사진으로부터 합리적으로 추정되는 정보


[환각 방지]

사진과 인터뷰 어디에도 근거가 없다면

- 감정
- 대화
- 날씨
- 관계
- 사건
- 행동
- 이후의 상황

을 만들어내지 마세요.


[제목]

구체적인 기억 단서를 사용하세요.

좋은 예:

"빨간 자전거를 처음 타던 마당"

"할머니 집 작은 부엌에서"

"동생과 만들던 블록 도시"

피해야 할 제목:

"소중한 추억"

"그때 그 시절"

"행복했던 어린 시절"


[sceneDescription]

사진에서 직접 확인되는 장면을
3~5문장 정도로 작성합니다.

사용자의 인터뷰를 통해
장소와 인물의 정체가 확인됐다면
이를 자연스럽게 연결할 수 있습니다.


[remembered]

가장 중요한 영역입니다.

사용자의 인터뷰 답변을 중심으로
4~7문장 정도로 구성하세요.

질문과 답변을 나열하지 말고
하나의 자연스러운 기억으로 연결하세요.


[unremembered]

사용자가 기억하지 못한 부분을
있는 그대로 기록하세요.

"기억 안 남"이라고 한 정보를
모델이 채워 넣지 마세요.


[reflection]

사용자가 현재 감정을 직접 말하지 않았다면
AI가 임의로 감정을 결정하지 마세요.

사진을 현재 다시 바라보는
차분한 관찰 수준으로 마무리하세요.


[문체]

자연스러운 한국어 개인 기록처럼 작성하세요.

다음 표현은 반복적으로 사용하지 마세요.

"소중한 추억"
"따뜻한 기억"
"그때 그 시절"
"잊지 못할 순간"
"시간이 흘러도"
"""


# ============================================================
# Classification Prompt
# ============================================================

PHOTO_VOTING_CLASSIFY_PROMPT = """
각 사진을 독립적으로 분석하여

childhood

또는

travel

중 하나로 분류하세요.


[childhood]

다음과 같은 성장 과정과 가족 기록이 중심인 경우:

- 유아기
- 어린 시절
- 학창 시절
- 유치원
- 학교
- 놀이터
- 생일
- 졸업
- 운동회
- 장난감
- 가족 행사
- 오래된 성장 기록


[travel]

다음과 같은 장소 경험이 중심인 경우:

- 여행
- 관광
- 나들이
- 음식
- 풍경
- 목적지
- 성인 여행
- 이동
- 관광 활동
- 일반적인 일상 기록


[가장 중요한 기준]

사진에 어린아이가 있다고
무조건 childhood라고 판단하지 마세요.

다음 질문을 기준으로 판단하세요.

"이 사진을 추억 노트로 만들 때
무엇이 이야기의 중심이 될 가능성이 높은가?"


반드시 제공된 사진 수와 동일한 개수의
perPhotoAnalysis 항목을 반환하세요.
"""


# ============================================================
# Travel Prompt
# ============================================================

TRAVEL_ANALYSIS_PROMPT = """
여러 장의 여행 및 일상 사진과
선택적인 음성을 종합하여
한 개의 추억 앨범 기록을 작성하세요.

사진을 한 장씩 독립적으로 설명하지 말고
하나의 경험으로 연결하세요.


[중요]

사진에서 확인되지 않는
정확한 장소명을 만들어내지 마세요.

정확한 날짜도 만들어내지 마세요.

불확실하다면

"여름 무렵으로 추정"

"도심 관광지로 보이는 장소"

처럼 표현하세요.


여러 사진에서 다음을 찾으세요.

- 반복되는 장소
- 함께한 사람
- 음식
- 활동
- 풍경
- 이동
- 시간 흐름


음성이 있으면
사용자가 직접 말한 정보를
사진 추정보다 우선합니다.


storyCaption은 관광 정보가 아니라
사용자의 개인적인 기록처럼 작성하세요.

사진에서 확인할 수 없는 감정을
임의로 추가하지 마세요.
"""


# ============================================================
# Travel / Multimodal
# ============================================================

async def analyze_multimodal_memory(
    images_data: list[dict],
    audio_base64: str | None = None,
    audio_mime: str | None = None,
) -> dict:

    parts: List[types.Part] = []

    for image in images_data[:6]:

        parts.append(
            _image_part(
                image
            )
        )

    if audio_base64:

        parts.append(
            _audio_part(
                audio_base64,
                audio_mime
            )
        )

    parts.append(
        types.Part.from_text(
            text=(
                f"총 {len(images_data)}장의 사진을 "
                "하나의 경험으로 종합 분석하세요. "
                "지정된 JSON 구조로 반환하세요."
            )
        )
    )

    return await _generate_json(
        parts=parts,
        system_instruction=(
            TRAVEL_ANALYSIS_PROMPT
        ),
        response_schema=(
            TravelAnalysisResponse
        ),
        operation_name=(
            "여행/일상 종합 분석"
        ),
    )


# ============================================================
# New Interview
# ============================================================

async def generate_memory_interview(
    images_data: list[dict]
) -> dict:

    parts: List[types.Part] = []

    for image in images_data[:6]:

        parts.append(
            _image_part(
                image
            )
        )

    parts.append(
        types.Part.from_text(
            text=f"""
이 사진들은 같은 사람의 하나의 추억 묶음입니다.

전체 사진 수는 {len(images_data)}장입니다.

사진 전체에서 반복되거나 특별한 단서를 먼저 찾은 뒤,
내부적으로 최소 7개의 질문 후보를 고려하세요.

사용자가 실제 기억을 가장 잘 떠올릴 수 있는
서로 다른 질문 3개만 최종 선택하세요.

사진에서 이미 보이는 내용을 확인하는 질문보다
사진 밖의 이야기를 얻는 질문을 우선하세요.
"""
        )
    )

    return await _generate_json(
        parts=parts,
        system_instruction=(
            INTERVIEW_GENERATION_PROMPT
        ),
        response_schema=(
            InterviewResponse
        ),
        operation_name=(
            "신규 기억 인터뷰 생성"
        ),
    )


# ============================================================
# Curated Note
# ============================================================

async def build_curated_memory_note(
    facts_and_clues: dict,
    qa_pairs: list[dict]
) -> dict:

    payload = {
        "visual_facts_and_clues": (
            facts_and_clues
        ),
        "user_interview_answers": (
            qa_pairs
        ),
    }

    parts = [
        types.Part.from_text(
            text=(
                "아래 사진 단서와 사용자의 실제 답변을 이용해 "
                "추억 노트를 작성하세요.\n\n"
                + json.dumps(
                    payload,
                    ensure_ascii=False,
                    indent=2
                )
            )
        )
    ]

    try:

        result = await _generate_json(
            parts=parts,
            system_instruction=(
                CURATION_SYNTHESIS_PROMPT
            ),
            response_schema=(
                CuratedNoteResponse
            ),
            operation_name=(
                "추억 노트 큐레이션"
            ),
        )

        print(
            "✨ [큐레이션 완료] "
            f"{result.get('title')}"
        )

        return result

    except Exception as e:

        print(
            "⚠️ 큐레이션 최종 실패. "
            "로컬 fallback 사용"
        )

        print(
            f"   {type(e).__name__}: "
            f"{repr(e)}"
        )

        meaningful_answers = []

        for item in qa_pairs:

            answer = (
                item.get(
                    "answer",
                    ""
                )
                or ""
            ).strip()

            if not answer:
                continue

            if answer in {
                "기억 안 남",
                "기억이 안 남",
                "모르겠음",
                "잘 모르겠음",
            }:
                continue

            meaningful_answers.append(
                answer
            )

        remembered = (
            " ".join(
                meaningful_answers
            )
            if meaningful_answers
            else (
                "사진은 남아 있지만 "
                "이 장면에 대한 구체적인 기억은 "
                "아직 선명하지 않다."
            )
        )

        clues = (
            facts_and_clues.get(
                "visualClues",
                []
            )
            or []
        )

        title = (
            f"{clues[0]}에 남은 기억"
            if clues
            else "사진 속에 남은 한 장면"
        )

        return {
            "title": title,
            "sceneDescription": (
                facts_and_clues.get(
                    "sceneFacts",
                    ""
                )
                or (
                    "사진 속에 당시의 모습이 "
                    "기록되어 있다."
                )
            ),
            "remembered": remembered,
            "unremembered": (
                "사진 속 일부 상황은 "
                "현재 정확히 기억나지 않는다."
            ),
            "reflection": (
                "사진을 다시 바라보며 "
                "기억나는 부분과 기억나지 않는 부분을 "
                "천천히 되짚어본다."
            ),
        }


# ============================================================
# Classification
# ============================================================

async def _classify_images_once(
    images_data: list[dict],
    operation_name: str,
) -> list[dict]:

    parts: List[types.Part] = []

    for image in images_data:

        parts.append(
            _image_part(
                image
            )
        )

    parts.append(
        types.Part.from_text(
            text=f"""
현재 사진 수는 {len(images_data)}장입니다.

1번부터 {len(images_data)}번까지
각 사진을 빠짐없이 독립 분석하세요.

각 사진에 대해

- childhood 또는 travel
- 판단 근거

를 반환하세요.
"""
        )
    )

    result = await _generate_json(
        parts=parts,
        system_instruction=(
            PHOTO_VOTING_CLASSIFY_PROMPT
        ),
        response_schema=(
            PhotoClassificationResponse
        ),
        operation_name=(
            operation_name
        ),
        # classification 자체에서 이미
        # recursive retry가 있기 때문에
        # 한 호출당 재시도는 1회로 제한
        max_retries=1,
    )

    analyses = result.get(
        "perPhotoAnalysis",
        []
    )

    if len(analyses) != len(
        images_data
    ):

        raise ValueError(
            "Gemini 분류 결과 수가 입력 사진 수와 다릅니다. "
            f"input={len(images_data)}, "
            f"output={len(analyses)}"
        )

    return analyses


async def _classify_chunk_adaptive(
    images_data: list[dict],
    global_start_index: int,
    depth: int = 0,
) -> list[dict]:

    count = len(
        images_data
    )

    label = (
        f"사진 분류 "
        f"{global_start_index}"
        f"~"
        f"{global_start_index + count - 1}"
    )

    try:

        print(
            f"📸 [{label}] "
            f"{count}장 요청"
        )

        analyses = (
            await _classify_images_once(
                images_data,
                label,
            )
        )

        result = []

        for local_idx, item in enumerate(
            analyses
        ):

            normalized = dict(
                item
            )

            normalized[
                "globalPhotoIndex"
            ] = (
                global_start_index
                + local_idx
            )

            result.append(
                normalized
            )

        return result

    except Exception as e:

        print(
            f"⚠️ [{label}] 실패"
        )

        print(
            "   Exception Type: "
            f"{type(e).__name__}"
        )

        print(
            "   Exception repr: "
            f"{repr(e)}"
        )

        # ====================================================
        # 핵심:
        # 4장 실패 → 2장 + 2장
        # 2장 실패 → 1장 + 1장
        # ====================================================

        if count > 1:

            middle = (
                count // 2
            )

            left = (
                images_data[:middle]
            )

            right = (
                images_data[middle:]
            )

            print(
                f"🔀 [{label}] "
                f"{count}장 → "
                f"{len(left)}장 + "
                f"{len(right)}장으로 자동 분할"
            )

            # API가 잠깐 불안정했을 가능성을 고려
            await asyncio.sleep(
                0.5
            )

            left_result = (
                await _classify_chunk_adaptive(
                    left,
                    global_start_index,
                    depth + 1,
                )
            )

            right_result = (
                await _classify_chunk_adaptive(
                    right,
                    global_start_index
                    + len(left),
                    depth + 1,
                )
            )

            return (
                left_result
                + right_result
            )

        # ====================================================
        # 한 장짜리 요청까지 실패했을 경우
        # 억지로 childhood로 분류하지 않는다.
        # ====================================================

        print(
            f"❌ 사진 {global_start_index}번 "
            "단독 분석까지 실패"
        )

        return [{
            "globalPhotoIndex": (
                global_start_index
            ),
            "photoIndex": 1,
            "detected": "unknown",
            "reason": (
                "Gemini API 분석 실패"
            ),
        }]


async def detect_memory_mode(
    images_data: list[dict]
) -> str:

    mode, _ = (
        await detect_memory_mode_batch(
            images_data
        )
    )

    return mode


async def detect_memory_mode_batch(
    images_data: list[dict]
) -> tuple[str, list[dict]]:

    total_count = len(
        images_data
    )

    if total_count == 0:

        return (
            "travel",
            []
        )

    print(
        "\n======================================================="
    )

    print(
        "🧠 [사진 모드 분석 시작]"
    )

    print(
        f"   총 사진 수: {total_count}장"
    )

    print(
        f"   기본 Batch 크기: "
        f"{BATCH_CHUNK_SIZE}장"
    )

    print(
        f"   모델: {MODEL_NAME}"
    )

    print(
        "======================================================="
    )

    all_analysis: list[dict] = []

    start_index = 0

    while start_index < total_count:

        chunk = images_data[
            start_index:
            start_index
            + BATCH_CHUNK_SIZE
        ]

        chunk_result = (
            await _classify_chunk_adaptive(
                images_data=chunk,
                global_start_index=(
                    start_index + 1
                ),
            )
        )

        all_analysis.extend(
            chunk_result
        )

        start_index += len(
            chunk
        )

    childhood_votes = sum(
        1
        for item in all_analysis
        if (
            item.get(
                "detected",
                ""
            ).lower()
            == "childhood"
        )
    )

    travel_votes = sum(
        1
        for item in all_analysis
        if (
            item.get(
                "detected",
                ""
            ).lower()
            == "travel"
        )
    )

    unknown_votes = sum(
        1
        for item in all_analysis
        if (
            item.get(
                "detected",
                ""
            ).lower()
            not in {
                "childhood",
                "travel"
            }
        )
    )

    valid_votes = (
        childhood_votes
        + travel_votes
    )

    # 모든 API 분석이 실패했을 때
    if valid_votes == 0:

        print(
            "❌ 모든 사진 분류가 실패했습니다."
        )

        print(
            "⚠️ 기존 프론트 호환을 위해 "
            "travel을 기본값으로 반환합니다."
        )

        final_mode = (
            "travel"
        )

    else:

        final_mode = (
            "childhood"
            if childhood_votes
            >= travel_votes
            else "travel"
        )

    print(
        "\n🎯 [최종 사진 분류 결과]"
    )

    print(
        f"   Childhood : "
        f"{childhood_votes}"
    )

    print(
        f"   Travel    : "
        f"{travel_votes}"
    )

    print(
        f"   Unknown   : "
        f"{unknown_votes}"
    )

    print(
        f"   Final     : "
        f"{final_mode.upper()}"
    )

    print(
        "=======================================================\n"
    )

    return (
        final_mode,
        all_analysis
    )


# ============================================================
# Existing Album Interview
# ============================================================

async def generate_memory_interview_batch(
    images_data: list[dict],
    photo_analyses: list[dict],
) -> dict:

    total_count = len(
        images_data
    )

    parts: List[types.Part] = []

    # ========================================================
    # 대표 이미지 최대 6장
    # ========================================================

    if total_count <= 6:

        target_images = (
            images_data
        )

    else:

        # 처음부터 끝까지 최대한 균등하게 선택
        indexes = []

        for i in range(6):

            index = round(
                i
                * (
                    total_count - 1
                )
                / 5
            )

            indexes.append(
                index
            )

        indexes = list(
            dict.fromkeys(
                indexes
            )
        )

        target_images = [
            images_data[index]
            for index in indexes
        ]

    for image in target_images:

        parts.append(
            _image_part(
                image
            )
        )

    # ========================================================
    # 분류 분석 결과 요약
    # ========================================================

    clues = []

    for analysis in photo_analyses:

        if (
            analysis.get(
                "detected"
            )
            == "unknown"
        ):
            continue

        clues.append(
            "- 사진 "
            f"{analysis.get('globalPhotoIndex')}: "
            f"{analysis.get('reason', '')}"
        )

    clues_summary = (
        "\n".join(
            clues[:20]
        )
        if clues
        else (
            "분류 단계에서 유효한 "
            "세부 단서를 얻지 못했습니다."
        )
    )

    parts.append(
        types.Part.from_text(
            text=f"""
이 앨범에는 총 {total_count}장의 사진이 있습니다.

전체 사진 분석에서 확인한 단서는 다음과 같습니다.

{clues_summary}


현재 제공된 대표 사진과
전체 사진 분석 단서를 함께 이용하세요.

다음을 내부적으로 검토하세요.

1. 반복되는 사람
2. 반복되는 장소
3. 반복되는 물건
4. 성장 변화
5. 반복되는 놀이
6. 가족 관계
7. 사진의 전후 이야기
8. 특별한 사건
9. 반복되는 생활
10. 현재의 삶과 연결될 수 있는 경험

최소 7개의 질문 후보를 고려한 뒤
사용자의 실제 기억을 가장 잘 끌어낼
서로 다른 질문 3개만 선택하세요.

최종 결과만 반환하세요.
"""
        )
    )

    try:

        return await _generate_json(
            parts=parts,
            system_instruction=(
                INTERVIEW_GENERATION_PROMPT
            ),
            response_schema=(
                InterviewResponse
            ),
            operation_name=(
                "기존 앨범 인터뷰 재생성"
            ),
        )

    except Exception as e:

        print(
            "⚠️ 인터뷰 생성 최종 fallback"
        )

        print(
            f"   {type(e).__name__}: "
            f"{repr(e)}"
        )

        return {
            "estimatedEra": (
                "정확한 시기 확인 필요"
            ),

            "sceneFacts": (
                "여러 장의 과거 사진에 "
                "인물과 주변 공간이 기록되어 있다."
            ),

            "visualClues": [
                "반복적으로 등장하는 공간",
                "여러 사진에 등장하는 사람",
                "사진에 남아 있는 당시의 생활 물건",
            ],

            "interviewQuestions": [
                {
                    "id": "q_1",
                    "category": (
                        "반복되던 일상"
                    ),
                    "targetClue": (
                        "사진에 반복되는 공간"
                    ),
                    "question": (
                        "사진 속 공간에서 "
                        "자주 하던 일이나 "
                        "반복되던 하루의 모습이 있었나요?"
                    ),
                    "quickOptions": [
                        "자주 놀던 곳",
                        "가족과 있던 곳",
                        "특별한 날에 가던 곳",
                        "기억 안 남",
                    ],
                },

                {
                    "id": "q_2",
                    "category": (
                        "관계"
                    ),
                    "targetClue": (
                        "사진에 등장하는 사람들"
                    ),
                    "question": (
                        "사진 속 사람들과 "
                        "당시 자주 함께했던 일 중 "
                        "지금도 떠오르는 장면이 있나요?"
                    ),
                    "quickOptions": [
                        "함께 놀던 기억",
                        "함께 외출한 기억",
                        "가족 행사",
                        "기억 안 남",
                    ],
                },

                {
                    "id": "q_3",
                    "category": (
                        "사진 밖의 이야기"
                    ),
                    "targetClue": (
                        "사진에 기록된 당시 장면"
                    ),
                    "question": (
                        "이 사진을 보면 "
                        "사진을 찍기 전이나 "
                        "찍은 뒤에 있었던 일까지 "
                        "떠오르는 것이 있나요?"
                    ),
                    "quickOptions": [
                        "사진 찍기 전이 기억남",
                        "사진 찍은 뒤가 기억남",
                        "다른 장면이 떠오름",
                        "기억 안 남",
                    ],
                },
            ],
        }