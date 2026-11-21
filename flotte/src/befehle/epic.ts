// flotte epic <nr> [<repo>] --drehbuch <datei> [--branch epic/<nr>-<slug>] [--basis origin/main]
//                            [--fenster 3] [--max-runden 3] [--konto <CLAUDE_CONFIG_DIR>]
// The package loop of an epic as a program (#69). Stage 1 (#65): language-model points and commands
// are stand-ins playing the script (src/epic/attrappe.ts); state and lock are real, in
// <git common dir>/flotte/epics/<nr>/. Real commands come with stage 2, real calls with stage 3.

import { readFileSync } from 'node:fs';
import { attrappe, type EpicDrehbuch } from '../epic/attrappe.ts';
import { fahreEpic } from '../epic/motor.ts';

function wert(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function epic(argv: string[]): Promise<unknown> {
  const nr = Number(argv[0]);
  if (!Number.isInteger(nr) || nr <= 0) throw new Error('Aufruf: flotte epic <nr> [<repo>] --drehbuch <datei> [--branch <epic-branch>] [--basis <remote/basis>] [--fenster 3] [--max-runden 3] [--konto <dir>]');
  const datei = wert(argv, '--drehbuch');
  if (!datei) throw new Error('flotte epic läuft in Stufe 1 (#65) nur mit --drehbuch <datei>: Aufrufe und Befehle sind Attrappen');
  const werte = new Set(['--drehbuch', '--branch', '--basis', '--fenster', '--max-runden', '--konto'].map((n) => wert(argv, n)));
  const repo = argv.slice(1).find((a) => !a.startsWith('--') && !werte.has(a)) ?? process.cwd();
  const u = attrappe(JSON.parse(readFileSync(datei, 'utf8')) as EpicDrehbuch);
  const zustand = await fahreEpic(
    {
      repo,
      epic: nr,
      epicBranch: wert(argv, '--branch') ?? `epic/${nr}`,
      basis: wert(argv, '--basis') ?? 'origin/main',
      fenster: Number(wert(argv, '--fenster') ?? 3),
      maxRunden: Number(wert(argv, '--max-runden') ?? 3),
      konto: wert(argv, '--konto') ?? '~/.claude',
    },
    u,
  );
  return { zustand, bloecke: u.welt.bloecke, protokoll: u.welt.protokoll };
}
