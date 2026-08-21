import { NextRequest, NextResponse } from 'next/server';
import { matchAllOcrEntries, groupOcrEntries } from '@/lib/crs-monitor/matcher';
import { getAllSectionsForSubject } from '@/lib/crs-monitor/client';
import { CrsMonitorError } from '@/lib/crs-monitor/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entries = body.entries;
    if (!Array.isArray(entries)) return NextResponse.json({ error: 'entries must be an array' }, { status: 400 });

    const grouped = groupOcrEntries(entries);
    const subjects = Array.from(new Set(grouped.map(g => g.subject).filter(Boolean)));
    const sectionsBySubject = new Map<string, any[]>();

    for (const subject of subjects) {
      try {
        const sections = await getAllSectionsForSubject(subject);
        sectionsBySubject.set(subject, sections);
      } catch (e) {
        if (e instanceof CrsMonitorError) {
          return NextResponse.json({
            matched: [], candidates: [],
            unmatched: entries.map((e: any) => ({ entry: e, reason: 'crs_unreachable', message: e.message })),
          });
        }
        throw e;
      }
    }

    const results = matchAllOcrEntries(grouped, sectionsBySubject);
    return NextResponse.json(results);
  } catch (error) {
    console.error('Enrich route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}