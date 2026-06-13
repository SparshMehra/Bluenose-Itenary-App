// Data access layer for Open Data Nova Scotia (Socrata / SODA API)
// Datasets used:
//   2h2s-6bg4  Tourism Nova Scotia Listed Operators (attractions with GPS coords)
//   n783-4gmh  Tourism Nova Scotia Visitation (monthly visitor counts)
//   is4a-t3qd  Visitor Exit Survey - Communities visited (popularity %)
//   xqm5-iybw  Provincial Visitor Information Centre visitation by month

const BASE = 'https://data.novascotia.ca/resource';

// Simple in-memory cache so we don't hammer the open data portal
const cache = new Map();
const TTL_MS = 60 * 60 * 1000; // 1 hour

async function fetchJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Open Data NS request failed (${res.status}): ${url}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
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

/**
 * Search tourism operators/attractions by name, region or type.
 * Returns up to `limit` results with coordinates.
 */
export async function searchDestinations({ query = '', region = '', type = '', limit = 15 } = {}) {
  const params = new URLSearchParams({ $limit: '5000' });
  const url = `${BASE}/2h2s-6bg4.json?${params}`;
  const rows = await fetchJson(url);

  const q = norm(query);
  const r = norm(region);
  const t = norm(type);

  const results = rows.filter((row) => {
    const name = norm(row.name);
    const reg = norm(row.region);
    const typ = norm(row.type);
    if (q && !(name.includes(q) || reg.includes(q))) return false;
    if (r && !reg.includes(r)) return false;
    if (t && !typ.includes(t)) return false;
    return row.latitude && row.longitude;
  });

  return results.slice(0, limit).map((row) => ({
    name: row.name,
    type: row.type,
    region: row.region,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));
}

// Some operators belong to several regions, stored comma-separated
// ("Bay of Fundy & Annapolis Valley, South Shore") — split into components.
function splitRegions(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Distinct tourism regions in the operators dataset (for the UI dropdown). */
export async function listRegions() {
  const rows = await fetchJson(`${BASE}/2h2s-6bg4.json?$select=distinct region&$limit=100`);
  const set = new Set();
  for (const r of rows) for (const part of splitRegions(r.region)) set.add(part);
  return [...set].sort();
}

/** Distinct operator types (Attraction, Accommodation, ...). */
export async function listTypes() {
  const rows = await fetchJson(`${BASE}/2h2s-6bg4.json?$select=distinct type&$limit=100`);
  return rows.map((r) => r.type).filter(Boolean).sort();
}

/** Site-wide summary: total operators + counts per region and per type. */
export async function getSummary() {
  const rows = await fetchJson(`${BASE}/2h2s-6bg4.json?$limit=5000`);
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
  const rows = await fetchJson(`${BASE}/n783-4gmh.json?$limit=50000`);

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
  const rows = await fetchJson(`${BASE}/is4a-t3qd.json?$limit=10000`);
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
