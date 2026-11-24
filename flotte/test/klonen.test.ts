// Adding a project by a link to its repository (`flotte projekt hinzufuegen [<ordner>] --klonen <url>`): only
// https links to github.com or a Gitea forge of a project already there; the folder proposed from the link;
// an existing folder only with a matching origin; an aborted clone removes only itself; after the clone
// rights and labels are checked and what setting up needs is named, never run. No network: the one real
// clone reads a local bare repository through the test hatch quelleUmleiten.

import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aufrufen, type AsyncAufrufer, type Aufrufer } from '../src/aufruf.ts';
import { ordnerVorschlag, originPasst, pruefeQuelle } from '../src/befehle/klonen.ts';
import { klonAngebot, projekt, type ProjektWelt } from '../src/befehle/projekt.ts';

const GITEA = 'https://gitea.beispiel.de:3000';

describe('pruefeQuelle: only https to github.com or a known Gitea forge', () => {
  it('takes github.com and the known Gitea forge, with or without .git and slash', () => {
    expect(pruefeQuelle('https://github.com/octo/klein', [])).toEqual({ url: 'https://github.com/octo/klein.git', art: 'github', forge: 'octo/klein', name: 'klein', api: 'https://api.github.com/repos/octo/klein' });
    expect(pruefeQuelle(' https://github.com/octo/klein.git/ ', []).forge).toBe('octo/klein');
    expect(pruefeQuelle(`${GITEA}/team/werk`, [GITEA])).toMatchObject({ art: 'gitea', url: `${GITEA}/team/werk.git`, api: `${GITEA}/api/v1/repos/team/werk` });
  });

  it.each([
    ['http://github.com/octo/klein', /Nur https-Links \(kein http:\/\/\)/],
    ['file:///C:/repos/klein', /Nur https-Links \(kein file:\/\/\)/],
    ['ssh://git@github.com/octo/klein.git', /Nur https-Links \(kein ssh:\/\/\)/],
    ['git@github.com:octo/klein.git', /ssh-Link/],
    ['https://user:geheim@github.com/octo/klein', /Benutzerangaben/],
    ['https://token@github.com/octo/klein', /Benutzerangaben/],
    ['https://localhost/octo/klein', /eigenen Netzes/],
    ['https://192.168.1.20/octo/klein', /eigenen Netzes/],
    ['https://[::1]/octo/klein', /eigenen Netzes/],
    ['https://nas.local/octo/klein', /eigenen Netzes/],
    ['https://gitlab.com/octo/klein', /Nur github\.com; gitlab\.com ist keine erlaubte Quelle/],
    ['https://gitea.beispiel.de/team/werk', /Nur github\.com oder gitea\.beispiel\.de:3000/],
    ['https://github.com:8443/octo/klein', /keine erlaubte Quelle/],
    ['https://github.com/octo', /kein Repository/],
    ['https://github.com/octo/klein/tree/main', /kein Repository/],
    ['https://github.com/octo/..', /kein Repository/],
    ['https://github.com/octo/klein?x=1', /Parameter/],
    ['kein link', /keine URL/],
  ])('%s is refused', (link, text) => {
    expect(() => pruefeQuelle(link, link.includes('gitea') ? [GITEA] : [])).toThrow(text);
  });

  it('origin matches over https, ssh and case; another repository does not', () => {
    const q = pruefeQuelle('https://github.com/Octo/Klein', []);
    expect(originPasst('https://github.com/octo/klein.git\n', q)).toBe(true);
    expect(originPasst('git@github.com:octo/klein.git', q)).toBe(true);
    expect(originPasst('ssh://git@github.com/octo/klein', q)).toBe(true);
    expect(originPasst('https://github.com/octo/anders.git', q)).toBe(false);
    expect(originPasst('https://gitlab.com/octo/klein.git', q)).toBe(false);
  });
});

describe('ordnerVorschlag', () => {
  it('next to most of the projects there, else ~/git/<name>', () => {
    const heim = join('C:', 'Users', 'jemand');
    expect(ordnerVorschlag('klein', [join('D:', 'repos', 'a'), join('D:', 'repos', 'b'), join('E:', 'x', 'c')], heim)).toBe(join('D:', 'repos', 'klein'));
    expect(ordnerVorschlag('klein', [], heim)).toBe(join(heim, 'git', 'klein'));
  });
});

