// flotte lauf start --repo <dir> --konto <CLAUDE_CONFIG_DIR> --auftrag <datei> [--resume <id>]
//                   [--modell <m>] [--leerlauf-min 30] [--log <datei>]
// flotte lauf lesen <log.jsonl>
// A run is `claude -p` with stream-json, auto mode, no permission prompts, without --bare
// (subscription login), the account by CLAUDE_CONFIG_DIR (#14, decision 2). The order goes in on
// stdin, so its length is no command-line problem. A run is finished when its process ends: it
// stays alive after its first result while background agents report (stage 0, probe 2).

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ausEreignis, schreibe as schreibeVerbrauch, type Verbrauch } from './verbrauch.ts';
import { lebt } from './zustand.ts';

export interface Ergebnis {
  text: string;
  istFehler: boolean;
  grund: string | null;
  verweigert: unknown[];
}

/** a PreToolUse hook (guard.ps1) refused a tool call; the run saw the reason and can change its way */
export interface HookSperre {
  id: string;
  /** "Skill epic, Regel 1" from guard.ps1's text, else the start of the text */
  regel: string;
  text: string;
}

const HOOK = /^(?:Error: )?PreToolUse:\w+ hook error:\s*/;

export function hookRegel(text: string): string {
  const t = text.replace(HOOK, '');
  return /Gesperrt durch Hook \(([^:)]+)/.exec(t)?.[1].trim() ?? t.slice(0, 80);
}

export type Fehlerart = 'netz' | 'anmeldung' | 'leerlauf' | 'werkzeuge' | 'kein_ergebnis' | 'exit' | null;

const kurz = (s: unknown, n = 100) => String(s ?? '').split(/\r?\n/).find((z) => z.trim())?.trim().slice(0, n) ?? '';

/** What a stream-json line shows of the run's work, for the board and `flotte zuschauen` (C4); null: nothing. */
export function schrittAus(d: any): string | null {
  if (d?.type === 'result') return `Zugende${d.is_error ? ' (Fehler)' : ''}: ${kurz(d.result, 80)}`;
  if (d?.type !== 'assistant' || !Array.isArray(d.message?.content)) return null;
  const unter = d.parent_tool_use_id ? '↳ ' : '';
  let s: string | null = null;
  for (const c of d.message.content) {
    if (c?.type === 'text' && c.text?.trim()) s = `${unter}${kurz(c.text)}`;
    if (c?.type !== 'tool_use') continue;
    const i = c.input ?? {};
    const was = i.command ?? i.skill ?? i.description ?? i.file_path ?? i.pattern ?? i.url ?? '';
    s = `${unter}${c.name}${was ? `: ${kurz(was)}` : ''}`;
  }
  return s;
}

export interface LaufErgebnis {
  sitzung: string | null;
  code: number | null;
  leerlauf: boolean;
  ergebnisse: Ergebnis[];
  /** the last non-empty result text: there stands the block */
  text: string;
  verweigert: unknown[];
  /** the denials a hook made (part of verweigert, matched by tool_use_id) */
  sperren: HookSperre[];
  verbrauch: Verbrauch | null;
  /** structured_output of the last result that has one (--json-schema) */
  strukturiert: unknown;
  /** the model the init event names */
  modell?: string | null;
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
  /** the tool list of the init event */
  werkzeuge: string[] | null = null;
  modell: string | null = null;
  sperren: HookSperre[] = [];
  /** the last step of the run (schrittAus) */
  schritt: string | null = null;
  zeile(roh: string, jetzt = Date.now()): void {
    let d: any;
    try {
      d = JSON.parse(roh);
    } catch {
      return;
    }
    this.schritt = schrittAus(d) ?? this.schritt;
    if (d?.session_id && !this.sitzung) this.sitzung = String(d.session_id);
    if (d?.type === 'system' && d.subtype === 'init' && Array.isArray(d.tools)) this.werkzeuge = d.tools.map(String);
    if (d?.type === 'system' && d.subtype === 'init' && typeof d.model === 'string') this.modell = d.model;
    if (d?.type === 'rate_limit_event' && d.rate_limit_info) this.verbrauch = ausEreignis(d.rate_limit_info, jetzt);
    if (d?.type === 'user' && Array.isArray(d.message?.content)) {
      for (const c of d.message.content) {
        if (c?.type !== 'tool_result' || !c.is_error) continue;
        const text = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x: any) => x?.text ?? '').join('') : '';
        if (HOOK.test(text)) this.sperren.push({ id: String(c.tool_use_id ?? ''), regel: hookRegel(text), text: text.replace(HOOK, '').slice(0, 300) });
      }
    }
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
    return { sitzung: this.sitzung, code, leerlauf, ergebnisse: this.ergebnisse, text, verweigert, sperren: this.sperren, verbrauch: this.verbrauch, strukturiert: this.strukturiert, modell: this.modell, fehler: fehlerart(this.ergebnisse, code, leerlauf, stderr), dauerMs, stderr: stderr.slice(-2000) };
  }
}

