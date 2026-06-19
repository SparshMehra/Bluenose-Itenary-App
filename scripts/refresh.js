// Standalone data-refresh runner.
// Use this for a manual refresh (`npm run refresh-data`) or from an OS
// scheduler (Windows Task Scheduler / cron) if you don't keep the server
// running 24/7. It snapshots every dataset once and exits.

import 'dotenv/config';
import { refreshAll } from '../src/pipeline.js';

refreshAll()
  .then((m) => {
    console.log('Refresh complete.', m?.ok ? 'All datasets OK.' : 'Some datasets failed — see above.');
    process.exit(m?.ok ? 0 : 1);
  })
  .catch((err) => {
    console.error('Refresh failed:', err);
    process.exit(1);
  });
