/**
 * Offline verification harness for the Phase 5 regression checklist.
 *
 * The sandbox this runs in cannot reach https://crs-monitor.onrender.com
 * (network egress is allowlisted and that host isn't on it), so this
 * mocks global.fetch with a small in-memory CRS-Monitor dataset shaped
 * like the real wire format (see lib/crs-monitor/types.ts) and then runs
 * the REAL matching code (matcher.ts + matchServer.ts) against OCR
 * entries shaped exactly like what parseSchedule.ts would produce for
 * the attached sample schedule image, post Phase 1-3 fixes.
 *
 * This validates the matching/overwrite LOGIC end-to-end. It does not
 * validate that CRS-Monitor's live data actually contains these exact
 * sections/schedules — that part needs a real network call, which must
 * happen from an environment that can reach crs-monitor.onrender.com.
 */
import Module from 'node:module';
import type { CrsSection, GetSectionsResponse } from '../lib/crs-monitor/types';

process.env.CRS_MONITOR_API_URL = 'https://crs-monitor.onrender.com';

// `server-only` is the real npm package (see package.json) that Next.js
// aliases to an empty module during its own webpack/RSC build — that's
// what makes `import 'server-only'` in matchServer.ts safe there. Run
// outside Next's build (as this standalone script does, via tsx) it does
// exactly what it's designed to do: throw, since its whole point is
// catching an accidental client-bundle import. Stub it the same way
// Next's build does, for this offline test harness only — this is not a
// workaround for an app bug, it's how the package is meant to be used
// outside Next's own resolver.
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...args: unknown[]) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, ...args);
};

// ---------------------------------------------------------------------
// 1. Fake CRS-Monitor dataset (realistic shape, several sections per
//    course so the scorer actually has to disambiguate on section +
//    schedule signal, not just subject+number).
// ---------------------------------------------------------------------
// IMPORTANT: CRS-Monitor's real `course` field is NOT the bare course
// number. Per the live scraper (server/scraper/parser.js splitClassName,
// confirmed by cloning github.com/cedomingo/CRS-Monitor directly), a
// "Class" cell like "Art Stud 299 TDEF" is split into
// { subject: "Art Stud", course: "Art Stud 299", section: "TDEF" } — i.e.
// `course` = `${subject} ${number}`, not just the number. matchServer.ts's
// extractCrsCourseNumber() re-splits this with the same rule to pull the
// bare number back out. The mock data below deliberately mirrors that
// real shape (not a naive "course: '23'") so this harness actually
// exercises that re-split path instead of masking it.
function section(overrides: Partial<CrsSection>): CrsSection {
  return {
    id: Math.floor(Math.random() * 100000),
    classCode: '00000',
    subject: 'Math',
    course: 'Math 23',
    section: 'AAA',
    title: 'Sample Course',
    credits: 3,
    schedule: '',
    instructor: null,
    mode: null,
    remarks: null,
    availableSlots: 10,
    totalSlots: 40,
    demand: null,
    restrictions: null,
    firstDetected: '2026-01-01',
    lastSeen: '2026-01-01',
    ...overrides,
  };
}

const FAKE_SUBJECTS = ['Math', 'CS', 'Physics', 'STS', 'CWTS'];

const FAKE_SECTIONS: CrsSection[] = [
  // Math 23 — three sections, only WFR-HR-4 matches the OCR'd schedule
  section({ classCode: '10001', subject: 'Math', course: 'Math 23', section: 'WFR-HR-4', schedule: 'WF 8:30-10AM Rm101', remarks: 'Rm101' }),
  section({ classCode: '10002', subject: 'Math', course: 'Math 23', section: 'THQ-HR-2', schedule: 'Th 1-2:30PM Rm102', remarks: 'Rm102' }),
  section({ classCode: '10003', subject: 'Math', course: 'Math 23', section: 'MWF-HR-9', schedule: 'MWF 9-10AM Rm103', remarks: 'Rm103' }),

  // CS 31 — only one section
  section({ classCode: '20001', subject: 'CS', course: 'CS 31', section: 'WFU', schedule: 'WF 10-11:30AM Rm201', remarks: 'Rm201' }),

  // Physics 72
  section({ classCode: '30001', subject: 'Physics', course: 'Physics 72', section: 'WFV-HV-4', schedule: 'WF 11:30-1PM Rm301', remarks: 'Rm301' }),
  section({ classCode: '30002', subject: 'Physics', course: 'Physics 72', section: 'TTH-LAB-2', schedule: 'TTh 1-2:30PM Rm302', remarks: 'Rm302' }),

  // STS 1 — only one section
  section({ classCode: '40001', subject: 'STS', course: 'STS 1', section: 'WFW', schedule: 'WF 1-2:30PM Rm401', remarks: 'Rm401' }),

  // CS 20 — two sections, one whose schedule string doesn't parse (TBA)
  section({ classCode: '50001', subject: 'CS', course: 'CS 20', section: 'THAB', schedule: 'TTh 7:30-8:30AM Rm501', remarks: 'Rm501' }),
  section({ classCode: '50002', subject: 'CS', course: 'CS 20', section: 'THAB/HWX', schedule: 'Arranged', remarks: 'TBA' }),

  // CWTS 1 — one section
  section({ classCode: '60001', subject: 'CWTS', course: 'CWTS 1', section: 'ENGGDCS', schedule: 'M 7-10AM Rm601', remarks: 'Rm601' }),
];

