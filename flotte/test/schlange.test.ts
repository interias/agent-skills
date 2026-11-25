// Round 5 of #14: the merge queue (A), the areas of the gate (B), silence with a living child (C1),
// adapters without the key merge (C3), the last step of a run (C4). The queue tests run against a
// real git repository with a bare origin and real epic worktrees; merge.ps1 and the gate are stand-ins
// that read the real branches.

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { aufrufen } from '../src/aufruf.ts';
import { adapter, schluessel } from '../src/befehle/adapter.ts';
import { zuschauen } from '../src/befehle/zuschauen.ts';
import { ANDOCK_FRAGE, ANDOCK_VERSUCHE, andockEmpfehlung, andockFehler, andockWahl, antworten, fahre, type Welt } from '../src/treiber/treiber.ts';
import { blockAus, blockEinsetzen, gateForm, gateLaeufe, gemeinsameBereiche, globRegex, bereicheAus, letzterVollLauf } from '../src/treiber/gate.ts';
import { belege, bildAus, liesAdapter } from '../src/werkzeuge/belegung.ts';
import { beobachte, schrittAus } from '../src/werkzeuge/lauf.ts';
import { flotteDir } from '../src/werkzeuge/zustand.ts';
import { aufbau, drehbuch, ende, lauf, type Optionen, gateAufruf } from './flotte-welt.ts';

// upper bounds against a hang only (#141): the order comes from signals, not from the wall clock
const T = 180_000;
const GRENZE = 120_000;
const ADAPTER = 'merge: nach_gate\ngate_command: gate voll\ngate_always_command: gate teil\ngate_areas:\n  - a/ = A\n  - b/ = B';
const form = gateForm(liesAdapter(`---\n${ADAPTER}\n---\n`));

