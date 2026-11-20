// flotte adapter [<ordner> ...]: before the new merge.ps1 is played in (#14, round 5, C3). Lists the
// project adapters (.claude/epic.md) of the repositories in the given folders, default ~/git, and
// names those without the key merge: after playing in, the Leitstand no longer merges there by
// itself (references/umschalten.md). Reads the adapter of the default branch on origin when there
// is one, else the file in the checkout. Changes nothing.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';

export interface AdapterStand {
  repo: string;
  quelle: string;
  merge: string | null;
}

/** The value of a flat frontmatter key, null when the key is missing (not its default). */
export function schluessel(text: string, name: string): string | null {
  const zeilen = text.split(/\r?\n/);
  if (zeilen[0]?.trim() !== '---') return null;
  for (let i = 1; i < zeilen.length && zeilen[i].trim() !== '---'; i++) {
    const m = new RegExp(`^${name}:\\s*(.*)$`).exec(zeilen[i]);
    if (m) return m[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '') || null;
  }
  return null;
}

export function adapterStand(repo: string, a: Aufrufer = aufrufen): AdapterStand | null {
  const kopf = a('git', ['-C', repo, 'show', 'origin/HEAD:.claude/epic.md']);
  if (!kopf.code) return { repo, quelle: 'origin/HEAD', merge: schluessel(kopf.stdout, 'merge') };
  const datei = join(repo, '.claude', 'epic.md');
  if (!existsSync(datei)) return null;
  return { repo, quelle: 'Arbeitskopie', merge: schluessel(readFileSync(datei, 'utf8'), 'merge') };
}

export function adapter(argv: string[], a: Aufrufer = aufrufen): unknown {
  const ordner = (argv.length ? argv : [join(homedir(), 'git')]).map((o) => resolve(o));
  const staende: AdapterStand[] = [];
  for (const o of ordner) {
    if (!existsSync(o)) throw new Error(`Ordner fehlt: ${o}`);
    // main checkouts only (.git is a folder); a worktree carries the same adapter
    for (const n of readdirSync(o)) {
      const repo = join(o, n);
      try {
        if (!statSync(join(repo, '.git')).isDirectory()) continue;
      } catch {
        continue;
      }
      const s = adapterStand(repo, a);
      if (s) staende.push(s);
    }
  }
  const ohne = staende.filter((s) => !s.merge);
  return {
    adapter: staende,
    ohneMerge: ohne.map((s) => s.repo),
    folge: ohne.length
      ? `Nach dem Einspielen mergt der Leitstand in ${ohne.length} Projekt(en) nicht mehr selbst (fehlender Schlüssel gilt als merge: mensch): ${ohne.map((s) => s.repo).join(', ')}`
      : 'Jeder gefundene Adapter nennt merge.',
  };
}