// narrow on purpose (acceptance, low): a 5xx number or "login" anywhere in a text is no evidence
const NETZ = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network error|Overloaded|API Error: (500|502|503|504|529)\b|connection error/i;
const ANMELDUNG = /Failed to authenticate|OAuth (token|session) (has )?expired|not logged in|Please run \/login|Invalid API key|authentication_error/i;

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
  /** further environment variables for the run (EPIC_LOCK_HOLDER) */
  env?: Record<string, string>;
  /** checks the tool list of the init event; a text names what is wrong and the run is killed */
  werkzeuge?: (tools: string[]) => string | null;
  /** called right after the spawn with the pid, before any output (D16) */
  beimStart?: (pid: number) => void;
  /** a new step of the run, or its silence while a child process lives (C1, C4) */
  beiSchritt?: (schritt: string) => void;
  /** every log line with the moment it was read (#51: the detail view derives phase and round from them) */
  beiZeile?: (zeile: string, zeit: number) => void;
  /** silence with a living child process counts as work up to this long (C1); default 4 × leerlaufMs */
  stilleMaxMs?: number;
  /** the program instead of claude: a stand-in that plays a script (stage 3) */
  programm?: string;
  programmArgs?: string[];
}

export function claudeArgs(s: Start): string[] {
  // --strict-mcp-config: no MCP server of the account, no claude.ai connector (acceptance finding 2)
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', '--permission-prompts', 'none', '--strict-mcp-config'];
  if (s.modell) a.push('--model', s.modell);
  if (s.resume) a.push('--resume', s.resume);
  if (s.extraArgs) a.push(...s.extraArgs);
  return a;
}

export function beende(pid: number): void {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      process.kill(pid, 'SIGKILL');
    }
  }
}

/**
 * Starts or resumes a run and resolves when its process has ended or idled too long (D5). The run
 * writes stream-json straight into its log (stderr next to it as <log>.err) in a process group of
 * its own: when the driver dies or gets Ctrl+C, the run finishes its turn and the restarted driver
 * reads the rest from the log (D16, acceptance finding 10).
 */
export function starte(s: Start): Promise<LaufErgebnis> {
  const programm = s.programm ?? process.env.FLOTTE_CLAUDE ?? 'claude';
  const args = [...(s.programmArgs ?? []), ...claudeArgs(s)];
  const log = s.log ?? join(tmpdir(), `flotte-lauf-${process.pid}-${Date.now()}.jsonl`);
  mkdirSync(dirname(log), { recursive: true });
  const ab = existsSync(log) ? statSync(log).size : 0;
  const errAb = existsSync(`${log}.err`) ? statSync(`${log}.err`).size : 0;
  const out = openSync(log, 'a');
  const err = openSync(`${log}.err`, 'a');
  const env = { ...laufUmgebung(process.env, s.konto), ...(s.env ?? {}) };
  const kind = spawn(programm, args, { cwd: s.repo, env, stdio: ['pipe', out, err], windowsHide: true, detached: true });
  closeSync(out);
  closeSync(err);
  if (kind.pid) s.beimStart?.(kind.pid);
  const ende = new Promise<number | null>((fertig) => {
    kind.on('error', () => fertig(null));
    kind.on('close', (code) => fertig(code));
  });
  kind.stdin?.on('error', () => {});
  kind.stdin?.end(s.auftrag);
  return beobachte({ log, ab, errAb, pid: kind.pid ?? null, ende, leerlaufMs: s.leerlaufMs, konto: s.konto, werkzeuge: s.werkzeuge, beenden: true, beiSchritt: s.beiSchritt, beiZeile: s.beiZeile, stilleMaxMs: s.stilleMaxMs });
}

/**
 * The names of the living descendants of a process (a gate, a test run the run started), without
 * conhost.exe, which Windows hangs on every console program. Empty when none lives or the process
 * table is unreadable.
 */
export function kinderVon(pid: number): Promise<string[]> {
  const [programm, args] =
    process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }']]
      : ['ps', ['-A', '-o', 'pid=,ppid=,comm=']];
  return new Promise((fertig) => {
    const k = spawn(programm as string, args as string[], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    k.stdout?.setEncoding('utf8').on('data', (x: string) => (out += x));
    k.on('error', () => fertig([]));
    k.on('close', () => {
      const kinder = new Map<number, { pid: number; name: string }[]>();
      for (const z of out.split(/\r?\n/)) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(z);
        if (!m) continue;
        const eintrag = { pid: Number(m[1]), name: m[3] };
        kinder.set(Number(m[2]), [...(kinder.get(Number(m[2])) ?? []), eintrag]);
      }
      const namen: string[] = [];
      const offen = [pid];
      const gesehen = new Set<number>();
      while (offen.length) {
        const p = offen.pop()!;
        for (const k of kinder.get(p) ?? []) {
          if (gesehen.has(k.pid) || k.pid === p) continue;
          gesehen.add(k.pid);
          offen.push(k.pid);
          if (!/^conhost(\.exe)?$/i.test(k.name)) namen.push(k.name);
        }
      }
      fertig(namen);
    });
  });
}

