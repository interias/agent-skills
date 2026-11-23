// flotte werft [<ordner> ...] [--bruecke <url>] [--einmal] (#88, agent-skills/ADR-0005): the Werft on
// the machine, one per machine, for every repository in the folders (default ~/git) whose adapter has
// the key deploy. It watches origin/<main_branch>, pulls the stacks the diff since its last stand
// touches, keeps that stand per repository in .git/flotte/werft.json and holds a stack that failed
// (red, with its log) until the person pulls it again over the bridge. It only calls the bridge
// (report, fetch actions, acknowledge); the bridge commands nothing. After nachziehen it runs the
// test migration by itself; a working migration (#89) only after a checked backup and a release the
// person gives on the bridge, bound to that commit and that backup, at most once.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { aufrufenAsync, type AsyncAufrufer } from '../aufruf.ts';
import { karte } from '../epic/mechanik.ts';
import { Bruecke, rechnerName } from '../treiber/bruecke.ts';
import { forgeAus } from '../treiber/treiber.ts';
import { entsperren, ersetze, flotteDir, lebt, sperren } from '../werkzeuge/zustand.ts';
import { repositorys, schluessel } from './adapter.ts';

/** deploy.abfrage_s when the adapter does not set it: every 2 minutes */
export const ABFRAGE_S = 120;
/** how often the loop looks at the bridge and at the repositories that are due */
export const TAKT_MS = 15_000;
/** one deploy command */
export const BEFEHL_MS = 30 * 60_000;
/** the tail of a command's output kept as the log of a red stack (the bridge's text limit) */
const PROTOKOLL_MAX = 4000;
/** the lock of the one Werft of a machine */
const SPERRE = 'werft.lock';
const FELDER: Record<string, keyof Omit<Stack, 'name' | 'pfade'> | 'pfade'> = {
  pfade: 'pfade',
  nachziehen: 'nachziehen',
  migration_test: 'migrationTest',
  migration_arbeit: 'migrationArbeit',
  sicherung: 'sicherung',
};

export interface Stack {
  name: string;
  /** patterns like gate_areas: ** spans folders, * and ? stay inside one, a trailing / is the folder */
  pfade: string[];
  nachziehen: string;
  /** #89: migration into the test database, runs by itself */
  migrationTest: string | null;
  /** #89: migration into the working database, only after a checked backup and a release on the bridge */
  migrationArbeit: string | null;
  /** #89: the backup before migrationArbeit */
  sicherung: string | null;
}

export interface Deploy {
  abfrageS: number;
  stacks: Stack[];
}

/** The key deploy of an adapter, null when it is missing; throws on a field nobody reads (a typo would deploy nothing). */
export function deployAus(text: string): Deploy | null {
  const k = karte(text, 'deploy');
  if (!k) return null;
  const abfrageS = k.abfrage_s === undefined ? ABFRAGE_S : Number(k.abfrage_s);
  if (!(abfrageS > 0)) throw new Error(`deploy.abfrage_s ${k.abfrage_s}: eine Zahl über 0`);
  const stacks = new Map<string, Stack>();
  for (const [schl, wert] of Object.entries(k)) {
    if (schl === 'abfrage_s') continue;
    const m = /^([A-Za-z0-9_-]+)\.([a-z_]+)$/.exec(schl);
    const feld = m ? FELDER[m[2]] : undefined;
    if (!m || !feld) throw new Error(`deploy.${schl}: kein Feld eines Stacks (<stack>.${Object.keys(FELDER).join(', .')})`);
    const s = stacks.get(m[1]) ?? { name: m[1], pfade: [], nachziehen: '', migrationTest: null, migrationArbeit: null, sicherung: null };
    if (feld === 'pfade') s.pfade = (wert.startsWith('[') ? wert.slice(1, -1).split(',') : [wert]).map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    else s[feld] = wert;
    stacks.set(m[1], s);
  }
  for (const s of stacks.values()) {
    if (!s.pfade.length || !s.nachziehen) throw new Error(`deploy: Stack ${s.name} braucht ${s.name}.pfade und ${s.name}.nachziehen`);
    if (s.migrationArbeit && !s.sicherung) throw new Error(`deploy: ${s.name}.migration_arbeit braucht ${s.name}.sicherung (ohne geprüfte Sicherung keine Freigabe)`);
  }
  return stacks.size ? { abfrageS, stacks: [...stacks.values()] } : null;
}

