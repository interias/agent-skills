// #243: "Braucht dich" says what is going on, who is on it and the person's step. The catalog of known
// causes (ursache.ts), the error line of a gate log, the summary of an unknown cause by a model (stand-in
// only), the push text and the issue comment.

import { describe, expect, it } from 'vitest';
import { einordnen, fehlerAus, KURZ_MAX, kommentarText, kurzzeile, mainRot, pushText, zusammenfassung } from '../src/treiber/ursache.ts';

const GATE_ROT = [
  ' FAIL  tests/adr-nummern.test.mts > ADR-Nummern > stanze lückenlos',
  "AssertionError: ADR-Fach 'stanze': erwartet 0001–0013, gefunden …0011, 0012, 0014",
  '== Gate: Basis origin/main @ abc1234 (HEAD def56789)',
  '  wurzel ROT 1:20',
  '  web grün 0:50',
  'Gate ROT.',
].join('\n');
const andockGrund = (log: string) => `Andocken nach zwei Nachbesserungen weiter nicht möglich:\n\nDie Basis zog davon. Der Treiber hat origin/main per \`git merge\` in den Missions-Branch geholt und die Andockprüfung gefahren (\`gate voll\`): rot. Nichts gepusht.\n\n\`\`\`\n${log}\n\`\`\`\n\nBasis selbst per \`git merge\` holen.`;

const passt = (s: string) => {
  expect(s.length).toBeLessThanOrEqual(KURZ_MAX);
  expect(s).not.toMatch(/[:…]\s*$/);
  expect(s).toMatch(/[.!?]$/);
};

describe('the short line', () => {
  it('takes the first candidate that fits whole, never cuts, never ends on a colon', () => {
    expect(kurzzeile(['x'.repeat(91), 'Kurz genug:'])).toBe('Kurz genug.');
    expect(kurzzeile(['main ist rot'])).toBe('main ist rot.');
    // nothing fits: the last one, still whole (the catalog's last candidate is always short)
    expect(kurzzeile(['y'.repeat(100)])).toBe(`${'y'.repeat(100)}.`);
  });
});

describe('the error line of a gate log', () => {
  it('names the red context, the failing test and its message', () => {
    expect(fehlerAus(GATE_ROT)).toEqual({ kontext: 'wurzel', test: 'tests/adr-nummern.test.mts', meldung: "AssertionError: ADR-Fach 'stanze': erwartet 0001–0013, gefunden …0011, 0012, 0014", zeile: "wurzel ROT · tests/adr-nummern.test.mts > ADR-Nummern > stanze lückenlos\nAssertionError: ADR-Fach 'stanze': erwartet 0001–0013, gefunden …0011, 0012, 0014" });
  });

  it('reads pytest and bun as well; without a test only the context', () => {
    expect(fehlerAus('FAILED tests/test_lage.py::test_satz - assert 1 == 2\n== Gate: Basis origin/main @ abc1234 (HEAD def56789)\n  bruecke ROT 0:40\nGate ROT.')).toMatchObject({ kontext: 'bruecke', test: 'tests/test_lage.py', meldung: 'assert 1 == 2' });
    expect(fehlerAus('(fail) lage > Satz [3.20ms]\nerror: expect(received).toBe(expected)\n== Gate: Basis origin/main @ abc1234 (HEAD def56789)\n  treiber ROT 2:00\nGate ROT.')).toMatchObject({ kontext: 'treiber', test: 'lage > Satz', meldung: 'error: expect(received).toBe(expected)' });
    expect(fehlerAus('== Gate: Basis origin/main @ abc1234 (HEAD def56789)\n  wurzel ROT 1:20\nGate ROT.')).toEqual({ kontext: 'wurzel', test: null, meldung: null, zeile: 'wurzel ROT' });
    expect(fehlerAus('nichts')).toBeNull();
  });

  it('never carries a local path out', () => {
    const f = fehlerAus('FAILED C:\\Users\\jemand\\repo\\tests\\test_x.py::t - Datei /home/jemand/x fehlt\n== Gate: Basis origin/main @ abc1234 (HEAD def56789)\n  wurzel ROT 1:20\nGate ROT.')!;
    expect(JSON.stringify(f)).not.toMatch(/jemand/);
  });
});

