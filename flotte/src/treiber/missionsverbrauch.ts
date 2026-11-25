// Tag Q: what a mission costs, also while it runs. The tokens of its runs and their subagents come from the transcripts
// of the accounts (as tokens.ts reads them: each message id once, <synthetic> left out), read on each turn from where
// the last reading stopped. The sessions come from the init lines of the run logs (laeufe/<nr>-*.jsonl); admiral calls
// and triage runs are not part of a mission. The share of an account's weekly limit is an estimate: the account's
// share over the weighted tokens of all mission runs on it in the current weekly window. The PR and the forge never
// see that share, only tokens (the repositories are public).

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { cacheQuote, gewichtet, leer, type Tokens } from '../tokens.ts';
import { paketAus, rolleVon } from './verlauf.ts';

export const STUNDE = 3_600_000;
export const WOCHE = 7 * 24 * STUNDE;
/** below this many weighted tokens of mission runs in the window the account's share says too little */
export const RATE_MIN_GEWICHTET = 1_000_000;
/** the cache rate marks only from this many input tokens on: the first calls of a run write the cache */
export const CACHE_MIN_EINGABE = 500_000;
export const CACHE_GRENZE = 0.7;
const STUECK = 4 * 1024 * 1024;

/** a transcript of a mission: the run's session (Orchestrator) or a subagent with role and package */
export interface Quelle {
  pfad: string;
  /** the account folder the transcript lies in, as the driver names it */
  konto: string;
  rolle: string;
  paket: string | null;
}

interface Nachricht {
  t: Tokens;
  stunde: number;
  konto: string;
  rolle: string;
  paket: string | null;
}

const roh = (t: Tokens) => t.eingabe + t.cache_schreiben + t.cache_lesen + t.ausgabe;

function plus(a: Tokens, b: Tokens): Tokens {
  return { eingabe: a.eingabe + b.eingabe, cache_schreiben: a.cache_schreiben + b.cache_schreiben, cache_lesen: a.cache_lesen + b.cache_lesen, ausgabe: a.ausgabe + b.ausgabe, nachrichten: a.nachrichten + b.nachrichten };
}

/**
 * The messages of one mission's transcripts, read on from where the last reading stopped (a line once it is whole, a
 * character split at the end waits for its other bytes). A message id seen before keeps its file, hour and role and
 * takes the newer usage: the lines of one message repeat it, the last with the final output; a resumed session that
 * copied its history counts nothing twice.
 */
export class Zaehler {
  private dateien = new Map<string, { pos: number; rest: string; dekoder: StringDecoder }>();
  readonly nachrichten = new Map<string, Nachricht>();

  /** reads what is new in the file; returns the bytes read */
  lies(q: Quelle): number {
    let groesse: number;
    try {
      groesse = statSync(q.pfad).size;
    } catch {
      return 0;
    }
    let f = this.dateien.get(q.pfad);
    if (!f || groesse < f.pos) this.dateien.set(q.pfad, (f = { pos: 0, rest: '', dekoder: new StringDecoder('utf8') }));
    if (groesse === f.pos) return 0;
    const anfang = f.pos;
    const fd = openSync(q.pfad, 'r');
    try {
      while (f.pos < groesse) {
        const puffer = Buffer.alloc(Math.min(STUECK, groesse - f.pos));
        const n = readSync(fd, puffer, 0, puffer.length, f.pos);
        if (!n) break;
        f.pos += n;
        const teile = (f.rest + f.dekoder.write(puffer.subarray(0, n))).split('\n');
        f.rest = teile.pop() ?? '';
        for (const z of teile) this.zeile(z, q);
      }
    } finally {
      closeSync(fd);
    }
    return f.pos - anfang;
  }

