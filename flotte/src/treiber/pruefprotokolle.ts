// The gate of a mission from its logs (Tag H): a gate writes one log per context under `.gate/logs/` of
// the worktree it runs in (hexanite: `wurzel.log`, `buero.log`, …). A log written within GATE_STILL_MS
// is a context at work, an older one a finished context. The worktrees of a mission are the mission
// worktree (`epic/<nr>-…`) and its package worktrees (`agent/<child>-…`, in spec mode `agent/<nr>-p<k>-…`).
// Read by the cards of the bridge (Gate-Fortschritt) and by the idle limit (a growing log is work).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const GATE_LOGS = join('.gate', 'logs');
/** a log not written for this long belongs to a finished context */
export const GATE_STILL_MS = 3 * 60_000;

export interface GateStand {
  kontexte: { name: string; stand: 'fertig' | 'laeuft'; zeit: number }[];
  /** how many contexts the gate runs; unknown from the logs alone */
  von: number | null;
  /** the logs folder was laid out (the gate's start), ISO */
  seit: string | null;
  /** the newest write of any log, epoch ms */
  zuletzt: number;
}

/** The worktrees of mission `nr` from `git worktree list --porcelain`. */
export function missionsWorktrees(porcelain: string, nr: number, kinder: number[]): string[] {
  const muster = new RegExp(`^refs/heads/(?:epic/${nr}(?:-|$)|agent/(?:${[nr, ...kinder].join('|')})-)`);
  const out: string[] = [];
  let pfad: string | null = null;
  for (const z of porcelain.split(/\r?\n/)) {
    if (z.startsWith('worktree ')) pfad = z.slice(9).trim();
    else if (z.startsWith('branch ') && pfad && muster.test(z.slice(7).trim())) out.push(pfad);
  }
  return out;
}

/**
 * The gate of the worktree whose logs were written last. `ab` (epoch ms, the start of a known gate run)
 * drops the logs of an earlier run; without it only a gate with a context at work counts.
 */
export function gateStand(worktrees: string[], jetzt: number, ab: number | null = null): GateStand | null {
  let best: GateStand | null = null;
  for (const wt of worktrees) {
    const dir = join(wt, GATE_LOGS);
    if (!existsSync(dir)) continue;
    let namen: string[];
    try {
      namen = readdirSync(dir).filter((n) => n.endsWith('.log'));
    } catch {
      continue;
    }
    const kontexte: GateStand['kontexte'] = [];
    for (const n of namen) {
      try {
        const zeit = statSync(join(dir, n)).mtimeMs;
        if (ab !== null && zeit < ab - 60_000) continue;
        kontexte.push({ name: n.slice(0, -4), stand: jetzt - zeit < GATE_STILL_MS ? 'laeuft' : 'fertig', zeit });
      } catch {
        // a log removed in between: the next look finds the new state
      }
    }
    if (!kontexte.length || (ab === null && !kontexte.some((k) => k.stand === 'laeuft'))) continue;
    const zuletzt = Math.max(...kontexte.map((k) => k.zeit));
    if (best && best.zuletzt >= zuletzt) continue;
    let seit: string | null = null;
    try {
      const s = statSync(dir);
      seit = new Date(s.birthtimeMs || s.ctimeMs).toISOString();
    } catch {
      seit = null;
    }
    kontexte.sort((a, b) => a.zeit - b.zeit || a.name.localeCompare(b.name));
    best = { kontexte, von: null, seit, zuletzt };
  }
  return best;
}