const git = (cwd: string, ...a: string[]) => {
  const r = aufrufen('git', ['-C', cwd, ...a]);
  if (r.code) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

interface EpicGit {
  nr: number;
  pr: number;
  branch: string;
  wt: string;
}

/**
 * A repository with origin, main (a/x.txt, b/y.txt) and per epic a branch in its own worktree with
 * one commit and a PR body that holds a full green gate run on that state.
 */
function gitWelt(epics: { nr: number; datei: string; inhalt?: string }[], o: Omit<Optionen, 'adapter'> & { rot?: (cwd: string, n: number) => boolean; rotText?: string; mergeImmerAbgelehnt?: number; stoerung?: (pr: number, n: number) => string | null } = {}) {
  const bodies = new Map<number, string>();
  const liste: EpicGit[] = [];
  const t = aufbau({
    ...o,
    adapter: ADAPTER,
    prInfo: (pr) => {
      // #141: the driver reads the PR at the head of the queue; a run of the script may wait for that (step signal)
      writeFileSync(`${process.env.FLOTTE_DREHBUCH}.signal-kopf-${pr}`, '');
      const e = liste.find((x) => x.pr === pr)!;
      git(t.repo, 'fetch', '-q', 'origin');
      const edit = [...t.p.prEdits].reverse().find((x) => x.pr === pr);
      return { headRefName: e.branch, baseRefName: 'main', headRefOid: git(t.repo, 'rev-parse', `origin/${e.branch}`), body: edit?.body ?? bodies.get(pr)! };
    },
    gate: (befehl, cwd, n) => {
      const kopf = git(cwd, 'rev-parse', 'HEAD');
      const basis = git(cwd, 'rev-parse', 'origin/main');
      const gruen = !o.rot?.(cwd, n);
      return { code: gruen ? 0 : 1, stdout: `${gruen ? 'vorher' : (o.rotText ?? 'vorher')}\n== Gate: ${befehl === 'gate teil' ? 'Immer-Teil, ' : ''}Basis origin/main @ ${basis.slice(0, 7)} (HEAD ${kopf.slice(0, 8)})\n  wurzel ${gruen ? 'grün' : 'ROT'}\n${gruen ? 'Gate grün.' : 'Gate ROT.'}\n` };
    },
    // merge.ps1: the last run must name the current base and head (merge.Tests.ps1 checks the areas)
    mergeEcht: (pr, n) => {
      // #229: a refusal of the forge as merge.ps1 prints it, before any check of the stand-in
      const s = o.stoerung?.(pr, n);
      if (s) return s;
      const e = liste.find((x) => x.pr === pr)!;
      git(t.repo, 'fetch', '-q', 'origin');
      const basis = git(t.repo, 'rev-parse', 'origin/main');
      const kopf = git(t.repo, 'rev-parse', `origin/${e.branch}`);
      const body = [...t.p.prEdits].reverse().find((x) => x.pr === pr)?.body ?? bodies.get(pr)!;
      const letzter = gateLaeufe(body, form)?.at(-1);
      if (o.mergeImmerAbgelehnt === pr || !letzter || !basis.startsWith(letzter.base)) return `GATE FEHLT #${pr}: Gate lief gegen ${letzter?.base ?? '?'}, die Basis steht auf ${basis.slice(0, 7)}`;
      if (!letzter.gruen || !letzter.head || !kopf.startsWith(letzter.head)) return `GATE FEHLT #${pr}: der letzte Gate-Lauf endet nicht mit 'Gate grün.'`;
      git(t.repo, 'merge', '-q', '--ff-only', 'origin/main');
      git(t.repo, 'merge', '-q', '--no-ff', '-m', `Merge #${pr}`, `origin/${e.branch}`);
      git(t.repo, 'push', '-q', 'origin', 'main');
      return `GEMERGT #${pr} -> main`;
    },
  });
  const origin = mkdtempSync(join(tmpdir(), 'flotte-origin-'));
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  git(t.repo, 'checkout', '-q', '-b', 'main');
  git(t.repo, 'config', 'user.email', 'probe@example.invalid');
  git(t.repo, 'config', 'user.name', 'Probe');
  for (const [d, f] of [['a', 'x.txt'], ['b', 'y.txt']]) {
    mkdirSync(join(t.repo, d), { recursive: true });
    writeFileSync(join(t.repo, d, f), `${d}\n`);
  }
  git(t.repo, 'add', '-A');
  git(t.repo, 'commit', '-q', '-m', 'start');
  git(t.repo, 'remote', 'add', 'origin', origin);
  git(t.repo, 'push', '-q', '-u', 'origin', 'main');
  const basis = git(t.repo, 'rev-parse', 'HEAD');
  for (const e of epics) {
    const branch = `epic/${e.nr}-x`;
    const wt = join(mkdtempSync(join(tmpdir(), 'flotte-wt-')), `e${e.nr}`);
    git(t.repo, 'worktree', 'add', '-q', '-b', branch, wt, 'main');
    mkdirSync(join(wt, e.datei, '..'), { recursive: true });
    writeFileSync(join(wt, e.datei), e.inhalt ?? `epic ${e.nr}\n`);
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', `epic ${e.nr}`);
    git(wt, 'push', '-q', 'origin', branch);
    const kopf = git(wt, 'rev-parse', 'HEAD');
    bodies.set(10 + e.nr, `## Pakete\n- eins\n\n## Gate\n\`\`\`\n== Gate: Basis origin/main @ ${basis.slice(0, 7)} (HEAD ${kopf.slice(0, 8)})\n  A grün\nGate grün.\n\`\`\`\n\nCloses #${e.nr}\n`);
    liste.push({ nr: e.nr, pr: 10 + e.nr, branch, wt });
  }
  /** the run ran the gate of its PR body (acceptance 3, finding 2) */
  const nachweis = (nr: number) => gateAufruf(/```\n([\s\S]*?)\n```/.exec(bodies.get(10 + nr)!)![1]);
  return { ...t, epics: liste, origin, nachweis, bodies };
}

const texte = (z: { ereignisse: { epic: number | null; text: string }[] }) => z.ereignisse.map((e) => `${e.epic ? `#${e.epic} ` : ''}${e.text}`);
const index = (liste: string[], muster: RegExp) => liste.findIndex((z) => muster.test(z));

describe('A: die Merge-Schlange', () => {
  it('merges in the order of FLOTTE-ENDE; n epics need n−1 gate runs of the driver, the part that always runs when the areas allow', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }, { nr: 4, datei: 'b/vier.txt' }, { nr: 5, datei: 'a/fuenf.txt' }]);
    // #4 ends while #3 is the head of the queue, #5 while #4 is
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }]), lauf(4, [{ signal: 'kopf-13' }, ...t.nachweis(4), { text: ende(4, 14) }]), lauf(5, [{ signal: 'kopf-14' }, ...t.nachweis(5), { text: ende(5, 15) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4, 5], { maxDauerMs: GRENZE }), t.welt);
    expect(Object.values(z.epics).map((e) => e.stufe)).toEqual(['fertig', 'fertig', 'fertig']);
    expect(z.statistik.gateWiederholungen).toBe(2);
    // #4 (area B) after #3 (area A): only the part that always runs; #5 (A) after #3 (A): the full gate
    expect(t.p.gates.map((g) => [g.befehl, resolve(g.cwd)])).toEqual([
      ['gate teil', t.epics[1].wt],
      ['gate voll', t.epics[2].wt],
    ]);
    const e = texte(z);
    expect(e.filter((x) => /Kopf der Schlange/.test(x)).map((x) => x.slice(0, 2))).toEqual(['#3', '#4', '#5']);
    expect(e.some((x) => /^#4 Andockprüfung des Treibers \(Immer-Teil, Basis bewegte sich nur in fremden Bereichen\)/.test(x))).toBe(true);
    expect(e.some((x) => /^#5 Andockprüfung des Treibers \(voll, Basis bewegte sich in Bereichen der Mission: A\)/.test(x))).toBe(true);
    // the driver pushed its merge of the base and wrote the block below the run's block
    const body4 = t.p.prEdits.find((x) => x.pr === 14)!.body;
    expect(gateLaeufe(body4, form)!.map((l) => [l.teil, l.gruen])).toEqual([[false, true], [true, true]]);
    expect(body4).toMatch(/Gate grün\.\n```\n```\n== Gate: Immer-Teil[\s\S]*Gate grün\.\n```\n\nCloses #4/);
    git(t.repo, 'fetch', '-q', 'origin');
    expect(git(t.repo, 'ls-tree', '-r', '--name-only', 'origin/main').split('\n')).toEqual(expect.arrayContaining(['a/drei.txt', 'b/vier.txt', 'a/fuenf.txt']));
    // the runs never got a merge order back
    expect(z.epics['4'].mergeVersuche ?? 0).toBe(0);
  }, T);

  it('a green block on the PR\'s head and merge-base counts without a gate call in the log; the driver runs no gate (#191)', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }]);
    // the run's gate call is not in its log (another form of the command), the block fits the state
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(t.p.gates).toEqual([]);
    expect(z.statistik.gateWiederholungen ?? 0).toBe(0);
    const e = texte(z);
    const an = index(e, /^#3 Andockblock des Laufs angerechnet \(Basis [0-9a-f]{7} = merge-base, HEAD [0-9a-f]{8} = Head des PR\)$/);
    expect(an).toBeGreaterThanOrEqual(0);
    expect(an).toBeLessThan(index(e, /^#3 merge\.ps1: GEMERGT/));
  }, T);

  it('a block on another head than the PR\'s is not counted: the driver runs the full gate before merge.ps1 (#191)', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }]);
    // the run committed after its gate
    writeFileSync(join(t.epics[0].wt, 'a', 'nach.txt'), 'nach dem Gate\n');
    git(t.epics[0].wt, 'add', '-A');
    git(t.epics[0].wt, 'commit', '-q', '-m', 'nach dem Gate');
    git(t.epics[0].wt, 'push', '-q', 'origin', 'epic/3-x');
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(t.p.gates.map((g) => [g.befehl, resolve(g.cwd)])).toEqual([['gate voll', t.epics[0].wt]]);
    const e = texte(z);
    const ohne = index(e, /^#3 Andockblock auf HEAD [0-9a-f]{8}, der PR steht auf [0-9a-f]{8}: der Treiber fährt die Andockprüfung selbst$/);
    expect(ohne).toBeGreaterThanOrEqual(0);
    expect(ohne).toBeLessThan(index(e, /^#3 merge\.ps1: GEMERGT/));
    // the driver's block is the last run of the PR, and merge.ps1 merged on it
    expect(gateLaeufe(t.p.prEdits.find((x) => x.pr === 13)!.body, form)!.map((l) => [l.teil, l.gruen])).toEqual([[false, true], [false, true]]);
  }, T);

  it('a block against another base than the merge-base is not counted, even with a gate call in the log (#191)', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }]);
    // the gate ran against a base the branch does not hold
    const fremd = 'abcdef1';
    t.bodies.set(13, t.bodies.get(13)!.replace(/@ [0-9a-f]{7}/, `@ ${fremd}`));
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(t.p.gates.map((g) => g.befehl)).toEqual(['gate voll']);
    expect(texte(z).some((x) => /^#3 Andockblock gegen Basis abcdef1, die merge-base ist [0-9a-f]{7}: der Treiber fährt die Andockprüfung selbst$/.test(x))).toBe(true);
  }, T);

  it('a red gate goes back to its run with the output, the queue goes on, the epic queues up again at the end', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }, { nr: 4, datei: 'b/vier.txt' }, { nr: 5, datei: 'a/fuenf.txt' }], { rot: (cwd, n) => n === 1 && cwd.endsWith('e4') });
    // #5 ends while #4 is the head (its gate turns red), #4 again while #5 is
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }]), lauf(4, [{ signal: 'kopf-13' }, ...t.nachweis(4), { text: ende(4, 14) }]), lauf(5, [{ signal: 'kopf-14' }, ...t.nachweis(5), { text: ende(5, 15) }]), lauf(4, [{ signal: 'kopf-15' }, ...t.nachweis(4), { text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4, 5], { maxDauerMs: GRENZE }), t.welt);
    expect(Object.values(z.epics).map((e) => e.stufe)).toEqual(['fertig', 'fertig', 'fertig']);
    const zuege4 = buch.gesehen().filter((g) => /^Flotte, Mission #4\b/.test(g.eingabe));
    expect(zuege4[1].eingabe).toMatch(/die Andockprüfung gefahren \(`gate teil`\): rot\. Nichts gepusht[\s\S]*wurzel ROT/);
    const e = texte(z);
    // #5 was merged while #4 was back at its run, then #4 at the end
    const merges = e.filter((x) => /merge\.ps1: GEMERGT/.test(x)).map((x) => x.slice(0, 2));
    expect(merges).toEqual(['#3', '#5', '#4']);
    expect(z.epics['4'].mergeVersuche).toBe(1);
    expect(z.statistik.gateWiederholungen).toBe(3);
  }, T);

  it('#25: a red gate with a cause outside the diff (a held test lock, a time limit) is run once more before it counts against the run', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }, { nr: 4, datei: 'b/vier.txt' }], { rot: (cwd, n) => n === 1 && cwd.endsWith('e4'), rotText: 'Testsperre belegt: ein anderer Lauf hält sie' });
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }]), lauf(4, [{ signal: 'kopf-13' }, ...t.nachweis(4), { text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: GRENZE }), t.welt);
    expect(Object.values(z.epics).map((e) => e.stufe)).toEqual(['fertig', 'fertig']);
    expect(z.epics['4'].mergeVersuche ?? 0).toBe(0);
    expect(t.p.gates).toHaveLength(2);
    expect(texte(z).some((x) => /^#4 Andockprüfung des Treibers rot, die Ursache liegt außerhalb des Diffs \(Testsperre\): einmal wiederholt$/.test(x))).toBe(true);
    expect(buch.gesehen().filter((g) => /^Flotte, Mission #4\b/.test(g.eingabe))).toHaveLength(1);
    // the green gate after it resets the repeat for a later red
    expect(z.epics['4'].gateAussenWiederholt).toBe(false);
  }, T);

  for (const [fall, rotText, gates] of [
    ['red from outside twice: the second red goes back to the run', 'Testsperre belegt: ein anderer Lauf hält sie', 2],
    ['a test that merely timed out is no cause outside: back to the run at once', 'FAIL test/x.test.ts > y: timed out after 5000 ms', 1],
  ] as const) {
    it(`#25: ${fall}`, async () => {
      const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }, { nr: 4, datei: 'b/vier.txt' }], { rot: (cwd) => cwd.endsWith('e4'), rotText });
      // #4 ends again only once the driver has given it back (event), then stays red: the test stops at the second return
      const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }]), lauf(4, [{ signal: 'kopf-13' }, ...t.nachweis(4), { text: ende(4, 14) }])]);
      const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: GRENZE }), t.welt);
      const zuege4 = buch.gesehen().filter((g) => /^Flotte, Mission #4\b/.test(g.eingabe));
      expect(zuege4[1].eingabe).toMatch(/die Andockprüfung gefahren \(`gate teil`\): rot\. Nichts gepusht/);
      // the gate runs before the first return: one, or two with the repeat
      const zurueck = texte(z).findIndex((x) => /^#4 zurück an den Lauf \(1 von 2\)/.test(x));
      expect(zurueck).toBeGreaterThanOrEqual(0);
      expect(texte(z).slice(0, zurueck).filter((x) => /^#4 Andockprüfung des Treibers rot nach/.test(x))).toHaveLength(gates);
      expect(texte(z).slice(0, zurueck).filter((x) => /einmal wiederholt/.test(x))).toHaveLength(gates - 1);
    }, T);
  }

  it('#25: a conflict when the base comes in goes back to the run without counting against it; the worktree is left as it was; the fifth time blocks', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/x.txt', inhalt: 'drei\n' }, { nr: 5, datei: 'a/x.txt', inhalt: 'fünf\n' }]);
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }]), lauf(5, [{ signal: 'kopf-13' }, ...t.nachweis(5), { text: ende(5, 15) }])]);
    const z = await fahre(t.einstellung(buch, [3, 5], { maxDauerMs: GRENZE }), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.epics['5']).toMatchObject({ stufe: 'blockiert', basisKonflikte: 5 });
    expect(z.epics['5'].mergeVersuche ?? 0).toBe(0);
    expect(z.epics['5'].haltGrund).toMatch(/^Nachziehen der Basis nach 5 Konflikten weiter nicht möglich/);
    const zuege5 = buch.gesehen().filter((g) => /^Flotte, Mission #5\b/.test(g.eingabe));
    expect(zuege5[1].eingabe).toMatch(/Konflikt in a\/x\.txt\. Der Treiber hat `git merge` abgebrochen, nichts gepusht/);
    expect(t.p.gates).toHaveLength(0);
    expect(git(t.epics[1].wt, 'status', '--porcelain')).toBe('');
    expect(git(t.epics[1].wt, 'rev-parse', 'HEAD')).toBe(git(t.repo, 'rev-parse', 'origin/epic/5-x'));
  }, T);

  it('after the merge the local epic branch goes when it lies wholly in origin; one a worktree holds stays', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }, { nr: 4, datei: 'b/vier.txt' }]);
    git(t.repo, 'worktree', 'remove', t.epics[0].wt);
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }]), lauf(4, [{ signal: 'kopf-13' }, ...t.nachweis(4), { text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: GRENZE }), t.welt);
    const e = texte(z);
    expect(e).toContain('#3 lokaler Branch epic/3-x gelöscht (liegt ganz in origin/main)');
    expect(e.some((x) => /^#4 lokaler Branch epic\/4-x bleibt: .*(checked out|ausgecheckt|used by worktree)/.test(x))).toBe(true);
    expect(aufrufen('git', ['-C', t.repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/epic/3-x']).code).not.toBe(0);
  }, T);

  it('after the merge the driver deletes the mission\'s branches on the forge whose commits are in the base and whose PR is merged (#203)', async () => {
    const prs: Record<string, { number: number; state: string }[]> = { 'agent/3-p3-offen': [{ number: 40, state: 'OPEN' }], 'agent/3-p4-gemergt': [{ number: 41, state: 'MERGED' }] };
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { bodies: { 3: '## Betroffene Module\n- m3\n\nKinder: #31\n' }, zu: [31], prListe: (b) => prs[b] ?? [] });
    const wt = t.epics[0].wt;
    // packages of the mission: three on the mission's head (in the base after the merge), one with its own commit
    for (const b of ['agent/31-kind', 'agent/3-p1-eins', 'agent/3-p3-offen', 'agent/3-p4-gemergt', 'agent/4-p1-fremd']) git(wt, 'push', '-q', 'origin', `HEAD:refs/heads/${b}`);
    git(wt, 'checkout', '-q', '-b', 'agent/3-p2-eigen');
    writeFileSync(join(wt, 'a', 'eigen.txt'), 'eigen\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', 'eigen');
    git(wt, 'push', '-q', 'origin', 'agent/3-p2-eigen');
    git(wt, 'checkout', '-q', 'epic/3-x');
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    const koepfe = git(t.repo, 'ls-remote', '--heads', 'origin').split('\n').map((z) => z.split('refs/heads/')[1]).sort();
    expect(koepfe).toEqual(['agent/3-p2-eigen', 'agent/3-p3-offen', 'agent/4-p1-fremd', 'main']);
    const e = texte(z);
    expect(e).toContain('#3 Branch epic/3-x auf der Forge gelöscht (in origin/main, PR #13 angedockt)');
    expect(e).toContain('#3 Branch agent/3-p4-gemergt auf der Forge gelöscht (in origin/main, PR #41 angedockt)');
    expect(e).toContain('#3 Branch agent/3-p2-eigen auf der Forge bleibt: Commits nicht in origin/main');
    expect(e).toContain('#3 Branch agent/3-p3-offen auf der Forge bleibt: PR #40 ist OPEN');
  }, T);

  it('a mission PR the forge does not yet show as merged leaves every branch on the forge (#203)', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { pr: () => ({ state: 'OPEN' }) });
    git(t.epics[0].wt, 'push', '-q', 'origin', 'HEAD:refs/heads/agent/3-p1-eins');
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 8000 }), t.welt);
    const koepfe = git(t.repo, 'ls-remote', '--heads', 'origin').split('\n').map((z) => z.split('refs/heads/')[1]).sort();
    expect(koepfe).toEqual(['agent/3-p1-eins', 'epic/3-x', 'main']);
    expect(texte(z)).toContain('#3 Branches auf der Forge bleiben: PR #13 ist dort OPEN, nicht angedockt');
  }, T);

  it('--konto-max keeps an account to its share of the epics', async () => {
    const t = aufbau();
    const buch = drehbuch([3, 4, 5].map((n) => lauf(n, [{ warte: 300 }, { text: ende(n, 10 + n) }])));
    const z = await fahre(t.einstellung(buch, [3, 4, 5], { kontoMax: { [t.konten[1]]: 1 } }), t.welt);
    expect(Object.values(z.epics).filter((e) => e.konto === t.konten[1])).toHaveLength(1);
    expect(Object.values(z.epics).every((e) => e.stufe === 'fertig')).toBe(true);
  }, T);

  it('--konto-max also counts the epics placed in the same tick (probe 3)', async () => {
    const t = aufbau();
    const buch = drehbuch([3, 4, 5].map((n) => lauf(n, [{ warte: 300 }, { text: ende(n, 10 + n) }])));
    const z = await fahre(t.einstellung(buch, [3, 4, 5], { kontoMax: { [t.konten[0]]: 1 } }), t.welt);
    expect(Object.values(z.epics).filter((e) => e.konto === t.konten[0])).toHaveLength(1);
    expect(Object.values(z.epics).every((e) => e.stufe === 'fertig')).toBe(true);
  }, T);

  it('lays the epic worktree out again when the run\'s session took it along, and takes it down after the merge (probe 3)', async () => {
    const aufrufe: { aktion: string; holder?: string }[] = [];
    let neu = '';
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }, { nr: 4, datei: 'b/vier.txt' }], {
      worktree: (aktion, args, env) => {
        aufrufe.push({ aktion, holder: env?.EPIC_LOCK_HOLDER });
        const branch = args[args.indexOf('-Branch') + 1];
        if (aktion === 'Up') {
          neu = join(mkdtempSync(join(tmpdir(), 'flotte-up-')), 'epic-4');
          git(t.repo, 'worktree', 'add', '-q', neu, branch);
          return JSON.stringify({ path: neu, branch });
        }
        git(t.repo, 'worktree', 'remove', neu);
        return '';
      },
    });
    // the session of #4 ended: its epic worktree is gone, the branch stays
    git(t.repo, 'worktree', 'remove', t.epics[1].wt);
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }]), lauf(4, [{ signal: 'kopf-13' }, ...t.nachweis(4), { text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: GRENZE }), t.welt);
    expect(Object.values(z.epics).map((e) => e.stufe)).toEqual(['fertig', 'fertig']);
    expect(aufrufe.map((a) => a.aktion)).toEqual(['Up', 'Down']);
    expect(aufrufe[0].holder).toMatch(/halten[\\/]4\.json$/);
    expect(t.p.gates.map((g) => [g.befehl, resolve(g.cwd)])).toEqual([['gate teil', resolve(neu)]]);
    expect(texte(z).some((x) => /#4 Missions-Worktree neu angelegt/.test(x))).toBe(true);
    expect(git(t.repo, 'worktree', 'list')).not.toContain('epic-4');
  }, T);

  it('blocks after three gate runs of the driver when the base keeps moving', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { mergeImmerAbgelehnt: 13 });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: GRENZE }), t.welt);
    expect(z.epics['3']).toMatchObject({ stufe: 'blockiert', gateWiederholungen: 3 });
    expect(z.epics['3'].notiz).toMatch(/3 Andockprüfungen des Treibers, die Basis zog jedes Mal davon/);
  }, T);
});

