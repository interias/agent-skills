// Holodeck (#44): the driver reads the prototypes of its project behind a path guard and sends a
// changed set to the bridge; the contract is flottenbruecke/beispiel/holodeck.json.

import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fahre } from '../src/treiber/treiber.ts';
import { liesPrototypen, PROTOTYP_MAX_BYTES, PROTOTYP_NAME, PROTOTYPEN_MAX, type Prototyp, prototypenStand, titelAus } from '../src/treiber/holodeck.ts';
import { liesAdapter } from '../src/werkzeuge/belegung.ts';
import { aufbau, drehbuch, ende, lauf } from './flotte-welt.ts';

const T = 30_000;
const beispiel = JSON.parse(readFileSync(fileURLToPath(new URL('../../flottenbruecke/beispiel/holodeck.json', import.meta.url)), 'utf8')) as { forge: string; dateien: Prototyp[] }[];
const SEITE = (titel: string) => `<!doctype html><html><head><title>${titel}</title></head><body><p>${titel}</p></body></html>`;

function repo() {
  const r = mkdtempSync(join(tmpdir(), 'holodeck-repo-'));
  mkdirSync(join(r, 'prototypen'));
  return r;
}

/** a link to a file outside; where Windows forbids file symlinks (EPERM) none is made */
function dateiLink(ziel: string, pfad: string): boolean {
  try {
    symlinkSync(ziel, pfad, 'file');
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw err;
  }
}

