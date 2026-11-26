// #126: `flotte projekt hinzufuegen|entfernen`. A repository folder gets the adapter from the template of
// mission/references/adapter.md (never over an existing one) and a start script under
// ~/.claude/flotte/start; a folder that is no Git repository is refused with nothing written.

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aufrufen, type Aufrufer } from '../src/aufruf.ts';
import { adapterVorlage, autostartEchtMit, offeneSchluessel, projekt, type ProjektWelt, startskript } from '../src/befehle/projekt.ts';
import { flotteDir } from '../src/werkzeuge/zustand.ts';

const VORLAGE = adapterVorlage(readFileSync(new URL('../../mission/references/adapter.md', import.meta.url), 'utf8'));

function welt(o: { gh?: Aufrufer } = {}): ProjektWelt & { heim: string; aufgaben: string[][] } {
  const heim = mkdtempSync(join(tmpdir(), 'flotte-projekt-heim-'));
  mkdirSync(join(heim, '.claude'));
  mkdirSync(join(heim, '.claude-arbeitspferd'));
  const aufgaben: string[][] = [];
  const aufrufer: Aufrufer = (p, args, opts) => (p === 'git' ? aufrufen(p, args, opts) : (o.gh ?? (() => ({ code: 1, stdout: '', stderr: 'unerwartet' })))(p, args, opts));
  return { aufrufer, heim, kontenDatei: join(heim, '.claude', 'flotte', 'konten.json'), aufgaben, autostart: (name, skript) => (aufgaben.push([name, skript]), 'angelegt') };
}

function repo(name = 'kleines-projekt', origin: string | null = 'https://github.com/o/r.git'): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'flotte-projekt-')), name);
  mkdirSync(dir);
  aufrufen('git', ['-C', dir, 'init', '-q']);
  if (origin) aufrufen('git', ['-C', dir, 'remote', 'add', 'origin', origin]);
  return dir;
}

const skriptVon = (w: { heim: string }, name: string) => join(w.heim, '.claude', 'flotte', 'start', `${name}.ps1`);

