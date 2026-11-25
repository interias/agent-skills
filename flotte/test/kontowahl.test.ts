// Tag P: the driver evens out the use of the accounts, the largest lead in the weekly window first.

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grund, rangfolge, vorsprung } from '../src/treiber/kontowahl.ts';
import { fahre } from '../src/treiber/treiber.ts';
import type { Bewertung } from '../src/werkzeuge/verbrauch.ts';
import { admiral, aufbau, drehbuch, ende, frage, lauf } from './flotte-welt.ts';

const H = 3_600_000;
const jetzt = Date.UTC(2026, 10, 25, 8, 0);
/** a measured account: used points of the week, days until its reset, used points of the 5-hour window */
const mess = (woche: number | null, tage = 3.5, fuenf = 10): Bewertung => ({
  stufe: 'gruen',
  grund: '',
  obergrenze: 4,
  fuenf: { verbraucht: fuenf, hochrechnung: null, reset: new Date(jetzt + 2 * H).toISOString() },
  sieben: woche === null ? null : { verbraucht: woche, hochrechnung: null, reset: new Date(jetzt + tage * 24 * H).toISOString() },
  alterMin: 1,
});

function reihe(b: Record<string, Bewertung | undefined>, laeufe: Record<string, number> = {}, missionen: Record<string, number> = {}): string[] {
  const bisher = (x: string, y: string) => (laeufe[x] ?? 0) - (laeufe[y] ?? 0) || (missionen[x] ?? 0) - (missionen[y] ?? 0);
  return rangfolge(Object.keys(b), (k) => b[k], jetzt, bisher);
}

describe('Tag P: Vorsprung im Wochenfenster', () => {
  it('is the share of the limit left minus the share of the time left until its reset', () => {
    // 6 % used, half the week left: 94 − 50
    expect(vorsprung(mess(6, 3.5), jetzt)).toBe(44);
    // 30 % used, half the week left: 70 − 50
    expect(vorsprung(mess(30, 3.5), jetzt)).toBe(20);
    // ahead of the time: 80 % used, a day left
    expect(vorsprung(mess(80, 1), jetzt)).toBe(6);
    expect(vorsprung(mess(80, 6), jetzt)).toBe(-66);
  });

  it('a weekly window reset since the measurement has started over; without a weekly window there is no value', () => {
    expect(vorsprung(mess(90, -1), jetzt)).toBe(0);
    expect(vorsprung(mess(null), jetzt)).toBeNull();
    expect(vorsprung(undefined, jetzt)).toBeNull();
    // a measured usage above 100 % stays within the range the bridge takes
    expect(vorsprung(mess(150, 6), jetzt)).toBe(-100);
  });

  it('names the reason in one sentence', () => {
    expect(grund('Konto 2', mess(6, 3.5), jetzt)).toBe('Konto 2: 44 Punkte Vorsprung im Wochenfenster');
    expect(grund('Konto 3', mess(80, 6), jetzt)).toBe('Konto 3: 66 Punkte Rückstand im Wochenfenster');
    expect(grund('Konto 1', mess(null), jetzt)).toBe('Konto 1: kein Messwert im Wochenfenster, gewählt nach Zahl der Läufe');
  });
});

describe('Tag P: Rangfolge der Konten', () => {
  it('the account with the larger lead wins despite more runs', () => {
    expect(reihe({ a: mess(30), b: mess(6) }, { b: 2 }, { b: 3 })).toEqual(['b', 'a']);
  });

  it('a tie within 5 points goes to more room in the 5-hour window', () => {
    expect(reihe({ a: mess(30, 3.5, 50), b: mess(34, 3.5, 20) })).toEqual(['b', 'a']);
  });

  it('a tie in both windows goes to the rule so far: fewer runs, then fewer missions', () => {
    expect(reihe({ a: mess(30), b: mess(32) }, { a: 1 })).toEqual(['b', 'a']);
    expect(reihe({ a: mess(30), b: mess(30) }, {}, { a: 2, b: 1 })).toEqual(['b', 'a']);
  });

  it('just outside the tie the lead decides, whatever the 5-hour window says', () => {
    expect(reihe({ a: mess(30, 3.5, 90), b: mess(36, 3.5, 0) })).toEqual(['a', 'b']);
  });

  it('accounts without a value come last, among themselves by the rule so far', () => {
    expect(reihe({ x: undefined, y: mess(null), a: mess(90, 1) }, { x: 1 })).toEqual(['a', 'y', 'x']);
  });

  it('the order does not depend on the order of the list', () => {
    const b = { a: mess(30), b: mess(33, 3.5, 5), c: mess(36), d: mess(10) };
    const erwartet = reihe(b);
    expect(rangfolge(['d', 'c', 'b', 'a'], (k) => b[k as keyof typeof b], jetzt, () => 0)).toEqual(erwartet);
    expect(erwartet).toEqual(['d', 'b', 'a', 'c']);
  });
});

