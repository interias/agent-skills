// The real Mechanik of `flotte mission` (#66): counting and lint parsers on fixed outputs, then
// worktree.ps1 (Up, Down, CleanupStale), ram.ps1, the slot, 4c and the git steps for real against a
// fixture repository with its own remote; gh is recorded (test/epic-fixture.ts).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aufrufen, aufrufenAsync } from '../src/aufruf.ts';
import { attrappe } from '../src/epic/attrappe.ts';
import { fahreEpic, type EpicEinstellung } from '../src/epic/motor.ts';
import type { Paket } from '../src/epic/schema.ts';
import { forgeAus } from '../src/befehle/epic.ts';
import { echteMechanik, karte, stackLaeuft, type MechanikEinstellung } from '../src/epic/mechanik.ts';
import { zaehle, zaehleLint } from '../src/epic/zaehlen.ts';
import { fixture, forge, ADAPTER, type Fixture } from './epic-fixture.ts';

const T = 60_000;
const WT = 'C:/wt/7';

describe('Zählung der Testausgaben (#66)', () => {
  it('bun test: tests, files and the red tests with their file relative to the worktree', () => {
    const aus = 'bun test v1.3.14\n\ntest\\x.test.ts:\nerror: expect(received).toBe(expected)\n(fail) gruppe > b bad [0.14ms]\n\n 2 pass\n 1 fail\n 3 expect() calls\nRan 3 tests across 2 files. [53.00ms]';
    expect(zaehle(aus, 'cd flotte && bun test', WT)).toEqual({ dateien: 2, tests: 3, rot: [{ datei: 'flotte/test/x.test.ts', test: 'gruppe > b bad' }] });
    expect(zaehle(' 7 pass\n 0 fail\nRan 7 tests across 1 file. [58.00ms]', 'bun test', WT)).toEqual({ dateien: 1, tests: 7, rot: [] });
  });

  it('Pester 3: counts from the summary, the file from the command, red tests by name', () => {
    const aus = 'Describing D\n [+] ok 328ms\n [-] bad 89ms\n   Expected: {2}\nTests completed in 417ms\nPassed: 1 Failed: 1 Skipped: 0 Pending: 0 Inconclusive: 0';
    expect(zaehle(aus, 'powershell -NoProfile -Command "Invoke-Pester .\\mission\\scripts\\guard.Tests.ps1"', WT)).toEqual({ dateien: 1, tests: 2, rot: [{ datei: 'mission/scripts/guard.Tests.ps1', test: 'bad' }] });
    expect(zaehle('Tests completed in 5.2s\nTests Passed: 10, Failed: 0, Skipped: 1, NotRun: 0', 'Invoke-Pester x.Tests.ps1', WT)).toMatchObject({ dateien: 1, tests: 11, rot: [] });
  });

  it('pytest: -q gives no file count (null, not 0); FAILED and ERROR lines are red', () => {
    expect(zaehle('........ [100%]\n8 passed in 0.52s', 'cd flottenbruecke && python -m pytest -q', WT)).toEqual({ dateien: null, tests: 8, rot: [] });
    const rot = '..F.E\nFAILED tests/test_a.py::test_x - assert 1 == 2\nERROR tests/test_b.py::test_y - fixture\n1 failed, 3 passed, 1 error in 1.20s';
    expect(zaehle(rot, 'cd flottenbruecke && python -m pytest -q', WT)).toEqual({
      dateien: null,
      tests: 5,
      rot: [
        { datei: 'flottenbruecke/tests/test_a.py', test: 'test_x' },
        { datei: 'flottenbruecke/tests/test_b.py', test: 'test_y' },
      ],
    });
    expect(zaehle('tests/test_a.py ..  [ 50%]\ntests/test_b.py ..  [100%]\n===== 4 passed in 0.1s =====', 'pytest', WT).dateien).toBe(2);
  });

  it('an unknown format is an error, never a count of 0', () => {
    expect(() => zaehle('PASS src/a.test.js\nTests: 3 passed, 3 total', 'npx jest', WT)).toThrow(/keinem bekannten Format/);
    expect(() => zaehle('', 'bun test', WT)).toThrow(/keinem bekannten Format/);
  });

  it('lint: findings per file from the output, not the exit code; exit ≠ 0 without findings is an error', () => {
    const kompakt = 'src/a.ts:3:5: no-unused\nsrc/a.ts:9:1: x\nsrc\\b.ts(4,2): error TS2322: nope\nFound 3 problems';
    expect(zaehleLint(kompakt, 'cd client && npm run lint', WT, 0)).toEqual({ 'client/src/a.ts': 2, 'client/src/b.ts': 1 });
    const stylish = 'C:/wt/7/src/c.ts\n  1:1  error  bad\n  2:3  warning  meh\n\n✖ 2 problems (1 error, 1 warning)';
    expect(zaehleLint(stylish, 'npx eslint .', WT, 1)).toEqual({ 'src/c.ts': 2 });
    expect(zaehleLint('', 'npx eslint .', WT, 0)).toEqual({});
    expect(() => zaehleLint('Oops, crashed', 'npx eslint .', WT, 2)).toThrow(/ohne Befund in bekannter Form/);
  });

  it('the adapter: nested maps of the frontmatter; a missing key is null', () => {
    expect(karte(ADAPTER, 'test_commands')).toEqual({ fix: 'bun test' });
    expect(karte(ADAPTER, 'lint_commands')).toEqual({ fix: 'bun lint.ts' });
    expect(karte(ADAPTER, 'acceptance_commands')).toBeNull();
    const pester = '---\nisolation: none-needed\ntest_commands:\n  worktree: powershell -NoProfile -Command "Invoke-Pester .\\mission\\scripts\\worktree.Tests.ps1"\n  flotte: cd flotte && bun test   # bun\nworktree_root: ../x\n---\n';
    expect(karte(pester, 'test_commands')).toEqual({ worktree: 'powershell -NoProfile -Command "Invoke-Pester .\\mission\\scripts\\worktree.Tests.ps1"', flotte: 'cd flotte && bun test' });
  });
});

