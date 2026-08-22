# Handoff — OCR alternate reader iteration (end of day, 2026-08-23)

Scope of this note: everything from today's sessions on schedule upload / OCR.
Earlier same-day work (CRS exact-section auto-match, sample-3 duplicate fix,
mobile views) is already committed and is only summarized here.

---

## 1. Shipped and verified

| Item | Files | Status |
| --- | --- | --- |
| CRS exact-section auto-match (Eng 13 / Eng 1 asked despite explicit code) | `lib/crs-monitor/matchServer.ts`, `matcher.ts`, `scripts/verify-crs-matching.ts` | Done. Pre-fix produced CANDIDATES x3/x2; post-fix auto-matches. Harness checks [11a]/[11b] pass. |
| Duplicate-class fix for clipped OCR reads (sample 3 showed two "Physics 72") | `lib/client-ocr/textCleanup.ts` (`canonicalizeCourseVariants`), `types.ts`, `parseSchedule.ts` | Done. Unifies truncated/misread variants of one class before grouping. Checks [12a]/[12b] pass. |
| Mobile views | `AppHeader.tsx`, `app/schedule/page.tsx`, `GroupScheduleGrid.tsx`, container padding across pages, correction footer | Done (committed as `cf93248`). |
| Alternate OCR reader (`docs/other` samples) | `lib/client-ocr/fallbackParse.ts` (NEW), `parseSchedule.ts` wiring | **Mostly done** — see per-sample status below. |

### Alternate-reader results vs ground truth (as of end of day)

| Sample | Cells correct | Residual |
| --- | --- | --- |
| sampleschedule4.jpg | **21/21** | none |
| sampleschedule5.png | 18/21 | 3 bottom-row cells missing (last-row checkmarks likely clipped at image edge) |
| sampleschedule6.png | 19/21 | 1 garbage cell `"Lo ZU 1HAD"` passes digit gate; Tue `CS 20 THAB` missing |
| sampleschedule7.png | **0/21** | OPEN — see §3 |
| sampleschedule8.png | 20/21 | junk prefix `"RE CS 20 THAB"` (strip rule only removes ≤1-char leading tokens) |

Baseline before this work: all five were unreadable by the primary reader.

---

## 2. How the alternate reader works (`fallbackParse.ts`)

Pipeline inside `readScheduleWithFallback()`:

1. Full-page sparse OCR (PSM 11) over a white-filled 2x upscale.
2. §1.5 Checkmarks — same green detector as primary, IoU-dedupe. Computed
   early because row bands AND column drift-correction anchor on it.
3. §2 Day columns — fuzzy header match on full-page words + dedicated 3x
   header-strip pass; affine drift correction via checkmark-x fit
   (`delta = p·est + q`, offset solved from Time|Mon boundary window between
   rightmost time label and leftmost checkmark); header-span override when ≥3
   strip day words resolve; **positional header recovery** when the strip's
   day names are unreadable garbage (see §3).
4. §3 Time rows — time tokens left of Mon boundary (letter-led words
   rejected), adaptive line clustering, wrapped-label merge
   (`mergeWrappedLineFragments`, both sides single-time, gap ≤ 1.9×medianH),
   `repairRowTimeSequence` (priority candidates original→clip-restore→flip,
   direct-vs-swapped scoring), neighbor fill for unlabeled bands.
5. Row bands from CHECKMARK y-clusters; labels assigned nearest-center.
6. Cell extraction, two strategies, best score wins (`scoreReading`):
   - geometric: whole-column-width crops (PSM 6, PSM 7 retry), glyph scrub,
     hyphen-wrap stitch, junk-token strip;
   - word-path: assign already-captured whole-page words to cells by position
     (no re-OCR; robust when fonts sit close to cell borders).

Debug flag: `CRS_OCR_DEBUG=1` prints centers/bounds/bands/scores per stage.

Wiring: `parseScheduleImage()` runs the PRIMARY reader first (untouched);
on throw OR zero cells it retries with this reader; only a double failure
raises the original error.

