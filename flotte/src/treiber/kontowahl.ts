// The order of the accounts for a new run (Tag P): the usage measured per account (#28) also holds the
// work outside the driver, so the driver evens it out. The account whose weekly window has the largest
// lead goes first: more of the limit left than the time until its reset asks for would lapse unused.
// It decides the order only; which accounts may take a run at all (green, active, under --konto-max,
// not throttled) the caller filters before.

import type { Bewertung } from '../werkzeuge/verbrauch.ts';

const WOCHE_MS = 7 * 24 * 3_600_000;
/** two leads within this many points count as a tie */
export const GLEICHSTAND_PUNKTE = 5;

/**
 * The lead of the weekly window in points: share of the limit left minus share of the time left until
 * its reset. Positive: more left than the time asks for. null without a measured weekly window.
 */
export function vorsprung(b: Bewertung | undefined, jetzt: number): number | null {
  const s = b?.sieben;
  if (!s) return null;
  const reset = Date.parse(s.reset);
  if (!Number.isFinite(reset)) return null;
  // a window whose reset lies in the past has started over: all left, all the time left
  if (reset <= jetzt) return 0;
  const zeit = Math.min(1, (reset - jetzt) / WOCHE_MS);
  // a usage above 100 % is possible in the measurement; the bridge takes −100…100
  return Math.max(-100, Math.min(100, Math.round(100 - s.verbraucht - 100 * zeit)));
}

/** points left in the 5-hour window; a window reset since the measurement is full again */
function luftFuenf(b: Bewertung | undefined, jetzt: number): number {
  const f = b?.fuenf;
  if (!f) return 0;
  return Date.parse(f.reset) <= jetzt ? 100 : 100 - f.verbraucht;
}

/**
 * The accounts in the order they take a run: the largest weekly lead first; leads within
 * GLEICHSTAND_PUNKTE of the best are a tie, decided by more room in the 5-hour window, then by
 * `bisher` (fewer runs, fewer missions). Accounts without a measured weekly window come last, in the
 * order of `bisher`.
 */
export function rangfolge(konten: string[], bewertung: (k: string) => Bewertung | undefined, jetzt: number, bisher: (a: string, b: string) => number): string[] {
  const mit = konten.filter((k) => vorsprung(bewertung(k), jetzt) !== null);
  const ohne = konten.filter((k) => vorsprung(bewertung(k), jetzt) === null).sort(bisher);
  const v = (k: string) => vorsprung(bewertung(k), jetzt)!;
  const reihe: string[] = [];
  // the tie is measured from the best one left, so the order stays the same however the list comes in
  while (mit.length) {
    const best = Math.max(...mit.map(v));
    const gleich = mit.filter((k) => v(k) >= best - GLEICHSTAND_PUNKTE);
    const k = gleich.sort((a, b) => luftFuenf(bewertung(b), jetzt) - luftFuenf(bewertung(a), jetzt) || bisher(a, b))[0];
    reihe.push(k);
    mit.splice(mit.indexOf(k), 1);
  }
  return [...reihe, ...ohne];
}

/** one sentence why: "Konto 2: 24 Punkte Vorsprung im Wochenfenster" */
export function grund(name: string, b: Bewertung | undefined, jetzt: number): string {
  const v = vorsprung(b, jetzt);
  if (v === null) return `${name}: kein Messwert im Wochenfenster, gewählt nach Zahl der Läufe`;
  return v < 0 ? `${name}: ${-v} Punkte Rückstand im Wochenfenster` : `${name}: ${v} Punkte Vorsprung im Wochenfenster`;
}
