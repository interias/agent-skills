// The sessions for the ship list (#41): `claude agents --json` per account, only the folder name and
// a few labels leave the machine, never a path or a pid; trouble gives an empty list.

import { describe, expect, it } from 'vitest';
import type { AsyncAufrufer } from '../src/aufruf.ts';
import { letzterName, liesSitzungen, sitzungenAusJson } from '../src/treiber/sitzungen.ts';

// invented patterns, never a real path
const WIN = 'C:\\Users\\beispiel\\git\\flotte-probe';
const UNIX = '/home/beispiel/git/notizen/';

const eintrag = (cwd: string, o: object = {}) => ({ pid: 4242, cwd, kind: 'interactive', startedAt: Date.parse('2026-11-20T12:02:00Z'), sessionId: 'abc-123', name: 'flotte-probe-ab', status: 'busy', ...o });

describe('sitzungen', () => {
  it('takes the last folder name of a Windows and a Unix path, never more', () => {
    expect(letzterName(WIN)).toBe('flotte-probe');
    expect(letzterName(UNIX)).toBe('notizen');
    expect(letzterName('C:\\')).toBe('');
    expect(letzterName(undefined)).toBe('');
  });

  it('keeps konto, projekt, name, status, kind and seit: no cwd, no pid, no session id', () => {
    const s = sitzungenAusJson([eintrag(WIN), eintrag(UNIX, { status: 'idle', name: 'notizen-cd' })], 'Konto 2');
    expect(s).toEqual([
      { konto: 'Konto 2', projekt: 'flotte-probe', name: 'flotte-probe-ab', status: 'busy', kind: 'interactive', seit: '2026-11-20T12:02:00.000Z' },
      { konto: 'Konto 2', projekt: 'notizen', name: 'notizen-cd', status: 'idle', kind: 'interactive', seit: '2026-11-20T12:02:00.000Z' },
    ]);
    const text = JSON.stringify(s);
    for (const verboten of ['beispiel', 'Users', 'home', '4242', 'abc-123', 'cwd', 'pid']) expect(text).not.toContain(verboten);
  });

  it('a name that is a path shrinks like the folder; odd values are dropped, not passed on', () => {
    const [s] = sitzungenAusJson([eintrag(WIN, { name: UNIX, status: '../x', kind: 7, startedAt: 'gestern' })], 'Konto 1');
    expect(s).toMatchObject({ name: 'notizen', status: '', kind: '', seit: '' });
    expect(sitzungenAusJson({ nicht: 'eine Liste' }, 'Konto 1')).toEqual([]);
    expect(sitzungenAusJson([null, 5, 'x'], 'Konto 1')).toEqual([]);
  });

  it('asks every account once, read only, with its own CLAUDE_CONFIG_DIR and a time limit', async () => {
    const aufrufe: { args: string[]; dir?: string; zeit?: number }[] = [];
    const langsam: AsyncAufrufer = async (_p, args, opts) => {
      aufrufe.push({ args, dir: opts?.env?.CLAUDE_CONFIG_DIR, zeit: opts?.timeoutMs });
      return { code: 0, stdout: JSON.stringify([eintrag(opts?.env?.CLAUDE_CONFIG_DIR === 'k1' ? WIN : UNIX)]), stderr: '' };
    };
    const s = await liesSitzungen([{ dir: 'k1', konto: 'Konto 1' }, { dir: 'k2', konto: 'Konto 2' }], langsam, 'claude');
    expect(aufrufe.map((a) => a.args)).toEqual([['agents', '--json'], ['agents', '--json']]);
    expect(aufrufe.map((a) => a.dir)).toEqual(['k1', 'k2']);
    expect(aufrufe.every((a) => a.zeit && a.zeit <= 10_000)).toBe(true);
    expect(s.map((x) => [x.konto, x.projekt])).toEqual([['Konto 1', 'flotte-probe'], ['Konto 2', 'notizen']]);
  });

  it('a missing command, an error exit, bad JSON and a timeout give an empty list for that account only', async () => {
    const langsam: AsyncAufrufer = async (_p, _a, opts) => {
      const dir = opts?.env?.CLAUDE_CONFIG_DIR;
      if (dir === 'fehlt') throw new Error('spawn claude ENOENT');
      if (dir === 'kaputt') return { code: 1, stdout: '', stderr: 'Fehler' };
      if (dir === 'text') return { code: 0, stdout: 'kein JSON', stderr: '' };
      if (dir === 'zeit') return { code: 1, stdout: '', stderr: 'Zeitgrenze 10000 ms' };
      return { code: 0, stdout: JSON.stringify([eintrag(WIN)]), stderr: '' };
    };
    const konten = ['fehlt', 'kaputt', 'text', 'zeit', 'gut'].map((dir) => ({ dir, konto: `K ${dir}` }));
    const s = await liesSitzungen(konten, langsam, 'claude');
    expect(s.map((x) => x.konto)).toEqual(['K gut']);
  });
});
