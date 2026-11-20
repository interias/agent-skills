import { describe, expect, it } from 'vitest';
import { leseText, artDesTexts } from '../src/transkript.ts';
import { rueckfragen, kalteZeit, istFehlstart, prDauern, verteilung, epicAus } from '../src/messen.ts';
import { T0, min, mensch, nachricht, meldung, assistent, ergebnis, frage } from './hilfen.ts';

const ganz = { von: T0 - 86_400_000, bis: T0 + 86_400_000 };
const lies = (...zeilen: string[]) => leseText(zeilen.join('\n'));

describe('transkript', () => {
  it('sorts user lines into person, message, notification, meta', () => {
    expect(artDesTexts('Bitte weiter')).toBe('mensch');
    expect(artDesTexts('<command-message>epic</command-message>\n<command-name>/epic</command-name>')).toBe('mensch');
    expect(artDesTexts('<pasted_content id="a">x</pasted_content>')).toBe('mensch');
    expect(artDesTexts('<cross-session-message>x')).toBe('nachricht');
    expect(artDesTexts('Background (from the session that started this one): x')).toBe('nachricht');
    expect(artDesTexts('<task-notification>x')).toBe('meldung');
    expect(artDesTexts('<system-reminder>x')).toBe('meta');
    expect(artDesTexts('This session is being continued from a previous conversation')).toBe('meta');
  });

  it('takes origin.kind first: a message of another session is written with isMeta', () => {
    const peer = JSON.stringify({ type: 'user', isMeta: true, origin: { kind: 'peer' }, timestamp: min(0), message: { content: 'Another Claude session sent a message:\n<cross-session-message>x' } });
    const human = JSON.stringify({ type: 'user', origin: { kind: 'human' }, timestamp: min(1), message: { content: '<command-name>/epic</command-name>' } });
    const task = JSON.stringify({ type: 'user', origin: { kind: 'task-notification' }, timestamp: min(2), message: { content: 'x' } });
    expect(lies(peer, human, task).map((e) => e.art)).toEqual(['nachricht', 'mensch', 'meldung']);
    expect(artDesTexts('Another Claude session sent a message:\n<cross-session-message>')).toBe('nachricht');
  });

  it('skips broken lines and sidechain lines and sorts by time', () => {
    const e = lies(assistent(2, 'b'), 'kaputt', JSON.stringify({ type: 'user', isSidechain: true, timestamp: min(0), message: { content: 'x' } }), mensch(1, 'a'));
    expect(e.map((x) => x.text)).toEqual(['a', 'b']);
  });
});

describe('rueckfragen', () => {
  it('reads AskUserQuestion: waiting time, recommendation followed, epic', () => {
    const e = lies(
      assistent(0, '', { tools: [{ id: 't1', name: 'AskUserQuestion', input: { questions: [frage('Epic #241 zuerst?', ['Ja (Recommended)', 'Nein']), frage('Port?', ['A', 'B (Empfehlung)'])] } }] }),
      ergebnis(30, 't1', 'Your questions have been answered: "Epic #241 zuerst?"="Ja (Recommended)", "Port?"="A". continue'),
    );
    const r = rueckfragen(e, [241, 299], ganz);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ form: 'ask', gefolgt: true, epic: 241, wartenMin: 30 });
    expect(r[1]).toMatchObject({ gefolgt: false, epic: null });
  });

  it('prefers toolUseResult.answers and leaves an answer by message open', () => {
    const e = lies(
      assistent(0, '', { tools: [{ id: 't1', name: 'AskUserQuestion', input: { questions: [frage('Q', ['X (Recommended)', 'Y'])] } }] }),
      ergebnis(5, 't1', 'egal', { answers: { Q: '[User did not answer this question — they sent a message instead.]' } }),
    );
    expect(rueckfragen(e, [], ganz)[0]).toMatchObject({ gefolgt: null, wartenMin: 5 });
  });

  it('counts a text round per ❓ and waits for the next input of a person', () => {
    const e = lies(
      assistent(0, 'Stand.\n❓ **Q1** — Epic #299: A oder B\n➡️ A\n❓ **Q2** — Ports\n➡️ B'),
      nachricht(10),
      mensch(45, 'A, B'),
    );
    const r = rueckfragen(e, [299], ganz);
    expect(r.map((x) => [x.form, x.epic, x.wartenMin, x.gefolgt])).toEqual([
      ['text', 299, 45, null],
      ['text', null, 45, null],
    ]);
  });

  it('ignores questions outside the window', () => {
    const e = lies(assistent(0, '❓ **Q1** x'), mensch(5, 'ja'));
    expect(rueckfragen(e, [], { von: T0 + 60_000, bis: T0 + 600_000 })).toEqual([]);
  });

  it('finds the epic by #number only for epics of the deployment', () => {
    expect(epicAus('PR #366 für Epic #302', [302])).toBe(302);
    expect(epicAus('Ticket #12', [302])).toBeNull();
  });
});

