// The state of one `flotte epic` run (#69, decision 7): <git common dir>/flotte/epics/<nr>/zustand.json
// with a lock next to it (one program per epic). It is written after every transition; a restart
// continues from it. Lock and atomic write are the driver's (werkzeuge/zustand.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ersetze, flotteDir } from '../werkzeuge/zustand.ts';
import type { ImplementerBericht, Paket, Paketklasse, ReviewerBericht, Rolle, Schnitt } from './schema.ts';

/** the escalation ladder: the three package classes and, after an escalation out of Urteil, urteil-hoch */
export type Stufe = Paketklasse | 'urteil-hoch';

export type PaketStufe = 'wartend' | 'startbereit' | 'implementer' | 'reviewer' | 'pruefung' | 'merge' | 'fertig' | 'zurueckgelassen' | 'blockiert';

export interface Suite {
  name: string;
  /** test files of the suite */
  dateien: number;
  tests: number;
  rot: { datei: string; test: string }[];
}

/** the result of the adapter's test commands, one entry per suite */
export type Testlauf = Suite[];

export interface Eskalation {
  runde: number;
  von: Stufe;
  nach: Stufe;
  grund: string;
}

/** the language-model call of a package or of the cut */
export interface AufrufStand {
  /** session of the call; a restart or a second try resumes it with --resume only (decision 2) */
  sitzung: string | null;
  /** --resume after an invalid output or a run without result: at most one per call (P8, P9) */
  resumes: number;
  /** the text of the next --resume; null: carry on where you stopped */
  fortsetzen: string | null;
  /** waits for an account limit (P20); the call is resumed when the account is free again */
  wartet: 'konto' | null;
}

export interface PaketZustand extends AufrufStand {
  nr: string;
  stufe: PaketStufe;
  /** current rung of the ladder; starts at the class of the cut */
  klasse: Stufe;
  /** implementer round, 1-based (max_rounds) */
  runde: number;
  eskalationen: Eskalation[];
  /** the next implementer call takes over the state of the worktree (a failed call before it) */
  uebernehmen: boolean;
  /** findings for the next implementer round */
  befund: string[];
  worktree: string | null;
  branch: string;
  bericht: ImplementerBericht | null;
  review: ReviewerBericht | null;
  lastflakes: string[];
  mergeCommit: string | null;
  /**
   * a merge conflict in the epic worktree: its files, and once the conflict call answered, its verdict.
   * While the verdict is open the epic worktree is mid-merge: no other merge, a restart resumes the call.
   */
  konflikt: { dateien: string[]; ergebnis: 'geloest' | 'inhaltlich' | null; begruendung: string } | null;
  /** the epic branch was checked after the merge (or needed no run) */
  epicGeprueft: boolean;
  revertCommit: string | null;
  grund: string | null;
  blockiertDurch: string | null;
  /** ISO times of the package (epic/SKILL.md, Phase 5, line `Zeiten:`) */
  zeiten: { start?: string; implementerZurueck?: string; reviewerZurueck?: string; abgenommen?: string; gemergt?: string; ende?: string };
}

export interface FrageZustand {
  nr: number;
  art: 'tor' | 'ram';
  /** index into schnitt.tor for art tor */
  punkt: number | null;
  betrifft: 'Lauf' | string[];
  antwort: string | null;
  /** the answer chose an option that rejects */
  abgelehnt: boolean;
  /** no longer relevant (a RAM question after the reading went back to ok) */
  erledigt: boolean;
}

export interface Ereignis {
  takt: number;
  /** ISO time: stage 4 (#68) reads package starts, role calls and merges from here */
  zeit: string;
  paket: string | null;
  art: 'start' | 'aufruf' | 'zurueck' | 'abgenommen' | 'gemergt' | 'zurueckgelassen' | 'blockiert' | 'eskalation' | 'kante' | 'lastflake' | 'frage' | 'antwort' | 'ram' | 'slot' | 'konto' | 'ende';
  rolle?: Rolle;
  text: string;
}

export interface Kante {
  a: string;
  b: string;
  art: 'kollision';
  grund: string;
}

/** abgebrochen: ended before any package started (gate rejected, no usable cut) */
export type Phase = 'ruesten' | 'schnitt' | 'tor' | 'pakete' | 'fertig' | 'abgebrochen';

export interface EpicLaufZustand {
  version: 1;
  epic: number;
  takt: number;
  phase: Phase;
  epicWorktree: string | null;
  /** Ausgangszahlen of phase 0 (epic worktree) */
  basis: Testlauf | null;
  /** lint findings per file in phase 0 */
  basisLint: Record<string, number> | null;
  schnitt: AufrufStand & { ergebnis: Schnitt | null };
  fragen: FrageZustand[];
  pakete: Record<string, PaketZustand>;
  /** collision edges added after a merge conflict (epic/SKILL.md, Phase 5) */
  kanten: Kante[];
  ram: { halt: boolean; frage: number | null; freigabe: boolean };
  /** the slot (epic/SKILL.md, rule 12): a full stack of the project runs, nothing new starts */
  slot: { belegt: boolean };
  konto: { gesperrt: boolean };
  ereignisse: Ereignis[];
  /** the FLOTTE-ENDE block once the run ended */
  ende: string | null;
}

export function neuerLauf(epic: number): EpicLaufZustand {
  return {
    version: 1,
    epic,
    takt: 0,
    phase: 'ruesten',
    epicWorktree: null,
    basis: null,
    basisLint: null,
    schnitt: { sitzung: null, resumes: 0, fortsetzen: null, wartet: null, ergebnis: null },
    fragen: [],
    pakete: {},
    kanten: [],
    ram: { halt: false, frage: null, freigabe: false },
    slot: { belegt: false },
    konto: { gesperrt: false },
    ereignisse: [],
    ende: null,
  };
}

/** agent/<nr>-<slug>, slug as in epic/SKILL.md Phase 3: lower case, ASCII, at most four words */
export function paketBranch(p: Pick<Paket, 'nr' | 'titel'>): string {
  const slug = p.titel
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
    .join('-');
  return `agent/${p.nr}${slug ? `-${slug}` : ''}`;
}

export function neuesPaket(p: Paket): PaketZustand {
  return {
    nr: p.nr,
    stufe: 'wartend',
    klasse: p.klasse,
    runde: 1,
    eskalationen: [],
    sitzung: null,
    resumes: 0,
    fortsetzen: null,
    uebernehmen: false,
    befund: [],
    wartet: null,
    worktree: null,
    branch: paketBranch(p),
    bericht: null,
    review: null,
    lastflakes: [],
    mergeCommit: null,
    konflikt: null,
    epicGeprueft: false,
    revertCommit: null,
    grund: null,
    blockiertDurch: null,
    zeiten: {},
  };
}

/** <git common dir>/flotte/epics/<nr>, created when missing */
export function epicDir(repo: string, epic: number): string {
  const dir = join(flotteDir(repo), 'epics', String(epic));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function liesLauf(dir: string, epic: number): EpicLaufZustand {
  const datei = join(dir, 'zustand.json');
  return existsSync(datei) ? (JSON.parse(readFileSync(datei, 'utf8')) as EpicLaufZustand) : neuerLauf(epic);
}

/** atomic like the driver's state: a crash leaves the old file, never half of a new one */
export function schreibeLauf(dir: string, z: EpicLaufZustand): void {
  const datei = join(dir, 'zustand.json');
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(z, null, 2));
  ersetze(tmp, datei);
}