// ---- the whole way through `flotte projekt hinzufuegen --klonen`

const LABELS_DA = ['bug', 'ready-for-agent', 'needs-triage'];

function welt(o: { push?: boolean; klon?: AsyncAufrufer; quelle?: string } = {}): ProjektWelt & { heim: string; gh: string[][]; klone: string[][] } {
  const heim = mkdtempSync(join(tmpdir(), 'flotte-klon-heim-'));
  mkdirSync(join(heim, '.claude'));
  const gh: string[][] = [];
  const klone: string[][] = [];
  const labels = new Set(LABELS_DA);
  const aufrufer: Aufrufer = (p, args, opts) => {
    if (p === 'git') return aufrufen(p, args, opts);
    gh.push(args);
    if (args[0] === 'api' && args[1] === 'repos/octo/klein') return { code: 0, stdout: JSON.stringify({ permissions: { push: o.push !== false }, has_issues: true }), stderr: '' };
    if (args[0] === 'label' && args[1] === 'list') return { code: 0, stdout: JSON.stringify([...labels].map((name) => ({ name }))), stderr: '' };
    if (args[0] === 'label' && args[1] === 'create') return labels.add(args[2]), { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'auth') return { code: 1, stdout: '', stderr: 'nicht angemeldet' };
    return { code: 1, stdout: '', stderr: 'unerwartet' };
  };
  const aufrufAsync: AsyncAufrufer = async (p, args, opts) => {
    klone.push(args);
    if (o.klon) return o.klon(p, args, opts);
    return aufrufen(p, args, { cwd: opts?.cwd, env: { ...process.env, ...opts?.env } });
  };
  return { aufrufer, aufrufAsync, heim, kontenDatei: join(heim, '.claude', 'flotte', 'konten.json'), gh, klone, ...(o.quelle ? { quelleUmleiten: () => o.quelle! } : {}) };
}

