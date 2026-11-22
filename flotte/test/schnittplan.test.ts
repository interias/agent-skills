// #146: before the single clearing, the triage reads all open Sternzeit-Notizen of a project and the open
// missions together and cuts a plan in one admiral call: each note exactly once a child of an open mission,
// of a new mission, merged into another note, superfluous, rejected, or left in triage. The program checks
// the plan; an invalid one changes nothing. Closing: the comment with origin first, then `not planned`.

import { describe, expect, it } from 'vitest';
import { regelnAus } from '../src/befehle/auftrag.ts';
import { triagiere } from '../src/befehle/triage.ts';
import { schnittplanAuftrag, schnittplanAus, schnittplanSchema, type Ticket, TRIAGE_MARKE } from '../src/triage.ts';
import type { LaufErgebnis, Start } from '../src/werkzeuge/lauf.ts';

const REGELN = regelnAus('');
const KLAR = {
  entscheidung: 'klar',
  herkunft: 'Skill-Empfehlung',
  grund: 'Ziel und Prüfung sind klar.',
  fragen: [],
  abnahmekriterien: '- Es geht.',
  verifikationsweg: '`bun test`',
};

interface Aufruf {
  args: string[];
  eingabe?: string;
}
type Notiz = { number: number; title: string; body: string; labels?: string[]; rolle?: string };
type Mission = { number: number; title: string; body?: string; labels?: string[]; kinder?: number | null };

function welt(notizen: Notiz[], plan: unknown, o: { missionen?: Mission[]; kommentarScheitert?: boolean; missionenScheitern?: boolean } = {}) {
  const aufrufe: Aufruf[] = [];
  const einzeln: Start[] = [];
  const geplant: Start[] = [];
  const missionen = o.missionen ?? [];
  return {
    aufrufe,
    einzeln,
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
          const nr = Number(/issues\/(\d+)$/.exec(args[1])?.[1]);
          const m = missionen.find((x) => x.number === nr);
          if (m) return m.kinder === null ? { code: 1, stdout: '', stderr: 'HTTP 404' } : { code: 0, stdout: `${m.kinder ?? 0}\n`, stderr: '' };
          return { code: 0, stdout: `${notizen.find((t) => t.number === nr)?.rolle ?? 'OWNER'}\n`, stderr: '' };
        }
        if (args[0] === 'issue' && args[1] === 'comment' && o.kommentarScheitert) return { code: 1, stdout: '', stderr: 'nein' };
        return { code: 0, stdout: '', stderr: '' };
      },
      starte: async (s: Start): Promise<LaufErgebnis> => {
        if (s.auftrag.startsWith('FLOTTE-SCHNITTPLAN')) {
          geplant.push(s);
          return { code: 0, sitzung: 'plan', dauerMs: 1000, strukturiert: plan } as LaufErgebnis;
        }
        einzeln.push(s);
        return { code: 0, sitzung: 's', dauerMs: 1000, strukturiert: KLAR } as LaufErgebnis;
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
  zuordnungen: ZWOELF.map((n, i) => ({ notiz: n.number, art: 'neue_mission', neue_mission: ['port', 'tafel', 'logbuch'][Math.floor(i / 4)], grund: 'gleiches Thema' })),
};
const ticket = (n: Notiz): Ticket => ({ nummer: n.number, titel: n.title, body: n.body, url: '', labels: ['needs-triage'], kommentare: [] });

