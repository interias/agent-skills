// The settings the person changes on the bridge without a restart (#58): the start parameters and
// the fixed thresholds are initial values. Here are their limits, the check and how a value is read
// from and written to the driver's Einstellung; treiber.ts applies them from the next turn on, keeps
// them in the state and reports them. Accounts appear by short name (`Konto 2`), never by path.

import type { Einstellung } from './treiber.ts';

export type Herkunft = 'start' | 'bruecke' | 'standard';
export type Wert = number | string | string[] | null;

interface Art {
  titel: string;
  /** whole numbers within min..max */
  min?: number;
  max?: number;
  /** an account (`eins`) or a list of accounts (`liste`) from the choice of known accounts */
  konto?: 'eins' | 'liste';
  /** one of these words (#112) */
  werte?: string[];
  /** null is allowed: back to the automatic value */
  leer: boolean;
  standard: Wert;
}

/** #166: the models the bridge offers for triage and admiral */
export const MODELLE = ['opus', 'fable', 'sonnet'];

export const EINSTELLUNGEN = {
  obergrenze: { titel: 'Missionen gleichzeitig', min: 1, max: 4, leer: true, standard: null },
  paketeJeEpic: { titel: 'Pakete je Mission gleichzeitig', min: 1, max: 3, leer: false, standard: 3 },
  konten: { titel: 'Konten der Läufe', konto: 'liste', leer: false, standard: null },
  admiral: { titel: 'Admiral-Konto', konto: 'eins', leer: true, standard: null },
  verbrauchGelb: { titel: 'Verbrauch Hauptenergie gelb über (%)', min: 1, max: 98, leer: false, standard: 60 },
  verbrauchRot: { titel: 'Verbrauch Hauptenergie rot über (%)', min: 2, max: 99, leer: false, standard: 85 },
  leerfahren: { titel: 'Bis 100 % leerfahren', konto: 'liste', leer: false, standard: [] },
  ramWarn: { titel: 'RAM-Schwelle (%)', min: 50, max: 84, leer: true, standard: null },
  platteMinGb: { titel: 'Plattenminimum (GB)', min: 1, max: 1000, leer: false, standard: 20 },
  leerlaufMin: { titel: 'Leerlauf (Minuten bis Nachfassen/Abbruch)', min: 5, max: 480, leer: false, standard: 60 },
  // #112: the standard is the adapter's (treiber.ts, standardWert); automatisch only with merge: nach_gate
  merge: { titel: 'Andocken', werte: ['automatisch', 'mensch'], leer: false, standard: 'mensch' },
  // #166: from the next triage run or question block on; a running one keeps its model
  triageModell: { titel: 'Modell der Triage', werte: MODELLE, leer: false, standard: 'opus' },
  admiralModell: { titel: 'Modell des Admirals', werte: MODELLE, leer: false, standard: 'fable' },
  // #167: file accesses the model of the triage may make per call; the program reads the common facts itself
  triageLesenMax: { titel: 'Dateizugriffe der Triage je Aufruf', min: 0, max: 100, leer: false, standard: 15 },
  // #37: the Windows notification of "Braucht dich" on the driver's machine
  meldung: { titel: 'Windows-Meldung bei „Braucht dich“', werte: ['an', 'aus'], leer: false, standard: 'aus' },
  // #193: an like --dauerhaft, aus collects no new mission; the standard is that of a start without --epics
  einsammeln: { titel: 'Missionen automatisch einsammeln', werte: ['an', 'aus'], leer: false, standard: 'an' },
} satisfies Record<string, Art>;

export type EinstellungName = keyof typeof EINSTELLUNGEN;
export const NAMEN = Object.keys(EINSTELLUNGEN) as EinstellungName[];
export const istName = (n: unknown): n is EinstellungName => typeof n === 'string' && Object.hasOwn(EINSTELLUNGEN, n);

/** the start parameter of a setting, for --… given explicitly */
export const START_PARAMETER: Partial<Record<EinstellungName, string>> = {
  obergrenze: '--obergrenze',
  konten: '--konten',
  admiral: '--admiral',
  ramWarn: '--ram-warn',
  platteMinGb: '--platte-min-gb',
  leerlaufMin: '--leerlauf-min',
  admiralModell: '--admiral-modell',
  meldung: '--meldung',
  // #193: --epics sets it as well (treiber.ts, einstellungAus)
  einsammeln: '--dauerhaft/--epics',
};

/** One setting in the report: value, where it comes from and since when, and what the bridge may offer. */
export interface BerichtEinstellung {
  name: EinstellungName;
  titel: string;
  wert: Wert;
  herkunft: Herkunft;
  seit: string;
  standard: Wert;
  leer: boolean;
  min?: number;
  max?: number;
  auswahl?: string[];
  /** #112: the words the driver takes now, and why one is missing (null: none missing) */
  werte?: string[];
  hinweis?: string | null;
}

/** #112: how an epic is merged: by the driver after the gate (merge.ps1), or a person looks at every PR */
export type Stellung = 'automatisch' | 'mensch';

export interface WirksameStellung {
  stellung: Stellung;
  /** projekt: the project's setting; vorschlag: the content touches BEIM_MENSCHEN; epic: the person's switch on the bridge */
  herkunft: 'projekt' | 'vorschlag' | 'epic';
  /** the reason of the proposal, also when the switch overrules it; null without one */
  grund: string | null;
}

