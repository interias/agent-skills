// flotte auftrag <repo> <entwurf.md|-> [--starten] [--trocken]: the order writer (agent-skills/ADR-0002),
// the only way Missionen and Missionsziele come into the forge. Reads the adapter of the target
// repository (.claude/epic.md in its checkout), checks the draft, creates it through the forge
// layer (src/auftrag/) and prints the links. --trocken prints what would be created. `-` reads the
// draft from stdin: `flotte chat` passes the draft the bridge sent with "anlegen" (#84).

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { auftragAusfuehren, type AuftragsRegeln } from '../auftrag/auftrag.ts';
import { giteaForge } from '../auftrag/gitea.ts';
import { githubForge } from '../auftrag/github.ts';
import { forgeAus } from '../treiber/treiber.ts';
import { liesAdapter } from '../werkzeuge/belegung.ts';
import { schluessel } from './adapter.ts';

const AUFRUF = 'Aufruf: flotte auftrag <repo> <entwurf.md|-> [--starten] [--trocken]';
const ABNAHME_STANDARD = ['## Abnahmekriterien', '## Akzeptanzkriterien', '## Acceptance criteria'];

/** The issue keys of the adapter with their defaults (mission/references/adapter.md, "Issues", form tickets). */
export function regelnAus(adapterText: string): AuftragsRegeln {
  const a = liesAdapter(adapterText);
  const abnahme = schluessel(adapterText, 'acceptance_section');
  return {
    epic_label: a.epic_label,
    ready_label: a.ready_label,
    acceptance_section: abnahme ? (abnahme.startsWith('[') ? abnahme.slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [abnahme]) : ABNAHME_STANDARD,
    verification_section: schluessel(adapterText, 'verification_section') ?? '## Verifikationsweg',
    modules_section: a.modules_section,
    spec: schluessel(adapterText, 'issue_form') === 'spec',
  };
}

/** owner/name on GitHub: from the adapter key api, else from origin. Gitea goes through giteaRepoAus(). */
export function githubRepoAus(adapterText: string, repo: string, a: Aufrufer): string {
  const art = schluessel(adapterText, 'forge');
  if (art && art !== 'github') throw new Error(`Forge ${art}: flotte auftrag spricht nur GitHub und Gitea.`);
  const api = /api\.github\.com\/repos\/([^/\s]+\/[^/\s]+?)\/?$/.exec(schluessel(adapterText, 'api') ?? '')?.[1];
  if (api) return api;
  const r = a('git', ['-C', repo, 'remote', 'get-url', 'origin']);
  const aus = r.code ? null : forgeAus(r.stdout);
  if (!aus) throw new Error(`Das GitHub-Repository lässt sich weder aus dem Adapter (api) noch aus origin lesen: ${repo}`);
  return aus;
}

/** owner/name from the adapter key api of a Gitea repository (`<host>/api/v1/repos/<owner>/<repo>`). */
export function giteaRepoAus(adapterText: string): string {
  const api = schluessel(adapterText, 'api');
  const aus = /\/api\/v1\/repos\/([^/\s]+\/[^/\s]+?)\/?$/.exec(api ?? '')?.[1];
  if (!aus) throw new Error('Forge gitea: der Adapter braucht `api: <host>/api/v1/repos/<owner>/<repo>`.');
  return aus;
}

/**
 * The Authorization header for Gitea (mission/references/forge.md): the token from the variable token_env
 * (default GITEA_TOKEN) or from the file token_file, else Basic Auth from the Git credential store.
 * Nothing of it is printed.
 */
export function giteaZugang(adapterText: string, repo: string, a: Aufrufer): string {
  const name = schluessel(adapterText, 'token_env') ?? 'GITEA_TOKEN';
  const datei = schluessel(adapterText, 'token_file');
  let token = process.env[name];
  if (!token && datei && existsSync(resolve(repo, datei))) {
    token = new RegExp(`^(?:export\\s+)?${name}=(.*)$`, 'm').exec(readFileSync(resolve(repo, datei), 'utf8'))?.[1].trim().replace(/^['"]|['"]$/g, '');
  }
  if (token) return `token ${token}`;
  const origin = new URL(schluessel(adapterText, 'api')!).origin;
  const r = a('git', ['credential', 'fill'], { eingabe: `url=${origin}\n\n`, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const wert = (k: string) => new RegExp(`^${k}=(.*)$`, 'm').exec(r.stdout)?.[1].replace(/\r$/, '');
  if (r.code || !wert('username') || !wert('password')) throw new Error(`Gitea: weder ${name} noch ein Eintrag im Git-Credential-Speicher für ${origin}.`);
  return `Basic ${Buffer.from(`${wert('username')}:${wert('password')}`).toString('base64')}`;
}

export async function auftrag(argv: string[], a: Aufrufer = aufrufen, stdin: () => string = () => readFileSync(0, 'utf8')): Promise<unknown> {
  const pos = argv.filter((x) => !x.startsWith('--'));
  const unbekannt = argv.filter((x) => x.startsWith('--') && x !== '--starten' && x !== '--trocken');
  if (pos.length !== 2 || unbekannt.length) throw new Error(AUFRUF);
  const repo = resolve(pos[0]);
  const datei = pos[1] === '-' ? null : resolve(pos[1]);
  if (!existsSync(repo)) throw new Error(`Repository fehlt: ${repo}`);
  if (datei && !existsSync(datei)) throw new Error(`Entwurf fehlt: ${datei}`);
  const adapterDatei = join(repo, '.claude', 'epic.md');
  const adapterText = existsSync(adapterDatei) ? readFileSync(adapterDatei, 'utf8') : '';
  const regeln = regelnAus(adapterText);
  const entwurf = datei ? readFileSync(datei, 'utf8') : stdin();
  // also in a dry run: it shows which repository the order would go to; the forge is not called then
  const gitea = schluessel(adapterText, 'forge') === 'gitea';
  const forge = gitea ? giteaRepoAus(adapterText) : githubRepoAus(adapterText, repo, a);
  const schicht = gitea ? giteaForge(schluessel(adapterText, 'api')!, () => giteaZugang(adapterText, repo, a), regeln) : githubForge(a, forge, regeln);
  const ergebnis = await auftragAusfuehren(entwurf, regeln, schicht, { starten: argv.includes('--starten'), trocken: argv.includes('--trocken') });
  return { forge, ...ergebnis };
}
