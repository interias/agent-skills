// flotte konten liste|anlegen|deaktivieren|aktivieren|anmelden|pruefen (#94, #95). Works on konten.json only:
// anlegen creates the folder ~/.claude-arbeitspferd-<n> and never one that exists, deaktivieren never
// deletes a folder. The sign-in stays with the person at the machine (`claude`, `/login`); pruefen only
// looks whether .credentials.json exists, never reads it, and asks Haiku once with CLAUDE_CONFIG_DIR.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { KONTEN_DATEI, kontoAus, kontenTafel, liesKonten, schreibeKonten, type Konto } from '../werkzeuge/konten.ts';

export type Anmeldung = 'angemeldet' | 'nicht angemeldet' | 'ordner fehlt' | 'unklar';

export interface KontenWelt {
  datei: string;
  heim: string;
  aufrufer: Aufrufer;
  claude?: string;
  /** konto_anmelden / `anmelden`: a terminal at the machine with `claude` on this account; default the real one */
  terminal?: (dir: string) => void;
}

const UNTERBEFEHLE = 'liste|anlegen|deaktivieren|aktivieren|anmelden|pruefen';
// the same narrow evidence the driver uses for a run that stopped at the sign-in (lauf.ts)
const ABGELEHNT = /Failed to authenticate|OAuth (token|session) (has )?expired|not logged in|Please run \/login|Invalid API key|authentication_error/i;

const wert = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** The sign-in of one account: the credentials file only by its existence, then one short Haiku call (`aufruf`; the driver goes without, #94 decision 3). */
export function anmeldung(k: Konto, w: KontenWelt, aufruf = true): Anmeldung {
  const dir = kontoAus(k.nr, kontenTafel(w.datei), w.heim);
  if (!existsSync(dir)) return 'ordner fehlt';
  if (!existsSync(join(dir, '.credentials.json'))) return 'nicht angemeldet';
  if (!aufruf) return 'angemeldet';
  const r = w.aufrufer(w.claude ?? process.env.FLOTTE_CLAUDE ?? 'claude', ['-p', '--model', 'haiku', 'Antworte nur mit ok.'], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir } });
  if (r.code === 0) return 'angemeldet';
  return ABGELEHNT.test(`${r.stdout} ${r.stderr}`) ? 'nicht angemeldet' : 'unklar';
}

/** A new window at the machine with `claude` on the account, for its /login; nothing of it goes through the bridge (#95). */
export function terminalMitClaude(dir: string): void {
  if (process.platform !== 'win32') throw new Error('Ein Terminal öffnen kann flotte nur unter Windows; am Rechner: CLAUDE_CONFIG_DIR setzen, claude starten, /login.');
  spawn('pwsh', ['-NoProfile', '-Command', "Start-Process pwsh -ArgumentList '-NoExit', '-Command', 'claude'"], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function finde(liste: Konto[], nr: string | undefined): Konto {
  const k = liste.find((x) => x.nr === nr);
  if (!k) throw new Error(`Konto ${nr ?? '(keins)'} ist nicht bekannt (Nummern: ${liste.map((x) => x.nr).join(', ')})`);
  return k;
}

export function konten(argv: string[], w: KontenWelt = { datei: KONTEN_DATEI, heim: homedir(), aufrufer: aufrufen }): unknown {
  const [befehl, ...rest] = argv;
  const liste = liesKonten(w.datei);
  switch (befehl) {
    case 'liste':
      return { datei: w.datei, konten: liste.map((k) => ({ ...k, vorhanden: existsSync(kontoAus(k.nr, kontenTafel(w.datei), w.heim)) })) };
    case 'anlegen': {
      const nr = String(Math.max(0, ...liste.map((k) => Number(k.nr)).filter(Number.isFinite)) + 1);
      const ordner = `~/.claude-arbeitspferd-${nr}`;
      const dir = join(w.heim, `.claude-arbeitspferd-${nr}`);
      if (existsSync(dir)) throw new Error(`Den Ordner ${dir} gibt es schon; anlegen nimmt nie einen vorhandenen Ordner. Ihn in ${w.datei} eintragen oder wegräumen.`);
      const konto: Konto = { nr, ordner, name: wert(rest, '--name') ?? `Arbeitspferd ${nr}`, farbe: wert(rest, '--farbe') ?? '#D97757', aktiv: true };
      mkdirSync(dir);
      schreibeKonten([...liste, konto], w.datei);
      return { angelegt: konto, weiter: `Am Rechner: arbeitspferd/einrichten.ps1 -Konfig ${ordner}, dann das Profil öffnen, claude starten und /login.` };
    }
    case 'deaktivieren':
    case 'aktivieren': {
      const k = finde(liste, rest[0]);
      k.aktiv = befehl === 'aktivieren';
      schreibeKonten(liste, w.datei);
      return { konto: k };
    }
    case 'anmelden': {
      const k = finde(liste, rest[0]);
      (w.terminal ?? terminalMitClaude)(kontoAus(k.nr, kontenTafel(w.datei), w.heim));
      return { konto: k, weiter: 'Im neuen Fenster /login eingeben und der Anleitung folgen.' };
    }
    case 'pruefen': {
      const auswahl = rest.length ? rest.map((nr) => finde(liste, nr)) : liste;
      return { konten: auswahl.map((k) => ({ nr: k.nr, name: k.name, aktiv: k.aktiv, anmeldung: anmeldung(k, w) })) };
    }
    default:
      throw new Error(`Aufruf: flotte konten <${UNTERBEFEHLE}> …`);
  }
}
