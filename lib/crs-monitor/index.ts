import "server-only";

// Barrel export — server-only. This pulls in ./turso (queries CRS-Monitor's
// Turso/libSQL database, reads CRS_MONITOR_TURSO_URL /
// CRS_MONITOR_TURSO_AUTH_TOKEN) and ./matchServer (the matching logic built
// on top of it), so it must never be imported from a "use client"
// component. Client-safe pieces (parseScheduleText, formatMinutesAsHHMM,
// groupOcrEntries, etc.) should be imported directly from "./matcher"
// instead, which has no such restriction.
export * from "./types";
export * from "./turso";
export * from "./matcher";
export * from "./matchServer";
