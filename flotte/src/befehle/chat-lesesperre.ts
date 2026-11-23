// The read lock of flotte chat (#84, agent-skills/ADR-0004): a PreToolUse hook for Read, Grep and
// Glob that refuses every access outside the repository, the working directory of the chat turn.
// A permission rule cannot do this: read tools need no approval in Claude Code, so
// `--allowedTools Read(./**)` narrows nothing, and the real probe of 23.11.2026 read a file outside
// the repository with permission_denials []. A hook runs before the tool and can refuse it.
//
// Contract, as far as this repository shows it (epic/scripts/guard.ps1, checked there against
// https://code.claude.com/docs/en/hooks): the hook input is JSON on stdin with tool_name, tool_input
// and cwd; exit 2 blocks the tool call and stderr goes to the model; exit 0 without output lets it
// run. Unclear input is refused (exit 2), as guard.ps1 fails closed. Only the real probe shows that
// Claude Code calls the hook under --permission-mode dontAsk for reads it would allow anyway, the
// exact tool_input of Grep and Glob, and that the model goes on with the refusal as a tool error.
//
// Called as `"<bun>" "<this file>"` (chat.ts, lesesperreArgs); the check is the exported function.

import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LESESPERRE = fileURLToPath(import.meta.url);

/** an absolute path or a step up in a Glob pattern, also inside a brace alternative ({a,../b}) */
const MUSTER_AUS = /(^|[{,])\s*([\\/~]|[A-Za-z]:)|(^|[\\/{,])\.\.([\\/},]|$)/;

/** the path with every link and junction resolved, as far as it exists; the rest is appended as written */
function echt(p: string): string {
  const rest: string[] = [];
  for (let kopf = p; ; ) {
    try {
      return join(realpathSync.native(kopf), ...rest.reverse());
    } catch {
      const oben = dirname(kopf);
      if (oben === kopf) return p;
      rest.push(basename(kopf));
      kopf = oben;
    }
  }
}

/** within: the same folder or below it; path.relative compares without letter case on Windows */
function innerhalb(wurzel: string, ziel: string): boolean {
  const r = relative(wurzel, ziel);
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`));
}

/**
 * The reason to refuse the tool call of the hook input, or null when it stays in the repository.
 * Read checks file_path, Grep and Glob check path (none: the working directory); Glob also refuses
 * a pattern that leads out. Grep's glob filter only narrows the files below path, so it is not checked.
 */
export function lesesperre(eingabe: unknown, heim = homedir()): string | null {
  const e = eingabe as any;
  if (!e || typeof e !== 'object' || typeof e.cwd !== 'string' || !isAbsolute(e.cwd) || !e.tool_input || typeof e.tool_input !== 'object')
    return 'Lesesperre: Hook-Eingabe ohne cwd oder tool_input, Zugriff nicht geprüft und deshalb gesperrt.';
  const werkzeug = e.tool_name;
  if (!['Read', 'Grep', 'Glob'].includes(werkzeug)) return `Lesesperre: Werkzeug ${String(werkzeug)} ist im Chat nicht vorgesehen.`;
  const pfad = werkzeug === 'Read' ? e.tool_input.file_path : (e.tool_input.path ?? '');
  if (typeof pfad !== 'string' || (werkzeug === 'Read' && !pfad)) return `Lesesperre: ${werkzeug} ohne lesbaren Pfad, gesperrt.`;
  if (werkzeug === 'Glob' && (typeof e.tool_input.pattern !== 'string' || MUSTER_AUS.test(e.tool_input.pattern)))
    return `Lesesperre: Das Muster ${JSON.stringify(e.tool_input.pattern)} führt aus dem Repository; nur relative Muster ohne .. sind erlaubt.`;
  const ausgeschrieben = /^~([\\/]|$)/.test(pfad) ? join(heim, pfad.slice(1)) : pfad;
  if (!innerhalb(echt(resolve(e.cwd)), echt(resolve(e.cwd, ausgeschrieben))))
    return `Lesesperre: ${pfad} liegt außerhalb des Repositorys; der Chat liest nur im Repository (ADR-0004).`;
  return null;
}

if (import.meta.main) {
  let grund: string | null;
  try {
    grund = lesesperre(JSON.parse(readFileSync(0, 'utf8')));
  } catch (err) {
    grund = `Lesesperre: Hook-Eingabe nicht lesbar (${(err as Error).message}), Zugriff gesperrt.`;
  }
  if (grund) {
    process.stderr.write(`${grund}\n`);
    process.exit(2);
  }
  process.exit(0);
}
