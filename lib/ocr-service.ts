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

  // Fail fast with a clear error instead of letting Vercel's own function
  // timeout kill the request (which returns an HTML page, not JSON, and
  // breaks client-side res.json() parsing). Kept under this route's
  // maxDuration (60s) so we always get a chance to respond with real JSON.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/parse`, {
      method: "POST",
      headers: { "X-Internal-Key": SERVICE_KEY! },
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "The OCR service took too long to respond. If it's been idle for " +
          "a while it may be cold-starting on Render — please try again in " +
          "a moment."
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`OCR /parse failed: ${res.status}`);
  }

  return res.json();
}
