// Daily data pipeline.
// Snapshots every Open Data Nova Scotia dataset to disk, on a daily schedule,
// so the app serves fast local copies and survives the portal being down.

import { DATASETS, fetchAllRows, writeSnapshot, readManifest, writeManifest } from './datasets.js';
import { clearDataCache } from './nsData.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_HOUR = 3; // 03:00 local time

let refreshing = false;

/** Refresh one dataset → snapshot on disk. Returns a manifest entry. */
async function refreshDataset({ id, name }) {
  const startedAt = Date.now();
  try {
    const rows = await fetchAllRows(id);
    const snap = await writeSnapshot(id, rows);
    return { id, name, ok: true, count: snap.count, fetchedAt: snap.fetchedAt, ms: Date.now() - startedAt };
  } catch (err) {
    console.error(`[pipeline] ${id} failed:`, err.message);
    return { id, name, ok: false, error: err.message, fetchedAt: new Date().toISOString(), ms: Date.now() - startedAt };
  }
}

/** Refresh ALL datasets and write the manifest. Safe to call anytime. */
export async function refreshAll() {
  if (refreshing) {
    console.log('[pipeline] refresh already in progress; skipping.');
    return readManifest();
  }
  refreshing = true;
  const t0 = Date.now();
  console.log('[pipeline] refreshing', DATASETS.length, 'datasets from Open Data Nova Scotia…');
  try {
    const datasets = [];
    for (const ds of DATASETS) datasets.push(await refreshDataset(ds)); // sequential = polite to the portal
    const manifest = {
      updatedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok: datasets.every((d) => d.ok),
      datasets,
    };
    await writeManifest(manifest);
    clearDataCache(); // make the app pick up the new snapshots without a restart
    const okCount = datasets.filter((d) => d.ok).length;
    console.log(`[pipeline] done: ${okCount}/${datasets.length} datasets in ${(manifest.durationMs / 1000).toFixed(1)}s`);
    return manifest;
  } finally {
    refreshing = false;
  }
}

/** True if snapshots are missing or older than ~23h (so a startup refresh is due). */
async function isStale() {
  const manifest = await readManifest();
  if (!manifest || !manifest.updatedAt) return true;
  if (!manifest.ok) return true;
  return Date.now() - new Date(manifest.updatedAt).getTime() > 23 * 60 * 60 * 1000;
}

function msUntil(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

/**
 * Start the pipeline: refresh now if data is stale, then refresh every day
 * at REFRESH_HOUR local time. Non-blocking; timers are unref'd so they never
 * keep the process alive on their own.
 */
export async function startDailyPipeline({ runOnStart = true } = {}) {
  if (runOnStart) {
    if (await isStale()) {
      refreshAll().catch((e) => console.error('[pipeline] startup refresh failed:', e.message));
    } else {
      const m = await readManifest();
      console.log(`[pipeline] snapshots are fresh (updated ${m.updatedAt}); skipping startup refresh.`);
    }
  }

  const delay = msUntil(REFRESH_HOUR);
  const first = setTimeout(() => {
    refreshAll().catch((e) => console.error('[pipeline] daily refresh failed:', e.message));
    const every = setInterval(
      () => refreshAll().catch((e) => console.error('[pipeline] daily refresh failed:', e.message)),
      DAY_MS
    );
    every.unref?.();
  }, delay);
  first.unref?.();
  console.log(`[pipeline] next daily refresh in ${(delay / 3_600_000).toFixed(1)}h (daily at ${String(REFRESH_HOUR).padStart(2, '0')}:00 local).`);
}

export { readManifest as getDataStatus };
