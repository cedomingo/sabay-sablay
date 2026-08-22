import Module from 'node:module';

delete process.env.CRS_MONITOR_API_URL;

// See verify-crs-matching.ts for why this stub is needed to run outside
// Next's own build (which aliases 'server-only' to an empty module).
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...args: unknown[]) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, ...args);
};

import { getSubjects } from '../lib/crs-monitor/client';
import { CrsMonitorError } from '../lib/crs-monitor/types';

async function main() {
  console.log('Module imported successfully with CRS_MONITOR_API_URL unset (no crash at import time).');
  try {
    await getSubjects();
    console.log('FAIL: expected getSubjects() to throw');
    process.exit(1);
  } catch (e) {
    if (e instanceof CrsMonitorError) {
      console.log(`PASS: getSubjects() threw CrsMonitorError -> "${e.message}"`);
      console.log('This is what app/api/schedule/enrich/route.ts checks for to return the graceful crs_unreachable result instead of a 500.');
    } else {
      console.log('FAIL: threw something other than CrsMonitorError ->', e);
      process.exit(1);
    }
  }
}

main();
