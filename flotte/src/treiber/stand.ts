// The stand the driver runs (#154): commit and date of the installed skill set (stand.json, written by
// install.ps1 next to the skill), the newest commit on main of its source (git fetch of origin, at most every
// STAND_MS) and the update the person starts on the bridge: after the driver halted (no merge open, the runs
// work on and are taken over), pull the source, install.ps1, rebuild the bridge when flottenbruecke/ changed
// since its image, then start the driver again with the same command line. The bridge commands nothing
// itself (agent-skills/ADR-0005): it only holds the action the driver fetches.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AsyncAufrufer, Aufrufer } from '../aufruf.ts';
import { lebt } from '../werkzeuge/zustand.ts';

export const STAND_DATEI = fileURLToPath(new URL('../../stand.json', import.meta.url));
/** how often the driver asks the source for a newer main: at most every 15 minutes */
export const STAND_MS = 15 * 60_000;
/** next to the state: what the update did; the next start reports it once and removes it */
export const EINGESPIELT = 'eingespielt.json';
const ZWEIG = 'main';

/** stand.json of the installed skill: the commit of the source, its date, when it was installed, the source folder */
export interface SkillStand {
  commit: string;
  datum: string;
  installiert: string | null;
  quelle: string;
}

/** the newest commit on main of the source, with the title of its pull request */
export interface MainStand {
  commit: string;
  datum: string;
  titel: string;
}

/** What the update did; auf null: nothing installed (fehler says why). */
export interface Eingespielt {
  zeit: string;
  von: string;
  auf: string | null;
  datum: string | null;
  bruecke: 'gebaut' | 'unveraendert' | null;
  fehler: string | null;
}

export function liesStand(datei = STAND_DATEI): SkillStand | null {
  if (!existsSync(datei)) return null;
  try {
    const j = JSON.parse(readFileSync(datei, 'utf8').replace(/^﻿/, '')) as Partial<SkillStand>;
    if (typeof j.commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(j.commit) || typeof j.quelle !== 'string' || !j.quelle) return null;
    return { commit: j.commit, datum: String(j.datum ?? ''), installiert: typeof j.installiert === 'string' ? j.installiert : null, quelle: j.quelle };
  } catch {
    return null;
  }
}

/**
 * The title of the pull request a commit on main came from: a merge commit of GitHub carries it in its
 * first body line, one of Gitea in quotes in its subject; a squash commit is its subject.
 */
