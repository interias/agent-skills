// "Braucht dich" as a Windows notification (#37): the driver runs on the machine and shows it itself
// over Windows PowerShell, without a module, also when no browser has the bridge open. #243: the content
// is what the card says: the short line of the cause and the person's step with the missions it holds, for
// a question the question in one sentence and the recommendation; never a path or a transcript. Title and
// text reach the script as environment variables, never as code.

import { ohnePfade } from '../befehle/nachtlauf.ts';
import type { Option } from '../werkzeuge/bloecke.ts';
import { pushText, type Ursache } from './ursache.ts';

export const TITEL_MAX = 90;
const TEXT_MAX = 200;

export interface Ereignis {
  /** changes when the event comes anew: a new question, an epic blocked again, the base red again */
  schluessel: string;
  titel: string;
  text: string;
}

interface MeldeFrage {
  epic: number;
  nr: number;
  seit: string;
  frage: string;
  kurz?: string | null;
  empfehlung?: string;
  optionen?: Option[];
}

interface MeldeEpic {
  nr: number;
  titel: string;
  stufe: string;
  haltZeit?: string | null;
  aufgegebenAm?: string | null;
  ursache?: Ursache | null;
}

const kuerze = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`);

/** "B · eigener PR" for a recommendation that names an option, else the recommendation as it is */
export function empfehlungText(f: Pick<MeldeFrage, 'empfehlung' | 'optionen'>): string {
  const e = (f.empfehlung ?? '').trim();
  const o = (f.optionen ?? []).find((x) => x.buchstabe === e);
  return o ? `${e} · ${o.text}` : e;
}

/**
 * The events of "Braucht dich": the open questions for the person, and one per cause that needs her: the epics blocked or
 * aborted and not given up, and the missions waiting for the red base (all of them in one event). What the fleet repairs
 * itself (wer flotte) rings nothing.
 */
export function ereignisse(forge: string, fragen: MeldeFrage[], epics: MeldeEpic[]): Ereignis[] {
  const fr = fragen.map((f) => {
    const empf = empfehlungText(f);
    return { schluessel: `frage:${forge}#${f.epic}#${f.nr}#${f.seit}`, titel: f.kurz || f.frage || `Frage zu #${f.epic}`, text: `→ ${empf ? `Empfohlen: ${empf}` : 'Antwort in der Brücke'} · #${f.epic}` };
  });
  const ursachen = new Map<string, { u: Ursache | null; epics: MeldeEpic[]; schluessel: string }>();
  for (const e of epics) {
    const halt = (e.stufe === 'blockiert' || e.stufe === 'abgebrochen') && !e.aufgegebenAm;
    const wartet = !halt && e.ursache?.wer === 'du' && !e.aufgegebenAm && !['gemergt', 'fertig', 'blockiert', 'abgebrochen'].includes(e.stufe);
    if (!halt && !wartet) continue;
    const key = halt ? `blockade:${forge}#${e.nr}#${e.stufe}#${e.haltZeit ?? ''}` : `ursache:${forge}#${e.ursache!.schluessel}#${e.ursache!.seit ?? ''}`;
    const da = ursachen.get(key) ?? { u: e.ursache ?? null, epics: [], schluessel: key };
    da.epics.push(e);
    ursachen.set(key, da);
  }
  const ur = [...ursachen.values()].map(({ u, epics: es, schluessel }) => {
    const nrs = es.map((e) => `#${e.nr}`);
    if (u) return { schluessel, ...pushText(u, nrs) };
    // an older state without a cause: the mission's title as before
    return { schluessel, titel: `${es[0].stufe === 'abgebrochen' ? 'Abgebrochen' : 'Blockiert'}: ${es[0].titel || `#${es[0].nr}`}`, text: `→ Ursache ansehen · hält ${nrs.join(', ')}` };
  });
  return [...fr, ...ur].map((x) => ({ schluessel: x.schluessel, titel: ohnePfade(x.titel), text: ohnePfade(x.text) }));
}

/** One notification: a single event as it is, several with their number and one line each. */
export function inhalt(neu: Ereignis[], kurz: string): { titel: string; text: string } {
  if (neu.length === 1) return { titel: kuerze(neu[0].titel, TITEL_MAX), text: kuerze(`${neu[0].text} (${kurz})`, TEXT_MAX) };
  return { titel: `Braucht dich: ${neu.length} neue Meldungen (${kurz})`, text: neu.map((x) => kuerze(x.titel, TITEL_MAX)).join('\n') };
}

/** Windows PowerShell 5.1 reaches the toast API of Windows (WinRT); the app id is the one of powershell.exe. */
export const TOAST_SKRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]',
  '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  "$t = $x.GetElementsByTagName('text')",
  '[void]$t.Item(0).AppendChild($x.CreateTextNode($env:FLOTTE_MELDUNG_TITEL))',
  '[void]$t.Item(1).AppendChild($x.CreateTextNode($env:FLOTTE_MELDUNG_TEXT))',
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))",
].join('\n');

/** The call of the notification: the fixed script encoded, title and text in the environment. */
export function aufruf(m: { titel: string; text: string }): { programm: string; args: string[]; env: Record<string, string> } {
  return {
    programm: 'powershell',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(TOAST_SKRIPT, 'utf16le').toString('base64')],
    env: { FLOTTE_MELDUNG_TITEL: m.titel, FLOTTE_MELDUNG_TEXT: m.text },
  };
}