describe('#229: ein fehlgeschlagenes Andocken löst der Treiber selbst', () => {
  const ABGELEHNT = 'MERGE FEHLGESCHLAGEN #13: GraphQL: Repository rule violations found. At least 1 approving review is required (mergePullRequest)';
  const NETZ = 'MERGE FEHLGESCHLAGEN #13: HTTP 502: Bad Gateway (https://api.github.com/graphql)';
  /** the person answers the driver's question once the event names it */
  const mitAntwort = (t: { repo: string; welt: Welt }, antwort: string): Welt => ({
    ...t.welt,
    melde: (zeile: string) => {
      t.welt.melde(zeile);
      if (new RegExp(`Frage ${ANDOCK_FRAGE} an den Menschen`).test(zeile)) setTimeout(() => antworten([t.repo, '3', String(ANDOCK_FRAGE), antwort]), 100);
    },
  });

  it('sorts the reason of the forge: passing, conflict, lasting', () => {
    for (const x of ['HTTP 502: Bad Gateway', 'Post "https://api.github.com/graphql": net/http: TLS handshake timeout', 'GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)', 'Status 0: Server nicht erreicht', 'Server nicht erreicht', 'Status 405: Please try again later', 'GraphQL: Pull Request is not mergeable yet: mergeable state unknown']) expect(andockFehler(x), x).toBe('voruebergehend');
    for (const x of ['GraphQL: Pull Request is not mergeable: the merge commit cannot be cleanly created. (mergePullRequest)', 'Status 409: merge conflict']) expect(andockFehler(x), x).toBe('konflikt');
    for (const x of ['GraphQL: Repository rule violations found. At least 1 approving review is required (mergePullRequest)', 'GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)', 'keine Ausgabe der Forge', 'GraphQL: Could not resolve to a PullRequest with the number of 13. (repository.pullRequest)']) expect(andockFehler(x), x).toBe('dauerhaft');
    expect(andockFehler('Post "https://api.github.com/graphql": could not resolve host: api.github.com')).toBe('voruebergehend');
  });

  it('recommends B only for a moved head, not for a branch ahead', () => {
    expect(andockEmpfehlung('GraphQL: Head branch was modified. Review and try the merge again.', 'dauerhaft')).toBe('B');
    expect(andockEmpfehlung('the branch is 2 commits ahead of the base', 'dauerhaft')).toBe('C');
    expect(andockEmpfehlung('HTTP 502', 'voruebergehend')).toBe('A');
  });

  it('reads the answer by the option letter or its words; the bridge sends free text as "Antwort: …"; anything else is C', () => {
    for (const [antwort, wahl] of [['A', 'A'], ['A — Antwort: bitte gleich', 'A'], ['B', 'B'], ['c', 'C'], ['Antwort: neu versuchen', 'A'], ['nochmal', 'A'], ['erneut versuchen', 'A'], ['Antwort: Andockprüfung neu fahren', 'B'], ['Mensch dockt an', 'C'], ['Antwort: keine Ahnung', 'C']] as const) expect(andockWahl(antwort), antwort).toBe(wahl);
  });

  it('passing: tries again after a pause, without a new gate, and docks', async () => {
    // the note of the mission as the board and the bridge read it from the saved state, at each repeat
    const notizen: string[] = [];
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], {
      stoerung: (_pr, n) => {
        if (n >= 2) notizen.push(JSON.parse(readFileSync(join(flotteDir(t.repo), 'zustand.json'), 'utf8')).epics['3'].notiz);
        return n <= 2 ? NETZ : null;
      },
    });
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    // a tick longer than the loop's own: the state is saved while the driver waits between two calls
    const z = await fahre(t.einstellung(buch, [3], { taktMs: 300 }), t.welt);
    expect(notizen).toEqual([
      'PR #13: Andocken vorübergehend fehlgeschlagen, Wiederholung 1 von 3 (HTTP 502: Bad Gateway (https://api.github.com/graphql))',
      'PR #13: Andocken vorübergehend fehlgeschlagen, Wiederholung 2 von 3 (HTTP 502: Bad Gateway (https://api.github.com/graphql))',
    ]);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(t.p.merges).toEqual([13, 13, 13]);
    expect(t.p.gates).toEqual([]);
    const e = texte(z);
    // the reason of the forge in the event, word for word
    expect(e).toContain(`#3 merge.ps1: ${NETZ}`);
    expect(e.filter((x) => /^#3 Andocken vorübergehend fehlgeschlagen \(HTTP 502: Bad Gateway \(https:\/\/api\.github\.com\/graphql\)\): Wiederholung [12] von 3 nach einem Takt, ohne neue Andockprüfung$/.test(x))).toHaveLength(2);
    expect(z.fragen).toEqual([]);
  }, T);

  it('base moved: the epic stays at the head, the driver brings the base in, runs the gate and docks', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], {
      stoerung: (_pr, n) => {
        if (n !== 1) return null;
        // another PR docked meanwhile (area B): the forge refuses the first call
        git(t.repo, 'fetch', '-q', 'origin');
        git(t.repo, 'merge', '-q', '--ff-only', 'origin/main');
        writeFileSync(join(t.repo, 'b', 'anders.txt'), 'anders\n');
        git(t.repo, 'add', '-A');
        git(t.repo, 'commit', '-q', '-m', 'anderer PR');
        git(t.repo, 'push', '-q', 'origin', 'main');
        return 'MERGE FEHLGESCHLAGEN #13: GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)';
      },
    });
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: GRENZE }), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(t.p.gates.map((g) => g.befehl)).toEqual(['gate teil']);
    const e = texte(z);
    const vorbei = index(e, /^#3 Andocken vorübergehend fehlgeschlagen \(GraphQL: Base branch was modified/);
    const fehlt = index(e, /^#3 merge\.ps1: GATE FEHLT #13: Gate lief gegen/);
    const gate = index(e, /^#3 Andockprüfung des Treibers \(Immer-Teil/);
    expect(vorbei).toBeGreaterThanOrEqual(0);
    expect(vorbei).toBeLessThan(fehlt);
    expect(fehlt).toBeLessThan(gate);
    expect(gate).toBeLessThan(index(e, /^#3 merge\.ps1: GEMERGT/));
    // nothing went back to the run, and the head never left the queue
    expect(buch.gesehen().filter((g) => /^Flotte, Mission #3\b/.test(g.eingabe))).toHaveLength(1);
    expect(e.filter((x) => /^#3 Kopf der Schlange/.test(x))).toHaveLength(1);
  }, T);

  it('a conflict when docking takes the existing way: the driver brings the base in and checks before it docks', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { stoerung: (_pr, n) => (n === 1 ? 'MERGE FEHLGESCHLAGEN #13: GraphQL: Pull Request is not mergeable: the merge commit cannot be cleanly created. (mergePullRequest)' : null) });
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: GRENZE }), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    const e = texte(z);
    expect(index(e, /^#3 Andocken fehlgeschlagen mit Konflikt \(GraphQL: Pull Request is not mergeable/)).toBeLessThan(index(e, /^#3 Andockprüfung des Treibers \(/));
    expect(t.p.gates).toHaveLength(1);
  }, T);

  it('lasting: a question block for the person with the reason word for word, what was tried, options and a recommendation; C leaves it to the person', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { stoerung: () => ABGELEHNT, pr: () => ({ state: 'OPEN' }) });
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 10_000 }), mitAntwort(t, 'C'));
    const ursache = ABGELEHNT.replace('MERGE FEHLGESCHLAGEN #13: ', '');
    // no repeat for a lasting refusal
    expect(t.p.merges).toEqual([13]);
    const f = z.fragen.find((x) => x.nr === ANDOCK_FRAGE)!;
    expect(f).toMatchObject({ epic: 3, ganzerLauf: true, empfehlung: 'C', marke: 'Andocken', beantwortet: 'C' });
    expect(f.frage).toContain(ursache);
    expect(f.lage).toContain(`Ursache (merge.ps1): ${ursache}`);
    expect(f.lage).toMatch(/Versucht: merge\.ps1 1-mal aufgerufen/);
    expect(f.optionen!.map((o) => o.buchstabe)).toEqual(['A', 'B', 'C']);
    expect(f.optionen!.map((o) => o.text).join(' | ')).toMatch(/erneut versuchen.*\| Andockprüfung neu fahren.*\| Mensch dockt an/);
    const k = t.p.kommentare.find((x) => x.nr === 3 && x.text.startsWith('**FRAGE AN DEN MENSCHEN (Flotte)**'))!;
    expect(k.text).toContain(ursache);
    expect(k.text).toContain(`flotte antworten . 3 ${ANDOCK_FRAGE}`);
    // C: the PR waits for the person, with the reason on the board and the bridge card
    expect(z.epics['3'].stufe).toBe('pr');
    expect(z.epics['3'].notiz).toBe(`PR #13 bereit, ein Mensch dockt an (Andocken fehlgeschlagen: ${ursache})`);
    // the question belongs to the driver, not to the run: no revocable decision for it
    expect(z.entscheidungen.filter((d) => d.nr === ANDOCK_FRAGE)).toEqual([]);
  }, T);

  it('a forge conflict after the driver\'s own full gate asks the person, it does not leave the PR without a word', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { stoerung: (_pr, n) => (n === 1 ? 'MERGE FEHLGESCHLAGEN #13: Status 409: merge conflict' : null), pr: () => ({ state: 'OPEN' }) });
    // the run committed after its gate: the driver runs the full gate itself first
    writeFileSync(join(t.epics[0].wt, 'a', 'nach.txt'), 'nach dem Gate\n');
    git(t.epics[0].wt, 'add', '-A');
    git(t.epics[0].wt, 'commit', '-q', '-m', 'nach dem Gate');
    git(t.epics[0].wt, 'push', '-q', 'origin', 'epic/3-x');
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 10_000 }), t.welt);
    expect(t.p.gates.map((g) => g.befehl)).toEqual(['gate voll']);
    const f = z.fragen.find((x) => x.nr === ANDOCK_FRAGE)!;
    expect(f.frage).toContain('Status 409: merge conflict');
    expect(f.lage).toMatch(/Versucht: merge\.ps1 1-mal aufgerufen; 1 Andockprüfung des Treibers/);
    expect(z.epics['3'].notiz).toMatch(/^PR #13: Andocken fehlgeschlagen, Frage an dich/);
  }, T);

  it('an open question closes once the mission leaves its PR; a later failure asks once more, never two open', async () => {
    let gefragt = false;
    let konflikte = 0;
    // one conflict after another docking, read once after the first question
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { stoerung: () => ABGELEHNT, pr: () => ({ state: 'OPEN', mergeable: gefragt && konflikte++ === 0 ? 'CONFLICTING' : 'MERGEABLE' }) });
    const welt: Welt = { ...t.welt, melde: (zeile) => {
      t.welt.melde(zeile);
      if (new RegExp(`Frage ${ANDOCK_FRAGE} an den Menschen`).test(zeile)) gefragt = true;
    } };
    // the conflict after another docking sends the run back to work; it ends again with the same PR
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 15_000 }), welt);
    const fragen = z.fragen.filter((x) => x.nr === ANDOCK_FRAGE);
    expect(fragen).toHaveLength(2);
    expect(fragen[0].beantwortet).toBe('überholt: die Mission steht auf laeuft');
    expect(fragen[1].beantwortet).toBeUndefined();
  }, T);

  it('a person docks by hand without answering: the question closes with the docking', async () => {
    let angedockt = false;
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { stoerung: () => ABGELEHNT, pr: () => ({ state: angedockt ? 'MERGED' : 'OPEN' }) });
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const welt: Welt = { ...t.welt, melde: (zeile) => {
      t.welt.melde(zeile);
      if (new RegExp(`Frage ${ANDOCK_FRAGE} an den Menschen`).test(zeile)) angedockt = true;
    } };
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: GRENZE }), welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.fragen.find((x) => x.nr === ANDOCK_FRAGE)).toMatchObject({ beantwortet: 'von Hand angedockt' });
  }, T);

  it('passing three times over: the question recommends A; A puts it back into the queue and it docks', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { stoerung: (_pr, n) => (n <= ANDOCK_VERSUCHE + 1 ? NETZ : null), pr: () => ({ state: 'OPEN' }) });
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: GRENZE }), mitAntwort(t, 'A'));
    expect(z.epics['3'].stufe).toBe('fertig');
    const f = z.fragen.find((x) => x.nr === ANDOCK_FRAGE)!;
    expect(f).toMatchObject({ empfehlung: 'A', beantwortet: 'A' });
    expect(f.lage).toMatch(/merge\.ps1 4-mal aufgerufen \(3 Wiederholungen im Abstand eines Takts/);
    expect(t.p.merges).toHaveLength(ANDOCK_VERSUCHE + 2);
    expect(t.p.gates).toEqual([]);
  }, T);

  it('B: the driver runs the gate again, also with a block that still counts, and docks', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { stoerung: (_pr, n) => (n === 1 ? ABGELEHNT : null), pr: () => ({ state: 'OPEN' }) });
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: GRENZE }), mitAntwort(t, 'B'));
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(t.p.gates.map((g) => g.befehl)).toEqual(['gate voll']);
    expect(texte(z).some((x) => /^#3 Andockprüfung des Treibers \(voll, der Mensch will die Andockprüfung neu\)/.test(x))).toBe(true);
  }, T);
});

