// The driver's side of the Flottenbrücke (#28): one report per turn, fetching and acknowledging the
// answers and actions of the person (requeue or give up a blocked epic, revoke a decision). Only the driver talks to the bridge; runs and admiral never see it. A bridge
// that is off or slow is no error: every call has a short time limit and yields undefined.
// The contract is flottenbruecke/beispiel/bericht.json, antworten.json and handlungen.json, tested on
// both sides.

import { hostname } from 'node:os';
import type { Option } from '../werkzeuge/bloecke.ts';
import type { EpicStufe } from '../werkzeuge/zustand.ts';

export const HERKUNFT_BRUECKE = 'Mensch über die Brücke';

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
export interface BerichtPaket {
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
  konten: { konto: string; stufe: string; fuenf: BerichtFenster | null; woche: BerichtFenster | null; alterMin: number | null }[];
  ram: { stufe: string; halt: boolean; prozent: number | null } | null;
  platte: { freiGb: number | null; genug: boolean } | null;
  obergrenze: number | null;
  fragen: BerichtFrage[];
  leerlaufS: number;
  ereignisse: { zeit: string; epic: number | null; text: string }[];
  entscheidungen: { epic: number; nr: number; frage: string; antwort: string; herkunft: string; grund: string; einflussreich: boolean; zeit: string; widerrufen: string | null }[];
  prognose: BerichtPrognose;
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

  async rufe(pfad: string, init: RequestInit = {}): Promise<unknown> {
    try {
      const r = await fetch(new URL(pfad, this.url.endsWith('/') ? this.url : `${this.url}/`), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(this.token ? { 'X-Bruecke-Token': this.token } : {}) },
        signal: AbortSignal.timeout(this.zeitMs),
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
