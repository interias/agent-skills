// #199: after a limit the driver requeues the mission itself at the reset time + 2 min, moves to another
// free account on a 429, and a blocked mission names its cause in the logbook and on the bridge.

import { describe, expect, it } from 'vitest';
import { fahre } from '../src/treiber/treiber.ts';
import { limitReset } from '../src/werkzeuge/lauf.ts';
import { aufbau, drehbuch, ende, lauf } from './flotte-welt.ts';

const T = 30_000;
const fuer = <G extends { eingabe: string }>(g: G[], nr: number) => g.filter((x) => new RegExp(`^Flotte, Mission #${nr}\\b`).test(x.eingabe));
const uhr = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
const texte = (z: { ereignisse: { epic: number | null; text: string }[] }) => z.ereignisse.map((e) => `${e.epic ? `#${e.epic} ` : ''}${e.text}`);

describe('#199: die Reset-Zeit aus der Limitmeldung', () => {
  const jetzt = new Date(2026, 10, 23, 22, 10).getTime();
  it('reads the epoch of the old form and the clock time of the new ones, the next one after now', () => {
    expect(limitReset('Claude AI usage limit reached|1795400000', jetzt)).toBe(1795400000_000);
    expect(limitReset("You've hit your limit · resets 3am (Europe/Berlin)", jetzt)).toBe(new Date(2026, 10, 24, 3, 0).getTime());
    expect(limitReset('5-hour limit reached ∙ resets 11:30pm', jetzt)).toBe(new Date(2026, 10, 23, 23, 30).getTime());
    expect(limitReset("You've hit your weekly limit · resets Nov 26, 3am (Europe/Berlin)", jetzt)).toBe(new Date(2026, 10, 26, 3, 0).getTime());
    expect(limitReset('Claude usage limit reached.', jetzt)).toBeNull();
  });
});

describe('#199: nach einem Limit selbst neu einreihen', () => {
  it('a limit with a reset time: the mission waits until reset + 2 min, then continues by itself', async () => {
    const t = aufbau();
    // the reset lay 118 s ago: the mission is due again 2 s after the limit
    const reset = Math.floor(Date.now() / 1000) - 118;
    const buch = drehbuch([lauf(3, [{ text: `Claude AI usage limit reached|${reset}`, fehler: true }], 1), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 15_000 }), t.welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe).toHaveLength(2);
    expect(laeufe[1].args).toEqual(expect.arrayContaining(['--resume', 's3']));
    const e = texte(z);
    expect(e.some((x) => x.startsWith('#3 Limit erreicht') && x.includes(`reiht sich um ${uhr((reset + 120) * 1000)} selbst wieder ein`))).toBe(true);
    expect(e).toContain('#3 Reset des Limits vorbei: die Mission reiht sich selbst wieder ein');
    expect(z.epics['3']).toMatchObject({ stufe: 'fertig', limitBis: null });
  }, T);

  it('before the reset nothing starts on the mission, even when the account looks green', async () => {
    const t = aufbau();
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const buch = drehbuch([lauf(3, [{ text: `Claude AI usage limit reached|${reset}`, fehler: true }], 1), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 3000 }), t.welt);
    expect(fuer(buch.gesehen(), 3)).toHaveLength(1);
    expect(z.epics['3'].limitBis).toBe(new Date((reset + 120) * 1000).toISOString());
    expect(z.epics['3'].notiz).toMatch(/^wartet bis \d\d:\d\d \(Reset des Limits \+ 2 min\)/);
    expect(z.epics['3'].stufe).toBe('laeuft');
  }, T);

  it('a limit and a denial in the same turn is a limit, not blocked by the denial (#114)', async () => {
    const t = aufbau();
    const reset = Math.floor(Date.now() / 1000) - 118;
    const buch = drehbuch([lauf(3, [{ text: `Claude AI usage limit reached|${reset}`, fehler: true, verweigert: [{ tool_name: 'Bash', tool_use_id: 'x1' }] }], 1), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 15_000 }), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(texte(z).some((x) => /blockiert/.test(x))).toBe(false);
  }, T);
});

