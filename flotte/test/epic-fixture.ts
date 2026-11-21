// A fixture for the real Mechanik of `flotte epic` (#66): a git repository in a temp folder with its
// own bare remote as origin and its own adapter, and a forge that records gh instead of calling it.
// git and the scripts of epic/scripts run for real against it; nothing reaches GitHub.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { aufrufen, aufrufenAsync, type AsyncAufrufer } from '../src/aufruf.ts';
import { attrappe, type EpicDrehbuch, type Welt } from '../src/epic/attrappe.ts';
import { echteMechanik } from '../src/epic/mechanik.ts';
import type { Aufruf, Mechanik } from '../src/epic/motor.ts';

export const ADAPTER = `---
forge: github
push_remote: origin
main_branch: main
base_branch: main
worktree_root: ../wt
isolation: none-needed   # the fixture shares nothing
code_graph: off
test_commands:
  fix: bun test
lint_commands:
  fix: bun lint.ts
---

# Adapter der Fixture
`;

// findings as path:line:col: for every TODO in src/
const LINT = `import { readFileSync } from 'node:fs';
const dateien = Bun.spawnSync(['git', 'ls-files', '-co', '--exclude-standard', 'src']).stdout.toString().split(/\\r?\\n/).filter(Boolean);
let n = 0;
for (const d of dateien) readFileSync(d, 'utf8').split(/\\r?\\n/).forEach((z, i) => { if (z.includes('TODO')) { console.log(\`\${d}:\${i + 1}:1: TODO gefunden\`); n++; } });
process.exit(n ? 1 : 0);
`;

export interface Fixture {
  wurzel: string;
  repo: string;
  remote: string;
  /** worktree_root of the adapter */
  wt: string;
  git(args: string[], cwd?: string): string;
  weg(): void;
}

