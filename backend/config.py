# backend/config.py
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ALBUMS_DIR = os.path.join(BASE_DIR, "albums")
ENHANCED_DIR = os.path.join(ALBUMS_DIR, "enhanced")
DB_PATH = os.path.join(BASE_DIR, "database.db")

# 🌟 API Keys 보안 설정 (.env 또는 시스템 환경변수)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AQ.Ab8RN6LdMYCWIu8SsspW74WQRX78b2e1PQ5V06NjnCjC1dPqwA")
YOUCAM_API_KEY = os.getenv("YOUCAM_API_KEY", "sk-aQ4x_2twP_ob_-RRqmtCdqt-6VBWx7mqdsCn357C-ynhIQvf2CMiDkZYy_iWfW_l")

os.makedirs(ALBUMS_DIR, exist_ok=True)
os.makedirs(ENHANCED_DIR, exist_ok=True)