// flotte pruefen [<ordner>]: what an existing repository lacks to be driven by the fleet as of today, each point with
// the step of /flotte-einrichten that closes it. Only reads: the adapter and the agent notes from origin/HEAD (else
// the working copy), rights, labels and the last merged pull requests from the forge, the scheduled task of the night
// run, the start script of the bridge. Writes nothing, fetches nothing, creates no label. Also the four steps of setting
// up the machine (account, sign-in, forge, project) as a checklist in the terminal, without a driver (#240): accounts
// from konten.json, the sign-in only by the existence of .credentials.json (never read).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { giteaZugriff } from '../forge/gitea.ts';
import { githubZugriff } from '../forge/github.ts';
import type { ForgeZugriff } from '../forge/zugriff.ts';
import { gateForm, gateLaeufe } from '../treiber/gate.ts';
import { ABGESCHAFFT, liesAdapter } from '../werkzeuge/belegung.ts';
import { schluessel } from './adapter.ts';
import { giteaRepoAus, giteaZugang, githubRepoAus } from './auftrag.ts';
import { repoRechte } from './forge.ts';
import { flottenLabels } from './klonen.ts';
import { kontenTafel, kontoAus, liesKonten } from '../werkzeuge/konten.ts';
import { bekannteProjekte, offeneSchluessel } from './projekt.ts';

export type Stand = 'ok' | 'fehlt' | 'empfohlen' | 'offen';

export interface Punkt {
  bereich: 'adapter' | 'andockpruefung' | 'forge' | 'andockweg' | 'nachtlauf' | 'bruecke';
  punkt: string;
  stand: Stand;
  text: string;
  /** the step of /flotte-einrichten that closes the point; empty when it is ok */
  schritt: string;
}

export interface PruefWelt {
  aufrufer: Aufrufer;
  /** the home folder: ~/.claude/flotte/start holds the start scripts of the bridge, ~/.claude/flotte/konten.json the accounts */
  heim: string;
  /** a line of the checklist for the person at the terminal (stderr; stdout carries the JSON) */
  melde?: (zeile: string) => void;
}

/** One step of setting up, in the order and with the titles of the bridge's checklist "Einrichten". */
export interface EinrichtSchritt {
  schritt: 'konto' | 'anmeldung' | 'forge' | 'projekt';
  stand: 'fertig' | 'offen';
  text: string;
}

const EINRICHT_TITEL: Record<EinrichtSchritt['schritt'], string> = { konto: 'Konto anlegen', anmeldung: 'Am Rechner anmelden', forge: 'Forge verknüpfen', projekt: 'Projekt hinzufügen' };

/** Account and sign-in from konten.json: an active account whose folder exists; signed in when its .credentials.json exists (never read). */
function kontoSchritte(heim: string): EinrichtSchritt[] {
  const datei = join(heim, '.claude', 'flotte', 'konten.json');
  let liste;
  try {
    liste = liesKonten(datei);
  } catch {
    const text = 'konten.json unlesbar: flotte konten liste zeigt den Fehler';
    return [{ schritt: 'konto', stand: 'offen', text }, { schritt: 'anmeldung', stand: 'offen', text }];
  }
  const tafel = kontenTafel(datei);
  const da = liste.filter((k) => k.aktiv && existsSync(kontoAus(k.nr, tafel, heim)));
  const an = da.filter((k) => existsSync(join(kontoAus(k.nr, tafel, heim), '.credentials.json')));
  const namen = (l: typeof liste) => l.map((k) => `Konto ${k.nr}`).join(', ');
  const ohne = da.filter((k) => !an.includes(k));
  return [
    da.length ? { schritt: 'konto', stand: 'fertig', text: `aktiv: ${namen(da)}` } : { schritt: 'konto', stand: 'offen', text: 'kein aktives Konto mit Ordner: flotte konten anlegen' },
    an.length
      ? { schritt: 'anmeldung', stand: 'fertig', text: `angemeldet: ${namen(an)}${ohne.length ? `; nicht angemeldet: ${namen(ohne)}` : ''}` }
      : { schritt: 'anmeldung', stand: 'offen', text: `${da.length ? `nicht angemeldet: ${namen(da)}` : 'kein Konto'}: flotte konten anmelden <nr>, dort /login` },
  ];
}

