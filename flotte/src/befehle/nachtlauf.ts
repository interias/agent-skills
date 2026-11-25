// flotte nachtlauf [<repo>] [--forge <owner/name>] [--stand | --freigeben] (step 8 of the gate rework): the full run of
// the project without a cache (adapter key gate_night_command) on the current origin/<base>, in a worktree of its own,
// started at night by a scheduled task (flotte/nachtlauf-aufgabe.ps1). Red is repeated once. Red again: the merge queue
// of the driver holds (schlange-halt.json in the fleet's state folder, read by the driver in every tick; it never
// writes zustand.json) and an issue with needs-triage says why. A person releases with --freigeben; nothing reverts a
// commit, and a later green night is noted at the halt and the issue but releases nothing. Runs with and without a
// driver; two night runs of one project exclude each other (nachtlauf.lock with an expiry).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { aufrufen, aufrufenAsync, type AsyncAufrufer, type Aufrufer } from '../aufruf.ts';
import { adapterText, fehlerText, type ForgeZugriff, forgeRepoFuer, zugriffFuer } from '../forge/zugriff.ts';
import { forgeAus } from '../treiber/treiber.ts';
import { SKRIPTE } from '../werkzeuge/ressourcen.ts';
import { entsperren, ersetze, flotteDir, lebt, sperren } from '../werkzeuge/zustand.ts';
import { schluessel } from './adapter.ts';
import { gateKontexte } from '../epic/zaehlen.ts';

/** the halt of the merge queue, next to zustand.json; the driver only reads it */
export const HALT_DATEI = 'schlange-halt.json';
/** the results of the night runs, next to zustand.json; only this command writes it */
export const STAND_DATEI = 'nachtlauf.json';
export const SPERRE = 'nachtlauf.lock';
/** a short lock around every change of the halt file, so a release never races a night run writing it */
export const HALT_SPERRE = 'schlange-halt.lock';
const HALT_SPERRE_MS = 60_000;
/** the package name of its worktree (<worktree_root>/nachtlauf) and of its lock in epic-locks */
export const PAKET = 'nachtlauf';
/** one run of the night command; at the limit its whole process tree ends */
export const BEFEHL_MS = 3 * 3_600_000;
const FETCH_MS = 10 * 60_000;
const SKRIPT_MS = 15 * 60_000;
/**
 * a lock older than this is taken over, whatever its process does: fetch (10 min) + worktree.ps1 Down and Up (15 min each)
 * + two runs of the command (2 × 3 h) = 6 h 40 min, so a run still within its limits never loses its lock
 */
export const VERFALL_MS = 7 * 3_600_000;
const VERLAUF_MAX = 30;
const BLOCK_MAX = 40;
/** the closing line of a red gate block (gate.ps1 and the default); with another one only the fixed sentence leaves the machine */
const ROT_ZEILE = 'Gate ROT.';
export const FREIGEBEN = 'flotte nachtlauf --freigeben';
const STAND = 'flotte nachtlauf --stand';

/** a step around the night command failed: kategorie is all that leaves the machine, the message stays local */
export class NachtFehler extends Error {
  constructor(
    readonly kategorie: string,
    text: string,
  ) {
    super(text);
  }
}

