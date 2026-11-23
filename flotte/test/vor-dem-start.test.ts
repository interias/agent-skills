// #198: before a mission starts the driver reads its order edges and what it touches from the forge
// again; an edge or a collision added since the deployment began keeps it waiting with a reason.

import { describe, expect, it } from 'vitest';
import { fahre } from '../src/treiber/treiber.ts';
import { aufbau, drehbuch, ende, lauf } from './flotte-welt.ts';

const T = 30_000;
const fuer = (g: { eingabe: string }[], nr: number) => g.filter((x) => new RegExp(`^Flotte, Mission #${nr}\\b`).test(x.eingabe));
const modul = (nr: number) => `## Betroffene Module\n- m${nr}\n`;

describe('#198: vor dem Start prüfen', () => {
  it('a predecessor edge added while the deployment runs: the mission waits with the reason and starts no run', async () => {
    const bodies: Record<number, string> = { 3: modul(3), 4: modul(4) };
    // #3 stays at its PR: a person merges, and nobody does
    const t = aufbau({ bodies, adapter: 'merge: mensch', pr: () => ({ state: 'OPEN' }) });
    const melde = t.welt.melde;
    t.welt.melde = (zeile) => {
      melde(zeile);
      if (zeile === '#3 Lauf gestartet') bodies[4] = `> **Reihenfolge:** nach #3\n\n${modul(4)}`;
    };
    const buch = drehbuch([lauf(3, [{ warte: 300 }, { text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4], { obergrenze: 1, maxDauerMs: 3000 }), t.welt);
    expect(z.epics['3'].stufe).toBe('pr');
    expect(fuer(buch.gesehen(), 4)).toHaveLength(0);
    expect(z.epics['4']).toMatchObject({ stufe: 'wartend', notiz: 'wartet auf den Merge von #3' });
  }, T);

  it('the predecessor merged: the mission starts after it', async () => {
    const bodies: Record<number, string> = { 3: modul(3), 4: modul(4) };
    const t = aufbau({ bodies, adapter: 'merge: mensch', pr: (_nr, n) => ({ state: n < 2 ? 'OPEN' : 'MERGED' }) });
    const melde = t.welt.melde;
    t.welt.melde = (zeile) => {
      melde(zeile);
      if (zeile === '#3 Lauf gestartet') bodies[4] = `> **Reihenfolge:** nach #3\n\n${modul(4)}`;
    };
    const buch = drehbuch([lauf(3, [{ warte: 300 }, { text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4], { obergrenze: 1 }), t.welt);
    expect(fuer(buch.gesehen(), 4)).toHaveLength(1);
    expect(z.epics['4'].stufe).toBe('fertig');
    const e = z.ereignisse.map((x) => `${x.epic ? `#${x.epic} ` : ''}${x.text}`);
    expect(e.indexOf('#4 Lauf gestartet')).toBeGreaterThan(e.findIndex((x) => /^#3 PR #13 gemergt/.test(x)));
  }, T);

  it('an exclusive collision with a running mission added meanwhile: the mission waits and starts no run', async () => {
    const bodies: Record<number, string> = { 3: modul(3), 4: modul(4), 5: modul(5) };
    const t = aufbau({ bodies });
    const melde = t.welt.melde;
    t.welt.melde = (zeile) => {
      melde(zeile);
      if (zeile === '#3 Lauf gestartet') bodies[5] = '## Betroffene Module\n- m5 (Exklusiv)\n';
    };
    // #4 ends at once and frees its place; #3 runs on
    const buch = drehbuch([lauf(3, [{ warte: 2500 }, { text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }]), lauf(5, [{ text: ende(5, 15) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4, 5], { obergrenze: 2, maxDauerMs: 2000 }), t.welt);
    expect(fuer(buch.gesehen(), 4)).toHaveLength(1);
    expect(fuer(buch.gesehen(), 5)).toHaveLength(0);
    expect(z.epics['5'].stufe).toBe('wartend');
  }, T);
});