describe('B: Gate-Block und Bereiche', () => {
  it('globs: ** spans folders, * stays inside one, a trailing / is the folder', () => {
    expect(globRegex('apps/web/').test('apps/web/src/a.ts')).toBe(true);
    expect(globRegex('apps/*/x.ts').test('apps/web/x.ts')).toBe(true);
    expect(globRegex('apps/*/x.ts').test('apps/web/sub/x.ts')).toBe(false);
    expect(globRegex('**/package.json').test('package.json')).toBe(true);
    expect(globRegex('**/package.json').test('a/b/package.json')).toBe(true);
    expect(globRegex('a.ts').test('aXts')).toBe(false);
  });

  it('a file outside every area touches every area', () => {
    const b = bereicheAus(['a/ = A', 'b/ = B']);
    expect(gemeinsameBereiche(['b/1'], ['a/1'], b)).toEqual([]);
    expect(gemeinsameBereiche(['a/2'], ['a/1'], b)).toEqual(['A']);
    expect(gemeinsameBereiche(['README.md'], ['a/1'], b)).toEqual(['(ohne Bereich)']);
    expect(gemeinsameBereiche(['b/1'], ['a/1', 'package.json'], b)).toEqual(['(ohne Bereich)']);
  });

  it('reads the runs of the section; a part run needs a full green run before it', () => {
    const body = '## Gate\n== Gate: Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)\nGate grün.\n== Gate: Immer-Teil, Basis origin/main @ ccccccc (HEAD dddddddd)\nGate grün.\n## Danach\n== Gate: Basis origin/main @ eeeeeee (HEAD ffffffff)';
    const l = gateLaeufe(body, form)!;
    expect(l).toEqual([{ base: 'aaaaaaa', head: 'bbbbbbbb', gruen: true, teil: false }, { base: 'ccccccc', head: 'dddddddd', gruen: true, teil: true }]);
    expect(letzterVollLauf(l)?.base).toBe('aaaaaaa');
    expect(letzterVollLauf([{ ...l[0], gruen: false }, l[1]])).toBeNull();
    expect(gateLaeufe('kein Gate', form)).toBeNull();
  });

  it('takes the block from the last line with a base and appends it to the section, or adds the section', () => {
    const b = blockAus('\x1b[32mlog\x1b[0m\n== Gate: Immer-Teil, Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)\n  wurzel grün\nGate grün.\n', form)!;
    expect(b).toEqual({ block: '== Gate: Immer-Teil, Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)\n  wurzel grün\nGate grün.', gruen: true, teil: true });
    expect(blockAus('kein Kopf\nGate grün.', form)).toBeNull();
    expect(blockEinsetzen('## Gate\n```\nalt\n```\n\n## Rest\nx', form, 'neu')).toBe('## Gate\n```\nalt\n```\n```\nneu\n```\n\n## Rest\nx');
    expect(blockEinsetzen('Text', form, 'neu')).toBe('Text\n\n## Gate\n\n```\nneu\n```\n');
    // text after the last code block of the section stays below the new block
    expect(blockEinsetzen('## Gate\n```\nalt\n```\n\nCloses #4\n', form, 'neu')).toBe('## Gate\n```\nalt\n```\n```\nneu\n```\n\nCloses #4\n');
    expect(blockEinsetzen('## Gate\nalt\n\n## Rest', form, 'neu')).toBe('## Gate\nalt\n```\nneu\n```\n\n## Rest');
  });

  it('on a tie the occupancy prefers epics from different areas', () => {
    const ad = liesAdapter(`---\n${ADAPTER}\n---\n`);
    const bilder = [bildAus(3, ['Ändert `a/eins.ts`.'], ad, [3, 4, 5]), bildAus(4, ['Ändert `a/zwei.ts`.'], ad, [3, 4, 5]), bildAus(5, ['Ändert `b/drei.ts`.'], ad, [3, 4, 5])];
    expect(bilder.map((b) => b.bereiche)).toEqual([['A'], ['A'], ['B']]);
    expect(belege(bilder, ad, { laufend: [], gemergt: [], obergrenze: 2 }).neu).toEqual([3, 5]);
    // without areas the smaller numbers win, as before
    const ohne = liesAdapter('---\nmerge: nach_gate\n---\n');
    expect(belege([3, 4, 5].map((n, i) => bildAus(n, [`Ändert \`${'aab'[i]}/${n}.ts\`.`], ohne, [3, 4, 5])), ohne, { laufend: [], gemergt: [], obergrenze: 2 }).neu).toEqual([3, 4]);
  });
});

