// Guard for the skill /bereitschaftsraum (agent-skills/ADR-0002): it creates missions only through
// `flotte auftrag`, and nothing in it tells the reader to call a forge's issue creation directly.
// A mention is allowed only inside the explicit ban.

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORDNER = join(fileURLToPath(new URL('../..', import.meta.url)), 'bereitschaftsraum');
const dateien = [join(ORDNER, 'SKILL.md')];
const ref = join(ORDNER, 'references');
if (existsSync(ref)) for (const n of readdirSync(ref).filter((n) => n.endsWith('.md'))) dateien.push(join(ref, n));

const VERBOTEN = /(gh|tea|glab)\s+issue\s+create|\bPOST\b[^\n]*\/issues|issues\.create|\/issues['"`\s]/gi;
// The negation must stand directly before the call ("kein `gh issue create`"), on the same line.
const VERBOT = /\b(nie|nicht|kein|keine|keinen|never)\s*[`'"]?$/i;

describe('bereitschaftsraum skill', () => {
  it('exists', () => {
    expect(existsSync(dateien[0]!)).toBe(true);
  });

  it('names flotte auftrag as the way to create issues', () => {
    expect(readFileSync(dateien[0]!, 'utf8')).toMatch(/flotte auftrag/);
  });

  it('calls no issue creation directly, except inside the explicit ban', () => {
    const fund: string[] = [];
    for (const d of dateien) {
      const zeilen = readFileSync(d, 'utf8').split(/\r?\n/);
      zeilen.forEach((z, i) => {
        for (const m of z.matchAll(VERBOTEN)) {
          if (!VERBOT.test(z.slice(0, m.index))) fund.push(`${d}:${i + 1}: ${z.trim()}`);
        }
      });
    }
    expect(fund).toEqual([]);
  });

  it('keeps the ban in the skill', () => {
    expect(readFileSync(dateien[0]!, 'utf8')).toMatch(/Nie[^\n]*legst du Missionen[\s\S]*gh issue create/);
  });
});
