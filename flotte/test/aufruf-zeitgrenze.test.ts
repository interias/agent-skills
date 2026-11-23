// #108: the time limit of a call with shell: true ends the whole process tree, not only the shell
// (test_commands of the adapter run that way; an orphaned test run holds RAM and ports).

import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aufrufenAsync, beendeGruppen } from '../src/aufruf.ts';

const lebt = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** shell -> bun (a script) -> a grandchild that outlives any limit; the grandchild's pid goes to pidDatei */
function baum() {
  const dir = mkdtempSync(join(tmpdir(), 'flotte-zeit-'));
  const pidDatei = join(dir, 'kind.pid');
  const skript = join(dir, 'baum.ts');
  writeFileSync(
    skript,
    `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const k = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true });
writeFileSync(${JSON.stringify(pidDatei)}, String(k.pid));
setTimeout(() => {}, 60000);
`,
  );
  return { dir, skript, pidDatei };
}

describe('Zeitgrenze mit shell: true (#108)', () => {
  it('ends the child of the shell too: after the limit no process of the tree lives', async () => {
    const { dir, skript, pidDatei } = baum();
    const beginn = Date.now();
    const r = await aufrufenAsync(`"${process.execPath}" "${skript}"`, [], { cwd: dir, shell: true, timeoutMs: 3000 });
    // the call returns at the limit, not after the 60 s of the tree
    expect(Date.now() - beginn).toBeLessThan(20_000);
    expect(r.stderr).toMatch(/Zeitgrenze 3000 ms/);
    expect(existsSync(pidDatei)).toBe(true);
    const kind = Number(readFileSync(pidDatei, 'utf8'));
    for (let i = 0; i < 40 && lebt(kind); i++) await new Promise((w) => setTimeout(w, 100));
    expect(lebt(kind)).toBe(false);
  }, 30_000);

  it.skipIf(process.platform === 'win32')('the program exiting ends the process group of a shell call still running (Ctrl+C, SIGTERM)', async () => {
    const { dir, skript, pidDatei } = baum();
    const lauf = aufrufenAsync(`"${process.execPath}" "${skript}"`, [], { cwd: dir, shell: true, timeoutMs: 60_000 });
    for (let i = 0; i < 100 && !existsSync(pidDatei); i++) await new Promise((w) => setTimeout(w, 100));
    const kind = Number(readFileSync(pidDatei, 'utf8'));
    expect(lebt(kind)).toBe(true);
    // what process.on('exit') runs when the signal handler calls process.exit(130)
    beendeGruppen();
    await lauf;
    for (let i = 0; i < 40 && lebt(kind); i++) await new Promise((w) => setTimeout(w, 100));
    expect(lebt(kind)).toBe(false);
  }, 30_000);
});
