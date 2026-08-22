import Module from 'node:module';

delete process.env.CRS_MONITOR_TURSO_URL;
delete process.env.CRS_MONITOR_TURSO_AUTH_TOKEN;

// See verify-crs-matching.ts for why this stub is needed to run outside
// Next's own build (which aliases 'server-only' to an empty module).
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...args: unknown[]) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, ...args);
};

import { CrsMonitorError } from '../lib/crs-monitor/types';

async function main() {
  // Dynamic import, not a static one: turso.ts itself does `import
  // 'server-only'` at module scope (unlike the old client.ts, which
  // didn't), and a static import gets hoisted ahead of the Module._load
  // patch above during ESM module linking — the patch would never get a
  // chance to intercept it. A dynamic import() happens at runtime, after
  // the patch is installed, same as matchServer.ts's own import of it in
  // verify-crs-matching.ts.
  const { getSubjects } = await import('../lib/crs-monitor/turso');
  console.log('Module imported successfully with CRS_MONITOR_TURSO_URL/CRS_MONITOR_TURSO_AUTH_TOKEN unset (no crash at import time).');
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
