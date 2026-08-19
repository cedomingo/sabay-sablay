# Phase 0 — Deployment Checklist

## 1. Supabase

Follow `supabase/README.md`. You need: project URL, anon key, service role
key, Google OAuth enabled, `schedule-images` private bucket created.

## 2. OCR service → Render

- New Web Service on Render, root directory `ocr-service/`
- Render builds from `ocr-service/Dockerfile`
- Set env var: `OCR_SERVICE_KEY` (generate a long random string)
- Note the deployed URL, e.g. `https://schedule-planner-ocr.onrender.com`

Verify:
```bash
curl https://<your-render-url>/health

curl -X POST https://<your-render-url>/parse \
  -H "X-Internal-Key: <your OCR_SERVICE_KEY>" \
  -F "file=@sample-schedule-screenshot.png"
```
You should get back JSON matching the Appendix B shape (a stub response
until the real `parse_schedule.py` is dropped in — see `ocr-service/README.md`).

## 3. Next.js app → Vercel

- Import this repo into Vercel, root directory `.` (leave `ocr-service/`
  out of the Vercel build — it's a separate Render deploy)
- Set env vars in the Vercel project settings:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only)
  - `OCR_SERVICE_URL` (the Render URL from step 2)
  - `OCR_SERVICE_KEY` (must match the Render env var)
  - `CRS_MONITOR_API_URL` (your existing CRS-Monitor deployment's base URL)
- Deploy

## 4. Confirm "done when" (per the build plan)

```bash
# Vercel placeholder page loads
open https://<your-vercel-url>

# Env vars wired correctly
curl https://<your-vercel-url>/api/health

# Vercel can reach Render over the shared secret
curl https://<your-vercel-url>/api/ocr-health

# Render /parse works directly, per the build plan's own done-when check
curl -X POST https://<your-render-url>/parse \
  -H "X-Internal-Key: <your OCR_SERVICE_KEY>" \
  -F "file=@sample-schedule-screenshot.png"
```

All four should succeed before moving to Phase 1.