/** A path pattern as in gate_areas (epic/scripts/merge.ps1, ConvertTo-GlobRegex). */
export function musterRegex(muster: string): RegExp {
  const p = muster.endsWith('/') ? `${muster}**` : muster;
  const r = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(.*/)?')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${r}$`);
}

/**
 * The working migration of a stack (#89), taken with every nachziehen of a stack that has one.
 * wartet: the backup is checked, the migration waits for its release. gesperrt: no checked backup, a
 * release is turned down. laeuft: released and started; written before the command, so a Werft that
 * died during it never starts it again. migriert, rot: the migration ended with exit 0, or not.
 */
export interface ArbeitsMigration {
  zustand: 'wartet' | 'gesperrt' | 'laeuft' | 'migriert' | 'rot';
  /** the commit pulled before the backup; the release has to name it */
  commit: string;
  /** the checked backup file, null when there is none */
  sicherung: string | null;
  /** sha256 of the backup file at its check; the release has to name it */
  pruefsumme: string | null;
  zeit: string;
  /** migration_arbeit as the adapter named it when the backup was taken: the one command a release runs. Missing in a stand before it was kept: never released */
  befehl?: string;
}

export interface StackStand {
  status: 'gruen' | 'rot';
  /** the commit of origin/<main_branch> this stack was last pulled at */
  commit: string;
  zeit: string;
  /** the tail of the output when red, else null */
  protokoll: string | null;
  /** #89, only for a stack with migration_arbeit; missing in a stand written before #89 */
  arbeit?: ArbeitsMigration | null;
}

export interface WerftStand {
  version: 1;
  /** the last commit of origin/<main_branch> the Werft has worked off; null before its first look */
  stand: string | null;
  geprueft: string | null;
  /** set by the person over the bridge; null: deploy.abfrage_s */
  abfrageS: number | null;
  /** why the repository could not be looked at (fetch, adapter, diff), else null */
  fehler: string | null;
  stacks: Record<string, StackStand>;
  /** the bridge actions already applied: one that comes again is only acknowledged */
  handlungenErledigt: number[];
}

const standDatei = (repo: string) => join(flotteDir(repo), 'werft.json');

export function ladeStand(repo: string): WerftStand {
  const datei = standDatei(repo);
  if (!existsSync(datei)) return { version: 1, stand: null, geprueft: null, abfrageS: null, fehler: null, stacks: {}, handlungenErledigt: [] };
  return JSON.parse(readFileSync(datei, 'utf8')) as WerftStand;
}

/** Atomic as the driver's state: a crash leaves the old stand, never half of a new one. */
function schreibeStand(repo: string, s: WerftStand): void {
  const datei = standDatei(repo);
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  ersetze(tmp, datei);
}

/**
 * One action as GET /api/werft/handlungen delivers it (flottenbruecke/SCHNITTSTELLE.md, "Werft").
 * nachziehen: stack now, at the current stand, red or not. einstellen: stack null, text the JSON
 * `{"name": "abfrage_s", "wert": <seconds or null>}`. migration_freigeben: stack, text the JSON
 * `{"commit": <sha>, "sicherung": <file name>, "pruefsumme": <sha256>}` of the waiting migration as
 * the report shows it. Other
 * arts are left at the bridge for a Werft that knows them.
 */
export interface WerftHandlung {
  id: number;
  forge: string;
  stack: string | null;
  art: 'nachziehen' | 'einstellen' | 'migration_freigeben';
  text: string | null;
  zeit: string;
  herkunft: string;
}

