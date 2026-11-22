// The scripts P1–P22 of #65 (stage 1 of #69): `flotte epic` with stand-ins for every language-model
// call and every command (src/epic/attrappe.ts); state and lock are real, in a fresh git repository.

import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aufrufen } from '../src/aufruf.ts';
import { epic } from '../src/befehle/epic.ts';
import { attrappe, neueWelt, type EpicDrehbuch, type Welt } from '../src/epic/attrappe.ts';
import { fahreEpic, type EpicEinstellung } from '../src/epic/motor.ts';
import type { Paket, TorPunkt } from '../src/epic/schema.ts';
import { epicDir, liesLauf, type EpicLaufZustand } from '../src/epic/zustand.ts';
import { leseBlock } from '../src/werkzeuge/bloecke.ts';
import { sperren } from '../src/werkzeuge/zustand.ts';

const T = 30_000;

const paket = (nr: string, o: Partial<Paket> = {}): Paket => ({ nr, titel: `Paket ${nr}`, klasse: 'standard', abnahme: [`${nr} tut, was es soll`], decisions: [], outOfScope: [], testing: [], verifikation: '', lektuere: [], dateien: [`src/p${nr}.ts`], nach: [], kollision: [], exklusiv: false, ...o });
const buch = (pakete: Paket[], o: Partial<EpicDrehbuch> = {}, tor: TorPunkt[] = []): EpicDrehbuch => ({ schnitt: { version: 1, pakete, tor }, ...o });

function neuesRepo(): string {
  const r = mkdtempSync(join(tmpdir(), 'flotte-epic-'));
  aufrufen('git', ['init', '-q', r]);
  return r;
}

const einstellung = (repo: string, o: Partial<EpicEinstellung> = {}): EpicEinstellung => ({ repo, epic: 69, epicBranch: 'epic/69-programm', basis: 'origin/main', fenster: 3, maxRunden: 3, konto: '/konten/2', ...o });

async function fahre(b: EpicDrehbuch, o: Partial<EpicEinstellung> & { welt?: Welt } = {}) {
  const repo = o.repo ?? neuesRepo();
  const u = attrappe(b, o.welt);
  const z = await fahreEpic(einstellung(repo, o), u);
  return { z, w: u.welt, repo };
}

/** the takt of the first event of a package and kind */
const takt = (z: EpicLaufZustand, paket: string, art: string) => z.ereignisse.find((e) => e.paket === paket && e.art === art)?.takt ?? -1;
const endeTakt = (z: EpicLaufZustand, paket: string) => z.ereignisse.find((e) => e.paket === paket && (e.art === 'gemergt' || e.art === 'zurueckgelassen'))?.takt ?? -1;

/** most packages running at once, in the order the events happened */
function hoechstens(z: EpicLaufZustand): number {
  const laufend = new Set<string>();
  let max = 0;
  for (const e of z.ereignisse) {
    if (e.art === 'start') laufend.add(e.paket!);
    if (e.art === 'gemergt' || e.art === 'zurueckgelassen') laufend.delete(e.paket!);
    max = Math.max(max, laufend.size);
  }
  return max;
}

const aufrufeVon = (w: Welt, rolle: string, paket: string) => w.aufrufe.filter((a) => a.rolle === rolle && a.paket === paket);
const getan = (w: Welt, muster: RegExp) => w.protokoll.filter((p) => muster.test(p.was));
const letzterBlock = (w: Welt) => leseBlock(w.bloecke[w.bloecke.length - 1]);

