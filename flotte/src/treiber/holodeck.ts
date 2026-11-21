// Holodeck (#44): the driver reads the prototypes of its project and sends them to the bridge, which
// runs in a container and sees no project folder. Only the HTML files directly in the folder of the
// adapter key prototype_dir (default prototypen/, relative to the repository root): no subfolders,
// no symlinks or junctions, nothing outside the folder. Only the file name leaves the machine, never
// a path (the repository is public, paths hold user names).

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const PROTOTYPEN_MAX = 50;
export const PROTOTYP_MAX_BYTES = 2 * 1024 * 1024;
/** the bridge's rule for a file name (flottenbruecke/app/modelle.py, PROTOTYP_NAME) */
export const PROTOTYP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.html$/;

/** One prototype as POST /api/holodeck takes it (flottenbruecke/beispiel/holodeck.json). */
export interface Prototyp {
  name: string;
  titel: string;
  /** mtime of the file, ISO */
  geaendert: string;
  inhalt: string;
}

const ZEICHEN: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The text of <title>, entities resolved; the file name without one. */
export function titelAus(html: string, name: string): string {
  const roh = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const text = roh
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ZEICHEN[e.toLowerCase()] ?? m;
      const n = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return kuerze(text || name, 300);
}

/** at most n code points: a cut surrogate pair would make the bridge's SQLite fail with 500 */
const kuerze = (s: string, n: number) => Array.from(s).slice(0, n).join('');

/** inside(a, b): b is a or lies below it */
const innerhalb = (a: string, b: string) => {
  const r = relative(a, b);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};

/**
 * The prototypes of the repository, sorted by name, and what the driver reports once as an event
 * (never with a path). A missing folder is no message: the project has no prototypes.
 */
export function liesPrototypen(repo: string, ordner: string): { dateien: Prototyp[]; meldungen: string[] } {
  const meldungen: string[] = [];
  const dateien: Prototyp[] = [];
  const teile = ordner.split(/[\\/]+/).filter(Boolean);
  if (!ordner.trim() || isAbsolute(ordner) || /^[A-Za-z]:/.test(ordner) || /^[\\/]/.test(ordner) || teile.includes('..')) {
    return { dateien, meldungen: ['prototype_dir führt aus dem Repository (absolut oder mit ..): nichts gelesen'] };
  }
  try {
    const wurzel = realpathSync(repo);
    const pfad = resolve(wurzel, ...teile);
    let st;
    try {
      st = lstatSync(pfad);
    } catch {
      return { dateien, meldungen };
    }
    if (st.isSymbolicLink() || !st.isDirectory()) return { dateien, meldungen: ['prototype_dir ist kein Ordner im Repository (Verknüpfung oder Datei): nichts gelesen'] };
    const echt = realpathSync(pfad);
    // a junction on the way (Windows) leads elsewhere without being a symlink itself
    if (!innerhalb(wurzel, echt)) return { dateien, meldungen: ['prototype_dir führt aus dem Repository (Verknüpfung auf dem Weg): nichts gelesen'] };
    const namen = readdirSync(echt).sort();
    for (const name of namen) {
      if (!name.toLowerCase().endsWith('.html')) continue;
      if (!PROTOTYP_NAME.test(name)) {
        meldungen.push(`${kuerze(name, 120)} übersprungen (Dateiname nur aus Buchstaben, Ziffern, . _ -)`);
        continue;
      }
      const datei = resolve(echt, name);
      const f = lstatSync(datei);
      if (f.isSymbolicLink() || !f.isFile()) continue;
      if (dirname(realpathSync(datei)) !== echt) continue;
      if (f.size > PROTOTYP_MAX_BYTES) {
        meldungen.push(`${name} übersprungen (größer als ${PROTOTYP_MAX_BYTES / 1024 / 1024} MB)`);
        continue;
      }
      if (dateien.length >= PROTOTYPEN_MAX) {
        meldungen.push(`mehr als ${PROTOTYPEN_MAX} Prototypen, der Rest fehlt`);
        break;
      }
      const inhalt = readFileSync(datei, 'utf8');
      dateien.push({ name, titel: titelAus(inhalt, name), geaendert: new Date(f.mtimeMs).toISOString(), inhalt });
    }
  } catch (err) {
    meldungen.push(`Ordner nicht lesbar (${(err as NodeJS.ErrnoException).code ?? 'Fehler'})`);
  }
  return { dateien, meldungen };
}

/** The state of a set over names and contents: only a changed set goes to the bridge again. */
export function prototypenStand(dateien: Prototyp[]): string {
  const h = createHash('sha256');
  for (const d of dateien) h.update(`${d.name}\0${d.inhalt}\0`);
  return h.digest('hex');
}
