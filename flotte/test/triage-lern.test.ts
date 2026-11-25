// #117: a proposal of the learning loop at lern_issue is triaged like a ticket. Clear: first the
// comment at the collecting issue, then (#170) a Sternzeit-Notiz through the order writer for the cut plan;
// superfluous: only the comment; critical: exactly one question. A second run does nothing, a
// stranger's comment with the mark of the loop is no proposal, a failed comment creates nothing.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { regelnAus } from '../src/befehle/auftrag.ts';
import { triagiere } from '../src/befehle/triage.ts';
import { lernKommentar } from '../src/lernen.ts';
import { entscheidungAus, LERN_THEMA, lernvorschlaege, offeneFragen, TRIAGE_FRAGE_MARKE, TRIAGE_MARKE, triageKommentar, type Entscheidung, type Ticket } from '../src/triage.ts';
import type { LaufErgebnis, Start } from '../src/werkzeuge/lauf.ts';

const REGELN = regelnAus('');
const ISSUE = 119;
const QUELLE = 'https://github.com/o/r/issues/119#issuecomment-555';
const LERN = lernKommentar(
  {
    vorschlaege: [
      { titel: 'Typprüfung im Gate', beleg: 'Epic #9, Kommentar 1', form: 'test', umsetzung: 'Ein Test führt tsc --noEmit aus.', wegfallen: 'nichts' },
      { titel: 'Zeittests robuster', beleg: 'PR #10', form: 'test', umsetzung: 'Schwellen gegen Last.', wegfallen: 'nichts' },
      { titel: 'Kundenmail nach dem Merge', beleg: 'PR #10', form: 'skilltext', umsetzung: 'Eine Mail an Kunden.', wegfallen: 'nichts' },
    ],
    gegriffen: [],
  },
  10,
  9,
  '2026-11-22',
  [],
  [],
);
const K = (n: number) => `Lernvorschlag 555/${n}`;

const antwort = {
  klar: {
    entscheidung: 'klar',
    herkunft: 'Skill-Empfehlung',
    grund: 'Der Beleg zeigt den Fehler, ein Test verhindert ihn.',
    fragen: [{ frage: 'Wiederholt ein künftiger Lauf den Fehler?', optionen: [], antwort: 'ja', herkunft: 'Eigenes Urteil: Beleg', grund: 'zweimal passiert', beim_menschen: false }],
    abnahmekriterien: '- Ein Typfehler macht die flotte-Suite rot.',
    verifikationsweg: '`cd flotte && bun test`',
  },
  ueberfluessig: { entscheidung: 'ueberfluessig', herkunft: 'Präzedenz: #134', grund: 'Mit #134 schon erledigt.', fragen: [], abnahmekriterien: '', verifikationsweg: '' },
  kritisch: {
    entscheidung: 'kritisch',
    herkunft: 'Skill-Empfehlung',
    grund: 'Geht nach außen.',
    fragen: [{ frage: 'Darf nach dem Merge eine Mail an Kunden gehen?', optionen: ['ja', 'nein'], antwort: 'nein', herkunft: 'Eigenes Urteil: nach außen', grund: 'nicht zurückholbar', beim_menschen: true, marke: 'nach außen' }],
    abnahmekriterien: '',
    verifikationsweg: '',
  },
};

interface Aufruf {
  args: string[];
  eingabe?: string;
}
type Kommentar = { body: string; rolle?: string; url?: string };

