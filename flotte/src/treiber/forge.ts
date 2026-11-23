// What the driver writes to and reads from the forge: comments, the fleet logbook issue
// (flotte/references/flottenlogbuch.md), the state of pull requests. Only through gh.

import type { Aufrufer } from '../aufruf.ts';
import { kinderAus } from '../werkzeuge/belegung.ts';

export function kommentar(a: Aufrufer, forge: string, nr: number, text: string): boolean {
  return a('gh', ['issue', 'comment', String(nr), '--repo', forge, '--body-file', '-'], { eingabe: text }).code === 0;
}

export interface PrZustand {
  state: string;
  mergeable: string;
  url: string;
}

export function prZustand(a: Aufrufer, forge: string, pr: number): PrZustand | null {
  const r = a('gh', ['pr', 'view', String(pr), '--repo', forge, '--json', 'state,mergeable,url']);
  if (r.code) return null;
  try {
    const j = JSON.parse(r.stdout);
    return { state: String(j.state ?? ''), mergeable: String(j.mergeable ?? ''), url: String(j.url ?? '') };
  } catch {
    return null;
  }
}

/** The one open issue with label `flotte`; created with its label when missing. */
export function logbuchFinden(a: Aufrufer, forge: string, body: string): number | null {
  const r = a('gh', ['issue', 'list', '--repo', forge, '--label', 'flotte', '--state', 'open', '--json', 'number']);
  if (!r.code) {
    try {
      const liste = JSON.parse(r.stdout) as { number: number }[];
      if (liste.length) return liste.map((x) => x.number).sort((x, y) => x - y)[0];
    } catch {
      /* fall through to create */
    }
  }
  a('gh', ['label', 'create', 'flotte', '--repo', forge, '--color', '00f0ff', '--description', 'Flottenlogbuch, kein Ticket']);
  const c = a('gh', ['issue', 'create', '--repo', forge, '--title', 'Flottenlogbuch', '--label', 'flotte', '--body-file', '-'], { eingabe: body });
  const m = /\/issues\/(\d+)/.exec(c.stdout);
  return c.code || !m ? null : Number(m[1]);
}

export function logbuchSchreiben(a: Aufrufer, forge: string, nr: number, body: string): boolean {
  return a('gh', ['issue', 'edit', String(nr), '--repo', forge, '--body-file', '-'], { eingabe: body }).code === 0;
}

export interface LogbuchEpic {
  number: number;
  stage: string;
  carrier: 'agent';
  paused: boolean;
  note: string;
}

/** The body: a sentence, the marker, the JSON block KIBO reads. Brake as a level only, never percent. */
export function logbuchBody(daten: { active: boolean; admiral: string; brake: string; ram: unknown[]; epics: LogbuchEpic[]; questions: { number: number; text: string }[]; history: { deployments: number; max_runs: number; all_green: number } }): string {
  const block = { version: 1, ...daten };
  return `Stand der Flotte vom Treiber \`flotte\`. Wird automatisch fortgeschrieben; KIBO liest den Block.\n\n<!-- kibo:flotte -->\n\`\`\`json\n${JSON.stringify(block, null, 2)}\n\`\`\`\n`;
}

/**
 * #145: after the merge of a mission's PR the PR closes only its Missionsziele. Every one of them closed
 * (or none listed): the mission is closed with a comment linking the PR. One still open: right after the
 * merge the mission stays open but loses the ready label, with a comment naming what is open; at a later
 * start (nachlauf) nothing is taken off, a mission released again since keeps its label. A Missionsziel
 * whose state cannot be read is unknown, not open: nothing is written. Returns what happened for the event
 * and whether it is final (closed); null when the forge could not be read or written (tried again later).
 */
export function missionAbschliessen(a: Aufrufer, forge: string, nr: number, pr: number, readyLabel: string, nachlauf = false): { text: string; endgueltig: boolean } | null {
  const zustand = (n: number, felder: string) => {
    const r = a('gh', ['issue', 'view', String(n), '--repo', forge, '--json', felder]);
    if (r.code) return null;
    try {
      return JSON.parse(r.stdout) as { state?: string; body?: string };
    } catch {
      return null;
    }
  };
  const mission = zustand(nr, 'state,body');
  if (!mission) return null;
  if (mission.state === 'CLOSED') return { text: 'Mission ist schon geschlossen', endgueltig: true };
  const ziele = kinderAus(String(mission.body ?? ''));
  const stand = ziele.map((k) => ({ k, state: zustand(k, 'state')?.state ?? null }));
  const unbekannt = stand.filter((x) => x.state === null).map((x) => `#${x.k}`);
  if (unbekannt.length) return { text: `Mission nicht abgeschlossen: Stand von ${unbekannt.join(', ')} nicht lesbar, nächster Versuch beim nächsten Start`, endgueltig: false };
  const offen = stand.filter((x) => x.state !== 'CLOSED').map((x) => x.k);
  const url = `https://github.com/${forge}/pull/${pr}`;
  if (!offen.length) {
    const text = `**Mission abgeschlossen (Flotte)** — Pull Request #${pr} ist angedockt: ${url}\n${ziele.length ? `Alle Missionsziele sind geschlossen: ${ziele.map((k) => `#${k}`).join(', ')}.` : 'Die Mission listet keine Missionsziele.'}`;
    return a('gh', ['issue', 'close', String(nr), '--repo', forge, '--comment', text]).code ? null : { text: `Mission geschlossen nach dem Andocken von PR #${pr}`, endgueltig: true };
  }
  const liste = offen.map((k) => `#${k}`).join(', ');
  if (nachlauf) return { text: `Mission bleibt offen (${liste} offen), beim Start nichts geändert`, endgueltig: false };
  if (a('gh', ['issue', 'edit', String(nr), '--repo', forge, '--remove-label', readyLabel]).code) return null;
  kommentar(a, forge, nr, `**Mission bleibt offen (Flotte)** — Pull Request #${pr} ist angedockt: ${url}\nNoch offen: ${liste}. \`${readyLabel}\` ist abgenommen; der Treiber startet sie dafür nicht neu. Die offenen Missionsziele brauchen eine neue Mission oder einen Menschen.`);
  return { text: `Mission bleibt offen (${liste} offen), ${readyLabel} abgenommen`, endgueltig: false };
}
