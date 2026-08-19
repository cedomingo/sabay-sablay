#!/usr/bin/env python3
"""
Parse a class-schedule screenshot (of the fixed "Time | Mon..Sun" grid style,
with green checkmark bullets marking each occupied cell) into JSON.

Usage:
    python3 parse_schedule.py input.png [output.json]

Design notes (why it works this way):
- The schedule image always has the same layout: a dark header row with
  "Time", day names Mon..Sun, and a "Total Units" figure; then a grid of
  fixed-height rows, one per time slot, with green checkmark icons marking
  which day/time cells contain a class. Courses that run for the same period
  across two adjacent grid rows are duplicated with a checkmark in each row.
- Instead of relying purely on OCR text positions (which is fragile because
  the green checkmark glyph gets fused into the OCR'd word, e.g. "OCS" or
  "0Eng" instead of "CS"/"Eng"), we FIND the checkmark icons directly via
  color-based blob detection. Each checkmark unambiguously marks one
  (day-column, time-row) cell. We then OCR only the clean text region to the
  right of each checkmark, so the course text never contains icon artifacts.
- Row time-ranges and day-column names are read dynamically via OCR of the
  header row and the left-hand "Time" column, so the script isn't hardcoded
  to this particular schedule's hours/days -- it adapts to any schedule that
  follows the same visual template.
- Finally, consecutive rows in the same day column with identical course
  text are merged into a single entry spanning the full time range.
"""

import sys
import json
import re
import numpy as np
from PIL import Image
from scipy import ndimage
import pytesseract


def find_checkmarks(arr):
    """Locate green checkmark icon blobs. Returns list of (x0,y0,x1,y1)."""
    r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
    mask = (g > 150) & (g - r > 30) & (g - b > 30)
    mask = ndimage.binary_dilation(mask, iterations=3)
    labeled, n = ndimage.label(mask)
    boxes = []
    for sl in ndimage.find_objects(labeled):
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        if (x1 - x0) >= 6 and (y1 - y0) >= 6:
            boxes.append((x0, y0, x1, y1))
    boxes.sort(key=lambda b: (b[1], b[0]))
    return boxes


TIME_RE = re.compile(r'(\d{1,2}:\d{2}\s*[AP]M)', re.IGNORECASE)


def get_ocr_words(im):
    data = pytesseract.image_to_data(im, output_type=pytesseract.Output.DICT)
    words = []
    for i in range(len(data['text'])):
        t = data['text'][i].strip()
        if t:
            words.append({
                'text': t,
                'x': data['left'][i], 'y': data['top'][i],
                'w': data['width'][i], 'h': data['height'][i],
            })
    return words


