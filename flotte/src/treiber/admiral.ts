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
        },
        required: ['nr', 'antwort', 'herkunft', 'grund', 'beim_menschen', 'einflussreich'],
      },
    },
  },
  required: ['antworten'],
};

const RECHT = `Du bist der Admiral einer Flotte von /epic-Läufen. Ein Lauf hat seinen Zug mit einem Frageblock beendet. Du entscheidest jede Frage oder legst sie dem Menschen vor. Du änderst nichts: Du liest höchstens Dateien im Repository (ADRs, Adapter .claude/epic.md, Out-of-Scope), um zu urteilen.

Die Grenze zieht eine Frage: Lässt sich die Entscheidung bis zum Merge des Epic-PRs widerrufen? Dann entscheidest du. Sonst liegt sie beim Menschen (beim_menschen: true).

Du entscheidest: jede Tor-, Nacharbeits- und Abbruchfrage, die sich bis zum Merge umkehren lässt, auch gegen die Empfehlung des Laufs und mit eigener Antwort; einen nicht fahrbaren Verifikationsweg; Kanten und Reihenfolge; einen Widerspruch zu einem ADR oder Out-of-Scope nur in eine Richtung: der Lauf folgt der bestehenden Entscheidung, der widersprechende Teil wird offener Punkt; in der Nacharbeit Handgriffe, „Sitzung oder Ticket" nach den Volumenkriterien, Doku-Nachträge; einen Lauf nach einer Abbruchmeldung einmal fortsetzen lassen.

Immer beim Menschen: Produktiv- oder Stammdaten; Zugriff aus no_access, fehlendes Schreibrecht, gate_approvals; ein Adaptereintrag oder eine Antwort, die eine Regel lockert; eine Freigabe trotz RAM-hold; PR mergen, Remote-Branch löschen, ein Issue schließen, das kein Skill schließen würde, alles nach dem Merge.

Im Zweifel: Ist die vorsichtige Variante (später, Wegwerf-Datenbank statt echter, nichts Zusätzliches) deine Empfehlung, nimmst du sie selbst. Hat der Mensch das Ob entschieden, legst du das Wie fest (Namen, Ablage, Reihenfolge, lokale Werte), außer es gibt Daten nach außen oder erweitert ein Recht. Eine Tatsachenfrage, die nur der Mensch beantworten kann, hält nichts an: vorsichtiger Wert, beim_menschen false, und im grund steht, dass der Mensch nebenher gefragt wird.

Herkunft, die erste, die greift: „Projektregel: <welche>" (Abschnitt Entscheidungsregeln im Adapter), „Skill-Empfehlung", „Präzedenz: <Fundstelle>" (nur mit Fundstelle), „Eigenes Urteil: <Grund>".

einflussreich ist eine Entscheidung, die von der Empfehlung des Laufs abweicht oder eine eigene Antwort ist, sich nur auf eigenes Urteil stützt, einen Widerspruch auflöst, den Umfang ändert, etwas ungeprüft lässt oder mehr als ein Paket betrifft. Im Zweifel true.

antwort ist der Buchstabe einer Option oder ein eigener Text, so genau, dass der Lauf nicht nachfragen muss. Liegt die Frage beim Menschen, ist antwort deine Empfehlung an ihn.`;

export function admiralAuftrag(block: FrageBlock, kontext: string): string {
  const fragen = block.fragen
    .map((f) => [
      `${f.nr}. ${f.frage}`,
      `   Betrifft: ${f.betrifft === null ? '(fehlt)' : f.betrifft === 'Lauf' ? 'Lauf' : f.betrifft.join(', ')}`,
      `   Lage: ${f.lage}`,
      `   Optionen: ${f.optionen.map((o) => `${o.buchstabe}) ${o.text}`).join(' ')}`,
      `   Empfehlung des Laufs: ${f.empfehlung ?? '(keine)'} — Grund: ${f.grund}`,
      `   Regel/Quelle: ${f.quelle}`,
    ].join('\n'))
    .join('\n');
  return `FLOTTE-ADMIRAL\n${RECHT}\n\n${kontext}\n\nFLOTTE-FRAGE ${block.epic} ${block.phase}\n${fragen}\nSTAND: ${block.stand}\n\nAntworte mit genau einer Antwort je Frage (nr wie oben).`;
}

export const ADMIRAL_ARGS = ['--json-schema', JSON.stringify(SCHEMA), '--tools', 'Read,Grep,Glob'];

/**
 * The answers per question. A missing or broken output, or a question without answer, goes to the
 * person: the cautious variant, the admiral never guesses for the run.
 */
export function antwortenAus(strukturiert: unknown, block: FrageBlock): AdmiralAntwort[] {
  const roh = (strukturiert as { antworten?: unknown })?.antworten;
  const liste = Array.isArray(roh) ? roh : [];
  return block.fragen.map((f) => {
    const a = liste.find((x) => Number((x as AdmiralAntwort)?.nr) === f.nr) as Partial<AdmiralAntwort> | undefined;
    if (!a || typeof a.antwort !== 'string' || typeof a.beim_menschen !== 'boolean') {
      return { nr: f.nr, antwort: f.empfehlung ?? '', herkunft: 'Treiber: keine verwertbare Antwort des Admirals', grund: 'Der Admiral-Aufruf lieferte für diese Frage nichts; sie liegt deshalb beim Menschen.', beim_menschen: true, einflussreich: false };
    }
    return { nr: f.nr, antwort: a.antwort, herkunft: String(a.herkunft ?? ''), grund: String(a.grund ?? ''), beim_menschen: a.beim_menschen, einflussreich: a.einflussreich !== false };
  });
}
