// Types 1:1 with CRS-Monitor's live wire format.
//
// Confirmed directly against CRS-Monitor's source (not the original brief's
// guessed shape, which used class_code/number/meeting_times — none of which
// exist on the real API):
//   - server/routes/sections.js  -> GET /api/sections response shape
//   - server/services/sectionService.js -> getSubjects/getCourseSuggestions
//
// Field-meaning note, because this is exactly the thing that gets silently
// "corrected" back to the wrong assumption if it isn't written down inline:
//
//   classCode  CRS's own registration code for the class as a whole
//              (e.g. "57851", occasionally "57851-THQ1"). This is NOT what
//              a student's schedule screenshot shows.
//   section    The short letter fragment (e.g. "WFV") split out of the
//              "Class" cell alongside subject/course. THIS is what OCR's
//              section fragment must be matched against — never classCode.
//
// There is no `scheduleBlocks` in the wire response — only CRS-Monitor's own
// DB has that. The wire response only has free-text `schedule`
// (e.g. "TTh 1-2:30PM lec Rm101"); a client that wants structured day/time
// has to parse it itself (see matcher.ts's parseScheduleText).

export interface CrsSection {
  id: number | string;
  classCode: string;
  subject: string;
  course: string;
  section: string;
  title: string;
  credits: number | null;
  schedule: string;
  instructor: string | null;
  mode: string | null;
  remarks: string | null;
  availableSlots: number | null;
  totalSlots: number | null;
  demand: number | null;
  restrictions: string | null;
  firstDetected: string | null;
  lastSeen: string | null;
}

export interface GetSectionsResponse {
  semesterCode: string;
  total: number;
  count: number;
  sections: CrsSection[];
}

export interface GetSectionsParams {
  semester?: string;
  search?: string;
  subjects?: string[];
  courses?: string[];
  ge?: boolean;
  days?: string[];
  startTime?: string; // "HH:MM", 24h
  endTime?: string;
  limit?: number; // server clamps to 2000 max
  offset?: number;
}

// GET /api/sections/subjects -> { subjects: [{ subject, count }] }
// NOT a bare string array — confirmed against sectionService.getSubjects().
export interface CrsSubject {
  subject: string;
  count: number;
}

// GET /api/sections/courses?search= -> { courses: [{ course, count }] }
// Autocomplete only; empty search returns [] server-side.
export interface CrsCourseSuggestion {
  course: string;
  count: number;
}

export interface CrsHealth {
  status: string;
  time: string;
}