/** a small bare repository with a package.json and a .env.example, the source of the one real clone */
function bareRepo(): string {
  const basis = mkdtempSync(join(tmpdir(), 'flotte-klon-quelle-'));
  const arbeit = join(basis, 'arbeit');
  mkdirSync(arbeit);
  const g = (...args: string[]) => aufrufen('git', ['-C', arbeit, ...args]);
  g('init', '-q', '-b', 'main');
  writeFileSync(join(arbeit, 'package.json'), '{"name":"klein"}\n');
  writeFileSync(join(arbeit, '.env.example'), 'API_KEY=\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'start');
  const bare = join(basis, 'klein.git');
  aufrufen('git', ['clone', '-q', '--bare', arbeit, bare]);
  return bare;
}

const skript = (w: { heim: string }, name: string) => join(w.heim, '.claude', 'flotte', 'start', `${name}.ps1`);

describe('flotte projekt hinzufuegen --klonen', () => {
  it('a missing folder is cloned (real git from a local bare repository), adapter with forge and api from the link, labels created, setup named', async () => {
    const w = welt({ quelle: bareRepo() });
    const ziel = join(mkdtempSync(join(tmpdir(), 'flotte-klon-ziel-')), 'klein');
    const r = (await projekt(['hinzufuegen', ziel, '--klonen', 'https://github.com/octo/klein'], w)) as Record<string, any>;
    expect(readFileSync(join(ziel, 'package.json'), 'utf8')).toContain('klein');
    expect(aufrufen('git', ['-C', ziel, 'remote', 'get-url', 'origin']).stdout.trim()).toBe('https://github.com/octo/klein.git');
    // git clone runs with only https allowed (plus file for the hatch) and no prompt
    expect(w.klone[0].slice(0, 6)).toEqual(['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.file.allow=always']);
    const adapter = readFileSync(join(ziel, '.claude', 'epic.md'), 'utf8');
    expect(adapter).toMatch(/^forge: github$/m);
    expect(adapter).toMatch(/^api: https:\/\/api\.github\.com\/repos\/octo\/klein$/m);
    expect(r.adapter.offen).toEqual(['gate_command', 'test_commands', 'commit_style', 'commit_language']);
    expect(existsSync(skript(w, 'klein'))).toBe(true);
    expect(r.klon.geklont).toBe(true);
    expect(r.klon.zugang).toEqual({ push: true, issues: true, labelsAngelegt: ['ready-for-human', 'needs-info', 'wontfix', 'epic', 'status/in-arbeit', 'status/blockiert', 'status/haengt'], labelsFehlen: [] });
    expect(r.klon.einrichten).toEqual(['package.json (Abhängigkeiten nicht installiert)', '.env.example (.env fehlt: die Geheimnisse trägst du selbst ein)']);
    // nothing of the setup was run
    expect(existsSync(join(ziel, 'node_modules'))).toBe(false);
    expect(existsSync(join(ziel, '.env'))).toBe(false);
    expect(r.meldung).toMatch(/^Projekt klein: geklont aus octo\/klein; Adapter angelegt, noch auszufüllen: gate_command/);
    expect(r.meldung).toContain('Schreibrecht da; Labels angelegt: ready-for-human');
    expect(r.meldung).toContain('nichts davon ausgeführt');
    expect(r.meldung).not.toContain(ziel);
    expect(r.logbuch).toBe('Projekt klein hinzugefügt: geklont; Adapter angelegt, noch auszufüllen: gate_command, test_commands, commit_style, commit_language; Startskript klein.ps1 angelegt');
    expect(readdirSync(join(ziel, '..'))).toEqual(['klein']);
  });

  it('without a folder: proposed next to the projects there (start scripts), else ~/git/<name>', async () => {
    const w = welt({ quelle: bareRepo() });
    const eltern = mkdtempSync(join(tmpdir(), 'flotte-klon-eltern-'));
    mkdirSync(join(w.heim, '.claude', 'flotte', 'start'), { recursive: true });
    writeFileSync(skript(w, 'alt'), `Set-Location -LiteralPath '${join(eltern, 'alt')}'\r\n`);
    expect(klonAngebot(w)).toEqual({ gitea: [], eltern });
    const r = (await projekt(['hinzufuegen', '--klonen', 'https://github.com/octo/klein', '--konten', '1'], w)) as Record<string, any>;
    expect(r.ordner).toBe(join(eltern, 'klein'));
    expect(readFileSync(skript(w, 'klein'), 'utf8')).toContain("--konten '1'");
    expect(klonAngebot({ heim: mkdtempSync(join(tmpdir(), 'flotte-klon-leer-')) }).eltern).toMatch(/[\\/]git$/);
  });

  it('an existing folder whose origin matches: not cloned, added as today', async () => {
    const w = welt();
    const dir = join(mkdtempSync(join(tmpdir(), 'flotte-klon-da-')), 'klein');
    mkdirSync(dir);
    aufrufen('git', ['-C', dir, 'init', '-q']);
    aufrufen('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:octo/klein.git']);
    const r = (await projekt(['hinzufuegen', dir, '--klonen', 'https://github.com/octo/klein'], w)) as Record<string, any>;
    expect(w.klone).toEqual([]);
    expect(r.klon.geklont).toBe(false);
    expect(r.meldung).toMatch(/^Projekt klein: Ordner schon da, origin passt zu octo\/klein; Adapter angelegt/);
    expect(existsSync(skript(w, 'klein'))).toBe(true);
  });

  it('an existing folder with another origin, or none: refused, nothing cloned or written', async () => {
    const w = welt();
    const dir = join(mkdtempSync(join(tmpdir(), 'flotte-klon-fremd-')), 'klein');
    mkdirSync(dir);
    aufrufen('git', ['-C', dir, 'init', '-q']);
    await expect(projekt(['hinzufuegen', dir, '--klonen', 'https://github.com/octo/klein'], w)).rejects.toThrow('Den Ordner klein gibt es schon, aber ohne origin; nicht geklont, nichts geschrieben.');
    aufrufen('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/octo/anders.git']);
    await expect(projekt(['hinzufuegen', dir, '--klonen', 'https://github.com/octo/klein'], w)).rejects.toThrow('sein origin zeigt auf ein anderes Repository als octo/klein; nicht geklont, nichts geschrieben');
    expect(w.klone).toEqual([]);
    expect(existsSync(join(dir, '.claude'))).toBe(false);
    expect(existsSync(skript(w, 'klein'))).toBe(false);
  });

  it('an aborted clone removes only its own half clone (read-only files too); the folder stays missing, a neighbour stays', async () => {
    const klon: AsyncAufrufer = async (_p, args) => {
      const zwischen = args.at(-1)!;
      mkdirSync(join(zwischen, '.git', 'objects', 'pack'), { recursive: true });
      const pack = join(zwischen, '.git', 'objects', 'pack', 'pack-1.pack');
      writeFileSync(pack, 'halb');
      chmodSync(pack, 0o444);
      return { code: 128, stdout: '', stderr: 'fatal: early EOF\nfatal: fetch-pack: invalid index-pack output' };
    };
    const w = welt({ klon });
    const eltern = mkdtempSync(join(tmpdir(), 'flotte-klon-abbruch-'));
    writeFileSync(join(eltern, 'nachbar.txt'), 'bleibt');
    const ziel = join(eltern, 'klein');
    await expect(projekt(['hinzufuegen', ziel, '--klonen', 'https://github.com/octo/klein'], w)).rejects.toThrow('Klon von octo/klein abgebrochen: fatal: fetch-pack: invalid index-pack output. Der abgebrochene Klon ist wieder entfernt.');
    expect(readdirSync(eltern)).toEqual(['nachbar.txt']);
    expect(existsSync(skript(w, 'klein'))).toBe(false);
  });

  it('a refused link or a start script for another folder: refused before any clone', async () => {
    const w = welt();
    const ziel = join(mkdtempSync(join(tmpdir(), 'flotte-klon-nein-')), 'klein');
    await expect(projekt(['hinzufuegen', ziel, '--klonen', 'file:///C:/geheim'], w)).rejects.toThrow('Nur https-Links');
    mkdirSync(join(w.heim, '.claude', 'flotte', 'start'), { recursive: true });
    writeFileSync(skript(w, 'klein'), "Set-Location -LiteralPath 'C:\\woanders\\klein'\r\n");
    await expect(projekt(['hinzufuegen', ziel, '--klonen', 'https://github.com/octo/klein'], w)).rejects.toThrow('Das Startskript klein.ps1 gibt es schon für einen anderen Ordner');
    expect(w.klone).toEqual([]);
    expect(existsSync(ziel)).toBe(false);
    await expect(projekt(['hinzufuegen', '--klonen'], w)).rejects.toThrow('Aufruf:');
  });

  it('without the write right: no label created, the missing right and only the missing labels named', async () => {
    const w = welt({ push: false, quelle: bareRepo() });
    const ziel = join(mkdtempSync(join(tmpdir(), 'flotte-klon-lesen-')), 'klein');
    const r = (await projekt(['hinzufuegen', ziel, '--klonen', 'https://github.com/octo/klein'], w)) as Record<string, any>;
    expect(w.gh.some((a) => a[0] === 'label' && a[1] === 'create')).toBe(false);
    expect(r.klon.zugang.push).toBe(false);
    expect(r.klon.zugang.labelsFehlen).not.toContain('ready-for-agent');
    expect(r.meldung).toContain('Schreibrecht fehlt (pushen und Labels setzen geht nicht); Labels fehlen: ready-for-human, needs-info');
  });

  it('the folder may stand after the switches as well; two folders are refused', async () => {
    const w = welt({ quelle: bareRepo() });
    const ziel = join(mkdtempSync(join(tmpdir(), 'flotte-klon-nach-')), 'woanders');
    const r = (await projekt(['hinzufuegen', '--klonen', 'https://github.com/octo/klein', ziel, '--konten', '1'], w)) as Record<string, any>;
    expect(r.ordner).toBe(ziel);
    expect(existsSync(join(ziel, '.claude', 'epic.md'))).toBe(true);
    await expect(projekt(['hinzufuegen', ziel, '--klonen', 'https://github.com/octo/klein', `${ziel}2`], w)).rejects.toThrow('Aufruf:');
  });

  it('a Gitea link is allowed only for the Gitea forge of a project there', async () => {
    const w = welt();
    const eigenes = join(mkdtempSync(join(tmpdir(), 'flotte-klon-gitea-')), 'werk');
    mkdirSync(join(eigenes, '.claude'), { recursive: true });
    writeFileSync(join(eigenes, '.claude', 'epic.md'), `---\nforge: gitea\napi: ${GITEA}/api/v1/repos/team/werk\n---\n`);
    expect(klonAngebot({ heim: w.heim, eigenesRepo: eigenes }).gitea).toEqual([GITEA]);
    await expect(projekt(['hinzufuegen', join(eigenes, '..', 'neu'), '--klonen', `${GITEA}/team/neu`], w)).rejects.toThrow('ist keine erlaubte Quelle');
  });
});
