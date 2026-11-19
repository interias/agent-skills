// The metrics of `flotte messen` (#14, "Messen"). Pure functions over transcript entries; the
// command in befehle/messen.ts supplies transcripts, pull requests, usage.ps1 and the remains.
// The same functions measure old deployments (Leitstand, Admiral, windows) and new ones (driver).

import type { Eintrag } from './transkript.ts';

const MIN = 60_000;
const EMPFEHLUNG = /\((Recommended|Empfehlung)\)/i;

export interface Fenster {
  von: number;
  bis: number;
}

export interface Rueckfrage {
  zeit: number;
  wartenMin: number | null;
  /** ask: AskUserQuestion; text: a question round as text (❓), answered by the next input of a person */
  form: 'ask' | 'text' | 'treiber';
  /** null: the transcript does not show whether the answer was the recommendation */
  gefolgt: boolean | null;
  epic: number | null;
  frage: string;
}

function imFenster(t: number, f: Fenster): boolean {
  return t >= f.von && t <= f.bis;
}

/** The first epic of the deployment the text names as #<n>, or null. */
export function epicAus(text: string, epics: number[]): number | null {
  for (const m of text.matchAll(/#(\d+)\b/g)) {
    const n = Number(m[1]);
    if (epics.includes(n)) return n;
  }
  return null;
}

/** Answers of an AskUserQuestion result: from toolUseResult.answers, else from the text "q"="a". */
export function antworten(text: string, daten: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const answers = (daten as { answers?: Record<string, unknown> } | null)?.answers;
  if (answers && typeof answers === 'object') {
    for (const [q, a] of Object.entries(answers)) out.set(q, String(a));
    if (out.size) return out;
  }
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)) out.set(m[1], m[2]);
  return out;
}

interface Frage {
  question?: string;
  options?: { label?: string }[];
}

export function rueckfragen(eintraege: Eintrag[], epics: number[], fenster: Fenster): Rueckfrage[] {
  const out: Rueckfrage[] = [];
  for (let i = 0; i < eintraege.length; i++) {
    const e = eintraege[i];
    if (e.art !== 'assistent' || !imFenster(e.zeit, fenster)) continue;

    for (const aufruf of e.aufrufe.filter((a) => a.name === 'AskUserQuestion')) {
      const fragen = (aufruf.input.questions as Frage[] | undefined) ?? [];
      let ergebnis: { zeit: number; text: string; daten: unknown } | null = null;
      for (let k = i + 1; k < eintraege.length && !ergebnis; k++) {
        const r = eintraege[k].ergebnisse.find((x) => x.id === aufruf.id);
        if (r) ergebnis = { zeit: eintraege[k].zeit, text: r.text, daten: r.daten };
      }
      const map = ergebnis ? antworten(ergebnis.text, ergebnis.daten) : new Map<string, string>();
      for (const f of fragen) {
        const frage = String(f.question ?? '');
        const antwort = map.get(frage);
        const empfohlen = (f.options ?? []).find((o) => EMPFEHLUNG.test(String(o.label ?? '')));
        let gefolgt: boolean | null = null;
        if (antwort !== undefined && empfohlen && !antwort.startsWith('[User did not answer')) {
          gefolgt = antwort.trim() === String(empfohlen.label).trim();
        }
        out.push({
          zeit: e.zeit,
          wartenMin: ergebnis ? (ergebnis.zeit - e.zeit) / MIN : null,
          form: 'ask',
          gefolgt,
          epic: epicAus(frage, epics),
          frage: frage.slice(0, 200),
        });
      }
    }

    if (e.stop === 'end_turn' && e.text.includes('❓')) {
      const naechste = eintraege.slice(i + 1).find((x) => x.art === 'mensch');
      for (const teil of e.text.split('❓').slice(1)) {
        out.push({
          zeit: e.zeit,
          wartenMin: naechste ? (naechste.zeit - e.zeit) / MIN : null,
          form: 'text',
          gefolgt: null,
          epic: epicAus(teil, epics),
          frage: teil.trim().slice(0, 200),
        });
      }
    }
  }
  return out;
}

/**
 * Cold time of a run: minutes between the end of a turn and the next input from outside (a
 * person or another session). A turn that ends and is woken by a notification about its own
 * background work was waiting for that work, not cold. A gap shorter than schwelleMin is
 * reaction time. The trailing wait after the last turn is not counted: the transcript does not
 * say whether anyone still needed the run.
 */
export function kalteZeit(eintraege: Eintrag[], fenster: Fenster, schwelleMin = 2): number {
  let kalt = 0;
  let endeSeit: number | null = null;
  for (const e of eintraege) {
    if (e.art === 'assistent') {
      endeSeit = e.stop === 'end_turn' ? e.zeit : null;
      continue;
    }
    if (e.art === 'meldung') {
      endeSeit = null;
      continue;
    }
    if ((e.art === 'mensch' || e.art === 'nachricht') && endeSeit !== null) {
      const von = Math.max(endeSeit, fenster.von);
      const bis = Math.min(e.zeit, fenster.bis);
      const luecke = (bis - von) / MIN;
      if (luecke >= schwelleMin) kalt += luecke;
      endeSeit = null;
    }
  }
  return kalt;
}

/** A start whose order was not taken: no answer of the model within the first minutes. */
export function istFehlstart(eintraege: Eintrag[], grenzeMin = 3): boolean {
  if (!eintraege.length) return true;
  const start = eintraege[0].zeit;
  return !eintraege.some((e) => e.art === 'assistent' && e.zeit - start <= grenzeMin * MIN);
}

