// P14 and P15 of #65 against the real Mechanik (#66): real merge conflicts in the fixture's epic
// worktree, a mechanical one resolved and committed, one about content aborted. Beside them a
// package whose test makes bun crash: 4c cannot count, the package goes round and is left behind.

import { afterAll, expect, it } from 'vitest';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aufrufen } from '../src/aufruf.ts';
import { fahreEpic, type EpicEinstellung } from '../src/epic/motor.ts';
import type { Paket } from '../src/epic/schema.ts';
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

it('P14/P15 echt: a mechanical conflict is resolved, committed and tested on the epic branch; one about content is aborted, the branch stays; edges added; a crashing test is a finding, not a stop', async () => {
  const f = neu();
  const g = forge();
  const u = echtesDrehbuch(
    {
      schnitt: { version: 1, pakete: [paket('90'), paket('91'), paket('92'), paket('93')], tor: [] },
      aufrufe: { 'implementer:91': [{ takte: 40 }], 'implementer:92': [{ takte: 120 }], 'konflikt:92': [{ ausgabe: { ergebnis: 'inhaltlich', begruendung: 'beide ändern dieselbe Zeile' } }] },
    },
    f,
    g,
    {
      arbeit: {
        90: anhaengen('neunzig'),
        91: anhaengen('einundneunzig'),
        92: anhaengen('zweiundneunzig'),
        // bun ends without a summary: zaehle throws (unknown format), which is the package's matter (rule 10)
        93: (cwd) => writeFileSync(join(cwd, 'test', 'kaputt.test.ts'), "import { test } from 'bun:test';\nprocess.exit(3);\ntest('nie', () => {});\n"),
      },
      loesung: {
        91: (cwd) => {
          writeFileSync(join(cwd, 'src', 'liste.txt'), 'a\nneunzig\neinundneunzig\n');
          aufrufen('git', ['-C', cwd, 'add', 'src/liste.txt']);
        },
      },
    },
  );
  const z = await fahreEpic(einstellung(f), u);

  expect(z.pakete['90'].stufe).toBe('fertig');
  // P14: the conflict was real, the merge commit has two parents, the epic branch was tested (resolved conflicts always are)
  const p91 = z.pakete['91'];
  expect(p91).toMatchObject({ stufe: 'fertig', konflikt: { dateien: ['src/liste.txt'], ergebnis: 'geloest' } });
  expect(f.git(['log', '-1', '--format=%P', p91.mergeCommit!]).split(' ')).toHaveLength(2);
  // --cleanup=strip: the "# Conflicts:" lines of the prepared message stay out of the merge commit
  expect(f.git(['log', '-1', '--format=%B', p91.mergeCommit!])).not.toMatch(/#\s*Conflicts/);
  // Up names the epic head the package started on (the hash of the reviewer's order)
  expect(p91.kopf).toMatch(/^[0-9a-f]{40}$/);
  expect(p91.epicLauf).toEqual([{ name: 'fix', dateien: 1, tests: 1, rot: [] }]);
  expect(z.kanten).toContainEqual({ a: '90', b: '91', art: 'kollision', grund: 'Merge-Konflikt in src/liste.txt' });
  // P15: aborted, nothing of 92 in the epic branch, no merge in progress, the branch stays
  expect(z.pakete['92']).toMatchObject({ stufe: 'zurueckgelassen', mergeCommit: null });
  expect(z.pakete['92'].grund).toMatch(/inhaltlich: beide ändern dieselbe Zeile/);
  expect(readFileSync(join(z.epicWorktree!, 'src', 'liste.txt'), 'utf8').replace(/\r/g, '')).toBe('a\nneunzig\neinundneunzig\n');
  expect(aufrufen('git', ['-C', z.epicWorktree!, 'rev-parse', '-q', '--verify', 'MERGE_HEAD']).code).not.toBe(0);
  expect(f.git(['branch', '--list', 'agent/92-paket-92'])).toContain('agent/92-paket-92');
  expect(g.labels[92]).toEqual(['status/haengt']);
  expect(z.kanten.some((k) => k.b === '92')).toBe(true);
  // Muss 2: three rounds with the finding, then left behind; the run ended with its PR
  expect(z.pakete['93']).toMatchObject({ stufe: 'zurueckgelassen', runde: 3, mergeCommit: null });
  expect(z.pakete['93'].grund).toMatch(/max_rounds \(3\).*Nachprüfung gescheitert: Suite fix \(Exit 3\).*keinem bekannten Format/);
  expect(z.phase).toBe('fertig');
  expect(g.prs).toHaveLength(1);
}, 120_000);
