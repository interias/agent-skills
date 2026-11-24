// Adding a project by a link to its repository: `flotte projekt hinzufuegen [<ordner>] --klonen <url>` and the
// bridge's field "oder Link zum Repository". Only https links to github.com or to the Gitea forge of a project
// this machine already drives; no user in the link, no file://, ssh:// or address of the own network. The
// machine clones with its own Git and gh login; no credential goes through the bridge. The clone lands in a
// hidden sibling folder first and is renamed at the end, so an aborted one leaves no half folder behind and
// only that sibling is removed. An existing folder is never cloned over: its origin must match the link.
// After the clone: write and issue rights, the labels of the fleet (missing ones created when the right is
// there), and what the project needs to be set up (dependencies, .env), named, never run.

import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { aufrufenAsync, type Aufrufer, type AsyncAufrufer } from '../aufruf.ts';
import { LABELS } from '../epic/mechanik.ts';
import { adapterText, zugriffFuer } from '../forge/zugriff.ts';
import { schluessel } from './adapter.ts';
import { giteaZugang } from './auftrag.ts';

export interface Quelle {
  /** the link git clones: https://<host>/<owner>/<name>.git */
  url: string;
  art: 'github' | 'gitea';
  /** owner/name */
  forge: string;
  /** the repository name, the proposed folder name */
  name: string;
  /** the value of the adapter key api */
  api: string;
}

const LOKAL = /^(localhost|.*\.localhost|.*\.local|.*\.lan|.*\.home\.arpa|.*\.internal)$/i;
const IP = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;
const TEIL = /^[\w.-]{1,100}$/;

/**
 * The link as the machine accepts it, or a refusal with a clear text. gitea: the origins (https://host[:port])
 * of the Gitea forges this machine already drives; github.com always.
 */
export function pruefeQuelle(link: string, gitea: string[]): Quelle {
  const roh = link.trim();
  if (/^[\w.-]+@[\w.-]+:/.test(roh)) throw new Error('Nur https-Links: ein ssh-Link (git@…) wird nicht geklont; den https-Link des Repositorys nehmen.');
  let u: URL;
  try {
    u = new URL(roh);
  } catch {
    throw new Error('Der Link ist keine URL; etwa https://github.com/<owner>/<name>.');
  }
  if (u.protocol !== 'https:') throw new Error(`Nur https-Links (kein ${u.protocol}//); etwa https://github.com/<owner>/<name>.`);
  if (u.username || u.password) throw new Error('Der Link enthält Benutzerangaben; ohne sie angeben (der Rechner nimmt seine eigene Anmeldung).');
  if (u.search || u.hash) throw new Error('Der Link hat Parameter oder einen Anker; nur https://<host>/<owner>/<name>.');
  const host = u.hostname.toLowerCase();
  const art = host === 'github.com' && !u.port ? 'github' : gitea.some((g) => g.toLowerCase() === u.origin.toLowerCase()) ? 'gitea' : null;
  if (!art) {
    if (LOKAL.test(host) || IP.test(host)) throw new Error('Keine Adressen dieses Rechners oder des eigenen Netzes; nur github.com oder die Gitea-Forge eines Projekts.');
    throw new Error(`Nur github.com${gitea.length ? ` oder ${gitea.map((g) => new URL(g).host).join(', ')}` : ''}; ${u.host} ist keine erlaubte Quelle.`);
  }
  const teile = u.pathname.replace(/\/+$/, '').split('/').slice(1);
  const name = (teile[1] ?? '').replace(/\.git$/i, '');
  if (teile.length !== 2 || !TEIL.test(teile[0]) || !TEIL.test(name) || /^\.+$/.test(teile[0]) || /^\.+$/.test(name)) throw new Error('Der Link nennt kein Repository; erwartet wird https://<host>/<owner>/<name>.');
  const forge = `${teile[0]}/${name}`;
  return { url: `${u.origin}/${forge}.git`, art, forge, name, api: art === 'github' ? `https://api.github.com/repos/${forge}` : `${u.origin}/api/v1/repos/${forge}` };
}

/** host/owner/name of a remote (https with or without user, ssh:// or git@host:), lower case; null when unreadable */
export function remoteKern(remote: string): string | null {
  const r = remote.trim();
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/.exec(r);
  let host: string;
  let pfad: string;
  if (scp) [host, pfad] = [scp[1], scp[2]];
  else {
    try {
      const u = new URL(r);
      [host, pfad] = [u.hostname, u.pathname];
    } catch {
      return null;
    }
  }
  const teile = pfad.replace(/\/+$/, '').replace(/\.git$/i, '').split('/').filter(Boolean);
  return teile.length >= 2 ? `${host}/${teile.slice(-2).join('/')}`.toLowerCase() : null;
}

