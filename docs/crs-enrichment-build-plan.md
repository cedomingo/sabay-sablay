# CRS-Monitor enrichment in sabay-sablay — full build plan

CRS_MONITOR_API_URL=https://crs-monitor.onrender.com

Two repos, both mine:
- `CRS-Monitor` (github.com/cedomingo/CRS-Monitor) — deployed, live-scrapes UP Diliman's
  public CRS schedule pages into SQLite, exposes a REST API.
- `sabay-sablay` (github.com/cedomingo/sabay-sablay) — Next.js app. Students upload a
  screenshot of their schedule, client-side OCR (Tesseract.js, `lib/client-ocr/`) turns
  it into structured rows, there's a manual correction UI at `app/schedule/correction/page.tsx`.
  "CRS-Monitor enrichment" is wired end-to-end but built against a fabricated API shape
  and does exact-string matching. This plan replaces it with something real.

Ground truth, confirmed by reading both repos directly (not assumed):

- CRS-Monitor's `classCode` (e.g. `57851`, occasionally `57851-THQ1`) is its own
  registration code for the class as a whole — **not** the short letter fragment
  (`WFV`) a student's schedule screenshot shows. That fragment is CRS-Monitor's
  `section` field, split out of the "Class" cell alongside `subject`/`course` in
  `server/scraper/parser.js`. **The matcher must fuzzy-match OCR's section fragment
  against `section`, not `classCode`.**
- Real `GET /api/sections` response: `{ semesterCode, total, count, sections: [{ id,
  classCode, subject, course, section, title, credits, schedule, instructor, mode,
  remarks, availableSlots, totalSlots, demand, restrictions, firstDetected, lastSeen }] }`.
  There is no `scheduleBlocks` in the wire response (only in the DB) — the client
  gets raw `schedule` free text and must parse it itself if it wants structured day/time.
- `GET /api/sections/subjects` → `{ subjects: [{ subject, count }] }` — not a bare
  string array.
- `GET /api/sections/courses?search=` → `{ courses: [{ course, count }] }`, autocomplete only
  (empty search returns `[]`).
- `GET /api/health` exists for a cheap liveness check.
- sabay-sablay has no `ocr-service/` — OCR is entirely client-side. `PROJECT_HANDOFF.md`
  doesn't exist in CRS-Monitor. Both were stale assumptions from the original task
  brief; noted so nobody goes looking for either.
- The OCR unit is one row **per meeting-day** (`ScheduleEntry: { day, start, end,
  start_minutes, end_minutes, course, subject, number, section }`), so a TTh lecture is
  already 2 separate rows by the time it reaches the correction page — the matcher needs
  to group same-class rows before matching, not match each day-row independently.
- Existing Supabase columns on `schedule_entries` (from `00000000000001_phase2_tables.sql`):
  `crs_class_code, room, available_slots, total_slots, enrichment_matched` — all nullable,
  no migration needed for those. Missing and needed: `raw_ocr_text` (or day-row equivalent),
  `instructor`, `remarks`, `restrictions`, and something to store confidence/candidates for
  the manual-confirmation path.
- `.env.example` already declares `CRS_MONITOR_API_URL` (not `CRS_MONITOR_URL` as the
  original brief said) — kept as-is, no rename.

Two decisions locked in with the user before Phase B starts, since a wrong default here
would silently mutate a student's schedule:
1. **Matching granularity:** group an OCR'd class's day-rows into one class and match
   once against CRS-Monitor (not per day-row).
2. **Overwrite behavior on confirmed match:** replace the class's day-rows wholesale with
   CRS-Monitor's actual meeting blocks (may add/remove rows if CRS's pattern has a
   different block count than what OCR captured — e.g. lec+lab vs one row, or a day OCR
   missed entirely).

Constraints carried through every phase:
- Talk to CRS-Monitor only over its REST API, never its DB directly (independent deploys).
- Don't guess at Supabase schema or component structure — read what's there first.
- Below the confidence threshold: route to the existing manual correction UI, never
  silently guess a room/time.
- Always retain the original OCR'd text so a bad match is auditable/reversible.
- Each phase ships as its own zip; nothing gets merged into one giant patch.

---

## Phase A — CRS-Monitor client in sabay-sablay — ✅ DONE (shipped)

**Prompt used:**
> Add a server-side-only fetch wrapper around CRS-Monitor's deployed REST API. Match
> the *real* response shapes (read `server/routes/sections.js` and
> `server/services/sectionService.js` first, don't trust the brief's guessed shapes).
> Cover `getSubjects()`, `getCourseSuggestions()`, `getSections(params)`, and a
> `getAllSectionsForSubject()` helper that paginates past the API's 2000-row cap.
> Include a cheap `checkHealth()`. Timeouts on every call — enrichment must degrade
> gracefully (an unmatched/unreachable entry should never break the upload/correction
> flow). Never import this from a Client Component.

**What was actually done:**
- Deleted the old `lib/crs-monitor.ts` (built against a fabricated shape: `class_code`,
  `number`, `meeting_times` — none of which exist on the real API; exact-string join).
