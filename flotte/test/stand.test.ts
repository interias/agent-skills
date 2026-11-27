// #154: the stand of the installed skill set, a newer main of its source, and the update as an
// attrappe records it (never a real install.ps1, docker or restart here).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aufrufen, aufrufenAsync, type Aufrufer, type Ergebnis } from '../src/aufruf.ts';
import { quelleMitOrigin } from './flotte-welt.ts';
import { einspielen, HUELLE, huelle, liesStand, mainStand, mitSperre, NEUSTART, neustartAufruf, prTitel, STAND_MS, type SkillStand } from '../src/treiber/stand.ts';

describe('Stand des Skill-Satzes (#154)', () => {
  it('reads stand.json as install.ps1 writes it (also with a BOM); anything else is no stand', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flotte-standdatei-'));
    const datei = join(dir, 'stand.json');
    writeFileSync(datei, '\uFEFF{"commit":"0123456789abcdef0123456789abcdef01234567","datum":"2026-11-20T10:00:00+01:00","installiert":"2026-11-21T08:00:00","quelle":"C:\\\\q"}');
    expect(liesStand(datei)).toEqual({ commit: '0123456789abcdef0123456789abcdef01234567', datum: '2026-11-20T10:00:00+01:00', installiert: '2026-11-21T08:00:00', quelle: 'C:\\q' });
    writeFileSync(datei, '{"commit":"kein commit","quelle":"q"}');
    expect(liesStand(datei)).toBeNull();
    expect(liesStand(join(dir, 'fehlt.json'))).toBeNull();
  });

  it('the title of the pull request from a merge commit of GitHub or Gitea, else the subject', () => {
    expect(prTitel('Merge pull request #155 from interias/epic/149\n\nSchnittplan: Triage fasst Notizen\n')).toBe('Schnittplan: Triage fasst Notizen');
    expect(prTitel("Merge pull request 'Werft zieht nach' (#12) from epic/12 into main")).toBe('Werft zieht nach');
    expect(prTitel('feat(flotte): Brücke zeigt den Stand (#154)\n\nText')).toBe('feat(flotte): Brücke zeigt den Stand (#154)');
  });

  it('asks the source at most every 15 minutes', () => {
    expect(STAND_MS).toBe(15 * 60_000);
  });

  it('a newer commit on main of the origin: commit, date and the title of its pull request; the installed one is no news', async () => {
    const q = quelleMitOrigin();
    const s: SkillStand = { commit: q.alt, datum: '', installiert: null, quelle: q.quelle };
    const r = await mainStand(aufrufenAsync, s);
    expect(r?.neu).toMatchObject({ commit: q.neu, titel: 'Schnittplan: Triage fasst Notizen' });
    expect(r?.neu?.datum).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await mainStand(aufrufenAsync, { ...s, commit: q.neu })).toEqual({ neu: null });
    // no origin (offline, a copy without remote): nothing to say
    const ohne = mkdtempSync(join(tmpdir(), 'flotte-ohne-'));
    aufrufen('git', ['init', '-q', ohne]);
    expect(await mainStand(aufrufenAsync, { ...s, quelle: ohne })).toBeNull();
  }, 30_000);
});

