// The admiral (#14, decision 4): one `claude -p --json-schema` call per question block. It only
// judges; the driver delivers, writes down and asks the person. Its prompt is the decision right
// of epic-flotte/SKILL.md, cut to what it needs to judge.

import type { FrageBlock } from '../werkzeuge/bloecke.ts';

export interface AdmiralAntwort {
  nr: number;
  /** a letter of the run's options or an own text */
  antwort: string;
  herkunft: string;
  grund: string;
  beim_menschen: boolean;
  einflussreich: boolean;
  /** for the person (#28, v2): why it lies with them, in a word or two, and whether it stays revocable until the merge */
  marke?: string;
  umkehrbar?: boolean;
}

/** The answer schema of one block: nr can only be a number of its questions (acceptance finding 1). */
export function schemaFuer(block: FrageBlock) {
  const s = structuredClone(SCHEMA);
  (s.properties.antworten.items.properties.nr as { type: string; enum?: number[] }).enum = block.fragen.map((f) => f.nr);
  return s;
}

export const SCHEMA = {
  type: 'object',
  properties: {
    antworten: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nr: { type: 'integer' },
          antwort: { type: 'string' },
          herkunft: { type: 'string' },
          grund: { type: 'string' },
          beim_menschen: { type: 'boolean' },
          einflussreich: { type: 'boolean' },
          marke: { type: 'string' },
          umkehrbar: { type: 'boolean' },
        },
        required: ['nr', 'antwort', 'herkunft', 'grund', 'beim_menschen', 'einflussreich'],
      },
    },
  },
  required: ['antworten'],
};

/**
 * The only questions that lie with the person (#110), the same list as epic-flotte/SKILL.md and
 * epic/SKILL.md ("Entscheidungsrecht"); it replaced "Immer beim Menschen" and the extra list for
 * merge: nach_gate. Everything else the admiral decides, whatever the merge mode.
 */
export const BEIM_MENSCHEN = [
  'was nach außen geht und sich nicht zurückholen lässt: E-Mails und Nachrichten an Dritte, Daten an Stellen außerhalb',
  'echtes Geld, das nicht vorher freigegeben ist',
  'Produktivdaten ändern, wenn das nicht eindeutig beschlossen ist',
  'Sicherheit und Zugänge, außer sie sind mit dem Menschen abgestimmt und im Epic, Ticket oder PR verankert',
  'Texte und Versprechen an Kunden, die erst im Epic entstehen (Prüfung am PR)',
  'Architektur: eine neue Abhängigkeit, die nicht üblich und nicht Best Practice ist, oder ein Bruch mit einer Architekturentscheidung (ADR)',
];

const RECHT = `Du bist der Admiral einer Flotte von /epic-Läufen. Ein Lauf hat seinen Zug mit einem Frageblock beendet. Du entscheidest jede Frage oder legst sie dem Menschen vor. Du änderst nichts: Du liest höchstens Dateien im Repository (ADRs, Adapter .claude/epic.md, Out-of-Scope), um zu urteilen.

Beim Menschen (beim_menschen: true) liegt nur, was auf dieser Liste steht, auch wenn die Antwort vorsichtig wäre:
${BEIM_MENSCHEN.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Alles andere entscheidest du, auch gegen die Empfehlung des Laufs und mit eigener Antwort: jede Tor-, Nacharbeits- und Abbruchfrage, auch den Umfang (weglassen, dazunehmen, in ein Ticket verschieben), ein neues Ticket, einen ADR-Bezug ohne Bruch, das Löschen von Arbeitsständen und das Ausrollen in Produktion, wenn es beschlossen ist; einen nicht fahrbaren Verifikationsweg; Kanten und Reihenfolge; einen Widerspruch zu einem ADR oder Out-of-Scope nur in eine Richtung: der Lauf folgt der bestehenden Entscheidung, der widersprechende Teil wird offener Punkt; in der Nacharbeit Handgriffe, „Sitzung oder Ticket" nach den Volumenkriterien, Doku-Nachträge; einen Lauf nach einer Abbruchmeldung einmal fortsetzen lassen. Der Verbrauch des Planlimits ist kein Kostenthema: Ihn regeln die Bremsen des Treibers. Jede Entscheidung steht am Issue und ist bis zum Merge des Epic-PRs widerrufbar.

Folge der Empfehlung des Laufs, wenn sie begründet ist, nur lokal wirkt und sich bis zum Merge umkehren lässt. Warten, Aufschieben oder Weglassen ist keine neutrale Wahl: Es kostet Zeit und lässt Arbeit liegen; wähle es gegen eine solche Empfehlung nur mit einem Grund aus dem Repository (ADR, Adapter, Out-of-Scope, ein Befund), den du im grund nennst.

Im Zweifel, ohne begründete Empfehlung des Laufs: Ist die vorsichtige Variante (später, Wegwerf-Datenbank statt echter, nichts Zusätzliches) deine Empfehlung, nimmst du sie selbst. Hat der Mensch das Ob entschieden, legst du das Wie fest (Namen, Ablage, Reihenfolge, lokale Werte), außer es gibt Daten nach außen oder erweitert ein Recht. Eine Tatsachenfrage, die nur der Mensch beantworten kann, hält nichts an: vorsichtiger Wert, beim_menschen false, und im grund steht, dass der Mensch nebenher gefragt wird.

Herkunft, die erste, die greift: „Projektregel: <welche>" (Abschnitt Entscheidungsregeln im Adapter), „Skill-Empfehlung", „Präzedenz: <Fundstelle>" (nur mit Fundstelle), „Eigenes Urteil: <Grund>".

einflussreich ist eine Entscheidung, die von der Empfehlung des Laufs abweicht oder eine eigene Antwort ist, sich nur auf eigenes Urteil stützt, einen Widerspruch auflöst, den Umfang ändert, etwas ungeprüft lässt oder mehr als ein Paket betrifft. Im Zweifel true.

antwort ist der Buchstabe einer Option oder ein eigener Text, so genau, dass der Lauf nicht nachfragen muss. Liegt die Frage beim Menschen, ist antwort deine Empfehlung an ihn. Dann nennt marke den Grund in ein, zwei Wörtern (etwa „nach außen", „Geld", „Produktivdaten", „Zugang", „Kundentext", „Architektur"), und umkehrbar sagt, ob sich seine Antwort bis zum Merge des Epic-PRs noch ändern lässt.`;

