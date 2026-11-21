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
  /** von 'mensch' (#52): an answer of the person, kept as a decision to revoke it; no decision of the admiral */
  entscheidungen: { epic: number; von?: string }[];
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
    const buchstabe = /^[A-Z]$/.test(f.empfehlung.trim()) ? f.empfehlung.trim() : null;
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
  return { fragen, kalt, starts, fehlstarts, entscheidungen: z.entscheidungen.filter((d) => d.von !== 'mensch').length };
}

// ---- Epic runs by role (#64) ----
// One epic run is split into its work: today the session of /epic and its subagents, under
// `flotte epic` one `claude -p` session per role. Both arrive here as Arbeit; the loader in
// befehle/messen.ts decides the role (subagent agentType or the role a session is listed with).

export type Rolle = 'orchestrator' | 'implementer' | 'reviewer' | 'kundschafter' | 'admiral' | 'schnitt' | 'konflikt' | 'andere';

/** Orchestration in the sense of the acceptance table of epic #69: cut, gate, conflict, questions. */
export const ORCHESTRIERUNG: Rolle[] = ['orchestrator', 'admiral', 'schnitt', 'konflikt'];

/** The role of an agent type or of a listed session: epic-implementer-urteil-hoch is an implementer, epic-lauf the orchestrator. */
export function rolleAus(agentType: string | null | undefined): Rolle {
  const t = String(agentType ?? '');
  if (/implementer/.test(t)) return 'implementer';
  if (/reviewer/.test(t)) return 'reviewer';
  if (/kundschafter/.test(t)) return 'kundschafter';
  if (/admiral/.test(t)) return 'admiral';
  if (t === 'epic-lauf' || t === 'host' || t === 'orchestrator') return 'orchestrator';
  if (t === 'schnitt' || t === 'konflikt') return t;
  return 'andere';
}

const LEITER = ['mechanisch', 'standard', 'urteil', 'urteil-hoch'];

/** The step of an implementer on the escalation ladder (epic/SKILL.md), or -1. */
export function stufeAus(agentType: string | null | undefined): number {
  const m = /implementer-(mechanisch|standard|urteil-hoch|urteil)\b/.exec(String(agentType ?? ''));
  return m ? LEITER.indexOf(m[1]) : -1;
}

export interface Arbeit {
  rolle: Rolle;
  agentType: string | null;
  /** package number as in the agent description ('#55', 'Paket 55', '41-p2'), null outside a package */
  paket: string | null;
  /** first and last line of its transcript */
  start: number;
  ende: number;
  weighted: number;
}

export interface PaketMerge {
  paket: string;
  zeit: number;
}

/** Nearest-rank quantile, q in (0, 1]. */
export function quantil(werte: number[], q: number): number | null {
  if (!werte.length) return null;
  const w = [...werte].sort((a, b) => a - b);
  return w[Math.min(w.length - 1, Math.max(0, Math.ceil(q * w.length) - 1))];
}

function zeitwerte(werte: number[], teiler: number) {
  const v = werte.map((x) => x / teiler);
  const p90 = quantil(v, 0.9);
  return { ...verteilung(v), p90: p90 === null ? null : runde(p90) };
}

/**
 * Model time of a transcript inside a span: per message of the model the gap to the line before,
 * at most 10 minutes (method of epic #69). Further lines of the same message add about nothing.
 */
export function modellzeit(eintraege: Eintrag[], von: number, bis: number): number {
  let ms = 0;
  for (let i = 1; i < eintraege.length; i++) {
    const e = eintraege[i];
    if (e.art !== 'assistent' || e.zeit < von || e.zeit > bis) continue;
    ms += Math.min(10 * MIN, Math.max(0, e.zeit - Math.max(eintraege[i - 1].zeit, von)));
  }
  return ms;
}

const MERGE = /\bgit\b[^\n]*\bmerge\b(?![-\w])[^\n]*?\bagent\/(\d+(?:-p\d+)?)/;

