# Student Schedule & Group Planner — Full Build Plan

## How to use this document

Each phase below is written as a self-contained prompt. When you start a new
session with a coding LLM (Claude Code, etc.):

1. Paste the **Master Context** block (always).
2. Paste the **Phase N** block you want built next.
3. Tell the LLM which prior phases are already done ("Phases 0–2 are done and
   working, build Phase 3 now").
4. Don't paste future phases — they're here so the LLM understands where the
   app is headed and doesn't paint itself into a corner, not so it builds
   ahead of schedule.

---

## Master Context (paste into every phase)

You are building **a schedule visualizer/planner for a group of students at
one school**. Students sign up by uploading a screenshot of their class
schedule (a fixed-template grid exported from the school's registration
portal — dark header row with Time/Mon–Sun columns, green checkmarks marking
occupied cells). The app parses that into structured data, then lets
students form groups, see a combined view of when the group is free vs
busy, and track deadlines/tasks — personal and group-shared.

**Confirmed tech stack:**
- Frontend + app backend: **Next.js** (App Router, TypeScript, Tailwind),
  deployed on **Vercel**
- Database + Auth + file storage: **Supabase** (Postgres, Supabase Auth,
  Supabase Storage)
- OCR/schedule parsing: existing Python script (`pytesseract` + `scipy` +
  `PIL`, color-based checkmark detection), wrapped in a small **FastAPI**
  service, deployed on **Render**, called from a Next.js server route with a
  shared secret header — not exposed directly to the browser
- Section enrichment (room, slots, etc.): existing, already-deployed
  **CRS-Monitor** service (github.com/cedomingo/CRS-Monitor —
  Node/Express/SQLite, scrapes UP Diliman's live public CRS schedule pages
  every poll) — the app queries its `/api/sections` endpoint server-side to
  enrich each parsed entry with canonical section detail (room, slots,
  class code). Full contract, matching strategy, and a field-verification
  step the implementing LLM must do before coding against it: see
  Appendix C.

**Full feature roadmap (all phases, for context only):**
- Phase 0 — infra scaffolding
- Phase 1 — design system & look/feel
- Phase 2 — auth, schedule upload, OCR parsing, manual correction
- Phase 3 — groups (create/invite/join)
- Phase 4 — combined schedule view (free/busy heatmap)
- Phase 5 — deadlines & tasks (personal + group)
- Phase 6 — presence, notifications, privacy controls
- Phase 7 — stretch features (calendar export, course-mate detection, etc.)

**Conventions:**
- Keep the OCR service's output contract stable (see Appendix B) — later
  phases depend on it.
- Every table with per-user data needs Supabase Row Level Security (RLS)
  from the moment it's created, not bolted on later.
- Favor server components / server actions in Next.js for anything touching
  Supabase with elevated privileges; never ship the service role key to the
  client.
- At the end of each phase, zip the current codebase and present it for
  download alongside a short summary of what was built and what's left.
- From Phase 2 onward, build every screen using the design tokens and
  components established in Phase 1 — no one-off hex values or ad hoc
  components once that phase is done.

---

## Phase 0 — Infra & Scaffolding

**Goal:** empty but deployed skeleton, all three services talking to each other.

**Build:**
- Next.js app (TypeScript, Tailwind, App Router), deployed to Vercel
- Supabase project: enable Auth with the **Google OAuth** provider (optionally
  restrict to your school's Google Workspace domain via the `hd` parameter,
  if your school issues student Google accounts), create an empty Postgres
  schema, create a `schedule-images` Storage bucket (private)
- FastAPI service wrapping the existing `parse_schedule.py` unchanged,
  exposing `POST /parse` (multipart image upload → JSON), deployed to
  Render, protected by a shared-secret header (`X-Internal-Key`)
- Env vars wired up in both Vercel and Render: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only),
  `OCR_SERVICE_URL`, `OCR_SERVICE_KEY`, `CRS_MONITOR_API_URL` (base URL of
  your already-deployed CRS-Monitor instance, server-only — see Appendix C)
- Basic health-check route on both Vercel and Render to confirm the deploy

**Don't build yet:** any real UI beyond a placeholder page, any DB tables
beyond confirming the connection works.

**Done when:** visiting the Vercel URL loads a placeholder page, and a test
`curl` to the Render `/parse` endpoint with a sample image returns the
script's JSON output.

---

## Phase 1 — Design System & Look and Feel

