import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { starte, laufUmgebung, fehlerart, liesLog } from '../src/werkzeuge/lauf.ts';
import { lies as liesVerbrauch } from '../src/werkzeuge/verbrauch.ts';
import { sperren, entsperren, lies, schreibe, leer, neuesEpic } from '../src/werkzeuge/zustand.ts';
import { drehbuch, mitAttrappe } from './attrappe.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'flotte-t-'));

describe('lauf', () => {
  it('sends the order on stdin with the fixed flags and reads session, results and usage', async () => {
    const d = drehbuch([{ sitzung: 's1', schritte: [{ verbrauch: [0.4, 0.2] }, { text: 'Zwischenstand' }, { text: '' }, { text: 'FLOTTE-ENDE 7 PR #9' }] }]);
    const konto = tmp();
    const log = join(tmp(), 'lauf.jsonl');
    const r = await starte({ repo: tmp(), konto, auftrag: 'Rufe /epic #7 auf', modell: 'haiku', log, ...mitAttrappe(d.datei) });
    expect(r).toMatchObject({ sitzung: 's1', code: 0, leerlauf: false, text: 'FLOTTE-ENDE 7 PR #9', fehler: null });
    expect(r.ergebnisse).toHaveLength(3);
    const [g] = d.gesehen();
    expect(g.eingabe).toBe('Rufe /epic #7 auf');
    expect(g.args).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', '--permission-prompts', 'none', '--model', 'haiku']);
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
    const d = drehbuch([{ schritte: [{ text: 'los' }, { haenge: true }] }]);
    const anfang = Date.now();
    const r = await starte({ repo: tmp(), konto: tmp(), auftrag: 'x', leerlaufMs: 400, ...mitAttrappe(d.datei) });
    expect(r).toMatchObject({ leerlauf: true, fehler: 'leerlauf', code: null });
    expect(Date.now() - anfang).toBeLessThan(10_000);
  });

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

  it('writes and reads the state', () => {
    const dir = tmp();
    expect(lies(dir, 'C:/r')).toEqual(leer('C:/r'));
    const z = leer('C:/r');
    z.epics['7'] = { ...neuesEpic(7), stufe: 'laeuft', sitzung: 's1' };
    schreibe(dir, z);
    expect(lies(dir, 'C:/r').epics['7']).toMatchObject({ stufe: 'laeuft', sitzung: 's1', neustarts: 0 });
  });
});
