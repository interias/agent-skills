// flotte lauf start --repo <dir> --konto <CLAUDE_CONFIG_DIR> --auftrag <datei> [--resume <id>]
//                   [--modell <m>] [--leerlauf-min 30] [--log <datei>]
// flotte lauf lesen <log.jsonl>
// A run is `claude -p` with stream-json, auto mode, no permission prompts, without --bare
// (subscription login), the account by CLAUDE_CONFIG_DIR (#14, decision 2). The order goes in on
// stdin, so its length is no command-line problem. A run is finished when its process ends: it
// stays alive after its first result while background agents report (stage 0, probe 2).

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ausEreignis, schreibe as schreibeVerbrauch, type Verbrauch } from './verbrauch.ts';

export interface Ergebnis {
  text: string;
  istFehler: boolean;
  grund: string | null;
  verweigert: unknown[];
}

export type Fehlerart = 'netz' | 'anmeldung' | 'leerlauf' | 'kein_ergebnis' | 'exit' | null;

export interface LaufErgebnis {
  sitzung: string | null;
  code: number | null;
  leerlauf: boolean;
  ergebnisse: Ergebnis[];
  /** the last non-empty result text: there stands the block */
  text: string;
  verweigert: unknown[];
  verbrauch: Verbrauch | null;
  /** structured_output of the last result that has one (--json-schema) */
  strukturiert: unknown;
  fehler: Fehlerart;
  dauerMs: number;
  stderr: string;
}

/** Evaluates stream-json lines, live or from a log. */
export class Auswertung {
  sitzung: string | null = null;
  ergebnisse: Ergebnis[] = [];
  verbrauch: Verbrauch | null = null;
  strukturiert: unknown = null;
  zeile(roh: string, jetzt = Date.now()): void {
    let d: any;
    try {
      d = JSON.parse(roh);
    } catch {
      return;
    }
    if (d?.session_id && !this.sitzung) this.sitzung = String(d.session_id);
    if (d?.type === 'rate_limit_event' && d.rate_limit_info) this.verbrauch = ausEreignis(d.rate_limit_info, jetzt);
    if (d?.type === 'result') {
      if (d.structured_output !== undefined && d.structured_output !== null) this.strukturiert = d.structured_output;
      this.ergebnisse.push({
        text: typeof d.result === 'string' ? d.result : '',
        istFehler: Boolean(d.is_error),
        grund: d.terminal_reason ?? d.subtype ?? null,
        verweigert: Array.isArray(d.permission_denials) ? d.permission_denials : [],
      });
    }
  }
  ergebnis(code: number | null, leerlauf: boolean, dauerMs: number, stderr: string): LaufErgebnis {
    const text = [...this.ergebnisse].reverse().find((e) => e.text.trim())?.text ?? '';
    const verweigert = this.ergebnisse.flatMap((e) => e.verweigert);
    return { sitzung: this.sitzung, code, leerlauf, ergebnisse: this.ergebnisse, text, verweigert, verbrauch: this.verbrauch, strukturiert: this.strukturiert, fehler: fehlerart(this.ergebnisse, code, leerlauf, stderr), dauerMs, stderr: stderr.slice(-2000) };
  }
}

const NETZ = /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network|Overloaded|\b5\d\d\b|connection error/i;
const ANMELDUNG = /authenticat|OAuth|log ?in|credential/i;

export function fehlerart(ergebnisse: Ergebnis[], code: number | null, leerlauf: boolean, stderr: string): Fehlerart {
  if (leerlauf) return 'leerlauf';
  const letzte = ergebnisse[ergebnisse.length - 1];
  const fehlerText = [letzte?.istFehler ? letzte.text : '', letzte?.grund === 'api_error' ? 'api_error' : '', stderr].join(' ');
  if (ANMELDUNG.test(fehlerText) && (letzte?.istFehler || code !== 0)) return 'anmeldung';
  if ((letzte?.istFehler || code !== 0) && NETZ.test(fehlerText)) return 'netz';
  if (!ergebnisse.length) return 'kein_ergebnis';
  if (code !== 0) return 'exit';
  return null;
}

/** Environment of a run: none of the variables a desktop session hands down, the account set. */
export function laufUmgebung(basis: NodeJS.ProcessEnv, konto: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(basis)) {
    if (/^(CLAUDE|ANTHROPIC_|USE_LOCAL_OAUTH|USE_STAGING_OAUTH)/.test(k) && k !== 'CLAUDE_CONFIG_DIR') continue;
    env[k] = v;
  }
  const standard = resolve(homedir(), '.claude');
  const pfad = resolve(konto.startsWith('~') ? join(homedir(), konto.slice(1)) : konto);
  if (pfad.toLowerCase() !== standard.toLowerCase()) env.CLAUDE_CONFIG_DIR = pfad;
  else delete env.CLAUDE_CONFIG_DIR;
  env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = '0';
  return env;
}

