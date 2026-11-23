// Sparpaket, run board off: under the driver the bridge shows the state, so every order that starts
// /mission or /mission-nacharbeit tells the run to build no Lauftafel.

import { describe, expect, it } from 'vitest';
import { fahre, TAFEL_AUS } from '../src/treiber/treiber.ts';
import { aufbau, drehbuch, ende, lauf } from './flotte-welt.ts';

describe('Lauftafel aus unter dem Treiber', () => {
  it('the start order and the order for the follow-up work both switch the board off', async () => {
    const t = aufbau({ pr: (_nr, n) => ({ state: n < 3 ? 'OPEN' : 'MERGED' }) });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13, '- ein offener Punkt') }]), lauf(3, [{ text: ende(3, 13) }])]);
    await fahre(t.einstellung(buch, [3], { maxDauerMs: 8000 }), t.welt);
    const auftraege = buch.gesehen().map((g) => g.eingabe || g.args.join(' '));
    expect(auftraege[0]).toMatch(/Rufe den Skill mission mit #3/);
    expect(auftraege.find((a) => /mission-nacharbeit/.test(a))).toBeDefined();
    for (const a of auftraege) expect(a).toContain(TAFEL_AUS);
  }, 30_000);
});

describe('Grenze für Pakete je Epic im Auftrag (#60)', () => {
  it('the start order carries the limit: the default and a lowered value', async () => {
    for (const [wert, erwartet] of [[undefined, 3], [2, 2]] as const) {
      const t = aufbau({});
      const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
      await fahre({ ...t.einstellung(buch, [3], { maxDauerMs: 8000 }), ...(wert ? { paketeJeEpic: wert } : {}) }, t.welt);
      expect(buch.gesehen()[0].eingabe).toContain(`Auftrag: höchstens ${erwartet} Pakete gleichzeitig.`);
    }
  }, 30_000);
});