describe('C1: Stille mit lebendem Kindprozess', () => {
  it('a turn that is silent while a child process works is no idle run', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ kind: 5000 }, { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { leerlaufMs: 2000 }), t.welt); // stilleMax = 4 × leerlaufMs (8 s) must outlast the 5 s child, with room for the process query under load (#128)
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.epics['3'].leerlaeufe ?? 0).toBe(0);
    expect(texte(z).some((x) => /^#3 still seit 0 min, Kindprozess lebt: bun/.test(x))).toBe(true);
  }, T);

  it('without a child the silence ends the turn as before; with a child only up to stilleMaxMs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flotte-stille-'));
    const log = join(dir, 'l.jsonl');
    writeFileSync(log, '');
    const lebend = { pid: process.pid, konto: dir, beenden: false, log } as const;
    const ohne = await beobachte({ ...lebend, leerlaufMs: 300, kinder: async () => [] });
    expect(ohne.fehler).toBe('leerlauf');
    const t0 = Date.now();
    const mit = await beobachte({ ...lebend, leerlaufMs: 300, stilleMaxMs: 1500, kinder: async () => ['node.exe'] });
    expect(mit.fehler).toBe('leerlauf');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
  }, T);

  it('Tag H: a growing gate log of the run lets the idle limit rest, also past stilleMaxMs; once it is silent the limit counts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flotte-stille-'));
    const log = join(dir, 'l.jsonl');
    writeFileSync(log, '');
    const t0 = Date.now();
    const schritte: string[] = [];
    // the gate writes its log for 1.5 s, then stays silent; no child process, a cap below that
    const r = await beobachte({ pid: process.pid, konto: dir, beenden: false, log, leerlaufMs: 300, stilleMaxMs: 400, kinder: async () => [], beiSchritt: (x) => schritte.push(x), belebt: () => ({ zeit: Math.min(Date.now(), t0 + 1500), was: 'Protokoll der Andockprüfung wächst: buero' }) });
    expect(r.fehler).toBe('leerlauf');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500 + 300);
    expect(schritte.some((x) => /^still seit \d+ min, Protokoll der Andockprüfung wächst: buero$/.test(x))).toBe(true);
  }, T);
});