describe('kalteZeit', () => {
  it('counts the gap from a turn end to the next outside input', () => {
    const e = lies(mensch(0, 'los'), assistent(1, 'FLOTTE-FRAGE 1 tor', { stop: 'end_turn' }), nachricht(61), assistent(62, 'ok'));
    expect(kalteZeit(e, ganz)).toBe(60);
  });

  it('does not count waiting for its own background agents', () => {
    const e = lies(
      assistent(0, '', { tools: [{ id: 'a1', name: 'Agent', input: { run_in_background: true } }] }),
      ergebnis(0, 'a1', 'started'),
      assistent(1, 'warte', { stop: 'end_turn' }),
      meldung(50, 'a1'),
      assistent(51, 'weiter', { stop: 'end_turn' }),
      nachricht(52),
    );
    expect(kalteZeit(e, ganz)).toBe(0);
  });

  it('ignores reaction time below the threshold and the trailing wait', () => {
    const e = lies(assistent(0, 'x', { stop: 'end_turn' }), mensch(1, 'y'), assistent(2, 'z', { stop: 'end_turn' }));
    expect(kalteZeit(e, ganz)).toBe(0);
  });

  it('clips to the window', () => {
    const e = lies(assistent(0, 'x', { stop: 'end_turn' }), mensch(100, 'y'));
    expect(kalteZeit(e, { von: T0 + 40 * 60_000, bis: T0 + 1e9 })).toBe(60);
  });
});

describe('istFehlstart', () => {
  it('is a miss without an answer in the first three minutes', () => {
    expect(istFehlstart([])).toBe(true);
    expect(istFehlstart(lies(mensch(0, '<system-reminder>hook</system-reminder>'), nachricht(20, 'Auftrag'), assistent(21, 'ok')))).toBe(true);
    expect(istFehlstart(lies(mensch(0, 'Auftrag'), assistent(1, 'ok')))).toBe(false);
  });
});

describe('prDauern', () => {
  it('takes the first ready marker naming the pull request, else the creation time', () => {
    const lauf = lies(assistent(30, 'FLOTTE-ENDE 302 https://github.com/o/r/pull/366'), assistent(40, 'FLOTTE-ENDE 302 /pull/366'));
    const d = prDauern(
      [
        { number: 366, createdAt: min(20), mergedAt: min(90) },
        { number: 367, createdAt: min(0), mergedAt: min(15) },
        { number: 368, createdAt: min(0), mergedAt: null },
      ],
      [lauf],
      ganz,
    );
    expect(d.map((x) => [x.pr, x.minuten, x.geschaetzt])).toEqual([
      [366, 60, false],
      [367, 15, true],
    ]);
  });
});

describe('verteilung', () => {
  it('sums and averages', () => {
    expect(verteilung([10, 1, 4])).toEqual({ n: 3, summe: 15, mittel: 5, median: 4, max: 10 });
    expect(verteilung([])).toMatchObject({ n: 0, mittel: null });
  });
});
