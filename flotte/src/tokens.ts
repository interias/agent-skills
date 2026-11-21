// Tokens per agent type, per epic and per package from the transcripts of the runs (Sparpaket,
// package 3): what an epic costs, where the cache works, and how many review rounds a package
// took. Reads like epic/scripts/usage.ps1 - one count per message id, <synthetic> left out - but
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
}

const PAKET = /(?:#|Paket\s+)(\d+(?:-p\d+)?)/;

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

/** Tokens and tool result sizes of one transcript (session or subagent), inside the window. */
export function leseTokens(inhalt: string, fenster: Fenster): { tokens: Tokens; zeichen: Record<string, number>; ersterText: string } {
  const jeNachricht = new Map<string, Tokens>();
  const werkzeug = new Map<string, string>();
  const zeichen: Record<string, number> = {};
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
      for (const b of content) if (b?.type === 'tool_use') werkzeug.set(String(b.id), String(b.name));
    }
    if (d?.type === 'user' && !ersterText) {
      const t = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n') : '';
      if (t.trim()) ersterText = t;
    }
    const zeit = Date.parse(d?.timestamp ?? '');
    if (Number.isNaN(zeit) || zeit < fenster.von || zeit > fenster.bis) continue;
    if (d.type === 'assistant' && d.message?.usage && d.message.model !== '<synthetic>') {
      const u = d.message.usage;
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
        const name = werkzeug.get(String(b.tool_use_id)) ?? 'unbekannt';
        zeichen[name] = (zeichen[name] ?? 0) + textLaenge(b.content);
      }
    }
  }
  return { tokens: [...jeNachricht.values()].reduce(plus, leer()), zeichen, ersterText };
}

/**
 * A run session and its subagents (<session>/subagents/agent-*.jsonl with .meta.json). The epic
 * comes from the first user text of the session (the order of the driver names #<nr>); the
 * subagents belong to the same epic. rolle names the session itself, e.g. 'lauf'.
 */
export function ladeSitzung(pfad: string, fenster: Fenster, epics: number[], rolle = 'lauf'): AgentLauf[] {
  const host = leseTokens(readFileSync(pfad, 'utf8'), fenster);
  const epic = epicAus(host.ersterText, epics);
  const out: AgentLauf[] = [{ rolle, epic, paket: null, tokens: host.tokens, zeichen: host.zeichen }];
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
    out.push({ rolle: typ, epic, paket: beschreibung.match(PAKET)?.[1] ?? null, tokens: t.tokens, zeichen: t.zeichen });
  }
  return out;
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
  const typen: Record<string, { tokens: Tokens; agenten: number; zeichen: Record<string, number> }> = {};
  const epics: Record<string, Tokens> = {};
  const pakete = new Map<string, { epic: number | null; paket: string; tokens: Tokens; implementer: number; reviewer: number }>();
  for (const l of laeufe) {
    const t = (typen[l.rolle] ??= { tokens: leer(), agenten: 0, zeichen: {} });
    t.tokens = plus(t.tokens, l.tokens);
    t.agenten++;
    for (const [w, z] of Object.entries(l.zeichen)) t.zeichen[w] = (t.zeichen[w] ?? 0) + z;
    const e = l.epic === null ? 'ohne_epic' : `#${l.epic}`;
    epics[e] = plus(epics[e] ?? leer(), l.tokens);
    if (l.paket) {
      const k = `${l.epic ?? '?'}/${l.paket}`;
      const p = pakete.get(k) ?? { epic: l.epic, paket: l.paket, tokens: leer(), implementer: 0, reviewer: 0 };
      p.tokens = plus(p.tokens, l.tokens);
      if (/implementer/.test(l.rolle)) p.implementer++;
      if (/reviewer/.test(l.rolle)) p.reviewer++;
      pakete.set(k, p);
    }
  }
  const jePaket = [...pakete.values()].sort((a, b) => a.paket.localeCompare(b.paket, 'de', { numeric: true }));
  return {
    summe: mitQuote(summe),
    je_agent_typ: Object.fromEntries(Object.entries(typen).sort((a, b) => b[1].tokens.ausgabe - a[1].tokens.ausgabe).map(([k, v]) => [k, { agenten: v.agenten, ...mitQuote(v.tokens), ergebnis_zeichen: v.zeichen }])),
    je_epic: Object.fromEntries(Object.entries(epics).map(([k, v]) => [k, mitQuote(v)])),
    je_paket: jePaket.map((p) => ({ epic: p.epic, paket: p.paket, implementer_laeufe: p.implementer, review_runden: p.reviewer, ...mitQuote(p.tokens) })),
    review_runden: { pakete: jePaket.length, mittel: jePaket.length ? runde(jePaket.reduce((s, p) => s + p.reviewer, 0) / jePaket.length) : null, ueber_eins: jePaket.filter((p) => p.reviewer > 1).length },
    methode: 'Transkripte der Läufe und ihrer Subagenten, je message.id einmal, ohne <synthetic>; cache_quote = Cache-Lesen / (Eingabe + Cache-Schreiben + Cache-Lesen); Paket aus der description des Agent-Aufrufs; Review-Runden = Reviewer-Läufe je Paket; ergebnis_zeichen = Länge der Werkzeugergebnisse je Werkzeug',
  };
}
