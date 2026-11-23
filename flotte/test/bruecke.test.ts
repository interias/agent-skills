// The driver and the Flottenbrücke (#28): report per turn, answers fetched and acknowledged, the
// shared contract flottenbruecke/beispiel/*.json, a bridge that is off, the raw-text fallback.

import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../src/aufruf.ts';
import { anhalten, einstellungAus, fahre } from '../src/treiber/treiber.ts';
import { existsSync, rmSync } from 'node:fs';
import { kurzname } from '../src/werkzeuge/konten.ts';
import { flotteDir, leer, lebt, neuesEpic, schreibe as schreibeZustand, startZeit } from '../src/werkzeuge/zustand.ts';
import { spawn } from 'node:child_process';
import { antwortenAusJson, antwortZeile, type Bericht, type BrueckenAntwort, type BrueckenHandlung, handlungenAusJson } from '../src/treiber/bruecke.ts';
import { admiral, aufbau, drehbuch, ende, frage, gateGefahren, lauf } from './flotte-welt.ts';
import { regelnAus } from '../src/befehle/auftrag.ts';
import type { TicketErgebnis, triagiere } from '../src/befehle/triage.ts';
import { type Entscheidung, entscheidungAus, lernTriageKommentar, lernvorschlaege, type Ticket, TRIAGE_MARKE, triageKommentar, wartetAufAntwort } from '../src/triage.ts';
import { lernKommentar } from '../src/lernen.ts';