**Goal:** establish a distinctive visual identity and a small reusable
component library before any real feature screens exist, so every later
phase styles itself consistently instead of improvising per page.

**Build:**
- A short design brief turned into a token system: a 4–6 color named
  palette, a type pairing (a characterful display face used with restraint
  + a clean body face + a utility face for timestamps/labels), and a
  spacing/radius scale. Avoid the generic AI-default looks (cream
  background + high-contrast serif + terracotta accent; near-black +
  single neon accent; zero-radius broadsheet with hairline rules) unless
  you deliberately want one of those — make choices that fit a student
  schedule/group-planning app specifically, not a generic SaaS template.
- One "signature" visual element grounded in the actual subject — the
  weekly schedule grid is the natural candidate here, since it's the thing
  every student will look at most; make its empty/occupied/hover states
  genuinely well-designed rather than an afterthought.
- Encode the tokens as the Tailwind theme config (`tailwind.config.ts`) so
  every later phase pulls from the theme instead of hardcoding hex values.
- A `/design-system` reference page rendering the palette, type scale, and
  core components in their states: buttons, inputs, cards, the weekly-grid
  cell (this one specifically gets reused in Phases 2, 4, and 6), badges/
  avatars, and empty/error states.
- Decide light/dark mode now if you want both — retrofitting it later
  touches every component.
- Mobile-first responsive pass on the component page itself.

**Don't build yet:** any real feature screens (auth, groups, heatmap) —
this phase only produces design tokens and a reusable component set.

**Done when:** `/design-system` renders every core component in every
state using only theme tokens (no one-off hex values anywhere in the
code), and it doesn't look like a generic template.

---

## Phase 2 — Auth, Upload & Schedule Parsing

**Goal:** a student can sign up, upload their schedule screenshot, review/fix
the parsed result, and see their own schedule.

**Build:**
- Supabase Auth signup/login via **Google OAuth** — one-click sign-in, no
  password to manage
- `profiles` table (see Appendix A), auto-created on signup via trigger;
  pre-fill `full_name` and `avatar_url` from the Google profile data
  returned by Supabase Auth
- Onboarding flow: after signup, prompt for schedule screenshot upload
- Upload flow: image → Supabase Storage → Next.js server route calls the
  Render `/parse` endpoint → returns structured entries
- **Correction UI**: show parsed entries in an editable table (day, start,
  end, course text) before saving, since OCR won't be 100% accurate on
  real-world screenshots — let the student fix or delete a row before
  confirming
- **Section enrichment**: after the student confirms the corrected rows,
  server-side, look up each entry (subject + course number + section)
  against your CRS-Monitor deployment's `/api/sections` (contract and
  required verification step in Appendix C). On a match, attach room and
  slot info to that entry; on no match, save the entry from OCR data alone
  — never block confirmation on enrichment succeeding
- On confirm: write to `schedules` + `schedule_entries` tables
- Personal schedule view: a read-only weekly grid rendering the student's
  own confirmed schedule, using the grid component from Phase 1 — show room
  (when matched) on the cell or its hover/expand state

**Don't build yet:** groups, combined views, tasks/deadlines.

**Data model touched:** `profiles`, `schedules`, `schedule_entries`,
including the CRS-Monitor enrichment columns (Appendix A)

**Done when:** a new user can sign up, upload one of the sample screenshots,
correct any misread rows, see their own weekly grid rendered correctly in
the Phase 1 design system, and — for rows that matched a live CRS section —
see that section's room displayed.

---

## Phase 3 — Groups

**Goal:** students can create a group, invite others, and see who's in it.

**Build:**
- `groups` and `group_members` tables (Appendix A)
- Create-group flow (name, optional description) — creator becomes owner
- Invite via a shareable code or link (`/join/[code]`) — joining adds a
  `group_members` row
- Group page: member list, leave-group action, owner can remove members
- RLS policies: a user can read `schedule_entries` for another user **only**
  if they share at least one group together (this is the policy Phase 4
  depends on — write it now even though the UI for it comes next phase)

**Don't build yet:** the combined schedule view UI itself, tasks.

**Data model touched:** `groups`, `group_members`; RLS update on
`schedule_entries`

**Done when:** two test accounts can create a group, invite/join each other,
and each can confirm (e.g. via a raw Supabase query) that they can now read
the other's `schedule_entries` but not a third, non-grouped user's.

