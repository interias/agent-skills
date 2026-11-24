// #147: the final check of a triage run. After writing, the program reads the forge again and compares every
// note of the input with the three end states it allows (Stefan, 22.11.2026):
// - closed, and the last comment of the triage names a reason (Grund, or merged into another note);
// - open with ready_label, a sub-issue of an open mission (epic_label), which carries ready_label too when the
//   run created it;
// - open in the triage (needs-triage, needs-info) with an open question to the person below it.
// Anything else is a deviation: the run is then incomplete, not finished (flotte/README.md, "Triage").

import { TRIAGE_LABEL, type AuftragsRegeln } from './auftrag/auftrag.ts';
import { fehlerText, type ForgeZugriff } from './forge/zugriff.ts';
import { BERECHTIGT, INFO_LABEL, offeneFragen, TRIAGE_MARKE, type Ticket } from './triage.ts';

export interface Abweichung {
  forge: string;
  nr: number;
  titel: string;
  /** what the forge shows now: open or closed, the labels, the mission it hangs on */
  zustand: string;
  /** which end state it misses */
  grund: string;
}

/** The final check in the output of a triage run; entfaellt: why there was none (--trocken). */
export interface Abschluss {
  geprueft: number;
  sauber: number;
  abweichungen: Abweichung[];
  entfaellt?: string;
}

/** A reason in the comment of the triage that closed a note: triageKommentar, schnittplanKommentar. */
const GRUND = /^(Grund: \S|Zusammengeführt in #\d+)/m;

interface Stand {
  offen: boolean;
  labels: string[];
}

/** The end state a note misses, or null when it has one of the three. mission: its parent as the forge shows it. */
export function endzustandFehlt(t: Ticket & { offen: boolean }, mission: (Stand & { nummer: number; neu: boolean }) | null, r: AuftragsRegeln): string | null {
  const ready = r.ready_label;
  if (!t.offen) {
    const k = t.kommentare.findLast((k) => BERECHTIGT.includes(k.rolle) && k.body.includes(TRIAGE_MARKE));
    return k && GRUND.test(k.body) ? null : 'geschlossen ohne Grund im letzten Kommentar der Triage';
  }
  if (t.labels.includes(ready)) {
    if (!mission) return `${ready} ohne Mission (kein Sub-Issue einer Mission)`;
    if (!mission.offen || !mission.labels.includes(r.epic_label)) return `${ready} an #${mission.nummer}, die keine offene Mission (${r.epic_label}) ist`;
    if (mission.neu && !mission.labels.includes(ready)) return `Mission #${mission.nummer} ist neu und trägt kein ${ready}`;
    return null;
  }
  if (t.labels.includes(TRIAGE_LABEL) || t.labels.includes(INFO_LABEL)) return offeneFragen(t).length ? null : 'in der Triage ohne offene Frage an den Menschen';
  return `weder in der Triage noch mit ${ready} freigegeben`;
}

/**
 * #170: the open tickets with ready_label outside the input (schon) that hang on no open mission: a run never starts
 * them, the driver only reports them as released without a mission. One list of the released tickets, one of the
 * open missions, then the parent of each released ticket that is no mission itself.
 */
export function loseFreigaben(z: ForgeZugriff, r: AuftragsRegeln, schon: Set<number>): Abweichung[] {
  const liste = (label: string) => {
    try {
      return z.issues(label, ['number', 'title', 'labels'], 500);
    } catch (e) {
      throw new Error(`Issues ${z.repo} mit ${label} nicht lesbar: ${fehlerText(e).slice(0, 200)}`);
    }
  };
  const missionen = new Set(liste(r.epic_label).map((m) => m.nummer));
  const out: Abweichung[] = [];
  for (const i of liste(r.ready_label)) {
    const nr = i.nummer;
    const labels = i.labels;
    if (schon.has(nr) || labels.includes(r.epic_label)) continue;
    let m: number | null;
    try {
      m = z.mission(nr);
    } catch {
      // a forge that does not answer for one ticket: left alone, the next run reads it again
      continue;
    }
    if (m !== null && missionen.has(m)) continue;
    out.push({ forge: z.repo, nr, titel: i.titel, zustand: ['offen', ...labels, ...(m !== null ? [`Missionsziel von #${m}`] : [])].join(', '), grund: m !== null ? `${r.ready_label} an #${m}, die keine offene Mission (${r.epic_label}) ist` : `${r.ready_label} ohne Mission (kein Sub-Issue einer Mission)` });
  }
  return out;
}

/**
 * Reads each note again (state, labels, comments, parent mission) and returns those without an allowed end state.
 * neu: the missions this run created. A note or mission the forge does not answer for counts as a deviation.
 */
export function abschlusspruefung(z: ForgeZugriff, r: AuftragsRegeln, notizen: { nummer: number; titel: string }[], neu: number[]): Abweichung[] {
  const forge = z.repo;
  const missionen = new Map<number, Stand>();
  const lies = (n: number, felder: string[]) => {
    try {
      return z.issue(n, felder);
    } catch (e) {
      throw new Error(`#${n} nicht lesbar: ${fehlerText(e).slice(0, 200)}`);
    }
  };
  const out: Abweichung[] = [];
  for (const n of notizen) {
    const abweichung = (zustand: string, grund: string) => out.push({ forge, nr: n.nummer, titel: n.titel, zustand, grund });
    try {
      const i = lies(n.nummer, ['number', 'title', 'state', 'labels', 'comments']);
      const t: Ticket & { offen: boolean } = {
        nummer: n.nummer,
        titel: i.titel || n.titel,
        body: '',
        url: '',
        offen: i.zustand === 'OPEN',
        labels: i.labels,
        kommentare: i.kommentare.map((k) => ({ body: k.body, autor: k.autor, zeit: k.zeit, rolle: k.rolle })),
      };
      let mission: (Stand & { nummer: number; neu: boolean }) | null = null;
      if (t.offen) {
        let nr: number | null;
        try {
          nr = z.mission(n.nummer);
        } catch (e) {
          throw new Error(`Mission von #${n.nummer} nicht lesbar: ${fehlerText(e).slice(0, 200)}`);
        }
        if (nr !== null) {
          if (!missionen.has(nr)) {
            const x = lies(nr, ['state', 'labels']);
            missionen.set(nr, { offen: x.zustand === 'OPEN', labels: x.labels });
          }
          mission = { nummer: nr, neu: neu.includes(nr), ...missionen.get(nr)! };
        }
      }
      const grund = endzustandFehlt(t, mission, r);
      if (grund) abweichung(t.offen ? ['offen', ...t.labels, ...(mission ? [`Missionsziel von #${mission.nummer}`] : [])].join(', ') : 'geschlossen', grund);
    } catch (err) {
      abweichung('nicht lesbar', (err as Error).message.slice(0, 300));
    }
  }
  return out;
}
