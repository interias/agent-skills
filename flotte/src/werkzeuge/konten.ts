// Accounts by short name (#14, acceptance 3, decision D): `1`, `2`, `3` or the name of the folder in
// the home directory, besides a full path. #94: ~/.claude/flotte/konten.json (outside the skill folder,
// install.ps1 never writes it) is the one source: per account number, folder, name, colour, aktiv.
// Without the file the standard accounts 1-3 apply.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export interface Konto {
  nr: string;
  ordner: string;
  name: string;
  farbe: string;
  aktiv: boolean;
}

export const KONTEN_DATEI = join(homedir(), '.claude', 'flotte', 'konten.json');
export const STANDARD_LISTE: Konto[] = [
  { nr: '1', ordner: '~/.claude', name: 'Hauptkonto', farbe: '#8FB573', aktiv: true },
  { nr: '2', ordner: '~/.claude-arbeitspferd', name: 'Arbeitspferd', farbe: '#D97757', aktiv: true },
  { nr: '3', ordner: '~/.claude-arbeitspferd-3', name: 'Arbeitspferd 3', farbe: '#7AA2C8', aktiv: true },
];
export const STANDARD_KONTEN: Record<string, string> = Object.fromEntries(STANDARD_LISTE.map((k) => [k.nr, k.ordner]));

const tilde = (p: string, heim = homedir()) => (p.startsWith('~') ? join(heim, p.slice(1)) : p);
const gleich = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/** The accounts of konten.json, else the standard 1-3; a file that is no list of accounts is named, never ignored. */
export function liesKonten(datei = KONTEN_DATEI): Konto[] {
  if (!existsSync(datei)) return STANDARD_LISTE.map((k) => ({ ...k }));
  let roh: unknown;
  try {
    roh = JSON.parse(readFileSync(datei, 'utf8'));
  } catch {
    roh = null;
  }
  if (!Array.isArray(roh) || roh.some((k) => typeof k?.nr !== 'string' || typeof k?.ordner !== 'string')) {
    throw new Error(`${datei} ist kein JSON der Form [{ "nr": "1", "ordner": "~/.claude", "name": "…", "farbe": "#…", "aktiv": true }, …]`);
  }
  return roh.map((k) => ({ nr: k.nr, ordner: k.ordner, name: k.name ?? `Konto ${k.nr}`, farbe: k.farbe ?? '#D97757', aktiv: k.aktiv !== false }));
}

export function schreibeKonten(liste: Konto[], datei = KONTEN_DATEI): void {
  mkdirSync(dirname(datei), { recursive: true });
  writeFileSync(datei, JSON.stringify(liste, null, 2) + '\n');
}

/** number → folder; with `nurAktive` the deactivated accounts are left out (they keep their number in the file). */
export function kontenTafel(datei = KONTEN_DATEI, nurAktive = false): Record<string, string> {
  return Object.fromEntries(liesKonten(datei).filter((k) => !nurAktive || k.aktiv).map((k) => [k.nr, k.ordner]));
}

/** The CLAUDE_CONFIG_DIRs of `dirs` without the deactivated accounts, in their order (#94: a deactivated account drops out of the choice). */
export function aktiveAuswahl(dirs: string[], datei = KONTEN_DATEI, heim = homedir()): string[] {
  const aus = liesKonten(datei).filter((k) => !k.aktiv).map((k) => resolve(tilde(k.ordner, heim)));
  return dirs.filter((d) => !aus.some((a) => gleich(a, d)));
}

/** The short name of an account for the board (#28): `Konto 2` by the table, else its folder name, never the path. */
export function kurzname(dir: string, admiral: string | null = null, tafel: Record<string, string> = kontenTafel()): string {
  const nr = Object.keys(tafel).find((n) => gleich(tilde(tafel[n]), dir));
  if (nr) return `Konto ${nr}`;
  return dir === admiral ? 'Admiral-Konto' : basename(dir);
}

/** The CLAUDE_CONFIG_DIR of an account: a number from the table, a folder name in the home directory, or a path. */
export function kontoAus(name: string, tafel: Record<string, string> = kontenTafel(), heim = homedir()): string {
  const n = name.trim();
  if (/^\d+$/.test(n)) {
    if (!tafel[n]) throw new Error(`Konto ${n} ist nicht bekannt (Kurznamen: ${Object.keys(tafel).join(', ')}; ${KONTEN_DATEI})`);
    return resolve(tilde(tafel[n], heim));
  }
  if (n.startsWith('~') || isAbsolute(n) || /[\\/]/.test(n)) return resolve(tilde(n, heim));
  return join(heim, n);
}
