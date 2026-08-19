# Schedule Planner — OCR Service

Thin FastAPI wrapper around the existing `parse_schedule.py` script.
Deployed to Render as its own service, called only from the Next.js
server (never the browser), authenticated via a shared-secret header.

## Before deploying

Drop the real `parse_schedule.py` into this directory (next to `main.py`)
so its `parse_schedule(image_path)` function is importable. Until then,
`/parse` returns a stub response matching the Appendix B shape so the
contract is testable end-to-end.

If the real script's entry point has a different name/signature, update
the import in `_run_parser()` in `main.py` accordingly — don't change the
response shape, since Phase 2 (correction UI) and Phase 4 (heatmap) both
depend on it staying stable.

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# also requires the tesseract-ocr binary on your system:
#   macOS:  brew install tesseract
#   Ubuntu: sudo apt-get install tesseract-ocr

cp .env.example .env   # fill in OCR_SERVICE_KEY
export $(cat .env | xargs)

uvicorn main:app --reload --port 8000
```

## Verify

```bash
curl http://localhost:8000/health

curl -X POST http://localhost:8000/parse \
  -H "X-Internal-Key: $OCR_SERVICE_KEY" \
  -F "file=@/path/to/sample-schedule-screenshot.png"
```

## Deploying to Render

- New Web Service → point at this repo, root directory `ocr-service/`
- Render will build from the `Dockerfile` in this directory
- Set env var `OCR_SERVICE_KEY` in the Render dashboard (must match the
  Next.js app's `OCR_SERVICE_KEY`)
- Render auto-injects `$PORT`; the Dockerfile CMD already respects it