/** why automatisch is not to be had: merge.ps1 refuses everything but merge: nach_gate on the default branch */
export const NUR_NACH_GATE = 'der Adapter sagt merge: mensch, automatisch andocken geht nur mit merge: nach_gate';

/**
 * #112: the merge of one epic. The person's switch overrules everything, a proposal from the content
 * overrules the project. automatisch never holds while the adapter says merge: mensch, whatever was
 * stored: the bridge can only tighten.
 */
export function wirksameStellung(projekt: Stellung, adapter: 'mensch' | 'nach_gate', vorschlag: string | null, epic: Stellung | null | undefined): WirksameStellung {
  const frei = adapter === 'nach_gate';
  if (epic === 'mensch' || (epic === 'automatisch' && frei)) return { stellung: epic, herkunft: 'epic', grund: vorschlag };
  if (vorschlag) return { stellung: 'mensch', herkunft: 'vorschlag', grund: vorschlag };
  return { stellung: frei ? projekt : 'mensch', herkunft: 'projekt', grund: null };
}

/** The value as the bridge sees it; accounts by their short name. */
export function lies(e: Einstellung, name: EinstellungName, kontoName: (dir: string) => string): Wert {
  switch (name) {
    case 'obergrenze':
      return e.obergrenze;
    case 'paketeJeEpic':
      return e.paketeJeEpic;
    case 'konten':
      return e.konten.map(kontoName);
    case 'admiral':
      return e.admiralKonto ? kontoName(e.admiralKonto) : null;
    case 'verbrauchGelb':
      return e.verbrauchGelb;
    case 'verbrauchRot':
      return e.verbrauchRot;
    case 'leerfahren':
      return e.leerfahren.map(kontoName);
    case 'ramWarn':
      return e.ramWarn;
    case 'platteMinGb':
      return e.plattMinGb;
    case 'leerlaufMin':
      return Math.round(e.leerlaufMs / 60_000);
    case 'merge':
      return e.merge;
    case 'triageModell':
      return e.triageModell;
    case 'admiralModell':
      return e.admiralModell;
    case 'triageLesenMax':
      return e.triageLesenMax;
    case 'meldung':
      return e.meldung;
    case 'einsammeln':
      return e.auto ? 'an' : 'aus';
  }
}

/**
 * Checks a value against the limits of the setting and writes it into e; the reason when it does not
 * fit (e stays as it was). `auswahl`: short name → CLAUDE_CONFIG_DIR of the accounts that exist.
 */
export function setze(e: Einstellung, name: EinstellungName, wert: unknown, auswahl: Map<string, string>): string | null {
  const a: Art = EINSTELLUNGEN[name];
  if (wert === null) {
    if (!a.leer) return 'braucht einen Wert';
  } else if (a.konto) {
    const liste = a.konto === 'eins' ? [wert] : wert;
    if (!Array.isArray(liste) || liste.some((k) => typeof k !== 'string')) return a.konto === 'eins' ? 'ein Konto erwartet' : 'eine Liste von Konten erwartet';
    const fremd = liste.filter((k) => !auswahl.has(k));
    if (fremd.length) return `unbekanntes Konto ${fremd.join(', ').slice(0, 100)} (bekannt: ${[...auswahl.keys()].join(', ')})`;
    if (new Set(liste).size !== liste.length) return 'ein Konto doppelt';
    if (name === 'konten' && !liste.length) return 'mindestens ein Konto';
  } else if (a.werte) {
    if (typeof wert !== 'string' || !a.werte.includes(wert)) return `${JSON.stringify(wert)?.slice(0, 40)} ist nicht ${a.werte.join(' oder ')}`;
  } else if (!Number.isInteger(wert) || (wert as number) < a.min! || (wert as number) > a.max!) {
    return `${JSON.stringify(wert)?.slice(0, 40)} liegt nicht zwischen ${a.min} und ${a.max}`;
  }
  const dirs = (x: unknown) => (x as string[]).map((k) => auswahl.get(k)!);
  const n = wert as number | null;
  switch (name) {
    case 'obergrenze':
      e.obergrenze = n;
      break;
    case 'paketeJeEpic':
      e.paketeJeEpic = n!;
      break;
    case 'konten':
      e.konten = dirs(wert);
      break;
    case 'admiral':
      e.admiralKonto = wert === null ? null : auswahl.get(wert as string)!;
      break;
    case 'verbrauchGelb':
      e.verbrauchGelb = n!;
      break;
    case 'verbrauchRot':
      e.verbrauchRot = n!;
      break;
    case 'leerfahren':
      e.leerfahren = dirs(wert);
      break;
    case 'ramWarn':
      e.ramWarn = n;
      break;
    case 'platteMinGb':
      e.plattMinGb = n!;
      break;
    case 'leerlaufMin':
      e.leerlaufMs = n! * 60_000;
      break;
    case 'merge':
      e.merge = wert as Stellung;
      break;
    case 'triageModell':
      e.triageModell = wert as string;
      break;
    case 'admiralModell':
      e.admiralModell = wert as string;
      break;
    case 'triageLesenMax':
      e.triageLesenMax = wert as number;
      break;
    case 'meldung':
      e.meldung = wert as 'an' | 'aus';
      break;
    case 'einsammeln':
      e.auto = wert === 'an';
      break;
  }
  return null;
}

/** a value for an event and the logbook */
export function zeige(w: Wert): string {
  if (w === null) return 'automatisch';
  if (Array.isArray(w)) return w.length ? w.join(', ') : 'keines';
  return String(w);
}
