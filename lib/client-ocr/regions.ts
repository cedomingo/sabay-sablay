import type { BoundingBox } from './checkmarks';

/**
 * The top-right "Total Units: N.N" header region of a schedule screenshot.
 *
 * This text is rendered in the same green used for checkmark glyphs, so it
 * must be excluded from checkmark detection (see findCheckmarks) rather than
 * relying on shape/size heuristics to reject it. Both the total-units OCR
 * crop (parseSchedule.ts) and the checkmark-detection exclusion
 * (checkmarks.ts) must use this exact same region, or the exclusion can
 * silently drift out of sync with where the text actually is.
 */
export function getTotalUnitsRegion(imageWidth: number): BoundingBox {
  return {
    x0: Math.floor(imageWidth * 0.8),
    y0: 0,
    x1: imageWidth,
    y1: 50,
  };
}