/**
 * Package merges of an orchestrator: a Bash or PowerShell call `git merge … agent/<nr>-…`
 * (epic/SKILL.md, phase 5), at the time of its result. A result with a conflict or an error does
 * not count; `--abort` and `merge-base` never do.
 */
export function paketMerges(eintraege: Eintrag[]): PaketMerge[] {
  const out: PaketMerge[] = [];
  for (let i = 0; i < eintraege.length; i++) {
    for (const a of eintraege[i].aufrufe) {
      if (a.name !== 'Bash' && a.name !== 'PowerShell') continue;
      const befehl = String(a.input.command ?? '');
      const m = MERGE.exec(befehl);
      if (!m || /--abort/.test(befehl)) continue;
      let zeit = eintraege[i].zeit;
      let text = '';
      for (let k = i + 1; k < eintraege.length; k++) {
        const r = eintraege[k].ergebnisse.find((x) => x.id === a.id);
        if (r) {
          zeit = eintraege[k].zeit;
          text = r.text;
          break;
        }
      }
      if (/CONFLICT|fatal:|Automatic merge failed/.test(text)) continue;
      out.push({ paket: m[1], zeit });
    }
  }
  return out;
}

export interface EpicEingabe {
  arbeiten: Arbeit[];
  merges: PaketMerge[];
  /** places of the window (adapter `window`) */
  fenster: number;
  /** hard predecessors per package; without them every package not yet started counts as ready */
  kanten?: Record<string, string[]>;
  /** run time of the epic without waiting for the person, as the driver measured it (messungen.jsonl) */
  arbeitMs?: number | null;
  /** model time of the orchestration between two moments; absent where no model orchestrates */
  modellzeit?: (von: number, bis: number) => number;
  /** moments the epic run was started anew (driver: "Lauf gestartet" after the first; flotte epic: event neustart) */
  neustarts?: number[];
  /** moments a worker process started, --resume included (flotte epic: its aufruf events); default the first lines of the worker transcripts */
  workerStarts?: number[];
  /** moments a call was started anew, not with --resume (flotte epic); counted between a restart and its first worker */
  neueAufrufe?: number[];
}

/**
 * The metrics of the acceptance table of epic #69 for one epic run. Weighted usage per role and per
 * package; a package carries its own work plus an equal share of the orchestration. A package
 * occupies a place from its first worker until its first merge (or its last work when it was never
 * merged). Window loss is the time a place was free while a package not yet started had all its
 * hard predecessors merged; collisions are not known here, so it is an upper bound.
 */
