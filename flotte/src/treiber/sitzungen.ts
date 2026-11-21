// The sessions of the accounts for the ship list of the Flottenbrücke (#41): per account one
// `claude agents --json` with that account's CLAUDE_CONFIG_DIR, read only, nothing is steered. Only
// what the list shows leaves the machine: the account's short name, the last folder name of the
// working directory (never the path, never the pid), the session's name, status, kind and start. A
// missing command, an error or a timeout gives no sessions for that account and never stops the driver.

import type { AsyncAufrufer } from '../aufruf.ts';

/** how often the driver asks `claude agents`, at most */
export const SITZUNGEN_MS = 60_000;
export const SITZUNGEN_ZEIT_MS = 10_000;
const JE_KONTO = 100;

/** One session in the report (flottenbruecke/beispiel/bericht.json, `sitzungen[]`). */
export interface BerichtSitzung {
  konto: string;
  projekt: string;
  name: string;
  status: string;
  kind: string;
  seit: string;
}

/** The last name of a path, Windows or Unix; the root of a drive has none. */
export function letzterName(pfad: unknown): string {
  const name = String(pfad ?? '').split(/[\\/]+/).filter(Boolean).pop() ?? '';
  return /^[A-Za-z]:$/.test(name) ? '' : name;
}

const wort = (x: unknown, n: number) => (typeof x === 'string' && /^[\w-]+$/.test(x) ? x.slice(0, n) : '');

/** The sessions of one account out of the JSON of `claude agents --json`; whatever does not fit is dropped. */
export function sitzungenAusJson(roh: unknown, konto: string): BerichtSitzung[] {
  if (!Array.isArray(roh)) return [];
  const liste: BerichtSitzung[] = [];
  for (const s of roh.slice(0, JE_KONTO)) {
    if (s === null || typeof s !== 'object') continue;
    const ms = (s as { startedAt?: unknown }).startedAt;
    const name = String((s as { name?: unknown }).name ?? '');
    liste.push({
      konto,
      projekt: letzterName((s as { cwd?: unknown }).cwd).slice(0, 100),
      // a name that is a path shrinks to its last part like the folder
      name: (/[\\/]/.test(name) ? letzterName(name) : name).slice(0, 100),
      status: wort((s as { status?: unknown }).status, 20),
      kind: wort((s as { kind?: unknown }).kind, 20),
      seit: typeof ms === 'number' && Number.isFinite(ms) && ms > 0 && ms < 8.64e15 ? new Date(ms).toISOString() : '',
    });
  }
  return liste;
}

/**
 * The sessions of all accounts, `claude agents --json` at most one call per account at a time with a
 * short time limit. dir is the account's CLAUDE_CONFIG_DIR, konto its short name for the board.
 */
export async function liesSitzungen(konten: { dir: string; konto: string }[], langsam: AsyncAufrufer, programm = process.env.FLOTTE_CLAUDE ?? 'claude'): Promise<BerichtSitzung[]> {
  const je = await Promise.all(
    konten.map(async ({ dir, konto }) => {
      try {
        const r = await langsam(programm, ['agents', '--json'], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: SITZUNGEN_ZEIT_MS });
        return r.code === 0 ? sitzungenAusJson(JSON.parse(r.stdout), konto) : [];
      } catch {
        return [];
      }
    }),
  );
  return je.flat();
}
