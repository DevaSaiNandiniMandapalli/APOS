"""APOS processing API.

The browser-local tools remain the default frontend experience. This FastAPI
service exposes the optional self-hosted document engines for operations that
need native libraries (LibreOffice, Ghostscript, OCRmyPDF, WeasyPrint,
pyHanko, pdf2docx and pdfplumber).

No database, account system or persistent document storage is used. Uploaded
bytes are held in memory and, for tools that need an external binary, in a
temporary directory that is removed by the tool before returning.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.parse
from collections import deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

from apos_processing.tools import all_tools, get_tool
from apos_processing.tools.helpers import ToolError
from apos_processing.tools.registry import Tool, UploadedFile
from apos_processing.workflows import run_workflow

VERSION = "0.2.0"
MAX_UPLOAD_MB = int(os.getenv("APOS_MAX_UPLOAD_MB", "50"))
MAX_FILES = int(os.getenv("APOS_MAX_FILES", "20"))
MAX_OUTPUT_BYTES = int(os.getenv("APOS_MAX_OUTPUT_MB", "100")) * 1024 * 1024
RATE_LIMIT_REQUESTS = int(os.getenv("APOS_RATE_LIMIT_REQUESTS", "120"))
RATE_LIMIT_WINDOW = int(os.getenv("APOS_RATE_LIMIT_WINDOW", "60"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class _RateLimiter:
    """Small bounded in-memory limiter; state is intentionally lost on restart."""

    def __init__(self, requests: int, window_seconds: int) -> None:
        self.requests = max(1, requests)
        self.window = max(1, window_seconds)
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._last_cleanup = time.monotonic()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if now - self._last_cleanup > self.window:
                cutoff = now - self.window
                self._hits = {name: deque(value for value in hits if value > cutoff) for name, hits in self._hits.items() if any(value > cutoff for value in hits)}
                self._last_cleanup = now
            hits = self._hits.setdefault(key, deque())
            cutoff = now - self.window
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self.requests:
                return False
            hits.append(now)
            if len(self._hits) > 5000:
                self._hits.pop(next(iter(self._hits)))
            return True


limiter = _RateLimiter(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"] = "no-store"
        return response


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app = FastAPI(
    title="APOS processing API",
    description="Optional self-hosted processing engines for APOS PDF, Office and security tools.",
    version=VERSION,
    docs_url="/api/docs",
    redoc_url=None,
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Length"],
)


@app.get("/api/v1/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    """Report API availability without exposing environment details."""
    return HealthResponse(status="ok", service="apos-api", version=VERSION)


@app.get("/api/v1/tools", tags=["tools"])
def list_tools() -> dict:
    """Describe every processing tool and whether its native dependencies are present."""
    tools = [tool.describe() for tool in all_tools()]
    return {
        "tools": tools,
        "version": VERSION,
        "max_upload_mb": MAX_UPLOAD_MB,
        "max_files": MAX_FILES,
        "processing_server": True,
    }


def _validate_generic(filename: str, data: bytes) -> None:
    """Validate common upload signatures without a specific tool descriptor."""
    suffix = Path(filename).suffix.lower()
    if suffix in {".pdf", ""} and not _looks_like_pdf(data):
        if suffix == ".pdf":
            raise HTTPException(400, f"{filename} does not have a PDF signature.")
        return
    if suffix == ".pdf":
        return
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"}:
        if suffix == ".png" and not _looks_like_png(data):
            raise HTTPException(400, f"{filename} does not match its PNG signature.")
        if suffix in {".jpg", ".jpeg"} and not _looks_like_jpeg(data):
            raise HTTPException(400, f"{filename} does not match its JPEG signature.")
    if suffix in {".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"} and not data.startswith(b"PK"):
        raise HTTPException(400, f"{filename} is not a valid ZIP-based Office document.")


def _looks_like_pdf(data: bytes) -> bool:
    return b"%PDF-" in data[:1024]


def _looks_like_png(data: bytes) -> bool:
    return data.startswith(b"\x89PNG\r\n\x1a\n")


def _looks_like_jpeg(data: bytes) -> bool:
    return data.startswith(b"\xff\xd8\xff")


def _validate_signature(tool: Tool, filename: str, data: bytes) -> None:
    """Reject obvious signature/extension mismatches before a tool sees them."""
    if not data:
        raise HTTPException(400, f"{filename or 'The uploaded file'} is empty.")
    suffix = Path(filename).suffix.lower()
    if tool.accepts == "image/*" and suffix not in {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"}:
        raise HTTPException(400, f"{filename} is not a supported image upload for {tool.label}.")
    if suffix in {".p12", ".pfx"}:
        return
    if suffix == ".pdf" or (not suffix and _looks_like_pdf(data)):
        if not _looks_like_pdf(data):
            raise HTTPException(400, f"{filename} does not have a PDF signature.")
        return
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"}:
        valid = (
            _looks_like_png(data)
            or _looks_like_jpeg(data)
            or (suffix in {".webp"} and data[:4] == b"RIFF" and data[8:12] == b"WEBP")
            or (suffix in {".tif", ".tiff"} and data[:4] in {b"II*\x00", b"MM\x00*"})
            or (suffix == ".gif" and data[:6] in {b"GIF87a", b"GIF89a"})
        )
        if not valid:
            raise HTTPException(400, f"{filename} does not match its image file signature.")
        return
    if suffix in {".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"}:
        if not data.startswith(b"PK"):
            raise HTTPException(400, f"{filename} is not a valid ZIP-based Office document.")
        return
    if suffix in {".doc", ".xls", ".ppt"}:
        if not data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            raise HTTPException(400, f"{filename} is not a valid legacy Office document.")
        return
    if suffix == ".rtf":
        if not data.lstrip().startswith(b"{\\rtf"):
            raise HTTPException(400, f"{filename} is not a valid RTF document.")
        return
    if suffix in {".html", ".htm"}:
        if b"<" not in data[:4096]:
            raise HTTPException(400, f"{filename} does not look like HTML.")
        return
    if suffix in {".txt", ".md", ".csv", ".json"}:
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(400, f"{filename} is not valid UTF-8 text.") from None
        return
    # Tools that accept an unusual extension validate their own content.
    if tool.accepts in {".pdf", ""} and not _looks_like_pdf(data):
        raise HTTPException(400, f"{filename} does not have a PDF signature.")


async def _collect_form(request: Request, tool: Tool | None = None) -> tuple[list[UploadedFile], dict[str, str]]:
    try:
        form = await request.form()
    except Exception:
        raise HTTPException(400, "Send multipart form data with files and options.") from None
    files: list[UploadedFile] = []
    options: dict[str, str] = {}
    total = 0
    for key, value in form.multi_items():
        if hasattr(value, "read"):
            data = await value.read()
            filename = getattr(value, "filename", None) or "file"
            total += len(data)
            if total > MAX_UPLOAD_BYTES:
                raise HTTPException(413, f"Uploads are capped at {MAX_UPLOAD_MB} MB.")
            if len(files) >= MAX_FILES:
                raise HTTPException(400, f"This server accepts at most {MAX_FILES} files per request.")
            if tool is not None:
                _validate_signature(tool, filename, data)
            else:
                _validate_generic(filename, data)
            if data:
                files.append(UploadedFile(name=filename, data=data))
        else:
            options[str(key)] = str(value)
    return files, options


def _file_response(result) -> Response:
    if len(result.data) > MAX_OUTPUT_BYTES:
        raise HTTPException(413, f"The generated output exceeds the {MAX_OUTPUT_BYTES // (1024 * 1024)} MB server limit.")
    quoted = urllib.parse.quote(result.filename)
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
        "Content-Length": str(len(result.data)),
        "X-APOS-Filename": result.filename,
    }
    return Response(content=result.data, media_type=result.media_type, headers=headers)


def _check_rate_limit(request: Request) -> None:
    if not limiter.allow(_client_key(request)):
        raise HTTPException(429, "Too many processing requests. Wait a minute and try again.")


def _check_availability(tool: Tool) -> None:
    if not tool.available():
        detail = tool.unavailable_hint or "A required native dependency is missing on this server."
        raise HTTPException(503, f"{tool.label} is not available on this server ({detail}).")


@app.post("/api/v1/tools/{name}", tags=["tools"])
async def run_tool(name: str, request: Request) -> Response:
    _check_rate_limit(request)
    try:
        tool = get_tool(name)
    except KeyError:
        raise HTTPException(404, f"No processing tool called {name!r}.") from None
    _check_availability(tool)
    files, options = await _collect_form(request, tool)
    if len(files) < tool.min_files:
        raise HTTPException(400, f"{tool.label} needs at least {tool.min_files} file(s).")
    if not tool.multiple and len(files) > 1:
        raise HTTPException(400, f"{tool.label} takes a single file.")
    try:
        result = await run_in_threadpool(tool.run, files, options)
    except ToolError as exc:
        raise HTTPException(400, str(exc)) from None
    except Exception:
        raise HTTPException(500, "The processing engine failed safely. The document was not retained.") from None
    return _file_response(result)


@app.post("/api/v1/workflows/run", tags=["workflows"])
async def run_workflow_endpoint(request: Request) -> Response:
    _check_rate_limit(request)
    files, options = await _collect_form(request)
    try:
        steps = json.loads(options.get("steps", "[]"))
    except json.JSONDecodeError:
        raise HTTPException(400, "steps must be valid JSON") from None
    if not files:
        raise HTTPException(400, "Add at least one file to run a workflow on.")
    try:
        result = await run_in_threadpool(run_workflow, files, steps)
    except ToolError as exc:
        raise HTTPException(400, str(exc)) from None
    except Exception:
        raise HTTPException(500, "The workflow failed safely. The documents were not retained.") from None
    return _file_response(result)


async def _first_upload(request: Request) -> bytes:
    try:
        form = await request.form()
    except Exception:
        raise HTTPException(400, "Upload a PDF to inspect.") from None
    for _, value in form.multi_items():
        if hasattr(value, "read"):
            data = await value.read()
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, f"Uploads are capped at {MAX_UPLOAD_MB} MB.")
            if not _looks_like_pdf(data):
                raise HTTPException(400, "The uploaded file does not have a PDF signature.")
            return data
    raise HTTPException(400, "Upload a PDF to inspect.")


@app.post("/api/v1/inspect/form-fields", tags=["inspect"])
async def inspect_form_fields(request: Request) -> dict:
    _check_rate_limit(request)
    data = await _first_upload(request)
    from apos_processing.tools.forms import list_form_fields

    try:
        return {"fields": await run_in_threadpool(list_form_fields, data)}
    except ToolError as exc:
        raise HTTPException(400, str(exc)) from None


@app.post("/api/v1/inspect/words", tags=["inspect"])
async def inspect_words(request: Request) -> dict:
    _check_rate_limit(request)
    data = await _first_upload(request)
    from apos_processing.tools.redact_auto import detect_word_boxes

    try:
        return {"pages": await run_in_threadpool(detect_word_boxes, data)}
    except ToolError as exc:
        raise HTTPException(400, str(exc)) from None
    except ImportError:
        raise HTTPException(503, "pdfplumber is not installed on this server.") from None


# Compatibility aliases for clients written against the supplied APOS/pdfsmith
# implementation. The versioned /api/v1 routes are the supported interface.
app.add_api_route("/healthz", health, methods=["GET"], include_in_schema=False)
app.add_api_route("/api/tools", list_tools, methods=["GET"], include_in_schema=False)
app.add_api_route("/api/tools/{name}", run_tool, methods=["POST"], include_in_schema=False)
app.add_api_route("/api/workflows/run", run_workflow_endpoint, methods=["POST"], include_in_schema=False)
app.add_api_route("/api/inspect/form-fields", inspect_form_fields, methods=["POST"], include_in_schema=False)
app.add_api_route("/api/inspect/words", inspect_words, methods=["POST"], include_in_schema=False)


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(Exception)
async def unhandled_error(_request: Request, _exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"error": "The processing service failed safely. The document was not retained."})