const PFADE = [
  // UNC
  /\\\\[^\s"'`<>|,;\\]+\\[^\s"'`<>|,;]*/g,
  // drive
  /\b[A-Za-z]:[\\/][^\s"'`<>|,;]*/g,
  // POSIX home folders
  /(?<![\w.~-])\/(?:home|Users|root)\/[^\s"'`<>|,;]*/g,
];

/** the one filter for all the night run sends out (logbook, issue, comments, the bridge): local paths become <pfad> */
export const ohnePfade = (text: string): string => PFADE.reduce((t, muster) => t.replace(muster, '<pfad>'), text);

export interface NachtErgebnis {
  ergebnis: 'gruen' | 'rot' | 'fehler';
  /** the commit of origin/<basis> it ran on; null when it did not get that far */
  commit: string | null;
  basis: string;
  /** start, ISO */
  zeit: string;
  dauerS: number;
  /** the log of the last run of the command, relative to the fleet's state folder */
  log: string | null;
  /** the first run was red and the command ran once more */
  wiederholt: boolean;
  /** the red parts of the gate block of the last run (empty when green or not readable) */
  teile: string[];
  /** with wiederholt: the red parts of the first run */
  erstesRot?: string[];
  /** fehler: why the night command did not run, as a fixed category (it leaves the machine) */
  grund?: string;
  /** fehler: the full text, with paths; stays in nachtlauf.json */
  detail?: string;
}

export interface SchlangeHalt {
  /** since when the queue holds, ISO; a later red night keeps it */
  seit: string;
  grund: string;
  /** the commit of the last red night */
  commit: string;
  basis: string;
  /** the issue with needs-triage; null when the forge could not create it (tried again at the next red night) */
  issue: number | null;
  teile: string[];
  log: string | null;
  /** a green night after the halt: noted, released is only by a person */
  gruen?: { zeit: string; commit: string };
  /** the file is there but cannot be read or lacks a field: it holds all the same (never fail open) */
  unlesbar?: true;
}

export interface NachtStand {
  letzter: NachtErgebnis | null;
  verlauf: NachtErgebnis[];
}

export interface NachtWelt {
  aufrufer: Aufrufer;
  langsam: AsyncAufrufer;
  jetzt: () => number;
  /** the forge layer of the driver for this project (GitHub or Gitea by the adapter) */
  forge: (repo: string, forge: string) => ForgeZugriff;
  pid: number;
  lebt: (pid: number) => boolean;
  /** mission/scripts with worktree.ps1 */
  skripte: string;
}

const echteWelt: NachtWelt = { aufrufer: aufrufen, langsam: aufrufenAsync, jetzt: Date.now, forge: (repo, forge) => zugriffFuer(repo, aufrufen, forge), pid: process.pid, lebt, skripte: SKRIPTE };

function liesJson<T>(datei: string): T | null {
  try {
    return JSON.parse(readFileSync(datei, 'utf8')) as T;
  } catch {
    return null;
  }
}

function schreibeJson(datei: string, wert: unknown): void {
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(wert, null, 2));
  ersetze(tmp, datei);
}

const istText = (x: unknown): x is string => typeof x === 'string';

/**
 * The halt of the merge queue; null only when the file is missing. A file that is there but cannot be read (busy,
 * broken JSON, a field missing) is a halt as well, marked unlesbar: the queue must not dock on a red base by mistake.
 */
export function liesHalt(dir: string): SchlangeHalt | null {
  const datei = join(dir, HALT_DATEI);
  let h: Record<string, unknown>;
  try {
    h = JSON.parse(readFileSync(datei, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return unlesbarerHalt(datei);
  }
  if (!h || typeof h !== 'object' || !istText(h.seit) || !istText(h.grund) || !istText(h.commit) || !Array.isArray(h.teile) || !h.teile.every(istText) || !(h.issue == null || typeof h.issue === 'number')) return unlesbarerHalt(datei);
  const g = h.gruen as Record<string, unknown> | undefined;
  return {
    seit: h.seit,
    grund: h.grund,
    commit: h.commit,
    basis: istText(h.basis) ? h.basis : '',
    issue: (h.issue as number | null | undefined) ?? null,
    teile: h.teile,
    log: istText(h.log) ? h.log : null,
    ...(g && istText(g.zeit) && istText(g.commit) ? { gruen: { zeit: g.zeit, commit: g.commit } } : {}),
  };
}

function unlesbarerHalt(datei: string): SchlangeHalt {
  let seit = '';
  try {
    // stable from tick to tick, so it is one event
    seit = statSync(datei).mtime.toISOString();
  } catch {
    /* not even that */
  }
  return { seit, grund: 'Haltedatei unlesbar', commit: '', basis: '', issue: null, teile: [], log: null, unlesbar: true };
}

/** the results; a last result that lacks its fields counts as none */
export function liesNachtlauf(dir: string): NachtStand {
  const s = liesJson<Partial<NachtStand>>(join(dir, STAND_DATEI));
  const l = s?.letzter as Partial<NachtErgebnis> | null | undefined;
  const gueltig = l && typeof l === 'object' && istText(l.zeit) && ['gruen', 'rot', 'fehler'].includes(l.ergebnis as string);
  return { letzter: gueltig ? (l as NachtErgebnis) : null, verlauf: Array.isArray(s?.verlauf) ? s.verlauf : [] };
}

/** the halt in a few words, for notes and the board */
export const haltKurz = (h: SchlangeHalt) => (h.unlesbar ? h.grund : `Nachtlauf rot auf ${h.commit.slice(0, 7)} seit ${h.seit.slice(0, 16).replace('T', ' ')}${h.issue ? `, Issue #${h.issue}` : ''}`);

/**
 * The gate block of the output (the last line that matches gate_base and what follows up to the closing line), and its
 * red parts; null when the output has none. Only these lines leave the machine, filtered for paths, and only when the
 * block ends with gate_green or the red closing line (vollstaendig): the rest of a log may hold anything.
 */
export function andockblock(ausgabe: string, adapter: string): { zeilen: string[]; gruen: boolean; teile: string[]; vollstaendig: boolean } | null {
  const base = new RegExp(schluessel(adapter, 'gate_base') ?? 'Basis \\S+ @ ([0-9a-f]{7,40})');
  const gruenZeile = schluessel(adapter, 'gate_green') ?? 'Gate grün.';
  const zeilen = ausgabe.split(/\r?\n/);
  let von = -1;
  zeilen.forEach((z, i) => {
    if (base.test(z)) von = i;
  });
  if (von < 0) return null;
  const block: string[] = [];
  for (const z of zeilen.slice(von, von + BLOCK_MAX)) {
    if (block.length && !z.trim()) break;
    block.push(z.trimEnd());
    if (block.length > 1 && /^\S/.test(z)) break;
  }
  const schluss = block.at(-1)?.trim();
  const vollstaendig = block.length > 1 && (schluss === gruenZeile || schluss === ROT_ZEILE);
  // the red contexts as the measurement reads them: deeper indented detail lines are no part
  const teile = vollstaendig ? gateKontexte(block.slice(1)).flatMap(({ kontext }) => (kontext.ergebnis === 'rot' ? [kontext.name] : [])).map(ohnePfade) : [];
  return { zeilen: vollstaendig ? block.map(ohnePfade) : [], gruen: block.some((z) => z.trim() === gruenZeile), teile, vollstaendig };
}

/** the repository of a folder (its main checkout) and owner/name of its forge, as `flotte fahren` finds them */
function projektAus(argv: string[], a: Aufrufer, cwd: string): { repo: string; forge: string } {
  const explizit = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
  let repo = explizit ? resolve(explizit) : null;
  if (!repo) {
    const r = a('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (r.code) throw new Error(`Kein Git-Repository in ${cwd}. ${AUFRUF}`);
    const common = r.stdout.trim();
    repo = /[\\/]\.git$/.test(common) ? resolve(common, '..') : resolve(cwd);
  }
  const i = argv.indexOf('--forge');
  let forge = (i >= 0 ? argv[i + 1] : undefined) ?? (forgeRepoFuer(repo, '') || null);
  if (!forge) {
    const r = a('git', ['-C', repo, 'remote', 'get-url', 'origin']);
    forge = r.code ? null : forgeAus(r.stdout);
    if (!forge) throw new Error(`Die Forge lässt sich nicht aus origin lesen; --forge <owner/name> angeben. ${AUFRUF}`);
  }
  return { repo, forge };
}

const AUFRUF = 'Aufruf: flotte nachtlauf [<repo>] [--forge <owner/name>] [--stand | --freigeben]';

export async function nachtlauf(argv: string[], welt: Partial<NachtWelt> = {}, cwd = process.cwd()): Promise<unknown> {
  const w: NachtWelt = { ...echteWelt, ...welt };
  const { repo, forge } = projektAus(argv, w.aufrufer, cwd);
  const dir = flotteDir(repo, w.aufrufer);
  if (argv.includes('--stand')) return stand(dir);
  const z = w.forge(repo, forge);
  if (argv.includes('--freigeben')) return await freigeben(dir, z, w);
  return fahren(repo, dir, z, w);
}

function stand(dir: string): unknown {
  const s = liesNachtlauf(dir);
  return { halt: liesHalt(dir), letzter: s.letzter, verlauf: s.verlauf.slice(-5), sperre: liesJson(join(dir, SPERRE)), freigeben: liesHalt(dir) ? FREIGEBEN : null };
}

/** the open logbook issue (label flotte); null without one: the night run creates none, that is the driver's */
function logbuch(z: ForgeZugriff, text: string): void {
  try {
    const nr = z.issues('flotte', ['number']).map((i) => i.nummer).sort((x, y) => x - y)[0];
    if (nr) z.kommentieren(nr, ohnePfade(`**Flotte (Nachtlauf)** — ${text}.`));
  } catch {
    /* the logbook is a view: the result stands in nachtlauf.json */
  }
}

function kommentar(z: ForgeZugriff, nr: number | null, text: string): void {
  if (!nr) return;
  try {
    z.kommentieren(nr, ohnePfade(text));
  } catch {
    /* the halt holds without the comment */
  }
}

/**
 * fn reads and changes the halt file under its short lock (HALT_SPERRE, never the long lock of the run): it gets the
 * halt read right then. Waits up to 30 s for another holder; a lock older than a minute is stale.
 */
async function mitHalt<T>(dir: string, w: NachtWelt, fn: (h: SchlangeHalt | null) => T): Promise<T> {
  for (let i = 0; ; i++) {
    const s = sperren(dir, w.pid, w.lebt, HALT_SPERRE, HALT_SPERRE_MS, w.jetzt());
    if (s.ok) break;
    if (i >= 300) throw new NachtFehler('Haltedatei gesperrt', `Die Haltedatei ist gesperrt (pid ${s.pid}, seit ${s.seit}); nichts geändert.`);
    await new Promise((weiter) => setTimeout(weiter, 100));
  }
  try {
    return fn(liesHalt(dir));
  } finally {
    entsperren(dir, w.pid, HALT_SPERRE);
  }
}

async function freigeben(dir: string, z: ForgeZugriff, w: NachtWelt): Promise<unknown> {
  const h = await mitHalt(dir, w, (h) => {
    if (h) rmSync(join(dir, HALT_DATEI), { force: true });
    return h;
  });
  if (!h) return { freigegeben: false, hinweis: 'Die Andock-Schlange hält nicht; nichts freizugeben.' };
  const zeit = new Date(w.jetzt()).toISOString();
  logbuch(z, `Andock-Schlange freigegeben (Halt seit ${h.seit}${h.issue ? `, Issue #${h.issue} bleibt offen` : ''}), per Befehl am Rechner`);
  kommentar(z, h.issue, `**Nachtlauf (Flotte)** — Die Andock-Schlange ist freigegeben (${zeit}, per Befehl am Rechner). Dieses Issue bleibt offen, bis die Ursache behoben ist.`);
  return { freigegeben: true, halt: h, hinweis: `Freigegeben. Der Treiber dockt ab seinem nächsten Takt wieder an${h.issue ? `; Issue #${h.issue} bleibt offen` : ''}.` };
}

/**
 * The worktree of the night run on a detached origin/<basis>, always <worktree_root>/nachtlauf: reused when its lock and
 * git both know it; when only one of them does (removed or unlocked by hand), Down clears what is left (#106) and Up
 * lays it out anew. A lock naming any other folder (the main checkout, a mission's worktree) is never forced onto the base.
 */
async function worktreeBereit(repo: string, dir: string, basis: string, adapter: string, w: NachtWelt): Promise<string> {
  const ziel = `origin/${basis}`;
  const eigen = join(resolve(repo, schluessel(adapter, 'worktree_root') ?? `../${basename(repo)}-worktrees`), PAKET);
  const lock = liesJson<{ worktree?: string }>(join(dir, '..', 'epic-locks', `${PAKET}.json`));
  const gleich = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
  const fremd = gleich(eigen, repo) ? eigen : lock?.worktree && !gleich(lock.worktree, eigen) ? lock.worktree : null;
  if (fremd) throw new NachtFehler('Worktree an unerwarteter Stelle', `Der Worktree ${fremd} ist nicht der eigene des Nachtlaufs (${eigen} unter worktree_root, nicht der Hauptcheckout); nichts umgestellt.`);
  const liste = w.aufrufer('git', ['-C', repo, 'worktree', 'list', '--porcelain']).stdout;
  const registriert = liste.split(/\r?\n/).some((z) => z.startsWith('worktree ') && gleich(z.slice(9).trim(), eigen));
  if (lock && registriert && existsSync(eigen)) {
    const r = w.aufrufer('git', ['-C', eigen, 'checkout', '-q', '--force', '--detach', ziel]);
    if (r.code) throw new NachtFehler('Worktree nicht auf die Basis gestellt', `Worktree des Nachtlaufs nicht auf ${ziel} gestellt: ${r.stderr.trim().slice(0, 200)}`);
    return eigen;
  }
  const skript = join(w.skripte, 'worktree.ps1');
  if (lock || registriert) {
    await w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', skript, '-Action', 'Down', '-RepoRoot', repo, '-Package', PAKET], { cwd: repo, timeoutMs: SKRIPT_MS, baum: true });
  }
  // a holder file keeps the worktree from CleanupStale of the driver once this process has ended
  const halter = join(dir, 'halten', `${PAKET}.json`);
  mkdirSync(join(dir, 'halten'), { recursive: true });
  if (!existsSync(halter)) writeFileSync(halter, JSON.stringify({ nachtlauf: true, repo, seit: new Date(w.jetzt()).toISOString() }));
  const r = await w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', skript, '-Action', 'Up', '-RepoRoot', repo, '-Package', PAKET, '-Detach', '-From', ziel, '-SessionPid', String(w.pid)], { cwd: repo, timeoutMs: SKRIPT_MS, baum: true, env: { EPIC_LOCK_HOLDER: halter } });
  let neu: { path?: string } | null = null;
  try {
    neu = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() ?? '');
  } catch {
    neu = null;
  }
  if (r.code || !neu?.path) throw new NachtFehler('Worktree nicht angelegt', `Worktree des Nachtlaufs nicht angelegt: ${(r.stderr || r.stdout).trim().split(/\r?\n/).pop()?.slice(0, 200) ?? `Exit ${r.code}`}`);
  return neu.path;
}

async function fahren(repo: string, dir: string, z: ForgeZugriff, w: NachtWelt): Promise<unknown> {
  const adapter = adapterText(repo);
  const befehl = schluessel(adapter, 'gate_night_command');
  if (!befehl) return { nachtlauf: 'aus', grund: 'Der Adapter nennt kein gate_night_command: für dieses Projekt gibt es keinen Nachtlauf.' };
  const sperre = sperren(dir, w.pid, w.lebt, SPERRE, VERFALL_MS, w.jetzt());
  if (!sperre.ok) throw new Error(`Ein Nachtlauf läuft schon (pid ${sperre.pid}, seit ${sperre.seit}). Kein zweiter.`);
  const t0 = w.jetzt();
  const zeit = new Date(t0).toISOString();
  const ziel = schluessel(adapter, 'base_branch');
  let basis = ziel && ziel !== 'from-issue' ? ziel : schluessel(adapter, 'main_branch');
  try {
    if (!basis) {
      try {
        basis = z.standardZweig();
      } catch (err) {
        throw new NachtFehler('Basiszweig nicht ermittelt', `Der Standardzweig der Forge ließ sich nicht lesen: ${fehlerText(err)}`);
      }
    }
    const f = await w.langsam('git', ['-C', repo, 'fetch', '-q', 'origin', basis], { timeoutMs: FETCH_MS, baum: true });
    if (f.code) throw new NachtFehler('git fetch scheiterte', `git fetch origin ${basis} scheiterte: ${f.stderr.trim().slice(0, 200)}`);
    const wt = await worktreeBereit(repo, dir, basis, adapter, w);
    const commit = w.aufrufer('git', ['-C', wt, 'rev-parse', 'HEAD']).stdout.trim();
    const stempel = stempelVon(zeit);
    mkdirSync(join(dir, 'nachtlauf'), { recursive: true });
    const lauf = async (n: number) => {
      const r = await w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', befehl], { cwd: wt, timeoutMs: BEFEHL_MS, baum: true });
      const log = join('nachtlauf', `${stempel}-${n}.log`);
      writeFileSync(join(dir, log), `> ${befehl}\n# origin/${basis} @ ${commit}, Exit ${r.code}\n${r.stdout}${r.stderr ? `\n--- stderr\n${r.stderr}` : ''}`);
      const b = andockblock(r.stdout, adapter);
      return { gruen: r.code === 0 && (b ? b.gruen : true), block: b, log };
    };
    const erster = await lauf(1);
    const zweiter = erster.gruen ? null : await lauf(2);
    const letzter = zweiter ?? erster;
    const e: NachtErgebnis = { ergebnis: letzter.gruen ? 'gruen' : 'rot', commit, basis, zeit, dauerS: Math.round((w.jetzt() - t0) / 1000), log: letzter.log, wiederholt: Boolean(zweiter), teile: letzter.gruen ? [] : (letzter.block?.teile ?? []), ...(zweiter ? { erstesRot: erster.block?.teile ?? [] } : {}) };
    merke(dir, e);
    const auf = `origin/${basis} @ ${commit.slice(0, 7)}`;
    const min = `${Math.round(e.dauerS / 60)} min`;
    if (e.ergebnis === 'gruen') {
      // under the short lock and read right then: a release meanwhile stays a release
      const halt = await mitHalt(dir, w, (h) => {
        if (h) schreibeHalt(dir, { ...h, gruen: { zeit, commit } });
        return h;
      });
      const erstesRot = e.erstesRot?.length ? `: ${e.erstesRot.join(', ')}` : '';
      logbuch(z, `Nachtlauf grün auf ${auf} nach ${min}${e.wiederholt ? `, grün erst in der Wiederholung (der erste Lauf war rot${erstesRot})` : ''}${halt ? `; die Andock-Schlange hält weiter, bis ein Mensch freigibt (\`${FREIGEBEN}\`)` : ''}`);
      if (halt) kommentar(z, halt.issue, `**Nachtlauf (Flotte)** — grün auf ${auf}. Die Schlange hält weiter, bis ein Mensch freigibt: \`${FREIGEBEN}\`.`);
      return e;
    }
    const rotTeile = e.teile.length ? ` (rot: ${e.teile.join(', ')})` : '';
    const grund = `Nachtlauf rot auf ${auf}, auch in der Wiederholung${rotTeile}`;
    const zeilen = letzter.block?.vollstaendig ? `\n\n\`\`\`\n${letzter.block.zeilen.join('\n')}\n\`\`\`` : '';
    // the open issue of the halt is reused even when the halt is released before it is written again
    let issue = liesHalt(dir)?.issue ?? null;
    if (issue) kommentar(z, issue, `**Nachtlauf (Flotte)** — wieder rot auf ${auf}${rotTeile}, auch in der Wiederholung. Die Schlange hält weiter; freigeben im Projektordner: \`${FREIGEBEN}\`.${zeilen}`);
    else issue = issueAnlegen(z, auf, e.teile, zeilen);
    // read again under the short lock: a halt still standing keeps its start, one released meanwhile starts anew
    const halt = await mitHalt(dir, w, (h) => {
      const neu: SchlangeHalt = { seit: h && !h.unlesbar ? h.seit : zeit, grund, commit, basis: e.basis, issue, teile: e.teile, log: e.log };
      schreibeHalt(dir, neu);
      return neu;
    });
    logbuch(z, `${grund}: Andock-Schlange hält${issue ? `, Issue #${issue}` : ', Issue nicht angelegt'}; laufende Missionen arbeiten weiter, freigeben mit \`${FREIGEBEN}\``);
    return { ...e, halt };
  } catch (err) {
    // only the category leaves the machine; the full text (paths, stderr) stays in nachtlauf.json and the terminal
    const kategorie = err instanceof NachtFehler ? err.kategorie : 'unerwarteter Fehler';
    merke(dir, { ergebnis: 'fehler', commit: null, basis: basis ?? '', zeit, dauerS: Math.round((w.jetzt() - t0) / 1000), log: null, wiederholt: false, teile: [], grund: kategorie, detail: fehlerText(err) });
    logbuch(z, `Nachtlauf nicht gefahren: ${kategorie}; Einzelheiten am Rechner mit \`${STAND}\``);
    throw err;
  } finally {
    entsperren(dir, w.pid, SPERRE);
  }
}

/** the result into nachtlauf.json; only the last VERLAUF_MAX stay, and only their logs */
function merke(dir: string, e: NachtErgebnis): void {
  const verlauf = [...liesNachtlauf(dir).verlauf, e].slice(-VERLAUF_MAX);
  schreibeJson(join(dir, STAND_DATEI), { letzter: e, verlauf });
  const stempel = verlauf.map((v) => stempelVon(v.zeit));
  const logs = join(dir, 'nachtlauf');
  if (existsSync(logs)) for (const f of readdirSync(logs)) if (!stempel.some((s) => f.startsWith(`${s}-`))) rmSync(join(logs, f), { force: true });
}

/** the start of a night run in the names of its logs */
const stempelVon = (zeit: string) => zeit.replace(/[:.]/g, '-');

function schreibeHalt(dir: string, h: SchlangeHalt): void {
  const { unlesbar: _, ...lesbar } = h;
  schreibeJson(join(dir, HALT_DATEI), lesbar);
}

/** the issue with needs-triage: title, one sentence of cause, the lines of the gate block, how to release; null when the forge refuses */
function issueAnlegen(z: ForgeZugriff, auf: string, teile: string[], zeilen: string): number | null {
  const body = `Der Nachtlauf (\`gate_night_command\`) ist auf \`${auf}\` rot${teile.length ? ` (${teile.join(', ')})` : ''}, auch in der Wiederholung. Die Andock-Schlange des Treibers hält: laufende Missionen arbeiten weiter, fertige warten in der Schlange, neu angedockt wird nichts.${zeilen}\n\nFreigeben, wenn die Ursache behoben oder bewusst hingenommen ist, im Projektordner: \`${FREIGEBEN}\`. Das schließt dieses Issue nicht; das tut, wer die Ursache behebt.`;
  try {
    z.labelAnlegen('needs-triage');
    return z.anlegen(ohnePfade(`Nachtlauf rot: ${auf}, Andock-Schlange hält`), ohnePfade(body), ['needs-triage']);
  } catch {
    return null;
  }
}
