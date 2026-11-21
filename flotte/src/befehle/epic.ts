// flotte epic <nr> [<repo>] --drehbuch <datei> [--branch epic/<nr>-<slug>] [--basis origin/main]
//                            [--fenster 3] [--max-runden 3] [--konto <CLAUDE_CONFIG_DIR>]
//                            [--mechanik echt [--forge <owner/repo>]]
// The package loop of an epic as a program (#69). Language-model points are stand-ins playing the
// script (src/epic/attrappe.ts) until stage 3; state and lock are real, in
// <git common dir>/flotte/epics/<nr>/. With --mechanik echt (stage 2, #66) worktrees, tests, git
// and the forge are real (src/epic/mechanik.ts); without it they play the script as well.

import { readFileSync } from 'node:fs';
import { aufrufen } from '../aufruf.ts';
import { attrappe, type EpicDrehbuch } from '../epic/attrappe.ts';
import { echteMechanik } from '../epic/mechanik.ts';
import { fahreEpic } from '../epic/motor.ts';

function wert(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function epic(argv: string[]): Promise<unknown> {
  const nr = Number(argv[0]);
  if (!Number.isInteger(nr) || nr <= 0) throw new Error('Aufruf: flotte epic <nr> [<repo>] --drehbuch <datei> [--branch <epic-branch>] [--basis <remote/basis>] [--fenster 3] [--max-runden 3] [--konto <dir>]');
  const datei = wert(argv, '--drehbuch');
  if (!datei) throw new Error('flotte epic läuft bis Stufe 3 (#67) nur mit --drehbuch <datei>: die Sprachmodell-Aufrufe sind Attrappen (Befehle mit --mechanik echt echt)');
  const werte = new Set(['--drehbuch', '--branch', '--basis', '--fenster', '--max-runden', '--konto', '--mechanik', '--forge'].map((n) => wert(argv, n)));
  const repo = argv.slice(1).find((a) => !a.startsWith('--') && !werte.has(a)) ?? process.cwd();
  const u = attrappe(JSON.parse(readFileSync(datei, 'utf8')) as EpicDrehbuch);
  const epicBranch = wert(argv, '--branch') ?? `epic/${nr}`;
  const basis = wert(argv, '--basis') ?? 'origin/main';
  const mechanik = wert(argv, '--mechanik');
  if (mechanik && mechanik !== 'echt') throw new Error(`--mechanik kennt nur echt (ohne den Schalter spielt die Mechanik das Drehbuch), nicht ${mechanik}`);
  if (mechanik) u.mechanik = echteMechanik({ repo, epic: nr, epicBranch, basis, forge: wert(argv, '--forge') ?? forgeAus(repo, basis.split('/')[0]) });
  const zustand = await fahreEpic(
    {
      repo,
      epic: nr,
      epicBranch,
      basis,
      fenster: Number(wert(argv, '--fenster') ?? 3),
      maxRunden: Number(wert(argv, '--max-runden') ?? 3),
      konto: wert(argv, '--konto') ?? '~/.claude',
    },
    u,
  );
  return { zustand, bloecke: u.welt.bloecke, protokoll: u.welt.protokoll };
}

/** owner/repo of the push remote's URL (github.com:owner/repo.git, https://host/owner/repo) */
export function forgeAus(repo: string, remote: string): string {
  const url = aufrufen('git', ['-C', repo, 'remote', 'get-url', remote]).stdout.trim();
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) throw new Error(`Forge aus ${remote} nicht lesbar (${url || 'kein Remote'}); --forge <owner/repo> angeben`);
  return m[1];
}