describe('the catalog: six known causes, each with short line, who and step', () => {
  const fall = (grund: string, mehr: Partial<Parameters<typeof einordnen>[0]> = {}) => einordnen({ nr: 548, grund, konto: 'Konto 2', pr: 551, seit: '2026-11-28T07:00:00Z', ...mehr });

  it('main red: whole sentence with context and test, the person, a button that checks again', () => {
    const u = mainRot({ basis: 'main', fehler: fehlerAus(GATE_ROT), seit: '2026-11-28T07:00:00Z' });
    expect(u).toMatchObject({ art: 'main_rot', wer: 'du', knopf: 'erledigt', quelle: 'katalog', schluessel: 'main_rot:wurzel' });
    expect(u.kurz).toBe('main ist rot: tests/adr-nummern.test.mts scheitert in wurzel.');
    expect(u.warum).toMatch(/^die Mission ist es nicht: main ist auch ohne sie rot$/);
    expect(u.schritt).toMatch(/^main reparieren/);
    expect(u.fehler).toMatch(/^wurzel ROT · tests\/adr-nummern/);
    passt(u.kurz);
  });

  it('conflict with main after the fleet tried: the person resolves it, the command to copy', () => {
    const u = fall('Nachziehen der Basis nach 5 Konflikten weiter nicht möglich:\n\nBeim Nachziehen von origin/main gab es einen Konflikt in a/x.txt, b/y.txt. Der Treiber hat `git merge` abgebrochen.');
    expect(u).toMatchObject({ art: 'konflikt', wer: 'du', knopf: 'erledigt', schluessel: 'konflikt:#548' });
    expect(u.kurz).toBe('Konflikt mit main in a/x.txt, b/y.txt, die Flotte löst ihn nicht selbst.');
    expect(u.befehl).toBe('git merge origin/main');
    passt(u.kurz);
  });

  it('the mission\'s gate red: the test in the line, the mission repairs it after a requeue', () => {
    const u = fall(andockGrund(GATE_ROT));
    expect(u).toMatchObject({ art: 'gate_rot', wer: 'mission', knopf: 'einreihen', schluessel: 'gate_rot:#548' });
    expect(u.kurz).toBe('Andockprüfung rot: tests/adr-nummern.test.mts scheitert in wurzel.');
    expect(u.fehler).toMatch(/AssertionError/);
    passt(u.kurz);
  });

  it('a run without result after restarts', () => {
    for (const [grund, kurz] of [
      ['Start ohne Ergebnis nach zwei Neustarts (start)', 'Der Lauf kam nach zwei Neustarts zu keinem Ergebnis.'],
      ['Netzfehler nach zwei Fortsetzungen', 'Der Lauf brach zweimal mit einem Netzfehler ab.'],
      ['Zug ohne Block, auch nach der Nachfrage. Letzter Stand des Laufs:\n\nirgendwas', 'Der Lauf endete ohne Block, auch nach der Nachfrage.'],
      ['Leerlauf: 60 min ohne Ausgabe', 'Der Lauf blieb 60 min ohne Ausgabe.'],
    ]) {
      const u = fall(grund);
      expect(u).toMatchObject({ art: 'ohne_ergebnis', kurz, wer: 'du', knopf: 'einreihen' });
      passt(u.kurz);
    }
  });

  it('PR missing or the wrong one', () => {
    expect(fall('FLOTTE-ENDE ohne Pull Request', { pr: null })).toMatchObject({ art: 'pr', kurz: 'Der Lauf endete ohne Pull Request.', wer: 'mission', knopf: 'einreihen' });
    expect(fall('PR #551 wurde ohne Andocken geschlossen')).toMatchObject({ art: 'pr', kurz: 'PR #551 wurde ohne Andocken geschlossen.', wer: 'du', knopf: 'erledigt' });
    expect(fall('PR #549 gehört nicht zur Mission (Head epic/543-x)')).toMatchObject({ art: 'pr', wer: 'du', knopf: 'erledigt' });
  });

  it('sign-in or rights missing', () => {
    const a = fall('Konto Konto 2 ist nicht angemeldet. Ein Mensch meldet es an.');
    expect(a).toMatchObject({ art: 'anmeldung', kurz: 'Konto 2 ist nicht angemeldet.', wer: 'du', knopf: 'erledigt' });
    expect(a.schritt).toMatch(/Maschinenraum/);
    const e = fall('Erlaubnis verweigert: Bash(git push --force). Kein zweiter Versuch in anderer Form.');
    expect(e).toMatchObject({ art: 'anmeldung', kurz: 'Eine Erlaubnis fehlt: Bash(git push --force).', wer: 'du', knopf: 'einreihen' });
    expect(fall('Gesperrt durch guard.ps1, dreimal:\n\n- rm -rf')).toMatchObject({ art: 'anmeldung', wer: 'du' });
  });

  it('every line of the catalog fits, also with long names', () => {
    const lang = 'sehr/langer/pfad/zu/einer/testdatei/mit/vielen/ordnern/und/einem/namen.test.mts';
    const f = fehlerAus(` FAIL  ${lang} > a\nError: x\n== Gate: Basis origin/main @ abc1234 (HEAD def56789)\n  ein-sehr-langer-kontextname-der-kaum-passt ROT 1:00\nGate ROT.`);
    passt(mainRot({ basis: 'main', fehler: f, seit: null }).kurz);
    passt(fall(andockGrund(` FAIL  ${lang} > a\nError: x\n== Gate: Basis origin/main @ abc1234 (HEAD def56789)\n  ein-sehr-langer-kontextname-der-kaum-passt ROT 1:00\nGate ROT.`)).kurz);
    passt(fall(`Nachziehen der Basis nach 5 Konflikten weiter nicht möglich:\n\nBeim Nachziehen von origin/main gab es einen Konflikt in ${lang}, ${lang}. Der Treiber hat abgebrochen.`).kurz);
    passt(fall(`Erlaubnis verweigert: ${lang} ${lang}. Kein zweiter Versuch.`).kurz);
  });

  it('an unknown cause: unbekannt, the person, until the model summarized it', () => {
    const u = fall('3 Andockprüfungen des Treibers, die Basis zog jedes Mal davon: GATE FEHLT #551');
    expect(u).toMatchObject({ art: 'unbekannt', wer: 'du', quelle: 'katalog', knopf: 'einreihen' });
    passt(u.kurz);
  });
});

