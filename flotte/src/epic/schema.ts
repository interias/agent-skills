// The outputs of the language-model points of `flotte epic` (#69, decision 4), version 1: cut,
// implementer, reviewer, conflict. Stage 1 (#65) needs only the fields the state machine reads; the
// JSON schemata handed to `claude -p --json-schema` and the prompts are stage 3 (#67).
// pruefeAusgabe names what is wrong with an output, null when it can be used.

export type Paketklasse = 'mechanisch' | 'standard' | 'urteil';

export interface Paket {
  /** child number ('65') or, for a spec without children, '<spec>-p<k>' */
  nr: string;
  titel: string;
  klasse: Paketklasse;
  abnahme: string[];
  /** Implementation Decisions with their reasons, in the wording of the issue */
  decisions: string[];
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

export interface Schnitt {
  version: 1;
  pakete: Paket[];
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
  /** what actually stands at the interface, for the successor's order (epic/SKILL.md, 4b) */
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
  for (const k of ['abnahme', 'decisions', 'dateien', 'nach', 'kollision']) if (!texte(p[k])) return `pakete[${i}].${k} ist keine Liste von Texten`;
  if (!(p.abnahme as string[]).length) return `pakete[${i}] hat keine Abnahmeliste`;
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

export function pruefeAusgabe(rolle: Rolle, x: unknown): string | null {
  if (!obj(x)) return 'keine strukturierte Ausgabe';
  if (x.version !== 1) return `version ist ${JSON.stringify(x.version)}, erwartet 1`;
  if (rolle === 'schnitt') {
    if (!Array.isArray(x.pakete) || !x.pakete.length) return 'pakete fehlt oder ist leer';
    for (let i = 0; i < x.pakete.length; i++) {
      const f = paketFehler(x.pakete[i], i);
      if (f) return f;
    }
    const graf = graphFehler(x.pakete as Paket[]);
    if (graf) return graf;
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
