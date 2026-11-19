// flotte zustand <repo>: prints the state file of the driver for this repository.
// State and lock live in <git common dir>/flotte/, next to the locks of worktree.ps1: outside
// every worktree, never tracked, the same for all worktrees of the repository. One driver per
// repository: the lock names the process; a lock of a dead process is taken over.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';

export type EpicStufe = 'wartend' | 'laeuft' | 'frage' | 'pr' | 'gemergt' | 'nacharbeit' | 'fertig' | 'blockiert' | 'abgebrochen';

export interface EpicZustand {
  nr: number;
  stufe: EpicStufe;
  konto: string | null;
  sitzung: string | null;
  /** starts without a usable result (D1) */
  neustarts: number;
  /** --resume after a network error (D18) */
  fortsetzungen: number;
  /** follow-ups after an end without block (D4) */
  nachfragen: number;
  pr: number | null;
  /** packages that wait for an answer of the person (D3) */
  geparkt: string[];
  notiz: string;
}

export interface Ereignis {
  zeit: string;
  epic: number | null;
  text: string;
}

export interface Zustand {
  version: 1;
  repo: string;
  epics: Record<string, EpicZustand>;
  ereignisse: Ereignis[];
  /** whatever later stages keep (questions to the person, brakes, ...) */
  [weiteres: string]: unknown;
}

export function flotteDir(repo: string, aufrufer: Aufrufer = aufrufen): string {
  const r = aufrufer('git', ['-C', repo, 'rev-parse', '--git-common-dir']);
  if (r.code) throw new Error(`kein Git-Repository: ${repo}`);
  const common = r.stdout.trim();
  const dir = join(isAbsolute(common) ? common : resolve(repo, common), 'flotte');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function lebt(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type Sperre = { ok: true; datei: string } | { ok: false; pid: number; seit: string };

/** Takes the driver lock of the repository (D20). A lock of a dead process is stale and taken over. */
export function sperren(dir: string, pid = process.pid, istLebendig: (p: number) => boolean = lebt): Sperre {
  const datei = join(dir, 'treiber.lock');
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      const fd = openSync(datei, 'wx');
      writeFileSync(fd, JSON.stringify({ pid, seit: new Date().toISOString() }));
      closeSync(fd);
      return { ok: true, datei };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let alt: { pid?: number; seit?: string } = {};
      try {
        alt = JSON.parse(readFileSync(datei, 'utf8'));
      } catch {
        /* half-written lock: treat as stale */
      }
      if (alt.pid && alt.pid !== pid && istLebendig(alt.pid)) return { ok: false, pid: alt.pid, seit: alt.seit ?? '' };
      unlinkSync(datei);
    }
  }
  return { ok: false, pid: -1, seit: '' };
}

export function entsperren(dir: string, pid = process.pid): void {
  const datei = join(dir, 'treiber.lock');
  try {
    const alt = JSON.parse(readFileSync(datei, 'utf8'));
    if (alt.pid === pid) unlinkSync(datei);
  } catch {
    /* nothing to release */
  }
}

export function leer(repo: string): Zustand {
  return { version: 1, repo, epics: {}, ereignisse: [] };
}

export function lies(dir: string, repo: string): Zustand {
  const datei = join(dir, 'zustand.json');
  if (!existsSync(datei)) return leer(repo);
  return JSON.parse(readFileSync(datei, 'utf8')) as Zustand;
}

/** Atomic: a crash between write and rename leaves the old state, never half of a new one. */
export function schreibe(dir: string, z: Zustand): void {
  const datei = join(dir, 'zustand.json');
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(z, null, 2));
  renameSync(tmp, datei);
}

export function neuesEpic(nr: number): EpicZustand {
  return { nr, stufe: 'wartend', konto: null, sitzung: null, neustarts: 0, fortsetzungen: 0, nachfragen: 0, pr: null, geparkt: [], notiz: '' };
}

export function zustand(argv: string[]): unknown {
  const repo = argv[0];
  if (!repo) throw new Error('Aufruf: flotte zustand <repo>');
  const dir = flotteDir(repo);
  let sperre: unknown = null;
  try {
    sperre = JSON.parse(readFileSync(join(dir, 'treiber.lock'), 'utf8'));
  } catch {
    sperre = null;
  }
  return { dir, sperre, zustand: lies(dir, repo) };
}
