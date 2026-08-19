import { NextResponse } from "next/server";
import { checkOcrServiceHealth } from "@/lib/ocr-service";

// GET /api/ocr-health
// Server-to-server proof that Vercel can reach the Render OCR service
// using the shared-secret header. Never called from the client directly
// for anything beyond this smoke test.
export async function GET() {
  try {
    const data = await checkOcrServiceHealth();
    return NextResponse.json({ status: "ok", ocrService: data });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
