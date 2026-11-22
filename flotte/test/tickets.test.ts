// #113: new tickets only when needed. The admiral decides a "new ticket?" question block; the rule
// reads the same in its prompt, epic/SKILL.md and epic-nacharbeit/SKILL.md.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { admiralAuftrag, BEIM_MENSCHEN, TICKET_REGEL } from '../src/treiber/admiral.ts';
import { leseBlock, type FrageBlock } from '../src/werkzeuge/bloecke.ts';
import { frage } from './flotte-welt.ts';

const block = leseBlock(frage(3, 'tor', [{ betrifft: 'Lauf', frage: 'Soll dafür ein neues Ticket angelegt werden?' }])) as FrageBlock;
const text = admiralAuftrag(block, 'Epic #3 in o/r.');
const leer = (s: string) => s.replace(/\s+/g, ' ');

describe('#113: Tickets nur, wenn nötig', () => {
  it('the admiral decides the ticket question: it is not on the list of the person', () => {
    const liste = text.slice(text.indexOf('Beim Menschen (beim_menschen: true)'), text.indexOf('Alles andere entscheidest du'));
    const admiral = text.slice(text.indexOf('Alles andere entscheidest du'));
    expect(liste).toContain(BEIM_MENSCHEN.map((p, i) => `${i + 1}. ${p}`).join('\n'));
    expect(liste).not.toMatch(/neue[sn]? Ticket|Ticketfrage|Ticket anlegen/);
    expect(admiral).toContain('ein neues Ticket');
    expect(admiral).toContain(TICKET_REGEL);
    expect(TICKET_REGEL).toContain('Eine Ticketfrage geht nicht an den Menschen.');
  });

  it('the rule names needs-triage, one sentence of cause and the listing in the epic PR', () => {
    expect(TICKET_REGEL).toMatch(/`needs-triage` und einen Satz zur Ursache/);
    expect(TICKET_REGEL).toMatch(/Epic-PR listet die angelegten Tickets/);
  });

  for (const datei of ['epic/SKILL.md', 'epic-nacharbeit/SKILL.md']) {
    it(`${datei} says the same sentence`, () => {
      const skill = readFileSync(fileURLToPath(new URL(`../../${datei}`, import.meta.url)), 'utf8');
      expect(leer(skill)).toContain(TICKET_REGEL);
    });
  }

  it('the old rule "no issues without explicit decision" and "at most three" is gone', () => {
    for (const datei of ['epic/SKILL.md', 'epic-nacharbeit/SKILL.md']) {
      const skill = readFileSync(fileURLToPath(new URL(`../../${datei}`, import.meta.url)), 'utf8');
      expect(skill).not.toMatch(/Keine Issues ohne ausdrückliche Entscheidung|Vorschlag zur Entscheidung|höchstens drei pro Lauf/);
    }
  });
});