function welt(kommentare: Kommentar[], antworten: Record<string, unknown>, o: { kommentarScheitert?: boolean; anlegenScheitert?: boolean; tickets?: unknown[] } = {}) {
  const aufrufe: Aufruf[] = [];
  const gestartet: Start[] = [];
  let naechste = 200;
  return {
    aufrufe,
    gestartet,
    w: {
      aufrufer: (_p: string, args: string[], opt?: { eingabe?: string }) => {
        aufrufe.push({ args, eingabe: opt?.eingabe });
        if (args[0] === 'issue' && args[1] === 'list') return { code: 0, stdout: JSON.stringify(o.tickets ?? []), stderr: '' };
        if (args[0] === 'issue' && args[1] === 'view') {
          const comments = kommentare.map((k, i) => ({ body: k.body, author: { login: k.rolle === 'NONE' ? 'fremder' : 'mensch' }, authorAssociation: k.rolle ?? 'OWNER', createdAt: `2026-11-22T1${i}:00:00Z`, url: k.url ?? `https://github.com/o/r/issues/119#issuecomment-${900 + i}` }));
          return { code: 0, stdout: JSON.stringify({ comments }), stderr: '' };
        }
        if (args[0] === 'issue' && args[1] === 'comment' && o.kommentarScheitert) return { code: 1, stdout: '', stderr: 'nein' };
        if (args[0] === 'issue' && args[1] === 'create' && o.anlegenScheitert) return { code: 1, stdout: '', stderr: 'kein Netz' };
        if (args[0] === 'issue' && args[1] === 'create') return { code: 0, stdout: `https://github.com/o/r/issues/${naechste++}\n`, stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
      starte: async (s: Start): Promise<LaufErgebnis> => {
        gestartet.push(s);
        const k = /Lernvorschlag \d+\/\d+/.exec(s.auftrag)?.[0] ?? '';
        return { code: 0, sitzung: 's', dauerMs: 1000, strukturiert: antworten[k] } as LaufErgebnis;
      },
    },
  };
}

const auftrag = (trocken = false) => ({ ziele: [{ repo: '.', forge: 'o/r', regeln: REGELN, lernIssue: ISSUE }], konto: 'k', modell: 'fable', trocken });
const schreibend = (a: Aufruf[]) => a.filter((x) => x.args[0] === 'issue' && ['edit', 'close', 'comment', 'create'].includes(x.args[1]));
const lern = (rolle = 'OWNER'): Kommentar => ({ body: LERN, rolle, url: QUELLE });

describe('#117: Lernvorschlag wird wie ein Triage-Ticket behandelt', () => {
  it('reads every proposal of a comment of the loop with its kennung; a stranger\'s comment with the mark is no proposal', () => {
    const k = (body: string, rolle: string, url: string) => ({ body, autor: 'x', zeit: 'z', rolle, url });
    const v = lernvorschlaege(ISSUE, [k(LERN, 'OWNER', QUELLE), k(LERN, 'NONE', 'https://github.com/o/r/issues/119#issuecomment-666')]);
    expect(v.map((x) => [x.kennung, x.ticket.titel, x.ticket.nummer])).toEqual([[K(1), 'Typprüfung im Gate', ISSUE], [K(2), 'Zeittests robuster', ISSUE], [K(3), 'Kundenmail nach dem Merge', ISSUE]]);
    expect(v[0].ticket.body).toContain('- Umsetzung: Ein Test führt tsc --noEmit aus.');
    expect(v[0].ticket.body).toContain(`Herkunft: ${QUELLE}`);
  });

  it('klar: first the comment at lern_issue, then (#170) a Sternzeit-Notiz through the order writer with needs-triage, then its number', async () => {
    const t = welt([lern()], { [K(1)]: antwort.klar, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.kritisch });
    const r = await triagiere(auftrag(), t.w);
    const [k1, neu, k1b, k2, k3, ...rest] = schreibend(t.aufrufe);
    expect(rest).toEqual([]);

    expect(k1.args.slice(0, 3)).toEqual(['issue', 'comment', String(ISSUE)]);
    expect(k1.eingabe).toContain(TRIAGE_MARKE);
    expect(k1.eingabe).toContain(K(1));
    expect(k1.eingabe).toContain('Herkunft: Skill-Empfehlung');
    // the order writer's GitHub layer: one issue, needs-triage (#170: the cut plan releases it into a mission), the checked sections, the origin
    expect(neu.args).toEqual(['issue', 'create', '--repo', 'o/r', '--title', 'Typprüfung im Gate', '--label', 'needs-triage', '--body-file', '-']);
    expect(neu.eingabe).toContain('## Abnahmekriterien\n- Ein Typfehler macht die flotte-Suite rot.');
    expect(neu.eingabe).toContain('## Verifikationsweg\n`cd flotte && bun test`');
    expect(neu.eingabe).toContain(`Herkunft: ${QUELLE}`);
    expect(k1b.args.slice(0, 3)).toEqual(['issue', 'comment', String(ISSUE)]);
    expect(k1b.eingabe).toContain(`Vorschlag 1 aus ${QUELLE} → #200, widerrufbar`);
    expect(k1b.eingabe).toContain(TRIAGE_MARKE);
    expect(k1b.eingabe).toMatch(/Herkunft: \S/);

    // überflüssig: only the comment, with the reason
    expect(k2.args.slice(0, 3)).toEqual(['issue', 'comment', String(ISSUE)]);
    expect(k2.eingabe).toContain(K(2));
    expect(k2.eingabe).toContain('Grund: Mit #134 schon erledigt.');
    // kritisch: exactly one question with the mark and the reference to the proposal
    expect(k3.eingabe).toContain(TRIAGE_FRAGE_MARKE);
    expect(k3.eingabe).toContain(`**FRAGE AN DEN MENSCHEN (Triage)** — ${K(3)}`);

    expect(r.tickets.map((x) => [x.lernvorschlag, x.ergebnis, x.geschrieben, x.missionsziel, x.fehler])).toEqual([
      [K(1), 'klar', true, 200, undefined],
      [K(2), 'ueberfluessig', true, undefined, undefined],
      [K(3), 'kritisch', true, undefined, undefined],
    ]);
    expect(r.fragen).toEqual([{ forge: 'o/r', ticket: ISSUE, url: QUELLE, frage: 'Darf nach dem Merge eine Mail an Kunden gehen?', optionen: ['ja', 'nein'], empfehlung: 'nein', grund: 'nicht zurückholbar', herkunft: 'Eigenes Urteil: nach außen', marke: 'nach außen', lernvorschlag: K(3) }]);
    expect(t.gestartet[0].auftrag).toContain(`# ${K(1)} (Sammel-Issue #${ISSUE}): Typprüfung im Gate`);
    expect(t.gestartet[0].extraArgs).toEqual(expect.arrayContaining(['--tools', 'Read,Grep,Glob']));
  });

  it('Tag N: a selection without the collecting issue leaves its proposals for the next run; with it they are triaged', async () => {
    const ohne = welt([lern()], { [K(1)]: antwort.klar, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.kritisch });
    const r = await triagiere({ ...auftrag(), ziele: [{ ...auftrag().ziele[0], nummern: [5] }] }, ohne.w);
    expect(ohne.gestartet).toEqual([]);
    expect(schreibend(ohne.aufrufe)).toEqual([]);
    expect(r.tickets).toEqual([]);
    const mit = welt([lern()], { [K(1)]: antwort.ueberfluessig, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.ueberfluessig });
    const r2 = await triagiere({ ...auftrag(), ziele: [{ ...auftrag().ziele[0], nummern: [ISSUE] }] }, mit.w);
    expect(r2.tickets.map((x) => x.lernvorschlag)).toEqual([K(1), K(2), K(3)]);
  });

  it('a second run over the comments of the first does nothing: no model, nothing written', async () => {
    const t = welt([lern()], { [K(1)]: antwort.klar, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.kritisch });
    await triagiere(auftrag(), t.w);
    const danach = schreibend(t.aufrufe).filter((x) => x.args[1] === 'comment').map((x) => ({ body: x.eingabe! }));
    const t2 = welt([lern(), ...danach], { [K(1)]: antwort.klar, [K(2)]: antwort.klar, [K(3)]: antwort.klar });
    const r2 = await triagiere(auftrag(), t2.w);
    expect(t2.gestartet).toEqual([]);
    expect(schreibend(t2.aufrufe)).toEqual([]);
    // only the open question shows, as waiting
    expect(r2.tickets.map((x) => [x.lernvorschlag, x.ergebnis])).toEqual([[K(3), 'wartet']]);
  });

  it('an entitled answer naming the kennung starts the triage of that proposal again, a stranger\'s or one for another does not', async () => {
    const t = welt([lern()], { [K(3)]: antwort.kritisch, [K(1)]: antwort.ueberfluessig, [K(2)]: antwort.ueberfluessig });
    await triagiere(auftrag(), t.w);
    const danach = schreibend(t.aufrufe).map((x) => ({ body: x.eingabe! }));
    const t2 = welt([lern(), ...danach, { body: `Zu ${K(3)}: nein, keine Mail.`, rolle: 'NONE' }, { body: `Zu ${K(1)}: doch umsetzen.` }], { [K(1)]: antwort.klar, [K(3)]: antwort.klar });
    const r2 = await triagiere(auftrag(), t2.w);
    expect(r2.tickets.map((x) => [x.lernvorschlag, x.ergebnis])).toEqual([[K(1), 'klar'], [K(3), 'wartet']]);
    // #170: the note of the clear proposal goes into the cut plan of the same run; one clearing call
    expect(t2.gestartet.filter((s) => s.auftrag.startsWith('FLOTTE-TRIAGE'))).toHaveLength(1);
    expect(t2.gestartet[0].auftrag).toContain('doch umsetzen.');
    expect(t2.gestartet[0].auftrag).not.toContain('keine Mail');
  });

  it('a stranger\'s comment with the mark of the loop is ignored: no model, nothing written', async () => {
    const t = welt([lern('NONE'), lern('CONTRIBUTOR')], { [K(1)]: antwort.klar });
    const r = await triagiere(auftrag(), t.w);
    expect(t.gestartet).toEqual([]);
    expect(schreibend(t.aufrufe)).toEqual([]);
    expect(r.tickets).toEqual([]);
  });

  it('a triage comment quoting another kennung further down does not hold that proposal back', async () => {
    const t = welt([lern()], { [K(2)]: { ...antwort.ueberfluessig, grund: `Doppelt zu ${K(1)}.` } });
    await triagiere({ ...auftrag(), ziele: [{ repo: '.', forge: 'o/r', regeln: REGELN, lernIssue: ISSUE }] }, t.w);
    const zu2 = schreibend(t.aufrufe).find((x) => x.eingabe?.includes(`Doppelt zu ${K(1)}.`))!;
    const t2 = welt([lern(), { body: zu2.eingabe! }], { [K(1)]: antwort.ueberfluessig, [K(3)]: antwort.ueberfluessig });
    const r2 = await triagiere(auftrag(), t2.w);
    expect(r2.tickets.map((x) => [x.lernvorschlag, x.ergebnis])).toEqual([[K(1), 'ueberfluessig'], [K(3), 'ueberfluessig']]);
  });

  it('a revocation or an answer quoting another kennung below its first line does not reopen that proposal', async () => {
    const t = welt([lern()], { [K(1)]: antwort.klar, [K(2)]: { ...antwort.ueberfluessig, grund: `doppelt zu ${K(1)}` }, [K(3)]: antwort.kritisch });
    await triagiere(auftrag(), t.w);
    const danach = schreibend(t.aufrufe).filter((x) => x.args[1] === 'comment').map((x) => ({ body: x.eingabe! }));
    // the revocation as the driver writes it (Vorher quotes the reason), and an answer written by hand
    const widerruf = `**Widerruf des Menschen (Mensch über die Brücke)** — Triage-Entscheidung „überflüssig“ zu ${K(2)} zurückgenommen\nEinwand: nicht doppelt\nVorher: doppelt zu ${K(1)} (Präzedenz: #134)\nHerkunft: Mensch über die Brücke`;
    const antwort3 = `Zu ${K(3)}: nein, keine Mail.\nWie bei ${K(1)} gilt: nichts nach außen.`;
    const t2 = welt([lern(), ...danach, { body: widerruf }, { body: antwort3 }], { [K(1)]: antwort.klar, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.ueberfluessig });
    const r2 = await triagiere(auftrag(), t2.w);
    expect(r2.tickets.map((x) => [x.lernvorschlag, x.ergebnis])).toEqual([[K(2), 'ueberfluessig'], [K(3), 'ueberfluessig']]);
    expect(t2.gestartet.map((s) => /# (Lernvorschlag \d+\/\d+)/.exec(s.auftrag)?.[1])).toEqual([K(2), K(3)]);
    expect(schreibend(t2.aufrufe).filter((x) => x.args[1] === 'create')).toEqual([]);
  });

  it('a clear proposal whose Missionsziel failed waits with the error "Missionsziel fehlt" until a comment names it, nothing is created again', async () => {
    const t = welt([lern()], { [K(1)]: antwort.klar, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.ueberfluessig }, { anlegenScheitert: true });
    const r = await triagiere(auftrag(), t.w);
    expect(r.tickets[0]).toMatchObject({ lernvorschlag: K(1), ergebnis: 'klar', geschrieben: true });
    expect(r.tickets[0].fehler).toMatch(/^Kommentar steht, Missionsziel gescheitert/);
    const danach = schreibend(t.aufrufe).filter((x) => x.args[1] === 'comment').map((x) => ({ body: x.eingabe! }));
    const t2 = welt([lern(), ...danach], { [K(1)]: antwort.klar });
    const r2 = await triagiere(auftrag(), t2.w);
    expect(t2.gestartet).toEqual([]);
    expect(schreibend(t2.aufrufe)).toEqual([]);
    expect(r2.tickets.map((x) => [x.lernvorschlag, x.ergebnis, x.fehler])).toEqual([[K(1), 'wartet', 'Missionsziel fehlt']]);
    // a person checked: the comment naming the kennung in its first line starts the triage again
    const t3 = welt([lern(), ...danach, { body: `${K(1)}: kein Missionsziel da, bitte neu.` }], { [K(1)]: antwort.klar });
    const r3 = await triagiere(auftrag(), t3.w);
    expect(r3.tickets.map((x) => [x.lernvorschlag, x.ergebnis, x.missionsziel])).toEqual([[K(1), 'klar', 200]]);
  });

  it('offen: the still open questions of waiting tickets and proposals, in the form of fragen; fragen keeps only the new ones', async () => {
    const t = welt([lern()], { [K(1)]: antwort.ueberfluessig, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.kritisch });
    const r = await triagiere(auftrag(), t.w);
    expect(r.fragen).toHaveLength(1);
    expect(r.offen).toEqual([]);
    const danach = schreibend(t.aufrufe).filter((x) => x.args[1] === 'comment').map((x) => ({ body: x.eingabe! }));
    // a Sternzeit-Notiz with the question of an earlier triage below it
    const notiz: Ticket = { nummer: 61, titel: 'Newsletter', body: 'Text', url: 'https://github.com/o/r/issues/61', labels: ['needs-triage'], kommentare: [] };
    const e = entscheidungAus({ ...antwort.kritisch, fragen: [{ ...antwort.kritisch.fragen[0], frage: 'Darf der Newsletter raus?' }] }, notiz.titel, notiz.body, REGELN) as Exclude<Entscheidung, { art: 'ungueltig' }>;
    const roh = { number: 61, title: notiz.titel, body: notiz.body, url: notiz.url, labels: [{ name: 'needs-triage' }], comments: [{ body: triageKommentar(e, notiz, ['needs-triage']), author: { login: 'flotte' }, createdAt: '2026-11-22T09:00:00Z', authorAssociation: 'OWNER' }] };
    const t2 = welt([lern(), ...danach], {}, { tickets: [roh] });
    const r2 = await triagiere(auftrag(), t2.w);
    expect(t2.gestartet).toEqual([]);
    expect(r2.fragen).toEqual([]);
    const frage = { optionen: ['ja', 'nein'], empfehlung: 'nein', grund: 'nicht zurückholbar', herkunft: 'Eigenes Urteil: nach außen', marke: 'nach außen' };
    expect(r2.offen).toEqual([
      { forge: 'o/r', ticket: 61, url: notiz.url, frage: 'Darf der Newsletter raus?', ...frage },
      { forge: 'o/r', ticket: ISSUE, url: QUELLE, frage: 'Darf nach dem Merge eine Mail an Kunden gehen?', ...frage, lernvorschlag: K(3) },
    ]);
  });

  it('when the comment fails, nothing is created', async () => {
    const t = welt([lern()], { [K(1)]: antwort.klar, [K(2)]: antwort.klar, [K(3)]: antwort.klar }, { kommentarScheitert: true });
    const r = await triagiere(auftrag(), t.w);
    expect(t.aufrufe.filter((x) => x.args[1] === 'create' || x.args[0] === 'label')).toEqual([]);
    expect(r.tickets.every((x) => !x.geschrieben && x.fehler === 'Kommentar gescheitert, nichts angelegt')).toBe(true);
  });

  it('--trocken decides and prints, writes nothing', async () => {
    const t = welt([lern()], { [K(1)]: antwort.klar, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.kritisch });
    const r = await triagiere(auftrag(true), t.w);
    expect(schreibend(t.aufrufe)).toEqual([]);
    expect(r.tickets.map((x) => [x.ergebnis, x.geschrieben])).toEqual([['klar', false], ['ueberfluessig', false], ['kritisch', false]]);
  });

  it('without lern_issue the collecting issue is not read', async () => {
    const t = welt([lern()], { [K(1)]: antwort.klar });
    await triagiere({ ...auftrag(), ziele: [{ repo: '.', forge: 'o/r', regeln: REGELN }] }, t.w);
    expect(t.aufrufe.filter((x) => x.args[1] === 'view')).toEqual([]);
  });

  it('the question at lern_issue reads back for the Frachtraum like one at a ticket', async () => {
    const t = welt([lern()], { [K(1)]: antwort.ueberfluessig, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.kritisch });
    await triagiere(auftrag(), t.w);
    const kommentare = [lern(), ...schreibend(t.aufrufe).map((x): Kommentar => ({ body: x.eingabe! }))].map((k, i) => ({ body: k.body, autor: 'flotte', zeit: `2026-11-22T1${i}:00:00Z`, rolle: 'OWNER', url: k.url ?? `https://github.com/o/r/issues/119#issuecomment-${900 + i}` }));
    const v = lernvorschlaege(ISSUE, kommentare);
    expect(v.map((x) => offeneFragen(x.ticket).map((f) => f.frage))).toEqual([[], [], ['Darf nach dem Merge eine Mail an Kunden gehen?']]);
  });

  it('a proposal whose Missionsziel exists is decided for good: a later comment naming its kennung starts no triage, no second Missionsziel', async () => {
    const t = welt([lern()], { [K(1)]: antwort.klar, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.ueberfluessig });
    await triagiere(auftrag(), t.w);
    const danach = schreibend(t.aufrufe).filter((x) => x.args[1] === 'comment').map((x): Kommentar => ({ body: x.eingabe! }));
    const t2 = welt([lern(), ...danach, { body: `${K(1)}: danke, passt.` }], { [K(1)]: antwort.klar });
    const r2 = await triagiere(auftrag(), t2.w);
    expect(t2.gestartet).toEqual([]);
    expect(schreibend(t2.aufrufe)).toEqual([]);
    expect(r2.tickets).toEqual([]);
    // a stranger cannot fake the comment with the number: the proposal is triaged as usual
    const t3 = welt([lern(), { body: `${TRIAGE_MARKE}\nVorschlag 1 aus ${QUELLE} → #7, widerrufbar (${K(1)})`, rolle: 'NONE' }], { [K(1)]: antwort.ueberfluessig, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.ueberfluessig });
    const r3 = await triagiere(auftrag(), t3.w);
    expect(r3.tickets.map((x) => x.lernvorschlag)).toEqual([K(1), K(2), K(3)]);
  });

  it('a field over several lines belongs whole to its proposal, the next proposal still reads', () => {
    const text = lernKommentar(
      {
        vorschlaege: [
          { titel: 'Erster', beleg: 'PR #1', form: 'test', umsetzung: 'Zeile eins\nZeile zwei', wegfallen: 'nichts' },
          { titel: 'Zweiter', beleg: 'PR #2', form: 'test', umsetzung: 'kurz', wegfallen: 'nichts' },
        ],
        gegriffen: [],
      },
      10,
      9,
      '2026-11-22',
      [],
      [],
    );
    const v = lernvorschlaege(ISSUE, [{ body: text, autor: 'x', zeit: 'z', rolle: 'OWNER', url: QUELLE }]);
    expect(v.map((x) => x.ticket.titel)).toEqual(['Erster', 'Zweiter']);
    expect(v[0].ticket.body).toContain('- Umsetzung: Zeile eins\n  Zeile zwei');
    expect(v[0].ticket.body).toContain('- Dafür entfällt: nichts');
    expect(v[1].ticket.body).not.toContain('Zeile zwei');
  });
});

describe('#117: Skill-Text und Verhalten', () => {
  const wurzel = fileURLToPath(new URL('../..', import.meta.url));
  const readme = readFileSync(`${wurzel}flotte/README.md`, 'utf8');
  const schnittstelle = readFileSync(`${wurzel}flottenbruecke/SCHNITTSTELLE.md`, 'utf8');
  const adapter = readFileSync(`${wurzel}mission/references/adapter.md`, 'utf8');

  it('README and adapter leave each Lernvorschlag to flotte triage; a ticket comes only from a clear proposal, never from a superfluous one', async () => {
    expect(adapter).toContain('jeden Vorschlag entscheidet `flotte triage`');
    expect(readme).toContain('außer aus einem Lernvorschlag über den Auftragsschreiber');
    expect(readme).toContain('**überflüssig:** nur der Kommentar mit Grund; nichts wird angelegt.');
    const t = welt([lern()], { [K(1)]: antwort.ueberfluessig, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.kritisch });
    await triagiere(auftrag(), t.w);
    expect(schreibend(t.aufrufe).filter((x) => x.args[1] !== 'comment')).toEqual([]);
    // a question reaches the person only as a comment at lern_issue (and in the Frachtraum)
    expect(readme).toContain('als Fragekommentar am Ticket (bei\neinem Lernvorschlag am `lern_issue`) und im Frachtraum der Brücke'.replaceAll('\n', readme.includes('\r\n') ? '\r\n' : '\n'));
  });

  it('README and SCHNITTSTELLE name the kennung, the topic and the comments as the code writes them', async () => {
    const t = welt([lern()], { [K(1)]: antwort.klar, [K(2)]: antwort.ueberfluessig, [K(3)]: antwort.kritisch });
    await triagiere(auftrag(), t.w);
    const neu = schreibend(t.aufrufe).find((x) => x.args[1] === 'comment' && x.eingabe?.includes('→ #200'))!.eingabe!;
    // README: `Vorschlag <n> aus <Kommentar> → #<neu>, widerrufbar (Lernvorschlag <id>/<n>)`
    const form = /`Vorschlag <n> aus <Kommentar> → #<neu>, widerrufbar \(Lernvorschlag <id>\/<n>\)`/;
    expect(readme).toMatch(form);
    expect(neu).toContain(`Vorschlag 1 aus ${QUELLE} → #200, widerrufbar (${K(1)})`);
    expect(readme).toContain('`Lernvorschlag <id>/<n>`');
    expect(schnittstelle).toContain('"Lernvorschlag <id>/<n>: <Titel>", labels: ["Lernschleife"]');
    for (const text of [readme, schnittstelle]) {
      expect(text).toContain(`\`${LERN_THEMA}\``);
      // an answer counts only with the kennung in its first line (gehoertZu)
      expect(text).toContain('in der ersten Zeile');
      // a proposal with its Missionsziel never comes back (missionszielAngelegt)
      expect(text).toContain('`→ #<neu>`');
    }
  });

  it('README names fragen and offen of the output and the missing Missionsziel as it is reported', async () => {
    const r = await triagiere(auftrag(), welt([], {}).w);
    expect(Object.keys(r)).toEqual(expect.arrayContaining(['fragen', 'offen']));
    expect(readme).toContain('`offen`');
    expect(readme).toContain('`Missionsziel fehlt`');
    expect(schnittstelle).toContain('`— Missionsziel fehlt`');
  });
});