describe('flotte epic, Drehbücher (#65)', () => {
  it('P1: five packages without edges: never more than 3 at once, a freed place is taken in the same takt', async () => {
    const lang = (n: number) => [{ takte: n }];
    const { z, w } = await fahre(buch(['1', '2', '3', '4', '5'].map((n) => paket(n)), { aufrufe: { 'implementer:1': lang(1), 'implementer:2': lang(4), 'implementer:3': lang(6), 'implementer:4': lang(1), 'implementer:5': lang(1) } }));
    expect(Object.values(z.pakete).every((p) => p.stufe === 'fertig')).toBe(true);
    expect(hoechstens(z)).toBe(3);
    const starts = z.ereignisse.filter((e) => e.art === 'start');
    expect(starts.slice(0, 3).map((e) => e.paket)).toEqual(['1', '2', '3']);
    expect(new Set(starts.slice(0, 3).map((e) => e.takt)).size).toBe(1);
    // package 1 merges first; package 4 takes its place in the same takt
    expect(takt(z, '4', 'start')).toBe(takt(z, '1', 'gemergt'));
    const viertes = z.ereignisse.findIndex((e) => e.paket === '4' && e.art === 'start');
    expect(z.ereignisse.findIndex((e) => e.paket === '1' && e.art === 'gemergt')).toBeLessThan(viertes);
    // decision 6: never two full runs at once
    expect(w.vollaeufe.max).toBe(1);
    const ende = letzterBlock(w);
    expect(ende).toMatchObject({ art: 'ende', epic: 69, pr: 100 });
  }, T);

  it('P2: edge A → B: B starts only after A is merged, on the epic head with A', async () => {
    const { z, w } = await fahre(buch([paket('10'), paket('11', { nach: ['10'] })]));
    expect(takt(z, '11', 'start')).toBeGreaterThanOrEqual(takt(z, '10', 'gemergt'));
    expect(z.ereignisse.findIndex((e) => e.paket === '11' && e.art === 'start')).toBeGreaterThan(z.ereignisse.findIndex((e) => e.paket === '10' && e.art === 'gemergt'));
    const up = getan(w, /^up 11 /)[0].was;
    expect(up).toMatch(/von epic\/69-programm \[agent\/10-paket-10\]/);
    expect(z.pakete['11'].stufe).toBe('fertig');
  }, T);

  it('P3: collision A–C: never at the same time, C starts in the takt after A has ended', async () => {
    const { z } = await fahre(buch([paket('20', { kollision: ['22'] }), paket('21'), paket('22')], { aufrufe: { 'implementer:20': [{ takte: 3 }] } }));
    expect(takt(z, '22', 'start')).toBeGreaterThanOrEqual(endeTakt(z, '20'));
    expect(z.ereignisse.findIndex((e) => e.paket === '22' && e.art === 'start')).toBeGreaterThan(z.ereignisse.findIndex((e) => e.paket === '20' && e.art === 'gemergt'));
    // the first takt after A's end: the merge is applied and C starts in the same takt
    expect(takt(z, '22', 'start')).toBe(endeTakt(z, '20'));
    expect(takt(z, '21', 'start')).toBe(takt(z, '20', 'start'));
  }, T);

  it('P4: an exclusive node starts only with all places empty, nothing beside it', async () => {
    const { z } = await fahre(buch([paket('1'), paket('2'), paket('3', { exklusiv: true }), paket('4'), paket('5')], { aufrufe: { 'implementer:1': [{ takte: 3 }] } }));
    const start3 = z.ereignisse.findIndex((e) => e.paket === '3' && e.art === 'start');
    const ende3 = z.ereignisse.findIndex((e) => e.paket === '3' && e.art === 'gemergt');
    const vorher = new Set<string>();
    for (const e of z.ereignisse.slice(0, start3)) {
      if (e.art === 'start') vorher.add(e.paket!);
      if (e.art === 'gemergt') vorher.delete(e.paket!);
    }
    expect(vorher.size).toBe(0);
    expect(z.ereignisse.slice(start3 + 1, ende3).some((e) => e.art === 'start')).toBe(false);
    expect(Object.values(z.pakete).every((p) => p.stufe === 'fertig')).toBe(true);
  }, T);

  it('P5: a Muss finding that is not structural: a new round in the same class; Sollte alone starts none', async () => {
    const muss = { befunde: [{ gruppe: 'muss', fundstelle: 'src/p30.ts:3', text: 'Abnahmepunkt 1 fehlt' }], strukturell: false };
    const sollte = { befunde: [{ gruppe: 'sollte', fundstelle: 'src/p31.ts:1', text: 'Name' }], strukturell: false };
    const { z, w } = await fahre(buch([paket('30'), paket('31')], { aufrufe: { 'reviewer:30': [{ ausgabe: muss }, {}], 'reviewer:31': [{ ausgabe: sollte }] } }));
    const impl = aufrufeVon(w, 'implementer', '30');
    expect(impl.map((a) => a.agent)).toEqual(['epic-implementer-standard', 'epic-implementer-standard']);
    expect(impl[1].resume).toBeNull();
    expect(impl[1].auftrag).toMatch(/Befund der letzten Runde:\n- src\/p30\.ts:3: Abnahmepunkt 1 fehlt/);
    expect(aufrufeVon(w, 'reviewer', '30').map((a) => a.agent)).toEqual(['epic-reviewer-standard', 'epic-reviewer-standard']);
    expect(z.pakete['30']).toMatchObject({ stufe: 'fertig', runde: 2, klasse: 'standard', eskalationen: [] });
    expect(aufrufeVon(w, 'implementer', '31')).toHaveLength(1);
    expect(z.pakete['31'].stufe).toBe('fertig');
  }, T);

  it('P6: a structural finding: the next round one rung higher, the reviewer follows; escalation in the state and at the ticket', async () => {
    const strukturell = { befunde: [{ gruppe: 'muss', fundstelle: 'src/p40.ts', text: 'falscher Schnitt der Schnittstelle' }], strukturell: true };
    const { z, w } = await fahre(buch([paket('40'), paket('41', { klasse: 'urteil' })], { aufrufe: { 'reviewer:40': [{ ausgabe: strukturell }, {}], 'reviewer:41': [{ ausgabe: strukturell }, {}] } }));
    expect(aufrufeVon(w, 'implementer', '40').map((a) => [a.agent, a.modell, a.effort])).toEqual([
      ['epic-implementer-standard', 'sonnet', 'medium'],
      ['epic-implementer-urteil', 'opus', 'medium'],
    ]);
    expect(aufrufeVon(w, 'reviewer', '40').map((a) => a.agent)).toEqual(['epic-reviewer-standard', 'epic-reviewer-urteil']);
    expect(z.pakete['40'].eskalationen).toEqual([{ runde: 2, von: 'standard', nach: 'urteil', grund: 'src/p40.ts: falscher Schnitt der Schnittstelle' }]);
    expect(z.ereignisse.some((e) => e.paket === '40' && e.art === 'eskalation')).toBe(true);
    expect(w.kommentare[40].some((k) => /\*\*Eskalation\*\* Paket 40, Runde 2: standard → urteil/.test(k))).toBe(true);
    // the last rung: Opus high only after an escalation out of Urteil
    expect(aufrufeVon(w, 'implementer', '41').map((a) => [a.agent, a.effort])).toEqual([
      ['epic-implementer-urteil', 'medium'],
      ['epic-implementer-urteil-hoch', 'high'],
    ]);
    expect(z.pakete['41'].klasse).toBe('urteil-hoch');
    expect(letzterBlock(w)?.art === 'ende' && (letzterBlock(w) as { offen: string }).offen).toMatch(/Eskalation Paket 40, Runde 2: standard → urteil/);
  }, T);

  it('P7: max_rounds reached: left behind, status/haengt, successors status/blockiert, the run goes on', async () => {
    const muss = { befunde: [{ gruppe: 'muss', fundstelle: 'x', text: 'nie gut' }], strukturell: false };
    const { z, w } = await fahre(buch([paket('50'), paket('51', { nach: ['50'] }), paket('52', { nach: ['51'] }), paket('53')], { aufrufe: { 'reviewer:50': [{ ausgabe: muss }] } }));
    expect(aufrufeVon(w, 'implementer', '50')).toHaveLength(3);
    expect(z.pakete['50']).toMatchObject({ stufe: 'zurueckgelassen', runde: 3 });
    expect(z.pakete['50'].grund).toMatch(/max_rounds \(3\) erreicht/);
    expect(w.status[50]).toBe('status/haengt');
    expect(w.kommentare[50].some((k) => /\*\*Zurückgelassen\*\* Paket 50/.test(k) && /agent\/50-paket-50 bleibt stehen/.test(k))).toBe(true);
    expect(getan(w, /^down 50$/)).toHaveLength(1);
    expect(getan(w, /branch -d agent\/50/)).toHaveLength(0);
    for (const n of ['51', '52']) {
      expect(z.pakete[n]).toMatchObject({ stufe: 'blockiert', blockiertDurch: '50' });
      expect(w.status[Number(n)]).toBe('status/blockiert');
      expect(w.kommentare[Number(n)].some((k) => /hängt an Paket 50/.test(k))).toBe(true);
      expect(getan(w, new RegExp(`^up ${n} `))).toHaveLength(0);
    }
    expect(z.pakete['53'].stufe).toBe('fertig');
    expect(z.phase).toBe('fertig');
    expect((letzterBlock(w) as { offen: string }).offen).toMatch(/Paket 50 zurückgelassen[\s\S]*Paket 51 blockiert durch 50/);
  }, T);

  it('P8: an implementer without a valid output: one --resume with the error, then the round is used up', async () => {
    const { z, w } = await fahre(buch([paket('60')], { aufrufe: { 'implementer:60': [{ ohneAusgabe: true }, { ausgabe: { version: 2 } }, {}] } }));
    const impl = aufrufeVon(w, 'implementer', '60');
    expect(impl.map((a) => [a.resume, a.runde])).toEqual([
      [null, 1],
      ['s-implementer:60-0', 1],
      [null, 2],
    ]);
    expect(impl[1].auftrag).toMatch(/passt nicht zum Schema: keine strukturierte Ausgabe/);
    expect(impl[2].auftrag).toMatch(/Übernimm den Stand im Worktree/);
    expect(z.pakete['60']).toMatchObject({ stufe: 'fertig', runde: 2 });
  }, T);

  it('P9: an implementer with exit ≠ 0 or without result: one --resume, then a new call with the worktree state', async () => {
    const { z, w } = await fahre(buch([paket('61'), paket('62')], { aufrufe: { 'implementer:61': [{ exit: 1 }, { ohneErgebnis: true }, {}], 'implementer:62': [{ ohneErgebnis: true }, {}] } }));
    const impl = aufrufeVon(w, 'implementer', '61');
    expect(impl.map((a) => a.resume)).toEqual([null, 's-implementer:61-0', null]);
    expect(impl[1].auftrag).toMatch(/endete ohne Ergebnis \(exit \(Exit 1\)/);
    expect(impl[2].auftrag).toMatch(/Übernimm den Stand im Worktree/);
    expect(impl[2].cwd).toBe('/wt/61');
    expect(getan(w, /^up 61 /)).toHaveLength(1);
    expect(z.pakete['61']).toMatchObject({ stufe: 'fertig', runde: 2 });
    // one resume is enough when it brings the report
    expect(aufrufeVon(w, 'implementer', '62').map((a) => a.resume)).toEqual([null, 's-implementer:62-0']);
    expect(z.pakete['62']).toMatchObject({ stufe: 'fertig', runde: 1 });
  }, T);

  it('P10: a red test in the package: the round goes back to the implementer with the finding; no merge', async () => {
    const rotImPaket = [{ name: 'flotte', dateien: 18, tests: 249, rot: [{ datei: 'src/p70.ts', test: 'rechnet' }] }];
    const { z, w } = await fahre(buch([paket('70')], { tests: { '70': [rotImPaket, [{ name: 'flotte', dateien: 18, tests: 249, rot: [] }]] } }));
    const impl = aufrufeVon(w, 'implementer', '70');
    expect(impl).toHaveLength(2);
    expect(impl[1].auftrag).toMatch(/src\/p70\.ts rot \(rechnet\), die Datei gehört zum Paket/);
    expect(getan(w, /^merge --no-ff agent\/70/)).toHaveLength(1);
    const abgenommen = z.ereignisse.filter((e) => e.paket === '70' && e.art === 'abgenommen');
    expect(abgenommen).toHaveLength(1);
    expect(abgenommen[0].takt).toBeGreaterThan(z.ereignisse.filter((e) => e.paket === '70' && e.art === 'aufruf' && e.rolle === 'implementer')[1].takt);
    expect(z.pakete['70']).toMatchObject({ stufe: 'fertig', runde: 2 });
  }, T);

  it('P11: red only in an untouched file that is green alone: Lastflake noted, the package goes on', async () => {
    const fremd = [{ name: 'flotte', dateien: 18, tests: 249, rot: [{ datei: 'test/fremd.test.ts', test: 'zeitkritisch' }] }];
    const { z, w } = await fahre(buch([paket('71'), paket('72')], { tests: { '71': [fremd], '72': [[{ name: 'flotte', dateien: 18, tests: 249, rot: [{ datei: 'test/anders.test.ts', test: 'kaputt' }] }], [{ name: 'flotte', dateien: 18, tests: 249, rot: [] }]] }, einzeln: { 'test/fremd.test.ts': true, 'test/anders.test.ts': false } }));
    expect(getan(w, /^einzeln 71 test\/fremd\.test\.ts$/)).toHaveLength(1);
    expect(z.pakete['71']).toMatchObject({ stufe: 'fertig', runde: 1 });
    expect(z.pakete['71'].lastflakes[0]).toMatch(/test\/fremd\.test\.ts \(zeitkritisch\) rot im Volllauf, einzeln grün/);
    expect(z.ereignisse.some((e) => e.paket === '71' && e.art === 'lastflake')).toBe(true);
    expect(aufrufeVon(w, 'implementer', '71')).toHaveLength(1);
    // red also alone is a finding
    expect(z.pakete['72'].runde).toBe(2);
    expect(aufrufeVon(w, 'implementer', '72')[1].auftrag).toMatch(/test\/anders\.test\.ts rot \(kaputt\), auch einzeln/);
  }, T);

  it('P12: the suite or test count went down, all green: a finding, no merge', async () => {
    const weniger = [{ name: 'flotte', dateien: 17, tests: 240, rot: [] }];
    const { z, w } = await fahre(buch([paket('73')], { tests: { '73': [weniger, [{ name: 'flotte', dateien: 18, tests: 251, rot: [] }]] } }));
    const impl = aufrufeVon(w, 'implementer', '73');
    expect(impl).toHaveLength(2);
    expect(impl[1].auftrag).toMatch(/Suite flotte: 240 Tests in 17 Dateien, Ausgangszahl 249 in 18/);
    expect(getan(w, /^merge --no-ff agent\/73/)).toHaveLength(1);
    expect(z.pakete['73']).toMatchObject({ stufe: 'fertig', runde: 2 });
  }, T);

  it('P13: the epic branch is red after the merge: revert -m 1, package left behind, successors blocked', async () => {
    const { z, w } = await fahre(buch([paket('80'), paket('81'), paket('82', { nach: ['80'] })], { epicRot: ['80'], aufrufe: { 'implementer:80': [{ takte: 3 }] } }));
    // 81 merged first, so the tree after merging 80 is not the one 4c checked: the epic branch is tested
    expect(getan(w, /^merge --no-ff agent\/81/)[0].takt).toBeLessThan(getan(w, /^merge --no-ff agent\/80/)[0].takt);
    expect(getan(w, /^revert -m 1 m2$/)).toHaveLength(1);
    expect(z.pakete['80']).toMatchObject({ stufe: 'zurueckgelassen', mergeCommit: 'm2', revertCommit: 'r-m2' });
    expect(w.status[80]).toBe('status/haengt');
    expect(w.kommentare[80].some((k) => /Revert-Commit r-m2; zurückholen = Revert des Reverts/.test(k))).toBe(true);
    expect(getan(w, /branch -d agent\/80/)).toHaveLength(0);
    expect(z.pakete['82']).toMatchObject({ stufe: 'blockiert', blockiertDurch: '80' });
    expect(w.status[82]).toBe('status/blockiert');
    expect(z.pakete['81'].stufe).toBe('fertig');
  }, T);

  it('P13b: the same tree as checked in 4c: no run on the epic branch after the merge', async () => {
    const { z, w } = await fahre(buch([paket('83')], { epicRot: ['83'] }));
    expect(getan(w, /^volllauf \/wt\/epic-69$/)).toHaveLength(1);
    expect(z.pakete['83'].stufe).toBe('fertig');
  }, T);

  it('P14: a mechanical merge conflict: conflict call, merge, tests on the epic branch, edge added', async () => {
    const { z, w } = await fahre(buch([paket('90'), paket('91')], { konflikt: { '90': ['src/gemeinsam.ts'] }, aufrufe: { 'implementer:90': [{ takte: 3 }] } }));
    const k = w.aufrufe.filter((a) => a.rolle === 'konflikt');
    expect(k).toHaveLength(1);
    expect(k[0]).toMatchObject({ paket: '90', cwd: '/wt/epic-69', resume: null });
    expect(k[0].auftrag).toMatch(/src\/gemeinsam\.ts/);
    expect(getan(w, /^merge abgeschlossen agent\/90/)).toHaveLength(1);
    const abgeschlossen = w.protokoll.findIndex((p) => /^merge abgeschlossen/.test(p.was));
    expect(w.protokoll.findIndex((p, i) => i > abgeschlossen && p.was === 'volllauf /wt/epic-69')).toBeGreaterThan(abgeschlossen);
    expect(z.kanten).toEqual([{ a: '91', b: '90', art: 'kollision', grund: 'Merge-Konflikt in src/gemeinsam.ts' }]);
    expect(z.pakete['90']).toMatchObject({ stufe: 'fertig', konflikt: { dateien: ['src/gemeinsam.ts'], ergebnis: 'geloest' } });
    expect((letzterBlock(w) as { offen: string }).offen).toMatch(/Kante nachgetragen: 91 – 90/);
  }, T);

  it('P15: a merge conflict about content: package not accepted, branch stays, edge added', async () => {
    const { z, w } = await fahre(buch([paket('92'), paket('93')], { konflikt: { '92': ['src/logik.ts'] }, aufrufe: { 'implementer:92': [{ takte: 3 }], 'konflikt:92': [{ ausgabe: { ergebnis: 'inhaltlich', begruendung: 'beide ändern die Regel' } }] } }));
    expect(getan(w, /^merge --abort agent\/92/)).toHaveLength(1);
    expect(z.pakete['92']).toMatchObject({ stufe: 'zurueckgelassen' });
    expect(z.pakete['92'].grund).toMatch(/Merge-Konflikt, inhaltlich: beide ändern die Regel/);
    expect(getan(w, /branch -d agent\/92/)).toHaveLength(0);
    expect(w.gemergt).toEqual(['agent/93-paket-93']);
    expect(z.kanten).toEqual([{ a: '93', b: '92', art: 'kollision', grund: 'Merge-Konflikt in src/logik.ts' }]);
    expect(w.status[92]).toBe('status/haengt');
  }, T);

  it('P16: the program ends in the middle of the implementer: a restart continues by --resume, nothing starts twice', async () => {
    const repo = neuesRepo();
    const welt = neueWelt();
    const pakete = [paket('100'), paket('101')];
    await expect(fahre(buch(pakete, { aufrufe: { 'implementer:100': [{ takte: 2, abbruch: true }] } }), { repo, welt })).rejects.toThrow(/Programm beendet/);
    const mitten = liesLauf(epicDir(repo, 69), 69);
    expect(mitten.pakete['100']).toMatchObject({ stufe: 'implementer', sitzung: 's-implementer:100-0' });
    const { z, w } = await fahre(buch(pakete), { repo, welt });
    const impl = aufrufeVon(w, 'implementer', '100');
    expect(impl.map((a) => a.resume)).toEqual([null, 's-implementer:100-0']);
    expect(impl[1].auftrag).toMatch(/Setze deine Arbeit an der Stelle fort/);
    for (const n of ['100', '101']) expect(getan(w, new RegExp(`^up ${n} `))).toHaveLength(1);
    expect(w.aufrufe.filter((a) => a.rolle === 'schnitt')).toHaveLength(1);
    expect(getan(w, /^merge --no-ff/)).toHaveLength(2);
    expect(Object.values(z.pakete).every((p) => p.stufe === 'fertig')).toBe(true);
  }, T);

  it('P16b: the program ends during the conflict call: the restart resumes it by --resume and does not merge again', async () => {
    const repo = neuesRepo();
    const welt = neueWelt();
    const pakete = [paket('102'), paket('103')];
    const konflikt = { '102': ['src/gemeinsam.ts'] };
    await expect(fahre(buch(pakete, { konflikt, aufrufe: { 'implementer:102': [{ takte: 3 }], 'konflikt:102': [{ abbruch: true }] } }), { repo, welt })).rejects.toThrow(/Programm beendet während konflikt:102/);
    expect(liesLauf(epicDir(repo, 69), 69).pakete['102']).toMatchObject({ stufe: 'merge', mergeCommit: null, sitzung: 's-konflikt:102-0', konflikt: { dateien: ['src/gemeinsam.ts'], ergebnis: null } });
    expect(welt.offenerMerge).toBe('agent/102-paket-102');
    const { z, w } = await fahre(buch(pakete, { konflikt }), { repo, welt });
    expect(w.aufrufe.filter((a) => a.rolle === 'konflikt').map((a) => a.resume)).toEqual([null, 's-konflikt:102-0']);
    expect(getan(w, /^merge --no-ff agent\/102/)).toHaveLength(1);
    expect(getan(w, /^merge abgeschlossen agent\/102/)).toHaveLength(1);
    expect(z.pakete['102']).toMatchObject({ stufe: 'fertig', mergeCommit: 'm2' });
  }, T);

  it('P17: the program ends between merge and Down: the restart sees the merge, does not merge again, cleans up, takes the place', async () => {
    const repo = neuesRepo();
    const welt = neueWelt();
    const pakete = [paket('110'), paket('111', { nach: ['110'] })];
    await expect(fahre(buch(pakete, { abbruchBeiDown: '110' }), { repo, welt })).rejects.toThrow(/vor Down 110/);
    expect(liesLauf(epicDir(repo, 69), 69).pakete['110']).toMatchObject({ stufe: 'merge', mergeCommit: 'm1', epicGeprueft: true });
    expect(welt.gemergt).toEqual(['agent/110-paket-110']);
    const { z, w } = await fahre(buch(pakete), { repo, welt });
    expect(getan(w, /^merge --no-ff agent\/110/)).toHaveLength(1);
    expect(getan(w, /^down 110$/)).toHaveLength(1);
    expect(getan(w, /^branch -d agent\/110/)).toHaveLength(1);
    expect(z.pakete['110'].stufe).toBe('fertig');
    expect(takt(z, '111', 'start')).toBe(takt(z, '110', 'gemergt'));
    expect(z.pakete['111'].stufe).toBe('fertig');
  }, T);

  it('P17b: the program ends after the merge, before the state is written: the restart takes the real merge commit and reverts it when red', async () => {
    const repo = neuesRepo();
    const welt = neueWelt();
    const b = (o: Partial<EpicDrehbuch>) => buch([paket('112'), paket('113')], { epicRot: ['112'], aufrufe: { 'implementer:112': [{ takte: 3 }] }, ...o });
    await expect(fahre(b({ abbruchNachMerge: '112' }), { repo, welt })).rejects.toThrow(/nach dem Merge von agent\/112/);
    expect(liesLauf(epicDir(repo, 69), 69).pakete['112']).toMatchObject({ stufe: 'merge', mergeCommit: null });
    expect(welt.gemergt).toEqual(['agent/113-paket-113', 'agent/112-paket-112']);
    const { z, w } = await fahre(b({}), { repo, welt });
    expect(getan(w, /^merge --no-ff agent\/112/)).toHaveLength(1);
    expect(getan(w, /^revert -m 1 m2$/)).toHaveLength(1);
    expect(z.pakete['112']).toMatchObject({ stufe: 'zurueckgelassen', mergeCommit: 'm2', revertCommit: 'r-m2' });
  }, T);

  it('P18: a question with Betrifft: <Paket>: only this package waits; the others run and start on', async () => {
    const tor: TorPunkt[] = [{ frage: 'Welche Lesart gilt für 121?', betrifft: ['121'], lage: 'zwei Lesarten', optionen: [{ text: 'die enge' }, { text: 'die weite' }], empfehlung: 'A', grund: 'kleiner', quelle: 'Skill' }];
    const { z, w } = await fahre(buch([paket('120'), paket('121'), paket('122'), paket('123', { nach: ['120'] })], { antworten: [{ frage: 1, antwort: 'A', nachTakten: 14 }] }, tor));
    const frage = leseBlock(w.bloecke[0]);
    expect(frage).toMatchObject({ art: 'frage', epic: 69, phase: 'tor' });
    expect(frage?.art === 'frage' && frage.fragen[0]).toMatchObject({ nr: 1, betrifft: ['121'], empfehlung: 'A' });
    const antwort = z.ereignisse.find((e) => e.art === 'antwort')!.takt;
    expect(takt(z, '120', 'start')).toBeLessThan(antwort);
    expect(takt(z, '122', 'start')).toBeLessThan(antwort);
    expect(takt(z, '120', 'gemergt')).toBeLessThan(antwort);
    expect(takt(z, '123', 'start')).toBeLessThan(antwort);
    expect(takt(z, '121', 'start')).toBeGreaterThanOrEqual(antwort);
    expect(aufrufeVon(w, 'implementer', '121')[0].auftrag).toMatch(/Am Vorab-Tor entschieden: Welche Lesart gilt für 121\? → A/);
    expect(Object.values(z.pakete).every((p) => p.stufe === 'fertig')).toBe(true);
  }, T);

  it('P19: RAM hold while a place is taken: no start; the running package goes on; starts again at ok', async () => {
    const { z, w } = await fahre(buch([paket('130'), paket('131'), paket('132', { nach: ['131'] })], { ram: ['ok', 'hold', 'hold', 'hold', 'hold', 'hold', 'hold', 'ok'], aufrufe: { 'implementer:130': [{ takte: 6 }] } }));
    const hold = z.ereignisse.findIndex((e) => e.art === 'ram' && /^hold/.test(e.text));
    const ok = z.ereignisse.findIndex((e) => e.art === 'ram' && /^ok/.test(e.text));
    expect(hold).toBeGreaterThan(0);
    expect(ok).toBeGreaterThan(hold);
    expect(z.ereignisse.slice(hold, ok).some((e) => e.art === 'start')).toBe(false);
    // the running package went on during hold
    expect(z.ereignisse.slice(hold, ok).some((e) => e.paket === '130' && (e.art === 'zurueck' || e.art === 'aufruf'))).toBe(true);
    expect(z.ereignisse.findIndex((e) => e.paket === '132' && e.art === 'start')).toBeGreaterThan(ok);
    const ram = leseBlock(w.bloecke.find((b) => / ram\n/.test(b))!);
    expect(ram?.art === 'frage' && ram.fragen[0]).toMatchObject({ betrifft: ['132'], empfehlung: 'A' });
    expect(getan(w, /^ram hold$/).length).toBe(6);
    expect(Object.values(z.pakete).every((p) => p.stufe === 'fertig')).toBe(true);
  }, T);

  it('P19b: RAM hold and a release of the person: the next start goes, one only', async () => {
    const { z } = await fahre(buch([paket('133'), paket('134', { nach: ['133'] }), paket('135', { nach: ['133'] })], { ram: ['ok', 'hold'], antworten: [{ frage: 1, antwort: 'B', nachTakten: 2 }, { frage: 2, antwort: 'B', nachTakten: 2 }] }));
    const freigaben = z.ereignisse.filter((e) => e.art === 'antwort');
    expect(freigaben).toHaveLength(2);
    expect(takt(z, '134', 'start')).toBe(freigaben[0].takt);
    expect(takt(z, '135', 'start')).toBe(freigaben[1].takt);
    expect(z.fragen.filter((f) => f.art === 'ram')).toHaveLength(2);
    expect(Object.values(z.pakete).every((p) => p.stufe === 'fertig')).toBe(true);
  }, T);

  it('P19c: the answer "wait" asks no second time during the same hold; warn starts and is noted', async () => {
    const { z, w } = await fahre(buch([paket('136'), paket('137', { nach: ['136'] })], { ram: ['ok', 'hold', 'hold', 'hold', 'hold', 'warn'], antworten: [{ frage: 1, antwort: 'A', nachTakten: 1 }] }));
    expect(w.bloecke.filter((b) => / ram\n/.test(b))).toHaveLength(1);
    expect(z.fragen.filter((f) => f.art === 'ram').map((f) => f.antwort)).toEqual(['A']);
    const warn = z.ereignisse.find((e) => e.art === 'ram' && /^warn bei 78 %, Start: 137$/.test(e.text));
    expect(warn?.takt).toBe(takt(z, '137', 'start'));
    expect(z.pakete['137'].stufe).toBe('fertig');
  }, T);

  it('P19d: the slot is busy (a full stack of the project runs): no start, the running package goes on; starts once it is free', async () => {
    const pakete = [paket('138'), paket('139'), paket('140', { nach: ['139'] })];
    const lang = { 'implementer:138': [{ takte: 6 }] };
    const { z, w } = await fahre(buch(pakete, { slot: [false, true, true, true, true, true, false], aufrufe: lang }));
    const belegt = z.ereignisse.findIndex((e) => e.art === 'slot' && /^belegt/.test(e.text));
    const frei = z.ereignisse.findIndex((e) => e.art === 'slot' && /^frei/.test(e.text));
    expect(belegt).toBeGreaterThan(0);
    expect(frei).toBeGreaterThan(belegt);
    expect(z.ereignisse.slice(belegt, frei).some((e) => e.art === 'start')).toBe(false);
    expect(z.ereignisse.slice(belegt, frei).some((e) => e.paket === '138' && (e.art === 'zurueck' || e.art === 'aufruf'))).toBe(true);
    expect(z.ereignisse.findIndex((e) => e.paket === '140' && e.art === 'start')).toBeGreaterThan(frei);
    expect(getan(w, /^slot belegt$/)).toHaveLength(5);
    expect(getan(w, /^ram hold$/)).toHaveLength(0);
    expect(Object.values(z.pakete).every((p) => p.stufe === 'fertig')).toBe(true);
    // counter-check: a free slot lets 140 start in the takt 139 is merged
    const gegen = await fahre(buch(pakete, { aufrufe: lang }));
    expect(gegen.z.ereignisse.some((e) => e.art === 'slot')).toBe(false);
    expect(takt(gegen.z, '140', 'start')).toBe(takt(gegen.z, '139', 'gemergt'));
  }, T);

  it('P20: permission_denials block the package without a second try', async () => {
    const { z, w } = await fahre(buch([paket('140'), paket('141', { nach: ['140'] }), paket('142')], { aufrufe: { 'implementer:140': [{ verweigert: [{ tool_name: 'Bash', tool_input: { command: 'git push' } }] }] } }));
    expect(aufrufeVon(w, 'implementer', '140')).toHaveLength(1);
    expect(z.pakete['140'].stufe).toBe('zurueckgelassen');
    expect(z.pakete['140'].grund).toMatch(/permission_denials/);
    expect(w.status[140]).toBe('status/haengt');
    expect(z.pakete['141']).toMatchObject({ stufe: 'blockiert', blockiertDurch: '140' });
    expect(z.pakete['142'].stufe).toBe('fertig');
  }, T);

  it('P20b: an account limit in the result: the package waits, no call starts meanwhile, then the same session goes on', async () => {
    const { z, w } = await fahre(buch([paket('143'), paket('144')], { aufrufe: { 'implementer:143': [{ kontolimit: true }, {}] }, kontoFreiNach: 3 }));
    const impl = aufrufeVon(w, 'implementer', '143');
    expect(impl.map((a) => [a.resume, a.agent, a.runde])).toEqual([
      [null, 'epic-implementer-standard', 1],
      ['s-implementer:143-0', 'epic-implementer-standard', 1],
    ]);
    expect(impl[1].auftrag).toMatch(/Kontolimit ist vorbei/);
    const wartet = z.ereignisse.findIndex((e) => e.art === 'konto' && /^wartet/.test(e.text));
    const frei = z.ereignisse.findIndex((e) => e.art === 'konto' && /frei/.test(e.text));
    expect(frei).toBeGreaterThan(wartet + 0);
    expect(z.ereignisse.slice(wartet, frei).some((e) => e.art === 'aufruf')).toBe(false);
    expect(z.ereignisse[frei].takt).toBeGreaterThan(z.ereignisse[wartet].takt);
    expect(Object.values(z.pakete).every((p) => p.stufe === 'fertig' && p.runde === 1)).toBe(true);
  }, T);

  it('P20c: an account limit in the conflict call: the package waits, then the same session goes on; no "inhaltlich"', async () => {
    const { z, w } = await fahre(buch([paket('145'), paket('146')], { konflikt: { '145': ['src/gemeinsam.ts'] }, aufrufe: { 'implementer:145': [{ takte: 3 }], 'konflikt:145': [{ kontolimit: true }, {}] }, kontoFreiNach: 2 }));
    expect(w.aufrufe.filter((a) => a.rolle === 'konflikt').map((a) => a.resume)).toEqual([null, 's-konflikt:145-0']);
    expect(z.ereignisse.some((e) => e.paket === '145' && e.art === 'konto' && /^wartet: Kontolimit/.test(e.text))).toBe(true);
    expect(getan(w, /^merge --abort/)).toHaveLength(0);
    expect(z.pakete['145']).toMatchObject({ stufe: 'fertig', konflikt: { ergebnis: 'geloest' } });
    expect(w.status[145]).toBe('status/in-arbeit');
  }, T);

  it('P21: a second program for the same epic is refused; a lock of a dead process is taken over', async () => {
    const repo = neuesRepo();
    expect(sperren(epicDir(repo, 69), 4242).ok).toBe(true);
    const u = attrappe(buch([paket('150')]));
    await expect(fahreEpic(einstellung(repo, { istLebendig: (pid) => pid === 4242 }), u)).rejects.toThrow(/läuft schon \(PID 4242/);
    expect(u.welt.protokoll).toHaveLength(0);
    expect(u.welt.aufrufe).toHaveLength(0);
    const { z } = await fahre(buch([paket('150')]), { repo, istLebendig: () => false });
    expect(z.phase).toBe('fertig');
    expect(existsSync(join(epicDir(repo, 69), 'treiber.lock'))).toBe(false);
  }, T);

  it('P22: the gate rejected: nothing started, the epic worktree cleaned up, FLOTTE-ENDE with the reason', async () => {
    const tor: TorPunkt[] = [{ frage: 'Darf das Epic Produktivdaten umschreiben?', betrifft: 'Lauf', lage: 'Paket 161 schreibt Stammdaten um', optionen: [{ text: 'ja, mit Sicherung' }, { text: 'nein, Lauf beenden', abbruch: true }], empfehlung: 'B', grund: 'Regel 4', quelle: 'epic/SKILL.md, Regel 4' }];
    const { z, w } = await fahre(buch([paket('160'), paket('161')], { antworten: [{ frage: 1, antwort: 'B' }] }, tor));
    expect(leseBlock(w.bloecke[0])).toMatchObject({ art: 'frage', phase: 'tor', fragen: [{ betrifft: 'Lauf' }] });
    expect(w.aufrufe.filter((a) => a.rolle !== 'schnitt')).toHaveLength(0);
    expect(getan(w, /^up /).map((p) => p.was)).toEqual(['up epic-69 epic/69-programm von origin/main []']);
    expect(getan(w, /^down epic-69$/)).toHaveLength(1);
    const ende = letzterBlock(w);
    expect(ende).toMatchObject({ art: 'ende', epic: 69, pr: null });
    expect(w.bloecke[w.bloecke.length - 1]).toMatch(/Vorab-Tor abgelehnt: Darf das Epic Produktivdaten umschreiben\? → B/);
    expect(z.phase).toBe('abgebrochen');
    expect(Object.values(z.pakete).every((p) => p.stufe === 'wartend')).toBe(true);
  }, T);

  it('P22b: the gate answered without rejection: the run starts', async () => {
    const tor: TorPunkt[] = [{ frage: 'Weiter?', betrifft: 'Lauf', lage: 'x', optionen: [{ text: 'ja' }, { text: 'nein', abbruch: true }], empfehlung: 'A', grund: 'g', quelle: 'q' }];
    const { z } = await fahre(buch([paket('162')], { antworten: [{ frage: 1, antwort: 'A' }] }, tor));
    expect(z.phase).toBe('fertig');
    expect(z.pakete['162'].stufe).toBe('fertig');
  }, T);

  it('a cut with a cycle over hard edges is invalid: one --resume with the error, then FLOTTE-ENDE instead of waiting forever', async () => {
    const { z, w } = await fahre(buch([paket('190', { nach: ['191'] }), paket('191', { nach: ['190'] })]));
    expect(w.aufrufe.map((a) => [a.rolle, a.resume])).toEqual([
      ['schnitt', null],
      ['schnitt', 's-schnitt-0'],
    ]);
    expect(w.aufrufe[1].auftrag).toMatch(/Zyklus über harte Kanten: 190 → 191 → 190/);
    expect(z.phase).toBe('abgebrochen');
    expect(letzterBlock(w)).toMatchObject({ art: 'ende', pr: null });
    expect(getan(w, /^down epic-69$/)).toHaveLength(1);
  }, T);

  it('state: zustand.json under <git common dir>/flotte/epics/<nr>, written after the run, with times for stage 4', async () => {
    const { z, repo } = await fahre(buch([paket('170')]));
    const datei = join(repo, '.git', 'flotte', 'epics', '69', 'zustand.json');
    expect(existsSync(datei)).toBe(true);
    const gelesen = JSON.parse(readFileSync(datei, 'utf8')) as EpicLaufZustand;
    expect(gelesen).toEqual(z);
    expect(gelesen.pakete['170'].zeiten).toMatchObject({ start: expect.any(String), implementerZurueck: expect.any(String), reviewerZurueck: expect.any(String), abgenommen: expect.any(String), gemergt: expect.any(String) });
    expect(gelesen.ereignisse.filter((e) => e.art === 'gemergt' || e.art === 'start').map((e) => [e.art, e.paket])).toEqual([
      ['start', '170'],
      ['gemergt', '170'],
    ]);
    // a finished run started again does nothing
    const u = attrappe(buch([paket('170')]));
    await fahreEpic(einstellung(repo), u);
    expect(u.welt.protokoll).toHaveLength(0);
  }, T);

  it('flotte epic <nr> <repo> --drehbuch plays a script; without one it refuses', async () => {
    const repo = neuesRepo();
    const datei = join(mkdtempSync(join(tmpdir(), 'flotte-epic-buch-')), 'drehbuch.json');
    writeFileSync(datei, JSON.stringify(buch([paket('180')])));
    const r = (await epic(['69', repo, '--drehbuch', datei, '--branch', 'epic/69-x'])) as { zustand: EpicLaufZustand; bloecke: string[] };
    expect(r.zustand.pakete['180'].stufe).toBe('fertig');
    expect(leseBlock(r.bloecke[r.bloecke.length - 1])).toMatchObject({ art: 'ende', epic: 69, pr: 100 });
    await expect(epic(['69', repo])).rejects.toThrow(/nur mit --drehbuch/);
  }, T);
});
