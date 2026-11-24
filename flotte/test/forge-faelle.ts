// The cases of the driver's forge layer (#127), written over any ForgeZugriff: forge-schicht.test.ts runs them
// against a stand-in per forge (gh and the Gitea API, test/forge-attrappen.ts), gitea.test.ts against a
// throwaway Gitea. Each case gets a fresh, empty repository.

import { expect, it } from 'vitest';
import type { ForgeZugriff } from '../src/forge/zugriff.ts';

export interface ForgeStand {
  zugriff: ForgeZugriff;
  /** an issue as a person makes it; returns its number */
  issue(x: { titel: string; body?: string; labels?: string[] }): Promise<number>;
  /** hangs kind on mission as its Missionsziel (sub-issue, Gitea dependency) */
  kindDazu(mission: number, kind: number): Promise<void>;
  /** a branch one commit ahead of the default branch */
  zweig(name: string): Promise<void>;
  lesen(nr: number): Promise<{ offen: boolean; labels: string[]; body: string; kommentare: string[] }>;
}

export function forgeFaelle(neu: () => Promise<ForgeStand>) {
  it('reads an issue with title, body, labels, state and comments with the role of their author', async () => {
    const s = await neu();
    const nr = await s.issue({ titel: 'Ziel', body: 'Text', labels: ['ready-for-agent'] });
    s.zugriff.kommentieren(nr, 'Ein Kommentar');
    const i = s.zugriff.issue(nr, ['number', 'title', 'body', 'state', 'labels', 'comments']);
    expect(i).toMatchObject({ nummer: nr, titel: 'Ziel', body: 'Text', zustand: 'OPEN', labels: ['ready-for-agent'], geschlossenAm: null });
    expect(i.kommentare.map((k) => [k.body, k.rolle])).toEqual([['Ein Kommentar', 'OWNER']]);
    expect(i.url).toMatch(new RegExp(`/issues/${nr}$`));
    expect(s.zugriff.autorRolle(nr)).toBe('OWNER');
  });

  it('lists the open issues with a label, without closed ones and without other labels', async () => {
    const s = await neu();
    const a = await s.issue({ titel: 'A', labels: ['epic'] });
    const b = await s.issue({ titel: 'B', labels: ['epic'] });
    await s.issue({ titel: 'C', labels: ['needs-triage'] });
    s.zugriff.schliessen(b);
    expect(s.zugriff.issues('epic', ['number', 'title', 'labels']).map((i) => i.nummer)).toEqual([a]);
  });

  it('a missing issue throws with the forge’s own text', async () => {
    const s = await neu();
    expect(() => s.zugriff.issue(4711, ['title'])).toThrow(/4711|Not Found|404|resolve/);
  });

  it('creates an issue with labels, sets its body, comments and changes labels', async () => {
    const s = await neu();
    s.zugriff.labelAnlegen('flotte', '00f0ff', 'Flottenlogbuch, kein Ticket');
    s.zugriff.labelAnlegen('flotte', '00f0ff', 'Flottenlogbuch, kein Ticket');
    s.zugriff.labelAnlegen('ready-for-agent');
    s.zugriff.labelAnlegen('needs-triage');
    expect(s.zugriff.labelNamen()).toEqual(expect.arrayContaining(['flotte', 'ready-for-agent', 'needs-triage']));
    const nr = s.zugriff.anlegen('Flottenlogbuch', 'erster Stand', ['flotte', 'needs-triage']);
    s.zugriff.bodySetzen(nr, 'zweiter Stand');
    s.zugriff.kommentieren(nr, 'Notiz');
    s.zugriff.labelsAendern(nr, { dazu: ['ready-for-agent'], weg: ['needs-triage'] });
    expect(await s.lesen(nr)).toEqual({ offen: true, labels: expect.arrayContaining(['flotte', 'ready-for-agent']), body: 'zweiter Stand', kommentare: ['Notiz'] });
    expect((await s.lesen(nr)).labels).not.toContain('needs-triage');
  });

  it('closes with a comment first and opens again', async () => {
    const s = await neu();
    const nr = await s.issue({ titel: 'Zu' });
    s.zugriff.schliessen(nr, { kommentar: '**Mission abgeschlossen**', nichtGeplant: true });
    expect(await s.lesen(nr)).toMatchObject({ offen: false, kommentare: ['**Mission abgeschlossen**'] });
    expect(s.zugriff.issue(nr, ['state', 'closedAt'])).toMatchObject({ zustand: 'CLOSED', geschlossenAm: expect.any(String) });
    s.zugriff.oeffnen(nr);
    expect((await s.lesen(nr)).offen).toBe(true);
  });

  it('reads the Missionsziele of a mission and the mission of a Missionsziel, and loosens one', async () => {
    const s = await neu();
    const mission = await s.issue({ titel: 'Mission', labels: ['epic'] });
    const a = await s.issue({ titel: 'A', labels: ['ready-for-agent'] });
    const b = await s.issue({ titel: 'B' });
    await s.kindDazu(mission, a);
    await s.kindDazu(mission, b);
    expect(s.zugriff.kinder(mission).sort((x, y) => x.nummer - y.nummer)).toEqual([
      { nummer: a, zustand: 'OPEN', labels: ['ready-for-agent'] },
      { nummer: b, zustand: 'OPEN', labels: [] },
    ]);
    expect(s.zugriff.mission(a)).toBe(mission);
    expect(s.zugriff.mission(mission)).toBeNull();
    s.zugriff.kindLoesen(mission, b);
    expect(s.zugriff.kinder(mission).map((k) => k.nummer)).toEqual([a]);
    expect(s.zugriff.mission(b)).toBeNull();
  });

  it('knows whether a label was ever put on, also after it was taken off', async () => {
    const s = await neu();
    s.zugriff.labelAnlegen('ready-for-agent');
    const nr = await s.issue({ titel: 'Mission' });
    expect(s.zugriff.labelJeGesetzt(nr, 'ready-for-agent')).toBe(false);
    s.zugriff.labelsAendern(nr, { dazu: ['ready-for-agent'] });
    s.zugriff.labelsAendern(nr, { weg: ['ready-for-agent'] });
    expect(s.zugriff.labelJeGesetzt(nr, 'ready-for-agent')).toBe(true);
    expect((await s.lesen(nr)).labels).toEqual([]);
  });

  it('opens a pull request, reads and lists it, edits its body; branches, default branch, commits ahead', async () => {
    const s = await neu();
    const basis = s.zugriff.standardZweig();
    await s.zweig('epic/1-probe');
    expect(s.zugriff.zweige()).toEqual(expect.arrayContaining([basis, 'epic/1-probe']));
    expect(s.zugriff.voraus(basis, 'epic/1-probe')).toBe(1);
    const url = s.zugriff.prAnlegen(basis, 'epic/1-probe', 'WIP: Probe', 'Gate grün.');
    const nr = Number(/\/pulls?\/(\d+)$/.exec(url)![1]);
    expect(s.zugriff.prLink(nr)).toBe(url);
    expect(s.zugriff.pr(nr, ['state', 'mergeable', 'url', 'headRefName', 'baseRefName', 'headRefOid', 'body'])).toMatchObject({ nummer: nr, zustand: 'OPEN', kopf: 'epic/1-probe', basis, body: 'Gate grün.', url });
    expect(s.zugriff.pr(nr, ['headRefOid']).kopfSha).not.toBe('');
    // Gitea calls a WIP pull request not mergeable; that is no conflict (review of #127)
    expect(s.zugriff.pr(nr, ['mergeable']).mergebar).not.toBe('CONFLICTING');
    s.zugriff.prBodySetzen(nr, 'Gate grün. Neu.');
    expect(s.zugriff.pr(nr, ['body']).body).toBe('Gate grün. Neu.');
    expect(s.zugriff.prs({ zustand: 'all', kopf: 'epic/1-probe', felder: ['number', 'state'] }).map((p) => [p.nummer, p.zustand])).toEqual([[nr, 'OPEN']]);
    expect(s.zugriff.prs({ zustand: 'open', kopf: 'epic/2-anders', felder: ['number', 'state'] })).toEqual([]);
    expect(s.zugriff.prs({ zustand: 'merged', felder: ['number'] })).toEqual([]);
  });

  it('tells merge.ps1 what it needs beyond -Repo and -Pr; a token only in the environment', async () => {
    const s = await neu();
    const m = s.zugriff.mergeSkript();
    if (s.zugriff.art === 'github') expect(m).toEqual({ args: [], env: {} });
    else {
      expect(m.args).toEqual(['-Api', expect.stringMatching(/\/api\/v1\/repos\/[^/]+\/[^/]+$/)]);
      expect(m.env.FLOTTE_FORGE_KOPF).toMatch(/^(token|Basic) /);
    }
  });
}
