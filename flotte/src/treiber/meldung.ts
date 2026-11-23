// "Braucht dich" as a Windows notification (#37): the driver runs on the machine and shows it itself
// over Windows PowerShell, without a module, also when no browser has the bridge open. Content: the
// project's short name, the epic number, the kind and a short title, never the question, a path or a
// transcript. Title and text reach the script as environment variables, never as code.

export const TITEL_MAX = 60;
const ART = { frage: 'Frage', blockade: 'Blockade' } as const;

export interface Ereignis {
  /** changes when the event comes anew: a new question, an epic blocked again */
  schluessel: string;
  kurz: string;
  epic: number;
  art: keyof typeof ART;
  titel: string;
}

/** The events of "Braucht dich": the open questions for the person, the epics blocked or aborted and not given up. */
export function ereignisse(
  forge: string,
  fragen: { epic: number; nr: number; seit: string }[],
  epics: { nr: number; titel: string; stufe: string; haltZeit?: string | null; aufgegebenAm?: string | null }[],
): Ereignis[] {
  const kurz = forge.split('/').pop() ?? forge;
  const titel = (nr: number) => epics.find((e) => e.nr === nr)?.titel ?? '';
  return [
    ...fragen.map((f) => ({ schluessel: `frage:${forge}#${f.epic}#${f.nr}#${f.seit}`, kurz, epic: f.epic, art: 'frage' as const, titel: titel(f.epic) })),
    ...epics
      .filter((e) => (e.stufe === 'blockiert' || e.stufe === 'abgebrochen') && !e.aufgegebenAm)
      .map((e) => ({ schluessel: `blockade:${forge}#${e.nr}#${e.stufe}#${e.haltZeit ?? ''}`, kurz, epic: e.nr, art: 'blockade' as const, titel: e.titel })),
  ];
}

const kuerze = (t: string) => (t.length <= TITEL_MAX ? t : `${t.slice(0, TITEL_MAX - 1).trimEnd()}…`);

/** One notification: a single event with its project and number in the title, several with their number. */
export function inhalt(neu: Ereignis[]): { titel: string; text: string } {
  const was = (x: Ereignis) => ART[x.art] + (x.titel ? ` · ${kuerze(x.titel)}` : '');
  if (neu.length === 1) return { titel: `Braucht dich: ${neu[0].kurz} #${neu[0].epic}`, text: was(neu[0]) };
  return { titel: `Braucht dich: ${neu.length} neue Meldungen`, text: neu.map((x) => `${x.kurz} #${x.epic} ${was(x)}`).join('\n') };
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
