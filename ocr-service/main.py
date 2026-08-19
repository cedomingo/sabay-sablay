"""
FastAPI wrapper around the existing parse_schedule.py OCR script.

Exposes:
  GET  /health  - unauthenticated liveness check (deploy verification only)
  POST /parse   - multipart image upload -> JSON (Appendix B contract),
                  protected by the X-Internal-Key shared-secret header

This file is intentionally a thin wrapper. Do NOT reimplement the parsing
logic here — call into parse_schedule.py unchanged so the OCR behavior
stays identical to the script that was already validated on real
screenshots.
"""

import asyncio
import hmac
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

app = FastAPI(title="Schedule Planner OCR Service")

INTERNAL_KEY = os.environ.get("OCR_SERVICE_KEY")


def _require_internal_key(x_internal_key: str | None) -> None:
    if not INTERNAL_KEY:
        # Fail loudly in any real deployment — an unset key would silently
        # disable auth on /parse.
        raise HTTPException(
            status_code=500,
            detail="OCR_SERVICE_KEY is not configured on the server.",
        )
    # Constant-time comparison — plain `!=` leaks timing information that
    # can be used to brute-force the key byte-by-byte.
    if not x_internal_key or not hmac.compare_digest(x_internal_key, INTERNAL_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Internal-Key.")


@app.get("/health")
def health():
    return {"status": "ok", "service": "schedule-planner-ocr"}


@app.post("/parse")
async def parse(
    file: UploadFile = File(...),
    x_internal_key: str | None = Header(default=None),
):
    _require_internal_key(x_internal_key)

    if file.content_type not in ("image/png", "image/jpeg", "image/jpg", "image/webp"):
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {file.content_type}")

    # Write the upload to a temp file since parse_schedule.py is expected
    # to operate on a filesystem path (PIL/pytesseract-based scripts
    # typically do). Adjust here if the real script accepts bytes/streams
    # directly instead.
    suffix = Path(file.filename or "upload.png").suffix or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        # parse_schedule() is synchronous and CPU-bound (image processing +
        # tesseract calls, itself internally parallelized). Running it
        # directly on this coroutine would block the event loop, stalling
        # every other in-flight request on this worker for the whole parse.
        # Offload it to a thread so the loop stays free.
        result = await asyncio.to_thread(_run_parser, tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return JSONResponse(content=result)


def _run_parser(image_path: str) -> dict:
    """
    Calls parse_schedule.py's parse_schedule(image_path), which does the
    actual checkmark-detection + OCR work and returns the Appendix B shape.
    Falls back to a stub response only if parse_schedule.py is missing
    (e.g. running this file standalone without it present).
    """
    try:
        from parse_schedule import parse_schedule  # type: ignore

        return parse_schedule(image_path)
    except ImportError:
        # Stub response matching the Appendix B contract shape, so
        # `curl .../parse` returns something structurally correct even
        # before parse_schedule.py is dropped in.
        return {
            "total_units": 0.0,
            "schedule": [],
            "_stub": True,
            "_note": (
                "parse_schedule.py not found in ocr-service/. This is a "
                "placeholder response — see the TODO in main.py."
            ),
        }