describe('#146 Schnittplan: 12 Notizen zu 3 Themen', () => {
  it('cuts three new missions, none over 8 children, every note assigned exactly once, in one admiral call', async () => {
    const t = welt(ZWOELF, DREI_THEMEN);
    const r = await triagiere(auftrag(true), t.w);
    expect(t.geplant).toHaveLength(1);
    expect(nummernIn(t.geplant[0].auftrag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(t.geplant[0].extraArgs).toEqual(['--json-schema', JSON.stringify(schnittplanSchema()), '--tools', 'Read,Grep,Glob']);
    const [p] = r.schnittplan;
    expect(p.fehler).toBeUndefined();
    expect(p.neue_missionen.map((m) => [m.titel, m.kinder])).toEqual([['Portprüfung', [1, 2, 3, 4]], ['Tafel', [5, 6, 7, 8]], ['Logbuch', [9, 10, 11, 12]]]);
    expect(p.zuordnungen.map((z) => z.notiz).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // --trocken: nothing written
    expect(schreibend(t.aufrufe)).toEqual([]);
  });

  it('a plan over the limits, missing or doubling a note, or naming an unknown one is invalid', () => {
    const n = ZWOELF.map(ticket);
    expect(schnittplanAus(DREI_THEMEN, n, []).art).toBe('plan');
    const fehler = (x: unknown) => { const p = schnittplanAus(x, n, []); return p.art === 'ungueltig' ? p.fehler : ''; };
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

  it('the order for the plan keeps a total budget however many and long the notes and missions are', () => {
    const lang = 'x'.repeat(10_000);
    const notizen = Array.from({ length: 200 }, (_, i) => ticket({ number: i + 1, title: `N ${i + 1}`, body: lang }));
    const missionen = Array.from({ length: 200 }, (_, i) => ({ nummer: 1000 + i, titel: `M ${i}`, body: lang, kinder: 0 }));
    const a = schnittplanAuftrag(notizen, missionen);
    expect(a.length).toBeLessThan(200_000);
    // every note is still in it, each cut
    expect(nummernIn(a)).toHaveLength(200);
    expect(a).toContain('[gekürzt nach');
    // few notes keep their full length up to the limit per note
    expect(schnittplanAuftrag([ticket({ number: 1, title: 'N', body: 'y'.repeat(5_000) })], [])).toContain('y'.repeat(5_000));
  });

  it('an invalid plan changes nothing and runs no single clearing for the notes of this project', async () => {
    const t = welt(ZWOELF, { ...DREI_THEMEN, zuordnungen: DREI_THEMEN.zuordnungen.slice(1) });
    const r = await triagiere(auftrag(), t.w);
    expect(schreibend(t.aufrufe)).toEqual([]);
    expect(t.einzeln).toEqual([]);
    expect(r.schnittplan[0].fehler).toContain('#1 ohne Zuordnung');
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
    const plan = { neue_missionen: [], zuordnungen: [{ notiz: 21, art: 'mission', mission: 40, grund: 'gleiches Thema wie #40', herkunft: 'Eigenes Urteil: Thema' }] };
    const t = welt([NOTIZ], plan, { missionen });
    const r = await triagiere(auftrag(), t.w);
    expect(t.geplant[0].auftrag).toContain('## Mission #40: Portprüfung (3 Kinder, noch 5 frei)');
    expect(t.geplant[0].auftrag).not.toContain('#41');
    expect(t.geplant[0].auftrag).not.toContain('#42');
    expect(r.schnittplan[0].neue_missionen).toEqual([]);
    expect(r.schnittplan[0].zuordnungen).toEqual([expect.objectContaining({ notiz: 21, art: 'mission', mission: 40 })]);
    // nothing closed; the child goes on to the single clearing as before
    expect(schreibend(t.aufrufe).filter((x) => x.args[1] === 'close')).toEqual([]);
    expect(t.einzeln).toHaveLength(1);
    expect(r.tickets.map((x) => [x.nummer, x.ergebnis])).toEqual([[21, 'klar']]);

    // the mission in a run, or one that would get a ninth child, is refused
    const n = [ticket(NOTIZ)];
    const offen = [{ nummer: 40, titel: 'Portprüfung', body: '', kinder: 8 }];
    const mit = (mission: number) => ({ ...plan, zuordnungen: [{ ...plan.zuordnungen[0], mission }] });
    expect(schnittplanAus(mit(41), n, offen)).toMatchObject({ art: 'ungueltig' });
    expect(schnittplanAus(mit(40), n, offen)).toEqual({ art: 'ungueltig', fehler: 'Mission #40 hätte mehr als 8 Kinder (8 + 1)' });
    expect(schnittplanAus(mit(40), n, [{ ...offen[0], kinder: 7 }]).art).toBe('plan');
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
    expect(t.einzeln).toEqual([]);
    expect(r.schnittplan[0].zuordnungen).toEqual([expect.objectContaining({ notiz: 21, art: 'verworfen', geschrieben: true })]);
    // without a reason the plan is invalid
    expect(schnittplanAus({ ...plan, zuordnungen: [{ ...plan.zuordnungen[0], grund: ' ' }] }, [ticket(NOTIZ)], []).art).toBe('ungueltig');
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
    // the one that stays is not closed and goes on to the single clearing
    expect(fuer(30).some((x) => x.args[1] === 'close')).toBe(false);
    expect(t.einzeln.map((s) => /Sternzeit-Notiz #(\d+)/.exec(s.auftrag)?.[1])).toEqual(['30']);
    expect(r.schnittplan[0].zuordnungen.map((z) => [z.notiz, z.art, z.in])).toEqual([[30, 'triage', undefined], [31, 'zusammengefuehrt', 30]]);
    // merged into a note that is closed itself, or into itself: invalid
    const n = zwei.map(ticket);
    expect(schnittplanAus({ ...plan, zuordnungen: [{ ...plan.zuordnungen[0], art: 'verworfen' }, plan.zuordnungen[1]] }, n, []).art).toBe('ungueltig');
    expect(schnittplanAus({ ...plan, zuordnungen: [plan.zuordnungen[0], { ...plan.zuordnungen[1], in: 31 }] }, n, []).art).toBe('ungueltig');
  });

  it('missions not readable: no plan, nothing written, no single clearing', async () => {
    const t = welt([NOTIZ], { neue_missionen: [], zuordnungen: [] }, { missionenScheitern: true });
    const r = await triagiere(auftrag(), t.w);
    expect(t.geplant).toEqual([]);
    expect(t.einzeln).toEqual([]);
    expect(schreibend(t.aufrufe)).toEqual([]);
    expect(r.schnittplan[0].fehler).toContain('offene Missionen nicht lesbar');
  });
});