const T = 30_000;
const beispiel = (datei: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../flottenbruecke/beispiel/${datei}`, import.meta.url)), 'utf8'));

type Wunsch = Pick<BrueckenHandlung, 'epic' | 'art'> & Partial<Pick<BrueckenHandlung, 'nr' | 'seit' | 'text'>>;

/**
 * A stand-in bridge: keeps the reports, answers what antwort() returns for an open question and
 * offers each action that handlung() returns for a report once.
 */
async function attrappe(antwort: (f: Bericht['fragen'][number]) => Omit<BrueckenAntwort, 'id' | 'epic' | 'nr' | 'seit' | 'zeit' | 'herkunft'> | null, o: { quittungFehlt?: number; handlung?: (b: Bericht) => Wunsch | null; handlungDoppelt?: boolean } = {}) {
  const berichte: Bericht[] = [];
  const offen = new Map<number, BrueckenAntwort>();
  const quittungen: number[] = [];
  const handlungen = new Map<number, BrueckenHandlung>();
  const gewuenscht = new Set<string>();
  const hQuittungen: number[] = [];
  let hId = 100;
  let id = 0;
  let fehlt = o.quittungFehlt ?? 0;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (x: unknown, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(x));
      };
      if (req.method === 'POST' && req.url === '/api/bericht') {
        const b = JSON.parse(body) as Bericht;
        berichte.push(b);
        for (const f of b.fragen) {
          if ([...offen.values()].some((a) => a.epic === f.epic && a.nr === f.nr && a.seit === f.seit) || quittungen.length) continue;
          const a = antwort(f);
          if (a) offen.set(++id, { id, epic: f.epic, nr: f.nr, seit: f.seit, zeit: new Date().toISOString(), herkunft: 'Mensch über die Brücke', ...a });
        }
        const h = o.handlung?.(b);
        if (h && !gewuenscht.has(JSON.stringify(h))) {
          gewuenscht.add(JSON.stringify(h));
          handlungen.set(++hId, { id: hId, nr: null, seit: null, text: null, zeit: new Date().toISOString(), herkunft: 'Mensch über die Brücke', ...h });
        }
        return json({ ok: true });
      }
      if (req.method === 'GET' && req.url?.startsWith('/api/antworten')) return json([...offen.values()]);
      if (req.method === 'GET' && req.url?.startsWith('/api/handlungen')) return json([...handlungen.values()]);
      const hq = /^\/api\/handlungen\/(\d+)\/quittung$/.exec(req.url ?? '');
      if (req.method === 'POST' && hq) {
        // handlungDoppelt: the first acknowledgement is lost, the driver gets the action again
        if (o.handlungDoppelt && !hQuittungen.includes(-Number(hq[1]))) {
          hQuittungen.push(-Number(hq[1]));
          return json({ detail: 'kaputt' }, 500);
        }
        handlungen.delete(Number(hq[1]));
        hQuittungen.push(Number(hq[1]));
        return json({ ok: true });
      }
      const q = /^\/api\/antworten\/(\d+)\/quittung$/.exec(req.url ?? '');
      if (req.method === 'POST' && q) {
        if (fehlt-- > 0) return json({ detail: 'kaputt' }, 500);
        offen.delete(Number(q[1]));
        quittungen.push(Number(q[1]));
        return json({ ok: true });
      }
      json({ detail: 'nicht da' }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, berichte, quittungen, hQuittungen, zu: () => new Promise<void>((r) => server.close(() => r())) };
}

const schluessel = (o: object) => Object.keys(o).sort();

describe('Flottenbrücke (#28)', () => {
  it('reads the answers of the contract and gives the free text unchanged after Antwort:', () => {
    const liste = antwortenAusJson(beispiel('antworten.json'));
    expect(liste).toHaveLength(3);
    expect(liste.map(antwortZeile)).toEqual(['A — Antwort: config/ ist richtig, aber ohne Unterordner', 'Antwort: protokoll — klein geschrieben, wie die anderen Schlüssel', 'A, C, I']);
    expect(antwortZeile({ option: 'B', text: null })).toBe('B');
    expect(antwortenAusJson([{ id: 1, epic: 2, nr: 1, seit: 'x', option: null, text: '  ' }, { kaputt: true }, 'x'])).toEqual([]);
  });

  it('names accounts Konto <n> by the table, else by folder, never by path', () => {
    const tafel = { '1': '/h/.claude', '2': '/h/.claude-arbeitspferd' };
    expect(kurzname(resolve('/h/.claude-arbeitspferd'), null, tafel)).toBe('Konto 2');
    expect(kurzname(resolve('/x/fremd'), null, tafel)).toBe('fremd');
    expect(kurzname(resolve('/x/fremd'), resolve('/x/fremd'), tafel)).toBe('Admiral-Konto');
  });

  it('takes the bridge from --bruecke or FLOTTE_BRUECKE', () => {
    const git: Aufrufer = (_p, args) => ({ code: 0, stdout: args.includes('get-url') ? 'https://github.com/o/r.git\n' : '/r/.git\n', stderr: '' });
    expect(einstellungAus(['/r', '--konten', '/k', '--bruecke', 'http://127.0.0.1:4747'], '/r', git).bruecke).toBe('http://127.0.0.1:4747');
    expect(() => einstellungAus(['/r', '--konten', '/k', '--bruecke', 'bruecke'], '/r', git)).toThrow(/eine URL/);
    process.env.FLOTTE_BRUECKE = 'http://bruecke:4747';
    try {
      expect(einstellungAus(['/r', '--konten', '/k'], '/r', git).bruecke).toBe('http://bruecke:4747');
    } finally {
      delete process.env.FLOTTE_BRUECKE;
    }
  });

  it('a question for the person: full on the board, answered there, the run goes on with exactly this answer; fetched twice it counts once', async () => {
    const b = await attrappe(() => ({ option: 'B', text: 'mit Testdaten, siehe #5' }), { quittungFehlt: 1 });
    try {
      const t = aufbau();
      const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe).toHaveLength(2);
      expect(laeufe[1].eingabe).toMatch(/Antworten des Menschen[\s\S]*\n1\. B — Antwort: mit Testdaten, siehe #5$/);
      const kommentare = t.p.kommentare.filter((k) => k.nr === 3 && k.text.startsWith('**Antwort des Menschen'));
      expect(kommentare).toHaveLength(1);
      expect(kommentare[0].text).toMatch(/\nAntwort: B — mit Testdaten, siehe #5\nHerkunft: Mensch über die Brücke$/);
      expect(z.epics['3'].stufe).toBe('fertig');
      expect(z.fragen[0]).toMatchObject({ beantwortet: 'B — Antwort: mit Testdaten, siehe #5', brueckeId: 1, lage: 'Sachverhalt', optionen: [{ buchstabe: 'A', text: 'vorsichtig' }, { buchstabe: 'B', text: 'riskant' }], betrifft: 'Lauf' });
      expect(z.fragen[0].roh).toMatch(/^1\. Frage 1 zu #3\?/);
      expect(b.quittungen).toEqual([1]);
      // the board saw the question complete, with the contract's fields
      const mitFrage = b.berichte.find((x) => x.fragen.length)!;
      expect(mitFrage.fragen[0]).toMatchObject({ epic: 3, nr: 1, frage: 'Frage 1 zu #3?', lage: 'Sachverhalt', empfehlung: 'A', betrifft: 'Lauf', ganzerLauf: true });
      expect(b.berichte.at(-1)!.fragen).toEqual([]);
    } finally {
      await b.zu();
    }
  }, T);

  it('reports in the shape of beispiel/bericht.json, accounts by short name, never a path', async () => {
    const b = await attrappe(() => null);
    try {
      const t = aufbau();
      const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'p2' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }]), lauf(3, [{ text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url, maxDauerMs: 3000 }), t.welt);
      const muster = beispiel('bericht.json');
      const mitFrage = b.berichte.find((x) => x.fragen.length)!;
      expect(schluessel(mitFrage)).toEqual(schluessel(muster));
      // `plaetze` (#51) only with Agent calls in the log: the sample has them, this run has none
      expect(schluessel(mitFrage.epics[0])).toEqual(schluessel(muster.epics[1]).filter((k) => k !== 'plaetze'));
      expect(schluessel(mitFrage.fragen[0])).toEqual(schluessel(muster.fragen[0]));
      expect(schluessel(mitFrage.konten[0])).toEqual(schluessel(muster.konten[0]));
      expect(schluessel(mitFrage.ereignisse[0])).toEqual(schluessel(muster.ereignisse[0]));
      expect(schluessel(mitFrage.ram!)).toEqual(schluessel(muster.ram));
      expect(schluessel(mitFrage.platte!)).toEqual(schluessel(muster.platte));
      // #58: every setting with its limits or its choice of accounts, in the order of the sample
      expect(mitFrage.einstellungen.map(schluessel)).toEqual(muster.einstellungen.map(schluessel));
      expect(mitFrage.forge).toBe('o/r');
      for (const x of b.berichte) {
        expect(JSON.stringify(x)).not.toContain(t.konten[0].replaceAll('\\', '\\\\'));
        for (const k of x.konten) expect(['gruen', 'gelb', 'rot']).toContain(k.stufe);
      }
      expect(b.berichte.at(-1)!.aktiv).toBe(false);
      expect(mitFrage.leerlaufS).toBe(20);
      expect(b.berichte.some((x) => x.epics[0].prozess)).toBe(true);
      // the person sees why the question lies with them
      expect(mitFrage.fragen[0]).toMatchObject({ herkunft: 'Skill-Empfehlung', geparkt: ['p2'], ganzerLauf: false });
    } finally {
      await b.zu();
    }
  }, T);

  it('the sessions of the accounts go into the report in the shape of beispiel/bericht.json, by folder name only (#41)', async () => {
    const b = await attrappe(() => null);
    try {
      const t = aufbau();
      const dirs: (string | undefined)[] = [];
      const welt = {
        ...t.welt,
        langsam: async (p: string, a: string[], o?: { env?: Record<string, string> }) => {
          if (p !== 'claude') return t.welt.langsam(p, a, o as never);
          dirs.push(o?.env?.CLAUDE_CONFIG_DIR);
          const cwd = 'C:\\Users\\beispiel\\git\\flotte-probe';
          return { code: 0, stdout: JSON.stringify([{ pid: 4242, cwd, kind: 'interactive', startedAt: Date.parse('2026-11-20T12:02:00Z'), sessionId: 'abc-123', name: 'flotte-probe-ab', status: 'busy' }]), stderr: '' };
        },
      };
      const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'p2' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }]), lauf(3, [{ text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url, maxDauerMs: 3000 }), welt);
      const muster = beispiel('bericht.json');
      expect(b.berichte[0].sitzungen).toEqual([]);
      const mit = b.berichte.find((x) => x.sitzungen.length)!;
      expect(schluessel(mit.sitzungen[0])).toEqual(schluessel(muster.sitzungen[0]));
      expect(mit.sitzungen).toHaveLength(t.konten.length);
      expect(mit.sitzungen.map((s) => s.konto)).toEqual(mit.konten.map((k) => k.konto));
      expect(mit.sitzungen[0]).toMatchObject({ projekt: 'flotte-probe', name: 'flotte-probe-ab', status: 'busy', kind: 'interactive' });
      // one reading per minute at most, not one per turn
      expect(dirs).toHaveLength(t.konten.length);
      for (const x of b.berichte) expect(JSON.stringify(x.sitzungen)).not.toMatch(/beispiel|Users|4242|abc-123/);
    } finally {
      await b.zu();
    }
  }, T);

  it('a multiple choice with five options: on the board with mehrfach, the answer reaches the run as A, C, E; reported and fetched at once, not only with the turn', async () => {
    const optionen = 'A) Deutsch B) Englisch C) Französisch D) Spanisch E) Italienisch';
    const block = `Bericht.\n\nFLOTTE-FRAGE 3 tor\n1. In welchen Sprachen? — Betrifft: Lauf — Lage: mehrere möglich — Optionen: ${optionen} — Auswahl: mehrere — Empfehlung: A, B — Grund: Besucher — Regel/Quelle: Skill\nSTAND: Tor  TAFEL: -`;
    const b = await attrappe((f) => (f.mehrfach && f.optionen.length === 5 ? { option: 'A, C, E', text: null } : null));
    try {
      const t = aufbau();
      const buch = drehbuch([lauf(3, [{ text: block }]), admiral(3, [{ nr: 1, antwort: 'A, B', beim_menschen: true }]), lauf(3, [{ text: ende(3, 13) }])]);
      const anfang = Date.now();
      // a tick of ten minutes: only the report on the event and the short polling bring the answer before it
      // (#164: the bound is the tick itself, far from the few seconds this takes; the test's own limit guards a hang)
      const TAKT = 600_000;
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url, taktMs: TAKT, brueckeAbfrageMs: 100 }), t.welt);
      expect(Date.now() - anfang).toBeLessThan(TAKT);
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe[1].eingabe).toMatch(/\n1\. A, C, E$/);
      expect(z.fragen[0]).toMatchObject({ mehrfach: true, empfehlung: 'A, B', beantwortet: 'A, C, E' });
      const mitFrage = b.berichte.find((x) => x.fragen.length)!;
      expect(mitFrage.fragen[0].mehrfach).toBe(true);
      expect(mitFrage.fragen[0].optionen.map((o) => o.buchstabe)).toEqual(['A', 'B', 'C', 'D', 'E']);
    } finally {
      await b.zu();
    }
  }, 120_000);

  it('a bridge that is off: the driver works on, one event', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { bruecke: 'http://127.0.0.1:9' }), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(t.p.meldungen.filter((m) => /Flottenbrücke nicht erreichbar/.test(m))).toHaveLength(1);
  }, T);

  it('#152: a block that does not parse goes to the admiral first; he decides, the person is not asked', async () => {
    const roh = 'FLOTTE-FRAGE 3 tor\nIch weiß nicht weiter: Datei anlegen oder nicht?\nSTAND: Tor';
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: `Bericht.\n\n${roh}` }]), admiral(3, [{ nr: 1, antwort: 'Leg sie an.', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    const an = buch.gesehen().find((g) => g.eingabe.startsWith('FLOTTE-ADMIRAL'))!;
    expect(an.eingabe).toContain('Ich weiß nicht weiter: Datei anlegen oder nicht?');
    // the order of the run names the question line in its wording
    expect(buch.gesehen()[0].eingabe).toContain('jede in einer Zeile: `1. <Frage> — Betrifft: <Pakete | Lauf> — Lage: … — Optionen: A) … B) … — Empfehlung: <Buchstabe>');
    expect(buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe))[1].eingabe).toMatch(/Antwort des Admirals auf FLOTTE-FRAGE tor:\n1\. Antwort: Leg sie an\./);
    expect(z.fragen).toEqual([]);
    expect(t.p.kommentare.some((k) => k.nr === 3 && /FRAGE AN DEN MENSCHEN/.test(k.text))).toBe(false);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('a block that does not parse and the admiral names a point for the person: the wording goes to the person, a free-text answer reaches the run unchanged', async () => {
    const roh = 'FLOTTE-FRAGE 3 tor\nIch weiß nicht weiter: Datei anlegen oder nicht?\nSTAND: Tor';
    const b = await attrappe((f) => (f.frage === '' && f.roh.includes('Ich weiß nicht weiter') ? { option: null, text: 'Leg sie an.' } : null));
    try {
      const t = aufbau();
      const buch = drehbuch([lauf(3, [{ text: `Bericht.\n\n${roh}` }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(buch.gesehen().filter((g) => g.eingabe.startsWith('FLOTTE-ADMIRAL'))).toHaveLength(1);
      expect(laeufe[1].eingabe).toMatch(/1\. liegt beim Menschen[\s\S]*\n1\. Antwort: Leg sie an\.$/);
      expect(t.p.kommentare.some((k) => k.nr === 3 && k.text.includes('Ich weiß nicht weiter'))).toBe(true);
      expect(z.fragen[0]).toMatchObject({ frage: '', roh, beantwortet: 'Antwort: Leg sie an.' });
      expect(z.epics['3'].stufe).toBe('fertig');
    } finally {
      await b.zu();
    }
  }, T);

  it('reads the actions of the contract; a revocation needs its decision and text', () => {
    const liste = handlungenAusJson(beispiel('handlungen.json'));
    expect(liste.map((h) => [h.epic, h.art, h.nr])).toEqual([
      [40, 'einreihen', null],
      [38, 'widerruf', 1],
      [0, 'einstellen', null],
      [43, 'aufnehmen', null],
      [38, 'pausieren', null],
      [39, 'fortsetzen', null],
      [41, 'prioritaet', null],
      [38, 'merge', null],
      // #116: the Frachtraum
      [0, 'triage', null],
      [61, 'triage-antwort', 1],
      [58, 'triage-widerruf', null],
      // #148: a mission of the cut plan
      [70, 'schnitt-widerruf', null],
    ]);
    expect(liste.find((h) => h.art === 'merge')!.text).toBe('mensch');
    expect(liste.find((h) => h.art === 'prioritaet')!.text).toBe('hoch');
    expect(handlungenAusJson([{ id: 1, epic: 2, art: 'widerruf', nr: 1, seit: 'x', text: ' ' }, { id: 2, epic: 2, art: 'loeschen' }, null])).toEqual([]);
    // #61: the epic actions need an epic; prioritaet carries its value as text (the driver checks it)
    expect(handlungenAusJson([{ id: 3, epic: 0, art: 'pausieren' }, { id: 4, epic: 0, art: 'aufnehmen' }, { id: 5, epic: 2, art: 'prioritaet', text: null }, { id: 6, epic: 0, art: 'merge', text: 'mensch' }])).toEqual([]);
    // #112: back to the proposal is merge without text
    expect(handlungenAusJson([{ id: 7, epic: 2, art: 'merge', text: null }])).toHaveLength(1);
    // #116: triage belongs to the project (epic 0), an answer needs its question, a revocation its decision and the objection
    expect(handlungenAusJson([{ id: 8, epic: 3, art: 'triage' }, { id: 9, epic: 61, art: 'triage-antwort', nr: null, seit: 'x', text: '{}' }, { id: 10, epic: 58, art: 'triage-widerruf', nr: null, seit: 'x', text: ' ' }])).toEqual([]);
    // #148: a revocation of a mission needs the mission and the objection
    expect(handlungenAusJson([{ id: 11, epic: 0, art: 'schnitt-widerruf', text: 'x' }, { id: 12, epic: 70, art: 'schnitt-widerruf', text: ' ' }])).toEqual([]);
  });

  it('usage per account: both windows with reset in the report', async () => {
    const b = await attrappe(() => null);
    try {
      const t = aufbau();
      const buch = drehbuch([lauf(3, [{ verbrauch: [0.42, 0.61] }, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      const k = b.berichte.at(-1)!.konten[0];
      expect(k.fuenf?.verbraucht).toBe(42);
      expect(k.woche?.verbraucht).toBe(61);
      expect(Date.parse(k.fuenf!.reset)).toBeGreaterThan(Date.now());
    } finally {
      await b.zu();
    }
  }, T);

  it('the reason of a braked account goes into the report, cut to the length the bridge takes; a green account has none', async () => {
    const b = await attrappe(() => null);
    try {
      const t = aufbau();
      // 90 % used in the 5-hour window: red, with a reason; the other accounts stay green or red by their own value
      const buch = drehbuch([lauf(3, [{ verbrauch: [0.9, 0.2] }, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      const konten = b.berichte.at(-1)!.konten;
      const rot = konten.find((k) => k.stufe === 'rot');
      expect(rot?.grund).toMatch(/verbraucht 90 %/);
      expect(rot!.grund!.length).toBeLessThanOrEqual(4000);
      for (const k of konten) expect('grund' in k).toBe(k.stufe !== 'gruen');
    } finally {
      await b.zu();
    }
  }, T);

  it('a blocked epic requeued on the bridge: the run continues where it stopped; fetched twice it acts once', async () => {
    const b = await attrappe(() => null, { handlung: (x) => (x.epics.find((e) => e.nr === 3)?.stufe === 'blockiert' ? { epic: 3, art: 'einreihen' } : null), handlungDoppelt: true });
    try {
      const t = aufbau();
      const abgemeldet = { zeile: { type: 'result', subtype: 'success', is_error: true, result: 'Please run /login' } };
      const buch = drehbuch([lauf(3, [abgemeldet], 1), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url, dauerhaft: true, maxDauerMs: 4000 }), t.welt);
      const blockiert = b.berichte.find((x) => x.epics[0].stufe === 'blockiert')!.epics[0];
      expect(blockiert.grund).toMatch(/nicht angemeldet/);
      expect(blockiert.haltZeit).toBeTruthy();
      expect(blockiert.log.some((l) => /blockiert/.test(l))).toBe(true);
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe).toHaveLength(2);
      expect(laeufe[1].eingabe).toMatch(/neu eingereiht\. Grund der Blockade war: Konto .* ist nicht angemeldet/);
      expect(z.epics['3'].stufe).toBe('fertig');
      expect(t.p.kommentare.filter((k) => k.nr === 3 && k.text.startsWith('**Epic neu eingereiht vom Menschen'))).toHaveLength(1);
      expect(b.hQuittungen.filter((x) => x > 0)).toEqual([101]);
    } finally {
      await b.zu();
    }
  }, T);

  it('#54: requeued with an open question of the run, the order names it as open and not to be decided by the run', async () => {
    const b = await attrappe(() => null, { handlung: (x) => (x.epics.find((e) => e.nr === 3)?.stufe === 'blockiert' ? { epic: 3, art: 'einreihen' } : null) });
    try {
      const t = aufbau();
      const buch = drehbuch([
        lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'P2' }]) }]),
        admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }]),
        lauf(3, [{ text: 'Aufgeräumt.', verweigert: [{ tool_name: 'Bash', tool_input: { command: 'rm -rf tmp' } }] }]),
        lauf(3, [{ text: ende(3, 13) }]),
      ]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url, dauerhaft: true, maxDauerMs: 4000 }), t.welt);
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe).toHaveLength(3);
      expect(laeufe[2].eingabe).toMatch(/neu eingereiht\. Grund der Blockade war: Erlaubnis verweigert: Bash/);
      expect(laeufe[2].eingabe).toContain('\nOffen und ohne Antwort des Menschen:\n1. Frage 1 zu #3?\nEntscheide sie nicht selbst. Stelle sie im nächsten FLOTTE-FRAGE erneut.');
      expect(z.fragen.filter((f) => f.epic === 3 && !f.beantwortet)).toHaveLength(1);
    } finally {
      await b.zu();
    }
  }, T);

  it('#135: every mission blocked, no --dauerhaft: the driver stays in the deployment, a later requeue continues the run', async () => {
    let blockiertSeit = 0;
    const b = await attrappe(() => null, {
      handlung: (x) => {
        if (x.epics.find((e) => e.nr === 3)?.stufe !== 'blockiert') return null;
        blockiertSeit ||= Date.now();
        // the person comes back later, well after the next tick
        return Date.now() - blockiertSeit > 800 ? { epic: 3, art: 'einreihen' } : null;
      },
    });
    try {
      const t = aufbau();
      const abgemeldet = { zeile: { type: 'result', subtype: 'success', is_error: true, result: 'Please run /login' } };
      const buch = drehbuch([lauf(3, [abgemeldet], 1), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url, maxDauerMs: 8000 }), t.welt);
      expect(buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe))).toHaveLength(2);
      expect(z.epics['3'].stufe).toBe('fertig');
      expect(z.ereignisse.filter((e) => /bleibt im Einsatz: #3 blockiert/.test(e.text))).toHaveLength(1);
      expect(z.ereignisse.some((e) => /Zeitgrenze/.test(e.text))).toBe(false);
    } finally {
      await b.zu();
    }
  }, T);

  it('#135: a blocked mission given up on the bridge: then the deployment ends', async () => {
    const b = await attrappe(() => null, { handlung: (x) => (x.epics[0]?.stufe === 'blockiert' ? { epic: 3, art: 'aufgeben' } : null) });
    try {
      const t = aufbau();
      const abgemeldet = { zeile: { type: 'result', subtype: 'success', is_error: true, result: 'Please run /login' } };
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [abgemeldet], 1)]), [3], { bruecke: b.url, maxDauerMs: 8000 }), t.welt);
      expect(z.epics['3']).toMatchObject({ stufe: 'abgebrochen' });
      expect(z.ereignisse.some((e) => /^Einsatz beendet/.test(e.text))).toBe(true);
      expect(z.ereignisse.some((e) => /Zeitgrenze/.test(e.text))).toBe(false);
    } finally {
      await b.zu();
    }
  }, T);

  it('#133: requeued after an order edge to an open epic was added: waiting with the session dropped, no resume', async () => {
    const bodies: Record<number, string> = { 3: '## Betroffene Module\n- a', 4: '## Betroffene Module\n- b' };
    const b = await attrappe(() => null, {
      handlung: (x) => {
        if (x.epics.find((e) => e.nr === 3)?.stufe !== 'blockiert') return null;
        // the person adds the edge to the blocked epic, then requeues it
        bodies[3] = '> **Reihenfolge:** nach #4\n\n## Betroffene Module\n- a';
        return { epic: 3, art: 'einreihen' };
      },
    });
    try {
      const t = aufbau({ bodies, pr: () => ({ state: 'OPEN' }) });
      const abgemeldet = { zeile: { type: 'result', subtype: 'success', is_error: true, result: 'Please run /login' } };
      const buch = drehbuch([lauf(3, [abgemeldet], 1), lauf(3, [{ text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
      const z = await fahre(t.einstellung(buch, [3, 4], { bruecke: b.url, dauerhaft: true, maxDauerMs: 4000 }), t.welt);
      expect(buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe))).toHaveLength(1);
      expect(z.epics['3']).toMatchObject({ stufe: 'wartend', sitzung: null, konto: null, notiz: 'wartet auf den Merge von #4' });
      expect(z.ereignisse.some((e) => e.epic === 3 && /neu eingereiht vom Menschen \(über die Brücke\), Vorgänger #4 noch nicht gemergt, wartet; die Sitzung ist verworfen/.test(e.text))).toBe(true);
    } finally {
      await b.zu();
    }
  }, T);

  it('a blocked epic given up on the bridge: aborted, marked, no further run', async () => {
    const b = await attrappe(() => null, { handlung: (x) => (x.epics[0]?.stufe === 'blockiert' ? { epic: 3, art: 'aufgeben' } : null) });
    try {
      const t = aufbau();
      const abgemeldet = { zeile: { type: 'result', subtype: 'success', is_error: true, result: 'Please run /login' } };
      const buch = drehbuch([lauf(3, [abgemeldet], 1)]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url, dauerhaft: true, maxDauerMs: 2500 }), t.welt);
      expect(z.epics['3']).toMatchObject({ stufe: 'abgebrochen', notiz: 'aufgegeben vom Menschen' });
      expect(z.epics['3'].aufgegebenAm).toBeTruthy();
      expect(b.berichte.at(-1)!.epics[0].aufgegebenAm).toBe(z.epics['3'].aufgegebenAm);
      expect(buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe))).toHaveLength(1);
    } finally {
      await b.zu();
    }
  }, T);

  it('a decision of the admiral revoked on the bridge reaches the run as widerruf: <Frage> → <neu>', async () => {
    const neu = 'B, mit Testdaten';
    const b = await attrappe(() => null, { handlung: (x) => (x.entscheidungen.length ? { epic: 3, art: 'widerruf', nr: 1, seit: x.entscheidungen[0].zeit, text: neu } : null) });
    try {
      const t = aufbau();
      const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ warte: 600 }, { text: ende(3, 13) }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe).toHaveLength(3);
      expect(laeufe[2].eingabe).toMatch(/Setze den Widerruf um[\s\S]*\nwiderruf: Frage 1 zu #3\? → B, mit Testdaten$/);
      expect(z.entscheidungen[0]).toMatchObject({ antwort: 'A', grund: 'vorsichtig', widerrufen: neu });
      expect(t.p.kommentare.some((k) => k.nr === 3 && k.text.includes('widerrufen vom Menschen: B, mit Testdaten'))).toBe(true);
      expect(z.epics['3'].stufe).toBe('fertig');
    } finally {
      await b.zu();
    }
  }, T);

  it('an answer of the person is a decision too (#52): revoked on the bridge it reaches the run and the issue', async () => {
    const neu = 'A, doch vorsichtig';
    const mensch = (x: Bericht) => x.entscheidungen.find((d) => d.von === 'mensch');
    const b = await attrappe(() => ({ option: 'B', text: null }), { handlung: (x) => (mensch(x) ? { epic: 3, art: 'widerruf', nr: mensch(x)!.nr, seit: mensch(x)!.zeit, text: neu } : null) });
    try {
      const t = aufbau();
      const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }]), lauf(3, [{ warte: 600 }, { text: ende(3, 13) }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      const gemeldet = b.berichte.map(mensch).find(Boolean)!;
      expect(gemeldet).toMatchObject({ epic: 3, nr: 1, frage: 'Frage 1 zu #3?', antwort: 'B', herkunft: 'Mensch über die Brücke', einflussreich: false, widerrufen: null, von: 'mensch' });
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe).toHaveLength(3);
      expect(laeufe[2].eingabe).toMatch(/Setze den Widerruf um[\s\S]*\nwiderruf: Frage 1 zu #3\? → A, doch vorsichtig$/);
      expect(z.entscheidungen).toEqual([expect.objectContaining({ von: 'mensch', antwort: 'B', zeit: gemeldet.zeit, widerrufen: neu })]);
      const k = t.p.kommentare.find((x) => x.nr === 3 && x.text.startsWith('**Widerruf des Menschen'))!;
      expect(k.text).toMatch(/widerrufen vom Menschen: A, doch vorsichtig\nVorher: B \(Mensch über die Brücke\)/);
      expect(z.epics['3'].stufe).toBe('fertig');
    } finally {
      await b.zu();
    }
  }, T);

  it('after the merge a revocation of the person no longer reaches the run, and a second one is refused (#52)', async () => {
    const mensch = (x: Bericht) => x.entscheidungen.find((d) => d.von === 'mensch');
    const b = await attrappe(() => ({ option: 'B', text: null }), {
      handlung: (x) => {
        const d = mensch(x);
        return d && x.epics[0]?.stufe === 'fertig' ? { epic: 3, art: 'widerruf', nr: d.nr, seit: d.zeit, text: d.widerrufen ? 'zweites Mal' : 'zu spät' } : null;
      },
    });
    try {
      const t = aufbau();
      const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url, dauerhaft: true, maxDauerMs: 4000 }), t.welt);
      expect(buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe))).toHaveLength(2);
      expect(z.epics['3']).toMatchObject({ stufe: 'fertig' });
      expect(z.epics['3'].widerrufe ?? []).toEqual([]);
      expect(z.entscheidungen[0].widerrufen).toBe('zu spät');
      const texte = z.ereignisse.filter((e) => e.epic === 3).map((e) => e.text);
      expect(texte.some((x) => /Widerruf zu Frage 1 kam nach dem Merge/.test(x))).toBe(true);
      expect(texte.some((x) => /Widerruf über die Brücke zu Frage 1: schon widerrufen/.test(x))).toBe(true);
    } finally {
      await b.zu();
    }
  }, T);

  it('prio/hoch: of two colliding epics the marked one starts first, the other waits with the reason on the bridge', async () => {
    const b = await attrappe(() => null);
    try {
      const body = '## Betroffene Module\n- core\n\nÄndert `core/a.ts`.';
      const t = aufbau({ bodies: { 3: body, 4: body }, labels: { 4: ['prio/hoch'] } });
      const buch = drehbuch([lauf(4, [{ warte: 300 }, { text: ende(4, 14) }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3, 4], { bruecke: b.url }), t.welt);
      const starts = buch.gesehen().filter((g) => /^Flotte, Mission #\d+\b/.test(g.eingabe)).map((g) => Number(/#(\d+)/.exec(g.eingabe)![1]));
      expect(starts).toEqual([4, 3]);
      expect(t.p.meldungen.some((m) => /^#4 Belegung: prio\/hoch: in dieser Belegung zuerst/.test(m))).toBe(true);
      const bericht = b.berichte.find((x) => x.epics.some((e) => e.nr === 4 && e.stufe === 'laeuft'))!;
      expect(bericht.epics.find((e) => e.nr === 4)!.prio).toBe(true);
      expect(bericht.epics.find((e) => e.nr === 3)!.prio).toBe(false);
      expect(z.epics['3'].stufe).toBe('fertig');
    } finally {
      await b.zu();
    }
  }, T);

  it('the order edges of an epic go into the report for the Sternenkarte (#43)', async () => {
    const b = await attrappe(() => null);
    try {
      const t = aufbau({ bodies: { 3: '## Betroffene Module\n- a', 4: '> **Reihenfolge:** nach #3, #99\n\n## Betroffene Module\n- b' } });
      const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
      await fahre(t.einstellung(buch, [3, 4], { bruecke: b.url }), t.welt);
      const bericht = b.berichte.find((x) => x.epics.length === 2)!;
      // only edges to epics of this deployment; the stranger #99 stays out
      expect(bericht.epics.find((e) => e.nr === 4)!.nach).toEqual([3]);
      expect(bericht.epics.find((e) => e.nr === 3)!.nach).toEqual([]);
      for (const x of b.berichte) for (const e of x.epics) expect(Array.isArray(e.nach)).toBe(true);
    } finally {
      await b.zu();
    }
  }, T);

  it('flotte anhalten: nothing new, the driver ends while the run works on; the same start takes the run over', async () => {
    const b = await attrappe(() => null);
    try {
      const t = aufbau();
      // #164: by events, not by the clock: anhalten once the run has started; the run ends only on a signal
      // the test gives after the driver ended, so a driver that waited for the run would hang here
      const buch = drehbuch([lauf(3, [{ signal: 'weiter' }, { text: ende(3, 13) }])]);
      let datei = '';
      void (async () => {
        while (!buch.gesehen().length) await new Promise((r) => setTimeout(r, 25));
        datei = (anhalten([t.repo]) as { datei: string }).datei;
      })();
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      writeFileSync(`${buch.datei}.signal-weiter`, '');
      expect(z.epics['3'].stufe).toBe('laeuft');
      expect(t.p.meldungen.some((m) => /^Angehalten auf Wunsch: kein Merge offen, 1 Lauf/.test(m))).toBe(true);
      // the request is used up: the next start runs normally
      expect(datei && !existsSync(datei)).toBe(true);
      const weiter = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      expect(weiter.epics['3'].stufe).toBe('fertig');
      expect(buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe))).toHaveLength(1);
    } finally {
      await b.zu();
    }
  }, T);

  it('the child tickets of an epic: number, title and stand from the forge, parked ones from the driver', async () => {
    const b = await attrappe(() => null);
    try {
      const t = aufbau({
        bodies: { 3: '## Betroffene Module\n- m3\n\n- [ ] #11\n- [ ] #12\n- [ ] #13\n- [ ] #14' },
        titel: { 11: 'Schema', 12: 'API', 13: 'Oberfläche', 14: 'Doku' },
        zu: [11],
        labels: { 12: ['status/in-arbeit'], 14: ['status/haengt'] },
      });
      const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: '#13' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }]), lauf(3, [{ warte: 400 }, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url, maxDauerMs: 3000 }), t.welt);
      const mitGeparkt = b.berichte.find((x) => x.epics[0].pakete.some((p) => p.stand === 'geparkt'))!;
      expect(mitGeparkt.epics[0].pakete).toEqual([
        { name: '#11', nr: 11, titel: 'Schema', stand: 'fertig', beginn: null, ende: '2026-01-01T10:00:00Z' },
        { name: '#12', nr: 12, titel: 'API', stand: 'laeuft', beginn: expect.any(String), ende: null },
        { name: '#13', nr: 13, titel: 'Oberfläche', stand: 'geparkt', beginn: expect.any(String), ende: null },
        { name: '#14', nr: 14, titel: 'Doku', stand: 'zurueckgelassen', beginn: expect.any(String), ende: null },
      ]);
      // level 2 counts from these: the first run's start, never moved by a later turn
      const start = mitGeparkt.epics[0].gestartetAm;
      expect(start).toEqual(expect.any(String));
      expect(b.berichte.at(-1)!.epics[0].gestartetAm).toBe(start);
      expect(mitGeparkt.epics[0].schlangeSeit).toBeNull();
      // no token, no path in a report
      expect(JSON.stringify(b.berichte)).not.toMatch(/token|\\\\Users/i);
    } finally {
      await b.zu();
    }
  }, T);

  it('a child merged into the epic branch counts as fertig while its issue is still open, ende = the merge', async () => {
    const b = await attrappe(() => null);
    try {
      const t = aufbau({ bodies: { 3: '## Betroffene Module\n- m3\n\n- [ ] #11\n- [ ] #12\n- [ ] #13' }, titel: { 11: 'Schema', 12: 'API', 13: 'Oberfläche' }, labels: { 11: ['status/in-arbeit'], 12: ['status/in-arbeit'], 13: ['status/in-arbeit'] } });
      const git = (datum: string, ...a: string[]) => aufrufen('git', ['-C', t.repo, '-c', 'user.name=t', '-c', 'user.email=t@example.org', ...a], { env: { ...process.env, GIT_COMMITTER_DATE: datum, GIT_AUTHOR_DATE: datum } });
      git('2026-01-01T08:00:00Z', 'commit', '-q', '--allow-empty', '-m', 'Start (#12)');
      git('2026-01-01T08:00:00Z', 'branch', 'epic/3-x');
      git('2026-01-01T08:00:00Z', 'checkout', '-q', 'epic/3-x');
      git('2026-01-02T09:00:00Z', 'commit', '-q', '--allow-empty', '-m', "Merge branch 'agent/11-schema' into epic/3-x");
      git('2026-01-02T10:30:00Z', 'commit', '-q', '--allow-empty', '-m', 'Oberfläche (#13)');
      git('2026-01-02T10:30:00Z', 'checkout', '-q', '-');
      const buch = drehbuch([lauf(3, [{ warte: 300 }, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      const pakete = b.berichte.find((x) => x.epics[0].pakete.length)!.epics[0].pakete;
      expect(pakete.map((p) => [p.nr, p.stand, p.ende])).toEqual([
        [11, 'fertig', '2026-01-02T09:00:00.000Z'],
        // "(#12)" lies on the base before the branch point: not the epic's own, still at work
        [12, 'laeuft', null],
        [13, 'fertig', '2026-01-02T10:30:00.000Z'],
      ]);
      // one git log per epic read, not one per child
      const logs = t.p.aufrufe.filter((a) => a[0] === 'git' && a.includes('log') && a.includes('--first-parent'));
      const lesungen = t.p.aufrufe.filter((a) => a[0] === 'gh' && a[2] === 'view' && a[3] === '11' && a.includes('number,title,state,labels,closedAt'));
      expect(logs.length).toBe(lesungen.length);
    } finally {
      await b.zu();
    }
  }, T);

  it('a waiting epic ("Bereit") reports its child tickets too, read at most every 5 min per epic', async () => {
    const b = await attrappe(() => null);
    try {
      const body = '## Betroffene Module\n- core\n\nÄndert `core/a.ts`.';
      const t = aufbau({ bodies: { 3: body, 4: `${body}\n\n- [ ] #21\n- [ ] #22` }, titel: { 21: 'Modell', 22: 'Seite' }, zu: [21] });
      const buch = drehbuch([lauf(3, [{ warte: 600 }, { text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
      await fahre(t.einstellung(buch, [3, 4], { bruecke: b.url }), t.welt);
      const wartend = b.berichte.find((x) => x.epics.some((e) => e.nr === 4 && e.stufe === 'wartend'))!;
      expect(wartend.epics.find((e) => e.nr === 4)!.pakete).toEqual([
        { name: '#21', nr: 21, titel: 'Modell', stand: 'fertig', beginn: null, ende: '2026-01-01T10:00:00Z' },
        { name: '#22', nr: 22, titel: 'Seite', stand: 'offen', beginn: null, ende: null },
      ]);
      // one read while waiting, one after the stage changed: never one per turn
      const gelesen = t.p.aufrufe.filter((a) => a[0] === 'gh' && a[1] === 'issue' && a[2] === 'view' && a[3] === '22' && a.includes('number,title,state,labels,closedAt'));
      expect(gelesen.length).toBeGreaterThanOrEqual(1);
      expect(gelesen.length).toBeLessThanOrEqual(new Set(b.berichte.map((x) => x.epics.find((e) => e.nr === 4)!.stufe)).size);
    } finally {
      await b.zu();
    }
  }, T);
});

describe('Einstellungen über die Brücke (#58)', () => {
  const einstellen = (name: string, wert: unknown): Wunsch => ({ epic: 0, art: 'einstellen', text: JSON.stringify({ name, wert }) });
  /** one action per report, in order */
  const nacheinander = (liste: Wunsch[]) => {
    const rest = [...liste];
    return () => rest.shift() ?? null;
  };

  it('reads einstellen of the contract: project-wide (epic 0), the setting as JSON in text', () => {
    const h = { id: 5, epic: 0, art: 'einstellen', nr: null, seit: null, text: '{"name":"obergrenze","wert":2}', zeit: '2026-11-20T14:40:00+00:00', herkunft: 'Mensch über die Brücke' };
    expect(handlungenAusJson([h, { ...h, id: 6, text: null }])).toEqual([h]);
  });

  it('every setting: a valid value holds from the next turn, as event and in the logbook; an invalid one is refused with an event; the report names value and origin', async () => {
    const t = aufbau();
    const [k1, k2] = t.konten.map((k) => basename(k));
    const gueltig: [string, unknown][] = [['obergrenze', 2], ['paketeJeEpic', 1], ['konten', [k2]], ['admiral', k1], ['verbrauchGelb', 50], ['verbrauchRot', 70], ['leerfahren', [k1]], ['ramWarn', 70], ['platteMinGb', 5], ['leerlaufMin', 30], ['merge', 'mensch']];
    const ungueltig: [string, unknown][] = [['obergrenze', 5], ['paketeJeEpic', 0], ['konten', []], ['konten', ['gibt-es-nicht']], ['admiral', 'gibt-es-nicht'], ['verbrauchGelb', 99], ['verbrauchGelb', 80], ['verbrauchRot', 100], ['leerfahren', k1], ['ramWarn', 90], ['platteMinGb', 0.5], ['leerlaufMin', 'viel'], ['merge', 'nach_gate'], ['merge', 'automatisch'], ['rechte', 'alle']];
    const b = await attrappe(() => null, { handlung: nacheinander([...gueltig, ...ungueltig].map(([n, w]) => einstellen(n, w))) });
    try {
      const z = await fahre(t.einstellung(drehbuch([]), [], { bruecke: b.url, dauerhaft: true, maxDauerMs: 3000 }), t.welt);
      const texte = z.ereignisse.map((x) => x.text);
      expect(texte.filter((x) => /^Einstellung .* von .* → auf .*, Mensch über die Brücke$/.test(x))).toHaveLength(gueltig.length);
      expect(texte).toContain('Einstellung Missionen gleichzeitig von automatisch → auf 2, Mensch über die Brücke');
      expect(texte).toContain(`Einstellung Konten der Läufe von ${k1}, ${k2} → auf ${k2}, Mensch über die Brücke`);
      expect(texte.filter((x) => /über die Brücke abgelehnt/.test(x))).toHaveLength(ungueltig.length);
      expect(texte).toContain('Einstellung Verbrauch Hauptenergie gelb über (%) über die Brücke abgelehnt: gelb (80) muss unter rot (70) liegen');
      expect(texte.some((x) => /unbekannte Einstellung "rechte"/.test(x))).toBe(true);
      // #112: the adapter of this world says merge: mensch, so the bridge cannot loosen it
      expect(texte).toContain('Einstellung Andocken über die Brücke abgelehnt: der Adapter sagt merge: mensch, automatisch andocken geht nur mit merge: nach_gate');
      expect(t.p.kommentare.filter((k) => k.nr === 99 && /^\*\*Flotte \(Treiber\)\*\* — Einstellung .*Mensch über die Brücke\.$/.test(k.text))).toHaveLength(gueltig.length);
      expect(Object.keys(z.einstellungen!).sort()).toEqual(gueltig.map(([n]) => n).sort());
      // every action acknowledged, the refused ones too
      expect(b.hQuittungen.filter((x) => x > 0)).toHaveLength(gueltig.length + ungueltig.length);
      const letzter = b.berichte.at(-1)!;
      for (const [name, wert] of gueltig) expect(letzter.einstellungen.find((x) => x.name === name)).toMatchObject({ wert, herkunft: 'bruecke' });
      expect(letzter.einstellungen.find((x) => x.name === 'konten')).toMatchObject({ standard: [k1, k2], leer: false, auswahl: expect.arrayContaining([k1, k2]) });
      expect(letzter.einstellungen.find((x) => x.name === 'obergrenze')).toMatchObject({ min: 1, max: 4, leer: true, standard: null });
      expect(letzter.einstellungen.find((x) => x.name === 'merge')).toMatchObject({ titel: 'Andocken', standard: 'mensch', leer: false, werte: ['mensch'], hinweis: expect.stringContaining('merge: nach_gate') });
      // in effect: limit and idle limit; still no account path in the report
      expect(letzter.obergrenze).toBe(2);
      expect(letzter.leerlaufS).toBe(1800);
      expect(JSON.stringify(letzter)).not.toContain(t.konten[0].replaceAll('\\', '\\\\'));
    } finally {
      await b.zu();
    }
  }, T);

  it('a restart keeps the settings of the bridge; a start parameter given explicitly wins with an event; a stored account that is gone is dropped with an event', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.1] });
    const [k1, k2, k3] = t.konten.map((k) => basename(k));
    const b = await attrappe(() => null, { handlung: nacheinander([einstellen('obergrenze', 3), einstellen('leerlaufMin', 30), einstellen('admiral', k3), einstellen('leerfahren', [k2, k3]), einstellen('verbrauchRot', 90), einstellen('paketeJeEpic', 2), einstellen('verbrauchGelb', 50), einstellen('ramWarn', 70), einstellen('platteMinGb', 5)]) });
    try {
      await fahre(t.einstellung(drehbuch([]), [], { bruecke: b.url, dauerhaft: true, maxDauerMs: 2000 }), t.welt);
    } finally {
      await b.zu();
    }
    rmSync(t.konten[2], { recursive: true, force: true });
    const b2 = await attrappe(() => null);
    try {
      const t2 = aufbau({ vorhanden: { repo: t.repo, konten: t.konten.slice(0, 2) } });
      const z = await fahre(t2.einstellung(drehbuch([]), [], { bruecke: b2.url, dauerhaft: true, maxDauerMs: 1000, leerlaufMs: 45 * 60_000, gesetzt: ['konten', 'leerlaufMin'] }), t2.welt);
      const texte = z.ereignisse.map((x) => x.text);
      expect(texte).toContain('Einstellung Leerlauf (Minuten bis Nachfassen/Abbruch): Startparameter --leerlauf-min gilt (45) statt 30 von der Brücke');
      expect(texte.some((x) => x.startsWith(`Einstellung Admiral-Konto von der Brücke (${k3}) gilt nicht mehr: unbekanntes Konto ${k3}`))).toBe(true);
      expect(texte.some((x) => x.startsWith(`Einstellung Bis 100 % leerfahren von der Brücke (${k2}, ${k3}) gilt nicht mehr`))).toBe(true);
      const e = b2.berichte.at(-1)!.einstellungen;
      expect(e.find((x) => x.name === 'obergrenze')).toMatchObject({ wert: 3, herkunft: 'bruecke' });
      expect(e.find((x) => x.name === 'verbrauchRot')).toMatchObject({ wert: 90, herkunft: 'bruecke' });
      expect(e.find((x) => x.name === 'leerlaufMin')).toMatchObject({ wert: 45, herkunft: 'start' });
      expect(e.find((x) => x.name === 'konten')).toMatchObject({ wert: [k1, k2], herkunft: 'start' });
      expect(e.find((x) => x.name === 'admiral')).toMatchObject({ wert: null, herkunft: 'standard' });
      for (const [name, wert] of [['paketeJeEpic', 2], ['verbrauchGelb', 50], ['ramWarn', 70], ['platteMinGb', 5]] as const) expect(e.find((x) => x.name === name)).toMatchObject({ wert, herkunft: 'bruecke' });
      expect(Object.keys(z.einstellungen!).sort()).toEqual(['obergrenze', 'paketeJeEpic', 'platteMinGb', 'ramWarn', 'verbrauchGelb', 'verbrauchRot']);
      expect(b2.berichte.at(-1)!.obergrenze).toBe(3);
    } finally {
      await b2.zu();
    }
  }, T);

  it('nothing running is stopped: a run stays on an account taken off, a lower limit starts fewer and ends none', async () => {
    const body = (m: string) => `## Betroffene Module\n- ${m}\n`;
    const t = aufbau({ bodies: { 3: body('a'), 4: body('b') } });
    const [, k2] = t.konten.map((k) => basename(k));
    let gesendet = 0;
    const b = await attrappe(() => null, {
      handlung: (x) => {
        if (gesendet >= 2 || x.epics.filter((e) => e.prozess).length < 2) return null;
        return gesendet++ === 0 ? einstellen('konten', [k2]) : einstellen('obergrenze', 1);
      },
    });
    try {
      const buch = drehbuch([lauf(3, [{ warte: 900 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }]), lauf(4, [{ warte: 900 }, { text: ende(4, 14) }])]);
      const z = await fahre(t.einstellung(buch, [3, 4], { bruecke: b.url }), t.welt);
      expect(z.epics['3'].stufe).toBe('fertig');
      expect(z.epics['4'].stufe).toBe('fertig');
      const laeufe3 = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe3).toHaveLength(2);
      // epic 3 started on the account taken off; its continuation after the change runs there too
      expect(laeufe3[0].konto).toBe(t.konten[0]);
      expect(laeufe3[1].konto).toBe(t.konten[0]);
      expect(z.einstellungen).toMatchObject({ konten: { wert: [k2] }, obergrenze: { wert: 1 } });
      expect(z.ereignisse.some((x) => /abgebrochen|beendet den Zug/.test(x.text))).toBe(false);
    } finally {
      await b.zu();
    }
  }, T);

  it('a changed limit of packages reaches the run when it is continued, once (#60)', async () => {
    const t = aufbau({});
    let gesendet = false;
    const b = await attrappe(() => null, {
      handlung: (x) => {
        if (gesendet || x.epics.filter((e) => e.prozess).length < 1) return null;
        gesendet = true;
        return einstellen('paketeJeEpic', 2);
      },
    });
    try {
      const buch = drehbuch([lauf(3, [{ warte: 900 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'B', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      expect(z.epics['3'].stufe).toBe('fertig');
      const laeufe3 = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe3).toHaveLength(3);
      expect(laeufe3[0].eingabe).toContain('Auftrag: höchstens 3 Pakete gleichzeitig.');
      expect(laeufe3[1].eingabe).toMatch(/Geänderter Auftrag: höchstens 2 Pakete gleichzeitig\. Gilt ab dem nächsten frei werdenden Platz/);
      expect(laeufe3[2].eingabe).not.toContain('höchstens 2 Pakete');
    } finally {
      await b.zu();
    }
  }, T);

  it('the same value is no change for the run (#60)', async () => {
    const t = aufbau({});
    let gesendet = false;
    const b = await attrappe(() => null, {
      handlung: (x) => {
        if (gesendet || x.epics.filter((e) => e.prozess).length < 1) return null;
        gesendet = true;
        return einstellen('paketeJeEpic', 3);
      },
    });
    try {
      const buch = drehbuch([lauf(3, [{ warte: 900 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      expect(z.epics['3'].stufe).toBe('fertig');
      const laeufe3 = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe3).toHaveLength(2);
      expect(laeufe3[1].eingabe).not.toContain('Geänderter Auftrag');
    } finally {
      await b.zu();
    }
  }, T);
});

describe('Epics steuern über die Brücke (#61)', () => {
  /** one action per report, in order */
  const nacheinander = (liste: Wunsch[]) => {
    const rest = [...liste];
    return () => rest.shift() ?? null;
  };
  const vier = () => ({ bereit: [4], epics: [{ number: 3 }, { number: 4 }] });
  const texte = (z: { ereignisse: { text: string }[] }) => z.ereignisse.map((x) => x.text);
  const index = (meldungen: string[], muster: RegExp) => meldungen.findIndex((m) => muster.test(m));

  it('aufnehmen: a released epic outside --epics is offered in the report, checked against the forge, joins and runs', async () => {
    const t = aufbau({ freigegeben: vier, titel: { 4: 'Neu freigegeben' } });
    const b = await attrappe(() => null, { handlung: (x) => (x.freigegeben?.some((f) => f.nr === 4) ? { epic: 4, art: 'aufnehmen' } : null) });
    try {
      const buch = drehbuch([lauf(3, [{ warte: 600 }, { text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      expect(b.berichte[0].freigegeben).toEqual([{ nr: 4, titel: 'Neu freigegeben' }]);
      expect(b.berichte[0].epics.map((e) => [e.nr, e.imEinsatz])).toEqual([[3, true]]);
      expect(z.epics['4'].stufe).toBe('fertig');
      expect(z.aufgenommen).toEqual([4]);
      expect(texte(z)).toContain('Epic #4 in den Einsatz aufgenommen, Mensch über die Brücke');
      expect(t.p.kommentare.some((k) => k.nr === 99 && k.text === '**Flotte (Treiber)** — Epic #4 in den Einsatz aufgenommen, Mensch über die Brücke.')).toBe(true);
      const danach = b.berichte.find((x) => x.epics.some((e) => e.nr === 4))!;
      expect(danach.freigegeben).toEqual([]);
      expect(danach.epics.find((e) => e.nr === 4)!.imEinsatz).toBe(true);
      expect(b.hQuittungen.filter((x) => x > 0)).toEqual([101]);
    } finally {
      await b.zu();
    }
  }, T);

  it('aufnehmen outlives a restart: the epic taken in joins the next deployment until it is done', async () => {
    const t = aufbau({ freigegeben: vier });
    const b = await attrappe(() => null, { handlung: (x) => (x.freigegeben?.some((f) => f.nr === 4) ? { epic: 4, art: 'aufnehmen' } : null) });
    const buch = drehbuch([lauf(3, [{ warte: 1500 }, { text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
    try {
      // one epic at a time: #4 is taken in while #3 runs, the driver stops before it starts
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url, obergrenze: 1, maxDauerMs: 800 }), t.welt);
      expect(z.aufgenommen).toEqual([4]);
      expect(z.epics['4'].stufe).toBe('wartend');
    } finally {
      await b.zu();
    }
    const t2 = aufbau({ vorhanden: { repo: t.repo, konten: t.konten } });
    const z2 = await fahre(t2.einstellung(buch, [3]), t2.welt);
    expect(texte(z2)).toContain('Über die Brücke aufgenommen, bleibt im Einsatz: #4');
    expect(z2.epics['4'].stufe).toBe('fertig');
    // done: the next start no longer takes it
    expect(z2.aufgenommen).toEqual([4]);
    const z3 = await fahre(t2.einstellung(drehbuch([]), [3]), t2.welt);
    expect(z3.aufgenommen).toEqual([]);
  }, T);

  it('aufnehmen refused: not released, already in the deployment; both are events and acknowledged', async () => {
    const t = aufbau({ freigegeben: () => ({ bereit: [], epics: [{ number: 3 }, { number: 5 }] }) });
    const b = await attrappe(() => null, { handlung: nacheinander([{ epic: 5, art: 'aufnehmen' }, { epic: 3, art: 'aufnehmen' }]) });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 400 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), t.welt);
      expect(texte(z)).toContain('Aufnehmen über die Brücke abgelehnt: kein offenes Epic mit epic und ready-for-agent');
      expect(texte(z)).toContain('Aufnehmen über die Brücke abgelehnt: schon im Einsatz');
      expect(z.epics['5']).toBeUndefined();
      expect(z.aufgenommen ?? []).toEqual([]);
      expect(b.hQuittungen.filter((x) => x > 0)).toHaveLength(2);
    } finally {
      await b.zu();
    }
  }, T);

  it('pausieren a waiting epic: it does not start until fortsetzen; the report shows the pause', async () => {
    const t = aufbau();
    const b = await attrappe(() => null, {
      handlung: (x) => {
        const e4 = x.epics.find((e) => e.nr === 4);
        if (e4?.stufe === 'wartend' && !e4.pausiert && x.epics.find((e) => e.nr === 3)?.stufe !== 'fertig') return { epic: 4, art: 'pausieren' };
        // #3 is done for a while and #4 still did not start: continue it
        if (e4?.pausiert && x.epics.find((e) => e.nr === 3)?.stufe === 'fertig') return { epic: 4, art: 'fortsetzen' };
        return null;
      },
    });
    try {
      const buch = drehbuch([lauf(3, [{ warte: 400 }, { text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
      const z = await fahre(t.einstellung(buch, [3, 4], { bruecke: b.url, obergrenze: 1 }), t.welt);
      expect(z.epics['4']).toMatchObject({ stufe: 'fertig', pausiert: null });
      const m = t.p.meldungen;
      expect(index(m, /^#4 Epic #4 pausiert, startet nicht; Mensch über die Brücke$/)).toBeGreaterThanOrEqual(0);
      expect(index(m, /^#4 Epic #4 pausiert/)).toBeLessThan(index(m, /^#3 Zug zu Ende/));
      expect(index(m, /^#4 Epic #4 fortgesetzt; Mensch über die Brücke$/)).toBeLessThan(index(m, /^#4 Lauf gestartet/));
      const pausiert = b.berichte.find((x) => x.epics.find((e) => e.nr === 4)?.pausiert)!.epics.find((e) => e.nr === 4)!;
      expect(pausiert).toMatchObject({ stufe: 'wartend', notiz: 'pausiert vom Menschen' });
      expect(Date.parse(pausiert.pausiert!)).toBeGreaterThan(0);
      expect(t.p.kommentare.filter((k) => k.nr === 99 && /^\*\*Flotte \(Treiber\)\*\* — Epic #4 (pausiert|fortgesetzt)/.test(k.text))).toHaveLength(2);
    } finally {
      await b.zu();
    }
  }, T);

  it('pausieren a running epic aborts nothing: the turn runs to its end, the admiral’s answer waits and reaches the run after fortsetzen', async () => {
    const t = aufbau();
    let gestoppt = 0;
    const b = await attrappe(() => null, {
      handlung: (x) => {
        const e = x.epics[0];
        if (e?.prozess && !e.pausiert) return { epic: 3, art: 'pausieren' };
        // the turn ended and nothing goes on: a few reports later the person continues
        if (e?.pausiert && !e.prozess && e.stufe === 'laeuft' && ++gestoppt > 5) return { epic: 3, art: 'fortsetzen' };
        return null;
      },
    });
    try {
      const buch = drehbuch([lauf(3, [{ warte: 900 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      expect(z.epics['3']).toMatchObject({ stufe: 'fertig', pausiert: null });
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe).toHaveLength(2);
      expect(laeufe[1].eingabe).toMatch(/Antwort des Admirals auf FLOTTE-FRAGE tor:\n1\. A/);
      const m = t.p.meldungen;
      const pause = index(m, /^#3 Epic #3 pausiert, der laufende Zug läuft zu Ende, danach wartet es; Mensch über die Brücke$/);
      expect(pause).toBeGreaterThanOrEqual(0);
      expect(pause).toBeLessThan(index(m, /^#3 Zug zu Ende/));
      expect(index(m, /^#3 Zug zu Ende/)).toBeLessThan(index(m, /^#3 Epic #3 fortgesetzt, der zurückgehaltene Zug geht an den Lauf; Mensch über die Brücke$/));
      expect(index(m, /^#3 Epic #3 fortgesetzt/)).toBeLessThan(index(m, /^#3 Lauf fortgesetzt/));
      expect(z.ereignisse.some((x) => /abgebrochen|Leerlauf|beendet den Zug/.test(x.text))).toBe(false);
      expect(gestoppt).toBeGreaterThan(5);
    } finally {
      await b.zu();
    }
  }, T);

  it('pausieren reaches the run through its holder file; its ram question waits for fortsetzen, which clears the field', async () => {
    const t = aufbau();
    const datei = join(flotteDir(t.repo), 'halten', '3.json');
    const lese = () => (existsSync(datei) ? (JSON.parse(readFileSync(datei, 'utf8')) as Record<string, unknown>) : null);
    const imPausieren: (Record<string, unknown> | null)[] = [];
    const nachFortsetzen: (Record<string, unknown> | null)[] = [];
    let notiz = '';
    let gestoppt = 0;
    let fortgesetzt = false;
    const b = await attrappe(() => null, {
      handlung: (x) => {
        const e = x.epics[0];
        if (e?.prozess && !e.pausiert && !fortgesetzt) return { epic: 3, art: 'pausieren' };
        if (e?.pausiert) imPausieren.push(lese());
        if (e?.pausiert && !e.prozess && e.stufe === 'laeuft' && ++gestoppt > 5) {
          notiz = e.notiz;
          fortgesetzt = true;
          return { epic: 3, art: 'fortsetzen' };
        }
        if (fortgesetzt && e?.prozess) nachFortsetzen.push(lese());
        return null;
      },
    });
    try {
      // the run's ram.ps1 said hold because of the pause: it ends its turn with FLOTTE-FRAGE ram
      const buch = drehbuch([lauf(3, [{ warte: 900 }, { text: frage(3, 'ram', [{ betrifft: 'Lauf' }]) }]), lauf(3, [{ warte: 600 }, { text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      expect(z.epics['3']).toMatchObject({ stufe: 'fertig', pausiert: null });
      // the field joins the driver's format and leaves it again
      expect(imPausieren.length).toBeGreaterThan(0);
      for (const j of imPausieren) {
        expect(j).toMatchObject({ epic: 3, repo: t.repo });
        expect(Date.parse(String(j!.pausiert))).toBeGreaterThan(0);
      }
      expect(nachFortsetzen.length).toBeGreaterThan(0);
      for (const j of nachFortsetzen) {
        expect(j).toMatchObject({ epic: 3, repo: t.repo });
        expect(j).not.toHaveProperty('pausiert');
      }
      expect(notiz).toBe('pausiert vom Menschen');
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe));
      expect(laeufe).toHaveLength(2);
      expect(laeufe[1].eingabe).toContain('Antwort auf FLOTTE-FRAGE ram: A) warten bis ok. Der Mensch hat die Pause aufgehoben, weiter.');
      const m = t.p.meldungen;
      const frageWeg = index(m, /^#3 RAM-Frage wegen der Pause: weiter nach fortsetzen$/);
      expect(frageWeg).toBeGreaterThanOrEqual(0);
      expect(frageWeg).toBeLessThan(index(m, /^#3 Epic #3 fortgesetzt, der zurückgehaltene Zug geht an den Lauf; Mensch über die Brücke$/));
      expect(index(m, /^#3 Epic #3 fortgesetzt/)).toBeLessThan(index(m, /^#3 Lauf fortgesetzt/));
      // the driver's own brake stays free: the pause is no memory reading
      expect(m.some((x) => /RAM (hold|warn)|wartet auf RAM|RAM-Frage: weiter, sobald/.test(x))).toBe(false);
    } finally {
      await b.zu();
    }
  }, T);

  it('pausieren, fortsetzen and prioritaet that do not fit are events and acknowledged', async () => {
    const t = aufbau();
    const b = await attrappe(() => null, {
      handlung: nacheinander([
        { epic: 3, art: 'fortsetzen' },
        { epic: 3, art: 'pausieren' },
        { epic: 3, art: 'pausieren', text: 'zweimal' },
        { epic: 3, art: 'prioritaet', text: 'dringend' },
        { epic: 7, art: 'pausieren' },
        { epic: 3, art: 'fortsetzen', text: 'jetzt' },
      ]),
    });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1200 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), t.welt);
      const x = texte(z);
      expect(x).toContain('Fortsetzen über die Brücke abgelehnt: nicht pausiert');
      expect(x).toContain('Pausieren über die Brücke abgelehnt: schon pausiert');
      expect(x).toContain('Priorität über die Brücke abgelehnt: unbekannte Priorität "dringend"');
      expect(x).toContain('Handlung pausieren über die Brücke: Epic gehört nicht zu diesem Einsatz');
      expect(z.epics['3']).toMatchObject({ stufe: 'fertig', pausiert: null });
      expect(z.epics['3'].prioritaet).toBeUndefined();
      expect(b.hQuittungen.filter((n) => n > 0)).toHaveLength(6);
    } finally {
      await b.zu();
    }
  }, T);

  it('prioritaet: of two startable colliding epics the high one starts first; normal on the bridge wins over the label; order edges keep their say', async () => {
    const nach2 = '> **Reihenfolge:** nach #2\n\n## Betroffene Module\n- core\n\nÄndert `core/a.ts`.';
    const t = aufbau({ bodies: { 2: '## Betroffene Module\n- a', 3: nach2, 4: nach2 }, labels: { 3: ['prio/hoch'] } });
    const b = await attrappe(() => null, { handlung: nacheinander([{ epic: 3, art: 'prioritaet', text: 'normal' }, { epic: 4, art: 'prioritaet', text: 'hoch' }]) });
    try {
      const buch = drehbuch([lauf(2, [{ warte: 600 }, { text: ende(2, 12) }]), lauf(4, [{ warte: 300 }, { text: ende(4, 14) }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [2, 3, 4], { bruecke: b.url }), t.welt);
      const starts = buch.gesehen().filter((g) => /^Flotte, Mission #\d+\b/.test(g.eingabe)).map((g) => Number(/#(\d+)/.exec(g.eingabe)![1]));
      // #2 first: the order edge holds both until its merge, whatever the priority
      expect(starts).toEqual([2, 4, 3]);
      expect(texte(z)).toContain('Priorität von #3 von hoch → auf normal, Mensch über die Brücke');
      expect(texte(z)).toContain('Priorität von #4 von normal → auf hoch, Mensch über die Brücke');
      const r = b.berichte.find((x) => x.epics.find((e) => e.nr === 4)?.stufe === 'laeuft')!;
      expect(r.epics.find((e) => e.nr === 4)).toMatchObject({ prio: true, prioritaet: 'hoch' });
      expect(r.epics.find((e) => e.nr === 3)).toMatchObject({ prio: false, prioritaet: 'normal' });
      expect(z.epics['3'].stufe).toBe('fertig');
    } finally {
      await b.zu();
    }
  }, T);
});

describe('Andocken je Projekt und Epic (#112)', () => {
  const NACH_GATE = 'merge: nach_gate\ngate_command: gate voll';
  const texte = (z: { ereignisse: { text: string }[] }) => z.ereignisse.map((x) => x.text);

  it('the proposal from the content: an epic that names a point of BEIM_MENSCHEN waits for a person, the reason on the bridge; the other one is merged', async () => {
    const t = aufbau({ adapter: NACH_GATE, bodies: { 3: '## Betroffene Module\n- a\n\nSchickt eine E-Mail an neue Nutzer.', 4: '## Betroffene Module\n- b' }, pr: (nr, n) => ({ state: nr === 13 && n < 3 ? 'OPEN' : 'MERGED' }) });
    const b = await attrappe(() => null);
    try {
      const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }]), lauf(4, [...gateGefahren(), { text: ende(4, 14) }])]);
      const z = await fahre(t.einstellung(buch, [3, 4], { bruecke: b.url }), t.welt);
      expect(t.p.merges).toEqual([14]);
      expect(z.epics['3'].stufe).toBe('fertig');
      const grund = 'nach außen: „E-Mail“ in #3';
      expect(t.p.kommentare.find((k) => k.nr === 3 && k.text.startsWith('**PR bereit'))!.text).toContain(`Andocken: Mensch prüft, Vorschlag: ${grund}`);
      const mitPr = b.berichte.find((x) => x.epics.find((e) => e.nr === 3)?.stufe === 'pr')!;
      expect(mitPr.epics.find((e) => e.nr === 3)!.merge).toEqual({ stellung: 'mensch', herkunft: 'vorschlag', grund });
      expect(mitPr.epics.find((e) => e.nr === 4)!.merge).toEqual({ stellung: 'automatisch', herkunft: 'projekt', grund: null });
      // the project's setting: the adapter's merge, both words on offer
      expect(mitPr.einstellungen.find((x) => x.name === 'merge')).toMatchObject({ wert: 'automatisch', herkunft: 'standard', standard: 'automatisch', werte: ['automatisch', 'mensch'], hinweis: null });
    } finally {
      await b.zu();
    }
  }, T);

  it('the setting of the project holds from the next turn; the epic overrules it; a PR held by its merge joins the queue when the switch says automatisch', async () => {
    const t = aufbau({ adapter: NACH_GATE, pr: () => ({ state: 'OPEN' }) });
    let schritt = 0;
    const b = await attrappe(() => null, {
      handlung: (x) => {
        if (schritt === 0) {
          schritt++;
          return { epic: 0, art: 'einstellen', text: JSON.stringify({ name: 'merge', wert: 'mensch' }) };
        }
        if (schritt === 1 && x.einstellungen.find((e) => e.name === 'merge')?.wert === 'mensch') {
          schritt++;
          return { epic: 4, art: 'merge', text: 'automatisch' };
        }
        const e3 = x.epics.find((e) => e.nr === 3);
        if (schritt === 2 && e3?.stufe === 'pr' && /Andocken: Mensch prüft, Einstellung des Projekts/.test(e3.notiz)) {
          schritt++;
          return { epic: 3, art: 'merge', text: 'automatisch' };
        }
        return null;
      },
    });
    try {
      const buch = drehbuch([lauf(3, [{ warte: 500 }, ...gateGefahren(), { text: ende(3, 13) }]), lauf(4, [{ warte: 500 }, ...gateGefahren(), { text: ende(4, 14) }])]);
      const z = await fahre(t.einstellung(buch, [3, 4], { bruecke: b.url }), t.welt);
      const x = texte(z);
      expect(x).toContain('Einstellung Andocken von automatisch → auf mensch, Mensch über die Brücke');
      expect(x).toContain('Andocken von #4 von mensch → auf automatisch, Mensch über die Brücke');
      expect(x).toContain('Andocken von #3 von mensch → auf automatisch, Mensch über die Brücke');
      // #4 merged without waiting for a person, #3 first waited for one, then joined the queue
      expect([...t.p.merges].sort()).toEqual([13, 14]);
      expect(t.p.kommentare.filter((k) => k.nr === 4 && k.text.startsWith('**PR bereit'))).toHaveLength(0);
      expect(z.epics['3']).toMatchObject({ stufe: 'fertig', merge: 'automatisch' });
      expect(z.epics['4']).toMatchObject({ stufe: 'fertig', merge: 'automatisch' });
      expect(t.p.kommentare.filter((k) => k.nr === 3 && /^\*\*PR bereit.*Andocken: Mensch prüft, Einstellung des Projekts/.test(k.text))).toHaveLength(1);
      const r = b.berichte.find((y) => y.epics.find((e) => e.nr === 4)?.merge.herkunft === 'epic')!;
      expect(r.epics.find((e) => e.nr === 4)!.merge).toEqual({ stellung: 'automatisch', herkunft: 'epic', grund: null });
      expect(r.einstellungen.find((e) => e.name === 'merge')).toMatchObject({ wert: 'mensch', herkunft: 'bruecke' });
      expect(z.einstellungen!.merge).toMatchObject({ wert: 'mensch' });
      expect(t.p.kommentare.some((k) => k.nr === 99 && k.text === '**Flotte (Treiber)** — Andocken von #4 von mensch → auf automatisch, Mensch über die Brücke.')).toBe(true);
    } finally {
      await b.zu();
    }
  }, T);

  it('the epic switch: automatisch refused under merge: mensch, an unknown word refused, mensch and back to the proposal taken; all acknowledged', async () => {
    const t = aufbau({ bodies: { 3: '## Betroffene Module\n- a\n\nNeue Preise für das Abonnement.' } });
    const rest: Wunsch[] = [{ epic: 3, art: 'merge', text: 'automatisch' }, { epic: 3, art: 'merge', text: 'irgendwie' }, { epic: 3, art: 'merge', text: 'mensch' }, { epic: 3, art: 'merge', text: null }, { epic: 7, art: 'merge', text: 'mensch' }];
    const b = await attrappe(() => null, { handlung: () => rest.shift() ?? null });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1200 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), t.welt);
      const x = texte(z);
      expect(x).toContain('Andocken über die Brücke abgelehnt: der Adapter sagt merge: mensch, automatisch andocken geht nur mit merge: nach_gate');
      expect(x).toContain('Andocken über die Brücke abgelehnt: unbekannte Stellung "irgendwie"');
      expect(x).toContain('Andocken von #3 von mensch → auf mensch, Mensch über die Brücke');
      expect(x).toContain('Andocken von #3 von mensch → auf den Vorschlag (mensch), Mensch über die Brücke');
      expect(x).toContain('Handlung merge über die Brücke: Epic gehört nicht zu diesem Einsatz');
      expect(z.epics['3'].merge).toBeNull();
      expect(b.berichte.at(-1)!.epics.find((e) => e.nr === 3)!.merge).toEqual({ stellung: 'mensch', herkunft: 'vorschlag', grund: 'Geld: „Preis“ in #3' });
      expect(b.hQuittungen.filter((n) => n > 0)).toHaveLength(5);
      // the setting of a project with merge: mensch offers only mensch, and says why
      expect(b.berichte.at(-1)!.einstellungen.find((e) => e.name === 'merge')).toMatchObject({ wert: 'mensch', werte: ['mensch'] });
    } finally {
      await b.zu();
    }
  }, T);

  it('a stored automatisch does not outlive a restart under merge: mensch: dropped with an event, the adapter holds', async () => {
    const t = aufbau({ adapter: NACH_GATE });
    const b = await attrappe(() => null, { handlung: (x) => (x.einstellungen.find((e) => e.name === 'merge')?.herkunft === 'bruecke' ? null : { epic: 0, art: 'einstellen', text: JSON.stringify({ name: 'merge', wert: 'automatisch' }) }) });
    try {
      const z = await fahre(t.einstellung(drehbuch([]), [], { bruecke: b.url, dauerhaft: true, maxDauerMs: 1500 }), t.welt);
      expect(z.einstellungen!.merge).toMatchObject({ wert: 'automatisch' });
    } finally {
      await b.zu();
    }
    writeFileSync(join(t.repo, '.claude', 'epic.md'), '---\nmerge: mensch\n---\n# Adapter\n');
    const b2 = await attrappe(() => null);
    try {
      const t2 = aufbau({ vorhanden: { repo: t.repo, konten: t.konten } });
      const z = await fahre(t2.einstellung(drehbuch([]), [], { bruecke: b2.url, dauerhaft: true, maxDauerMs: 1000 }), t2.welt);
      expect(texte(z)).toContain('Einstellung Andocken von der Brücke (automatisch) gilt nicht mehr: der Adapter sagt merge: mensch, automatisch andocken geht nur mit merge: nach_gate');
      expect(b2.berichte.at(-1)!.einstellungen.find((e) => e.name === 'merge')).toMatchObject({ wert: 'mensch', herkunft: 'standard', werte: ['mensch'] });
      expect(z.einstellungen!.merge).toBeUndefined();
    } finally {
      await b2.zu();
    }
  }, T);

  it('switched to mensch while it waits in the merge queue: at the head it goes to a person, not to merge.ps1', async () => {
    const t = aufbau({ adapter: NACH_GATE, mergeDauerMs: 1500, pr: () => ({ state: 'OPEN' }) });
    let gesendet = false;
    const b = await attrappe(() => null, {
      handlung: (x) => {
        // #4 stands behind #3, whose merge is under way
        if (gesendet || x.schlange[0] !== 3 || !x.schlange.includes(4)) return null;
        gesendet = true;
        return { epic: 4, art: 'merge', text: 'mensch' };
      },
    });
    try {
      const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }]), lauf(4, [{ warte: 200 }, ...gateGefahren(), { text: ende(4, 14) }])]);
      const z = await fahre(t.einstellung(buch, [3, 4], { bruecke: b.url, maxDauerMs: 5000 }), t.welt);
      expect(gesendet).toBe(true);
      expect(t.p.merges).toEqual([13]);
      expect(z.epics['3'].stufe).toBe('fertig');
      expect(z.epics['4']).toMatchObject({ stufe: 'pr', merge: 'mensch' });
      expect(t.p.kommentare.filter((k) => k.nr === 4 && k.text.startsWith('**PR bereit') && k.text.includes('Andocken: Mensch prüft, Schalter am Epic'))).toHaveLength(1);
    } finally {
      await b.zu();
    }
  }, T);
});

describe('Frachtraum: die Triage über die Brücke (#116)', () => {
  const texte = (z: { ereignisse: { text: string }[] }) => z.ereignisse.map((x) => x.text);
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const ergebnis = (tickets: Partial<TicketErgebnis>[], fragen = 0): Awaited<ReturnType<typeof triagiere>> => ({
    trocken: false,
    tickets: tickets.map((t) => ({ forge: 'o/r', titel: `Notiz ${t.nummer}`, url: `https://github.com/o/r/issues/${t.nummer}`, geschrieben: true, kommentar: 'k', ...t }) as TicketErgebnis),
    fragen: Array.from({ length: fragen }, () => ({ forge: 'o/r', ticket: 9, url: '', frage: 'f', optionen: [], empfehlung: '', grund: '', herkunft: '', marke: '' })),
    offen: [],
    fehler: [],
    schnittplan: [],
    nachgeholt: [],
    // the final check of a clean run; the driver reads it like a missing one (#163: the type wants it)
    abschluss: { geprueft: 0, sauber: 0, abweichungen: [] },
    zustand: 'beendet',
  });
  const zwei = () => ergebnis([{ nummer: 7, ergebnis: 'klar', herkunft: 'Skill-Empfehlung', grund: 'Abschnitte nachgetragen' }, { nummer: 8, ergebnis: 'ueberfluessig', herkunft: 'Präzedenz: #3', grund: 'schon erledigt' }, { nummer: 9, ergebnis: 'kritisch', herkunft: 'h', grund: 'g' }], 1);

  /** a stand-in triage run: records each call, waits a little so the report can show it running */
  const triageAttrappe = (r: Awaited<ReturnType<typeof triagiere>>, warteMs = 300) => {
    const aufrufe: Parameters<typeof triagiere>[0][] = [];
    const f: typeof triagiere = async (o) => {
      aufrufe.push(o);
      await new Promise((x) => setTimeout(x, warteMs));
      return r;
    };
    return { f, aufrufe };
  };

  /** a forge with one Sternzeit-Notiz #61 and the question of the triage below it; the person's comments join it */
  const mitFrage = (t: ReturnType<typeof aufbau>) => {
    const ticket: Ticket = { nummer: 61, titel: 'Newsletter', body: 'Text', url: 'https://github.com/o/r/issues/61', labels: ['needs-triage', 'kommunikation'], kommentare: [] };
    const kritisch = entscheidungAus(
      { entscheidung: 'kritisch', herkunft: 'h', grund: 'g', fragen: [{ frage: 'Darf der Newsletter an alle Kunden gehen?', optionen: ['an alle Kunden', 'nur an die Testliste'], antwort: 'nur an die Testliste', herkunft: 'Eigenes Urteil: geht nach außen', grund: 'nicht zurückholbar', beim_menschen: true, marke: 'nach außen' }], abnahmekriterien: '', verifikationsweg: '' },
      ticket.titel,
      ticket.body,
      regelnAus(''),
    ) as Exclude<Entscheidung, { art: 'ungueltig' }>;
    const frage = { body: triageKommentar(kritisch, ticket, ['needs-triage']), author: { login: 'flotte' }, createdAt: '2026-11-20T13:05:00Z', authorAssociation: 'OWNER' };
    const aufrufer: Aufrufer = (p, a, o) => {
      if (p === 'gh' && a[0] === 'issue' && a[1] === 'list' && a.includes('needs-triage')) {
        const mensch = t.p.kommentare.filter((k) => k.nr === 61).map((k) => ({ body: k.text, author: { login: 'mensch' }, createdAt: '2026-11-20T15:00:00Z', authorAssociation: 'OWNER' }));
        return ok(JSON.stringify([{ number: 61, title: ticket.titel, body: ticket.body, url: ticket.url, labels: ticket.labels.map((name) => ({ name })), comments: [frage, ...mensch] }]));
      }
      return t.welt.aufrufer(p, a, o);
    };
    return aufrufer;
  };

  it('triage: the action runs triagiere for this project; the decisions go into the report, event and fleet logbook', async () => {
    const t = aufbau();
    const tr = triageAttrappe(zwei());
    const b = await attrappe(() => null, { handlung: () => ({ epic: 0, art: 'triage' }) });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 900 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, triagiere: tr.f });
      expect(tr.aufrufe).toHaveLength(1);
      expect(tr.aufrufe[0].ziele).toEqual([{ repo: t.repo, forge: 'o/r', regeln: expect.objectContaining({ ready_label: 'ready-for-agent', epic_label: 'epic' }), lernIssue: null }]);
      expect(tr.aufrufe[0]).toMatchObject({ trocken: false, konto: t.konten[0] });
      expect(texte(z)).toContain('Triage-Lauf gestartet, Mensch über die Brücke');
      expect(texte(z)).toContain('Triage-Lauf beendet: 1 Warp frei, 1 geschlossen, 1 Frage an den Menschen');
      expect(t.p.kommentare.filter((k) => k.nr === 99 && /^\*\*Flotte \(Treiber\)\*\* — Triage-Lauf (gestartet|beendet)/.test(k.text))).toHaveLength(2);
      // the first report already carries the triage state; while the run is under way it says so
      expect(b.berichte[0].triage).toMatchObject({ laeuft: false, tickets: [], fragen: [], entscheidungen: [] });
      expect(Date.parse(b.berichte[0].triage.gelesen!)).toBeGreaterThan(0);
      expect(b.berichte.some((x) => x.triage.laeuft)).toBe(true);
      // #148: the running report names its start, no progress (the driver does not know it); the last one the end with the counters
      const laufend = b.berichte.find((x) => x.triage.laeuft)!.triage;
      expect(Date.parse(laufend.seit!)).toBeGreaterThan(0);
      expect(laufend.fortschritt).toBeUndefined();
      expect(b.berichte[0].triage.beendet).toBeUndefined();
      const letzter = b.berichte.at(-1)!.triage;
      expect(letzter.laeuft).toBe(false);
      expect(letzter.seit).toBeUndefined();
      expect(letzter.beendet).toEqual({ zeit: expect.any(String), epics: 0, fragen: 1 });
      expect(letzter.entscheidungen.map((d) => [d.nr, d.ergebnis, d.herkunft, d.grund, d.widerrufen])).toEqual([
        [7, 'klar', 'Skill-Empfehlung', 'Abschnitte nachgetragen', null],
        [8, 'ueberfluessig', 'Präzedenz: #3', 'schon erledigt', null],
      ]);
      // they outlive a restart in the state
      expect(z.triage!.entscheidungen.map((d) => d.nr)).toEqual([7, 8]);
      expect(b.hQuittungen.filter((x) => x > 0)).toEqual([101]);
    } finally {
      await b.zu();
    }
  }, T);

  it('#148: a failed triage run ends in the report as beendet with the error', async () => {
    const t = aufbau();
    const b = await attrappe(() => null, { handlung: () => ({ epic: 0, art: 'triage' }) });
    const kaputt: typeof triagiere = async () => {
      await new Promise((x) => setTimeout(x, 50));
      throw new Error('kein Konto antwortet');
    };
    try {
      await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 900 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, triagiere: kaputt });
      const letzter = b.berichte.at(-1)!.triage;
      expect(letzter.laeuft).toBe(false);
      expect(letzter.beendet).toEqual({ zeit: expect.any(String), epics: 0, fragen: 0, gescheitert: true, fehler: expect.stringContaining('kein Konto antwortet') });
    } finally {
      await b.zu();
    }
  }, T);

  it('#146: notes closed by the cut plan count as closed, show as decisions and are revoked by reopening; an invalid plan counts as without result; #147: created missions and attached notes are counted', async () => {
    const t = aufbau();
    const zu = (notiz: number, art: string, mehr: object = {}) => ({ notiz, titel: `Notiz ${notiz}`, url: `https://github.com/o/r/issues/${notiz}`, art, grund: 'kein Nutzen', herkunft: 'Eigenes Urteil: x', geschrieben: true, kommentar: 'k', ...mehr });
    const r = {
      // 31 and 32 failed at their mission: each counts once as without result, the mission not again
      ...ergebnis([{ nummer: 30, ergebnis: 'klar', mission: 100, zuordnung: 'neue_mission' }, { nummer: 31, ergebnis: 'klar', zuordnung: 'neue_mission', fehler: 'Kommentar steht, Mission „Q“ nicht angelegt' }, { nummer: 32, ergebnis: 'klar', zuordnung: 'mission', fehler: 'Kommentar steht, Kommentar an Mission #40 gescheitert: nicht angehängt' }]),
      schnittplan: [
        { forge: 'o/r', aufrufe: 1, neue_missionen: [{ schluessel: 'p', titel: 'Port', begruendung: 'b', kinder: [30], nummer: 100, url: 'https://github.com/o/r/issues/100', angehaengt: [30], geschrieben: true }, { schluessel: 'q', titel: 'Q', begruendung: 'b', kinder: [31], fehler: 'HTTP 502' }], missionen: [{ nummer: 40, titel: 'T', kinder: [32], angehaengt: [], kommentar: 'k', geschrieben: false, fehler: 'Kommentar gescheitert, nichts angehängt' }], sitzung: 's', zuordnungen: [zu(20, 'verworfen'), zu(21, 'zusammengefuehrt', { in: 22, grund: 'dasselbe' }), zu(22, 'triage', { geschrieben: undefined, kommentar: undefined }), zu(23, 'verworfen', { geschrieben: false, fehler: 'Kommentar gescheitert, nichts geändert' })] },
        { forge: 'o/r', aufrufe: 2, neue_missionen: [], zuordnungen: [], fehler: 'Sternzeit-Notiz #1 ohne Zuordnung' },
      ],
    } as Awaited<ReturnType<typeof triagiere>>;
    const tr = triageAttrappe(r, 50);
    const aufrufer: Aufrufer = (p, a, o) => (p === 'gh' && a[0] === 'issue' && a[1] === 'reopen' ? (t.p.aufrufe.push([p, ...a]), ok()) : t.welt.aufrufer(p, a, o));
    const b = await attrappe(() => null, {
      handlung: (x) => {
        const d = x.triage.entscheidungen.find((e) => e.nr === 20);
        if (!x.triage.entscheidungen.length) return { epic: 0, art: 'triage' };
        if (d && !d.widerrufen) return { epic: 20, art: 'triage-widerruf', seit: d.zeit, text: 'Lohnt sich doch.' };
        return null;
      },
    });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1500 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer, triagiere: tr.f });
      expect(texte(z)).toContain('Triage-Lauf beendet: 1 Warp frei (1 an Missionen angehängt), 1 Mission angelegt, 2 geschlossen, 0 Fragen an den Menschen, 4 ohne Ergebnis');
      expect(z.triage!.entscheidungen.map((d) => [d.nr, d.ergebnis, d.grund])).toEqual([
        [20, 'ueberfluessig', 'verworfen: kein Nutzen'],
        [21, 'ueberfluessig', 'zusammengeführt in #22: dasselbe'],
        [30, 'klar', ''],
      ]);
      const stelle = (...x: string[]) => t.p.aufrufe.findIndex((a) => x.every((y, i) => a[i] === y));
      expect(stelle('gh', 'issue', 'comment', '20')).toBeLessThan(stelle('gh', 'issue', 'reopen', '20'));
      expect(texte(z)).toContain('Triage-Entscheidung „geschlossen“ zu #20 widerrufen (wieder geöffnet), Mensch über die Brücke');
    } finally {
      await b.zu();
    }
  }, T);

  it('#149: a mission whose Warp frei the triage run set later stands in the logbook; one that failed counts as without result', async () => {
    const t = aufbau();
    const nach = (nummer: number, mehr: object = {}) => ({ forge: 'o/r', nummer, titel: `Mission ${nummer}`, kinder: [30], kommentar: 'k', geschrieben: true, ...mehr });
    const tr = triageAttrappe({ ...ergebnis([]), nachgeholt: [nach(100), nach(101, { geschrieben: false, fehler: 'Kommentar gescheitert, nichts geändert' })] }, 50);
    const b = await attrappe(() => null, { handlung: () => ({ epic: 0, art: 'triage' }) });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 900 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, triagiere: tr.f });
      expect(texte(z)).toContain('Triage-Lauf beendet: 0 Warp frei, Warp frei nachgeholt für Mission #100, 0 geschlossen, 0 Fragen an den Menschen, 1 ohne Ergebnis');
      expect(t.p.kommentare.some((k) => k.nr === 99 && k.text.includes('Warp frei nachgeholt für Mission #100'))).toBe(true);
    } finally {
      await b.zu();
    }
  }, T);

  it('#147 Abschlussprüfung: notes without an allowed end state stand as an error in the logbook and the Frachtraum; the run counts as incomplete', async () => {
    const t = aufbau();
    const abw = (nr: number, grund: string) => ({ forge: 'o/r', nr, titel: `Notiz ${nr}`, zustand: 'offen, needs-triage', grund });
    const tr = triageAttrappe({ ...ergebnis([{ nummer: 7, ergebnis: 'klar', herkunft: 'h', grund: 'g' }]), abschluss: { geprueft: 3, sauber: 1, abweichungen: [abw(4, 'in der Triage ohne offene Frage an den Menschen'), abw(6, 'ready-for-agent ohne Mission (kein Sub-Issue einer Mission)')] }, zustand: 'unvollstaendig' }, 50);
    const b = await attrappe(() => null, { handlung: () => ({ epic: 0, art: 'triage' }) });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 900 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, triagiere: tr.f });
      const zeile = 'Triage-Lauf unvollständig: 1 Warp frei, 0 geschlossen, 0 Fragen an den Menschen; 2 Notizen nicht sauber abgearbeitet: #4 (in der Triage ohne offene Frage an den Menschen), #6 (ready-for-agent ohne Mission (kein Sub-Issue einer Mission))';
      expect(texte(z)).toContain(zeile);
      expect(texte(z).some((x) => x.startsWith('Triage-Lauf beendet'))).toBe(false);
      expect(t.p.kommentare.some((k) => k.nr === 99 && k.text.includes(zeile))).toBe(true);
      expect(b.berichte.at(-1)!.triage.abschluss).toMatchObject({ zustand: 'unvollstaendig', geprueft: 3, sauber: 1, abweichungen: [{ nr: 4, titel: 'Notiz 4', zustand: 'offen, needs-triage', grund: 'in der Triage ohne offene Frage an den Menschen' }, { nr: 6 }] });
      // a clean run says beendet as before
      const t2 = aufbau();
      const tr2 = triageAttrappe({ ...zwei(), abschluss: { geprueft: 3, sauber: 3, abweichungen: [] }, zustand: 'beendet' }, 50);
      const b2 = await attrappe(() => null, { handlung: () => ({ epic: 0, art: 'triage' }) });
      try {
        const z2 = await fahre(t2.einstellung(drehbuch([lauf(3, [{ warte: 900 }, { text: ende(3, 13) }])]), [3], { bruecke: b2.url }), { ...t2.welt, triagiere: tr2.f });
        expect(texte(z2)).toContain('Triage-Lauf beendet: 1 Warp frei, 1 geschlossen, 1 Frage an den Menschen');
        expect(z2.triage!.abschluss).toMatchObject({ zustand: 'beendet', geprueft: 3, sauber: 3, abweichungen: [] });
      } finally {
        await b2.zu();
      }
    } finally {
      await b.zu();
    }
  }, T);

  it('#147 flotte anhalten ends a triage run under way with its whole process tree; it is reported as aborted', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ warte: 8000 }, { text: ende(3, 13) }]), { wenn: '^TRIAGE-ATTRAPPE', schritte: [{ text: 'los' }, { kind: 120_000 }] }]);
    let pid = 0;
    const f: typeof triagiere = async (o, w) => {
      const r = await w.starte({ ...(o.programm ?? {}), repo: o.ziele[0].repo, konto: o.konto, auftrag: 'TRIAGE-ATTRAPPE', leerlaufMs: 60_000, beimStart: (p) => (pid = p) });
      expect(r.fehler).toBe('abbruch');
      expect(w.abgebrochen?.()).toBe(true);
      // what the run wrote before the abort (here a note released into a mission) stays in the report, revocable
      return { ...ergebnis([{ nummer: 7, ergebnis: 'klar', herkunft: 'h', grund: 'g', mission: 40 }]), abschluss: { geprueft: 0, sauber: 0, abweichungen: [], entfaellt: 'abgebrochen' }, zustand: 'abgebrochen' };
    };
    const kinder = () => (existsSync(`${buch.datei}.kinder`) ? readFileSync(`${buch.datei}.kinder`, 'utf8').split('\n').filter(Boolean).map(Number) : []);
    const b = await attrappe(() => null, { handlung: () => ({ epic: 0, art: 'triage' }) });
    try {
      const warte = (async () => {
        const bis = Date.now() + 15_000;
        while (!kinder().length && Date.now() < bis) await new Promise((r) => setTimeout(r, 50));
        anhalten([t.repo]);
      })();
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), { ...t.welt, triagiere: f });
      await warte;
      expect(kinder()).toHaveLength(1);
      const bis = Date.now() + 5000;
      while ([pid, ...kinder()].some(lebt) && Date.now() < bis) await new Promise((r) => setTimeout(r, 50));
      expect([pid, ...kinder()].filter(lebt)).toEqual([]);
      expect(texte(z)).toContain('Triage-Lauf abgebrochen: Treiber angehalten; bis dahin 1 Warp frei (1 an Missionen angehängt), 0 geschlossen, 0 Fragen an den Menschen');
      expect(z.triage!.entscheidungen.map((d) => [d.nr, d.ergebnis, d.mission])).toEqual([[7, 'klar', 40]]);
      expect(z.triageLauf).toBeUndefined();
      expect(z.triage!.abschluss).toMatchObject({ zustand: 'abgebrochen', grund: 'Treiber angehalten' });
      expect(b.berichte.at(-1)!.triage).toMatchObject({ laeuft: false, abschluss: { zustand: 'abgebrochen' } });
    } finally {
      await b.zu();
    }
  }, T);

  it('#147 a triage run still under way in the state at a restart is reported as aborted, not forgotten; its process is ended', async () => {
    const t = aufbau();
    const rest = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true, detached: true });
    const z0 = leer(t.repo);
    z0.epics['3'] = { ...neuesEpic(3), stufe: 'fertig' } as never;
    Object.assign(z0, { triageLauf: { seit: '2026-11-22T10:00:00.000Z', pids: [{ pid: rest.pid!, seit: startZeit(rest.pid!) }, { pid: 999_999, seit: 1 }] } });
    schreibeZustand(flotteDir(t.repo), z0);
    const b = await attrappe(() => null);
    try {
      const z = await fahre(t.einstellung(drehbuch([]), [3], { bruecke: b.url }), t.welt);
      const zeile = 'Triage-Lauf abgebrochen: beim Neustart des Treibers galt der Lauf seit 2026-11-22T10:00:00.000Z noch als laufend';
      expect(texte(z)).toContain(zeile);
      expect(t.p.kommentare.some((k) => k.nr === 99 && k.text.includes(zeile))).toBe(true);
      expect(z.triageLauf).toBeUndefined();
      expect(z.triage!.abschluss).toMatchObject({ zustand: 'abgebrochen', grund: 'Neustart des Treibers' });
      expect(b.berichte[0].triage.abschluss).toMatchObject({ zustand: 'abgebrochen' });
      const bis = Date.now() + 5000;
      while (lebt(rest.pid!) && Date.now() < bis) await new Promise((r) => setTimeout(r, 50));
      expect(lebt(rest.pid!)).toBe(false);
    } finally {
      if (lebt(rest.pid!)) rest.kill();
      await b.zu();
    }
  }, T);

  // #148: the cut plan in the report, schnitt-widerruf per mission
  const plan = (missionNeu: number) => {
    const zu = (notiz: number, art: string, mehr: object = {}) => ({ notiz, titel: `Notiz ${notiz}`, url: `https://github.com/o/r/issues/${notiz}`, art, grund: `Grund ${notiz}`, herkunft: 'Eigenes Urteil: x', ...mehr });
    return {
      ...ergebnis([
        { nummer: 30, ergebnis: 'klar', mission: missionNeu, zuordnung: 'neue_mission' },
        { nummer: 31, ergebnis: 'klar', mission: missionNeu, zuordnung: 'neue_mission' },
        { nummer: 32, ergebnis: 'klar', mission: 40, zuordnung: 'mission' },
        { nummer: 33, ergebnis: 'klar', mission: 40, zuordnung: 'mission' },
      ]),
      schnittplan: [
        {
          forge: 'o/r',
          aufrufe: 1,
          neue_missionen: [
            { schluessel: 'p', titel: 'Portprüfung', begruendung: 'Drei Notizen zum selben Port', kinder: [30, 31, 34], nummer: missionNeu, url: `https://github.com/o/r/issues/${missionNeu}`, labels: ['epic', 'ready-for-agent'], angehaengt: [30, 31], geschrieben: true },
            // not created: no clear child, no number
            { schluessel: 'q', titel: 'Q', begruendung: 'b', kinder: [35] },
          ],
          missionen: [{ nummer: 40, titel: 'Tafel', kinder: [32, 33], angehaengt: [32, 33], kommentar: 'k', geschrieben: true }],
          sitzung: 's',
          zuordnungen: [zu(20, 'verworfen', { geschrieben: true }), zu(21, 'zusammengefuehrt', { in: 22, geschrieben: true }), zu(23, 'ueberfluessig', { fundstelle: 'PR #9', geschrieben: false, fehler: 'Kommentar gescheitert, nichts geändert' }), zu(22, 'triage'), zu(30, 'neue_mission', { neue_mission: 'p' }), zu(31, 'neue_mission', { neue_mission: 'p' }), zu(32, 'mission', { mission: 40 }), zu(33, 'mission', { mission: 40 })],
        },
      ],
    } as Awaited<ReturnType<typeof triagiere>>;
  };

  /** the forge of the cut plan: ids, unlinking, the bodies of the missions, closing; failing: calls that fail */
  const schnittForge = (t: ReturnType<typeof aufbau>, bodies: Record<number, string>, failing: (a: string[]) => boolean = () => false): Aufrufer => (p, a, o) => {
    if (p !== 'gh') return t.welt.aufrufer(p, a, o);
    const id = /^repos\/o\/r\/issues\/(\d+)$/.exec(a[1] ?? '');
    const mitsch = (x: { code: number; stdout: string; stderr: string }) => (t.p.aufrufe.push([p, ...a]), failing(a) ? { code: 1, stdout: '', stderr: 'HTTP 502' } : x);
    if (a[0] === 'api' && id && a[2] === '--jq') return mitsch(ok(`9000${id[1]}\n`));
    if (a[0] === 'api' && a[2] === 'DELETE') return mitsch(ok());
    if (a[0] === 'issue' && a[1] === 'view' && a.includes('body') && bodies[Number(a[2])] !== undefined) return mitsch(ok(JSON.stringify({ body: bodies[Number(a[2])] })));
    if (a[0] === 'issue' && a[1] === 'close') return mitsch(ok());
    if (a[0] === 'issue' && a[1] === 'edit' && a.includes('--body-file')) {
      if (failing(a)) return mitsch(ok());
      bodies[Number(a[2])] = o?.eingabe ?? '';
      return mitsch(ok());
    }
    if (failing(a)) return mitsch(ok());
    return t.welt.aufrufer(p, a, o);
  };

  it('#148: the driver reports the cut plan of its last triage run: missions with children and reason, the notes it closed', async () => {
    const t = aufbau();
    const tr = triageAttrappe(plan(100), 50);
    const b = await attrappe(() => null, { handlung: () => ({ epic: 0, art: 'triage' }) });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 900 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, triagiere: tr.f });
      expect(b.berichte[0].triage.schnittplan).toBeNull();
      const s = b.berichte.at(-1)!.triage.schnittplan!;
      expect(Date.parse(s.zeit)).toBeGreaterThan(0);
      expect(s.fehler).toBeNull();
      expect(s.missionen).toEqual([
        { nr: 100, url: 'https://github.com/o/r/issues/100', titel: 'Portprüfung', begruendung: 'Drei Notizen zum selben Port', neu: true, kinder: [{ nr: 30, titel: 'Notiz 30', grund: 'Grund 30' }, { nr: 31, titel: 'Notiz 31', grund: 'Grund 31' }], freigegeben: true, fehler: null, widerrufen: null },
        { nr: 40, url: null, titel: 'Tafel', begruendung: '', neu: false, kinder: [{ nr: 32, titel: 'Notiz 32', grund: 'Grund 32' }, { nr: 33, titel: 'Notiz 33', grund: 'Grund 33' }], freigegeben: true, fehler: null, widerrufen: null },
      ]);
      expect(s.notizen).toEqual([
        { nr: 20, titel: 'Notiz 20', art: 'verworfen', grund: 'Grund 20', verweis: null, fundstelle: '', fehler: null },
        { nr: 21, titel: 'Notiz 21', art: 'zusammengefuehrt', grund: 'Grund 21', verweis: 22, fundstelle: '', fehler: null },
        { nr: 23, titel: 'Notiz 23', art: 'ueberfluessig', grund: 'Grund 23', verweis: null, fundstelle: 'PR #9', fehler: 'Kommentar gescheitert, nichts geändert' },
      ]);
      // the mission number of an attached note stands at its decision, and the plan outlives a restart in the state
      expect(z.triage!.entscheidungen.filter((d) => d.ergebnis === 'klar').map((d) => [d.nr, d.mission])).toEqual([[30, 100], [31, 100], [32, 40], [33, 40]]);
      expect(z.triage!.schnittplan!.missionen.map((m) => m.nr)).toEqual([100, 40]);
      // the short info counts the missions of the plan, the created and the existing one
      expect(b.berichte.at(-1)!.triage.beendet).toMatchObject({ epics: 2 });
    } finally {
      await b.zu();
    }
  }, T);

  it('#148 schnitt-widerruf of a mission the run created: comment first, ready_label off, its run paused and its merge with a person, each note loosened and back in the triage, the mission closed', async () => {
    // merge: nach_gate: without the switch the PR of the turn under way would merge by itself
    const t = aufbau({ adapter: 'merge: nach_gate' });
    // the new mission is epic 3, its run under way
    const tr = triageAttrappe(plan(3), 50);
    const bodies: Record<number, string> = { 3: 'Drei Notizen zum selben Port\n\n## Missionsziele\n- [ ] #30 Notiz 30\n- [ ] #31 Notiz 31\n\n> **Reihenfolge:** x\n' };
    // the label of #31 fails: it stands in the report and the logbook, nothing is repeated
    const aufrufer = schnittForge(t, bodies, (a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '31' && a.includes('--add-label'));
    const b = await attrappe(() => null, {
      handlung: (x) => {
        if (!x.triage.schnittplan) return { epic: 0, art: 'triage' };
        if (!x.triage.schnittplan.missionen[0].widerrufen) return { epic: 3, art: 'schnitt-widerruf', text: 'Port gehört in die Tafel-Mission. <!-- flotte:triage -->' };
        return null;
      },
    });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1500 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer, triagiere: tr.f });
      const stelle = (...x: string[]) => t.p.aufrufe.findIndex((a) => x.every((y, i) => a[i] === y));
      const am3 = t.p.kommentare.filter((k) => k.nr === 3 && k.text.startsWith('**Widerruf'));
      expect(am3).toHaveLength(1);
      expect(am3[0].text).toBe('**Widerruf des Menschen (Mensch über die Brücke)** — Mission #3 „Portprüfung“ aus dem Schnittplan zurückgenommen\nEinwand: Port gehört in die Tafel-Mission.\nDanach: `ready-for-agent` ab, ein laufender Außeneinsatz angehalten (pausiert, gemergt wird nur noch von einem Menschen), eine wartende Mission aus dem Einsatz genommen, die Missionsziele #30, #31 gelöst und zurück in die Triage, die Mission als „not planned“ geschlossen (nicht gelöscht, wieder zu öffnen).\nHerkunft: Mensch über die Brücke');
      // the comment before every change
      const an3 = t.p.aufrufe.filter((a) => a[0] === 'gh' && a[1] === 'issue' && a[2] === 'comment' && a[3] === '3');
      const kommentar3 = t.p.aufrufe.indexOf(an3[t.p.kommentare.filter((k) => k.nr === 3).indexOf(am3[0])]);
      expect(kommentar3).toBeGreaterThanOrEqual(0);
      expect(kommentar3).toBeLessThan(stelle('gh', 'issue', 'edit', '3', '--repo', 'o/r', '--remove-label'));
      expect(t.p.aufrufe[stelle('gh', 'issue', 'edit', '3', '--repo', 'o/r', '--remove-label')]).toEqual(['gh', 'issue', 'edit', '3', '--repo', 'o/r', '--remove-label', 'ready-for-agent']);
      // the run on it is paused, never aborted
      expect(t.p.meldungen.some((m) => /^#3 Epic #3 pausiert, der laufende Zug läuft zu Ende, danach wartet es; Mensch über die Brücke$/.test(m))).toBe(true);
      expect(z.epics['3'].pausiert).toBeTruthy();
      expect(z.ereignisse.some((x) => /abgebrochen|aufgegeben/.test(x.text))).toBe(false);
      // the PR the turn ended with waits for a person: the switch of the epic says mensch, merge.ps1 never ran
      expect(z.epics['3'].merge).toBe('mensch');
      expect(texte(z)).toContain('Andocken von #3 von automatisch → auf mensch, Mensch über die Brücke');
      expect(t.p.merges).toEqual([]);
      for (const n of ['30', '31']) {
        const an = t.p.kommentare.filter((k) => k.nr === Number(n));
        expect(an).toHaveLength(1);
        expect(an[0].text).toContain(`Sternzeit-Notiz #${n} aus Mission #3 „Portprüfung“ gelöst\nEinwand: Port gehört in die Tafel-Mission.\nNicht wieder in Mission #3`);
        expect(stelle('gh', 'issue', 'comment', n)).toBeLessThan(stelle('gh', 'api', '--method', 'DELETE', 'repos/o/r/issues/3/sub_issue', '-F', `sub_issue_id=9000${n}`));
        // the next triage takes the comment as a fact: the note does not wait behind its earlier triage comment
        const notiz: Ticket = { nummer: Number(n), titel: `Notiz ${n}`, body: '', url: '', labels: ['needs-triage'], kommentare: [{ body: `${TRIAGE_MARKE}\n**Triage: Missionsziel von Mission #3, Warp frei**`, autor: 'flotte', zeit: '1', rolle: 'OWNER' }, { body: an[0].text, autor: 'flotte', zeit: '2', rolle: 'OWNER' }] };
        expect(wartetAufAntwort(notiz)).toBe(false);
      }
      expect(t.p.kommentare.every((k) => !k.text.includes('flotte:triage'))).toBe(true);
      expect(stelle('gh', 'issue', 'edit', '30', '--repo', 'o/r', '--remove-label')).toBeGreaterThan(stelle('gh', 'api', '--method', 'DELETE', 'repos/o/r/issues/3/sub_issue', '-F', 'sub_issue_id=900030'));
      expect(t.p.aufrufe[stelle('gh', 'issue', 'edit', '30', '--repo', 'o/r', '--remove-label')]).toEqual(['gh', 'issue', 'edit', '30', '--repo', 'o/r', '--remove-label', 'ready-for-agent', '--add-label', 'needs-triage']);
      // the list of the mission without both lines, the rest as it was
      expect(bodies[3]).toBe('Drei Notizen zum selben Port\n\n## Missionsziele\n\n> **Reihenfolge:** x\n');
      // closed last, not planned, never deleted
      const zu = stelle('gh', 'issue', 'close', '3');
      expect(t.p.aufrufe[zu]).toEqual(['gh', 'issue', 'close', '3', '--repo', 'o/r', '--reason', 'not planned']);
      expect(zu).toBeGreaterThan(stelle('gh', 'issue', 'edit', '31', '--repo', 'o/r', '--remove-label'));
      expect(t.p.aufrufe.some((a) => a.includes('delete'))).toBe(false);
      // the failed step: in the report and the logbook, once
      const m = b.berichte.at(-1)!.triage.schnittplan!.missionen[0];
      expect(m.widerrufen).toBe('Port gehört in die Tafel-Mission.');
      expect(m.fehler).toBe('Widerruf: Labels an #31 gescheitert: HTTP 502');
      expect(texte(z)).toContain('Mission #3 aus dem Schnittplan widerrufen (ready-for-agent ab, #30, #31 zurück in die Triage, geschlossen); gescheitert: Labels an #31 gescheitert: HTTP 502, Mensch über die Brücke');
      expect(t.p.aufrufe.filter((a) => a[0] === 'gh' && a[1] === 'issue' && a[2] === 'edit' && a[3] === '31')).toHaveLength(1);
      // the decisions of the notes go with it: #30 revoked, #31 still revocable on its own
      expect(z.triage!.entscheidungen.filter((d) => d.mission === 3).map((d) => [d.nr, d.widerrufen])).toEqual([[30, 'Port gehört in die Tafel-Mission.'], [31, null]]);
    } finally {
      await b.zu();
    }
  }, T);

  it('#148 schnitt-widerruf of an open mission: only the notes the run hung on it go back, the mission stays; triage-widerruf of an attached note loosens it too', async () => {
    const t = aufbau();
    const tr = triageAttrappe(plan(100), 50);
    const bodies: Record<number, string> = { 40: 'Tafel\n\n## Missionsziele\n- [x] #12 Alt\n- [ ] #32 Notiz 32\n- [ ] #33 Notiz 33\n' };
    const aufrufer = schnittForge(t, bodies);
    const b = await attrappe(() => null, {
      handlung: (x) => {
        const s = x.triage.schnittplan;
        if (!s) return { epic: 0, art: 'triage' };
        const d33 = x.triage.entscheidungen.find((d) => d.nr === 33)!;
        if (!d33.widerrufen) return { epic: 33, art: 'triage-widerruf', seit: d33.zeit, text: 'Gehört nicht zur Tafel.' };
        if (!s.missionen[1].widerrufen) return { epic: 40, art: 'schnitt-widerruf', text: 'Die Tafel ist voll genug.' };
        return null;
      },
    });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1500 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer, triagiere: tr.f });
      const stelle = (...x: string[]) => t.p.aufrufe.findIndex((a) => x.every((y, i) => a[i] === y));
      // triage-widerruf of #33: comment, loosened (sub-issue, list line), then the labels
      expect(stelle('gh', 'issue', 'comment', '33')).toBeLessThan(stelle('gh', 'api', '--method', 'DELETE', 'repos/o/r/issues/40/sub_issue', '-F', 'sub_issue_id=900033'));
      expect(stelle('gh', 'api', '--method', 'DELETE', 'repos/o/r/issues/40/sub_issue', '-F', 'sub_issue_id=900033')).toBeLessThan(stelle('gh', 'issue', 'edit', '33', '--repo', 'o/r', '--remove-label'));
      expect(texte(z)).toContain('Triage-Entscheidung „Warp frei“ zu #33 widerrufen (von Mission #40 gelöst, ready-for-agent ab, needs-triage an), Mensch über die Brücke');
      // its comment names the loosening and that it shall not return to this mission
      const am33 = t.p.kommentare.filter((k) => k.nr === 33);
      expect(am33).toHaveLength(1);
      expect(am33[0].text).toContain('Aus Mission #40 gelöst (Sub-Issue und Liste `## Missionsziele`). Nicht wieder in Mission #40: Die nächste Triage ordnet diese Notiz neu zu, ohne diese Mission.\nHerkunft: Mensch über die Brücke');
      // schnitt-widerruf of #40: only #32 is left to go back
      const am40 = t.p.kommentare.filter((k) => k.nr === 40);
      expect(am40.map((k) => k.text)).toEqual(['**Widerruf des Menschen (Mensch über die Brücke)** — Missionsziele aus dem Schnittplan zurückgenommen: #32\nEinwand: Die Tafel ist voll genug.\nDanach: gelöst (Sub-Issue und Liste `## Missionsziele`) und zurück in die Triage; die Mission selbst bleibt, wie sie ist.\nHerkunft: Mensch über die Brücke']);
      expect(stelle('gh', 'issue', 'comment', '40')).toBeLessThan(stelle('gh', 'issue', 'comment', '32'));
      expect(stelle('gh', 'issue', 'comment', '32')).toBeLessThan(stelle('gh', 'api', '--method', 'DELETE', 'repos/o/r/issues/40/sub_issue', '-F', 'sub_issue_id=900032'));
      expect(t.p.aufrufe.filter((a) => a[1] === 'api' && a[3] === 'DELETE')).toHaveLength(2);
      expect(bodies[40]).toBe('Tafel\n\n## Missionsziele\n- [x] #12 Alt\n');
      // the mission itself: no label, no close
      // (#145: the run's own mission #3 is closed after its merge)
      expect(t.p.aufrufe.filter((a) => a[0] === 'gh' && a[1] === 'issue' && ['close', 'reopen'].includes(a[2]) && a[3] !== '3')).toEqual([]);
      expect(t.p.aufrufe.filter((a) => a[0] === 'gh' && a[1] === 'issue' && a[2] === 'edit' && a[3] === '40' && !a.includes('--body-file'))).toEqual([]);
      expect(texte(z)).toContain('Missionsziele #32 aus Mission #40 widerrufen (zurück in die Triage, die Mission bleibt), Mensch über die Brücke');
      const m = b.berichte.at(-1)!.triage.schnittplan!.missionen[1];
      expect([m.widerrufen, m.fehler]).toEqual(['Die Tafel ist voll genug.', null]);
      expect(z.epics['3'].pausiert ?? null).toBeNull();
    } finally {
      await b.zu();
    }
  }, T);

  it('#148 schnitt-widerruf of a mission that did not start yet: out of the deployment for good, not paused; the driver ends', async () => {
    const t = aufbau();
    // #4 is the new mission; one place, #3 runs first, #4 waits
    const tr = triageAttrappe(plan(4), 50);
    const aufrufer = schnittForge(t, { 4: '## Missionsziele\n- [ ] #30 Notiz 30\n- [ ] #31 Notiz 31\n' });
    const b = await attrappe(() => null, {
      handlung: (x) => {
        if (!x.triage.schnittplan) return { epic: 0, art: 'triage' };
        if (x.epics.find((e) => e.nr === 4)?.stufe === 'wartend' && !x.triage.schnittplan.missionen[0].widerrufen) return { epic: 4, art: 'schnitt-widerruf', text: 'Doch nicht.' };
        return null;
      },
    });
    try {
      // no turn for #4 in the script: a start would fail the test
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1200 }, { text: ende(3, 13) }])]), [3, 4], { bruecke: b.url, obergrenze: 1 }), { ...t.welt, aufrufer, triagiere: tr.f });
      expect(texte(z)).toContain('Mission #4 aus dem Einsatz genommen (widerrufen, nicht gestartet), Mensch über die Brücke');
      expect(z.epics['4']).toBeUndefined();
      expect(z.aufgenommen ?? []).not.toContain(4);
      expect(texte(z).some((x) => /Epic #4 pausiert|#4 Lauf gestartet|Andocken von #4/.test(x))).toBe(false);
      expect(t.p.meldungen.some((m) => /^#4 Lauf gestartet/.test(m))).toBe(false);
      expect(b.berichte.at(-1)!.epics.map((e) => e.nr)).toEqual([3]);
      expect(z.epics['3'].stufe).toBe('fertig');
      expect(t.p.aufrufe.some((a) => a[0] === 'gh' && a[1] === 'issue' && a[2] === 'close' && a[3] === '4')).toBe(true);
    } finally {
      await b.zu();
    }
  }, T);

  it('#149 a revoked mission whose label and close both failed is not collected again, also after a restart; aufnehmen takes it back on purpose', async () => {
    // without --epics: #3 and the new mission #4 released; one place, #3 runs first, #4 waits
    const freigegeben = () => ({ bereit: [3, 4], epics: [{ number: 3 }, { number: 4 }] });
    const t = aufbau({ freigegeben });
    const tr = triageAttrappe(plan(4), 50);
    const aufrufer = schnittForge(t, { 4: '## Missionsziele\n- [ ] #30 Notiz 30\n- [ ] #31 Notiz 31\n' }, (a) => a[0] === 'issue' && a[2] === '4' && (a[1] === 'close' || (a[1] === 'edit' && a.includes('--remove-label'))));
    const b = await attrappe(() => null, {
      handlung: (x) => {
        if (!x.triage.schnittplan) return { epic: 0, art: 'triage' };
        if (x.epics.find((e) => e.nr === 4)?.stufe === 'wartend' && !x.triage.schnittplan.missionen[0].widerrufen) return { epic: 4, art: 'schnitt-widerruf', text: 'Doch nicht.' };
        return null;
      },
    });
    const uebersprungen = (z: { ereignisse: { text: string }[] }) => texte(z).filter((x) => x.startsWith('Mission #4 nicht eingesammelt'));
    try {
      // no turn for #4 in the script: a start would fail the test
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1200 }, { text: ende(3, 13) }])]), [], { bruecke: b.url, obergrenze: 1, auto: true, sammelnMs: 100 }), { ...t.welt, aufrufer, triagiere: tr.f });
      expect(texte(z)).toContain('Mission #4 aus dem Einsatz genommen (widerrufen, nicht gestartet), Mensch über die Brücke');
      expect(texte(z)).toContain('Mission #4 aus dem Schnittplan widerrufen (ready-for-agent ab, #30, #31 zurück in die Triage, geschlossen); gescheitert: ready-for-agent an Mission #4 abnehmen gescheitert: HTTP 502; Mission #4 schließen gescheitert: HTTP 502, Mensch über die Brücke');
      expect(z.widerrufen).toEqual([4]);
      expect(z.epics['4']).toBeUndefined();
      expect(t.p.meldungen.some((m) => /^#4 Lauf gestartet/.test(m))).toBe(false);
      // collected every 100 ms, said once, in the fleet logbook too
      expect(uebersprungen(z)).toEqual(['Mission #4 nicht eingesammelt: über die Brücke widerrufen (wieder in den Einsatz nur mit der Handlung „aufnehmen“), Mensch über die Brücke']);
      expect(t.p.kommentare.filter((k) => k.nr === 99 && k.text.includes('Mission #4 nicht eingesammelt'))).toHaveLength(1);
    } finally {
      await b.zu();
    }

    // restart with the saved state: still out
    const t2 = aufbau({ vorhanden: { repo: t.repo, konten: t.konten }, freigegeben });
    const z2 = await fahre(t2.einstellung(drehbuch([]), [], { auto: true }), t2.welt);
    expect(z2.epics['4']).toBeUndefined();
    // the events of the state go on: the second start, and one line more for the new process
    expect(texte(z2).findLast((x) => x.startsWith('Einsatz gestartet'))).toMatch(/^Einsatz gestartet: #3 /);
    expect(uebersprungen(z2)).toHaveLength(2);
    expect(z2.widerrufen).toEqual([4]);

    // a person released it again and takes it in on the bridge: it runs, the mark is gone
    const t3 = aufbau({ vorhanden: { repo: t.repo, konten: t.konten }, freigegeben });
    // the ids 101 and 102 of a fresh stand-in bridge count as carried out in the saved state: two fillers first
    const vorab: Wunsch[] = [{ epic: 4, art: 'pausieren' }, { epic: 4, art: 'fortsetzen' }];
    const b3 = await attrappe(() => null, { handlung: (x) => vorab.shift() ?? (x.freigegeben?.some((f) => f.nr === 4) ? { epic: 4, art: 'aufnehmen' } : null) });
    try {
      const z3 = await fahre(t3.einstellung(drehbuch([lauf(4, [{ text: ende(4, 14) }])]), [], { auto: true, bruecke: b3.url, dauerhaft: true, maxDauerMs: 2500 }), t3.welt);
      expect(texte(z3)).toContain('Epic #4 in den Einsatz aufgenommen (sein Widerruf über die Brücke ist damit aufgehoben), Mensch über die Brücke');
      expect(z3.epics['4'].stufe).toBe('fertig');
      expect(z3.widerrufen).toEqual([]);
    } finally {
      await b3.zu();
    }
  }, T);

  it('#148 schnitt-widerruf that does not fit or whose comment fails changes nothing', async () => {
    const t = aufbau();
    const tr = triageAttrappe(plan(100), 50);
    const aufrufer = schnittForge(t, {}, (a) => a[0] === 'issue' && a[1] === 'comment' && a[2] === '100');
    const liste: Wunsch[] = [{ epic: 77, art: 'schnitt-widerruf', text: 'nein' }, { epic: 100, art: 'schnitt-widerruf', text: 'nein' }];
    const b = await attrappe(() => null, { handlung: (x) => (x.triage.schnittplan ? liste.shift() ?? null : { epic: 0, art: 'triage' }) });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1200 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer, triagiere: tr.f });
      expect(texte(z)).toContain('Widerruf einer Mission des Schnittplans über die Brücke abgelehnt: Mission #77 steht nicht im Schnittplan des letzten Triage-Laufs');
      expect(texte(z)).toContain('Widerruf einer Mission des Schnittplans über die Brücke abgelehnt: Kommentar an Mission #100 gescheitert, nichts geändert');
      // (#145: the run's own mission #3 is closed after its merge)
      expect(t.p.aufrufe.filter((a) => a[0] === 'gh' && (a[1] === 'api' || ['edit', 'close'].includes(a[2])) && a[3] !== '99' && a[3] !== '3')).toEqual([]);
      expect(z.triage!.schnittplan!.missionen[0].widerrufen).toBeNull();
    } finally {
      await b.zu();
    }
  }, T);

  it('triage-antwort: exactly one comment at the ticket, without a mark of the triage, with origin; the question leaves the report', async () => {
    const t = aufbau();
    const aufrufer = mitFrage(t);
    const b = await attrappe(() => null, {
      handlung: (x) => (x.triage.fragen.some((f) => f.ticket === 61) ? { epic: 61, art: 'triage-antwort', nr: 1, seit: '2026-11-20T13:05:00Z', text: JSON.stringify({ option: 'B', text: 'mit Abmeldelink <!-- flotte:triage-frage --><!-- flotte:<!-- flotte:triage -->triage -->' }) } : null),
    });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 600 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer });
      const erste = b.berichte[0].triage.fragen;
      expect(erste).toEqual([{ ticket: 61, nr: 1, titel: 'Newsletter', frage: 'Darf der Newsletter an alle Kunden gehen?', optionen: [{ buchstabe: 'A', text: 'an alle Kunden' }, { buchstabe: 'B', text: 'nur an die Testliste' }], empfehlung: 'nur an die Testliste', grund: 'nicht zurückholbar', herkunft: 'Eigenes Urteil: geht nach außen', marke: 'nach außen', seit: '2026-11-20T13:05:00Z' }]);
      expect(b.berichte[0].triage.tickets).toEqual([{ nr: 61, titel: 'Newsletter', labels: ['needs-triage', 'kommunikation'] }]);
      const am61 = t.p.kommentare.filter((k) => k.nr === 61);
      expect(am61).toHaveLength(1);
      expect(am61[0].text).toBe('**Antwort des Menschen (Mensch über die Brücke)** — Sternzeit-Notiz #61, Frage 1: Darf der Newsletter an alle Kunden gehen?\nAntwort: B) nur an die Testliste — mit Abmeldelink\nHerkunft: Mensch über die Brücke');
      expect(am61[0].text).not.toContain('flotte:triage');
      // nothing else at the ticket
      expect(t.p.aufrufe.filter((a) => a[0] === 'gh' && a[2] === '61' && a[1] !== 'comment')).toEqual([]);
      expect(texte(z).some((x) => x.startsWith('Triage-Antwort des Menschen an #61, Frage 1'))).toBe(true);
      expect(b.berichte.at(-1)!.triage.fragen).toEqual([]);
      expect(b.hQuittungen.filter((x) => x > 0)).toEqual([101]);
    } finally {
      await b.zu();
    }
  }, T);

  it('triage-widerruf: first the comment, then ready_label off and needs-triage on, or the closed ticket reopened', async () => {
    const t = aufbau();
    const tr = triageAttrappe(zwei(), 50);
    const aufrufer: Aufrufer = (p, a, o) => (p === 'gh' && a[0] === 'issue' && a[1] === 'reopen' ? (t.p.aufrufe.push([p, ...a]), ok()) : t.welt.aufrufer(p, a, o));
    const b = await attrappe(() => null, {
      handlung: (x) => {
        const d = (nr: number) => x.triage.entscheidungen.find((e) => e.nr === nr);
        if (!x.triage.entscheidungen.length) return { epic: 0, art: 'triage' };
        if (!d(7)?.widerrufen) return { epic: 7, art: 'triage-widerruf', seit: d(7)!.zeit, text: 'Die Abnahme fehlt noch.' };
        if (!d(8)?.widerrufen) return { epic: 8, art: 'triage-widerruf', seit: d(8)!.zeit, text: 'Ist doch nicht erledigt.' };
        return null;
      },
    });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1500 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer, triagiere: tr.f });
      const stelle = (...x: string[]) => t.p.aufrufe.findIndex((a) => x.every((y, i) => a[i] === y));
      expect(stelle('gh', 'issue', 'comment', '7')).toBeGreaterThanOrEqual(0);
      expect(stelle('gh', 'issue', 'comment', '7')).toBeLessThan(stelle('gh', 'issue', 'edit', '7'));
      expect(t.p.aufrufe[stelle('gh', 'issue', 'edit', '7')]).toEqual(['gh', 'issue', 'edit', '7', '--repo', 'o/r', '--remove-label', 'ready-for-agent', '--add-label', 'needs-triage']);
      expect(stelle('gh', 'issue', 'comment', '8')).toBeLessThan(stelle('gh', 'issue', 'reopen', '8'));
      expect(t.p.aufrufe[stelle('gh', 'issue', 'reopen', '8')]).toEqual(['gh', 'issue', 'reopen', '8', '--repo', 'o/r']);
      const am7 = t.p.kommentare.filter((k) => k.nr === 7);
      expect(am7).toHaveLength(1);
      expect(am7[0].text).toBe('**Widerruf des Menschen (Mensch über die Brücke)** — Triage-Entscheidung „Warp frei“ zu Sternzeit-Notiz #7 zurückgenommen\nEinwand: Die Abnahme fehlt noch.\nVorher: Abschnitte nachgetragen (Skill-Empfehlung)\nHerkunft: Mensch über die Brücke');
      expect(texte(z)).toContain('Triage-Entscheidung „Warp frei“ zu #7 widerrufen (ready-for-agent ab, needs-triage an), Mensch über die Brücke');
      expect(texte(z)).toContain('Triage-Entscheidung „geschlossen“ zu #8 widerrufen (wieder geöffnet), Mensch über die Brücke');
      expect(z.triage!.entscheidungen.map((d) => [d.nr, d.widerrufen])).toEqual([[7, 'Die Abnahme fehlt noch.'], [8, 'Ist doch nicht erledigt.']]);
      expect(b.berichte.at(-1)!.triage.entscheidungen.every((d) => d.widerrufen)).toBe(true);
    } finally {
      await b.zu();
    }
  }, T);

  it('triage-widerruf whose comment fails: nothing changed at the ticket, the decision stays revocable', async () => {
    const t = aufbau();
    const tr = triageAttrappe(zwei(), 50);
    const aufrufer: Aufrufer = (p, a, o) => (p === 'gh' && a[0] === 'issue' && a[1] === 'comment' && a[2] === '7' ? (t.p.aufrufe.push([p, ...a]), { code: 1, stdout: '', stderr: 'HTTP 502' }) : t.welt.aufrufer(p, a, o));
    let gesendet = false;
    const b = await attrappe(() => null, {
      handlung: (x) => {
        if (!x.triage.entscheidungen.length) return { epic: 0, art: 'triage' };
        if (gesendet) return null;
        gesendet = true;
        return { epic: 7, art: 'triage-widerruf', seit: x.triage.entscheidungen.find((e) => e.nr === 7)!.zeit, text: 'Die Abnahme fehlt noch.' };
      },
    });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 900 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer, triagiere: tr.f });
      expect(gesendet).toBe(true);
      expect(texte(z)).toContain('Widerruf einer Triage-Entscheidung über die Brücke abgelehnt: Kommentar an #7 gescheitert, nichts geändert');
      expect(t.p.aufrufe.filter((a) => a[0] === 'gh' && a[3] === '7' && a[2] !== 'comment')).toEqual([]);
      expect(z.triage!.entscheidungen.find((d) => d.nr === 7)!.widerrufen).toBeNull();
    } finally {
      await b.zu();
    }
  }, T);

  it('actions that do not fit change nothing: an event „abgelehnt“, nothing written, both acknowledged', async () => {
    const t = aufbau();
    const tr = triageAttrappe(ergebnis([]), 1500);
    const aufrufer = mitFrage(t);
    const liste: Wunsch[] = [
      { epic: 0, art: 'triage' },
      // a second press while the first run is under way
      { epic: 0, art: 'triage', text: 'noch einmal' },
      { epic: 61, art: 'triage-antwort', nr: 2, seit: '2026-11-20T13:05:00Z', text: JSON.stringify({ option: 'A', text: null }) },
      { epic: 61, art: 'triage-antwort', nr: 1, seit: '2026-11-20T13:05:00Z', text: JSON.stringify({ option: 'C', text: null }) },
      { epic: 7, art: 'triage-widerruf', seit: '2026-11-20T13:04:00Z', text: 'nein' },
    ];
    const b = await attrappe(() => null, { handlung: () => liste.shift() ?? null });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1200 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer, triagiere: tr.f });
      expect(tr.aufrufe).toHaveLength(1);
      expect(texte(z)).toContain('Triage-Lauf über die Brücke abgelehnt: ein Triage-Lauf läuft schon');
      expect(texte(z)).toContain('Triage-Antwort über die Brücke abgelehnt: keine offene Frage 2 an #61');
      expect(texte(z)).toContain('Triage-Antwort über die Brücke abgelehnt: Option C gibt es bei Frage 1 an #61 nicht');
      expect(texte(z)).toContain('Widerruf einer Triage-Entscheidung über die Brücke abgelehnt: keine solche Entscheidung zu #7');
      expect(t.p.kommentare.filter((k) => k.nr === 61 || k.nr === 7)).toEqual([]);
      // (#145: the run's own mission #3 is closed after its merge)
      expect(t.p.aufrufe.filter((a) => a[0] === 'gh' && ['edit', 'reopen', 'close'].includes(a[2] ?? '') && a[3] !== '99' && a[3] !== '3')).toEqual([]);
      expect(t.p.aufrufe.filter((a) => a[0] === 'gh' && (a[3] === '61' || a[3] === '7'))).toEqual([]);
      expect(b.hQuittungen.filter((x) => x > 0)).toHaveLength(5);
    } finally {
      await b.zu();
    }
  }, T);

  it('reads the Sternzeit-Notizen only with a bridge, at the start and then at most every 30 min', async () => {
    const t = aufbau();
    const b = await attrappe(() => null);
    try {
      await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 400 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), t.welt);
      const lesen = t.p.aufrufe.filter((a) => a[0] === 'gh' && a[1] === 'issue' && a[2] === 'list' && (a.includes('needs-triage') || a.includes('needs-info')));
      expect(lesen).toHaveLength(2);
    } finally {
      await b.zu();
    }
    const t2 = aufbau();
    await fahre(t2.einstellung(drehbuch([lauf(3, [{ text: ende(3, 13) }])]), [3]), t2.welt);
    expect(t2.p.aufrufe.filter((a) => a.includes('needs-triage'))).toEqual([]);
  }, T);

  // #117: the proposals of the learning loop at lern_issue in the Frachtraum, like Sternzeit-Notizen
  const LERN_URL = 'https://github.com/o/r/issues/50#issuecomment-555';
  const lernText = lernKommentar(
    {
      vorschlaege: [
        { titel: 'Typprüfung im Gate', beleg: 'PR #10', form: 'test', umsetzung: 'tsc im Test.', wegfallen: 'nichts' },
        { titel: 'Zeittests robuster', beleg: 'PR #10', form: 'test', umsetzung: 'Schwellen.', wegfallen: 'nichts' },
        { titel: 'Kundenmail', beleg: 'PR #10', form: 'skilltext', umsetzung: 'Mail an Kunden.', wegfallen: 'nichts' },
      ],
      gegriffen: [],
    },
    10,
    9,
    '2026-11-22',
    [],
    [],
  );

  /** the collecting issue #50: the comment of the loop, proposal 2 decided superfluous, a question about proposal 3; with klar1 proposal 1 decided clear, its Missionsziel missing */
  const mitLernIssue = (t: ReturnType<typeof aufbau>, klar1 = false) => {
    const roh = (body: string, i: number, url = `https://github.com/o/r/issues/50#issuecomment-${600 + i}`) => ({ body, author: { login: 'flotte' }, createdAt: `2026-11-22T1${i}:00:00Z`, authorAssociation: 'OWNER', url });
    const [v1, v2, v3] = lernvorschlaege(50, [{ body: lernText, autor: 'flotte', zeit: 'z', rolle: 'OWNER', url: LERN_URL }]);
    const e = (x: object, v: typeof v2) => entscheidungAus(x, v.ticket.titel, v.ticket.body, regelnAus('')) as Exclude<Entscheidung, { art: 'ungueltig' }>;
    const ueber = lernTriageKommentar(e({ entscheidung: 'ueberfluessig', herkunft: 'Präzedenz: #3', grund: 'erledigt', fragen: [], abnahmekriterien: '', verifikationsweg: '' }, v2), v2, 'ready-for-agent');
    const frage = lernTriageKommentar(
      e({ entscheidung: 'kritisch', herkunft: 'h', grund: 'g', fragen: [{ frage: 'Darf eine Mail an Kunden gehen?', optionen: ['ja', 'nein'], antwort: 'nein', herkunft: 'Eigenes Urteil: nach außen', grund: 'nicht zurückholbar', beim_menschen: true, marke: 'nach außen' }], abnahmekriterien: '', verifikationsweg: '' }, v3),
      v3,
      'ready-for-agent',
    );
    const klar = lernTriageKommentar(e({ entscheidung: 'klar', herkunft: 'h', grund: 'g', fragen: [], abnahmekriterien: '- tsc läuft', verifikationsweg: '`bun test`' }, v1), v1, 'ready-for-agent');
    const aufrufer: Aufrufer = (p, a, o) => {
      if (p === 'gh' && a[0] === 'issue' && a[1] === 'view' && a[2] === '50') {
        const mensch = t.p.kommentare.filter((k) => k.nr === 50).map((k, i) => roh(k.text, 5 + i));
        return ok(JSON.stringify({ comments: [roh(lernText, 0, LERN_URL), roh(ueber, 1), roh(frage, 2), ...(klar1 ? [roh(klar, 3)] : []), ...mensch] }));
      }
      return t.welt.aufrufer(p, a, o);
    };
    return aufrufer;
  };

  it('#117: open Lernvorschläge in the report under the topic Lernschleife, decided ones not; an answer names the kennung', async () => {
    const t = aufbau({ adapter: 'merge: mensch\nlern_issue: "#50"' });
    const aufrufer = mitLernIssue(t);
    const b = await attrappe(() => null, {
      handlung: (x) => (x.triage.fragen.some((f) => f.ticket === 50) ? { epic: 50, art: 'triage-antwort', nr: 1, seit: '2026-11-22T12:00:00Z', text: JSON.stringify({ option: 'B', text: null }) } : null),
    });
    try {
      await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 600 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer });
      const erste = b.berichte[0].triage;
      expect(erste.tickets).toEqual([
        { nr: 50, titel: 'Lernvorschlag 555/1: Typprüfung im Gate', labels: ['Lernschleife'] },
        { nr: 50, titel: 'Lernvorschlag 555/3: Kundenmail', labels: ['Lernschleife'] },
      ]);
      expect(erste.fragen).toEqual([{ ticket: 50, nr: 1, titel: 'Lernvorschlag 555/3: Kundenmail', frage: 'Darf eine Mail an Kunden gehen?', optionen: [{ buchstabe: 'A', text: 'ja' }, { buchstabe: 'B', text: 'nein' }], empfehlung: 'nein', grund: 'nicht zurückholbar', herkunft: 'Eigenes Urteil: nach außen', marke: 'nach außen', seit: '2026-11-22T12:00:00Z', lernvorschlag: 'Lernvorschlag 555/3' }]);
      const am50 = t.p.kommentare.filter((k) => k.nr === 50);
      // the kennung alone in the first line: a kennung the question quotes counts for no other proposal
      expect(am50.map((k) => k.text)).toEqual(['**Antwort des Menschen (Mensch über die Brücke)** — Lernvorschlag 555/3, Frage 1\nFrage: Darf eine Mail an Kunden gehen?\nAntwort: B) nein\nHerkunft: Mensch über die Brücke']);
      // answered: the question leaves the report, the proposal stays open for the next triage
      expect(b.berichte.at(-1)!.triage.fragen).toEqual([]);
      expect(b.berichte.at(-1)!.triage.tickets.map((x) => x.titel)).toContain('Lernvorschlag 555/3: Kundenmail');
    } finally {
      await b.zu();
    }
  }, T);

  it('#117: a clear proposal whose Missionsziel is missing stays in the Frachtraum with the hint', async () => {
    const t = aufbau({ adapter: 'merge: mensch\nlern_issue: "#50"' });
    const aufrufer = mitLernIssue(t, true);
    const b = await attrappe(() => null);
    try {
      await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 300 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer });
      expect(b.berichte[0].triage.tickets).toEqual([
        { nr: 50, titel: 'Lernvorschlag 555/1: Typprüfung im Gate — Missionsziel fehlt', labels: ['Lernschleife'] },
        { nr: 50, titel: 'Lernvorschlag 555/3: Kundenmail', labels: ['Lernschleife'] },
      ]);
    } finally {
      await b.zu();
    }
  }, T);

  it('#117: a failed read of lern_issue holds back only the proposals, the Sternzeit-Notizen still reach the Frachtraum', async () => {
    const t = aufbau({ adapter: 'merge: mensch\nlern_issue: "#50"' });
    const mitNotiz = mitFrage(t);
    const aufrufer: Aufrufer = (p, a, o) => (p === 'gh' && a[0] === 'issue' && a[1] === 'view' && a[2] === '50' ? { code: 1, stdout: '', stderr: 'HTTP 502' } : mitNotiz(p, a, o));
    const b = await attrappe(() => null);
    try {
      await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 300 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, aufrufer });
      expect(b.berichte[0].triage.tickets).toEqual([{ nr: 61, titel: 'Newsletter', labels: ['needs-triage', 'kommunikation'] }]);
      expect(b.berichte[0].triage.fragen.map((f) => f.ticket)).toEqual([61]);
    } finally {
      await b.zu();
    }
  }, T);

  it('#117: a triage run passes lern_issue; widerruf of a clear proposal acts on its Missionsziel, of a superfluous one only comments at lern_issue', async () => {
    const t = aufbau({ adapter: 'merge: mensch\nlern_issue: "#50"' });
    const lern = (nummer: number, o: Partial<TicketErgebnis>) => ({ nummer, titel: `Vorschlag ${o.lernvorschlag}`, url: LERN_URL, herkunft: 'h', grund: 'g', ...o });
    const tr = triageAttrappe(
      ergebnis([
        lern(50, { lernvorschlag: 'Lernvorschlag 555/1', ergebnis: 'klar', missionsziel: 200 }),
        lern(50, { lernvorschlag: 'Lernvorschlag 555/2', ergebnis: 'ueberfluessig' }),
        lern(50, { lernvorschlag: 'Lernvorschlag 555/3', ergebnis: 'ueberfluessig' }),
        // a clear proposal whose Missionsziel failed is nothing to revoke
        lern(50, { lernvorschlag: 'Lernvorschlag 556/1', ergebnis: 'klar', fehler: 'Kommentar steht, Missionsziel gescheitert: x' }),
      ]),
      50,
    );
    const b = await attrappe(() => null, {
      handlung: (x) => {
        const d = (k: string) => x.triage.entscheidungen.find((e) => e.titel.startsWith(k));
        if (!x.triage.entscheidungen.length) return { epic: 0, art: 'triage' };
        if (!d('Lernvorschlag 555/1')?.widerrufen) return { epic: 200, art: 'triage-widerruf', seit: d('Lernvorschlag 555/1')!.zeit, text: 'Noch nicht.' };
        if (!d('Lernvorschlag 555/3')?.widerrufen) return { epic: 50, art: 'triage-widerruf', seit: d('Lernvorschlag 555/3')!.zeit, text: 'Doch nicht erledigt.' };
        return null;
      },
    });
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ warte: 1500 }, { text: ende(3, 13) }])]), [3], { bruecke: b.url }), { ...t.welt, triagiere: tr.f });
      expect(tr.aufrufe[0].ziele[0].lernIssue).toBe(50);
      const e = z.triage!.entscheidungen;
      expect(e.map((d) => [d.nr, d.titel, d.ergebnis, d.lernvorschlag])).toEqual([
        [200, 'Lernvorschlag 555/1: Vorschlag Lernvorschlag 555/1', 'klar', 'Lernvorschlag 555/1'],
        [50, 'Lernvorschlag 555/2: Vorschlag Lernvorschlag 555/2', 'ueberfluessig', 'Lernvorschlag 555/2'],
        [50, 'Lernvorschlag 555/3: Vorschlag Lernvorschlag 555/3', 'ueberfluessig', 'Lernvorschlag 555/3'],
      ]);
      // (nr, zeit) stays a key although two decisions share the collecting issue
      expect(new Set(e.map((d) => `${d.nr}#${d.zeit}`)).size).toBe(3);
      expect(e.map((d) => d.widerrufen)).toEqual(['Noch nicht.', null, 'Doch nicht erledigt.']);
      const stelle = (...x: string[]) => t.p.aufrufe.findIndex((a) => x.every((y, i) => a[i] === y));
      expect(stelle('gh', 'issue', 'comment', '200')).toBeLessThan(stelle('gh', 'issue', 'edit', '200'));
      expect(t.p.aufrufe[stelle('gh', 'issue', 'edit', '200')]).toEqual(['gh', 'issue', 'edit', '200', '--repo', 'o/r', '--remove-label', 'ready-for-agent', '--add-label', 'needs-triage']);
      expect(t.p.kommentare.filter((k) => k.nr === 50).map((k) => k.text)).toEqual(['**Widerruf des Menschen (Mensch über die Brücke)** — Triage-Entscheidung „überflüssig“ zu Lernvorschlag 555/3 zurückgenommen\nEinwand: Doch nicht erledigt.\nVorher: g (h)\nHerkunft: Mensch über die Brücke']);
      expect(t.p.aufrufe.filter((a) => a[0] === 'gh' && a[3] === '50' && a[2] !== 'comment' && a[2] !== 'view')).toEqual([]);
      expect(texte(z)).toContain('Triage-Entscheidung „überflüssig“ zu Lernvorschlag 555/3 widerrufen, Mensch über die Brücke');
      // a superfluous proposal closes nothing
      expect(texte(z)).toContain('Triage-Lauf beendet: 1 Warp frei, 0 geschlossen, 2 überflüssig, 0 Fragen an den Menschen, 1 ohne Ergebnis');
    } finally {
      await b.zu();
    }
  }, T);
});
