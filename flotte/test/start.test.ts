// Acceptance 3, decisions A–D (20.11.2026): start in the project folder, epics by release label,
// the end of a deployment, accounts by short name and the admiral's account.

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../src/aufruf.ts';
import { einstellungAus, fahre, forgeAus } from '../src/treiber/treiber.ts';
import { freigegebene, liesAdapter } from '../src/werkzeuge/belegung.ts';
import { kontenTafel, kontoAus, STANDARD_KONTEN } from '../src/werkzeuge/konten.ts';
import { aufbau, drehbuch, ende, lauf } from './flotte-welt.ts';
import { flotteDir, leer, neuesEpic, schreibe as schreibeZustand } from '../src/werkzeuge/zustand.ts';

const T = 30_000;

describe('D: Konten mit Kurznamen', () => {
  it('1, 2, 3 from the table, a folder name in the home directory, a path as it is', () => {
    expect(kontoAus('1', STANDARD_KONTEN)).toBe(join(homedir(), '.claude'));
    expect(kontoAus('2', STANDARD_KONTEN)).toBe(join(homedir(), '.claude-arbeitspferd'));
    expect(kontoAus('3', STANDARD_KONTEN)).toBe(join(homedir(), '.claude-arbeitspferd-3'));
    expect(kontoAus('.claude-arbeitspferd')).toBe(join(homedir(), '.claude-arbeitspferd'));
    expect(kontoAus('~/.claude')).toBe(join(homedir(), '.claude'));
    const pfad = mkdtempSync(join(tmpdir(), 'flotte-konto-'));
    expect(kontoAus(pfad)).toBe(resolve(pfad));
    expect(() => kontoAus('7', STANDARD_KONTEN)).toThrow(/Konto 7 ist nicht bekannt/);
  });

  it('konten.json next to the skill overrides the standard', () => {
    const datei = join(mkdtempSync(join(tmpdir(), 'flotte-tafel-')), 'konten.json');
    writeFileSync(datei, JSON.stringify({ '2': 'D:/konten/zwei', '4': '~/.vier' }));
    const t = kontenTafel(datei);
    expect(kontoAus('2', t)).toBe(resolve('D:/konten/zwei'));
    expect(kontoAus('4', t)).toBe(join(homedir(), '.vier'));
    expect(kontoAus('1', t)).toBe(join(homedir(), '.claude'));
    writeFileSync(datei, '{kaputt');
    expect(() => kontenTafel(datei)).toThrow(/kein JSON/);
  });
});

