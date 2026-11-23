// Tokens per agent type, per epic and per package from the transcripts of the runs (Sparpaket,
// package 3): what an epic costs, where the cache works, and how many review rounds a package
// took. Reads like mission/scripts/usage.ps1 - one count per message id, <synthetic> left out - but
// without weights: the four kinds of tokens stay apart, and the cache rate is computed from them.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { epicAus, runde, type Fenster } from './messen.ts';

export interface Tokens {
  eingabe: number;
  cache_schreiben: number;
  cache_lesen: number;
  ausgabe: number;
  nachrichten: number;
}

export interface AgentLauf {
  /** host: the session of a run; otherwise the agentType of the subagent */
  rolle: string;
  epic: number | null;
  /** '588', '41-p2' from the description of the Agent call, as usage.ps1 reads it */
  paket: string | null;
  tokens: Tokens;
  /** characters of tool results per tool: what filled the context (test output, reading) */
  zeichen: Record<string, number>;
  /** weighted tokens (gewichtet()) the tool results of a category cost, see kontextKosten */
  kontext: Record<string, number>;
}

const PAKET = /(?:#|Paket\s+)(\d+(?:-p\d+)?)/;
const TEST = /(npm (run )?test|npx (vitest|jest|playwright)|\bvitest\b|\bjest\b|\bpytest\b|playwright test|bun test|dotnet test|cargo test|go test)/;

/** Input-token equivalents like usage.ps1 without model weights: fresh + 1.25 write + 0.1 read + 5 output. */
export function gewichtet(t: Tokens): number {
  return t.eingabe + 1.25 * t.cache_schreiben + 0.1 * t.cache_lesen + 5 * t.ausgabe;
}

/** The category of a tool result for kontext: gate, test, git-diff, shell, lesen, andere. */
export function kategorie(werkzeug: string, befehl: string): string {
  if (werkzeug === 'Bash' || werkzeug === 'PowerShell') {
    if (/\bgate\b/.test(befehl)) return 'gate';
    if (TEST.test(befehl)) return 'test';
    if (/\bgit\b[^|;&]*\b(diff|show|log)\b/.test(befehl)) return 'git-diff';
    return 'shell';
  }
  return ['Read', 'Grep', 'Glob'].includes(werkzeug) ? 'lesen' : 'andere';
}

export function leer(): Tokens {
  return { eingabe: 0, cache_schreiben: 0, cache_lesen: 0, ausgabe: 0, nachrichten: 0 };
}

function plus(a: Tokens, b: Tokens): Tokens {
  return { eingabe: a.eingabe + b.eingabe, cache_schreiben: a.cache_schreiben + b.cache_schreiben, cache_lesen: a.cache_lesen + b.cache_lesen, ausgabe: a.ausgabe + b.ausgabe, nachrichten: a.nachrichten + b.nachrichten };
}

/** Share of the input that came from the cache: read / (fresh + written + read), null without input. */
export function cacheQuote(t: Tokens): number | null {
  const alle = t.eingabe + t.cache_schreiben + t.cache_lesen;
  return alle ? Math.round((t.cache_lesen / alle) * 1000) / 1000 : null;
}

function textLaenge(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((n: number, b: { type?: string; text?: string }) => n + (b && b.type === 'text' && typeof b.text === 'string' ? b.text.length : 0), 0);
}

/**
 * Tokens and tool result sizes of one transcript (session or subagent), inside the window.
 * kontext: what the tool results of each category cost in weighted tokens - written to the cache
 * once (1.25) and read again by every later model call of this agent (0.1 each), at about four
 * characters per token. An upper bound for any measure that shortens that kind of result.
 */
export function leseTokens(inhalt: string, fenster: Fenster): { tokens: Tokens; zeichen: Record<string, number>; kontext: Record<string, number>; ersterText: string } {
  const jeNachricht = new Map<string, Tokens>();
  const werkzeug = new Map<string, { name: string; befehl: string }>();
  const zeichen: Record<string, number> = {};
  const folge: ({ aufruf: true } | { kategorie: string; tokens: number })[] = [];
  let ersterText = '';
  for (const zeile of inhalt.split(/\r?\n/)) {
    if (!zeile.trim()) continue;
    let d: any;
    try {
      d = JSON.parse(zeile);
    } catch {
      continue;
    }
    const content = d?.message?.content;
    if (d?.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) if (b?.type === 'tool_use') werkzeug.set(String(b.id), { name: String(b.name), befehl: String(b.input?.command ?? '') });
    }
    if (d?.type === 'user' && !ersterText) {
      const t = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n') : '';
      if (t.trim()) ersterText = t;
    }
    const zeit = Date.parse(d?.timestamp ?? '');
    if (Number.isNaN(zeit) || zeit < fenster.von || zeit > fenster.bis) continue;
    if (d.type === 'assistant' && d.message?.usage && d.message.model !== '<synthetic>') {
      const u = d.message.usage;
      if (!jeNachricht.has(String(d.message.id ?? d.uuid))) folge.push({ aufruf: true });
      jeNachricht.set(String(d.message.id ?? d.uuid), {
        eingabe: Number(u.input_tokens ?? 0),
        cache_schreiben: Number(u.cache_creation_input_tokens ?? 0),
        cache_lesen: Number(u.cache_read_input_tokens ?? 0),
        ausgabe: Number(u.output_tokens ?? 0),
        nachrichten: 1,
      });
    } else if (d.type === 'user' && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type !== 'tool_result') continue;
        const w = werkzeug.get(String(b.tool_use_id)) ?? { name: 'unbekannt', befehl: '' };
        const laenge = textLaenge(b.content);
        zeichen[w.name] = (zeichen[w.name] ?? 0) + laenge;
        folge.push({ kategorie: kategorie(w.name, w.befehl), tokens: laenge / 4 });
      }
    }
  }
  const kontext: Record<string, number> = {};
  let spaeter = 0;
  for (let i = folge.length - 1; i >= 0; i--) {
    const f = folge[i];
    if ('aufruf' in f) spaeter++;
    else kontext[f.kategorie] = (kontext[f.kategorie] ?? 0) + f.tokens * (1.25 + 0.1 * spaeter);
  }
  return { tokens: [...jeNachricht.values()].reduce(plus, leer()), zeichen, kontext, ersterText };
}

