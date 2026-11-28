// flotte bloecke <datei|->: reads the last FLOTTE-FRAGE or FLOTTE-ENDE block of a run's final
// text (flotte/references/bloecke.md).

import { readFileSync } from 'node:fs';

export interface Option {
  buchstabe: string;
  text: string;
}

export interface Frage {
  nr: number;
  frage: string;
  /** 'Lauf': the whole run waits; a list: only these packages wait; null: the field is missing */
  betrifft: 'Lauf' | string[] | null;
  lage: string;
  optionen: Option[];
  /** `— Auswahl: mehrere`: the answer may name several options (`A, C`); default single choice */
  mehrfach: boolean;
  empfehlung: string | null;
  grund: string;
  quelle: string;
  /** #243: the question in one sentence of at most KURZ_MAX characters for the card and the push; null: missing or too long */
  kurz: string | null;
  /** the question as the run wrote it, for the board when the fields do not parse (#28) */
  roh: string;
}

export interface FrageBlock {
  art: 'frage';
  epic: number;
  phase: string;
  fragen: Frage[];
  stand: string;
  tafel: string;
  /** the whole block as the run wrote it: what the person sees when no question parses (#28) */
  roh: string;
}

export interface EndeBlock {
  art: 'ende';
  epic: number;
  pr: number | null;
  prUrl: string | null;
  offen: string;
  /** an end without a pull request: what the person has to do before the mission goes on (`Mensch:` line) */
  mensch: MenschSchritt | null;
}

export const MENSCH_ARTEN = ['warten-auf', 'pr-andocken', 'label-setzen', 'entscheiden'] as const;

export interface MenschSchritt {
  art: (typeof MENSCH_ARTEN)[number];
  /** the ticket or PR it waits for: `#123` of the own forge or `owner/repo#123` */
  ref: string | null;
  /** her step in one sentence */
  text: string;
}

export type Block = FrageBlock | EndeBlock;

const KOPF = /^\s*(?:\*\*)?FLOTTE-(FRAGE|ENDE)(?:\*\*)?\s+#?(\d+)\b(.*)$/;
const MENSCH = /^\s*(?:\*\*)?Mensch:(?:\*\*)?\s*(.*)$/;

/** `Mensch: <art> [<ref>] — <sentence>`; an unknown kind is a decision of the person with the whole text */
function menschAus(zeile: string | undefined): MenschSchritt | null {
  const wert = zeile ? MENSCH.exec(zeile)![1].trim() : '';
  if (!wert) return null;
  const m = new RegExp(`^(${MENSCH_ARTEN.join('|')})\\b\\s*((?:[\\w.-]+\\/[\\w.-]+)?#\\d+)?\\s*(?:[—–-]\\s*)?(.*)$`, 's').exec(wert);
  if (!m) return { art: 'entscheiden', ref: null, text: wert.slice(0, 300) };
  return { art: m[1] as MenschSchritt['art'], ref: m[2] ?? null, text: (m[3].trim() || wert).slice(0, 300) };
}

function felder(zeile: string): Map<string, string> {
  const out = new Map<string, string>();
  const teile = zeile.split(/\s+[—–]\s+/);
  out.set('Frage', teile[0].replace(/^\s*\d+[.)]\s*/, '').trim().replace(/^\*\*(.+)\*\*$/, '$1'));
  for (const t of teile.slice(1)) {
    const m = /^([A-Za-zÄÖÜäöüß/]+):\s*(.*)$/s.exec(t.trim());
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}

