// Accounts by short name (#14, acceptance 3, decision D): `1`, `2`, `3` or the name of the folder in
// the home directory, besides a full path. The numbers come from konten.json next to the skill
// ({ "1": "~/.claude", ... }), else from the standard below.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KONTEN_DATEI = fileURLToPath(new URL('../../konten.json', import.meta.url));
export const STANDARD_KONTEN: Record<string, string> = { '1': '~/.claude', '2': '~/.claude-arbeitspferd', '3': '~/.claude-arbeitspferd-3' };

const tilde = (p: string) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

export function kontenTafel(datei = KONTEN_DATEI): Record<string, string> {
  if (!existsSync(datei)) return STANDARD_KONTEN;
  try {
    return { ...STANDARD_KONTEN, ...(JSON.parse(readFileSync(datei, 'utf8')) as Record<string, string>) };
  } catch {
    throw new Error(`${datei} ist kein JSON der Form { "1": "<kontenordner>", ... }`);
  }
}

/** The CLAUDE_CONFIG_DIR of an account: a number from the table, a folder name in the home directory, or a path. */
export function kontoAus(name: string, tafel: Record<string, string> = kontenTafel()): string {
  const n = name.trim();
  if (/^\d+$/.test(n)) {
    if (!tafel[n]) throw new Error(`Konto ${n} ist nicht bekannt (Kurznamen: ${Object.keys(tafel).join(', ')}; ${KONTEN_DATEI})`);
    return resolve(tilde(tafel[n]));
  }
  if (n.startsWith('~') || isAbsolute(n) || /[\\/]/.test(n)) return resolve(tilde(n));
  return join(homedir(), n);
}