/**
 * A run session and its subagents (<session>/subagents/agent-*.jsonl with .meta.json). The epic
 * comes from the first user text of the session (the order of the driver names #<nr>); the
 * subagents belong to the same epic. rolle names the session itself, e.g. 'lauf'.
 */
export function ladeSitzung(pfad: string, fenster: Fenster, epics: number[], rolle = 'lauf'): AgentLauf[] {
  const host = leseTokens(readFileSync(pfad, 'utf8'), fenster);
  const epic = epicAus(host.ersterText, epics);
  const out: AgentLauf[] = [{ rolle, epic, paket: null, tokens: host.tokens, zeichen: host.zeichen, kontext: host.kontext }];
  const sub = join(dirname(pfad), basename(pfad, '.jsonl'), 'subagents');
  if (!existsSync(sub)) return out;
  for (const n of readdirSync(sub).filter((x) => /^agent-.*\.jsonl$/.test(x))) {
    let typ = 'unbekannt';
    let beschreibung = '';
    try {
      const meta = JSON.parse(readFileSync(join(sub, n.replace(/\.jsonl$/, '.meta.json')), 'utf8'));
      typ = String(meta.agentType ?? typ);
      beschreibung = String(meta.description ?? '');
    } catch {
      // without meta the agent still counts, as 'unbekannt'
    }
    const t = leseTokens(readFileSync(join(sub, n), 'utf8'), fenster);
    if (!t.tokens.nachrichten) continue;
    out.push({ rolle: typ, epic, paket: beschreibung.match(PAKET)?.[1] ?? null, tokens: t.tokens, zeichen: t.zeichen, kontext: t.kontext });
  }
  return out;
}

/** Share of the weighted tokens per category, largest first, in percent with one decimal. */
function anteile(kontext: Record<string, number>, summe: number): Record<string, number> {
  if (!summe) return {};
  return Object.fromEntries(Object.entries(kontext).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((v / summe) * 1000) / 10]));
}

