// flotte ressourcen <repo> [--platte-min-gb 20]
// RAM through mission/scripts/ram.ps1 (a failed measurement counts as hold), free disk space of the
// repository's drive, docker reachable. The RAM brake with hysteresis lives in naechsteBremse().

import { statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { aufrufenAsync, pwshJsonAsync, type AsyncAufrufer } from '../aufruf.ts';

export type RamStufe = 'ok' | 'warn' | 'hold';

export interface Ram {
  level: RamStufe;
  percent_used: number | null;
  free_gb: number | null;
  fehler?: string;
}

export interface Ressourcen {
  ram: Ram;
  platte: { frei_gb: number | null; min_gb: number; genug: boolean };
  docker: boolean;
}

export const SKRIPTE = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../mission/scripts');

/**
 * warnPercent: --ram-warn of the driver, handed to ram.ps1; null leaves the adapter's or its default.
 * The driver measures the machine only: EPIC_LOCK_HOLDER stays empty, so the pause of an epic (#61,
 * read by ram.ps1 from that holder file) never sets the driver's own brake, even when the driver was
 * started from a run's environment.
 */
export async function messeRam(aufrufer: AsyncAufrufer, repo: string, skript = `${SKRIPTE}/ram.ps1`, warnPercent: number | null = null): Promise<Ram> {
  const r = await pwshJsonAsync(aufrufer, skript, ['-RepoRoot', repo, ...(warnPercent === null ? [] : ['-WarnPercent', String(warnPercent)])], { timeoutMs: 60_000, env: { EPIC_LOCK_HOLDER: '' } });
  const j = r.json as { level?: string; percent_used?: number; free_gb?: number } | null;
  if (r.code || !j || !['ok', 'warn', 'hold'].includes(String(j.level))) {
    return { level: 'hold', percent_used: null, free_gb: null, fehler: `ram.ps1 Exit ${r.code}: ${r.stderr.trim().slice(0, 200)}` };
  }
  return { level: j.level as RamStufe, percent_used: j.percent_used ?? null, free_gb: j.free_gb ?? null };
}

export function freiGb(pfad: string): number | null {
  try {
    const s = statfsSync(pfad);
    return Math.round((Number(s.bavail) * Number(s.bsize)) / 1e8) / 10;
  } catch {
    return null;
  }
}

export async function dockerErreichbar(aufrufer: AsyncAufrufer): Promise<boolean> {
  if ((await aufrufer('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 20_000 })).code === 0) return true;
  // docker of a running WSL distribution, the way worktree.ps1 and sweep.ps1 reach it; WSL is never started
  const laufend = await aufrufer('wsl.exe', ['--list', '--running', '--quiet'], { timeoutMs: 20_000 });
  if (laufend.code !== 0 || !laufend.stdout.replace(/\0/g, '').trim()) return false;
  return (await aufrufer('wsl.exe', ['docker', 'version', '--format', '{{.Server.Version}}'], { timeoutMs: 20_000 })).code === 0;
}

export async function messe(aufrufer: AsyncAufrufer, repo: string, plattMinGb: number, frei: (p: string) => number | null = freiGb): Promise<Ressourcen> {
  const f = frei(repo);
  return {
    ram: await messeRam(aufrufer, repo),
    // an unknown free space is not enough: no start without a reading
    platte: { frei_gb: f, min_gb: plattMinGb, genug: f !== null && f >= plattMinGb },
    docker: await dockerErreichbar(aufrufer),
  };
}

export interface Bremse {
  /** true: nothing new starts */
  halt: boolean;
  stufe: RamStufe;
  /** held because the reading failed, not because of the memory */
  fehler?: boolean;
}

/**
 * The RAM brake with hysteresis: warn or hold stop new starts; they resume only at level ok
 * with percent_used at least `abstand` points below the warn threshold, so a machine hovering
 * at the threshold does not start and stop in turns. A failed reading is hold.
 */
export function naechsteBremse(vorher: Bremse, ram: Ram, warnPercent = 75, abstand = 5): Bremse {
  if (ram.fehler) return { halt: true, stufe: 'hold', fehler: true };
  if (ram.level !== 'ok') return { halt: true, stufe: ram.level };
  // a hold that came only from a failed reading ends with the next good reading: the memory itself
  // never was above the threshold (acceptance finding 8)
  if (!vorher.halt || vorher.fehler) return { halt: false, stufe: 'ok' };
  const weitWeg = ram.percent_used !== null && ram.percent_used <= warnPercent - abstand;
  return weitWeg ? { halt: false, stufe: 'ok' } : { halt: true, stufe: 'ok' };
}

export function ressourcen(argv: string[], aufrufer: AsyncAufrufer = aufrufenAsync): Promise<unknown> {
  const repo = argv.find((a) => !a.startsWith('--'));
  if (!repo) throw new Error('Aufruf: flotte ressourcen <repo> [--platte-min-gb 20]');
  const i = argv.indexOf('--platte-min-gb');
  return messe(aufrufer, repo, i >= 0 ? Number(argv[i + 1]) : 20);
}
