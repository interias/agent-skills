// The Gitea layer of the order writer (#73): the shared cases of the order writer against a
// throwaway Gitea in Docker. The test starts its own Compose project (own name per run, free port,
// fixed image tag) and removes it with its volume in afterAll, also when a case fails; what a killed
// earlier run left behind it removes before it starts. Without Docker it fails; it is not skipped
// (skill epic, rule 5).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auftragAusfuehren } from '../src/auftrag/auftrag.ts';
import { giteaForge } from '../src/auftrag/gitea.ts';
import { auftrag } from '../src/befehle/auftrag.ts';
import { aufrufen, aufrufenAsync, pwshPfad } from '../src/aufruf.ts';
import { forgeAsyncFuer } from '../src/forge/async.ts';
import { giteaZugriff } from '../src/forge/gitea.ts';
import { zugriffFuer } from '../src/forge/zugriff.ts';
import { missionAbschliessen } from '../src/treiber/forge.ts';
import { adapterAus, freigegebene, sammle } from '../src/werkzeuge/belegung.ts';
import { forgeFaelle, type ForgeStand } from './forge-faelle.ts';
import { auftragFaelle, ENTWURF_DREI, REGELN, type IssueStand, type Pruefstand } from './auftrag-faelle.ts';

const COMPOSE = join(import.meta.dirname, 'gitea', 'compose.yaml');
// in a package worktree (folder "73") the package number, anywhere else (the gate on main) "gate"
const ordner = basename(resolve(import.meta.dirname, '..', '..'));
const PROJEKT = `agent-skills-${/^\d+$/.test(ordner) ? ordner : 'gate'}-gitea-${process.pid}`;
const ADMIN = 'flotte-test';
const PASSWORT = `pw-${crypto.randomUUID()}`;

const docker = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true });
  // up to the subcommand of compose (index 5), never further: later arguments carry the password
  if (r.status !== 0) throw new Error(`docker ${args.slice(0, 6).join(' ')}: ${(r.stderr || String(r.error ?? r.stdout)).trim()}`);
  return r.stdout;
};
const compose = (args: string[], env: Record<string, string> = {}, projekt = PROJEKT) => docker(['compose', '-p', projekt, '-f', COMPOSE, ...args], env);

const lebt = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Projects of earlier runs that were killed before afterAll (Ctrl+C, a gate timeout): their process is gone. */
function resteAbraeumen() {
  const projekte = JSON.parse(docker(['compose', 'ls', '-a', '--format', 'json']) || '[]') as { Name: string }[];
  for (const { Name } of projekte) {
    const m = /^agent-skills-.+-gitea-(\d+)$/.exec(Name);
    if (m && Number(m[1]) !== process.pid && !lebt(Number(m[1]))) compose(['down', '-v', '--remove-orphans'], { GITEA_PORT: '3000' }, Name);
  }
}

const freierPort = () =>
  new Promise<number>((ok, fehler) => {
    const s = createServer()
      .once('error', fehler)
      .listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => ok(p));
      });
  });

let basis = '';
let port = 0;
let zaehler = 0;
let token = '';
let kopf = '';

