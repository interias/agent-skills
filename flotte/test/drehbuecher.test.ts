// The scripts D1–D21 of #14: each is a test with stand-ins (claude, gh, pwsh scripts).

import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { antworten, fahre } from '../src/treiber/treiber.ts';
import { flotteDir, lebt, neuesEpic, schreibe as schreibeZustand, leer } from '../src/werkzeuge/zustand.ts';
import { admiral, aufbau, drehbuch, ende, frage, gateGefahren, lauf, ping, skriptVon } from './flotte-welt.ts';

const T = 30_000;
const fuer = <G extends { eingabe: string }>(gesehen: G[], nr: number): G[] => gesehen.filter((g) => new RegExp(`^Flotte, Mission #${nr}\\b`).test(g.eingabe));
const index = (liste: string[], muster: RegExp) => liste.findIndex((z) => muster.test(z));

/** a process that lives for `ms` and then ends, for pids alive or dead */
function prozess(ms: number): Promise<number> & { pid: number } {
  const kind = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { stdio: 'ignore' });
  const p = new Promise<number>((r) => kind.on('exit', () => r(kind.pid!))) as Promise<number> & { pid: number };
  p.pid = kind.pid!;
  return p;
}

const ergebnisZeile = (text: string) => JSON.stringify({ type: 'result', subtype: 'success', session_id: 's3', is_error: false, result: text, permission_denials: [] });

