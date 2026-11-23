/**
 * Detail view of an epic (#51): phase, round and class of each package, derived from what the driver
 * already reads, the stream-json of the runs. Each Agent call of an epic-implementer or epic-reviewer
 * names its package in the description (`Implementer #588 …`, `Reviewer #588 …`, epic/SKILL.md, phase 6).
 *
 * Two pure steps: `eintraegeAus` turns one log line into entries, `ableiten` turns the entries of a
 * run into the fields per package. Nothing is guessed: a package without a call has no fields, an
 * entry without a time gives no time. Spec mode has no child number: its packages are named
 * `<spec>-p<k>` (`Implementer #45-p2 …`, epic/SKILL.md, phase 3), the key is that name (#151).
 * A Bash or PowerShell call of the adapter's gate command is a gate run of the run (#151).
 */
import { gateKern } from '../treiber/gate.ts';
import { KLASSE, type Klasse, RANG } from './prognose.ts';

export type Phase = 'implementer' | 'review' | 'nachbesserung' | 'merge';

/** What one log line says about a package: a call, the return of the call, or work below the call. */
export interface AgentEintrag {
  /** epoch ms; null when the line carried none and none was given */
  zeit: number | null;
  art: 'aufruf' | 'rueckkehr' | 'unter';
  /** tool_use id of the Agent call */
  id: string;
  /** aufruf only; gate: a call of the gate command, no package */
  rolle?: 'implementer' | 'reviewer' | 'gate';
  klasse?: Klasse;
  /** aufruf only: the child ticket, in spec mode the package `<spec>-p<k>` */
  paket?: number | string;
  /** aufruf of a spec package only: the description after the package, its only title */
  titel?: string;
}

export interface PaketDetail {
  /** absent once the package is merged into the epic branch */
  phase?: Phase;
  /** implementer rounds so far: the first call and each first call after a review */
  runde: number;
  /** class of the latest implementer call */
  stufe: Klasse;
  /** class of the first call, only when it differs from `stufe` */
  stufeStart?: Klasse;
  /** the latest round runs in a higher class than the one before */
  eskaliert: boolean;
  /** ISO: first call, start of the current phase, the last entry that concerns the package */
  erstAufruf?: string;
  phaseSeit?: string;
  lebenszeichen?: string;
}

const REVIEWER = /^epic-reviewer-(standard|urteil)$/;
const AGENT = new Set(['Agent', 'Task']);
const SHELL = new Set(['Bash', 'PowerShell']);
/** the package in a description: a child `#588`, a spec package `#45-p2` */
const PAKET = /#(\d+)(?:-p(\d+))?/i;
const iso = (ms: number | null | undefined) => (ms == null ? undefined : new Date(ms).toISOString());

/**
 * The entries of one stream-json line. The time is the line's own `timestamp` when it has one, else
 * `zeit` (the moment the driver read it); null stays null. Returns every return and every line of a
 * sub-agent: the caller keeps those whose call it knows (`fuegeAn`). `gate`: the gate commands of
 * the adapter; a call whose command holds the core of one is a gate run (as gateLaeufeImLog).
 */
