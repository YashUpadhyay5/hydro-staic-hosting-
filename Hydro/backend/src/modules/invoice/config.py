import os

from urllib.parse import quote_plus

from dotenv import load_dotenv

# Load .env relative to config.py location
dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path=dotenv_path, override=True)


def get_env_string(name, default=None):
    val = os.getenv(name)
    if val is None:
        return default
    val_stripped = val.strip()
    if val_stripped.lower() in ("none", "null", "undefined", ""):
        return default
    return val_stripped


class Config:

    # Database
    DATABASE_URL = get_env_string("DATABASE_URL")
    ALLOWED_ORIGINS = get_env_string("ALLOWED_ORIGINS")

    # OCR
    OCR_API_URL = get_env_string("OCR_API_URL")
    RUNPOD_ENDPOINT_ID = get_env_string("RUNPOD_ENDPOINT_ID")
    
    if RUNPOD_ENDPOINT_ID and not OCR_API_URL:
        OCR_API_URL = f"https://api.runpod.ai/v2/{RUNPOD_ENDPOINT_ID}/run"

    RUNPOD_API_KEY = get_env_string("RUNPOD_API_KEY")


    # Frontend
    FRONTEND_URL = os.getenv(
        "FRONTEND_URL"
    )

    # Storage
    UPLOAD_DIR = os.getenv(
        "UPLOAD_DIR"
    )

    OCR_DIR = os.getenv(
        "OCR_DIR"
    )

    EXPORT_DIR = os.getenv(
        "EXPORT_DIR"
    )

    SUMMARY_DIR = os.getenv(
        "SUMMARY_DIR"
    )

    # Queue
    QUEUE_POLL_INTERVAL = int(
        os.getenv(
            "QUEUE_POLL_INTERVAL",
            5
        )
    )

    MAX_UPLOAD_SIZE_MB = int(
        os.getenv(
            "MAX_UPLOAD_SIZE_MB",
            50
        )
    )

    # Auth — single legacy user
    LOGIN_USERNAME = get_env_string("LOGIN_USERNAME", "admin")
    LOGIN_PASSWORD = get_env_string("LOGIN_PASSWORD", "admin123")

    # JWT
    JWT_SECRET_KEY = get_env_string("JWT_SECRET_KEY", "default-secret-change-me")
    JWT_EXPIRY_HOURS = int(os.getenv("JWT_EXPIRY_HOURS", 24))

    # Auth — dynamic multi-user support
    # Reads LOGIN_USERNAME / LOGIN_PASSWORD, LOGIN_USERNAME2 / LOGIN_PASSWORD2, etc.
    @staticmethod
    def get_users():
        users = {}
        # First pair (no suffix)
        u = get_env_string("LOGIN_USERNAME")
        p = get_env_string("LOGIN_PASSWORD")
        if u and p:
            users[u] = p
        # Numbered pairs: 2, 3, 4, ...
        for i in range(2, 100):
            u = get_env_string(f"LOGIN_USERNAME{i}")
            p = get_env_string(f"LOGIN_PASSWORD{i}")
            if u and p:
                users[u] = p
            elif not u and not p:
                break  # stop scanning when no more pairs found
        # Fallback: if no users found at all, use the legacy single user
        if not users:
            users["admin"] = "admin123"
        return users