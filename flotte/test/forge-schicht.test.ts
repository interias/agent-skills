// The driver's forge layer (#127): the shared cases against the stand-in of each forge, the choice by the
// adapter key forge, and that no gh call is left outside the GitHub implementation.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AsyncAufrufer, Aufrufer } from '../src/aufruf.ts';
import { giteaAsync, githubAsync } from '../src/forge/async.ts';
import { curlKonfig, curlLesen } from '../src/forge/curl.ts';
import { giteaZugriff } from '../src/forge/gitea.ts';
import { githubZugriff } from '../src/forge/github.ts';
import { zugriffFuer, type ForgeZugriff } from '../src/forge/zugriff.ts';
import { bestand, GITEA_API, ghAttrappe, giteaAttrappe, issueAnlegen, type Bestand } from './forge-attrappen.ts';
import { forgeFaelle, type ForgeStand } from './forge-faelle.ts';

function stand(b: Bestand, zugriff: ForgeZugriff): ForgeStand {
  return {
    zugriff,
    issue: async (x) => issueAnlegen(b, x).nummer,
    kindDazu: async (mission, kind) => void b.issues.find((i) => i.nummer === mission)!.kinder.push(kind),
    zweig: async (name) => void (b.zweige[name] = 1),
    lesen: async (nr) => {
      const i = b.issues.find((x) => x.nummer === nr)!;
      return { offen: i.offen, labels: [...i.labels], body: i.body, kommentare: i.kommentare.map((k) => k.body) };
    },
  };
}

describe('forge layer: GitHub through gh (stand-in)', () => {
  forgeFaelle(async () => {
    const b = bestand();
    return stand(b, githubZugriff(ghAttrappe(b), 'o/r'));
  });
});

describe('forge layer: Gitea through its API (stand-in)', () => {
  forgeFaelle(async () => {
    const b = bestand();
    return stand(b, giteaZugriff(giteaAttrappe(b), GITEA_API(b), () => 'token geheim'));
  });

  it('a Missionsziel with open blockers cannot be closed: the error names the 412', () => {
    const b = bestand();
    const mission = issueAnlegen(b, { titel: 'M', labels: ['epic'] });
    mission.kinder.push(issueAnlegen(b, { titel: 'K' }).nummer);
    const z = giteaZugriff(giteaAttrappe(b), GITEA_API(b), () => 'token geheim');
    expect(() => z.schliessen(mission.nummer)).toThrow(/HTTP 412.*offene Blocker/);
  });

  it('a mission blocked by another mission keeps it out of its Missionsziele (order edge)', () => {
    const b = bestand();
    const vorher = issueAnlegen(b, { titel: 'Vorher', labels: ['epic'] });
    const mission = issueAnlegen(b, { titel: 'M', labels: ['epic'] });
    const kind = issueAnlegen(b, { titel: 'K' });
    mission.kinder.push(vorher.nummer, kind.nummer);
    const z = giteaZugriff(giteaAttrappe(b), GITEA_API(b), () => 'token geheim');
    expect(z.kinder(mission.nummer).map((k) => k.nummer)).toEqual([kind.nummer]);
  });

  it('a wrong token reads as 404 and says it may be the token; the token goes on stdin, never as an argument', () => {
    const b = bestand();
    issueAnlegen(b, { titel: 'A' });
    const z = giteaZugriff(giteaAttrappe(b), GITEA_API(b), () => 'token falsch');
    expect(() => z.issue(1, ['title'])).toThrow(/HTTP 404 \(oder Token fehlt/);
    expect(b.aufrufe.flat().join(' ')).not.toContain('falsch');
  });

  it('a list longer than one page is read page by page (Gitea caps at 50)', () => {
    const b = bestand();
    for (let i = 0; i < 120; i++) issueAnlegen(b, { titel: `T${i}`, labels: ['epic'] });
    const z = giteaZugriff(giteaAttrappe(b), GITEA_API(b), () => 'token geheim');
    expect(z.issues('epic', ['number']).length).toBe(120);
    expect(z.issues('epic', ['number'], 70).length).toBe(70);
  });

  it('a comment by a collaborator with write access counts as COLLABORATOR, a stranger as NONE', () => {
    const b = bestand();
    b.mitarbeiter.push('kollege');
    const i = issueAnlegen(b, { titel: 'A', kommentare: [{ body: 'x', autor: 'kollege' }, { body: 'y', autor: 'fremd' }] });
    const z = giteaZugriff(giteaAttrappe(b), GITEA_API(b), () => 'token geheim');
    expect(z.issue(i.nummer, ['comments']).kommentare.map((k) => k.rolle)).toEqual(['COLLABORATOR', 'NONE']);
  });
});

describe('forge layer: curl config', () => {
  it('quotes body and header so that they come back unchanged', () => {
    const body = { body: 'Zeile 1\nZeile "2" mit \\ und\ttab und Ümlaut' };
    const x = curlLesen(curlKonfig({ methode: 'PATCH', url: 'http://h/api/v1/repos/o/r/issues/1', kopf: 'token a"b', body }));
    expect(x).toEqual({ methode: 'PATCH', url: 'http://h/api/v1/repos/o/r/issues/1', kopf: 'token a"b', body });
  });
});

describe('forge layer: the choice by the adapter', () => {
  const repoMit = (adapter: string) => {
    const repo = mkdtempSync(join(tmpdir(), 'flotte-forge-'));
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'epic.md'), `---\n${adapter}\n---\n`);
    return repo;
  };

  it('GitHub without the key, Gitea with forge: gitea, address from api, token from token_env', () => {
    const b = bestand();
    expect(zugriffFuer(repoMit('merge: mensch'), ghAttrappe(b), 'o/r').art).toBe('github');
    const repo = repoMit(`forge: gitea\napi: ${GITEA_API(b)}\ntoken_env: FLOTTE_TEST_FORGE_TOKEN`);
    issueAnlegen(b, { titel: 'Hallo' });
    process.env.FLOTTE_TEST_FORGE_TOKEN = 'geheim';
    try {
      const z = zugriffFuer(repo, giteaAttrappe(b), 'nicht/benutzt');
      expect([z.art, z.repo]).toEqual(['gitea', 'o/r']);
      expect(z.issue(1, ['title']).titel).toBe('Hallo');
    } finally {
      delete process.env.FLOTTE_TEST_FORGE_TOKEN;
    }
  });
});

