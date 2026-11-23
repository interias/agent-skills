// The outputs of the language-model points of `flotte mission` (#69, decision 4), version 1: cut,
// implementer, reviewer, conflict. The JSON schemata handed to `claude -p --json-schema` are built
// from these types (schemata.ts); the orders are written from the fields of the cut (auftraege.ts).
// pruefeAusgabe names what is wrong with an output, null when it can be used; for the cut it checks
// the form the program can check itself: graph, coverage of the stories, an acceptance list each.
// abdeckungFehler holds the cut against the target issue: every child placed (tickets), as many
// stories as the issue has (spec).

import { abschnitt, kinderAus } from '../werkzeuge/belegung.ts';

export type Paketklasse = 'mechanisch' | 'standard' | 'urteil';

export interface Paket {
  /** child number ('65') or, for a spec without children, '<spec>-p<k>' */
  nr: string;
  titel: string;
  klasse: Paketklasse;
  abnahme: string[];
  /** Implementation Decisions with their reasons, in the wording of the issue */
  decisions: string[];
  /** the Out-of-Scope points that concern the package */
  outOfScope: string[];
  /** Testing Decisions with their named model */
  testing: string[];
  /** the way of verification of the package (verification_section or the issue) */
  verifikation: string;
  /** reading before the first change beyond must_read and glossary: ADRs the issue names, the README of the module */
  lektuere: string[];
  /** touched files and modules, with the dependents the code graph names */
  dateien: string[];
  /** hard predecessors: they must be merged before this package starts */
  nach: string[];
  /** collision edges: never at the same time */
  kollision: string[];
  /** exclusive node: starts only with all places empty, nothing next to it */
  exklusiv: boolean;
}

export interface TorOption {
  text: string;
  /** choosing this option rejects: the package (or, for Betrifft Lauf, the whole run) does not start */
  abbruch?: boolean;
}

export interface TorPunkt {
  frage: string;
  /** 'Lauf': nothing starts before the answer; a list: only these packages wait */
  betrifft: 'Lauf' | string[];
  lage: string;
  optionen: TorOption[];
  /** letter of the recommended option */
  empfehlung: string;
  grund: string;
  quelle: string;
}

/** one user story (mode spec) or one workable child (mode tickets) and the package it goes to */
export interface Zuordnung {
  story: string;
  paket: string;
}

/** a child this run does not work on (mission/SKILL.md, Phase 1 and 2d): it gets a comment with the reason */
export interface Uebersprungen {
  nr: string;
  /** the exact reason and what unlocks it */
  grund: string;
  /** the tickets that block it; not empty: the child gets status/blockiert */
  blocker: string[];
}

export interface Schnitt {
  version: 1;
  modus: 'tickets' | 'spec';
  pakete: Paket[];
  /** mission/SKILL.md 2a, the table story → package: every story exactly one package */
  zuordnung: Zuordnung[];
  /** children of the epic that are no package, with their reason */
  uebersprungen: Uebersprungen[];
  tor: TorPunkt[];
}

export interface Volllauf {
  suite: string;
  dateien: number;
  tests: number;
  gruen: boolean;
}

export interface ImplementerBericht {
  version: 1;
  dateien: string[];
  neueDateien: string[];
  /** one sentence per acceptance point */
  abnahme: { punkt: string; satz: string }[];
  volllauf: Volllauf[];
  nichtGekonnt: string[];
  /** work taken over from elsewhere: source and author */
  fremdarbeit: string[];
  /** subject of the commit of 4d after commit_style and commit_language of the adapter */
  betreff: string;
  /** the why for the body of that commit */
  warum: string;
}

export interface Befund {
  gruppe: 'muss' | 'sollte' | 'kann';
  fundstelle: string;
  text: string;
}

export interface ReviewerBericht {
  version: 1;
  befunde: Befund[];
  strukturell: boolean;
  /** what actually stands at the interface, for the successor's order (mission/SKILL.md, 4b) */
  schnittstelle: string;
  selbstkorrekturen: string[];
}

export interface KonfliktBericht {
  version: 1;
  ergebnis: 'geloest' | 'inhaltlich';
  begruendung: string;
}

export type Rolle = 'schnitt' | 'implementer' | 'reviewer' | 'konflikt';

export interface Ausgaben {
  schnitt: Schnitt;
  implementer: ImplementerBericht;
  reviewer: ReviewerBericht;
  konflikt: KonfliktBericht;
}

const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const texte = (x: unknown) => Array.isArray(x) && x.every((t) => typeof t === 'string');

