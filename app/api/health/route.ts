import { NextResponse } from "next/server";

// GET /api/health
// Confirms the Next.js deploy is up and reports (without leaking secrets)
// whether the expected server env vars are present. Used as the
// "done when" check for Phase 0.
export async function GET() {
  const envCheck = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    OCR_SERVICE_URL: Boolean(process.env.OCR_SERVICE_URL),
    OCR_SERVICE_KEY: Boolean(process.env.OCR_SERVICE_KEY),
    CRS_MONITOR_API_URL: Boolean(process.env.CRS_MONITOR_API_URL),
  };

  return NextResponse.json({
    status: "ok",
    service: "schedule-planner-web",
    timestamp: new Date().toISOString(),
    env: envCheck,
  });
}