describe('C3: Adapter ohne merge', () => {
  it('names the adapters without the key; repositories without an adapter do not count', () => {
    const wurzel = mkdtempSync(join(tmpdir(), 'flotte-git-'));
    for (const [n, text] of [['mit', '---\nmerge: nach_gate   # Treiber\n---\n'], ['ohne', '---\nforge: github\n---\n'], ['leer', null]] as const) {
      const r = join(wurzel, n);
      aufrufen('git', ['init', '-q', r]);
      if (text) {
        mkdirSync(join(r, '.claude'));
        writeFileSync(join(r, '.claude', 'epic.md'), text);
      }
    }
    mkdirSync(join(wurzel, 'kein-repo'));
    const r = adapter([wurzel]) as { adapter: { repo: string; merge: string | null; quelle: string }[]; ohneMerge: string[]; folge: string };
    expect(r.adapter.map((a) => [a.repo.endsWith('mit') ? 'mit' : 'ohne', a.merge, a.quelle]).sort()).toEqual([['mit', 'nach_gate', 'Arbeitskopie'], ['ohne', null, 'Arbeitskopie']]);
    expect(r.ohneMerge).toEqual([join(wurzel, 'ohne')]);
    expect(r.folge).toMatch(/Nur ein Mensch dockt an in 1 Projekt\(en\)/);
    expect(schluessel('---\nmerge: "mensch"\n---', 'merge')).toBe('mensch');
    expect(schluessel('kein Frontmatter\nmerge: x', 'merge')).toBeNull();
  });
});

