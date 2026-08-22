// Fallback OCR reader ("alternate reader").
//
// The primary reader (parseSchedule.ts + layout.ts) assumes a well-formed
// CRS screenshot: day headers inside the top 15% of the image, one time
// range per horizontal strip of the Time column, and class text that fits
// on a single line next to its checkmark. The alternate samples under
// docs/other break each of those assumptions:
//
//   - sampleschedule4.jpg / 8.png: an extra "Show classes" toolbar pushes
//     the day-header row below the 15% window, time labels wrap onto two
//     lines ("07:30AM to" / "08:30AM"), and CLASS NAMES wrap too
//     ("Math 23⏎WFR-HR-4"), which the primary reader's tight
//     checkmark-anchored crop (+20px, single-line mode) truncates.
//   - sampleschedule5.png: the image is cropped through the left edge, so
//     leading characters of time labels are missing.
//   - sampleschedule7.png: much smaller fonts and tighter rows than the
//     fixed pixel tolerances in layout.ts assume.
//
// This reader takes a structurally different approach: ONE sparse-text
// OCR pass over the whole upscaled image, then the grid is reconstructed
// geometrically from word positions —
//
//   1. Day columns come from fuzzy-matched header words anywhere in the
//      top quarter of the image (Levenshtein ≤ 1, so clipped/partial
//      headers still match); missing columns are interpolated from the
//      median spacing between the ones that were found. If nothing is
//      found the columns are split evenly as a last resort — this module
//      never throws for layout reasons.
//   2. Time rows come from every time-shaped token left of the Mon
//      boundary, clustered into lines adaptively (tolerance derived from
//      the median word height, not fixed pixels) and then MERGED when two
//      adjacent lines each hold exactly one time — that is the wrapped
//      "07:30AM to" / "08:30AM" case.
//   3. Checkmark detection is shared with the primary reader (the green
//      circles look the same in every variant).
//   4. Each checkmark maps to a (day column × row band) CELL, and the
//      whole cell rectangle is OCR'd in multi-line mode — wrapped class
//      names survive intact. Hyphenated line wraps ("ARTS 1 THV-⏎6")
//      are stitched back together before cleanup.
//
// Output shape mirrors the primary reader's intermediate entries so
// parseSchedule.ts can post-process both paths identically.

import { cropAndUpscale } from './canvas';
import { cleanCourseText } from './textCleanup';
import { findCheckmarks, type BoundingBox } from './checkmarks';
import { getTotalUnitsRegion } from './regions';

/** One parsed class cell — same shape the primary reader pushes into its
 *  `entries` array before canonicalization/merging. */
export interface OcrCell {
  day: string;
  rowIdx: number;
  start: string;
  end: string;
  course_raw: string;
}

interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TimeToken {
  /** Normalized "H:MMAM/PM" — exactly the shape timeToMinutes() parses. */
  time: string;
  xCenter: number;
  top: number;
  bottom: number;
}

export interface WordLine {
  tokens: TimeToken[];
  top: number;
  bottom: number;
}

interface RowBand {
  rowIdx: number;
  start: string;
  end: string;
  top: number;
  bottom: number;
}

