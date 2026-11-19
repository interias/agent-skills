// flotte bloecke <datei|->: reads the last FLOTTE-FRAGE or FLOTTE-ENDE block of a run's final
// text (epic-flotte/SKILL.md, "Die Blöcke"). FLOTTE-WELLE is gone (#14, decision 3).

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
  empfehlung: string | null;
  grund: string;
  quelle: string;
}

export interface FrageBlock {
  art: 'frage';
  epic: number;
  phase: string;
  fragen: Frage[];
  stand: string;
  tafel: string;
}

export interface EndeBlock {
  art: 'ende';
  epic: number;
  pr: number | null;
  prUrl: string | null;
  offen: string;
}

export type Block = FrageBlock | EndeBlock;

const KOPF = /^\s*(?:\*\*)?FLOTTE-(FRAGE|ENDE)(?:\*\*)?\s+#?(\d+)\b(.*)$/;

function felder(zeile: string): Map<string, string> {
  const out = new Map<string, string>();
  const teile = zeile.split(/\s+[—–]\s+/);
  out.set('Frage', teile[0].replace(/^\s*\d+[.)]\s*/, '').trim());
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

function optionenAus(wert: string | undefined): Option[] {
  if (!wert) return [];
  const out: Option[] = [];
  const re = /(?:^|\s)([A-H])\)\s*(.*?)(?=\s+[A-H]\)\s|$)/gs;
  for (const m of wert.matchAll(re)) out.push({ buchstabe: m[1], text: m[2].trim() });
  return out;
}

function frageAus(nr: number, zeile: string): Frage {
  const f = felder(zeile);
  const empf = f.get('Empfehlung');
  return {
    nr,
    frage: f.get('Frage') ?? '',
    betrifft: betrifftAus(f.get('Betrifft')),
    lage: f.get('Lage') ?? '',
    optionen: optionenAus(f.get('Optionen')),
    empfehlung: empf ? (/^([A-H])\b/.exec(empf)?.[1] ?? empf) : null,
    grund: f.get('Grund') ?? '',
    quelle: f.get('Regel/Quelle') ?? f.get('Quelle') ?? '',
  };
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
    const ganz = [kopf[3], ...rest].join('\n');
    const url = /https?:\/\/\S+\/pull(?:s)?\/(\d+)/.exec(ganz);
    const nummer = url ? Number(url[1]) : /\bPR\s*#(\d+)/i.exec(ganz) ? Number(/\bPR\s*#(\d+)/i.exec(ganz)![1]) : null;
    const offenStart = rest.findIndex((z) => /^###\s+Was das Epic offen lässt/.test(z.trim()));
    const offen = offenStart >= 0 ? rest.slice(offenStart + 1).join('\n').trim() : '';
    return { art: 'ende', epic, pr: nummer, prUrl: url ? url[0].replace(/[).,]+$/, '') : null, offen };
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
    const nummer = /^\s*(\d+)[.)]\s+(.*)$/.exec(z);
    const st = /^\s*STAND:\s*(.*?)(?:\s+TAFEL:\s*(\S+))?\s*$/.exec(z);
    if (st) {
      abschliessen();
      stand = st[1].trim();
      tafel = st[2] ?? '';
      continue;
    }
    if (nummer) {
      abschliessen();
      aktuell = { nr: Number(nummer[1]), text: z };
      continue;
    }
    if (aktuell && z.trim()) aktuell.text += ' ' + z.trim();
  }
  abschliessen();
  return { art: 'frage', epic, phase, fragen, stand, tafel };
}

export function bloecke(argv: string[]): unknown {
  const datei = argv[0];
  if (!datei) throw new Error('Aufruf: flotte bloecke <datei|->');
  const text = readFileSync(datei === '-' ? 0 : datei, 'utf8');
  return { block: leseBlock(text) };
}