describe('A: Start im Projektordner', () => {
  it('reads owner/name from https and ssh remotes', () => {
    expect(forgeAus('https://github.com/interias/hexanite.git\n')).toBe('interias/hexanite');
    expect(forgeAus('https://github.com/interias/hexanite')).toBe('interias/hexanite');
    expect(forgeAus('git@github.com:interias/agent-skills.git')).toBe('interias/agent-skills');
    expect(forgeAus('https://gitea.example/x/y.git')).toBeNull();
  });

  it('without <repo> and --forge: the main checkout of the current folder and origin; explicit values win', () => {
    const repo = mkdtempSync(join(tmpdir(), 'flotte-start-'));
    aufrufen('git', ['init', '-q', repo]);
    aufrufen('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/o/projekt.git']);
    mkdirSync(join(repo, 'unter', 'ordner'), { recursive: true });
    const e = einstellungAus(['--konten', '1,2', '--admiral', '1', '--konto-max', '1=0', '--dauerhaft'], join(repo, 'unter', 'ordner'));
    expect(resolve(e.repo).toLowerCase()).toBe(resolve(repo).toLowerCase());
    expect(e.forge).toBe('o/projekt');
    expect(e.auto).toBe(true);
    expect(e.dauerhaft).toBe(true);
    expect(e.konten).toEqual([kontoAus('1'), kontoAus('2')]);
    expect(e.admiralKonto).toBe(kontoAus('1'));
    expect(e.kontoMax).toEqual({ [kontoAus('1')]: 0 });
    // #58: explicit start parameters win over settings of the bridge at the start
    expect(e.gesetzt).toEqual(['konten', 'admiral']);
    expect(einstellungAus(['--konten', '1', '--obergrenze', '2', '--leerlauf-min', '60', '--ram-warn', '70', '--platte-min-gb', '30'], join(repo, 'unter', 'ordner')).gesetzt).toEqual(['obergrenze', 'konten', 'ramWarn', 'platteMinGb', 'leerlaufMin']);
    const fest = einstellungAus([repo, '--forge', 'x/y', '--epics', '3,#4', '--konten', '2'], tmpdir());
    expect([fest.forge, fest.epics, fest.auto, fest.dauerhaft]).toEqual(['x/y', [3, 4], false, false]);
    // #150: --epics with --dauerhaft is the fixed list plus the ones released later
    const beides = einstellungAus([repo, '--forge', 'x/y', '--epics', '3', '--konten', '2', '--dauerhaft'], tmpdir());
    expect([beides.epics, beides.auto, beides.dauerhaft]).toEqual([[3], true, true]);
  });

  it('names what is missing: no repository, no GitHub origin, no accounts, an account outside --konten', () => {
    const leer = mkdtempSync(join(tmpdir(), 'flotte-leer-'));
    expect(() => einstellungAus(['--konten', '1'], leer)).toThrow(/Kein Git-Repository/);
    const ohne = mkdtempSync(join(tmpdir(), 'flotte-ohne-'));
    aufrufen('git', ['init', '-q', ohne]);
    expect(() => einstellungAus(['--konten', '1'], ohne)).toThrow(/Forge lässt sich nicht aus origin lesen/);
    expect(() => einstellungAus([ohne, '--forge', 'o/r'], ohne)).toThrow(/Aufruf: flotte fahren/);
    expect(() => einstellungAus([ohne, '--forge', 'o/r', '--konten', '2', '--konto-max', '1=0'], ohne)).toThrow(/--konto-max 1=0/);
  });
});