// Column 0 is the Time column; 1..7 map onto DAY_NAMES below.
const COLUMN_KEYS = ['time', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Matches "07:30AM", "8.05pm", "7:30 AM"… Hour validated 1-12 and minutes
// 0-59 afterwards, so clipped fragments like ":30AM" (no hour) or year-like
// numbers are rejected rather than guessed.
const TIME_TOKEN_RE = /(\d{1,2})\s*[:.]?\s*(\d{2})\s*([AP])\.?\s*M?/gi;

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

export function lettersOnly(text: string): string {
  return text.replace(/[^a-zA-Z]/g, '').toLowerCase();
}

/** Column index (0 = Time, 1..7 = Mon..Sun) for a header-ish word, or -1.
 *  Fuzzy so clipped headers ("ime" for "Time") and OCR noise still land. */
export function fuzzyColumnIndex(word: string): number {
  const normalized = lettersOnly(word);
  if (normalized.length < 3 || normalized.length > 7) return -1;
  let bestIdx = -1;
  let bestDist = 2;
  for (let i = 0; i < COLUMN_KEYS.length; i++) {
    const dist = levenshtein(normalized, COLUMN_KEYS[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestDist <= 1 ? bestIdx : -1;
}

export function extractTimes(text: string): string[] {
  const out: string[] = [];
  TIME_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TIME_TOKEN_RE.exec(text)) !== null) {
    const h = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    const ap = match[3].toUpperCase();
    if (h < 1 || h > 12 || mins > 59) continue;
    out.push(`${h}:${String(mins).padStart(2, '0')}${ap}M`);
  }
  return out;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Stitches hyphenated line wraps back together: Tesseract returns
 *  "ARTS 1 THV-\n6" for a cell whose section wrapped mid-token, and the
 *  intended value is "ARTS 1 THV-6" (same for "WFR-\nHR-4"). Plain wraps
 *  without a trailing hyphen ("PE 2 FLB\nMEG") become spaces via
 *  cleanCourseText afterwards, which is correct. */
export function unwrapWrappedLines(text: string): string {
  // NOTE: '$1-' keeps the hyphen — it belongs to the value itself
  // ("THV-6", "WFR-HR-4"); consuming it produced "THV6".
  return text.replace(/\r/g, '').replace(/(\w)-\s*\n\s*(?=\w)/g, '$1-');
}

/**
 * Strips stray glyph tokens OCR invents for the green checkmark circle once
 * whole-cell crops include it ("J ENG 13 WFW-4", "2 LS 20 THAB"): leading
 * pure-punctuation tokens and leading SINGLE-character tokens go away,
 * while real multi-character subjects ("PE", "CS") are untouched. Capped at
 * three strips so a genuinely noisy cell keeps most of its text.
 */
export function stripLeadingJunkTokens(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  let stripped = 0;
  while (
    tokens.length > 1 &&
    stripped < 3 &&
    (/^[^A-Za-z0-9]+$/.test(tokens[0]) || tokens[0].length === 1)
  ) {
    tokens.shift();
    stripped++;
  }
  return tokens.join(' ');
}

/** Intersection-over-union of two boxes (0 = disjoint, 1 = identical). */
export function iou(a: BoundingBox, b: BoundingBox): number {
  const ix0 = Math.max(a.x0, b.x0);
  const iy0 = Math.max(a.y0, b.y0);
  const ix1 = Math.min(a.x1, b.x1);
  const iy1 = Math.min(a.y1, b.y1);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter === 0) return 0;
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  return inter / (areaA + areaB - inter);
}

function minutesOfLabel(label: string): number | null {
  const m = label.match(/^(\d{1,2}):(\d{2})(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  if (h < 1 || h > 12 || mins > 59) return null;
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + mins;
}

/**
 * Repairs row time labels whose digits were clipped out of the image —
 * left-cropped screenshots turn "11:00AM" into "1:00AM", "01:00PM" into
 * "1:00AM"-style fragments. Rows are strictly ordered top to bottom and
 * never overlap, so each label is re-parsed into CANDIDATE values: the
 * parsed value itself, the AM/PM flip, and the leading-'1'-restored hour
 * (the most common clip artifact for single-digit readings). Walking rows
 * top to bottom, the start picks its smallest candidate at-or-after the
 * previous row's end, then the end picks its smallest candidate greater
 * than that start within a generous duration cap.
 *
 * Rows whose labels cannot be reconciled are kept AS-IS (never dropped):
 * the band still anchors every column's cells for that slot; only the
 * times stay odd. Pure — input not mutated.
 */
export function repairRowTimeSequence<T extends { times: string[] }>(rows: T[]): T[] {
  const DUR_CAP_MINUTES = 480;
  // Candidate readings in PRIORITY order: the original OCR value wins
  // whenever it fits the row sequence, then the leading-'1' restoration for
  // clipped single-digit hours, and the AM/PM flip LAST — flipping a label
  // that was actually correct is far more damaging than leaving a fragment.
  const candidatesOf = (label: string): Array<{ label: string; min: number }> => {
    const out: Array<{ label: string; min: number }> = [];
    const push = (candidate: string) => {
      const min = minutesOfLabel(candidate);
      if (min !== null && !out.some((o) => o.min === min)) out.push({ label: candidate, min });
    };
    push(label);
    const oneDigit = label.match(/^(\d)(:\d{2})(AM|PM)$/i);
    if (oneDigit) push(`1${oneDigit[1]}${oneDigit[2]}${oneDigit[3].toUpperCase()}`);
    push(label.replace(/(AM|PM)$/i, (ap) => (ap.toUpperCase() === 'AM' ? 'PM' : 'AM')));
    return out;
  };

  // First candidate pair (in priority order) that keeps the sequence
  // monotonic: start at-or-after the previous row's end, end strictly after
  // the start, within a generous duration cap.
  const tryPairs = (
    sCands: Array<{ label: string; min: number }>,
    eCands: Array<{ label: string; min: number }>
  ): Array<{ s: string; e: string; rank: number; gap: number }> => {
    const out: Array<{ s: string; e: string; rank: number; gap: number }> = [];
    for (let si = 0; si < sCands.length; si++) {
      const s = sCands[si];
      if (s.min < prevEndRef.value) continue;
      for (let ei = 0; ei < eCands.length; ei++) {
        const e = eCands[ei];
        if (e.min > s.min && e.min - s.min <= DUR_CAP_MINUTES) {
          out.push({ s: s.label, e: e.label, rank: si + ei, gap: e.min - s.min });
        }
      }
    }
    return out;
  };

  const prevEndRef = { value: Number.NEGATIVE_INFINITY };
  const result: T[] = [];
  for (const row of rows) {
    const sLabel = row.times[0];
    const eLabel = row.times[row.times.length - 1];
    // Evaluate the direct reading and the role-swapped reading, then take
    // the better one: lowest combined candidate rank first (prefers
    // untouched readings on both sides), then the smallest duration. The
    // swap path rescues inverted reads ("11:00AM to 10:00AM" for
    // "10:00AM to 11:00AM") and wrong-order wrapped merges.
    const direct = tryPairs(candidatesOf(sLabel), candidatesOf(eLabel));
    const swapped = tryPairs(candidatesOf(eLabel), candidatesOf(sLabel));
    const pickBest = (list: ReturnType<typeof tryPairs>) =>
      list.sort((a, b) => a.rank - b.rank || a.gap - b.gap)[0] ?? null;
    const dBest = pickBest(direct);
    const sBest = pickBest(swapped);
    const winner = (() => {
      if (dBest && sBest) {
        if (dBest.rank !== sBest.rank) return dBest.rank < sBest.rank ? dBest : sBest;
        return dBest.gap <= sBest.gap ? dBest : sBest;
      }
      return dBest ?? sBest;
    })();
    const times = winner
      ? [winner.s, ...row.times.slice(1, -1), winner.e]
      : [...row.times];
    const endMin = minutesOfLabel(times[times.length - 1]);
    prevEndRef.value = Math.max(prevEndRef.value, endMin ?? Number.NEGATIVE_INFINITY);
    result.push({ ...row, times });
  }
  return result;
}

/**
 * Merges wrapped row labels: two vertically-adjacent lines that EACH hold
 * exactly one time are one label split across lines ("07:30AM to" above
 * "08:30AM") and are combined into a single line holding both times.
 *
 * BOTH sides must be single-time fragments. A complete line already holds
 * both times and never merges — that's what keeps genuinely tight rows
 * apart — and a one-sided rule would let a genuinely clipped fragment
 * (screenshots cropped through the left edge lose one label digit) absorb
 * an unrelated neighbouring row instead of simply being dropped.
 *
 * Pure: returns new line objects; the input is not mutated.
 */
export function mergeWrappedLineFragments(
  lines: WordLine[],
  medianHeight: number
): WordLine[] {
  const merged: WordLine[] = lines.map((l) => ({
    tokens: [...l.tokens],
    top: l.top,
    bottom: l.bottom,
  }));

  const timeCount = (line: WordLine) =>
    line.tokens.reduce((sum, t) => sum + extractTimes(t.time).length, 0);

  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    for (let i = 0; i < merged.length - 1; i++) {
      const upper = merged[i];
      const lower = merged[i + 1];
      const gap = lower.top - upper.bottom;
      if (
        timeCount(upper) === 1 &&
        timeCount(lower) === 1 &&
        gap <= medianHeight * 1.9
      ) {
        upper.tokens.push(...lower.tokens);
        upper.tokens.sort((a, b) => a.xCenter - b.xCenter);
        upper.bottom = Math.max(upper.bottom, lower.bottom);
        merged.splice(i + 1, 1);
        didMerge = true;
      }
    }
  }
  return merged;
}

export async function readScheduleWithFallback(
  img: HTMLImageElement,
  imageData: ImageData,
  worker: any,
  onProgress?: (message: string) => void
): Promise<OcrCell[]> {
  const W = img.width;
  const H = img.height;

  // ---- 1. Full-page sparse OCR ------------------------------------------
  // White fill first (transparent PNGs would otherwise invert), then a 2x
  // upscale so small-font variants survive the pass.
  const SCALE = 2;
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = Math.ceil(W * SCALE);
  pageCanvas.height = Math.ceil(H * SCALE);
  const pctx = pageCanvas.getContext('2d')!;
  pctx.fillStyle = '#FFFFFF';
  pctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(img, 0, 0, pageCanvas.width, pageCanvas.height);

  onProgress?.('Alternate reader: scanning the whole image…');
  const pageResult = await worker.recognize(pageCanvas, undefined, {
    tessedit_pageseg_mode: '11',
  } as any);
  const rawWords: any[] = (pageResult.data as any)?.words || [];
  const words: OcrWord[] = [];
  for (const w of rawWords) {
    const text = String(w.text ?? '').trim();
    if (!text || !w.bbox) continue;
    words.push({
      text,
      x0: w.bbox.x0 / SCALE,
      y0: w.bbox.y0 / SCALE,
      x1: w.bbox.x1 / SCALE,
      y1: w.bbox.y1 / SCALE,
    });
  }
  if (words.length === 0) return [];

  const medianH = Math.max(median(words.map((w) => w.y1 - w.y0)), 8);

  // ---- 1.5 Checkmarks -----------------------------------------------------
  // Same detector as the primary reader — the green circles are consistent
  // across every schedule variant seen so far. Some renders draw the circle
  // with glow/anti-aliasing that splits ONE mark into several blobs, which
  // would produce duplicate phantom cells, so overlapping boxes are merged.
  // Computed EARLY because both row bands (y-clusters) AND day-column bounds
  // (x-distribution) are anchored on it.
  const rawChecks = findCheckmarks(imageData, [getTotalUnitsRegion(W)]);
  if (rawChecks.length === 0) return [];
  const areaDesc = [...rawChecks].sort(
    (a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0)
  );
  const checkmarks: BoundingBox[] = [];
  for (const box of areaDesc) {
    if (!checkmarks.some((kept) => iou(box, kept) > 0.35)) {
      checkmarks.push(box);
    }
  }
  if (checkmarks.length === 0) return [];

  // ---- 2. Day columns ----------------------------------------------------
  onProgress?.('Alternate reader: locating day columns…');
  const candidates: Array<{ idx: number; center: number; y0: number }> = [];
  for (const w of words) {
    if ((w.y0 + w.y1) / 2 > H * 0.25) continue; // headers live near the top
    const idx = fuzzyColumnIndex(w.text);
    if (idx >= 0) candidates.push({ idx, center: (w.x0 + w.x1) / 2, y0: w.y0 });
  }
  // Topmost match wins per column (the header row is above everything else).
  candidates.sort((a, b) => a.y0 - b.y0 || a.center - b.center);
  const knowns: Array<{ idx: number; center: number }> = [];
  for (const c of candidates) {
    if (!knowns.some((k) => k.idx === c.idx)) knowns.push({ idx: c.idx, center: c.center });
  }
  knowns.sort((a, b) => a.idx - b.idx);

  // Refinement pass: sparse whole-page OCR routinely merges or drops the
  // tiny day-header words on small-font variants, collapsing columns to an
  // even-spacing guess whose cell crops land in the WRONG days. A dedicated
  // high-resolution pass over just the header strip produces far better
  // word boxes; where it disagrees with the full-page matches, it wins.
  // High-confidence day-word spans from the dedicated header strip. When at
  // least three resolve, they become the AUTHORITATIVE column geometry —
  // interpolated estimates can be a full column off on compact variants.
  const headerSpans: Array<{ idx: number; center: number; x0: number; x1: number }> = [];
  try {
    const stripH = Math.max(40, Math.round(H * 0.22));
    const STRIP_SCALE = 3;
    const stripCanvas = document.createElement('canvas');
    stripCanvas.width = Math.ceil(W * STRIP_SCALE);
    stripCanvas.height = Math.ceil(stripH * STRIP_SCALE);
    const sctx = stripCanvas.getContext('2d')!;
    sctx.fillStyle = '#FFFFFF';
    sctx.fillRect(0, 0, stripCanvas.width, stripCanvas.height);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, W, stripH, 0, 0, stripCanvas.width, stripCanvas.height);
    const stripResult = await worker.recognize(stripCanvas, undefined, {
      tessedit_pageseg_mode: '6',
    } as any);
    const stripWords: any[] = (stripResult.data as any)?.words || [];
    if (process.env.CRS_OCR_DEBUG) {
      console.log(
        '[fallback][debug] strip words:',
        JSON.stringify(
          stripWords.map((w) => ({
            t: String(w.text ?? ''),
            x: Math.round(((w.bbox?.x0 ?? 0) + (w.bbox?.x1 ?? 0)) / 2 / STRIP_SCALE),
          }))
        )
      );
    }
    const stripCandidates: Array<{
      idx: number;
      center: number;
      y0: number;
      x0: number;
      x1: number;
    }> = [];
    for (const sw of stripWords) {
      const text = String(sw.text ?? '').trim();
      if (!text || !sw.bbox) continue;
      const idx = fuzzyColumnIndex(text);
      if (idx < 0) continue;
      stripCandidates.push({
        idx,
        center: (sw.bbox.x0 + sw.bbox.x1) / 2 / STRIP_SCALE,
        y0: sw.bbox.y0 / STRIP_SCALE,
        x0: sw.bbox.x0 / STRIP_SCALE,
        x1: sw.bbox.x1 / STRIP_SCALE,
      });
    }
    stripCandidates.sort((a, b) => a.y0 - b.y0 || a.center - b.center);
    const stripKnowns: Array<{ idx: number; center: number }> = [];
    for (const c of stripCandidates) {
      if (!stripKnowns.some((k) => k.idx === c.idx)) {
        stripKnowns.push({ idx: c.idx, center: c.center });
      }
    }
    stripKnowns.sort((a, b) => a.idx - b.idx);
    // ---- Positional header recovery --------------------------------------
    // Some variants render the day-name row in small light-on-dark type the
    // reader cannot decipher ("Cm we we we | mf sw] sn]") yet still emit
    // EIGHT tokens in one tight row at perfectly ordered column positions.
    // When fuzzy matching came up short, such a row maps onto Time..Sun by
    // ORDER alone. Toolbar rows are rejected by keyword fingerprint, and
    // coverage/spacing sanity gates keep stray grid rows out.
    if (stripKnowns.length < 3) {
      const boxedWords: Array<{
        text: string;
        x0: number;
        x1: number;
        y0: number;
        y1: number;
      }> = [];
      let maxToolbarBottom = 0;
      let firstTimeTop = Number.POSITIVE_INFINITY;
      for (const sw of stripWords) {
        const text = String(sw.text ?? '').trim();
        if (!text || !sw.bbox || !/[A-Za-z0-9|]/.test(text)) continue;
        boxedWords.push({
          text,
          x0: sw.bbox.x0 / STRIP_SCALE,
          x1: sw.bbox.x1 / STRIP_SCALE,
          y0: sw.bbox.y0 / STRIP_SCALE,
          y1: sw.bbox.y1 / STRIP_SCALE,
        });
        // Two landmark rows bracket the day-header line regardless of how
        // OCR groups the words vertically: the toolbar above (keyworded)
        // and the first grid-row content below (time-shaped tokens).
        if (/total|units|enlisted|show|classes/i.test(text)) {
          maxToolbarBottom = Math.max(maxToolbarBottom, sw.bbox.y1 / STRIP_SCALE);
        }
        if (/\d{2}\s*[AP]/i.test(text)) {
          firstTimeTop = Math.min(firstTimeTop, sw.bbox.y0 / STRIP_SCALE);
        }
      }
      // The first grid row's CLASS TEXT can start ABOVE its time label
      // (compact renders), so the tightest reliable bottom anchor is the
      // topmost checkmark — marks always sit inside their row.
      const minCheckTop = Math.min(...checkmarks.map((k) => k.y0));
      const bandBottom = Math.min(firstTimeTop, minCheckTop - 1);
      const bandWords = boxedWords.filter((w) => {
        const cy = (w.y0 + w.y1) / 2;
        return cy > maxToolbarBottom && cy < bandBottom;
      });
      if (process.env.CRS_OCR_DEBUG) {
        console.log(
          `[fallback][debug] header band: toolbarBottom=${maxToolbarBottom.toFixed(1)} firstTimeTop=${
            Number.isFinite(firstTimeTop) ? firstTimeTop.toFixed(1) : 'inf'
          } inBand=${bandWords.length}:`,
          bandWords.map((w) => w.text).join(' ')
        );
      }
      if (bandWords.length === COLUMN_KEYS.length) {
        bandWords.sort((a, b) => a.x0 - b.x0);
        const strictlyIncreasing =
          bandWords.every((w, i) => i === 0 || w.x0 > bandWords[i - 1].x0);
        const rowCenters = bandWords.map((w) => (w.x0 + w.x1) / 2);
        const gaps = rowCenters.slice(1).map((c, i) => c - rowCenters[i]);
        const minGap = Math.min(...gaps);
        const coverage = bandWords[bandWords.length - 1].x1 - bandWords[0].x0;
        const fingerprint = bandWords.map((w) => w.text.toLowerCase()).join(' ');
        if (
          strictlyIncreasing &&
          coverage >= W * 0.5 &&
          minGap > 8 &&
          Math.max(...gaps) <= Math.max(24, minGap) * 3.2 &&
          !/total|units|enlisted|show|classes/.test(fingerprint)
        ) {
          stripKnowns.length = 0;
          for (let i = 0; i < bandWords.length; i++) {
            stripKnowns.push({ idx: i, center: rowCenters[i] });
            if (!headerSpans.some((s) => s.idx === i)) {
              headerSpans.push({
                idx: i,
                center: rowCenters[i],
                x0: bandWords[i].x0,
                x1: bandWords[i].x1,
              });
            }
          }
          stripKnowns.sort((a, b) => a.idx - b.idx);
        }
      }
    }
    // Topmost match wins per column for the authoritative spans as well.
    for (const c of stripCandidates) {
      if (!headerSpans.some((s) => s.idx === c.idx)) {
        headerSpans.push({ idx: c.idx, center: c.center, x0: c.x0, x1: c.x1 });
      }
    }
    if (stripKnowns.length > knowns.length && stripKnowns.length >= 2) {
      knowns.length = 0;
      knowns.push(...stripKnowns);
    } else if (stripKnowns.length > 0) {
      // Merge: the strip's box wins per-column where it matched.
      for (const sk of stripKnowns) {
        const at = knowns.findIndex((k) => k.idx === sk.idx);
        if (at >= 0) knowns[at] = sk;
        else knowns.push(sk);
      }
      knowns.sort((a, b) => a.idx - b.idx);
    }
  } catch {
    // Header-strip refinement is best-effort; full-page matches remain.
  }

  const centers: number[] = new Array(COLUMN_KEYS.length).fill(NaN);
  knowns.forEach((k) => {
    centers[k.idx] = k.center;
  });

  if (knowns.length >= 2) {
    const slopes: number[] = [];
    for (let i = 1; i < knowns.length; i++) {
      slopes.push((knowns[i].center - knowns[i - 1].center) / (knowns[i].idx - knowns[i - 1].idx));
    }
    let step = median(slopes);
    if (!Number.isFinite(step) || step <= 1) step = W / 8;
    for (let i = 0; i < centers.length; i++) {
      if (!Number.isNaN(centers[i])) continue;
      let anchorIdx = -1;
      let anchorDist = Number.POSITIVE_INFINITY;
      for (let j = 0; j < centers.length; j++) {
        if (Number.isNaN(centers[j])) continue;
        const d = Math.abs(j - i);
        if (d < anchorDist) {
          anchorDist = d;
          anchorIdx = j;
        }
      }
      centers[i] = centers[anchorIdx] + step * (i - anchorIdx);
    }
  } else if (knowns.length === 1) {
    for (let i = 0; i < centers.length; i++) {
      centers[i] = knowns[0].center + (W / 8) * (i - knowns[0].idx);
    }
  } else {
    // Last resort: Time column gets the leftmost sixth, days split evenly.
    for (let i = 0; i < centers.length; i++) {
      centers[i] = W * 0.16 + ((W * 0.84) / 7) * i;
    }
  }

  // ---- 2b. Drift-corrected centers via checkmark marks --------------------
  // Each mark sits at a fixed position inside its cell, so (observed mark x
  // − estimated column center) = constantOffset + drift, where drift is the
  // text-estimate's error. Drift varies smoothly across columns while the
  // offset stays constant, so fitting delta = p·est + q over mapped marks
  // recovers exactly the drift SHAPE. The constant offset is then solved
  // from the layout constraint that the day columns must span the grid
  // between the Time column's right edge and the image's right edge.
  // Correction runs ONLY when the fit is meaningful (meaningful slope with
  // tiny residuals — a genuinely drifted estimate) AND the header strip did
  // not already provide trustworthy absolute geometry. A flat fit means the
  // estimates were already right and must not be touched.
  if (headerSpans.length < 3) {
    const mapped: Array<{ est: number; delta: number }> = [];
    const checkWidths = median(checkmarks.map((k) => k.x1 - k.x0));
    const gapX = Math.max(checkWidths * 2.2, 26);
    const sortedCxs = checkmarks.map((k) => (k.x0 + k.x1) / 2).sort((a, b) => a - b);
    const xClusters: Array<{ sum: number; count: number }> = [];
    for (const cx of sortedCxs) {
      const last = xClusters[xClusters.length - 1];
      const ref = last ? last.sum / last.count : Number.NaN;
      if (!last || Math.abs(cx - ref) > gapX) xClusters.push({ sum: cx, count: 1 });
      else {
        last.sum += cx;
        last.count += 1;
      }
    }
    for (const cluster of xClusters) {
      const mean = cluster.sum / cluster.count;
      let bestIdx = -1;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 1; i < centers.length; i++) {
        if (Number.isNaN(centers[i])) continue;
        const d = Math.abs(mean - centers[i]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestDist <= W * 0.16) {
        mapped.push({ est: centers[bestIdx], delta: mean - centers[bestIdx] });
      }
    }

    let applied = false;
    if (mapped.length >= 3) {
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (const m of mapped) {
        sx += m.est;
        sy += m.delta;
        sxx += m.est * m.est;
        sxy += m.est * m.delta;
      }
      const denom = mapped.length * sxx - sx * sx;
      if (Math.abs(denom) > 1e-6) {
        const p = (mapped.length * sxy - sx * sy) / denom;
        const q = (sy - p * sx) / mapped.length;
        let maxResid = 0;
        for (const m of mapped) {
          maxResid = Math.max(maxResid, Math.abs(m.delta - (p * m.est + q)));
        }
        if (
          Number.isFinite(p) &&
          Math.abs(p) <= 0.25 &&
          maxResid <= Math.max(10, W * 0.015)
        ) {
          // shaped_i recovers the smoothed MARK positions; true centers are
          // shaped_i + K for one constant K (mark-to-center distance). K is
          // solved by anchoring the Time|Mon boundary: it must sit between
          // the rightmost time-label pixel and the leftmost checkmark — two
          // hard, layout-independent constraints.
          const shaped = centers.map((c) => (Number.isNaN(c) ? c : c + p * c + q));
          const minCheckCx = Math.min(...checkmarks.map((k) => (k.x0 + k.x1) / 2));
          const timeWords = words.filter(
            (w) => extractTimes(w.text).length > 0 && (w.x0 + w.x1) / 2 < minCheckCx
          );
          if (timeWords.length >= 2) {
            const tMaxRight = Math.max(...timeWords.map((w) => w.x1));
            const cTime =
              timeWords.reduce((s, w) => s + (w.x0 + w.x1) / 2, 0) / timeWords.length;
            const bLow = tMaxRight + 6;
            const bHigh = minCheckCx - 4;
            if (bLow <= bHigh) {
              const boundary = (bLow + bHigh) / 2;
              // boundary = (cTime + shaped_Mon + K) / 2
              const offset = 2 * boundary - cTime - shaped[1];
              for (let i = 1; i < centers.length; i++) {
                if (!Number.isNaN(shaped[i])) centers[i] = shaped[i] + offset;
              }
              applied = true;
            }
          }
        }
      }
    }
    if (process.env.CRS_OCR_DEBUG) {
      console.log(
        `[fallback][debug] drift correction ${applied ? 'APPLIED' : 'skipped'}; centers:`,
        centers.map((c) => Math.round(c)).join(',')
      );
    }
  }

  for (let i = 0; i < centers.length; i++) {
    centers[i] = Math.min(W - 1, Math.max(0, centers[i]));
    if (i > 0 && centers[i] <= centers[i - 1]) centers[i] = centers[i - 1] + 1;
  }
  // Final clamp: the monotonic bump above can push trailing columns past
  // the right edge when several degenerate centers pile up near W-1; pull
  // every center back inside the image afterwards. A resulting tie is fine
  // — degenerate columns simply produce empty cells that get skipped.
  for (let i = 0; i < centers.length; i++) {
    centers[i] = Math.min(W - 1, Math.max(0, centers[i]));
  }

  const bounds: number[] = [0];
  for (let i = 0; i < centers.length - 1; i++) {
    bounds.push((centers[i] + centers[i + 1]) / 2);
  }
  bounds.push(W);

  // ---- 2c. Header-span bounds override ------------------------------------
  // At least three resolved day words give trustworthy ABSOLUTE column
  // geometry; rebuild centers/bounds from their spans so compact variants
  // whose interpolated estimates were a full column off recover.
  if (headerSpans.length >= 3) {
    const orderedSpans = [...headerSpans].sort((a, b) => a.idx - b.idx);
    for (const s of orderedSpans) {
      centers[s.idx] = s.center;
    }
    for (let i = 0; i < centers.length; i++) {
      centers[i] = Math.min(W - 1, Math.max(0, centers[i]));
      if (i > 0 && centers[i] <= centers[i - 1]) {
        centers[i] = centers[i - 1] + 1;
      }
    }
    const rebuilt: number[] = [0];
    for (let i = 0; i < centers.length - 1; i++) {
      rebuilt.push((centers[i] + centers[i + 1]) / 2);
    }
    rebuilt.push(W);
    for (let i = 0; i < bounds.length; i++) bounds[i] = rebuilt[i];
    if (process.env.CRS_OCR_DEBUG) {
      console.log(
        '[fallback][debug] header-span bounds:',
        bounds.map((c) => Math.round(c)).join(',')
      );
    }
  }

  // ---- 3. Time rows ------------------------------------------------------
  // Every time-shaped token left of the Mon boundary becomes a row marker.
  // Lines are clustered with a tolerance derived from the median word
  // height instead of fixed pixels, so tiny-font and large-font variants
  // cluster the same way. Wrapped two-line labels are re-joined afterwards.
  const monLeft = bounds[1];
  const tokens: TimeToken[] = [];
  for (const w of words) {
    const centerX = (w.x0 + w.x1) / 2;
    if (centerX >= monLeft) continue;
    // Class-name words start with letters; time labels always start with
    // digits (wrapped second lines included), so letter-led words can never
    // be row markers — filtering them keeps stray column bleed from
    // inventing phantom times.
    if (/^[A-Za-z]/.test(w.text)) continue;
    const times = extractTimes(w.text);
    for (const time of times) {
      tokens.push({ time, xCenter: centerX, top: w.y0, bottom: w.y1 });
    }
  }
  if (tokens.length === 0) return [];

  tokens.sort((a, b) => a.top - b.top || a.xCenter - b.xCenter);
  const sameLineGap = medianH * 0.6;
  const lines: WordLine[] = [];
  for (const token of tokens) {
    const line = lines[lines.length - 1];
    if (!line || token.top > line.bottom + sameLineGap) {
      lines.push({ tokens: [token], top: token.top, bottom: token.bottom });
    } else {
      line.tokens.push(token);
      line.bottom = Math.max(line.bottom, token.bottom);
      line.top = Math.min(line.top, token.top);
    }
  }
  for (const line of lines) {
    line.tokens.sort((a, b) => a.xCenter - b.xCenter);
  }

  // Merge wrapped labels ("07:30AM to" / "08:30AM") — exact rule and
  // safety conditions documented on the exported helper.
  const mergedLines = mergeWrappedLineFragments(lines, medianH);

  // Time labels provide row TIMES only — NOT band geometry. Their vertical
  // positions drift relative to the class rows across variants (wrapped
  // two-line labels start higher than the row boundary; left-cropped
  // screenshots lose whole label lines, merging two rows into one band).
  const labeledRows = mergedLines
    .map((l) => ({
      times: l.tokens.map((t) => t.time),
      top: l.top,
      bottom: l.bottom,
      center: (l.top + l.bottom) / 2,
    }))
    .filter((l) => l.times.length >= 2)
    .sort((a, b) => a.top - b.top);

  // ---- 4. Checkmarks: already computed in section 1.5 --------------------

  // ---- 4.5 Row bands from checkmark clusters ------------------------------
  // The checkmarks themselves are the reliable row anchor: each sits inside
  // its own grid row in every render seen, marks of one row land within a
  // few pixels of each other, and adjacent rows are separated by far more
  // than the mark's height. Clustering their vertical centers therefore
  // yields exactly the occupied rows; band boundaries are the midpoints
  // between neighboring clusters.
  const checkH = median(checkmarks.map((k) => k.y1 - k.y0));
  const clusterGap = Math.max(medianH * 1.8, checkH * 1.6, 22);
  const sortedCys = checkmarks.map((k) => (k.y0 + k.y1) / 2).sort((a, b) => a - b);
  const clusters: Array<{ top: number; bottom: number }> = [];
  for (const cy of sortedCys) {
    const last = clusters[clusters.length - 1];
    if (!last || cy - last.bottom > clusterGap) {
      clusters.push({ top: cy, bottom: cy });
    } else {
      last.top = Math.min(last.top, cy);
      last.bottom = Math.max(last.bottom, cy);
    }
  }

  const layoutBands: RowBand[] = [];
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const prev = clusters[i - 1];
    const next = clusters[i + 1];
    layoutBands.push({
      rowIdx: i,
      start: '',
      end: '',
      top: Math.max(0, prev ? (prev.bottom + cluster.top) / 2 : cluster.top - checkH),
      bottom: Math.min(H, next ? (cluster.bottom + next.top) / 2 : H),
    });
  }
  if (layoutBands.length === 0) return [];

  // ---- 4.6 Assign time labels to bands, then repair the sequence ----------
  // Each complete label line joins whichever band its center falls nearest
  // to. Bands without any label keep empty times rather than inventing them.
  for (const row of labeledRows) {
    let best: RowBand | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const band of layoutBands) {
      const d = Math.abs(row.center - (band.top + band.bottom) / 2);
      if (d < bestDist) {
        bestDist = d;
        best = band;
      }
    }
    if (!best) continue;
    if (!best.start) {
      best.start = row.times[0];
      best.end = row.times[row.times.length - 1];
      (best as any)._labelDist = bestDist;
    } else if (bestDist < (best as any)._labelDist) {
      // a second label line maps into this band — keep the nearer one
      best.start = row.times[0];
      best.end = row.times[row.times.length - 1];
      (best as any)._labelDist = bestDist;
    }
  }

  // Repair clipped hour digits ("11:00AM" read as "1:00AM" on left-cropped
  // screenshots) across the band sequence — see the exported helper.
  const labeled = layoutBands.filter((b) => b.start && b.end);
  const repaired = repairRowTimeSequence(labeled.map((b) => ({ times: [b.start, b.end] })));
  repaired.forEach((r, i) => {
    labeled[i].start = r.times[0];
    labeled[i].end = r.times[r.times.length - 1];
  });

  // Fill still-unlabeled bands from their labeled neighbours: a band that
  // sits between two labeled rows spans exactly the slot between them
  // (missed label lines happen when screenshots clip the left edge).
  const fillUnlabeledBandTimes = () => {
    for (let i = 0; i < layoutBands.length; i++) {
      const band = layoutBands[i];
      if (band.start && band.end) continue;
      let prevEnd: string | null = null;
      for (let p = i - 1; p >= 0; p--) {
        if (layoutBands[p].end) {
          prevEnd = layoutBands[p].end;
          break;
        }
      }
      let nextStart: string | null = null;
      for (let n = i + 1; n < layoutBands.length; n++) {
        if (layoutBands[n].start) {
          nextStart = layoutBands[n].start;
          break;
        }
      }
      if (prevEnd && nextStart) {
        band.start = prevEnd;
        band.end = nextStart;
      }
    }
  };
  fillUnlabeledBandTimes();

  if (process.env.CRS_OCR_DEBUG) {
    console.log(
      '[fallback][debug] day centers:',
      centers.map((c) => Math.round(c)).join(','),
      '| bounds:',
      bounds.map((c) => Math.round(c)).join(',')
    );
    console.log(
      '[fallback][debug] labeledRows:',
      JSON.stringify(labeledRows.map((r) => ({ t: r.times, top: Math.round(r.top) })))
    );
    console.log(
      '[fallback][debug] bands:',
      JSON.stringify(layoutBands.map((b) => ({
        rowIdx: b.rowIdx,
        s: b.start,
        e: b.end,
        top: Math.round(b.top),
        bot: Math.round(b.bottom),
      })))
    );
  }

  // ---- 5. Cell extraction ------------------------------------------------
  // Each checkmark lands in exactly one (day column × row band) cell; the
  // WHOLE cell rectangle is OCR'd once in multi-line mode and cached, so
  // wrapped class names survive regardless of where the checkmark sits.
  onProgress?.('Alternate reader: reading class names…');
  const cellCache = new Map<string, string>();
  const cells: OcrCell[] = [];

  for (const box of checkmarks) {
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;

    let col = -1;
    for (let i = 1; i < bounds.length - 1; i++) {
      if (cx >= bounds[i] && cx < bounds[i + 1]) {
        col = i;
        break;
      }
    }
    if (col === -1) continue; // checkmark inside/near the Time column

    let band: RowBand | null = null;
    let bandDist = Number.POSITIVE_INFINITY;
    for (const candidate of layoutBands) {
      const d = Math.abs(cy - (candidate.top + candidate.bottom) / 2);
      if (d < bandDist) {
        bandDist = d;
        band = candidate;
      }
    }
    if (!band) continue;

    const cacheKey = `${col}|${band.rowIdx}`;
    let text = cellCache.get(cacheKey);
    if (text === undefined) {
      // Crop the WHOLE column-width cell rather than just right of the
      // checkmark: wrapped class names put continuation lines UNDER the
      // checkmark, and checkmark widths vary across renders — anchoring on
      // the column edges captures every variant. The circle glyph may OCR
      // as a junk prefix ("©CS 20 …"), which cleanCourseText strips; the
      // digit plausibility filter below catches anything worse.
      const xA = bounds[col] + 3;
      const xB = bounds[col + 1] - 2;
      const yA = Math.max(0, band.top);
      const yB = Math.min(H, Math.max(band.bottom, yA + 14));

      if (xB - xA < 12 || yB - yA < 10) {
        text = '';
      } else {
        const cellCanvas = cropAndUpscale(img, xA, yA, xB - xA, yB - yA, 2);
        const result = await worker.recognize(cellCanvas, undefined, {
          tessedit_pageseg_mode: '6',
        } as any);
        // Scrub checkmark-glyph artifacts ("©", "@") wherever they land,
        // then unwrap hyphenated line wraps and tidy whitespace.
        text = cleanCourseText(
          unwrapWrappedLines(String(result.data.text ?? '').replace(/[©@]/g, ' '))
        );
        text = stripLeadingJunkTokens(text);
        // Second chance: sparse strips sometimes return nothing usable in
        // block mode; a single-line pass rescues those cells.
        if (!/\d/.test(text)) {
          const retry = await worker.recognize(cellCanvas, undefined, {
            tessedit_pageseg_mode: '7',
          } as any);
          const retryText = cleanCourseText(
            unwrapWrappedLines(String(retry.data.text ?? '').replace(/[©@]/g, ' '))
          );
          if (/\d/.test(retryText)) {
            text = stripLeadingJunkTokens(retryText);
          }
        }
      }
      cellCache.set(cacheKey, text);
    }
    if (!text) continue;
    // Plausibility gate: every real course cell contains at least one digit
    // ("Math 23", "Eng 13"). Empty-area noise and header bleed-through
    // reliably don't.
    if (!/\d/.test(text)) continue;

    const day = DAY_NAMES[col - 1];
    if (cells.some((c) => c.day === day && c.rowIdx === band!.rowIdx)) continue;
    cells.push({
      day,
      rowIdx: band.rowIdx,
      start: band.start,
      end: band.end,
      course_raw: text,
    });
  }

  // ---- 5b. Word-path assembly (alternate strategy) ------------------------
  // Cropped-cell OCR is fragile exactly where the geometric approach is
  // weakest: tiny fonts sit close to cell borders, so a few pixels of drift
  // clip characters ("CS 20 THA", "WFR-HR-4" without its head). This
  // strategy never crops again — it assigns the ALREADY-CAPTURED whole-page
  // words to (day × band) cells by position and joins them per reading
  // order. Both strategies run; the stronger result wins below.
  const lineH = Math.max(medianH, 12);
  const usableWords = words.filter(
    (w) =>
      (w.y0 + w.y1) / 2 > H * 0.2 && // header zone out
      (w.x0 + w.x1) / 2 >= bounds[1] - 60 && // time column out
      /[A-Za-z0-9]/.test(w.text)
  );
  const wordCells: OcrCell[] = [];
  for (const box of checkmarks) {
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;

    let col = -1;
    for (let i = 1; i < bounds.length - 1; i++) {
      if (cx >= bounds[i] && cx < bounds[i + 1]) {
        col = i;
        break;
      }
    }
    if (col === -1) continue;

    let band: RowBand | null = null;
    let bandDist = Number.POSITIVE_INFINITY;
    for (const candidate of layoutBands) {
      const d = Math.abs(cy - (candidate.top + candidate.bottom) / 2);
      if (d < bandDist) {
        bandDist = d;
        band = candidate;
      }
    }
    if (!band) continue;

    const candidates = usableWords.filter(
      (w) =>
        (w.x0 + w.x1) / 2 >= bounds[col] - 8 &&
        (w.x0 + w.x1) / 2 < bounds[col + 1] + 6 &&
        w.x0 >= box.x0 - 8 &&
        (w.y0 + w.y1) / 2 >= band.top - 2 &&
        (w.y0 + w.y1) / 2 <= band.bottom + 2
    );
    if (candidates.length === 0) continue;

    candidates.sort(
      (a, b) => Math.round(a.y0 / lineH) - Math.round(b.y0 / lineH) || a.x0 - b.x0
    );
    const text = stripLeadingJunkTokens(
      cleanCourseText(unwrapWrappedLines(candidates.map((w) => w.text).join(' ')))
    );
    if (!text || !/\d/.test(text)) continue;

    const day = DAY_NAMES[col - 1];
    if (wordCells.some((c) => c.day === day && c.rowIdx === band!.rowIdx)) continue;
    wordCells.push({
      day,
      rowIdx: band.rowIdx,
      start: band.start,
      end: band.end,
      course_raw: text,
    });
  }

  // ---- 5c. Pick the stronger reading --------------------------------------
  // Plausible cells (letter-led subject + a digit, complete times) score
  // positively; implausible or incomplete ones and per-cell duplicates cost.
  const scoreReading = (list: OcrCell[]): number => {
    let s = 0;
    const seen = new Set<string>();
    for (const c of list) {
      const key = `${c.day}|${c.rowIdx}`;
      if (seen.has(key)) s -= 1;
      seen.add(key);
      if (!/\d/.test(c.course_raw)) s -= 0.5;
      else if (/^[A-Za-z][A-Za-z ./]*\s*\d/.test(c.course_raw.trim())) s += 1;
      else s -= 0.25;
      if (!c.start || !c.end) s -= 0.75;
    }
    return s;
  };
  const geoScore = scoreReading(cells);
  const wordScore = scoreReading(wordCells);
  if (process.env.CRS_OCR_DEBUG) {
    console.log(
      `[fallback][debug] reading scores: geometric=${geoScore.toFixed(2)} (${cells.length}), word-path=${wordScore.toFixed(2)} (${wordCells.length})`
    );
  }
  return wordScore > geoScore ? wordCells : cells;
}
