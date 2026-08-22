import { createWorker } from 'tesseract.js';
import { loadImage, getImageData, cropAndUpscale } from './canvas';
import { findCheckmarks } from './checkmarks';
import { detectLayout } from './layout';
import { getTotalUnitsRegion } from './regions';
import { cleanCourseText, splitCourse, timeToMinutes, canonicalizeCourseVariants } from './textCleanup';
import { ScheduleEntry, ParsedScheduleResult } from './types';

export type ProgressCallback = (message: string) => void;

export async function parseScheduleImage(
  file: File,
  onProgress?: ProgressCallback
): Promise<ParsedScheduleResult> {
  onProgress?.("Loading image...");
  const img = await loadImage(file);
  const imageData = getImageData(img);

  onProgress?.("Initializing OCR engine...");
  const worker = await createWorker('eng', 1, {
    logger: () => {} // Suppress noisy default logger
  });

  try {
    onProgress?.("Reading schedule layout...");
    const { columns, rows } = await detectLayout(img, worker);

    onProgress?.("Detecting classes (checkmarks)...");
    // Exclude the top-right "Total Units" header region — it's rendered in
    // the same green as checkmark glyphs and would otherwise be picked up
    // as a false checkmark (see regions.ts).
    const totalUnitsRegion = getTotalUnitsRegion(img.width);
    const checkmarks = findCheckmarks(imageData, [totalUnitsRegion]);

    if (checkmarks.length === 0) {
      throw new Error("No green checkmarks detected. Ensure the schedule grid is visible and not cropped.");
    }

    onProgress?.("Reading class details...");
    
    const cells: { day: string; rowIdx: number; start: string; end: string; canvas: HTMLCanvasElement }[] = [];
    // Defense in depth (on top of the geometric exclusion above): flag any
    // checkmark landing in a day column that's implausible for a typical
    // schedule, so a future false positive doesn't silently corrupt output.
    const SUSPECT_DAYS = new Set(['Sun']);
    for (const box of checkmarks) {
      const cx = (box.x0 + box.x1) / 2;
      const col = columns.slice(1).find(c => cx >= c.left && cx < c.right);
      if (!col) continue;

      if (SUSPECT_DAYS.has(col.name)) {
        console.warn(
          `[parseSchedule] Checkmark detected in suspect day column "${col.name}" at ` +
          `(${box.x0},${box.y0})-(${box.x1},${box.y1}). This is uncommon for a typical ` +
          `schedule — verify this isn't a false positive (e.g. leaking from a header region).`
        );
      }

      const rowIdx = rows.reduce((bestIdx, r, idx) => {
        return Math.abs(r.y - box.y0) < Math.abs(rows[bestIdx].y - box.y0) ? idx : bestIdx;
      }, 0);
      const row = rows[rowIdx];

      const cropLeft = box.x1 + 2;
      const cropRight = Math.max(cropLeft + 10, col.right - 2);
      const cropTop = Math.max(0, box.y0 - 6);
      const cropBottom = box.y1 + 20;
      const cropWidth = cropRight - cropLeft;
      const cropHeight = cropBottom - cropTop;

      if (cropWidth <= 0 || cropHeight <= 0) continue;

      const cellCanvas = cropAndUpscale(img, cropLeft, cropTop, cropWidth, cropHeight, 2);
      cells.push({ day: col.name, rowIdx, start: row.start, end: row.end, canvas: cellCanvas });
    }

    const entries: any[] = [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      onProgress?.(`Reading class details... (${i + 1}/${cells.length})`);
      
      // Cast options to 'any' to allow valid Tesseract config keys not in strict TS definitions
      const result = await worker.recognize(cell.canvas, undefined, { tessedit_pageseg_mode: '7' } as any);
      const rawText = result.data.text;
      const text = cleanCourseText(rawText);
      if (!text) continue;

      entries.push({
        day: cell.day,
        rowIdx: cell.rowIdx,
        start: cell.start,
        end: cell.end,
        course_raw: text,
      });
    }

    onProgress?.("Finishing...");
    // Unify clipped reads of the same class ("Physics 72 WFV-HV-4" vs
    // "…WFV-HV-" vs "…WFV-H" — cells clip at the column edge) into one
    // canonical course_raw BEFORE merging/grouping, so one class can't
    // split into two groups downstream. See textCleanup.ts's
    // canonicalizeCourseVariants() for the unification rules and the
    // time-overlap guard that keeps genuinely distinct classes apart.
    const unifiedEntries = canonicalizeCourseVariants(entries);
    unifiedEntries.sort((a, b) => {
      if (a.day !== b.day) return a.day.localeCompare(b.day);
      return a.rowIdx - b.rowIdx;
    });

    const merged: any[] = [];
    for (const e of unifiedEntries) {
      if (merged.length > 0) {
        const last = merged[merged.length - 1];
        if (last.day === e.day && last.course_raw === e.course_raw && e.rowIdx === last._lastRowIdx + 1) {
          last.end = e.end;
          last._lastRowIdx = e.rowIdx;
          continue;
        }
      }
      merged.push({ ...e, _lastRowIdx: e.rowIdx });
    }

    const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const resultEntries: ScheduleEntry[] = merged.map(m => {
      const { subject, number, section } = splitCourse(m.course_raw);
      return {
        day: m.day,
        start: m.start,
        end: m.end,
        start_minutes: timeToMinutes(m.start),
        end_minutes: timeToMinutes(m.end),
        course: m.course_raw,
        subject,
        number,
        section
      };
    });

    resultEntries.sort((a, b) => {
      const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
      if (dayDiff !== 0) return dayDiff;
      return a.start_minutes - b.start_minutes;
    });

    let total_units: number | null = null;
    try {
      const topRightCanvas = document.createElement('canvas');
      topRightCanvas.width = totalUnitsRegion.x1 - totalUnitsRegion.x0;
      topRightCanvas.height = totalUnitsRegion.y1 - totalUnitsRegion.y0;
      const trCtx = topRightCanvas.getContext('2d')!;
      trCtx.drawImage(
        img,
        totalUnitsRegion.x0, totalUnitsRegion.y0,
        totalUnitsRegion.x1 - totalUnitsRegion.x0, totalUnitsRegion.y1 - totalUnitsRegion.y0,
        0, 0, topRightCanvas.width, topRightCanvas.height
      );
      
      const trResult = await worker.recognize(topRightCanvas, undefined, { tessedit_pageseg_mode: '8' } as any);
      const trText = trResult.data.text.trim();
      const unitsMatch = trText.match(/(\d+\.?\d*)/);
      if (unitsMatch && unitsMatch[1]) {
        total_units = parseFloat(unitsMatch[1]);
      }
    } catch {
      // Ignore total units parsing failure, it's optional
    }

    return {
      total_units,
      schedule: resultEntries
    };
  } finally {
    await worker.terminate();
  }
}