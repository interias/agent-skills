// Step 8 of the gate rework: flotte nachtlauf, the full run of the project without a cache on origin/<base> in its
// own worktree. A real repository with a bare origin; worktree.ps1, the night command and the forge are stand-ins.

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { aufrufen, type AsyncAufrufer, type Aufrufer } from '../src/aufruf.ts';
import { andockblock, BEFEHL_MS, HALT_DATEI, liesHalt, liesNachtlauf, nachtlauf, type NachtWelt, ohnePfade, SPERRE, VERFALL_MS } from '../src/befehle/nachtlauf.ts';
import { githubZugriff } from '../src/forge/github.ts';
import { giteaZugriff } from '../src/forge/gitea.ts';
import type { ForgeZugriff } from '../src/forge/zugriff.ts';
import { flotteDir } from '../src/werkzeuge/zustand.ts';
import { type Bestand, bestand, ghAttrappe, GITEA_API, giteaAttrappe, issueAnlegen } from './forge-attrappen.ts';

const T = 60_000;

const git = (cwd: string, ...a: string[]) => {
  const r = aufrufen('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  if (r.code) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const ADAPTER = 'forge: github\nbase_branch: main\ngate_night_command: pwsh -NoProfile -File ./gate.ps1';

const block = (basis: string, teile: [string, boolean][]) => {
  const gruen = teile.every(([, g]) => g);
  return `== Gate: Basis origin/main @ ${basis.slice(0, 7)} (HEAD ${basis.slice(0, 8)})\n${teile.map(([n, g]) => `  ${n.padEnd(8)} ${g ? 'grün' : 'ROT'}     12 s`).join('\n')}\n${gruen ? 'Gate grün.' : 'Gate ROT.'}`;
};

/** a project with origin; each call of the night command takes the next output (a function of the commit it runs on) */
function welt(o: { adapter?: string; ausgaben?: ((commit: string) => { code: number; stdout: string })[]; forge?: 'github' | 'gitea'; logbuch?: boolean } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), 'flotte-nacht-'));
  const origin = join(wurzel, 'origin.git');
  const repo = join(wurzel, 'repo');
  aufrufen('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  aufrufen('git', ['clone', '-q', origin, repo]);
  git(repo, 'checkout', '-q', '-b', 'main');
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, '.claude', 'epic.md'), `---\n${o.adapter ?? ADAPTER}\nworktree_root: ../wt\n---\n# Adapter\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'start');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  const b: Bestand = bestand();
  if (o.logbuch !== false) issueAnlegen(b, { titel: 'Flottenlogbuch', labels: ['flotte'] });
  const roh: ForgeZugriff = o.forge === 'gitea' ? giteaZugriff(giteaAttrappe(b), GITEA_API(b), () => 'token geheim', 'epic', 0) : githubZugriff(ghAttrappe(b), 'o/r');
  // haken: runs once at the first call of the forge after the night command ran (a person acting meanwhile)
  let haken: (() => void) | null = null;
  let befehlGelaufen = false;
  const forge = new Proxy(roh, {
    get(z, k) {
      const f = (z as unknown as Record<string | symbol, unknown>)[k];
      if (typeof f !== 'function') return f;
      return (...a: unknown[]) => {
        if (befehlGelaufen && haken) {
          const h = haken;
          haken = null;
          h();
        }
        return f.apply(z, a);
      };
    },
  });
  const befehle: { befehl: string; cwd: string; commit: string }[] = [];
  const optionen: { timeoutMs?: number; baum?: boolean }[] = [];
  const skripte: { aktion: string; args: string[]; env?: Record<string, string> }[] = [];
  const ausgaben = o.ausgaben ?? [(c) => ({ code: 0, stdout: `bun test ...\n${block(c, [['flotte', true]])}\n` })];
  const aufrufer: Aufrufer = (p, a, opts) => aufrufen(p, a, opts);
  const langsam: AsyncAufrufer = async (p, a, opts) => {
    if (p === 'git') return aufrufen(p, a, opts);
    if (p === 'pwsh' && a.includes('-File')) {
      const aktion = a[a.indexOf('-Action') + 1];
      skripte.push({ aktion, args: a, env: opts?.env as Record<string, string> | undefined });
      const lock = join(repo, '.git', 'epic-locks', 'nachtlauf.json');
      const pfad = join(wurzel, 'wt', 'nachtlauf');
      if (aktion === 'Up') {
        const r = aufrufen('git', ['-C', repo, 'worktree', 'add', '--detach', pfad, a[a.indexOf('-From') + 1]]);
        if (r.code) return { code: 1, stdout: '', stderr: r.stderr };
        mkdirSync(join(lock, '..'), { recursive: true });
        writeFileSync(lock, JSON.stringify({ package: 'nachtlauf', worktree: pfad, holder: opts?.env?.EPIC_LOCK_HOLDER ?? null }));
        return { code: 0, stdout: `${JSON.stringify({ path: pfad, branch: null })}\n`, stderr: '' };
      }
      if (aktion === 'Down') {
        aufrufen('git', ['-C', repo, 'worktree', 'remove', '--force', pfad]);
        rmSync(lock, { force: true });
        return { code: 0, stdout: '{}\n', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: `unerwartet: ${aktion}` };
    }
    if (p === 'pwsh' && a.includes('-Command')) {
      const commit = git(opts!.cwd!, 'rev-parse', 'HEAD');
      befehlGelaufen = true;
      optionen.push({ timeoutMs: opts?.timeoutMs, baum: opts?.baum });
      befehle.push({ befehl: a[a.indexOf('-Command') + 1], cwd: opts!.cwd!, commit });
      const f = ausgaben[Math.min(befehle.length - 1, ausgaben.length - 1)];
      return { ...f(commit), stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unerwartet: ${p}` };
  };
  const w: Partial<NachtWelt> = { aufrufer, langsam, forge: () => forge, skripte: join(wurzel, 'skripte') };
  /** a new commit on origin/main */
  const weiter = (name: string) => {
    writeFileSync(join(repo, `${name}.txt`), name);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', name);
    git(repo, 'push', '-q', 'origin', 'main');
    return git(repo, 'rev-parse', 'HEAD');
  };
  const dir = flotteDir(repo);
  const kommentare = (nr: number) => b.issues.find((i) => i.nummer === nr)!.kommentare.map((k) => k.body);
  /** fn runs at the first call of the forge after the next night command */
  const nachDemBefehl = (fn: () => void) => {
    befehlGelaufen = false;
    haken = fn;
  };
  return { wurzel, repo, b, w, befehle, optionen, skripte, weiter, dir, kommentare, nachDemBefehl, kopf: () => git(repo, 'rev-parse', 'origin/main') };
}