export function epicKennzahlen(x: EpicEingabe) {
  const summe = x.arbeiten.reduce((s, a) => s + a.weighted, 0);
  const jeRolle: Partial<Record<Rolle, { weighted: number; anteil: number; auftraege: number }>> = {};
  for (const a of x.arbeiten) {
    const r = (jeRolle[a.rolle] ??= { weighted: 0, anteil: 0, auftraege: 0 });
    r.weighted += a.weighted;
    r.auftraege++;
  }
  for (const r of Object.values(jeRolle)) {
    r.anteil = summe ? runde((r.weighted * 100) / summe) : 0;
    r.weighted = Math.round(r.weighted);
  }
  const orchestrierung = x.arbeiten.filter((a) => ORCHESTRIERUNG.includes(a.rolle) && !a.paket).reduce((s, a) => s + a.weighted, 0);
  const istWorker = (a: Arbeit) => a.rolle === 'implementer' || a.rolle === 'reviewer';

  const ersterMerge = (p: string) => x.merges.filter((m) => m.paket === p).reduce<number | null>((t, m) => (t === null || m.zeit < t ? m.zeit : t), null);
  const nummern = [...new Set(x.arbeiten.filter((a) => a.paket && istWorker(a)).map((a) => a.paket as string))];
  const pakete = nummern.map((p) => {
    const mine = x.arbeiten.filter((a) => a.paket === p);
    const impl = mine.filter((a) => a.rolle === 'implementer').sort((a, b) => a.start - b.start);
    const rev = mine.filter((a) => a.rolle === 'reviewer');
    let eskalationen = 0;
    for (let i = 1; i < impl.length; i++) if (stufeAus(impl[i].agentType) > stufeAus(impl[i - 1].agentType)) eskalationen++;
    const eigen = mine.reduce((s, a) => s + a.weighted, 0);
    const iw = impl.reduce((s, a) => s + a.weighted, 0);
    const rw = rev.reduce((s, a) => s + a.weighted, 0);
    const gemergt = ersterMerge(p);
    const reviewerZurueck = rev.filter((a) => gemergt === null || a.ende <= gemergt).reduce<number | null>((t, a) => (t === null || a.ende > t ? a.ende : t), null);
    return {
      paket: p,
      start: Math.min(...mine.filter(istWorker).map((a) => a.start)),
      ende: gemergt ?? Math.max(...mine.map((a) => a.ende)),
      gemergt,
      reviewerZurueck,
      implementer: Math.round(iw),
      reviewer: Math.round(rw),
      andere: Math.round(eigen - iw - rw),
      summe: Math.round(eigen + orchestrierung / nummern.length),
      implementerAuftraege: impl.length,
      eskalationen,
      merges: x.merges.filter((m) => m.paket === p).length,
      doppeltGestartet: impl.some((a, i) => impl.slice(i + 1).some((b) => b.start < a.ende)),
    };
  });

  // from a merge (or a reviewer coming back) to the next start of a package that was ready at that
  // merge (its hard predecessors merged), under an hour
  const bereitBei = (p: string, t: number) => (x.kanten?.[p] ?? []).every((v) => (ersterMerge(v) ?? Infinity) <= t);
  const bisStart = (t: number, bereitAb: number) => {
    const s = pakete.filter((p) => p.start >= t && p.start - t < 60 * MIN && bereitBei(p.paket, bereitAb)).reduce<number | null>((m, p) => (m === null || p.start < m ? p.start : m), null);
    return s === null ? [] : [s - t];
  };
  const gemergtBisStart = x.merges.flatMap((m) => bisStart(m.zeit, m.zeit));
  const zurueckBisStart = pakete.flatMap((p) => (p.reviewerZurueck === null ? [] : bisStart(p.reviewerZurueck, p.gemergt ?? p.reviewerZurueck)));
  const pruef = pakete.flatMap((p) => (p.gemergt === null || p.reviewerZurueck === null ? [] : [{ von: p.reviewerZurueck, bis: p.gemergt }]));

  // window loss: between the moments where occupancy or readiness can change
  let verlust = 0;
  let laufzeit = 0;
  if (pakete.length) {
    const punkte = [...new Set(pakete.flatMap((p) => [p.start, p.ende]).concat(x.merges.map((m) => m.zeit)))].sort((a, b) => a - b);
    laufzeit = punkte[punkte.length - 1] - punkte[0];
    for (let i = 0; i + 1 < punkte.length; i++) {
      const t = punkte[i];
      const belegt = pakete.filter((p) => p.start <= t && p.ende > t).length;
      const bereit = pakete.some((p) => p.start > t && (x.kanten?.[p.paket] ?? []).every((v) => (ersterMerge(v) ?? Infinity) <= t));
      if (belegt < x.fenster && bereit) verlust += punkte[i + 1] - t;
    }
  }

  const workerStarts = [...(x.workerStarts ?? x.arbeiten.filter(istWorker).map((a) => a.start))].sort((a, b) => a - b);
  const neustarts = (x.neustarts ?? []).map((t) => {
    const s = workerStarts.find((v) => v >= t);
    // a call started anew before the first worker is model usage for the rebuild; --resume of a running call is not
    const neu = x.neueAufrufe ? x.neueAufrufe.filter((v) => v >= t && v < (s ?? Infinity)).length : null;
    return { zeit: new Date(t).toISOString(), bis_erster_worker_s: s === undefined ? null : Math.round((s - t) / 1000), neue_aufrufe_bis_worker: neu };
  });

  const ir = pakete.map((p) => p.implementer + p.reviewer);
  const mittel = (w: number[]) => (w.length ? Math.round(w.reduce((s, v) => s + v, 0) / w.length) : null);
  const sek = (w: number[]) => w.map((v) => Math.round(v / 1000));
  return {
    /** the single values in seconds, for the sum over several epics (epicSumme) */
    stichproben: { gemergt_bis_naechster_start: sek(gemergtBisStart), reviewer_zurueck_bis_naechster_start: sek(zurueckBisStart), pruefzeit: sek(pruef.map((p) => p.bis - p.von)), fensterverlust: Math.round(verlust / 1000), laufzeit: Math.round(laufzeit / 1000) },
    verbrauch: {
      weighted: Math.round(summe),
      je_rolle: jeRolle,
      orchestrierung: { weighted: Math.round(orchestrierung), anteil: summe ? runde((orchestrierung * 100) / summe) : 0 },
      je_paket: mittel(pakete.map((p) => p.summe)),
      implementer_reviewer_je_paket: mittel(ir),
    },
    pakete: pakete.map((p) => ({ paket: p.paket, implementer: p.implementer, reviewer: p.reviewer, andere: p.andere, summe: p.summe, implementer_auftraege: p.implementerAuftraege, eskalationen: p.eskalationen, merges: p.merges, gemergt: p.gemergt === null ? null : new Date(p.gemergt).toISOString() })),
    implementer_auftraege_je_paket: pakete.length ? runde(pakete.reduce((s, p) => s + p.implementerAuftraege, 0) / pakete.length) : null,
    eskalationen: pakete.reduce((s, p) => s + p.eskalationen, 0),
    zeiten: {
      durchlauf_min: x.arbeitMs == null ? null : runde(x.arbeitMs / MIN),
      gemergt_bis_naechster_start_s: zeitwerte(gemergtBisStart, 1000),
      reviewer_zurueck_bis_naechster_start_s: zeitwerte(zurueckBisStart, 1000),
      pruefzeit_s: { ...zeitwerte(pruef.map((p) => p.bis - p.von), 1000), modell_s: x.modellzeit ? runde(pruef.reduce((s, p) => s + x.modellzeit!(p.von, p.bis), 0) / 1000) : null },
      fensterverlust: { minuten: runde(verlust / MIN), laufzeit_min: runde(laufzeit / MIN), anteil: laufzeit ? runde((verlust * 100) / laufzeit) : null },
    },
    neustart: { neustarts, doppelt_gestartete_pakete: pakete.filter((p) => p.doppeltGestartet).length, doppelte_merges: pakete.filter((p) => p.merges > 1).length },
  };
}