  private zeile(z: string, q: Quelle): void {
    // only an assistant line carries usage; the others are not even parsed
    if (!z.includes('"usage"')) return;
    let d: any;
    try {
      d = JSON.parse(z);
    } catch {
      return;
    }
    const u = d?.message?.usage;
    if (d?.type !== 'assistant' || !u || d.message.model === '<synthetic>') return;
    const id = String(d.message.id ?? d.uuid);
    const alt = this.nachrichten.get(id);
    const zeit = Date.parse(d.timestamp ?? '');
    this.nachrichten.set(id, {
      t: { eingabe: Number(u.input_tokens ?? 0), cache_schreiben: Number(u.cache_creation_input_tokens ?? 0), cache_lesen: Number(u.cache_read_input_tokens ?? 0), ausgabe: Number(u.output_tokens ?? 0), nachrichten: 1 },
      stunde: alt?.stunde ?? (Number.isNaN(zeit) ? 0 : Math.floor(zeit / STUNDE)),
      konto: alt?.konto ?? q.konto,
      rolle: alt?.rolle ?? q.rolle,
      paket: alt?.paket ?? q.paket,
    });
  }
}

export interface Posten {
  paket: string | null;
  rolle: string;
  tokens: Tokens;
  /** weighted tokens per account */
  konten: Record<string, number>;
}

/** What a mission used: the sum, per package and role, weighted per account, and [sum, weighted] per account and hour. */
export interface Verbrauchsstand {
  tokens: Tokens;
  posten: Posten[];
  konten: Record<string, number>;
  stunden: Record<string, Record<string, [number, number]>>;
}

/** Package and role in the order they first used tokens; the mission's own session (no package) first. */
export function auswerten(nachrichten: Iterable<Nachricht>): Verbrauchsstand {
  let tokens = leer();
  const posten = new Map<string, Posten>();
  const konten: Record<string, number> = {};
  const stunden: Record<string, Record<string, [number, number]>> = {};
  for (const n of nachrichten) {
    const g = gewichtet(n.t);
    tokens = plus(tokens, n.t);
    const k = `${n.paket ?? ''}\u0000${n.rolle}`;
    const p = posten.get(k) ?? { paket: n.paket, rolle: n.rolle, tokens: leer(), konten: {} };
    p.tokens = plus(p.tokens, n.t);
    p.konten[n.konto] = (p.konten[n.konto] ?? 0) + g;
    posten.set(k, p);
    konten[n.konto] = (konten[n.konto] ?? 0) + g;
    const s = ((stunden[n.konto] ??= {})[String(n.stunde)] ??= [0, 0]);
    s[0] += roh(n.t);
    s[1] += g;
  }
  const liste = [...posten.values()];
  return { tokens, posten: [...liste.filter((p) => p.paket === null), ...liste.filter((p) => p.paket !== null)], konten, stunden };
}

/** [sum, weighted] of the hours from the hour of `von` until before `bis` */
export function imFenster(stunden: Record<string, [number, number]> | undefined, von: number, bis: number): { summe: number; gewichtet: number } {
  const ab = Math.floor(von / STUNDE);
  let summe = 0;
  let gew = 0;
  for (const [h, [s, g]] of Object.entries(stunden ?? {})) {
    const n = Number(h);
    if (n >= ab && n * STUNDE < bis) {
      summe += s;
      gew += g;
    }
  }
  return { summe, gewichtet: gew };
}

// ---- where the transcripts lie

/** the folder Claude Code keeps a session of this working directory in: every sign but letters and digits a dash */
export const projektOrdner = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-');

const ausHeim = (p: string) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

