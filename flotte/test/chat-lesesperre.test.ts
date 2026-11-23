// The read lock of flotte chat (#84, ADR-0004): a PreToolUse hook that refuses Read, Grep and Glob
// outside the repository. The check as a function, then the script as a process with the hook JSON
// on stdin. Paths are made in tmpdir(), never a path of this machine.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LESESPERRE, lesesperre } from '../src/befehle/chat-lesesperre.ts';

function welt() {
  const basis = mkdtempSync(join(tmpdir(), 'flotte-lesesperre-'));
  const repo = join(basis, 'repo');
  mkdirSync(join(repo, 'a', 'b'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# r\n');
  mkdirSync(join(basis, 'repo-andere'));
  writeFileSync(join(basis, 'repo-andere', 'x'), 'x');
  mkdirSync(join(basis, 'heim', '.claude'), { recursive: true });
  writeFileSync(join(basis, 'heim', '.claude', '.credentials.json'), '{}');
  return { basis, repo, heim: join(basis, 'heim') };
}

const read = (cwd: string, file_path: unknown) => ({ tool_name: 'Read', tool_input: { file_path }, cwd });
const glob = (cwd: string, pattern: unknown, path?: unknown) => ({ tool_name: 'Glob', tool_input: { pattern, ...(path === undefined ? {} : { path }) }, cwd });
const grep = (cwd: string, path?: unknown) => ({ tool_name: 'Grep', tool_input: { pattern: 'x', ...(path === undefined ? {} : { path }) }, cwd });

describe('lesesperre', () => {
  it('allows reading inside the repository: relative, nested, absolute, a file not yet there, no path', () => {
    const { repo, heim } = welt();
    for (const e of [
      read(repo, 'README.md'),
      read(repo, './a/b'),
      read(repo, join(repo, 'a', 'b', 'neu.txt')),
      read(repo, join(repo, 'a', '..', 'README.md')),
      grep(repo),
      grep(repo, 'a'),
      glob(repo, '**/*.md'),
      glob(repo, 'src/**/*.ts', join(repo, 'a')),
    ])
      expect(lesesperre(e, heim)).toBeNull();
  });

  it('other letter case: the same folder on Windows, another one elsewhere', () => {
    const { repo, heim } = welt();
    const anders = join(repo.slice(0, -'repo'.length) + 'REPO', 'README.md');
    if (process.platform === 'win32') expect(lesesperre(read(repo, anders), heim)).toBeNull();
    else expect(lesesperre(read(repo, anders), heim)).toMatch(/außerhalb des Repositorys/);
  });

  it('refuses reading outside: .., a path beside it, a prefix neighbour, the account credentials, another drive', () => {
    const { basis, repo, heim } = welt();
    for (const e of [
      read(repo, '../x'),
      read(repo, join(basis, 'heim', '.claude', '.credentials.json')),
      read(repo, join(basis, 'repo-andere', 'x')),
      read(repo, `${repo}-andere${process.platform === 'win32' ? '\\' : '/'}x`),
      read(repo, '~/.claude/.credentials.json'),
      read(repo, 'a/../../repo-andere/x'),
      grep(repo, '..'),
      grep(repo, basis),
      glob(repo, '*', join(repo, '..')),
      ...(process.platform === 'win32' ? [read(repo, 'Z:\\r\\repo\\README.md'), read(repo, '\\\\server\\share\\x')] : [read(repo, '/etc/passwd')]),
    ])
      expect(lesesperre(e, heim)).toMatch(/außerhalb des Repositorys/);
  });

  it('refuses a Glob pattern that leads out of the repository', () => {
    const { repo, heim } = welt();
    for (const p of ['../**', '**/../../*', 'a/../../x', 'C:/**', 'c:\\Users\\**', '/etc/*', '\\x\\**', '~/.claude/*', '{a,../b}/*', '{a,/etc}/*'])
      expect(lesesperre(glob(repo, p), heim)).toMatch(/Muster/);
    expect(lesesperre(glob(repo, '**/..foo/*.md'), heim)).toBeNull();
  });

  it('a link inside the repository that points outside is outside', () => {
    const { basis, repo, heim } = welt();
    // a junction on Windows needs no rights; elsewhere a plain symlink
    symlinkSync(join(basis, 'heim'), join(repo, 'verweis'), 'junction');
    expect(lesesperre(read(repo, join('verweis', '.claude', '.credentials.json')), heim)).toMatch(/außerhalb des Repositorys/);
  });

  it('refuses unclear input: no JSON object, no cwd, a relative cwd, no file_path, a path that is no string, another tool', () => {
    const { repo, heim } = welt();
    for (const e of [
      null,
      'Read',
      {},
      { tool_name: 'Read', tool_input: { file_path: 'README.md' } },
      read('repo', 'README.md'),
      read(repo, undefined),
      read(repo, 7),
      grep(repo, ['a']),
      glob(repo, undefined),
      { tool_name: 'Read', cwd: repo },
      { tool_name: 'Bash', tool_input: { command: 'cat x' }, cwd: repo },
    ])
      expect(lesesperre(e, heim)).toEqual(expect.any(String));
  });
});

describe('the hook script as a process', () => {
  const hook = (eingabe: string) => spawnSync(process.execPath, [LESESPERRE], { input: eingabe, encoding: 'utf8', timeout: 20_000 });

  it('exit 2 with the reason on stderr outside, exit 0 without output inside, exit 2 on garbage', () => {
    const { basis, repo } = welt();
    const aussen = hook(JSON.stringify(read(repo, join(basis, 'repo-andere', 'x'))));
    expect(aussen.status).toBe(2);
    expect(aussen.stderr).toMatch(/außerhalb des Repositorys/);
    const innen = hook(JSON.stringify(read(repo, 'README.md')));
    expect(innen.status).toBe(0);
    expect(innen.stdout + innen.stderr).toBe('');
    const kaputt = hook('{kein json');
    expect(kaputt.status).toBe(2);
    expect(kaputt.stderr).toMatch(/Lesesperre/);
  }, 30_000);
});
