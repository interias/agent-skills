// The real language-model calls of `flotte epic` (#69, stage 3, decision 2): each one `claude -p`
// with stream-json, --json-schema, auto mode without permission prompts and the account's
// CLAUDE_CONFIG_DIR, started and read by the driver's module lauf (not rebuilt). Every call carries
// epic/scripts/guard.ps1 as its PreToolUse hook, as the driver gives it to every run (rules 1, 2
// and 11 of the skill are enforced by it). The roles with an agent file run as `--agent <name>`
// (instruction, model and effort from agents/, stage 0); cut and conflict get model and effort.
// The session is reported from the first line that names it; a continuation is only ever --resume.
// Every call writes its stream-json log under logDir. The processes run detached: whoever stops
// the program ends the running ones first (beendeLaufende), so a restart never resumes a session
// whose first process still works.

import { join } from 'node:path';
import { guardArgs } from '../treiber/treiber.ts';
import { beende, starte, type Start } from '../werkzeuge/lauf.ts';
import { SKRIPTE } from '../werkzeuge/ressourcen.ts';
import { lies } from '../werkzeuge/verbrauch.ts';
import type { Aufrufe } from './motor.ts';

export interface AufrufEinstellung {
  /** CLAUDE_CONFIG_DIR of the account the epic runs on */
  konto: string;
  /** stream-json logs of the calls, one file per role, package and round (a --resume appends) */
  logDir: string;
  /** a call silent this long (with no living child process) is killed, default 20 minutes */
  leerlaufMs?: number;
  /** after an account limit, the account is asked again at the earliest after this long, default 10 minutes */
  kontoPauseMs?: number;
  /** epic/scripts with guard.ps1; default the scripts of this repository */
  skripte?: string;
  /** tests: the stand-in instead of claude */
  programm?: Pick<Start, 'programm' | 'programmArgs'>;
  jetzt?: () => number;
  /** ends a process tree; default lauf.ts beende (taskkill /T on Windows) */
  beende?: (pid: number) => void;
}

export interface EchteAufrufe extends Aufrufe {
  /** ends every call process still running; their sessions are continued with --resume by the next start */
  beendeLaufende(): number[];
}

function sitzungAus(zeile: string): string | null {
  try {
    const d = JSON.parse(zeile);
    return d?.session_id ? String(d.session_id) : null;
  } catch {
    return null;
  }
}

export function echteAufrufe(e: AufrufEinstellung): EchteAufrufe {
  const jetzt = e.jetzt ?? Date.now;
  const laufend = new Set<number>();
  let gesperrtSeit: number | null = null;
  return {
    async rufe(a, beiSitzung) {
      let gemeldet = false;
      let pid: number | null = null;
      const melde = (s: string | null) => {
        if (!s || gemeldet) return;
        gemeldet = true;
        beiSitzung(s);
      };
      try {
        const r = await starte({
          repo: a.cwd,
          konto: a.konto,
          auftrag: a.auftrag,
          resume: a.resume,
          // the agent file brings model and effort (stage 0); cut and conflict name them
          modell: a.agent ? null : a.modell,
          extraArgs: [...(a.agent ? ['--agent', a.agent] : ['--effort', a.effort]), '--json-schema', JSON.stringify(a.schema), ...guardArgs(join(e.skripte ?? SKRIPTE, 'guard.ps1'))],
          leerlaufMs: e.leerlaufMs ?? 20 * 60_000,
          log: join(e.logDir, `${a.rolle}${a.paket ? `-${a.paket}` : ''}-r${a.runde}.jsonl`),
          beiZeile: (z) => melde(sitzungAus(z)),
          beimStart: (p) => {
            pid = p;
            laufend.add(p);
          },
          ...e.programm,
        });
        melde(r.sitzung);
        return r;
      } finally {
        if (pid !== null) laufend.delete(pid);
      }
    },
    /** free again when the windows the last limit filled have been reset, never before the pause */
    async kontoFrei() {
      const t = jetzt();
      gesperrtSeit ??= t;
      if (t - gesperrtSeit < (e.kontoPauseMs ?? 10 * 60_000)) return false;
      const v = lies(e.konto);
      const frei = !v || [v.fuenf, v.sieben].every((f) => !f || f.anteil < 1 || f.reset <= t);
      if (frei) gesperrtSeit = null;
      return frei;
    },
    beendeLaufende() {
      const pids = [...laufend];
      for (const p of pids) (e.beende ?? beende)(p);
      return pids;
    },
  };
}