function paketFehler(p: unknown, i: number): string | null {
  if (!obj(p)) return `pakete[${i}] ist kein Objekt`;
  if (typeof p.nr !== 'string' || !p.nr) return `pakete[${i}].nr fehlt`;
  if (!['mechanisch', 'standard', 'urteil'].includes(String(p.klasse))) return `pakete[${i}].klasse ist nicht mechanisch, standard oder urteil`;
  if (typeof p.titel !== 'string') return `pakete[${i}].titel fehlt`;
  for (const k of ['abnahme', 'decisions', 'outOfScope', 'testing', 'lektuere', 'dateien', 'nach', 'kollision']) if (!texte(p[k])) return `pakete[${i}].${k} ist keine Liste von Texten`;
  if (!(p.abnahme as string[]).some((a) => a.trim())) return `pakete[${i}] hat keine Abnahmeliste`;
  if (typeof p.verifikation !== 'string') return `pakete[${i}].verifikation fehlt`;
  if (typeof p.exklusiv !== 'boolean') return `pakete[${i}].exklusiv fehlt`;
  return null;
}

/**
 * The form of the graph (#69: the program checks only the form): every edge names a package of the
 * cut, no number twice, no cycle over hard edges. Otherwise a package would wait forever.
 */
function graphFehler(pakete: Paket[]): string | null {
  const nummern = new Set(pakete.map((p) => p.nr));
  if (nummern.size !== pakete.length) return 'eine Paketnummer steht doppelt';
  for (const p of pakete) {
    for (const k of ['nach', 'kollision'] as const) {
      const fremd = p[k].find((n) => !nummern.has(n) || n === p.nr);
      if (fremd !== undefined) return `pakete ${p.nr}: ${k} nennt ${fremd === p.nr ? 'sich selbst' : `das unbekannte Paket ${fremd}`}`;
    }
  }
  const nach = new Map(pakete.map((p) => [p.nr, p.nach]));
  const fertig = new Set<string>();
  const pfad: string[] = [];
  const besuche = (nr: string): string | null => {
    if (fertig.has(nr)) return null;
    if (pfad.includes(nr)) return [...pfad.slice(pfad.indexOf(nr)), nr].join(' → ');
    pfad.push(nr);
    for (const v of nach.get(nr) ?? []) {
      const z = besuche(v);
      if (z) return z;
    }
    pfad.pop();
    fertig.add(nr);
    return null;
  };
  for (const p of pakete) {
    const zyklus = besuche(p.nr);
    if (zyklus) return `Zyklus über harte Kanten: ${zyklus}`;
  }
  return null;
}

/**
 * mission/SKILL.md 2a: every story goes to exactly one package of the cut, and every package has a
 * story (a package without one is work nobody asked for). In mode tickets the stories are the
 * workable children: each one is its own package.
 */