describe('#199: 429 wechselt das Konto', () => {
  it('a 429 moves the mission to another free account of the list instead of starting again at once', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1] });
    const [k1, k2] = t.konten;
    const buch = drehbuch([lauf(3, [{ text: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit"}}', fehler: true }], 1), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [k1, k2] }), t.welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe.map((l) => l.konto)).toEqual([k1, k2]);
    // a session lives in its account: on the other one the run starts anew
    expect(laeufe[1].args).not.toContain('--resume');
    expect(texte(z)).toContain('#3 429 (Anfragen gedrosselt) auf Konto 1: weiter auf Konto 2');
    expect(z.epics['3']).toMatchObject({ stufe: 'fertig', konto: k2, neustarts: 0 });
  }, T);

  it('two throttled accounts never hand the mission back and forth: after the second 429 it waits', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1] });
    const [k1, k2] = t.konten;
    const drossel = { text: 'API Error: 429 rate_limit_error', fehler: true };
    const buch = drehbuch([lauf(3, [drossel], 1), lauf(3, [drossel], 1), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [k1, k2], maxDauerMs: 3000 }), t.welt);
    expect(fuer(buch.gesehen(), 3).map((l) => l.konto)).toEqual([k1, k2]);
    expect(texte(z)).toContain('#3 429 (Anfragen gedrosselt) auf Konto 2, kein anderes Konto frei: die Mission wartet 5 min');
  }, T);

  it('a 429 without another free account: the mission waits on its account, no start within the same tick', async () => {
    const t = aufbau({ verbrauch: [0.1] });
    const [k1] = t.konten;
    const buch = drehbuch([lauf(3, [{ text: 'API Error: 429 rate_limit_error', fehler: true }], 1), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [k1], maxDauerMs: 3000 }), t.welt);
    expect(fuer(buch.gesehen(), 3)).toHaveLength(1);
    expect(texte(z)).toContain('#3 429 (Anfragen gedrosselt) auf Konto 1, kein anderes Konto frei: die Mission wartet 5 min');
    expect(z.epics['3'].stufe).toBe('laeuft');
  }, T);
});

describe('#199: blockiert nennt die Ursache', () => {
  it('a denial without a block: cause Erlaubnis on the bridge (notiz) and in the logbook', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: 'mitten drin', verweigert: [{ tool_name: 'Bash', tool_use_id: 'x1' }] }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 3000 }), t.welt);
    expect(z.epics['3'].stufe).toBe('blockiert');
    expect(z.epics['3'].notiz).toMatch(/^Ursache Erlaubnis: Erlaubnis verweigert: Bash/);
    // the bridge shows the cause before the reason (bruecke.test.ts, #28)
    expect(z.epics['3']).toMatchObject({ haltUrsache: 'Erlaubnis', haltGrund: expect.stringMatching(/^Erlaubnis verweigert: Bash/) });
    expect(t.p.kommentare.some((k) => k.nr === z.logbuch && /Mission #3 blockiert, Ursache Erlaubnis: Erlaubnis verweigert: Bash/.test(k.text))).toBe(true);
  }, T);

  it('a start without a result twice: cause anderes', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [], 1)]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 5000 }), t.welt);
    expect(z.epics['3'].stufe).toBe('blockiert');
    expect(z.epics['3'].notiz).toMatch(/^Ursache anderes: Start ohne Ergebnis nach zwei Neustarts/);
    // the bridge shows the cause before the reason (bruecke.test.ts, #28)
    expect(z.epics['3'].haltUrsache).toBe('anderes');
    expect(t.p.kommentare.some((k) => k.nr === z.logbuch && /Mission #3 blockiert, Ursache anderes/.test(k.text))).toBe(true);
  }, T);
});