export function eintraegeAus(roh: string, zeit: number | null = null, gate: string[] = []): AgentEintrag[] {
  let d: any;
  try {
    d = JSON.parse(roh);
  } catch {
    return [];
  }
  const eigen = typeof d?.timestamp === 'string' ? Date.parse(d.timestamp) : NaN;
  const z = Number.isNaN(eigen) ? zeit : eigen;
  const out: AgentEintrag[] = [];
  const inhalt: any[] = Array.isArray(d?.message?.content) ? d.message.content : [];
  if (d?.parent_tool_use_id) return [{ zeit: z, art: 'unter', id: String(d.parent_tool_use_id) }];
  if (d?.type === 'assistant') {
    const kerne = gate.map(gateKern).filter(Boolean);
    for (const c of inhalt) {
      if (c?.type !== 'tool_use') continue;
      if (SHELL.has(c.name) && typeof c.input?.command === 'string' && kerne.some((k) => c.input.command.includes(k))) {
        out.push({ zeit: z, art: 'aufruf', id: String(c.id), rolle: 'gate' });
        continue;
      }
      if (!AGENT.has(c.name)) continue;
      const typ = String(c.input?.subagent_type ?? '');
      const beschreibung = String(c.input?.description ?? '');
      const m = PAKET.exec(beschreibung);
      const impl = KLASSE.exec(typ)?.[1] as Klasse | undefined;
      const rev = REVIEWER.test(typ);
      if (!m || (!impl && !rev)) continue;
      const e: AgentEintrag = { zeit: z, art: 'aufruf', id: String(c.id), rolle: impl ? 'implementer' : 'reviewer', klasse: impl, paket: m[2] ? `${m[1]}-p${m[2]}` : Number(m[1]) };
      if (m[2]) e.titel = beschreibung.slice(m.index + m[0].length).trim();
      out.push(e);
    }
  } else if (d?.type === 'user') {
    for (const c of inhalt) if (c?.type === 'tool_result' && c.tool_use_id && !gestartet(c.content)) out.push({ zeit: z, art: 'rueckkehr', id: String(c.tool_use_id) });
  } else if (d?.type === 'system' && d.subtype === 'task_notification' && d.tool_use_id && ENDE.has(d.status)) {
    out.push({ zeit: z, art: 'rueckkehr', id: String(d.tool_use_id) });
  }
  return out;
}

/** the final states of a background agent in its `task_notification`; real logs show `stopped` too (TaskStop) */
const ENDE = new Set(['completed', 'failed', 'killed', 'stopped']);

/**
 * A background agent (`/epic` starts implementer and reviewer so) answers its call at once with
 * "Async agent launched …"; that is its start, not its return. Its end comes later as a `system`
 * line `task_notification` with the id of the call and no `timestamp`. A plain result is the end of
 * an agent in the foreground. A command in the background (a gate) answers "Command running in
 * background …" and ends the same way.
 */
function gestartet(inhalt: unknown): boolean {
  const text = typeof inhalt === 'string' ? inhalt : Array.isArray(inhalt) ? inhalt[0]?.text : undefined;
  return typeof text === 'string' && (text.startsWith('Async agent launched') || text.startsWith('Command running in background'));
}

/**
 * Adds the entries to the list of an epic: calls always (once per id), a return once per known call,
 * work below a call as the latest time per call. Returns the list; `maximal` bounds it (oldest go).
 */
export function fuegeAn(liste: AgentEintrag[], neu: AgentEintrag[], maximal = 600): AgentEintrag[] {
  for (const e of neu) {
    const bekannt = liste.some((x) => x.art === 'aufruf' && x.id === e.id);
    if (e.art === 'aufruf') {
      if (!bekannt) liste.push(e);
    } else if (!bekannt) continue;
    else if (e.art === 'rueckkehr') {
      if (!liste.some((x) => x.art === 'rueckkehr' && x.id === e.id)) liste.push(e);
    } else {
      const alt = liste.find((x) => x.art === 'unter' && x.id === e.id);
      if (alt) alt.zeit = e.zeit;
      else liste.push(e);
    }
  }
  if (liste.length > maximal) liste.splice(0, liste.length - maximal);
  return liste;
}

