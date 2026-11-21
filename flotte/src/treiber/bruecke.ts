// The driver's side of the Flottenbrücke (#28): one report per turn, fetching and acknowledging the
// answers and actions of the person (requeue or give up a blocked epic, revoke a decision). Only the driver talks to the bridge; runs and admiral never see it. A bridge
// that is off or slow is no error: every call has a short time limit and yields undefined.
// The contract is flottenbruecke/beispiel/bericht.json, antworten.json, handlungen.json and
// holodeck.json, tested on both sides.

import { hostname } from 'node:os';
import type { Option } from '../werkzeuge/bloecke.ts';
import type { Prototyp } from './holodeck.ts';
import type { BerichtSitzung } from './sitzungen.ts';
import type { EpicStufe } from '../werkzeuge/zustand.ts';
import type { PaketDetail } from '../werkzeuge/detail.ts';

export const HERKUNFT_BRUECKE = 'Mensch über die Brücke';
/** an answer of the person by `flotte antworten` (#52: a decision of the person like one over the bridge) */
export const HERKUNFT_FLOTTE = 'Mensch über die Flotte';
/** what the bridge takes per decision (flottenbruecke/app/modelle.py): longer text is cut, never the whole report refused */
const TEXT_MAX = 4000;
const HERKUNFT_MAX = 500;
/** the schema's limit of decisions per report */
export const ENTSCHEIDUNGEN_MAX = 500;
/** a set of prototypes may weigh megabytes: a longer limit than the report's */
export const HOLODECK_MS = 10_000;

/** One answer as GET /api/antworten delivers it. */
export interface BrueckenAntwort {
  id: number;
  epic: number;
  nr: number;
  seit: string;
  option: string | null;
  text: string | null;
  zeit: string;
  herkunft: string;
}

/** One action as GET /api/handlungen delivers it; nr, seit and text only for a revocation. */
export interface BrueckenHandlung {
  id: number;
  epic: number;
  art: 'einreihen' | 'aufgeben' | 'widerruf';
  nr: number | null;
  seit: string | null;
  text: string | null;
  zeit: string;
  herkunft: string;
}

export interface BerichtFrage {
  epic: number;
  nr: number;
  frage: string;
  lage: string;
  optionen: Option[];
  mehrfach: boolean;
  empfehlung: string;
  grund: string;
  betrifft: string;
  wartet: string;
  ganzerLauf: boolean;
  seit: string;
  roh: string;
  beantwortet: string | null;
  herkunft: string;
  marke: string;
  umkehrbar: boolean | null;
  geparkt: string[];
}

/**
 * A package of an epic for the bar on the bridge: a child ticket with number and title (the bridge
 * links it), in spec mode a name only. stand: fertig (closed), laeuft (status/in-arbeit), geparkt
 * (waits for an answer of the person), zurueckgelassen (status/haengt), blockiert (status/blockiert), offen.
 */
export interface BerichtPaket extends Partial<PaketDetail> {
  name: string;
  stand: 'offen' | 'laeuft' | 'fertig' | 'geparkt' | 'blockiert' | 'zurueckgelassen';
  nr: number | null;
  titel: string;
  /** first seen working (the driver reads the children at most every PAKETE_MS) and closed, ISO */
  beginn: string | null;
  ende: string | null;
}

/** a usage window: used share in percent, reset as ISO time */
export interface BerichtFenster {
  verbraucht: number;
  reset: string;
}

export interface BerichtEpic {
  nr: number;
  titel: string;
  stufe: EpicStufe;
  konto: string | null;
  pr: number | null;
  notiz: string;
  geparkt: string[];
  pakete: BerichtPaket[];
  schritt: string | null;
  schrittZeit: string | null;
  prozess: boolean;
  grund: string;
  haltZeit: string | null;
  log: string[];
  aufgegebenAm: string | null;
  /** the priority label (prio/hoch) on the epic or a child */
  prio: boolean;
  /** ISO times for level 2: first run started, joined the merge queue, the driver's gate started */
  gestartetAm: string | null;
  schlangeSeit: string | null;
  gateSeit: string | null;
  /** forecast of a waiting epic in seconds (p50–p90), null below the threshold or when hidden */
  prognose: { p50: number; p90: number } | null;
  /** order edges for the Sternenkarte: the epics of this repository it comes after (`> **Reihenfolge:**`, ## Blocked by) */
  nach: number[];
  /** detail view (#51), optional: runs and continuations of the driver after the first start; places in use against the window */
  neustarts?: number;
  plaetze?: { belegt: number; von?: number };
}

/** A decision for the bridge; von (#52): mensch, admiral, or lauf (the admiral followed the run's recommendation). */
export interface BerichtEntscheidung {
  epic: number;
  nr: number;
  frage: string;
  antwort: string;
  herkunft: string;
  grund: string;
  einflussreich: boolean;
  zeit: string;
  widerrufen: string | null;
  von: 'mensch' | 'admiral' | 'lauf' | null;
}

/** The decisions in the shape of the report, every text cut to what the bridge takes. */
export function entscheidungFuerBericht(d: Omit<BerichtEntscheidung, 'grund' | 'widerrufen' | 'von'> & { grund?: string; widerrufen?: string | null; von?: BerichtEntscheidung['von'] }): BerichtEntscheidung {
  const k = (s: string) => s.slice(0, TEXT_MAX);
  return { epic: d.epic, nr: d.nr, frage: k(d.frage), antwort: k(d.antwort), herkunft: d.herkunft.slice(0, HERKUNFT_MAX), grund: k(d.grund ?? ''), einflussreich: d.einflussreich, zeit: d.zeit, widerrufen: d.widerrufen == null ? null : k(d.widerrufen), von: d.von ?? null };
}

