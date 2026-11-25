// The gate block in a pull request description (#14, round 5, B) and its contexts. The same rules as
// merge.ps1 (Test-GateBlock): the last run counts, with base, head and the green line; the driver
// reads them to decide whether it gates itself, merge.ps1 checks them again on the forge and does not
// take the driver's word.

import type { Adapter } from '../werkzeuge/belegung.ts';
import { gateKontext } from '../epic/zaehlen.ts';

export interface GateForm {
  heading: string;
  green: string;
  base: RegExp;
  head: RegExp;
  /** gate_cached: a context line it matches took its result from the gate's cache; null: the adapter says nothing */
  cached: RegExp | null;
}

/** A context of the gate block: result gruen, rot or the block's own word (übersprungen …), duration and cache as read; null: unknown. */
export interface GateKontext {
  name: string;
  ergebnis: string;
  dauerS: number | null;
  cache: boolean | null;
}

/** One gate run of the driver: when it ended, for which mission and PR, how long it took, green or not, its contexts. */
export interface AndockMessung {
  zeit: string;
  epic: number;
  pr: number | null;
  dauerS: number;
  gruen: boolean;
  kontexte: GateKontext[];
}

export interface GateLauf {
  base: string;
  head: string | null;
  gruen: boolean;
}

export function gateForm(a: Adapter): GateForm {
  return {
    heading: a.gate_heading ?? '## Gate',
    green: a.gate_green ?? 'Gate grün.',
    base: new RegExp(a.gate_base ?? 'Basis \\S+ @ ([0-9a-f]{7,40})'),
    head: new RegExp(a.gate_head ?? '\\(HEAD ([0-9a-f]{7,40})\\)'),
    cached: muster(a.gate_cached),
  };
}

/** An adapter pattern that does not compile gives null: the measurement then lacks the statement, nothing stops. */
function muster(text: string | null): RegExp | null {
  if (!text) return null;
  try {
    return new RegExp(text);
  } catch {
    return null;
  }
}

/** The contexts of a gate block: its context lines (gateKontext) between the line with the base and the end. */
export function kontexteAus(block: string, f: GateForm): GateKontext[] {
  const zeilen = block.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
  const s = zeilen.findIndex((z) => f.base.test(z));
  if (s < 0) return [];
  return zeilen.slice(s + 1).flatMap((z) => {
    const k = gateKontext(z);
    return k ? [{ name: k.name.slice(0, 100), ergebnis: k.ergebnis.slice(0, 40), dauerS: k.dauerS, cache: f.cached ? f.cached.test(z) : null }] : [];
  });
}

/** n of m contexts from the cache, counted over the contexts that ran (green or red); null without a cache statement. */
export function cacheAnteil(kontexte: GateKontext[]): { n: number; m: number } | null {
  const gelaufen = kontexte.filter((k) => k.cache !== null && (k.ergebnis === 'gruen' || k.ergebnis === 'rot'));
  return gelaufen.length ? { n: gelaufen.filter((k) => k.cache).length, m: gelaufen.length } : null;
}

