// #146: the triage reads all open Sternzeit-Notizen of a project and the open missions together and cuts a
// plan in one admiral call: each note exactly once a child of an open mission, of a new mission, merged into
// another note, superfluous, rejected, or left in triage. The same call clears the notes (questions, sections);
// there is no call per note. The program checks the plan; an invalid one changes nothing. Closing: the comment
// with origin first, then `not planned`.

import { describe, expect, it } from 'vitest';
import { regelnAus } from '../src/befehle/auftrag.ts';
import { triagiere } from '../src/befehle/triage.ts';
import { pakete, schnittplanAuftrag, schnittplanAus, schnittplanSchema, type Ticket, TRIAGE_MARKE } from '../src/triage.ts';
import type { LaufErgebnis, Start } from '../src/werkzeuge/lauf.ts';

const REGELN = regelnAus('');
/** #146: the clearing of a note joining a mission, part of its place in the plan */
const KLAR = { fragen: [], abnahmekriterien: '- Es geht.', verifikationsweg: '`bun test`' };

interface Aufruf {
  args: string[];
  eingabe?: string;
}
type Notiz = { number: number; title: string; body: string; labels?: string[]; rolle?: string };
type Mission = { number: number; title: string; body?: string; labels?: string[]; kinder?: number | null };

function welt(notizen: Notiz[], plan: unknown, o: { missionen?: Mission[]; kommentarScheitert?: boolean; missionenScheitern?: boolean } = {}) {
  const aufrufe: Aufruf[] = [];
  const geplant: Start[] = [];
  const missionen = o.missionen ?? [];
  return {
    aufrufe,
    geplant,
    w: {
      aufrufer: (_p: string, args: string[], opt?: { eingabe?: string }) => {
        aufrufe.push({ args, eingabe: opt?.eingabe });
        if (args[0] === 'issue' && args[1] === 'list') {
          const label = args[args.indexOf('--label') + 1];
          if (label === 'epic') {
            if (o.missionenScheitern) return { code: 1, stdout: '', stderr: 'HTTP 502' };
            return { code: 0, stdout: JSON.stringify(missionen.map((m) => ({ number: m.number, title: m.title, body: m.body ?? '', url: `https://github.com/o/r/issues/${m.number}`, labels: ['epic', ...(m.labels ?? [])].map((name) => ({ name })) }))), stderr: '' };
          }
          const liste = notizen.map((t) => ({ number: t.number, title: t.title, body: t.body, url: `https://github.com/o/r/issues/${t.number}`, labels: (t.labels ?? ['needs-triage']).map((name) => ({ name })), comments: [] })).filter((t) => t.labels.some((l) => l.name === label));
          return { code: 0, stdout: JSON.stringify(liste), stderr: '' };
        }
        if (args[0] === 'api') {
          const nr = Number(/issues\/(\d+)(\/sub_issues)?$/.exec(args[1])?.[1]);
          const m = missionen.find((x) => x.number === nr);
          // the Missionsziele of the mission, one JSON line each
          if (m) return m.kinder === null ? { code: 1, stdout: '', stderr: 'HTTP 404' } : { code: 0, stdout: Array.from({ length: m.kinder ?? 0 }, (_, i) => `${JSON.stringify({ number: 1000 + i, state: 'open', labels: [] })}\n`).join(''), stderr: '' };
          return { code: 0, stdout: `${notizen.find((t) => t.number === nr)?.rolle ?? 'OWNER'}\n`, stderr: '' };
        }
        if (args[0] === 'issue' && args[1] === 'comment' && o.kommentarScheitert) return { code: 1, stdout: '', stderr: 'nein' };
        return { code: 0, stdout: '', stderr: '' };
      },
      // #146: every start counts; there is no other call than the cut plan
      starte: async (s: Start): Promise<LaufErgebnis> => {
        geplant.push(s);
        expect(s.auftrag.startsWith('FLOTTE-SCHNITTPLAN')).toBe(true);
        return { code: 0, sitzung: 'plan', dauerMs: 1000, strukturiert: plan } as LaufErgebnis;
      },
    },
  };
}

