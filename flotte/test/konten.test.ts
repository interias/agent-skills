// #94: konten.json under ~/.claude/flotte is the one source of the accounts; CLI `flotte konten`.

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Aufrufer } from '../src/aufruf.ts';
import { konten, type KontenWelt } from '../src/befehle/konten.ts';
import { aktiveAuswahl, kontenTafel, kontoAus, liesKonten, STANDARD_KONTEN } from '../src/werkzeuge/konten.ts';

function welt(aufrufer?: Aufrufer): KontenWelt & { aufrufe: { args: string[]; dir: string | undefined }[] } {
  const heim = mkdtempSync(join(tmpdir(), 'flotte-konten-'));
  const aufrufe: { args: string[]; dir: string | undefined }[] = [];
  const nie: Aufrufer = (_p, args, opts) => {
    aufrufe.push({ args, dir: opts?.env?.CLAUDE_CONFIG_DIR });
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  return { datei: join(heim, '.claude', 'flotte', 'konten.json'), heim, aufrufer: aufrufer ?? nie, aufrufe };
}

describe('#94 konten.json', () => {
  it('without the file accounts 1-3 stay as before', () => {
    const w = welt();
    expect(existsSync(w.datei)).toBe(false);
    expect(liesKonten(w.datei).map((k) => k.nr)).toEqual(['1', '2', '3']);
    expect(kontenTafel(w.datei)).toEqual(STANDARD_KONTEN);
    expect(liesKonten(w.datei).every((k) => k.aktiv)).toBe(true);
  });

  it('a broken file is named, not ignored', () => {
    const w = welt();
    mkdirSync(join(w.heim, '.claude', 'flotte'), { recursive: true });
    writeFileSync(w.datei, '{kaputt');
    expect(() => liesKonten(w.datei)).toThrow(/kein JSON/);
  });

  it('a new account appears in liste and in kontoAus(); its folder is created, never one that exists', () => {
    const w = welt();
    const r = konten(['anlegen', '--name', 'Vier', '--farbe', '#123456'], w) as { angelegt: { nr: string; ordner: string } };
    expect(r.angelegt.nr).toBe('4');
    expect(r.angelegt.ordner).toBe('~/.claude-arbeitspferd-4');
    expect(existsSync(join(w.heim, '.claude-arbeitspferd-4'))).toBe(true);
    const liste = konten(['liste'], w) as { konten: { nr: string; name: string; farbe: string; aktiv: boolean }[] };
    expect(liste.konten.find((k) => k.nr === '4')).toMatchObject({ name: 'Vier', farbe: '#123456', aktiv: true });
    expect(kontoAus('4', kontenTafel(w.datei), w.heim)).toBe(join(w.heim, '.claude-arbeitspferd-4'));
    // the next one must not take a folder that already exists
    mkdirSync(join(w.heim, '.claude-arbeitspferd-5'));
    expect(() => konten(['anlegen'], w)).toThrow(/gibt es schon/);
    expect(liesKonten(w.datei).map((k) => k.nr)).toEqual(['1', '2', '3', '4']);
  });

  it('a deactivated account drops out of the choice, its folder stays; aktivieren brings it back', () => {
    const w = welt();
    konten(['anlegen'], w);
    const dir = join(w.heim, '.claude-arbeitspferd-4');
    expect(aktiveAuswahl([dir], w.datei, w.heim)).toEqual([dir]);
    konten(['deaktivieren', '4'], w);
    expect(existsSync(dir)).toBe(true);
    expect(aktiveAuswahl([dir, join(w.heim, '.claude')], w.datei, w.heim)).toEqual([join(w.heim, '.claude')]);
    expect(Object.keys(kontenTafel(w.datei, true))).toEqual(['1', '2', '3']);
    // still known by its number, so a run that is on it keeps its name
    expect(kontoAus('4', kontenTafel(w.datei), w.heim)).toBe(dir);
    konten(['aktivieren', '4'], w);
    expect(aktiveAuswahl([dir], w.datei, w.heim)).toEqual([dir]);
    expect(() => konten(['deaktivieren', '9'], w)).toThrow(/Konto 9 ist nicht bekannt/);
  });

  it('pruefen: a missing credentials file means not signed in, without a call; never reads the file', () => {
    const w = welt();
    for (const d of ['.claude', '.claude-arbeitspferd']) mkdirSync(join(w.heim, d), { recursive: true });
    writeFileSync(join(w.heim, '.claude', '.credentials.json'), 'GEHEIM');
    const r = konten(['pruefen'], w) as { konten: { nr: string; anmeldung: string }[] };
    expect(r.konten.map((k) => [k.nr, k.anmeldung])).toEqual([
      ['1', 'angemeldet'],
      ['2', 'nicht angemeldet'],
      ['3', 'ordner fehlt'],
    ]);
    expect(w.aufrufe).toHaveLength(1);
    expect(w.aufrufe[0].dir).toBe(join(w.heim, '.claude'));
    expect(w.aufrufe[0].args).toContain('haiku');
    expect(JSON.stringify(r)).not.toContain('GEHEIM');
  });

  it('pruefen: a refused call means not signed in, another failure stays unclear', () => {
    let n = 0;
    const w = welt(() => (n++ === 0 ? { code: 1, stdout: '', stderr: 'Invalid API key · Please run /login' } : { code: 1, stdout: '', stderr: 'ECONNRESET' }));
    for (const d of ['.claude', '.claude-arbeitspferd']) {
      mkdirSync(join(w.heim, d), { recursive: true });
      writeFileSync(join(w.heim, d, '.credentials.json'), '{}');
    }
    const r = konten(['pruefen', '1', '2'], w) as { konten: { nr: string; anmeldung: string }[] };
    expect(r.konten.map((k) => k.anmeldung)).toEqual(['nicht angemeldet', 'unklar']);
  });

  it('a wrong call names the subcommands', () => {
    expect(() => konten(['weg'], welt())).toThrow(/liste\|anlegen\|deaktivieren\|aktivieren\|pruefen/);
  });

  it('keeps what the file says over the standard', () => {
    const w = welt();
    mkdirSync(join(w.heim, '.claude', 'flotte'), { recursive: true });
    writeFileSync(w.datei, JSON.stringify([{ nr: '2', ordner: 'D:/konten/zwei', name: 'Zwei', farbe: '#000000', aktiv: true }]));
    expect(liesKonten(w.datei).map((k) => k.nr)).toEqual(['2']);
    expect(JSON.parse(readFileSync(w.datei, 'utf8'))).toHaveLength(1);
  });
});
