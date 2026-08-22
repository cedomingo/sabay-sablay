/**
 * Offline verification harness for the Phase 5 regression checklist.
 *
 * The sandbox this runs in cannot reach a real Turso/libSQL database (network
 * egress is allowlisted and Turso's hosts aren't on it), so this stubs out
 * @libsql/client's createClient()/execute() with a small in-memory
 * CRS-Monitor dataset shaped like the real `sections`/`semesters` tables
 * (see lib/crs-monitor/types.ts) and then runs the REAL matching code
 * (matcher.ts + matchServer.ts + turso.ts) against OCR entries shaped
 * exactly like what parseSchedule.ts would produce for the attached sample
 * schedule image, post Phase 1-3 fixes.
 *
 * This validates the matching/overwrite LOGIC end-to-end. It does not
 * validate that CRS-Monitor's live Turso database actually contains these
 * exact sections/schedules — that part needs a real query, which must
 * happen from an environment that can reach it with real
 * CRS_MONITOR_TURSO_URL / CRS_MONITOR_TURSO_AUTH_TOKEN credentials.
 */
import Module from 'node:module';

process.env.CRS_MONITOR_TURSO_URL = 'libsql://fake-crs-monitor.turso.io';
process.env.CRS_MONITOR_TURSO_AUTH_TOKEN = 'fake-token-for-offline-harness';

// `server-only` is the real npm package (see package.json) that Next.js
// aliases to an empty module during its own webpack/RSC build — that's
// what makes `import 'server-only'` in matchServer.ts/turso.ts safe there.
// Run outside Next's build (as this standalone script does, via tsx) it
// does exactly what it's designed to do: throw, since its whole point is
// catching an accidental client-bundle import. Stub it the same way
// Next's build does, for this offline test harness only — this is not a
// workaround for an app bug, it's how the package is meant to be used
// outside Next's own resolver.
//
// @libsql/client is stubbed alongside it for the same "run outside the
// real deployment environment" reason: this harness has no real Turso
// database to query, so createClient() is replaced with an in-memory
// stand-in whose execute() answers the exact query shapes turso.ts issues
// (see FAKE_EXECUTE below) rather than making a network call.
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...args: unknown[]) {
  if (request === 'server-only') return {};
  if (request === '@libsql/client') {
    return { createClient: () => ({ execute: FAKE_EXECUTE }) };
  }
  return originalLoad.call(this, request, ...args);
};

// ---------------------------------------------------------------------
// 1. Fake CRS-Monitor dataset (realistic shape, several sections per
//    course so the scorer actually has to disambiguate on section +
//    schedule signal, not just subject+number).
// ---------------------------------------------------------------------
// IMPORTANT: CRS-Monitor's real `course` column is NOT the bare course
// number. Per the live scraper (server/scraper/parser.js splitClassName,
// confirmed by cloning github.com/cedomingo/CRS-Monitor directly), a
// "Class" cell like "Art Stud 299 TDEF" is split into
// { subject: "Art Stud", course: "Art Stud 299", section: "TDEF" } — i.e.
// `course` = `${subject} ${number}`, not just the number. matchServer.ts's
// extractCrsCourseNumber() re-splits this with the same rule to pull the
// bare number back out. The mock data below deliberately mirrors that
// real shape (not a naive "course: '23'") so this harness actually
// exercises that re-split path instead of masking it.
interface FakeSectionRow {
  id: number;
  semester_code: string;
  class_code: string;
  subject: string;
  course: string;
  section: string;
  credits: string | null;
  schedule: string | null;
  instructor: string | null;
  mode: string | null;
  remarks: string | null;
  available_slots: number | null;
  total_slots: number | null;
  demand: string | null;
  restrictions: string | null;
  blocks_json: string | null;
  letter: string | null;
  first_detected: string;
  last_seen: string;
  title: string | null;
  schedule_blocks_json: string;
}

let nextId = 1;
const SEMESTER = 'AY2025-2026-1';

function section(overrides: Partial<FakeSectionRow>): FakeSectionRow {
  return {
    id: nextId++,
    semester_code: SEMESTER,
    class_code: '00000',
    subject: 'Math',
    course: 'Math 23',
    section: 'AAA',
    credits: '3',
    schedule: '',
    instructor: null,
    mode: null,
    remarks: null,
    available_slots: 10,
    total_slots: 40,
    demand: null,
    restrictions: null,
    blocks_json: null,
    letter: null,
    first_detected: '2026-01-01',
    last_seen: '2026-01-01',
    title: 'Sample Course',
    schedule_blocks_json: '[]',
    ...overrides,
  };
}

