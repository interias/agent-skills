/**
 * Forecast for epics and the backlog (#28, Prognose): measured per repository, it settles itself.
 *
 * The driver appends one record per finished epic to `<flotte dir>/messungen.jsonl` (per repository,
 * across deployments). The forecast is a Monte Carlo over the measured distributions, never a mean:
 * per run it draws a pace (seconds of work per weighted package, from one finished epic), the
 * packages of the epic with their class and escalations (from all finished packages), and a gate
 * time. Complexity counts by class, not by the bare number of tickets. Waits for the person are left
 * out of the measurements and so out of the forecast.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Klasse = 'mechanisch' | 'standard' | 'urteil' | 'urteil-hoch';

export interface MessPaket {
  name: string;
  klasse: Klasse;
  /** implementer calls of the package in a higher class than its first */
  eskalationen: number;
}

export interface Messung {
  epic: number;
  titel: string;
  konto: string | null;
  /** first run started, last FLOTTE-ENDE (ISO) */
  start: string;
  ende: string;
  /** end minus start minus the time the whole run waited for the person */
  arbeitS: number;
  menschWartenS: number;
  /** the driver's own gate runs in the merge queue */
  gateS: number;
  pakete: MessPaket[];
  /** the forecast shown before the first run, and whether arbeitS + gateS fell into its span */
  prognose: Spanne | null;
  treffer: boolean | null;
}

/** seconds; the board shows p50–p90, the self check counts p10–p90 */
export interface Spanne {
  p10: number;
  p50: number;
  p90: number;
}

export const GEWICHT: Record<Klasse, number> = { mechanisch: 0.5, standard: 1, urteil: 2, 'urteil-hoch': 3 };
/** an escalation costs a further round of the higher class */
export const ESKALATION = 1;
/** a run works on at most three packages at once */
export const PARALLEL = 3;
export const LAEUFE = 2000;
/** below this hit rate the board hides the forecast */
export const MIN_TREFFER = 0.6;
/** the hit rate counts from this many checked epics */
export const MIN_GEPRUEFT = 5;

export const DATEI = 'messungen.jsonl';

export function liesMessungen(dir: string): Messung[] {
  const p = join(dir, DATEI);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .flatMap((z) => {
      try {
        const m = JSON.parse(z) as Messung;
        return typeof m.epic === 'number' && typeof m.arbeitS === 'number' ? [m] : [];
      } catch {
        return [];
      }
    });
}

export function schreibeMessung(dir: string, m: Messung): void {
  appendFileSync(join(dir, DATEI), JSON.stringify(m) + '\n');
}

// transcripts before the Sprachraum (ADR-0003) carry the old agent names
export const KLASSE = /^(?:ingenieur|epic-implementer)-(mechanisch|standard|urteil-hoch|urteil)$/;
const PAKET = /#\d+|\bP\d+\b/;
export const RANG: Klasse[] = ['mechanisch', 'standard', 'urteil', 'urteil-hoch'];

/**
 * The packages of a run from its logs (stream-json of claude -p, all turns): each Agent call of an
 * ingenieur names its package in the description (`Implementer #588 …`, `Implementer P2 …`).
 * The first call gives the class, every later one in a higher class is an escalation.
 */
export function paketeAusLogs(logs: string[]): MessPaket[] {
  const je = new Map<string, Klasse[]>();
  for (const log of logs) {
    for (const zeile of log.split(/\r?\n/)) {
      let j: { type?: string; message?: { content?: unknown } };
      try {
        j = JSON.parse(zeile);
      } catch {
        continue;
      }
      if (j.type !== 'assistant' || !Array.isArray(j.message?.content)) continue;
      for (const c of j.message.content as { type?: string; name?: string; input?: { subagent_type?: string; description?: string } }[]) {
        if (c.type !== 'tool_use' || (c.name !== 'Agent' && c.name !== 'Task')) continue;
        const k = KLASSE.exec(c.input?.subagent_type ?? '');
        const p = PAKET.exec(c.input?.description ?? '');
        if (!k || !p) continue;
        je.set(p[0], [...(je.get(p[0]) ?? []), k[1] as Klasse]);
      }
    }
  }
  return [...je].map(([name, ks]) => {
    let hoechste = RANG.indexOf(ks[0]);
    let eskalationen = 0;
    for (const k of ks.slice(1)) {
      if (RANG.indexOf(k) > hoechste) {
        eskalationen++;
        hoechste = RANG.indexOf(k);
      }
    }
    return { name, klasse: ks[0], eskalationen };
  });
}

