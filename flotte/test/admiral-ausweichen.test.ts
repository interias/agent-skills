// #111: a red admiral account no longer sends the questions to the person. The admiral moves to
// another account of the fleet with room; without one the question block waits for a free account.

import { describe, expect, it } from 'vitest';
import { fahre } from '../src/treiber/treiber.ts';
import { schreibe as schreibeVerbrauch } from '../src/werkzeuge/verbrauch.ts';
import { admiral, aufbau, drehbuch, ende, frage, lauf, ping } from './flotte-welt.ts';

const T = 30_000;
const H = 3_600_000;
const texte = (z: { ereignisse: { epic: number | null; text: string }[] }) => z.ereignisse.map((e) => `${e.epic ? `#${e.epic} ` : ''}${e.text}`);
const anteil = (k: string, a: number) => schreibeVerbrauch(k, { zeit: Date.now(), fuenf: { anteil: a, reset: Date.now() + 3 * H }, sieben: { anteil: 0.1, reset: Date.now() + 5 * 24 * H } });
const gruen = (k: string) => anteil(k, 0.1);
// the run starts on a green account that turns red during its turn: no account of the fleet has room
const wirdRot = (t: ReturnType<typeof aufbau>, k: string) => {
  const melde = t.welt.melde;
  t.welt.melde = (zeile) => {
    melde(zeile);
    if (zeile.endsWith('Lauf gestartet')) anteil(k, 0.95);
  };
};
const fragtSpaet = () => drehbuch([lauf(3, [{ warte: 400 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
const anMenschen = (t: ReturnType<typeof aufbau>) => t.p.kommentare.filter((k) => k.text.startsWith('**FRAGE AN DEN MENSCHEN'));

describe('#111: Admiral-Konto rot', () => {
  it('another account green: the admiral call runs there (green before yellow), nothing goes to the person', async () => {
    const t = aufbau({ verbrauch: [0.4, 0.1, 0.95] });
    const [gelb, frei, admiralKonto] = t.konten;
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [gelb, frei], admiralKonto }), t.welt);
    const aufrufe = buch.gesehen().filter((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL'));
    expect(aufrufe.map((x) => x.konto)).toEqual([frei]);
    expect(texte(z)).toContain('#3 Admiral-Konto rot: der Admiral weicht auf Konto 2 aus');
    expect(z.fragen).toEqual([]);
    expect(anMenschen(t)).toEqual([]);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('no account green, one yellow: the admiral call runs on the yellow account', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.95] });
    const [konto, , admiralKonto] = t.konten;
    const melde = t.welt.melde;
    t.welt.melde = (zeile) => {
      melde(zeile);
      if (zeile.endsWith('Lauf gestartet')) anteil(konto, 0.4);
    };
    const z = await fahre(t.einstellung(fragtSpaet(), [3], { konten: [konto], admiralKonto }), t.welt);
    expect(texte(z)).toContain('#3 Admiral-Konto rot: der Admiral weicht auf Konto 1 aus');
    expect(z.fragen).toEqual([]);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('all red: no call and no question to the person; once an account is free the admiral is asked once', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.95] });
    const [konto, , admiralKonto] = t.konten;
    wirdRot(t, konto);
    const buch = fragtSpaet();
    const aufrufe = () => buch.gesehen().filter((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL'));
    let vorDemFreiwerden: number | null = null;
    let fragenVorher: number | null = null;
    const melde = t.welt.melde;
    t.welt.melde = (zeile) => {
      melde(zeile);
      if (!zeile.includes('wartet auf ein freies Konto')) return;
      setTimeout(() => {
        vorDemFreiwerden = aufrufe().length;
        fragenVorher = anMenschen(t).length;
        gruen(konto);
        gruen(admiralKonto);
      }, 400);
    };
    const z = await fahre(t.einstellung(buch, [3], { konten: [konto], admiralKonto }), t.welt);
    expect(vorDemFreiwerden).toBe(0);
    expect(fragenVorher).toBe(0);
    expect(aufrufe().map((x) => x.konto)).toEqual([admiralKonto]);
    expect(z.fragen).toEqual([]);
    expect(anMenschen(t)).toEqual([]);
    const e = texte(z);
    expect(e.indexOf('#3 Admiral-Konto rot, kein Konto mit Luft: der Frageblock wartet auf ein freies Konto')).toBeGreaterThanOrEqual(0);
    expect(e.indexOf('#3 Admiral-Konto hat Luft: der wartende Frageblock geht an den Admiral')).toBeGreaterThan(e.indexOf('#3 Admiral-Konto rot, kein Konto mit Luft: der Frageblock wartet auf ein freies Konto'));
    expect(z.epics['3']).toMatchObject({ stufe: 'fertig', wartendeFrage: null });
  }, T);

  it('without --admiral: the run account turns red during the turn, the admiral call runs on the green one', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1] });
    const [k1, k2] = t.konten;
    wirdRot(t, k1);
    const buch = fragtSpaet();
    const z = await fahre(t.einstellung(buch, [3], { konten: [k1, k2], maxDauerMs: 4000 }), t.welt);
    expect(z.epics['3'].konto).toBe(k1);
    expect(buch.gesehen().filter((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL')).map((x) => x.konto)).toEqual([k2]);
    expect(texte(z)).toContain('#3 Konto 1 rot: der Admiral weicht auf Konto 2 aus');
    expect(z.fragen).toEqual([]);
    expect(anMenschen(t)).toEqual([]);
  }, T);

  it('without --admiral: a block waiting for the stale run account gets it pinged, then asks there', async () => {
    const t = aufbau({ verbrauch: [0.1] });
    const [k1] = t.konten;
    wirdRot(t, k1);
    const melde = t.welt.melde;
    t.welt.melde = (zeile) => {
      melde(zeile);
      // the red value grows stale while the block waits: only a ping makes the account free again
      if (zeile.includes('wartet auf ein freies Konto')) schreibeVerbrauch(k1, { zeit: Date.now() - 40 * 60_000, fuenf: { anteil: 0.95, reset: Date.now() + 3 * H }, sieben: { anteil: 0.1, reset: Date.now() + 5 * 24 * H } });
    };
    const buch = drehbuch([lauf(3, [{ warte: 400 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), ping(0.1), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [k1], maxDauerMs: 8000 }), t.welt);
    expect(buch.gesehen().filter((x) => x.eingabe.startsWith('FLOTTE-PING')).map((x) => x.konto)).toContain(k1);
    expect(buch.gesehen().filter((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL')).map((x) => x.konto)).toEqual([k1]);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('the waiting block outlives a restart of the driver and is asked once after it', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.95] });
    const [konto, , admiralKonto] = t.konten;
    wirdRot(t, konto);
    const buch = fragtSpaet();
    const aufrufe = () => buch.gesehen().filter((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL'));
    const erst = await fahre(t.einstellung(buch, [3], { konten: [konto], admiralKonto, maxDauerMs: 1500 }), t.welt);
    // the stage stays (the bridge shows no wait for the person) and the run gets no turn meanwhile
    expect(erst.epics['3']).toMatchObject({ stufe: 'laeuft', notiz: 'Frageblock wartet auf ein freies Konto' });
    expect(erst.epics['3'].auftrag).toBeFalsy();
    expect(erst.epics['3'].wartendeFrage?.fragen.map((f) => f.nr)).toEqual([1]);
    expect(aufrufe()).toEqual([]);
    expect(buch.gesehen().filter((x) => x.eingabe.startsWith('Flotte, Mission #3'))).toHaveLength(1);
    expect(erst.fragen).toEqual([]);
    gruen(konto);
    gruen(admiralKonto);
    const z = await fahre(t.einstellung(buch, [3], { konten: [konto], admiralKonto }), t.welt);
    expect(aufrufe().map((x) => x.konto)).toEqual([admiralKonto]);
    expect(z.fragen).toEqual([]);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);
});

// #197: a stale value of the admiral account is measured again before the question block is routed;
// a failed measurement keeps the last known value with its age instead of red.
describe('#197: veralteter Verbrauchswert des Admiral-Kontos', () => {
  const alt = (k: string, a: number) => schreibeVerbrauch(k, { zeit: Date.now() - 40 * 60_000, fuenf: { anteil: a, reset: Date.now() + 3 * H }, sieben: { anteil: 0.1, reset: Date.now() + 5 * 24 * H } });
  // the admiral account's value is stale when the run's turn ends (no regular ping in between)
  const wirdAlt = (t: ReturnType<typeof aufbau>, k: string) => {
    const melde = t.welt.melde;
    t.welt.melde = (zeile) => {
      melde(zeile);
      if (/Zug zu Ende/.test(zeile)) alt(k, 0.1);
    };
  };
  // the calls up to the admiral's: the last two show what came right before him
  const reihe = (buch: ReturnType<typeof drehbuch>) => {
    const l = buch.gesehen().filter((x) => /^FLOTTE-(PING|ADMIRAL)/.test(x.eingabe)).map((x) => [/^FLOTTE-PING/.test(x.eingabe) ? 'PING' : 'ADMIRAL', x.konto]);
    return l.slice(0, l.findIndex((x) => x[0] === 'ADMIRAL') + 1);
  };

  it('stale, measured again green: the admiral answers on his own account, nothing waits', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1] });
    const [konto, admiralKonto] = t.konten;
    wirdAlt(t, admiralKonto);
    const buch = drehbuch([lauf(3, [{ warte: 400 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), ping(0.1), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [konto], admiralKonto }), t.welt);
    expect(reihe(buch).slice(-2)).toEqual([['PING', admiralKonto], ['ADMIRAL', admiralKonto]]);
    const e = texte(z);
    expect(e).toContain('#3 Verbrauch Admiral-Konto 40 min alt: vor dem Frageblock neu gemessen, gruen');
    expect(e.some((x) => /: der Admiral weicht auf Konto|wartet auf ein freies Konto/.test(x))).toBe(false);
    expect(z.fragen).toEqual([]);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('stale, measured again red: only the fresh red value moves the block (#111: to another account with room)', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1] });
    const [konto, admiralKonto] = t.konten;
    wirdAlt(t, admiralKonto);
    const buch = drehbuch([lauf(3, [{ warte: 400 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), ping(0.95), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [konto], admiralKonto }), t.welt);
    expect(reihe(buch).slice(-2)).toEqual([['PING', admiralKonto], ['ADMIRAL', konto]]);
    const e = texte(z);
    expect(e).toContain('#3 Verbrauch Admiral-Konto 40 min alt: vor dem Frageblock neu gemessen, rot');
    expect(e).toContain('#3 Admiral-Konto rot: der Admiral weicht auf Konto 1 aus');
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('stale, the measurement fails: the last known value counts with its age in the logbook, not red', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1] });
    const [konto, admiralKonto] = t.konten;
    wirdAlt(t, admiralKonto);
    const buch = drehbuch([lauf(3, [{ warte: 400 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), { wenn: '^FLOTTE-PING', schritte: [{ text: 'OK' }] }, admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [konto], admiralKonto }), t.welt);
    expect(reihe(buch).slice(-1)).toEqual([['ADMIRAL', admiralKonto]]);
    const zeile = /^Verbrauch Admiral-Konto: Messung gescheitert \(kein rate_limit_event\), es gilt der letzte bekannte Wert \(\d+(\.\d)? min alt\): gruen/;
    expect(z.ereignisse.some((x) => zeile.test(x.text))).toBe(true);
    expect(t.p.kommentare.some((k) => k.nr === z.logbuch && /Messung gescheitert .*letzte bekannte Wert \(\d+(\.\d)? min alt\)/.test(k.text))).toBe(true);
    expect(texte(z).some((x) => /: der Admiral weicht auf Konto|wartet auf ein freies Konto/.test(x))).toBe(false);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);
});