const FAKE_SUBJECTS = ['Math', 'CS', 'Physics', 'STS', 'CWTS', 'Eng'];

// remarks is prereq/co-req text (see types.ts) — NOT room, per the
// corrected schema. Room now lives only in `schedule`'s free text
// (see FAKE_SECTIONS below), positionally paired with schedule_blocks_json
// by extractRoomsFromSchedule()/parseCrsScheduleBlocks() in matcher.ts.
const FAKE_SECTIONS: FakeSectionRow[] = [
  // Math 23 WFR-HR-4 — deliberately a real 2-segment lec+lab section (the
  // OCR entries below have this class meeting WF at one time AND Th at a
  // DIFFERENT time, which is exactly the shape a 2-block schedule
  // produces), so the room-pairing / multi-segment path actually gets
  // exercised end-to-end through the real matcher, not just in isolation.
  // Segment 0 ("lec", room "Rm101") pairs with block 0 (W,F); segment 1
  // ("lab", room "Rm101-L") pairs with block 1 (Th).
  section({
    class_code: '10001', subject: 'Math', course: 'Math 23', section: 'WFR-HR-4',
    schedule: 'WF 8:30-10AM lec Rm101; Th 9-10AM lab Rm101-L',
    schedule_blocks_json: JSON.stringify([
      { days: ['W', 'F'], start: '08:30', end: '10:00' },
      { days: ['Th'], start: '09:00', end: '10:00' },
    ]),
  }),
  section({
    class_code: '10002', subject: 'Math', course: 'Math 23', section: 'THQ-HR-2',
    schedule: 'Th 1-2:30PM Rm102',
    schedule_blocks_json: JSON.stringify([{ days: ['Th'], start: '13:00', end: '14:30' }]),
  }),
  section({
    class_code: '10003', subject: 'Math', course: 'Math 23', section: 'MWF-HR-9',
    schedule: 'MWF 9-10AM Rm103',
    schedule_blocks_json: JSON.stringify([{ days: ['M', 'W', 'F'], start: '09:00', end: '10:00' }]),
  }),

  // CS 31 — only one section
  section({
    class_code: '20001', subject: 'CS', course: 'CS 31', section: 'WFU',
    schedule: 'WF 10-11:30AM Rm201',
    schedule_blocks_json: JSON.stringify([{ days: ['W', 'F'], start: '10:00', end: '11:30' }]),
  }),

  // Physics 72
  section({
    class_code: '30001', subject: 'Physics', course: 'Physics 72', section: 'WFV-HV-4',
    schedule: 'WF 11:30-1PM Rm301',
    schedule_blocks_json: JSON.stringify([{ days: ['W', 'F'], start: '11:30', end: '13:00' }]),
    remarks: 'Prerequisite: Physics 71',
  }),
  section({
    class_code: '30002', subject: 'Physics', course: 'Physics 72', section: 'TTH-LAB-2',
    schedule: 'TTh 1-2:30PM Rm302',
    schedule_blocks_json: JSON.stringify([{ days: ['T', 'Th'], start: '13:00', end: '14:30' }]),
    remarks: 'Prerequisite: Physics 71',
  }),

  // STS 1 — only one section
  section({
    class_code: '40001', subject: 'STS', course: 'STS 1', section: 'WFW',
    schedule: 'WF 1-2:30PM Rm401',
    schedule_blocks_json: JSON.stringify([{ days: ['W', 'F'], start: '13:00', end: '14:30' }]),
  }),

  // Eng 13 / Eng 1 — sample schedule 1 regression fixtures ("still asks
  // for Eng 13 and Eng 1 verification even though it's clearly WFW-4").
  // Real CRS data runs PARALLEL sections of one course at the SAME
  // timeslot, and short section codes substring-collide
  // ("WFW40".includes("WFW4")), so before the exact-section override both
  // WFW-4 and WFW-40 qualified at +15 schedule signal (+20 vs +10 section)
  // and the matcher punted to a manual prompt despite the screenshot
  // naming the section outright.
  section({
    class_code: '70001', subject: 'Eng', course: 'Eng 13', section: 'WFW-4',
    schedule: 'WF 1-2:30PM Rm701',
    schedule_blocks_json: JSON.stringify([{ days: ['W', 'F'], start: '13:00', end: '14:30' }]),
  }),
  section({
    class_code: '70002', subject: 'Eng', course: 'Eng 13', section: 'WFW-40',
    schedule: 'WF 1-2:30PM Rm702',
    schedule_blocks_json: JSON.stringify([{ days: ['W', 'F'], start: '13:00', end: '14:30' }]),
  }),
  // A same-course section with no textual relation to "WFW4" — never
  // qualifies (sectionSignal 0), proving the override doesn't need it gone.
  section({
    class_code: '70003', subject: 'Eng', course: 'Eng 13', section: 'THX-2',
    schedule: 'TTh 8-9AM Rm703',
    schedule_blocks_json: JSON.stringify([{ days: ['T', 'Th'], start: '08:00', end: '09:00' }]),
  }),
  section({
    class_code: '71001', subject: 'Eng', course: 'Eng 1', section: 'WFX-1',
    schedule: 'WF 2:30-4PM Rm711',
    schedule_blocks_json: JSON.stringify([{ days: ['W', 'F'], start: '14:30', end: '16:00' }]),
  }),
  section({
    class_code: '71002', subject: 'Eng', course: 'Eng 1', section: 'WFX-10',
    schedule: 'WF 2:30-4PM Rm712',
    schedule_blocks_json: JSON.stringify([{ days: ['W', 'F'], start: '14:30', end: '16:00' }]),
  }),

  // CS 20 — two sections, one whose schedule string is "Arranged"/TBA and
  // deliberately doesn't parse into any blocks (schedule_blocks_json stays
  // '[]', the section() default) — exercises the needs-review fallback.
  section({
    class_code: '50001', subject: 'CS', course: 'CS 20', section: 'THAB',
    schedule: 'TTh 7:30-8:30AM Rm501',
    schedule_blocks_json: JSON.stringify([{ days: ['T', 'Th'], start: '07:30', end: '08:30' }]),
  }),
  section({
    class_code: '50002', subject: 'CS', course: 'CS 20', section: 'THAB/HWX',
    schedule: 'Arranged',
    schedule_blocks_json: '[]',
  }),

  // CWTS 1 — one section; combined course number ("CWTS 1 and 2") is
  // exercised separately below via reSplitRawCourseText/extractCrsCourseNumber
  // directly, since none of the OCR fixture rows below are for it.
  section({
    class_code: '60001', subject: 'CWTS', course: 'CWTS 1', section: 'ENGGDCS',
    schedule: 'M 7-10AM Rm601',
    schedule_blocks_json: JSON.stringify([{ days: ['M'], start: '07:00', end: '10:00' }]),
  }),
];