def find_day_columns(words, img_w):
    """Locate header row day names (Time, Mon..Sun) and build column boundaries."""
    day_names = ['Time', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    header_words = [w for w in words if w['y'] < 50]
    centers = {}
    for name in day_names:
        matches = [w for w in header_words if w['text'].strip('.,:').lower() == name.lower()]
        if matches:
            w = matches[0]
            centers[name] = w['x'] + w['w'] / 2
    # Fill in any missing day using expected uniform spacing, based on the
    # ones we did find.
    known = [(day_names.index(k), v) for k, v in centers.items()]
    known.sort()
    if len(known) >= 2:
        (i0, c0), (i1, c1) = known[0], known[-1]
        step = (c1 - c0) / (i1 - i0)
        for idx, name in enumerate(day_names):
            if name not in centers:
                centers[name] = c0 + step * (idx - i0)
    # boundaries = midpoints between consecutive centers
    ordered_centers = [centers[n] for n in day_names]
    bounds = [0.0]
    for i in range(len(ordered_centers) - 1):
        bounds.append((ordered_centers[i] + ordered_centers[i + 1]) / 2)
    bounds.append(float(img_w))
    # columns[i] = (name, left, right) for i in 0..7 (0 = Time column)
    columns = []
    for i, name in enumerate(day_names):
        columns.append({'name': name, 'left': bounds[i], 'right': bounds[i + 1]})
    return columns


def find_time_rows(words, columns):
    """Read the left 'Time' column to get each row's (start,end,y)."""
    time_col = columns[0]
    left_words = [w for w in words if time_col['left'] <= w['x'] < time_col['right']]
    # group by proximity in y (line-ish clustering)
    left_words.sort(key=lambda w: w['y'])
    lines = []
    for w in left_words:
        placed = False
        for line in lines:
            if abs(line[0]['y'] - w['y']) < 15:
                line.append(w)
                placed = True
                break
        if not placed:
            lines.append([w])
    rows = []
    for line in lines:
        text = ' '.join(w['text'] for w in sorted(line, key=lambda w: w['x']))
        times = TIME_RE.findall(text)
        if len(times) >= 2:
            y = min(w['y'] for w in line)
            start = times[0].upper().replace(' ', '')
            end = times[1].upper().replace(' ', '')
            rows.append({'start': start, 'end': end, 'y': y})
    rows.sort(key=lambda r: r['y'])
    return rows


def find_total_units(words, img_w):
    cand = [w for w in words if w['y'] < 30 and w['x'] > img_w * 0.8]
    for w in cand:
        try:
            return float(w['text'])
        except ValueError:
            continue
    return None


def clean_course_text(text):
    text = text.strip()
    text = re.sub(r'^[^A-Za-z0-9]+', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def split_course(text):
    m = re.match(r'^([A-Za-z]+)\s*([0-9]+[A-Za-z]?)\s*(.*)$', text)
    if m:
        subject, number, section = m.groups()
        return subject, number, section.strip()
    return text, '', ''


def parse_schedule(image_path):
    # Keep the image in its original mode for OCR: flattening RGBA -> RGB
    # composites onto black and breaks recognition of the white-on-dark-brown
    # header row text. Use a separate RGB array only for color-based
    # checkmark detection, where alpha doesn't matter.
    im = Image.open(image_path)
    arr = np.array(im.convert('RGB'))
    img_w = im.width

    words = get_ocr_words(im)
    columns = find_day_columns(words, img_w)
    rows = find_time_rows(words, columns)
    total_units = find_total_units(words, img_w)

    checkmarks = find_checkmarks(arr)

    entries = []
    for (x0, y0, x1, y1) in checkmarks:
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2

        col = None
        for c in columns[1:]:  # skip Time column
            if c['left'] <= cx < c['right']:
                col = c
                break
        if col is None:
            continue

        row_idx = min(range(len(rows)), key=lambda i: abs(rows[i]['y'] - y0))
        row = rows[row_idx]

        crop_left = x1 + 2
        crop_right = int(col['right']) - 2
        crop_top = max(0, y0 - 6)
        crop_bottom = y1 + 20  # allow for two-line wrapped text within the cell
        if crop_right <= crop_left:
            continue
        cell_im = im.crop((crop_left, crop_top, crop_right, crop_bottom))
        cell_im = cell_im.resize((cell_im.width * 3, cell_im.height * 3), Image.LANCZOS)
        text = pytesseract.image_to_string(cell_im, config='--psm 7').strip()
        text = clean_course_text(text)
        if not text:
            continue

        entries.append({
            'day': col['name'],
            'row_idx': row_idx,
            'start': row['start'],
            'end': row['end'],
            'course_raw': text,
        })

    # Merge consecutive rows (same day, same course text, adjacent row_idx)
    entries.sort(key=lambda e: (e['day'], e['row_idx']))
    merged = []
    for e in entries:
        if merged and merged[-1]['day'] == e['day'] and merged[-1]['course_raw'] == e['course_raw'] \
                and e['row_idx'] == merged[-1]['_last_row_idx'] + 1:
            merged[-1]['end'] = e['end']
            merged[-1]['_last_row_idx'] = e['row_idx']
        else:
            m = dict(e)
            m['_last_row_idx'] = e['row_idx']
            merged.append(m)

    def time_to_minutes(t):
        m = re.match(r'(\d{1,2}):(\d{2})(AM|PM)', t.upper())
        if not m:
            return 0
        h, mnt, ap = int(m.group(1)), int(m.group(2)), m.group(3)
        if ap == 'AM':
            h = 0 if h == 12 else h
        else:
            h = 12 if h == 12 else h + 12
        return h * 60 + mnt

    result_entries = []
    for m in merged:
        subject, number, section = split_course(m['course_raw'])
        result_entries.append({
            'day': m['day'],
            'start': m['start'],
            'end': m['end'],
            'start_minutes': time_to_minutes(m['start']),
            'end_minutes': time_to_minutes(m['end']),
            'course': m['course_raw'],
            'subject': subject,
            'number': number,
            'section': section,
        })

    day_order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    result_entries.sort(key=lambda e: (day_order.index(e['day']), time_to_minutes(e['start'])))

    return {
        'total_units': total_units,
        'schedule': result_entries,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 parse_schedule.py <image_path> [output.json]")
        sys.exit(1)
    image_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else None

    result = parse_schedule(image_path)
    out_json = json.dumps(result, indent=2)

    if out_path:
        with open(out_path, 'w') as f:
            f.write(out_json)
        print(f"Wrote {out_path}")
    else:
        print(out_json)


if __name__ == '__main__':
    main()