/** The steps of /flotte-einrichten (flotte-einrichten/SKILL.md, headings "## Schritt <n>: <name>"). */
export const SCHRITTE = { 1: 'Erkennen', 2: 'Andockprüfung', 3: 'Adapter', 4: 'Forge', 5: 'Nachtlauf', 6: 'Probelauf und Anmelden' } as const;
const schritt = (n: keyof typeof SCHRITTE, was: string) => `/flotte-einrichten, Schritt ${n} (${SCHRITTE[n]}): ${was}`;

/** How many merged pull requests are searched for the last proof block. */
export const PRS_GESUCHT = 20;

/** The name of the night run's scheduled task, exactly as nachtlauf-aufgabe.ps1 builds it. */
export function nachtlaufAufgabe(projekt: string): string {
  const voll = resolve(projekt).replace(/\\+$/, '');
  const hash = createHash('sha256').update(voll.toLowerCase(), 'utf8').digest('hex').slice(0, 6);
  return `Flotte Nachtlauf ${basename(voll).replace(/[^A-Za-z0-9_.-]/g, '-')}-${hash}`;
}

/** A file as the default branch on origin has it, else as in the checkout; null when neither has it. */
function lies(repo: string, pfad: string, a: Aufrufer): { text: string; quelle: string } | null {
  const r = a('git', ['-C', repo, 'show', `origin/HEAD:${pfad}`]);
  if (!r.code) return { text: r.stdout, quelle: 'origin/HEAD' };
  const datei = join(repo, ...pfad.split('/'));
  return existsSync(datei) ? { text: readFileSync(datei, 'utf8'), quelle: 'Arbeitskopie' } : null;
}

/** Whether the frontmatter names the key at all (also a map such as test_commands, whose flat value is empty). */
export function hatSchluessel(adapter: string, name: string): boolean {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(adapter);
  return !!m && new RegExp(`^${name}:`, 'm').test(m[1]);
}