describe('der Slot (#66)', () => {
  it('a running compose project of a worktree or named <repo>-<package> of a locked package holds the slot; shared services and other repos do not', () => {
    const ls = (x: object[]) => JSON.stringify(x);
    expect(stackLaeuft(ls([{ Name: 'app-12', Status: 'running(3)', ConfigFiles: 'C:\\x\\compose.yml' }]), 'C:/src/app', 'C:/src/app-worktrees', ['12'])).toBe(true);
    expect(stackLaeuft(ls([{ Name: 'stack', Status: 'running(1)', ConfigFiles: '/mnt/c/src/app-worktrees/12/compose.yml' }]), 'C:/src/app', 'C:/src/app-worktrees', [])).toBe(true);
    expect(stackLaeuft(ls([{ Name: 'postgres', Status: 'running(1)', ConfigFiles: 'C:\\infra\\compose.yml' }, { Name: 'app-2x', Status: 'exited(1)' }]), 'C:/src/app', 'C:/src/app-worktrees', ['2x'])).toBe(false);
    // a shared service of the project (Sollte 7): the prefix app- alone does not hold the slot
    expect(stackLaeuft(ls([{ Name: 'app-services', Status: 'running(2)', ConfigFiles: 'C:\\src\\app\\compose.yml' }]), 'C:/src/app', 'C:/src/app-worktrees', ['12', 'epic-69'])).toBe(false);
    expect(stackLaeuft('', 'C:/src/app', 'C:/src/app-worktrees', [])).toBe(false);
  });
});