export function fixture(dateien: Record<string, string> = {}): Fixture {
  const wurzel = mkdtempSync(join(tmpdir(), 'flotte-mech-'));
  const repo = join(wurzel, 'repo');
  const remote = join(wurzel, 'remote.git');
  const git = (args: string[], cwd = repo) => {
    const r = aufrufen('git', ['-C', cwd, ...args]);
    if (r.code) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  mkdirSync(repo);
  aufrufen('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'core.autocrlf', 'false']);
  const alle: Record<string, string> = {
    '.claude/epic.md': ADAPTER,
    'lint.ts': LINT,
    'test/basis.test.ts': "import { expect, test } from 'bun:test';\ntest('basis', () => expect(1).toBe(1));\n",
    'src/liste.txt': 'a\n',
    ...dateien,
  };
  for (const [d, text] of Object.entries(alle)) {
    mkdirSync(dirname(join(repo, d)), { recursive: true });
    writeFileSync(join(repo, d), text);
  }
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);
  git(['remote', 'add', 'origin', remote]);
  git(['push', '-q', '-u', 'origin', 'main']);
  return {
    wurzel,
    repo,
    remote,
    wt: join(wurzel, 'wt'),
    git,
    weg() {
      // the fixture links no folders (no link_dirs), so no junction lies in it; checked before the recursive delete
      const wt = join(wurzel, 'wt');
      if (existsSync(wt)) for (const n of readdirSync(wt, { withFileTypes: true })) if (n.isSymbolicLink()) throw new Error(`Verweis in der Fixture: ${n.name}`);
      rmSync(wurzel, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

export interface Forge {
  aufrufer: AsyncAufrufer;
  labels: Record<number, string[]>;
  repoLabels: string[];
  kommentare: Record<number, string[]>;
  prs: { titel: string; base: string; head: string; body: string; url: string }[];
  titel: Record<number, string>;
  /** tickets whose label edits do not stick: the read-back keeps the old state */
  stur: Set<number>;
  /** every gh call */
  aufrufe: string[][];
}

const nach = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** gh answered from memory; every other program runs for real */
export function forge(titel: Record<number, string> = {}): Forge {
  const f: Forge = { labels: {}, repoLabels: [], kommentare: {}, prs: [], titel, stur: new Set(), aufrufe: [], aufrufer: aufrufenAsync };
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  f.aufrufer = async (programm, args, opts = {}) => {
    if (programm !== 'gh') return aufrufenAsync(programm, args, opts);
    f.aufrufe.push(args);
    const [a, b, c] = args;
    const nr = Number(c);
    if (a === 'label' && b === 'list') return ok(JSON.stringify(f.repoLabels.map((name) => ({ name }))));
    if (a === 'label' && b === 'create') {
      f.repoLabels.push(c);
      return ok();
    }
    if (a === 'issue' && b === 'view') {
      const json = nach(args, '--json');
      if (json === 'labels') return ok(JSON.stringify({ labels: (f.labels[nr] ?? []).map((name) => ({ name })) }));
      if (json === 'comments') return ok(JSON.stringify({ comments: (f.kommentare[nr] ?? []).map((body) => ({ body })) }));
      if (json === 'title') return ok(JSON.stringify({ title: f.titel[nr] ?? `Ticket ${nr}` }));
      if (json === 'body') return ok(JSON.stringify({ body: '' }));
    }
    if (a === 'issue' && b === 'edit') {
      const dazu = nach(args, '--add-label')?.split(',') ?? [];
      const weg = nach(args, '--remove-label')?.split(',') ?? [];
      if (dazu.some((l) => !f.repoLabels.includes(l))) return { code: 1, stdout: '', stderr: `label not found` };
      if (f.stur.has(nr)) return ok();
      f.labels[nr] = [...new Set([...(f.labels[nr] ?? []).filter((l) => !weg.includes(l)), ...dazu])];
      return ok();
    }
    if (a === 'issue' && b === 'comment') {
      (f.kommentare[nr] ??= []).push(opts.eingabe ?? '');
      return ok();
    }
    if (a === 'pr' && b === 'list') return ok(JSON.stringify(f.prs.filter((p) => p.head === nach(args, '--head')).map((p) => ({ url: p.url }))));
    if (a === 'pr' && b === 'create') {
      const url = `https://example.invalid/o/r/pull/${100 + f.prs.length}`;
      f.prs.push({ titel: nach(args, '--title')!, base: nach(args, '--base')!, head: nach(args, '--head')!, body: opts.eingabe ?? '', url });
      return ok(`${url}\n`);
    }
    return { code: 1, stdout: '', stderr: `gh-Attrappe kennt ${args.join(' ')} nicht` };
  };
  return f;
}

/**
 * The scripts of #65 against the real Mechanik: calls, driver and takts stay the stand-ins; RAM and
 * slot play the script; `arbeit` does what an implementer leaves in its worktree (at the start of
 * its first call), `loesung` what a conflict call does in the epic worktree. A takt waits a little,
 * because git and the scripts take real time.
 */
export function echtesDrehbuch(buch: EpicDrehbuch, f: Fixture, g: Forge, o: { welt?: Welt; arbeit?: Record<string, (cwd: string) => void>; loesung?: Record<string, (cwd: string) => void>; mechanik?: (m: Mechanik) => Mechanik; tod?: () => boolean } = {}) {
  const u = attrappe({ maxTakte: 20_000, ...buch }, o.welt);
  const m = echteMechanik({ repo: f.repo, epic: 69, epicBranch: 'epic/69-programm', basis: 'origin/main', forge: 'o/r', halter: join(f.wurzel, 'halter.json'), aufrufer: g.aufrufer, ram: u.mechanik.ram, slot: u.mechanik.slot });
  const rufe = u.aufrufe.rufe.bind(u.aufrufe);
  const warte = u.warte;
  const getan = new Set<string>();
  return {
    ...u,
    mechanik: o.mechanik ? o.mechanik(m) : m,
    aufrufe: {
      ...u.aufrufe,
      async rufe(a: Aufruf, bei: (s: string) => void) {
        const schluessel = `${a.rolle}:${a.paket}`;
        if (!getan.has(schluessel)) {
          getan.add(schluessel);
          if (a.rolle === 'implementer') o.arbeit?.[a.paket!]?.(a.cwd);
          if (a.rolle === 'konflikt') o.loesung?.[a.paket!]?.(a.cwd);
        }
        return rufe(a, bei);
      },
    },
    async warte() {
      // the program dies outside every job (P17): the loop throws, the job that hangs is never finished
      if (o.tod?.()) throw new Error('Programm beendet (Drehbuch)');
      await warte();
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}
