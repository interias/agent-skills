// flotte auftrag <repo> <entwurf.md> [--starten] [--trocken]: the order writer (agent-skills/ADR-0002),
// the only way Missionen and Missionsziele come into the forge. Reads the adapter of the target
// repository (.claude/epic.md in its checkout), checks the draft, creates it through the forge
// layer (src/auftrag/) and prints the links. --trocken prints what would be created.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { auftragAusfuehren, type AuftragsRegeln } from '../auftrag/auftrag.ts';
import { githubForge } from '../auftrag/github.ts';
import { forgeAus } from '../treiber/treiber.ts';
import { liesAdapter } from '../werkzeuge/belegung.ts';
import { schluessel } from './adapter.ts';

const AUFRUF = 'Aufruf: flotte auftrag <repo> <entwurf.md> [--starten] [--trocken]';
const ABNAHME_STANDARD = ['## Abnahmekriterien', '## Akzeptanzkriterien', '## Acceptance criteria'];

/** The issue keys of the adapter with their defaults (epic/references/adapter.md, "Issues", form tickets). */
export function regelnAus(adapterText: string): AuftragsRegeln {
  const a = liesAdapter(adapterText);
  const abnahme = schluessel(adapterText, 'acceptance_section');
  return {
    epic_label: a.epic_label,
    ready_label: a.ready_label,
    acceptance_section: abnahme ? (abnahme.startsWith('[') ? abnahme.slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [abnahme]) : ABNAHME_STANDARD,
    verification_section: schluessel(adapterText, 'verification_section') ?? '## Verifikationsweg',
    modules_section: a.modules_section,
  };
}

/** owner/name on GitHub: from the adapter key api, else from origin. Any other forge is not built yet. */
export function githubRepoAus(adapterText: string, repo: string, a: Aufrufer): string {
  const art = schluessel(adapterText, 'forge');
  if (art && art !== 'github') throw new Error(`Forge ${art}: flotte auftrag spricht bisher nur GitHub.`);
  const api = /api\.github\.com\/repos\/([^/\s]+\/[^/\s]+?)\/?$/.exec(schluessel(adapterText, 'api') ?? '')?.[1];
  if (api) return api;
  const r = a('git', ['-C', repo, 'remote', 'get-url', 'origin']);
  const aus = r.code ? null : forgeAus(r.stdout);
  if (!aus) throw new Error(`Das GitHub-Repository lässt sich weder aus dem Adapter (api) noch aus origin lesen: ${repo}`);
  return aus;
}

export async function auftrag(argv: string[], a: Aufrufer = aufrufen): Promise<unknown> {
  const pos = argv.filter((x) => !x.startsWith('--'));
  const unbekannt = argv.filter((x) => x.startsWith('--') && x !== '--starten' && x !== '--trocken');
  if (pos.length !== 2 || unbekannt.length) throw new Error(AUFRUF);
  const repo = resolve(pos[0]);
  const datei = resolve(pos[1]);
  if (!existsSync(repo)) throw new Error(`Repository fehlt: ${repo}`);
  if (!existsSync(datei)) throw new Error(`Entwurf fehlt: ${datei}`);
  const adapterDatei = join(repo, '.claude', 'epic.md');
  const adapterText = existsSync(adapterDatei) ? readFileSync(adapterDatei, 'utf8') : '';
  const regeln = regelnAus(adapterText);
  const entwurf = readFileSync(datei, 'utf8');
  // also in a dry run: it shows which repository the order would go to; the forge is not called then
  const forge = githubRepoAus(adapterText, repo, a);
  const ergebnis = await auftragAusfuehren(entwurf, regeln, githubForge(a, forge), { starten: argv.includes('--starten'), trocken: argv.includes('--trocken') });
  return { forge, ...ergebnis };
}
