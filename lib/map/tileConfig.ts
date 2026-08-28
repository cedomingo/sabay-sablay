/**
 * Tile provider decision — resolves build plan §C ("Still open: tile
 * provider... pick before Phase 2 ships, since OSM's own tile server usage
 * policy won't tolerate a live app at scale").
 *
 * Decision: MapTiler's free tier (100k tile loads/month, no credit card to
 * start) over Stadia Maps or self-hosting. Reasoning:
 *   - Self-hosting tiles (e.g. a tileserver-gl container) is real
 *     infrastructure to run and pay for — overkill for a UP Diliman-only
 *     map that only ever needs one small bounding box of tiles, and this
 *     project is explicitly free-tier/Vercel-constrained throughout.
 *   - MapTiler and Stadia are comparable free tiers; MapTiler's key-in-URL
 *     setup is marginally simpler to wire through NEXT_PUBLIC_ env vars
 *     than Stadia's referrer-allowlist model, and its "streets" style reads
 *     clearly at campus zoom levels (14–17) without extra config.
 *
 * Requires NEXT_PUBLIC_MAPTILER_KEY (see .env.example) in production. Local
 * dev with no key falls back to raw OSM tiles so `npm run dev` works out of
 * the box — that fallback must NOT go to production traffic, since it's
 * exactly the "won't tolerate a live app at scale" case §C warned about.
 */

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

export const usingFallbackTiles = !MAPTILER_KEY;

export const TILE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export const TILE_ATTRIBUTION = MAPTILER_KEY
  ? '\u00A9 <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> \u00A9 <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
  : '\u00A9 <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';

export const TILE_MAX_ZOOM = 19;

// UP Diliman campus center + a zoom that frames the ~40-place dataset
// without the person having to pan on load. Roughly the centroid of
// up-diliman-places.json.
export const CAMPUS_CENTER: [number, number] = [14.6537, 121.0685];
export const CAMPUS_DEFAULT_ZOOM = 15;
