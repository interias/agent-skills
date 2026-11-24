// A stopped driver is no work: the gap between its last save and the next start becomes a pause of the started
// missions, from their last own activity on (stillstandEintragen in treiber.ts).
import { describe, expect, it } from 'vitest';
import { STILLSTAND_AB_MS, stillstandEintragen, type FlottenEpic } from '../src/treiber/treiber.ts';

const H = 3600_000;
const T0 = Date.parse('2026-11-23T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const epic = (nr: number, extra: Partial<FlottenEpic> = {}): FlottenEpic => ({ nr, gestartetAm: iso(T0 - 10 * H), ...extra }) as FlottenEpic;

describe('Stillstand des Treibers zählt als Pause', () => {
  it('a started mission without activity gets the whole gap as a pause', () => {
    const ep = epic(1);
    expect(stillstandEintragen([ep], iso(T0), T0 + 30 * H, () => null)).toEqual([1]);
    expect(ep.halte).toEqual([{ art: 'pause', von: iso(T0), bis: iso(T0 + 30 * H) }]);
  });

  it('a run that worked on without the driver: the pause starts at its last activity', () => {
    const ep = epic(2);
    stillstandEintragen([ep], iso(T0), T0 + 30 * H, () => T0 + 2 * H);
    expect(ep.halte?.[0].von).toBe(iso(T0 + 2 * H));
  });

  it('a restart within minutes, a finished, given up or not started mission, and an open held span stay untouched', () => {
    const kurz = epic(3);
    expect(stillstandEintragen([kurz], iso(T0), T0 + STILLSTAND_AB_MS - 1, () => null)).toEqual([]);
    const fertig = epic(4, { endeAm: iso(T0 - H) });
    const aufgegeben = epic(5, { aufgegebenAm: iso(T0 - H) });
    const neu = epic(6, { gestartetAm: null });
    const offen = epic(7, { halte: [{ art: 'limit', von: iso(T0 - H), bis: null }] });
    expect(stillstandEintragen([fertig, aufgegeben, neu, offen], iso(T0), T0 + 30 * H, () => null)).toEqual([]);
    expect(offen.halte).toHaveLength(1);
    expect(fertig.halte).toBeUndefined();
  });

  it('activity up to shortly before the start is no stop; a state without stand changes nothing', () => {
    const ep = epic(8);
    expect(stillstandEintragen([ep], iso(T0), T0 + 30 * H, () => T0 + 30 * H - 60_000)).toEqual([]);
    expect(stillstandEintragen([ep], undefined, T0 + 30 * H, () => null)).toEqual([]);
  });
});
