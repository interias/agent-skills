// docs/befugnisse.md is the readable version of the admiral's decision right; the README points to it
// with the graphic. The page quotes the list of the person and the ticket rule word for word, so it
// cannot drift from what the admiral, the runs and the triage are actually given.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BEIM_MENSCHEN, HERKUNFT_REGEL, TICKET_REGEL } from '../src/treiber/admiral.ts';

const lies = (datei: string) => readFileSync(fileURLToPath(new URL(`../../${datei}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const readme = lies('README.md');
const seite = lies('docs/befugnisse.md');
const leer = (s: string) => s.replace(/\s+/g, ' ');

describe('Wer entscheidet: README und docs/befugnisse.md', () => {
  it('the README shows the graphic in both widths and links the page', () => {
    const abschnitt = readme.slice(readme.indexOf('## Wer entscheidet'));
    expect(readme.indexOf('## Wer entscheidet')).toBeGreaterThan(readme.indexOf('## Die Brücke'));
    expect(abschnitt).toContain('assets/readme/befugnisse.png');
    expect(abschnitt).toContain('assets/readme/befugnisse-schmal.png');
    expect(abschnitt).toContain('(docs/befugnisse.md)');
  });

  it('the page quotes the list of the person word for word and asks one question per point', () => {
    expect(seite).toContain(BEIM_MENSCHEN.map((p, i) => `${i + 1}. ${p}`).join('\n'));
    const fragen = seite.slice(seite.indexOf('## Prüffragen'), seite.indexOf('## Nacharbeit'));
    expect(fragen.match(/^\| \d \|/gm)).toHaveLength(BEIM_MENSCHEN.length);
  });

  it('the page quotes the ticket rule word for word', () => {
    expect(leer(seite)).toContain(leer(TICKET_REGEL));
  });

  it('the page names the four origins of a decision', () => {
    for (const h of ['Projektregel', 'Skill-Empfehlung', 'Präzedenz', 'Eigenes Urteil']) expect(HERKUNFT_REGEL).toContain(h);
    expect(seite).toMatch(/Projektregel, Skill-Empfehlung, Präzedenz mit\s+Fundstelle oder eigenes Urteil mit Grund/);
  });
});
