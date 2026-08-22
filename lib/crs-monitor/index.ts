import "server-only";

// Barrel export — server-only. This pulls in ./client (network calls to
// CRS-Monitor, reads process.env.CRS_MONITOR_API_URL) and ./matchServer
// (the matching logic built on top of it), so it must never be imported
// from a "use client" component. Client-safe pieces (parseScheduleText,
// formatMinutesAsHHMM, groupOcrEntries, etc.) should be imported directly
// from "./matcher" instead, which has no such restriction.
export * from "./types";
export * from "./client";
export * from "./matcher";
export * from "./matchServer";
