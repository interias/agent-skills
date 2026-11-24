// The rules of the package loop as pure functions (mission/SKILL.md, "Modelle, Paketklasse,
// Kundschafter", Phase 4 and 4c): roles per rung, escalation ladder, the window choice, the
// verification against the Ausgangszahlen, the reading of a call's result, and the blocks to the
// driver (flotte/references/bloecke.md).

import type { LaufErgebnis } from '../werkzeuge/lauf.ts';
import { pruefeAusgabe, type Ausgaben, type Paket, type Rolle } from './schema.ts';
import type { EpicLaufZustand, PaketZustand, Stufe, Testlauf } from './zustand.ts';

export interface Besetzung {
  agent: string;
  modell: string;
  effort: string;
}

export const IMPLEMENTER: Record<Stufe, Besetzung> = {
  mechanisch: { agent: 'ingenieur-mechanisch', modell: 'sonnet', effort: 'low' },
  standard: { agent: 'ingenieur-standard', modell: 'sonnet', effort: 'medium' },
  urteil: { agent: 'ingenieur-urteil', modell: 'opus', effort: 'medium' },
  'urteil-hoch': { agent: 'ingenieur-urteil-hoch', modell: 'opus', effort: 'high' },
};

/** the reviewer follows the rung; there is no reviewer above erster-offizier-urteil */
export const REVIEWER: Record<Stufe, Besetzung> = {
  mechanisch: { agent: 'erster-offizier-standard', modell: 'sonnet', effort: 'high' },
  standard: { agent: 'erster-offizier-standard', modell: 'sonnet', effort: 'high' },
  urteil: { agent: 'erster-offizier-urteil', modell: 'opus', effort: 'medium' },
  'urteil-hoch': { agent: 'erster-offizier-urteil', modell: 'opus', effort: 'medium' },
};

const LEITER: Stufe[] = ['mechanisch', 'standard', 'urteil', 'urteil-hoch'];

/** one rung up after a structural finding; urteil-hoch is the last */
export const hoeher = (s: Stufe): Stufe => LEITER[Math.min(LEITER.indexOf(s) + 1, LEITER.length - 1)];

const LAUFEND = ['implementer', 'reviewer', 'pruefung', 'merge'];
const ENDE = ['fertig', 'zurueckgelassen', 'blockiert'];

/** occupies a place of the window: from the implementer start until merged or left behind */
export const laeuft = (p: PaketZustand) => LAUFEND.includes(p.stufe);
export const istEnde = (p: PaketZustand) => ENDE.includes(p.stufe);

function paketeDes(z: EpicLaufZustand): Paket[] {
  return z.schnitt.ergebnis?.pakete ?? [];
}

export function kollidiert(z: EpicLaufZustand, a: string, b: string): boolean {
  const pa = paketeDes(z).find((p) => p.nr === a);
  const pb = paketeDes(z).find((p) => p.nr === b);
  return Boolean(pa?.kollision.includes(b) || pb?.kollision.includes(a) || z.kanten.some((k) => (k.a === a && k.b === b) || (k.a === b && k.b === a)));
}

/** direct successors over hard edges */
export const nachfolger = (z: EpicLaufZustand, nr: string) => paketeDes(z).filter((p) => p.nach.includes(nr)).map((p) => p.nr);

/** every package that depends on nr over hard edges, transitively */
export function alleNachfolger(z: EpicLaufZustand, nr: string): string[] {
  const out: string[] = [];
  const offen = [nr];
  while (offen.length) {
    for (const n of nachfolger(z, offen.pop()!)) {
      if (out.includes(n)) continue;
      out.push(n);
      offen.push(n);
    }
  }
  return out;
}

/** packages a merge of nr unlocks: successors whose other hard predecessors are all merged */
export function entsperrt(z: EpicLaufZustand, nr: string): number {
  return paketeDes(z).filter((s) => s.nach.includes(nr) && !istEnde(z.pakete[s.nr]) && s.nach.every((v) => v === nr || z.pakete[v]?.stufe === 'fertig')).length;
}

/** packages that wait for an answer at the gate (Betrifft: <Paket>, P18) */
export function geparkt(z: EpicLaufZustand): Set<string> {
  const out = new Set<string>();
  for (const f of z.fragen) if (f.art === 'tor' && f.antwort === null && Array.isArray(f.betrifft)) for (const p of f.betrifft) out.add(p);
  return out;
}

