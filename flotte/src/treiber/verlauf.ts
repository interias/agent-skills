// Tag J: the history of a mission's runs for the bridge, condensed from the logs of its runs (stream-json): the run's
// text, one line per tool call in plain words with its target and time, subagents as groups with role and package.
// Never a tool's output. Before anything leaves the machine, secrets are masked and local paths shortened (relative to
// the worktree, else below ~). The same translation gives the card its sentence while the run works (klartextAus).
// The bridge stores what the driver sends and draws it (flottenbruecke/SCHNITTSTELLE.md, POST /api/verlauf).

import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { gateKern } from './gate.ts';

export interface VerlaufEintrag {
  id: string;
  art: 'text' | 'werkzeug' | 'gruppe' | 'frage' | 'entscheidung';
  /** ISO; null when no line said a time */
  zeit: string | null;
  /** text: what the run said; werkzeug: the target; gruppe: its title; frage, entscheidung: the question, the answer */
  text: string;
  /** the id of the group (the subagent's call) the entry belongs to */
  gruppe?: string;
  wz?: string;
  /** the raw command, masked and shortened; the bridge shows it folded */
  roh?: string;
  stand?: 'laeuft' | 'fertig' | 'fehler' | 'abgebrochen';
  bis?: string;
  rolle?: string;
  paket?: string;
  von?: string;
}

export interface Werkzeug {
  wz: string;
  ziel: string;
  roh: string | null;
}

export interface VerlaufOptionen {
  /** the gate commands of the adapter */
  gate?: string[];
  /** the worktrees and the repository: a path below one becomes relative */
  wurzeln?: string[];
}

/** what the bridge takes per field (flottenbruecke/app/modelle.py, VerlaufEintrag) */
const TEXT_MAX = 2000;
const ZIEL_MAX = 300;

// ---- masking