/** whether origin points at the repository of the link (same host, owner and name; ssh or https) */
export const originPasst = (origin: string, q: Quelle) => remoteKern(origin) === remoteKern(q.url);

/** The origins of the Gitea forges of the given project folders (adapter `forge: gitea`, its `api`). */
export function giteaHerkuenfte(ordner: string[]): string[] {
  const aus = new Set<string>();
  for (const o of ordner) {
    const text = adapterText(o);
    if (schluessel(text, 'forge') !== 'gitea') continue;
    try {
      aus.add(new URL(schluessel(text, 'api') ?? '').origin);
    } catch {
      /* no api */
    }
  }
  return [...aus];
}

/** The proposed folder: next to most of the projects already there, else ~/git/<name>. */
export function ordnerVorschlag(name: string, projekte: string[], heim: string): string {
  const zahl = new Map<string, number>();
  for (const p of projekte) zahl.set(dirname(p), (zahl.get(dirname(p)) ?? 0) + 1);
  const eltern = [...zahl].sort((a, b) => b[1] - a[1])[0]?.[0] ?? join(heim, 'git');
  return join(eltern, name.replace(/[^\w.-]/g, '-'));
}

export interface KlonWelt {
  aufrufAsync?: AsyncAufrufer;
  /** test hatch only: the source git really clones from (a local bare repository); origin is set to the link afterwards */
  quelleUmleiten?: (url: string) => string;
  /** default 30 minutes */
  zeitgrenzeMs?: number;
}