---

## 3. OPEN — sample 7 (top priority tomorrow)

Symptom: every class lands in the wrong day column (text itself is nearly
correct once columns are right — word-path proves it).

Root-cause chain:

1. Its day-header row renders in small light-on-dark type that OCR cannot
   decipher: strip returns `Cm we we we | mf sw] sn]` — garbage TEXT but at
   PERFECT x positions for Time..Sun (x ≈ 91, 325, 527, 686, 792, 1013, 1322, 1445).
2. Fuzzy matching rejects them all → `headerSpans < 3` → span override never
   fires → columns fall back to even-spacing interpolation → bounds shifted
   ~130px right of truth → every crop/check lands one column left.
3. Positional header recovery was implemented to accept an 8-token band by
   ORDER alone. Two anchor attempts failed:
   - `firstTimeTop` (first `\d\d[AP]` token, y=72): too LOW — grid-row class
     text starts higher, so band contained 14 tokens (leaked "CS 20 THAB" ×2).
   - `min(firstTimeTop, minCheckTop − 1)`: yielded **inBand=0** ⇒
     `minCheckTop` is ABOVE the header tokens' center (~40). That is
     unexpected and is the exact point where work stopped.

Tomorrow, first action: dump `minCheckTop` and the 3 topmost checkmark boxes
for sample 7 (`console.log(checkmarks.slice().sort(by y0).slice(0,3))`).
Suspicions: (a) a stray green blob near the top survived exclusion, or (b) a
coordinate-space mixup (strip words are already divided by STRIP_SCALE; checks
are native coords — both should be original pixels, verify).

Once the band contains exactly those 8 garbage tokens, positional mapping
fires → `headerSpans` fills → span override rebuilds true bounds → BOTH
strategies should jump sharply (word-path text is already near-perfect).

Then re-check `repairRowTimeSequence` on its repaired labels (its 9:00 label
line went missing from `labeledRows` in earlier debug — wrap-merge gap may
need one more nudge for this variant).

---

## 4. Other residuals (after sample 7)

- Sample 5: synthesize a trailing band when labeled rows exist below the last
  check cluster (bottom-row marks appear clipped in the screenshot itself).
- Sample 8: extend `stripLeadingJunkTokens` to drop ≤2-char leading tokens
  when followed by a `LETTERS+digit` subject pattern ("RE CS 20 THAB").
- Sample 6: garbage cell passes the digit gate — consider requiring a
  letter-led subject token, not just any digit.
- Browser E2E regression: upload samples 1–3 through `/schedule/upload` to
  confirm the primary→fallback chain didn't disturb previously-working paths
  (logic unchanged; typecheck-only verification so far).
- Harness scripts currently live in %TEMP% — persist into `scripts/`
  (`verify-fallback-ocr.ts`, `verify-fallback-helpers.ts`) with relative
  imports; ground truth for the five images is embedded in the harness.
- `eng.traineddata` (5 MB, downloaded by tesseract during local runs) is now
  gitignored; delete the file if you want the space back.
- `canvas` package installed locally with `--no-save` for the Node harness
  (it was already declared in package.json but missing from node_modules).

## 5. Commands

```
npm run typecheck                                  # clean as of handoff
npx tsx scripts/verify-crs-matching.ts             # matcher harness (all PASS)
CRS_OCR_DEBUG=1 npx tsx <ocr-harness> [images...]  # fallback reader vs ground truth
```

(The OCR harness + helper unit tests need to be copied out of %TEMP% into
`scripts/` — contents described in §4; the temp copies still exist this
session but temp is volatile.)

## 6. Commit state

Everything is committed EXCEPT `lib/client-ocr/fallbackParse.ts`
(today's entire iteration: ~1019 lines vs the committed 462-line first cut)
and the `.gitignore` addition. Suggested commit:
`fix: alternate OCR reader — column drift correction, positional headers, dual-strategy cell extraction`.
