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
import { deployAus, ladeStand, musterRegex, takt, werft, type WerftBericht, type WerftHandlung } from '../src/befehle/werft.ts';

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
function fixture() {
  const wurzel = mkdtempSync(join(tmpdir(), 'flotte-werft-'));
  wurzeln.push(wurzel);
  const origin = join(wurzel, 'origin.git');
  const arbeit = join(wurzel, 'arbeit');
  const rechner = join(wurzel, 'rechner');
  mkdirSync(rechner);
  writeFileSync(join(wurzel, 'nachziehen.ts'), NACHZIEHEN);
  aufrufen('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  aufrufen('git', ['init', '-q', '-b', 'main', arbeit]);
  git(arbeit, 'config', 'user.email', 'werft@example.invalid');
  git(arbeit, 'config', 'user.name', 'Werft');
  mkdirSync(join(arbeit, '.claude'));
  writeFileSync(join(arbeit, '.claude', 'epic.md'), ADAPTER);
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
  return { wurzel, rechner, repo, merge, aufrufe, leere, jetzt, kaputt: (s: string, an = true) => (an ? writeFileSync(join(wurzel, `kaputt-${s}`), '') : rmSync(join(wurzel, `kaputt-${s}`), { force: true })) };
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
    expect(() => deployAus('---\ndeploy:\n  x.pfade: [a/]\n  x.nachzihen: up\n---\n')).toThrow(/x\.nachzihen/);
    expect(() => deployAus('---\ndeploy:\n  x.pfade: [a/]\n---\n')).toThrow(/nachziehen/);
    expect(() => deployAus('---\ndeploy:\n  abfrage_s: 0\n  x.pfade: [a/]\n  x.nachziehen: up\n---\n')).toThrow(/abfrage_s/);
  });

  it('matches paths like gate_areas: ** over folders, * inside one, a trailing / is the folder', () => {
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
      expect(f.aufrufe()).toEqual([`a ${neu}`, `b ${neu}`]);
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
      expect(f.aufrufe()).toEqual([`a ${neu}`, `b ${neu}`]);
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
      expect(f.aufrufe()).toEqual([`b ${danach}`]);
      expect(ladeStand(f.repo).stand).toBe(danach);

      // died after a again, and a commit touching only b came before the restart: a is not pulled again
      f.leere();
      const x = f.merge('apps/a/z.ts', 'apps/b/z.ts');
      const s2 = ladeStand(f.repo);
      s2.stacks.a = { ...s2.stacks.a, commit: x };
      writeFileSync(datei, JSON.stringify(s2));
      const y = f.merge('apps/b/w.ts');
      await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: null });
      expect(f.aufrufe()).toEqual([`b ${y}`]);
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
      expect(f.aufrufe()).toEqual([`a ${neu}`, `b ${neu}`, `c ${neu}`]);
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
      const br = await brueckenAttrappe([h({ id: 1, art: 'nachziehen', stack: 'a' }), h({ id: 2, art: 'einstellen', text: JSON.stringify({ name: 'abfrage_s', wert: 600 }) }), h({ id: 3, art: 'nachziehen', stack: 'gibtsnicht' }), h({ id: 4, art: 'migration_freigeben' as never, stack: 'b' })]);
      try {
        const b = await takt({ ordner: [f.rechner], jetzt: f.jetzt, bruecke: new Bruecke(br.url, null), rechner: 'werft-test' });
        expect(f.aufrufe()).toEqual([`a ${neu}`]);
        expect(ladeStand(f.repo).stacks.a).toMatchObject({ status: 'gruen', commit: neu, protokoll: null });
        expect(ladeStand(f.repo).abfrageS).toBe(600);
        expect(br.abgeholt).toEqual(['/api/werft/handlungen?rechner=werft-test']);
        // an unknown stack is turned down and acknowledged; an art of a later Werft stays at the bridge
        expect(br.quittungen.sort()).toEqual([1, 2, 3]);
        expect(br.berichte).toHaveLength(1);
        expect(br.berichte[0]).toEqual(b);
        expect(b).toMatchObject({ rechner: 'werft-test', repos: [{ forge: 'repo', branch: 'main', stand: neu, abfrageS: 600, fehler: null }] });
        expect(b.repos[0].stacks[0]).toMatchObject({ name: 'a', status: 'gruen', commit: neu, migration: { test: false, arbeit: false, sicherung: false } });
        expect(b.repos[0].stacks[1].migration).toEqual({ test: true, arbeit: false, sicherung: false });
        expect(b.meldungen.join('\n')).toMatch(/gibtsnicht/);
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