describe('forge layer: gh only in the GitHub implementation', () => {
  // the order writer has its own GitHub side; the link check asks gh for the login itself (#125)
  const ERLAUBT = ['forge/github.ts', 'forge/async.ts', 'auftrag/github.ts', 'befehle/forge.ts'];
  // still to move behind the forge layer; each package of #127 takes its files off this list
  ERLAUBT.push('treiber/forge.ts', 'treiber/treiber.ts', 'werkzeuge/belegung.ts');
  const dateien = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? dateien(join(dir, n)) : n.endsWith('.ts') ? [join(dir, n)] : []));

  it('no other file under src/ calls gh', () => {
    const src = join(import.meta.dirname, '..', 'src');
    const treffer = dateien(src)
      .map((d) => d.slice(src.length + 1).replace(/\\/g, '/'))
      .filter((d) => !ERLAUBT.includes(d))
      .filter((d) => /\(\s*'gh'\s*,/.test(readFileSync(join(src, d), 'utf8')));
    expect(treffer).toEqual([]);
  });
});

const asynchron = (a: Aufrufer): AsyncAufrufer => async (p, args, o) => a(p, args, o);

describe.each([
  ['GitHub', (b: Bestand) => githubAsync(asynchron(ghAttrappe(b)), 'o/r')],
  ['Gitea', (b: Bestand) => giteaAsync(asynchron(giteaAttrappe(b)), GITEA_API(b), () => 'token geheim')],
] as const)('forge layer without blocking (flotte mission): %s', (_, bauen) => {
  it('labels, body, title, comments, Missionsziele and the pull request of the mission', async () => {
    const b = bestand();
    const mission = issueAnlegen(b, { titel: 'Mission', body: 'Plan', labels: ['epic', 'status/blockiert'] });
    const kind = issueAnlegen(b, { titel: 'Ziel' });
    mission.kinder.push(kind.nummer);
    const f = bauen(b);
    expect(await f.labelNamen()).toEqual(expect.arrayContaining(['epic', 'status/blockiert']));
    await f.labelAnlegen('status/in-arbeit', '00f0ff', 'Zustand');
    await f.labelsAendern(mission.nummer, ['status/in-arbeit'], ['status/blockiert']);
    expect(await f.labels(mission.nummer)).toEqual(['epic', 'status/in-arbeit']);
    expect([await f.body(mission.nummer), await f.titel(mission.nummer)]).toEqual(['Plan', 'Mission']);
    await f.kommentieren(mission.nummer, 'Eröffnung');
    expect(await f.kommentare(mission.nummer)).toEqual(['Eröffnung']);
    expect(await f.kinder(mission.nummer)).toEqual([kind.nummer]);
    expect(await f.offenerPr('epic/1-x')).toBeNull();
    const url = await f.prAnlegen('main', 'epic/1-x', 'WIP: Mission', 'Gate');
    expect(url).toMatch(/\/pulls?\/\d+$/);
    expect(await f.offenerPr('epic/1-x')).toBe(url);
  });
});