type EpicMessung = ReturnType<typeof epicKennzahlen> & { ungueltige_ausgaben: { aufrufe: number; ungueltig: number } };

/** The table of epic #69 over several epic runs of one deployment: means per epic, per package and over all single values. */
export function epicSumme(laeufe: EpicMessung[]) {
  const pakete = laeufe.flatMap((l) => l.pakete);
  const summe = laeufe.reduce((s, l) => s + l.verbrauch.weighted, 0);
  const orch = laeufe.reduce((s, l) => s + l.verbrauch.orchestrierung.weighted, 0);
  const verlust = laeufe.reduce((s, l) => s + l.stichproben.fensterverlust, 0);
  const laufzeit = laeufe.reduce((s, l) => s + l.stichproben.laufzeit, 0);
  const durchlauf = laeufe.map((l) => l.zeiten.durchlauf_min).filter((d): d is number => d !== null);
  const aufrufe = laeufe.reduce((s, l) => s + l.ungueltige_ausgaben.aufrufe, 0);
  const ungueltig = laeufe.reduce((s, l) => s + l.ungueltige_ausgaben.ungueltig, 0);
  const alle = (k: 'gemergt_bis_naechster_start' | 'reviewer_zurueck_bis_naechster_start' | 'pruefzeit') => laeufe.flatMap((l) => l.stichproben[k]);
  return {
    epics: laeufe.length,
    pakete: pakete.length,
    verbrauch_je_epic: laeufe.length ? Math.round(summe / laeufe.length) : null,
    verbrauch_je_paket: pakete.length ? Math.round(pakete.reduce((s, p) => s + p.summe, 0) / pakete.length) : null,
    anteil_orchestrierung: summe ? runde((orch * 100) / summe) : null,
    implementer_reviewer_je_paket: pakete.length ? Math.round(pakete.reduce((s, p) => s + p.implementer + p.reviewer, 0) / pakete.length) : null,
    durchlauf_min: durchlauf.length ? verteilung(durchlauf) : null,
    gemergt_bis_naechster_start_s: zeitwerte(alle('gemergt_bis_naechster_start'), 1),
    reviewer_zurueck_bis_naechster_start_s: zeitwerte(alle('reviewer_zurueck_bis_naechster_start'), 1),
    pruefzeit_s: { ...zeitwerte(alle('pruefzeit'), 1), modell_s: runde(laeufe.reduce((s, l) => s + (l.zeiten.pruefzeit_s.modell_s ?? 0), 0)) },
    fensterverlust_anteil: laufzeit ? runde((verlust * 100) / laufzeit) : null,
    implementer_auftraege_je_paket: pakete.length ? runde(pakete.reduce((s, p) => s + p.implementer_auftraege, 0) / pakete.length) : null,
    eskalationen: pakete.reduce((s, p) => s + p.eskalationen, 0),
    ungueltige_ausgaben: { aufrufe, ungueltig, anteil: aufrufe ? runde((ungueltig * 100) / aufrufe) : null },
    neustart: {
      bis_erster_worker_s: laeufe.flatMap((l) => l.neustart.neustarts.map((n) => n.bis_erster_worker_s)),
      neue_aufrufe_bis_worker: laeufe.flatMap((l) => l.neustart.neustarts.map((n) => n.neue_aufrufe_bis_worker)),
      doppelt_gestartete_pakete: laeufe.reduce((s, l) => s + l.neustart.doppelt_gestartete_pakete, 0),
      doppelte_merges: laeufe.reduce((s, l) => s + l.neustart.doppelte_merges, 0),
    },
  };
}