---

## Phase 4 — Combined Schedule View (Free/Busy Heatmap)

**Goal:** inside a group, see an overlay of when the group is free vs busy.

**Build:**
- Group schedule page: weekly grid (same Mon–Sun / time-slot layout as the
  personal view) where each cell's shading reflects how many group members
  have a class at that time (e.g. 0 = fully free/light, all-members = fully
  busy/dark)
- Click/hover a cell to see exactly who's busy, in what course, and the
  room (when that entry was matched to a CRS-Monitor section — see
  Appendix C)
- Use `start_minutes`/`end_minutes` (added in Appendix B's OCR contract) to
  do the overlap math client-side or via a Supabase RPC function — either
  is fine for this scale
- A simple "best time to meet" callout: the top 1–3 emptiest slots in the
  group's week

**Don't build yet:** tasks/deadlines, notifications.

**Done when:** a group of 3+ test accounts with different schedules shows a
correctly shaded heatmap, and slot-click correctly lists who's busy.

---

## Phase 5 — Deadlines & Tasks

**Goal:** track school work, both privately and shared within a group.

**Build:**
- `tasks` table (Appendix A) — a task has an owner, an optional `group_id`
  (null = personal, set = shared with that group), title, description,
  due date, status
- Personal task list/board (create/edit/complete/delete)
- Group task board, visible to all group members, any member can add;
  optionally assign a task to a specific member
- Merged view: upcoming deadlines (personal + all groups) alongside the
  weekly schedule, sorted by due date

**Don't build yet:** notifications/reminders (that's Phase 6), presence.

**Data model touched:** `tasks`

**Done when:** a personal task only appears for its owner; a group task
appears for every member and any member can mark it complete.

---

## Phase 6 — Presence, Notifications & Privacy

**Goal:** the social layer — "what are my friends up to" — plus reminders
and control over what's shared.

**Build:**
- Lightweight presence: derive "in class now" / "free now" from the
  student's own confirmed schedule, no extra table needed — show it next to
  their name in the group member list
- Privacy controls: let a student hide specific courses from group views
  (add a `hidden` boolean on `schedule_entries`, excluded from heatmap +
  presence but still shown to the owner)
- Reminders: due-date notifications for tasks — start with in-app
  (a notifications table + bell icon) before adding email
- Email reminders via Supabase scheduled functions (cron) once in-app works

**Don't build yet:** Phase 7 stretch items.

**Done when:** a hidden course doesn't affect the heatmap or presence for
other members; a task nearing its due date produces an in-app notification.

---

## Phase 7 — Stretch Features (optional, pick as needed)

- Export merged schedule to Google/Apple Calendar (.ics)
- "Course-mate detection" — surface when 2+ group members share a course
- Support multiple groups per user with a group switcher
- Light gamification (completion streaks) for tasks
- PWA manifest for installable mobile experience

---

## Appendix A — Target Supabase Schema (full, for reference across phases)

```sql
-- Phase 2
profiles (
  id uuid primary key references auth.users(id),
  full_name text,
  school_email text,
  avatar_url text,
  created_at timestamptz default now()
)

schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  label text,               -- e.g. "1st Sem 2026-2027"
  total_units numeric,
  source_image_path text,   -- Supabase Storage path
  created_at timestamptz default now()
)

schedule_entries (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references schedules(id),
  day text,                 -- 'Mon'..'Sun'
  start_display text,       -- '07:30AM'
  end_display text,         -- '08:30AM'
  start_minutes int,        -- minutes since midnight
  end_minutes int,
  subject text,
  number text,
  section text,
  course_raw text,
  hidden boolean default false,  -- added Phase 6
  -- CRS-Monitor enrichment (Phase 2, Appendix C) — all nullable, since a
  -- row may not match (elective, cross-registered, not yet polled)
  crs_class_code text,      -- CRS-Monitor's unique enlistable-unit code
  room text,
  available_slots int,
  total_slots int,
  enrichment_matched boolean default false,
  created_at timestamptz default now()
)

-- Phase 3
groups (
  id uuid primary key default gen_random_uuid(),
  name text,
  description text,
  invite_code text unique,
  owner_id uuid references profiles(id),
  created_at timestamptz default now()
)

group_members (
  group_id uuid references groups(id),
  user_id uuid references profiles(id),
  role text default 'member',  -- 'owner' | 'member'
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
)

-- Phase 5
tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id),
  group_id uuid references groups(id) null,  -- null = personal
  title text,
  description text,
  due_at timestamptz,
  status text default 'open',  -- 'open' | 'done'
  created_at timestamptz default now()
)

-- Phase 6
notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  message text,
  read boolean default false,
  created_at timestamptz default now()
)
```

