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