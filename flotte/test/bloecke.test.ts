import { describe, expect, it } from 'vitest';
import { leseBlock, nurBuchstaben } from '../src/werkzeuge/bloecke.ts';

const frage = `Bericht des Laufs.

FLOTTE-FRAGE 302 tor
1. Soll #307 vor #254 laufen? — Betrifft: #307, #254 — Lage: ADR-0094 verlangt X (docs/adr/0094.md) — Optionen: A) zuerst #307, ein Tag später B) parallel, Konfliktgefahr — Empfehlung: A — Grund: sicherer — Regel/Quelle: epic, Phase 1
2. Darf der Lauf die Testdatenbank neu anlegen? — Betrifft: Lauf — Lage: kein Testbett — Optionen: A) ja B) nein — Empfehlung: B — Grund: Daten — Regel/Quelle: Adapter
3. Port 5433 oder 5434? — Lage: beide frei — Optionen: A) 5433 B) 5434 — Empfehlung: A — Grund: Standard — Regel/Quelle: Skill
STAND: 3 von 5 Paketen gemergt  TAFEL: https://claude.ai/artifact/abc`;

describe('leseBlock', () => {
  it('reads a question block with Betrifft, options and recommendation', () => {
    const b = leseBlock(frage);
    expect(b).toMatchObject({ art: 'frage', epic: 302, phase: 'tor', stand: '3 von 5 Paketen gemergt', tafel: 'https://claude.ai/artifact/abc' });
    if (b?.art !== 'frage') throw new Error('kein Frageblock');
    expect(b.fragen).toHaveLength(3);
    expect(b.fragen[0]).toMatchObject({ nr: 1, frage: 'Soll #307 vor #254 laufen?', betrifft: ['#307', '#254'], empfehlung: 'A', quelle: 'epic, Phase 1' });
    expect(b.fragen[0].optionen).toEqual([
      { buchstabe: 'A', text: 'zuerst #307, ein Tag später' },
      { buchstabe: 'B', text: 'parallel, Konfliktgefahr' },
    ]);
    expect(b.fragen[1].betrifft).toBe('Lauf');
    expect(b.fragen[2].betrifft).toBeNull();
  });

  it('takes the last block when a text holds several', () => {
    const b = leseBlock('FLOTTE-FRAGE 1 tor\n1. x — Betrifft: Lauf\nSTAND: a\n\nweiter gearbeitet\nFLOTTE-FRAGE 1 abbruch\n1. y — Betrifft: p2\nSTAND: b');
    expect(b).toMatchObject({ phase: 'abbruch', stand: 'b' });
  });

  it('reads an end block with the pull request and what stays open', () => {
    const b = leseBlock('FLOTTE-ENDE 299 https://github.com/o/r/pull/347\nPR offen.\n\n### Was das Epic offen lässt\n- #243 wartet\n- Doku');
    expect(b).toEqual({ art: 'ende', epic: 299, pr: 347, prUrl: 'https://github.com/o/r/pull/347', offen: '- #243 wartet\n- Doku' });
  });

  it('reads the PR number without a link and a bold header', () => {
    expect(leseBlock('**FLOTTE-ENDE** #7 PR #12 bereit')).toMatchObject({ art: 'ende', epic: 7, pr: 12, prUrl: null, offen: '' });
  });

  it('is null without a block, also for a mention inside a sentence', () => {
    expect(leseBlock('Fertig. Ich schicke gleich FLOTTE-ENDE.')).toBeNull();
    expect(leseBlock('')).toBeNull();
  });

  it('reads any number of options in order, a multiple choice and the raw wording (#28)', () => {
    const zeile = '1. Welche Sprachen? — Betrifft: Lauf — Optionen: A) de B) en C) fr D) es E) it F) nl G) pl H) cs I) da (siehe X) unten) — Auswahl: mehrere — Empfehlung: A, C — Grund: g';
    const b = leseBlock(`FLOTTE-FRAGE 5 tor\n${zeile}\nSTAND: x`);
    if (b?.art !== 'frage') throw new Error('kein Frageblock');
    const f = b.fragen[0];
    expect(f.optionen.map((o) => o.buchstabe)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
    expect(f.optionen[8].text).toBe('da (siehe X) unten)');
    expect(f).toMatchObject({ mehrfach: true, empfehlung: 'A, C', roh: zeile });
    expect(b.roh).toBe(`FLOTTE-FRAGE 5 tor\n${zeile}\nSTAND: x`);
    const einzeln = leseBlock('FLOTTE-FRAGE 5 tor\n1. x — Optionen: A) a B) b — Empfehlung: B, weil sicher\nSTAND: x');
    expect(einzeln?.art === 'frage' && einzeln.fragen[0]).toMatchObject({ mehrfach: false, empfehlung: 'B' });
    expect(nurBuchstaben('A, C')).toBe(true);
    expect(nurBuchstaben('Ab sofort')).toBe(false);
  });

  it('reads options, recommendation and Betrifft a run wrote into the question text', () => {
    const b = leseBlock('FLOTTE-FRAGE 393 nacharbeit\n1. **#405 Lieferschein ohne Kommissionierung.** Er bucht ohne Fach. - A) so lassen - B) Ticket: aus dem FIFO-Fach buchen - C) Ticket: erst nach der Kommissionierung ➡️ **C als Ticket.** Das entspricht Entscheidung 6. Betrifft: nichts in dieser Sitzung.\n2. **QR-Code.** - A) so lassen: nur die Nummer. - B) Ticket: eine URL ➡️ **A**, mit dem Probedruck neu entscheiden.\nSTAND: x');
    const [f1, f2] = b?.art === 'frage' ? b.fragen : [];
    expect(f1).toMatchObject({ frage: '**#405 Lieferschein ohne Kommissionierung.** Er bucht ohne Fach.', empfehlung: 'C', betrifft: null });
    expect(f1.optionen).toEqual([
      { buchstabe: 'A', text: 'so lassen' },
      { buchstabe: 'B', text: 'Ticket: aus dem FIFO-Fach buchen' },
      { buchstabe: 'C', text: 'Ticket: erst nach der Kommissionierung' },
    ]);
    expect(f2.optionen.map((o) => o.buchstabe)).toEqual(['A', 'B']);
    expect(f2.empfehlung).toBe('A');
  });

  it('leaves a question alone that only mentions a letter', () => {
    const b = leseBlock('FLOTTE-FRAGE 5 tor\n1. Gilt Plan A) weiter? — Empfehlung: ja\nSTAND: x');
    expect(b?.art === 'frage' && b.fragen[0]).toMatchObject({ frage: 'Gilt Plan A) weiter?', optionen: [], empfehlung: 'ja' });
  });

  it('joins a question that runs over several lines', () => {
    const b = leseBlock('FLOTTE-FRAGE 5 nacharbeit\n1. Lange Frage\n   — Betrifft: p3 — Empfehlung: B\nSTAND: x');
    expect(b?.art === 'frage' && b.fragen[0]).toMatchObject({ frage: 'Lange Frage', betrifft: ['p3'], empfehlung: 'B' });
  });
});