const api = async (methode: string, pfad: string, body?: unknown, auth = kopf): Promise<any> => {
  const r = await fetch(`${basis}/api/v1${pfad}`, { method: methode, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: HTTP ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

/** every page of a list; Gitea caps them at 50 */
const alle = async (pfad: string): Promise<any[]> => {
  const ergebnis: any[] = [];
  for (let seite = 1; ; seite++) {
    const liste = await api('GET', `${pfad}${pfad.includes('?') ? '&' : '?'}limit=50&page=${seite}`);
    ergebnis.push(...liste);
    if (liste.length < 50) return ergebnis;
  }
};

/** A fresh repository per case, so the cases do not see each other's issues. */
async function neuesRepo(mitZweig = false): Promise<string> {
  const name = `fall-${++zaehler}`;
  await api('POST', '/user/repos', { name, auto_init: mitZweig, default_branch: 'main' });
  return name;
}

/** #127: the driver's forge layer against this Gitea, curl through the real Aufrufer */
async function forgeStand(): Promise<ForgeStand> {
  const name = await neuesRepo(true);
  const r = `/repos/${ADMIN}/${name}`;
  return {
    zugriff: giteaZugriff(aufrufen, `${basis}/api/v1${r}`, () => kopf),
    issue: async (x) => {
      const ids: number[] = [];
      for (const l of x.labels ?? []) {
        const da = (await alle(`${r}/labels`)).find((y) => y.name === l);
        ids.push(da ? da.id : (await api('POST', `${r}/labels`, { name: l, color: '#ededed' })).id);
      }
      return (await api('POST', `${r}/issues`, { title: x.titel, body: x.body ?? '', labels: ids })).number;
    },
    kindDazu: async (mission, kind) => void (await api('POST', `${r}/issues/${mission}/dependencies`, { owner: ADMIN, repo: name, index: kind })),
    zweig: async (zweig) => void (await api('POST', `${r}/contents/probe-${zaehler}.md`, { content: Buffer.from('probe\n').toString('base64'), branch: 'main', new_branch: zweig, message: 'probe' })),
    lesen: async (nr) => {
      const i = await api('GET', `${r}/issues/${nr}`);
      return { offen: i.state === 'open', labels: (i.labels as { name: string }[]).map((l) => l.name), body: i.body, kommentare: (await alle(`${r}/issues/${nr}/comments`)).map((c) => c.body) };
    },
  };
}

function pruefstand(name: string): Pruefstand {
  return {
    forge: giteaForge(`${basis}/api/v1/repos/${ADMIN}/${name}`, () => kopf, REGELN),
    issues: async (): Promise<IssueStand[]> => {
      const liste = await alle(`/repos/${ADMIN}/${name}/issues?state=all&type=issues`);
      return Promise.all(
        liste.map(async (i) => ({
          nummer: i.number,
          titel: i.title,
          body: i.body,
          labels: (i.labels as { name: string }[]).map((l) => l.name),
          // the issues that block this one; Gitea does not list them in linking order (equal timestamps), so by number, which is draft order
          verknuepft: (await alle(`/repos/${ADMIN}/${name}/issues/${i.number}/dependencies`)).map((d) => d.number as number).sort((a, b) => a - b),
        })),
      );
    },
  };
}

describe('auftrag: shared cases, Gitea layer against a throwaway Gitea', () => {
  beforeAll(async () => {
    resteAbraeumen();
    port = await freierPort();
    basis = `http://127.0.0.1:${port}`;
    try {
      compose(['up', '-d'], { GITEA_PORT: String(port) });
      for (let i = 0; ; i++) {
        try {
          if ((await fetch(`${basis}/api/healthz`)).ok) break;
        } catch {
          /* not up yet */
        }
        if (i > 90) throw new Error('Die Wegwerf-Gitea wurde in 90 s nicht gesund.');
        await new Promise((f) => setTimeout(f, 1000));
      }
      compose(['exec', '-T', '-u', 'git', 'gitea', 'gitea', 'admin', 'user', 'create', '--admin', '--username', ADMIN, '--password', PASSWORT, '--email', `${ADMIN}@example.invalid`, '--must-change-password=false'], { GITEA_PORT: String(port) });
      const basic = `Basic ${Buffer.from(`${ADMIN}:${PASSWORT}`).toString('base64')}`;
      token = (await api('POST', `/users/${ADMIN}/tokens`, { name: 'flotte-test', scopes: ['all'] }, basic)).sha1;
      kopf = `token ${token}`;
    } catch (e) {
      // a failed hook must not leave the stack behind, whether or not afterAll runs
      try {
        compose(['down', '-v', '--remove-orphans'], { GITEA_PORT: String(port) });
      } catch {
        /* the original error counts */
      }
      throw e;
    }
  }, 300_000);

  // also after a red case; ports and name are only needed to read the file, down removes by project
  afterAll(() => {
    compose(['down', '-v', '--remove-orphans'], { GITEA_PORT: String(port || 3000) });
  }, 120_000);

  auftragFaelle(async () => pruefstand(await neuesRepo()));

  describe('the forge layer of the driver (#127)', () => {
    forgeFaelle(forgeStand);
  });

  // #127, the probe of the issue: a mission with two Missionsziele is collected, built, docked after the gate and its
  // issues close. Real: the order writer, the driver's collecting, the forge layer, merge.ps1 and closing the
  // mission. Stood in: the runs of the Ingenieure (two commits by the test) and the gate run (its block in the PR).
  it('probe: a mission with two Missionsziele is collected, built, docked after the gate, its issues close', async () => {
    const protokoll: string[] = [];
    const schritt = (x: string) => protokoll.push(x);
    const name = await neuesRepo(true);
    const dir = join(mkdtempSync(join(tmpdir(), 'flotte-gitea-probe-')), 'repo');
    const git = (...args: string[]) => {
      const r = aufrufen('git', ['-C', dir, ...args]);
      if (r.code) throw new Error(`git ${args[0]}: ${r.stderr.trim()}`);
      return r.stdout.trim();
    };
    const remote = `http://${ADMIN}:${token}@127.0.0.1:${port}/${ADMIN}/${name}.git`;
    if (aufrufen('git', ['clone', '-q', remote, dir]).code) throw new Error('git clone gescheitert');
    git('config', 'user.name', 'probe');
    git('config', 'user.email', 'probe@example.invalid');
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'epic.md'), `---\nforge: gitea\napi: ${basis}/api/v1/repos/${ADMIN}/${name}\ntoken_env: FLOTTE_TEST_GITEA_TOKEN\nmerge: nach_gate\nmain_branch: main\n---\n# Adapter\n`);
    git('add', '.');
    git('commit', '-q', '-m', 'adapter');
    git('push', '-q', 'origin', 'main');
    writeFileSync(join(dir, 'entwurf.md'), ENTWURF_DREI.slice(0, ENTWURF_DREI.indexOf('# Missionsziel: Datei `probe/c.md`')));
    process.env.FLOTTE_TEST_GITEA_TOKEN = token;
    try {
      const a = (await auftrag([dir, join(dir, 'entwurf.md'), '--starten'])) as any;
      const mission: number = a.mission.nummer;
      const ziele: number[] = a.ziele.map((z: { nummer: number }) => z.nummer);
      schritt(`Auftrag: Mission #${mission}, Missionsziele ${ziele.map((z) => `#${z}`).join(', ')} (Labels ${a.labels.mission.join(', ')})`);

      const z = zugriffFuer(dir, aufrufen, '');
      const adapter = adapterAus(dir);
      expect(freigegebene(z, adapter).epics).toEqual([mission]);
      const { bilder } = sammle(z, dir, [mission]);
      expect(bilder[0].kinder).toEqual(ziele);
      schritt(`Eingesammelt: Mission #${mission} mit Missionszielen ${bilder[0].kinder!.map((k) => `#${k}`).join(', ')}`);

      const zweig = `epic/${mission}-probe`;
      git('checkout', '-q', '-b', zweig);
      for (const [i, datei] of ['a', 'b'].entries()) {
        mkdirSync(join(dir, 'probe'), { recursive: true });
        writeFileSync(join(dir, 'probe', `${datei}.md`), `Zeile ${datei}\n`);
        git('add', '.');
        git('commit', '-q', '-m', `feat: probe/${datei}.md (#${ziele[i]})`);
      }
      git('push', '-q', 'origin', zweig);
      const basisSha = git('rev-parse', 'origin/main');
      const kopfSha = git('rev-parse', 'HEAD');
      const body = `## Gate\n== Gate: Basis origin/main @ ${basisSha.slice(0, 7)} (HEAD ${kopfSha.slice(0, 8)})\nGate grün.\n\n${ziele.map((k) => `Closes #${k}`).join('\n')}\n`;
      const prUrl = await forgeAsyncFuer(dir, aufrufenAsync, '').prAnlegen('main', zweig, 'Probe des Andockens auf Gitea', body);
      const pr = Number(/\/pulls\/(\d+)$/.exec(prUrl ?? '')?.[1]);
      expect(pr).toBeGreaterThan(0);
      schritt(`Gebaut: ${zweig} mit 2 Commits, Pull Request #${pr} mit Gate-Block (Basis ${basisSha.slice(0, 7)}, HEAD ${kopfSha.slice(0, 8)})`);

      const zusatz = z.mergeSkript();
      const skript = resolve(import.meta.dirname, '..', '..', 'mission', 'scripts', 'merge.ps1');
      const m = aufrufen(pwshPfad(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', skript, '-Repo', z.repo, '-Pr', String(pr), '-LeerMinuten', '0', ...zusatz.args], { env: { ...process.env, ...zusatz.env } });
      const zeile = m.stdout.trim().split(/\r?\n/).pop() ?? '';
      schritt(`merge.ps1: ${zeile}`);
      expect(zeile).toBe(`GEMERGT #${pr} -> main; Issues zu: ${ziele.map((k) => `#${k}`).join(' ')}; Branch ${zweig} geloescht`);
      expect(z.pr(pr, ['state']).zustand).toBe('MERGED');

      const ende = missionAbschliessen(z, mission, pr, adapter.ready_label);
      schritt(`Mission: ${ende?.text}`);
      expect(ende).toEqual({ text: `Mission geschlossen nach dem Andocken von PR #${pr}`, endgueltig: true });
      const zustaende = [mission, ...ziele].map((n) => `#${n} ${z.issue(n, ['state']).zustand}`);
      schritt(`Issues: ${zustaende.join(', ')}`);
      expect(zustaende.every((x) => x.endsWith('CLOSED'))).toBe(true);
    } finally {
      delete process.env.FLOTTE_TEST_GITEA_TOKEN;
      console.log(`Probe #127 gegen die Wegwerf-Gitea:\n${protokoll.map((x) => `- ${x}`).join('\n')}`);
    }
  }, 180_000);

  it('a Missionsziel is a dependency of its mission, and the epic label carries colour and description', async () => {
    const name = await neuesRepo();
    const p = pruefstand(name);
    const r = await auftragAusfuehren(ENTWURF_DREI, REGELN, p.forge, { starten: false, trocken: false });
    if (r.trocken) throw new Error('trocken: false returned a dry result');
    const mission = (await p.issues()).find((i) => i.nummer === r.mission!.nummer)!;
    expect(mission.verknuepft).toEqual(r.ziele.map((z) => z.nummer));
    const epic = (await alle(`/repos/${ADMIN}/${name}/labels`)).find((l) => l.name === 'epic');
    expect(epic).toMatchObject({ color: 'ff2bd6', description: 'Mission: wartet auf ihre Missionsziele (gesetzt von /mission, gelesen von KIBO)' });
  }, 60_000);

  it('flotte auftrag with forge: gitea writes through the adapter, token from token_env', async () => {
    const name = await neuesRepo();
    const dir = mkdtempSync(join(tmpdir(), 'flotte-gitea-'));
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'epic.md'), `---\nforge: gitea\napi: ${basis}/api/v1/repos/${ADMIN}/${name}\ntoken_env: FLOTTE_TEST_GITEA_TOKEN\n---\n`);
    writeFileSync(join(dir, 'entwurf.md'), ENTWURF_DREI);
    process.env.FLOTTE_TEST_GITEA_TOKEN = token;
    try {
      const r = (await auftrag([dir, join(dir, 'entwurf.md'), '--starten'])) as any;
      expect(r.forge).toBe(`${ADMIN}/${name}`);
      expect(r.mission.url).toBe(`${basis}/${ADMIN}/${name}/issues/${r.mission.nummer}`);
      expect(r.labels).toEqual({ mission: ['epic', 'ready-for-agent'], ziele: ['ready-for-agent'] });
      expect(r.ziele).toHaveLength(3);
    } finally {
      delete process.env.FLOTTE_TEST_GITEA_TOKEN;
    }
  }, 60_000);
});
