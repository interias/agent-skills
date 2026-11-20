// The world around the driver for the scripts D1–D21: a real empty git repository, a forge stand-in
// for gh, stand-ins for the pwsh scripts, fresh usage files per account. Runs go to the stand-in
// claude (src/attrappe.ts) through the real `starte`.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { aufrufen, type Aufrufer, type AsyncAufrufer, type Ergebnis } from '../src/aufruf.ts';
import { standard, type Einstellung, type Welt } from '../src/treiber/treiber.ts';
import { starte } from '../src/werkzeuge/lauf.ts';
import { startZeit } from '../src/werkzeuge/zustand.ts';
import { schreibe as schreibeVerbrauch } from '../src/werkzeuge/verbrauch.ts';
import { drehbuch, mitAttrappe } from './attrappe.ts';

const H = 3_600_000;

/** the script a pwsh call runs: the argument after -File */
export const skriptVon = (args: string[]) => basename(args[args.indexOf('-File') + 1] ?? '');

export interface Optionen {
  /** issue bodies by number; default: each epic its own module */
  bodies?: Record<number, string>;
  /** labels per issue (prio/hoch, status/in-arbeit), titles, closed issues */
  labels?: Record<number, string[]>;
  titel?: Record<number, string>;
  zu?: number[];
  /** frontmatter lines of .claude/epic.md */
  adapter?: string;
  /** JSON lines of ram.ps1 in order, the last one repeats; null: the measurement fails */
  ram?: (string | null)[];
  frei?: number | null;
  /** merge.ps1 output per call */
  merge?: (pr: number, n: number) => string;
  /** state of a PR per call of `gh pr view` */
  pr?: (pr: number, n: number) => { state: string; mergeable?: string };
  /** exit code of a nach_merge command */
  nachMerge?: number;
  /** usage share of the 5-hour window per account; null: no file; 'alt': 40 min old */
  verbrauch?: (number | null | 'alt')[];
  /** text of the installed merge.ps1; default: a version that knows the key merge */
  mergeSkript?: string;
  /** how long merge.ps1 takes (it waits for checks) */
  mergeDauerMs?: number;
  /** an existing repository and accounts instead of fresh ones (a second driver process, D16) */
  vorhanden?: { repo: string; konten: string[] };
  /** merge.ps1 as a function of the call (async: it may merge for real); wins over merge */
  mergeEcht?: (pr: number, n: number) => string;
  /** the gate command of the adapter (-Command starting with "gate"): output and exit code */
  gate?: (befehl: string, cwd: string, n: number) => { code: number; stdout: string };
  /** `gh pr view --json headRefName,...` of a PR; default: open, on epic/<pr - 10>-x, with GATE_BODY */
  prInfo?: (pr: number) => { state?: string; headRefName: string; baseRefName: string; headRefOid: string; body: string };
  /** worktree.ps1 -Action Up/Down: stdout; without it Up and Down count as CleanupStale */
  worktree?: (aktion: string, args: string[], env: Record<string, string> | undefined) => string;
  /** the forge's open issues with ready-for-agent and with epic, per call (without --epics) */
  freigegeben?: () => { bereit: number[]; epics: { number: number; body?: string }[] };
}

export interface Protokoll {
  aufrufe: string[][];
  kommentare: { nr: number; text: string }[];
  logbuch: string[];
  merges: number[];
  aufraeumen: number;
  sweeps: number;
  nachMerge: string[];
  meldungen: string[];
  zeitleiste: string[];
  /** bodies written with `gh pr edit` */
  prEdits: { pr: number; body: string }[];
  gates: { befehl: string; cwd: string }[];
}

