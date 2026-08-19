export interface DayColumn {
  name: string;
  left: number;
  right: number;
}

export interface TimeRow {
  start: string;
  end: string;
  y: number;
}

interface Word {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const TIME_RE = /(\d{1,2}:\d{2}\s*[AP]M)/gi;

export async function detectLayout(
  img: HTMLImageElement,
  worker: any
): Promise<{ columns: DayColumn[]; rows: TimeRow[] }> {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  // 1. Header OCR (top 15%)
  const headerH = Math.max(50, Math.floor(img.height * 0.15));
  const headerCanvas = document.createElement('canvas');
  headerCanvas.width = img.width;
  headerCanvas.height = headerH;
  const hCtx = headerCanvas.getContext('2d')!;
  hCtx.drawImage(canvas, 0, 0, img.width, headerH, 0, 0, img.width, headerH);

  const headerResult = await worker.recognize(headerCanvas, undefined, { tessedit_pageseg_mode: '6' } as any);
  const headerWords: Word[] = (headerResult.data.words || []).map((w: any) => ({
    text: w.text.trim(),
    x: w.bbox.x0,
    y: w.bbox.y0,
    w: w.bbox.x1 - w.bbox.x0,
    h: w.bbox.y1 - w.bbox.y0,
  }));

  const dayNames = ['Time', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const centers: Record<string, number> = {};
  for (const name of dayNames) {
    const matches = headerWords.filter((w: Word) => w.text.replace(/[^a-zA-Z]/g, '').toLowerCase() === name.toLowerCase());
    if (matches.length > 0) {
      const w = matches[0];
      centers[name] = w.x + w.w / 2;
    }
  }

  const known = dayNames.map((name, idx) => centers[name] ? { idx, center: centers[name] } : null).filter(Boolean) as { idx: number, center: number }[];
  known.sort((a, b) => a.idx - b.idx);

  if (known.length >= 2) {
    const first = known[0];
    const last = known[known.length - 1];
    const step = (last.center - first.center) / (last.idx - first.idx);
    for (let i = 0; i < dayNames.length; i++) {
      if (!centers[dayNames[i]]) {
        centers[dayNames[i]] = first.center + step * (i - first.idx);
      }
    }
  } else {
    throw new Error("Couldn't read day-column headers. Ensure the full schedule grid is visible.");
  }

  const orderedCenters = dayNames.map(name => centers[name]);
  const bounds: number[] = [0];
  for (let i = 0; i < orderedCenters.length - 1; i++) {
    bounds.push((orderedCenters[i] + orderedCenters[i + 1]) / 2);
  }
  bounds.push(img.width);

  const columns: DayColumn[] = dayNames.map((name, i) => ({
    name,
    left: bounds[i],
    right: bounds[i + 1]
  }));

  // 2. Time column OCR (left 20%)
  const timeColRight = columns[1].left;
  const timeCanvas = document.createElement('canvas');
  timeCanvas.width = Math.ceil(timeColRight);
  timeCanvas.height = img.height;
  const tCtx = timeCanvas.getContext('2d')!;
  tCtx.drawImage(canvas, 0, 0, timeColRight, img.height, 0, 0, timeColRight, img.height);

  const timeResult = await worker.recognize(timeCanvas, undefined, { tessedit_pageseg_mode: '6' } as any);
  const timeWords: Word[] = (timeResult.data.words || []).map((w: any) => ({
    text: w.text.trim(),
    x: w.bbox.x0,
    y: w.bbox.y0,
    w: w.bbox.x1 - w.bbox.x0,
    h: w.bbox.y1 - w.bbox.y0,
  }));

  timeWords.sort((a: Word, b: Word) => a.y - b.y);
  const lines: Word[][] = [];
  for (const w of timeWords) {
    let placed = false;
    for (const line of lines) {
      if (Math.abs(line[0].y - w.y) < 15) {
        line.push(w);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([w]);
  }

  const rows: TimeRow[] = [];
  for (const line of lines) {
    const text = line.map((w: Word) => w.text).join(' ');
    const times = text.match(TIME_RE);
    
    // Explicitly check times is not null and has at least 2 elements
    if (times && times.length >= 2) {
      const y = Math.min(...line.map((w: Word) => w.y));
      rows.push({
        start: times[0]!.toUpperCase().replace(/\s/g, ''),
        end: times[1]!.toUpperCase().replace(/\s/g, ''),
        y
      });
    }
  }
  rows.sort((a, b) => a.y - b.y);

  if (rows.length === 0) {
    throw new Error("Couldn't read time-slot rows. Ensure the left 'Time' column is visible.");
  }

  return { columns, rows };
}