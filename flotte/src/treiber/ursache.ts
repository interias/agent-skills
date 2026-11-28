// #243: why a mission needs the person, in three lines: what is going on (a whole sentence of at most
// KURZ_MAX characters, never cut), who is on it (the person, the fleet or the mission, with half a
// sentence why) and the person's step with the button that fits it. A catalog for the known causes;
// an unknown one gets the catalog's plain line until the cheapest model summarized reason and log
// (zusammenfassung, marked as such). The bridge draws the cause as it comes (flottenbruecke/SCHNITTSTELLE.md,
// `ursache`); push and issue comment speak the same lines.

import { ohnePfade } from '../befehle/nachtlauf.ts';
import { gateKontexte } from '../epic/zaehlen.ts';

export const KURZ_MAX = 90;

export type UrsacheArt = 'main_rot' | 'konflikt' | 'gate_rot' | 'ohne_ergebnis' | 'pr' | 'anmeldung' | 'unbekannt';
export type Wer = 'du' | 'flotte' | 'mission';

export interface Ursache {
  /** one card per cause: the missions a cause holds share it (main_rot:<context>), else <art>:#<nr> */
  schluessel: string;
  art: UrsacheArt;
  kurz: string;
  wer: Wer;
  /** half a sentence: why that one is on it */
  warum: string;
  schritt: string;
  /** a command to copy, without a path */
  befehl: string | null;
  /** the main button: erledigt (the driver checks the cause again and requeues), einreihen (requeue is the step), none */
  knopf: 'erledigt' | 'einreihen' | null;
  quelle: 'katalog' | 'zusammengefasst';
  /** the error line: red context, test and message */
  fehler: string | null;
  seit: string | null;
  /** after "Erledigt": the sentence why the cause still holds, null before */
  geprueft?: string | null;
}

/** #243: a step of the person an admiral's decision needs later ("Dein Schritt bald"), until she says done */
export interface BaldSchritt {
  id: string;
  epic: number;
  /** the step in one sentence, at most 90 characters */
  kurz: string;
  /** why: the admiral's decision it comes from */
  warum: string;
  zeit: string;
}

export interface Fehler {
  kontext: string | null;
  test: string | null;
  meldung: string | null;
  /** what the card shows under "Details": context, test, message */
  zeile: string;
}

const WER: Record<Wer, string> = { du: 'Du', flotte: 'Flotte', mission: 'Mission' };
export const werText = (w: Wer) => WER[w];

/** The first candidate that fits whole; a colon or ellipsis at the end becomes a full stop. The last candidate is the catalog's short fallback. */
export function kurzzeile(kandidaten: string[]): string {
  const fertig = kandidaten.map((k) => {
    const s = k.trim().replace(/\s*[:…,;–-]+$/, '');
    return /[.!?]$/.test(s) ? s : `${s}.`;
  });
  return fertig.find((s) => s.length <= KURZ_MAX) ?? fertig.at(-1)!;
}