describe('Einspielen (#154): die Schritte in ihrer Reihenfolge, als Attrappe', () => {
  const quelle = mkdtempSync(join(tmpdir(), 'flotte-quelle-'));
  writeFileSync(join(quelle, 'install.ps1'), '# attrappe');
  mkdirSync(join(quelle, 'flottenbruecke'), { recursive: true });
  const s: SkillStand = { commit: 'aaaaaaa1111111111111111111111111111111111', datum: '', installiert: null, quelle };
  function attrappe(o: { status?: string; zweig?: string; diff?: number; install?: number; docker?: number } = {}) {
    const schritte: string[] = [];
    const umgebung: Record<string, string | undefined>[] = [];
    const ok = (stdout = ''): Ergebnis => ({ code: 0, stdout, stderr: '' });
    const a: Aufrufer = (programm, args, opts) => {
      const g = programm === 'git' ? args.slice(2) : [];
      if (programm === 'git') schritte.push(`git ${g.join(' ')}`);
      else schritte.push(`${programm} ${args.join(' ')} @${opts?.cwd ?? ''}`);
      if (programm === 'docker') umgebung.push({ BRUECKE_COMMIT: opts?.env?.BRUECKE_COMMIT, BRUECKE_DATUM: opts?.env?.BRUECKE_DATUM });
      if (programm === 'wsl.exe') umgebung.push({ BRUECKE_COMMIT: opts?.env?.BRUECKE_COMMIT, WSLENV: opts?.env?.WSLENV });
      if (programm === 'docker' && o.docker) return { code: o.docker, stdout: '', stderr: 'ENOENT' };
      if (g[0] === 'status') return ok(o.status ?? '');
      if (g[0] === 'rev-parse' && g[1] === '--abbrev-ref') return ok(`${o.zweig ?? 'main'}\n`);
      if (g[0] === 'rev-parse') return ok('bbbbbbb2222222222222222222222222222222222\n');
      if (g[0] === 'log') return ok('2026-11-23T09:00:00+01:00\n');
      if (g[0] === 'diff') return { code: o.diff ?? 1, stdout: '', stderr: '' };
      if (programm === 'powershell') return { code: o.install ?? 0, stdout: 'Done.', stderr: '' };
      return ok();
    };
    return { a, schritte, umgebung };
  }
  const jetzt = () => Date.parse('2026-11-23T10:00:00Z');

  it('flottenbruecke/ changed since the image: pull, install.ps1, then the bridge is built with its commit and date', () => {
    const x = attrappe({ diff: 1 });
    const r = einspielen(x.a, s, 'ccccccc', jetzt);
    expect(x.schritte).toEqual([
      'git status --porcelain',
      'git rev-parse --abbrev-ref HEAD',
      'git pull --ff-only origin main',
      'git rev-parse HEAD',
      'git log -1 --format=%cI HEAD',
      `powershell -NoProfile -ExecutionPolicy Bypass -File ${join(quelle, 'install.ps1')} -OhneBruecke @${quelle}`,
      'git diff --quiet ccccccc HEAD -- flottenbruecke/',
      `docker compose up -d --build @${join(quelle, 'flottenbruecke')}`,
    ]);
    expect(x.umgebung).toEqual([{ BRUECKE_COMMIT: 'bbbbbbb2222222222222222222222222222222222', BRUECKE_DATUM: '2026-11-23T09:00:00+01:00' }]);
    expect(r).toEqual({ zeit: '2026-11-23T10:00:00.000Z', von: s.commit, auf: 'bbbbbbb2222222222222222222222222222222222', datum: '2026-11-23T09:00:00+01:00', bruecke: 'gebaut', fehler: null });
  });

  it('no docker on PATH (127): the bridge is built by docker in WSL, WSLENV carries commit and date; another docker error is no reason', () => {
    const x = attrappe({ diff: 1, docker: 127 });
    const r = einspielen(x.a, s, 'ccccccc', jetzt);
    expect(x.schritte.slice(-2)).toEqual([`docker compose up -d --build @${join(quelle, 'flottenbruecke')}`, `wsl.exe -e docker compose up -d --build @${join(quelle, 'flottenbruecke')}`]);
    expect(x.umgebung[1].BRUECKE_COMMIT).toBe('bbbbbbb2222222222222222222222222222222222');
    expect(x.umgebung[1].WSLENV?.split(':').slice(-2)).toEqual(['BRUECKE_COMMIT', 'BRUECKE_DATUM']);
    expect(r).toMatchObject({ bruecke: 'gebaut', fehler: null });
    const y = attrappe({ diff: 1, docker: 1 });
    expect(einspielen(y.a, s, 'ccccccc', jetzt).fehler).toMatch(/^docker compose/);
    expect(y.schritte.some((z) => z.startsWith('wsl.exe'))).toBe(false);
  });

  it('flottenbruecke/ unchanged: no build; a bridge without a known commit is built', () => {
    const x = attrappe({ diff: 0 });
    expect(einspielen(x.a, s, 'ccccccc', jetzt).bruecke).toBe('unveraendert');
    expect(x.schritte.some((z) => z.startsWith('docker'))).toBe(false);
    const y = attrappe({ diff: 0 });
    expect(einspielen(y.a, s, null, jetzt).bruecke).toBe('gebaut');
    expect(y.schritte.some((z) => z.startsWith('git diff'))).toBe(false);
  });

  it('a source that is not clean or not on main: nothing is pulled, installed or built', () => {
    for (const o of [{ status: ' M install.ps1\n' }, { zweig: 'epic/159' }]) {
      const x = attrappe(o);
      const r = einspielen(x.a, s, 'ccccccc', jetzt);
      expect(r.auf).toBeNull();
      expect(r.fehler).toMatch(/nicht sauber|nicht auf main/);
      expect(x.schritte.some((z) => /pull|powershell|docker/.test(z))).toBe(false);
    }
  });

  it('installed already by another driver (for all): pulled, but neither installed nor built again', () => {
    const x = attrappe({ diff: 1 });
    const r = einspielen(x.a, { ...s, commit: 'bbbbbbb2222222222222222222222222222222222' }, 'ccccccc', jetzt);
    expect(r).toMatchObject({ auf: 'bbbbbbb2222222222222222222222222222222222', bruecke: 'unveraendert', fehler: null });
    expect(x.schritte.some((z) => /powershell|docker|git diff/.test(z))).toBe(false);
  });

  it('one update at a time on the machine: the lock is held while it runs and gone after; a stale one is taken over', () => {
    const datei = join(mkdtempSync(join(tmpdir(), 'flotte-sperre-')), 'einspielen.lock');
    expect(mitSperre(() => existsSync(datei), datei)).toBe(true);
    expect(existsSync(datei)).toBe(false);
    writeFileSync(datei, '1');
    expect(mitSperre(() => 'weiter', datei, () => Date.now() + 31 * 60_000)).toBe('weiter');
    expect(existsSync(datei)).toBe(false);
    // Ctrl+C during install.ps1 left it: its process is gone, the next update does not wait 30 minutes
    writeFileSync(datei, String(spawnSync(process.execPath, ['-e', '0']).pid));
    expect(mitSperre(() => 'sofort', datei)).toBe('sofort');
  });

  it('install.ps1 fails: no bridge is built, the error is kept', () => {
    const x = attrappe({ install: 1 });
    const r = einspielen(x.a, s, 'ccccccc', jetzt);
    expect(r.fehler).toMatch(/^install\.ps1 Exit 1/);
    expect(x.schritte.some((z) => /docker/.test(z))).toBe(false);
  });

  it('the restart takes the same command line: program, script, arguments and folder', () => {
    const argv = ['C:\\bun\\bun.exe', 'C:\\skills\\flotte\\src\\cli.ts', 'fahren', '--konten', '1,2', '--bruecke', 'http://127.0.0.1:4747'];
    expect(neustartAufruf(argv, 'C:\\bun\\bun.exe', 'C:\\projekt')).toEqual({ programm: 'C:\\bun\\bun.exe', args: argv.slice(1), cwd: 'C:\\projekt' });
  });

  it('the hull starts the same command line again while the driver ends with NEUSTART, and ends with any other code', () => {
    const n = { programm: 'C:\\bun\\bun.exe', args: ['C:\\skills\\flotte\\src\\cli.ts', 'fahren', '--konten', '1'], cwd: 'C:\\projekt' };
    for (const [codes, ende] of [[[NEUSTART, NEUSTART, 0], 0], [[NEUSTART, 130], 130], [[null], 1]] as [(number | null)[], number][]) {
      const aufrufe: { programm: string; args: string[]; cwd: string; huelle: string | undefined }[] = [];
      const rest = [...codes];
      const starte = (programm: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv }) => {
        aufrufe.push({ programm, args, cwd: o.cwd, huelle: o.env[HUELLE] });
        return rest.length ? rest.shift()! : 0;
      };
      expect(huelle(starte, n, { PATH: 'x' })).toBe(ende);
      expect(aufrufe).toHaveLength(codes.length);
      for (const x of aufrufe) expect(x).toEqual({ ...n, huelle: '1' });
    }
  });
});
