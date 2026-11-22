// Growth limit of the skills (Sparpaket, package 6): every SKILL.md of this repository stays within
// its line budget, and every rule the learning loop gave birth to names its origin with a date.
// Two skills are over the general budget today; their budget is frozen at today's size, so they
// may shrink but not grow. Raising a budget is a decision in a pull request, not a side effect.

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = fileURLToPath(new URL('../..', import.meta.url));
const BUDGET = 500;
const EINGEFROREN: Record<string, number> = { epic: 902, 'epic-flotte': 713 };

const skills = readdirSync(WURZEL).filter((d) => !d.startsWith('.') && statSync(join(WURZEL, d)).isDirectory() && existsSync(join(WURZEL, d, 'SKILL.md')));
const zeilen = (datei: string) => readFileSync(datei, 'utf8').split(/\r?\n/).length - (readFileSync(datei, 'utf8').endsWith('\n') ? 1 : 0);

function texte(): { datei: string; text: string }[] {
  const out: { datei: string; text: string }[] = [];
  for (const s of skills) {
    out.push({ datei: `${s}/SKILL.md`, text: readFileSync(join(WURZEL, s, 'SKILL.md'), 'utf8') });
    const ref = join(WURZEL, s, 'references');
    if (existsSync(ref)) for (const n of readdirSync(ref).filter((n) => n.endsWith('.md'))) out.push({ datei: `${s}/references/${n}`, text: readFileSync(join(ref, n), 'utf8') });
  }
  for (const n of readdirSync(join(WURZEL, 'agents'))) out.push({ datei: `agents/${n}`, text: readFileSync(join(WURZEL, 'agents', n), 'utf8') });
  return out;
}

describe('skills: growth limit', () => {
  it('finds the skills of the repository', () => {
    expect(skills).toEqual(expect.arrayContaining(['epic', 'epic-flotte', 'flotte', 'codebase-design', 'research', 'prototype', 'tdd', 'diagnosing-bugs', 'code-inspektion']));
  });

  for (const s of skills) {
    const budget = EINGEFROREN[s] ?? BUDGET;
    it(`${s}/SKILL.md stays within ${budget} lines`, () => {
      expect(zeilen(join(WURZEL, s, 'SKILL.md'))).toBeLessThanOrEqual(budget);
    });
  }

  it('every rule from the learning loop names its origin with a date', () => {
    const ohneDatum = texte().flatMap((t) => [...t.text.matchAll(/Lernschleife L\d+(?!\d|, \d{4}-\d{2}-\d{2})/g)].map((m) => `${t.datei}: ${m[0]}`));
    expect(ohneDatum).toEqual([]);
  });
});