function zuordnungFehler(modus: string, pakete: Paket[], zuordnung: unknown): string | null {
  if (!Array.isArray(zuordnung) || !zuordnung.length) return 'zuordnung fehlt oder ist leer';
  const nummern = new Set(pakete.map((p) => p.nr));
  const gesehen = new Map<string, string>();
  for (const [i, z] of zuordnung.entries()) {
    if (!obj(z) || typeof z.story !== 'string' || !z.story.trim() || typeof z.paket !== 'string') return `zuordnung[${i}] unvollständig`;
    const story = z.story.trim();
    if (!nummern.has(z.paket)) return `zuordnung: ${story} geht an das unbekannte Paket ${z.paket}`;
    const vorher = gesehen.get(story);
    if (vorher !== undefined) return `zuordnung: ${story} steht ${vorher === z.paket ? 'doppelt' : `bei den Paketen ${vorher} und ${z.paket}`}, jede Story gehört genau einem Paket`;
    gesehen.set(story, z.paket);
    if (modus === 'tickets' && story.replace(/^#/, '').split(/\s/)[0] !== z.paket) return `zuordnung: im Modus tickets ist jedes Missionsziel sein eigenes Paket, ${story} geht an ${z.paket}`;
  }
  const ohne = pakete.find((p) => ![...gesehen.values()].includes(p.nr));
  return ohne ? `Paket ${ohne.nr} hat keine Story in der Zuordnung` : null;
}

function uebersprungenFehler(pakete: Paket[], ue: unknown): string | null {
  if (!Array.isArray(ue)) return 'uebersprungen fehlt';
  const gesehen = new Set<string>();
  for (const [i, u] of ue.entries()) {
    if (!obj(u) || typeof u.nr !== 'string' || !u.nr || typeof u.grund !== 'string' || !u.grund.trim() || !texte(u.blocker)) return `uebersprungen[${i}] unvollständig`;
    const nr = u.nr.replace(/^#/, '');
    if (pakete.some((p) => p.nr === nr)) return `uebersprungen: ${nr} ist zugleich ein Paket`;
    if (gesehen.has(nr)) return `uebersprungen: ${nr} steht doppelt`;
    gesehen.add(nr);
  }
  return null;
}

const ohneRaute = (s: string) => s.trim().replace(/^#/, '').split(/\s/)[0];

/**
 * The cut against the body of the target issue, so that a story or a child the model left out of
 * its own lists is noticed. tickets: every child the body names (Kinder: in the header line or a
 * checklist) stands in zuordnung or in uebersprungen, not in both. spec: the section
 * `## User Stories` has as many top-level entries as zuordnung has distinct stories. A body that
 * names no child or has no such section gives nothing to check.
 */
export function abdeckungFehler(s: Schnitt, body: string): string | null {
  if (s.modus === 'tickets') {
    const zugeordnet = new Set(s.zuordnung.map((z) => ohneRaute(z.story)));
    const weg = new Set(s.uebersprungen.map((u) => ohneRaute(u.nr)));
    for (const k of kinderAus(body).map(String)) {
      if (zugeordnet.has(k) && weg.has(k)) return `Missionsziel #${k} steht in zuordnung und in uebersprungen`;
      if (!zugeordnet.has(k) && !weg.has(k)) return `Missionsziel #${k} der Mission steht weder in zuordnung noch in uebersprungen`;
    }
    return null;
  }
  const stories = abschnitt(body, '## User Stories')
    .split(/\r?\n/)
    .filter((z) => /^(\d+[.)]|[-*])\s+\S/.test(z) && !/^[-*]\s+\[[ xX]\]\s+#\d+/.test(z)).length;
  const zugeordnet = new Set(s.zuordnung.map((z) => z.story.trim())).size;
  return stories && stories !== zugeordnet ? `Das Issue hat ${stories} User Stories, die Zuordnung nennt ${zugeordnet}; jede Story gehört genau einem Paket` : null;
}

export function pruefeAusgabe(rolle: Rolle, x: unknown): string | null {
  if (!obj(x)) return 'keine strukturierte Ausgabe';
  if (x.version !== 1) return `version ist ${JSON.stringify(x.version)}, erwartet 1`;
  if (rolle === 'schnitt') {
    if (x.modus !== 'tickets' && x.modus !== 'spec') return 'modus ist nicht tickets oder spec';
    if (!Array.isArray(x.pakete) || !x.pakete.length) return 'pakete fehlt oder ist leer';
    for (let i = 0; i < x.pakete.length; i++) {
      const f = paketFehler(x.pakete[i], i);
      if (f) return f;
    }
    const graf = graphFehler(x.pakete as Paket[]);
    if (graf) return graf;
    const zu = zuordnungFehler(x.modus, x.pakete as Paket[], x.zuordnung);
    if (zu) return zu;
    const ue = uebersprungenFehler(x.pakete as Paket[], x.uebersprungen);
    if (ue) return ue;
    if (!Array.isArray(x.tor)) return 'tor fehlt';
    for (const [i, t] of x.tor.entries()) {
      if (!obj(t) || typeof t.frage !== 'string' || !(t.betrifft === 'Lauf' || texte(t.betrifft)) || !Array.isArray(t.optionen) || !t.optionen.length) return `tor[${i}] unvollständig`;
    }
    return null;
  }
  if (rolle === 'implementer') {
    for (const k of ['dateien', 'neueDateien', 'nichtGekonnt', 'fremdarbeit']) if (!texte(x[k])) return `${k} ist keine Liste von Texten`;
    if (!Array.isArray(x.abnahme)) return 'abnahme fehlt';
    if (!Array.isArray(x.volllauf)) return 'volllauf fehlt';
    if (typeof x.betreff !== 'string' || typeof x.warum !== 'string') return 'betreff oder warum fehlt';
    return null;
  }
  if (rolle === 'reviewer') {
    if (!Array.isArray(x.befunde) || !x.befunde.every((b) => obj(b) && ['muss', 'sollte', 'kann'].includes(String(b.gruppe)))) return 'befunde fehlt oder hat eine Gruppe außer muss, sollte, kann';
    if (typeof x.strukturell !== 'boolean') return 'strukturell fehlt';
    if (typeof x.schnittstelle !== 'string') return 'schnittstelle fehlt';
    if (!texte(x.selbstkorrekturen)) return 'selbstkorrekturen fehlt';
    return null;
  }
  if (!['geloest', 'inhaltlich'].includes(String(x.ergebnis))) return 'ergebnis ist nicht geloest oder inhaltlich';
  if (typeof x.begruendung !== 'string') return 'begruendung fehlt';
  return null;
}
