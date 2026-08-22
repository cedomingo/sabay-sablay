/** One OCR'd schedule cell, shaped like parseScheduleImage's intermediate
 *  `entries` rows — the input canonicalizeCourseVariants() unifies. */
export interface CourseTextCell {
  day: string;
  start: string;
  end: string;
  course_raw: string;
}

export interface ScheduleEntry {
  day: string;
  start: string;
  end: string;
  start_minutes: number;
  end_minutes: number;
  course: string;
  subject: string;
  number: string;
  section: string;
}

export interface ParsedScheduleResult {
  total_units: number | null;
  schedule: ScheduleEntry[];
}
