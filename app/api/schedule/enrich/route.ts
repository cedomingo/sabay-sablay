import { createClient } from "@/lib/supabase/server";
import { enrichEntries } from "@/lib/crs-monitor";
import { NextResponse } from "next/server";

// POST /api/schedule/enrich
// Accepts an array of parsed schedule entries and enriches them with
// CRS-Monitor section data (room, class_code, slots).
export async function POST(request: Request) {
  const supabase = createClient();

  // Verify the user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { entries } = body as {
      entries: Array<{ subject: string; number: string; section: string }>;
    };

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: "entries array is required" },
        { status: 400 }
      );
    }

    const enriched = await enrichEntries(entries);

    return NextResponse.json({ enriched });
  } catch (error) {
    console.error("Enrich error:", error);
    return NextResponse.json(
      { error: "Failed to enrich entries" },
      { status: 500 }
    );
  }
}
