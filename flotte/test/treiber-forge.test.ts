// The driver at the forge through the forge layer (#127): the same course (a released mission collected,
// a comment, the mission closed or left open after the docking, the fleet logbook) against the stand-in of
// GitHub (gh) and of Gitea (its API), test/forge-attrappen.ts.

import { describe, expect, it } from 'vitest';
import { giteaZugriff } from '../src/forge/gitea.ts';
import { githubZugriff } from '../src/forge/github.ts';
import type { ForgeZugriff } from '../src/forge/zugriff.ts';
import { kommentar, logbuchFinden, logbuchSchreiben, missionAbschliessen, prZustand } from '../src/treiber/forge.ts';
import { freigegebene, liesAdapter, sammle } from '../src/werkzeuge/belegung.ts';
import { bestand, GITEA_API, ghAttrappe, giteaAttrappe, issueAnlegen, type Bestand } from './forge-attrappen.ts';

const FORGEN: [string, (b: Bestand) => ForgeZugriff][] = [
  ['GitHub', (b) => githubZugriff(ghAttrappe(b), 'o/r')],
  ['Gitea', (b) => giteaZugriff(giteaAttrappe(b), GITEA_API(b), () => 'token geheim')],
];

/** a released mission #1 with its Missionsziele #2 and #3, a docked pull request #4 of its branch */
function lage(b: Bestand) {
  const mission = issueAnlegen(b, { titel: 'Mission', labels: ['epic'], body: '## Missionsziele\n- [ ] #2\n- [ ] #3\n\n## Betroffene Module\n- m1\n' });
  const a = issueAnlegen(b, { titel: 'Ziel A', labels: ['ready-for-agent'], body: '## Betroffene Module\n- m1\n' });
  const c = issueAnlegen(b, { titel: 'Ziel B', labels: ['prio/hoch'] });
  issueAnlegen(b, { titel: 'lose', labels: ['ready-for-agent'] });
  mission.kinder.push(a.nummer, c.nummer);
  b.prs.push({ nummer: 5, titel: 'Mission', body: '', kopf: 'epic/1-mission', basis: 'main', zustand: 'MERGED' });
  return { mission, a, c };
}

describe.each(FORGEN)('the driver through the forge layer: %s', (_, zugriff) => {
  it('collects the released mission with its Missionsziele and comments on it', () => {
    const b = bestand();
    const { mission } = lage(b);
    const z = zugriff(b);
    expect(freigegebene(z, liesAdapter(''))).toEqual({ epics: [1], ohneEpic: [4] });
    const { bilder } = sammle(z, '/nirgends', [1]);
    expect(bilder[0]).toMatchObject({ nr: 1, kinder: [2, 3], prio: true, module: ['m1'] });
    expect(kommentar(z, 1, '**Flotte** — Mission gestartet.')).toBe(true);
    expect(mission.kommentare.map((k) => k.body)).toEqual(['**Flotte** — Mission gestartet.']);
    expect(kommentar(z, 4711, 'ins Leere')).toBe(false);
  });

  it('after the docking with every Missionsziel closed: the mission is closed with a comment linking the pull request', () => {
    const b = bestand();
    const { mission, a, c } = lage(b);
    const z = zugriff(b);
    expect(prZustand(z, 5)).toMatchObject({ state: 'MERGED' });
    a.offen = false;
    c.offen = false;
    expect(missionAbschliessen(z, 1, 5, 'ready-for-agent')).toEqual({ text: 'Mission geschlossen nach dem Andocken von PR #5', endgueltig: true });
    expect(mission.offen).toBe(false);
    expect(mission.kommentare.at(-1)!.body).toContain(`Pull Request #5 ist angedockt: ${z.prLink(5)}`);
    expect(mission.kommentare.at(-1)!.body).toContain('Alle Missionsziele sind geschlossen: #2, #3.');
    expect(missionAbschliessen(z, 1, 5, 'ready-for-agent')).toEqual({ text: 'Mission ist schon geschlossen', endgueltig: true });
  });

  it('one Missionsziel still open: the mission stays open and loses the ready label, at a later start nothing changes', () => {
    const b = bestand();
    const { mission, a } = lage(b);
    mission.labels.push('ready-for-agent');
    const z = zugriff(b);
    a.offen = false;
    expect(missionAbschliessen(z, 1, 5, 'ready-for-agent', true)).toEqual({ text: 'Mission bleibt offen (#3 offen), beim Start nichts geändert', endgueltig: false });
    expect(mission.labels).toContain('ready-for-agent');
    expect(missionAbschliessen(z, 1, 5, 'ready-for-agent')).toEqual({ text: 'Mission bleibt offen (#3 offen), ready-for-agent abgenommen', endgueltig: false });
    expect(mission).toMatchObject({ offen: true, labels: ['epic'] });
    expect(mission.kommentare.at(-1)!.body).toContain('Noch offen: #3.');
    expect(mission.kommentare.at(-1)!.body).toContain(z.prLink(5));
  });

  it('a mission the forge cannot read is not closed: null, tried again later', () => {
    const b = bestand();
    expect(missionAbschliessen(zugriff(b), 4711, 5, 'ready-for-agent')).toBeNull();
  });

  it('finds the fleet logbook, creates it with its label when missing, and writes its body', () => {
    const b = bestand();
    const z = zugriff(b);
    const nr = logbuchFinden(z, 'erster Stand')!;
    expect(b.issues.find((i) => i.nummer === nr)).toMatchObject({ titel: 'Flottenlogbuch', labels: ['flotte'], body: 'erster Stand' });
    expect(logbuchFinden(z, 'anderer Stand')).toBe(nr);
    expect(logbuchSchreiben(z, nr, 'zweiter Stand')).toBe(true);
    expect(b.issues.find((i) => i.nummer === nr)!.body).toBe('zweiter Stand');
    expect(b.issues.length).toBe(1);
  });
});
