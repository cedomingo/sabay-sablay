// Server-only helper for talking to the FastAPI OCR service on Render.
// Never call this from a Client Component — OCR_SERVICE_URL/KEY are
// server-only env vars and must not leak into the browser bundle.

const BASE_URL = process.env.OCR_SERVICE_URL;
const SERVICE_KEY = process.env.OCR_SERVICE_KEY;

function assertConfigured() {
  if (!BASE_URL || !SERVICE_KEY) {
    throw new Error(
      "OCR_SERVICE_URL / OCR_SERVICE_KEY are not set. Configure them in " +
        ".env.local (dev) or the Vercel project settings (prod)."
    );
  }
}

// GET {OCR_SERVICE_URL}/health — used by /api/health to confirm the
// Next.js app and the Render service can actually reach each other.
export async function checkOcrServiceHealth() {
  assertConfigured();

  const res = await fetch(`${BASE_URL}/health`, {
    headers: { "X-Internal-Key": SERVICE_KEY! },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`OCR service health check failed: ${res.status}`);
  }

  return res.json();
}

// POST {OCR_SERVICE_URL}/parse — multipart image upload, returns the
// structured schedule JSON described in Appendix B of the build plan.
// Wired up for real in Phase 2; exported now so the contract is fixed
// from Phase 0 onward.
export async function parseScheduleImage(imageFile: File) {
  assertConfigured();

  const formData = new FormData();
  formData.append("file", imageFile);

  const res = await fetch(`${BASE_URL}/parse`, {
    method: "POST",
    headers: { "X-Internal-Key": SERVICE_KEY! },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`OCR /parse failed: ${res.status}`);
  }

  return res.json();
}