/**
 * The forecast as a whole: status zu_wenig (below `ab` measured epics, so far `bisher`), ungenau (hit
 * rate under 60 %, hidden) or ok; the backlog in seconds from `berechnet`. Waits for the person are
 * not included.
 */
export interface BerichtPrognose {
  status: 'zu_wenig' | 'ungenau' | 'ok';
  ab: number;
  bisher: number;
  treffer: number;
  geprueft: number;
  backlog: { p50: number; p90: number } | null;
  berechnet: string;
}

export interface Bericht {
  forge: string;
  url: string;
  rechner: string;
  stand: string;
  aktiv: boolean;
  taktS: number;
  epics: BerichtEpic[];
  schlange: number[];
  konten: { konto: string; stufe: string; fuenf: BerichtFenster | null; woche: BerichtFenster | null; alterMin: number | null; grund?: string }[];
  ram: { stufe: string; halt: boolean; prozent: number | null } | null;
  platte: { freiGb: number | null; genug: boolean } | null;
  obergrenze: number | null;
  fragen: BerichtFrage[];
  leerlaufS: number;
  ereignisse: { zeit: string; epic: number | null; text: string }[];
  /** #52: every decision of an epic not yet merged (the bridge shows them until the merge), else the latest 100 */
  entscheidungen: BerichtEntscheidung[];
  prognose: BerichtPrognose;
  /** the sessions of the accounts for the ship list (#41): folder name only, no path, no pid */
  sitzungen: BerichtSitzung[];
}

/** What the run reads for an answer from the bridge: the letter, the free text unchanged after `Antwort:`. */
export function antwortZeile(a: Pick<BrueckenAntwort, 'option' | 'text'>): string {
  const option = a.option?.trim() || null;
  const text = a.text?.trim() || null;
  if (option && text) return `${option} — Antwort: ${a.text}`;
  return option ?? `Antwort: ${a.text}`;
}

/** The answers of GET /api/antworten; entries that do not fit the contract are dropped. */
export function antwortenAusJson(roh: unknown): BrueckenAntwort[] {
  if (!Array.isArray(roh)) return [];
  return roh.filter(
    (a): a is BrueckenAntwort =>
      a !== null &&
      typeof a === 'object' &&
      Number.isInteger(a.id) &&
      Number.isInteger(a.epic) &&
      Number.isInteger(a.nr) &&
      typeof a.seit === 'string' &&
      (a.option === null || typeof a.option === 'string') &&
      (a.text === null || typeof a.text === 'string') &&
      Boolean(a.option?.trim() || a.text?.trim()),
  );
}

/** The actions of GET /api/handlungen; entries that do not fit the contract are dropped. */
export function handlungenAusJson(roh: unknown): BrueckenHandlung[] {
  if (!Array.isArray(roh)) return [];
  return roh.filter(
    (h): h is BrueckenHandlung =>
      h !== null &&
      typeof h === 'object' &&
      Number.isInteger(h.id) &&
      Number.isInteger(h.epic) &&
      (h.art === 'einreihen' || h.art === 'aufgeben' || (h.art === 'widerruf' && Number.isInteger(h.nr) && typeof h.seit === 'string' && Boolean(h.text?.trim()))),
  );
}

export const rechnerName = () => hostname();

export class Bruecke {
  constructor(
    readonly url: string,
    readonly token: string | null,
    readonly zeitMs = 3000,
  ) {}

  async rufe(pfad: string, init: RequestInit = {}, zeitMs = this.zeitMs): Promise<unknown> {
    try {
      const r = await fetch(new URL(pfad, this.url.endsWith('/') ? this.url : `${this.url}/`), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(this.token ? { 'X-Bruecke-Token': this.token } : {}) },
        signal: AbortSignal.timeout(zeitMs),
      });
      if (!r.ok) return undefined;
      return await r.json();
    } catch {
      return undefined;
    }
  }

  /** true when the bridge took the report */
  async melde(b: Bericht): Promise<boolean> {
    return (await this.rufe('api/bericht', { method: 'POST', body: JSON.stringify(b) })) !== undefined;
  }

  /** true when the bridge took the set of prototypes; it replaces the project's previous set */
  async holodeck(forge: string, dateien: Prototyp[]): Promise<boolean> {
    return (await this.rufe('api/holodeck', { method: 'POST', body: JSON.stringify({ forge, dateien }) }, HOLODECK_MS)) !== undefined;
  }

  /** the open answers, undefined when the bridge is not reachable */
  async hole(forge: string): Promise<BrueckenAntwort[] | undefined> {
    const r = await this.rufe(`api/antworten?forge=${encodeURIComponent(forge)}`);
    return r === undefined ? undefined : antwortenAusJson(r);
  }

  async quittiere(id: number): Promise<boolean> {
    return (await this.rufe(`api/antworten/${id}/quittung`, { method: 'POST' })) !== undefined;
  }

  /** the open actions; undefined when the bridge is not reachable or older than v2 */
  async holeHandlungen(forge: string): Promise<BrueckenHandlung[] | undefined> {
    const r = await this.rufe(`api/handlungen?forge=${encodeURIComponent(forge)}`);
    return r === undefined ? undefined : handlungenAusJson(r);
  }

  async quittiereHandlung(id: number): Promise<boolean> {
    return (await this.rufe(`api/handlungen/${id}/quittung`, { method: 'POST' })) !== undefined;
  }
}