export interface PullRequest {
  number: number;
  createdAt: string;
  mergedAt: string | null;
}

export interface PrDauer {
  pr: number;
  bereit: number;
  gemergt: number;
  minuten: number;
  /** true: no "ready" marker found in the runs, the creation time stands in */
  geschaetzt: boolean;
}

/** Ready is the first FLOTTE-ENDE or "PR #<n> bereit" of a run that names the pull request. */
export function prDauern(prs: PullRequest[], laeufe: Eintrag[][], fenster: Fenster): PrDauer[] {
  const out: PrDauer[] = [];
  for (const pr of prs) {
    if (!pr.mergedAt) continue;
    const gemergt = Date.parse(pr.mergedAt);
    if (!imFenster(gemergt, fenster)) continue;
    const erstellt = Date.parse(pr.createdAt);
    const nennt = new RegExp(`(#${pr.number}\\b|/pull/${pr.number}\\b)`);
    let bereit: number | null = null;
    for (const lauf of laeufe) {
      for (const e of lauf) {
        if (e.art !== 'assistent' || e.zeit < erstellt - 60 * MIN || e.zeit > gemergt) continue;
        if (!/FLOTTE-ENDE|bereit/.test(e.text) || !nennt.test(e.text)) continue;
        if (bereit === null || e.zeit < bereit) bereit = e.zeit;
      }
    }
    const b = bereit ?? erstellt;
    out.push({ pr: pr.number, bereit: b, gemergt, minuten: Math.max(0, (gemergt - b) / MIN), geschaetzt: bereit === null });
  }
  return out;
}

export interface Verteilung {
  n: number;
  summe: number;
  mittel: number | null;
  median: number | null;
  max: number | null;
}

export function verteilung(werte: number[]): Verteilung {
  const w = [...werte].sort((a, b) => a - b);
  const summe = w.reduce((s, x) => s + x, 0);
  const median = w.length ? (w.length % 2 ? w[(w.length - 1) / 2] : (w[w.length / 2 - 1] + w[w.length / 2]) / 2) : null;
  return { n: w.length, summe: runde(summe), mittel: w.length ? runde(summe / w.length) : null, median: median === null ? null : runde(median), max: w.length ? runde(w[w.length - 1]) : null };
}

export function runde(x: number): number {
  return Math.round(x * 10) / 10;
}

/** What `flotte messen` needs from the state file of the driver (src/treiber/treiber.ts). */
export interface TreiberZustand {
  ereignisse: { zeit: string; epic: number | null; text: string }[];
  fragen: { epic: number; nr: number; frage: string; empfehlung: string; beantwortet?: string }[];
  entscheidungen: { epic: number }[];
}

/**
 * Questions, waiting time, cold time and starts of a deployment of the driver (acceptance finding
 * 14): the questions to the person and their waits come from the driver's events, not from
 * transcripts, where a run under the driver never asks anyone. Cold time is measured as in
 * kalteZeit: from the end of a turn to the next start of that epic, without the wait for the
 * person in between, gaps from schwelleMin on.
 */
export function treiberKennzahlen(z: TreiberZustand, fenster: Fenster, schwelleMin = 2) {
  const ev = z.ereignisse.map((e) => ({ ...e, t: Date.parse(e.zeit) })).filter((e) => imFenster(e.t, fenster));
  const fragen: Rueckfrage[] = [];
  for (const f of z.fragen) {
    const q = ev.find((e) => e.epic === f.epic && e.text.includes(`Frage ${f.nr} liegt beim Menschen`));
    if (!q) continue;
    const a = ev.find((e) => e.epic === f.epic && e.t >= q.t && e.text.includes(`Antwort des Menschen auf Frage ${f.nr}`));
    const buchstabe = /^[A-H]$/.test(f.empfehlung.trim()) ? f.empfehlung.trim() : null;
    fragen.push({
      zeit: q.t,
      wartenMin: a ? (a.t - q.t) / MIN : null,
      form: 'treiber',
      gefolgt: f.beantwortet && buchstabe ? new RegExp(`(^|[^A-Za-z])${buchstabe}([^A-Za-z]|$)`).test(f.beantwortet) : null,
      epic: f.epic,
      frage: f.frage,
    });
  }
  const epics = [...new Set(ev.map((e) => e.epic).filter((n): n is number => n !== null))];
  const kalt = epics.map((nr) => {
    const mine = ev.filter((e) => e.epic === nr);
    let minuten = 0;
    let endeSeit: number | null = null;
    let warten = 0;
    let frageSeit: number | null = null;
    for (const e of mine) {
      if (/^Zug zu Ende/.test(e.text)) {
        endeSeit = e.t;
        warten = 0;
      } else if (/liegt beim Menschen/.test(e.text)) frageSeit ??= e.t;
      else if (/^Antwort des Menschen/.test(e.text) && frageSeit !== null) {
        warten += e.t - frageSeit;
        frageSeit = null;
      } else if (/^Lauf (gestartet|fortgesetzt)/.test(e.text) && endeSeit !== null) {
        const luecke = (e.t - endeSeit - warten) / MIN;
        if (luecke >= schwelleMin) minuten += luecke;
        endeSeit = null;
      }
    }
    return { epic: nr, minuten };
  });
  const starts = ev.filter((e) => /^Lauf (gestartet|fortgesetzt)/.test(e.text)).length;
  const fehlstarts = ev.filter((e) => /^Start ohne Ergebnis/.test(e.text)).length;
  return { fragen, kalt, starts, fehlstarts, entscheidungen: z.entscheidungen.length };
}
