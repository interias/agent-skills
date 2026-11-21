// Sparpaket, run board off: under the driver the bridge shows the state, so every order that starts
// /epic or /epic-nacharbeit tells the run to build no Lauftafel.

import { describe, expect, it } from 'vitest';
import { fahre, TAFEL_AUS } from '../src/treiber/treiber.ts';
import { aufbau, drehbuch, ende, lauf } from './flotte-welt.ts';

describe('Lauftafel aus unter dem Treiber', () => {
  it('the start order and the order for the follow-up work both switch the board off', async () => {
    const t = aufbau({ pr: (_nr, n) => ({ state: n < 3 ? 'OPEN' : 'MERGED' }) });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13, '- ein offener Punkt') }]), lauf(3, [{ text: ende(3, 13) }])]);
    await fahre(t.einstellung(buch, [3], { maxDauerMs: 8000 }), t.welt);
    const auftraege = buch.gesehen().map((g) => g.eingabe || g.args.join(' '));
    expect(auftraege[0]).toMatch(/Rufe den Skill epic mit #3/);
    expect(auftraege.find((a) => /epic-nacharbeit/.test(a))).toBeDefined();
    for (const a of auftraege) expect(a).toContain(TAFEL_AUS);
  }, 30_000);
});
