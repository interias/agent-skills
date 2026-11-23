// P17 of #65 (P17b: epic-mechanik-p17b.test.ts) against the real Mechanik (#66): the program dies outside every job, once
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

it('P17 echt: the program dies after the merge commit is in the state, before Down; the restart merges no second time, cleans up and starts the successor', async () => {
  const f = neu();
  const g = forge();
  const welt = neueWelt();
  const pakete = [paket('110'), paket('111', { nach: ['110'] })];
  let tot = false;
  const erst = echtesDrehbuch({ schnitt: { version: 1, pakete, tor: [] } }, f, g, {
    welt,
    arbeit: { 110: anhaengen('hundertzehn') },
    tod: () => tot,
    // the merge job stops after the merge commit was written to the state: the program dies at the next takt
    mechanik: (m) => ({
      ...m,
      async baumGleich(branch) {
        if (branch === 'agent/110-paket-110') {
          tot = true;
          return nie();
        }
        return m.baumGleich(branch);
      },
    }),
  });
  await expect(fahreEpic(einstellung(f), erst)).rejects.toThrow(/Programm beendet/);
  const zwischen = liesLauf(epicDir(f.repo, 69), 69).pakete['110'];
  expect(zwischen).toMatchObject({ stufe: 'merge', epicGeprueft: false });
  expect(zwischen.mergeCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(existsSync(join(f.wt, '110'))).toBe(true);

  // the restart: a new program with a new Mechanik; CleanupStale leaves the worktrees of this epic alone
  const z = await fahreEpic(einstellung(f), echtesDrehbuch({ schnitt: { version: 1, pakete, tor: [] } }, f, g, { welt, arbeit: { 111: anhaengen('hundertelf') } }));
  expect(z.pakete['110']).toMatchObject({ stufe: 'fertig', mergeCommit: zwischen.mergeCommit, epicLauf: null });
  expect(merges(f, 'agent/110-paket-110')).toHaveLength(1);
  expect(existsSync(join(f.wt, '110'))).toBe(false);
  expect(f.git(['branch', '--list', 'agent/110-paket-110'])).toBe('');
  expect(z.pakete['111'].stufe).toBe('fertig');
  expect(readFileSync(join(z.epicWorktree!, 'src', 'liste.txt'), 'utf8').replace(/\r/g, '')).toBe('a\nhundertzehn\nhundertelf\n');
  expect(g.kommentare[110].filter((k) => k.startsWith('**Angedockt**'))).toHaveLength(1);
  expect(g.prs[0].titel).toBe('Ticket 69');
}, 120_000);