export interface Beobachtung {
  log: string;
  /** byte offsets where this turn starts in the log and in <log>.err */
  ab?: number;
  errAb?: number;
  pid: number | null;
  /** the exit code once the process ended; without it (a run of an earlier driver) the pid is polled */
  ende?: Promise<number | null>;
  leerlaufMs?: number;
  konto: string;
  werkzeuge?: (tools: string[]) => string | null;
  /** false: the identity of the pid is not proven, so it is never killed (D16) */
  beenden: boolean;
  beiSchritt?: (schritt: string) => void;
  beiZeile?: (zeile: string, zeit: number) => void;
  stilleMaxMs?: number;
  /** the living descendants of the run's process (C1); replaceable in tests */
  kinder?: (pid: number) => Promise<string[]>;
}

/** Follows the log of a run until its process ends, kills it on idling or on a forbidden tool list. */
export function beobachte(b: Beobachtung): Promise<LaufErgebnis> {
  const anfang = Date.now();
  const auswertung = new Auswertung();
  const grenze = b.leerlaufMs ?? 60 * 60_000;
  let pos = b.ab ?? 0;
  let errPos = b.errAb ?? 0;
  let rest = '';
  let stderr = '';
  let leerlauf = false;
  let werkzeugFehler: string | null = null;
  let zuletzt = Date.now();
  // C1: silence while a child process lives (a gate, a test run) is work, up to stilleMax
  const stilleMax = b.stilleMaxMs ?? 4 * grenze;
  const kinder = b.kinder ?? kinderVon;
  let kindBis = 0;
  let pruefe = false;
  let ohneKind = false;
  let letzterSchritt: string | null = null;
  let code: number | null | undefined;
  b.ende?.then((c) => (code = c));
  const lies = (datei: string, von: number): { text: string; bis: number } => {
    if (!existsSync(datei)) return { text: '', bis: von };
    const groesse = statSync(datei).size;
    if (groesse <= von) return { text: '', bis: von };
    const fd = openSync(datei, 'r');
    try {
      const puffer = Buffer.alloc(groesse - von);
      readSync(fd, puffer, 0, puffer.length, von);
      return { text: puffer.toString('utf8'), bis: groesse };
    } finally {
      closeSync(fd);
    }
  };
  const zeilen = (text: string) => {
    rest += text;
    const teile = rest.split(/\r?\n/);
    rest = teile.pop() ?? '';
    for (const z of teile) {
      if (!z.trim()) continue;
      auswertung.zeile(z);
      b.beiZeile?.(z, Date.now());
      if (auswertung.schritt && auswertung.schritt !== letzterSchritt) {
        letzterSchritt = auswertung.schritt;
        b.beiSchritt?.(letzterSchritt);
      }
      if (auswertung.verbrauch) schreibeVerbrauch(b.konto, auswertung.verbrauch);
      if (auswertung.werkzeuge && b.werkzeuge && werkzeugFehler === null) {
        werkzeugFehler = b.werkzeuge(auswertung.werkzeuge);
        if (werkzeugFehler && b.pid && b.beenden) beende(b.pid);
      }
    }
  };
  const schritt = () => {
    const o = lies(b.log, pos);
    const e = lies(`${b.log}.err`, errPos);
    if (o.bis > pos || e.bis > errPos) {
      zuletzt = Date.now();
      ohneKind = false;
    }
    pos = o.bis;
    errPos = e.bis;
    stderr += e.text;
    if (o.text) zeilen(o.text);
  };
  return new Promise((fertig) => {
    const takt = Math.min(250, Math.max(20, grenze / 4));
    const uhr = setInterval(() => {
      schritt();
      const vorbei = b.ende ? code !== undefined : !b.pid || !lebt(b.pid);
      if (!vorbei && !leerlauf && Date.now() - Math.max(zuletzt, kindBis) > grenze) {
        if (b.pid && !ohneKind && Date.now() - zuletzt < stilleMax) {
          if (pruefe) return;
          pruefe = true;
          kinder(b.pid).then((namen) => {
            pruefe = false;
            if (!namen.length) {
              ohneKind = true;
              return;
            }
            kindBis = Date.now();
            b.beiSchritt?.(`still seit ${Math.round((Date.now() - zuletzt) / 60_000)} min, Kindprozess lebt: ${[...new Set(namen)].slice(0, 4).join(', ')}`);
          });
          return;
        }
        leerlauf = true;
        if (b.pid && b.beenden) beende(b.pid);
        // a pid of unproven identity is not killed: stop following it
        if (!b.beenden) code = null;
        return;
      }
      if (!vorbei && !(leerlauf && !b.beenden)) return;
      clearInterval(uhr);
      schritt();
      if (rest.trim()) zeilen('\n');
      const c = b.ende ? (code ?? null) : auswertung.ergebnisse.length ? 0 : null;
      const r = auswertung.ergebnis(leerlauf ? null : c, leerlauf, Date.now() - anfang, stderr);
      if (werkzeugFehler) {
        r.fehler = 'werkzeuge';
        r.stderr = `${werkzeugFehler}\n${r.stderr}`.slice(-2000);
      }
      fertig(r);
    }, takt);
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