describe('Holodeck: reading the prototypes (#44)', () => {
  it('only the HTML files directly in the folder, sorted, with title and mtime, never a path', () => {
    const r = repo();
    writeFileSync(join(r, 'prototypen', 'b-start.html'), SEITE('Start &amp; Ziel'));
    writeFileSync(join(r, 'prototypen', 'a.html'), '<p>ohne Titel</p>');
    writeFileSync(join(r, 'prototypen', 'notiz.txt'), 'nein');
    mkdirSync(join(r, 'prototypen', 'unter'));
    writeFileSync(join(r, 'prototypen', 'unter', 'tief.html'), SEITE('tief'));
    mkdirSync(join(r, 'prototypen', 'ordner.html'));
    utimesSync(join(r, 'prototypen', 'a.html'), new Date('2026-11-20T10:00:00Z'), new Date('2026-11-20T10:00:00Z'));
    const { dateien, meldungen } = liesPrototypen(r, 'prototypen/');
    expect(dateien.map((d) => [d.name, d.titel])).toEqual([
      ['a.html', 'a.html'],
      ['b-start.html', 'Start & Ziel'],
    ]);
    expect(dateien[0].geaendert).toBe('2026-11-20T10:00:00.000Z');
    expect(dateien[1].inhalt).toBe(SEITE('Start &amp; Ziel'));
    expect(meldungen).toEqual([]);
    expect(JSON.stringify(dateien)).not.toContain(r.replaceAll('\\', '\\\\'));
    expect(JSON.stringify(dateien)).not.toContain('prototypen');
  });

  it('a missing folder: no prototypes, no message', () => {
    expect(liesPrototypen(mkdtempSync(join(tmpdir(), 'holodeck-leer-')), 'prototypen/')).toEqual({ dateien: [], meldungen: [] });
  });

  it('prototype_dir may not lead out of the repository: .. or absolute reads nothing and says so, without the path', () => {
    const r = repo();
    const aussen = mkdtempSync(join(tmpdir(), 'holodeck-aussen-'));
    writeFileSync(join(aussen, 'geheim.html'), SEITE('geheim'));
    writeFileSync(join(r, 'prototypen', 'ok.html'), SEITE('ok'));
    for (const wert of ['..', '../', `../${aussen.split(/[\\/]/).pop()}`, 'prototypen/../..', 'prototypen\\..\\..', aussen, '/etc', '\\\\server\\teil', 'C:prototypen', '']) {
      const { dateien, meldungen } = liesPrototypen(join(r, 'prototypen'), wert);
      expect(dateien, wert).toEqual([]);
      expect(meldungen, wert).toHaveLength(1);
      expect(meldungen[0]).not.toContain(aussen);
    }
    expect(liesPrototypen(r, './prototypen').dateien.map((d) => d.name)).toEqual(['ok.html']);
  });

  it('no symlink or junction out of the folder: neither the folder itself, nor one on the way, nor a file in it', () => {
    const aussen = mkdtempSync(join(tmpdir(), 'holodeck-aussen-'));
    writeFileSync(join(aussen, 'geheim.html'), SEITE('geheim'));
    // the folder itself points outside
    const r1 = mkdtempSync(join(tmpdir(), 'holodeck-repo-'));
    symlinkSync(aussen, join(r1, 'prototypen'), 'junction');
    expect(liesPrototypen(r1, 'prototypen').dateien).toEqual([]);
    expect(liesPrototypen(r1, 'prototypen').meldungen).toHaveLength(1);
    // a link on the way
    const r2 = mkdtempSync(join(tmpdir(), 'holodeck-repo-'));
    mkdirSync(join(aussen, 'prototypen'));
    writeFileSync(join(aussen, 'prototypen', 'geheim.html'), SEITE('geheim'));
    symlinkSync(aussen, join(r2, 'docs'), 'junction');
    expect(liesPrototypen(r2, 'docs/prototypen').dateien).toEqual([]);
    expect(liesPrototypen(r2, 'docs/prototypen').meldungen[0]).toMatch(/aus dem Repository/);
    // links inside the folder: a directory named like a prototype, a file
    const r3 = repo();
    writeFileSync(join(r3, 'prototypen', 'echt.html'), SEITE('echt'));
    symlinkSync(aussen, join(r3, 'prototypen', 'tor.html'), 'junction');
    const datei = dateiLink(join(aussen, 'geheim.html'), join(r3, 'prototypen', 'link.html'));
    const { dateien } = liesPrototypen(r3, 'prototypen');
    expect(dateien.map((d) => d.name)).toEqual(['echt.html']);
    expect(JSON.stringify(dateien)).not.toContain('geheim');
    if (datei) expect(dateien.some((d) => d.name === 'link.html')).toBe(false);
  });

  it('limits: a file over 2 MB and the 51st are left out, a name the bridge would refuse too', () => {
    const r = repo();
    writeFileSync(join(r, 'prototypen', 'gross.html'), 'x'.repeat(PROTOTYP_MAX_BYTES + 1));
    writeFileSync(join(r, 'prototypen', 'genau.html'), 'x'.repeat(PROTOTYP_MAX_BYTES));
    writeFileSync(join(r, 'prototypen', 'mit leer.html'), SEITE('leer'));
    writeFileSync(join(r, 'prototypen', '.versteckt.html'), SEITE('versteckt'));
    let { dateien, meldungen } = liesPrototypen(r, 'prototypen');
    expect(dateien.map((d) => d.name)).toEqual(['genau.html']);
    expect(meldungen).toEqual(['.versteckt.html übersprungen (Dateiname nur aus Buchstaben, Ziffern, . _ -)', 'gross.html übersprungen (größer als 2 MB)', 'mit leer.html übersprungen (Dateiname nur aus Buchstaben, Ziffern, . _ -)']);
    const r2 = repo();
    for (let i = 0; i < PROTOTYPEN_MAX + 1; i++) writeFileSync(join(r2, 'prototypen', `p${String(i).padStart(2, '0')}.html`), SEITE(String(i)));
    ({ dateien, meldungen } = liesPrototypen(r2, 'prototypen'));
    expect(dateien).toHaveLength(PROTOTYPEN_MAX);
    expect(dateien.at(-1)!.name).toBe('p49.html');
    expect(meldungen).toEqual(['mehr als 50 Prototypen, der Rest fehlt']);
  });

  it('the title from <title>, entities resolved, else the file name', () => {
    expect(titelAus('<TITLE lang="de">\n  Karte &#8211; Entwurf&nbsp;2 &#x263A;</TITLE>', 'k.html')).toBe('Karte – Entwurf 2 ☺');
    expect(titelAus('<title>  </title>', 'k.html')).toBe('k.html');
    expect(titelAus('x'.repeat(10), 'k.html')).toBe('k.html');
    // cut by code points: a lone surrogate would make the bridge fail with 500
    expect(titelAus(`<title>${'a'.repeat(299)}\u{1F600}\u{1F600}</title>`, 'k.html')).toBe(`${'a'.repeat(299)}\u{1F600}`);
  });

  it('a message about a long name keeps whole characters', () => {
    const r = repo();
    writeFileSync(join(r, 'prototypen', `${'a'.repeat(119)}\u{1F600}x.html`), SEITE('lang'));
    const { meldungen } = liesPrototypen(r, 'prototypen');
    expect(meldungen).toEqual([`${'a'.repeat(119)}\u{1F600} übersprungen (Dateiname nur aus Buchstaben, Ziffern, . _ -)`]);
  });

  it('the adapter key prototype_dir, default prototypen/', () => {
    expect(liesAdapter('').prototype_dir).toBe('prototypen/');
    expect(liesAdapter('---\nprototype_dir: docs/entwuerfe/  # Holodeck\n---\n').prototype_dir).toBe('docs/entwuerfe/');
  });

  it('the contract beispiel/holodeck.json: two projects, the fields of the reader, names and sizes the bridge takes', () => {
    expect(beispiel.map((b) => b.forge)).toEqual(['interias/flotte-probe', 'interias/sternwarte']);
    const r = repo();
    writeFileSync(join(r, 'prototypen', 'x.html'), SEITE('x'));
    const muster = Object.keys(liesPrototypen(r, 'prototypen').dateien[0]).sort();
    for (const b of beispiel) {
      expect(Object.keys(b).sort()).toEqual(['dateien', 'forge']);
      for (const d of b.dateien) {
        expect(Object.keys(d).sort()).toEqual(muster);
        expect(d.name).toMatch(PROTOTYP_NAME);
        expect(d.titel).toBe(titelAus(d.inhalt, d.name));
        expect(Number.isNaN(Date.parse(d.geaendert))).toBe(false);
        expect(Buffer.byteLength(d.inhalt)).toBeLessThan(PROTOTYP_MAX_BYTES);
      }
    }
  });

  it('the state changes with a name or a content, not with the mtime', () => {
    const a = { name: 'a.html', titel: 'a', geaendert: '2026-11-20T10:00:00Z', inhalt: 'x' };
    expect(prototypenStand([a])).toBe(prototypenStand([{ ...a, geaendert: '2026-11-21T10:00:00Z' }]));
    expect(prototypenStand([a])).not.toBe(prototypenStand([{ ...a, inhalt: 'y' }]));
    expect(prototypenStand([a])).not.toBe(prototypenStand([{ ...a, name: 'b.html' }]));
    expect(prototypenStand([])).not.toBe(prototypenStand([a]));
  });
});

