// #37: the Windows notification of "Braucht dich": once per event, several of one turn as one with their
// number, nothing again after a restart, off by default, and the PowerShell call it would make (never run here).
// #243: its content is the card's: short line and step with the missions it holds, a question with its recommendation.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aufruf, ereignisse, inhalt, TOAST_SKRIPT } from '../src/treiber/meldung.ts';
import { einstellungAus, fahre } from '../src/treiber/treiber.ts';
import { flotteDir } from '../src/werkzeuge/zustand.ts';
import { mainRot } from '../src/treiber/ursache.ts';
import { aufbau, drehbuch, lauf } from './flotte-welt.ts';

const T = 30_000;
const EPICS = [
  { nr: 3, titel: 'Werft zieht Stacks nach', stufe: 'laeuft' },
  { nr: 4, titel: 'Ein sehr langer Titel einer Mission, der weit über sechzig Zeichen hinausgeht und gekürzt wird', stufe: 'blockiert', haltZeit: '2026-11-23T10:00:00Z' },
  { nr: 5, titel: 'Aufgegeben', stufe: 'abgebrochen', haltZeit: '2026-11-23T09:00:00Z', aufgegebenAm: '2026-11-23T09:30:00Z' },
  { nr: 6, titel: 'Gemergt', stufe: 'gemergt' },
];
const FRAGE = { epic: 3, nr: 1, seit: '2026-11-23T10:05:00Z', frage: String.raw`Soll C:\Users\jemand\geheim.txt weg?`, lage: 'Transkript: /home/jemand/.ssh', empfehlung: 'B', optionen: [{ buchstabe: 'A', text: 'ja' }, { buchstabe: 'B', text: 'nein, behalten' }] };
const ROT = mainRot({ basis: 'main', fehler: { kontext: 'wurzel', test: 'tests/adr.test.mts', meldung: null, zeile: 'wurzel ROT' }, seit: '2026-11-23T09:50:00Z' });

