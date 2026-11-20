// The driver and the Flottenbrücke (#28): report per turn, answers fetched and acknowledged, the
// shared contract flottenbruecke/beispiel/*.json, a bridge that is off, the raw-text fallback.

import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Aufrufer } from '../src/aufruf.ts';
import { einstellungAus, fahre } from '../src/treiber/treiber.ts';
import { kurzname } from '../src/werkzeuge/konten.ts';
import { antwortenAusJson, antwortZeile, type Bericht, type BrueckenAntwort } from '../src/treiber/bruecke.ts';
import { admiral, aufbau, drehbuch, ende, frage, lauf } from './flotte-welt.ts';

const T = 30_000;
const beispiel = (datei: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../flottenbruecke/beispiel/${datei}`, import.meta.url)), 'utf8'));

/** A stand-in bridge: keeps the reports, answers what antwort() returns for an open question. */
async function attrappe(antwort: (f: Bericht['fragen'][number]) => Omit<BrueckenAntwort, 'id' | 'epic' | 'nr' | 'seit' | 'zeit' | 'herkunft'> | null, o: { quittungFehlt?: number } = {}) {
  const berichte: Bericht[] = [];
  const offen = new Map<number, BrueckenAntwort>();
  const quittungen: number[] = [];
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
        return json({ ok: true });
      }
      if (req.method === 'GET' && req.url?.startsWith('/api/antworten')) return json([...offen.values()]);
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
  return { url, berichte, quittungen, zu: () => new Promise<void>((r) => server.close(() => r())) };
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
      expect(schluessel(mitFrage.epics[0])).toEqual(schluessel(muster.epics[1]));
      expect(schluessel(mitFrage.fragen[0])).toEqual(schluessel(muster.fragen[0]));
      expect(schluessel(mitFrage.konten[0])).toEqual(schluessel(muster.konten[0]));
      expect(schluessel(mitFrage.ram!)).toEqual(schluessel(muster.ram));
      expect(schluessel(mitFrage.platte!)).toEqual(schluessel(muster.platte));
      expect(mitFrage.forge).toBe('o/r');
      for (const x of b.berichte) {
        expect(JSON.stringify(x)).not.toContain(t.konten[0].replaceAll('\\', '\\\\'));
        for (const k of x.konten) expect(['gruen', 'gelb', 'rot']).toContain(k.stufe);
      }
      expect(b.berichte.at(-1)!.aktiv).toBe(false);
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
});