/** Clones the link into the folder, which must not exist; an aborted clone removes only its own hidden sibling folder. */
export async function klonen(q: Quelle, ordner: string, w: KlonWelt): Promise<void> {
  const a = w.aufrufAsync ?? aufrufenAsync;
  if (existsSync(ordner)) throw new Error(`Den Ordner ${basename(ordner)} gibt es schon; nicht geklont.`);
  mkdirSync(dirname(ordner), { recursive: true });
  const zwischen = join(dirname(ordner), `.${basename(ordner)}.klon-${process.pid}-${Date.now()}`);
  const umgeleitet = w.quelleUmleiten?.(q.url);
  // only https leaves the machine, also on a redirect; no prompt for a login that would hang the driver
  const schutz = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', ...(umgeleitet ? ['-c', 'protocol.file.allow=always'] : [])];
  const weg = () => {
    try {
      rmSync(zwischen, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* named in the refusal */
    }
  };
  let r: Awaited<ReturnType<AsyncAufrufer>>;
  try {
    r = await a('git', [...schutz, 'clone', '--quiet', '--no-recurse-submodules', '--', umgeleitet ?? q.url, zwischen], { timeoutMs: w.zeitgrenzeMs ?? 30 * 60_000, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
  } catch (e) {
    r = { code: 1, stdout: '', stderr: (e as Error).message };
  }
  if (r.code) {
    weg();
    const rest = existsSync(zwischen) ? ' Der abgebrochene Klon ließ sich nicht ganz entfernen.' : ' Der abgebrochene Klon ist wieder entfernt.';
    throw new Error(`Klon von ${q.forge} abgebrochen: ${(r.stderr || r.stdout).trim().split(/\r?\n/).at(-1)?.slice(0, 200) || `Code ${r.code}`}.${rest}`);
  }
  try {
    if (umgeleitet) {
      const s = await a('git', ['-C', zwischen, 'remote', 'set-url', 'origin', q.url]);
      if (s.code) throw new Error(s.stderr.trim());
    }
    renameSync(zwischen, ordner);
  } catch (e) {
    weg();
    throw new Error(`Klon von ${q.forge} nicht abgeschlossen: ${(e as Error).message.slice(0, 200)}. Der Klon ist wieder entfernt.`);
  }
}

/** The labels the fleet works with: release, triage and skip labels of the adapter, the mission label, the status labels. */
export function flottenLabels(adapter: string): [string, string | undefined, string | undefined][] {
  const skip = schluessel(adapter, 'skip_labels');
  const liste = skip ? skip.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : ['needs-triage', 'needs-info', 'wontfix'];
  const namen = [schluessel(adapter, 'ready_label') ?? 'ready-for-agent', 'ready-for-human', ...liste, schluessel(adapter, 'epic_label') ?? 'epic'];
  const aus: [string, string | undefined, string | undefined][] = [...new Set(namen)].map((n) => [n, undefined, undefined]);
  for (const [n, l] of Object.entries(LABELS)) aus.push([n, l.farbe, l.text]);
  return aus;
}

export interface Zugang {
  push: boolean | null;
  issues: boolean | null;
  labelsAngelegt: string[];
  labelsFehlen: string[];
  /** why something could not be checked */
  fehler?: string;
}

/** Write and issue rights on the repository, then the labels of the fleet: missing ones are created when the right is there. */
export async function zugangPruefen(repo: string, q: Quelle, w: { aufrufer: Aufrufer; abruf?: typeof fetch }): Promise<Zugang> {
  const z: Zugang = { push: null, issues: null, labelsAngelegt: [], labelsFehlen: [] };
  let info: Record<string, any> | null = null;
  if (q.art === 'github') {
    const r = w.aufrufer('gh', ['api', `repos/${q.forge}`]);
    if (r.code) z.fehler = 'gh ist am Rechner nicht angemeldet oder sieht das Repository nicht';
    else {
      try {
        info = JSON.parse(r.stdout);
      } catch {
        z.fehler = 'gh antwortete unlesbar';
      }
    }
  } else {
    try {
      const kopf = giteaZugang(adapterText(repo), repo, w.aufrufer);
      const r = await (w.abruf ?? fetch)(q.api, { headers: { Authorization: kopf } });
      if (r.ok) info = (await r.json()) as Record<string, any>;
      else z.fehler = `Gitea antwortete ${r.status}`;
    } catch (e) {
      z.fehler = (e as Error).message.slice(0, 200);
    }
  }
  if (info) {
    z.push = info.permissions?.push === true;
    z.issues = info.has_issues !== false;
  }
  const soll = flottenLabels(adapterText(repo));
  if (!z.push) {
    z.labelsFehlen = soll.map(([n]) => n);
    return z;
  }
  try {
    const f = zugriffFuer(repo, w.aufrufer, q.forge);
    const da = new Set(f.labelNamen());
    const neu = soll.filter(([n]) => !da.has(n));
    for (const [n, farbe, text] of neu) {
      try {
        f.labelAnlegen(n, farbe, text);
      } catch {
        /* read back below */
      }
    }
    // gh label create says nothing on a failure: what counts is what the forge lists afterwards
    const nachher = neu.length ? new Set(f.labelNamen()) : da;
    for (const [n] of neu) (nachher.has(n) ? z.labelsAngelegt : z.labelsFehlen).push(n);
  } catch (e) {
    z.labelsFehlen = soll.map(([n]) => n);
    z.fehler = `Labels nicht gelesen: ${(e as Error).message.slice(0, 200)}`;
  }
  return z;
}

export function zugangText(z: Zugang): string {
  const teile: string[] = [];
  if (z.push === null) teile.push(`Rechte nicht geprüft (${z.fehler ?? 'keine Antwort'})`);
  else {
    teile.push(z.push ? 'Schreibrecht da' : 'Schreibrecht fehlt (pushen und Labels setzen geht nicht)');
    if (z.issues === false) teile.push('Issues sind im Repository abgeschaltet');
  }
  if (z.labelsAngelegt.length) teile.push(`Labels angelegt: ${z.labelsAngelegt.join(', ')}`);
  if (z.labelsFehlen.length) teile.push(`Labels fehlen: ${z.labelsFehlen.join(', ')}`);
  return teile.join('; ');
}

/** What setting up the project would need; the driver names it and runs none of it. */
export function einrichtenUmschau(ordner: string): string[] {
  const da = (p: string) => existsSync(join(ordner, p));
  const aus: string[] = [];
  const node = ['package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].filter(da);
  if (node.length) aus.push(`${node.join(', ')}${da('node_modules') ? '' : ' (Abhängigkeiten nicht installiert)'}`);
  const py = ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'Pipfile', 'uv.lock'].filter(da);
  if (py.length) aus.push(`${py.join(', ')}${da('.venv') || da('venv') ? '' : ' (keine venv)'}`);
  for (const beispiel of ['.env.example', '.env.sample', '.env.template']) {
    if (da(beispiel)) aus.push(`${beispiel}${da('.env') ? '' : ' (.env fehlt: die Geheimnisse trägst du selbst ein)'}`);
  }
  const compose = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].filter(da);
  if (compose.length) aus.push(compose.join(', '));
  return aus;
}

/** The adapter template with forge and api of the link filled in (what the link tells). */
export function vorlageMitQuelle(vorlage: string, q: Quelle): string {
  return vorlage.replace(/^forge: <[^>]*>$/m, `forge: ${q.art}`).replace(/^api: <[^>]*>$/m, `api: ${q.api}`);
}
