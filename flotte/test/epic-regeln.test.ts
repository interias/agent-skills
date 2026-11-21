// The pure rules of `flotte epic` (src/epic/regeln.ts) that no script of #65 pins on its own.

import { describe, expect, it } from 'vitest';
import { bewerteAufruf, endeBlock, hoeher, nachpruefung, wahl } from '../src/epic/regeln.ts';
import { pruefeAusgabe, type Paket } from '../src/epic/schema.ts';
import { neuerLauf, neuesPaket, paketBranch } from '../src/epic/zustand.ts';
import { leseBlock } from '../src/werkzeuge/bloecke.ts';
import type { LaufErgebnis } from '../src/werkzeuge/lauf.ts';

const paket = (nr: string, o: Partial<Paket> = {}): Paket => ({ nr, titel: nr, klasse: 'standard', abnahme: ['a'], decisions: [], dateien: [], nach: [], kollision: [], exklusiv: false, ...o });

function lauf(pakete: Paket[]) {
  const z = neuerLauf(69);
  z.schnitt.ergebnis = { version: 1, pakete, tor: [] };
  for (const p of pakete) z.pakete[p.nr] = neuesPaket(p);
  return z;
}

const ergebnis = (o: Partial<LaufErgebnis>): LaufErgebnis => ({ sitzung: 's', code: 0, leerlauf: false, ergebnisse: [{ text: 'fertig', istFehler: false, grund: null, verweigert: [] }], text: 'fertig', verweigert: [], sperren: [], verbrauch: null, strukturiert: null, fehler: null, dauerMs: 0, stderr: '', ...o });

describe('flotte epic, Regeln', () => {
  it('the window: most unlocked successors first, a tie goes to the smaller number', () => {
    const z = lauf([paket('7'), paket('3'), paket('5'), paket('8', { nach: ['7'] }), paket('9', { nach: ['7'] }), paket('6', { nach: ['5'] })]);
    expect(wahl(z, 1)).toEqual(['7']);
    expect(wahl(z, 3)).toEqual(['7', '5', '3']);
    // a successor that still waits for another predecessor is not unlocked
    const y = lauf([paket('1'), paket('2'), paket('4', { nach: ['2', '1'] }), paket('3', { nach: ['2'] })]);
    expect(wahl(y, 1)).toEqual(['2']);
  });

  it('the ladder ends at urteil-hoch', () => {
    expect(['mechanisch', 'standard', 'urteil', 'urteil-hoch'].map((s) => hoeher(s as never))).toEqual(['standard', 'urteil', 'urteil-hoch', 'urteil-hoch']);
  });

  it('4c: new lint findings in a changed file are a finding, untouched files and old findings are not', () => {
    const basis = [{ name: 's', dateien: 1, tests: 2, rot: [] }];
    const n = nachpruefung({ basis, lauf: basis, beruehrt: ['a.ts', 'b.ts'], einzeln: {}, basisLint: { 'a.ts': 1, 'c.ts': 0 }, lint: { 'a.ts': 1, 'b.ts': 2, 'c.ts': 5 } });
    expect(n).toEqual({ ok: false, befunde: ['Lint: b.ts hat 2 Befunde, vorher 0'], lastflakes: [] });
    expect(nachpruefung({ basis, lauf: [], beruehrt: [], einzeln: {}, basisLint: {}, lint: {} }).befunde).toEqual(['Suite s fehlt im Volllauf']);
  });

  it('a call: denials before everything, an account limit waits, a crash is no invalid output', () => {
    expect(bewerteAufruf('implementer', ergebnis({ verweigert: [{ tool_name: 'Bash' }], fehler: 'exit', code: 1 })).art).toBe('verweigert');
    expect(bewerteAufruf('implementer', ergebnis({ ergebnisse: [{ text: "You've hit your limit · resets 3pm", istFehler: true, grund: null, verweigert: [] }], code: 1, fehler: 'exit' })).art).toBe('konto');
    expect(bewerteAufruf('implementer', ergebnis({ fehler: 'kein_ergebnis', ergebnisse: [] })).art).toBe('abgebrochen');
    expect(bewerteAufruf('reviewer', ergebnis({ strukturiert: { version: 1, befunde: [{ gruppe: 'blocker' }], strukturell: false, schnittstelle: '', selbstkorrekturen: [] } }))).toEqual({ art: 'ungueltig', fehler: 'befunde fehlt oder hat eine Gruppe außer muss, sollte, kann' });
  });

  it('the cut: a package without acceptance list is invalid', () => {
    expect(pruefeAusgabe('schnitt', { version: 1, pakete: [paket('1', { abnahme: [] })], tor: [] })).toBe('pakete[0] hat keine Abnahmeliste');
    expect(pruefeAusgabe('konflikt', { version: 1, ergebnis: 'geloest', begruendung: 'x' })).toBeNull();
  });

  it('the cut: edges to unknown packages, to itself, doubled numbers and cycles over hard edges are invalid', () => {
    const schnitt = (pakete: Paket[]) => pruefeAusgabe('schnitt', { version: 1, pakete, tor: [] });
    expect(schnitt([paket('1', { nach: ['99'] })])).toBe('pakete 1: nach nennt das unbekannte Paket 99');
    expect(schnitt([paket('1'), paket('2', { kollision: ['98'] })])).toBe('pakete 2: kollision nennt das unbekannte Paket 98');
    expect(schnitt([paket('1', { nach: ['1'] })])).toBe('pakete 1: nach nennt sich selbst');
    expect(schnitt([paket('1'), paket('1')])).toBe('eine Paketnummer steht doppelt');
    expect(schnitt([paket('1', { nach: ['3'] }), paket('2', { nach: ['1'] }), paket('3', { nach: ['2'] })])).toBe('Zyklus über harte Kanten: 1 → 3 → 2 → 1');
    // counter-check: a diamond is no cycle, collisions both ways are fine
    expect(schnitt([paket('1'), paket('2', { nach: ['1'], kollision: ['3'] }), paket('3', { nach: ['1'], kollision: ['2'] }), paket('4', { nach: ['2', '3'] })])).toBeNull();
  });

  it('branch names and the end block in the form the driver reads', () => {
    expect(paketBranch({ nr: '69-p2', titel: 'Zustand: Größe & Übergänge prüfen jetzt' })).toBe('agent/69-p2-zustand-groesse-uebergaenge-pruefen');
    expect(leseBlock(endeBlock(69, 'https://github.com/o/r/pull/7', 'fertig', '- nichts'))).toEqual({ art: 'ende', epic: 69, pr: 7, prUrl: 'https://github.com/o/r/pull/7', offen: '- nichts' });
  });
});
