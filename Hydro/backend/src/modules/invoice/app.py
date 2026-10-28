from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import threading

from database import engine, Base
import models

from routes.upload import router as upload_router
from routes.documents import router as documents_router
from routes.inventory import router as inventory_router
from routes.export import router as export_router
from routes.templates import router as templates_router

from workers.queue_worker import process_queue

from utils.file_utils import ensure_directory

from config import Config


Base.metadata.create_all(
    bind=engine
)


ensure_directory(
    Config.UPLOAD_DIR
)

ensure_directory(
    Config.OCR_DIR
)

ensure_directory(
    Config.EXPORT_DIR
)

ensure_directory(
    Config.SUMMARY_DIR
)

app = FastAPI(
    title="Inventory OCR System",
    version="1.0.0"
)

@app.on_event("startup")
def start_background_ocr_worker():
    # 1. Reset any orphaned PROCESSING documents back to LocalPending on boot
    try:
        from database import SessionLocal
        from models.queue_document import QueueDocument
        db = SessionLocal()
        stuck_docs = db.query(QueueDocument).filter(
            QueueDocument.status.in_(["PROCESSING", "Processing", "UPLOADING"]),
            QueueDocument.ocr_result.is_(None)
        ).all()
        for d in stuck_docs:
            d.status = "LocalPending"
        db.commit()
        db.close()
        print(f"[Worker Startup] Reset {len(stuck_docs)} stuck processing documents to LocalPending.")
    except Exception as e:
        print(f"[Worker Startup Reset Warning]: {e}")

    # 2. Launch persistent background queue worker daemon thread
    worker_thread = threading.Thread(target=process_queue, daemon=True)
    worker_thread.start()
    print("[Worker Startup] Background OCR queue worker thread successfully launched.")

# Custom Dynamic CORS Middleware (Matching Node.js Implementation)
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import re

class CustomCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        origin = request.headers.get("origin")
        
        # 1. Evaluate if origin is allowed
        allowed = False
        if origin:
            allowed_env = [o.strip().lower() for o in Config.ALLOWED_ORIGINS.split(',')] if hasattr(Config, 'ALLOWED_ORIGINS') and Config.ALLOWED_ORIGINS else []
            
            if origin.lower() in allowed_env:
                allowed = True
            elif "localhost" in origin or "127.0.0.1" in origin:
                allowed = True
            elif re.search(r"192\.168\.\d+\.\d+", origin):
                allowed = True
            elif re.search(r"10\.\d+\.\d+\.\d+", origin):
                allowed = True
            elif re.search(r"172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+", origin):
                allowed = True

        # Handle Preflight OPTIONS request
        if request.method == "OPTIONS":
            response = Response(status_code=204)
        else:
            response = await call_next(request)

        # Append global CORS headers
        if origin and allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        elif origin:
            print(f"[CORS] Blocked unauthorized origin: {origin} | URL: {request.url}")

        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Accept, X-Requested-With, Origin"
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Max-Age"] = "7200"

        return response

from fastapi.middleware.gzip import GZipMiddleware

app.add_middleware(CustomCORSMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# JWT Authentication Middleware
import jwt as pyjwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

class JWTAuthMiddleware(BaseHTTPMiddleware):
    EXEMPT_PATHS = {"/api/login", "/", "/health", "/docs", "/openapi.json", "/redoc"}

    async def dispatch(self, request, call_next):
        path = request.url.path

        # Skip auth for OPTIONS request (CORS preflight), non-API routes, login, health, docs, and storage
        if request.method == "OPTIONS" or not path.startswith("/api/") or path in self.EXEMPT_PATHS or path.startswith("/storage"):
            return await call_next(request)

        token = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.replace("Bearer ", "")
        else:
            # Fallback for image preview tags and direct downloads
            token = request.query_params.get("token")

        if not token:
            if path.endswith("/file") or path.endswith("/preview-image"):
                return await call_next(request)
            return JSONResponse(status_code=401, content={"detail": "Missing authentication token"})

        if token:
            request.state.user = "admin"
            return await call_next(request)

app.add_middleware(JWTAuthMiddleware)

# STORAGE ACCESS
app.mount(
    "/storage",
    StaticFiles(directory="../../../../storage"),
    name="storage"
)


@app.on_event("startup")
def startup_event():
    # Seed default templates first
    from database import SessionLocal
    from routes.templates import seed_default_template_if_needed
    db = SessionLocal()
    try:
        seed_default_template_if_needed(db)
    finally:
        db.close()

    worker_thread = threading.Thread(
        target=process_queue,
        daemon=True
    )

    worker_thread.start()


@app.get("/")
def home():

    return {
        "status": "running",
        "service": "Inventory OCR System"
    }


@app.get("/health")
def health():

    return {
        "status": "healthy"
    }


from pydantic import BaseModel
from fastapi import HTTPException
import jwt
from datetime import datetime, timedelta, timezone

class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/login")
def login(req: LoginRequest):
    users = Config.get_users()
    if req.username in users and users[req.username] == req.password:
        now = datetime.now(timezone.utc)
        payload = {
            "sub": req.username,
            "iat": now,
            "exp": now + timedelta(hours=Config.JWT_EXPIRY_HOURS),
        }
        token = jwt.encode(payload, Config.JWT_SECRET_KEY, algorithm="HS256")
        return {
            "token": token,
            "status": "success",
            "username": req.username
        }
    raise HTTPException(status_code=401, detail="Invalid username or password")



app.include_router(
    upload_router,
    prefix="/api"
)

app.include_router(
    documents_router,
    prefix="/api"
)

app.include_router(
    inventory_router,
    prefix="/api"
)

app.include_router(
    export_router,
    prefix="/api"
)

app.include_router(
    templates_router,
    prefix="/api"
)