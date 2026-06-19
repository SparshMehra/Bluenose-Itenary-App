// Data access layer for Open Data Nova Scotia.
// Serves rows from the daily on-disk snapshots written by the pipeline
// (src/pipeline.js); falls back to a live fetch if a snapshot is missing.
// Datasets used:
//   2h2s-6bg4  Tourism Nova Scotia Listed Operators (attractions with GPS coords)
//   n783-4gmh  Tourism Nova Scotia Visitation (monthly visitor counts)
//   is4a-t3qd  Visitor Exit Survey - Communities visited (popularity %)
//   xqm5-iybw  Provincial Visitor Information Centre visitation by month

import { fetchAllRows, readSnapshot, writeSnapshot } from './datasets.js';

// In-memory copy of each dataset's rows. Cleared by the pipeline (via
// clearDataCache) right after it writes fresh snapshots, so the running app
// picks up new data without a restart.
const mem = new Map(); // id -> { rows, at }
const MEM_TTL = 24 * 60 * 60 * 1000;

/** Called by the pipeline after a refresh so the app reloads fresh snapshots. */
export function clearDataCache() {
  mem.clear();
}

/**
 * Load all rows for a dataset: memory → disk snapshot → live fetch.
 * On a live fetch (snapshot absent), the result is persisted as a snapshot so
 * the very first run still warms the cache.
 */
async function loadDataset(id) {
  const hit = mem.get(id);
  if (hit && Date.now() - hit.at < MEM_TTL) return hit.rows;

  const snap = await readSnapshot(id);
  if (snap) {
    mem.set(id, { rows: snap.rows, at: Date.now() });
    return snap.rows;
  }

  // No snapshot yet (e.g. first ever boot before the pipeline finishes): go live.
  const rows = await fetchAllRows(id);
  mem.set(id, { rows, at: Date.now() });
  writeSnapshot(id, rows).catch(() => {}); // best-effort warm
  return rows;
}

// Normalize for fuzzy matching: lowercase, strip accents and punctuation
// (the dataset uses curly apostrophes — "Peggy’s Cove" must match "Peggys Cove").
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein edit distance — used to tolerate small typos ("lunenberg").
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

const shape = (row) => ({
  name: row.name,
  type: row.type,
  region: row.region,
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
});

/**
 * Search tourism operators/attractions by name, region or type.
 * Returns up to `limit` results with coordinates. Falls back to a typo-tolerant
 * fuzzy match when an exact substring search finds nothing.
 */
export async function searchDestinations({ query = '', region = '', type = '', limit = 15 } = {}) {
  const rows = await loadDataset('2h2s-6bg4');

  const q = norm(query);
  const r = norm(region);
  const t = norm(type);

  const passesFilters = (row) => {
    if (r && !norm(row.region).includes(r)) return false;
    if (t && !norm(row.type).includes(t)) return false;
    return row.latitude && row.longitude;
  };

  const results = rows.filter((row) => {
    const name = norm(row.name);
    if (q && !(name.includes(q) || norm(row.region).includes(q))) return false;
    return passesFilters(row);
  });

  // Typo-tolerant fallback: compare the query against each name word.
  if (q && results.length === 0 && q.length >= 4) {
    const tol = q.length >= 7 ? 3 : 2; // allow more edits on longer words
    const scored = [];
    for (const row of rows) {
      if (!passesFilters(row)) continue;
      let best = Infinity;
      for (const word of norm(row.name).split(' ')) {
        if (Math.abs(word.length - q.length) > tol) continue;
        const d = lev(q, word);
        if (d < best) best = d;
      }
      if (best <= tol) scored.push({ row, d: best });
    }
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, limit).map(({ row }) => shape(row));
  }

  return results.slice(0, limit).map(shape);
}

// Some operators belong to several regions, stored comma-separated
// ("Bay of Fundy & Annapolis Valley, South Shore") — split into components.
function splitRegions(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Distinct tourism regions in the operators dataset (for the UI dropdown). */
export async function listRegions() {
  const rows = await loadDataset('2h2s-6bg4');
  const set = new Set();
  for (const r of rows) for (const part of splitRegions(r.region)) set.add(part);
  return [...set].sort();
}

/** Distinct operator types (Attraction, Accommodation, ...). */
export async function listTypes() {
  const rows = await loadDataset('2h2s-6bg4');
  const set = new Set();
  for (const r of rows) if (r.type) set.add(r.type);
  return [...set].sort();
}

/** Site-wide summary: total operators + counts per region and per type. */
export async function getSummary() {
  const rows = await loadDataset('2h2s-6bg4');
  const byRegion = {};
  const byType = {};
  for (const row of rows) {
    for (const part of splitRegions(row.region)) byRegion[part] = (byRegion[part] || 0) + 1;
    if (row.type) byType[row.type] = (byType[row.type] || 0) + 1;
  }
  return {
    total_operators: rows.length,
    by_region: Object.entries(byRegion).map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count),
    by_type: Object.entries(byType).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
  };
}

/**
 * Monthly visitor totals to Nova Scotia (all origins/modes combined),
 * plus a per-calendar-month average across years — used to judge
 * peak season vs quiet season ("best dates").
 */
export async function getVisitationByMonth() {
  const rows = await loadDataset('n783-4gmh');

  const byMonthYear = new Map(); // '2024-07' -> total
  for (const row of rows) {
    if (!row.month_year) continue;
    const key = row.month_year.slice(0, 7);
    const n = Number(row.number_of_visitors_rounded_to_nearest_hundred) || 0;
    byMonthYear.set(key, (byMonthYear.get(key) || 0) + n);
  }

  // Average per calendar month across all years on record
  const monthTotals = new Array(12).fill(0);
  const monthCounts = new Array(12).fill(0);
  for (const [key, total] of byMonthYear) {
    const m = Number(key.slice(5, 7)) - 1;
    monthTotals[m] += total;
    monthCounts[m] += 1;
  }
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const averageByCalendarMonth = monthNames.map((name, i) => ({
    month: name,
    avg_visitors: monthCounts[i] ? Math.round(monthTotals[i] / monthCounts[i]) : 0,
  }));

  // Most recent 24 months of raw totals for trend context
  const recent = [...byMonthYear.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-24)
    .map(([month, total]) => ({ month, total_visitors: total }));

  return { averageByCalendarMonth, recentMonths: recent };
}

/**
 * How popular communities are with overnight visitors
 * (exit survey: % of visitors who visited each community, latest survey year).
 */
export async function getCommunityPopularity({ community = '', region = '', limit = 20 } = {}) {
  const rows = await loadDataset('is4a-t3qd');
  const latestYear = rows.reduce((max, r) => Math.max(max, Number(r.year) || 0), 0);

  let results = rows
    .filter((r) => Number(r.year) === latestYear)
    .map((r) => ({
      community: r.community,
      region: r.region,
      percent_of_visitors: Math.round(Number(r.percent) * 1000) / 10, // 0.064 -> 6.4
      survey_year: latestYear,
    }));

  const c = community.trim().toLowerCase();
  const reg = region.trim().toLowerCase();
  if (c) results = results.filter((r) => (r.community || '').toLowerCase().includes(c));
  if (reg) results = results.filter((r) => (r.region || '').toLowerCase().includes(reg));

  results.sort((a, b) => b.percent_of_visitors - a.percent_of_visitors);
  return results.slice(0, limit);
}
