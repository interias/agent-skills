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
