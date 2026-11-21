// The real Mechanik of `flotte epic` (#66, stage 2 of #69): worktrees, RAM and graph through the
// scripts of epic/scripts (called, not rebuilt, decision 1), 4c through the adapter's test_commands
// and lint_commands (decision 6, counted in zaehlen.ts), merge, revert and push through git in the
// epic worktree, labels, comments and the pull request through gh. Every program goes through one
// AsyncAufrufer, so tests run git and the scripts for real against a fixture and record gh.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { aufrufenAsync, pwshJsonAsync, type AsyncAufrufer, type Ergebnis } from '../aufruf.ts';
import { schluessel } from '../befehle/adapter.ts';
import { frontmatter, liesAdapter } from '../werkzeuge/belegung.ts';
import { messeRam, SKRIPTE, type Ram } from '../werkzeuge/ressourcen.ts';
import { flotteDir } from '../werkzeuge/zustand.ts';
import type { Aufgeraeumt, Mechanik, StatusLabel } from './motor.ts';
import { zaehle, zaehleLint, verzeichnisAus } from './zaehlen.ts';
import { epicDir, type Testlauf } from './zustand.ts';

/** names, colours and descriptions as in epic/references/forge.md, "Statuslabels" */
export const LABELS: Record<StatusLabel, { farbe: string; text: string }> = {
  'status/in-arbeit': { farbe: '00f0ff', text: 'Zustand für KIBO: ein Lauf hat das Ticket angefasst und ist noch nicht fertig. Steuert nichts.' },
  'status/blockiert': { farbe: 'ff3b5c', text: 'Zustand für KIBO: das Ticket wartet auf ein anderes Ticket. Steuert nichts.' },
  'status/haengt': { farbe: 'fcee0a', text: 'Zustand für KIBO: ein Lauf hat das Ticket aufgegeben, ohne einen Menschen geht es nicht weiter. Steuert nichts.' },
};
const EPIC_LABEL = { farbe: 'ff2bd6', text: 'Epic: wartet auf seine Kinder (gesetzt von /epic, gelesen von KIBO)' };

export interface MechanikEinstellung {
  /** main checkout */
  repo: string;
  epic: number;
  epicBranch: string;
  /** <push_remote>/<basis> */
  basis: string;
  /** owner/repo for gh */
  forge: string;
  /** the lock owner of Up: the program, which lives as long as its packages */
  pid?: number;
  aufrufer?: AsyncAufrufer;
  /** epic/scripts */
  skripte?: string;
  /** tests measure RAM and slot themselves; default ram.ps1 and docker compose ls */
  ram?: () => Promise<Ram>;
  slot?: () => Promise<{ belegt: boolean }>;
  /** holder file of the locks (EPIC_LOCK_HOLDER); default the driver's, else <epic dir>/lock-holder, created at Up and removed at the end */
  halter?: string;
  /** one suite or lint command, default 60 minutes */
  zeitgrenzeMs?: number;
}