/** A stand-in bridge that records every set; the first `fehlt` sets fail with 500. */
async function bruecke(fehlt = 0) {
  const saetze: { forge: string; dateien: Prototyp[] }[] = [];
  let berichte = 0;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (x: unknown, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(x));
      };
      if (req.method === 'POST' && req.url === '/api/holodeck') {
        if (fehlt-- > 0) return json({ detail: 'kaputt' }, 500);
        saetze.push(JSON.parse(body));
        return json({ ok: true });
      }
      if (req.method === 'POST' && req.url === '/api/bericht') {
        berichte++;
        return json({ ok: true });
      }
      if (req.method === 'GET') return json([]);
      json({ detail: 'nicht da' }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, saetze, berichte: () => berichte, zu: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('Holodeck: the driver sends the set (#44)', () => {
  it('once per changed set, with the file name only; a refused set goes again with the next turn', async () => {
    const b = await bruecke(1);
    try {
      const t = aufbau({ adapter: 'merge: mensch\nprototype_dir: entwuerfe' });
      const repo = t.repo;
      mkdirSync(join(repo, 'entwuerfe'));
      writeFileSync(join(repo, 'entwuerfe', 'karte.html'), SEITE('Karte'));
      const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url, maxDauerMs: 3000 }), t.welt);
      expect(b.berichte()).toBeGreaterThan(1);
      expect(b.saetze).toHaveLength(1);
      expect(b.saetze[0].forge).toBe('o/r');
      expect(b.saetze[0].dateien.map((d) => [d.name, d.titel])).toEqual([['karte.html', 'Karte']]);
      expect(JSON.stringify(b.saetze[0])).not.toContain(repo.replaceAll('\\', '\\\\'));
    } finally {
      await b.zu();
    }
  }, T);

  it('prototype_dir out of the repository: an empty set and one event, the driver works on', async () => {
    const b = await bruecke();
    try {
      const t = aufbau({ adapter: 'merge: mensch\nprototype_dir: ../' });
      const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { bruecke: b.url, maxDauerMs: 3000 }), t.welt);
      expect(z.epics['3'].stufe).toBe('fertig');
      expect(b.saetze.map((s) => s.dateien)).toEqual([[]]);
      expect(t.p.meldungen.filter((m) => /Holodeck: prototype_dir führt aus dem Repository/.test(m))).toHaveLength(1);
    } finally {
      await b.zu();
    }
  }, T);
});
