// The measurement of a gate run of the driver: duration, and per context of the gate block its name,
// result, duration and whether the gate took the result from its cache (adapter key gate_cached).

import { describe, expect, it } from 'vitest';
import { cacheAnteil, gateForm, kontexteAus } from '../src/treiber/gate.ts';
import { dauerSekunden, gateKontext, zaehle } from '../src/epic/zaehlen.ts';
import { liesAdapter } from '../src/werkzeuge/belegung.ts';

const BLOCK = [
  '== Gate: Basis origin/main @ 80b0ca3, 14 geänderte Dateien (HEAD d38f3542)',
  '  alpha    grün            9:50',
  '  beta     grün            0:02  aus dem Cache: grün am 25.11.2026, 08:12 auf 1a2b3c4d (9:41), Eingaben unverändert',
  '  gamma    übersprungen          nicht berührt',
  '  delta    ROT            22:29  …',
  'Gate grün.',
].join('\n');

const form = (zusatz = '') => gateForm(liesAdapter(`---\nmerge: nach_gate\n${zusatz}---\n`));

describe('Andockmessung: die Kontexte des Andockblocks', () => {
  it('reads name, result and duration of each context, and the cache by gate_cached', () => {
    expect(kontexteAus(BLOCK, form("gate_cached: 'aus dem Cache'\n"))).toEqual([
      { name: 'alpha', ergebnis: 'gruen', dauerS: 590, cache: false },
      { name: 'beta', ergebnis: 'gruen', dauerS: 2, cache: true },
      { name: 'gamma', ergebnis: 'übersprungen', dauerS: null, cache: false },
      { name: 'delta', ergebnis: 'rot', dauerS: 1349, cache: false },
    ]);
  });

  it('without gate_cached there is no cache statement; the durations are measured all the same', () => {
    const k = kontexteAus(BLOCK, form());
    expect(k.map((x) => x.cache)).toEqual([null, null, null, null]);
    expect(k.map((x) => x.dauerS)).toEqual([590, 2, null, 1349]);
    expect(cacheAnteil(k)).toBeNull();
  });

  it('counts the cache share over the contexts that ran (green or red), not the skipped ones', () => {
    expect(cacheAnteil(kontexteAus(BLOCK, form('gate_cached: aus dem Cache\n')))).toEqual({ n: 1, m: 3 });
  });

  it('reads the block of this repository: seconds with a group separator (N0) and without', () => {
    const block = ['== Gate: Basis origin/main @ a7d3a91 (HEAD d9084a7c)', '  flotte   grün    1.558 s', '  bruecke  grün       42 s', '  pester   ROT    2,301 s', 'Gate ROT.'].join('\n');
    expect(kontexteAus(block, form())).toEqual([
      { name: 'flotte', ergebnis: 'gruen', dauerS: 1558, cache: null },
      { name: 'bruecke', ergebnis: 'gruen', dauerS: 42, cache: null },
      { name: 'pester', ergebnis: 'rot', dauerS: 2301, cache: null },
    ]);
  });

  it('a duration it cannot read is missing, nothing is guessed; a line that is no context is left out', () => {
    expect(dauerSekunden('9:50')).toBe(590);
    expect(dauerSekunden('1:02:03')).toBe(3723);
    expect(dauerSekunden('1.5 s')).toBe(1.5);
    expect(dauerSekunden('12 min')).toBeNull();
    expect(dauerSekunden('9:5')).toBeNull();
    expect(gateKontext('  x   grün   9:5')).toEqual({ name: 'x', ergebnis: 'gruen', dauerS: null, rest: '9:5' });
    expect(gateKontext('  rot: (fail) a > b')).toBeNull();
    expect(gateKontext('Gate grün.')).toBeNull();
    expect(kontexteAus('kein Block', form())).toEqual([]);
  });

  it('lines indented deeper than the first context line are detail, not contexts (review M2)', () => {
    const block = [
      '== Gate: Basis origin/main @ 80b0ca3, 14 geänderte Dateien (HEAD d38f3542)',
      '  alpha    grün            9:50',
      '    Gruppen: alle 11',
      '    Lose: 2',
      '    Los 1 (Testbett): grün 4:10',
      '    Log: C:/tmp/gate-alpha.log',
      '  beta     ROT             1:02  aus dem Cache: nein',
      '    Fehler im Testbett: x',
      '  gamma    übersprungen          nicht berührt',
      'Gate ROT.',
    ].join('\n');
    expect(kontexteAus(block, form()).map((k) => [k.name, k.ergebnis, k.dauerS])).toEqual([
      ['alpha', 'gruen', 590],
      ['beta', 'rot', 62],
      ['gamma', 'übersprungen', null],
    ]);
    // zaehle reads the same contexts: two that ran, the red one named
    expect(zaehle(block, 'pwsh -NoProfile -File ./gate.ps1', '/wt/a')).toEqual({ dateien: null, tests: 2, rot: [{ datei: 'beta', test: 'aus dem Cache: nein' }] });
  });

  it('caps what it keeps: at most 40 contexts, the cache pattern sees the first 500 characters of a line (review M3, K1)', () => {
    const viele = ['== Gate: Basis origin/main @ 80b0ca3 (HEAD d38f3542)', ...Array.from({ length: 60 }, (_, i) => `  k${i}  grün  0:01`), 'Gate grün.'].join('\n');
    expect(kontexteAus(viele, form())).toHaveLength(40);
    const lang = ['== Gate: Basis origin/main @ 80b0ca3 (HEAD d38f3542)', `  a  grün  0:01  ${'x'.repeat(600)} aus dem Cache`, 'Gate grün.'].join('\n');
    expect(kontexteAus(lang, form("gate_cached: 'aus dem Cache'\n"))[0].cache).toBe(false);
  });

  it('minutes and seconds above 59 are not guessed (review K3)', () => {
    expect(dauerSekunden('99:99')).toBeNull();
    expect(dauerSekunden('1:60:00')).toBeNull();
    expect(dauerSekunden('75:30')).toBe(4530);
  });

  it('an unreadable gate_cached pattern gives no cache statement and stops nothing', () => {
    const f = form("gate_cached: '(aus dem'\n");
    expect(f.cached).toBeNull();
    expect(kontexteAus(BLOCK, f).map((x) => x.cache)).toEqual([null, null, null, null]);
  });

  it('zaehle counts the same contexts as a suite: the block of this repository too', () => {
    const block = ['== Gate: Basis origin/main @ a7d3a91 (HEAD d9084a7c)', '  flotte   grün    1.558 s', '  pester   ROT       42 s', 'Gate ROT.'].join('\n');
    expect(zaehle(block, 'pwsh -NoProfile -File ./gate.ps1', '/wt/a')).toEqual({ dateien: null, tests: 2, rot: [{ datei: 'pester', test: 'rot' }] });
  });
});

describe('Andockmessung: alte und neue Adapter (Ausrollen)', () => {
  it('a key the driver does not know (gate_cached at an older driver, or any other) stops nothing', () => {
    const a = liesAdapter('---\nmerge: nach_gate\ngate_command: gate voll\ngate_cached: aus dem Cache\nirgendwas_neues: 1\n---\n');
    expect(a.gate_command).toBe('gate voll');
    expect(a.merge).toBe('nach_gate');
  });
});
