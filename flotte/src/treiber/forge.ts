// What the driver writes to and reads from the forge: comments, the fleet logbook issue
// (flotte/references/flottenlogbuch.md), the state of pull requests. Only through the forge layer (#127).

import type { ForgeZugriff } from '../forge/zugriff.ts';
import { kinderAus } from '../werkzeuge/belegung.ts';

export function kommentar(z: ForgeZugriff, nr: number, text: string): boolean {
  try {
    z.kommentieren(nr, text);
    return true;
  } catch {
    return false;
  }
}

export interface PrZustand {
  state: string;
  mergeable: string;
  url: string;
}

export function prZustand(z: ForgeZugriff, pr: number): PrZustand | null {
  try {
    const p = z.pr(pr, ['state', 'mergeable', 'url']);
    return { state: p.zustand, mergeable: p.mergebar, url: p.url };
  } catch {
    return null;
  }
}

/** The one open issue with label `flotte`; created with its label when missing. */
export function logbuchFinden(z: ForgeZugriff, body: string): number | null {
  try {
    const liste = z.issues('flotte', ['number']);
    if (liste.length) return liste.map((x) => x.nummer).sort((x, y) => x - y)[0];
  } catch {
    /* fall through to create */
  }
  try {
    z.labelAnlegen('flotte', '00f0ff', 'Flottenlogbuch, kein Ticket');
    return z.anlegen('Flottenlogbuch', body, ['flotte']);
  } catch {
    return null;
  }
}

export function logbuchSchreiben(z: ForgeZugriff, nr: number, body: string): boolean {
  try {
    z.bodySetzen(nr, body);
    return true;
  } catch {
    return false;
  }
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
export function missionAbschliessen(z: ForgeZugriff, nr: number, pr: number, readyLabel: string, nachlauf = false): { text: string; endgueltig: boolean } | null {
  const zustand = (n: number, felder: string[]) => {
    try {
      return z.issue(n, felder);
    } catch {
      return null;
    }
  };
  const mission = zustand(nr, ['state', 'body']);
  if (!mission) return null;
  if (mission.zustand === 'CLOSED') return { text: 'Mission ist schon geschlossen', endgueltig: true };
  const ziele = kinderAus(mission.body);
  const stand = ziele.map((k) => ({ k, state: zustand(k, ['state'])?.zustand ?? null }));
  const unbekannt = stand.filter((x) => x.state === null).map((x) => `#${x.k}`);
  if (unbekannt.length) return { text: `Mission nicht abgeschlossen: Stand von ${unbekannt.join(', ')} nicht lesbar, nächster Versuch beim nächsten Start`, endgueltig: false };
  const offen = stand.filter((x) => x.state !== 'CLOSED').map((x) => x.k);
  const url = z.prLink(pr);
  if (!offen.length) {
    const text = `**Mission abgeschlossen (Flotte)** — Pull Request #${pr} ist angedockt: ${url}\n${ziele.length ? `Alle Missionsziele sind geschlossen: ${ziele.map((k) => `#${k}`).join(', ')}.` : 'Die Mission listet keine Missionsziele.'}`;
    try {
      z.schliessen(nr, { kommentar: text });
    } catch {
      return null;
    }
    return { text: `Mission geschlossen nach dem Andocken von PR #${pr}`, endgueltig: true };
  }
  const liste = offen.map((k) => `#${k}`).join(', ');
  if (nachlauf) return { text: `Mission bleibt offen (${liste} offen), beim Start nichts geändert`, endgueltig: false };
  try {
    z.labelsAendern(nr, { weg: [readyLabel] });
  } catch {
    return null;
  }
  kommentar(z, nr, `**Mission bleibt offen (Flotte)** — Pull Request #${pr} ist angedockt: ${url}\nNoch offen: ${liste}. \`${readyLabel}\` ist abgenommen; der Treiber startet sie dafür nicht neu. Die offenen Missionsziele brauchen eine neue Mission oder einen Menschen.`);
  return { text: `Mission bleibt offen (${liste} offen), ${readyLabel} abgenommen`, endgueltig: false };
}
