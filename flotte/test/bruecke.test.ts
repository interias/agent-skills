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
import { flotteDir } from '../src/werkzeuge/zustand.ts';
import { antwortenAusJson, antwortZeile, type Bericht, type BrueckenAntwort, type BrueckenHandlung, handlungenAusJson } from '../src/treiber/bruecke.ts';
import { admiral, aufbau, drehbuch, ende, frage, gateGefahren, lauf } from './flotte-welt.ts';

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
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
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
      // a turn of a minute: only the report on the event and the short polling bring the answer in time
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url, taktMs: 60_000, brueckeAbfrageMs: 100 }), t.welt);
      expect(Date.now() - anfang).toBeLessThan(20_000);
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
      expect(laeufe[1].eingabe).toMatch(/\n1\. A, C, E$/);
      expect(z.fragen[0]).toMatchObject({ mehrfach: true, empfehlung: 'A, B', beantwortet: 'A, C, E' });
      const mitFrage = b.berichte.find((x) => x.fragen.length)!;
      expect(mitFrage.fragen[0].mehrfach).toBe(true);
      expect(mitFrage.fragen[0].optionen.map((o) => o.buchstabe)).toEqual(['A', 'B', 'C', 'D', 'E']);
    } finally {
      await b.zu();
    }
  }, T);

  it('a bridge that is off: the driver works on, one event', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { bruecke: 'http://127.0.0.1:9' }), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(t.p.meldungen.filter((m) => /Flottenbrücke nicht erreichbar/.test(m))).toHaveLength(1);
  }, T);

  it('a block that does not parse: the wording goes to the person, a free-text answer reaches the run unchanged', async () => {
    const roh = 'FLOTTE-FRAGE 3 tor\nIch weiß nicht weiter: Datei anlegen oder nicht?\nSTAND: Tor';
    const b = await attrappe((f) => (f.frage === '' && f.roh.includes('Ich weiß nicht weiter') ? { option: null, text: 'Leg sie an.' } : null));
    try {
      const t = aufbau();
      const buch = drehbuch([lauf(3, [{ text: `Bericht.\n\n${roh}` }]), lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
      expect(buch.gesehen().some((g) => g.eingabe.startsWith('FLOTTE-ADMIRAL'))).toBe(false);
      expect(laeufe[1].eingabe).toMatch(/nicht in Fragen zerlegen[\s\S]*\n1\. Antwort: Leg sie an\.$/);
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
    ]);
    expect(liste.find((h) => h.art === 'merge')!.text).toBe('mensch');
    expect(liste.find((h) => h.art === 'prioritaet')!.text).toBe('hoch');
    expect(handlungenAusJson([{ id: 1, epic: 2, art: 'widerruf', nr: 1, seit: 'x', text: ' ' }, { id: 2, epic: 2, art: 'loeschen' }, null])).toEqual([]);
    // #61: the epic actions need an epic; prioritaet carries its value as text (the driver checks it)
    expect(handlungenAusJson([{ id: 3, epic: 0, art: 'pausieren' }, { id: 4, epic: 0, art: 'aufnehmen' }, { id: 5, epic: 2, art: 'prioritaet', text: null }, { id: 6, epic: 0, art: 'merge', text: 'mensch' }])).toEqual([]);
    // #112: back to the proposal is merge without text
    expect(handlungenAusJson([{ id: 7, epic: 2, art: 'merge', text: null }])).toHaveLength(1);
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
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
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
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
      expect(laeufe).toHaveLength(3);
      expect(laeufe[2].eingabe).toMatch(/neu eingereiht\. Grund der Blockade war: Erlaubnis verweigert: Bash/);
      expect(laeufe[2].eingabe).toContain('\nOffen und ohne Antwort des Menschen:\n1. Frage 1 zu #3?\nEntscheide sie nicht selbst. Stelle sie im nächsten FLOTTE-FRAGE erneut.');
      expect(z.fragen.filter((f) => f.epic === 3 && !f.beantwortet)).toHaveLength(1);
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
      expect(buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe))).toHaveLength(1);
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
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
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
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
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
      expect(buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe))).toHaveLength(2);
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
      const starts = buch.gesehen().filter((g) => /^Flotte, Epic #\d+\b/.test(g.eingabe)).map((g) => Number(/#(\d+)/.exec(g.eingabe)![1]));
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
      const buch = drehbuch([lauf(3, [{ warte: 2500 }, { text: ende(3, 13) }])]);
      const anfang = Date.now();
      let datei = '';
      setTimeout(() => (datei = (anhalten([t.repo]) as { datei: string }).datei), 500);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      expect(Date.now() - anfang).toBeLessThan(2400);
      expect(z.epics['3'].stufe).toBe('laeuft');
      expect(t.p.meldungen.some((m) => /^Angehalten auf Wunsch: kein Merge offen, 1 Lauf/.test(m))).toBe(true);
      // the request is used up: the next start runs normally
      expect(datei && !existsSync(datei)).toBe(true);
      const weiter = await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      expect(weiter.epics['3'].stufe).toBe('fertig');
      expect(buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe))).toHaveLength(1);
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
      expect(texte).toContain('Einstellung Epics gleichzeitig von automatisch → auf 2, Mensch über die Brücke');
      expect(texte).toContain(`Einstellung Konten der Läufe von ${k1}, ${k2} → auf ${k2}, Mensch über die Brücke`);
      expect(texte.filter((x) => /über die Brücke abgelehnt/.test(x))).toHaveLength(ungueltig.length);
      expect(texte).toContain('Einstellung Verbrauch 5 h gelb über (%) über die Brücke abgelehnt: gelb (80) muss unter rot (70) liegen');
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
      const laeufe3 = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
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
      const laeufe3 = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
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
      const laeufe3 = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
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
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
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
      const laeufe = buch.gesehen().filter((g) => /^Flotte, Epic #3\b/.test(g.eingabe));
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
      const starts = buch.gesehen().filter((g) => /^Flotte, Epic #\d+\b/.test(g.eingabe)).map((g) => Number(/#(\d+)/.exec(g.eingabe)![1]));
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
