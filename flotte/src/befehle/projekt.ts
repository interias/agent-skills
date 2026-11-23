// flotte projekt hinzufuegen <ordner> [--autostart] [--konten 1,2] [--bruecke <url>] | entfernen [<ordner>] (#126).
// hinzufuegen checks the folder (exists, root of a Git repository) before it writes anything, then writes only
// two files: the adapter .claude/epic.md from the template of mission/references/adapter.md ("Vorlage"; an
// existing adapter is never overwritten) and the start script ~/.claude/flotte/start/<name>.ps1 (never over an
// existing one), where flottenbruecke/einrichten.ps1 -Autostart looks for it. The forge is only read. With
// --autostart the scheduled task "Flotte <name>" at logon, like einrichten.ps1 step 4, only when it is missing.
// entfernen halts the driver like `flotte anhalten` and deletes nothing.

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { KONTEN_DATEI, kontenTafel, kontoAus, liesKonten } from '../werkzeuge/konten.ts';
import { flotteDir } from '../werkzeuge/zustand.ts';
import { forgeStatus, type ForgeStatus, type ForgeWelt } from './forge.ts';

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
  abruf?: ForgeWelt['abruf'];
}

export interface ProjektErgebnis {
  projekt: string;
  ordner: string;
  adapter: { angelegt: boolean; offen: string[] };
  startskript: { datei: string; angelegt: boolean };
  autostart: Autostart | null;
  forge: { origin: boolean; status: ForgeStatus | null };
  /** for events and the CLI: the folder name only, never a path */
  meldung: string;
  /** for the public fleet logbook: what was created, nothing about the forge */
  logbuch: string;
}

const VORLAGE = fileURLToPath(new URL('../../../mission/references/adapter.md', import.meta.url));
const STANDARD_BRUECKE = 'http://127.0.0.1:4747';
const AUFRUF = 'Aufruf: flotte projekt hinzufuegen <ordner> [--autostart] [--konten 1,2] [--bruecke <url>] | entfernen [<ordner>]';

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

/** The folder must exist and be the root of a Git repository; otherwise a refusal before anything is written. */
function pruefeOrdner(ordner: string, a: Aufrufer): string {
  const abs = resolve(ordner);
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

export async function hinzufuegen(ordner: string, o: { autostart: boolean; konten?: string[]; bruecke?: string }, w: ProjektWelt): Promise<ProjektErgebnis> {
  const abs = pruefeOrdner(ordner, w.aufrufer);
  const name = basename(abs).replace(/[^\w.-]/g, '-');
  const skriptDatei = join(w.heim, '.claude', 'flotte', 'start', `${name}.ps1`);
  // built before anything is written, so a wrong --bruecke or --konten leaves nothing behind
  const skript = startskript({ name, ordner: abs, konten: o.konten ?? standardKonten(w), bruecke: o.bruecke ?? process.env.FLOTTE_BRUECKE ?? STANDARD_BRUECKE });
  const origin = w.aufrufer('git', ['-C', abs, 'remote', 'get-url', 'origin']).code === 0;

  const adapterDatei = join(abs, '.claude', 'epic.md');
  const vorhanden = existsSync(adapterDatei);
  let adapter: string;
  if (vorhanden) adapter = readFileSync(adapterDatei, 'utf8');
  else {
    adapter = adapterVorlage(readFileSync(w.vorlage ?? VORLAGE, 'utf8'));
    mkdirSync(join(abs, '.claude'), { recursive: true });
    writeFileSync(adapterDatei, adapter, { flag: 'wx' });
  }
  let status: ForgeStatus | null = null;
  if (vorhanden && origin) {
    try {
      status = await forgeStatus(abs, { aufrufer: w.aufrufer, abruf: w.abruf });
    } catch {
      status = null;
    }
  }

  const neuesSkript = !existsSync(skriptDatei);
  if (neuesSkript) {
    mkdirSync(join(skriptDatei, '..'), { recursive: true });
    // with a BOM: Windows PowerShell 5.1 reads a script without one in the ANSI code page
    writeFileSync(skriptDatei, `﻿${skript}`, { flag: 'wx' });
  }
  const autostart = o.autostart ? (w.autostart ?? autostartEchtMit(w.aufrufer))(`Flotte ${name}`, skriptDatei) : null;

  const offen = offeneSchluessel(adapter);
  const adapterText = `Adapter ${vorhanden ? 'vorhanden, unverändert' : 'angelegt'}${offen.length ? `, noch auszufüllen: ${offen.join(', ')}` : ''}`;
  const skriptText = `Startskript ${name}.ps1 ${neuesSkript ? 'angelegt' : 'vorhanden, unverändert'}`;
  const autoText = autostart ? `; Autostart ${autostart === 'angelegt' ? 'angelegt' : 'vorhanden'}` : '';
  const forge = { origin, status };
  return {
    projekt: name,
    ordner: abs,
    adapter: { angelegt: !vorhanden, offen },
    startskript: { datei: `~/.claude/flotte/start/${name}.ps1`, angelegt: neuesSkript },
    autostart,
    forge,
    meldung: `Projekt ${name}: ${adapterText}; ${skriptText}${autoText}; Forge: ${forgeText(forge)}`,
    logbuch: `Projekt ${name} hinzugefügt: ${adapterText}; ${skriptText}${autoText}`,
  };
}

/** flotte projekt entfernen: the driver halts like `flotte anhalten`; adapter, start script, state and repository stay. */
export function entfernen(ordner: string, w: Pick<ProjektWelt, 'aufrufer'>): unknown {
  const abs = pruefeOrdner(ordner, w.aufrufer);
  writeFileSync(join(flotteDir(abs, w.aufrufer), 'anhalten'), new Date().toISOString());
  return {
    projekt: basename(abs),
    geloescht: [],
    hinweis: 'Der Treiber hält an wie bei flotte anhalten (nichts Neues, ein offenes Andocken läuft zu Ende). Adapter, Startskript, Zustand und Repository bleiben. Aus der Liste der Brücke nimmt es „Entfernen“ im Maschinenraum; ein neuer Start des Treibers bringt es zurück.',
  };
}

export async function projekt(argv: string[], w: ProjektWelt = { aufrufer: aufrufen, heim: homedir(), kontenDatei: KONTEN_DATEI }): Promise<unknown> {
  const [befehl, ordner, ...rest] = argv;
  switch (befehl) {
    case 'hinzufuegen': {
      if (!ordner || ordner.startsWith('--')) throw new Error(AUFRUF);
      const konten = wert(rest, '--konten')?.split(',').filter(Boolean);
      return await hinzufuegen(ordner, { autostart: rest.includes('--autostart'), konten, bruecke: wert(rest, '--bruecke') }, w);
    }
    case 'entfernen':
      return entfernen(ordner ?? '.', w);
    default:
      throw new Error(AUFRUF);
  }
}
