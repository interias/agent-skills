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
import { fahre } from '../src/treiber/treiber.ts';
import { blockAus, blockEinsetzen, gateForm, gateLaeufe, gemeinsameBereiche, globRegex, bereicheAus, letzterVollLauf } from '../src/treiber/gate.ts';
import { belege, bildAus, liesAdapter } from '../src/werkzeuge/belegung.ts';
import { beobachte, schrittAus } from '../src/werkzeuge/lauf.ts';
import { flotteDir } from '../src/werkzeuge/zustand.ts';
import { aufbau, drehbuch, ende, lauf, type Optionen, gateAufruf } from './flotte-welt.ts';

const T = 60_000;
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
function gitWelt(epics: { nr: number; datei: string; inhalt?: string }[], o: Omit<Optionen, 'adapter'> & { rot?: (cwd: string, n: number) => boolean; mergeImmerAbgelehnt?: number } = {}) {
  const bodies = new Map<number, string>();
  const liste: EpicGit[] = [];
  const t = aufbau({
    ...o,
    adapter: ADAPTER,
    prInfo: (pr) => {
      const e = liste.find((x) => x.pr === pr)!;
      git(t.repo, 'fetch', '-q', 'origin');
      const edit = [...t.p.prEdits].reverse().find((x) => x.pr === pr);
      return { headRefName: e.branch, baseRefName: 'main', headRefOid: git(t.repo, 'rev-parse', `origin/${e.branch}`), body: edit?.body ?? bodies.get(pr)! };
    },
    gate: (befehl, cwd, n) => {
      const kopf = git(cwd, 'rev-parse', 'HEAD');
      const basis = git(cwd, 'rev-parse', 'origin/main');
      const gruen = !o.rot?.(cwd, n);
      return { code: gruen ? 0 : 1, stdout: `vorher\n== Gate: ${befehl === 'gate teil' ? 'Immer-Teil, ' : ''}Basis origin/main @ ${basis.slice(0, 7)} (HEAD ${kopf.slice(0, 8)})\n  wurzel ${gruen ? 'grün' : 'ROT'}\n${gruen ? 'Gate grün.' : 'Gate ROT.'}\n` };
    },
    // merge.ps1: the last run must name the current base and head (merge.Tests.ps1 checks the areas)
    mergeEcht: (pr) => {
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
    const buch = drehbuch([lauf(3, [{ warte: 100 }, ...t.nachweis(3), { text: ende(3, 13) }]), lauf(4, [{ warte: 1200 }, ...t.nachweis(4), { text: ende(4, 14) }]), lauf(5, [{ warte: 2400 }, ...t.nachweis(5), { text: ende(5, 15) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4, 5], { maxDauerMs: 40_000 }), t.welt);
    expect(Object.values(z.epics).map((e) => e.stufe)).toEqual(['fertig', 'fertig', 'fertig']);
    expect(z.statistik.gateWiederholungen).toBe(2);
    // #4 (area B) after #3 (area A): only the part that always runs; #5 (A) after #3 (A): the full gate
    expect(t.p.gates.map((g) => [g.befehl, resolve(g.cwd)])).toEqual([
      ['gate teil', t.epics[1].wt],
      ['gate voll', t.epics[2].wt],
    ]);
    const e = texte(z);
    expect(e.filter((x) => /Kopf der Schlange/.test(x)).map((x) => x.slice(0, 2))).toEqual(['#3', '#4', '#5']);
    expect(e.some((x) => /^#4 Gate des Treibers \(Immer-Teil, Basis bewegte sich nur in fremden Bereichen\)/.test(x))).toBe(true);
    expect(e.some((x) => /^#5 Gate des Treibers \(voll, Basis bewegte sich in Bereichen des Epics: A\)/.test(x))).toBe(true);
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
    const an = index(e, /^#3 Gate-Block des Laufs angerechnet \(Basis [0-9a-f]{7} = merge-base, HEAD [0-9a-f]{8} = Head des PR\)$/);
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
    const ohne = index(e, /^#3 Gate-Block auf HEAD [0-9a-f]{8}, der PR steht auf [0-9a-f]{8}: der Treiber fährt das Gate selbst$/);
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
    expect(texte(z).some((x) => /^#3 Gate-Block gegen Basis abcdef1, die merge-base ist [0-9a-f]{7}: der Treiber fährt das Gate selbst$/.test(x))).toBe(true);
  }, T);

  it('a red gate goes back to its run with the output, the queue goes on, the epic queues up again at the end', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }, { nr: 4, datei: 'b/vier.txt' }, { nr: 5, datei: 'a/fuenf.txt' }], { rot: (cwd, n) => n === 1 && cwd.endsWith('e4') });
    const buch = drehbuch([lauf(3, [{ warte: 100 }, ...t.nachweis(3), { text: ende(3, 13) }]), lauf(4, [{ warte: 1200 }, ...t.nachweis(4), { text: ende(4, 14) }]), lauf(5, [{ warte: 2400 }, ...t.nachweis(5), { text: ende(5, 15) }]), lauf(4, [{ warte: 3000 }, ...t.nachweis(4), { text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4, 5], { maxDauerMs: 45_000 }), t.welt);
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

  it('a conflict when the base comes in goes back to the run; the worktree is left as it was; the third time blocks', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/x.txt', inhalt: 'drei\n' }, { nr: 5, datei: 'a/x.txt', inhalt: 'fünf\n' }]);
    const buch = drehbuch([lauf(3, [{ warte: 100 }, ...t.nachweis(3), { text: ende(3, 13) }]), lauf(5, [{ warte: 1500 }, ...t.nachweis(5), { text: ende(5, 15) }])]);
    const z = await fahre(t.einstellung(buch, [3, 5], { maxDauerMs: 40_000 }), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.epics['5']).toMatchObject({ stufe: 'blockiert', mergeVersuche: 3 });
    const zuege5 = buch.gesehen().filter((g) => /^Flotte, Mission #5\b/.test(g.eingabe));
    expect(zuege5[1].eingabe).toMatch(/Konflikt in a\/x\.txt\. Der Treiber hat `git merge` abgebrochen, nichts gepusht/);
    expect(t.p.gates).toHaveLength(0);
    expect(git(t.epics[1].wt, 'status', '--porcelain')).toBe('');
    expect(git(t.epics[1].wt, 'rev-parse', 'HEAD')).toBe(git(t.repo, 'rev-parse', 'origin/epic/5-x'));
  }, T);

  it('after the merge the local epic branch goes when it lies wholly in origin; one a worktree holds stays', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }, { nr: 4, datei: 'b/vier.txt' }]);
    git(t.repo, 'worktree', 'remove', t.epics[0].wt);
    const buch = drehbuch([lauf(3, [...t.nachweis(3), { text: ende(3, 13) }]), lauf(4, [{ warte: 1500 }, ...t.nachweis(4), { text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4]), t.welt);
    const e = texte(z);
    expect(e).toContain('#3 lokaler Branch epic/3-x gelöscht (liegt ganz in origin/main)');
    expect(e.some((x) => /^#4 lokaler Branch epic\/4-x bleibt: .*(checked out|ausgecheckt|used by worktree)/.test(x))).toBe(true);
    expect(aufrufen('git', ['-C', t.repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/epic/3-x']).code).not.toBe(0);
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
    const buch = drehbuch([lauf(3, [{ warte: 100 }, ...t.nachweis(3), { text: ende(3, 13) }]), lauf(4, [{ warte: 1200 }, ...t.nachweis(4), { text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: 30_000 }), t.welt);
    expect(Object.values(z.epics).map((e) => e.stufe)).toEqual(['fertig', 'fertig']);
    expect(aufrufe.map((a) => a.aktion)).toEqual(['Up', 'Down']);
    expect(aufrufe[0].holder).toMatch(/halten[\\/]4\.json$/);
    expect(t.p.gates.map((g) => [g.befehl, resolve(g.cwd)])).toEqual([['gate teil', resolve(neu)]]);
    expect(texte(z).some((x) => /#4 Epic-Worktree neu angelegt/.test(x))).toBe(true);
    expect(git(t.repo, 'worktree', 'list')).not.toContain('epic-4');
  }, T);

  it('blocks after three gate runs of the driver when the base keeps moving', async () => {
    const t = gitWelt([{ nr: 3, datei: 'a/drei.txt' }], { mergeImmerAbgelehnt: 13 });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3']).toMatchObject({ stufe: 'blockiert', gateWiederholungen: 3 });
    expect(z.epics['3'].notiz).toMatch(/3 Gate-Läufe des Treibers, die Basis zog jedes Mal davon/);
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
    expect(r.folge).toMatch(/mergt nur ein Mensch in 1 Projekt\(en\)/);
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