describe('Tag P: der Treiber wählt nach der Rangfolge', () => {
  const T = 30_000;
  const texte = (z: { ereignisse: { epic: number | null; text: string }[] }) => z.ereignisse.map((e) => `${e.epic ? `#${e.epic} ` : ''}${e.text}`);
  const missionsLaeufe = <G extends { eingabe: string }>(g: G[]) => g.filter((x) => x.eingabe.startsWith('Flotte, Mission #3'));

  it('a mission starts on the account with the larger weekly lead and names why', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1], woche: [0.6, 0.1] });
    const [, k2] = t.konten;
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(missionsLaeufe(buch.gesehen()).map((l) => l.konto)).toEqual([k2]);
    expect(texte(z).some((x) => /^#3 Start auf Konto 2: \d+ Punkte Vorsprung im Wochenfenster$/.test(x))).toBe(true);
  }, T);

  it('a yellow or red account never takes the mission, however large its lead (inactive: below)', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.7, 0.95], woche: [0.6, 0.1, 0.1] });
    const [k1] = t.konten;
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(missionsLaeufe(buch.gesehen()).map((l) => l.konto)).toEqual([k1]);
    expect(texte(z).some((x) => /^#3 Start auf Konto 1: \d+ Punkte Rückstand im Wochenfenster$/.test(x))).toBe(true);
  }, T);

  it('a deactivated account takes nothing, however large its lead: no start, no move after a 429, no admiral call', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.1, 0.95], woche: [0.6, 0.1, 0.6, 0.1] });
    const [k1, aus, k3, admiralKonto] = t.konten;
    const heim = mkdtempSync(join(tmpdir(), 'flotte-heim-'));
    const datei = join(heim, '.claude', 'flotte', 'konten.json');
    mkdirSync(join(heim, '.claude', 'flotte'), { recursive: true });
    writeFileSync(datei, JSON.stringify([k1, aus, k3].map((k, i) => ({ nr: String(i + 1), ordner: k, name: `Konto ${i + 1}`, farbe: '#112233', aktiv: k !== aus }))));
    t.welt.konten = { datei, heim, terminal: () => {} };
    const buch = drehbuch([lauf(3, [{ text: 'API Error: 429 rate_limit_error', fehler: true }], 1), lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [k1, aus, k3], admiralKonto }), t.welt);
    const g = buch.gesehen();
    expect(missionsLaeufe(g)[0].konto).toBe(k1);
    expect(missionsLaeufe(g)[1].konto).toBe(k3);
    expect(g.filter((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL')).map((x) => x.konto)).toEqual([k3]);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('after a 429 the mission moves by the same order, not to the next account of the list', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.1], woche: [0.1, 0.6, 0.1] });
    const [k1, , k3] = t.konten;
    const buch = drehbuch([lauf(3, [{ text: 'API Error: 429 rate_limit_error', fehler: true }], 1), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(missionsLaeufe(buch.gesehen()).map((l) => l.konto)).toEqual([k1, k3]);
    expect(texte(z)).toContain('#3 429 (Anfragen gedrosselt) auf Konto 1: weiter auf Konto 3');
  }, T);

  it('a red admiral account moves the admiral by the same order', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.95], woche: [0.6, 0.1, 0.1] });
    const [k1, k2, admiralKonto] = t.konten;
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [k1, k2], admiralKonto }), t.welt);
    expect(buch.gesehen().filter((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL')).map((x) => x.konto)).toEqual([k2]);
    expect(texte(z)).toContain('#3 Admiral-Konto rot: der Admiral weicht auf Konto 2 aus');
  }, T);
});
