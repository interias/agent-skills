// The README section "Wer entscheidet" is the readable version of the admiral's decision right. It
// quotes the list of the person and the ticket rule word for word, so the page cannot drift from
// what the admiral, the runs and the triage are actually given.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BEIM_MENSCHEN, HERKUNFT_REGEL, TICKET_REGEL } from '../src/treiber/admiral.ts';

const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const leer = (s: string) => s.replace(/\s+/g, ' ');
const abschnitt = readme.slice(readme.indexOf('## Wer entscheidet'), readme.indexOf('## Das Bild'));

describe('README: Wer entscheidet', () => {
  it('stands before the picture of the flow', () => {
    expect(readme.indexOf('## Wer entscheidet')).toBeGreaterThan(0);
    expect(readme.indexOf('## Wer entscheidet')).toBeLessThan(readme.indexOf('## Das Bild'));
  });

  it('quotes the list of the person word for word and asks one question per point', () => {
    expect(abschnitt).toContain(BEIM_MENSCHEN.map((p, i) => `${i + 1}. ${p}`).join('\n'));
    const fragen = abschnitt.slice(abschnitt.indexOf('### Prüffragen'), abschnitt.indexOf('### Nacharbeit'));
    expect(fragen.match(/^\| \d \|/gm)).toHaveLength(BEIM_MENSCHEN.length);
  });

  it('quotes the ticket rule word for word', () => {
    expect(leer(abschnitt)).toContain(leer(TICKET_REGEL));
  });

  it('names the four origins of a decision', () => {
    for (const h of ['Projektregel', 'Skill-Empfehlung', 'Präzedenz', 'Eigenes Urteil']) expect(HERKUNFT_REGEL).toContain(h);
    expect(abschnitt).toMatch(/Projektregel, Skill-Empfehlung, Präzedenz mit\s+Fundstelle oder eigenes Urteil mit Grund/);
  });

  it('links the graphic in both widths', () => {
    expect(abschnitt).toContain('assets/readme/befugnisse.png');
    expect(abschnitt).toContain('assets/readme/befugnisse-schmal.png');
  });
});
