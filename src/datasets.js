// Single source of truth for the Open Data Nova Scotia datasets the app uses,
// plus the low-level fetch/snapshot IO primitives shared by the data layer
// (nsData.js) and the daily pipeline (pipeline.js).

import fs from 'node:fs/promises';
import path from 'node:path';

export const BASE = 'https://data.novascotia.ca/resource';
export const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');
export const MANIFEST_PATH = path.join(CACHE_DIR, 'manifest.json');

// Every dataset the pipeline snapshots daily. Add a row here and both the
// pipeline and the cache loader pick it up automatically.
export const DATASETS = [
  { id: '2h2s-6bg4', name: 'Tourism Listed Operators' },
  { id: 'n783-4gmh', name: 'Tourism Visitation (monthly)' },
  { id: 'is4a-t3qd', name: 'Visitor Exit Survey — Communities' },
  { id: 'xqm5-iybw', name: 'Provincial VIC Visitation (monthly)' },
];

function requestHeaders() {
  const h = { Accept: 'application/json' };
  // Optional Socrata app token → higher rate limits. Set SOCRATA_APP_TOKEN in .env.
  if (process.env.SOCRATA_APP_TOKEN) h['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  return h;
}

export function snapshotPath(id) {
  return path.join(CACHE_DIR, `${id}.json`);
}

/** Fetch ALL rows for a dataset, paginating through the Socrata API. */
export async function fetchAllRows(id) {
  const pageSize = 5000;
  const headers = requestHeaders();
  const all = [];
  for (let offset = 0; offset < 1_000_000; offset += pageSize) {
    const url = `${BASE}/${id}.json?$limit=${pageSize}&$offset=${offset}&$order=:id`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Open Data NS ${id} request failed (${res.status})`);
    const page = await res.json();
    all.push(...page);
    if (page.length < pageSize) break; // last page
  }
  return all;
}

/** Write a dataset snapshot to disk as { id, fetchedAt, count, rows }. */
export async function writeSnapshot(id, rows) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const payload = { id, fetchedAt: new Date().toISOString(), count: rows.length, rows };
  // Atomic-ish write: temp file then rename, so a reader never sees a half file.
  const tmp = snapshotPath(id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(payload));
  await fs.rename(tmp, snapshotPath(id));
  return payload;
}

/** Read a dataset snapshot from disk, or null if missing/unreadable. */
export async function readSnapshot(id) {
  try {
    const raw = await fs.readFile(snapshotPath(id), 'utf8');
    const snap = JSON.parse(raw);
    return Array.isArray(snap.rows) ? snap : null;
  } catch {
    return null;
  }
}

export async function readManifest() {
  try {
    return JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeManifest(manifest) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const tmp = MANIFEST_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2));
  await fs.rename(tmp, MANIFEST_PATH);
}