describe('#126 Projekt hinzufügen', () => {
  it('a folder without adapter: the adapter from the template and the start script; the placeholders are named', async () => {
    const w = welt();
    const r = (await projekt(['hinzufuegen', repo(), '--bruecke', 'http://127.0.0.1:4747'], w)) as Record<string, any>;
    const dir = r.ordner as string;
    expect(readFileSync(join(dir, '.claude', 'epic.md'), 'utf8')).toBe(VORLAGE);
    expect(r.adapter).toEqual({ angelegt: true, offen: ['forge', 'api', 'gate_command', 'test_commands', 'commit_style', 'commit_language'] });
    expect(r.startskript).toEqual({ datei: '~/.claude/flotte/start/kleines-projekt.ps1', angelegt: true });
    const s = readFileSync(skriptVon(w, 'kleines-projekt'), 'utf8');
    expect(s).toContain(`Set-Location -LiteralPath '${dir}'`);
    // the accounts: the active ones of konten.json whose folder exists (here 1 and 2 of the standard)
    expect(s).toContain(`bun "$HOME\\.claude\\skills\\flotte\\src\\cli.ts" fahren --konten '1,2' --dauerhaft --bruecke http://127.0.0.1:4747`);
    expect(r.forge).toEqual({ origin: true, status: null });
    expect(r.autostart).toBeNull();
    expect(w.aufgaben).toEqual([]);
    expect(r.meldung).toBe('Projekt kleines-projekt: Adapter angelegt, noch auszufüllen: forge, api, gate_command, test_commands, commit_style, commit_language; Startskript kleines-projekt.ps1 angelegt; Forge: origin vorhanden; eigener Treiber für kleines-projekt, nicht gestartet: startet von Hand mit ~/.claude/flotte/start/kleines-projekt.ps1');
    expect(r.meldung).not.toContain(dir);
  });

  it('a folder with adapter: only the start script, the adapter unchanged; the forge checked by forgeStatus; autostart once', async () => {
    const gh: Aufrufer = (_p, args) => (args[0] === 'auth' ? { code: 0, stdout: '', stderr: 'Logged in to github.com account octo' } : { code: 0, stdout: 'true\n', stderr: '' });
    const w = welt({ gh });
    const dir = repo('mit-adapter');
    mkdirSync(join(dir, '.claude'));
    const adapter = '---\nforge: github\napi: https://api.github.com/repos/o/r\nmerge: mensch\n---\n# eigener Adapter\n';
    writeFileSync(join(dir, '.claude', 'epic.md'), adapter);
    const r = (await projekt(['hinzufuegen', dir, '--autostart', '--konten', '2'], w)) as Record<string, any>;
    expect(readFileSync(join(dir, '.claude', 'epic.md'), 'utf8')).toBe(adapter);
    expect(r.adapter).toEqual({ angelegt: false, offen: [] });
    expect(r.startskript.angelegt).toBe(true);
    expect(readFileSync(skriptVon(w, 'mit-adapter'), 'utf8')).toContain("fahren --konten '2' --dauerhaft --bruecke http://127.0.0.1:4747");
    expect(r.forge.status).toEqual({ art: 'github', forge: 'o/r', angemeldet: true, konto: 'octo', rechte: 'ok', treiber: true });
    expect(r.autostart).toBe('angelegt');
    expect(w.aufgaben).toEqual([['Flotte mit-adapter', skriptVon(w, 'mit-adapter')]]);
    expect(r.meldung).toContain('; eigener Treiber für mit-adapter, nicht gestartet: startet bei der nächsten Anmeldung (Autostart) oder von Hand mit ~/.claude/flotte/start/mit-adapter.ps1');
    // a second call overwrites nothing: the start script stays as it is
    writeFileSync(skriptVon(w, 'mit-adapter'), '# von Hand\n');
    const zwei = (await projekt(['hinzufuegen', dir], w)) as Record<string, any>;
    expect(zwei.startskript.angelegt).toBe(false);
    expect(readFileSync(skriptVon(w, 'mit-adapter'), 'utf8')).toBe('# von Hand\n');
    expect(zwei.meldung).toContain('Startskript mit-adapter.ps1 vorhanden, unverändert');
  });

  it('no Git repository or no folder: a clear refusal, nothing written', async () => {
    const w = welt();
    const kein = join(mkdtempSync(join(tmpdir(), 'flotte-projekt-')), 'nur-ordner');
    mkdirSync(kein);
    await expect(projekt(['hinzufuegen', kein, '--autostart'], w)).rejects.toThrow('nur-ordner ist kein Git-Repository');
    await expect(projekt(['hinzufuegen', join(kein, 'fehlt')], w)).rejects.toThrow('Den Ordner fehlt gibt es nicht');
    expect(readdirSync(kein)).toEqual([]);
    expect(existsSync(join(w.heim, '.claude', 'flotte', 'start'))).toBe(false);
    expect(w.aufgaben).toEqual([]);
  });

  it('without origin the forge says so', async () => {
    const r = (await projekt(['hinzufuegen', repo('ohne-origin', null)], welt())) as Record<string, any>;
    expect(r.forge).toEqual({ origin: false, status: null });
    expect(r.meldung).toContain('Forge: kein origin');
  });

  it('the placeholders of an adapter: flat keys and map entries in <…>, nothing from the prose', () => {
    expect(offeneSchluessel('---\nforge: github\napi: <x>\ntest_commands:\n  flotte: bun test\n  <suite>: <b>\n---\n# <Projekt>\n')).toEqual(['api', 'test_commands']);
    expect(offeneSchluessel('# kein Frontmatter <x>\n')).toEqual([]);
  });

  it('an adapter under the old name .claude/prd.md counts as there: nothing written, the rename is named', async () => {
    const dir = repo('alter-name');
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'prd.md'), '---\nforge: github\n---\n');
    const r = (await projekt(['hinzufuegen', dir], welt())) as Record<string, any>;
    expect(existsSync(join(dir, '.claude', 'epic.md'))).toBe(false);
    expect(r.adapter).toEqual({ angelegt: false, offen: [], alterName: true });
    expect(r.meldung).toContain('Adapter unter altem Namen .claude/prd.md, umbenennen in .claude/epic.md');
  });

  it('a start script of the same name for another folder: refused before anything is written; for the same folder unchanged', async () => {
    const w = welt();
    const dir = repo('gleicher-name');
    mkdirSync(join(w.heim, '.claude', 'flotte', 'start'), { recursive: true });
    writeFileSync(skriptVon(w, 'gleicher-name'), "Set-Location -LiteralPath 'D:\\anderswo\\gleicher-name'\r\nbun x\r\n");
    await expect(projekt(['hinzufuegen', dir, '--autostart'], w)).rejects.toThrow('Das Startskript gleicher-name.ps1 gibt es schon für einen anderen Ordner (gleicher-name in anderswo); nichts geschrieben.');
    expect(existsSync(join(dir, '.claude'))).toBe(false);
    expect(w.aufgaben).toEqual([]);
    writeFileSync(skriptVon(w, 'gleicher-name'), `Set-Location -LiteralPath '${dir}'\r\n`);
    const r = (await projekt(['hinzufuegen', dir], w)) as Record<string, any>;
    expect(r.startskript.angelegt).toBe(false);
    expect(r.meldung).toContain('Startskript gleicher-name.ps1 vorhanden, unverändert');
  });

  it('a failing autostart does not throw: autostart fehlgeschlagen with its reason, the files are there', async () => {
    const w = welt();
    w.autostart = () => {
      throw new Error('Zugriff verweigert');
    };
    const dir = repo('ohne-aufgabe');
    const r = (await projekt(['hinzufuegen', dir, '--autostart'], w)) as Record<string, any>;
    expect(r.autostart).toBe('fehlgeschlagen');
    expect(r.autostartGrund).toBe('Zugriff verweigert');
    expect(r.startskript.angelegt).toBe(true);
    expect(r.meldung).toContain('; Autostart fehlgeschlagen: Zugriff verweigert;');
    expect(r.logbuch).toContain('; Autostart fehlgeschlagen');
    expect(r.logbuch).not.toContain('Zugriff');
  });

  it('the real autostart calls autostart.ps1 with the start script and the home folder; umgestellt comes through', async () => {
    const aufrufe: string[][] = [];
    const w = welt({ gh: (p, args) => (aufrufe.push([p, ...args]), { code: 0, stdout: 'Warnung\r\numgestellt\r\n', stderr: '' }) });
    w.autostart = autostartEchtMit(w.aufrufer, w.heim);
    const dir = repo('alte-aufgabe', null);
    const r = (await projekt(['hinzufuegen', dir, '--autostart'], w)) as Record<string, any>;
    expect(r.autostart).toBe('umgestellt');
    expect(r.meldung).toContain('; Autostart umgestellt;');
    const [p, ...args] = aufrufe[0];
    expect(p).toBe('powershell');
    expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']);
    expect(args[5].replace(/\\/g, '/').endsWith('/flotte/autostart.ps1')).toBe(true);
    expect(existsSync(args[5])).toBe(true);
    expect(args.slice(6)).toEqual(['-Skript', join(w.heim, '.claude', 'flotte', 'start', 'alte-aufgabe.ps1'), '-Heim', w.heim]);
  });

  it('the real autostart: an answer other than angelegt, vorhanden or umgestellt is a failure', () => {
    const a: Aufrufer = () => ({ code: 0, stdout: 'Zugriff verweigert', stderr: '' });
    expect(() => autostartEchtMit(a, 'C:\\heim')('Flotte x', 'C:\\heim\\x.ps1')).toThrow('Die geplante Aufgabe Flotte x ließ sich nicht anlegen: Zugriff verweigert');
  });

  it('a folder in surrounding quotes is taken without them; a relative folder is refused', async () => {
    const dir = repo('in-anfuehrung');
    const r = (await projekt(['hinzufuegen', `"${dir}"`], welt())) as Record<string, any>;
    expect(r.ordner).toBe(dir);
    await expect(projekt(['hinzufuegen', 'relativ\\ordner'], welt())).rejects.toThrow('Der Ordner muss ein absoluter Pfad sein');
  });

  it('the start script quotes the folder and takes only a URL for the bridge', () => {
    const s = startskript({ name: 'p', ordner: "C:\\repos\\o'brien", konten: ['1'], bruecke: 'http://127.0.0.1:4747' });
    expect(s).toContain("Set-Location -LiteralPath 'C:\\repos\\o''brien'");
    expect(s).toContain("'Flotte p'");
    expect(() => startskript({ name: 'p', ordner: 'C:\\r', konten: ['1'], bruecke: 'http://x/"; rm' })).toThrow(/URL/);
  });
});

describe('#126 Projekt entfernen', () => {
  it('halts the driver like flotte anhalten and deletes nothing', async () => {
    const w = welt();
    const dir = repo('weg');
    await projekt(['hinzufuegen', dir], w);
    const r = (await projekt(['entfernen', dir], w)) as Record<string, any>;
    expect(existsSync(join(flotteDir(dir), 'anhalten'))).toBe(true);
    expect(r.geloescht).toEqual([]);
    expect(existsSync(join(dir, '.claude', 'epic.md'))).toBe(true);
    expect(existsSync(skriptVon(w, 'weg'))).toBe(true);
  });
});
