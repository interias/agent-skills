// flotte epic <nr> [<repo>] [--drehbuch <datei>] [--branch epic/<nr>-<slug>] [--basis origin/main]
//                            [--fenster 3] [--max-runden 3] [--konto <CLAUDE_CONFIG_DIR>]
//                            [--mechanik echt [--forge <owner/repo>]]
//                            [--aufrufe echt [--antworten <datei>] [--max-min 120] [--leerlauf-min 20]]
// The package loop of an epic as a program (#69). State and lock are real, in
// <git common dir>/flotte/epics/<nr>/. With --mechanik echt (stage 2, #66) worktrees, tests, git
// and the forge are real (src/epic/mechanik.ts), with --aufrufe echt (stage 3, #67) the
// language-model points are `claude -p` on the account of --konto (src/epic/aufrufe.ts); what is
// not real plays the script of --drehbuch (src/epic/attrappe.ts), which is needed unless both are.
//
// The driver protocol with real calls: every block (FLOTTE-FRAGE, FLOTTE-ENDE) goes to stdout and
// is appended to <epic dir>/bloecke.txt. Answers come from --antworten, a file read every takt with
// one line `<nr>: <antwort>` per question (it may be written while the program waits). Without
// --antworten the program stops as soon as only an answer could go on (a gate point about the whole
// run, or only parked packages left) and nothing runs; a restart with --antworten reports the open
// block again and reads the answer. --max-min stops the program after that long. Whenever the
// program stops, it ends the call processes still running first (they run detached), so the next
// start continues their sessions with --resume and never runs a second process beside the first.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aufrufen } from '../aufruf.ts';
import { attrappe, type EpicDrehbuch } from '../epic/attrappe.ts';
import { echteAufrufe, type EchteAufrufe } from '../epic/aufrufe.ts';
import { echteMechanik } from '../epic/mechanik.ts';
import { fahreEpic, type Leitung, type Umgebung } from '../epic/motor.ts';
import { geparkt, istEnde } from '../epic/regeln.ts';
import { epicDir, liesLauf } from '../epic/zustand.ts';

function wert(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const SCHALTER = ['--drehbuch', '--branch', '--basis', '--fenster', '--max-runden', '--konto', '--mechanik', '--forge', '--aufrufe', '--antworten', '--max-min', '--leerlauf-min'];

/** the program stopped on purpose (an open question without --antworten, --max-min) */
class Angehalten extends Error {}

/** answers of the file, `<nr>: <antwort>` (also `<nr>.` or `<nr>)`), each one once per program run */
export function dateiLeitung(dir: string, antworten: string | null, ausgabe: (block: string) => void = (b) => process.stdout.write(`${b}\n`)): Leitung {
  const geliefert = new Set<number>();
  return {
    melde(block) {
      appendFileSync(join(dir, 'bloecke.txt'), `${block}\n\n`);
      ausgabe(block);
    },
    antworten() {
      if (!antworten || !existsSync(antworten)) return [];
      const out: { frage: number; antwort: string }[] = [];
      for (const z of readFileSync(antworten, 'utf8').split(/\r?\n/)) {
        const m = /^\s*(\d+)\s*[:.)]\s*(.+?)\s*$/.exec(z);
        if (!m || geliefert.has(Number(m[1]))) continue;
        geliefert.add(Number(m[1]));
        out.push({ frage: Number(m[1]), antwort: m[2] });
      }
      return out;
    },
  };
}

/** only an answer could go on, and nothing runs: a gate point about the whole run, or only parked packages left */
export function wartetNurAufAntwort(dir: string, epic: number): string | null {
  const z = liesLauf(dir, epic);
  if (z.phase === 'tor') return 'Vorab-Tor: ein Punkt über den ganzen Lauf ist offen';
  if (z.phase !== 'pakete' || !z.fragen.some((f) => f.antwort === null && !f.erledigt)) return null;
  const park = geparkt(z);
  const pakete = Object.values(z.pakete);
  return pakete.some((p) => park.has(p.nr)) && pakete.every((p) => istEnde(p) || park.has(p.nr)) ? 'nur noch geparkte Pakete, sie warten auf ihre Antwort' : null;
}

