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
import { findCheckmarks } from './checkmarks';
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
        gap <= medianHeight * 1.25
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

  const pad = Math.min(14, Math.max(3, Math.round(medianH * 0.35)));
  const completeRows = mergedLines
    .map((l) => ({
      times: l.tokens.map((t) => t.time),
      top: l.top,
    }))
    .filter((l) => l.times.length >= 2)
    .sort((a, b) => a.top - b.top);

  const bands: RowBand[] = completeRows.map((row, i) => ({
    rowIdx: i,
    start: row.times[0],
    end: row.times[row.times.length - 1],
    top: row.top - pad,
    bottom: (i + 1 < completeRows.length ? completeRows[i + 1].top : H) - pad,
  }));
  if (bands.length === 0) return [];

  // ---- 4. Checkmarks -----------------------------------------------------
  // Same detector as the primary reader — the green circles are consistent
  // across every schedule variant seen so far.
  const checkmarks = findCheckmarks(imageData, [getTotalUnitsRegion(W)]);
  if (checkmarks.length === 0) return [];

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
    for (const candidate of bands) {
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
      let xA = box.x1 + 2;
      const xB = bounds[col + 1] - 2;
      if (xB - xA < 20) xA = Math.max(bounds[col] + 2, xB - 20);
      const yA = Math.max(0, band.top);
      const yB = Math.min(H, Math.max(band.bottom, yA + 14));

      if (xB - xA < 12 || yB - yA < 10) {
        text = '';
      } else {
        const cellCanvas = cropAndUpscale(img, xA, yA, xB - xA, yB - yA, 2);
        const result = await worker.recognize(cellCanvas, undefined, {
          tessedit_pageseg_mode: '6',
        } as any);
        text = cleanCourseText(unwrapWrappedLines(String(result.data.text ?? '')));
      }
      cellCache.set(cacheKey, text);
    }
    if (!text) continue;

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

  return cells;
}
