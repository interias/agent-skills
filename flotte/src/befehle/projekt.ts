// flotte projekt hinzufuegen <ordner> [--autostart] [--konten 1,2] [--bruecke <url>] | entfernen [<ordner>] (#126).
// With --klonen <url> the folder may be left out (proposed from the link) and is cloned first when it is
// missing; an existing one must have the link as origin (src/befehle/klonen.ts).
// hinzufuegen checks the folder (exists, root of a Git repository) before it writes anything, then writes only
// two files: the adapter .claude/epic.md from the template of mission/references/adapter.md ("Vorlage"; an
// existing adapter is never overwritten) and the start script ~/.claude/flotte/start/<name>.ps1 (never over an
// existing one), where flottenbruecke/einrichten.ps1 -Autostart looks for it. The forge is only read. With
// --autostart the scheduled task "Flotte <name>" at logon, like einrichten.ps1 step 4, only when it is missing.
// entfernen halts the driver like `flotte anhalten` and deletes nothing.

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aufrufen, type AsyncAufrufer, type Aufrufer } from '../aufruf.ts';
import { KONTEN_DATEI, kontenTafel, kontoAus, liesKonten } from '../werkzeuge/konten.ts';
import { flotteDir } from '../werkzeuge/zustand.ts';
import { forgeStatus, type ForgeStatus } from './forge.ts';
import { einrichtenUmschau, giteaHerkuenfte, klonen, ordnerVorschlag, originPasst, pruefeQuelle, type Quelle, vorlageMitQuelle, type Zugang, zugangPruefen, zugangText } from './klonen.ts';

export type Autostart = 'angelegt' | 'vorhanden';

export interface ProjektWelt {
  aufrufer: Aufrufer;
  /** the home folder: ~/.claude/flotte/start holds the start scripts */
  heim: string;
  /** konten.json: the active accounts with a folder are the standard of --konten */
  kontenDatei: string;
  /** mission/references/adapter.md; default the one next to this skill */
  vorlage?: string;
  /** the scheduled task at logon, only when missing; default the real one (tests never register one) */
  autostart?: (aufgabe: string, skript: string) => Autostart;
  /** the clone (--klonen); default the real git */
  aufrufAsync?: AsyncAufrufer;
  /** test hatch only: the local source the clone really reads (src/befehle/klonen.ts) */
  quelleUmleiten?: (url: string) => string;
  /** the repository of the driver that adds: counts among the projects already there */
  eigenesRepo?: string;
}

export interface ProjektErgebnis {
  projekt: string;
  ordner: string;
  /** alterName: the adapter stands as .claude/prd.md (mission/references/adapter.md, "Alter Name") */
  adapter: { angelegt: boolean; offen: string[]; alterName?: true };
  startskript: { datei: string; angelegt: boolean };
  /** fehlgeschlagen: the files are written, the scheduled task is not; autostartGrund says why */
  autostart: Autostart | 'fehlgeschlagen' | null;
  autostartGrund?: string;
  forge: { origin: boolean; status: ForgeStatus | null };
  /** --klonen: the repository of the link, whether it was cloned (or the folder was there), rights and labels, what setting up needs */
  klon?: { quelle: string; geklont: boolean; zugang: Zugang; einrichten: string[] };
  /** for events and the CLI: the folder name only, never a path */
  meldung: string;
  /** for the public fleet logbook: what was created, nothing about the forge */
  logbuch: string;
}

const VORLAGE = fileURLToPath(new URL('../../../mission/references/adapter.md', import.meta.url));
const STANDARD_BRUECKE = 'http://127.0.0.1:4747';
const AUFRUF = 'Aufruf: flotte projekt hinzufuegen <ordner> [--autostart] [--konten 1,2] [--bruecke <url>] | hinzufuegen [<ordner>] --klonen <https-Link> [--autostart] … | entfernen [<ordner>]';

const wert = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** The block of the section "Vorlage" in mission/references/adapter.md: the one template of a new adapter. */
export function adapterVorlage(adapterMd: string): string {
  const m = /^## Vorlage\r?\n[\s\S]*?```markdown\r?\n([\s\S]*?)\r?\n```/m.exec(adapterMd);
  if (!m) throw new Error('Die Vorlage des Adapters fehlt (mission/references/adapter.md, Abschnitt „Vorlage“).');
  return `${m[1].replace(/\r\n/g, '\n')}\n`;
}

