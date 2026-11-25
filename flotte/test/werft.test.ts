// The Werft (#88): a fixture repository with its own bare origin and stand-in deploy commands; a
// commit on origin/main pulls exactly the touched stacks, an error holds only its stack, a restart
// goes on from the saved stand, and the bridge is only called, never calling.

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aufrufen } from '../src/aufruf.ts';
import { Bruecke } from '../src/treiber/bruecke.ts';
import { deployAus, ladeStand, musterRegex, takt, werft, werftHandlungenAusJson, type WerftBericht, type WerftHandlung } from '../src/befehle/werft.ts';

const T = 60_000;

const ADAPTER = `---
main_branch: main
deploy:
  abfrage_s: 120
  a.pfade: [apps/a/, geteilt/**]
  a.nachziehen: bun ../../nachziehen.ts a
  b.pfade: [apps/b/**]
  b.nachziehen: bun ../../nachziehen.ts b
  b.migration_test: bun ../../nachziehen.ts b-migration
  c.pfade: [apps/c/]
  c.nachziehen: bun ../../nachziehen.ts c
---

# Adapter der Werft-Fixture
`;

// records "<stack> <commit>" and fails while a file kaputt-<stack> lies next to it
const NACHZIEHEN = `import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const stack = process.argv[2];
appendFileSync(join(import.meta.dir, 'aufrufe.txt'), \`\${stack} \${process.env.WERFT_COMMIT}\\n\`);
if (existsSync(join(import.meta.dir, \`kaputt-\${stack}\`))) { console.error(\`\${stack}: Compose-Fehler\`); process.exit(1); }
console.log(\`\${stack} nachgezogen\`);
`;

// the stand-in for a working database: a SQLite file next to the fixture (bun:sqlite, no server).
// sichern writes a backup with VACUUM INTO and names it in its last line; migrieren adds a row with
// the commit and notes the state of its migration in werft.json as it starts; lesen prints the rows of
// a file. Marker files make the backup fail (after writing and naming a file), stale or empty.
const DB = `import { Database } from 'bun:sqlite';
import { appendFileSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = import.meta.dir;
const was = process.argv[2];
const arbeit = join(dir, 'arbeit.sqlite');
if (was === 'lesen') {
  const d = new Database(process.argv[3], { readonly: true });
  console.log(JSON.stringify(d.query('SELECT commit_sha FROM migrationen').all().map((x) => x.commit_sha)));
  d.close();
  process.exit(0);
}
if (was === 'anlegen') {
  const d = new Database(arbeit);
  d.run('CREATE TABLE migrationen (commit_sha TEXT)');
  d.close();
  process.exit(0);
}
appendFileSync(join(dir, 'aufrufe.txt'), \`\${was} \${process.env.WERFT_COMMIT}\\n\`);
const kaputt = () => existsSync(join(dir, \`kaputt-\${was}\`)) && (console.error(\`\${was}: gescheitert\`), process.exit(1));
if (was !== 'sichern') kaputt();
if (was === 'sichern') {
  mkdirSync(join(dir, 'sicherungen'), { recursive: true });
  const ziel = join(dir, 'sicherungen', \`\${Date.now()}-\${Math.random().toString(36).slice(2)}.sqlite\`);
  if (existsSync(join(dir, 'alt-sichern'))) {
    writeFileSync(ziel, 'alt');
    utimesSync(ziel, new Date('2020-01-01'), new Date('2020-01-01'));
  } else if (existsSync(join(dir, 'leer-sichern'))) writeFileSync(ziel, '');
  else {
    const d = new Database(arbeit);
    d.run(\`VACUUM INTO '\${ziel.replaceAll("'", "''")}'\`);
    d.close();
  }
  console.log('Sicherung geschrieben:');
  console.log(ziel);
  kaputt();
} else {
  const stand = JSON.parse(readFileSync(join(process.cwd(), '.git', 'flotte', 'werft.json'), 'utf8'));
  appendFileSync(join(dir, 'zustand-beim-start.txt'), \`\${stand.stacks[process.env.WERFT_STACK].arbeit.zustand}\\n\`);
  const d = new Database(arbeit);
  d.query('INSERT INTO migrationen (commit_sha) VALUES (?)').run(process.env.WERFT_COMMIT);
  d.close();
  console.log('migriert');
}
`;

const MIGRATION = `---
main_branch: main
deploy:
  d.pfade: [apps/d/]
  d.nachziehen: bun ../../nachziehen.ts d
  d.sicherung: bun ../../db.ts sichern
  d.migration_arbeit: bun ../../db.ts migrieren
---
`;

