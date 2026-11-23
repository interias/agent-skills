// #125: the state of the forge per project (signed in / not / missing rights) from stand-ins for gh and
// the Gitea API, and `flotte forge verknuepfen` opening a terminal at the machine; never a token in the output.

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Aufrufer } from '../src/aufruf.ts';
import { forge, forgeStatus, type ForgeWelt } from '../src/befehle/forge.ts';

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

function gitea(antworten: Record<string, { status: number; body?: unknown }>): ForgeWelt['abruf'] {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>).Authorization).toBe('token geheim-123');
    const a = antworten[String(url)] ?? { status: 404 };
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
  }) as ForgeWelt['abruf'];
}

describe('#125 Status der Forge', () => {
  it('GitHub: signed in with push rights, signed in without, not signed in', async () => {
    const repo = repoMit(GITHUB);
    expect(await forgeStatus(repo, { aufrufer: gh({ auth: true, push: true }) })).toEqual({ art: 'github', forge: 'o/r', angemeldet: true, konto: 'octo', rechte: 'ok', treiber: true });
    expect(await forgeStatus(repo, { aufrufer: gh({ auth: true, push: false }) })).toMatchObject({ angemeldet: true, rechte: 'fehlt' });
    expect(await forgeStatus(repo, { aufrufer: gh({ auth: true, push: null }) })).toMatchObject({ angemeldet: true, rechte: 'fehlt' });
    expect(await forgeStatus(repo, { aufrufer: gh({ auth: false }) })).toEqual({ art: 'github', forge: 'o/r', angemeldet: false, konto: null, rechte: null, treiber: true });
    expect(JSON.stringify(await forgeStatus(repo, { aufrufer: gh({ auth: true, push: true }) }))).not.toContain('gho_');
  });

  it('Gitea: the token from the machine, user and rights from the API; the driver does not speak Gitea yet', async () => {
    const repo = repoMit(GITEA);
    process.env.FORGE_TEST_TOKEN = 'geheim-123';
    try {
      const ok = await forgeStatus(repo, { aufrufer: gh({ auth: false }), abruf: gitea({ 'https://gitea.example/api/v1/user': { status: 200, body: { login: 'robo' } }, 'https://gitea.example/api/v1/repos/o/r': { status: 200, body: { permissions: { push: true } } } }) });
      expect(ok).toEqual({ art: 'gitea', forge: 'o/r', angemeldet: true, konto: 'robo', rechte: 'ok', treiber: false });
      expect(JSON.stringify(ok)).not.toContain('geheim');
      const ohne = await forgeStatus(repo, { aufrufer: gh({ auth: false }), abruf: gitea({ 'https://gitea.example/api/v1/user': { status: 200, body: { login: 'robo' } }, 'https://gitea.example/api/v1/repos/o/r': { status: 200, body: { permissions: { push: false } } } }) });
      expect(ohne).toMatchObject({ angemeldet: true, rechte: 'fehlt' });
      const abgelehnt = await forgeStatus(repo, { aufrufer: gh({ auth: false }), abruf: gitea({ 'https://gitea.example/api/v1/user': { status: 401 } }) });
      expect(abgelehnt).toMatchObject({ angemeldet: false, konto: null, rechte: null });
    } finally {
      delete process.env.FORGE_TEST_TOKEN;
    }
    // no token and no entry in the credential store: not signed in, nothing called
    const leer = await forgeStatus(repo, { aufrufer: () => ({ code: 1, stdout: '', stderr: '' }), abruf: (() => { throw new Error('nicht aufrufen'); }) as never });
    expect(leer).toMatchObject({ art: 'gitea', angemeldet: false });
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