/** a nested map of the adapter's frontmatter (test_commands, lint_commands); null when the key is missing */
export function karte(text: string, name: string): Record<string, string> | null {
  const zeilen = text.split(/\r?\n/);
  if (zeilen[0]?.trim() !== '---') return null;
  let drin = false;
  let out: Record<string, string> | null = null;
  for (let i = 1; i < zeilen.length && zeilen[i].trim() !== '---'; i++) {
    const z = zeilen[i];
    if (!z.trim() || /^\s*#/.test(z)) continue;
    if (/^\S/.test(z)) {
      drin = new RegExp(`^${name}:\\s*(#.*)?$`).test(z);
      if (drin) out = {};
      continue;
    }
    const m = drin ? /^\s+([A-Za-z0-9_.-]+):\s*(.+?)\s*$/.exec(z) : null;
    if (m) out![m[1]] = m[2].replace(/\s+#\s.*$/, '').replace(/^(['"])(.*)\1$/, '$2');
  }
  return out && Object.keys(out).length ? out : null;
}

/**
 * a full stack of the project runs: a running compose project in a worktree under worktree_root, or
 * named <repo>-<package> (Up's project name) for a package that holds a lock; a shared service such
 * as app-services has no lock and does not count
 */
export function stackLaeuft(composeLs: string, repo: string, worktreeRoot: string, gesperrt: string[]): boolean {
  let liste: { Name?: string; Status?: string; ConfigFiles?: string }[] = [];
  try {
    const j = JSON.parse(composeLs || '[]');
    liste = Array.isArray(j) ? j : [j];
  } catch {
    return false;
  }
  const praefix = `${basename(repo).toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-`;
  const wurzel = `${pfadNormal(worktreeRoot)}/`;
  const namen = new Set(gesperrt.map((n) => `${praefix}${n.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`));
  return liste.some((p) => /running/i.test(p.Status ?? '') && (namen.has(p.Name ?? '') || (p.ConfigFiles ?? '').split(',').some((f) => pfadNormal(f).startsWith(wurzel))));
}

function pfadNormal(p: string): string {
  return p
    .trim()
    .replace(/^\/mnt\/([a-z])\//i, '$1:/')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

const flach = (s: string) => s.replace(/\s+/g, ' ').trim();

export function echteMechanik(e: MechanikEinstellung): Mechanik {
  const a = e.aufrufer ?? aufrufenAsync;
  const repo = resolve(e.repo);
  const skript = (n: string) => join(e.skripte ?? SKRIPTE, n);
  const pid = e.pid ?? process.pid;
  const zeit = e.zeitgrenzeMs ?? 60 * 60_000;
  const [remote, ...rest] = e.basis.split('/');
  const basisBranch = rest.join('/');
  const adapterText = (() => {
    try {
      return readFileSync(join(repo, '.claude', 'epic.md'), 'utf8');
    } catch {
      return '';
    }
  })();
  const adapter = liesAdapter(adapterText);
  const tests = karte(adapterText, 'test_commands');
  const lints = karte(adapterText, 'lint_commands');
  const vorCommit = frontmatter(adapterText).get('pre_commit_checks') ?? [];
  const common = dirname(flotteDir(repo));
  const lockVon = (name: string) => join(common, 'epic-locks', `${name}.json`);
  // a holder file keeps the locks of this epic alive between two program runs (worktree.ps1,
  // CleanupStale); the driver names its own, else it lives next to the state and goes at the end
  const eigenerHalter = e.halter !== undefined || !process.env.EPIC_LOCK_HOLDER;
  const halter = e.halter ?? process.env.EPIC_LOCK_HOLDER ?? join(epicDir(repo, e.epic), 'lock-holder');
  const halterWeg = () => eigenerHalter && rmSync(halter, { force: true });
  const epicName = `epic-${e.epic}`;
  let epicPfad: string | null = null;
  let labelsDa = false;
  /** red file of the last full run → its suite, for the single run */
  const rotIn = new Map<string, string>();

  const git = (cwd: string, args: string[], eingabe?: string) => a('git', ['-C', cwd, ...args], { eingabe, timeoutMs: 300_000 });
  const fehler = (was: string, r: Ergebnis) => new Error(`${was}: Exit ${r.code}: ${flach(r.stderr || r.stdout).slice(0, 600)}`);
  async function gitOk(cwd: string, args: string[], eingabe?: string): Promise<string> {
    const r = await git(cwd, args, eingabe);
    if (r.code) throw fehler(`git ${args.join(' ')}`, r);
    return r.stdout.trim();
  }
  async function gh(args: string[], eingabe?: string): Promise<string> {
    const r = await a('gh', args, { eingabe, timeoutMs: 120_000 });
    if (r.code) throw fehler(`gh ${args.slice(0, 3).join(' ')}`, r);
    return r.stdout;
  }
  const shell = (befehl: string, cwd: string) => a(befehl, [], { cwd, shell: true, timeoutMs: zeit });

  async function epicWt(): Promise<string> {
    if (epicPfad && existsSync(epicPfad)) return epicPfad;
    const liste = await gitOk(repo, ['worktree', 'list', '--porcelain']);
    for (const block of liste.split(/\r?\n\r?\n/)) {
      const pfad = /^worktree (.+)$/m.exec(block)?.[1];
      if (pfad && new RegExp(`^branch refs/heads/${e.epicBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(block)) return (epicPfad = resolve(pfad));
    }
    throw new Error(`kein Epic-Worktree auf ${e.epicBranch} (git worktree list)`);
  }

  const worktreeRoot = () => {
    const w = schluessel(adapterText, 'worktree_root') ?? `../${basename(repo)}-worktrees`;
    return resolve(repo, w);
  };

  async function composeLs(): Promise<string | null> {
    const d = await a('docker', ['compose', 'ls', '--format', 'json'], { timeoutMs: 20_000 });
    if (!d.code) return d.stdout;
    // docker of a running WSL distribution, the way worktree.ps1 reaches it; WSL is never started
    const l = await a('wsl.exe', ['--list', '--running', '--quiet'], { timeoutMs: 20_000 });
    if (l.code || !l.stdout.replace(/\0/g, '').trim()) return null;
    const w = await a('wsl.exe', ['docker', 'compose', 'ls', '--format', 'json'], { timeoutMs: 20_000 });
    return w.code ? null : w.stdout;
  }

  async function labelsSicher() {
    if (labelsDa) return;
    const da = new Set((JSON.parse((await gh(['label', 'list', '--repo', e.forge, '--json', 'name', '--limit', '500'])) || '[]') as { name: string }[]).map((l) => l.name));
    const soll: [string, { farbe: string; text: string }][] = [...Object.entries(LABELS), [adapter.epic_label, EPIC_LABEL]];
    for (const [name, l] of soll) if (!da.has(name)) await gh(['label', 'create', name, '--repo', e.forge, '--color', l.farbe, '--description', l.text]);
    labelsDa = true;
  }

  const labelsVon = async (ticket: number) => ((JSON.parse(await gh(['issue', 'view', String(ticket), '--repo', e.forge, '--json', 'labels'])).labels ?? []) as { name: string }[]).map((l) => l.name);

  /** edit, then read back (epic/SKILL.md, "Die Statuslabels"); one more try, then a Glut point: the text, not a stop */
  async function labelsSetzen(ticket: number, dazu: string[], weg: string[]): Promise<string | null> {
    for (let versuch = 0; versuch < 2; versuch++) {
      await gh(['issue', 'edit', String(ticket), '--repo', e.forge, ...(dazu.length ? ['--add-label', dazu.join(',')] : []), ...(weg.length ? ['--remove-label', weg.join(',')] : [])]);
      const ist = await labelsVon(ticket);
      if (dazu.every((l) => ist.includes(l)) && weg.every((l) => !ist.includes(l))) return null;
    }
    return `Labels an #${ticket} stehen nach zwei Versuchen nicht wie gesetzt (+${dazu.join(',') || '–'} −${weg.join(',') || '–'})`;
  }

  async function suite(name: string, befehl: string, wt: string) {
    const r = await shell(befehl, wt);
    try {
      return zaehle(`${r.stdout}\n${r.stderr}`, befehl, wt);
    } catch (f) {
      throw new Error(`Suite ${name} (Exit ${r.code}): ${(f as Error).message}`);
    }
  }

  return {
    async aufraeumen(): Promise<Aufgeraeumt[]> {
      const r = await pwshJsonAsync(a, skript('worktree.ps1'), ['-Action', 'CleanupStale', '-RepoRoot', repo], { cwd: repo, timeoutMs: 300_000 });
      // exit 1 with a list: a step failed and is in the list as skipped; without a list the script stopped
      if (r.json === null && r.code) throw new Error(`worktree.ps1 CleanupStale: ${flach(r.stderr)}`);
      return (Array.isArray(r.json) ? r.json : r.json ? [r.json] : []) as Aufgeraeumt[];
    },
    async up(name, branch, von) {
      // a repeated Up after a stop before the state was written: the lock names the worktree
      const lock = lockVon(name);
      if (existsSync(lock)) {
        const l = JSON.parse(readFileSync(lock, 'utf8').replace(/^﻿/, '')) as { branch?: string; worktree?: string; port?: number | null };
        if (l.branch === branch && l.worktree && existsSync(l.worktree)) {
          if (name === epicName) epicPfad = l.worktree;
          return { worktree: l.worktree, port: l.port ?? null, isolation: null, kopf: (await git(l.worktree, ['rev-parse', 'HEAD'])).stdout.trim() || null };
        }
      }
      let ab = von;
      let ausRemote = false;
      if (name === epicName) {
        // epic/SKILL.md, Phase 3: an epic branch on the remote is taken, never created anew
        await git(repo, ['fetch', '-q', remote]);
        ausRemote = !(await git(repo, ['rev-parse', '-q', '--verify', `refs/remotes/${remote}/${branch}`])).code;
        const lokal = !(await git(repo, ['rev-parse', '-q', '--verify', `refs/heads/${branch}`])).code;
        if (ausRemote && !lokal) ab = `${remote}/${branch}`;
      }
      if (eigenerHalter) writeFileSync(halter, String(pid));
      const r = await pwshJsonAsync(a, skript('worktree.ps1'), ['-Action', 'Up', '-RepoRoot', repo, '-Package', name, '-Branch', branch, '-From', ab, '-SessionPid', String(pid)], { cwd: repo, env: { EPIC_LOCK_HOLDER: halter }, timeoutMs: 300_000 });
      const j = r.json as { path?: string; port?: number | null; isolation?: string | null } | null;
      if (r.code || !j?.path) throw new Error(`worktree.ps1 Up ${name}: ${flach(r.stderr) || `Exit ${r.code}`}`);
      if (ausRemote) await gitOk(j.path, ['pull', '--ff-only', remote, branch]);
      if (name === epicName) epicPfad = j.path;
      return { worktree: j.path, port: j.port ?? null, isolation: j.isolation ?? null, kopf: (await git(j.path, ['rev-parse', 'HEAD'])).stdout.trim() || null };
    },
    async down(name) {
      const r = await a('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', skript('worktree.ps1'), '-Action', 'Down', '-RepoRoot', repo, '-Package', name], { cwd: repo, timeoutMs: 300_000 });
      const meldung = flach(r.stderr);
      if (r.code && / is not clean/.test(meldung)) return { schmutzig: true };
      // a repeated Down after a stop: the worktree and its lock are gone already
      if (r.code && !(/ does not exist\./.test(meldung) && !existsSync(lockVon(name)))) throw new Error(`worktree.ps1 Down ${name}: ${meldung}`);
      if (name === epicName) halterWeg();
      return { schmutzig: false };
    },
    async branchLoeschen(branch) {
      const wt = await epicWt();
      if ((await git(wt, ['rev-parse', '-q', '--verify', `refs/heads/${branch}`])).code) return;
      await gitOk(wt, ['branch', '-d', branch]);
    },
    ram: e.ram ?? (() => messeRam(a, repo)),
    slot:
      e.slot ??
      (async () => {
        const ls = await composeLs();
        const locks = existsSync(join(common, 'epic-locks')) ? readdirSync(join(common, 'epic-locks')).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)) : [];
        return { belegt: ls !== null && stackLaeuft(ls, repo, worktreeRoot(), locks) };
      }),
    async volllauf(wt): Promise<Testlauf> {
      if (!tests) throw new Error(`.claude/epic.md in ${repo} nennt keine test_commands; ohne sie gibt es keine Ausgangszahlen`);
      const out: Testlauf = [];
      for (const [name, befehl] of Object.entries(tests)) {
        const g = await suite(name, befehl, wt);
        for (const r of g.rot) rotIn.set(`${wt}\0${r.datei}`, name);
        out.push({ name, ...g });
      }
      return out;
    },
    async einzeln(wt, datei) {
      const name = rotIn.get(`${wt}\0${datei}`);
      if (!name || !datei || !tests) return false;
      const befehl = tests[name];
      // Pester names its file in the command already; the others take the file as an argument (a worker limit stays)
      const dir = verzeichnisAus(befehl);
      const rel = dir && datei.startsWith(`${dir}/`) ? datei.slice(dir.length + 1) : datei;
      const einzel = /Invoke-Pester/i.test(befehl) ? befehl : `${befehl} ${/\s/.test(rel) ? `"${rel}"` : rel}`;
      try {
        const g = await suite(name, einzel, wt);
        return g.tests > 0 && !g.rot.length;
      } catch {
        return false;
      }
    },
    async lint(wt) {
      const out: Record<string, number> = {};
      for (const befehl of Object.values(lints ?? {})) {
        const r = await shell(befehl, wt);
        for (const [d, n] of Object.entries(zaehleLint(`${r.stdout}\n${r.stderr}`, befehl, wt, r.code))) out[d] = (out[d] ?? 0) + n;
      }
      return out;
    },
    async beruehrt(wt) {
      const start = await gitOk(wt, ['merge-base', 'HEAD', e.epicBranch]);
      const geaendert = await gitOk(wt, ['diff', '--name-only', start]);
      const neu = await gitOk(wt, ['ls-files', '--others', '--exclude-standard']);
      return [...new Set(`${geaendert}\n${neu}`.split(/\r?\n/).filter(Boolean))];
    },
    async sichern(wt, nachricht) {
      if (!existsSync(wt)) return null;
      await gitOk(wt, ['add', '-A']);
      if (!(await git(wt, ['diff', '--cached', '--quiet'])).code) return null;
      // 4d: pre_commit_checks before the commit (a git hook runs by itself in the commit); a red check is the package's matter
      for (const befehl of vorCommit) {
        const r = await shell(befehl, wt);
        if (r.code) throw new Error(`pre_commit_checks: ${befehl}: Exit ${r.code}: ${flach(r.stderr || r.stdout).slice(0, 600)}`);
      }
      await gitOk(wt, ['commit', '-q', '-F', '-'], nachricht);
      return gitOk(wt, ['rev-parse', 'HEAD']);
    },
    async imEpic(branch) {
      const r = await git(repo, ['rev-parse', '-q', '--verify', `refs/heads/${branch}`]);
      if (r.code) return null;
      const spitze = r.stdout.trim();
      if ((await git(repo, ['merge-base', '--is-ancestor', spitze, e.epicBranch])).code) return null;
      const merges = await gitOk(repo, ['log', '--merges', '--format=%H %P', `${spitze}..${e.epicBranch}`]);
      for (const zeile of merges.split(/\r?\n/)) {
        const [h, , ...andere] = zeile.split(' ');
        if (andere.includes(spitze)) return h;
      }
      return null;
    },
    async merge(branch) {
      const wt = await epicWt();
      // a branch without commits of its own is in HEAD already: nothing to merge, no merge commit (never the one of another package)
      if (!(await git(wt, ['merge-base', '--is-ancestor', branch, 'HEAD'])).code) return { ok: true, commit: null };
      const r = await git(wt, ['merge', '--no-ff', '--no-edit', branch]);
      if (!r.code) return { ok: true, commit: await gitOk(wt, ['rev-parse', 'HEAD']) };
      const offen = (await git(wt, ['diff', '--name-only', '--diff-filter=U'])).stdout.split(/\r?\n/).filter(Boolean);
      if (offen.length) return { ok: false, dateien: offen };
      throw fehler(`git merge --no-ff ${branch}`, r);
    },
    async mergeAbschliessen() {
      const wt = await epicWt();
      const offen = (await git(wt, ['diff', '--name-only', '--diff-filter=U'])).stdout.trim();
      if (offen) throw new Error(`Merge nicht abschließbar, noch ungelöst: ${offen.split(/\r?\n/).join(', ')}`);
      // strip: the "# Conflicts:" lines of the prepared message stay out of the merge commit
      await gitOk(wt, ['commit', '-q', '--no-edit', '--cleanup=strip']);
      return gitOk(wt, ['rev-parse', 'HEAD']);
    },
    async mergeAbbrechen() {
      const wt = await epicWt();
      if ((await git(wt, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).code) return;
      await gitOk(wt, ['merge', '--abort']);
    },
    async baumGleich(branch) {
      return (await git(await epicWt(), ['diff', '--quiet', branch, 'HEAD'])).code === 0;
    },
    async revert(commit) {
      const wt = await epicWt();
      await gitOk(wt, ['revert', '-m', '1', '--no-edit', commit]);
      return gitOk(wt, ['rev-parse', 'HEAD']);
    },
    async graph() {
      // the graph is optional: not installed, switched off or failed, the run goes on without it
      const r = await pwshJsonAsync(a, skript('graph.ps1'), ['-RepoRoot', repo, '-Worktree', await epicWt(), '-Package', epicName], { cwd: repo, timeoutMs: 600_000 });
      const j = r.json as { available?: boolean; reason?: string; graph?: string } | null;
      if (r.code || !j) return { available: false, grund: `graph.ps1 Exit ${r.code}: ${flach(r.stderr).slice(0, 300)}` };
      return { available: Boolean(j.available), ...(j.reason ? { grund: j.reason } : {}), ...(j.graph ? { pfad: j.graph } : {}) };
    },
    async body(ticket) {
      return String(JSON.parse(await gh(['issue', 'view', String(ticket), '--repo', e.forge, '--json', 'body'])).body ?? '');
    },
    async kommentare(ticket) {
      const j = JSON.parse(await gh(['issue', 'view', String(ticket), '--repo', e.forge, '--json', 'comments']));
      return ((j.comments ?? []) as { body: string }[]).map((k) => k.body);
    },
    async kommentar(ticket, text) {
      // from a file (stdin), never from a shell string (epic/references/forge.md, "Stolperstellen")
      await gh(['issue', 'comment', String(ticket), '--repo', e.forge, '--body-file', '-'], text);
    },
    async status(ticket, label) {
      await labelsSicher();
      return labelsSetzen(
        ticket,
        [label],
        Object.keys(LABELS).filter((l) => l !== label),
      );
    },
    async eroeffnung() {
      await labelsSicher();
      return labelsSetzen(e.epic, ['status/in-arbeit', adapter.epic_label], ['status/blockiert', 'status/haengt']);
    },
    async abschluss({ wip, body }) {
      const wt = await epicWt();
      await gitOk(wt, ['push', '-q', '-u', remote, e.epicBranch]);
      // a repeated end after a stop finds its pull request
      const offen = JSON.parse((await gh(['pr', 'list', '--repo', e.forge, '--head', e.epicBranch, '--state', 'open', '--json', 'url'])) || '[]') as { url: string }[];
      let pr: string | null = offen[0]?.url ?? null;
      if (!pr) {
        const titel = String(JSON.parse(await gh(['issue', 'view', String(e.epic), '--repo', e.forge, '--json', 'title'])).title ?? `Epic #${e.epic}`);
        const aus = await gh(['pr', 'create', '--repo', e.forge, '--base', basisBranch, '--head', e.epicBranch, '--title', `${wip ? 'WIP: ' : ''}${titel}`, '--body-file', '-'], body);
        pr = /https?:\/\/\S+/.exec(aus)?.[0] ?? null;
      }
      const fehler = await labelsSetzen(e.epic, [], ['status/in-arbeit']);
      halterWeg();
      return { pr, fehler };
    },
  };
}