describe('an unknown cause summarized by the model (stand-in)', () => {
  const basis = einordnen({ nr: 548, grund: 'Etwas Unerwartetes: der Worktree fehlt', konto: null, pr: null, seit: null });

  it('a valid answer: its short line, who and step, marked as summarized', () => {
    const u = zusammenfassung(basis, { kurz: 'Der Missions-Worktree fehlt auf dem Rechner.', wer: 'du', warum: 'die Flotte legt ihn nicht neu an', schritt: 'Worktree neu anlegen, dann neu einreihen.' });
    expect(u).toMatchObject({ art: 'unbekannt', quelle: 'zusammengefasst', kurz: 'Der Missions-Worktree fehlt auf dem Rechner.', wer: 'du', schritt: 'Worktree neu anlegen, dann neu einreihen.' });
  });

  it('an answer that breaks the rules keeps the catalog line', () => {
    expect(zusammenfassung(basis, { kurz: 'x'.repeat(120), wer: 'du', warum: '', schritt: 's' })).toBe(basis);
    expect(zusammenfassung(basis, { kurz: 'Endet auf:', wer: 'du', warum: '', schritt: 's' })).toMatchObject({ kurz: 'Endet auf.', quelle: 'zusammengefasst' });
    expect(zusammenfassung(basis, { kurz: 'Gut.', wer: 'niemand', warum: '', schritt: 's' })).toBe(basis);
    expect(zusammenfassung(basis, null)).toBe(basis);
  });
});

describe('push text and issue comment', () => {
  const u = mainRot({ basis: 'main', fehler: fehlerAus(GATE_ROT), seit: null });

  it('the push: short line plus step and what it holds', () => {
    expect(pushText(u, ['#548'])).toEqual({ titel: 'main ist rot: tests/adr-nummern.test.mts scheitert in wurzel.', text: '→ main reparieren (tests/adr-nummern.test.mts in wurzel), dann „Erledigt“ · hält #548' });
    expect(pushText(u, ['#548', '#545']).text).toMatch(/· hält #548, #545$/);
  });

  it('the comment begins with the three lines; log and the command in <details>', () => {
    const k = kommentarText(u, { kopf: 'Braucht dich · main rot', details: GATE_ROT, befehl: 'flotte antworten . 548 1 "<Antwort>"' });
    const z = k.split('\n');
    expect(z[0]).toBe('**Braucht dich · main rot**');
    expect(z[2]).toBe('**Was:** main ist rot: tests/adr-nummern.test.mts scheitert in wurzel.');
    expect(z[3]).toMatch(/^\*\*Wer:\*\* Du · die Mission ist es nicht: main ist auch ohne sie rot$/);
    expect(z[4]).toMatch(/^\*\*Schritt:\*\* main reparieren/);
    expect(k).toMatch(/<details><summary>Details<\/summary>\n\n```\n[\s\S]*Gate ROT\.\n```\n\nAntworten, im Repository: `flotte antworten \. 548 1 "<Antwort>"`\n\n<\/details>$/);
  });
});