function betrifftAus(wert: string | undefined): Frage['betrifft'] {
  if (wert === undefined || !wert.trim()) return null;
  if (/^lauf\b/i.test(wert.trim())) return 'Lauf';
  const pakete = wert
    .split(/[,;]|\s+und\s+|\s+/)
    .map((x) => x.trim().replace(/[.)]$/, ''))
    .filter((x) => /^(#?\d+(-p\d+)?|p\d+|[\w-]+\/[\w-]+)$/i.test(x));
  return pakete.length ? pakete : null;
}

/** A) … B) … in alphabetical order, as many as there are; a letter out of order is part of a text. */
function optionenAus(wert: string | undefined): Option[] {
  if (!wert) return [];
  const stellen: { buchstabe: string; von: number; text: number }[] = [];
  let ab = 0;
  for (let c = 65; c <= 90; c++) {
    const buchstabe = String.fromCharCode(c);
    const re = new RegExp(`(?:^|\\s)${buchstabe}\\)\\s*`, 'g');
    re.lastIndex = ab;
    const m = re.exec(wert);
    if (!m) break;
    stellen.push({ buchstabe, von: m.index, text: m.index + m[0].length });
    ab = m.index + m[0].length;
  }
  return stellen.map((st, i) => ({ buchstabe: st.buchstabe, text: wert.slice(st.text, stellen[i + 1]?.von ?? wert.length).trim() }));
}

/** `B` or `A, C`: an answer that only names options */
export const nurBuchstaben = (text: string) => /^[A-Z](?:\s*[,;]\s*[A-Z])*$/.test(text.trim());

/** The letters at the start of an answer or recommendation (`B`, `A, C`), null when it starts with none. */
export function buchstabenAus(text: string): string | null {
  const m = /^\s*([A-Z](?:\s*[,;]\s*[A-Z])*)(?![\wÄÖÜäöüß])/.exec(text);
  return m ? m[1].split(/\s*[,;]\s*/).join(', ') : null;
}

/**
 * A run that writes its options into the question text (`… - A) … - B) … ➡️ **C** …`, no
 * `— Optionen:` field): question, options, recommendation and Betrifft from the running text, so
 * the bridge offers buttons instead of free text only.
 */
function fliesstext(f: Map<string, string>): void {
  const text = f.get('Frage') ?? '';
  const a = /(?:^|\s)(?:-\s+)?A\)\s/.exec(text);
  if (!a || !/(?:^|\s)B\)\s/.test(text.slice(a.index))) return;
  let rest = text.slice(a.index);
  const pfeil = /\s*(?:➡️|➡|→|=>)\s*/.exec(rest);
  let nach = '';
  if (pfeil) {
    nach = rest.slice(pfeil.index + pfeil[0].length);
    rest = rest.slice(0, pfeil.index);
  }
  const betrifft = /\s*Betrifft:\s*([^.]*)\.?\s*$/.exec(nach);
  if (betrifft) {
    if (!f.has('Betrifft')) f.set('Betrifft', betrifft[1]);
    nach = nach.slice(0, betrifft.index);
  }
  f.set('Frage', text.slice(0, a.index).trim());
  f.set('Optionen', rest.replace(/(^|\s)-\s+(?=[A-Z]\)\s)/g, '$1').trim());
  const empf = nach.replace(/\*\*/g, '').trim();
  if (empf && !f.has('Empfehlung')) f.set('Empfehlung', empf);
}

function frageAus(nr: number, zeile: string): Frage {
  const f = felder(zeile);
  if (!f.has('Optionen')) fliesstext(f);
  const empf = f.get('Empfehlung');
  return {
    nr,
    frage: f.get('Frage') ?? '',
    betrifft: betrifftAus(f.get('Betrifft')),
    lage: f.get('Lage') ?? '',
    optionen: optionenAus(f.get('Optionen')),
    mehrfach: /^(mehrere|mehrfach)/i.test(f.get('Auswahl') ?? ''),
    empfehlung: empf ? (buchstabenAus(empf) ?? empf) : null,
    grund: f.get('Grund') ?? '',
    quelle: f.get('Regel/Quelle') ?? f.get('Quelle') ?? '',
    kurz: kurzAus(f.get('Kurz')),
    roh: zeile.trim(),
  };
}

const FELD = /^(Betrifft|Lage|Optionen|Auswahl|Empfehlung|Grund|Regel\/Quelle|Quelle|Kurz):/;

/** #243: the short line as the run wrote it, when it fits whole (90 characters); never cut */
function kurzAus(wert: string | undefined): string | null {
  // a whole sentence: one that ends on ":" or "," is cut off, not a short line
  const s = (wert ?? '').trim().replace(/^\*\*(.+)\*\*$/, '$1');
  return s && s.length <= 90 && !/[:,;–-]$/.test(s) ? s : null;
}

