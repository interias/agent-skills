// #243 in the driver: an unknown cause summarized by the cheapest model (a stand-in here), the issue comment of a
// halt and of a question in the new form, "Dein Schritt bald" from a decision of the admiral, and the stage of the
// admiral's account in the logbook only when it changes.

import { describe, expect, it } from 'vitest';
import { fahre } from '../src/treiber/treiber.ts';
import { admiral, aufbau, drehbuch, frage, lauf } from './flotte-welt.ts';

const T = 30_000;

/** a run the driver ends before it works: tools it must not have (an unknown cause for the catalog) */
const fremdeWerkzeuge = (nr: number) => ({ ...lauf(nr, [{ text: 'nichts' }]), werkzeuge: ['Bash', 'mcp__fremd__x'] });
/** the stand-in of the summary call: its structured answer */
const zusammenfassung = (antwort: unknown) => ({ wenn: '^FLOTTE-URSACHE', schritte: [{ zeile: { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: antwort } }] });

describe('an unknown cause, summarized by the model', () => {
  it('the summary replaces the catalog\'s plain line, marked as summarized; the comment waits for it and begins with the three lines', async () => {
    const t = aufbau();
    const buch = drehbuch([fremdeWerkzeuge(3), zusammenfassung({ kurz: 'Der Lauf hatte ein fremdes Werkzeug und wurde beendet.', wer: 'du', warum: 'die Flotte startet ihn so nicht', schritt: 'MCP-Server aus dem Konto nehmen, dann neu einreihen.' })]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].stufe).toBe('blockiert');
    expect(z.epics['3'].ursache).toMatchObject({ art: 'unbekannt', quelle: 'zusammengefasst', kurz: 'Der Lauf hatte ein fremdes Werkzeug und wurde beendet.', wer: 'du', schritt: 'MCP-Server aus dem Konto nehmen, dann neu einreihen.' });
    const aufruf = buch.gesehen().find((g) => g.eingabe.startsWith('FLOTTE-URSACHE'))!;
    expect(aufruf.eingabe).toMatch(/Lauf mit verbotenen Werkzeugen: mcp__fremd__x/);
    expect(aufruf.args).toContain('--json-schema');
    expect(aufruf.args[aufruf.args.indexOf('--model') + 1]).toBe('haiku');
    const k = t.p.kommentare.filter((x) => x.nr === 3 && /^\*\*Braucht dich/.test(x.text));
    expect(k).toHaveLength(1);
    expect(k[0].text.split('\n').slice(0, 5)).toEqual(['**Braucht dich · Mission blockiert (Flotte, Treiber)**', '', '**Was:** Der Lauf hatte ein fremdes Werkzeug und wurde beendet.', '**Wer:** Du · die Flotte startet ihn so nicht', '**Schritt:** MCP-Server aus dem Konto nehmen, dann neu einreihen.']);
    expect(k[0].text).toMatch(/<details><summary>Details<\/summary>\n\n```\nLauf mit verbotenen Werkzeugen[\s\S]*<\/details>$/);
  }, T);

  it('an answer that breaks the rules (a line too long) keeps the catalog\'s line', async () => {
    const t = aufbau();
    const buch = drehbuch([fremdeWerkzeuge(3), zusammenfassung({ kurz: 'x'.repeat(120), wer: 'du', warum: 'w', schritt: 's' })]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].ursache).toMatchObject({ art: 'unbekannt', quelle: 'katalog' });
    expect(z.epics['3'].ursache!.kurz.length).toBeLessThanOrEqual(90);
    expect(z.ereignisse.some((e) => /Ursache nicht zusammengefasst/.test(e.text))).toBe(true);
  }, T);
});

describe('the comments of "Braucht dich"', () => {
  it('a question for the person: the three lines first, the run\'s short line as what, situation and command folded', async () => {
    const t = aufbau();
    const block = frage(3, 'tor', [{ betrifft: 'Lauf' }]).replace('Regel/Quelle: Skill', 'Regel/Quelle: Skill — Kurz: Vorsichtig oder riskant?');
    const buch = drehbuch([lauf(3, [{ text: block }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 1500 }), t.welt);
    expect(z.fragen[0].kurz).toBe('Vorsichtig oder riskant?');
    const k = t.p.kommentare.find((x) => x.text.startsWith('**FRAGE AN DEN MENSCHEN'))!.text.split('\n');
    expect(k.slice(0, 5)).toEqual(['**FRAGE AN DEN MENSCHEN (Flotte) · Frage 1**', '', '**Was:** Vorsichtig oder riskant?', '**Wer:** Du · der Admiral legt sie dir vor', '**Schritt:** In der Brücke antworten; Empfehlung: A · vorsichtig.']);
    expect(k.join('\n')).toMatch(/<details><summary>Details<\/summary>\n\nFrage: Frage 1 zu #3\?\nLage: Sachverhalt[\s\S]*Antworten, im Repository: `flotte antworten \. 3 1 "<Antwort>"`\n\n<\/details>$/);
  }, T);
});

describe('Dein Schritt bald', () => {
  it('a decision of the admiral that needs a step of the person later: a step in the state and on the decision\'s comment', async () => {
    const t = aufbau();
    const antwort = { nr: 1, antwort: 'A', beim_menschen: false, mensch_spaeter: '#543 dockt erst an, wenn ADR-0013 auf main liegt.' };
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [antwort]), lauf(3, [{ text: 'weiter\n\nFLOTTE-ENDE 3 https://github.com/o/r/pull/13\n\n### Was das Epic offen lässt\nkeine' }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.bald).toEqual([expect.objectContaining({ epic: 3, kurz: '#543 dockt erst an, wenn ADR-0013 auf main liegt.', warum: 'Admiral zu Frage 1: Frage 1 zu #3?' })]);
    expect(t.p.kommentare.some((k) => k.nr === 3 && /^\*\*Entschieden von der Flotte[\s\S]*\nDein Schritt bald: #543 dockt erst an/.test(k.text))).toBe(true);
    expect(z.ereignisse.some((e) => e.epic === 3 && e.text === 'Dein Schritt bald: #543 dockt erst an, wenn ADR-0013 auf main liegt.')).toBe(true);
  }, T);
});

describe('the stage of the admiral\'s account in the logbook', () => {
  it('only on a change: a restart with the same yellow writes nothing new', async () => {
    const fragt = () => drehbuch([lauf(3, [{ warte: 300 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: 'x\n\nFLOTTE-ENDE 3 https://github.com/o/r/pull/13\n\n### Was das Epic offen lässt\nkeine' }])]);
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.4] });
    const admiralKonto = t.konten[2];
    await fahre(t.einstellung(fragt(), [3], { konten: [t.konten[0]], admiralKonto }), t.welt);
    const gelb = (k: { text: string }[]) => k.filter((x) => /Admiral-Konto gelb/.test(x.text)).length;
    expect(gelb(t.p.kommentare)).toBe(1);
    // the same deployment once more: still yellow, no second line
    const t2 = aufbau({ vorhanden: { repo: t.repo, konten: t.konten } });
    await fahre(t2.einstellung(drehbuch([]), [3], { konten: [t.konten[0]], admiralKonto, maxDauerMs: 1000 }), t2.welt);
    expect(gelb(t2.p.kommentare)).toBe(0);
  }, T);
});
