// `flotte pruefen <ordner>` names what an existing repository lacks to be driven by the fleet, each point with
// the step of /flotte-einrichten. Dummy repositories (real git, a gh and Task Scheduler stand-in); the command only reads.

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aufrufen, type Aufrufer } from '../src/aufruf.ts';
import { flottenLabels } from '../src/befehle/klonen.ts';
import { startskript } from '../src/befehle/projekt.ts';
import { nachtlaufAufgabe, pruefen, pruefeRepo, SCHRITTE, type Punkt } from '../src/befehle/pruefen.ts';

const git = (dir: string, ...args: string[]) => {
  const r = aufrufen('git', ['-C', dir, ...args]);
  if (r.code) throw new Error(r.stderr);
  return r.stdout;
};

function repo(dateien: Record<string, string> = {}, name = 'app'): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'flotte-pruefen-')), name);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  for (const [pfad, text] of Object.entries(dateien)) {
    mkdirSync(join(dir, pfad, '..'), { recursive: true });
    writeFileSync(join(dir, pfad), text);
  }
  return dir;
}

const BLOCK = ['## Gate', '', '```', '== Gate: Basis origin/main @ a7d3a91, 3 geänderte Dateien (HEAD d9084a7c)', '  web grün            0:50', 'Gate grün.', '```'].join('\n');

interface Forge {
  push?: boolean;
  issues?: boolean;
  labels?: string[];
  prs?: { number: number; body: string; mergedAt: string }[];
  aufgabe?: 'da' | 'fehlt' | null;
}

/** git for real; gh and the Task Scheduler answer from `f`; every call is recorded. */
function welt(f: Forge = {}) {
  const heim = mkdtempSync(join(tmpdir(), 'flotte-pruefen-heim-'));
  const aufrufe: [string, string[]][] = [];
  const aufrufer: Aufrufer = (p, args, opts) => {
    aufrufe.push([p, args]);
    if (p === 'git') return aufrufen(p, args, opts);
    if (p === 'powershell') return f.aufgabe === null ? { code: 1, stdout: '', stderr: 'kaputt' } : { code: 0, stdout: `${f.aufgabe ?? 'fehlt'}\n`, stderr: '' };
    if (p === 'gh' && args[0] === 'api') return { code: 0, stdout: JSON.stringify({ permissions: { push: f.push ?? true }, has_issues: f.issues ?? true }), stderr: '' };
    if (p === 'gh' && args[0] === 'label') return { code: 0, stdout: JSON.stringify((f.labels ?? []).map((name) => ({ name }))), stderr: '' };
    if (p === 'gh' && args[0] === 'pr') return { code: 0, stdout: JSON.stringify(f.prs ?? []), stderr: '' };
    return { code: 1, stdout: '', stderr: 'unerwartet' };
  };
  return { aufrufer, heim, aufrufe };
}

const FERTIG = [
  '---',
  'forge: github',
  'api: https://api.github.com/repos/o/r',
  'merge: nach_gate',
  'gate_command: pwsh -NoProfile -File ./gate.ps1',
  'gate_cached: aus dem Cache',
  'gate_night_command: pwsh -NoProfile -File ./gate.ps1 -OhneCache',
  'exclusive_paths: [package.json]',
  'test_commands:',
  '  unit: npm test',
  '---',
  '# Adapter',
  '',
].join('\n');

const stand = (r: any, punkt: string): Punkt => r.punkte.find((p: Punkt) => p.punkt === punkt);