## Appendix B — OCR Microservice Contract

`POST /parse` — multipart form with the schedule image.

Response (extends the existing script's output with minute-integer fields
for easier heatmap math downstream):

```json
{
  "total_units": 18.0,
  "schedule": [
    {
      "day": "Mon",
      "start": "10:00AM",
      "end": "11:30AM",
      "start_minutes": 600,
      "end_minutes": 690,
      "course": "CWTS 1 Engg DCS",
      "subject": "CWTS",
      "number": "1",
      "section": "Engg DCS"
    }
  ]
}
```

Keep this shape stable — Phases 2 and 4 both depend on it.

## Appendix C — CRS-Monitor Enrichment Contract

Source: `github.com/cedomingo/CRS-Monitor` — already built and already
deployed by you, currently polling and storing **all** UP Diliman CRS
sections for the live semester. This is a separate existing service, not
something built as part of this roadmap; the app just calls it.

**Architecture (for the implementing LLM's context):**
- Node/Express + SQLite. A background poller scrapes all 26 lettered CRS
  schedule pages (`crs.upd.edu.ph/schedule/{semester_code}/{letter}`) on an
  interval and upserts into SQLite.
- A **section's identity is its class code** — the same unique enlistable
  unit CRS itself uses. One class code can be split across multiple
  "blocks" (different enlisting units with separate slot allocations);
  slot counts on the main record are pre-summed across blocks, with
  per-block detail kept separately if ever needed.
- A section with multiple meeting times (e.g. lecture + lab) stores them
  joined with `; ` internally.
- API surface: `GET /api/sections`, `GET /api/sections/subjects`,
  `GET /api/meta`, `GET /api/health`. Read-only, no auth. Even though it's
  unauthenticated, call it from a Next.js **server** route (using
  `CRS_MONITOR_API_URL`), not directly from the browser — keeps one
  consistent egress point and avoids hardcoding the CRS-Monitor URL into
  client bundles.
- **Semester scoping matters:** the API serves whichever semester is
  currently marked "active" by default, or a specific one via
  `?semester={semester_code}` (e.g. `120252`). Default to the active
  semester; a mismatched semester code silently returns zero matches
  rather than an error, so don't hardcode an old code from testing.

**Matching strategy (confirmed against your sample screenshots):**
The section codes your OCR output already extracts (`THAB`, `WFR-HR-4`,
`THV-6`) follow the same subject / course-number / section format
CRS-Monitor stores internally. So enrichment is a join on
`subject + number + section` from `schedule_entries` against
CRS-Monitor's equivalent fields — no fuzzy matching should be needed for
the common case.

**⚠️ Field names need live verification before coding this:**
I wasn't able to fetch CRS-Monitor's actual route/service source
(`server/routes/*.js`, `server/services/sectionService.js`) to confirm the
exact JSON keys `/api/sections` returns. From the README I'm confident the
underlying data *includes* class code, subject, course number, section,
room, meeting-time text, available/total slots, demand, restrictions,
remarks, and timestamps — but whether the JSON calls them e.g. `room` vs
`venue`, `class_code` vs `classCode`, is not confirmed here.

**Action for the implementing LLM, before writing the enrichment code in
Phase 2:** hit the live deployment directly —
```
curl "$CRS_MONITOR_API_URL/api/sections?semester=<active_code>" | head
```
— and use the *actual* returned field names. Don't guess from this
document.

**Enrichment behavior:**
- Non-blocking: a student can confirm and save their schedule whether or
  not any given row matches. No match just means `enrichment_matched`
  stays `false` and the enrichment columns stay null (expected for
  cross-registered courses, electives outside CRS, or a section
  CRS-Monitor hasn't polled yet this semester).
- Batch the lookups for one student's confirmed rows into as few requests
  as `/api/sections` supports (e.g. one fetch of the relevant subject(s),
  matched client/server-side against all rows) rather than one HTTP call
  per row.
- Where it surfaces: room on the personal grid (Phase 2) and group heatmap
  cells (Phase 4) — cell hover/click can show room alongside who's busy.