const TEST = [
  // vitest, jest: " FAIL  tests/x.test.ts > group > name", "× name"
  /^\s*(?:FAIL|×|✗)\s+(.+?)\s*$/,
  // bun: "(fail) group > name [3.20ms]"
  /^\s*\(fail\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/,
  // TAP
  /^\s*not ok \d+ -?\s*(.+?)\s*$/,
];
const PYTEST = /^\s*FAILED\s+(\S+?)(?:::\S+)?(?:\s+-\s+(.*))?\s*$/;
const MELDUNG = /(Error|Exception|assert|expected|erwartet|fehlt)/i;

/**
 * The error line of a gate log: the first red context of its last block, the first failing test before
 * it and the message right below that test. Null without a red context and without a failing test.
 */
export function fehlerAus(log: string): Fehler | null {
  const text = ohnePfade(log);
  const zeilen = text.split(/\r?\n/);
  const kopf = zeilen.map((z) => /^== Gate: /.test(z)).lastIndexOf(true);
  const kontext = kopf >= 0 ? (gateKontexte(zeilen.slice(kopf + 1)).find((k) => k.kontext.ergebnis === 'rot')?.kontext.name ?? null) : null;
  let test: string | null = null;
  let voll: string | null = null;
  let meldung: string | null = null;
  for (let i = 0; i < (kopf >= 0 ? kopf : zeilen.length) && !test; i++) {
    const p = PYTEST.exec(zeilen[i]);
    if (p) {
      test = p[1];
      voll = zeilen[i].trim().replace(/^FAILED\s+/, '').replace(/\s+-\s+.*$/, '');
      meldung = p[2]?.trim() || null;
      break;
    }
    const m = TEST.map((re) => re.exec(zeilen[i])).find(Boolean);
    if (!m) continue;
    voll = m[1];
    // the file when the line names one (vitest), else the test's name (bun)
    const erstes = m[1].split(' > ')[0].trim();
    test = /[./\\]/.test(erstes) ? erstes : m[1];
    meldung = zeilen.slice(i + 1, i + 4).map((z) => z.trim()).find((z) => z && MELDUNG.test(z) && !/^== Gate: /.test(z)) ?? null;
  }
  if (!kontext && !test) return null;
  const kurz = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
  meldung = kurz(meldung, 300);
  const zeile = [[kontext ? `${kontext} ROT` : null, voll].filter(Boolean).join(' · '), meldung].filter(Boolean).join('\n');
  return { kontext, test: kurz(test, 200), meldung, zeile };
}

/** main (the base) red without the mission: the missions wait, one card for all of them. */
export function mainRot(e: { basis: string; fehler: Fehler | null; seit: string | null }): Ursache {
  const { basis, fehler: f } = e;
  const k = f?.kontext;
  const t = f?.test;
  return {
    schluessel: `main_rot:${k ?? '?'}`,
    art: 'main_rot',
    kurz: kurzzeile([...(t && k ? [`${basis} ist rot: ${t} scheitert in ${k}`] : []), ...(k ? [`${basis} ist rot: ${k} scheitert`] : []), `${basis} ist rot, auch ohne die Mission`]),
    wer: 'du',
    warum: `die Mission ist es nicht: ${basis} ist auch ohne sie rot`,
    schritt: `${basis} reparieren${t && k ? ` (${t} in ${k})` : k ? ` (${k})` : ''}, dann „Erledigt“.`,
    befehl: null,
    knopf: 'erledigt',
    quelle: 'katalog',
    fehler: f?.zeile ?? null,
    seit: e.seit,
  };
}

/** A conflict with the base the fleet repairs itself (the run merges main again): a yellow line under "Unterwegs", no card. */
export function konfliktSelbst(nr: number, seit: string | null): Ursache {
  return { schluessel: `konflikt:#${nr}`, art: 'konflikt', kurz: 'Konflikt mit main, die Flotte holt main selbst nach.', wer: 'flotte', warum: 'ein mechanischer Konflikt, der Lauf löst ihn', schritt: 'Nichts zu tun.', befehl: null, knopf: null, quelle: 'katalog', fehler: null, seit };
}

export interface UrsacheEingang {
  nr: number;
  /** the reason of the halt as the driver wrote it */
  grund: string;
  /** the account of the mission by its short name */
  konto: string | null;
  pr: number | null;
  seit: string | null;
}

/** The cause of a halt from the catalog; anything else is `unbekannt` with a plain line until the model summarized it. */
export function einordnen(e: UrsacheEingang): Ursache {
  const grund = ohnePfade(e.grund);
  const erste = grund.split('\n')[0].trim();
  const u = (art: UrsacheArt, kurz: string[], wer: Wer, warum: string, schritt: string, knopf: Ursache['knopf'], mehr: Partial<Ursache> = {}): Ursache => ({ schluessel: `${art}:#${e.nr}`, art, kurz: kurzzeile(kurz), wer, warum, schritt, befehl: null, knopf, quelle: 'katalog', fehler: null, seit: e.seit, ...mehr });

  if (/^Nachziehen der Basis nach \d+ Konflikten/.test(erste)) {
    const dateien = /Konflikt in (.+?)\. Der Treiber/.exec(grund)?.[1];
    return u('konflikt', [...(dateien ? [`Konflikt mit main in ${dateien}, die Flotte löst ihn nicht selbst`] : []), 'Konflikt mit main, die Flotte löst ihn nicht selbst'], 'du', 'die Flotte hat mehrmals nachgezogen, der Konflikt ist inhaltlich', 'Konflikt im Missions-Branch von Hand lösen und pushen, dann „Erledigt“.', 'erledigt', { befehl: 'git merge origin/main', fehler: dateien ? `Konflikt in ${dateien}` : null });
  }
  if (/^Andocken nach zwei Nachbesserungen/.test(erste)) {
    const f = fehlerAus(grund);
    const k = f?.kontext;
    const t = f?.test;
    return u('gate_rot', [...(t && k ? [`Andockprüfung rot: ${t} scheitert in ${k}`] : []), ...(k ? [`Andockprüfung rot: ${k} scheitert`] : []), 'Die Andockprüfung der Mission ist rot'], 'mission', 'ihr Stand bricht die Prüfung, zwei Nachbesserungen halfen nicht', 'Fehler ansehen, dann neu einreihen: die Mission bessert nach.', 'einreihen', { fehler: f?.zeile ?? null });
  }
  const neustart = 'die Flotte hat es selbst schon neu versucht';
  const ansehen = 'Letzten Stand im Log ansehen, dann neu einreihen oder aufgeben.';
  if (/^Start ohne Ergebnis nach zwei Neustarts/.test(erste)) return u('ohne_ergebnis', ['Der Lauf kam nach zwei Neustarts zu keinem Ergebnis'], 'du', neustart, ansehen, 'einreihen');
  if (/^Netzfehler nach zwei Fortsetzungen/.test(erste)) return u('ohne_ergebnis', ['Der Lauf brach zweimal mit einem Netzfehler ab'], 'du', neustart, 'Netz am Rechner prüfen, dann neu einreihen.', 'einreihen');
  if (/^Zug ohne Block/.test(erste)) return u('ohne_ergebnis', ['Der Lauf endete ohne Block, auch nach der Nachfrage'], 'du', 'die Flotte hat einmal nachgefragt', ansehen, 'einreihen');
  const leer = /^Leerlauf: (\d+) min ohne Ausgabe/.exec(erste);
  if (leer) return u('ohne_ergebnis', [`Der Lauf blieb ${leer[1]} min ohne Ausgabe`], 'du', 'die Flotte hat ihn nach der Leerlauf-Grenze beendet', ansehen, 'einreihen');

  if (/^FLOTTE-ENDE ohne Pull Request/.test(erste)) return u('pr', ['Der Lauf endete ohne Pull Request'], 'mission', 'sie hat keinen PR genannt', 'Neu einreihen: die Mission legt den PR an.', 'einreihen');
  const zu = /^PR #(\d+) wurde ohne Andocken geschlossen/.exec(erste);
  if (zu) return u('pr', [`PR #${zu[1]} wurde ohne Andocken geschlossen`], 'du', 'jemand hat ihn geschlossen', `PR #${zu[1]} wieder öffnen, dann „Erledigt“; sonst aufgeben.`, 'erledigt');
  const fremd = /^PR #(\d+) gehört nicht zur Mission/.exec(erste);
  if (fremd) return u('pr', [`PR #${fremd[1]} gehört nicht zu #${e.nr}`, 'Der PR gehört nicht zur Mission'], 'du', 'der Lauf meldete einen fremden PR', 'Den richtigen PR an der Mission eintragen, dann „Erledigt“.', 'erledigt');

  // the driver writes `Konto ${kontoName}`: "Konto Konto 2 …" or "Konto arbeitspferd …"
  const konto = /^Konto (Konto \d+|.+?) ist nicht angemeldet/.exec(erste);
  if (konto) {
    const name = konto[1];
    return u('anmeldung', [`${name} ist nicht angemeldet`, 'Ein Konto ist nicht angemeldet'], 'du', 'nur du kannst ein Konto anmelden', `${name} am Rechner anmelden (Maschinenraum › Konten › Anmelden), dann „Erledigt“.`, 'erledigt');
  }
  const erlaubnis = /^Erlaubnis verweigert: (.+?)\. Kein zweiter/.exec(erste);
  if (erlaubnis || /^Gesperrt durch guard\.ps1/.test(erste)) {
    return u('anmeldung', [...(erlaubnis ? [`Eine Erlaubnis fehlt: ${erlaubnis[1]}`] : []), 'Eine Erlaubnis fehlt dem Lauf'], 'du', 'der Lauf darf den Schritt nicht selbst', 'Den Schritt selbst tun oder die Erlaubnis im Projekt ergänzen, dann neu einreihen.', 'einreihen', { fehler: erste.slice(0, 300) });
  }

  return u('unbekannt', [`Blockiert: ${erste}`, 'Die Mission ist blockiert, der Grund steht im Log'], 'du', 'die Ursache steht nicht im Katalog', 'Grund und Log ansehen, dann neu einreihen oder aufgeben.', 'einreihen', { fehler: erste.slice(0, 300) || null });
}

/** What the model returns for an unknown cause (the JSON schema of its call). */
export interface Zusammenfassung {
  kurz: string;
  wer: string;
  warum: string;
  schritt: string;
}

export const ZUSAMMENFASSUNG_SCHEMA = {
  type: 'object',
  properties: { kurz: { type: 'string' }, wer: { type: 'string', enum: ['du', 'flotte', 'mission'] }, warum: { type: 'string' }, schritt: { type: 'string' } },
  required: ['kurz', 'wer', 'warum', 'schritt'],
};

/** The order of the summary: reason and log, no path, at most 6000 characters. */
export function zusammenfassungsAuftrag(grund: string, log: string[]): string {
  return `FLOTTE-URSACHE Fasse zusammen, warum eine Mission der Flotte blockiert ist, für den Menschen, der die Brücke öffnet. kurz: ein ganzer Satz, höchstens ${KURZ_MAX} Zeichen, endet nicht mit einem Doppelpunkt. wer: du (der Mensch muss handeln), flotte (die Flotte repariert es selbst) oder mission (die Mission bessert nach einem Neu-Einreihen nach). warum: ein Halbsatz. schritt: ein konkreter Satz, was der Mensch tut.\n\nGrund:\n${ohnePfade(grund).slice(0, 3000)}\n\nLog:\n${ohnePfade(log.join('\n')).slice(-3000)}`;
}

/** The model's summary over the catalog's line, when it keeps the rules; else the catalog's line stays. */
export function zusammenfassung(u: Ursache, z: Partial<Zusammenfassung> | null): Ursache {
  if (!z || typeof z.kurz !== 'string' || typeof z.schritt !== 'string' || !['du', 'flotte', 'mission'].includes(z.wer ?? '')) return u;
  const kurz = kurzzeile([ohnePfade(z.kurz)]);
  const schritt = ohnePfade(z.schritt).trim();
  if (kurz.length > KURZ_MAX || !schritt || schritt.length > 300) return u;
  return { ...u, kurz, wer: z.wer as Wer, warum: ohnePfade(String(z.warum ?? '')).trim().slice(0, 200) || u.warum, schritt, quelle: 'zusammengefasst' };
}

/** The push: the short line as title, the step and the missions it holds below. */
export function pushText(u: Pick<Ursache, 'kurz' | 'schritt'>, missionen: string[]): { titel: string; text: string } {
  const halt = missionen.length ? ` · hält ${missionen.join(', ')}` : '';
  return { titel: u.kurz, text: `→ ${u.schritt.replace(/\.$/, '')}${halt}` };
}

/** The comment at the issue: the three lines first, log and the command to answer folded in <details>. */
export function kommentarText(u: Pick<Ursache, 'kurz' | 'wer' | 'warum' | 'schritt'>, o: { kopf: string; text?: string | null; details?: string | null; befehl?: string | null }): string {
  const innen = [o.text?.trim() ?? '', o.details ? `\`\`\`\n${ohnePfade(o.details).trim()}\n\`\`\`` : '', o.befehl ? `Antworten, im Repository: \`${o.befehl}\`` : ''].filter(Boolean);
  return [`**${o.kopf}**`, '', `**Was:** ${u.kurz}`, `**Wer:** ${werText(u.wer)} · ${u.warum}`, `**Schritt:** ${u.schritt}`, ...(innen.length ? ['', `<details><summary>Details</summary>\n\n${innen.join('\n\n')}\n\n</details>`] : [])].join('\n');
}
