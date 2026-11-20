// The driver's side of the Flottenbrücke (#28): one report per turn, fetching and acknowledging the
// answers of the person. Only the driver talks to the bridge; runs and admiral never see it. A bridge
// that is off or slow is no error: every call has a short time limit and yields undefined.
// The contract is flottenbruecke/beispiel/bericht.json and antworten.json, tested on both sides.

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
}

export interface Bericht {
  forge: string;
  url: string;
  rechner: string;
  stand: string;
  aktiv: boolean;
  taktS: number;
  epics: { nr: number; titel: string; stufe: EpicStufe; konto: string | null; pr: number | null; notiz: string; geparkt: string[]; pakete: { name: string; stand: string }[]; schritt: string | null; schrittZeit: string | null }[];
  schlange: number[];
  konten: { konto: string; stufe: string }[];
  ram: { stufe: string; halt: boolean; prozent: number | null } | null;
  platte: { freiGb: number | null; genug: boolean } | null;
  obergrenze: number | null;
  fragen: BerichtFrage[];
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
}