const FAKE_SEMESTERS = [{ semester_code: SEMESTER, is_active: 1 }];

// Answers the query shapes turso.ts issues (getSubjects, getAllSectionsForSubject,
// and the active-semester lookup) — no other SQL is expected from this
// harness's code path, so anything else is a signal the real module
// changed shape and this stub needs updating.
async function FAKE_EXECUTE(stmt: string | { sql: string; args?: unknown[] }) {
  const sql = typeof stmt === 'string' ? stmt : stmt.sql;
  const args = typeof stmt === 'string' ? [] : (stmt.args ?? []);

  if (sql.includes('FROM semesters')) {
    return { rows: FAKE_SEMESTERS.filter((s) => s.is_active === 1) };
  }

  if (sql.includes('GROUP BY subject')) {
    const semesterCode = args[0] as string;
    const bySubject = new Map<string, number>();
    for (const s of FAKE_SECTIONS) {
      if (s.semester_code !== semesterCode) continue;
      bySubject.set(s.subject, (bySubject.get(s.subject) ?? 0) + 1);
    }
    return {
      rows: Array.from(bySubject.entries())
        .filter(([subject]) => FAKE_SUBJECTS.includes(subject))
        .map(([subject, count]) => ({ subject, count })),
    };
  }

  if (sql.includes('FROM sections')) {
    const [semesterCode, subject] = args as [string, string];
    return {
      rows: FAKE_SECTIONS.filter((s) => s.semester_code === semesterCode && s.subject === subject),
    };
  }

  throw new Error(`Unmocked SQL: ${sql}`);
}