export function werftHandlungenAusJson(roh: unknown): WerftHandlung[] {
  if (!Array.isArray(roh)) return [];
  return roh.filter(
    (h): h is WerftHandlung =>
      h !== null &&
      typeof h === 'object' &&
      Number.isInteger(h.id) &&
      typeof h.forge === 'string' &&
      (((h.art === 'nachziehen' || h.art === 'migration_freigeben') && typeof h.stack === 'string') || (h.art === 'einstellen' && typeof h.text === 'string')),
  );
}

export interface BerichtStack {
  name: string;
  /** null: not pulled by the Werft yet */
  status: 'gruen' | 'rot' | null;
  commit: string | null;
  zeit: string | null;
  protokoll: string | null;
  /** which commands of #89 the adapter names */
  migration: { test: boolean; arbeit: boolean; sicherung: boolean };
  /** the working migration as ArbeitsMigration, the backup by its file name only (never a path); null without one */
  arbeit: (Omit<ArbeitsMigration, 'sicherung' | 'befehl'> & { sicherung: string | null }) | null;
}

export interface BerichtRepo {
  forge: string;
  branch: string;
  stand: string | null;
  geprueft: string | null;
  abfrageS: number;
  fehler: string | null;
  stacks: BerichtStack[];
}

export interface WerftBericht {
  rechner: string;
  zeit: string;
  repos: BerichtRepo[];
  /** what this takt did or turned down, also on stderr */
  meldungen: string[];
}

export interface WerftOptionen {
  ordner: string[];
  aufrufer?: AsyncAufrufer;
  bruecke?: Bruecke | null;
  jetzt?: () => Date;
  rechner?: string;
}

/** The adapter as the repository knows it without fetching: origin/HEAD, else the checkout. */
async function adapterText(repo: string, a: AsyncAufrufer): Promise<string | null> {
  const kopf = await a('git', ['-C', repo, 'show', 'origin/HEAD:.claude/epic.md']);
  if (!kopf.code) return kopf.stdout;
  const datei = join(repo, '.claude', 'epic.md');
  return existsSync(datei) ? readFileSync(datei, 'utf8') : null;
}

/** owner/name of origin on GitHub, else the folder name (never a path): the key of the repository at the bridge */
async function forgeVon(repo: string, a: AsyncAufrufer): Promise<string> {
  const r = await a('git', ['-C', repo, 'remote', 'get-url', 'origin']);
  return (r.code ? null : forgeAus(r.stdout)) ?? basename(repo);
}

const kurz = (sha: string) => sha.slice(0, 7);
const ende = (text: string) => (text.length > PROTOKOLL_MAX ? text.slice(-PROTOKOLL_MAX) : text);

/** sha256 of a file, read as a stream: a backup can be large */
async function pruefsumme(datei: string): Promise<string> {
  const h = createHash('sha256');
  for await (const teil of createReadStream(datei)) h.update(teil as Buffer);
  return h.digest('hex');
}

/**
 * Runs the backup command and checks what it left. Checked is a backup whose command ends with exit 0
 * and names in the last line of its output a file (absolute or from the repository root) that exists,
 * is not empty and was written after the command started. Returns the file and its checksum, or why not.
 */
async function sichere(repo: string, befehl: string, env: Record<string, string>, a: AsyncAufrufer): Promise<{ datei: string; pruefsumme: string } | { grund: string; protokoll: string }> {
  const start = Date.now();
  const r = await a(befehl, [], { cwd: repo, shell: true, timeoutMs: BEFEHL_MS, env });
  const nicht = (grund: string) => ({ grund, protokoll: ende(`${grund}\n${r.stdout}${r.stderr}`.trim()) });
  if (r.code) return nicht(`Sicherung gescheitert (Exit ${r.code})`);
  const zeile = r.stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!zeile) return nicht('die Sicherung nennt in der letzten Zeile ihrer Ausgabe keine Datei');
  const datei = resolve(repo, zeile);
  const st = existsSync(datei) ? statSync(datei) : null;
  if (!st?.isFile()) return nicht(`die Sicherung ${basename(datei)} fehlt`);
  if (!st.size) return nicht(`die Sicherung ${basename(datei)} ist leer`);
  // a second of slack for file systems that keep whole seconds
  if (st.mtimeMs + 1000 < start) return nicht(`die Sicherung ${basename(datei)} ist älter als der Sicherungsbefehl`);
  return { datei, pruefsumme: await pruefsumme(datei) };
}