- Replaced with `lib/crs-monitor/` module:
  - `types.ts` — `CrsSection`, `CrsSubject`, `CrsCourseSuggestion`, `GetSectionsParams`,
    `GetSectionsResponse`, `CrsScheduleBlock`/`CrsBlock`, all 1:1 with the wire format,
    with field-meaning notes (`classCode` vs `section`) inline so this doesn't get
    silently "corrected" back to the wrong assumption later.
  - `client.ts` — `getSubjects()`, `getCourseSuggestions()`, `getSections()`,
    `getAllSectionsForSubject()`, `checkHealth()`. 8s timeout on section fetches, 3s on
    health checks. Throws a typed `CrsMonitorError` on failure/timeout/bad JSON so callers
    can distinguish "CRS-Monitor is down" from "no match found."
  - `index.ts` — barrel export so `@/lib/crs-monitor` keeps resolving for existing
    import sites.
- Added `server-only` as a real npm dependency (was previously just a comment-level
  promise, not enforced) so this module can never end up in a client bundle.
- Left `.env.example`'s `CRS_MONITOR_API_URL` untouched — already correct.
- Verified with `tsc --noEmit`: clean except one expected error in
  `app/api/schedule/enrich/route.ts` (still imports the old `enrichEntries`) — that
  route is intentionally rewritten in Phase C against the new matcher, not patched now.

**Shipped:** `phase-A-crs-monitor-client.zip` — `lib/crs-monitor/` + updated
`package.json`/`package-lock.json`.

---

## Phase B — The matcher — ⏳ NEXT

**Prompt:**
> Build `lib/crs-monitor/matcher.ts`. Input: one *grouped* OCR'd class — subject, course
> number, section fragment, and the set of day-rows (day/start/end) OCR captured for it
> (possibly incomplete/wrong, since the source screenshot itself truncates section codes
> and sometimes meeting times — that's a university-side display limitation, not an OCR
> bug, and there's no upstream fix for it). Output: the best-matching `CrsSection`, a
> ranked list of candidates if ambiguous, or nothing if there's no reasonable match.
>
> Requirements:
> - Normalize subject names before comparing: case/whitespace, and the specific
>   abbreviation mismatches CRS-Monitor's own parser docs call out (e.g. `Art Stud`,
>   `App Physics`) — pull the canonical list from `parser.js`'s comments/tests rather
>   than inventing one.
> - Match the OCR section fragment against CRS-Monitor's `section` field (not
>   `classCode`) as a segment/prefix match, not exact equality.
> - Group OCR's day-rows into one class before matching (per the locked decision above).
> - When subject+course has multiple candidate sections, rank by confidence. Define
>   confidence concretely in code comments: exact segment match > partial match; unique
>   match > multiple candidates; and if OCR's day/time roughly matches one candidate's
>   parsed `schedule` better than the others, use that as an additional disambiguating
>   signal (you'll need to parse CRS's free-text `schedule` into day/time blocks
>   yourself here, client-side — the live API doesn't return `scheduleBlocks`, only the
>   DB has it).
> - Below a confidence threshold, return "needs manual confirmation," not a guess.
> - Write the confidence model down in comments — this is the part most likely to need
>   tuning later against real mismatches, so it needs to be legible, not just correct.

**Status:** not started.

---

## Phase C — Persist and display — ⏳ AFTER B

**Prompt:**
> Wire the matcher into the real flow and persist/display its output.
>
> - Rewrite `app/api/schedule/enrich/route.ts` and the call site in
>   `app/schedule/correction/page.tsx` to group day-rows, call the Phase B matcher, and
>   handle its three outcomes (confident match / candidates / no match) — route anything
>   below threshold into the existing manual correction UI rather than auto-applying it.
> - On confirmed match (auto or manually confirmed): **overwrite** — not just fill blanks
>   on — the entry's class code, room, and meeting day-rows with CRS-Monitor's
>   authoritative values, per the locked wholesale-replace decision (may add/remove
>   day-rows vs what OCR produced). Store slot counts too.
> - Add a Supabase migration for whatever the current schema is missing: at minimum
>   `raw_ocr_text` (keep the original OCR'd text so a bad match is auditable/reversible —
>   this is non-negotiable per the constraints above), plus `instructor`, `remarks`,
>   `restrictions`, and confidence/candidate storage for the manual-confirmation path.
>   Don't guess the existing schema — read `supabase/migrations/` first (already done in
>   Phase A/B exploration: existing enrichment columns are `crs_class_code, room,
>   available_slots, total_slots, enrichment_matched`, all present, no migration needed
>   for those specifically).
> - Decide and document snapshot-vs-refresh: default to snapshot-at-match (CRS-Monitor
>   data can drift — slots/rooms change during enlistment — so flag this explicitly as a
>   tradeoff in a code comment/PR description, don't bury it as an implementation detail).
> - Surface room, instructor, remarks, and restrictions in the correction UI
>   (`app/schedule/correction/page.tsx`) and wherever else the schedule grid renders
>   entries — read the existing component structure first rather than assuming.

**Status:** not started, blocked on Phase B.

---

## Delivery format

Each phase ships as its own zip (not one combined patch at the end):
- `phase-A-crs-monitor-client.zip` — shipped.
- `phase-B-matcher.zip` — pending.
- `phase-C-persist-and-display.zip` — pending.
