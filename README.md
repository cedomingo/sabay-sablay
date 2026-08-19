# Sabay Sablay

A schedule visualizer/planner for a group of students at one school.
Students upload a screenshot of their class schedule, the app OCRs it into
structured data, then lets students form groups, see a combined free/busy
view, and track deadlines/tasks.

Full roadmap and phase-by-phase spec: [`docs/schedule-planner-build-plan.md`](docs/schedule-planner-build-plan.md).

## Status: Phase 6 — Presence, Notifications & Privacy ✅

Google OAuth sign-in, schedule screenshot upload, OCR parsing, manual
correction UI, CRS-Monitor section enrichment, and personal weekly grid.

## Architecture

- **`/` (this repo root)** — Next.js app (TypeScript, Tailwind, App Router),
  deployed to Vercel. Frontend + app backend (server routes/actions).
- **`ocr-service/`** — FastAPI service wrapping the existing
  `parse_schedule.py` OCR script, deployed to Render as a separate
  service. Called only from Next.js server routes via a shared-secret
  header, never exposed to the browser.
- **Supabase** — Postgres + Auth (Google OAuth) + Storage. See
  `supabase/README.md`.
- **CRS-Monitor** — a separate, already-deployed service
  (github.com/cedomingo/CRS-Monitor) queried server-side for section
  enrichment. Not part of this repo.

## What's built (Phases 1–6)

### Auth & Onboarding (Phase 2)
- Supabase Auth with Google OAuth — one-click sign-in
- `profiles` table auto-created on signup via database trigger
- Middleware refreshes sessions and handles redirects
- Login page at `/auth/login`

### Schedule Upload & Parsing (Phase 2)
- Upload page at `/schedule/upload` — drag-and-drop or click to upload
- OCR parsing via FastAPI service, correction UI, CRS-Monitor enrichment

### Design System (Phase 1)
- Tailwind config with full token set (Deep teal, Paper, Coral, Aqua,
  Lilac, Sun, Line colors + DM Sans / Space Mono fonts)
- `globals.css` with grain texture, paper-grid, and schedule-cell styles

### Groups (Phase 3)
- Create group, invite via shareable code/link, join flow
- Group detail page with member list, leave/remove/delete actions
- RLS policies for cross-group schedule reading

### Combined Schedule View (Phase 4)
- Group heatmap grid showing free/busy overlap across members
- Click/hover cells for detail (who's busy, course, room)
- "Best times to meet" callout for empty slots

### Deadlines & Tasks (Phase 5)
- Personal task board at `/tasks` (create/edit/complete/delete)
- Group task boards at `/groups/[id]/tasks` with assignee support
- Merged upcoming deadlines on the schedule page

### Presence, Notifications & Privacy (Phase 6)
- **Presence**: "in class now" / "free now" derived from schedules,
  shown next to member names in group detail pages
- **Privacy**: hide/show toggle on schedule entries — hidden entries
  are excluded from group heatmap and presence but visible to owner
- **Notifications**: in-app notification system with bell icon, unread
  badge, dropdown, and full notifications page at `/notifications`
- Auto-generated due-date reminders for approaching task deadlines

### Stretch Features (Phase 7)
- **Calendar Export**: Export personal schedule to .ics format (Google Calendar, Apple Calendar)
- **Course-mate Detection**: Shows which group members share courses
- **Task Streaks**: Tracks consecutive days of task completions as gamification
- **PWA**: Installable mobile app experience with manifest and themed icons

## What's NOT built yet

Nothing — all planned phases (0–7) are complete!

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Supabase + OCR + CRS-Monitor values
npm run dev
```

Visit `http://localhost:3000` — you'll be redirected to `/auth/login`.
Sign in with Google, then upload your schedule screenshot.

For the OCR service, see `ocr-service/README.md`.

### Supabase setup

1. Run migrations in order: `phase2_tables` → `phase3_groups` → `phase5_tasks` → `phase6_notifications`
2. Enable Google OAuth in the Supabase Auth dashboard
3. Create a `schedule-images` Storage bucket (private)

### Deploying

See `DEPLOYMENT.md`.