describe('die Abnahmestufe (#108)', () => {
  const mitAdapter = (adapter: string, code: (befehl: string) => number = () => 0) => {
    const repo = mkdtempSync(join(tmpdir(), 'flotte-abnahme-'));
    aufrufen('git', ['init', '-q', repo]);
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'epic.md'), adapter);
    const gefahren: { befehl: string; cwd?: string }[] = [];
    const m = echteMechanik({
      repo,
      epic: 69,
      epicBranch: 'epic/69-programm',
      basis: 'origin/main',
      forge: 'o/r',
      halter: join(repo, 'halter'),
      aufrufer: async (p, _args, o) => {
        gefahren.push({ befehl: p, cwd: o?.cwd });
        const c = code(p);
        return { code: c, stdout: c ? '2 failed\n' : 'ok\n', stderr: '' };
      },
    });
    return { m, gefahren, weg: () => rmSync(repo, { recursive: true, force: true }) };
  };

  it('acceptance_commands as a map or a list; each runs once in the given worktree, red on exit ≠ 0', async () => {
    const karteForm = mitAdapter('---\nacceptance_commands:\n  e2e: npx playwright test\n  sicht: npm run sicht\n---\n', (b) => (b === 'npm run sicht' ? 1 : 0));
    try {
      expect(karteForm.m.abnahmeBefehle()).toEqual(['e2e', 'sicht']);
      expect(await karteForm.m.abnahme('C:/wt/epic-69')).toEqual([
        { name: 'e2e', ok: true, text: 'e2e: grün' },
        { name: 'sicht', ok: false, text: 'sicht: Exit 1: 2 failed' },
      ]);
      expect(karteForm.gefahren).toEqual([
        { befehl: 'npx playwright test', cwd: 'C:/wt/epic-69' },
        { befehl: 'npm run sicht', cwd: 'C:/wt/epic-69' },
      ]);
    } finally {
      karteForm.weg();
    }
    const liste = mitAdapter('---\nacceptance_commands: [npm run e2e]\n---\n');
    try {
      expect(liste.m.abnahmeBefehle()).toEqual(['npm run e2e']);
    } finally {
      liste.weg();
    }
    const ohne = mitAdapter(ADAPTER);
    try {
      expect(ohne.m.abnahmeBefehle()).toEqual([]);
      expect(await ohne.m.abnahme('C:/wt/epic-69')).toEqual([]);
      expect(ohne.gefahren).toEqual([]);
    } finally {
      ohne.weg();
    }
  });
});