export function aufbau(o: Optionen = {}) {
  const repo = o.vorhanden?.repo ?? mkdtempSync(join(tmpdir(), 'flotte-repo-'));
  if (!o.vorhanden) {
    aufrufen('git', ['init', '-q', repo]);
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'epic.md'), `---\n${o.adapter ?? 'merge: mensch'}\n---\n# Adapter\n`);
    mkdirSync(join(repo, 'skripte'));
    writeFileSync(join(repo, 'skripte', 'merge.ps1'), o.mergeSkript ?? '# merge: nach_gate, gate_heading\n');
  }
  const verbrauch = o.verbrauch ?? [0.1, 0.1];
  const konten = o.vorhanden?.konten ?? verbrauch.map((anteil, i) => {
    const k = mkdtempSync(join(tmpdir(), `flotte-konto${i + 1}-`));
    if (anteil !== null) {
      const zeit = anteil === 'alt' ? Date.now() - 40 * 60_000 : Date.now();
      schreibeVerbrauch(k, { zeit, fuenf: { anteil: anteil === 'alt' ? 0.1 : anteil, reset: Date.now() + 3 * H }, sieben: { anteil: 0.1, reset: Date.now() + 5 * 24 * H } });
    }
    return k;
  });
  const p: Protokoll = { aufrufe: [], kommentare: [], logbuch: [], merges: [], aufraeumen: 0, sweeps: 0, nachMerge: [], meldungen: [], zeitleiste: [], prEdits: [], gates: [] };
  let gateN = 0;
  let ramN = 0;
  const prN = new Map<number, number>();
  const mergeN = new Map<number, number>();
  const ok = (stdout = ''): Ergebnis => ({ code: 0, stdout, stderr: '' });

  const aufrufer: Aufrufer = (programm, args, opts) => {
    p.aufrufe.push([programm, ...args]);
    if (programm === 'git') return aufrufen(programm, args, opts);
    if (programm !== 'gh') return { code: 1, stdout: '', stderr: `unerwartet: ${programm}` };
    const [a, b] = args;
    const nr = Number(args[2]);
    if (a === 'issue' && b === 'view') return ok(JSON.stringify({ body: o.bodies?.[nr] ?? `## Betroffene Module\n- m${nr}\n`, labels: (o.labels?.[nr] ?? []).map((name) => ({ name })), title: o.titel?.[nr] ?? '', state: o.zu?.includes(nr) ? 'CLOSED' : 'OPEN', closedAt: o.zu?.includes(nr) ? '2026-01-01T10:00:00Z' : null }));
    if (a === 'issue' && b === 'comment') {
      p.kommentare.push({ nr, text: opts?.eingabe ?? '' });
      return ok();
    }
    if (a === 'issue' && b === 'list') {
      // without --epics: the open issues with ready-for-agent and with epic (the adapter's defaults)
      const label = args[args.indexOf('--label') + 1];
      const f = o.freigegeben?.();
      if (f && label === 'ready-for-agent') return ok(JSON.stringify(f.bereit.map((n) => ({ number: n }))));
      if (f && label === 'epic') return ok(JSON.stringify(f.epics.map((e) => ({ body: '', ...e }))));
      return ok('[]');
    }
    if (a === 'label') return ok();
    if (a === 'repo' && b === 'view') return ok('main\n');
    if (a === 'issue' && b === 'create') return ok('https://github.com/o/r/issues/99\n');
    if (a === 'issue' && b === 'edit') {
      p.logbuch.push(opts?.eingabe ?? '');
      return ok();
    }
    if (a === 'pr' && b === 'view' && args.join(' ').includes('headRefName')) return ok(JSON.stringify({ state: 'OPEN', ...(o.prInfo?.(nr) ?? { headRefName: `epic/${nr - 10}-x`, baseRefName: 'main', headRefOid: `bbbbbbbb${'2'.repeat(32)}`, body: GATE_BODY }) }));
    if (a === 'pr' && b === 'edit') {
      p.prEdits.push({ pr: nr, body: opts?.eingabe ?? '' });
      return ok();
    }
    if (a === 'pr' && b === 'view') {
      const n = (prN.get(nr) ?? 0) + 1;
      prN.set(nr, n);
      const s = o.pr?.(nr, n) ?? { state: 'MERGED' };
      if (s.state === 'MERGED') p.zeitleiste.push(`gemergt ${nr}`);
      return ok(JSON.stringify({ state: s.state, mergeable: s.mergeable ?? 'MERGEABLE', url: `https://github.com/o/r/pull/${nr}` }));
    }
    return { code: 1, stdout: '', stderr: `gh unerwartet: ${args.join(' ')}` };
  };

  const langsam: AsyncAufrufer = async (programm, args, opts) => {
    p.aufrufe.push([programm, ...args]);
    if (programm === 'git') return aufrufen(programm, args, opts);
    const skript = skriptVon(args);
    const befehl = args[args.indexOf('-Command') + 1] ?? '';
    if (args.includes('-Command') && befehl.startsWith('gate') && o.gate) {
      p.gates.push({ befehl, cwd: opts?.cwd ?? '' });
      p.zeitleiste.push(`gate ${befehl}`);
      return { ...o.gate(befehl, opts?.cwd ?? '', ++gateN), stderr: '' };
    }
    if (skript === 'ram.ps1') {
      const liste = o.ram ?? ['{"level":"ok","percent_used":50,"free_gb":30}'];
      const z = liste[Math.min(ramN++, liste.length - 1)];
      return z === null ? { code: 1, stdout: '', stderr: 'kaputt' } : ok(z);
    }
    if (skript === 'merge.ps1') {
      const pr = Number(args[args.indexOf('-Pr') + 1]);
      const n = (mergeN.get(pr) ?? 0) + 1;
      mergeN.set(pr, n);
      p.merges.push(pr);
      if (o.mergeDauerMs) await new Promise((r) => setTimeout(r, o.mergeDauerMs));
      const zeile = o.mergeEcht?.(pr, n) ?? o.merge?.(pr, n) ?? `GEMERGT #${pr} -> main`;
      if (zeile.startsWith('GEMERGT')) p.zeitleiste.push(`gemergt ${pr}`);
      return ok(`${zeile}\n`);
    }
    const aktion = args[args.indexOf('-Action') + 1];
    if (skript === 'worktree.ps1' && o.worktree && aktion !== 'CleanupStale') {
      p.zeitleiste.push(`worktree ${aktion}`);
      return ok(o.worktree(aktion, args, opts?.env));
    }
    if (skript === 'worktree.ps1') {
      p.aufraeumen++;
      p.zeitleiste.push('aufraeumen');
      return ok('[]');
    }
    if (skript === 'sweep.ps1') {
      p.sweeps++;
      return ok('[]');
    }
    const c = args.indexOf('-Command');
    if (c >= 0) {
      p.nachMerge.push(args[c + 1]);
      p.zeitleiste.push(`nach_merge ${args[c + 1]}`);
      return { code: o.nachMerge ?? 0, stdout: '', stderr: o.nachMerge ? 'fehlgeschlagen' : '' };
    }
    return { code: 1, stdout: '', stderr: 'unerwartet' };
  };

  const welt: Welt = {
    aufrufer,
    langsam,
    starte,
    freiGb: () => (o.frei === undefined ? 100 : o.frei),
    startZeit: (pid) => startZeit(pid),
    jetzt: Date.now,
    melde: (z) => {
      p.meldungen.push(z);
      p.zeitleiste.push(z);
    },
  };

  function einstellung(buch: { datei: string }, epics: number[], e: Partial<Einstellung> = {}): Einstellung {
    return {
      ...standard(repo, 'o/r', epics, konten),
      ...mitAttrappe(buch.datei),
      skripte: join(repo, 'skripte'),
      mergeSkript: join(repo, 'skripte', 'merge.ps1'),
      admiralModell: null,
      admiralEffort: null,
      taktMs: 20,
      leerlaufMs: 20_000,
      maxDauerMs: 20_000,
      ...e,
    };
  }

  return { repo, konten, p, welt, einstellung };
}