/**
 * Startbereit (mission/SKILL.md, Phase 4): all hard predecessors merged, no collision edge to a running
 * package, not parked; an exclusive node only with every place empty, and nothing next to a running one.
 */
export function startbereit(z: EpicLaufZustand, nr: string, laufend: string[], park: Set<string>): boolean {
  const p = paketeDes(z).find((x) => x.nr === nr);
  const s = z.pakete[nr];
  if (!p || !s || !['wartend', 'startbereit'].includes(s.stufe) || park.has(nr)) return false;
  if (!p.nach.every((v) => z.pakete[v]?.stufe === 'fertig')) return false;
  if (laufend.some((l) => kollidiert(z, nr, l))) return false;
  if (p.exklusiv && laufend.length) return false;
  if (laufend.some((l) => paketeDes(z).find((x) => x.nr === l)?.exklusiv)) return false;
  return true;
}

/** the order of candidates: most unlocked successors first, then the smaller number */
export function rangfolge(z: EpicLaufZustand, kandidaten: string[]): string[] {
  // '65' compares as 65, '69-p2' as 2: the child number or the package number within the spec
  const zahl = (nr: string) => Number(/(\d+)$/.exec(nr)?.[1] ?? 0);
  return [...kandidaten].sort((a, b) => entsperrt(z, b) - entsperrt(z, a) || zahl(a) - zahl(b) || a.localeCompare(b));
}

/**
 * The packages to start now: the choice is made anew for every free place, each start counts as
 * running for the next choice (collision, exclusive node).
 */
export function wahl(z: EpicLaufZustand, fenster: number): string[] {
  const laufend = Object.values(z.pakete).filter(laeuft).map((p) => p.nr);
  const park = geparkt(z);
  const gewaehlt: string[] = [];
  while (laufend.length < fenster) {
    const kandidaten = Object.keys(z.pakete).filter((nr) => !gewaehlt.includes(nr) && startbereit(z, nr, laufend, park));
    const naechstes = rangfolge(z, kandidaten)[0];
    if (!naechstes) break;
    gewaehlt.push(naechstes);
    laufend.push(naechstes);
  }
  return gewaehlt;
}

// ---- 4c: verification against the Ausgangszahlen

/** red files the package does not touch: candidates for a single run (Lastflake) */
export function flakeKandidaten(lauf: Testlauf, beruehrt: string[]): string[] {
  return [...new Set(lauf.flatMap((s) => s.rot.map((r) => r.datei)).filter((d) => !beruehrt.includes(d)))];
}

export interface Nachpruefung {
  ok: boolean;
  befunde: string[];
  lastflakes: string[];
}

/**
 * mission/SKILL.md 4c: red in a touched file is a finding; red only in untouched files that are green
 * alone is a Lastflake; a lower suite or test count is a finding even when all is green; new lint
 * findings in changed files are a finding.
 */
export function nachpruefung(x: { basis: Testlauf; lauf: Testlauf; beruehrt: string[]; einzeln: Record<string, boolean>; basisLint: Record<string, number>; lint: Record<string, number> }): Nachpruefung {
  const befunde: string[] = [];
  const lastflakes: string[] = [];
  for (const s of x.lauf) {
    for (const r of s.rot) {
      if (x.beruehrt.includes(r.datei)) befunde.push(`${s.name}: ${r.datei} rot (${r.test}), die Datei gehört zum Paket`);
      else if (x.einzeln[r.datei]) lastflakes.push(`${s.name}: ${r.datei} (${r.test}) rot im Volllauf, einzeln grün`);
      else befunde.push(`${s.name}: ${r.datei} rot (${r.test}), auch einzeln`);
    }
  }
  for (const b of x.basis) {
    const s = x.lauf.find((l) => l.name === b.name);
    if (!s) befunde.push(`Suite ${b.name} fehlt im Volllauf`);
    else if ((s.dateien !== null && b.dateien !== null && s.dateien < b.dateien) || s.tests < b.tests) befunde.push(`Suite ${b.name}: ${s.tests} Tests in ${s.dateien} Dateien, Ausgangszahl ${b.tests} in ${b.dateien}`);
  }
  for (const d of x.beruehrt) {
    const vorher = x.basisLint[d] ?? 0;
    const nachher = x.lint[d] ?? 0;
    if (nachher > vorher) befunde.push(`Lint: ${d} hat ${nachher} Befunde, vorher ${vorher}`);
  }
  return { ok: !befunde.length, befunde, lastflakes: [...new Set(lastflakes)] };
}