const fahre = (t: ReturnType<typeof welt>, ...argv: string[]) => nachtlauf([t.repo, '--forge', 'o/r', ...argv], t.w) as Promise<Record<string, unknown>>;
const rot = (teil: string) => (c: string) => ({ code: 1, stdout: `(fail) etwas > kaputt\n${block(c, [['flotte', teil !== 'flotte'], ['pester', teil !== 'pester']])}\n` });
const gruen = (c: string) => ({ code: 0, stdout: `${block(c, [['flotte', true], ['pester', true]])}\n` });
const triage = (b: Bestand) => b.issues.filter((i) => i.labels.includes('needs-triage'));

describe('flotte nachtlauf (Schritt 8 des Gate-Umbaus)', () => {
  it('without gate_night_command in the adapter there is no night run: it says so and ends without an error, touching nothing', async () => {
    const t = welt({ adapter: 'forge: github\ngate_command: pwsh -NoProfile -File ./gate.ps1' });
    const r = await fahre(t);
    expect(r.nachtlauf).toBe('aus');
    expect(String(r.grund)).toMatch(/gate_night_command/);
    expect(t.befehle).toHaveLength(0);
    expect(t.skripte).toHaveLength(0);
    expect(existsSync(join(t.dir, 'nachtlauf.json'))).toBe(false);
  }, T);

  it('green: the night command runs in its own worktree on a detached origin/<base>, with its log; result in the fleet state and the logbook, no halt', async () => {
    const t = welt();
    const r = await fahre(t);
    expect(r.ergebnis).toBe('gruen');
    // worktree.ps1 Up the way the driver lays out a worktree, detached, with a holder file so CleanupStale spares it
    expect(t.skripte.map((s) => s.aktion)).toEqual(['Up']);
    const up = t.skripte[0].args;
    expect(up).toEqual(expect.arrayContaining(['-Package', 'nachtlauf', '-Detach', '-From', 'origin/main', '-SessionPid', String(process.pid)]));
    expect(up).not.toContain('-Branch');
    expect(existsSync(t.skripte[0].env!.EPIC_LOCK_HOLDER)).toBe(true);
    expect(t.befehle).toEqual([{ befehl: 'pwsh -NoProfile -File ./gate.ps1', cwd: join(t.wurzel, 'wt', 'nachtlauf'), commit: t.kopf() }]);
    // at its time limit the whole process tree ends, not only the outer pwsh (a hanging test would hold the worktree)
    expect(t.optionen).toEqual([{ timeoutMs: BEFEHL_MS, baum: true }]);
    const s = liesNachtlauf(t.dir);
    expect(s.letzter).toMatchObject({ ergebnis: 'gruen', commit: t.kopf(), basis: 'main', wiederholt: false, teile: [] });
    expect(s.letzter!.dauerS).toBeGreaterThanOrEqual(0);
    expect(Date.parse(s.letzter!.zeit)).not.toBeNaN();
    // the log path is relative to the fleet's state folder and holds the output
    expect(s.letzter!.log).toMatch(/^nachtlauf[\\/][^:]+-1\.log$/);
    expect(readFileSync(join(t.dir, s.letzter!.log!), 'utf8')).toContain('Gate grün.');
    expect(liesHalt(t.dir)).toBeNull();
    expect(triage(t.b)).toHaveLength(0);
    expect(t.kommentare(1).join('\n')).toMatch(/^\*\*Flotte \(Nachtlauf\)\*\* — Nachtlauf grün auf origin\/main @ [0-9a-f]{7}/);
    expect(t.kommentare(1).join('\n')).not.toContain(t.wurzel);
    // the lock is released
    expect(existsSync(join(t.dir, SPERRE))).toBe(false);
  }, T);

  it('the next night reuses its worktree and moves it to the new origin/<base>', async () => {
    const t = welt();
    await fahre(t);
    const neu = t.weiter('zwei');
    await fahre(t);
    expect(t.skripte.map((s) => s.aktion)).toEqual(['Up']);
    expect(t.befehle.map((b) => b.commit)).toEqual([expect.any(String), neu]);
    expect(liesNachtlauf(t.dir).verlauf.map((v) => v.commit)).toEqual([t.befehle[0].commit, neu]);
  }, T);

  it('keeps the last 30 results and only their logs', async () => {
    const t = welt();
    const alt = Array.from({ length: 30 }, (_, i) => ({ ergebnis: 'gruen', commit: 'a'.repeat(40), basis: 'main', zeit: new Date(Date.UTC(2026, 9, i + 1, 2, 30)).toISOString(), dauerS: 60, log: null, wiederholt: false, teile: [] }));
    mkdirSync(join(t.dir, 'nachtlauf'), { recursive: true });
    const stempel = (z: string) => z.replace(/[:.]/g, '-');
    for (const a of alt) writeFileSync(join(t.dir, 'nachtlauf', `${stempel(a.zeit)}-1.log`), 'x');
    writeFileSync(join(t.dir, 'nachtlauf.json'), JSON.stringify({ letzter: alt.at(-1), verlauf: alt }));
    await fahre(t);
    const s = liesNachtlauf(t.dir);
    expect(s.verlauf).toHaveLength(30);
    expect(s.verlauf[0].zeit).toBe(alt[1].zeit);
    expect(existsSync(join(t.dir, 'nachtlauf', `${stempel(alt[0].zeit)}-1.log`))).toBe(false);
    expect(existsSync(join(t.dir, 'nachtlauf', `${stempel(alt[1].zeit)}-1.log`))).toBe(true);
    expect(existsSync(join(t.dir, s.letzter!.log!))).toBe(true);
  }, T);

  it('red, then green in the repeat: no halt, but the first red is noted', async () => {
    const t = welt({ ausgaben: [rot('pester'), gruen] });
    const r = await fahre(t);
    expect(r.ergebnis).toBe('gruen');
    expect(t.befehle).toHaveLength(2);
    const s = liesNachtlauf(t.dir).letzter!;
    expect(s).toMatchObject({ ergebnis: 'gruen', wiederholt: true, erstesRot: ['pester'] });
    expect(s.log).toMatch(/-2\.log$/);
    expect(liesHalt(t.dir)).toBeNull();
    expect(triage(t.b)).toHaveLength(0);
    expect(t.kommentare(1).at(-1)).toMatch(/grün erst in der Wiederholung \(der erste Lauf war rot: pester\)/);
  }, T);

  it('red, and red again in the repeat: the merge queue holds and an issue with needs-triage names the red part, the commit and how to release', async () => {
    const t = welt({ ausgaben: [rot('flotte')] });
    const r = await fahre(t);
    expect(r.ergebnis).toBe('rot');
    expect(t.befehle).toHaveLength(2);
    const h = liesHalt(t.dir)!;
    const issue = triage(t.b);
    expect(issue).toHaveLength(1);
    expect(h).toMatchObject({ commit: t.kopf(), basis: 'main', issue: issue[0].nummer, teile: ['flotte'] });
    expect(h.grund).toMatch(/Nachtlauf rot auf origin\/main @ [0-9a-f]{7}, auch in der Wiederholung \(rot: flotte\)/);
    expect(issue[0].titel).toMatch(/^Nachtlauf rot: origin\/main @ [0-9a-f]{7}, Andock-Schlange hält$/);
    // one sentence of cause, the lines of the gate block and nothing else of the log; no local path
    expect(issue[0].body).toMatch(/rot \(flotte\), auch in der Wiederholung/);
    expect(issue[0].body).toContain('  flotte   ROT');
    expect(issue[0].body).toContain('flotte nachtlauf --freigeben');
    expect(issue[0].body).not.toContain('(fail) etwas');
    expect(issue[0].body).not.toContain(t.wurzel);
    expect(issue[0].body).not.toMatch(/[A-Za-z]:\\/);
    expect(t.kommentare(1).at(-1)).toMatch(/Andock-Schlange hält, Issue #\d+/);
    expect(liesNachtlauf(t.dir).letzter).toMatchObject({ ergebnis: 'rot', teile: ['flotte'], erstesRot: ['flotte'] });
  }, T);

  it('a second red night while the halt stands comments on the issue instead of opening a new one', async () => {
    const t = welt({ ausgaben: [rot('flotte')] });
    await fahre(t);
    const nr = liesHalt(t.dir)!.issue!;
    const seit = liesHalt(t.dir)!.seit;
    t.weiter('zwei');
    await fahre(t);
    expect(triage(t.b)).toHaveLength(1);
    expect(t.kommentare(nr).at(-1)).toMatch(/wieder rot auf origin\/main @ [0-9a-f]{7}[\s\S]*flotte nachtlauf --freigeben/);
    // the halt keeps its start, the commit moves on
    expect(liesHalt(t.dir)).toMatchObject({ seit, issue: nr, commit: t.kopf() });
  }, T);

  it('a later green night notes the green at the halt and in the issue, but does not release', async () => {
    const t = welt({ ausgaben: [rot('flotte'), rot('flotte'), gruen] });
    await fahre(t);
    const nr = liesHalt(t.dir)!.issue!;
    await fahre(t);
    expect(liesHalt(t.dir)).toMatchObject({ issue: nr, gruen: { commit: t.kopf() } });
    expect(t.kommentare(nr).at(-1)).toMatch(/grün auf origin\/main @ [0-9a-f]{7}\. Die Schlange hält weiter, bis ein Mensch freigibt/);
    expect(t.b.issues.find((i) => i.nummer === nr)!.offen).toBe(true);
  }, T);

  it('--freigeben releases the halt, notes it in the logbook and at the issue, and leaves the issue open; --stand shows it', async () => {
    const t = welt({ ausgaben: [rot('pester')] });
    await fahre(t);
    const nr = liesHalt(t.dir)!.issue!;
    const stand = await fahre(t, '--stand');
    expect(stand.halt).toMatchObject({ issue: nr });
    expect(stand.letzter).toMatchObject({ ergebnis: 'rot' });
    const r = await fahre(t, '--freigeben');
    expect(r.freigegeben).toBe(true);
    expect(existsSync(join(t.dir, HALT_DATEI))).toBe(false);
    expect(t.kommentare(1).at(-1)).toMatch(/Andock-Schlange freigegeben \(Halt seit .+, Issue #\d+ bleibt offen\)/);
    expect(t.kommentare(nr).at(-1)).toMatch(/freigegeben/);
    expect(t.b.issues.find((i) => i.nummer === nr)!.offen).toBe(true);
    // nothing left to release
    const nochmal = await fahre(t, '--freigeben');
    expect(nochmal.freigegeben).toBe(false);
    expect((await fahre(t, '--stand')).halt).toBeNull();
  }, T);

  it('two night runs of one project exclude each other; a lock past its expiry is taken over', async () => {
    const t = welt();
    // a living foreign process holds the lock
    writeFileSync(join(t.dir, SPERRE), JSON.stringify({ pid: 4242, seit: new Date().toISOString() }));
    await expect(nachtlauf([t.repo, '--forge', 'o/r'], { ...t.w, lebt: () => true })).rejects.toThrow(/Ein Nachtlauf läuft schon \(pid 4242/);
    expect(t.befehle).toHaveLength(0);
    // the same lock, older than its expiry: the process hangs or the pid was reused
    writeFileSync(join(t.dir, SPERRE), JSON.stringify({ pid: 4242, seit: new Date(Date.now() - VERFALL_MS - 60_000).toISOString() }));
    const r = (await nachtlauf([t.repo, '--forge', 'o/r'], { ...t.w, lebt: () => true })) as Record<string, unknown>;
    expect(r.ergebnis).toBe('gruen');
  }, T);

  it('a step around the command that fails (no worktree) is no red of the base: no halt, no issue, an error with its reason', async () => {
    const t = welt();
    t.w.langsam = async (p, a, opts) => (p === 'git' ? aufrufen(p, a, opts) : { code: 1, stdout: '', stderr: 'worktree.ps1: Env file x does not exist in the main checkout.' });
    await expect(fahre(t)).rejects.toThrow(/Worktree des Nachtlaufs nicht angelegt: worktree\.ps1: Env file x/);
    expect(liesHalt(t.dir)).toBeNull();
    expect(triage(t.b)).toHaveLength(0);
    expect(liesNachtlauf(t.dir).letzter).toMatchObject({ ergebnis: 'fehler', grund: 'Worktree nicht angelegt' });
    expect(t.kommentare(1).at(-1)).toMatch(/Nachtlauf nicht gefahren/);
  }, T);

  it('an error leaves the machine as its category only; the full text with its local path stays in nachtlauf.json', async () => {
    const t = welt();
    const pfad = 'C:\\Users\\jemand\\git\\app\\.git';
    t.w.langsam = async (p) => (p === 'git' ? { code: 128, stdout: '', stderr: `fatal: unable to access '${pfad}': Permission denied` } : { code: 1, stdout: '', stderr: 'unerwartet' });
    // the person at the terminal sees the full text
    await expect(fahre(t)).rejects.toThrow(/git fetch origin main scheiterte: .*jemand/);
    const l = liesNachtlauf(t.dir).letzter!;
    expect(l).toMatchObject({ ergebnis: 'fehler', grund: 'git fetch scheiterte' });
    expect(l.detail).toContain(pfad);
    expect(t.kommentare(1).at(-1)).toBe('**Flotte (Nachtlauf)** — Nachtlauf nicht gefahren: git fetch scheiterte; Einzelheiten am Rechner mit `flotte nachtlauf --stand`.');
  }, T);

  it('the path filter: drive, UNC and home paths become a placeholder, the rest of the line stays', () => {
    expect(ohnePfade('pytest --basetemp=C:\\Users\\jemand\\tmp\\x -> Exit 1')).toBe('pytest --basetemp=<pfad> -> Exit 1');
    expect(ohnePfade("fatal: 'd:/git/app' und \\\\server\\freigabe\\x, /home/jemand/y; /Users/jemand/z")).toBe("fatal: '<pfad>' und <pfad>, <pfad>; <pfad>");
    expect(ohnePfade('origin/main @ abc1234 https://github.com/o/r/issues/5 und src/a.ts')).toBe('origin/main @ abc1234 https://github.com/o/r/issues/5 und src/a.ts');
  });

  it('a line of the gate block with a local path goes into the issue filtered', async () => {
    const t = welt({
      ausgaben: [(c) => ({ code: 1, stdout: `== Gate: Basis origin/main @ ${c.slice(0, 7)} (HEAD ${c.slice(0, 8)})\n  bruecke  ROT     python -m pytest --basetemp=C:\\Users\\jemand\\tmp\\x -> Exit 1\n  skripte  ROT     \\\\server\\freigabe\\x, /home/jemand/y\nGate ROT.\n` })],
    });
    await fahre(t);
    const issue = triage(t.b)[0];
    expect(issue.body).toContain('  bruecke  ROT     python -m pytest --basetemp=<pfad> -> Exit 1');
    for (const s of ['jemand', 'C:\\', '\\\\server']) expect(issue.body).not.toContain(s);
    expect(liesHalt(t.dir)!.teile).toEqual(['bruecke', 'skripte']);
    t.weiter('zwei');
    await fahre(t);
    expect(t.kommentare(issue.nummer).at(-1)).toContain('--basetemp=<pfad>');
    expect(t.kommentare(issue.nummer).at(-1)).not.toContain('jemand');
  }, T);

  it('a gate block without its closing line leaves the machine as the fixed sentence only', async () => {
    const t = welt({ ausgaben: [(c) => ({ code: 1, stdout: `== Gate: Basis origin/main @ ${c.slice(0, 7)} (HEAD ${c.slice(0, 8)})\n  flotte   ROT     abgebrochen\n` })] });
    const r = await fahre(t);
    expect(r.ergebnis).toBe('rot');
    const issue = triage(t.b)[0];
    expect(issue.body).not.toContain('```');
    expect(issue.body).not.toContain('abgebrochen');
    expect(issue.body).toMatch(/^Der Nachtlauf \(`gate_night_command`\) ist auf `origin\/main @ [0-9a-f]{7}` rot, auch in der Wiederholung\./);
  }, T);

  it('a release while the night run is green does not bring the halt back', async () => {
    const t = welt({ ausgaben: [rot('flotte'), rot('flotte'), gruen] });
    await fahre(t);
    t.nachDemBefehl(() => rmSync(join(t.dir, HALT_DATEI)));
    await fahre(t);
    expect(liesHalt(t.dir)).toBeNull();
  }, T);

  it('a release while the night run is red again sets a fresh halt with a new start; the open issue is reused', async () => {
    const t = welt({ ausgaben: [rot('flotte')] });
    await fahre(t);
    const alt = liesHalt(t.dir)!;
    t.weiter('zwei');
    t.nachDemBefehl(() => rmSync(join(t.dir, HALT_DATEI)));
    await fahre(t);
    const neu = liesHalt(t.dir)!;
    expect(neu.seit).not.toBe(alt.seit);
    expect(neu).toMatchObject({ issue: alt.issue, commit: t.kopf() });
    expect(triage(t.b)).toHaveLength(1);
  }, T);

  it('--freigeben waits for the short lock around the halt file instead of racing a night run writing it', async () => {
    const t = welt({ ausgaben: [rot('flotte')] });
    await fahre(t);
    writeFileSync(join(t.dir, 'schlange-halt.lock'), JSON.stringify({ pid: 4242, seit: new Date().toISOString() }));
    const lauf = nachtlauf([t.repo, '--forge', 'o/r', '--freigeben'], { ...t.w, lebt: () => true }) as Promise<Record<string, unknown>>;
    await new Promise((w) => setTimeout(w, 300));
    expect(existsSync(join(t.dir, HALT_DATEI))).toBe(true);
    rmSync(join(t.dir, 'schlange-halt.lock'));
    expect((await lauf).freigegeben).toBe(true);
    expect(existsSync(join(t.dir, HALT_DATEI))).toBe(false);
  }, T);

  it('its own worktree registered without its lock (lost by hand) is laid out anew, not an error every night', async () => {
    const t = welt();
    await fahre(t);
    rmSync(join(t.repo, '.git', 'epic-locks', 'nachtlauf.json'));
    const r = await fahre(t);
    expect(r.ergebnis).toBe('gruen');
    expect(t.skripte.map((s) => s.aktion)).toEqual(['Up', 'Down', 'Up']);
  }, T);

  it('a lock that names another worktree (the main checkout) is never forced onto the base: an error, no halt', async () => {
    const t = welt();
    mkdirSync(join(t.repo, '.git', 'epic-locks'), { recursive: true });
    writeFileSync(join(t.repo, '.git', 'epic-locks', 'nachtlauf.json'), JSON.stringify({ package: 'nachtlauf', worktree: t.repo }));
    writeFileSync(join(t.repo, 'ungesichert.txt'), 'x');
    await expect(fahre(t)).rejects.toThrow(/nicht der eigene/);
    expect(git(t.repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(existsSync(join(t.repo, 'ungesichert.txt'))).toBe(true);
    expect(t.befehle).toHaveLength(0);
    expect(liesHalt(t.dir)).toBeNull();
    expect(liesNachtlauf(t.dir).letzter).toMatchObject({ ergebnis: 'fehler', grund: 'Worktree an unerwarteter Stelle' });
  }, T);

  it('the issue goes through the forge layer on Gitea as well', async () => {
    const t = welt({ ausgaben: [rot('flotte')], forge: 'gitea' });
    await fahre(t);
    const issue = triage(t.b);
    expect(issue).toHaveLength(1);
    expect(liesHalt(t.dir)!.issue).toBe(issue[0].nummer);
  }, T);

  it('runs without a logbook issue as well', async () => {
    const t = welt({ ausgaben: [rot('flotte')], logbuch: false });
    const r = await fahre(t);
    expect(r.ergebnis).toBe('rot');
    expect(t.b.issues.filter((i) => i.labels.includes('flotte'))).toHaveLength(0);
    expect(resolve(t.dir)).toBe(resolve(t.repo, '.git', 'flotte'));
  }, T);
});

describe('Nachtlauf: die roten Teile des Andockblocks', () => {
  it('names only contexts at the first context indentation; a deeper detail line that says ROT is no part', () => {
    const ausgabe = ['log davor', '== Gate: Basis origin/main @ 80b0ca3 (HEAD d38f3542)', '  alpha    grün     9:50', '    Gruppen: alle 11', '    Los 1 (Testbett): ROT', '    einheit   ROT   3 Tests','  beta     ROT      1:02', '    Fehler im Testbett: x', '  gamma    übersprungen', 'Gate ROT.'].join('\n');
    expect(andockblock(ausgabe, '---\nmerge: nach_gate\n---\n')).toMatchObject({ gruen: false, vollstaendig: true, teile: ['beta'] });
  });
});
