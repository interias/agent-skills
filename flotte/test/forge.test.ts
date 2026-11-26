// #125: the state of the forge per project (signed in / not / missing rights) from stand-ins for gh and
// the Gitea API, and `flotte forge verknuepfen` opening a terminal at the machine; never a token in the output.

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Aufrufer } from '../src/aufruf.ts';
import { forge, forgeStatus, repoRechte } from '../src/befehle/forge.ts';
import { curlLesen } from '../src/forge/curl.ts';

function repoMit(adapter: string): string {
  const repo = mkdtempSync(join(tmpdir(), 'flotte-forge-'));
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, '.claude', 'epic.md'), `---\n${adapter}\n---\n`);
  return repo;
}

const GITHUB = 'forge: github\napi: https://api.github.com/repos/o/r';
const GITEA = 'forge: gitea\napi: https://gitea.example/api/v1/repos/o/r\ntoken_env: FORGE_TEST_TOKEN';

function gh(o: { auth: boolean; push?: boolean | null }): Aufrufer {
  return (p, args) => {
    if (p === 'gh' && args[0] === 'auth') return o.auth ? { code: 0, stdout: '', stderr: 'github.com\n  ✓ Logged in to github.com account octo (keyring)\n  - Token: gho_************\n' } : { code: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts.' };
    if (p === 'gh' && args[0] === 'api') return o.push == null ? { code: 1, stdout: '', stderr: 'HTTP 404' } : { code: 0, stdout: `${o.push}\n`, stderr: '' };
    return { code: 1, stdout: '', stderr: 'unerwartet' };
  };
}

/** curl against the Gitea API like src/forge/curl.ts calls it; `null` is a curl that did not reach the host. */
function gitea(antworten: Record<string, { status: number; body?: unknown }> | null, weiter: Aufrufer = gh({ auth: false })): Aufrufer {
  return (p, args, o) => {
    if (p !== 'curl') return weiter(p, args, o);
    expect(args.join(' ')).not.toContain('geheim');
    const x = curlLesen(o?.eingabe ?? '');
    expect(x.kopf).toBe('token geheim-123');
    if (!antworten) return { code: 6, stdout: '', stderr: 'curl: (6) Could not resolve host: gitea.example' };
    const a = antworten[x.url] ?? { status: 404 };
    return { code: 0, stdout: `${JSON.stringify(a.body ?? {})}
${a.status}`, stderr: '' };
  };
}

const ERREICHBAR = { 'https://gitea.example/api/v1/user': { status: 200, body: { login: 'robo' } }, 'https://gitea.example/api/v1/repos/o/r': { status: 200, body: { permissions: { push: true }, has_issues: true } } };

describe('#125 Status der Forge', () => {
  it('GitHub: signed in with push rights, signed in without, not signed in', async () => {
    const repo = repoMit(GITHUB);
    expect(await forgeStatus(repo, { aufrufer: gh({ auth: true, push: true }) })).toEqual({ art: 'github', forge: 'o/r', angemeldet: true, konto: 'octo', rechte: 'ok', treiber: true });
    expect(await forgeStatus(repo, { aufrufer: gh({ auth: true, push: false }) })).toMatchObject({ angemeldet: true, rechte: 'fehlt' });
    expect(await forgeStatus(repo, { aufrufer: gh({ auth: true, push: null }) })).toMatchObject({ angemeldet: true, rechte: 'fehlt' });
    expect(await forgeStatus(repo, { aufrufer: gh({ auth: false }) })).toEqual({ art: 'github', forge: 'o/r', angemeldet: false, konto: null, rechte: null, treiber: true });
    expect(JSON.stringify(await forgeStatus(repo, { aufrufer: gh({ auth: true, push: true }) }))).not.toContain('gho_');
  });

  it('Gitea: the token from the machine, user and rights from the API; the driver runs it (#127)', async () => {
    const repo = repoMit(GITEA);
    process.env.FORGE_TEST_TOKEN = 'geheim-123';
    try {
      const ok = await forgeStatus(repo, { aufrufer: gitea(ERREICHBAR) });
      expect(ok).toEqual({ art: 'gitea', forge: 'o/r', angemeldet: true, konto: 'robo', rechte: 'ok', treiber: true });
      expect(JSON.stringify(ok)).not.toContain('geheim');
      const ohne = await forgeStatus(repo, { aufrufer: gitea({ 'https://gitea.example/api/v1/user': { status: 200, body: { login: 'robo' } }, 'https://gitea.example/api/v1/repos/o/r': { status: 200, body: { permissions: { push: false } } } }) });
      expect(ohne).toMatchObject({ angemeldet: true, rechte: 'fehlt' });
      const abgelehnt = await forgeStatus(repo, { aufrufer: gitea({ 'https://gitea.example/api/v1/user': { status: 401 } }) });
      expect(abgelehnt).toMatchObject({ angemeldet: false, konto: null, rechte: null });
      // a token without read:user: /user refuses, the repository answers; signed in, the account name unknown
      const ohneNutzer = await forgeStatus(repo, { aufrufer: gitea({ 'https://gitea.example/api/v1/user': { status: 403 }, 'https://gitea.example/api/v1/repos/o/r': { status: 200, body: { permissions: { push: true } } } }) });
      expect(ohneNutzer).toEqual({ art: 'gitea', forge: 'o/r', angemeldet: true, konto: null, rechte: 'ok', treiber: true });
    } finally {
      delete process.env.FORGE_TEST_TOKEN;
    }
    // no token and no entry in the credential store: not signed in, nothing called
    const leer = await forgeStatus(repo, { aufrufer: (p) => (expect(p).not.toBe('curl'), { code: 1, stdout: '', stderr: '' }) });
    expect(leer).toMatchObject({ art: 'gitea', angemeldet: false });
  });

  it('Gitea unreachable (curl status 0) is not "not signed in": forgeStatus fails, the next call after the outage is green again', async () => {
    const repo = repoMit(GITEA);
    process.env.FORGE_TEST_TOKEN = 'geheim-123';
    try {
      const fehler = await forgeStatus(repo, { aufrufer: gitea(null) }).then(() => null, (e: Error) => e);
      expect(fehler?.message).toMatch(/Gitea nicht erreichbar/);
      expect(fehler?.message).not.toContain('geheim');
      // the same module in the same process, the host back: signed in without a restart
      expect(await forgeStatus(repo, { aufrufer: gitea(ERREICHBAR) })).toMatchObject({ angemeldet: true, konto: 'robo', rechte: 'ok' });
      // signed in, but the repository read fails on the network: unreachable too, not "no push right"
      const halb = await forgeStatus(repo, { aufrufer: (p, a, o) => (curlLesen(o?.eingabe ?? '').url.endsWith('/user') ? gitea(ERREICHBAR) : gitea(null))(p, a, o) }).then(() => null, (e: Error) => e);
      expect(halb?.message).toMatch(/Gitea nicht erreichbar/);
    } finally {
      delete process.env.FORGE_TEST_TOKEN;
    }
  });

  it('repoRechte on Gitea goes through curl too: rights, a refusal, and an outage named as such', async () => {
    const repo = repoMit(GITEA);
    const q = { art: 'gitea' as const, forge: 'o/r', api: 'https://gitea.example/api/v1/repos/o/r' };
    process.env.FORGE_TEST_TOKEN = 'geheim-123';
    try {
      expect(await repoRechte(repo, q, { aufrufer: gitea(ERREICHBAR) })).toEqual({ push: true, issues: true });
      expect(await repoRechte(repo, q, { aufrufer: gitea({}) })).toEqual({ fehler: 'Gitea antwortete 404' });
      const weg = await repoRechte(repo, q, { aufrufer: gitea(null) });
      expect(weg).toMatchObject({ fehler: expect.stringMatching(/Gitea nicht erreichbar/) });
      expect(JSON.stringify(weg)).not.toContain('geheim');
    } finally {
      delete process.env.FORGE_TEST_TOKEN;
    }
  });

  it('verknuepfen opens a terminal at the machine: gh auth login, or the hidden Gitea prompt into the credential store', async () => {
    const befehle: string[] = [];
    await forge(['verknuepfen', repoMit(GITHUB)], { aufrufer: gh({ auth: false }), terminal: (b) => befehle.push(b) });
    await forge(['verknuepfen', repoMit(GITEA)], { aufrufer: gh({ auth: false }), terminal: (b) => befehle.push(b) });
    expect(befehle[0]).toBe('gh auth login --hostname github.com');
    expect(befehle[1]).toContain('Read-Host -AsSecureString');
    expect(befehle[1]).toContain('git credential approve');
    expect(befehle[1]).toContain('host=gitea.example');
    await expect(forge(['weg'], { aufrufer: gh({ auth: false }) })).rejects.toThrow(/pruefen\|verknuepfen/);
  });
});