/** the session and working directory of a run log from its init line; null: not written yet */
function initAus(datei: string): { id: string; cwd: string } | null | 'nie' {
  let text: string;
  let groesse = 0;
  try {
    groesse = statSync(datei).size;
    const fd = openSync(datei, 'r');
    try {
      const puffer = Buffer.alloc(Math.min(groesse, 256 * 1024));
      text = puffer.toString('utf8', 0, readSync(fd, puffer, 0, puffer.length, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const z of text.split('\n')) {
    if (!z.includes('"init"')) continue;
    try {
      const d = JSON.parse(z);
      if (d?.type === 'system' && d.subtype === 'init' && typeof d.session_id === 'string') return { id: d.session_id, cwd: String(d.cwd ?? '') };
    } catch { /* a line cut at the end */ }
  }
  // no init in the first 256 KB of a log this long: it has none
  return groesse > 256 * 1024 ? 'nie' : null;
}

/** role of a subagent: the Andockprüfung by its description, else by its type (verlauf.ts) */
function rolleAus(typ: string, beschreibung: string): string {
  if (/andockpr|\bgate\b/i.test(beschreibung) || /andockpr|\bgate\b/i.test(typ)) return 'Andockprüfung';
  return rolleVon(typ, beschreibung);
}

/**
 * The transcripts of one mission: the sessions of its run logs (each log read once its init line is there), each
 * session's transcript below the account (in the folder of its working directory, else found by one search of the
 * account), and its subagents with role and package from their .meta.json (listed again each time: new ones come).
 */
export class Fundstellen {
  private logs = new Map<string, { id: string; cwd: string } | 'nie'>();
  private sitzungen = new Map<string, { pfad: string; konto: string } | null>();
  private gesucht = new Set<string>();
  private metas = new Map<string, { rolle: string; paket: string | null }>();

  quellen(laeufe: string, nr: number, konten: string[]): Quelle[] {
    let namen: string[] = [];
    try {
      namen = readdirSync(laeufe).filter((d) => d.startsWith(`${nr}-`) && d.endsWith('.jsonl')).sort();
    } catch {
      return [];
    }
    const ids = new Map<string, string>();
    for (const n of namen) {
      let s = this.logs.get(n);
      if (s === undefined) {
        const i = initAus(join(laeufe, n));
        if (i === null) continue;
        this.logs.set(n, (s = i));
      }
      if (s !== 'nie' && !ids.has(s.id)) ids.set(s.id, s.cwd);
    }
    const out: Quelle[] = [];
    for (const [id, cwd] of ids) {
      const s = this.sitzung(id, cwd, konten);
      if (!s) continue;
      out.push({ pfad: s.pfad, konto: s.konto, rolle: 'Orchestrator', paket: null });
      out.push(...this.subagenten(s));
    }
    return out;
  }

  private sitzung(id: string, cwd: string, konten: string[]): { pfad: string; konto: string } | null {
    const bekannt = this.sitzungen.get(id);
    if (bekannt) return bekannt;
    for (const k of konten) {
      const p = join(ausHeim(k), 'projects', projektOrdner(cwd), `${id}.jsonl`);
      if (existsSync(p)) return this.merke(id, { pfad: p, konto: k });
    }
    // once per session: a transcript in another project folder of an account
    if (this.gesucht.has(id)) return null;
    this.gesucht.add(id);
    for (const k of konten) {
      const projekte = join(ausHeim(k), 'projects');
      let ordner: string[] = [];
      try {
        ordner = readdirSync(projekte);
      } catch {
        continue;
      }
      for (const o of ordner) {
        const p = join(projekte, o, `${id}.jsonl`);
        if (existsSync(p)) return this.merke(id, { pfad: p, konto: k });
      }
    }
    return null;
  }

  private merke(id: string, s: { pfad: string; konto: string }) {
    this.sitzungen.set(id, s);
    return s;
  }

  private subagenten(s: { pfad: string; konto: string }): Quelle[] {
    const dir = join(s.pfad.replace(/\.jsonl$/, ''), 'subagents');
    let namen: string[];
    try {
      namen = readdirSync(dir).filter((n) => /^agent-.*\.jsonl$/.test(n)).sort();
    } catch {
      return [];
    }
    return namen.map((n) => {
      const pfad = join(dir, n);
      let m = this.metas.get(pfad);
      if (!m) {
        try {
          const meta = JSON.parse(readFileSync(pfad.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
          const beschreibung = String(meta.description ?? '');
          this.metas.set(pfad, (m = { rolle: rolleAus(String(meta.agentType ?? ''), beschreibung), paket: paketAus(beschreibung)?.name ?? null }));
        } catch {
          // its meta may come a moment later: asked again next time
          m = { rolle: 'Subagent', paket: null };
        }
      }
      return { pfad, konto: s.konto, ...m };
    });
  }
}

// ---- the share of the weekly limit, the mark, the texts

const eine = (x: number) => Math.round(x * 10) / 10;

/** percent of the weekly limit per million weighted tokens: the account's share over its mission runs' weighted tokens in the window */
export function wochenRate(anteilProzent: number, gewichtetImFenster: number): number | null {
  if (gewichtetImFenster < RATE_MIN_GEWICHTET || anteilProzent < 0.5) return null;
  return anteilProzent / (gewichtetImFenster / 1e6);
}

/** a mission's estimated share in percent: its weighted tokens per account times the account's rate; null when an account it used has none */
export function anteilWoche(konten: Record<string, number>, raten: Record<string, number | null | undefined>): number | null {
  let s = 0;
  let etwas = false;
  for (const [k, g] of Object.entries(konten)) {
    if (!g) continue;
    const r = raten[k];
    if (r == null) return null;
    s += (g / 1e6) * r;
    etwas = true;
  }
  return etwas ? eine(s) : null;
}

/** German numbers: 2,4 Mio, 830 Tsd, 512 */
export function zahl(n: number): string {
  const de = (x: number) => String(x).replace('.', ',');
  if (n >= 1e6) return `${de(eine(n / 1e6))} Mio`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} Tsd`;
  return String(Math.round(n));
}

const prozent = (q: number | null) => (q === null ? '–' : `${Math.round(q * 100)} %`);

/**
 * Why the mission's number is marked: from twice the mean of the finished missions with the same number of packages
 * ± 1 (without any, all finished ones), or a cache rate under 70 % from CACHE_MIN_EINGABE input tokens on. Nothing halts.
 */
export function warnungen(t: Tokens, gewichtetJetzt: number, pakete: number | null, frueher: { pakete: number; gewichtet: number }[]): string[] {
  const out: string[] = [];
  const gleich = pakete === null ? [] : frueher.filter((m) => Math.abs(m.pakete - pakete) <= 1);
  const vergleich = gleich.length ? gleich : frueher;
  if (vergleich.length) {
    const mittel = vergleich.reduce((s, m) => s + m.gewichtet, 0) / vergleich.length;
    if (mittel > 0 && gewichtetJetzt >= 2 * mittel) out.push(`${String(eine(gewichtetJetzt / mittel)).replace('.', ',')}-mal das Mittel von ${vergleich.length} vergleichbaren abgeschlossenen Missionen (${zahl(mittel)} gewichtet)`);
  }
  const q = cacheQuote(t);
  if (t.eingabe + t.cache_schreiben + t.cache_lesen >= CACHE_MIN_EINGABE && q !== null && q < CACHE_GRENZE) out.push(`Cache-Quote ${prozent(q)} unter ${Math.round(CACHE_GRENZE * 100)} %`);
  return out;
}

const aufschluesselung = (t: Tokens) => `${zahl(roh(t))} Tok (Eingabe ${zahl(t.eingabe)}, Cache-Schreiben ${zahl(t.cache_schreiben)}, Cache-Lesen ${zahl(t.cache_lesen)}, Ausgabe ${zahl(t.ausgabe)}), Cache ${prozent(cacheQuote(t))}`;

/** the line of the mission's PR: tokens and cache rate, never a share of the plan's limit (public repositories) */
export const prZeile = (t: Tokens) => `Verbrauch: ${aufschluesselung(t)}`;

/** the end sum for the logbook of the bridge (local, never the forge) */
export const logbuchZeile = (t: Tokens, anteil: number | null) => `Verbrauch der Mission: ${aufschluesselung(t)}, gewichtet ${zahl(gewichtet(t))}${anteil === null ? '' : `, ≈${String(anteil).replace('.', ',')} % Woche`}`;

const ZEILE = /^Verbrauch: .* Tok \(.*$/m;

/** the body with the line replaced, else before the generated line at the end, else appended */
export function prBodyMitVerbrauch(body: string, zeile: string): string {
  if (ZEILE.test(body)) return body.replace(ZEILE, zeile);
  if (!body.trim()) return zeile;
  const m = /\n+🤖 Generated with[^\n]*\s*$/.exec(body);
  if (m) return `${body.slice(0, m.index)}\n\n${zeile}\n\n${body.slice(m.index).replace(/^\n+/, '')}`;
  return `${body.replace(/\n+$/, '')}\n\n${zeile}\n`;
}