/** The fields per package, by child number or spec package. `fertig`: the packages merged into the epic branch have no phase. */
export function ableiten(eintraege: AgentEintrag[], fertig: ReadonlySet<number | string> = new Set()): Map<number | string, PaketDetail> {
  const aufrufe = eintraege.filter((e) => e.art === 'aufruf' && e.paket !== undefined && e.rolle);
  const je = new Map<number | string, AgentEintrag[]>();
  for (const a of aufrufe) je.set(a.paket!, [...(je.get(a.paket!) ?? []), a]);
  const out = new Map<number | string, PaketDetail>();
  for (const [nr, calls] of je) {
    const impl = calls.filter((c) => c.rolle === 'implementer');
    if (!impl.length) continue;
    const ids = new Set(calls.map((c) => c.id));
    const mit = eintraege.filter((e) => ids.has(e.id));
    const zurueck = (c: AgentEintrag) => eintraege.find((e) => e.art === 'rueckkehr' && e.id === c.id);
    const letzter = calls[calls.length - 1];
    const stufe = impl[impl.length - 1].klasse!;
    const start = impl[0].klasse!;
    const davor = impl.length > 1 ? impl[impl.length - 2].klasse! : null;
    // a round begins with the first implementer call after a review; a call again without a review
    // between (the run was restarted and dispatched the implementer anew) is the same round
    let runde = 0;
    let nachReview = true;
    for (const c of calls) {
      if (c.rolle === 'reviewer') nachReview = true;
      else if (nachReview) {
        runde++;
        nachReview = false;
      }
    }
    const d: PaketDetail = { runde, stufe, eskaliert: davor !== null && RANG.indexOf(stufe) > RANG.indexOf(davor) };
    if (start !== stufe) d.stufeStart = start;
    d.erstAufruf = iso(calls[0].zeit);
    const lebenszeichen = Math.max(...mit.map((e) => e.zeit ?? -Infinity));
    d.lebenszeichen = Number.isFinite(lebenszeichen) ? iso(lebenszeichen) : undefined;
    if (!fertig.has(nr)) {
      if (letzter.rolle === 'implementer') {
        const nachReview = calls.slice(0, calls.indexOf(letzter)).some((c) => c.rolle === 'reviewer');
        d.phase = nachReview ? 'nachbesserung' : 'implementer';
        d.phaseSeit = iso(letzter.zeit);
      } else if (zurueck(letzter)) {
        d.phase = 'merge';
        d.phaseSeit = iso(zurueck(letzter)!.zeit);
      } else {
        d.phase = 'review';
        d.phaseSeit = iso(letzter.zeit);
      }
    }
    for (const k of Object.keys(d) as (keyof PaketDetail)[]) if (d[k] === undefined) delete d[k];
    out.set(nr, d);
  }
  return out;
}

/** Places in use: packages in implementer, review or nachbesserung (merge is the host's, no place). */
export function belegt(details: Iterable<PaketDetail>): number {
  let n = 0;
  for (const d of details) if (d.phase === 'implementer' || d.phase === 'review' || d.phase === 'nachbesserung') n++;
  return n;
}

/**
 * The gate run under way: how many gate calls the entries hold and the start of the latest, while it
 * has not returned; else null. Entries cut off by `fuegeAn` (`maximal`) are not counted.
 */
export function gateLauf(eintraege: AgentEintrag[]): { n: number; seit: string | null } | null {
  const gates = eintraege.filter((e) => e.art === 'aufruf' && e.rolle === 'gate');
  const letzter = gates.at(-1);
  if (!letzter || eintraege.some((e) => e.art === 'rueckkehr' && e.id === letzter.id)) return null;
  return { n: gates.length, seit: iso(letzter.zeit) ?? null };
}

/**
 * The spec packages a commit subject says are merged, as `<spec>-p<k>`: `Merge … agent/<spec>-p<k>-…`,
 * `… (#<spec>-p<k>)` and `Merge #<spec>-p<k>: …`.
 */
export function specAusBetreff(betreff: string): string[] {
  return [...betreff.matchAll(/^Merge\b.*?\bagent\/(\d+-[pP]\d+)(?:-|\b)/g), ...betreff.matchAll(/\(#(\d+-[pP]\d+)\)/g), ...betreff.matchAll(/^Merge #(\d+-[pP]\d+):/g)].map((m) => m[1].toLowerCase());
}

/**
 * The child numbers a commit subject says are merged: `Merge … agent/<nr>-…`, `… (#<nr>)` and
 * `Merge #<nr>: …`. A number anywhere else ("Refs #409", "#4090") does not count.
 */
export function kinderAusBetreff(betreff: string): number[] {
  return [...betreff.matchAll(/^Merge\b.*?\bagent\/(\d+)(?:-|\b)/g), ...betreff.matchAll(/\(#(\d+)\)/g), ...betreff.matchAll(/^Merge #(\d+):/g)].map((m) => Number(m[1]));
}