/**
 * A line that continues a question. #152: a field on its own line (`Lage: …`, also `**Lage:** …`)
 * starts a field as ` — Lage: …` would; an option as a list item (`- **A)** …`) joins as `A) …`.
 */
function folgeZeile(z: string): string {
  const t = z.trim().replace(/^\*\*([^*:]+):\*\*/, '$1:');
  if (FELD.test(t)) return ` — ${t}`;
  const option = /^[-*]\s+(?:\*\*)?([A-Z])\)(?:\*\*)?\s*(.*)$/.exec(t);
  if (option) return ` ${option[1]}) ${option[2]}`;
  return ` ${t}`;
}

/** The last block in the text, or null when the run ended without one. */
export function leseBlock(text: string): Block | null {
  const zeilen = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < zeilen.length; i++) if (KOPF.test(zeilen[i])) start = i;
  if (start < 0) return null;
  const kopf = KOPF.exec(zeilen[start])!;
  const epic = Number(kopf[2]);
  const rest = zeilen.slice(start + 1);

  if (kopf[1] === 'ENDE') {
    const offenStart = rest.findIndex((z) => /^###\s+Was das Epic offen lässt/.test(z.trim()));
    const oben = offenStart >= 0 ? rest.slice(0, offenStart) : rest;
    const menschZeile = oben.find((z) => MENSCH.test(z));
    // the person's line names PRs of others ("PR #123 andocken"): never the run's own
    const ganz = [kopf[3], ...rest.filter((z) => z !== menschZeile)].join('\n');
    const url = /https?:\/\/\S+\/pull(?:s)?\/(\d+)/.exec(ganz);
    const nummer = url ? Number(url[1]) : /\bPR\s*#(\d+)/i.exec(ganz) ? Number(/\bPR\s*#(\d+)/i.exec(ganz)![1]) : null;
    const offen = offenStart >= 0 ? rest.slice(offenStart + 1).join('\n').trim() : '';
    return { art: 'ende', epic, pr: nummer, prUrl: url ? url[0].replace(/[).,]+$/, '') : null, offen, mensch: menschAus(menschZeile) };
  }

  const phase = (kopf[3].trim().split(/\s+/)[0] ?? '').toLowerCase();
  const fragen: Frage[] = [];
  let stand = '';
  let tafel = '';
  let aktuell: { nr: number; text: string } | null = null;
  const abschliessen = () => {
    if (aktuell) fragen.push(frageAus(aktuell.nr, aktuell.text));
    aktuell = null;
  };
  for (const z of rest) {
    // #152: `❓ **Q1** — **Frage**` starts a question like `1. Frage`
    // (with the ❓, in bold, or followed by a dash or colon: not a line that merely starts with `Q3-…`)
    const q = /^\s*(?:❓\s*(?:\*\*)?Q(\d+)(?:\*\*)?|\*\*Q(\d+)\*\*|Q(\d+)(?=\s+[—–]|:))\s*(?:[—–:.)-]\s*)?(.*)$/.exec(z);
    const qNr = q ? (q[1] ?? q[2] ?? q[3]) : null;
    const nummer = /^\s*(\d+)[.)]\s+(.*)$/.exec(z) ?? (q ? [z, qNr!, `${qNr}. ${q[4]}`] : null);
    const st = /^\s*STAND:\s*(.*?)(?:\s+TAFEL:\s*(\S+))?\s*$/.exec(z);
    if (st) {
      abschliessen();
      stand = st[1].trim();
      tafel = st[2] ?? '';
      continue;
    }
    if (nummer) {
      abschliessen();
      aktuell = { nr: Number(nummer[1]), text: q && !/^\s*\d+[.)]\s/.test(z) ? nummer[2] : z };
      continue;
    }
    if (aktuell && z.trim()) aktuell.text += folgeZeile(z);
  }
  abschliessen();
  return { art: 'frage', epic, phase, fragen, stand, tafel, roh: zeilen.slice(start).join('\n').trim() };
}

export function bloecke(argv: string[]): unknown {
  const datei = argv[0];
  if (!datei) throw new Error('Aufruf: flotte bloecke <datei|->');
  const text = readFileSync(datei === '-' ? 0 : datei, 'utf8');
  return { block: leseBlock(text) };
}
