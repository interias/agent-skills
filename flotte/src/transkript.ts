// Reads a Claude Code transcript (<config>/projects/<slug>/<session>.jsonl) into a flat list of
// entries. Nothing here guesses beyond the line itself; the measurements in messen.ts decide what
// an entry means for a metric.

import { readFileSync } from 'node:fs';

/**
 * mensch: typed by a person (also a slash command or pasted text).
 * nachricht: from another session or the host app (cross-session message, side-sessions event,
 *   a task handed over by a starting session).
 * meldung: a notification about the session's own background work (task-notification).
 * ergebnis: a tool result.
 * meta: system reminders, compaction summaries, hook output.
 * assistent: a message of the model.
 */
export type Art = 'mensch' | 'nachricht' | 'meldung' | 'ergebnis' | 'meta' | 'assistent';

export interface Werkzeugaufruf {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface Werkzeugergebnis {
  id: string;
  text: string;
  /** toolUseResult of the line, when Claude Code wrote one (AskUserQuestion: answers). */
  daten: unknown;
}

export interface Eintrag {
  zeit: number;
  art: Art;
  text: string;
  aufrufe: Werkzeugaufruf[];
  ergebnisse: Werkzeugergebnis[];
  /** assistant only: end_turn, tool_use, ... */
  stop: string | null;
  modell: string | null;
}

type Block = { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown };

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b: Block) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

const HERKUNFT: Record<string, Art> = { human: 'mensch', peer: 'nachricht', 'task-notification': 'meldung' };
const NACHRICHT = [/^Another Claude session sent a message/, /^<cross-session-message/, /^<side-sessions-event/, /^Background \(from the session/, /^Task \(from the session/];
const MELDUNG = [/^<task-notification/];
const META = [/^This session is being continued/, /^Caveat:/, /^<system-reminder/, /^<local-command/, /^\[Request interrupted/];

/** The art of a user line's own text (not of its tool results). */
export function artDesTexts(text: string): Art {
  const t = text.trimStart();
  if (MELDUNG.some((r) => r.test(t))) return 'meldung';
  if (NACHRICHT.some((r) => r.test(t))) return 'nachricht';
  if (t.includes('<command-name>')) return 'mensch';
  if (t.startsWith('<pasted_content')) return 'mensch';
  if (META.some((r) => r.test(t)) || t.startsWith('<')) return 'meta';
  return 'mensch';
}

export function leseZeile(zeile: string): Eintrag | null {
  let d: any;
  try {
    d = JSON.parse(zeile);
  } catch {
    return null;
  }
  if (!d || typeof d !== 'object' || !d.timestamp) return null;
  if (d.isSidechain) return null;
  const zeit = Date.parse(d.timestamp);
  if (Number.isNaN(zeit)) return null;
  const message = d.message ?? {};
  const content = message.content;
  if (d.type === 'assistant') {
    const aufrufe: Werkzeugaufruf[] = Array.isArray(content)
      ? content
          .filter((b: Block) => b && b.type === 'tool_use')
          .map((b: Block) => ({ id: String(b.id), name: String(b.name), input: (b.input ?? {}) as Record<string, unknown> }))
      : [];
    return { zeit, art: 'assistent', text: textOf(content), aufrufe, ergebnisse: [], stop: message.stop_reason ?? null, modell: message.model ?? null };
  }
  if (d.type !== 'user') return null;
  // origin.kind says who sent the line; a message from another session is written with isMeta
  const herkunft = HERKUNFT[String(d.origin?.kind ?? '')];
  if (herkunft) return { zeit, art: herkunft, text: textOf(content), aufrufe: [], ergebnisse: [], stop: null, modell: null };
  if (d.isMeta || d.isCompactSummary) return { zeit, art: 'meta', text: textOf(content), aufrufe: [], ergebnisse: [], stop: null, modell: null };
  const ergebnisse: Werkzeugergebnis[] = Array.isArray(content)
    ? content
        .filter((b: Block) => b && b.type === 'tool_result')
        .map((b: Block) => ({ id: String(b.tool_use_id), text: textOf(b.content) || (typeof b.content === 'string' ? b.content : ''), daten: d.toolUseResult }))
    : [];
  const text = textOf(content);
  const art: Art = ergebnisse.length && !text ? 'ergebnis' : artDesTexts(text);
  return { zeit, art, text, aufrufe: [], ergebnisse, stop: null, modell: null };
}

export function leseText(inhalt: string): Eintrag[] {
  const out: Eintrag[] = [];
  for (const zeile of inhalt.split(/\r?\n/)) {
    if (!zeile.trim()) continue;
    const e = leseZeile(zeile);
    if (e) out.push(e);
  }
  return out.sort((a, b) => a.zeit - b.zeit);
}

export function leseDatei(pfad: string): Eintrag[] {
  return leseText(readFileSync(pfad, 'utf8'));
}
