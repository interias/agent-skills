import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { starte, laufUmgebung, fehlerart, liesLog } from '../src/werkzeuge/lauf.ts';
import { lies as liesVerbrauch } from '../src/werkzeuge/verbrauch.ts';
import { sperren, entsperren, lebt, lies, schreibe, leer, neuesEpic } from '../src/werkzeuge/zustand.ts';
import { drehbuch, mitAttrappe } from './attrappe.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'flotte-t-'));

describe('lauf', () => {
  it('sends the order on stdin with the fixed flags and reads session, results and usage', async () => {
    const d = drehbuch([{ sitzung: 's1', schritte: [{ verbrauch: [0.4, 0.2] }, { text: 'Zwischenstand' }, { text: '' }, { text: 'FLOTTE-ENDE 7 PR #9' }] }]);
    const konto = tmp();
    const log = join(tmp(), 'lauf.jsonl');
    const r = await starte({ repo: tmp(), konto, auftrag: 'Rufe /mission #7 auf', modell: 'haiku', log, ...mitAttrappe(d.datei) });
    expect(r).toMatchObject({ sitzung: 's1', code: 0, leerlauf: false, text: 'FLOTTE-ENDE 7 PR #9', fehler: null });
    expect(r.ergebnisse).toHaveLength(3);
    const [g] = d.gesehen();
    expect(g.eingabe).toBe('Rufe /mission #7 auf');
    // as a file on stdin, not a pipe that a busy driver writes too late (claude -p waits 3 s; #69)
    expect(readFileSync(`${log}.auftrag`, 'utf8')).toBe('Rufe /mission #7 auf');
    expect(g.args).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', '--permission-prompts', 'none', '--strict-mcp-config', '--model', 'haiku']);
    expect(g.decke).toBe('0');
    expect(g.konto).toBe(konto);
    expect(liesVerbrauch(konto)?.fuenf?.anteil).toBe(0.4);
    expect(liesLog(log).text).toBe('FLOTTE-ENDE 7 PR #9');
  });

  it('resumes with --resume and keeps the session', async () => {
    const d = drehbuch([{ schritte: [{ text: 'weiter' }] }]);
    const r = await starte({ repo: tmp(), konto: tmp(), auftrag: 'Antwort: A', resume: 'abc', ...mitAttrappe(d.datei) });
    expect(r.sitzung).toBe('abc');
    expect(d.gesehen()[0].args.slice(-2)).toEqual(['--resume', 'abc']);
  });

  it('kills a run that prints nothing for too long (D5)', async () => {
    // #164: the run hangs for a day; that starte returns at all, with leerlauf, shows the kill. The test's own
    // limit is only the guard against that hang, wide enough for a loaded machine.
    const d = drehbuch([{ schritte: [{ text: 'los' }, { haenge: true }] }]);
    const r = await starte({ repo: tmp(), konto: tmp(), auftrag: 'x', leerlaufMs: 400, ...mitAttrappe(d.datei) });
    expect(r).toMatchObject({ leerlauf: true, fehler: 'leerlauf', code: null });
  }, 60_000);

  // #147: a run ends with its whole process tree; the stand-in's child stands for a tool call claude started
  const kinder = (datei: string) => (existsSync(`${datei}.kinder`) ? readFileSync(`${datei}.kinder`, 'utf8').split('\n').filter(Boolean).map(Number) : []);
  const tot = async (pids: number[]) => {
    const ende = Date.now() + 5000;
    while (pids.some(lebt) && Date.now() < ende) await new Promise((r) => setTimeout(r, 50));
    return pids.filter(lebt);
  };

  it('#147 after a timeout no process of the run lives on, its children neither', async () => {
    const d = drehbuch([{ schritte: [{ text: 'los' }, { kind: 120_000 }] }]);
    let pid = 0;
    const r = await starte({ repo: tmp(), konto: tmp(), auftrag: 'x', leerlaufMs: 300, stilleMaxMs: 600, beimStart: (p) => (pid = p), ...mitAttrappe(d.datei) });
    expect(r).toMatchObject({ leerlauf: true, fehler: 'leerlauf' });
    expect(kinder(d.datei)).toHaveLength(1);
    expect(await tot([pid, ...kinder(d.datei)])).toEqual([]);
  }, 20_000);

  it('#147 an abort ends the whole process tree at once; aborted before the start, nothing is spawned', async () => {
    const KIND_MS = 120_000;
    const d = drehbuch([{ schritte: [{ text: 'los' }, { kind: KIND_MS }] }]);
    const abbruch = new AbortController();
    let pid = 0;
    const lauf = starte({ repo: tmp(), konto: tmp(), auftrag: 'x', leerlaufMs: 60_000, abbruch: abbruch.signal, beimStart: (p) => (pid = p), ...mitAttrappe(d.datei) });
    const ende = Date.now() + 10_000;
    while (!kinder(d.datei).length && Date.now() < ende) await new Promise((r) => setTimeout(r, 50));
    expect(kinder(d.datei)).toHaveLength(1);
    const anfang = Date.now();
    abbruch.abort('Treiber angehalten');
    const r = await lauf;
    expect(r.fehler).toBe('abbruch');
    // #164: "at once" against the setup: without the abort the run would live as long as its child (KIND_MS)
    expect(Date.now() - anfang).toBeLessThan(KIND_MS / 2);
    expect(await tot([pid, ...kinder(d.datei)])).toEqual([]);
    const vorher = d.gesehen().length;
    expect((await starte({ repo: tmp(), konto: tmp(), auftrag: 'x', abbruch: abbruch.signal, ...mitAttrappe(d.datei) })).fehler).toBe('abbruch');
    expect(d.gesehen()).toHaveLength(vorher);
  }, 90_000);

  it('reports exit codes, missing results, network and login errors (D1, D18)', async () => {
    const ohne = drehbuch([{ schritte: [], exit: 1 }]);
    expect((await starte({ repo: tmp(), konto: tmp(), auftrag: 'x', ...mitAttrappe(ohne.datei) })).fehler).toBe('kein_ergebnis');
    expect(fehlerart([{ text: 'API Error: 529 Overloaded', istFehler: true, grund: 'api_error', verweigert: [] }], 1, false, '')).toBe('netz');
    expect(fehlerart([{ text: 'Failed to authenticate: OAuth session expired', istFehler: true, grund: 'api_error', verweigert: [] }], 1, false, '')).toBe('anmeldung');
    expect(fehlerart([{ text: 'ok', istFehler: false, grund: null, verweigert: [] }], 3, false, '')).toBe('exit');
  });

  it('collects permission denials (D19)', async () => {
    const d = drehbuch([{ schritte: [{ text: 'gesperrt', verweigert: [{ tool_name: 'Bash', tool_input: { command: 'gh pr merge 1' } }] }] }]);
    const r = await starte({ repo: tmp(), konto: tmp(), auftrag: 'x', ...mitAttrappe(d.datei) });
    expect(r.verweigert).toHaveLength(1);
  });

  it('hands down no desktop variables and sets the account only when it is not the default', () => {
    const env = laufUmgebung({ PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1', ANTHROPIC_BASE_URL: 'x', CLAUDE_CONFIG_DIR: 'alt' }, '~/.claude-arbeitspferd');
    expect(env).toEqual({ PATH: 'p', CLAUDE_CONFIG_DIR: join(homedir(), '.claude-arbeitspferd'), CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' });
    expect(laufUmgebung({}, '~/.claude').CLAUDE_CONFIG_DIR).toBeUndefined();
  });
});

describe('zustand', () => {
  it('lets one driver per repository take the lock (D20)', () => {
    const dir = tmp();
    expect(sperren(dir, 111, () => true).ok).toBe(true);
    expect(sperren(dir, 222, () => true)).toMatchObject({ ok: false, pid: 111 });
    entsperren(dir, 111);
    expect(sperren(dir, 222, () => true).ok).toBe(true);
  });

  it('takes over the lock of a dead driver', () => {
    const dir = tmp();
    sperren(dir, 111, () => true);
    expect(sperren(dir, 222, () => false).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'treiber.lock'), 'utf8')).pid).toBe(222);
  });

  it('treats a broken lock file as stale', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'treiber.lock'), '{kaputt');
    expect(sperren(dir, 5, () => true).ok).toBe(true);
  });

  it('keeps writing the state while another process keeps reading it (D16 flake, Windows EPERM)', async () => {
    const dir = tmp();
    schreibe(dir, leer('repo'));
    const datei = join(dir, 'zustand.json').replace(/\\/g, '/');
    const leser = spawn(process.execPath, ['-e', `const fs = require('node:fs'); const ende = Date.now() + 1500; while (Date.now() < ende) { try { fs.readFileSync('${datei}'); } catch {} }`]);
    await new Promise((r) => setTimeout(r, 200));
    for (let i = 0; i < 300; i++) schreibe(dir, { ...leer('repo'), stand: String(i) } as never);
    await new Promise((r) => leser.on('exit', r));
    expect(lies(dir, 'repo').stand).toBe('299');
  }, 20_000);

  it('writes and reads the state', () => {
    const dir = tmp();
    expect(lies(dir, 'C:/r')).toEqual(leer('C:/r'));
    const z = leer('C:/r');
    z.epics['7'] = { ...neuesEpic(7), stufe: 'laeuft', sitzung: 's1' };
    schreibe(dir, z);
    expect(lies(dir, 'C:/r').epics['7']).toMatchObject({ stufe: 'laeuft', sitzung: 's1', neustarts: 0 });
  });
});
