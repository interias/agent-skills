// P13, P13b, P2 and P19 of #65 against the real Mechanik (#66): worktrees by worktree.ps1, 4c with
// bun test in the fixture, merges with --no-ff, revert -m 1, push to the fixture's own remote; labels,
// comments and the pull request go to the recorded forge.

import { afterAll, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aufrufen } from '../src/aufruf.ts';
import { fahreEpic } from '../src/epic/motor.ts';
import type { Paket } from '../src/epic/schema.ts';
import { echtesDrehbuch, fixture, forge } from './epic-fixture.ts';

const f = fixture();
afterAll(() => f.weg());

const paket = (nr: string, o: Partial<Paket> = {}): Paket => ({ nr, titel: `Paket ${nr}`, klasse: 'standard', abnahme: [`${nr} tut, was es soll`], decisions: [], dateien: [], nach: [], kollision: [], exklusiv: false, ...o });
const schreibe = (cwd: string, datei: string, text: string) => {
  mkdirSync(join(cwd, datei, '..'), { recursive: true });
  writeFileSync(join(cwd, datei), text);
};

it('P13/P13b/P2/P19 echt: red epic branch after the merge is reverted with -m 1, the branch stays; the same tree needs no run; a successor starts on the head with its predecessor; warn goes into the comment', async () => {
  const g = forge({ 69: 'Epic-Programm: Fixture' });
  let flagIn83: boolean | null = null;
  const u = echtesDrehbuch(
    {
      schnitt: { version: 1, pakete: [paket('80'), paket('81'), paket('82', { nach: ['80'] }), paket('83', { nach: ['81'] })], tor: [] },
      // 80 comes back late, so 81 is merged before it and the tree after 80's merge is not the one 4c checked
      aufrufe: { 'implementer:80': [{ takte: 150 }] },
      ram: ['ok', 'hold', 'warn'],
    },
    f,
    g,
    {
      arbeit: {
        81: (cwd) => schreibe(cwd, 'src/flag.txt', 'x\n'),
        80: (cwd) => schreibe(cwd, 'test/p80.test.ts', "import { expect, test } from 'bun:test';\nimport { existsSync } from 'node:fs';\ntest('ohne flag', () => expect(existsSync('src/flag.txt')).toBe(false));\n"),
        83: (cwd) => {
          flagIn83 = existsSync(join(cwd, 'src', 'flag.txt'));
          schreibe(cwd, 'src/p83.txt', 'p83\n');
        },
      },
    },
  );
  const z = await fahreEpic({ repo: f.repo, epic: 69, epicBranch: 'epic/69-programm', basis: 'origin/main', fenster: 3, maxRunden: 3, konto: '/konten/2' }, u);

  // P13: 80 merged for real, red on the epic branch, reverted as a commit of its own; the branch stays
  const p80 = z.pakete['80'];
  expect(p80.stufe).toBe('zurueckgelassen');
  expect(p80.mergeCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(p80.revertCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(f.git(['log', '-1', '--format=%P', p80.mergeCommit!]).split(' ')).toHaveLength(2);
  expect(f.git(['log', '-1', '--format=%s', p80.revertCommit!])).toMatch(/^Revert/);
  expect(p80.epicLauf?.[0].rot).toEqual([{ datei: 'test/p80.test.ts', test: 'ohne flag' }]);
  expect(f.git(['branch', '--list', 'agent/80-paket-80'])).toContain('agent/80-paket-80');
  expect(existsSync(join(f.wt, '80'))).toBe(false);
  expect(g.labels[80]).toEqual(['status/haengt']);
  expect(g.kommentare[80].some((k) => k.includes(`Revert-Commit ${p80.revertCommit}; zurückholen = Revert des Reverts`))).toBe(true);
  expect(z.pakete['82']).toMatchObject({ stufe: 'blockiert', blockiertDurch: '80' });
  expect(g.labels[82]).toEqual(['status/blockiert']);

  // P13b: 81 alone on the epic branch: the tree is the one 4c checked, no run after the merge; Down, branch -d
  const p81 = z.pakete['81'];
  expect(p81).toMatchObject({ stufe: 'fertig', epicGeprueft: true, epicLauf: null });
  expect(p81.testlauf).toEqual([{ name: 'fix', dateien: 1, tests: 1, rot: [] }]);
  expect(f.git(['branch', '--list', 'agent/81-paket-81'])).toBe('');
  expect(existsSync(join(f.wt, '81'))).toBe(false);
  const k81 = g.kommentare[81].find((k) => k.startsWith('**Gemergt**'))!;
  expect(k81).toContain(`Merge-Commit ${p81.mergeCommit}`);
  expect(k81).toContain('- 81 tut, was es soll: erfüllt');
  expect(k81).toContain('Verifikation (4c, Volllauf im Paket-Worktree): fix 1 Tests in 1 Dateien, 0 rot; Ausgangszahlen: fix 1 Tests in 1 Dateien, 0 rot.');
  expect(k81).toContain('Lauf auf dem Epic-Branch entfällt: git diff --quiet agent/81-paket-81 HEAD endete mit 0');
  expect(k81).toMatch(/\nZeiten: Start \S+, Implementer zurück \S+, Reviewer zurück \S+, abgenommen \S+, gemergt \S+/);
  expect(g.labels[81]).toEqual(['status/in-arbeit']);

  // P2: 83 started from the epic head that holds 81; P19: hold asked, warn started and is in the comment
  expect(flagIn83).toBe(true);
  expect(z.pakete['83'].stufe).toBe('fertig');
  expect(z.fragen.some((q) => q.art === 'ram')).toBe(true);
  expect(g.kommentare[83].find((k) => k.startsWith('**Gemergt**'))).toMatch(/RAM beim Start: warn bei 78 %, Start: 83/);

  // the epic branch holds 81 and 83, not 80; pushed to the fixture's remote; the PR is WIP and closes only the accepted children
  const epicWt = z.epicWorktree!;
  expect(existsSync(join(epicWt, 'src', 'flag.txt')) && existsSync(join(epicWt, 'src', 'p83.txt'))).toBe(true);
  expect(existsSync(join(epicWt, 'test', 'p80.test.ts'))).toBe(false);
  expect(aufrufen('git', ['-C', f.remote, 'rev-parse', 'epic/69-programm']).stdout.trim()).toBe(f.git(['rev-parse', 'epic/69-programm']));
  expect(g.prs).toHaveLength(1);
  expect(g.prs[0]).toMatchObject({ titel: 'WIP: Epic-Programm: Fixture', base: 'main', head: 'epic/69-programm' });
  expect(g.prs[0].body).toContain('Closes #81');
  expect(g.prs[0].body).toContain('Closes #83');
  expect(g.prs[0].body).not.toMatch(/Closes #(69|80|82)\b/);
  expect(g.prs[0].body).toContain('Lauftafel aus (Flotten-Treiber)');
  expect(g.aufrufe.some((a) => a[0] === 'pr' && a[1] === 'merge')).toBe(false);

  // the target issue: epic_label and status/in-arbeit at the opening, in-arbeit gone at the end; opening and closing comment
  expect(g.labels[69]).toEqual(['epic']);
  expect(g.aufrufe.some((a) => a[1] === 'edit' && a[2] === '69' && a.includes('status/in-arbeit,epic'))).toBe(true);
  expect(g.kommentare[69].some((k) => k.startsWith('**Lauf beginnt**') && k.includes('Lauftafel aus (Flotten-Treiber)'))).toBe(true);
  expect(g.kommentare[69].some((k) => k.startsWith('**Abschluss**') && k.includes(g.prs[0].url) && k.includes('### Was das Epic offen lässt'))).toBe(true);
  expect(z.ende).toContain(`FLOTTE-ENDE 69 ${g.prs[0].url}`);

  // left on disk: the main checkout, the epic worktree; the lock holder of the run is gone
  const liste = f.git(['worktree', 'list', '--porcelain']).split(/\r?\n/).filter((l) => l.startsWith('worktree '));
  expect(liste).toHaveLength(2);
  expect(existsSync(join(f.wurzel, 'halter.json'))).toBe(false);
}, 120_000);