describe('C4: der letzte Schritt eines Laufs', () => {
  const werkzeug = (name: string, input: Record<string, unknown>) => ({ zeile: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name, input }] } } });

  it('names tool calls, texts and the end of a turn', () => {
    expect(schrittAus({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test\nmehr' } }] } })).toBe('Bash: npm test');
    expect(schrittAus({ type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'tool_use', name: 'Agent', input: { description: 'Implementer #5' } }] } })).toBe('↳ Agent: Implementer #5');
    expect(schrittAus({ type: 'assistant', message: { content: [{ type: 'text', text: '\nPaket 1 fertig.\n' }] } })).toBe('Paket 1 fertig.');
    expect(schrittAus({ type: 'result', is_error: false, result: 'FLOTTE-ENDE 3' })).toBe('Zugende: FLOTTE-ENDE 3');
    expect(schrittAus({ type: 'user' })).toBeNull();
  });

  it('the board shows the last step; flotte zuschauen prints the steps of the log', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [werkzeug('Skill', { skill: 'mission' }), werkzeug('Bash', { command: 'pwsh worktree.ps1 -Action Up' }), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].schritt).toMatch(/^Zugende: Fertig\./);
    const tafel = readFileSync(join(flotteDir(t.repo), 'tafel.html'), 'utf8');
    expect(tafel).toMatch(/<th>letzter Schritt<\/th>/);
    expect(tafel).toMatch(/Zugende: Fertig\./);
    const zeilen: string[] = [];
    const r = (await zuschauen([t.repo, '3', '--einmal'], (x) => zeilen.push(x))) as { schritte: number; logs: string[] };
    expect(r.schritte).toBe(4);
    expect(zeilen.slice(1).map((x) => x.slice(10))).toEqual(['Skill: mission', 'Bash: pwsh worktree.ps1 -Action Up', 'Fertig.', 'Zugende: Fertig.']);
    expect(existsSync(r.logs[0])).toBe(true);
  }, T);
});
