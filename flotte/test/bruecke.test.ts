// The driver and the Flottenbrücke (#28): report per turn, answers fetched and acknowledged, the
// shared contract flottenbruecke/beispiel/*.json, a bridge that is off, the raw-text fallback.

import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../src/aufruf.ts';
import { anhalten, einstellungAus, fahre } from '../src/treiber/treiber.ts';
import { existsSync } from 'node:fs';
import { kurzname } from '../src/werkzeuge/konten.ts';
import { antwortenAusJson, antwortZeile, type Bericht, type BrueckenAntwort, type BrueckenHandlung, handlungenAusJson } from '../src/treiber/bruecke.ts';
import { admiral, aufbau, drehbuch, ende, frage, lauf } from './flotte-welt.ts';

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
    ]);
    expect(handlungenAusJson([{ id: 1, epic: 2, art: 'widerruf', nr: 1, seit: 'x', text: ' ' }, { id: 2, epic: 2, art: 'loeschen' }, null])).toEqual([]);
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