/** the weight of a run: its packages by class and escalations, spread over up to three at once */
export function gewicht(pakete: { klasse: Klasse; eskalationen: number }[]): number {
  if (!pakete.length) return 0;
  const summe = pakete.reduce((s, p) => s + GEWICHT[p.klasse] + ESKALATION * p.eskalationen, 0);
  return summe / Math.min(PARALLEL, pakete.length);
}

/** mulberry32: a small seeded generator, so a forecast is the same for the same data */
export function zufall(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ziehe = <T>(xs: T[], r: () => number): T => xs[Math.floor(r() * xs.length)];

function quantil(werte: number[], q: number): number {
  const s = [...werte].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** the measurements a forecast can use: a known weight */
const brauchbar = (hist: Messung[]) => hist.filter((m) => gewicht(m.pakete) > 0 && m.arbeitS > 0);

/** one drawn duration of an epic with n packages (null: unknown, drawn from the history too) */
function einEpic(hist: Messung[], n: number | null, r: () => number): number {
  const m = ziehe(hist, r);
  const tempo = m.arbeitS / gewicht(m.pakete);
  const alle = hist.flatMap((h) => h.pakete);
  const anzahl = n && n > 0 ? n : ziehe(hist, r).pakete.length;
  const pakete = Array.from({ length: anzahl }, () => ziehe(alle, r));
  return tempo * gewicht(pakete) + ziehe(hist, r).gateS;
}

/**
 * The span for one epic: n its child tickets (spec mode: null). Null when the history is too short
 * (`ab` finished epics with a known weight).
 */
export function prognoseEpic(hist: Messung[], n: number | null, ab: number, seed = 1): Spanne | null {
  const h = brauchbar(hist);
  if (h.length < ab) return null;
  const r = zufall(seed);
  const d = Array.from({ length: LAEUFE }, () => einEpic(h, n, r));
  return { p10: quantil(d, 0.1), p50: quantil(d, 0.5), p90: quantil(d, 0.9) };
}

/**
 * When the backlog is empty: every released epic not yet done (n its tickets, bisherS the work it has
 * done so far) on `obergrenze` places at once, in the given order, each drawn as above. Seconds from now.
 */
export function prognoseBacklog(hist: Messung[], epics: { n: number | null; bisherS: number }[], obergrenze: number, ab: number, seed = 1): Spanne | null {
  const h = brauchbar(hist);
  if (h.length < ab || !epics.length) return null;
  const r = zufall(seed);
  const plaetze = Math.max(1, obergrenze);
  const d = Array.from({ length: LAEUFE }, () => {
    const frei = Array<number>(plaetze).fill(0);
    for (const e of epics) {
      // a running epic needs what is left, at least a tenth of a drawn run
      const voll = einEpic(h, e.n, r);
      const rest = Math.max(voll - e.bisherS, voll * 0.1);
      const i = frei.indexOf(Math.min(...frei));
      frei[i] += rest;
    }
    return Math.max(...frei);
  });
  return { p10: quantil(d, 0.1), p50: quantil(d, 0.5), p90: quantil(d, 0.9) };
}

/** did the measured duration fall into the span shown before (p10–p90)? */
export function getroffen(s: Spanne | null, dauerS: number): boolean | null {
  return s ? dauerS >= s.p10 && dauerS <= s.p90 : null;
}

export interface PrognoseStand {
  /** zu_wenig: below the threshold; ungenau: hit rate under 60 %; ok */
  status: 'zu_wenig' | 'ungenau' | 'ok';
  ab: number;
  bisher: number;
  treffer: number;
  geprueft: number;
}

export function stand(hist: Messung[], ab: number): PrognoseStand {
  const bisher = brauchbar(hist).length;
  const geprueft = hist.filter((m) => m.treffer !== null && m.treffer !== undefined);
  const treffer = geprueft.filter((m) => m.treffer).length;
  const status = bisher < ab ? 'zu_wenig' : geprueft.length >= MIN_GEPRUEFT && treffer / geprueft.length < MIN_TREFFER ? 'ungenau' : 'ok';
  return { status, ab, bisher, treffer, geprueft: geprueft.length };
}
