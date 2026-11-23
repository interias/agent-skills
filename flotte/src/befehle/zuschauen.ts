// flotte zuschauen <repo> <epic> [--einmal]: follows the log of an epic's run (#14, round 5, C4).
// Prints each step (tool call, text, end of turn) as a line on stderr, from the start of the current
// turn; switches to the next turn's log when the driver starts one. Ends with Ctrl+C, when the epic
// is done, or with --einmal after what is there. stdout gets one JSON object, as every command.

import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { flotteDir, lies } from '../werkzeuge/zustand.ts';
import { schrittAus } from '../werkzeuge/lauf.ts';

const ENDE = new Set(['fertig', 'blockiert', 'abgebrochen']);

export async function zuschauen(argv: string[], schreib: (z: string) => void = (z) => process.stderr.write(`${z}\n`), taktMs = 1000): Promise<unknown> {
  const [repo, epicArg] = argv;
  const nr = Number(String(epicArg ?? '').replace('#', ''));
  if (!repo || !nr) throw new Error('Aufruf: flotte zuschauen <repo> <epic> [--einmal]');
  const einmal = argv.includes('--einmal');
  const dir = flotteDir(repo);
  let log: string | null = null;
  let pos = 0;
  let rest = '';
  let zeilen = 0;
  const logs: string[] = [];
  for (;;) {
    const ep = lies(dir, repo).epics[String(nr)] as { log?: string | null; stufe?: string } | undefined;
    if (!ep) throw new Error(`Mission #${nr} steht nicht im Zustand des Treibers (${dir})`);
    if (ep.log && ep.log !== log) {
      log = ep.log;
      pos = 0;
      rest = '';
      logs.push(log);
      schreib(`== #${nr}: ${log}`);
    }
    if (log && existsSync(log)) {
      const groesse = statSync(log).size;
      if (groesse > pos) {
        const fd = openSync(log, 'r');
        const puffer = Buffer.alloc(groesse - pos);
        readSync(fd, puffer, 0, puffer.length, pos);
        closeSync(fd);
        pos = groesse;
        const teile = (rest + puffer.toString('utf8')).split(/\r?\n/);
        rest = teile.pop() ?? '';
        for (const t of teile) {
          let d: unknown;
          try {
            d = JSON.parse(t);
          } catch {
            continue;
          }
          const s = schrittAus(d);
          if (!s) continue;
          zeilen++;
          schreib(`${new Date().toISOString().slice(11, 19)}  ${s}`);
        }
      }
    }
    if (einmal || ENDE.has(ep.stufe ?? '')) return { epic: nr, stufe: ep.stufe ?? null, logs, schritte: zeilen };
    await new Promise((r) => setTimeout(r, taktMs));
  }
}