function abschnitt(body: string, heading: string): { zeilen: string[]; von: number; bis: number } | null {
  const zeilen = body.split(/\r?\n/);
  const von = zeilen.findIndex((z) => z.trim() === heading.trim());
  if (von < 0) return null;
  const ebene = (/^(#+)/.exec(heading.trim())?.[1] ?? '##').length;
  let bis = zeilen.length;
  for (let i = von + 1; i < zeilen.length; i++) {
    const h = /^(#+)\s/.exec(zeilen[i]);
    if (h && h[1].length <= ebene) {
      bis = i;
      break;
    }
  }
  return { zeilen, von, bis };
}

/** The runs of the gate section in order; null without a section. */
export function gateLaeufe(body: string, f: GateForm): GateLauf[] | null {
  const a = abschnitt(body, f.heading);
  return a ? laeufeIn(a.zeilen.slice(a.von + 1, a.bis), f) : null;
}

/** The runs in a text, each from a line with a base to the next one. */
function laeufeIn(zeilen: string[], f: GateForm): GateLauf[] {
  const starts = zeilen.map((z, i) => (f.base.test(z) ? i : -1)).filter((i) => i >= 0);
  return starts.map((s, k) => {
    const bis = starts[k + 1] ?? zeilen.length;
    return {
      base: f.base.exec(zeilen[s])![1],
      head: f.head.exec(zeilen[s])?.[1] ?? null,
      gruen: zeilen.slice(s + 1, bis).some((z) => z.trim() === f.green),
    };
  });
}

/**
 * The core of a gate command: without leading environment assignments (`$env:X='0';`, `X=0 `,
 * `set X=0 &&`), so that `$env:HIVE_TESTBETT='0'; npm run gate -- --voll` matches a call that sets
 * the variable another way.
 */
export function gateKern(befehl: string): string {
  let b = befehl.trim();
  for (;;) {
    const n = b.replace(/^\$env:\w+\s*=\s*('[^']*'|"[^"]*"|\S+)\s*;\s*/i, '').replace(/^set\s+\w+=\S*\s*&&\s*/i, '').replace(/^\w+=('[^']*'|"[^"]*"|\S*)\s+/, '');
    if (n === b) return b;
    b = n;
  }
}

type Inhalt = { type?: string; id?: string; name?: string; input?: { command?: unknown }; tool_use_id?: string; content?: unknown };

/**
 * The gate runs in a run's log that are the output of a real gate call (acceptance 3, finding 2;
 * follow-up check of #27): each tool result is matched to its call by tool_use_id, also in subagents,
 * and counts only when the call was Bash or PowerShell and its command holds the core of one of the
 * gate commands. A PR text seen with `gh pr view`, the snippet after an Edit, an `echo` of a block or
 * a Read of a gate's output file is no gate run; in doubt the driver runs the gate itself.
 */
export function gateLaeufeImLog(log: string, f: GateForm, befehle: string[]): GateLauf[] {
  const kerne = befehle.map(gateKern).filter(Boolean);
  if (!kerne.length) return [];
  const aufrufe = new Map<string, string>();
  const ergebnisse: { id: string; text: string }[] = [];
  for (const zeile of log.split(/\r?\n/)) {
    let j: { type?: string; message?: { content?: unknown } };
    try {
      j = JSON.parse(zeile);
    } catch {
      continue;
    }
    if (!Array.isArray(j.message?.content)) continue;
    for (const c of j.message.content as Inhalt[]) {
      if (j.type === 'assistant' && c.type === 'tool_use' && c.id && (c.name === 'Bash' || c.name === 'PowerShell') && typeof c.input?.command === 'string') aufrufe.set(c.id, c.input.command);
      if (j.type === 'user' && c.type === 'tool_result' && c.tool_use_id) {
        const text = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? (c.content as { text?: string }[]).map((x) => x.text ?? '').join('\n') : '';
        ergebnisse.push({ id: c.tool_use_id, text });
      }
    }
  }
  return ergebnisse
    .filter((e) => {
      const befehl = aufrufe.get(e.id);
      return befehl !== undefined && kerne.some((k) => befehl.includes(k));
    })
    .flatMap((e) => laeufeIn(e.text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/), f));
}

/** Two SHAs name the same commit when the shorter is a prefix of the longer. */
export const gleich = (a: string | null, b: string | null) => !!a && !!b && (a.length <= b.length ? b.startsWith(a) : a.startsWith(b));


/** The block of a gate output: from its last line with a base to the end; null when no line names a base. */
export function blockAus(ausgabe: string, f: GateForm): { block: string; gruen: boolean } | null {
  const zeilen = ausgabe.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
  let s = -1;
  zeilen.forEach((z, i) => {
    if (f.base.test(z)) s = i;
  });
  if (s < 0) return null;
  const block = zeilen.slice(s).join('\n').trimEnd();
  return { block, gruen: zeilen.slice(s + 1).some((z) => z.trim() === f.green) };
}

/**
 * Adds a gate run as a code block to the gate section, right after its last code block (text after
 * it, such as Closes lines, stays below), else at the end of the section; the last run counts.
 */
export function blockEinsetzen(body: string, f: GateForm, block: string): string {
  const neu = ['```', block, '```'];
  const a = abschnitt(body, f.heading);
  if (!a) return `${body.trimEnd()}\n\n${f.heading}\n\n${neu.join('\n')}\n`;
  let nach = -1;
  for (let i = a.von + 1; i < a.bis; i++) if (a.zeilen[i].trim().startsWith('```')) nach = i;
  if (nach >= 0) return [...a.zeilen.slice(0, nach + 1), ...neu, ...a.zeilen.slice(nach + 1)].join('\n');
  let ende = a.bis;
  while (ende > a.von + 1 && !a.zeilen[ende - 1].trim()) ende--;
  return [...a.zeilen.slice(0, ende), ...neu, ...(a.bis < a.zeilen.length ? ['', ...a.zeilen.slice(a.bis)] : [])].join('\n');
}
