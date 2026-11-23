// P17b of #65 (P17: epic-mechanik-p17.test.ts) against the real Mechanik (#66): the program dies outside every job, once
// after the merge commit is in the state (before Down) and once right after the merge, before the
// state knows it. The restart finds the real merge commit (imEpic), merges no second time, cleans up
// and starts the successors. A package without commits of its own is nothing to merge: it never takes
// over the merge commit of another package.

import { afterAll, expect, it } from 'vitest';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neueWelt } from '../src/epic/attrappe.ts';
import { fahreEpic, type EpicEinstellung } from '../src/epic/motor.ts';
import type { Paket } from '../src/epic/schema.ts';
import { epicDir, liesLauf } from '../src/epic/zustand.ts';
import { echtesDrehbuch, fixture, forge, type Fixture } from './epic-fixture.ts';

const fixtures: Fixture[] = [];
afterAll(() => fixtures.forEach((f) => f.weg()));
const neu = () => {
  const f = fixture();
  fixtures.push(f);
  return f;
};

const paket = (nr: string, o: Partial<Paket> = {}): Paket => ({ nr, titel: `Paket ${nr}`, klasse: 'standard', abnahme: [`${nr} tut, was es soll`], decisions: [], outOfScope: [], testing: [], verifikation: '', lektuere: [], dateien: [], nach: [], kollision: [], exklusiv: false, ...o });
const einstellung = (f: Fixture): EpicEinstellung => ({ repo: f.repo, epic: 69, epicBranch: 'epic/69-programm', basis: 'origin/main', fenster: 3, maxRunden: 3, konto: '/konten/2' });
const anhaengen = (zeile: string) => (cwd: string) => appendFileSync(join(cwd, 'src', 'liste.txt'), `${zeile}\n`);
/** a promise that never ends: the job that waits on it is dead with the program */
const nie = () => new Promise<never>(() => {});
const merges = (f: Fixture, branch: string) => f.git(['log', '--merges', '--format=%s', 'epic/69-programm']).split(/\r?\n/).filter((s) => s.includes(branch));

it('P17b echt: the program dies right after the merge, before the state knows it; imEpic takes the real merge commit; a package without commits is nothing to merge and takes no foreign merge commit', async () => {
  const f = neu();
  const g = forge();
  const welt = neueWelt();
  const pakete = [paket('120'), paket('121', { nach: ['120'] }), paket('122', { nach: ['120'] })];
  let tot = false;
  const erst = echtesDrehbuch({ schnitt: { version: 1, pakete, tor: [] } }, f, g, {
    welt,
    arbeit: { 120: anhaengen('hundertzwanzig') },
    tod: () => tot,
    mechanik: (m) => ({
      ...m,
      async merge(branch) {
        const v = await m.merge(branch);
        if (branch !== 'agent/120-paket-120') return v;
        tot = true;
        return nie();
      },
    }),
  });
  await expect(fahreEpic(einstellung(f), erst)).rejects.toThrow(/Programm beendet/);
  expect(liesLauf(epicDir(f.repo, 69), 69).pakete['120']).toMatchObject({ stufe: 'merge', mergeCommit: null });
  expect(merges(f, 'agent/120-paket-120')).toHaveLength(1);
  const echt = f.git(['rev-parse', 'epic/69-programm']);

  // 121 adds a line, 122 leaves nothing (as every stand-in implementer with --mechanik echt)
  const z = await fahreEpic(einstellung(f), echtesDrehbuch({ schnitt: { version: 1, pakete, tor: [] }, aufrufe: { 'implementer:122': [{ takte: 60 }] } }, f, g, { welt, arbeit: { 121: anhaengen('hunderteinundzwanzig') } }));
  // Sollte 4: exactly one merge, the commit taken over from the epic branch
  expect(z.pakete['120']).toMatchObject({ stufe: 'fertig', mergeCommit: echt });
  expect(merges(f, 'agent/120-paket-120')).toHaveLength(1);
  // Muss 1: 122 is nothing to merge: no merge commit of its own or of 120/121, no run, no revert, said in the comment
  const p122 = z.pakete['122'];
  expect(p122).toMatchObject({ stufe: 'fertig', nichtsZuMergen: true, mergeCommit: null, revertCommit: null, epicLauf: null });
  expect(merges(f, 'agent/122-paket-122')).toHaveLength(0);
  expect(g.kommentare[122].find((k) => k.startsWith('**Angedockt**'))).toMatch(/nichts anzudocken, agent\/122-paket-122 hat keine eigenen Commits.*kein Andock-Commit\.\nAbnahme:[\s\S]*Lauf auf dem Missions-Branch entfällt: nichts angedockt/);
  expect(f.git(['branch', '--list', 'agent/122-paket-122'])).toBe('');
  expect(z.pakete['121']).toMatchObject({ stufe: 'fertig' });
  expect(z.pakete['121'].mergeCommit).not.toBe(echt);
  expect(g.prs[0].body).toContain('- Paket 122: nichts anzudocken, Runde 1');
}, 120_000);