// ---- script building blocks for the stand-in

export const lauf = (nr: number, schritte: unknown[], exit?: number) => ({ wenn: `^Flotte, Epic #${nr}\\b`, sitzung: `s${nr}`, schritte, ...(exit === undefined ? {} : { exit }) });

export const frage = (nr: number, phase: string, fragen: { betrifft?: string; empfehlung?: string }[]) =>
  [`Bericht.`, ``, `FLOTTE-FRAGE ${nr} ${phase}`, ...fragen.map((f, i) => `${i + 1}. Frage ${i + 1} zu #${nr}?${f.betrifft === undefined ? '' : ` — Betrifft: ${f.betrifft}`} — Lage: Sachverhalt — Optionen: A) vorsichtig B) riskant — Empfehlung: ${f.empfehlung ?? 'A'} — Grund: sicher — Regel/Quelle: Skill`), `STAND: Tor  TAFEL: http://tafel`].join('\n');

export const ende = (nr: number, pr: number, offen = 'keine') => `Fertig.\n\nFLOTTE-ENDE ${nr} https://github.com/o/r/pull/${pr}\n\n### Was das Epic offen lässt\n${offen}`;

export const admiral = (nr: number, antworten: { nr: number; antwort: string; beim_menschen: boolean; einflussreich?: boolean }[]) => ({
  wenn: `^FLOTTE-ADMIRAL[\\s\\S]*FLOTTE-FRAGE ${nr} `,
  schritte: [{ zeile: { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { antworten: antworten.map((a) => ({ herkunft: 'Skill-Empfehlung', grund: 'vorsichtig', einflussreich: false, ...a })) } } }],
});

/** the gate block of the default PR (prInfo) */
export const GATE_BLOCK = '== Gate: Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)\n  web grün 0:50\nGate grün.';
export const GATE_BODY = `## Pakete\n- eins\n\n## Gate\n\`\`\`\n${GATE_BLOCK}\n\`\`\`\n`;

let werkzeugId = 0;

/**
 * Two steps of a run: a tool call and its result (acceptance 3, finding 2). Only a Bash or
 * PowerShell call of the gate command proves a gate run; spread them into the steps.
 */
export const werkzeug = (name: string, input: Record<string, unknown>, text: string, o: { parent?: string } = {}) => {
  const id = `toolu_${++werkzeugId}`;
  const p = o.parent ? { parent_tool_use_id: o.parent } : {};
  return [
    { zeile: { type: 'assistant', ...p, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } } },
    { zeile: { type: 'user', ...p, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } } },
  ];
};

/** the run called the gate command of the test adapters (gate_command: gate voll) */
export const gateAufruf = (text: string, befehl = 'gate voll') => werkzeug('Bash', { command: befehl }, text);

/** the run ran the gate of the default PR */
export const gateGefahren = () => gateAufruf(`> gate\n${GATE_BLOCK}\n`);

export const ping =(anteil: number) => ({ wenn: '^FLOTTE-PING', schritte: [{ verbrauch: [anteil, 0.1] }, { text: 'OK' }] });

export { drehbuch };
