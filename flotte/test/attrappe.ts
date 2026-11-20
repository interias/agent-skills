// Test helpers around the stand-in: a script file per test and the starts it saw.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ATTRAPPE = fileURLToPath(new URL('../src/attrappe.ts', import.meta.url));

export interface Gesehen {
  n: number;
  args: string[];
  eingabe: string;
  cwd: string;
  konto: string | null;
  decke: string | null;
  halter: string | null;
}

export function drehbuch(aufrufe: unknown[]): { datei: string; gesehen: () => Gesehen[] } {
  const dir = mkdtempSync(join(tmpdir(), 'flotte-drehbuch-'));
  const datei = join(dir, 'drehbuch.json');
  writeFileSync(datei, JSON.stringify({ aufrufe }));
  return {
    datei,
    gesehen: () => (existsSync(`${datei}.aufrufe.jsonl`) ? readFileSync(`${datei}.aufrufe.jsonl`, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)) : []),
  };
}

/** Start options that run the stand-in with bun instead of claude. */
export function mitAttrappe(datei: string) {
  process.env.FLOTTE_DREHBUCH = datei;
  return { programm: process.execPath, programmArgs: [ATTRAPPE] };
}