const ziel = { repo: '.', forge: 'o/r', regeln: REGELN };
const auftrag = (trocken = false) => ({ ziele: [ziel], konto: 'k', modell: 'fable', trocken });
const schreibend = (a: Aufruf[]) => a.filter((x) => x.args[0] === 'issue' && ['edit', 'close', 'comment', 'delete'].includes(x.args[1]));
const nummernIn = (auftrag: string) => [...auftrag.matchAll(/^## Sternzeit-Notiz #(\d+)/gm)].map((m) => Number(m[1]));

/** 12 notes to three topics: Port 1-4, Tafel 5-8, Logbuch 9-12 */
const ZWOELF: Notiz[] = Array.from({ length: 12 }, (_, i) => ({ number: i + 1, title: `${['Port', 'Tafel', 'Logbuch'][Math.floor(i / 4)]} ${i + 1}`, body: `Notiz ${i + 1}` }));
const DREI_THEMEN = {
  neue_missionen: [
    { schluessel: 'port', titel: 'Portprüfung', begruendung: 'vier Notizen zum Port' },
    { schluessel: 'tafel', titel: 'Tafel', begruendung: 'vier Notizen zur Tafel' },
    { schluessel: 'logbuch', titel: 'Logbuch', begruendung: 'vier Notizen zum Logbuch' },
  ],
  zuordnungen: ZWOELF.map((n, i) => ({ notiz: n.number, art: 'neue_mission', neue_mission: ['port', 'tafel', 'logbuch'][Math.floor(i / 4)], grund: 'gleiches Thema', ...KLAR })),
};
const ticket = (n: Notiz): Ticket => ({ nummer: n.number, titel: n.title, body: n.body, url: '', labels: ['needs-triage'], kommentare: [] });

describe('#146 Schnittplan: 12 Notizen zu 3 Themen', () => {
  it('cuts three new missions, none over 8 children, every note assigned exactly once, in one admiral call', async () => {
    const t = welt(ZWOELF, DREI_THEMEN);
    const r = await triagiere(auftrag(true), t.w);
    expect(t.geplant).toHaveLength(1);
    expect(nummernIn(t.geplant[0].auftrag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(t.geplant[0].extraArgs).toEqual(['--json-schema', JSON.stringify(schnittplanSchema()), '--tools', 'Read,Grep,Glob', '--max-turns', '18']);
    const [p] = r.schnittplan;
    expect(p.fehler).toBeUndefined();
    expect(p.neue_missionen.map((m) => [m.titel, m.kinder])).toEqual([['Portprüfung', [1, 2, 3, 4]], ['Tafel', [5, 6, 7, 8]], ['Logbuch', [9, 10, 11, 12]]]);
    expect(p.zuordnungen.map((z) => z.notiz).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // --trocken: nothing written
    expect(schreibend(t.aufrufe)).toEqual([]);
  });

  it('a plan over the limits, missing or doubling a note, or naming an unknown one is invalid', () => {
    const n = ZWOELF.map(ticket);
    expect(schnittplanAus(DREI_THEMEN, n, [], REGELN).art).toBe('plan');
    const fehler = (x: unknown) => { const p = schnittplanAus(x, n, [], REGELN); return p.art === 'ungueltig' ? p.fehler : ''; };
    expect(fehler({ ...DREI_THEMEN, zuordnungen: DREI_THEMEN.zuordnungen.slice(1) })).toContain('#1 ohne Zuordnung');
    expect(fehler({ ...DREI_THEMEN, zuordnungen: [...DREI_THEMEN.zuordnungen, DREI_THEMEN.zuordnungen[0]] })).toContain('#1 doppelt');
    expect(fehler({ ...DREI_THEMEN, zuordnungen: [...DREI_THEMEN.zuordnungen, { notiz: 99, art: 'triage', grund: 'x' }] })).toContain('#99');
    // nine children for one mission
    const neun = { ...DREI_THEMEN, zuordnungen: DREI_THEMEN.zuordnungen.map((z, i) => (i < 9 ? { ...z, neue_mission: 'port' } : z)) };
    expect(fehler(neun)).toContain('mehr als 8');
    // five new missions
    const fuenf = {
      neue_missionen: ['a', 'b', 'c', 'd', 'e'].map((s) => ({ schluessel: s, titel: s, begruendung: s })),
      zuordnungen: DREI_THEMEN.zuordnungen.map((z, i) => ({ ...z, neue_mission: ['a', 'b', 'c', 'd', 'e'][i % 5] })),
    };
    expect(fehler(fuenf)).toContain('mehr als 4');
    expect(fehler(null)).toContain('Schema');
  });

  it('the plan carries the clearing: a note joining a mission without its sections, or a closed one asking the person, is invalid', () => {
    const n = ZWOELF.map(ticket);
    const fehler = (x: unknown) => { const p = schnittplanAus(x, n, [], REGELN); return p.art === 'ungueltig' ? p.fehler : ''; };
    const mit = (i: number, z: object) => ({ ...DREI_THEMEN, zuordnungen: DREI_THEMEN.zuordnungen.map((y, j) => (j === i ? { ...y, ...z } : y)) });
    expect(fehler(mit(0, { verifikationsweg: '' }))).toContain('Sternzeit-Notiz #1: abnahmekriterien oder verifikationsweg fehlt');
    const frage = { frage: 'Darf das raus?', optionen: ['ja', 'nein'], antwort: 'nein', herkunft: 'h', grund: 'g', beim_menschen: true, marke: 'nach außen' };
    // the last plan (after the repair): such a note alone stays on triage, a structural error still invalidates
    const q = schnittplanAus(mit(0, { verifikationsweg: '' }), n, [], REGELN, 4, true);
    expect(q.art === 'plan' && q.zuordnungen[0]).toMatchObject({ art: 'triage', herabgestuft: expect.stringContaining('vorgesehen: neue Mission „port“') });
    expect(q.art === 'plan' && q.neue_missionen.map((m) => m.kinder.length)).toEqual([3, 4, 4]);
    expect(schnittplanAus({ ...mit(0, { verifikationsweg: '' }), zuordnungen: DREI_THEMEN.zuordnungen.slice(1) }, n, [], REGELN, 4, true).art).toBe('ungueltig');
    // with a question with the person a note waits for the answer: no sections needed yet
    expect(fehler(mit(0, { verifikationsweg: '', fragen: [frage] }))).toBe('');
    expect(fehler(mit(0, { art: 'verworfen', fragen: [frage] }))).toContain('verworfen, aber eine Frage liegt beim Menschen');
    // `triage` stays without a change: no sections needed
    expect(fehler(mit(0, { art: 'triage', abnahmekriterien: '', verifikationsweg: '' }))).toBe('');
    // #146: `triage` without a question with the person gets one from the program, no invalid plan
    const t = schnittplanAus(mit(0, { art: 'triage', grund: 'Zu dünn' }), n, [], REGELN);
    expect(t.art === 'plan' && t.zuordnungen[0]).toMatchObject({ art: 'triage', fragenErgaenzt: true, fragen: [expect.objectContaining({ beim_menschen: true, marke: 'zu dünn', herkunft: 'Programm: Notiz in der Triage ohne Frage an den Menschen' })] });
    expect(t.art === 'plan' && t.zuordnungen[0].fragen).toHaveLength(1);
    expect(t.art === 'plan' && t.zuordnungen[1].fragenErgaenzt).toBeUndefined();
    // the question reads back in the form of the triage, an unknown mark becomes `ohne Marke`
    const p = schnittplanAus(mit(0, { fragen: [{ ...frage, marke: 'Wetter' }] }), n, [], REGELN);
    expect(p.art === 'plan' && p.zuordnungen[0].fragen).toEqual([{ ...frage, marke: 'ohne Marke' }]);
    // the new missions left in this run (an earlier package used some)
    expect(fehler(DREI_THEMEN)).toBe('');
    expect(schnittplanAus(DREI_THEMEN, n, [], REGELN, 2)).toEqual({ art: 'ungueltig', fehler: 'mehr als 2 neue Missionen (3)' });
    expect(schnittplanAuftrag(n, [], REGELN, 2)).toContain('höchstens 2 neue Missionen');
    // the schema asks for the questions of every note and offers the sections
    const zu = (schnittplanSchema() as any).properties.zuordnungen.items;
    expect(zu.required).toContain('fragen');
    expect(Object.keys(zu.properties)).toEqual(expect.arrayContaining(['fragen', 'abnahmekriterien', 'verifikationsweg']));
    expect(zu.properties.fragen.items.properties.marke.enum).toContain('Geld');
  });

  it('the order for the plan keeps a total budget however many and long the notes and missions are', () => {
    const lang = 'x'.repeat(10_000);
    const notizen = Array.from({ length: 200 }, (_, i) => ticket({ number: i + 1, title: `N ${i + 1}`, body: lang }));
    const missionen = Array.from({ length: 200 }, (_, i) => ({ nummer: 1000 + i, titel: `M ${i}`, body: lang, kinder: 0 }));
    const a = schnittplanAuftrag(notizen, missionen, REGELN);
    expect(a.length).toBeLessThan(200_000);
    // every note is still in it, each cut
    expect(nummernIn(a)).toHaveLength(200);
    expect(a).toContain('[gekürzt nach');
    // few notes keep their full length up to the limit per note
    expect(schnittplanAuftrag([ticket({ number: 1, title: 'N', body: 'y'.repeat(5_000) })], [], REGELN)).toContain('y'.repeat(5_000));
  });

  it('#148: a note with many comments keeps its text and the newest ones (a revocation), the oldest go with a note', () => {
    const alt = Array.from({ length: 30 }, (_, i) => ({ body: `ALT-${i} ${'z'.repeat(400)}`, autor: 'mensch', zeit: `2026-11-0${(i % 9) + 1}`, rolle: 'OWNER' }));
    const widerruf = { body: '**Widerruf des Menschen (Mensch über die Brücke)** — Nicht wieder in Mission #40', autor: 'flotte', zeit: '2026-11-22', rolle: 'OWNER' };
    const viel = (nr: number): Ticket => ({ ...ticket({ number: nr, title: `N ${nr}`, body: `TEXT-${nr} kurz` }), kommentare: [...alt, widerruf] });
    // many notes: each gets far less than its comments need
    const a = schnittplanAuftrag(Array.from({ length: 60 }, (_, i) => viel(i + 1)), [], REGELN);
    expect(a.length).toBeLessThan(200_000);
    for (const nr of [1, 30, 60]) {
      const teil = a.slice(a.indexOf(`## Sternzeit-Notiz #${nr}: `), a.indexOf(`## Sternzeit-Notiz #${nr + 1}: `) >>> 0);
      expect(teil).toContain(`TEXT-${nr} kurz`);
      expect(teil).toContain('Nicht wieder in Mission #40');
      expect(teil).not.toContain('ALT-0 ');
      expect(teil).toMatch(/\(\d+ ältere Kommentare ausgelassen\)/);
    }
    // within its share a note keeps every comment
    const wenig = schnittplanAuftrag([{ ...viel(1), kommentare: [...alt.slice(0, 5), widerruf] }], [], REGELN);
    expect(wenig).toContain('ALT-0 ');
    expect(wenig).not.toContain('ältere Kommentare ausgelassen');
  });

  it('an invalid plan changes nothing for the notes of this project; its repair is the only second call', async () => {
    const t = welt(ZWOELF, { ...DREI_THEMEN, zuordnungen: DREI_THEMEN.zuordnungen.slice(1) });
    const r = await triagiere(auftrag(), t.w);
    expect(schreibend(t.aufrufe)).toEqual([]);
    expect(t.geplant).toHaveLength(2);
    expect(r.schnittplan[0].aufrufe).toBe(2);
    expect(r.tickets).toEqual([]);
    expect(r.schnittplan[0].fehler).toContain('#1 ohne Zuordnung');
  });
});

describe('#146 Teilung erst über der Größengrenze, nach Thema', () => {
  const lang = 'x'.repeat(5_000);
  const THEMEN = ['Port', 'Tafel', 'Logbuch'];
  const DREISSIG = Array.from({ length: 30 }, (_, i) => ticket({ number: i + 1, title: `${THEMEN[i % 3]} Notiz ${i + 1}`, body: lang }));

  it('one package while the notes fit the budget of one order, however many there are', () => {
    expect(pakete(DREISSIG.slice(0, 12))).toEqual([DREISSIG.slice(0, 12)]);
    expect(pakete(ZWOELF.map(ticket))).toHaveLength(1);
    expect(pakete([])).toEqual([]);
  });

  it('above the budget: few packages, whole topics each, never one per note; a word in most titles names no topic', () => {
    const p = pakete(DREISSIG);
    expect(p).toHaveLength(2);
    for (const thema of THEMEN) expect(p.filter((x) => x.some((t) => t.titel.startsWith(thema)))).toHaveLength(1);
    expect(p.flat().map((t) => t.nummer).sort((a, b) => a - b)).toEqual(DREISSIG.map((t) => t.nummer));
    // within a package in the order of the notes
    for (const x of p) expect(x.map((t) => t.nummer)).toEqual([...x.map((t) => t.nummer)].sort((a, b) => a - b));
    // one topic larger than a package is cut in order, still into few packages
    const gross = pakete(Array.from({ length: 40 }, (_, i) => ticket({ number: i + 1, title: `Port ${i + 1}`, body: lang })));
    expect(gross).toHaveLength(2);
    expect(gross.every((x) => x.length > 1)).toBe(true);
  });
});

describe('#146 Schnittplan: offene Mission, verworfen, Duplikate', () => {
  const NOTIZ = { number: 21, title: 'Port auch für die Tafel prüfen', body: 'Wie bei der Portprüfung.' };

  it('a note fitting an open mission becomes its child instead of a new mission; a mission in a run or full is not offered', async () => {
    const missionen: Mission[] = [
      { number: 40, title: 'Portprüfung', body: 'Ports vor dem Start prüfen.', kinder: 3 },
      { number: 41, title: 'Läuft gerade', labels: ['status/in-arbeit'], kinder: 2 },
      { number: 42, title: 'Kinder nicht lesbar', kinder: null },
    ];
    const plan = { neue_missionen: [], zuordnungen: [{ notiz: 21, art: 'mission', mission: 40, grund: 'gleiches Thema wie #40', herkunft: 'Eigenes Urteil: Thema', ...KLAR }] };
    const t = welt([NOTIZ], plan, { missionen });
    const r = await triagiere(auftrag(), t.w);
    expect(t.geplant[0].auftrag).toContain('## Mission #40: Portprüfung (3 Missionsziele, noch 5 frei)');
    expect(t.geplant[0].auftrag).not.toContain('#41');
    expect(t.geplant[0].auftrag).not.toContain('#42');
    expect(r.schnittplan[0].neue_missionen).toEqual([]);
    expect(r.schnittplan[0].zuordnungen).toEqual([expect.objectContaining({ notiz: 21, art: 'mission', mission: 40 })]);
    // nothing closed; the child is cleared in the same call
    expect(schreibend(t.aufrufe).filter((x) => x.args[1] === 'close')).toEqual([]);
    expect(t.geplant).toHaveLength(1);
    expect(r.tickets.map((x) => [x.nummer, x.ergebnis])).toEqual([[21, 'klar']]);

    // the mission in a run, or one that would get a ninth child, is refused
    const n = [ticket(NOTIZ)];
    const offen = [{ nummer: 40, titel: 'Portprüfung', body: '', kinder: 8 }];
    const mit = (mission: number) => ({ ...plan, zuordnungen: [{ ...plan.zuordnungen[0], mission }] });
    expect(schnittplanAus(mit(41), n, offen, REGELN)).toMatchObject({ art: 'ungueltig' });
    expect(schnittplanAus(mit(40), n, offen, REGELN)).toEqual({ art: 'ungueltig', fehler: 'Mission #40 hätte mehr als 8 Missionsziele (8 + 1)' });
    expect(schnittplanAus(mit(40), n, [{ ...offen[0], kinder: 7 }], REGELN).art).toBe('plan');
  });

  it('a note without use is rejected: the comment with the reason first, then closed as not planned, never deleted', async () => {
    const plan = { neue_missionen: [], zuordnungen: [{ notiz: 21, art: 'verworfen', grund: 'Lohnt sich nicht: die Tafel hat keinen Port.', herkunft: 'Eigenes Urteil: kein Nutzen' }] };
    const t = welt([NOTIZ], plan);
    const r = await triagiere(auftrag(), t.w);
    const [k, c, ...rest] = schreibend(t.aufrufe);
    expect(rest).toEqual([]);
    expect(k.args.slice(0, 3)).toEqual(['issue', 'comment', '21']);
    expect(k.eingabe).toContain(TRIAGE_MARKE);
    expect(k.eingabe).toContain('Grund: Lohnt sich nicht');
    expect(k.eingabe).toContain('Herkunft: Eigenes Urteil: kein Nutzen');
    expect(k.eingabe).toMatch(/Widerrufbar/);
    expect(c.args).toEqual(['issue', 'close', '21', '--repo', 'o/r', '--reason', 'not planned']);
    expect(t.aufrufe.some((x) => x.args.includes('delete'))).toBe(false);
    expect(t.geplant).toHaveLength(1);
    expect(r.schnittplan[0].zuordnungen).toEqual([expect.objectContaining({ notiz: 21, art: 'verworfen', geschrieben: true })]);
    // without a reason the plan is invalid
    expect(schnittplanAus({ ...plan, zuordnungen: [{ ...plan.zuordnungen[0], grund: ' ' }] }, [ticket(NOTIZ)], [], REGELN).art).toBe('ungueltig');
  });

  it('when the comment fails, the note is not closed', async () => {
    const plan = { neue_missionen: [], zuordnungen: [{ notiz: 21, art: 'verworfen', grund: 'kein Nutzen', herkunft: 'Eigenes Urteil: x' }] };
    const t = welt([NOTIZ], plan, { kommentarScheitert: true });
    const r = await triagiere(auftrag(), t.w);
    expect(schreibend(t.aufrufe).map((x) => x.args[1])).toEqual(['comment']);
    expect(r.schnittplan[0].zuordnungen[0]).toMatchObject({ geschrieben: false, fehler: 'Kommentar gescheitert, nichts geändert' });
  });

  it('two duplicates: one stays, the other is closed with a comment pointing to it', async () => {
    const zwei = [
      { number: 30, title: 'Logbuch filtern', body: 'Filter im Logbuch.' },
      { number: 31, title: 'Filter fürs Logbuch', body: 'Das Logbuch braucht einen Filter.' },
    ];
    const plan = {
      neue_missionen: [],
      zuordnungen: [
        { notiz: 30, art: 'triage', grund: 'zu dünn für eine Mission', herkunft: 'Eigenes Urteil: eine Notiz' },
        { notiz: 31, art: 'zusammengefuehrt', in: 30, grund: 'dasselbe wie #30', herkunft: 'Präzedenz: #30' },
      ],
    };
    const t = welt(zwei, plan);
    const r = await triagiere(auftrag(), t.w);
    const fuer = (nr: number) => schreibend(t.aufrufe).filter((x) => x.args[2] === String(nr));
    const [k, c, ...rest] = fuer(31);
    expect(rest).toEqual([]);
    expect(k.eingabe).toContain('zusammengeführt in #30');
    expect(k.eingabe).toContain('Herkunft: Präzedenz: #30');
    expect(c.args).toEqual(['issue', 'close', '31', '--repo', 'o/r', '--reason', 'not planned']);
    // the one that stays is not closed and was cleared in the same call
    expect(fuer(30).some((x) => x.args[1] === 'close')).toBe(false);
    expect(t.geplant).toHaveLength(1);
    expect(r.tickets.map((x) => x.nummer)).toEqual([30]);
    expect(r.schnittplan[0].zuordnungen.map((z) => [z.notiz, z.art, z.in])).toEqual([[30, 'triage', undefined], [31, 'zusammengefuehrt', 30]]);
    // merged into a note that is closed itself, or into itself: invalid
    const n = zwei.map(ticket);
    expect(schnittplanAus({ ...plan, zuordnungen: [{ ...plan.zuordnungen[0], art: 'verworfen' }, plan.zuordnungen[1]] }, n, [], REGELN).art).toBe('ungueltig');
    expect(schnittplanAus({ ...plan, zuordnungen: [plan.zuordnungen[0], { ...plan.zuordnungen[1], in: 31 }] }, n, [], REGELN).art).toBe('ungueltig');
  });

  it('missions not readable: no plan, no call, nothing written', async () => {
    const t = welt([NOTIZ], { neue_missionen: [], zuordnungen: [] }, { missionenScheitern: true });
    const r = await triagiere(auftrag(), t.w);
    expect(t.geplant).toEqual([]);
    expect(schreibend(t.aufrufe)).toEqual([]);
    expect(r.schnittplan[0].fehler).toContain('offene Missionen nicht lesbar');
  });
});