describe('flotte pruefen', () => {
  it('a bare repository: every point that is missing, each with its step of /flotte-einrichten', async () => {
    const dir = repo();
    const r = (await pruefeRepo(dir, welt({ push: false }))) as any;
    expect(r.projekt).toBe('app');
    expect(r.adapterQuelle).toBeNull();
    const fehlt = r.punkte.filter((p: Punkt) => p.stand === 'fehlt').map((p: Punkt) => p.punkt);
    expect(fehlt).toEqual(['adapter', 'gate_command', 'gate_cached', 'merge', 'rechte', 'labels', 'gate_night_command', 'aufgabe']);
    // with a standard of their own or a driver started by hand: recommended, not missing
    for (const k of ['forge', 'api', 'test_commands', 'exclusive_paths', 'notiz', 'startskript']) expect(stand(r, k).stand, k).toBe('empfohlen');
    expect(stand(r, 'adapter').schritt).toBe('/flotte-einrichten, Schritt 3 (Adapter): Adapter anlegen und ausfüllen');
    expect(stand(r, 'gate_command').schritt).toMatch(/^\/flotte-einrichten, Schritt 2 \(Andockprüfung\)/);
    expect(stand(r, 'labels').text).toBe(`Labels fehlen: ${flottenLabels('').map(([n]) => n).join(', ')}`);
    expect(stand(r, 'rechte').text).toBe('kein Schreibrecht für die Anmeldung dieses Rechners');
    expect(stand(r, 'aufgabe').text).toBe(`keine geplante Aufgabe ${nachtlaufAufgabe(dir)}`);
    expect(stand(r, 'nachweisblock')).toMatchObject({ stand: 'offen', schritt: expect.stringContaining('Schritt 6 (Probelauf und Anmelden)') });
    expect(r.fehlt).toBe(8);
    expect(r.empfohlen).toBe(6);
    // the next step is the lowest one among the missing points
    expect(r.folge).toBe(`app: 8 Punkt(e) fehlen (${fehlt.join(', ')}); als Nächstes /flotte-einrichten, Schritt 2 (Andockprüfung): Andockprüfung mit Kontexten bauen`);
  });

  it('a repository ready for the fleet: nothing missing, nothing open, no recommendation', async () => {
    const dir = repo({ '.claude/epic.md': FERTIG, 'AGENTS.md': 'Angedockt wird nur mit merge.ps1.\n' });
    const w = welt({ labels: flottenLabels(FERTIG).map(([n]) => n), prs: [{ number: 7, body: `Text\n\n${BLOCK}\n`, mergedAt: '2026-11-20T10:00:00Z' }], aufgabe: 'da' });
    mkdirSync(join(w.heim, '.claude', 'flotte', 'start'), { recursive: true });
    writeFileSync(join(w.heim, '.claude', 'flotte', 'start', 'app.ps1'), startskript({ name: 'app', ordner: dir, konten: ['1'], bruecke: 'http://127.0.0.1:4747' }));
    const r = (await pruefeRepo(dir, w)) as any;
    expect(r.punkte.filter((p: Punkt) => p.stand !== 'ok')).toEqual([]);
    expect(stand(r, 'nachweisblock').text).toBe('Andockblock mit Basis und HEAD in #7');
    expect(r.folge).toBe('app: nichts fehlt');
  });

  it('old name, placeholders, abolished keys, a proof block without HEAD', async () => {
    const adapter = FERTIG.replace('api: https://api.github.com/repos/o/r', 'api: <API-Basis>').replace('gate_cached: aus dem Cache', 'gate_areas: [web]');
    const dir = repo({ '.claude/prd.md': adapter });
    const ohneKopf = BLOCK.replace(' (HEAD d9084a7c)', '');
    const r = (await pruefeRepo(dir, welt({ prs: [{ number: 3, body: ohneKopf, mergedAt: '2026-11-19T10:00:00Z' }, { number: 9, body: 'kein Block', mergedAt: '2026-11-21T10:00:00Z' }] }))) as any;
    expect(stand(r, 'adapter')).toMatchObject({ stand: 'fehlt', text: 'Adapter unter altem Namen .claude/prd.md', schritt: expect.stringContaining('umbenennen') });
    expect(stand(r, 'platzhalter')).toMatchObject({ stand: 'fehlt', text: expect.stringContaining('noch in <…>: api') });
    expect(stand(r, 'abgeschafft')).toMatchObject({ stand: 'empfohlen', text: 'abgeschaffte Schlüssel stehen noch: gate_areas' });
    expect(stand(r, 'gate_cached').stand).toBe('fehlt');
    expect(stand(r, 'nachweisblock')).toMatchObject({ stand: 'fehlt', text: 'der Andockblock in #3 nennt die Basis, aber keinen HEAD' });
  });

  it('reads the adapter of the default branch on origin before the working copy', async () => {
    const quelle = repo({ '.claude/epic.md': FERTIG }, 'quelle');
    git(quelle, 'add', '-A');
    git(quelle, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'adapter');
    const dir = join(mkdtempSync(join(tmpdir(), 'flotte-pruefen-klon-')), 'app');
    aufrufen('git', ['clone', '-q', quelle, dir]);
    git(dir, 'remote', 'set-url', 'origin', 'https://github.com/o/r.git');
    writeFileSync(join(dir, '.claude', 'epic.md'), FERTIG.replace('merge: nach_gate', 'merge: mensch'));
    const r = (await pruefeRepo(dir, welt())) as any;
    expect(r.adapterQuelle).toBe('origin/HEAD');
    expect(stand(r, 'merge').stand).toBe('ok');
  });

  it('only reads: no fetch, no label created, nothing written; an unanswered Task Scheduler is open, not missing', async () => {
    const dir = repo({ '.claude/epic.md': FERTIG });
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
    const w = welt({ aufgabe: null });
    const r = (await pruefeRepo(dir, w)) as any;
    expect(stand(r, 'aufgabe').stand).toBe('offen');
    const gh = w.aufrufe.filter(([p]) => p === 'gh').map(([, a]) => a.slice(0, 2).join(' '));
    expect(gh.every((a) => ['api repos/o/r', 'label list', 'pr list'].includes(a))).toBe(true);
    expect(w.aufrufe.filter(([p, a]) => p === 'git' && ['fetch', 'pull', 'push', 'commit', 'checkout'].some((x) => a.includes(x)))).toEqual([]);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('from a subfolder: the repository root counts; a partial run is no proof block', async () => {
    const dir = repo({ '.claude/epic.md': FERTIG, 'sub/x.txt': 'x' });
    const teil = BLOCK.replace('== Gate: Basis', '== Gate Immer-Teil: Basis');
    const r = (await pruefeRepo(join(dir, 'sub'), welt({ prs: [{ number: 4, body: teil, mergedAt: '2026-11-22T10:00:00Z' }] }))) as any;
    expect(r.projekt).toBe('app');
    expect(r.adapterQuelle).toBe('Arbeitskopie');
    expect(stand(r, 'aufgabe').text).toBe(`keine geplante Aufgabe ${nachtlaufAufgabe(dir)}`);
    expect(stand(r, 'nachweisblock').stand).toBe('offen');
  });

  it('the task name is the one nachtlauf-aufgabe.ps1 builds (hash computed by the script logic in PowerShell)', () => {
    expect(nachtlaufAufgabe('C:\\git\\app')).toBe('Flotte Nachtlauf app-d1f4a3');
  });

  it('every step named stands as a heading in flotte-einrichten/SKILL.md', () => {
    const skill = readFileSync(new URL('../../flotte-einrichten/SKILL.md', import.meta.url), 'utf8');
    for (const [n, name] of Object.entries(SCHRITTE)) expect(skill).toContain(`\n## Schritt ${n}: ${name}\n`);
  });

  it('a wrong call is refused', async () => {
    await expect(pruefen(['a', 'b'], welt())).rejects.toThrow('Aufruf: flotte pruefen [<ordner>]');
    await expect(pruefen([join(tmpdir(), 'gibt-es-nicht-xyz')], welt())).rejects.toThrow('gibt es nicht');
  });
});