describe('B: freigegebene Epics', () => {
  it('open epics with ready_label on themselves or on an open child', () => {
    const aufrufe: string[][] = [];
    const a: Aufrufer = (_p, args) => {
      aufrufe.push(args);
      const label = args[args.indexOf('--label') + 1];
      const out = label === 'bereit' ? [{ number: 5 }, { number: 21 }, { number: 9 }] : [{ number: 3, body: '## Kinder\n- [ ] #5\n- [x] #6' }, { number: 4, body: '> **Reihenfolge:** Kinder: #7' }, { number: 21, body: '' }];
      return { code: 0, stdout: JSON.stringify(out), stderr: '' };
    };
    expect(freigegebene(a, 'o/r', liesAdapter('---\nready_label: bereit\nepic_label: type/epic\n---\n'))).toEqual({ epics: [3, 21], ohneEpic: [9] });
    expect(aufrufe.map((x) => x[x.indexOf('--label') + 1])).toEqual(['bereit', 'type/epic']);
    expect(aufrufe.every((x) => x.includes('open'))).toBe(true);
    expect(liesAdapter('').ready_label).toBe('ready-for-agent');
  });

  it('without --epics the driver takes the released epics, adds one released later, then ends', async () => {
    let n = 0;
    const t = aufbau({
      freigegeben: () => {
        n++;
        return { bereit: n === 1 ? [3] : [3, 4], epics: n === 1 ? [{ number: 3 }] : [{ number: 3 }, { number: 4 }] };
      },
    });
    const buch = drehbuch([lauf(3, [{ warte: 600 }, { text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [], { auto: true, sammelnMs: 200 }), t.welt);
    expect(Object.values(z.epics).map((e) => [e.nr, e.stufe])).toEqual([
      [3, 'fertig'],
      [4, 'fertig'],
    ]);
    const e = z.ereignisse.map((x) => x.text);
    expect(e[0]).toMatch(/^Einsatz gestartet: #3 \(freigegeben mit ready-for-agent, neu eingesammelt alle 0 min\)/);
    expect(e).toContain('Neu freigegeben: #4');
    expect(z.aktiv).toBe(false);
    expect(e.some((x) => /Zeitgrenze/.test(x))).toBe(false);
  }, T);

  it('nothing released: the driver ends at once; with --dauerhaft it waits for new epics', async () => {
    const leer = aufbau({ freigegeben: () => ({ bereit: [], epics: [] }) });
    const z = await fahre(leer.einstellung(drehbuch([]), [], { auto: true }), leer.welt);
    expect(z.ereignisse[0].text).toBe('Einsatz gestartet: keine freigegebenen Epics (freigegeben mit ready-for-agent, neu eingesammelt alle 15 min)');
    expect(z.ereignisse.some((x) => /Zeitgrenze/.test(x.text))).toBe(false);

    const wartet = aufbau({ freigegeben: () => ({ bereit: [], epics: [] }) });
    const z2 = await fahre(wartet.einstellung(drehbuch([]), [], { auto: true, dauerhaft: true, maxDauerMs: 800 }), wartet.welt);
    expect(z2.ereignisse.some((x) => /Zeitgrenze von 1 s erreicht/.test(x.text))).toBe(true);
  }, T);

  it('a released issue that is no epic and no child of one is reported once', async () => {
    const t = aufbau({ freigegeben: () => ({ bereit: [3, 8], epics: [{ number: 3 }] }) });
    const buch = drehbuch([lauf(3, [{ warte: 600 }, { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [], { auto: true, sammelnMs: 150 }), t.welt);
    const ohne = z.ereignisse.filter((x) => x.text.startsWith('freigegeben, aber kein Epic'));
    expect(ohne.map((x) => x.text)).toEqual(['freigegeben, aber kein Epic: #8 (ohne epic und nicht Kind eines Epics; mit --epics fahren oder das Label setzen)']);
    expect(Object.keys(z.epics)).toEqual(['3']);
  }, T);

  it('#150: --epics with --dauerhaft (auto with a fixed list): the fixed list plus the released ones', async () => {
    const t = aufbau({ freigegeben: () => ({ bereit: [4], epics: [{ number: 4 }] }) });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
    // without --dauerhaft the driver ends once both are done; the limit only guards a hang
    const z = await fahre(t.einstellung(buch, [3], { auto: true, maxDauerMs: 120_000 }), t.welt);
    expect(z.ereignisse.some((e) => /Zeitgrenze/.test(e.text))).toBe(false);
    expect(Object.values(z.epics).map((e) => [e.nr, e.stufe])).toEqual([
      [3, 'fertig'],
      [4, 'fertig'],
    ]);
  }, T);

  it('#150: a run taken over from an earlier deployment that the collection misses still counts in the occupancy', async () => {
    const t = aufbau({ freigegeben: () => ({ bereit: [3], epics: [{ number: 3 }] }) });
    const z0 = leer(t.repo);
    // a living run of an issue without the epic label, driven before with --epics; its process is gone by now
    z0.epics['5'] = { ...neuesEpic(5), stufe: 'laeuft', konto: t.konten[0], sitzung: 's5', pid: 2 ** 22 + 7, pidSeit: Date.now() } as never;
    schreibeZustand(flotteDir(t.repo), z0);
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }]), lauf(5, [{ text: ende(5, 15) }])]);
    const z = await fahre(t.einstellung(buch, [], { auto: true, maxDauerMs: 120_000 }), t.welt);
    expect(z.ereignisse.some((e) => /Zeitgrenze/.test(e.text))).toBe(false);
    expect(z.ereignisse.some((e) => e.epic === null && /^Übernommen aus einem früheren Einsatz: #5/.test(e.text))).toBe(true);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.epics['5'].stufe).toBe('fertig');
  }, T);

  it('with --epics the list stays fixed: no epic is collected', async () => {
    const t = aufbau({ freigegeben: () => ({ bereit: [4], epics: [{ number: 4 }] }) });
    const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ text: ende(3, 13) }])]), [3]), t.welt);
    expect(Object.keys(z.epics)).toEqual(['3']);
  }, T);
});