export function prTitel(nachricht: string): string {
  const zeilen = nachricht.trim().split(/\r?\n/);
  const betreff = zeilen[0] ?? '';
  const gitea = /^Merge pull request '(.+)' \(#\d+\)/.exec(betreff);
  if (gitea) return gitea[1];
  if (/^Merge pull request #\d+ /.test(betreff)) return zeilen.slice(1).find((z) => z.trim())?.trim() ?? betreff;
  return betreff;
}

/**
 * main of the source after a fetch of origin: null when it cannot be read (offline, no origin), else neu,
 * the newer commit, or null when the installed one is main or comes after it.
 */
export async function mainStand(a: AsyncAufrufer, s: SkillStand): Promise<{ neu: MainStand | null } | null> {
  const git = (...args: string[]) => a('git', ['-C', s.quelle, ...args], { timeoutMs: 60_000 });
  if ((await git('fetch', '--quiet', 'origin', ZWEIG)).code) return null;
  const log = await git('log', '-1', '--format=%H%x1f%cI%x1f%B', `origin/${ZWEIG}`);
  const [commit, datum, nachricht] = log.stdout.split('\x1f');
  if (log.code || !commit?.trim()) return null;
  if (commit.trim() === s.commit || !(await git('merge-base', '--is-ancestor', `origin/${ZWEIG}`, s.commit)).code) return { neu: null };
  return { neu: { commit: commit.trim(), datum: (datum ?? '').trim(), titel: prTitel(nachricht ?? '').slice(0, 300) } };
}

/**
 * The update as by hand (INSTALL.md): the source clean and on main, pull, install.ps1, then the bridge
 * (docker compose up -d --build in flottenbruecke/, with its commit and date as build arguments) only when
 * flottenbruecke/ changed since the commit of its image (unknown: rebuilt). A step that fails ends it;
 * what came before stays (install.ps1 backs up every skill it replaces).
 */
export function einspielen(a: Aufrufer, s: SkillStand, brueckeCommit: string | null, jetzt = Date.now): Eingespielt {
  const r: Eingespielt = { zeit: new Date(jetzt()).toISOString(), von: s.commit, auf: null, datum: null, bruecke: null, fehler: null };
  const git = (...args: string[]) => a('git', ['-C', s.quelle, ...args]);
  const nein = (fehler: string) => ({ ...r, fehler: fehler.slice(0, 500) });
  if (!existsSync(join(s.quelle, 'install.ps1'))) return nein('install.ps1 fehlt in der Quelle');
  const status = git('status', '--porcelain');
  if (status.code || status.stdout.trim()) return nein('die Quelle ist nicht sauber (git status)');
  if (git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim() !== ZWEIG) return nein(`die Quelle steht nicht auf ${ZWEIG}`);
  const pull = git('pull', '--ff-only', 'origin', ZWEIG);
  if (pull.code) return nein(`git pull: ${(pull.stderr || pull.stdout).trim()}`);
  r.auf = git('rev-parse', 'HEAD').stdout.trim();
  r.datum = git('log', '-1', '--format=%cI', 'HEAD').stdout.trim();
  // installed already (by the driver of another project, for "alle"): nothing to do but the restart
  if (r.auf === s.commit) return { ...r, bruecke: 'unveraendert' };
  const install = a('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(s.quelle, 'install.ps1')], { cwd: s.quelle });
  if (install.code) return { ...nein(`install.ps1 Exit ${install.code}: ${(install.stderr || install.stdout).trim().split(/\r?\n/).pop() ?? ''}`), auf: r.auf, datum: r.datum };
  // exit 0: unchanged since the image; 1: changed; anything else (an unknown commit): rebuilt to be sure
  const diff = brueckeCommit ? git('diff', '--quiet', brueckeCommit, 'HEAD', '--', 'flottenbruecke/').code : 1;
  if (diff === 0) return { ...r, bruecke: 'unveraendert' };
  const bau = a('docker', ['compose', 'up', '-d', '--build'], { cwd: join(s.quelle, 'flottenbruecke'), env: { ...process.env, BRUECKE_COMMIT: r.auf, BRUECKE_DATUM: r.datum } });
  if (bau.code) return { ...nein(`docker compose: ${(bau.stderr || bau.stdout).trim().split(/\r?\n/).pop() ?? ''}`), auf: r.auf, datum: r.datum };
  return { ...r, bruecke: 'gebaut' };
}

/**
 * One update at a time on this machine: the drivers of several projects ("alle") share the source and the
 * installed skills, and two install.ps1 at once would clear each other's folders. A lock whose process is gone
 * or that is older than 30 minutes is left over and taken over.
 */
export function mitSperre<T>(f: () => T, datei = join(tmpdir(), 'flotte-einspielen.lock'), jetzt = Date.now): T {
  for (;;) {
    try {
      writeFileSync(datei, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        // its holder is gone (Ctrl+C while install.ps1 ran) or it is older than 30 minutes: taken over
        const pid = Number(readFileSync(datei, 'utf8'));
        if ((pid > 0 && !lebt(pid)) || jetzt() - statSync(datei).mtimeMs > 30 * 60_000) {
          rmSync(datei, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  }
  try {
    return f();
  } finally {
    rmSync(datei, { force: true });
  }
}

/** The same command line the driver was started with: the same program, script, arguments and folder. */
export function neustartAufruf(argv = process.argv, programm = process.execPath, cwd = process.cwd()): { programm: string; args: string[]; cwd: string } {
  return { programm, args: argv.slice(1), cwd };
}

/** the exit code of a driver that installed a new stand and wants the hull to start it again */
export const NEUSTART = 75;
/** set in the environment of a driver the hull started: it ends with NEUSTART instead of starting one itself */
export const HUELLE = 'FLOTTE_HUELLE';

type Starte = (programm: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' }) => number | null;

/**
 * The hull: starts the same command line again and again while the driver ends with NEUSTART, else ends with its
 * code. Only the outermost process is a hull, so there is at most one waiting process however often it updates.
 */
export function huelle(starte: Starte, n = neustartAufruf(), env: NodeJS.ProcessEnv = process.env): number {
  for (;;) {
    const code = starte(n.programm, n.args, { cwd: n.cwd, env: { ...env, [HUELLE]: '1' }, stdio: 'inherit' }) ?? 1;
    if (code !== NEUSTART) return code;
  }
}

/**
 * Starts the driver again in this console and waits for it: its output, Ctrl+C and exit code stay those of
 * the terminal the person started it in. Ctrl+C belongs to the driver from now on.
 */
export function neustarten(): number {
  process.removeAllListeners('SIGINT');
  process.on('SIGINT', () => {});
  return huelle((p, args, o) => spawnSync(p, args, o).status);
}
