# backend/config.py

import os
from dotenv import load_dotenv


# ============================================================
# 환경변수 로드
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

ENV_PATH = os.path.join(BASE_DIR, ".env")

load_dotenv(ENV_PATH)


# ============================================================
# 파일 경로
# ============================================================

ALBUMS_DIR = os.path.join(
    BASE_DIR,
    "albums"
)

ENHANCED_DIR = os.path.join(
    ALBUMS_DIR,
    "enhanced"
)

DB_PATH = os.path.join(
    BASE_DIR,
    "database.db"
)


# ============================================================
# API Keys
# ============================================================

GEMINI_API_KEY = os.getenv(
    "GEMINI_API_KEY",
    "AQ.Ab8RN6LdMYCWIu8SsspW74WQRX78b2e1PQ5V06NjnCjC1dPqwA"
)

YOUCAM_API_KEY = os.getenv(
    "YOUCAM_API_KEY",
    "sk-aQ4x_2twP_ob_-RRqmtCdqt-6VBWx7mqdsCn357C-ynhIQvf2CMiDkZYy_iWfW_l"
)


# ============================================================
# Gemini 설정
# ============================================================

# 최신 안정 Flash 모델
GEMINI_MODEL = os.getenv(
    "GEMINI_MODEL",
    "gemini-3.8-flash"
)


# Google GenAI SDK HTTP timeout
#
# 단위: millisecond
#
# 분류 요청은 실제 서비스에서 45~60초 이상 걸리면
# 비정상 상태로 보는 것이 적절하지만,
# 네트워크 변동을 고려해 SDK 레벨 timeout은 60초로 설정.
GEMINI_HTTP_TIMEOUT_MS = int(
    os.getenv(
        "GEMINI_HTTP_TIMEOUT_MS",
        "60000"
    )
)


# API 호출 실패 시 추가 재시도 횟수
#
# 2 = 최초 1회 + 재시도 2회
GEMINI_MAX_RETRIES = int(
    os.getenv(
        "GEMINI_MAX_RETRIES",
        "2"
    )
)


# 사진 분류 한 요청당 사진 수
#
# 기존 7장에서 4장으로 감소.
GEMINI_CLASSIFY_BATCH_SIZE = int(
    os.getenv(
        "GEMINI_CLASSIFY_BATCH_SIZE",
        "4"
    )
)


# 한 번에 직접 분석할 최대 사진 수
GEMINI_DIRECT_THRESHOLD = int(
    os.getenv(
        "GEMINI_DIRECT_THRESHOLD",
        "4"
    )
)


# ============================================================
# 디렉터리 생성
# ============================================================

os.makedirs(
    ALBUMS_DIR,
    exist_ok=True
)

os.makedirs(
    ENHANCED_DIR,
    exist_ok=True
)