/** Role, package and round of a call log of `flotte epic` (<rolle>[-<paket>]-r<runde>.jsonl, src/epic/aufrufe.ts). */
export function aufrufLog(name: string): { rolle: Rolle; paket: string | null; runde: number } | null {
  const m = /^([a-z]+)(?:-(.+?))?-r(\d+)\.jsonl$/.exec(name);
  return m ? { rolle: rolleAus(m[1]), paket: m[2] ?? null, runde: Number(m[3]) } : null;
}

/** What flotte messen reads from the state of `flotte epic` (<git common dir>/flotte/epics/<nr>/zustand.json, src/epic/zustand.ts). */
export interface ProgrammZustand {
  ereignisse: { zeit: string; paket: string | null; art: string; rolle?: string; text: string }[];
}

/**
 * The events of `flotte epic` as the source of an epic run (#68): package merges (event gemergt),
 * restarts (neustart), worker processes started or resumed (aufruf of implementer and reviewer),
 * calls started anew (aufruf without --resume) and invalid outputs (ungueltig).
 */
export function programmEreignisse(z: ProgrammZustand) {
  const ev = z.ereignisse.map((e) => ({ ...e, t: Date.parse(e.zeit) }));
  const aufrufe = ev.filter((e) => e.art === 'aufruf');
  return {
    merges: ev.filter((e) => e.art === 'gemergt' && e.paket).map((e) => ({ paket: e.paket as string, zeit: e.t })),
    neustarts: ev.filter((e) => e.art === 'neustart').map((e) => e.t),
    workerStarts: aufrufe.filter((e) => e.rolle === 'implementer' || e.rolle === 'reviewer').map((e) => e.t),
    neueAufrufe: aufrufe.filter((e) => !/--resume/.test(e.text)).map((e) => e.t),
    aufrufe: aufrufe.length,
    ungueltig: ev.filter((e) => e.art === 'ungueltig').length,
  };
}