export async function epic(argv: string[]): Promise<unknown> {
  const nr = Number(argv[0]);
  if (!Number.isInteger(nr) || nr <= 0) throw new Error('Aufruf: flotte epic <nr> [<repo>] [--drehbuch <datei>] [--branch <epic-branch>] [--basis <remote/basis>] [--fenster 3] [--max-runden 3] [--konto <dir>] [--mechanik echt [--forge <owner/repo>]] [--aufrufe echt [--antworten <datei>] [--max-min 120] [--leerlauf-min 20]]');
  const mechanik = wert(argv, '--mechanik');
  if (mechanik && mechanik !== 'echt') throw new Error(`--mechanik kennt nur echt (ohne den Schalter spielt die Mechanik das Drehbuch), nicht ${mechanik}`);
  const aufrufe = wert(argv, '--aufrufe');
  if (aufrufe && aufrufe !== 'echt') throw new Error(`--aufrufe kennt nur echt (ohne den Schalter spielen die Aufrufe das Drehbuch), nicht ${aufrufe}`);
  // real calls work in real worktrees: --aufrufe echt only with --mechanik echt
  if (aufrufe && !mechanik) throw new Error('--aufrufe echt nur zusammen mit --mechanik echt: die Aufrufe arbeiten in echten Worktrees');
  const datei = wert(argv, '--drehbuch');
  if (!datei && !aufrufe) throw new Error('flotte epic läuft nur mit --drehbuch <datei>, außer Mechanik und Aufrufe sind beide echt (--mechanik echt --aufrufe echt)');
  const werte = new Set(SCHALTER.map((n) => wert(argv, n)));
  const repo = argv.slice(1).find((a) => !a.startsWith('--') && !werte.has(a)) ?? process.cwd();
  const epicBranch = wert(argv, '--branch') ?? `epic/${nr}`;
  const basis = wert(argv, '--basis') ?? 'origin/main';
  const konto = wert(argv, '--konto') ?? '~/.claude';
  const adapter = existsSync(join(repo, '.claude', 'epic.md')) ? readFileSync(join(repo, '.claude', 'epic.md'), 'utf8') : '';
  const dir = epicDir(repo, nr);
  const u: Umgebung & { welt?: { bloecke: string[]; protokoll: unknown[] } } = datei
    ? attrappe(JSON.parse(readFileSync(datei, 'utf8')) as EpicDrehbuch)
    : ({} as Umgebung);
  if (mechanik) u.mechanik = echteMechanik({ repo, epic: nr, epicBranch, basis, forge: wert(argv, '--forge') ?? forgeAus(repo, basis.split('/')[0]) });
  const bloecke: string[] = [];
  let echt: EchteAufrufe | null = null;
  if (aufrufe) {
    const antworten = wert(argv, '--antworten') ?? null;
    const maxMs = Number(wert(argv, '--max-min') ?? 120) * 60_000;
    const beginn = Date.now();
    u.aufrufe = echt = echteAufrufe({ konto, logDir: join(dir, 'aufrufe'), leerlaufMs: Number(wert(argv, '--leerlauf-min') ?? 20) * 60_000 });
    u.leitung = dateiLeitung(dir, antworten, (b) => {
      bloecke.push(b);
      process.stdout.write(`${b}\n`);
    });
    u.jetzt = Date.now;
    u.warte = async () => {
      if (Date.now() - beginn > maxMs) throw new Angehalten(`--max-min ${maxMs / 60_000} erreicht`);
      const grund = antworten ? null : wartetNurAufAntwort(dir, nr);
      if (grund) throw new Angehalten(`${grund}; weiter mit --antworten <datei>`);
      await new Promise((r) => setTimeout(r, 3000));
    };
  }
  const einstellung = { repo, epic: nr, epicBranch, basis, fenster: Number(wert(argv, '--fenster') ?? 3), maxRunden: Number(wert(argv, '--max-runden') ?? 3), konto, adapter };
  // Ctrl+C or a kill of the program: the detached calls do not get the signal, so they are ended here too
  const signal = () => {
    echt?.beendeLaufende();
    process.exit(130);
  };
  if (echt) for (const s of ['SIGINT', 'SIGTERM'] as const) process.once(s, signal);
  try {
    const zustand = await fahreEpic(einstellung, u);
    return { zustand, bloecke: u.welt?.bloecke ?? bloecke, ...(u.welt ? { protokoll: u.welt.protokoll } : {}) };
  } catch (f) {
    // no call outlives the program: a restart resumes the ended session (Neustart: nothing starts twice)
    echt?.beendeLaufende();
    if (!(f instanceof Angehalten)) throw f;
    return { angehalten: f.message, zustand: liesLauf(dir, nr), bloecke };
  } finally {
    for (const s of ['SIGINT', 'SIGTERM'] as const) process.off(s, signal);
  }
}

/** owner/repo of the push remote's URL (github.com:owner/repo.git, https://host/owner/repo) */
export function forgeAus(repo: string, remote: string): string {
  const url = aufrufen('git', ['-C', repo, 'remote', 'get-url', remote]).stdout.trim();
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) throw new Error(`Forge aus ${remote} nicht lesbar (${url || 'kein Remote'}); --forge <owner/repo> angeben`);
  return m[1];
}