export const rot = (t: Testlauf) => t.some((s) => s.rot.length > 0);

// ---- reading a call's result

export type Bewertung<R extends Rolle> =
  | { art: 'ok'; daten: Ausgaben[R] }
  | { art: 'ungueltig'; fehler: string }
  | { art: 'abgebrochen'; fehler: string }
  | { art: 'verweigert'; fehler: string }
  | { art: 'konto'; fehler: string };

export const KONTOLIMIT = /(hit|reached) (your|the) (usage |session |weekly )?limit|usage limit|limit reached|resets (at )?\d/i;

/**
 * A finished, valid result is ok even with permission_denials: the agent took another way, and the
 * program counts the denials itself (P8, #108). Denials without such a result block (no second
 * try), an account limit or a login failure waits, a run that ended with exit ≠ 0 or without result
 * is resumed once (P9), a run that ended without a valid output gets the error back once (P8).
 */
export function bewerteAufruf<R extends Rolle>(rolle: R, r: LaufErgebnis): Bewertung<R> {
  if (r.verweigert.length && (r.fehler || pruefeAusgabe(rolle, r.strukturiert))) return { art: 'verweigert', fehler: `permission_denials: ${JSON.stringify(r.verweigert).slice(0, 200)}` };
  const letzte = r.ergebnisse[r.ergebnisse.length - 1];
  if (r.fehler === 'anmeldung') return { art: 'konto', fehler: 'Anmeldung des Kontos fehlt' };
  if (letzte?.istFehler && KONTOLIMIT.test(letzte.text)) return { art: 'konto', fehler: `Kontolimit: ${letzte.text.slice(0, 120)}` };
  if (r.fehler) return { art: 'abgebrochen', fehler: `${r.fehler}${r.code !== null ? ` (Exit ${r.code})` : ''}${r.stderr ? `: ${r.stderr.trim().slice(0, 200)}` : ''}` };
  const f = pruefeAusgabe(rolle, r.strukturiert);
  if (f) return { art: 'ungueltig', fehler: f };
  return { art: 'ok', daten: r.strukturiert as Ausgaben[R] };
}

// ---- blocks to the driver, in the form bloecke.ts reads

export interface BlockFrage {
  nr: number;
  frage: string;
  betrifft: 'Lauf' | string[];
  lage: string;
  optionen: string[];
  empfehlung: string;
  grund: string;
  quelle: string;
}

// #195: a dash between spaces separates the fields of a question line (bloecke.ts), so inside a field it becomes a hyphen
const flach = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/ [—–] /g, ' - ');

export function frageBlock(epic: number, phase: 'tor' | 'ram', fragen: BlockFrage[], stand: string): string {
  const zeilen = fragen.map((f) => {
    // the cut often writes its own letter before an option (`A: …`); the block numbers them itself
    const optionen = f.optionen.map((o, i) => {
      const b = String.fromCharCode(65 + i);
      return `${b}) ${flach(o).replace(new RegExp(`^${b}[):]\\s*`), '')}`;
    }).join(' ');
    const betrifft = f.betrifft === 'Lauf' ? 'Lauf' : f.betrifft.join(', ');
    return `${f.nr}. ${flach(f.frage)} — Betrifft: ${betrifft} — Lage: ${flach(f.lage)} — Optionen: ${optionen} — Empfehlung: ${f.empfehlung} — Grund: ${flach(f.grund)} — Regel/Quelle: ${flach(f.quelle)}`;
  });
  return [`FLOTTE-FRAGE ${epic} ${phase}`, ...zeilen, `STAND: ${flach(stand)}  TAFEL: aus`].join('\n');
}

export function endeBlock(epic: number, pr: string | null, text: string, offen: string): string {
  return [`FLOTTE-ENDE ${epic}${pr ? ` ${pr}` : ''}`, '', text, '', '### Was das Epic offen lässt', offen || 'nichts'].join('\n');
}