export interface Start {
  repo: string;
  konto: string;
  auftrag: string;
  resume?: string | null;
  modell?: string | null;
  leerlaufMs?: number;
  log?: string | null;
  /** further arguments for claude (--json-schema, --tools, ...) */
  extraArgs?: string[];
  /** called right after the spawn with the pid, before any output (D16) */
  beimStart?: (pid: number) => void;
  /** the program instead of claude: a stand-in that plays a script (stage 3) */
  programm?: string;
  programmArgs?: string[];
}

export function claudeArgs(s: Start): string[] {
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', '--permission-prompts', 'none'];
  if (s.modell) a.push('--model', s.modell);
  if (s.resume) a.push('--resume', s.resume);
  if (s.extraArgs) a.push(...s.extraArgs);
  return a;
}

function beende(pid: number): void {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      process.kill(pid, 'SIGKILL');
    }
  }
}

/** Starts or resumes a run and resolves when its process has ended or idled too long (D5). */
export function starte(s: Start): Promise<LaufErgebnis> {
  const programm = s.programm ?? process.env.FLOTTE_CLAUDE ?? 'claude';
  const args = [...(s.programmArgs ?? []), ...claudeArgs(s)];
  const anfang = Date.now();
  const auswertung = new Auswertung();
  if (s.log) mkdirSync(dirname(s.log), { recursive: true });
  return new Promise((fertig) => {
    const kind = spawn(programm, args, { cwd: s.repo, env: laufUmgebung(process.env, s.konto), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    if (kind.pid) s.beimStart?.(kind.pid);
    let rest = '';
    let stderr = '';
    let leerlauf = false;
    let zuletzt = Date.now();
    const grenze = s.leerlaufMs ?? 30 * 60_000;
    const wache = setInterval(() => {
      if (Date.now() - zuletzt > grenze && kind.pid) {
        leerlauf = true;
        beende(kind.pid);
      }
    }, Math.min(10_000, Math.max(50, grenze / 4)));
    kind.stdout.setEncoding('utf8');
    kind.stdout.on('data', (stueck: string) => {
      zuletzt = Date.now();
      rest += stueck;
      const zeilen = rest.split(/\r?\n/);
      rest = zeilen.pop() ?? '';
      for (const z of zeilen) {
        if (!z.trim()) continue;
        if (s.log) appendFileSync(s.log, z + '\n');
        auswertung.zeile(z);
        if (auswertung.verbrauch) schreibeVerbrauch(s.konto, auswertung.verbrauch);
      }
    });
    kind.stderr.setEncoding('utf8');
    kind.stderr.on('data', (x: string) => {
      zuletzt = Date.now();
      stderr += x;
    });
    kind.on('error', (e) => {
      stderr += String(e.message);
    });
    kind.on('close', (code) => {
      clearInterval(wache);
      if (rest.trim()) {
        if (s.log) appendFileSync(s.log, rest + '\n');
        auswertung.zeile(rest);
      }
      fertig(auswertung.ergebnis(leerlauf ? null : code, leerlauf, Date.now() - anfang, stderr));
    });
    kind.stdin.end(s.auftrag);
  });
}

export function liesLog(datei: string): LaufErgebnis {
  const a = new Auswertung();
  for (const z of readFileSync(datei, 'utf8').split(/\r?\n/)) if (z.trim()) a.zeile(z);
  return a.ergebnis(0, false, 0, '');
}

function wert(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function lauf(argv: string[]): Promise<unknown> {
  const [was, ...rest] = argv;
  if (was === 'lesen' && rest[0]) return liesLog(rest[0]);
  if (was !== 'start') throw new Error('Aufruf: flotte lauf start --repo <dir> --konto <dir> --auftrag <datei> [--resume <id>] [--modell <m>] [--leerlauf-min 30] [--log <datei>] | flotte lauf lesen <log>');
  const repo = wert(rest, '--repo');
  const konto = wert(rest, '--konto');
  const auftrag = wert(rest, '--auftrag');
  if (!repo || !konto || !auftrag) throw new Error('--repo, --konto und --auftrag sind Pflicht');
  return starte({
    repo,
    konto,
    auftrag: readFileSync(auftrag, 'utf8'),
    resume: wert(rest, '--resume') ?? null,
    modell: wert(rest, '--modell') ?? null,
    leerlaufMs: Number(wert(rest, '--leerlauf-min') ?? 30) * 60_000,
    log: wert(rest, '--log') ?? null,
  });
}
