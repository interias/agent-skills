// The gate block in a pull request description and the areas of the gate (#14, round 5, B). The
// same rules as merge.ps1 (Test-GateBlock): the driver uses them to decide whether the part that
// always runs is enough after it merged the base into an epic branch; merge.ps1 checks them again on
// the forge and does not take the driver's word.

import type { Adapter } from '../werkzeuge/belegung.ts';

export interface GateForm {
  heading: string;
  green: string;
  base: RegExp;
  head: RegExp;
  teil: RegExp;
}

export interface GateLauf {
  base: string;
  head: string | null;
  gruen: boolean;
  /** only the part that always runs (gate_partial in its head line) */
  teil: boolean;
}

export interface Bereich {
  muster: RegExp;
  name: string;
}

export const OHNE_BEREICH = '(ohne Bereich)';

export function gateForm(a: Adapter): GateForm {
  return {
    heading: a.gate_heading ?? '## Gate',
    green: a.gate_green ?? 'Gate grün.',
    base: new RegExp(a.gate_base ?? 'Basis \\S+ @ ([0-9a-f]{7,40})'),
    head: new RegExp(a.gate_head ?? '\\(HEAD ([0-9a-f]{7,40})\\)'),
    teil: new RegExp(a.gate_partial ?? 'Immer-Teil'),
  };
}

/** gate_areas: `<pattern> = <name>`; ** spans folders, * and ? stay inside one, a trailing / is the folder. */
export function globRegex(muster: string): RegExp {
  const m = muster.endsWith('/') ? `${muster}**` : muster;
  let r = '';
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === '*' && m[i + 1] === '*') {
      if (m[i + 2] === '/') {
        r += '(.*/)?';
        i += 2;
      } else {
        r += '.*';
        i += 1;
      }
    } else if (c === '*') r += '[^/]*';
    else if (c === '?') r += '[^/]';
    else r += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${r}$`);
}

export function bereicheAus(eintraege: string[]): Bereich[] {
  return eintraege.flatMap((e) => {
    const m = /^\s*(\S+)\s*=\s*(\S+)\s*$/.exec(e);
    return m ? [{ muster: globRegex(m[1]), name: m[2] }] : [];
  });
}

/** The areas of some files; a file in no area is OHNE_BEREICH and counts as touching every area. */
export function bereicheVon(dateien: string[], bereiche: Bereich[]): Set<string> {
  const namen = new Set<string>();
  for (const d of dateien) {
    const treffer = bereiche.filter((b) => b.muster.test(d)).map((b) => b.name);
    if (treffer.length) for (const t of treffer) namen.add(t);
    else namen.add(OHNE_BEREICH);
  }
  return namen;
}

/** The areas where the moved base and the epic meet; empty: the base moved only beside the epic. */
export function gemeinsameBereiche(bewegt: string[], epic: string[], bereiche: Bereich[]): string[] {
  const b = bereicheVon(bewegt, bereiche);
  const e = bereicheVon(epic, bereiche);
  const beide = [...b].filter((x) => e.has(x) || x === OHNE_BEREICH);
  if (e.has(OHNE_BEREICH) && b.size) beide.push(OHNE_BEREICH);
  return [...new Set(beide)];
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
      teil: f.teil.test(zeilen[s]),
    };
  });
}

/** The text of the tool results in one stream-json line of a run's log (main session and subagents). */
function werkzeugErgebnisse(zeile: string): string[] {
  let j: { type?: string; message?: { content?: unknown } };
  try {
    j = JSON.parse(zeile);
  } catch {
    return [];
  }
  if (j.type !== 'user' || !Array.isArray(j.message?.content)) return [];
  return (j.message.content as { type?: string; content?: unknown }[])
    .filter((c) => c.type === 'tool_result')
    .map((c) => (typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? (c.content as { text?: string }[]).map((x) => x.text ?? '').join('\n') : ''));
}

/**
 * The gate runs that appear in a run's log as the result of a tool call (acceptance 3, finding 2): the
 * output of a real gate call, not a block the run wrote into its text or the PR. The line numbers of
 * a Read (a gate in the background, read from its output file) are dropped.
 */
export function gateLaeufeImLog(log: string, f: GateForm): GateLauf[] {
  return log
    .split(/\r?\n/)
    .flatMap(werkzeugErgebnisse)
    .flatMap((t) => laeufeIn(t.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map((z) => z.replace(/^\s*\d+(\t|→)/, '')), f));
}

/** Two SHAs name the same commit when the shorter is a prefix of the longer. */
export const gleich = (a: string | null, b: string | null) => !!a && !!b && (a.length <= b.length ? b.startsWith(a) : a.startsWith(b));

/** The last full green run before the end (the base of a part run), or null. */
export function letzterVollLauf(laeufe: GateLauf[]): GateLauf | null {
  for (let i = laeufe.length - 1; i >= 0; i--) if (!laeufe[i].teil) return laeufe[i].gruen && laeufe[i].head ? laeufe[i] : null;
  return null;
}

/** The block of a gate output: from its last line with a base to the end; null when no line names a base. */
export function blockAus(ausgabe: string, f: GateForm): { block: string; gruen: boolean; teil: boolean } | null {
  const zeilen = ausgabe.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
  let s = -1;
  zeilen.forEach((z, i) => {
    if (f.base.test(z)) s = i;
  });
  if (s < 0) return null;
  const block = zeilen.slice(s).join('\n').trimEnd();
  return { block, gruen: zeilen.slice(s + 1).some((z) => z.trim() === f.green), teil: f.teil.test(zeilen[s]) };
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