/**
 * Invalid outputs of `--json-schema` calls in stream-json logs: a result without
 * structured_output, or one whose subtype names the structured output.
 */
export function ungueltigeAusgaben(logs: string[]): { aufrufe: number; ungueltig: number } {
  let aufrufe = 0;
  let ungueltig = 0;
  for (const log of logs) {
    for (const zeile of log.split(/\r?\n/)) {
      if (!zeile.includes('"result"')) continue;
      let r: { type?: string; subtype?: string; structured_output?: unknown };
      try {
        r = JSON.parse(zeile);
      } catch {
        continue;
      }
      if (r?.type !== 'result') continue;
      aufrufe++;
      if (r.structured_output == null || /structured/.test(String(r.subtype ?? ''))) ungueltig++;
    }
  }
  return { aufrufe, ungueltig };
}

/**
 * Lead time and errors per epic of a driver deployment (Sparpaket, package 3): from the first
 * "Lauf gestartet" to the first "FLOTTE-ENDE, PR", without the time the run waited for the
 * person in between. An epic counts as an error when the driver gave it back to the run (red gate,
 * conflict), blocked or aborted it. An epic still running (no FLOTTE-ENDE, no halt) is left out of
 * the error rate.
 */
export function epicVerlauf(z: TreiberZustand, fenster: Fenster) {
  const ev = z.ereignisse.map((e) => ({ ...e, t: Date.parse(e.zeit) })).filter((e) => imFenster(e.t, fenster) && e.epic !== null);
  const nummern = [...new Set(ev.map((e) => e.epic as number))].sort((a, b) => a - b);
  const epics = nummern.map((nr) => {
    const mine = ev.filter((e) => e.epic === nr);
    const start = mine.find((e) => /^Lauf gestartet/.test(e.text))?.t ?? null;
    const ende = mine.find((e) => /^FLOTTE-ENDE, PR/.test(e.text))?.t ?? null;
    let warten = 0;
    let frageSeit: number | null = null;
    for (const e of mine) {
      if (ende !== null && e.t > ende) break;
      if (/liegt beim Menschen/.test(e.text)) frageSeit ??= e.t;
      else if (/^Antwort des Menschen/.test(e.text) && frageSeit !== null) {
        warten += e.t - frageSeit;
        frageSeit = null;
      }
    }
    const rueckgaben = mine.filter((e) => /^zurück an den Lauf/.test(e.text)).length;
    const halt = mine.find((e) => /^(blockiert|abgebrochen):/.test(e.text));
    return {
      epic: nr,
      durchlauf_min: start !== null && ende !== null ? runde((ende - start - warten) / MIN) : null,
      rueckgaben,
      halt: halt ? halt.text.split(':')[0] : null,
      offen: ende === null && !halt,
      fehler: rueckgaben > 0 || Boolean(halt),
    };
  });
  const bewertet = epics.filter((e) => !e.offen);
  const fehler = bewertet.filter((e) => e.fehler).length;
  return {
    epics,
    durchlauf_min: verteilung(epics.map((e) => e.durchlauf_min).filter((x): x is number => x !== null)),
    fehlerquote: bewertet.length ? runde(fehler / bewertet.length) : null,
    methode: 'Treiber: erstes „Lauf gestartet" bis erstes „FLOTTE-ENDE, PR", ohne Warten auf den Menschen; Fehler = Rückgabe an den Lauf, blockiert oder abgebrochen; ein Epic ohne FLOTTE-ENDE und ohne Halt zählt als offen, nicht in der Quote',
  };
}
