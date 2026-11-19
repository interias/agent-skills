// flotte ressourcen <repo> [--platte-min-gb 20]
// RAM through epic/scripts/ram.ps1 (a failed measurement counts as hold), free disk space of the
// repository's drive, docker reachable. The RAM brake with hysteresis lives in naechsteBremse().

import { statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { aufrufen, pwshJson, type Aufrufer } from '../aufruf.ts';

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

export const SKRIPTE = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../epic/scripts');

export function messeRam(aufrufer: Aufrufer, repo: string, skript = `${SKRIPTE}/ram.ps1`): Ram {
  const r = pwshJson(aufrufer, skript, ['-RepoRoot', repo], { timeoutMs: 60_000 });
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

export function dockerErreichbar(aufrufer: Aufrufer): boolean {
  if (aufrufer('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 20_000 }).code === 0) return true;
  // docker of a running WSL distribution, the way worktree.ps1 and sweep.ps1 reach it; WSL is never started
  const laufend = aufrufer('wsl.exe', ['--list', '--running', '--quiet'], { timeoutMs: 20_000 });
  if (laufend.code !== 0 || !laufend.stdout.replace(/\0/g, '').trim()) return false;
  return aufrufer('wsl.exe', ['docker', 'version', '--format', '{{.Server.Version}}'], { timeoutMs: 20_000 }).code === 0;
}

export function messe(aufrufer: Aufrufer, repo: string, plattMinGb: number, frei: (p: string) => number | null = freiGb): Ressourcen {
  const f = frei(repo);
  return {
    ram: messeRam(aufrufer, repo),
    // an unknown free space is not enough: no start without a reading
    platte: { frei_gb: f, min_gb: plattMinGb, genug: f !== null && f >= plattMinGb },
    docker: dockerErreichbar(aufrufer),
  };
}

export interface Bremse {
  /** true: nothing new starts */
  halt: boolean;
  stufe: RamStufe;
}

/**
 * The RAM brake with hysteresis: warn or hold stop new starts; they resume only at level ok
 * with percent_used at least `abstand` points below the warn threshold, so a machine hovering
 * at the threshold does not start and stop in turns. A failed reading is hold.
 */
export function naechsteBremse(vorher: Bremse, ram: Ram, warnPercent = 75, abstand = 5): Bremse {
  if (ram.level !== 'ok') return { halt: true, stufe: ram.level };
  if (!vorher.halt) return { halt: false, stufe: 'ok' };
  const weitWeg = ram.percent_used !== null && ram.percent_used <= warnPercent - abstand;
  return weitWeg ? { halt: false, stufe: 'ok' } : { halt: true, stufe: 'ok' };
}

export function ressourcen(argv: string[], aufrufer: Aufrufer = aufrufen): unknown {
  const repo = argv.find((a) => !a.startsWith('--'));
  if (!repo) throw new Error('Aufruf: flotte ressourcen <repo> [--platte-min-gb 20]');
  const i = argv.indexOf('--platte-min-gb');
  return messe(aufrufer, repo, i >= 0 ? Number(argv[i + 1]) : 20);
}