/** The keys of the frontmatter whose value, or an entry of whose map, still stands in <…>. */
export function offeneSchluessel(adapter: string): string[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(adapter);
  if (!m) return [];
  const offen: string[] = [];
  let oben = '';
  for (const z of m[1].split(/\r?\n/)) {
    const flach = /^([A-Za-z_]\w*):\s*(.*)$/.exec(z);
    if (flach) oben = flach[1];
    const platzhalter = flach ? /<[^>]*>/.test(flach[2]) : /^\s+\S/.test(z) && /<[^>]*>/.test(z);
    if (platzhalter && oben && !offen.includes(oben)) offen.push(oben);
  }
  return offen;
}

const inAnfuehrung = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The start script of a driver: window title, the repository folder, `flotte fahren --dauerhaft` with the bridge. */
export function startskript(o: { name: string; ordner: string; konten: string[]; bruecke: string }): string {
  if (!/^https?:\/\/[\w.:\-[\]/]+$/.test(o.bruecke)) throw new Error(`--bruecke ${o.bruecke}: eine URL wie ${STANDARD_BRUECKE}`);
  if (!o.konten.length || o.konten.some((k) => !/^[\w.-]+$/.test(k))) throw new Error(`--konten ${o.konten.join(',')}: Kontonummern oder Ordnernamen, mit Komma getrennt`);
  return [
    `# Flotte ${o.name}: written by \`flotte projekt hinzufuegen\` (#126); the scheduled task "Flotte ${o.name}" runs it at logon.`,
    `try { $Host.UI.RawUI.WindowTitle = ${inAnfuehrung(`Flotte ${o.name}`)} } catch { }`,
    `Set-Location -LiteralPath ${inAnfuehrung(o.ordner)}`,
    `bun "$HOME\\.claude\\skills\\flotte\\src\\cli.ts" fahren --konten ${inAnfuehrung(o.konten.join(','))} --dauerhaft --bruecke ${o.bruecke}`,
    '',
  ].join('\r\n');
}

