import { NextRequest, NextResponse } from 'next/server';
import { matchAllOcrEntries } from '@/lib/crs-monitor/matchServer';
import { CrsMonitorError } from '@/lib/crs-monitor/types';

type MatchResults = Awaited<ReturnType<typeof matchAllOcrEntries>>;

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entries = body.entries;
    const semester = typeof body.semester === 'string' ? body.semester : undefined;
    if (!Array.isArray(entries)) return NextResponse.json({ error: 'entries must be an array' }, { status: 400 });

    let results: MatchResults;
    try {
      results = await matchAllOcrEntries(entries, semester);
    } catch (e) {
      if (e instanceof CrsMonitorError) {
        return NextResponse.json({
          matched: [], candidates: [],
          unmatched: entries.map((entry: any) => ({ entry, reason: 'crs_unreachable', message: e.message })),
        });
      }
      throw e;
    }

    const matched = results
      .filter((r) => r.outcome.status === 'matched')
      .map((r) => ({
        entry: r.ocrClass,
        crsSection: (r.outcome as { status: 'matched'; section: any; confidence: number }).section,
        confidence: (r.outcome as { status: 'matched'; section: any; confidence: number }).confidence,
      }));

    const candidates = results
      .filter((r) => r.outcome.status === 'candidates')
      .map((r) => ({
        entry: r.ocrClass,
        candidates: (r.outcome as { status: 'candidates'; candidates: any[] }).candidates,
      }));

    // `options` is the full scored same-course pool (best first) whenever
    // there is one to offer — it powers the correction page's
    // "Can't find your section?" escape hatch. Absent when matching never
    // got as far as a course-level pool (unresolvable subject / no such
    // course number), where there is genuinely nothing more to show.
    const unmatched = results.flatMap((r) =>
      r.outcome.status === 'unmatched'
        ? [{
            entry: r.ocrClass,
            reason: r.outcome.reason,
            ...(r.outcome.pool && r.outcome.pool.length > 0
              ? { options: r.outcome.pool }
              : {}),
          }]
        : []
    );

    return NextResponse.json({ matched, candidates, unmatched });
  } catch (error) {
    console.error('Enrich route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