describe('Lesen gegen gh und pre_commit_checks (#108)', () => {
  const mitGh = (adapter: string, gh: (args: string[], n: number) => { code: number; stdout: string; stderr: string }) => {
    const repo = mkdtempSync(join(tmpdir(), 'flotte-gh-'));
    aufrufen('git', ['init', '-q', repo]);
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'epic.md'), adapter);
    const aufrufe: string[][] = [];
    const shell: string[] = [];
    const m = echteMechanik({
      repo,
      epic: 69,
      epicBranch: 'epic/69-programm',
      basis: 'origin/main',
      forge: 'o/r',
      halter: join(repo, 'halter'),
      aufrufer: async (p, args, o) => {
        if (o?.shell) {
          shell.push(p);
          return { code: 0, stdout: '', stderr: '' };
        }
        if (p !== 'gh') return aufrufenAsync(p, args, o);
        aufrufe.push(args);
        return gh(args, aufrufe.length);
      },
    });
    return { m, aufrufe, shell, repo, weg: () => rmSync(repo, { recursive: true, force: true }) };
  };
  const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' });

  it('a read of the forge goes again after HTTP 5xx or an unreadable answer; a 404 stops at once, a lasting 5xx after the last try', async () => {
    const wackel = mitGh(ADAPTER, (_a, n) => (n === 1 ? { code: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' } : n === 2 ? ok('{"body": "Kinder: #1') : ok(JSON.stringify({ body: 'Kinder: #1' }))));
    try {
      expect(await wackel.m.body(69)).toBe('Kinder: #1');
      expect(wackel.aufrufe).toHaveLength(3);
    } finally {
      wackel.weg();
    }
    const fehlt = mitGh(ADAPTER, () => ({ code: 1, stdout: '', stderr: 'GraphQL: Could not resolve to an Issue with the number of 69. (repository.issue)' }));
    try {
      await expect(fehlt.m.body(69)).rejects.toThrow(/Could not resolve/);
      expect(fehlt.aufrufe).toHaveLength(1);
    } finally {
      fehlt.weg();
    }
    const kaputt = mitGh(ADAPTER, () => ({ code: 1, stdout: '', stderr: 'gh: Server Error (HTTP 503)' }));
    try {
      await expect(kaputt.m.kommentare(69)).rejects.toThrow(/HTTP 503/);
      expect(kaputt.aufrufe).toHaveLength(4);
    } finally {
      kaputt.weg();
    }
  }, T);

  it('a comment after HTTP 5xx is written again only when it is not there yet', async () => {
    const da: string[] = [];
    const g = mitGh(ADAPTER, (args, n) => {
      if (args[1] === 'comment') {
        da.push('Text');
        // the forge took the first comment and still answered 502
        return n === 1 ? { code: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' } : ok('');
      }
      return ok(JSON.stringify({ comments: da.map((body) => ({ body })) }));
    });
    try {
      await g.m.kommentar(69, 'Text');
      expect(da).toEqual(['Text']);
      const leer: string[] = [];
      const h = mitGh(ADAPTER, (args, n) => (args[1] === 'comment' ? (n === 1 ? { code: 1, stdout: '', stderr: 'HTTP 500' } : (leer.push('Text'), ok(''))) : ok(JSON.stringify({ comments: leer.map((body) => ({ body })) }))));
      try {
        await h.m.kommentar(69, 'Text');
        expect(leer).toEqual(['Text']);
      } finally {
        h.weg();
      }
    } finally {
      g.weg();
    }
  }, T);

  it('pre_commit_checks: an entry without a program at its start is prose, never run as a shell command; the commands run', async () => {
    const g = mitGh(`---\npre_commit_checks:\n  - git --version\n  - core.hooksPath gesetzt und Patch-Notes-Check\n---\n`, () => ok(''));
    try {
      expect(g.m.vorCommitProsa()).toEqual(['core.hooksPath gesetzt und Patch-Notes-Check']);
      writeFileSync(join(g.repo, 'neu.txt'), 'x\n');
      aufrufen('git', ['-C', g.repo, 'config', 'user.name', 'T']);
      aufrufen('git', ['-C', g.repo, 'config', 'user.email', 't@example.invalid']);
      expect(await g.m.sichern(g.repo, 'neu (#1)\n')).toMatch(/^[0-9a-f]{40}$/);
      expect(g.shell).toEqual(['git --version']);
    } finally {
      g.weg();
    }
    const ohne = mitGh(ADAPTER, () => ok(''));
    try {
      expect(ohne.m.vorCommitProsa()).toEqual([]);
    } finally {
      ohne.weg();
    }
  }, T);

  it('statusAbnehmen: takes off every status label an earlier run left, keeps the others; nothing to do is no edit', async () => {
    const g = forge();
    g.labels[12] = ['status/in-arbeit', 'bug'];
    const m = echteMechanik({ repo: leeresRepo(), epic: 69, epicBranch: 'epic/69-programm', basis: 'origin/main', forge: 'o/r', halter: join(tmpdir(), `halter-${process.pid}`), aufrufer: g.aufrufer });
    expect(await m.statusAbnehmen(12)).toBeNull();
    expect(g.labels[12]).toEqual(['bug']);
    const edits = g.aufrufe.filter((a) => a[1] === 'edit').length;
    expect(await m.statusAbnehmen(13)).toBeNull();
    expect(g.aufrufe.filter((a) => a[1] === 'edit')).toHaveLength(edits);
  }, T);
});

describe('echte Mechanik gegen die Fixture (#66)', () => {
  let f: Fixture;
  const halter = () => join(f.wurzel, 'halter.json');
  const mech = (o: Partial<MechanikEinstellung> = {}) => echteMechanik({ repo: f.repo, epic: 69, epicBranch: 'epic/69-programm', basis: 'origin/main', forge: 'o/r', halter: halter(), aufrufer: forge().aufrufer, ...o });

  beforeAll(() => {
    f = fixture();
    f.git(['branch', 'epic/69-programm']);
  });
  afterAll(() => f.weg());

  it('flotte mission --mechanik echt: the forge comes from the push remote, an unreadable remote asks for --forge', () => {
    f.git(['remote', 'add', 'gh', 'https://github.com/o/r.git']);
    expect(forgeAus(f.repo, 'gh')).toBe('o/r');
    expect(() => forgeAus(f.repo, 'origin')).toThrow(/--forge/);
  });

  it('ram.ps1 for real: a level, never a guess', async () => {
    const r = await mech().ram();
    expect(['ok', 'warn', 'hold']).toContain(r.level);
  }, T);

  it('the slot reads docker compose ls through the caller; without docker it is free', async () => {
    const aufrufe: string[] = [];
    const m = mech({
      aufrufer: async (p, args) => {
        aufrufe.push(`${p} ${args.join(' ')}`);
        if (p === 'docker') return { code: 0, stdout: JSON.stringify([{ Name: 'x', Status: 'running(2)', ConfigFiles: join(f.wt, '12', 'compose.yml') }]), stderr: '' };
        return { code: 1, stdout: '', stderr: '' };
      },
    });
    expect(await m.slot()).toEqual({ belegt: true });
    const ohne = mech({ aufrufer: async () => ({ code: 1, stdout: '', stderr: 'nicht gefunden' }) });
    expect(await ohne.slot()).toEqual({ belegt: false });
    expect(aufrufe).toContain('docker compose ls --format json');
  }, T);

  it('Up and Down: worktree under worktree_root with lock, Up again takes it, a dirty worktree stays, Down again is harmless', async () => {
    const m = mech();
    const w = await m.up('5', 'agent/5-paket', 'main');
    expect(w).toEqual({ worktree: join(f.wt, '5'), port: null, isolation: null, kopf: f.git(['rev-parse', 'main']) });
    expect(existsSync(join(f.repo, '.git', 'epic-locks', '5.json'))).toBe(true);
    expect(existsSync(halter())).toBe(true);
    expect((await m.up('5', 'agent/5-paket', 'main')).worktree).toBe(w.worktree);
    writeFileSync(join(w.worktree, 'neu.txt'), 'x');
    expect(await m.down('5')).toEqual({ schmutzig: true });
    expect(existsSync(w.worktree)).toBe(true);
    rmSync(join(w.worktree, 'neu.txt'));
    expect(await m.down('5')).toEqual({ schmutzig: false });
    expect(existsSync(w.worktree)).toBe(false);
    expect(await m.down('5')).toEqual({ schmutzig: false });
    expect(f.git(['branch', '--list', 'agent/5-paket'])).toContain('agent/5-paket');
    await expect(m.up('6', 'agent/6-x', 'gibt-es-nicht')).rejects.toThrow(/worktree\.ps1 Up 6: worktree\.ps1: /);
  }, T);

  it('Up while another program holds .git/config (probe nachher-1, #68): the same Up once more, then the worktree', async () => {
    const sperre = join(f.repo, '.git', 'config.lock');
    const ups: number[] = [];
    const m = mech({
      aufrufer: async (p, args, o) => {
        const r = await aufrufenAsync(p, args, o);
        if (args.includes('Up')) {
          ups.push(r.code);
          rmSync(sperre, { force: true });
        }
        return r;
      },
    });
    // a new branch from a remote branch writes its upstream into .git/config
    writeFileSync(sperre, '');
    const w = await m.up('7', 'agent/7-sperre', 'origin/main');
    expect(ups).toEqual([1, 0]);
    expect(existsSync(w.worktree)).toBe(true);
    expect(await m.down('7')).toEqual({ schmutzig: false });
  }, T);

  it('CleanupStale: a lock of a dead session stays while its holder file exists, then goes; the branch stays', async () => {
    const kind = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
    const m = mech({ pid: kind.pid });
    const w = await m.up('7', 'agent/7-paket', 'main');
    kind.kill();
    await new Promise((r) => kind.once('exit', r));
    const gehalten = await m.aufraeumen();
    expect(existsSync(w.worktree)).toBe(true);
    expect(gehalten.some((x) => x.kind === 'lock' && x.action === 'skipped' && /held by/.test(String(x.reason)))).toBe(true);
    rmSync(halter());
    const weg = await m.aufraeumen();
    expect(weg.some((x) => x.action === 'removed')).toBe(true);
    expect(existsSync(w.worktree)).toBe(false);
    expect(f.git(['branch', '--list', 'agent/7-paket'])).toContain('agent/7-paket');
  }, T);

  it('4c: counts against the fixture, red file, single run, lint per file, touched files with uncommitted and new ones', async () => {
    const m = mech();
    const w = await m.up('8', 'agent/8-paket', 'main');
    expect(await m.volllauf(w.worktree)).toEqual([{ name: 'fix', dateien: 1, tests: 1, rot: [] }]);
    writeFileSync(join(w.worktree, 'test', 'rot.test.ts'), "import { expect, test } from 'bun:test';\ntest('rot', () => expect(1).toBe(2));\n");
    writeFileSync(join(w.worktree, 'src', 'liste.txt'), 'a\nTODO b\n');
    const lauf = await m.volllauf(w.worktree);
    expect(lauf).toEqual([{ name: 'fix', dateien: 2, tests: 2, rot: [{ datei: 'test/rot.test.ts', test: 'rot' }] }]);
    expect(await m.einzeln(w.worktree, 'test/rot.test.ts')).toBe(false);
    expect(await m.lint(w.worktree)).toEqual({ 'src/liste.txt': 1 });
    expect((await m.beruehrt(w.worktree)).sort()).toEqual(['src/liste.txt', 'test/rot.test.ts']);
    rmSync(join(w.worktree, 'test', 'rot.test.ts'));
    writeFileSync(join(w.worktree, 'src', 'liste.txt'), 'a\n');
    expect(await m.down('8')).toEqual({ schmutzig: false });
  }, T);

  it('a suite whose output has no known format stops 4c with an error instead of a count', async () => {
    writeFileSync(join(f.repo, '.claude', 'epic.md'), ADAPTER.replace('fix: bun test', 'fix: echo hallo'));
    try {
      await expect(mech().volllauf(f.repo)).rejects.toThrow(/Suite fix .*keinem bekannten Format/);
    } finally {
      writeFileSync(join(f.repo, '.claude', 'epic.md'), ADAPTER);
    }
  }, T);

  it('imEpic: the merge commit that brought the branch in, null before the merge and for a branch without commits; merge of such a branch is nothing to merge', async () => {
    const m = mech();
    await m.up('epic-69', 'epic/69-programm', 'origin/main');
    const w = await m.up('9', 'agent/9-paket', 'epic/69-programm');
    expect(await m.imEpic('agent/9-paket')).toBeNull();
    expect(await m.merge('agent/9-paket')).toEqual({ ok: true, commit: null });
    writeFileSync(join(w.worktree, 'src', 'neun.txt'), '9\n');
    expect(await m.sichern(w.worktree, 'Paket 9 (#9)\n')).toMatch(/^[0-9a-f]{40}$/);
    expect(await m.imEpic('agent/9-paket')).toBeNull();
    const v = await m.merge('agent/9-paket');
    expect(v.ok && v.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await m.imEpic('agent/9-paket')).toBe(v.ok ? v.commit : '');
    expect(await m.baumGleich('agent/9-paket')).toBe(true);
    expect(await m.down('9')).toEqual({ schmutzig: false });
    await m.down('epic-69');
  }, T);

  it('labels: a label that does not stick after the second read-back is a text (Glut point), not a stop', async () => {
    const g = forge();
    g.stur.add(13);
    const m = mech({ aufrufer: g.aufrufer });
    expect(await m.status(13, 'status/in-arbeit')).toMatch(/Labels an #13 stehen nach zwei Versuchen nicht wie gesetzt/);
    expect(g.aufrufe.filter((a) => a[1] === 'edit' && a[2] === '13')).toHaveLength(2);
    expect(await m.status(14, 'status/in-arbeit')).toBeNull();
  }, T);

  it('labels: missing ones are created with the colours of forge.md, one status label per ticket, read back', async () => {
    const g = forge();
    const m = mech({ aufrufer: g.aufrufer });
    await m.status(12, 'status/in-arbeit');
    await m.status(12, 'status/haengt');
    expect(g.labels[12]).toEqual(['status/haengt']);
    expect(g.aufrufe.filter((a) => a[0] === 'label' && a[1] === 'create').map((a) => [a[2], a[a.indexOf('--color') + 1]])).toEqual([
      ['status/in-arbeit', '00f0ff'],
      ['status/blockiert', 'ff3b5c'],
      ['status/haengt', 'fcee0a'],
      ['epic', 'ff2bd6'],
    ]);
    await m.eroeffnung();
    expect(g.labels[69].sort()).toEqual(['epic', 'status/in-arbeit']);
    await m.kommentar(12, 'Text mit `Backticks`');
    expect(await m.kommentare(12)).toEqual(['Text mit `Backticks`']);
    expect(g.aufrufe.find((a) => a[1] === 'comment')).toContain('--body-file');
  }, T);
});

const P = (nr: string, o: Partial<Paket> = {}): Paket => ({ nr, titel: `Paket ${nr}`, klasse: 'standard', abnahme: [`${nr} tut, was es soll`], decisions: [], outOfScope: [], testing: [], verifikation: '', lektuere: [], dateien: [], nach: [], kollision: [], exklusiv: false, ...o });
const leeresRepo = () => {
  const r = mkdtempSync(join(tmpdir(), 'flotte-epic-'));
  aufrufen('git', ['init', '-q', r]);
  return r;
};
const einst = (repo: string, maxRunden = 2): EpicEinstellung => ({ repo, epic: 69, epicBranch: 'epic/69-programm', basis: 'origin/main', fenster: 3, maxRunden, konto: '/konten/2' });

describe('Fehler im Befehlskanal und an den Labels sind Paketsache (#66, Runde 2)', () => {
  it('4c throws (unknown format): a finding, a new round, left behind after max_rounds; the others merge, the run ends', async () => {
    const u = attrappe({ schnitt: { version: 1, pakete: [P('1'), P('2')], tor: [] } });
    const volllauf = u.mechanik.volllauf;
    u.mechanik = { ...u.mechanik, volllauf: async (wt) => (wt === '/wt/1' ? Promise.reject(new Error('Suite fix (Exit 3): Ausgabe von "bun test" in keinem bekannten Format')) : volllauf(wt)) };
    const z = await fahreEpic(einst(leeresRepo()), u);
    expect(z.phase).toBe('fertig');
    expect(z.pakete['1'].stufe).toBe('zurueckgelassen');
    expect(z.pakete['1'].runde).toBe(2);
    expect(z.pakete['1'].grund).toMatch(/Nachprüfung gescheitert: Suite fix \(Exit 3\).*keinem bekannten Format/);
    expect(u.welt.aufrufe.filter((a) => a.rolle === 'implementer' && a.paket === '1')).toHaveLength(2);
    expect(z.pakete['2'].stufe).toBe('fertig');
  }, T);

  it('the merge job throws: the open merge is aborted, the package left behind; the run ends', async () => {
    const u = attrappe({ schnitt: { version: 1, pakete: [P('1'), P('2')], tor: [] } });
    const merge = u.mechanik.merge;
    u.mechanik = { ...u.mechanik, merge: async (b) => (b === 'agent/1-paket-1' ? Promise.reject(new Error('git merge --no-ff agent/1-paket-1: Exit 128: kaputt')) : merge(b)) };
    const z = await fahreEpic(einst(leeresRepo()), u);
    expect(z.phase).toBe('fertig');
    expect(z.pakete['1']).toMatchObject({ stufe: 'zurueckgelassen', mergeCommit: null });
    expect(z.pakete['1'].grund).toMatch(/Merge-Schritt gescheitert: git merge --no-ff agent\/1-paket-1: Exit 128: kaputt/);
    expect(u.welt.protokoll.some((x) => x.was.startsWith('merge --abort'))).toBe(true);
    expect(u.welt.status[1]).toBe('status/haengt');
    expect(z.pakete['2'].stufe).toBe('fertig');
  }, T);

  it('labels that do not stick at a start, the opening and the end: events and open points in the end block, the run ends', async () => {
    const u = attrappe({ schnitt: { version: 1, pakete: [P('1')], tor: [] } });
    u.mechanik = {
      ...u.mechanik,
      status: async (t) => `Labels an #${t} stehen nach zwei Versuchen nicht wie gesetzt (+status/in-arbeit −…)`,
      eroeffnung: async () => 'Labels an #69 stehen nach zwei Versuchen nicht wie gesetzt (+status/in-arbeit,epic −…)',
      abschluss: async () => ({ pr: 'https://example.invalid/o/r/pull/1', fehler: 'Labels an #69 stehen nach zwei Versuchen nicht wie gesetzt (+– −status/in-arbeit)' }),
    };
    const z = await fahreEpic(einst(leeresRepo()), u);
    expect(z.phase).toBe('fertig');
    expect(z.pakete['1'].stufe).toBe('fertig');
    expect(z.ereignisse.filter((e) => e.art === 'glut')).toHaveLength(3);
    expect(z.ende).toContain('- Labels an #1 stehen nach zwei Versuchen nicht wie gesetzt');
    expect(z.ende).toContain('- Labels an #69 stehen nach zwei Versuchen nicht wie gesetzt (+– −status/in-arbeit)');
  }, T);
});
