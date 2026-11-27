// The cases of the order writer (#72), written over any implementation of the forge layer: a test
// file calls auftragFaelle() with a fresh Pruefstand per case. GitHub runs them against stand-ins
// (auftrag.test.ts); the Gitea layer (#73) runs the same cases against a throwaway instance.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { auftragAusfuehren, type AngelegtesIssue, type AuftragsRegeln, type Forge } from '../src/auftrag/auftrag.ts';

export interface IssueStand {
  nummer: number;
  titel: string;
  body: string;
  labels: string[];
  /** the Missionsziele linked to this issue, in linking order */
  verknuepft: number[];
}

/** A forge under test plus a way to read back everything that is in it. */
export interface Pruefstand {
  forge: Forge;
  issues(): Promise<IssueStand[]>;
}

export const REGELN: AuftragsRegeln = {
  epic_label: 'epic',
  ready_label: 'ready-for-agent',
  acceptance_section: ['## Abnahmekriterien', '## Akzeptanzkriterien', '## Acceptance criteria'],
  verification_section: '## Verifikationsweg',
  modules_section: '## Betroffene Module',
  spec: false,
};

/** Mission with three Missionsziele; also the draft of the real probe. */
export const ENTWURF_DREI = readFileSync(fileURLToPath(new URL('../probe/auftrag-entwurf.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** The second Missionsziel lacks its verification section. */
export const ENTWURF_LUECKE = ENTWURF_DREI.replace(/(# Missionsziel: Datei `probe\/b\.md` anlegen[\s\S]*?)## Verifikationsweg\nDatei im Pull Request ansehen\.\n\n/, '$1');

export const ENTWURF_EINZELN = `# Missionsziel: Einzelnes Ziel

## Abnahmekriterien
- geht

## Verifikationsweg
Test.
`;

/** An in-memory forge: the stand-in of the forge layer itself. */
export function speicherForge(): Pruefstand & { aufrufe: string[] } {
  const issues: IssueStand[] = [];
  const aufrufe: string[] = [];
  const finde = (n: number) => {
    const i = issues.find((x) => x.nummer === n);
    if (!i) throw new Error(`#${n} gibt es nicht`);
    return i;
  };
  return {
    aufrufe,
    forge: {
      async anlegen({ titel, body, labels }): Promise<AngelegtesIssue> {
        const nummer = issues.length + 101;
        issues.push({ nummer, titel, body, labels: [...labels], verknuepft: [] });
        aufrufe.push(`anlegen #${nummer}`);
        return { nummer, url: `https://forge.test/o/r/issues/${nummer}` };
      },
      async bodySetzen(n, body) {
        finde(n).body = body;
        aufrufe.push(`body #${n}`);
      },
      async verknuepfen(mission, ziel) {
        finde(ziel);
        finde(mission).verknuepft.push(ziel);
        aufrufe.push(`verknuepfen #${mission} #${ziel}`);
      },
      async verknuepft(mission, ziel) {
        return finde(mission).verknuepft.includes(ziel);
      },
    },
    issues: async () => issues.map((i) => ({ ...i, labels: [...i.labels], verknuepft: [...i.verknuepft] })),
  };
}

const T = 60_000;

export function auftragFaelle(neu: () => Pruefstand | Promise<Pruefstand>) {
  it(
    'a missing required section aborts before any issue exists and names the Missionsziel',
    async () => {
      const p = await neu();
      const vorher = (await p.issues()).length;
      await expect(auftragAusfuehren(ENTWURF_LUECKE, REGELN, p.forge, { starten: false, trocken: false })).rejects.toThrow(/Nichts angelegt[\s\S]*probe\/b\.md[\s\S]*## Verifikationsweg/);
      expect((await p.issues()).length).toBe(vorher);
    },
    T,
  );

  it(
    'a mission with three Missionsziele lands fully linked: list in order, order line, "Teil von" in each',
    async () => {
      const p = await neu();
      const vorher = new Set((await p.issues()).map((i) => i.nummer));
      const r = await auftragAusfuehren(ENTWURF_DREI, REGELN, p.forge, { starten: false, trocken: false });
      if (r.trocken) throw new Error('trocken: false returned a dry result');
      const neue = (await p.issues()).filter((i) => !vorher.has(i.nummer));
      expect(neue).toHaveLength(4);
      const m = neue.find((i) => i.nummer === r.mission!.nummer)!;
      const ziele = r.ziele.map((z) => neue.find((i) => i.nummer === z.nummer)!);
      expect(m.titel).toBe('Probe des Auftragsschreibers');
      expect(ziele.map((z) => z.titel)).toEqual(['Datei `probe/a.md` anlegen', 'Datei `probe/b.md` anlegen', 'Datei `probe/c.md` anlegen']);
      expect(m.verknuepft).toEqual(ziele.map((z) => z.nummer));
      expect(m.body).toContain(['## Missionsziele', ...ziele.map((z) => `- [ ] #${z.nummer} ${z.titel}`)].join('\n'));
      expect(m.body).toContain('> **Reihenfolge:**');
      expect(m.body).not.toContain('#?');
      for (const z of ziele) {
        expect(z.body.split('\n')[0]).toBe(`Teil von #${m.nummer}`);
        expect(z.body).toContain('## Abnahmekriterien');
      }
      expect(r.mission!.url).toMatch(new RegExp(`/${m.nummer}$`));
      expect(r.ziele.every((z) => z.url.endsWith(`/${z.nummer}`))).toBe(true);
    },
    T,
  );

  it(
    'labels: without --starten needs-triage, with --starten ready_label; epic_label only on the mission',
    async () => {
      for (const starten of [false, true]) {
        const p = await neu();
        const vorher = new Set((await p.issues()).map((i) => i.nummer));
        const r = await auftragAusfuehren(ENTWURF_DREI, REGELN, p.forge, { starten, trocken: false });
        if (r.trocken) throw new Error('trocken: false returned a dry result');
        const neue = (await p.issues()).filter((i) => !vorher.has(i.nummer));
        const status = starten ? 'ready-for-agent' : 'needs-triage';
        expect(neue.find((i) => i.nummer === r.mission!.nummer)!.labels.sort()).toEqual(['epic', status].sort());
        for (const z of r.ziele) expect(neue.find((i) => i.nummer === z.nummer)!.labels).toEqual([status]);
      }
    },
    T,
  );

  it(
    '--trocken creates nothing and shows mission, Missionsziele, labels and bodies',
    async () => {
      const p = await neu();
      const vorher = (await p.issues()).length;
      const r = await auftragAusfuehren(ENTWURF_DREI, REGELN, p.forge, { starten: true, trocken: true });
      if (!r.trocken) throw new Error('trocken: true created issues');
      expect((await p.issues()).length).toBe(vorher);
      expect(r.trocken).toBe(true);
      expect(r.mission).toMatchObject({ titel: 'Probe des Auftragsschreibers', labels: ['epic', 'ready-for-agent'] });
      expect(r.ziele).toHaveLength(3);
      expect(r.ziele[0].body.startsWith('Teil von #?\n')).toBe(true);
    },
    T,
  );

  it(
    'a single Missionsziel lands alone: no mission, no "Teil von", no epic label',
    async () => {
      const p = await neu();
      const vorher = new Set((await p.issues()).map((i) => i.nummer));
      const r = await auftragAusfuehren(ENTWURF_EINZELN, REGELN, p.forge, { starten: false, trocken: false });
      const neue = (await p.issues()).filter((i) => !vorher.has(i.nummer));
      expect(r.mission).toBeNull();
      expect(neue).toHaveLength(1);
      expect(neue[0]).toMatchObject({ titel: 'Einzelnes Ziel', labels: ['needs-triage'] });
      expect(neue[0].body.startsWith('## Abnahmekriterien')).toBe(true);
    },
    T,
  );

  it(
    'issue_form spec: the single issue is the spec, the mission itself, and carries epic next to ready_label',
    async () => {
      const p = await neu();
      const vorher = new Set((await p.issues()).map((i) => i.nummer));
      const r = await auftragAusfuehren(ENTWURF_EINZELN, { ...REGELN, spec: true }, p.forge, { starten: true, trocken: false });
      const neue = (await p.issues()).filter((i) => !vorher.has(i.nummer));
      expect(r.mission).toBeNull();
      expect(neue).toHaveLength(1);
      expect([...neue[0].labels].sort()).toEqual(['epic', 'ready-for-agent']);
      expect(r.labels?.ziele).toEqual(['epic', 'ready-for-agent']);
    },
    T,
  );
}