const wurzeln: string[] = [];
afterAll(() => {
  for (const w of wurzeln) rmSync(w, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => {
  const r = aufrufen('git', ['-C', cwd, ...args]);
  if (r.code) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** wurzel/origin.git (bare), wurzel/arbeit (where merges land on main), wurzel/rechner/repo (the Werft's checkout) */
function fixture(adapter = ADAPTER) {
  const wurzel = mkdtempSync(join(tmpdir(), 'flotte-werft-'));
  wurzeln.push(wurzel);
  const origin = join(wurzel, 'origin.git');
  const arbeit = join(wurzel, 'arbeit');
  const rechner = join(wurzel, 'rechner');
  mkdirSync(rechner);
  writeFileSync(join(wurzel, 'nachziehen.ts'), NACHZIEHEN);
  writeFileSync(join(wurzel, 'db.ts'), DB);
  aufrufen('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  aufrufen('git', ['init', '-q', '-b', 'main', arbeit]);
  git(arbeit, 'config', 'user.email', 'werft@example.invalid');
  git(arbeit, 'config', 'user.name', 'Werft');
  mkdirSync(join(arbeit, '.claude'));
  writeFileSync(join(arbeit, '.claude', 'epic.md'), adapter);
  git(arbeit, 'add', '.');
  git(arbeit, 'commit', '-q', '-m', 'adapter');
  git(arbeit, 'remote', 'add', 'origin', origin);
  git(arbeit, 'push', '-q', 'origin', 'main');
  const repo = join(rechner, 'repo');
  aufrufen('git', ['clone', '-q', origin, repo]);
  const merge = (...dateien: string[]) => {
    for (const d of dateien) {
      mkdirSync(join(arbeit, d, '..'), { recursive: true });
      writeFileSync(join(arbeit, d), `${Date.now()} ${Math.random()}\n`);
    }
    git(arbeit, 'add', '.');
    git(arbeit, 'commit', '-q', '-m', `merge ${dateien.join(' ')}`);
    git(arbeit, 'push', '-q', 'origin', 'main');
    return git(arbeit, 'rev-parse', 'HEAD');
  };
  const aufrufe = () => (existsSync(join(wurzel, 'aufrufe.txt')) ? readFileSync(join(wurzel, 'aufrufe.txt'), 'utf8').split(/\r?\n/).filter(Boolean) : []);
  const leere = () => rmSync(join(wurzel, 'aufrufe.txt'), { force: true });
  let uhr = Date.parse('2026-11-23T10:00:00Z');
  // every takt is a quarter of an hour later: each repository is due
  const jetzt = () => new Date((uhr += 15 * 60_000));
  /** the rows of the working database or of a backup of it */
  const zeilen = (datei = join(wurzel, 'arbeit.sqlite')): string[] => {
    const r = aufrufen('bun', [join(wurzel, 'db.ts'), 'lesen', datei]);
    if (r.code) throw new Error(r.stderr);
    return JSON.parse(r.stdout) as string[];
  };
  /** a merge that only changes the adapter */
  const neuerAdapter = (text: string) => {
    writeFileSync(join(arbeit, '.claude', 'epic.md'), text);
    git(arbeit, 'commit', '-q', '-am', 'adapter');
    git(arbeit, 'push', '-q', 'origin', 'main');
    return git(arbeit, 'rev-parse', 'HEAD');
  };
  return { wurzel, rechner, repo, merge, neuerAdapter, aufrufe, leere, jetzt, zeilen, kaputt: (s: string, an = true) => (an ? writeFileSync(join(wurzel, `kaputt-${s}`), '') : rmSync(join(wurzel, `kaputt-${s}`), { force: true })) };
}

/** A stand-in bridge: keeps the reports of the Werft, offers the actions once, records acknowledgements. */
async function brueckenAttrappe(handlungen: WerftHandlung[] = []) {
  const berichte: WerftBericht[] = [];
  const offen = new Map(handlungen.map((h) => [h.id, h]));
  const quittungen: number[] = [];
  const abgeholt: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (x: unknown, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(x));
      };
      if (req.method === 'POST' && req.url === '/api/werft') {
        berichte.push(JSON.parse(body) as WerftBericht);
        return json({ ok: true });
      }
      if (req.method === 'GET' && req.url?.startsWith('/api/werft/handlungen?')) {
        abgeholt.push(req.url);
        return json([...offen.values()]);
      }
      const q = /^\/api\/werft\/handlungen\/(\d+)\/quittung$/.exec(req.url ?? '');
      if (req.method === 'POST' && q) {
        offen.delete(Number(q[1]));
        quittungen.push(Number(q[1]));
        return json({ ok: true });
      }
      json({ detail: 'unbekannt' }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, berichte, quittungen, abgeholt, offen, zu: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('Werft (#88)', () => {
  it('reads the key deploy: stacks with patterns, commands and the fields of #89', () => {
    const d = deployAus(ADAPTER)!;
    expect(d.abfrageS).toBe(120);
    expect(d.stacks.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(d.stacks[0]).toEqual({ name: 'a', pfade: ['apps/a/', 'geteilt/**'], nachziehen: 'bun ../../nachziehen.ts a', migrationTest: null, migrationArbeit: null, sicherung: null });
    expect(d.stacks[1].migrationTest).toBe('bun ../../nachziehen.ts b-migration');
    expect(deployAus('---\nmain_branch: main\n---\n')).toBeNull();
    expect(deployAus('---\ndeploy:\n  x.pfade: [a/]\n  x.nachziehen: up\n  x.migration_arbeit: m\n  x.sicherung: s\n---\n')!.stacks[0]).toMatchObject({ migrationArbeit: 'm', sicherung: 's' });
    expect(deployAus('---\ndeploy:\n  x.pfade: [a/]\n  x.nachziehen: up\n---\n')!.abfrageS).toBe(120);
    // a working migration without a backup could never be released: an error, not a stack that waits forever
    expect(() => deployAus('---\ndeploy:\n  x.pfade: [a/]\n  x.nachziehen: up\n  x.migration_arbeit: m\n---\n')).toThrow(/x\.sicherung/);
    expect(() => deployAus('---\ndeploy:\n  x.pfade: [a/]\n  x.nachzihen: up\n---\n')).toThrow(/x\.nachzihen/);
    expect(() => deployAus('---\ndeploy:\n  x.pfade: [a/]\n---\n')).toThrow(/nachziehen/);
    expect(() => deployAus('---\ndeploy:\n  abfrage_s: 0\n  x.pfade: [a/]\n  x.nachziehen: up\n---\n')).toThrow(/abfrage_s/);
  });

  it('matches path patterns: ** over folders, * inside one, a trailing / is the folder', () => {
    expect(musterRegex('apps/a/').test('apps/a/x/y.ts')).toBe(true);
    expect(musterRegex('apps/*.ts').test('apps/x/y.ts')).toBe(false);
    expect(musterRegex('**/compose.yml').test('compose.yml')).toBe(true);
    expect(musterRegex('**/compose.yml').test('apps/a/compose.yml')).toBe(true);
    expect(musterRegex('apps/a.b/?').test('apps/a.b/c')).toBe(true);
    expect(musterRegex('apps/a.b/?').test('apps/aXb/c')).toBe(false);
  });

  it(
    'a new commit with paths in stack a and b pulls exactly a and b and writes the stand on',
    async () => {
      const f = fixture();
      // the first look only takes the stand: nothing is pulled for what was there before the Werft
      const erst = await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(erst.repos).toHaveLength(1);
      expect(f.aufrufe()).toEqual([]);
      const anfang = ladeStand(f.repo).stand;
      expect(anfang).toBe(git(f.repo, 'rev-parse', 'origin/main'));

      const neu = f.merge('apps/a/main.ts', 'apps/b/x/y.ts', 'README.md');
      const b = await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      // b's test migration runs by itself right after b is pulled
      expect(f.aufrufe()).toEqual([`a ${neu}`, `b ${neu}`, `b-migration ${neu}`]);
      const s = ladeStand(f.repo);
      expect(s.stand).toBe(neu);
      expect(s.stacks.a).toMatchObject({ status: 'gruen', commit: neu });
      expect(s.stacks.b).toMatchObject({ status: 'gruen', commit: neu });
      expect(s.stacks.c).toBeUndefined();
      expect(b.repos[0].stand).toBe(neu);
      expect(b.repos[0].stacks.map((x) => [x.name, x.status])).toEqual([
        ['a', 'gruen'],
        ['b', 'gruen'],
        ['c', null],
      ]);

      // nothing new on origin/main: nothing pulled
      f.leere();
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(f.aufrufe()).toEqual([]);

      // a commit that touches no stack: nothing pulled, the stand moves on
      const daneben = f.merge('README.md', 'docs/x.md');
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(f.aufrufe()).toEqual([]);
      expect(ladeStand(f.repo).stand).toBe(daneben);
    },
    T,
  );

  it(
    'an error in a: b is pulled all the same, a stands on red with its log and is held',
    async () => {
      const f = fixture();
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      f.kaputt('a');
      const neu = f.merge('geteilt/lib.ts', 'apps/b/index.ts');
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(f.aufrufe()).toEqual([`a ${neu}`, `b ${neu}`, `b-migration ${neu}`]);
      const s = ladeStand(f.repo);
      expect(s.stand).toBe(neu);
      expect(s.stacks.b).toMatchObject({ status: 'gruen', commit: neu });
      expect(s.stacks.a).toMatchObject({ status: 'rot', commit: neu });
      expect(s.stacks.a.protokoll).toContain('a: Compose-Fehler');

      // a red stack waits for the person: the next commit touching a and c pulls only c
      f.leere();
      f.kaputt('a', false);
      const weiter = f.merge('apps/a/main.ts', 'apps/c/x.ts');
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(f.aufrufe()).toEqual([`c ${weiter}`]);
      expect(ladeStand(f.repo).stacks.a).toMatchObject({ status: 'rot', commit: neu });
      expect(ladeStand(f.repo).stand).toBe(weiter);
    },
    T,
  );

  it(
    'a restart goes on from the saved stand and pulls nothing twice, not even after a crash between two stacks',
    async () => {
      const f = fixture();
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      const neu = f.merge('apps/a/x.ts', 'apps/b/x.ts');
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      f.leere();
      // a new process knows only the file
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(f.aufrufe()).toEqual([]);

      // the Werft died after a and before b: the stand is the old one, a carries the new commit
      const danach = f.merge('apps/a/y.ts', 'apps/b/y.ts');
      const datei = join(git(f.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'flotte', 'werft.json');
      const s = ladeStand(f.repo);
      s.stacks.a = { ...s.stacks.a, commit: danach };
      writeFileSync(datei, JSON.stringify(s));
      expect(s.stand).toBe(neu);
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(f.aufrufe()).toEqual([`b ${danach}`, `b-migration ${danach}`]);
      expect(ladeStand(f.repo).stand).toBe(danach);

      // died after a again, and a commit touching only b came before the restart: a is not pulled again
      f.leere();
      const x = f.merge('apps/a/z.ts', 'apps/b/z.ts');
      const s2 = ladeStand(f.repo);
      s2.stacks.a = { ...s2.stacks.a, commit: x };
      writeFileSync(datei, JSON.stringify(s2));
      const y = f.merge('apps/b/w.ts');
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(f.aufrufe()).toEqual([`b ${y}`, `b-migration ${y}`]);
      expect(ladeStand(f.repo).stand).toBe(y);
    },
    T,
  );

  it(
    'the old stand is gone (force push and gc): every stack counts as touched, with a message',
    async () => {
      const f = fixture();
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      const datei = join(git(f.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'flotte', 'werft.json');
      writeFileSync(datei, JSON.stringify({ ...ladeStand(f.repo), stand: 'deadbeef'.repeat(5) }));
      const neu = f.merge('apps/c/x.ts');
      const b = await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(f.aufrufe()).toEqual([`a ${neu}`, `b ${neu}`, `b-migration ${neu}`, `c ${neu}`]);
      expect(b.meldungen.join('\n')).toMatch(/deadbee fehlt lokal/);
      expect(b.repos[0]).toMatchObject({ stand: neu, fehler: null });
    },
    T,
  );

  it(
    'a "nachziehen" that could not work (fetch failed) stays open at the bridge and works in the next takt',
    async () => {
      const f = fixture();
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      f.kaputt('a');
      const neu = f.merge('apps/a/x.ts');
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      f.kaputt('a', false);
      f.leere();
      const origin = git(f.repo, 'remote', 'get-url', 'origin');
      git(f.repo, 'remote', 'set-url', 'origin', join(f.wurzel, 'weg.git'));
      const br = await brueckenAttrappe([{ id: 7, forge: 'repo', stack: 'a', art: 'nachziehen', text: null, zeit: '2026-11-23T10:00:00Z', herkunft: 'Mensch über die Brücke' }]);
      try {
        const b = await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: new Bruecke(br.url, null), rechner: 'werft-test' });
        expect(b.repos[0].fehler).toMatch(/git fetch/);
        expect(f.aufrufe()).toEqual([]);
        expect(br.quittungen).toEqual([]);
        expect(br.offen.has(7)).toBe(true);
        expect(ladeStand(f.repo).handlungenErledigt).toEqual([]);

        git(f.repo, 'remote', 'set-url', 'origin', origin);
        await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: new Bruecke(br.url, null), rechner: 'werft-test' });
        expect(f.aufrufe()).toEqual([`a ${neu}`]);
        expect(ladeStand(f.repo).stacks.a).toMatchObject({ status: 'gruen', commit: neu });
        expect(br.quittungen).toEqual([7]);
      } finally {
        await br.zu();
      }
    },
    T,
  );

  describe('settings from the bridge (#90)', () => {
    /** the fixture after its first look, a bridge, a takt against both, an action per call */
    async function mitBruecke() {
      const f = fixture();
      const br = await brueckenAttrappe();
      const lauf = () => takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: new Bruecke(br.url, null), rechner: 'werft-test' });
      const h = (id: number, art: WerftHandlung['art'], stack: string | null, text: unknown = null) => br.offen.set(id, { id, forge: 'repo', stack, art, text: text === null ? null : JSON.stringify(text), zeit: '2026-11-23T10:00:00Z', herkunft: 'Mensch über die Brücke' });
      await lauf();
      return { f, br, lauf, h };
    }

    it(
      'Werft off: nothing is pulled, nachziehen is turned down; the setting outlasts a restart; on again it catches up',
      async () => {
        const { f, br, lauf, h } = await mitBruecke();
        try {
          h(1, 'einstellen', null, { name: 'an', wert: false });
          const aus = await lauf();
          expect(aus.repos[0]).toMatchObject({ an: false, migrationTest: true, abfrageS: 120, abfrageGesetzt: null });
          expect(aus.meldungen.join('\n')).toMatch(/Einstellung Werft von an → auf aus, Mensch über die Brücke/);
          expect(ladeStand(f.repo).an).toBe(false);

          const neu = f.merge('apps/a/x.ts', 'apps/b/x.ts');
          h(2, 'nachziehen', 'c');
          const b = await lauf();
          expect(f.aufrufe()).toEqual([]);
          expect(b.meldungen.join('\n')).toMatch(/Nachziehen über die Brücke abgelehnt: die Werft ist für repo aus/);
          expect(br.quittungen.sort()).toEqual([1, 2]);
          // the stand stays where it was: nothing was looked at
          expect(b.repos[0].stand).not.toBe(neu);

          h(3, 'einstellen', null, { name: 'an', wert: true });
          const an = await lauf();
          expect(an.repos[0].an).toBe(true);
          expect(f.aufrufe()).toEqual([`a ${neu}`, `b ${neu}`, `b-migration ${neu}`]);
        } finally {
          await br.zu();
        }
      },
      T,
    );

    it(
      'a stack off is not pulled, not even on request; on again it catches up on what it missed',
      async () => {
        const { f, br, lauf, h } = await mitBruecke();
        try {
          h(1, 'einstellen', 'b', { name: 'an', wert: false });
          await lauf();
          const neu = f.merge('apps/a/x.ts', 'apps/b/x.ts');
          h(2, 'nachziehen', 'b');
          const b = await lauf();
          expect(f.aufrufe()).toEqual([`a ${neu}`]);
          expect(b.meldungen.join('\n')).toMatch(/Nachziehen über die Brücke abgelehnt: der Stack b ist aus/);
          expect(b.repos[0].stacks.map((x) => [x.name, x.an])).toEqual([
            ['a', true],
            ['b', false],
            ['c', true],
          ]);
          expect(br.quittungen.sort()).toEqual([1, 2]);

          // a commit that touches only c: b still has the earlier one to catch up on
          f.leere();
          const spaeter = f.merge('apps/c/x.ts');
          h(3, 'einstellen', 'b', { name: 'an', wert: true });
          await lauf();
          expect(f.aufrufe()).toEqual([`b ${spaeter}`, `b-migration ${spaeter}`, `c ${spaeter}`]);
          expect(ladeStand(f.repo).stacks.b).toMatchObject({ status: 'gruen', commit: spaeter });

          // caught up: the next takt pulls nothing
          f.leere();
          await lauf();
          expect(f.aufrufe()).toEqual([]);
        } finally {
          await br.zu();
        }
      },
      T,
    );

    it(
      'test migrations off: nachziehen runs without them; the report shows the effective values',
      async () => {
        const { f, br, lauf, h } = await mitBruecke();
        try {
          h(1, 'einstellen', null, { name: 'migration_test', wert: false });
          h(2, 'einstellen', null, { name: 'abfrage_s', wert: 600 });
          await lauf();
          const neu = f.merge('apps/b/x.ts');
          h(3, 'nachziehen', 'b');
          const b = await lauf();
          expect(f.aufrufe()).toEqual([`b ${neu}`]);
          expect(b.repos[0]).toMatchObject({ an: true, migrationTest: false, abfrageS: 600, abfrageGesetzt: 600 });
          const s = ladeStand(f.repo);
          expect([s.migrationTest, s.abfrageS]).toEqual([false, 600]);
        } finally {
          await br.zu();
        }
      },
      T,
    );

    it(
      'a setting with another name, value or an unknown stack is turned down and acknowledged',
      async () => {
        const { f, br, lauf, h } = await mitBruecke();
        try {
          h(1, 'einstellen', null, { name: 'an', wert: 'aus' });
          h(2, 'einstellen', 'gibtsnicht', { name: 'an', wert: false });
          h(3, 'einstellen', null, { name: 'migration_test', wert: 1 });
          h(4, 'einstellen', 'b', { name: 'migration_test', wert: false });
          h(5, 'einstellen', null, { name: 'abfrage_s', wert: 0 });
          h(6, 'einstellen', null, { name: 'gibtsnicht', wert: true });
          const b = await lauf();
          expect(br.quittungen.sort()).toEqual([1, 2, 3, 4, 5, 6]);
          expect(b.meldungen.filter((x) => /Einstellung über die Brücke abgelehnt/.test(x))).toHaveLength(6);
          const s = ladeStand(f.repo);
          expect([s.an, s.stacksAus, s.migrationTest, s.abfrageS]).toEqual([true, [], true, null]);
        } finally {
          await br.zu();
        }
      },
      T,
    );

    it('a stand written before #90 reads with the defaults: on, every stack on, test migrations on', () => {
      const f = fixture();
      const datei = join(f.repo, '.git', 'flotte', 'werft.json');
      mkdirSync(join(datei, '..'), { recursive: true });
      writeFileSync(datei, JSON.stringify({ version: 1, stand: null, geprueft: null, abfrageS: null, fehler: null, stacks: {}, handlungenErledigt: [] }));
      expect(ladeStand(f.repo)).toMatchObject({ an: true, stacksAus: [], nachholen: [], migrationTest: true });
    });
  });

  it('one Werft per machine: a second start ends with an error, the lock goes with the first', async () => {
    const sperrDir = mkdtempSync(join(tmpdir(), 'flotte-werft-sperre-'));
    const leer = mkdtempSync(join(tmpdir(), 'flotte-werft-leer-'));
    wurzeln.push(sperrDir, leer);
    expect(await werft([leer, '--einmal'], sperrDir)).toMatchObject({ repos: [] });
    expect(existsSync(join(sperrDir, 'werft.lock'))).toBe(false);
    // a living process holds the lock: the parent of this test
    writeFileSync(join(sperrDir, 'werft.lock'), JSON.stringify({ pid: process.ppid, seit: '2026-11-23T10:00:00Z' }));
    await expect(werft([leer, '--einmal'], sperrDir)).rejects.toThrow(/läuft schon eine Werft \(PID \d+/);
    expect(JSON.parse(readFileSync(join(sperrDir, 'werft.lock'), 'utf8')).pid).toBe(process.ppid);
    // a dead holder is stale: taken over
    writeFileSync(join(sperrDir, 'werft.lock'), JSON.stringify({ pid: 999_999_9, seit: '2026-11-23T10:00:00Z' }));
    expect(await werft([leer, '--einmal'], sperrDir)).toMatchObject({ repos: [] });
  });

  it(
    'reports to the bridge, fetches "nachziehen" and a setting, acknowledges them; without a bridge it works on',
    async () => {
      const f = fixture();
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      f.kaputt('a');
      const neu = f.merge('apps/a/x.ts');
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      f.kaputt('a', false);
      f.leere();
      const h = (x: Partial<WerftHandlung> & Pick<WerftHandlung, 'id' | 'art'>): WerftHandlung => ({ forge: 'repo', stack: null, text: null, zeit: '2026-11-23T10:00:00Z', herkunft: 'Mensch über die Brücke', ...x });
      const br = await brueckenAttrappe([h({ id: 1, art: 'nachziehen', stack: 'a' }), h({ id: 2, art: 'einstellen', text: JSON.stringify({ name: 'abfrage_s', wert: 600 }) }), h({ id: 3, art: 'nachziehen', stack: 'gibtsnicht' }), h({ id: 4, art: 'migration_freigeben', stack: 'b', text: '{}' }), h({ id: 5, art: 'spaeter' as never, stack: 'b' })]);
      try {
        const b = await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: new Bruecke(br.url, null), rechner: 'werft-test' });
        expect(f.aufrufe()).toEqual([`a ${neu}`]);
        expect(ladeStand(f.repo).stacks.a).toMatchObject({ status: 'gruen', commit: neu, protokoll: null });
        expect(ladeStand(f.repo).abfrageS).toBe(600);
        expect(br.abgeholt).toEqual(['/api/werft/handlungen?rechner=werft-test']);
        // an unknown stack and a release for a stack without a working migration are turned down and acknowledged;
        // an art of a later Werft stays at the bridge
        expect(br.quittungen.sort()).toEqual([1, 2, 3, 4]);
        expect([...br.offen.keys()]).toEqual([5]);
        expect(br.berichte).toHaveLength(1);
        expect(br.berichte[0]).toEqual(b);
        expect(b).toMatchObject({ rechner: 'werft-test', repos: [{ forge: 'repo', branch: 'main', stand: neu, abfrageS: 600, fehler: null }] });
        expect(b.repos[0].stacks[0]).toMatchObject({ name: 'a', status: 'gruen', commit: neu, migration: { test: false, arbeit: false, sicherung: false } });
        expect(b.repos[0].stacks[1].migration).toEqual({ test: true, arbeit: false, sicherung: false });
        expect(b.meldungen.join('\n')).toMatch(/gibtsnicht/);
        expect(b.meldungen.join('\n')).toMatch(/Freigabe der Migration über die Brücke abgelehnt: kein b\.migration_arbeit/);
      } finally {
        await br.zu();
      }
      // the bridge is gone: the Werft pulls on
      f.leere();
      const weiter = f.merge('apps/c/x.ts');
      const tot = await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: new Bruecke(br.url, null, 500) });
      expect(f.aufrufe()).toEqual([`c ${weiter}`]);
      expect(tot.repos[0].stand).toBe(weiter);
    },
    T,
  );
});

describe('Werft: Migrationen (#89)', () => {
  /** what a release names, as the bridge reads it from the report */
  const bindung = (m: { commit: string; sicherung: string | null; pruefsumme: string | null }) => ({ commit: m.commit, sicherung: m.sicherung, pruefsumme: m.pruefsumme });

  /** the fixture with stack d (backup and working migration) and its SQLite database, a bridge, a takt against both */
  async function mitMigration() {
    const f = fixture(MIGRATION);
    aufrufen('bun', [join(f.wurzel, 'db.ts'), 'anlegen']);
    const br = await brueckenAttrappe();
    const lauf = () => takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: new Bruecke(br.url, null), rechner: 'werft-test' });
    const freigabe = (id: number, felder: unknown, stack = 'd') => br.offen.set(id, { id, forge: 'repo', stack, art: 'migration_freigeben', text: JSON.stringify(felder), zeit: '2026-11-23T10:00:00Z', herkunft: 'Mensch über die Brücke' });
    const nachziehen = (id: number) => br.offen.set(id, { id, forge: 'repo', stack: 'd', art: 'nachziehen', text: null, zeit: '2026-11-23T10:00:00Z', herkunft: 'Mensch über die Brücke' });
    await lauf();
    return { f, br, lauf, freigabe, nachziehen };
  }

  it(
    'a test migration runs by itself after nachziehen; when it fails the stack is red with its log',
    async () => {
      const f = fixture();
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      f.kaputt('b-migration');
      const neu = f.merge('apps/a/x.ts', 'apps/b/x.ts');
      const b = await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(f.aufrufe()).toEqual([`a ${neu}`, `b ${neu}`, `b-migration ${neu}`]);
      expect(ladeStand(f.repo).stacks.b).toMatchObject({ status: 'rot', commit: neu });
      expect(ladeStand(f.repo).stacks.b.protokoll).toContain('b-migration: Compose-Fehler');
      expect(b.meldungen.join('\n')).toMatch(/b rot .*migration_test/);
      // only b is held
      expect(ladeStand(f.repo).stacks.a).toMatchObject({ status: 'gruen', commit: neu });

      // a red nachziehen: the test migration does not run
      f.kaputt('b-migration', false);
      f.kaputt('b');
      f.leere();
      const br = await brueckenAttrappe([{ id: 1, forge: 'repo', stack: 'b', art: 'nachziehen', text: null, zeit: '2026-11-23T10:00:00Z', herkunft: 'Mensch über die Brücke' }]);
      try {
        await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: new Bruecke(br.url, null), rechner: 'werft-test' });
        expect(f.aufrufe()).toEqual([`b ${neu}`]);
      } finally {
        await br.zu();
      }
    },
    T,
  );

  it(
    'a working migration: backup first, never without a release, exactly once with it, not again after a restart',
    async () => {
      const { f, br, lauf, freigabe } = await mitMigration();
      try {
        const neu = f.merge('apps/d/x.ts');
        const b = await lauf();
        expect(f.aufrufe()).toEqual([`d ${neu}`, `sichern ${neu}`]);
        const m = b.repos[0].stacks[0].arbeit!;
        expect(m).toMatchObject({ zustand: 'wartet', commit: neu });
        expect(m.pruefsumme).toMatch(/^[0-9a-f]{64}$/);
        // the report names the file, never its path
        expect(m.sicherung).toMatch(/^[^/\\]+\.sqlite$/);
        expect(b.repos[0].stacks[0].status).toBe('gruen');

        // no release: the migration never runs, however many takts pass
        for (let i = 0; i < 3; i++) await lauf();
        expect(f.zeilen()).toEqual([]);
        expect(f.aufrufe()).not.toContain(`migrieren ${neu}`);

        // a release bound to another commit, another backup or to nothing is turned down and acknowledged
        freigabe(10, { ...bindung(m), commit: 'f'.repeat(40) });
        freigabe(11, { ...bindung(m), pruefsumme: '0'.repeat(64) });
        freigabe(12, { ...bindung(m), sicherung: 'andere.sqlite' });
        freigabe(15, { commit: neu });
        const abgelehnt = await lauf();
        expect(f.zeilen()).toEqual([]);
        expect(br.quittungen.sort()).toEqual([10, 11, 12, 15]);
        expect(abgelehnt.meldungen.filter((x) => /Freigabe der Migration über die Brücke abgelehnt/.test(x))).toHaveLength(4);
        expect(abgelehnt.repos[0].stacks[0].arbeit?.zustand).toBe('wartet');

        // the release of the waiting migration: it works on the database exactly once
        freigabe(13, bindung(m));
        const frei = await lauf();
        expect(f.zeilen()).toEqual([neu]);
        expect(f.aufrufe().filter((x) => x.startsWith('migrieren'))).toEqual([`migrieren ${neu}`]);
        expect(frei.repos[0].stacks[0].arbeit).toMatchObject({ zustand: 'migriert', commit: neu });
        expect(br.quittungen).toContain(13);
        // the stand said laeuft before the command started: a Werft that dies during it never starts it again
        expect(readFileSync(join(f.wurzel, 'zustand-beim-start.txt'), 'utf8').split(/\r?\n/).filter(Boolean)).toEqual(['laeuft']);
        // the backup was taken before: it holds the database without the migration
        const sicherung = ladeStand(f.repo).stacks.d.arbeit!.sicherung!;
        expect(f.zeilen(sicherung)).toEqual([]);

        // the same release again (its acknowledgement got lost), a second release, and each takt a new
        // process that knows only werft.json: the migration does not run again
        freigabe(13, bindung(m));
        freigabe(14, bindung(m));
        await lauf();
        await lauf();
        expect(f.zeilen()).toEqual([neu]);
        expect(br.quittungen.filter((x) => x === 13)).toHaveLength(2);
        expect(br.quittungen).toContain(14);
        expect(br.offen.size).toBe(0);
      } finally {
        await br.zu();
      }
    },
    T,
  );

  it(
    'an old release never moves a later migration: a new commit takes a new backup and needs its own release',
    async () => {
      const { f, br, lauf, freigabe } = await mitMigration();
      try {
        const x = f.merge('apps/d/x.ts');
        const alt = (await lauf()).repos[0].stacks[0].arbeit!;
        expect(alt).toMatchObject({ zustand: 'wartet', commit: x });
        const y = f.merge('apps/d/y.ts');
        const neu = (await lauf()).repos[0].stacks[0].arbeit!;
        expect(neu).toMatchObject({ zustand: 'wartet', commit: y });
        // two backups of an unchanged database may be byte for byte the same: the file tells them apart
        expect(neu.sicherung).not.toBe(alt.sicherung);

        freigabe(20, bindung(alt));
        freigabe(21, { ...bindung(alt), commit: y });
        await lauf();
        expect(f.zeilen()).toEqual([]);
        expect(br.quittungen.sort()).toEqual([20, 21]);

        freigabe(22, bindung(neu));
        await lauf();
        expect(f.zeilen()).toEqual([y]);
      } finally {
        await br.zu();
      }
    },
    T,
  );

  it(
    'a failed, stale or empty backup locks the release; nachziehen on the bridge takes a new one',
    async () => {
      const { f, br, lauf, freigabe, nachziehen } = await mitMigration();
      try {
        f.kaputt('sichern');
        const neu = f.merge('apps/d/x.ts');
        const b = await lauf();
        expect(f.aufrufe()).toEqual([`d ${neu}`, `sichern ${neu}`]);
        expect(b.repos[0].stacks[0]).toMatchObject({ status: 'rot', arbeit: { zustand: 'gesperrt', commit: neu, sicherung: null, pruefsumme: null } });
        expect(b.repos[0].stacks[0].protokoll).toContain('sichern: gescheitert');
        freigabe(30, { commit: neu, pruefsumme: null });
        const abgelehnt = await lauf();
        expect(abgelehnt.meldungen.join('\n')).toMatch(/Freigabe der Migration über die Brücke abgelehnt: .*keine geprüfte Sicherung/);
        expect(br.quittungen).toEqual([30]);
        expect(f.zeilen()).toEqual([]);
        expect(f.aufrufe().some((x) => x.startsWith('migrieren'))).toBe(false);

        // exit 0, but the file it names is older than the command
        f.kaputt('sichern', false);
        writeFileSync(join(f.wurzel, 'alt-sichern'), '');
        nachziehen(31);
        const alt = await lauf();
        expect(alt.repos[0].stacks[0]).toMatchObject({ status: 'rot', arbeit: { zustand: 'gesperrt' } });
        expect(alt.repos[0].stacks[0].protokoll).toMatch(/älter als der Sicherungsbefehl/);

        // exit 0, but the file is empty
        rmSync(join(f.wurzel, 'alt-sichern'));
        writeFileSync(join(f.wurzel, 'leer-sichern'), '');
        nachziehen(32);
        const leer = await lauf();
        expect(leer.repos[0].stacks[0]).toMatchObject({ status: 'rot', arbeit: { zustand: 'gesperrt' } });
        expect(leer.repos[0].stacks[0].protokoll).toMatch(/leer/);
        expect(f.zeilen()).toEqual([]);

        // a good backup: waits, and its release works
        rmSync(join(f.wurzel, 'leer-sichern'));
        nachziehen(33);
        const gut = (await lauf()).repos[0].stacks[0];
        expect(gut).toMatchObject({ status: 'gruen', arbeit: { zustand: 'wartet', commit: neu } });
        freigabe(34, bindung(gut.arbeit!));
        await lauf();
        expect(f.zeilen()).toEqual([neu]);

        // a red nachziehen takes no backup and drops the waiting migration: its release is turned down
        const y = f.merge('apps/d/y.ts');
        const w = (await lauf()).repos[0].stacks[0].arbeit!;
        expect(w).toMatchObject({ zustand: 'wartet', commit: y });
        f.kaputt('d');
        f.leere();
        nachziehen(35);
        const rot = (await lauf()).repos[0].stacks[0];
        expect(f.aufrufe()).toEqual([`d ${y}`]);
        expect(rot).toMatchObject({ status: 'rot', arbeit: null });
        freigabe(36, bindung(w));
        await lauf();
        expect(f.zeilen()).toEqual([neu]);
      } finally {
        await br.zu();
      }
    },
    T,
  );

  it(
    'a failed or interrupted migration is never run again by the same release; a backup that changed locks it',
    async () => {
      const { f, br, lauf, freigabe, nachziehen } = await mitMigration();
      try {
        f.kaputt('migrieren');
        const neu = f.merge('apps/d/x.ts');
        const m = (await lauf()).repos[0].stacks[0].arbeit!;
        freigabe(40, bindung(m));
        const rot = await lauf();
        expect(rot.repos[0].stacks[0]).toMatchObject({ status: 'rot', arbeit: { zustand: 'rot' } });
        expect(rot.repos[0].stacks[0].protokoll).toContain('migrieren: gescheitert');
        f.kaputt('migrieren', false);
        freigabe(40, bindung(m));
        freigabe(41, bindung(m));
        await lauf();
        expect(f.aufrufe().filter((x) => x.startsWith('migrieren'))).toEqual([`migrieren ${neu}`]);
        expect(f.zeilen()).toEqual([]);

        // the Werft died during a migration (the stand says it runs): a release never starts it again
        // d is red: the person pulls it again, which takes a new backup
        const y = f.merge('apps/d/y.ts');
        nachziehen(44);
        const w = (await lauf()).repos[0].stacks[0].arbeit!;
        expect(w).toMatchObject({ zustand: 'wartet', commit: y });
        const datei = join(git(f.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'flotte', 'werft.json');
        const s = ladeStand(f.repo);
        s.stacks.d.arbeit = { ...s.stacks.d.arbeit!, zustand: 'laeuft' };
        writeFileSync(datei, JSON.stringify(s));
        freigabe(42, bindung(w));
        const b = await lauf();
        expect(b.meldungen.join('\n')).toMatch(/abgelehnt: .*laeuft/);
        expect(f.zeilen()).toEqual([]);

        // the backup file changed after the check: the release is turned down and the migration locked
        const z = f.merge('apps/d/z.ts');
        const v = (await lauf()).repos[0].stacks[0].arbeit!;
        writeFileSync(ladeStand(f.repo).stacks.d.arbeit!.sicherung!, 'überschrieben');
        freigabe(43, bindung(v));
        const g = await lauf();
        expect(g.meldungen.join('\n')).toMatch(/abgelehnt: .*Sicherung .*geändert/);
        expect(g.repos[0].stacks[0].arbeit?.zustand).toBe('gesperrt');
        expect(f.zeilen()).toEqual([]);
      } finally {
        await br.zu();
      }
    },
    T,
  );

  it(
    'the shared contract: the report has the fields of flottenbruecke/beispiel/werft.json, the example actions are read',
    async () => {
      const beispiel = (datei: string) => JSON.parse(readFileSync(new URL(`../../flottenbruecke/beispiel/${datei}`, import.meta.url), 'utf8'));
      const { f, br, lauf } = await mitMigration();
      try {
        f.merge('apps/d/x.ts');
        const b = await lauf();
        const v = beispiel('werft.json');
        const api = v.repos[0].stacks.find((s: { name: string }) => s.name === 'api');
        expect(Object.keys(b).sort()).toEqual(Object.keys(v).sort());
        expect(Object.keys(b.repos[0]).sort()).toEqual(Object.keys(v.repos[0]).sort());
        expect(Object.keys(b.repos[0].stacks[0]).sort()).toEqual(Object.keys(api).sort());
        expect(Object.keys(b.repos[0].stacks[0].arbeit!).sort()).toEqual(Object.keys(api.arbeit).sort());
        const h = beispiel('werft-handlungen.json');
        expect(werftHandlungenAusJson(h)).toHaveLength(h.length);
      } finally {
        await br.zu();
      }
    },
    T,
  );

  it(
    'a switched-off Werft or stack runs no released migration: the release is turned down, the migration keeps waiting',
    async () => {
      const { f, br, lauf, freigabe } = await mitMigration();
      const einstellen = (id: number, name: string, wert: unknown, stack: string | null = null) => br.offen.set(id, { id, forge: 'repo', stack, art: 'einstellen', text: JSON.stringify({ name, wert }), zeit: '2026-11-23T10:00:00Z', herkunft: 'Mensch über die Brücke' });
      try {
        const x = f.merge('apps/d/x.ts');
        const m = (await lauf()).repos[0].stacks[0].arbeit!;
        expect(m).toMatchObject({ zustand: 'wartet', commit: x });

        einstellen(60, 'an', false, 'd');
        freigabe(61, bindung(m));
        const aus = await lauf();
        expect(aus.meldungen.join('\n')).toMatch(/Freigabe der Migration über die Brücke abgelehnt: der Stack d ist aus/);
        expect(aus.repos[0].stacks[0].arbeit?.zustand).toBe('wartet');
        expect(br.quittungen.sort()).toEqual([60, 61]);

        einstellen(62, 'an', true, 'd');
        einstellen(63, 'an', false);
        freigabe(64, bindung(m));
        const werftAus = await lauf();
        expect(werftAus.meldungen.join('\n')).toMatch(/Freigabe der Migration über die Brücke abgelehnt: die Werft ist für repo aus/);
        expect(werftAus.repos[0].stacks[0].arbeit?.zustand).toBe('wartet');
        expect(f.zeilen()).toEqual([]);

        // switched on again: the same waiting migration takes a new release
        einstellen(65, 'an', true);
        freigabe(66, bindung(m));
        await lauf();
        expect(f.zeilen()).toEqual([x]);
      } finally {
        await br.zu();
      }
    },
    T,
  );

  it(
    'a release is bound to the command the backup was taken for: a later adapter with another command locks it',
    async () => {
      const { f, br, lauf, freigabe } = await mitMigration();
      try {
        const x = f.merge('apps/d/x.ts');
        const m = (await lauf()).repos[0].stacks[0].arbeit!;
        expect(m).toMatchObject({ zustand: 'wartet', commit: x });
        // the report never carries the command
        expect(m).not.toHaveProperty('befehl');
        // only .claude/epic.md changes, outside d.pfade: d is not pulled again, its migration is another command
        const y = f.neuerAdapter(MIGRATION.replace('bun ../../db.ts migrieren', 'bun ../../db.ts boese'));
        freigabe(50, bindung(m));
        const b = await lauf();
        expect(ladeStand(f.repo).stand).toBe(y);
        expect(f.aufrufe().some((z) => z.startsWith('boese') || z.startsWith('migrieren'))).toBe(false);
        expect(b.meldungen.join('\n')).toMatch(/Freigabe der Migration über die Brücke abgelehnt: der Befehl von d hat sich seit der Sicherung geändert/);
        expect(b.repos[0].stacks[0].arbeit?.zustand).toBe('gesperrt');
        expect(br.quittungen).toEqual([50]);
        expect(f.zeilen()).toEqual([]);

        // a stand from before the command was kept (an older werft.json) is never released either
        const z = f.merge('apps/d/z.ts');
        const w = (await lauf()).repos[0].stacks[0].arbeit!;
        expect(w).toMatchObject({ zustand: 'wartet', commit: z });
        const datei = join(git(f.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'flotte', 'werft.json');
        const s = ladeStand(f.repo);
        delete (s.stacks.d.arbeit as { befehl?: string }).befehl;
        writeFileSync(datei, JSON.stringify(s));
        freigabe(51, bindung(w));
        const alt = await lauf();
        expect(alt.meldungen.join('\n')).toMatch(/abgelehnt: der Befehl von d hat sich seit der Sicherung geändert/);
        expect(f.aufrufe().some((z) => z.startsWith('boese') || z.startsWith('migrieren'))).toBe(false);
        expect(f.zeilen()).toEqual([]);
      } finally {
        await br.zu();
      }
    },
    T,
  );
});
