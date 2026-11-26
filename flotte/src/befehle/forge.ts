// flotte forge pruefen|verknuepfen [<repo>] (#125): is the forge of a project linked at this machine?
// GitHub through `gh auth status` and a probe of the push right on the repository; Gitea with the access
// `flotte auftrag` uses (token_env, token_file or the Git credential store) against /user and the
// repository, through curl like every other Gitea call of the driver (a long-running driver stayed on "not
// signed in" after a network outage while it read through fetch). A host that curl does not reach is no
// verdict on the sign-in: forgeStatus fails then, and the driver keeps the state it last read. Only the state and the account name leave this module, never a token. verknuepfen opens
// a terminal at the machine (gh auth login, or a hidden prompt for the Gitea token into the credential
// store); nothing of it goes through the bridge (ADR-0005).

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { schluessel } from './adapter.ts';
import { giteaRepoAus, giteaZugang, githubRepoAus } from './auftrag.ts';
import { oeffneTerminal } from './konten.ts';
import { curl } from '../forge/curl.ts';

export interface ForgeStatus {
  art: 'github' | 'gitea';
  /** owner/name */
  forge: string;
  angemeldet: boolean;
  konto: string | null;
  /** push right on the repository; null when not signed in */
  rechte: 'ok' | 'fehlt' | null;
  /** whether the driver can run the project (GitHub and Gitea through its forge layer, #127) */
  treiber: boolean;
}

export interface ForgeWelt {
  aufrufer: Aufrufer;
  /** verknuepfen: the terminal at the machine; default the real one */
  terminal?: (befehl: string) => void;
}

const adapterVon = (repo: string) => {
  const d = join(repo, '.claude', 'epic.md');
  return existsSync(d) ? readFileSync(d, 'utf8') : '';
};

/** `github`: owner/name when the caller knows it (the driver: --forge), else from adapter or origin. */
export async function forgeStatus(repo: string, w: ForgeWelt, github?: string): Promise<ForgeStatus> {
  const adapter = adapterVon(repo);
  if (schluessel(adapter, 'forge') === 'gitea') {
    const forge = giteaRepoAus(adapter);
    const nicht: ForgeStatus = { art: 'gitea', forge, angemeldet: false, konto: null, rechte: null, treiber: true };
    let kopf: string;
    try {
      kopf = giteaZugang(adapter, repo, w.aufrufer);
    } catch {
      return nicht;
    }
    const api = schluessel(adapter, 'api')!.replace(/\/+$/, '');
    const hole = (url: string) => {
      const r = giteaLesen(w.aufrufer, url, kopf);
      if ('fehler' in r && r.status === 0) throw new Error(r.fehler);
      return 'fehler' in r ? null : r.info;
    };
    const ich = hole(`${new URL(api).origin}/api/v1/user`);
    const r = hole(api);
    // a token scoped to the repository (no read:user) gets 403 on /user but reads the repository: signed in,
    // only the account name stays unknown
    if (!ich?.login && !r) return nicht;
    return { ...nicht, angemeldet: true, konto: ich?.login ? String(ich.login).slice(0, 100) : null, rechte: r?.permissions?.push === true ? 'ok' : 'fehlt' };
  }
  const forge = github ?? githubRepoAus(adapter, repo, w.aufrufer);
  const auth = w.aufrufer('gh', ['auth', 'status', '--hostname', 'github.com']);
  if (auth.code) return { art: 'github', forge, angemeldet: false, konto: null, rechte: null, treiber: true };
  const konto = /(?:account|as) ([\w-]+)/.exec(`${auth.stdout}\n${auth.stderr}`)?.[1] ?? null;
  const push = w.aufrufer('gh', ['api', `repos/${forge}`, '--jq', '.permissions.push']);
  return { art: 'github', forge, angemeldet: true, konto, rechte: !push.code && push.stdout.trim() === 'true' ? 'ok' : 'fehlt', treiber: true };
}