function mitQuote(t: Tokens) {
  return { ...t, cache_quote: cacheQuote(t) };
}

/**
 * The token block of `flotte messen`: sum, per agent type (with the tool result characters), per
 * epic and per package. Review rounds of a package = reviewer runs; implementer runs > 1 means a
 * second round or an escalation.
 */
export function tokenKennzahlen(laeufe: AgentLauf[]) {
  const summe = laeufe.reduce((s, l) => plus(s, l.tokens), leer());
  const typen: Record<string, { tokens: Tokens; agenten: number; zeichen: Record<string, number>; kontext: Record<string, number> }> = {};
  const epics: Record<string, Tokens> = {};
  const pakete = new Map<string, { epic: number | null; paket: string; tokens: Tokens; implementer: number; reviewer: number }>();
  for (const l of laeufe) {
    const t = (typen[l.rolle] ??= { tokens: leer(), agenten: 0, zeichen: {}, kontext: {} });
    t.tokens = plus(t.tokens, l.tokens);
    t.agenten++;
    for (const [w, z] of Object.entries(l.zeichen)) t.zeichen[w] = (t.zeichen[w] ?? 0) + z;
    for (const [k, z] of Object.entries(l.kontext)) t.kontext[k] = (t.kontext[k] ?? 0) + z;
    const e = l.epic === null ? 'ohne_epic' : `#${l.epic}`;
    epics[e] = plus(epics[e] ?? leer(), l.tokens);
    if (l.paket) {
      const k = `${l.epic ?? '?'}/${l.paket}`;
      const p = pakete.get(k) ?? { epic: l.epic, paket: l.paket, tokens: leer(), implementer: 0, reviewer: 0 };
      p.tokens = plus(p.tokens, l.tokens);
      if (/implementer|ingenieur/.test(l.rolle)) p.implementer++;
      if (/reviewer|erster-offizier/.test(l.rolle)) p.reviewer++;
      pakete.set(k, p);
    }
  }
  const jePaket = [...pakete.values()].sort((a, b) => a.paket.localeCompare(b.paket, 'de', { numeric: true }));
  return {
    summe: mitQuote(summe),
    je_agent_typ: Object.fromEntries(Object.entries(typen).sort((a, b) => b[1].tokens.ausgabe - a[1].tokens.ausgabe).map(([k, v]) => [k, { agenten: v.agenten, ...mitQuote(v.tokens), gewichtet: Math.round(gewichtet(v.tokens)), ergebnis_zeichen: v.zeichen, kontext_anteil: anteile(v.kontext, gewichtet(v.tokens)) }])),
    je_epic: Object.fromEntries(Object.entries(epics).map(([k, v]) => [k, mitQuote(v)])),
    je_paket: jePaket.map((p) => ({ epic: p.epic, paket: p.paket, implementer_laeufe: p.implementer, review_runden: p.reviewer, ...mitQuote(p.tokens) })),
    review_runden: { pakete: jePaket.length, mittel: jePaket.length ? runde(jePaket.reduce((s, p) => s + p.reviewer, 0) / jePaket.length) : null, ueber_eins: jePaket.filter((p) => p.reviewer > 1).length },
    methode: 'Transkripte der Läufe und ihrer Subagenten, je message.id einmal, ohne <synthetic>; cache_quote = Cache-Lesen / (Eingabe + Cache-Schreiben + Cache-Lesen); Paket aus der description des Agent-Aufrufs; Review-Runden = Reviewer-Läufe je Paket; ergebnis_zeichen = Länge der Werkzeugergebnisse je Werkzeug; kontext_anteil = Anteil an den gewichteten Tokens des Agent-Typs (Eingabe + 1,25 Schreiben + 0,1 Lesen + 5 Ausgabe), den die Werkzeugergebnisse einer Art kosten: einmal geschrieben, von jedem späteren Modellaufruf wieder gelesen, rund 4 Zeichen je Token — die Obergrenze jeder Maßnahme, die diese Ergebnisse kürzt',
  };
}
