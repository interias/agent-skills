// The driver's side of the Flottenbrücke (#28): one report per turn, fetching and acknowledging the
// answers and actions of the person (requeue or give up a blocked epic, revoke a decision, change a setting,
// take an epic in, pause or continue it, set its priority or its merge; #116: start a triage run, answer a question
// of the triage or revoke one of its decisions). Only the driver talks to the bridge; runs and admiral never see it. A bridge
// that is off or slow is no error: every call has a short time limit and yields undefined.
// The contract is flottenbruecke/beispiel/bericht.json, antworten.json, handlungen.json and
// holodeck.json, tested on both sides.

import { hostname } from 'node:os';
import type { Option } from '../werkzeuge/bloecke.ts';
import type { Prototyp } from './holodeck.ts';
import type { BerichtSitzung } from './sitzungen.ts';
import type { EpicStufe } from '../werkzeuge/zustand.ts';
import type { PaketDetail } from '../werkzeuge/detail.ts';
import type { BerichtEinstellung, WirksameStellung } from './einstellungen.ts';

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

/**
 * One action as GET /api/handlungen delivers it; nr, seit and text only for a revocation. einstellen
 * (#58) belongs to the project, not to an epic: epic 0, text the JSON `{"name": …, "wert": …}`.
 * #61: aufnehmen, pausieren, fortsetzen without text, prioritaet with text `hoch` or `normal`.
 * #112: merge with text `automatisch` or `mensch`, null: back to the proposal.
 * #116 Frachtraum: triage (epic 0) starts a triage run of the project; triage-antwort answers a critical
 * question of the triage (epic the ticket, nr and seit the question, text the JSON `{"option", "text"}`);
 * triage-widerruf revokes a decision of a triage run (epic the ticket, seit its zeit, text the objection).
 * #148: schnitt-widerruf revokes a mission of the last cut plan (epic the mission, text the objection).
 */
export interface BrueckenHandlung {
  id: number;
  epic: number;
  art: 'einreihen' | 'aufgeben' | 'widerruf' | 'einstellen' | 'aufnehmen' | 'pausieren' | 'fortsetzen' | 'prioritaet' | 'merge' | 'triage' | 'triage-antwort' | 'triage-widerruf' | 'schnitt-widerruf';
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
  /** the priority in effect: the bridge's (#61), else the label (prio/hoch) on the epic or a child */
  prio: boolean;
  /** #61: in this deployment (an epic of an earlier one may stay in the state); paused by the person since (ISO); the priority set on the bridge, null: the label's */
  imEinsatz: boolean;
  pausiert: string | null;
  prioritaet: 'hoch' | 'normal' | null;
  /** #112: how the epic merges now, where that comes from (projekt, vorschlag, epic) and the proposal's reason */
  merge: WirksameStellung;
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
  /** #58: the settings in effect, where each comes from and what the bridge may offer */
  einstellungen: BerichtEinstellung[];
  /** #61: the released open epics of the forge that are not in this deployment (aufnehmen) */
  freigegeben: { nr: number; titel: string }[];
  /** #116: the triage state (Frachtraum) */
  triage: BerichtTriage;
}

/** #116: a decision of a triage run of this driver, revocable on the bridge; (nr, zeit) is the key */
export interface BerichtTriageEntscheidung {
  nr: number;
  titel: string;
  ergebnis: 'klar' | 'ueberfluessig';
  herkunft: string;
  grund: string;
  zeit: string;
  widerrufen: string | null;
  /** #117: a decision about a Lernvorschlag (its kennung); klar: nr is the Missionsziel, ueberfluessig: the collecting issue. The bridge ignores the field. */
  lernvorschlag?: string;
  /** #148, klar: the mission the note hangs on (a revocation loosens it there). The bridge ignores the field. */
  mission?: number;
}

/**
 * #148: the cut plan of the last triage run for the Frachtraum: the missions it created (neu) or hung notes on,
 * each with the notes it linked (kinder) and whether they got Warp frei; the notes it closed (merged into
 * verweis, superfluous, rejected). widerrufen: the person's objection once schnitt-widerruf ran; fehler: a failed
 * step of the run or of the revocation.
 */
export interface BerichtSchnittplan {
  zeit: string;
  fehler: string | null;
  missionen: { nr: number; url: string | null; titel: string; begruendung: string; neu: boolean; kinder: { nr: number; titel: string; grund: string }[]; freigegeben: boolean; fehler: string | null; widerrufen: string | null }[];
  notizen: { nr: number; titel: string; art: 'zusammengefuehrt' | 'ueberfluessig' | 'verworfen'; grund: string; verweis: number | null; fundstelle: string; fehler: string | null }[];
}

/**
 * #147: how the last triage run of the driver ended: beendet (every note of its input in an allowed end state),
 * unvollstaendig (the notes that are not, from the final check), abgebrochen (stopped driver, or still under way
 * at a restart; grund says which).
 */
export interface BerichtTriageAbschluss {
  zeit: string;
  zustand: 'beendet' | 'unvollstaendig' | 'abgebrochen';
  geprueft: number;
  sauber: number;
  abweichungen: { nr: number; titel: string; zustand: string; grund: string }[];
  grund: string | null;
}

/**
 * #116: the triage state of the project for the Frachtraum: the open Sternzeit-Notizen and the open
 * critical questions from the forge (gelesen: when), the decisions of the driver's triage runs, a run under way.
 */
export interface BerichtTriage {
  gelesen: string | null;
  laeuft: boolean;
  /** #148: the start of the run under way, its progress (note n of m, only when known: left out otherwise), the end of the last run (missions of its cut plan, questions for the person) */
  seit?: string;
  fortschritt?: { n: number; m: number };
  beendet?: { zeit: string; epics: number; fragen: number; gescheitert?: boolean; fehler?: string };
  tickets: { nr: number; titel: string; labels: string[] }[];
  entscheidungen: BerichtTriageEntscheidung[];
  /** #148: the cut plan of the last triage run; null before the first one or when it cut none */
  schnittplan: BerichtSchnittplan | null;
  /** #147: how the last triage run ended; null before the first one (an older bridge ignores it) */
  abschluss?: BerichtTriageAbschluss | null;
  /** #117: lernvorschlag (the kennung) for a question about a proposal of the learning loop; the bridge ignores it */
  fragen: { ticket: number; nr: number; titel: string; frage: string; optionen: Option[]; empfehlung: string; grund: string; herkunft: string; marke: string; seit: string; lernvorschlag?: string }[];
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
      (h.art === 'einreihen' || h.art === 'aufgeben' || (h.art === 'widerruf' && Number.isInteger(h.nr) && typeof h.seit === 'string' && Boolean(h.text?.trim())) || (h.art === 'einstellen' && typeof h.text === 'string') || ((h.art === 'aufnehmen' || h.art === 'pausieren' || h.art === 'fortsetzen') && h.epic > 0) || (h.art === 'prioritaet' && h.epic > 0 && typeof h.text === 'string') || (h.art === 'merge' && h.epic > 0 && (h.text === null || typeof h.text === 'string')) || (h.art === 'triage' && h.epic === 0) || (h.art === 'triage-antwort' && h.epic > 0 && Number.isInteger(h.nr) && typeof h.seit === 'string' && typeof h.text === 'string') || (h.art === 'triage-widerruf' && h.epic > 0 && typeof h.seit === 'string' && Boolean(h.text?.trim())) || (h.art === 'schnitt-widerruf' && h.epic > 0 && Boolean(h.text?.trim()))),
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