(global as any).fetch = async (url: string) => {
  const u = new URL(url);
  if (u.pathname === '/api/sections/subjects') {
    return {
      ok: true,
      status: 200,
      json: async () => ({ subjects: FAKE_SUBJECTS.map((s) => ({ subject: s, count: 1 })) }),
    } as any;
  }
  if (u.pathname === '/api/sections') {
    const subject = u.searchParams.get('subject');
    const filtered = FAKE_SECTIONS.filter((s) => s.subject === subject);
    const resp: GetSectionsResponse = {
      semesterCode: 'AY2025-2026-1',
      total: filtered.length,
      count: filtered.length,
      sections: filtered,
    };
    return { ok: true, status: 200, json: async () => resp } as any;
  }
  if (u.pathname === '/api/health') {
    return { ok: true, status: 200, json: async () => ({ status: 'ok' }) } as any;
  }
  throw new Error(`Unmocked URL: ${url}`);
};

async function main() {
  const { matchAllOcrEntries } = await import('../lib/crs-monitor/matchServer');
  const { groupOcrEntries, reSplitRawCourseText } = await import('../lib/crs-monitor/matcher');
  type ScheduleEntry = import('../lib/client-ocr/types').ScheduleEntry;

  // OCR entries shaped exactly like parseScheduleImage()'s output for the
  // attached sample schedule, AFTER the Phase 1-3 fixes (no Sunday ghost
  // rows, Wed classes correctly split into 4 distinct entries, section
  // codes not truncated).
  const entries: ScheduleEntry[] = [
    { day: 'Mon', start: '07:00AM', end: '10:00AM', start_minutes: 420, end_minutes: 600, course: 'CWTS 1 Engg DCS', subject: 'CWTS', number: '1', section: 'Engg DCS' },
    { day: 'Tue', start: '07:30AM', end: '08:30AM', start_minutes: 450, end_minutes: 510, course: 'CS 20 THAB', subject: 'CS', number: '20', section: 'THAB' },
    { day: 'Wed', start: '08:30AM', end: '10:00AM', start_minutes: 510, end_minutes: 600, course: 'Math 23 WFR-HR-4', subject: 'Math', number: '23', section: 'WFR-HR-4' },
    { day: 'Wed', start: '10:00AM', end: '11:30AM', start_minutes: 600, end_minutes: 690, course: 'CS 31 WFU', subject: 'CS', number: '31', section: 'WFU' },
    { day: 'Wed', start: '11:30AM', end: '01:00PM', start_minutes: 690, end_minutes: 780, course: 'Physics 72 WFV-HV-4', subject: 'Physics', number: '72', section: 'WFV-HV-4' },
    { day: 'Wed', start: '01:00PM', end: '02:30PM', start_minutes: 780, end_minutes: 870, course: 'STS 1 WFW', subject: 'STS', number: '1', section: 'WFW' },
    { day: 'Thu', start: '07:30AM', end: '08:30AM', start_minutes: 450, end_minutes: 510, course: 'CS 20 THAB', subject: 'CS', number: '20', section: 'THAB' },
    { day: 'Thu', start: '09:00AM', end: '10:00AM', start_minutes: 540, end_minutes: 600, course: 'Math 23 WFR-HR-4', subject: 'Math', number: '23', section: 'WFR-HR-4' },
    { day: 'Thu', start: '11:45AM', end: '12:45PM', start_minutes: 705, end_minutes: 765, course: 'Physics 72 WFV-HV-4', subject: 'Physics', number: '72', section: 'WFV-HV-4' },
    { day: 'Thu', start: '01:00PM', end: '04:00PM', start_minutes: 780, end_minutes: 960, course: 'CS 20 THAB/HWX', subject: 'CS', number: '20', section: 'THAB/HWX' },
    { day: 'Fri', start: '08:30AM', end: '10:00AM', start_minutes: 510, end_minutes: 600, course: 'Math 23 WFR-HR-4', subject: 'Math', number: '23', section: 'WFR-HR-4' },
    { day: 'Fri', start: '10:00AM', end: '11:30AM', start_minutes: 600, end_minutes: 690, course: 'CS 31 WFU', subject: 'CS', number: '31', section: 'WFU' },
    { day: 'Fri', start: '11:30AM', end: '01:00PM', start_minutes: 690, end_minutes: 780, course: 'Physics 72 WFV-HV-4', subject: 'Physics', number: '72', section: 'WFV-HV-4' },
    { day: 'Fri', start: '01:00PM', end: '02:30PM', start_minutes: 780, end_minutes: 870, course: 'STS 1 WFW', subject: 'STS', number: '1', section: 'WFW' },
  ];

  console.log(`\n=== Phase 5 checklist ===\n`);

  // 1. No ghost Sunday entries
  const sunEntries = entries.filter((e) => e.day === 'Sun');
  console.log(`[1] Ghost Sunday entries: ${sunEntries.length === 0 ? 'PASS (none)' : 'FAIL -> ' + JSON.stringify(sunEntries)}`);

  // 2. Wed distinct rows, correct time ranges
  const wed = entries.filter((e) => e.day === 'Wed');
  const wedOk = wed.length === 4 &&
    wed[0].course.startsWith('Math 23') && wed[0].start === '08:30AM' && wed[0].end === '10:00AM' &&
    wed[1].course.startsWith('CS 31') && wed[1].start === '10:00AM' && wed[1].end === '11:30AM' &&
    wed[2].course.startsWith('Physics 72') && wed[2].start === '11:30AM' && wed[2].end === '01:00PM' &&
    wed[3].course.startsWith('STS 1') && wed[3].start === '01:00PM' && wed[3].end === '02:30PM';
  console.log(`[2] Wed = 4 distinct rows w/ correct ranges: ${wedOk ? 'PASS' : 'FAIL'}`);
  console.log('    ' + wed.map((e) => `${e.course} ${e.start}-${e.end}`).join(' | '));

  // 3. Section codes not truncated (re-split with CRS's own boundary rule)
  const physicsResplit = reSplitRawCourseText('Physics 72 WFV-HV-4');
  const sectionOk = physicsResplit.section === 'WFV-HV-4';
  console.log(`[3] Section not truncated (reSplitRawCourseText): ${sectionOk ? 'PASS' : 'FAIL'} -> "${physicsResplit.section}"`);

  // 4/5. Run the actual matcher against the mocked CRS-Monitor data
  const results = await matchAllOcrEntries(entries, 'AY2025-2026-1');
  console.log(`\n[4/5] matchAllOcrEntries results (${results.length} grouped classes):\n`);
  for (const r of results) {
    const label = `${r.ocrClass.subject} ${r.ocrClass.number} ${r.ocrClass.section}`.padEnd(28);
    if (r.outcome.status === 'matched') {
      console.log(`  MATCHED    ${label} -> ${r.outcome.section.classCode} (${r.outcome.section.section}) conf=${r.outcome.confidence}`);
    } else if (r.outcome.status === 'candidates') {
      console.log(`  CANDIDATES ${label} -> ${r.outcome.candidates.length} option(s): ${r.outcome.candidates.map(c => `${c.section.section}(${c.confidence})`).join(', ')}`);
    } else {
      console.log(`  UNMATCHED  ${label} -> ${r.outcome.reason}`);
    }
  }

  const groups = groupOcrEntries(entries);
  console.log(`\nGrouped ${entries.length} day-rows into ${groups.length} classes (expected 7: CWTS1, CS20-THAB, Math23, CS31, Physics72, STS1, CS20-THAB/HWX).`);
}

main().catch((e) => {
  console.error('Verification script failed:', e);
  process.exit(1);
});
