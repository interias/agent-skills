import { describe, expect, it } from 'vitest';
import { belege, bildAus, kollision, liesAdapter, sammle, type EpicBild } from '../src/werkzeuge/belegung.ts';
import type { Aufrufer } from '../src/aufruf.ts';

const adapter = liesAdapter('---\nexclusive_paths: [package-lock.json, db/migrations/]\nalways_collide:\n  - CHANGELOG.md   # patch notes\n  - version.txt\n---\n');
const bild = (nr: number, o: Partial<EpicBild> = {}): EpicBild => ({ nr, module: [], dateien: [], exklusiv: false, migration: false, nach: [], ...o });

describe('adapter', () => {
  it('reads flat keys, inline and block lists, and defaults', () => {
    expect(adapter.exclusive_paths).toEqual(['package-lock.json', 'db/migrations/']);
    expect(adapter.always_collide).toEqual(['CHANGELOG.md', 'version.txt']);
    expect(adapter.modules_section).toBe('## Betroffene Module');
    expect(liesAdapter('').exclusive_paths).toContain('package-lock.json');
  });
});

describe('bildAus', () => {
  it('reads modules, files, exclusive, migration and order edges to epics of the deployment', () => {
    const body = [
      '> **Reihenfolge:** nach #3 und #4; Kinder: #11, #12',
      '',
      '## Betroffene Module',
      '- `api` — Endpunkte',
      '- web: Liste',
      '- Datenbank (Schema-Migration)',
      '',
      '## Blocked by',
      '- #5',
      '',
      'Ändert `api/routes.ts` und `CHANGELOG.md`.',
    ].join('\n');
    const b = bildAus(7, [body, 'Kind: `web/list.tsx`'], adapter, [3, 5, 7, 9]);
    expect(b).toEqual({ nr: 7, module: ['api', 'datenbank', 'web'], dateien: ['CHANGELOG.md', 'api/routes.ts', 'web/list.tsx'], exklusiv: false, migration: true, nach: [3, 5] });
    expect(bildAus(8, ['## Betroffene Module\n- core (Exklusiv)'], adapter, [8]).exklusiv).toBe(true);
  });
});

describe('kollision', () => {
  it('names the level with evidence, the higher one in doubt', () => {
    expect(kollision(bild(1, { module: ['api'] }), bild(2, { module: ['web'] }), adapter)).toMatchObject({ stufe: 'keine' });
    expect(kollision(bild(1, { dateien: ['CHANGELOG.md'] }), bild(2, { dateien: ['CHANGELOG.md', 'README.md'] }), adapter)).toMatchObject({ stufe: 'klein', beleg: expect.stringContaining('CHANGELOG.md') });
    expect(kollision(bild(1, { module: ['api'] }), bild(2, { module: ['api'] }), adapter)).toMatchObject({ stufe: 'mittel', beleg: 'dasselbe Modul: api' });
    expect(kollision(bild(1, { dateien: ['package-lock.json'] }), bild(2), adapter).stufe).toBe('mittel');
    expect(kollision(bild(1, { dateien: ['api/a.ts'] }), bild(2, { dateien: ['api/a.ts'] }), adapter)).toMatchObject({ stufe: 'gross', beleg: 'dieselben Dateien: api/a.ts' });
    expect(kollision(bild(1, { migration: true }), bild(2, { migration: true }), adapter).stufe).toBe('gross');
    expect(kollision(bild(1, { exklusiv: true }), bild(2), adapter).stufe).toBe('gross');
  });
});

describe('belege', () => {
  it('starts B only after A is merged (D14)', () => {
    const bilder = [bild(1), bild(2, { nach: [1] })];
    expect(belege(bilder, adapter, { laufend: [], gemergt: [] })).toMatchObject({ belegung: [1], wartend: [{ nr: 2, wartetAuf: [1] }] });
    expect(belege(bilder, adapter, { laufend: [1], gemergt: [] }).neu).toEqual([]);
    expect(belege(bilder, adapter, { laufend: [], gemergt: [1] }).belegung).toEqual([2]);
  });

  it('runs five epics with a large collision one after another, never more than four (D15)', () => {
    const gross = [1, 2, 3, 4, 5].map((n) => bild(n, { dateien: ['core/a.ts'] }));
    expect(belege(gross, adapter, { laufend: [], gemergt: [] }).belegung).toEqual([1]);
    expect(belege(gross, adapter, { laufend: [1], gemergt: [] }).neu).toEqual([]);
    const frei = [1, 2, 3, 4, 5].map((n) => bild(n, { module: [`m${n}`] }));
    expect(belege(frei, adapter, { laufend: [], gemergt: [] }).belegung).toEqual([1, 2, 3, 4]);
  });

  it('keeps the limit of the worst pair and prefers the set that unblocks most', () => {
    const bilder = [bild(1, { dateien: ['api/a.ts'] }), bild(2, { dateien: ['api/a.ts'] }), bild(3, { module: ['web'] }), bild(4, { nach: [2] })];
    // 1 and 2 are gross (alone): {1,3} and {2,3} are allowed; 2 unblocks #4
    expect(belege(bilder, adapter, { laufend: [], gemergt: [] }).belegung).toEqual([2, 3]);
  });

  it('lowers the cap by the weekly brake and adds nothing to running ones above it', () => {
    const frei = [1, 2, 3].map((n) => bild(n, { module: [`m${n}`] }));
    expect(belege(frei, adapter, { laufend: [], gemergt: [], obergrenze: 2 }).belegung).toEqual([1, 2]);
    expect(belege(frei, adapter, { laufend: [1, 2], gemergt: [], obergrenze: 1 })).toMatchObject({ belegung: [1, 2], neu: [] });
  });
});

describe('sammle', () => {
  it('reads epic and child bodies through gh', () => {
    const bodies: Record<string, string> = {
      '10': '## Betroffene Module\n- api\n\n- [ ] #11',
      '11': 'Ändert `api/x.ts`',
      '20': '> **Reihenfolge:** nach #10\n## Betroffene Module\n- web',
    };
    const gh: Aufrufer = (_p, args) => ({ code: 0, stdout: JSON.stringify({ body: bodies[args[2]] ?? '' }), stderr: '' });
    const { bilder } = sammle(gh, 'C:/gibt-es-nicht', 'o/r', [10, 20]);
    expect(bilder).toEqual([
      { nr: 10, module: ['api'], dateien: ['api/x.ts'], exklusiv: false, migration: false, nach: [] },
      { nr: 20, module: ['web'], dateien: [], exklusiv: false, migration: false, nach: [10] },
    ]);
  });
});