/**
 * Fetches origin/<branch>, pulls the touched stacks and the ones the person asked for, writes the
 * stand after every stack: a restart pulls nothing twice. Returns the deploy key it read.
 */
async function ziehe(repo: string, forge: string, branch: string, s: WerftStand, erzwungen: Set<string>, a: AsyncAufrufer, jetzt: Date, melde: (t: string) => void): Promise<Deploy | null> {
  const git = (args: string[]) => a('git', ['-C', repo, ...args], { timeoutMs: 120_000 });
  const scheitert = (text: string) => {
    s.fehler = text;
    schreibeStand(repo, s);
    melde(`${forge}: ${text}`);
    return null;
  };
  const f = await git(['fetch', '-q', 'origin', branch]);
  if (f.code) return scheitert(`git fetch origin ${branch}: ${f.stderr.trim()}`);
  const neu = (await git(['rev-parse', `origin/${branch}`])).stdout.trim();
  let deploy: Deploy | null;
  try {
    deploy = deployAus((await git(['show', `origin/${branch}:.claude/epic.md`])).stdout);
  } catch (e) {
    return scheitert((e as Error).message);
  }
  if (!deploy) return scheitert(`kein Schlüssel deploy auf origin/${branch}`);
  const geaendert = async (von: string): Promise<string[] | null> => {
    const d = await git(['diff', '--name-only', von, neu]);
    return d.code ? null : d.stdout.split(/\r?\n/).filter(Boolean);
  };
  const trifft = (st: Stack, dateien: string[]) => dateien.some((d) => st.pfade.some((p) => musterRegex(p).test(d)));
  /** null: every stack counts as touched (the old stand is gone, e.g. after a force push and gc) */
  let dateien: string[] | null = [];
  if (s.stand && s.stand !== neu) {
    if ((await git(['cat-file', '-e', `${s.stand}^{commit}`])).code) {
      melde(`${forge}: der alte Stand ${kurz(s.stand)} fehlt lokal (Force-Push?); alle Stacks gelten als berührt`);
      dateien = null;
    } else {
      dateien = await geaendert(s.stand);
      if (!dateien) return scheitert(`git diff ${kurz(s.stand)} ${kurz(neu)} gescheitert`);
    }
  }
  s.geprueft = jetzt.toISOString();
  s.fehler = null;
  for (const name of erzwungen) if (!deploy.stacks.some((x) => x.name === name)) melde(`${forge}: Nachziehen über die Brücke abgelehnt: kein Stack ${name} in deploy`);
  for (const st of deploy.stacks) {
    const alt = s.stacks[st.name];
    let beruehrt = dateien === null || trifft(st, dateien);
    // pulled at a later commit than the stand (a crash between two stacks): only what came after counts
    if (beruehrt && dateien !== null && alt && alt.commit !== s.stand && alt.commit !== neu) beruehrt = trifft(st, (await geaendert(alt.commit)) ?? dateien);
    if (!erzwungen.has(st.name)) {
      if (!beruehrt || alt?.commit === neu) continue;
      if (alt?.status === 'rot') {
        melde(`${forge}: ${st.name} steht seit ${kurz(alt.commit)} auf rot und wird nicht nachgezogen; nachziehen über die Brücke`);
        continue;
      }
    }
    const env = { WERFT_COMMIT: neu, WERFT_STACK: st.name };
    const lauf = (befehl: string) => a(befehl, [], { cwd: repo, shell: true, timeoutMs: BEFEHL_MS, env });
    // the test migration belongs to nachziehen: it runs by itself, and its failure holds the stack
    let schritt = 'nachziehen';
    let r = await lauf(st.nachziehen);
    if (!r.code && st.migrationTest) {
      schritt = 'migration_test';
      r = await lauf(st.migrationTest);
    }
    let protokoll = r.code ? ende(`${r.stdout}${r.stderr}`.trim() || `Exit ${r.code}`) : null;
    // every nachziehen replaces the waiting working migration: a release only ever fits the latest backup
    let arbeit: ArbeitsMigration | null = null;
    let sicherung = '';
    if (!r.code && st.migrationArbeit) {
      const g = await sichere(repo, st.sicherung!, env, a);
      arbeit = { zustand: 'gesperrt', commit: neu, sicherung: null, pruefsumme: null, zeit: new Date().toISOString(), befehl: st.migrationArbeit };
      if ('grund' in g) {
        protokoll = g.protokoll;
        sicherung = g.grund;
      } else {
        Object.assign(arbeit, { zustand: 'wartet', sicherung: g.datei, pruefsumme: g.pruefsumme });
        sicherung = `Sicherung ${basename(g.datei)} geprüft, die Migration wartet auf die Freigabe`;
      }
    }
    s.stacks[st.name] = { status: protokoll ? 'rot' : 'gruen', commit: neu, zeit: new Date().toISOString(), protokoll, arbeit };
    schreibeStand(repo, s);
    if (r.code) melde(`${forge}: ${st.name} rot (${kurz(neu)}, ${schritt} Exit ${r.code}), angehalten`);
    else if (arbeit?.zustand === 'gesperrt') melde(`${forge}: ${st.name} nachgezogen (${kurz(neu)}), aber ${sicherung}: keine Freigabe der Migration möglich, angehalten`);
    else melde(`${forge}: ${st.name} nachgezogen (${kurz(neu)})${sicherung ? `, ${sicherung}` : ''}`);
  }
  s.stand = neu;
  schreibeStand(repo, s);
  return deploy;
}