describe('Drehbücher (#14)', () => {
  it('D1: a start without result or with exit ≠ 0 is restarted at most twice, then blocked', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ stderr: 'boom' }], 1)]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(fuer(buch.gesehen(), 3)).toHaveLength(3);
    expect(buch.gesehen().every((g) => !g.args.includes('--resume'))).toBe(true);
    expect(z.epics['3']).toMatchObject({ stufe: 'blockiert', neustarts: 2 });
    expect(t.p.kommentare.some((k) => k.nr === 3 && /blockiert/.test(k.text))).toBe(true);
  }, T);

  it('D1b (#132): an account limit is no failed start; the run continues once the account has room', async () => {
    const t = aufbau();
    const limit = "You've hit your weekly limit · resets Nov 24, 3am (Europe/Berlin)";
    const buch = drehbuch([lauf(3, [{ text: limit, fehler: true }], 1), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe).toHaveLength(2);
    expect(laeufe[1].args).toEqual(expect.arrayContaining(['--resume', 's3']));
    expect(z.epics['3']).toMatchObject({ stufe: 'fertig', neustarts: 0 });
    expect(z.ereignisse.some((e) => /Limit erreicht/.test(e.text) && /kein Fehlstart/.test(e.text))).toBe(true);
    expect(t.p.kommentare.some((k) => k.nr === 3 && /blockiert/.test(k.text))).toBe(false);
  }, T);

  it('D2: the admiral decides a gate question; answer by --resume, comment at the issue, the run goes on', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe).toHaveLength(2);
    expect(laeufe[1].args).toEqual(expect.arrayContaining(['--resume', 's3']));
    expect(laeufe[1].eingabe).toMatch(/1\. A — Herkunft: Skill-Empfehlung/);
    const admiralAufruf = buch.gesehen().find((g) => g.eingabe.startsWith('FLOTTE-ADMIRAL'))!;
    expect(admiralAufruf.args).toEqual(expect.arrayContaining(['--json-schema', '--tools', 'Read,Grep,Glob']));
    expect(t.p.kommentare.find((k) => k.nr === 3 && k.text.startsWith('**Entschieden'))?.text).toMatch(/Entscheidung: A/);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.entscheidungen).toHaveLength(1);
  }, T);

  it('D3: a question for the person that names packages parks them; the run goes on without them, others run, the answer comes later', async () => {
    const buch = drehbuch([
      lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'p2' }, { betrifft: 'Lauf' }]) }]),
      admiral(3, [
        { nr: 1, antwort: 'A', beim_menschen: true },
        { nr: 2, antwort: 'B', beim_menschen: false, einflussreich: true },
      ]),
      lauf(3, [{ warte: 300 }, { text: ende(3, 13) }]),
      lauf(3, [{ text: ende(3, 13) }]),
      lauf(4, [{ warte: 200 }, { text: ende(4, 14) }]),
    ]);
    const t2 = aufbau({ verbrauch: [0.1, 0.1] });
    const welt = { ...t2.welt, melde: (zeile: string) => {
      t2.welt.melde(zeile);
      if (/Frage 1 liegt beim Menschen/.test(zeile)) setTimeout(() => antworten([t2.repo, '3', '1', 'Nimm A']), 100);
    } };
    const z = await fahre(t2.einstellung(buch, [3, 4]), welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe[1].eingabe).toMatch(/weiter ohne p2/);
    expect(laeufe[1].eingabe).toMatch(/1\. liegt beim Menschen; geparkt: p2/);
    expect(t2.p.kommentare.some((k) => k.nr === 3 && k.text.startsWith('**FRAGE AN DEN MENSCHEN'))).toBe(true);
    expect(t2.p.kommentare.some((k) => k.nr === 99 && k.text.startsWith('**Protokoll'))).toBe(true);
    expect(laeufe[2].eingabe).toMatch(/Antworten des Menschen[\s\S]*1\. Nimm A/);
    expect(z.epics['4'].stufe).toBe('fertig');
    expect(new Set(buch.gesehen().filter((g) => /^Flotte/.test(g.eingabe)).map((g) => g.konto)).size).toBe(2);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.fragen[0].beantwortet).toBe('Nimm A');
  }, T);

  it('D3b: a question for the person about the whole run holds the run until the answer', async () => {
    const t = aufbau({ pr: () => ({ state: 'MERGED' }) });
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }]), lauf(3, [{ text: ende(3, 13) }])]);
    const welt = { ...t.welt, melde: (zeile: string) => {
      t.welt.melde(zeile);
      if (/Frage 1 liegt beim Menschen/.test(zeile)) setTimeout(() => antworten([t.repo, '3', '1', 'B, mit Testdaten']), 300);
    } };
    const z = await fahre(t.einstellung(buch, [3]), welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe).toHaveLength(2);
    expect(laeufe[1].eingabe).toMatch(/1\. liegt beim Menschen[\s\S]*Antworten des Menschen[\s\S]*1\. B, mit Testdaten/);
    expect(index(t.p.zeitleiste, /Antwort des Menschen/)).toBeLessThan(index(t.p.zeitleiste, /Lauf fortgesetzt/));
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('D3c: a run that asks a parked question again waits for the person; no second admiral call, comment or bridge question', async () => {
    const t = aufbau({ pr: () => ({ state: 'MERGED' }) });
    const buch = drehbuch([
      lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'p2' }]) }]),
      admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }]),
      lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'p2' }]) }]),
      lauf(3, [{ text: ende(3, 13) }]),
    ]);
    const welt = { ...t.welt, melde: (zeile: string) => {
      t.welt.melde(zeile);
      if (/wiederholt: liegen schon beim Menschen/.test(zeile)) setTimeout(() => antworten([t.repo, '3', '1', 'Nimm A']), 300);
    } };
    const z = await fahre(t.einstellung(buch, [3]), welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe).toHaveLength(3);
    expect(laeufe[2].eingabe).toMatch(/liegen schon beim Menschen[\s\S]*Antworten des Menschen[\s\S]*1\. Nimm A/);
    expect(buch.gesehen().filter((g) => g.eingabe.startsWith('FLOTTE-ADMIRAL'))).toHaveLength(1);
    expect(t.p.kommentare.filter((k) => k.nr === 3 && k.text.startsWith('**FRAGE AN DEN MENSCHEN'))).toHaveLength(1);
    expect(z.fragen).toHaveLength(1);
    expect(index(t.p.zeitleiste, /Antwort des Menschen/)).toBeLessThan(t.p.zeitleiste.findLastIndex((x) => /Lauf fortgesetzt/.test(x)));
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('D3d: open repeats of a question answered since are closed at start, with that answer', async () => {
    const t = aufbau();
    const z0 = leer(t.repo);
    const f = { epic: 3, nr: 1, frage: 'Haltepunkt 1: weiter?', betrifft: 'p2', empfehlung: 'A', wartet: 'p2', ganzerLauf: false };
    z0.epics['3'] = { ...neuesEpic(3), stufe: 'fertig' } as never;
    z0.fragen = [
      { ...f, seit: '2026-11-21T16:30:00.000Z', beantwortet: 'A', beantwortetAm: '2026-11-21T16:46:00.000Z' },
      { ...f, seit: '2026-11-21T16:40:00.000Z' },
      { ...f, frage: 'Etwas anderes?', betrifft: 'p9', seit: '2026-11-21T16:41:00.000Z' },
      { ...f, seit: '2026-11-21T16:50:00.000Z' },
    ] as never;
    schreibeZustand(flotteDir(t.repo), z0);
    const z = await fahre(t.einstellung(drehbuch([]), [3]), t.welt);
    expect(z.fragen.map((x) => x.beantwortet ?? null)).toEqual(['A', 'A', null, null]);
    expect(z.fragen[1].wiederholungVon).toBe('2026-11-21T16:30:00.000Z');
  }, T);

  it('D3e: an open question stored without options gets them from its wording at start', async () => {
    const t = aufbau();
    const z0 = leer(t.repo);
    z0.epics['3'] = { ...neuesEpic(3), stufe: 'fertig' } as never;
    const roh = '1. **QR-Code.** - A) so lassen - B) Ticket: eine URL ➡️ **A**. Betrifft: nichts in dieser Sitzung.';
    z0.fragen = [{ epic: 3, nr: 1, frage: roh.slice(3), optionen: [], roh, empfehlung: 'A', wartet: 'der ganze Lauf', ganzerLauf: true, seit: '2026-11-21T19:27:42.126Z' }] as never;
    schreibeZustand(flotteDir(t.repo), z0);
    const z = await fahre(t.einstellung(drehbuch([]), [3]), t.welt);
    expect(z.fragen[0]).toMatchObject({ frage: '**QR-Code.**', optionen: [{ buchstabe: 'A', text: 'so lassen' }, { buchstabe: 'B', text: 'Ticket: eine URL' }] });
  }, T);

  it('D4: a run that ends without block is asked once, then aborted with its state at the issue', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: 'Ich habe aufgehört.' }]), lauf(3, [{ text: 'Immer noch kein Block.' }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe).toHaveLength(2);
    expect(laeufe[1].eingabe).toMatch(/ohne FLOTTE-FRAGE oder FLOTTE-ENDE/);
    expect(z.epics['3'].stufe).toBe('abgebrochen');
    expect(t.p.kommentare.find((k) => k.nr === 3)?.text).toMatch(/Immer noch kein Block/);
  }, T);

  it('D5: a run silent for too long is stopped, CleanupStale runs', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ haenge: true }])]);
    const z = await fahre(t.einstellung(buch, [3], { leerlaufMs: 600 }), t.welt);
    expect(z.epics['3'].stufe).toBe('abgebrochen');
    expect(z.epics['3'].notiz).toMatch(/Leerlauf/);
    expect(t.p.aufraeumen).toBeGreaterThan(0);
  }, T);

  it('D6: nothing new on RAM warn and hold, starts only after the hysteresis', async () => {
    const r = (level: string, p: number) => JSON.stringify({ level, percent_used: p, free_gb: 10 });
    const t = aufbau({ ram: [r('warn', 76), r('hold', 86), r('ok', 73), r('ok', 73), r('ok', 69)] });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    const ramAufrufe = () => t.p.aufrufe.filter((a) => skriptVon(a.slice(1)) === 'ram.ps1').length;
    expect(ramAufrufe()).toBeGreaterThanOrEqual(5);
    expect(index(t.p.zeitleiste, /RAM warn/)).toBeLessThan(index(t.p.zeitleiste, /RAM wieder ok \(69/));
    expect(index(t.p.zeitleiste, /RAM wieder ok/)).toBeLessThan(index(t.p.zeitleiste, /Lauf gestartet/));
    expect(z.ram[0]).toMatchObject({ epic: 3, level: 'ok', percent_used: 69 });
  }, T);

  it('D7: a failed RAM measurement counts as hold', async () => {
    const t = aufbau({ ram: [null] });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 800 }), t.welt);
    expect(buch.gesehen()).toHaveLength(0);
    expect(z.bremse).toMatchObject({ ram: 'hold', ramHalt: true });
    expect(z.epics['3'].stufe).toBe('wartend');
  }, T);

  it('D8: yellow and red usage start nothing; a stale value is red until a mini run fetches a fresh one', async () => {
    for (const anteil of [0.42, 0.9]) {
      const t = aufbau({ verbrauch: [anteil] });
      const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 600 }), t.welt);
      expect(buch.gesehen()).toHaveLength(0);
      expect(z.bremse?.konten[0].stufe).toBe(anteil === 0.42 ? 'gelb' : 'rot');
      expect(t.p.logbuch.at(-1)).not.toMatch(/%|0\.65|0\.9/);
    }
    const alt = aufbau({ verbrauch: ['alt'] });
    const roterPing = drehbuch([ping(0.9), lauf(3, [{ text: ende(3, 13) }])]);
    await fahre(alt.einstellung(roterPing, [3], { maxDauerMs: 600 }), alt.welt);
    expect(roterPing.gesehen().map((g) => g.eingabe.slice(0, 11))).toEqual(['FLOTTE-PING']);
    expect(roterPing.gesehen()[0].args).toEqual(expect.arrayContaining(['--model', 'haiku']));

    const frisch = aufbau({ verbrauch: [null] });
    const gruenerPing = drehbuch([ping(0.1), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(frisch.einstellung(gruenerPing, [3]), frisch.welt);
    expect(gruenerPing.gesehen().map((g) => g.eingabe.slice(0, 11))).toEqual(['FLOTTE-PING', 'Flotte, Mis']);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('D9: no start below the disk threshold, with a message', async () => {
    const t = aufbau({ frei: 5 });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 500 }), t.welt);
    expect(buch.gesehen()).toHaveLength(0);
    expect(t.p.meldungen.some((m) => /Platte: 5 GB frei, Schwelle 20 GB: kein Start/.test(m))).toBe(true);
    expect(z.bremse?.platteGenug).toBe(false);
  }, T);

  it('D10: FLOTTE-ENDE without a valid gate block: no merge, the order goes back to the run', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll', merge: (pr, n) => (n === 1 ? `GATE FEHLT #${pr}: der Head enthaelt die aktuelle Basis nicht (2 Commits dahinter)` : `GEMERGT #${pr} -> main`) });
    const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }]), lauf(3, [...gateGefahren(), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe).toHaveLength(2);
    expect(laeufe[1].args).toEqual(expect.arrayContaining(['--resume', 's3']));
    // without a worktree the driver cannot pull the base in itself: back to the run
    expect(laeufe[1].eingabe).toMatch(/Die Basis zog davon[\s\S]*Andockblock in der PR-Beschreibung ersetzen/);
    expect(t.p.merges).toEqual([13, 13]);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('D11: green gate with merge: nach_gate: merge.ps1 merges; the driver never merges or deletes a branch itself', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll' });
    const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { sweepRoot: t.repo }), t.welt);
    const merge = t.p.aufrufe.find((a) => skriptVon(a.slice(1)) === 'merge.ps1')!;
    expect(merge.slice(merge.indexOf('-File') + 2)).toEqual(['-Repo', 'o/r', '-Pr', '13']);
    expect(t.p.aufrufe.some((a) => a[0] === 'gh' && (a[1] === 'pr' && a[2] === 'merge'))).toBe(false);
    expect(t.p.aufrufe.some((a) => a.includes('--delete') || a.some((x) => /git\/refs\/heads/.test(x)))).toBe(false);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(t.p.aufraeumen).toBe(1);
    expect(t.p.sweeps).toBe(1);
    expect(z.aktiv).toBe(false);
  }, T);

  describe('#153: what CleanupStale reports after the merge', () => {
    const fahreMit = async (cleanup: () => { code: number; stdout: string; stderr: string }) => {
      const t = aufbau({ cleanup });
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ text: ende(3, 13) }])]), [3]), t.welt);
      expect(t.p.aufraeumen).toBe(1);
      return z.ereignisse.filter((e) => /CleanupStale/.test(e.text)).map((e) => e.text);
    };
    const eintrag = (action: string, reason: string) => ({ kind: 'lock', id: 'x', path: 'p', branch: null, action, reason });

    it('nothing to do is no event', async () => {
      expect(await fahreMit(() => ({ code: 0, stdout: JSON.stringify([eintrag('skipped', 'living lock')]), stderr: 'worktree.ps1: CleanupStale: nothing to do (52 skipped).\n' }))).toEqual([]);
    });

    it('n stopped or removed is no error', async () => {
      expect(await fahreMit(() => ({ code: 0, stdout: JSON.stringify([eintrag('removed', 'dead'), eintrag('stopped', 'dead'), eintrag('skipped', 'dirty')]), stderr: 'worktree.ps1: CleanupStale: 2 stopped or removed, 1 skipped.\n' }))).toEqual(['Reste abgeräumt (CleanupStale): 2 gestoppt oder entfernt']);
    });

    it('a failed step is an error and named, not the summary line', async () => {
      const t = await fahreMit(() => ({ code: 1, stdout: JSON.stringify([eintrag('skipped', 'living lock'), eintrag('skipped', 'failed: git worktree remove exit 128')]), stderr: 'worktree.ps1: CleanupStale: nothing to do (2 skipped).\n' }));
      expect(t).toEqual(['CleanupStale meldet Fehler (Exit 1): lock x: failed: git worktree remove exit 128']);
    });
  });

  describe('#145: the mission issue after the merge of its PR', () => {
    const mitZielen = '## Missionsziele\n- [ ] #21 a\n- [x] #22 b\n\n## Betroffene Module\n- m3';

    it('every Missionsziel closed: the driver closes the mission with a comment linking the PR', async () => {
      const t = aufbau({ bodies: { 3: mitZielen }, zu: [21, 22] });
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ text: ende(3, 13) }])]), [3]), t.welt);
      expect(z.epics['3'].stufe).toBe('fertig');
      expect(t.p.geschlossen).toHaveLength(1);
      expect(t.p.geschlossen[0].nr).toBe(3);
      expect(t.p.geschlossen[0].text).toMatch(/Mission abgeschlossen/);
      expect(t.p.geschlossen[0].text).toContain('https://github.com/o/r/pull/13');
      expect(t.p.labelWeg).toEqual([]);
    }, T);

    it('a Missionsziel still open: the mission stays open, loses ready-for-agent, a comment names what is open', async () => {
      const t = aufbau({ bodies: { 3: mitZielen }, zu: [22] });
      await fahre(t.einstellung(drehbuch([lauf(3, [{ text: ende(3, 13) }])]), [3]), t.welt);
      expect(t.p.geschlossen).toEqual([]);
      expect(t.p.labelWeg).toEqual([{ nr: 3, label: 'ready-for-agent' }]);
      const k = t.p.kommentare.filter((x) => x.nr === 3 && /Mission bleibt offen/.test(x.text));
      expect(k).toHaveLength(1);
      expect(k[0].text).toMatch(/#21/);
      expect(k[0].text).not.toMatch(/#22/);
    }, T);

    it('a Missionsziel whose state cannot be read is unknown: nothing written; a later start closes the mission once all are closed', async () => {
      const zu = [22];
      const unlesbar = [21];
      const t = aufbau({ bodies: { 3: mitZielen }, zu, unlesbar });
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [{ text: ende(3, 13) }])]), [3]), t.welt);
      expect(z.epics['3']).toMatchObject({ stufe: 'fertig', abgeschlossen: false });
      expect(t.p.geschlossen).toEqual([]);
      expect(t.p.labelWeg).toEqual([]);
      expect(z.ereignisse.some((e) => /Stand von #21 nicht lesbar/.test(e.text))).toBe(true);
      unlesbar.length = 0;
      zu.push(21);
      await fahre(t.einstellung(drehbuch([]), [3]), t.welt);
      expect(t.p.geschlossen.map((g) => g.nr)).toEqual([3]);
    }, T);

    it('open Missionsziele after the merge: not final; a later start takes no label off a mission released again, and closes it once all are closed', async () => {
      const zu = [22];
      const t = aufbau({ bodies: { 3: mitZielen }, zu, labels: { 3: ['ready-for-agent'] } });
      const z0 = leer(t.repo);
      z0.epics['3'] = { ...neuesEpic(3), stufe: 'fertig', pr: 13 } as never;
      schreibeZustand(flotteDir(t.repo), z0);
      const z = await fahre(t.einstellung(drehbuch([]), [3]), t.welt);
      expect(z.epics['3'].abgeschlossen).toBe(false);
      expect(t.p.labelWeg).toEqual([]);
      expect(t.p.kommentare.filter((k) => k.nr === 3)).toEqual([]);
      zu.push(21);
      await fahre(t.einstellung(drehbuch([]), [3]), t.welt);
      expect(t.p.geschlossen.map((g) => g.nr)).toEqual([3]);
    }, T);

    it('a mission merged before but still open is closed at the next start, once', async () => {
      const t = aufbau({ bodies: { 3: mitZielen }, zu: [21, 22] });
      const z0 = leer(t.repo);
      z0.epics['3'] = { ...neuesEpic(3), stufe: 'fertig', pr: 13 } as never;
      schreibeZustand(flotteDir(t.repo), z0);
      const z = await fahre(t.einstellung(drehbuch([]), [3]), t.welt);
      expect(t.p.geschlossen.map((g) => g.nr)).toEqual([3]);
      await fahre(t.einstellung(drehbuch([]), [3]), t.welt);
      expect(t.p.geschlossen).toHaveLength(1);
      expect(z.epics['3'].stufe).toBe('fertig');
    }, T);
  });

  it('D12: merge: mensch waits, reports "PR bereit", notices the merge later', async () => {
    const t = aufbau({ adapter: 'merge: mensch', pr: (_nr, n) => ({ state: n < 4 ? 'OPEN' : 'MERGED' }) });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(t.p.merges).toEqual([]);
    expect(t.p.kommentare.filter((k) => k.nr === 3 && k.text.startsWith('**PR bereit'))).toHaveLength(1);
    expect(t.p.aufrufe.filter((a) => a[0] === 'gh' && a[1] === 'pr' && a[2] === 'view' && !a.join(' ').includes('headRefName')).length).toBe(4);
    expect(z.epics['3']).toMatchObject({ stufe: 'fertig', pr: 13 });
  }, T);

  it('D13: a second epic PR with a conflict after the first merge goes back to its run: merge the base, gate again', async () => {
    let ersterGemergt = false;
    const t = aufbau({
      pr: (nr) => {
        if (nr === 13) {
          ersterGemergt = true;
          return { state: 'MERGED' };
        }
        const zweiterZug = fuer(buch.gesehen(), 4).length >= 2;
        return zweiterZug ? { state: 'MERGED' } : { state: 'OPEN', mergeable: ersterGemergt ? 'CONFLICTING' : 'MERGEABLE' };
      },
    });
    const buch = drehbuch([lauf(3, [{ warte: 200 }, { text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }]), lauf(4, [{ text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4]), t.welt);
    const laeufe = fuer(buch.gesehen(), 4);
    expect(laeufe).toHaveLength(2);
    expect(laeufe[1].eingabe).toMatch(/Konflikt\. Basis per `git merge` in den Missions-Worktree holen[\s\S]*Andockprüfung neu/);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.epics['4'].stufe).toBe('fertig');
  }, T);

  it('D14: with an order edge A before B, B starts only after A is merged', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll', bodies: { 3: '## Betroffene Module\n- a', 4: '> **Reihenfolge:** nach #3\n\n## Betroffene Module\n- b' } });
    const buch = drehbuch([lauf(3, [{ warte: 200 }, ...gateGefahren(), { text: ende(3, 13) }]), lauf(4, [...gateGefahren(), { text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4]), t.welt);
    expect(index(t.p.zeitleiste, /^gemergt 13$/)).toBeLessThan(index(t.p.zeitleiste, /^#4 Lauf gestartet/));
    expect(z.epics['4'].stufe).toBe('fertig');
    expect(z.statistik.maxLaeufe).toBe(1);
  }, T);

  describe('#133: an order edge added to a running epic', () => {
    const kante = '> **Reihenfolge:** nach #4\n\n## Betroffene Module\n- a';
    // the edge comes after the start: the first read of #3 has none, every later one has it
    const spaeteKante = () => {
      let gelesen = 0;
      return { get 3() { return gelesen++ ? kante : '## Betroffene Module\n- a'; }, 4: '## Betroffene Module\n- b' } as Record<number, string>;
    };
    const ohnePr = (offen: string) => `Nicht weiter.\n\nFLOTTE-ENDE 3\n\n### Was das Epic offen lässt\n${offen}`;
    // #4 ends once #3 waits for it; #3 starts again only after #4 is merged
    const wartet3 = { signale: { 'wartet-3': /^#3 .*Vorgänger #4 noch nicht gemergt, wartet/ } };

    for (const [fall, offen] of [
      ['naming the predecessor', 'Die Reihenfolge verlangt erst #4, das ist noch offen.'],
      ['without naming it (the edge decides, not the wording)', 'keine'],
    ]) {
      it(`FLOTTE-ENDE without a PR, ${fall}: waiting, the session dropped, not blocked; after the merge of #4 a new start without --resume`, async () => {
        const t = aufbau({ bodies: spaeteKante(), ...wartet3 });
        const buch = drehbuch([lauf(3, [{ text: ohnePr(offen) }]), lauf(4, [{ signal: 'wartet-3' }, { text: ende(4, 14) }]), lauf(3, [{ text: ende(3, 13) }])]);
        const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: 120_000 }), t.welt);
        expect(z.ereignisse.some((e) => e.epic === 3 && /FLOTTE-ENDE ohne Pull Request, Vorgänger #4 noch nicht gemergt, wartet; die Sitzung ist verworfen/.test(e.text))).toBe(true);
        expect(t.p.kommentare.some((k) => k.nr === 3 && /blockiert/.test(k.text))).toBe(false);
        const starts = fuer(buch.gesehen(), 3);
        expect(starts).toHaveLength(2);
        expect(starts[1].args).not.toContain('--resume');
        expect(index(t.p.zeitleiste, /^gemergt 14$/)).toBeLessThan(index(t.p.zeitleiste, /^gemergt 13$/));
        expect(z.epics['3'].stufe).toBe('fertig');
      }, T);
    }

    it('the predecessor is merged already: blocked as before', async () => {
      const t = aufbau({ bodies: spaeteKante(), signale: { 'gemergt-14': /^gemergt 14$/ } });
      const buch = drehbuch([lauf(3, [{ signal: 'gemergt-14' }, { text: ohnePr('keine') }]), lauf(4, [{ text: ende(4, 14) }])]);
      const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: 120_000 }), t.welt);
      expect(z.epics['4'].stufe).toBe('fertig');
      expect(index(t.p.zeitleiste, /^gemergt 14$/)).toBeLessThan(index(t.p.zeitleiste, /^#3 blockiert: FLOTTE-ENDE ohne Pull Request/));
      expect(z.epics['3']).toMatchObject({ stufe: 'blockiert', notiz: 'FLOTTE-ENDE ohne Pull Request' });
    }, T);

    it('before a resume (an answer of the admiral): waiting, no resumed turn; after the merge of #4 a new start', async () => {
      const t = aufbau({ bodies: spaeteKante(), signale: { 'wartet-3': /^#3 vor dem Fortsetzen, Vorgänger #4 noch nicht gemergt, wartet/ } });
      const buch = drehbuch([
        lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]),
        admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]),
        lauf(4, [{ signal: 'wartet-3' }, { text: ende(4, 14) }]),
        lauf(3, [{ text: ende(3, 13) }]),
      ]);
      const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: 120_000 }), t.welt);
      const starts = fuer(buch.gesehen(), 3);
      expect(starts).toHaveLength(2);
      expect(starts[1].args).not.toContain('--resume');
      expect(starts[1].eingabe).not.toMatch(/Antwort des Admirals/);
      expect(index(t.p.zeitleiste, /^gemergt 14$/)).toBeLessThan(index(t.p.zeitleiste, /^gemergt 13$/));
      expect(z.epics['3'].stufe).toBe('fertig');
    }, T);
  });

  it('#144: an epic left out because of a collision carries the reason as its note', async () => {
    // #3 ends only once the reason of #4 is said (an event); then #4 runs after it
    const t = aufbau({ bodies: { 3: 'Ändert `core/a.ts`.', 4: 'Ändert `core/a.ts`.' }, signale: { grund: /^#4 wartet auf #3/ } });
    const buch = drehbuch([lauf(3, [{ signal: 'grund' }, { text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: 120_000 }), t.welt);
    expect(z.ereignisse.filter((e) => e.epic === 4 && e.text === 'wartet auf #3: Kollision gross (dieselben Dateien: core/a.ts)')).toHaveLength(1);
    expect(index(t.p.zeitleiste, /^#4 wartet auf #3/)).toBeLessThan(index(t.p.zeitleiste, /^gemergt 13$/));
    expect(z.epics['4'].stufe).toBe('fertig');
  }, T);

  it('D15: a large collision and five startable epics run one after another; never more than four at once', async () => {
    const nrs = [3, 4, 5, 6, 7];
    const gross = aufbau({ bodies: Object.fromEntries(nrs.map((n) => [n, 'Ändert `core/a.ts`.'])) });
    const buch = drehbuch(nrs.map((n) => lauf(n, [{ warte: 150 }, { text: ende(n, 10 + n) }])));
    const z = await fahre(gross.einstellung(buch, nrs), gross.welt);
    expect(z.statistik.maxLaeufe).toBe(1);
    expect(nrs.every((n) => z.epics[String(n)].stufe === 'fertig')).toBe(true);
    expect(gross.p.meldungen.some((m) => /Belegung/.test(m))).toBe(false);
    // one after another, the epics still spread over both accounts
    expect(nrs.map((n) => z.epics[String(n)].konto)).toEqual([0, 1, 0, 1, 0].map((i) => gross.konten[i]));

    const frei = aufbau();
    const buch2 = drehbuch(nrs.map((n) => lauf(n, [{ warte: 400 }, { text: ende(n, 10 + n) }])));
    const z2 = await fahre(frei.einstellung(buch2, nrs), frei.welt);
    expect(z2.statistik.maxLaeufe).toBe(4);
    expect(nrs.every((n) => z2.epics[String(n)].stufe === 'fertig')).toBe(true);
  }, T);

  it('D16: a driver killed in the middle of a turn; the run finishes its turn, a new driver takes it from the log', async () => {
    const t = aufbau();
    const dir = flotteDir(t.repo);
    const buch = drehbuch([lauf(3, [{ text: 'Zwischenstand' }, { warte: 2500 }, { text: ende(3, 13) }])]);
    const alt = spawn(process.execPath, [fileURLToPath(new URL('./treiber-prozess.ts', import.meta.url)), JSON.stringify({ repo: t.repo, konten: t.konten, datei: buch.datei, epics: [3] })], { stdio: 'ignore' });
    let z0: { epics: Record<string, { pid?: number; log?: string }> } = { epics: {} };
    for (let i = 0; i < 100 && !z0.epics['3']?.pid; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        z0 = JSON.parse(readFileSync(join(dir, 'zustand.json'), 'utf8'));
      } catch {
        /* not written yet */
      }
    }
    const laufPid = z0.epics['3'].pid!;
    // the driver dies hard (worse than Ctrl+C, which only takes its lock along); the run lives on
    process.kill(alt.pid!, 'SIGKILL');
    await new Promise((r) => alt.on('exit', r));
    expect(lebt(laufPid)).toBe(true);
    expect(readFileSync(z0.epics['3'].log!, 'utf8')).not.toMatch(/FLOTTE-ENDE/);

    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(buch.gesehen()).toHaveLength(1);
    expect(t.p.meldungen.some((m) => /lebt noch: wird beobachtet/.test(m))).toBe(true);
    expect(readFileSync(z0.epics['3'].log!, 'utf8')).toMatch(/FLOTTE-ENDE 3/);
    expect(z.epics['3']).toMatchObject({ stufe: 'fertig', pr: 13 });
  }, T);

  it('D16: a dead run is read from its log; a reused pid is no run and is never killed', async () => {
    for (const fall of ['tot', 'fremd'] as const) {
      const t = aufbau();
      const dir = flotteDir(t.repo);
      const log = join(dir, 'alt.jsonl');
      writeFileSync(log, `${ergebnisZeile(ende(3, 13))}\n`);
      const kind = prozess(fall === 'tot' ? 0 : 5000);
      if (fall === 'tot') await kind;
      const z0 = leer(t.repo);
      // fremd: the pid lives, but it started an hour after the driver spawned its run
      z0.epics['3'] = { ...neuesEpic(3), stufe: 'laeuft', konto: t.konten[0], sitzung: 's3', pid: kind.pid, pidSeit: Date.now() - 3_600_000, log } as never;
      schreibeZustand(dir, z0);
      const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
      const z = await fahre(t.einstellung(buch, [3]), t.welt);
      expect(buch.gesehen()).toHaveLength(0);
      expect(z.epics['3'].stufe).toBe('fertig');
      expect(t.p.meldungen.some((m) => /endete ohne Treiber/.test(m))).toBe(true);
      if (fall === 'fremd') expect(lebt(kind.pid)).toBe(true);
    }
  }, T);

  it('D17: a run that dies is cleaned up (CleanupStale) before it starts again', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ stderr: 'gestorben' }], 3), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(index(t.p.zeitleiste, /^aufraeumen$/)).toBeLessThan(index(t.p.zeitleiste, /Neustart 1 von 2/) + 1);
    expect(index(t.p.zeitleiste, /^aufraeumen$/)).toBeLessThan(t.p.zeitleiste.lastIndexOf('#3 Lauf gestartet'));
    // the worktree removal itself (junctions first, no recursion through them) is worktree.ps1's, tested in worktree.Tests.ps1
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('D18: a network error is continued by --resume at most twice', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: 'API Error: 529 Overloaded', fehler: true }], 1)]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe).toHaveLength(3);
    expect(laeufe.slice(1).every((g) => g.args.includes('--resume'))).toBe(true);
    expect(z.epics['3']).toMatchObject({ stufe: 'blockiert', fortsetzungen: 2 });
  }, T);

  it('D19: permission_denials go on the board, the epic is blocked, no second try in another form', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: 'Merge versucht.', verweigert: [{ tool_name: 'Bash', tool_input: { command: 'gh pr merge 13' } }] }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(fuer(buch.gesehen(), 3)).toHaveLength(1);
    expect(z.epics['3']).toMatchObject({ stufe: 'blockiert' });
    expect(z.epics['3'].notiz).toMatch(/Erlaubnis verweigert: Bash/);
    expect(readFileSync(join(flotteDir(t.repo), 'tafel.html'), 'utf8')).toMatch(/Erlaubnis verweigert: Bash/);
  }, T);

  it('#54: a question block goes before permission_denials: the questions are open, the denials an event and noted at the question, no blockade', async () => {
    const t = aufbau();
    const verweigert = [{ tool_name: 'Bash', tool_input: { command: 'rm -rf tmp-1' } }, { tool_name: 'Bash', tool_input: { command: 'rm -rf tmp-2' } }];
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'abbruch', [{ betrifft: 'Lauf' }]), verweigert }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 1500 }), t.welt);
    expect(z.epics['3'].stufe).toBe('frage');
    const offen = z.fragen.filter((f) => f.epic === 3 && !f.beantwortet);
    expect(offen).toHaveLength(1);
    expect(offen[0].lage).toBe('Sachverhalt\nIm selben Zug abgelehnt: Bash, Bash.');
    expect(index(t.p.zeitleiste, /Erlaubnis verweigert: Bash, Bash; der Zug endete mit FLOTTE-FRAGE, nicht blockiert/)).toBeGreaterThanOrEqual(0);
    expect(index(t.p.zeitleiste, /blockiert:/)).toBe(-1);
    expect(t.p.kommentare.some((k) => k.text.startsWith('**FRAGE AN DEN MENSCHEN') && k.text.includes('Im selben Zug abgelehnt: Bash, Bash.'))).toBe(true);
  }, T);

  it('D20: a second driver in the same repository refuses to start', async () => {
    const t = aufbau();
    const anderer = prozess(3000);
    writeFileSync(join(flotteDir(t.repo), 'treiber.lock'), JSON.stringify({ pid: anderer.pid, seit: 'vorhin' }));
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    await expect(fahre(t.einstellung(buch, [3]), t.welt)).rejects.toThrow(/läuft schon ein Treiber/);
    expect(buch.gesehen()).toHaveLength(0);
  }, T);

  it('D21: a failing nach_merge command is reported; cleanup runs anyway', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll\nnach_merge:\n  - npm run deploy:lokal', nachMerge: 1 });
    const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(t.p.nachMerge).toEqual(['npm run deploy:lokal']);
    expect(t.p.meldungen.some((m) => /FEHLER nach_merge #3: npm run deploy:lokal/.test(m))).toBe(true);
    expect(index(t.p.zeitleiste, /^nach_merge /)).toBeLessThan(index(t.p.zeitleiste, /^aufraeumen$/));
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);
});
