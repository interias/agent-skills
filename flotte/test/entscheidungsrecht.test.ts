// #110: one list "beim Menschen" in the admiral's prompt, the same in flotte/references/entscheidungsrecht.md and
// epic/SKILL.md. The admiral is a language model; what goes to the person is decided by its prompt,
// so the cases are checked against the prompt: the list names the person's questions, the sentence
// "Alles andere entscheidest du" names the admiral's.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { admiralAuftrag, BEIM_MENSCHEN } from '../src/treiber/admiral.ts';
import { leseBlock, type FrageBlock } from '../src/werkzeuge/bloecke.ts';
import { frage } from './flotte-welt.ts';

const text = admiralAuftrag(leseBlock(frage(3, 'tor', [{ betrifft: 'Lauf' }])) as FrageBlock, 'Epic #3 in o/r.');
const liste = text.slice(text.indexOf('Beim Menschen (beim_menschen: true)'), text.indexOf('Alles andere entscheidest du'));
const admiral = text.slice(text.indexOf('Alles andere entscheidest du'), text.indexOf('\n', text.indexOf('Alles andere entscheidest du')));
const marken = text.slice(text.indexOf('Dann nennt marke'));

describe('#110: Entscheidungsrecht, eine Liste beim Menschen', () => {
  it('the list stands in the prompt, numbered, and nothing else lies with the person', () => {
    expect(liste).toContain(BEIM_MENSCHEN.map((p, i) => `${i + 1}. ${p}`).join('\n'));
    expect(text).not.toMatch(/Immer beim Menschen|zusätzlich beim Menschen/);
  });

  for (const [marke, admiralSagt, nichtInListe] of [
    ['Kosten (Planlimit)', 'Der Verbrauch des Planlimits ist kein Kostenthema: Ihn regeln die Bremsen', /Kosten|Planlimit|Verbrauch|Budget/],
    ['Umfang', 'auch den Umfang (weglassen, dazunehmen, in ein Ticket verschieben)', /Umfang/],
    ['ADR ohne Bruch', 'einen ADR-Bezug ohne Bruch', /ADR(?!\))/],
    ['Ticket', 'ein neues Ticket', /neue[sn]? Ticket|Ticket anlegen/],
  ] as const) {
    it(`a question marked ${marke} does not go to the person`, () => {
      expect(admiral).toContain(admiralSagt);
      expect(liste).not.toMatch(nichtInListe);
    });
  }

  for (const [marke, punkt] of [
    ['E-Mail an Dritte', /E-Mails und Nachrichten an Dritte/],
    ['echtes Geld', /echtes Geld, das nicht vorher freigegeben ist/],
    ['Produktivdaten ohne Beschluss', /Produktivdaten ändern, wenn das nicht eindeutig beschlossen ist/],
    ['Zugang', /Sicherheit und Zugänge, außer/],
    ['neue unübliche Abhängigkeit', /eine neue Abhängigkeit, die nicht üblich und nicht Best Practice ist/],
  ] as const) {
    it(`a question marked ${marke} goes to the person`, () => {
      expect(liste).toMatch(punkt);
    });
  }

  it('the examples for marke name the list, not costs or scope', () => {
    expect(marken).not.toMatch(/Kosten|Umfang|Schema|Ausrollen/);
  });

  // the whole list, nothing more: an extra point in one skill would make the texts differ
  for (const [datei, von, bis, trenner] of [
    ['flotte/references/entscheidungsrecht.md', 'nur dafür wartet der Lauf: ', ' **Alles andere entscheidest du**', ' '],
    ['epic/SKILL.md', '„Entscheidungsrecht"): ', '. Alles andere entscheidet der Admiral', '; '],
  ] as const) {
    it(`${datei} names the same list`, () => {
      const skill = readFileSync(fileURLToPath(new URL(`../../${datei}`, import.meta.url)), 'utf8').replace(/\s+/g, ' ');
      const start = skill.indexOf(von) + von.length;
      expect(skill.slice(start, skill.indexOf(bis, start))).toBe(BEIM_MENSCHEN.map((p, i) => `${i + 1}. ${p}`).join(trenner));
    });
  }
});