describe('Windows-Meldung: Auslöser und Inhalt', () => {
  it('only "Braucht dich": the open question and the epic blocked, not the one given up, running or merged', () => {
    const e = ereignisse('interias/werft', [FRAGE], EPICS);
    expect(e.map((x) => x.schluessel.split(':')[0])).toEqual(['frage', 'blockade']);
    expect(new Set(e.map((x) => x.schluessel)).size).toBe(2);
    // blocked again later: a new event
    const wieder = ereignisse('interias/werft', [], [{ ...EPICS[1], haltZeit: '2026-11-23T11:00:00Z' }]);
    expect(wieder[0].schluessel).not.toBe(e[1].schluessel);
  });

  it('#243: one event per cause: the missions waiting for the red base together; what the fleet repairs itself rings nothing', () => {
    const e = ereignisse('interias/werft', [], [
      { nr: 548, titel: 'a', stufe: 'pr', ursache: ROT },
      { nr: 545, titel: 'b', stufe: 'pr', ursache: ROT },
      { nr: 546, titel: 'c', stufe: 'laeuft', ursache: { ...ROT, schluessel: 'konflikt:#546', art: 'konflikt', wer: 'flotte' } },
    ]);
    expect(e).toEqual([{ schluessel: 'ursache:interias/werft#main_rot:wurzel#2026-11-23T09:50:00Z', titel: 'main ist rot: tests/adr.test.mts scheitert in wurzel.', text: '→ main reparieren (tests/adr.test.mts in wurzel), dann „Erledigt“ · hält #548, #545' }]);
  });

  it('content: the short line and the step, a question with its recommendation; the project in the text; no path, no transcript', () => {
    const e = ereignisse('interias/werft', [FRAGE], [...EPICS, { nr: 7, titel: 'x', stufe: 'blockiert', haltZeit: 'h', ursache: { ...ROT, schluessel: 'ohne_ergebnis:#7', kurz: 'Der Lauf kam nach zwei Neustarts zu keinem Ergebnis.', schritt: 'Letzten Stand im Log ansehen, dann neu einreihen oder aufgeben.' } }]);
    expect(inhalt([e[0]], 'werft')).toEqual({ titel: 'Soll <pfad> weg?', text: '→ Empfohlen: B · nein, behalten · #3 (werft)' });
    expect(inhalt([e[2]], 'werft')).toEqual({ titel: 'Der Lauf kam nach zwei Neustarts zu keinem Ergebnis.', text: '→ Letzten Stand im Log ansehen, dann neu einreihen oder aufgeben · hält #7 (werft)' });
    // an older state without a cause: the title of the mission as before, cut for the notification
    expect(inhalt([e[1]], 'werft').titel).toBe(`${'Blockiert: Ein sehr langer Titel einer Mission, der weit über sechzig Zeichen hinausgeht und gekürzt wird'.slice(0, 89).trimEnd()}…`);
    const m = inhalt(e, 'werft');
    expect(m.titel).toBe('Braucht dich: 3 neue Meldungen (werft)');
    expect(m.text.split('\n')).toHaveLength(3);
    const alles = `${m.titel} ${m.text} ${e.map((x) => x.text).join(' ')}`;
    for (const verboten of ['geheim', 'Users', '.ssh', 'Transkript', 'interias', '\\']) expect(alles).not.toContain(verboten);
    // the short line of the run's question wins over the question
    expect(ereignisse('o/r', [{ ...FRAGE, kurz: 'Datei weg?' }], [])[0].titel).toBe('Datei weg?');
  });

  it('the call: Windows PowerShell with the fixed script encoded, title and text only in the environment', () => {
    const a = aufruf({ titel: "Braucht dich: x'; Remove-Item C:\\ #1", text: '$(Stop-Computer)' });
    expect(a.programm).toBe('powershell');
    expect(a.args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
    const skript = Buffer.from(a.args[5], 'base64').toString('utf16le');
    expect(skript).toBe(TOAST_SKRIPT);
    expect(skript).toContain('ToastNotificationManager');
    expect(skript).toContain('$env:FLOTTE_MELDUNG_TITEL');
    // no module: only what Windows brings along
    expect(skript).not.toMatch(/Import-Module|BurntToast|Install-/);
    expect(a.env).toEqual({ FLOTTE_MELDUNG_TITEL: "Braucht dich: x'; Remove-Item C:\\ #1", FLOTTE_MELDUNG_TEXT: '$(Stop-Computer)' });
  });

  it('the switch: --meldung an or aus, off by default', () => {
    const basis = ['repo', '--forge', 'o/r', '--konten', 'k1'];
    expect(einstellungAus(basis).meldung).toBe('aus');
    expect(einstellungAus([...basis, '--meldung', 'an']).meldung).toBe('an');
    expect(() => einstellungAus([...basis, '--meldung', 'laut'])).toThrow(/--meldung laut/);
  });
});

describe('Windows-Meldung im Treiber', () => {
  it('a blocked epic rings once; a restart of the driver rings nothing again', async () => {
    const t = aufbau({ titel: { 3: 'Werft zieht Stacks nach' } });
    await fahre(t.einstellung(drehbuch([lauf(3, [{ stderr: 'boom' }], 1)]), [3], { meldung: 'an' }), t.welt);
    expect(t.p.toasts).toHaveLength(1);
    expect(t.p.toasts[0].env).toEqual({ FLOTTE_MELDUNG_TITEL: 'Der Lauf kam nach zwei Neustarts zu keinem Ergebnis.', FLOTTE_MELDUNG_TEXT: '→ Letzten Stand im Log ansehen, dann neu einreihen oder aufgeben · hält #3 (r)' });
    expect(t.p.toasts[0].args).toContain('-EncodedCommand');
    const t2 = aufbau({ vorhanden: { repo: t.repo, konten: t.konten } });
    await fahre(t2.einstellung(drehbuch([]), [3], { meldung: 'an', maxDauerMs: 1000 }), t2.welt);
    expect(t2.p.toasts).toHaveLength(0);
  }, T);

  it('switch off: no call, the event is still noted, switching on later rings nothing old', async () => {
    const t = aufbau();
    const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ stderr: 'boom' }], 1)]), [3]), t.welt);
    expect(t.p.toasts).toHaveLength(0);
    expect(t.p.aufrufe.some((a) => a[0] === 'powershell')).toBe(false);
    expect(z.gemeldet).toHaveLength(1);
    const t2 = aufbau({ vorhanden: { repo: t.repo, konten: t.konten } });
    await fahre(t2.einstellung(drehbuch([]), [3], { meldung: 'an', maxDauerMs: 1000 }), t2.welt);
    expect(t2.p.toasts).toHaveLength(0);
  }, T);

  it('several events in one turn: one notification with their number', async () => {
    const t = aufbau();
    await fahre(t.einstellung(drehbuch([lauf(3, [{ stderr: 'boom' }], 1), lauf(4, [{ stderr: 'boom' }], 1)]), [3, 4]), t.welt);
    // both blocked with the switch off; the state forgets them, the next start finds both in its first turn
    const datei = join(flotteDir(t.repo), 'zustand.json');
    const z = JSON.parse(readFileSync(datei, 'utf8'));
    expect(Object.values(z.epics).map((e) => (e as { stufe: string }).stufe)).toEqual(['blockiert', 'blockiert']);
    delete z.gemeldet;
    writeFileSync(datei, JSON.stringify(z));
    const t2 = aufbau({ vorhanden: { repo: t.repo, konten: t.konten } });
    await fahre(t2.einstellung(drehbuch([]), [3, 4], { meldung: 'an', maxDauerMs: 1000 }), t2.welt);
    expect(t2.p.toasts).toHaveLength(1);
    expect(t2.p.toasts[0].env?.FLOTTE_MELDUNG_TITEL).toBe('Braucht dich: 2 neue Meldungen (r)');
    expect(t2.p.toasts[0].env?.FLOTTE_MELDUNG_TEXT).toBe('Der Lauf kam nach zwei Neustarts zu keinem Ergebnis.\nDer Lauf kam nach zwei Neustarts zu keinem Ergebnis.');
  }, T);
});
