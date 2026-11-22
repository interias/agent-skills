// What the driver writes to and reads from the forge: comments, the fleet logbook issue
// (flotte/references/flottenlogbuch.md), the state of pull requests. Only through gh.

import type { Aufrufer } from '../aufruf.ts';

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