/** One takt of the Werft: actions from the bridge, every due repository, one report, acknowledgements. */
export async function takt(o: WerftOptionen): Promise<WerftBericht> {
  const a = o.aufrufer ?? aufrufenAsync;
  const jetzt = (o.jetzt ?? (() => new Date()))();
  const rechner = o.rechner ?? rechnerName();
  const meldungen: string[] = [];
  const melde = (t: string) => {
    meldungen.push(t);
    process.stderr.write(`Werft: ${t}\n`);
  };
  const roh = o.bruecke ? await o.bruecke.rufe(`api/werft/handlungen?rechner=${encodeURIComponent(rechner)}`) : undefined;
  const handlungen = roh === undefined ? [] : werftHandlungenAusJson(roh);
  const quittieren: number[] = [];
  const repos: BerichtRepo[] = [];
  const bekannt = new Set<string>();
  for (const repo of repositorys(o.ordner)) {
    const text = await adapterText(repo, a);
    if (!text || !karte(text, 'deploy')) continue;
    const forge = await forgeVon(repo, a);
    bekannt.add(forge);
    const branch = schluessel(text, 'main_branch') ?? 'main';
    const s = ladeStand(repo);
    const erzwungen = new Set<string>();
    // nachziehen counts as done only once ziehe got through (fetch, adapter, diff); until then it stays at the bridge
    const nachziehen: number[] = [];
    const freigaben: WerftHandlung[] = [];
    const erledigt = (id: number) => (s.handlungenErledigt = [...s.handlungenErledigt, id].slice(-200));
    for (const h of handlungen.filter((x) => x.forge === forge)) {
      if (s.handlungenErledigt.includes(h.id)) {
        quittieren.push(h.id);
        continue;
      }
      if (h.art === 'nachziehen') {
        erzwungen.add(h.stack!);
        nachziehen.push(h.id);
      } else if (h.art === 'migration_freigeben') freigaben.push(h);
      else {
        quittieren.push(h.id);
        erledigt(h.id);
        let e: { name?: unknown; wert?: unknown } = {};
        try {
          e = JSON.parse(h.text!);
        } catch {
          /* turned down below */
        }
        if (e.name === 'abfrage_s' && (e.wert === null || (typeof e.wert === 'number' && e.wert > 0))) {
          melde(`${forge}: Einstellung Abfrageabstand von ${s.abfrageS ?? 'Adapter'} → auf ${e.wert ?? 'Adapter'}, ${h.herkunft}`);
          s.abfrageS = e.wert as number | null;
        } else melde(`${forge}: Einstellung über die Brücke abgelehnt: ${h.text}`);
      }
    }
    schreibeStand(repo, s);
    let deploy: Deploy | null = null;
    try {
      deploy = deployAus(text);
    } catch {
      /* ziehe reads it again from origin and names the error */
    }
    const abstand = s.abfrageS ?? deploy?.abfrageS ?? ABFRAGE_S;
    const faellig = !s.geprueft || jetzt.getTime() - Date.parse(s.geprueft) >= abstand * 1000 || erzwungen.size > 0;
    if (faellig) {
      const gelesen = await ziehe(repo, forge, branch, s, erzwungen, a, jetzt, melde);
      if (gelesen) {
        for (const id of nachziehen) erledigt(id);
        quittieren.push(...nachziehen);
        schreibeStand(repo, s);
      }
      deploy = gelesen ?? deploy;
    }
    // after ziehe: a release for a stack it just pulled again names the old backup and is turned down.
    // A release counts once, worked or turned down, and is written before the migration starts: neither
    // a lost acknowledgement nor a restart runs a migration twice.
    for (const h of freigaben) {
      quittieren.push(h.id);
      erledigt(h.id);
      const st = deploy?.stacks.find((x) => x.name === h.stack);
      const m = s.stacks[h.stack!]?.arbeit;
      let f: { commit?: unknown; sicherung?: unknown; pruefsumme?: unknown } = {};
      try {
        f = JSON.parse(h.text ?? '') ?? {};
      } catch {
        /* binds to nothing: turned down below */
      }
      let grund: string | null = null;
      if (!st?.migrationArbeit) grund = `kein ${h.stack}.migration_arbeit in deploy`;
      else if (!m || m.zustand === 'gesperrt') grund = `${h.stack} hat keine geprüfte Sicherung`;
      else if (m.zustand !== 'wartet') grund = `die Migration von ${h.stack} wartet nicht auf eine Freigabe (${m.zustand}, ${kurz(m.commit)})`;
      else if (f.commit !== m.commit || f.sicherung !== basename(m.sicherung!) || f.pruefsumme !== m.pruefsumme) grund = `sie gilt nicht der wartenden Migration von ${h.stack} (${kurz(m.commit)}, Sicherung ${basename(m.sicherung!)})`;
      else if (st.migrationArbeit !== m.befehl) {
        // the adapter changed without touching the stack's pfade (or the stand is older than befehl): the backup was not taken for this command
        grund = `der Befehl von ${h.stack} hat sich seit der Sicherung geändert; nachziehen nimmt eine neue Sicherung`;
        m.zustand = 'gesperrt';
      } else if (!existsSync(m.sicherung!) || (await pruefsumme(m.sicherung!)) !== m.pruefsumme) {
        grund = `die Sicherung ${basename(m.sicherung!)} fehlt oder hat sich seit ihrer Prüfung geändert; nachziehen nimmt eine neue`;
        m.zustand = 'gesperrt';
      }
      if (grund || !st || !m?.befehl) {
        schreibeStand(repo, s);
        melde(`${forge}: Freigabe der Migration über die Brücke abgelehnt: ${grund}`);
        continue;
      }
      m.zustand = 'laeuft';
      m.zeit = new Date().toISOString();
      schreibeStand(repo, s);
      const r = await a(m.befehl, [], { cwd: repo, shell: true, timeoutMs: BEFEHL_MS, env: { WERFT_COMMIT: m.commit, WERFT_STACK: st.name } });
      m.zustand = r.code ? 'rot' : 'migriert';
      m.zeit = new Date().toISOString();
      if (r.code) Object.assign(s.stacks[st.name], { status: 'rot', protokoll: ende(`${r.stdout}${r.stderr}`.trim() || `Exit ${r.code}`) });
      schreibeStand(repo, s);
      melde(r.code ? `${forge}: ${st.name} rot (${kurz(m.commit)}, migration_arbeit Exit ${r.code}), angehalten` : `${forge}: ${st.name} migriert (${kurz(m.commit)}), freigegeben: ${h.herkunft}`);
    }
    repos.push({
      forge,
      branch,
      stand: s.stand,
      geprueft: s.geprueft,
      abfrageS: s.abfrageS ?? deploy?.abfrageS ?? ABFRAGE_S,
      fehler: s.fehler,
      stacks: (deploy?.stacks ?? []).map((st) => {
        const x = s.stacks[st.name];
        // the command stays on the machine: the report carries what a release names, nothing to run
        let arbeit: BerichtStack['arbeit'] = null;
        if (x?.arbeit) {
          const { befehl: _, ...ohne } = x.arbeit;
          arbeit = { ...ohne, sicherung: ohne.sicherung && basename(ohne.sicherung) };
        }
        return { name: st.name, status: x?.status ?? null, commit: x?.commit ?? null, zeit: x?.zeit ?? null, protokoll: x?.protokoll ?? null, migration: { test: Boolean(st.migrationTest), arbeit: Boolean(st.migrationArbeit), sicherung: Boolean(st.sicherung) }, arbeit };
      }),
    });
  }
  for (const h of handlungen.filter((x) => !bekannt.has(x.forge))) {
    quittieren.push(h.id);
    melde(`Handlung ${h.art} über die Brücke abgelehnt: kein Repository ${h.forge} mit deploy auf ${rechner}`);
  }
  const bericht: WerftBericht = { rechner, zeit: jetzt.toISOString(), repos, meldungen };
  if (o.bruecke && (await o.bruecke.rufe('api/werft', { method: 'POST', body: JSON.stringify(bericht) })) !== undefined) {
    for (const id of quittieren) await o.bruecke.rufe(`api/werft/handlungen/${id}/quittung`, { method: 'POST' });
  }
  return bericht;
}