async function main() {
  const { matchAllOcrEntries } = await import('../lib/crs-monitor/matchServer');
  const {
    groupOcrEntries,
    reSplitRawCourseText,
    extractCrsCourseNumber,
    extractRoomsFromSchedule,
    parseCrsScheduleBlocks,
    expandParsedBlocks,
  } = await import('../lib/crs-monitor/matcher');
  const { timeToMinutes, formatMinutesAsDisplay } = await import('../lib/client-ocr/textCleanup');
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
    // Sample schedule 1's Eng rows (the reported bug): full section codes
    // visible in the screenshot, Wed/Fri meetings per the grid.
    { day: 'Wed', start: '01:00PM', end: '02:30PM', start_minutes: 780, end_minutes: 870, course: 'Eng 13 WFW-4', subject: 'Eng', number: '13', section: 'WFW-4' },
    { day: 'Fri', start: '01:00PM', end: '02:30PM', start_minutes: 780, end_minutes: 870, course: 'Eng 13 WFW-4', subject: 'Eng', number: '13', section: 'WFW-4' },
    { day: 'Wed', start: '02:30PM', end: '04:00PM', start_minutes: 870, end_minutes: 960, course: 'Eng 1 WFX-1', subject: 'Eng', number: '1', section: 'WFX-1' },
    { day: 'Fri', start: '02:30PM', end: '04:00PM', start_minutes: 870, end_minutes: 960, course: 'Eng 1 WFX-1', subject: 'Eng', number: '1', section: 'WFX-1' },
  ];

  console.log(`\n=== Phase 5 checklist ===\n`);

  // 1. No ghost Sunday entries
  const sunEntries = entries.filter((e) => e.day === 'Sun');
  console.log(`[1] Ghost Sunday entries: ${sunEntries.length === 0 ? 'PASS (none)' : 'FAIL -> ' + JSON.stringify(sunEntries)}`);

  // 2. Wed distinct rows, correct time ranges (incl. the Eng 13 / Eng 1
  // regression rows; STS and Eng 13 share the same Wed slot, so assert per
  // course instead of by index)
  const wed = entries.filter((e) => e.day === 'Wed');
  const wedExpect: Array<[string, string, string]> = [
    ['Math 23', '08:30AM', '10:00AM'],
    ['CS 31', '10:00AM', '11:30AM'],
    ['Physics 72', '11:30AM', '01:00PM'],
    ['STS 1', '01:00PM', '02:30PM'],
    ['Eng 13', '01:00PM', '02:30PM'],
    // Trailing space: "Eng 1" alone also startsWith-matches "Eng 13 ..."
    ['Eng 1 ', '02:30PM', '04:00PM'],
  ];
  const wedOk = wed.length === wedExpect.length &&
    wedExpect.every(([prefix, s, e]) => {
      const row = wed.find((x) => x.course.startsWith(prefix));
      return row && row.start === s && row.end === e;
    });
  console.log(`[2] Wed = ${wedExpect.length} distinct rows w/ correct ranges: ${wedOk ? 'PASS' : 'FAIL'}`);
  console.log('    ' + wed.map((e) => `${e.course} ${e.start}-${e.end}`).join(' | '));

  // 3. Section codes not truncated (re-split with CRS's own boundary rule)
  const physicsResplit = reSplitRawCourseText('Physics 72 WFV-HV-4');
  const sectionOk = physicsResplit.section === 'WFV-HV-4';
  console.log(`[3] Section not truncated (reSplitRawCourseText): ${sectionOk ? 'PASS' : 'FAIL'} -> "${physicsResplit.section}"`);

  // 4/5. Run the actual matcher against the mocked CRS-Monitor Turso data
  const results = await matchAllOcrEntries(entries, SEMESTER);
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
  console.log(`\nGrouped ${entries.length} day-rows into ${groups.length} classes (expected 9: CWTS1, CS20-THAB, Math23, CS31, Physics72, STS1, Eng13-WFW4, Eng1-WFX1, CS20-THAB/HWX).`);

  console.log(`\n=== Phase 2 checklist (room / time / course-number mapping) ===\n`);

  // 6. Room-pairing, exercised through the real matched pipeline: Math 23
  // WFR-HR-4's fixture is a real 2-segment lec+lab schedule (see
  // FAKE_SECTIONS) — confirm the matched section's own scheduleBlocksJson
  // pairs each block with the right room via parseCrsScheduleBlocks, and
  // that expandParsedBlocks carries `room` through per day-row.
  const mathMatch = results.find((r) => r.ocrClass.subject === 'Math' && r.outcome.status === 'matched');
  let math23Ok = false;
  if (mathMatch && mathMatch.outcome.status === 'matched') {
    const blocks = parseCrsScheduleBlocks(
      mathMatch.outcome.section.scheduleBlocksJson,
      mathMatch.outcome.section.schedule
    );
    const rows = expandParsedBlocks(blocks);
    const byDay = Object.fromEntries(rows.map((r) => [r.day, r.room]));
    math23Ok = byDay.Wed === 'Rm101' && byDay.Fri === 'Rm101' && byDay.Thu === 'Rm101-L';
    console.log(`[6] Math 23 WFR-HR-4 lec+lab room pairing: ${math23Ok ? 'PASS' : 'FAIL'} -> ${JSON.stringify(byDay)}`);
  } else {
    console.log('[6] Math 23 WFR-HR-4 lec+lab room pairing: FAIL -> no matched Math result to check');
  }

  // 7. extractRoomsFromSchedule against the exact confirmed real example
  // from the migration spec (not just the synthetic fixtures above) —
  // including "TBA" being kept as a valid room, not nulled.
  const specRooms = extractRoomsFromSchedule('Th 7-8AM lec TBA; WF 7-8:30AM lec MB 301', 2);
  const specRoomsOk = specRooms[0] === 'TBA' && specRooms[1] === 'MB 301';
  console.log(`[7] extractRoomsFromSchedule spec example: ${specRoomsOk ? 'PASS' : 'FAIL'} -> ${JSON.stringify(specRooms)}`);

  // 8. Segment/block count mismatch -> flagged as unknown (null), not guessed.
  const mismatchRooms = extractRoomsFromSchedule('Th 7-8AM lec TBA; WF 7-8:30AM lec MB 301', 3);
  const mismatchOk = mismatchRooms.length === 3 && mismatchRooms.every((r) => r === null);
  console.log(`[8] extractRoomsFromSchedule segment/block mismatch -> null (flagged, not guessed): ${mismatchOk ? 'PASS' : 'FAIL'} -> ${JSON.stringify(mismatchRooms)}`);

  // 9. formatMinutesAsDisplay <-> timeToMinutes round-trip, incl. 12AM/12PM edges.
  const roundTripCases = [0, 30, 60, 450, 690, 720, 750, 780, 1439];
  const roundTripOk = roundTripCases.every((mins) => timeToMinutes(formatMinutesAsDisplay(mins)) === mins);
  console.log(
    `[9] formatMinutesAsDisplay/timeToMinutes round-trip (incl. 12AM/12PM): ${roundTripOk ? 'PASS' : 'FAIL'} -> ` +
      roundTripCases.map((m) => `${m}->"${formatMinutesAsDisplay(m)}"->${timeToMinutes(formatMinutesAsDisplay(m))}`).join(', ')
  );

  // 10. extractCrsCourseNumber strips the subject CRS's `course` column
  // includes ("Math 23" -> "23"), including the combined-number case
  // ("CWTS 1 and 2" -> "1 and 2") per matcher.ts's own comments.
  const bareMath = extractCrsCourseNumber('Math 23');
  const bareCombined = extractCrsCourseNumber('CWTS 1 and 2');
  const courseNumberOk = bareMath === '23' && bareCombined === '1 and 2';
  console.log(`[10] extractCrsCourseNumber (incl. combined "and"): ${courseNumberOk ? 'PASS' : 'FAIL'} -> "${bareMath}", "${bareCombined}"`);

  // 11. Sample schedule 1 regression: "Eng 13 WFW-4" and "Eng 1 WFX-1"
  // must AUTO-MATCH their exact sections even though parallel sections
  // meeting the same timeslot substring-collide with the OCR fragment
  // ("WFW-40" ⊃ "WFW4", both at WF 1-2:30PM). Before the exact-section
  // override in matchOcrClass these came back as CANDIDATES and the
  // correction page asked for manual confirmation.
  const eng13 = results.find((r) => r.ocrClass.section === 'WFW-4' && r.ocrClass.number === '13');
  const eng1 = results.find((r) => r.ocrClass.section === 'WFX-1' && r.ocrClass.number === '1');
  const eng13Ok =
    eng13?.outcome.status === 'matched' && eng13.outcome.section.section === 'WFW-4';
  const eng1Ok =
    eng1?.outcome.status === 'matched' && eng1.outcome.section.section === 'WFX-1';
  const describe = (r: typeof eng13) =>
    !r ? 'group not found'
      : r.outcome.status === 'matched'
        ? `MATCHED -> ${r.outcome.section.section} (${r.outcome.section.classCode})`
        : r.outcome.status === 'candidates'
          ? `CANDIDATES x${r.outcome.candidates.length}: ${r.outcome.candidates.map((c) => `${c.section.section}(${c.confidence})`).join(', ')}`
          : `UNMATCHED: ${r.outcome.reason}`;
  console.log(`[11a] Eng 13 WFW-4 auto-matched despite same-slot WFW-40: ${eng13Ok ? 'PASS' : 'FAIL'} -> ${describe(eng13)}`);
  console.log(`[11b] Eng 1 WFX-1 auto-matched despite same-slot WFX-10: ${eng1Ok ? 'PASS' : 'FAIL'} -> ${describe(eng1)}`);
}

main().catch((e) => {
  console.error('Verification script failed:', e);
  process.exit(1);
});