/** A GET against the Gitea API through curl; status 0 is a host curl did not reach. */
function giteaLesen(a: Aufrufer, url: string, kopf: string): { info: Record<string, any> } | { status: number; fehler: string } {
  const r = curl(a, { methode: 'GET', url, kopf });
  if (r.status === 0) return { status: 0, fehler: `Gitea nicht erreichbar (${r.text.slice(0, 160)})` };
  if (r.status < 200 || r.status >= 300) return { status: r.status, fehler: `Gitea antwortete ${r.status}` };
  try {
    return { info: JSON.parse(r.text) as Record<string, any> };
  } catch {
    return { status: r.status, fehler: 'Gitea antwortete unlesbar' };
  }
}

/** Push right and issues of a repository (adding a project by link): gh on GitHub, the Gitea access of `flotte auftrag` on Gitea. */
export async function repoRechte(repo: string, q: { art: 'github' | 'gitea'; forge: string; api: string }, w: { aufrufer: Aufrufer }): Promise<{ push: boolean; issues: boolean } | { fehler: string }> {
  let info: Record<string, any>;
  if (q.art === 'github') {
    const r = w.aufrufer('gh', ['api', `repos/${q.forge}`]);
    if (r.code) return { fehler: 'gh ist am Rechner nicht angemeldet oder sieht das Repository nicht' };
    try {
      info = JSON.parse(r.stdout);
    } catch {
      return { fehler: 'gh antwortete unlesbar' };
    }
  } else {
    try {
      const r = giteaLesen(w.aufrufer, q.api, giteaZugang(adapterVon(repo), repo, w.aufrufer));
      if ('fehler' in r) return { fehler: r.fehler };
      info = r.info;
    } catch (e) {
      return { fehler: (e as Error).message.slice(0, 200) };
    }
  }
  return { push: info?.permissions?.push === true, issues: info?.has_issues !== false };
}

/** The command for the terminal at the machine: gh's own login, or the Gitea token hidden into the Git credential store. */
export function verknuepfenBefehl(repo: string): string {
  const adapter = adapterVon(repo);
  if (schluessel(adapter, 'forge') !== 'gitea') return 'gh auth login --hostname github.com';
  const u = new URL(schluessel(adapter, 'api') ?? giteaRepoAus(adapter));
  return [
    `Write-Host 'Gitea ${u.host}: Benutzer und Token (das Token bleibt auf diesem Rechner, im Git-Credential-Speicher).'`,
    "$u = Read-Host 'Benutzer'",
    "$t = Read-Host -AsSecureString 'Token'",
    '$p = [Net.NetworkCredential]::new(\'\', $t).Password',
    `"protocol=${u.protocol.replace(':', '')}\`nhost=${u.host}\`nusername=$u\`npassword=$p\`n" | git credential approve`,
    'Remove-Variable p, t',
    "Write-Host 'Gespeichert.'",
  ].join('; ');
}

/** Opens the terminal for linking at the machine; synchronous, so a caller sees a failure at once. */
export function verknuepfen(repo: string, w: ForgeWelt): string {
  const b = verknuepfenBefehl(repo);
  (w.terminal ?? ((x: string) => oeffneTerminal(x)))(b);
  return b;
}

export async function forge(argv: string[], w: ForgeWelt = { aufrufer: aufrufen }): Promise<unknown> {
  const [befehl, ordner] = argv;
  const repo = resolve(ordner ?? '.');
  switch (befehl) {
    case 'pruefen':
      return await forgeStatus(repo, w);
    case 'verknuepfen': {
      const b = verknuepfen(repo, w);
      return { geoeffnet: b.startsWith('gh ') ? b : 'Gitea-Abfrage', weiter: 'Im neuen Fenster anmelden; danach zeigt flotte forge pruefen den Stand.' };
    }
    default:
      throw new Error('Aufruf: flotte forge <pruefen|verknuepfen> [<repo>]');
  }
}