const AUFRUF = 'Aufruf: flotte werft [<ordner> ...] [--bruecke <url>] [--einmal]';

/**
 * Started from a terminal like the driver; runs until Ctrl+C, with --einmal a single takt. One per
 * machine: werft.lock in ~/.flotte (sperrDir), a second start ends with an error.
 */
export async function werft(argv: string[], sperrDir = join(homedir(), '.flotte')): Promise<unknown> {
  const ordner: string[] = [];
  let url: string | null = process.env.FLOTTE_BRUECKE ?? null;
  let einmal = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bruecke') url = argv[++i] ?? '';
    else if (argv[i] === '--einmal') einmal = true;
    else if (argv[i].startsWith('--')) throw new Error(`${argv[i]}: unbekannt. ${AUFRUF}`);
    else ordner.push(argv[i]);
  }
  if (url !== null && !/^https?:\/\//.test(url)) throw new Error(`--bruecke ${url}: eine URL wie http://127.0.0.1:4747`);
  const bruecke = url ? new Bruecke(url, process.env.FLOTTE_BRUECKE_TOKEN || null) : null;
  mkdirSync(sperrDir, { recursive: true });
  const sperre = sperren(sperrDir, process.pid, lebt, SPERRE);
  if (!sperre.ok) throw new Error(`Auf diesem Rechner läuft schon eine Werft (PID ${sperre.pid} seit ${sperre.seit}); eine je Rechner.`);
  process.once('SIGINT', () => {
    entsperren(sperrDir, process.pid, SPERRE);
    process.stderr.write('Werft angehalten. Der Stand steht nach jedem Stack in .git/flotte/werft.json.\n');
    process.exit(130);
  });
  try {
    for (;;) {
      const b = await takt({ ordner, bruecke });
      if (einmal) return b;
      await new Promise((r) => setTimeout(r, TAKT_MS));
    }
  } finally {
    entsperren(sperrDir, process.pid, SPERRE);
  }
}