function aufgabeDa(name: string, a: Aufrufer): boolean | null {
  const befehl = `if (Get-ScheduledTask -TaskName '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue) { 'da' } else { 'fehlt' }`;
  const r = a('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(befehl, 'utf16le').toString('base64')]);
  const aus = r.stdout.trim().split(/\r?\n/).at(-1);
  return r.code || (aus !== 'da' && aus !== 'fehlt') ? null : aus === 'da';
}

function zugriff(repo: string, adapter: string, a: Aufrufer): { f: ForgeZugriff; q: { art: 'github' | 'gitea'; forge: string; api: string } } {
  if (schluessel(adapter, 'forge') === 'gitea') {
    const api = schluessel(adapter, 'api') ?? '';
    let kopf: string | null = null;
    return { f: giteaZugriff(a, api, () => (kopf ??= giteaZugang(adapter, repo, a)), schluessel(adapter, 'epic_label') ?? 'epic'), q: { art: 'gitea', forge: giteaRepoAus(adapter), api } };
  }
  const forge = githubRepoAus(adapter, repo, a);
  return { f: githubZugriff(a, forge), q: { art: 'github', forge, api: `https://api.github.com/repos/${forge}` } };
}

/** The forge part: rights, labels, the last proof block of a merged pull request. */
async function forgePunkte(repo: string, adapter: string, w: PruefWelt): Promise<Punkt[]> {
  const aus: Punkt[] = [];
  let z: ReturnType<typeof zugriff>;
  try {
    z = zugriff(repo, adapter, w.aufrufer);
  } catch (e) {
    const grund = `Forge nicht lesbar (${(e as Error).message.slice(0, 160)})`;
    const offen = (bereich: Punkt['bereich'], punkt: string, n: keyof typeof SCHRITTE, was: string): Punkt => ({ bereich, punkt, stand: 'offen', text: grund, schritt: schritt(n, was) });
    return [offen('forge', 'rechte', 4, 'Anmeldung und Schreibrecht prüfen'), offen('forge', 'labels', 4, 'Labels anlegen'), offen('andockpruefung', 'nachweisblock', 6, 'Probelauf gegen main')];
  }
  const r = await repoRechte(repo, z.q, w);
  if ('fehler' in r) aus.push({ bereich: 'forge', punkt: 'rechte', stand: 'offen', text: `Rechte nicht geprüft: ${r.fehler}`, schritt: schritt(4, 'Anmeldung und Schreibrecht prüfen') });
  else if (!r.push || !r.issues) aus.push({ bereich: 'forge', punkt: 'rechte', stand: 'fehlt', text: [!r.push && 'kein Schreibrecht für die Anmeldung dieses Rechners', !r.issues && 'Issues sind im Repository abgeschaltet'].filter(Boolean).join('; '), schritt: schritt(4, 'Schreibrecht und Issues freischalten') });
  else aus.push({ bereich: 'forge', punkt: 'rechte', stand: 'ok', text: 'Schreibrecht und Issues da', schritt: '' });

  try {
    const da = new Set(z.f.labelNamen());
    const fehlen = flottenLabels(adapter).map(([n]) => n).filter((n) => !da.has(n));
    aus.push(fehlen.length ? { bereich: 'forge', punkt: 'labels', stand: 'fehlt', text: `Labels fehlen: ${fehlen.join(', ')}`, schritt: schritt(4, 'Labels anlegen') } : { bereich: 'forge', punkt: 'labels', stand: 'ok', text: 'alle Labels der Flotte da', schritt: '' });
  } catch (e) {
    aus.push({ bereich: 'forge', punkt: 'labels', stand: 'offen', text: `Labels nicht gelesen: ${(e as Error).message.slice(0, 160)}`, schritt: schritt(4, 'Labels anlegen') });
  }

  // the proof block: the last merged pull request with a gate section; its last run must name base and head
  try {
    const form = gateForm(liesAdapter(adapter));
    const prs = z.f.prs({ zustand: 'merged', limit: PRS_GESUCHT, felder: ['number', 'body', 'mergedAt'] }).sort((x, y) => (y.gemergtAm ?? '').localeCompare(x.gemergtAm ?? ''));
    // a partial run is never a proof (merge.ps1, treiber/gate.ts)
    const mit = prs.map((p) => ({ p, l: gateLaeufe(p.body, form)?.filter((l) => !l.teil) })).find((x) => x.l?.length);
    const letzt = mit?.l?.at(-1);
    if (!mit || !letzt) aus.push({ bereich: 'andockpruefung', punkt: 'nachweisblock', stand: 'offen', text: `in den letzten ${prs.length} angedockten Pull Requests kein Andockblock unter „${form.heading}“`, schritt: schritt(6, 'Probelauf gegen main zeigt den Block') });
    else if (!letzt.head) aus.push({ bereich: 'andockpruefung', punkt: 'nachweisblock', stand: 'fehlt', text: `der Andockblock in #${mit.p.nummer} nennt die Basis, aber keinen HEAD`, schritt: schritt(2, 'Kopfzeile des Blocks mit Basis und HEAD') });
    else aus.push({ bereich: 'andockpruefung', punkt: 'nachweisblock', stand: 'ok', text: `Andockblock mit Basis und HEAD in #${mit.p.nummer}`, schritt: '' });
  } catch (e) {
    aus.push({ bereich: 'andockpruefung', punkt: 'nachweisblock', stand: 'offen', text: `Pull Requests nicht gelesen: ${(e as Error).message.slice(0, 160)}`, schritt: schritt(6, 'Probelauf gegen main') });
  }
  return aus;
}

export async function pruefeRepo(ordner: string, w: PruefWelt): Promise<unknown> {
  const gegeben = resolve(ordner.trim().replace(/^(["'])(.*)\1$/, '$2'));
  if (!existsSync(gegeben)) throw new Error(`Den Ordner ${basename(gegeben)} gibt es nicht.`);
  const wurzel = w.aufrufer('git', ['-C', gegeben, 'rev-parse', '--show-toplevel']);
  if (wurzel.code) throw new Error(`${basename(gegeben)} ist kein Git-Repository.`);
  // from a subfolder: the repository is its root (task name, start script, adapter of the working copy)
  const repo = resolve(wurzel.stdout.trim());
  const a = w.aufrufer;
  const punkte: Punkt[] = [];
  const p = (bereich: Punkt['bereich'], punkt: string, ok: boolean, gut: string, schlecht: string, s: string, stand: Stand = 'fehlt') => punkte.push(ok ? { bereich, punkt, stand: 'ok', text: gut, schritt: '' } : { bereich, punkt, stand, text: schlecht, schritt: s });

  // adapter
  const neu = lies(repo, '.claude/epic.md', a);
  const alt = neu ? null : lies(repo, '.claude/prd.md', a);
  const adapter = (neu ?? alt)?.text ?? '';
  const quelle = (neu ?? alt)?.quelle ?? null;
  p('adapter', 'adapter', !!neu, `.claude/epic.md (${quelle})`, alt ? 'Adapter unter altem Namen .claude/prd.md' : 'kein Adapter .claude/epic.md', schritt(3, alt ? 'in .claude/epic.md umbenennen' : 'Adapter anlegen und ausfüllen'));
  const kopf = /^---\r?\n[\s\S]*?\r?\n---/.test(adapter);
  if (adapter) p('adapter', 'frontmatter', kopf, 'Frontmatter da', 'kein Frontmatter: Skripte und Treiber lesen nur dort', schritt(3, 'Schlüssel ins Frontmatter'));
  const offen = offeneSchluessel(adapter);
  if (kopf) p('adapter', 'platzhalter', !offen.length, 'kein Wert in <…>', `noch in <…>: ${offen.join(', ')}; der Treiber startet dort keine Mission`, schritt(3, 'Werte eintragen'));
  // each has a standard (origin, package.json / pyproject.toml), but every run derives it again
  for (const [k, woher] of [['forge', 'origin'], ['api', 'origin'], ['test_commands', 'package.json oder pyproject.toml']]) p('adapter', k, hatSchluessel(adapter, k), `${k} gesetzt`, `${k} fehlt: jeder Lauf leitet es selbst aus ${woher} ab`, schritt(3, `${k} eintragen`), 'empfohlen');
  p('adapter', 'exclusive_paths', hatSchluessel(adapter, 'exclusive_paths'), 'exclusive_paths gesetzt', 'exclusive_paths fehlt: nur Lockfiles, Abhängigkeitslisten und Migrationen machen ein Paket exklusiv', schritt(3, 'Pfade nennen, die allein laufen müssen'), 'empfohlen');
  const abgeschafft = ABGESCHAFFT.filter((k) => hatSchluessel(adapter, k));
  if (abgeschafft.length) punkte.push({ bereich: 'adapter', punkt: 'abgeschafft', stand: 'empfohlen', text: `abgeschaffte Schlüssel stehen noch: ${abgeschafft.join(', ')}`, schritt: schritt(3, 'streichen') });

  // the gate contract: a command, its cache stated, its proof block (forge part)
  p('andockpruefung', 'gate_command', hatSchluessel(adapter, 'gate_command') && !offen.includes('gate_command'), 'gate_command gesetzt', 'kein gate_command: der Treiber kann die Andockprüfung nicht selbst fahren', schritt(2, 'Andockprüfung mit Kontexten bauen'));
  p('andockpruefung', 'gate_cached', hatSchluessel(adapter, 'gate_cached'), 'gate_cached gesetzt', 'kein gate_cached: unveränderte Eingaben kommen nicht nachweisbar aus dem Cache', schritt(2, 'Cache je Kontext und seine Zeile im Block'));

  // the way onto main
  const merge = schluessel(adapter, 'merge');
  p('andockweg', 'merge', merge === 'nach_gate', 'merge: nach_gate (angedockt wird nur mit merge.ps1)', `merge: ${merge ?? 'fehlt (gilt als mensch)'}: nur ein Mensch dockt an`, schritt(4, 'merge: nach_gate und merge.ps1 als einziger Weg'));
  const notizen = ['AGENTS.md', 'CLAUDE.md'].map((d) => lies(repo, d, a)?.text ?? '').join('\n');
  p('andockweg', 'notiz', /merge\.ps1/.test(notizen), 'AGENTS.md oder CLAUDE.md nennt merge.ps1', 'AGENTS.md und CLAUDE.md nennen merge.ps1 nicht: eine Sitzung dort weiß nicht, dass nur dieser Weg andockt', schritt(4, 'Zeile in AGENTS.md'), 'empfohlen');

  punkte.push(...(await forgePunkte(repo, adapter, w)));

  // night run
  p('nachtlauf', 'gate_night_command', hatSchluessel(adapter, 'gate_night_command'), 'gate_night_command gesetzt', 'kein gate_night_command: kein Nachtlauf', schritt(5, 'Nachtbefehl eintragen'));
  const aufgabe = nachtlaufAufgabe(repo);
  const da = aufgabeDa(aufgabe, a);
  if (da === null) punkte.push({ bereich: 'nachtlauf', punkt: 'aufgabe', stand: 'offen', text: `die Aufgabenplanung antwortete nicht (${aufgabe})`, schritt: schritt(5, 'geplante Aufgabe einrichten') });
  else p('nachtlauf', 'aufgabe', da, `geplante Aufgabe ${aufgabe} da`, `keine geplante Aufgabe ${aufgabe}`, schritt(5, 'geplante Aufgabe einrichten'));

  const angemeldet = bekannteProjekte({ heim: w.heim }).some((o) => resolve(o).toLowerCase() === repo.toLowerCase());
  // a driver started by hand reports to the bridge as well; only "Projekt hinzufügen" leaves a start script behind
  p('bruecke', 'startskript', angemeldet, 'über „Projekt hinzufügen“ angemeldet (Startskript da)', 'kein Startskript von „Projekt hinzufügen“: der Treiber startet nur von Hand, nicht von der Brücke oder beim Anmelden', schritt(6, 'Projekt hinzufügen'), 'empfohlen');

  const rechte = punkte.find((x) => x.punkt === 'rechte')!;
  const skript = punkte.find((x) => x.punkt === 'startskript')!;
  const schritte: EinrichtSchritt[] = [
    ...kontoSchritte(w.heim),
    rechte.stand === 'ok' ? { schritt: 'forge', stand: 'fertig', text: rechte.text } : { schritt: 'forge', stand: 'offen', text: `${rechte.text}: ${/Issues sind/.test(rechte.text) ? 'Issues in den Einstellungen des Repositorys einschalten' : 'flotte forge verknuepfen <repo>'}` },
    skript.stand === 'ok' ? { schritt: 'projekt', stand: 'fertig', text: 'Startskript da' } : { schritt: 'projekt', stand: 'offen', text: 'kein Startskript: flotte projekt hinzufuegen <ordner> [--autostart]' },
  ];
  w.melde?.([`Einrichten (${basename(repo)}):`, ...schritte.map((x) => `  [${x.stand === 'fertig' ? 'x' : ' '}] ${EINRICHT_TITEL[x.schritt]} — ${x.text}`)].join('\n'));

  const zahl = (s: Stand) => punkte.filter((x) => x.stand === s).length;
  const fehlt = punkte.filter((x) => x.stand === 'fehlt');
  const naechster = [...fehlt, ...punkte.filter((x) => x.stand === 'offen')].map((x) => x.schritt).sort()[0];
  return {
    projekt: basename(repo),
    adapterQuelle: quelle,
    punkte,
    einrichten: { schritte, fertig: schritte.every((x) => x.stand === 'fertig') },
    fehlt: fehlt.length,
    empfohlen: zahl('empfohlen'),
    offen: zahl('offen'),
    folge: fehlt.length
      ? `${basename(repo)}: ${fehlt.length} Punkt(e) fehlen (${fehlt.map((x) => x.punkt).join(', ')}); als Nächstes ${naechster}`
      : `${basename(repo)}: nichts fehlt${zahl('offen') ? `; ${zahl('offen')} Punkt(e) ungeprüft, als Nächstes ${naechster}` : ''}${zahl('empfohlen') ? `; ${zahl('empfohlen')} Empfehlung(en)` : ''}`,
  };
}

export async function pruefen(argv: string[], w: PruefWelt = { aufrufer: aufrufen, heim: homedir(), melde: (z) => process.stderr.write(`${z}\n`) }): Promise<unknown> {
  if (argv.length > 1 || argv.some((x) => x.startsWith('--'))) throw new Error('Aufruf: flotte pruefen [<ordner>]');
  return pruefeRepo(argv[0] ?? '.', w);
}