/** The scheduled task "Flotte <name>" at logon for the signed-in user, as einrichten.ps1 step 4 does it; only when missing. */
export function autostartEchtMit(aufrufer: Aufrufer): (aufgabe: string, skript: string) => Autostart {
  return (aufgabe, skript) => {
    const befehl = [
      `$n = ${inAnfuehrung(aufgabe)}`,
      "if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) { 'vorhanden'; exit 0 }",
      `$a = New-ScheduledTaskAction -Execute 'pwsh' -Argument ${inAnfuehrung(`-NoProfile -File "${skript}"`)} -WorkingDirectory ${inAnfuehrung(join(skript, '..'))}`,
      'Register-ScheduledTask -TaskName $n -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Action $a -User $env:USERNAME | Out-Null',
      "'angelegt'",
    ].join('; ');
    const r = aufrufer('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(befehl, 'utf16le').toString('base64')]);
    const aus = r.stdout.trim().split(/\r?\n/).at(-1);
    if (r.code || (aus !== 'angelegt' && aus !== 'vorhanden')) throw new Error(`Die geplante Aufgabe ${aufgabe} ließ sich nicht anlegen: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    return aus;
  };
}

const gleicherOrdner = (a: string, b: string) => {
  const echt = (p: string) => {
    try {
      return realpathSync.native(p);
    } catch {
      return resolve(p);
    }
  };
  return echt(a).toLowerCase() === echt(b).toLowerCase();
};

/** A path copied with "Copy as path" comes in quotes; they go. */
const ohneAnfuehrung = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, '$2').trim();

/** The folder an existing start script changes to (Set-Location), or null when it names none. */
export function skriptOrdner(text: string): string | null {
  const m = /Set-Location\s+(?:-(?:Literal)?Path\s+)?(?:'((?:[^']|'')*)'|"([^"]*)"|([^\s;]+))/i.exec(text);
  if (!m) return null;
  return m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] ?? m[3]);
}

/** The folder must exist and be the root of a Git repository; otherwise a refusal before anything is written. */
function pruefeOrdner(ordner: string, a: Aufrufer): string {
  const abs = resolve(ohneAnfuehrung(ordner));
  const name = basename(abs);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`Den Ordner ${name} gibt es nicht; nichts geschrieben.`);
  const r = a('git', ['-C', abs, 'rev-parse', '--show-toplevel']);
  if (r.code) throw new Error(`${name} ist kein Git-Repository (dort git init oder einen Klon nehmen); nichts geschrieben.`);
  const wurzel = r.stdout.trim();
  if (!gleicherOrdner(wurzel, abs)) throw new Error(`${name} liegt in einem Git-Repository, ist aber nicht seine Wurzel (${basename(wurzel)}); nichts geschrieben.`);
  return abs;
}

function standardKonten(w: ProjektWelt): string[] {
  const tafel = kontenTafel(w.kontenDatei);
  const da = liesKonten(w.kontenDatei).filter((k) => k.aktiv && existsSync(kontoAus(k.nr, tafel, w.heim))).map((k) => k.nr);
  return da.length ? da : ['1'];
}

function forgeText(f: ProjektErgebnis['forge']): string {
  if (!f.origin) return 'kein origin';
  const s = f.status;
  if (!s) return 'origin vorhanden';
  return `${s.art} ${s.forge}, ${s.angemeldet ? `angemeldet${s.konto ? ` als ${s.konto}` : ''}, ${s.rechte === 'ok' ? 'mit' : 'ohne'} Schreibrecht` : 'nicht angemeldet'}`;
}

/** The folders of the projects of this machine: those of the start scripts, and the driver's own. */
export function bekannteProjekte(w: Pick<ProjektWelt, 'heim' | 'eigenesRepo'>): string[] {
  const dir = join(w.heim, '.claude', 'flotte', 'start');
  const aus = w.eigenesRepo ? [resolve(w.eigenesRepo)] : [];
  let dateien: string[] = [];
  try {
    dateien = readdirSync(dir).filter((d) => d.toLowerCase().endsWith('.ps1'));
  } catch {
    /* none yet */
  }
  for (const d of dateien) {
    try {
      const o = skriptOrdner(readFileSync(join(dir, d), 'utf8'));
      if (o && !aus.some((a) => gleicherOrdner(a, o))) aus.push(o);
    } catch {
      /* unreadable */
    }
  }
  return aus;
}

/** What the bridge needs for the field "Link zum Repository": the Gitea forges allowed besides github.com, the folder new clones go to. */
export function klonAngebot(w: Pick<ProjektWelt, 'heim' | 'eigenesRepo'>): { gitea: string[]; eltern: string } {
  const p = bekannteProjekte(w);
  const eltern = dirname(ordnerVorschlag('x', p, w.heim));
  // the bridge never sees the user's name: the home folder goes as ~, the driver expands it again
  return { gitea: giteaHerkuenfte(p), eltern: gleicherOrdner(eltern, w.heim) || eltern.toLowerCase().startsWith(`${w.heim.toLowerCase()}${sep}`) ? `~${eltern.slice(w.heim.length)}` : eltern };
}

/** --klonen: the folder of the link is cloned when it is missing; an existing one must have the link as origin. */
async function bereitstellen(q: Quelle, abs: string, w: ProjektWelt, vorher: () => void): Promise<boolean> {
  if (existsSync(abs)) {
    pruefeOrdner(abs, w.aufrufer);
    const r = w.aufrufer('git', ['-C', abs, 'remote', 'get-url', 'origin']);
    if (r.code) throw new Error(`Den Ordner ${basename(abs)} gibt es schon, aber ohne origin; nicht geklont, nichts geschrieben.`);
    if (!originPasst(r.stdout, q)) throw new Error(`Den Ordner ${basename(abs)} gibt es schon, sein origin zeigt auf ein anderes Repository als ${q.forge}; nicht geklont, nichts geschrieben. Einen anderen Ordner angeben.`);
    return false;
  }
  vorher();
  await klonen(q, abs, w);
  return true;
}

export async function hinzufuegen(ordner: string | null, o: { autostart: boolean; konten?: string[]; bruecke?: string; klonen?: string }, w: ProjektWelt): Promise<ProjektErgebnis> {
  const projekte = o.klonen ? bekannteProjekte(w) : [];
  const quelle = o.klonen ? pruefeQuelle(o.klonen, giteaHerkuenfte(projekte)) : null;
  const gegeben = ordner?.trim() ? ohneAnfuehrung(ordner) : '';
  // ~ for the home folder: the bridge proposes clone folders that way (klonAngebot)
  const ohne = /^~([\\/]|$)/.test(gegeben) ? join(w.heim, gegeben.slice(1)) : gegeben || (quelle ? ordnerVorschlag(quelle.name, projekte, w.heim) : '');
  if (!isAbsolute(ohne) || !/^([A-Za-z]:[\\/]|[\\/])/.test(ohne)) throw new Error('Der Ordner muss ein absoluter Pfad sein (etwa C:\\repos\\projekt); nichts geschrieben.');
  const name = basename(resolve(ohne)).replace(/[^\w.-]/g, '-');
  const skriptDatei = join(w.heim, '.claude', 'flotte', 'start', `${name}.ps1`);
  // an existing start script for another folder: refused before anything is written (and before a clone)
  const fremd = () => {
    const ziel = existsSync(skriptDatei) ? skriptOrdner(readFileSync(skriptDatei, 'utf8')) : null;
    if (ziel !== null && !gleicherOrdner(ziel, resolve(ohne))) throw new Error(`Das Startskript ${name}.ps1 gibt es schon für einen anderen Ordner (${basename(ziel)} in ${basename(join(ziel, '..'))}); nichts geschrieben. Das Skript wegräumen oder umbenennen, dann noch einmal.`);
  };
  // built before anything is written, so a wrong --bruecke or --konten leaves nothing behind
  const skript = startskript({ name, ordner: resolve(ohne), konten: o.konten ?? standardKonten(w), bruecke: o.bruecke ?? process.env.FLOTTE_BRUECKE ?? STANDARD_BRUECKE });
  const geklont = quelle ? await bereitstellen(quelle, resolve(ohne), w, fremd) : false;
  const abs = pruefeOrdner(ohne, w.aufrufer);
  fremd();
  const neuesSkript = !existsSync(skriptDatei);
  const origin = w.aufrufer('git', ['-C', abs, 'remote', 'get-url', 'origin']).code === 0;

  const adapterDatei = join(abs, '.claude', 'epic.md');
  const altDatei = join(abs, '.claude', 'prd.md');
  const alterName = !existsSync(adapterDatei) && existsSync(altDatei);
  const vorhanden = existsSync(adapterDatei) || alterName;
  let adapter: string;
  if (vorhanden) adapter = readFileSync(alterName ? altDatei : adapterDatei, 'utf8');
  else {
    adapter = adapterVorlage(readFileSync(w.vorlage ?? VORLAGE, 'utf8'));
    // what the link tells: forge and api
    if (quelle) adapter = vorlageMitQuelle(adapter, quelle);
    mkdirSync(join(abs, '.claude'), { recursive: true });
    writeFileSync(adapterDatei, adapter, { flag: 'wx' });
  }
  let status: ForgeStatus | null = null;
  if (vorhanden && origin) {
    try {
      status = await forgeStatus(abs, { aufrufer: w.aufrufer });
    } catch {
      status = null;
    }
  }

  if (neuesSkript) {
    mkdirSync(join(skriptDatei, '..'), { recursive: true });
    // with a BOM: Windows PowerShell 5.1 reads a script without one in the ANSI code page
    writeFileSync(skriptDatei, `\uFEFF${skript}`, { flag: 'wx' });
  }
  let autostart: ProjektErgebnis['autostart'] = null;
  let autostartGrund: string | undefined;
  if (o.autostart) {
    try {
      autostart = (w.autostart ?? autostartEchtMit(w.aufrufer))(`Flotte ${name}`, skriptDatei);
    } catch (e) {
      autostart = 'fehlgeschlagen';
      autostartGrund = (e as Error).message.slice(0, 300);
    }
  }

  let klon: ProjektErgebnis['klon'];
  if (quelle) klon = { quelle: quelle.forge, geklont, zugang: await zugangPruefen(abs, quelle, w), einrichten: einrichtenUmschau(abs) };
  const offen = offeneSchluessel(adapter);
  const adapterText = `Adapter ${alterName ? 'unter altem Namen .claude/prd.md, umbenennen in .claude/epic.md' : vorhanden ? 'vorhanden, unverändert' : 'angelegt'}${offen.length ? `, noch auszufüllen: ${offen.join(', ')}` : ''}`;
  const skriptText = `Startskript ${name}.ps1 ${neuesSkript ? 'angelegt' : 'vorhanden, unverändert'}`;
  const autoText = autostart ? `; Autostart ${autostart}` : '';
  const forge = { origin, status };
  const klonText = klon ? `${klon.geklont ? `geklont aus ${klon.quelle}` : `Ordner schon da, origin passt zu ${klon.quelle}`}; ` : '';
  const klonRest = klon ? `; ${zugangText(klon.zugang)}; Einrichten: ${klon.einrichten.length ? `gefunden ${klon.einrichten.join(', ')}; nichts davon ausgeführt` : 'nichts gefunden'}` : '';
  return {
    projekt: name,
    ordner: abs,
    adapter: { angelegt: !vorhanden, offen, ...(alterName ? { alterName: true as const } : {}) },
    startskript: { datei: `~/.claude/flotte/start/${name}.ps1`, angelegt: neuesSkript },
    autostart,
    ...(autostartGrund ? { autostartGrund } : {}),
    forge,
    ...(klon ? { klon } : {}),
    // the reason only here (the bridge and the CLI), not in the public logbook
    meldung: `Projekt ${name}: ${klonText}${adapterText}; ${skriptText}${autoText}${autostartGrund ? `: ${autostartGrund}` : ''}; Forge: ${forgeText(forge)}${klonRest}`,
    logbuch: `Projekt ${name} hinzugefügt: ${klon?.geklont ? 'geklont; ' : ''}${adapterText}; ${skriptText}${autoText}`,
  };
}

/** flotte projekt entfernen: the driver halts like `flotte anhalten`; adapter, start script, state and repository stay. */
export function entfernen(ordner: string, w: Pick<ProjektWelt, 'aufrufer'>): unknown {
  const abs = pruefeOrdner(ordner, w.aufrufer);
  writeFileSync(join(flotteDir(abs, w.aufrufer), 'anhalten'), new Date().toISOString());
  return {
    projekt: basename(abs),
    geloescht: [],
    hinweis: 'Der Treiber hält an wie bei flotte anhalten (nichts Neues, ein offenes Andocken läuft zu Ende). Adapter, Startskript, Zustand und Repository bleiben. Aus der Liste der Brücke nimmt es „Entfernen“ im Maschinenraum; ein neuer Start des Treibers bringt es zurück. Eine geplante Aufgabe „Flotte <name>“ (Autostart) startet ihn bei jeder Anmeldung wieder: in der Aufgabenplanung deaktivieren oder löschen, wenn das Projekt wegbleiben soll.',
  };
}

export async function projekt(argv: string[], w: ProjektWelt = { aufrufer: aufrufen, heim: homedir(), kontenDatei: KONTEN_DATEI }): Promise<unknown> {
  const [befehl, ordner, ...rest] = argv;
  switch (befehl) {
    case 'hinzufuegen': {
      const flags = argv.slice(1);
      const link = wert(flags, '--klonen');
      // the folder is the one word that is neither a switch nor its value, before or after the switches
      const pfade = flags.filter((x, i) => !x.startsWith('--') && !['--konten', '--bruecke', '--klonen'].includes(flags[i - 1]));
      if (pfade.length > 1 || (!pfade.length && !link) || (flags.includes('--klonen') && !link?.trim())) throw new Error(AUFRUF);
      const konten = wert(flags, '--konten')?.split(',').filter(Boolean);
      return await hinzufuegen(pfade[0] ?? null, { autostart: flags.includes('--autostart'), konten, bruecke: wert(flags, '--bruecke'), klonen: link }, w);
    }
    case 'entfernen':
      return entfernen(ordner ?? '.', w);
    default:
      throw new Error(AUFRUF);
  }
}