export function admiralAuftrag(block: FrageBlock, kontext: string): string {
  const fragen = block.fragen
    .map((f) => [
      `${f.nr}. ${f.frage}`,
      `   Betrifft: ${f.betrifft === null ? '(fehlt)' : f.betrifft === 'Lauf' ? 'Lauf' : f.betrifft.join(', ')}`,
      `   Lage: ${f.lage}`,
      `   Optionen: ${f.optionen.map((o) => `${o.buchstabe}) ${o.text}`).join(' ')}`,
      ...(f.mehrfach ? ['   Auswahl: mehrere — antwort nennt alle gewählten Buchstaben, durch Komma getrennt (etwa „A, C")'] : []),
      `   Empfehlung des Laufs: ${f.empfehlung ?? '(keine)'} — Grund: ${f.grund}`,
      `   Regel/Quelle: ${f.quelle}`,
    ].join('\n'))
    .join('\n');
  return `FLOTTE-ADMIRAL\n${RECHT}\n\n${kontext}\n\nFLOTTE-FRAGE ${block.epic} ${block.phase}\n${fragen}\nSTAND: ${block.stand}\n\nAntworte mit genau einer Antwort je Frage. nr ist die Nummer der Frage vor dem Punkt (${block.fragen.map((f) => f.nr).join(', ')}), nicht die Nummer des Epics.`;
}

export function admiralArgs(block: FrageBlock): string[] {
  return ['--json-schema', JSON.stringify(schemaFuer(block)), '--tools', 'Read,Grep,Glob'];
}

/** What the init event of an admiral call may list: the read tools and the answer tool of --json-schema. */
export const ADMIRAL_WERKZEUGE = ['Glob', 'Grep', 'Read', 'StructuredOutput'];

/** Built-in tools of a run that reach outside the repository and that no skill of the fleet uses. */
export const LAUF_VERBOTEN = ['RemoteTrigger', 'PushNotification', 'PublishPlugin', 'ShareOnboardingGuide', 'DesignSync'];

export function admiralWerkzeuge(tools: string[]): string | null {
  const fremd = tools.filter((t) => !ADMIRAL_WERKZEUGE.includes(t));
  return fremd.length ? `Admiral mit unerwarteten Werkzeugen: ${fremd.slice(0, 8).join(', ')}${fremd.length > 8 ? ` und ${fremd.length - 8} weitere` : ''}` : null;
}

export function laufWerkzeuge(tools: string[]): string | null {
  const fremd = tools.filter((t) => t.startsWith('mcp__') || LAUF_VERBOTEN.includes(t));
  return fremd.length ? `Lauf mit verbotenen Werkzeugen: ${fremd.slice(0, 8).join(', ')}${fremd.length > 8 ? ` und ${fremd.length - 8} weitere` : ''}` : null;
}

/**
 * The answers per question. A missing or broken output, or a question without answer, goes to the
 * person: the cautious variant, the admiral never guesses for the run.
 */
export function antwortenAus(strukturiert: unknown, block: FrageBlock): AdmiralAntwort[] {
  const roh = (strukturiert as { antworten?: unknown })?.antworten;
  const liste = Array.isArray(roh) ? roh : [];
  // a model that numbers by something else (the epic, from 0): as many answers as questions and not
  // one fitting number are taken in order (dress rehearsal: nr 12 for question 1)
  const keinePasst = !liste.some((x) => block.fragen.some((f) => Number((x as AdmiralAntwort)?.nr) === f.nr));
  const nachReihe = keinePasst && liste.length === block.fragen.length;
  return block.fragen.map((f, i) => {
    const a = (nachReihe ? liste[i] : liste.find((x) => Number((x as AdmiralAntwort)?.nr) === f.nr)) as Partial<AdmiralAntwort> | undefined;
    if (!a || typeof a.antwort !== 'string' || typeof a.beim_menschen !== 'boolean') {
      return { nr: f.nr, antwort: f.empfehlung ?? '', herkunft: 'Treiber: keine verwertbare Antwort des Admirals', grund: 'Der Admiral-Aufruf lieferte für diese Frage nichts; sie liegt deshalb beim Menschen.', beim_menschen: true, einflussreich: false, marke: 'Admiral ohne Antwort' };
    }
    return {
      nr: f.nr,
      antwort: a.antwort,
      herkunft: String(a.herkunft ?? ''),
      grund: String(a.grund ?? ''),
      beim_menschen: a.beim_menschen,
      einflussreich: a.einflussreich !== false,
      ...(typeof a.marke === 'string' && a.marke.trim() ? { marke: a.marke.trim().slice(0, 60) } : {}),
      ...(typeof a.umkehrbar === 'boolean' ? { umkehrbar: a.umkehrbar } : {}),
    };
  });
}
