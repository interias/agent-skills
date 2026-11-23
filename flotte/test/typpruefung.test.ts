// #163: the type check runs with the suite, so the gate (bun test) reports a type error without an extra step.
// tsc of the local TypeScript over src and test (tsconfig.json); red with its output: file, line, error text.

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aufrufenAsync } from '../src/aufruf.ts';

const FLOTTE = fileURLToPath(new URL('..', import.meta.url));
const TSC = join(FLOTTE, 'node_modules', 'typescript', 'bin', 'tsc');

describe('Typprüfung (#163)', () => {
  it('tsc -p . finds no type error in src and test', async () => {
    // without devDependencies red with a clear message, never skipped quietly
    expect(existsSync(TSC), 'TypeScript nicht installiert: `bun install` in flotte/').toBe(true);
    const r = await aufrufenAsync(process.execPath, [TSC, '-p', '.'], { cwd: FLOTTE, timeoutMs: 280_000 });
    // the whole output in the message, so a red run names file, line and error
    expect(r.code, `tsc -p . (Exit ${r.code}):\n${(r.stdout + r.stderr).trim()}`).toBe(0);
  }, 300_000);
});
