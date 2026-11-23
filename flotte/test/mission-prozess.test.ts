// #108: the whole program `flotte mission` as a process of its own, with real Mechanik (git and the
// scripts against a fixture), gh and claude -p as stand-ins on PATH. While a call runs (it started a
// child process), the program stops, and afterwards no process of that call lives:
//  - on its own accord (--max-min reached): the catch branch of epic()
//  - on SIGTERM: the signal handler (POSIX only, Windows knows no signal that a process could catch
//    from another one: process.kill there ends the target at once, the handler never runs)

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aufrufen, beende } from '../src/aufruf.ts';
import { ATTRAPPE, drehbuch } from './attrappe.ts';
import { fixture, type Fixture } from './epic-fixture.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const GH = fileURLToPath(new URL('./gh-attrappe.ts', import.meta.url));
const KURZBEFEHL = fileURLToPath(new URL('./kurzbefehl.ts', import.meta.url));
const EXE = process.platform === 'win32' ? '.exe' : '';
const T = 120_000;

// claude and gh as real executables on PATH (test/kurzbefehl.ts), compiled once
let bin = '';
beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'flotte-bin-'));
  const r = aufrufen(process.execPath, ['build', '--compile', KURZBEFEHL, '--outfile', join(bin, `claude${EXE}`)]);
  if (r.code) throw new Error(`bun build --compile: ${r.stderr}`);
  linkSync(join(bin, `claude${EXE}`), join(bin, `gh${EXE}`));
}, T);
afterAll(() => rmSync(bin, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const lebt = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fix: Fixture | null = null;
let kinder: string | null = null;
let programm: ChildProcess | null = null;
const temp: string[] = [];
afterEach(() => {
  // a failed test must not leave the program, its calls or the child process behind (rule 13: who starts, ends)
  if (programm?.pid && programm.exitCode === null && programm.signalCode === null) {
    // Windows: only taskkill /T takes the calls with the program; POSIX: its signal handler ends them
    if (process.platform === 'win32') beende(programm.pid);
    else programm.kill('SIGTERM');
  }
  programm = null;
  if (kinder && existsSync(kinder)) for (const p of readFileSync(kinder, 'utf8').split('\n').filter(Boolean)) if (lebt(Number(p))) process.kill(Number(p), 'SIGKILL');
  kinder = null;
  fix?.weg();
  fix = null;
  for (const d of temp.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** starts the program; the first call (the cut) starts a child process and then waits for it */
async function starteProgramm(extra: string[]) {
  fix = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'flotte-prozess-'));
  const konto = mkdtempSync(join(tmpdir(), 'flotte-konto-'));
  temp.push(dir, konto);
  const d = drehbuch([{ sitzung: 's-schnitt', schritte: [{ kind: 120_000 }] }]);
  kinder = `${d.datei}.kinder`;
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FLOTTE_CLAUDE: join(bin, `claude${EXE}`), FLOTTE_DREHBUCH: d.datei, FLOTTE_TEST_BUN: process.execPath, FLOTTE_TEST_CLAUDE: ATTRAPPE, FLOTTE_TEST_GH: GH };
  delete env.EPIC_LOCK_HOLDER;
  const kind = spawn(process.execPath, [CLI, 'mission', '69', fix.repo, '--mechanik', 'echt', '--aufrufe', 'echt', '--forge', 'o/r', '--branch', 'epic/69-x', '--konto', konto, '--antworten', join(dir, 'antworten.txt'), ...extra], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  programm = kind;
  let ausgabe = '';
  kind.stdout.on('data', (x) => (ausgabe += x));
  kind.stderr.on('data', (x) => (ausgabe += x));
  const ende = new Promise<number | null>((fertig) => kind.on('close', (code) => fertig(code)));
  // the call runs once its child process has been written down
  let pid = 0;
  for (let i = 0; i < 600 && !pid; i++) {
    await warte(100);
    if (existsSync(kinder)) pid = Number(readFileSync(kinder, 'utf8').split('\n')[0]);
  }
  return { kind, ende, kindPid: pid, ausgabe: () => ausgabe };
}

describe('flotte mission als eigener Prozess (#108)', () => {
  it('stops on its own (--max-min): the call and its child process are ended, none lives after the program', async () => {
    const p = await starteProgramm(['--max-min', '0.5']);
    expect(p.kindPid, p.ausgabe()).toBeGreaterThan(0);
    expect(lebt(p.kindPid)).toBe(true);
    const code = await p.ende;
    expect(code, p.ausgabe()).toBe(0);
    expect(p.ausgabe()).toMatch(/--max-min 0\.5 erreicht/);
    for (let i = 0; i < 40 && lebt(p.kindPid); i++) await warte(100);
    expect(lebt(p.kindPid)).toBe(false);
  }, T);

  it.skipIf(process.platform === 'win32')('gets SIGTERM while a call runs: exit 130, the call and its child process are ended', async () => {
    const p = await starteProgramm([]);
    expect(p.kindPid, p.ausgabe()).toBeGreaterThan(0);
    expect(lebt(p.kindPid)).toBe(true);
    p.kind.kill('SIGTERM');
    expect(await p.ende).toBe(130);
    for (let i = 0; i < 40 && lebt(p.kindPid); i++) await warte(100);
    expect(lebt(p.kindPid)).toBe(false);
  }, T);
});