const STERNE = '***';
/** names that say their value is secret, in an assignment, a header or an option */
const NAME = String.raw`[\w.-]*(?:token|secret|passw(?:or)?d|passwort|api[_-]?key|access[_-]?key|private[_-]?key|_key|schluessel|credential)[\w.-]*|[\w.-]*_pass[\w.-]*|[\w.-]*[-_]pin`;
const GEHEIM: [RegExp, string][] = [
  [/\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,})/g, STERNE],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, STERNE],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, STERNE],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, STERNE],
  [/\bAKIA[0-9A-Z]{16}\b/g, STERNE],
  [/\b(?:sk_(?:live|test)_[A-Za-z0-9]{10,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,})/g, STERNE],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, STERNE],
  // curl -u user:pw, mysql -pPW, ConvertTo-SecureString "pw", gh secret set … --body "value"
  [/((?:^|\s)(?:-u|--user)\s+[^\s:]+:)("[^"]*"|'[^']*'|\S+)/g, `$1${STERNE}`],
  [/(\bmysql(?:dump)?\b[^\n]*?\s-p)([^\s-]\S*)/g, `$1${STERNE}`],
  [/(ConvertTo-SecureString\s+(?:-String\s+)?)("[^"]*"|'[^']*'|\S+)/gi, `$1${STERNE}`],
  [/(\bgh secret set\b[^\n]*?(?:--body|-b)[ =])("[^"]*"|'[^']*'|\S+)/g, `$1${STERNE}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, STERNE],
  [/\b(Authorization\s*:\s*(?:Bearer|Basic|token)\s+)[^\s"']+/gi, `$1${STERNE}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${STERNE}`],
  // credentials in a URL
  [/(\/\/[^\s/:@]+:)[^\s/@]+@/g, `$1${STERNE}@`],
  // NAME=value, NAME: value, "name": "value", --name value
  [new RegExp(String.raw`((?:${NAME})["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s;&|,"']+)`, 'gi'), `$1${STERNE}`],
  [new RegExp(String.raw`(--(?:${NAME}|token|password|passwort|secret|pin)[ =])("[^"]*"|'[^']*'|\S+)`, 'gi'), `$1${STERNE}`],
  // a PowerShell parameter: -Password x, -NuGetApiKey x
  [new RegExp(String.raw`((?:^|\s)-(?:${NAME}|token|password|passwort|secret)\s+)("[^"]*"|'[^']*'|\S+)`, 'gi'), `$1${STERNE}`],
];

/** Masks tokens, keys and passwords: known token shapes, and the value of anything named like a secret. */
export function maskiere(text: string): string {
  let t = text;
  for (const [muster, ersatz] of GEHEIM) t = t.replace(muster, ersatz);
  // a value masked twice (a name and a known shape) reads once
  return t.replace(/\*{3}(?:\*{3})+/g, STERNE);
}

// ---- paths

const flucht = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** C:\a\b, C:/a/b and /c/a/b of one root, as a pattern that matches any slash */
function wurzelMuster(wurzel: string): string | null {
  const w = wurzel.replace(/[\\/]+$/, '');
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(w);
  const teile = (m ? m[2] : w.replace(/^[\\/]+/, '')).split(/[\\/]+/).filter(Boolean);
  if (!teile.length) return null;
  const rest = teile.map(flucht).join(String.raw`[\\/]+`);
  return m ? String.raw`(?:${m[1]}:[\\/]+|/${m[1].toLowerCase()}/)${rest}` : String.raw`/${rest}`;
}

/**
 * Local paths shortened: below a root (the longest first) relative to it, the root itself `.`; any other path in a
 * user's folder below `~`. Without a user name or a machine's layout in what the bridge stores.
 */
export function kuerzePfade(text: string, wurzeln: string[]): string {
  let t = text;
  for (const w of [...wurzeln].sort((a, b) => b.length - a.length)) {
    const m = wurzelMuster(w);
    if (!m) continue;
    t = t.replace(new RegExp(`${m}(?:[\\\\/]+|(?![\\w.-]))`, 'gi'), (treffer) => (/[\\/]$/.test(treffer) ? '' : '.'));
  }
  return t.replace(/\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`;|&]+/gi, '~').replace(/(^|[^\w.-])\/[a-z]\/Users\/[^/\s"'`;|&]+/gi, '$1~');
}

/** cut to n code units without splitting a surrogate pair (the bridge stores UTF-8) */
const schnitt = (s: string, n: number) => s.slice(0, n).replace(/[\uD800-\uDBFF]$/, '');
const sauber = (s: string, o: VerlaufOptionen, n = TEXT_MAX) => schnitt(maskiere(kuerzePfade(s, o.wurzeln ?? [])), n);
const ersteZeile = (s: unknown) => String(s ?? '').split(/\r?\n/).find((z) => z.trim())?.trim() ?? '';
const pfad = (p: unknown, o: VerlaufOptionen) => sauber(String(p ?? ''), o, ZIEL_MAX).replace(/\\/g, '/');

// ---- translation

const TESTS = /\b(?:pytest|py\.test|bun test|vitest|jest|mocha|playwright test|(?:npm|pnpm|yarn) (?:run )?test\b|Invoke-Pester|go test|cargo test|dotnet test|unittest)\b/i;
const NICHT_ZEIGEN = new Set(['ToolSearch', 'TodoWrite', 'TaskOutput', 'TaskList', 'TaskGet', 'TaskUpdate', 'TaskCreate', 'ExitPlanMode', 'EnterPlanMode']);

function shellArt(befehl: string, gate: string[]): string {
  const kerne = gate.map(gateKern).filter(Boolean);
  if (kerne.some((k) => befehl.includes(k))) return 'Andockprüfung';
  if (/\bgh pr\b|\bgh api\b[^|;&]*\/pulls\b/.test(befehl)) return 'Pull Request';
  if (TESTS.test(befehl)) return 'Tests';
  if (/\bgit commit\b/.test(befehl)) return 'Commit';
  if (/\bgh issue\b|\bgh api\b[^|;&]*\/issues\b/.test(befehl)) return 'Ticket';
  if (/\bgit (?:push|pull|fetch|merge|rebase|checkout|switch|worktree|cherry-pick|reset)\b/.test(befehl)) return 'Git';
  return 'Befehl';
}

/** A tool call in plain words: its kind, its target, the raw command (shell only); null: bookkeeping, not shown. */
export function uebersetze(name: string, input: Record<string, unknown>, o: VerlaufOptionen = {}): Werkzeug | null {
  if (NICHT_ZEIGEN.has(name)) return null;
  const i = input ?? {};
  const beschreibung = typeof i.description === 'string' ? sauber(ersteZeile(i.description), o, ZIEL_MAX) : '';
  switch (name) {
    case 'Read':
      return { wz: 'Lesen', ziel: pfad(i.file_path, o), roh: null };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { wz: 'Bearbeiten', ziel: pfad(i.file_path ?? i.notebook_path, o), roh: null };
    case 'Write':
      return { wz: 'Schreiben', ziel: pfad(i.file_path, o), roh: null };
    case 'Grep':
      return { wz: 'Suchen', ziel: `„${sauber(String(i.pattern ?? ''), o, 120)}“${i.path ? ` in ${pfad(i.path, o)}` : ''}`, roh: null };
    case 'Glob':
      return { wz: 'Suchen', ziel: `${sauber(String(i.pattern ?? ''), o, 120)}${i.path ? ` in ${pfad(i.path, o)}` : ''}`, roh: null };
    case 'Bash':
    case 'PowerShell': {
      const befehl = String(i.command ?? '');
      const wz = shellArt(befehl, o.gate ?? []);
      const roh = sauber(befehl, o);
      return { wz, ziel: wz === 'Andockprüfung' ? 'des Laufs' : beschreibung || sauber(ersteZeile(befehl), o, ZIEL_MAX), roh };
    }
    case 'Agent':
    case 'Task':
      return { wz: 'Subagent', ziel: beschreibung, roh: null };
    case 'Skill':
      return { wz: 'Skill', ziel: sauber(String(i.skill ?? ''), o, ZIEL_MAX), roh: null };
    case 'Monitor':
    case 'ScheduleWakeup':
      return { wz: 'Warten', ziel: beschreibung || sauber(ersteZeile(i.reason), o, ZIEL_MAX), roh: null };
    case 'WebFetch': {
      let host = '';
      try {
        host = new URL(String(i.url)).host;
      } catch { /* no URL */ }
      return { wz: 'Recherche', ziel: host, roh: null };
    }
    case 'WebSearch':
      return { wz: 'Recherche', ziel: sauber(String(i.query ?? ''), o, ZIEL_MAX), roh: null };
    case 'SendMessage':
      return { wz: 'Nachricht', ziel: sauber(String(i.to ?? ''), o, ZIEL_MAX), roh: null };
    case 'TaskStop':
      return { wz: 'Anhalten', ziel: beschreibung, roh: null };
    case 'SubagentHandback':
      return { wz: 'Bericht', ziel: 'an den Lauf', roh: null };
    default:
      return { wz: name.slice(0, 40), ziel: beschreibung, roh: null };
  }
}

// ---- roles

// transcripts before the Sprachraum (ADR-0003) carry the old agent names
const PAKET = /#(\d+)(?:-p(\d+))?/i;

/** the role of a subagent by its type, else by its description */
export function rolleVon(typ: string, beschreibung = ''): string {
  if (/^ingenieur|implementer/i.test(typ)) return 'Ingenieur';
  if (/^(?:erster-offizier|epic-reviewer)/i.test(typ)) return 'Erster Offizier';
  if (/kundschafter|explore/i.test(typ)) return 'Kundschafter';
  if (/review/i.test(typ) || /^review|\breviewer\b/i.test(beschreibung)) return 'Prüfer';
  return 'Subagent';
}

/** "#480", a spec package "#45-p2"; null without one */
export function paketAus(beschreibung: string): { schluessel: number | string; name: string; rest: string } | null {
  const m = PAKET.exec(beschreibung);
  if (!m) return null;
  return { schluessel: m[2] ? `${m[1]}-p${m[2]}` : Number(m[1]), name: m[0], rest: beschreibung.slice(m.index + m[0].length).trim() };
}

// ---- the card's sentence

const VERB: Record<string, (ziel: string) => string> = {
  Tests: (z) => `fährt Tests${z ? `: ${z}` : ''}`,
  Lesen: (z) => `liest ${z}`,
  Bearbeiten: (z) => `bearbeitet ${z}`,
  Schreiben: (z) => `schreibt ${z}`,
  Suchen: (z) => `sucht ${z}`,
  Befehl: (z) => `führt aus: ${z}`,
  Andockprüfung: () => 'fährt die Andockprüfung',
  'Pull Request': (z) => `Pull Request: ${z}`,
  Commit: (z) => `committet${z ? `: ${z}` : ''}`,
  Ticket: (z) => `am Ticket: ${z}`,
  Git: (z) => `Git: ${z}`,
  Skill: (z) => `lädt den Skill ${z}`,
  Warten: (z) => `wartet${z ? `: ${z}` : ''}`,
  Recherche: (z) => `recherchiert${z ? `: ${z}` : ''}`,
  Nachricht: (z) => `schreibt an ${z}`,
  Anhalten: (z) => `hält an${z ? `: ${z}` : ''}`,
  Bericht: () => 'gibt den Bericht ab',
};

export interface Klartext {
  /** null: the run itself */
  rolle: string | null;
  paket: number | string | null;
  /** what it does, without the actor: "liest gate/logik.mts" */
  satz: string;
}

const kurz = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * What a stream-json line shows of the run's work, in plain words, for the card while the run works; null: nothing
 * (a result, an output). The last block of the line counts (as schrittAus). `gruppe`: role and package of a subagent by
 * the id of its call.
 */
export function klartextAus(d: any, gruppe: (id: string) => { rolle: string; paket: number | string | null } | null, o: VerlaufOptionen = {}): Klartext | null {
  if (d?.type !== 'assistant' || !Array.isArray(d.message?.content)) return null;
  const g = d.parent_tool_use_id ? (gruppe(String(d.parent_tool_use_id)) ?? { rolle: 'Subagent', paket: null }) : null;
  let satz: string | null = null;
  for (const c of d.message.content) {
    if (c?.type === 'text' && c.text?.trim()) satz = `„${kurz(sauber(ersteZeile(c.text), o, ZIEL_MAX))}“`;
    if (c?.type !== 'tool_use') continue;
    if (c.name === 'Agent' || c.name === 'Task') {
      const b = String(c.input?.description ?? '');
      const p = paketAus(b);
      satz = `startet ${rolleVon(String(c.input?.subagent_type ?? ''), b)}${p ? ` für ${p.name}` : ''}`;
      continue;
    }
    const w = uebersetze(String(c.name), c.input ?? {}, o);
    if (w) satz = kurz((VERB[w.wz] ?? ((z: string) => `${w.wz}: ${z}`))(w.ziel));
  }
  return satz ? { rolle: g?.rolle ?? null, paket: g?.paket ?? null, satz } : null;
}

// ---- condensing

const ENDE: Record<string, VerlaufEintrag['stand']> = { completed: 'fertig', failed: 'fehler', killed: 'abgebrochen', stopped: 'abgebrochen' };

function ergebnisText(inhalt: unknown): string {
  if (typeof inhalt === 'string') return inhalt;
  return Array.isArray(inhalt) ? String(inhalt[0]?.text ?? '') : '';
}

/**
 * Reads the lines of a mission's run logs, in order and across its runs, into entries. A line seen before (the same
 * message block, the same tool id) changes nothing: a driver that reads a log anew after a restart adds nothing twice.
 */
export class Verdichter {
  private liste: VerlaufEintrag[] = [];
  private nachId = new Map<string, VerlaufEintrag>();
  private zuletzt: string | null = null;
  /** at most this many entries kept; the oldest go (a group whose work is kept is kept too, see eintraege) */
  constructor(private o: VerlaufOptionen = {}, private behalten = 2000) {}

  zeile(roh: string, zeit: number | null = null): void {
    if (!roh.trim()) return;
    let d: any;
    try {
      d = JSON.parse(roh);
    } catch {
      return;
    }
    const eigen = typeof d?.timestamp === 'string' ? d.timestamp : null;
    if (eigen) this.zuletzt = eigen;
    const jetzt = eigen ?? (zeit != null ? new Date(zeit).toISOString() : this.zuletzt);
    const inhalt: any[] = Array.isArray(d?.message?.content) ? d.message.content : [];
    const oben = d?.parent_tool_use_id ? String(d.parent_tool_use_id) : null;
    const gruppe = oben && this.nachId.get(oben)?.art === 'gruppe' ? oben : undefined;
    if (d?.type === 'assistant') {
      inhalt.forEach((c, i) => {
        if (c?.type === 'text' && c.text?.trim()) {
          this.dazu({ id: `${d.message?.id ?? d.uuid ?? jetzt}:${i}`, art: 'text', zeit: jetzt, text: sauber(c.text.trim(), this.o), ...(gruppe ? { gruppe } : {}) });
        }
        if (c?.type !== 'tool_use' || !c.id) return;
        const id = String(c.id);
        if (c.name === 'Agent' || c.name === 'Task') {
          const b = String(c.input?.description ?? '');
          const p = paketAus(b);
          this.dazu({ id, art: 'gruppe', zeit: jetzt, text: sauber(p?.rest || b, this.o, ZIEL_MAX), rolle: rolleVon(String(c.input?.subagent_type ?? ''), b), ...(p ? { paket: p.name } : {}), stand: 'laeuft', ...(gruppe ? { gruppe } : {}) });
          return;
        }
        const w = uebersetze(String(c.name), c.input ?? {}, this.o);
        if (!w) return;
        this.dazu({ id, art: 'werkzeug', zeit: jetzt, wz: w.wz, text: w.ziel, ...(w.roh ? { roh: w.roh } : {}), stand: 'laeuft', ...(gruppe ? { gruppe } : {}) });
      });
    } else if (d?.type === 'user') {
      for (const c of inhalt) {
        if (c?.type !== 'tool_result' || !c.tool_use_id) continue;
        const e = this.nachId.get(String(c.tool_use_id));
        if (!e || e.stand !== 'laeuft') continue;
        const t = ergebnisText(c.content);
        // a command or an agent in the background answers at once; its end is its notification
        if (t.startsWith('Command running in background') || t.startsWith('Async agent launched')) continue;
        e.stand = c.is_error ? 'fehler' : 'fertig';
        if (jetzt) e.bis = jetzt;
      }
    } else if (d?.type === 'system' && d.tool_use_id) {
      const e = this.nachId.get(String(d.tool_use_id));
      if (!e) return;
      if (d.subtype === 'task_notification' && ENDE[d.status] && e.stand === 'laeuft') {
        e.stand = ENDE[d.status];
        if (jetzt) e.bis = jetzt;
      } else if (d.subtype === 'task_started' && e.art === 'gruppe' && e.stand !== 'laeuft') {
        // an agent woken again (it waited for its own background work)
        e.stand = 'laeuft';
        delete e.bis;
      }
    }
  }

  private dazu(e: VerlaufEintrag): void {
    if (this.nachId.has(e.id)) return;
    if (e.zeit === null) delete (e as Partial<VerlaufEintrag>).zeit;
    this.liste.push(e);
    this.nachId.set(e.id, e);
    if (this.liste.length > this.behalten) {
      // the oldest go, a running group stays: its work still comes
      let zuViel = this.liste.length - this.behalten;
      this.liste = this.liste.filter((x) => {
        if (zuViel <= 0 || (x.art === 'gruppe' && x.stand === 'laeuft')) return true;
        zuViel--;
        this.nachId.delete(x.id);
        return false;
      });
    }
  }

  /** the run's process ended (the next run began, or the driver saw it end): what still runs was cut off */
  schliessen(): void {
    for (const e of this.liste) {
      if (e.stand !== 'laeuft' || e.art === 'frage') continue;
      e.stand = 'abgebrochen';
      if (this.zuletzt) e.bis = this.zuletzt;
    }
  }

  /** the latest `max` entries, `extra` (questions, decisions) by time among them; a group whose work is shown comes along */
  eintraege(max = 300, extra: VerlaufEintrag[] = []): VerlaufEintrag[] {
    const alle = [...this.liste];
    for (const x of [...extra].sort((a, b) => String(a.zeit).localeCompare(String(b.zeit)))) {
      const i = alle.findIndex((y) => y.zeit && x.zeit && y.zeit > x.zeit);
      alle.splice(i < 0 ? alle.length : i, 0, x);
    }
    const fenster = alle.filter((x) => x.art !== 'gruppe' || !alle.some((y) => y.gruppe === x.id)).slice(-max);
    const zeigen = new Set(fenster.map((x) => x.id));
    for (const x of fenster) if (x.gruppe) zeigen.add(x.gruppe);
    return alle.filter((x) => zeigen.has(x.id)).map((x) => ({ ...x }));
  }
}

// ---- the driver's side: the logs of a mission, the questions and decisions

/** how many bytes of a mission's logs are read at most when its history is read the first time (the newest runs) */
export const VERLAUF_BYTES = 32 * 1024 * 1024;

/**
 * The logs of one mission (`laeufe/<nr>-<start>-<n>.jsonl`), read on from where the last reading stopped: only the new
 * bytes, a line once it is whole. The first reading takes the newest runs up to `maxBytes`, the newest always.
 */
export class Verlaufleser {
  private v: Verdichter;
  private dateien = new Map<string, { pos: number; rest: string; dekoder: StringDecoder }>();
  private erstes = true;
  /** the log the last lines came from: a later one is the next run, the earlier one's process ended */
  private letzte: string | null = null;

  constructor(readonly o: VerlaufOptionen, private maxBytes = VERLAUF_BYTES) {
    this.v = new Verdichter(o);
  }

  lies(laeufe: string, nr: number): void {
    let namen: string[];
    try {
      namen = readdirSync(laeufe).filter((d) => d.startsWith(`${nr}-`) && d.endsWith('.jsonl'));
    } catch {
      return;
    }
    const start = (d: string) => Number(d.split('-')[1]) || 0;
    namen.sort((a, b) => start(a) - start(b) || a.localeCompare(b));
    const groesse = new Map(namen.map((d) => [d, (() => { try { return statSync(join(laeufe, d)).size; } catch { return 0; } })()]));
    if (this.erstes) {
      this.erstes = false;
      let summe = 0;
      const nehmen = new Set<string>();
      for (const d of [...namen].reverse()) {
        summe += groesse.get(d)!;
        if (nehmen.size && summe > this.maxBytes) break;
        nehmen.add(d);
      }
      for (const d of namen) if (!nehmen.has(d)) this.dateien.set(d, { pos: groesse.get(d)!, rest: '', dekoder: new StringDecoder('utf8') });
    }
    for (const d of namen) {
      const f = this.dateien.get(d) ?? { pos: 0, rest: '', dekoder: new StringDecoder('utf8') };
      this.dateien.set(d, f);
      const bis = groesse.get(d)!;
      if (bis <= f.pos) continue;
      const fd = openSync(join(laeufe, d), 'r');
      try {
        const puffer = Buffer.alloc(bis - f.pos);
        readSync(fd, puffer, 0, puffer.length, f.pos);
        f.pos = bis;
        // a character split at the end of a reading waits in the decoder for its other bytes
        const teile = (f.rest + f.dekoder.write(puffer)).split(/\r?\n/);
        f.rest = teile.pop() ?? '';
        if (teile.some((z) => z.trim())) {
          if (this.letzte !== null && this.letzte !== d) this.v.schliessen();
          this.letzte = d;
        }
        for (const z of teile) this.v.zeile(z);
      } finally {
        closeSync(fd);
      }
    }
  }

  eintraege(max = 300, extra: VerlaufEintrag[] = []): VerlaufEintrag[] {
    return this.v.eintraege(max, extra);
  }

  schliessen(): void {
    this.v.schliessen();
  }
}

const VON: Record<string, string> = { mensch: 'Mensch', admiral: 'Admiral', lauf: 'Lauf' };

/** the questions to the person and the decisions of a mission as entries of its history, masked */
export function fragenUndEntscheidungen(
  nr: number,
  fragen: { epic: number; nr: number; frage: string; seit: string; beantwortet?: string | null }[],
  entscheidungen: { epic: number; nr: number; frage: string; antwort: string; herkunft: string; zeit: string; von?: string | null }[],
  wurzeln: string[] = [],
): VerlaufEintrag[] {
  const m = (s: string) => sauber(s, { wurzeln });
  return [
    ...fragen.filter((f) => f.epic === nr).map((f): VerlaufEintrag => ({ id: `frage:${f.nr}:${f.seit}`, art: 'frage', zeit: f.seit, text: m(f.frage), stand: f.beantwortet ? 'fertig' : 'laeuft' })),
    ...entscheidungen.filter((d) => d.epic === nr).map((d): VerlaufEintrag => ({ id: `ent:${d.nr}:${d.zeit}`, art: 'entscheidung', zeit: d.zeit, text: m(`Frage ${d.nr} → ${d.antwort} · ${d.frage}`), von: (d.von ? VON[d.von] : null) ?? d.herkunft.slice(0, 100) })),
  ];
}
