// The triage run (#115): the admiral clears Sternzeit-Notizen (needs-triage, needs-info) without
// asking. Per ticket one `claude -p --json-schema` call asks the questions of a question round
// itself, answers them from the facts (body, comments, ADRs, code) and decides under the decision
// right of the admiral (BEIM_MENSCHEN in treiber/admiral.ts):
// - klar: missing acceptance and verification sections are filled in (checked like the order writer
//   checks a draft), ready_label replaces the triage labels;
// - ueberfluessig: closed with the reason;
// - kritisch: one bundled question to the person, the ticket stays in triage.
// The program decides what the model's answer allows, writes the comment first and changes the
// ticket only when the comment stands. Formats of the comments and the JSON: flotte/README.md, "Triage".

import { abschnittInhalt, pruefen, type AuftragsRegeln } from './auftrag/auftrag.ts';
import { BEIM_MENSCHEN, HERKUNFT_REGEL, MERKMALE } from './treiber/admiral.ts';

export const INFO_LABEL = 'needs-info';
/** First line of every comment of the triage run. */
export const TRIAGE_MARKE = '<!-- flotte:triage -->';
/** First line of a question to the person: the bridge finds it, the next triage waits on an answer below it. */
export const TRIAGE_FRAGE_MARKE = '<!-- flotte:triage-frage -->';
const TEXT_MAX = 40_000;
const ENTSCHEIDUNGEN = ['klar', 'ueberfluessig', 'kritisch'] as const;
const PUNKTE = MERKMALE.map((m) => m.punkt);

export interface Ticket {
  nummer: number;
  titel: string;
  body: string;
  url: string;
  labels: string[];
  /** rolle: authorAssociation of the forge (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, …) */
  kommentare: { body: string; autor: string; zeit: string; rolle: string }[];
}

/** Only these may answer: the repository is public, anyone can comment. */
export const BERECHTIGT = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const berechtigt = (k: Ticket['kommentare'][number]) => BERECHTIGT.includes(k.rolle);

export interface TriageFrage {
  frage: string;
  optionen: string[];
  /** the admiral's answer; with the person: its recommendation */
  antwort: string;
  herkunft: string;
  grund: string;
  beim_menschen: boolean;
  /** with the person: the point of BEIM_MENSCHEN (short name from MERKMALE) */
  marke?: string;
}

export type Entscheidung =
  | { art: 'klar'; herkunft: string; grund: string; fragen: TriageFrage[]; body: string; nachgetragen: string[] }
  | { art: 'ueberfluessig' | 'kritisch'; herkunft: string; grund: string; fragen: TriageFrage[] }
  | { art: 'ungueltig'; fehler: string };

export function triageSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['entscheidung', 'herkunft', 'grund', 'fragen', 'abnahmekriterien', 'verifikationsweg'],
    properties: {
      entscheidung: { type: 'string', enum: [...ENTSCHEIDUNGEN] },
      herkunft: { type: 'string' },
      grund: { type: 'string' },
      fragen: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['frage', 'optionen', 'antwort', 'herkunft', 'grund', 'beim_menschen'],
          properties: {
            frage: { type: 'string' },
            optionen: { type: 'array', items: { type: 'string' } },
            antwort: { type: 'string' },
            herkunft: { type: 'string' },
            grund: { type: 'string' },
            beim_menschen: { type: 'boolean' },
            marke: { type: 'string', enum: PUNKTE },
          },
        },
      },
      abnahmekriterien: { type: 'string', description: 'Markdown, nur wenn der Abschnitt fehlt oder leer ist, sonst leer' },
      verifikationsweg: { type: 'string', description: 'nur wenn der Abschnitt fehlt oder leer ist, sonst leer' },
    },
  };
}

/**
 * A comment of the triage (question, or a decision whose release failed) stands, and no person with
 * a role below it has written since: nothing new to judge. Strangers' comments do not count.
 */
export function wartetAufAntwort(t: Ticket): boolean {
  const marke = (k: Ticket['kommentare'][number]) => berechtigt(k) && (k.body.includes(TRIAGE_MARKE) || k.body.includes(TRIAGE_FRAGE_MARKE));
  const i = t.kommentare.findLastIndex(marke);
  return i >= 0 && !t.kommentare.slice(i + 1).some((k) => berechtigt(k) && !marke(k));
}

const voll = (text: string, k: string) => (abschnittInhalt(text, k) ?? '').trim() !== '';

/** Fills a section that is missing (appended) or empty (content under its heading). */
function nachtragen(body: string, ueberschrift: string, inhalt: string): string {
  if (abschnittInhalt(body, ueberschrift) === null) return `${body.trimEnd()}\n\n${ueberschrift}\n${inhalt.trim()}\n`;
  const zeilen = body.split(/\r?\n/);
  const i = zeilen.findIndex((z) => z.trim() === ueberschrift.trim());
  zeilen.splice(i + 1, 0, inhalt.trim());
  return zeilen.join('\n');
}

/**
 * What the model's answer allows. A question with the person makes the ticket critical whatever the
 * model chose; critical without such a question, clear whose sections still fail the order writer's
 * check, superfluous without a reason, or an answer outside the schema change nothing.
 */
export function entscheidungAus(x: unknown, titel: string, body: string, r: AuftragsRegeln): Entscheidung {
  const o = x as Record<string, unknown> | null;
  if (!o || !ENTSCHEIDUNGEN.includes(o.entscheidung as never) || !Array.isArray(o.fragen)) return { art: 'ungueltig', fehler: 'keine Antwort im Schema' };
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const grund = text(o.grund);
  const herkunft = text(o.herkunft) || `Eigenes Urteil: ${grund || 'ohne Angabe'}`;
  const fragen: TriageFrage[] = (o.fragen as Record<string, unknown>[])
    .filter((f) => f && text(f.frage) && typeof f.antwort === 'string' && typeof f.beim_menschen === 'boolean')
    .map((f) => ({
      frage: text(f.frage),
      optionen: Array.isArray(f.optionen) ? f.optionen.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [],
      antwort: text(f.antwort),
      herkunft: text(f.herkunft) || `Eigenes Urteil: ${text(f.grund) || 'ohne Angabe'}`,
      grund: text(f.grund),
      beim_menschen: f.beim_menschen as boolean,
      ...(f.beim_menschen ? { marke: PUNKTE.includes(text(f.marke)) ? text(f.marke) : 'ohne Marke' } : {}),
    }));
  if (fragen.some((f) => f.beim_menschen)) return { art: 'kritisch', herkunft, grund, fragen };
  if (o.entscheidung === 'kritisch') return { art: 'ungueltig', fehler: 'kritisch, aber keine Frage liegt nach der Liste beim Menschen' };
  if (o.entscheidung === 'ueberfluessig') return grund ? { art: 'ueberfluessig', herkunft, grund, fragen } : { art: 'ungueltig', fehler: 'überflüssig ohne Grund' };
  let neu = body;
  const nachgetragen: string[] = [];
  if (!r.acceptance_section.some((k) => voll(body, k)) && text(o.abnahmekriterien)) {
    const k = r.acceptance_section.find((k) => abschnittInhalt(body, k) !== null) ?? r.acceptance_section[0];
    neu = nachtragen(neu, k, text(o.abnahmekriterien));
    nachgetragen.push(k);
  }
  if (!voll(body, r.verification_section) && text(o.verifikationsweg)) {
    neu = nachtragen(neu, r.verification_section, text(o.verifikationsweg));
    nachgetragen.push(r.verification_section);
  }
  try {
    pruefen({ mission: null, ziele: [{ titel, text: neu }] }, r);
  } catch (e) {
    return { art: 'ungueltig', fehler: (e as Error).message.replace('Nichts angelegt, ', 'Nichts geändert, ') };
  }
  return { art: 'klar', herkunft, grund, fragen, body: neu, nachgetragen };
}

export function triageAuftrag(t: Ticket, r: AuftragsRegeln): string {
  // strangers' comments never reach the model: no answer of a third party, no injected instruction
  const zugelassen = t.kommentare.filter(berechtigt);
  const fremde = t.kommentare.length - zugelassen.length;
  const kommentare = zugelassen.length ? zugelassen.map((k) => `### ${k.autor} (${k.rolle}), ${k.zeit}\n${k.body}`).join('\n\n') : '(keine)';
  let fakten = `## Text\n${t.body.trim() || '(leer)'}\n\n## Kommentare, älteste zuerst\n${kommentare}${fremde ? `\n\n(${fremde} Kommentar${fremde === 1 ? '' : 'e'} Dritter ausgelassen)` : ''}`;
  if (fakten.length > TEXT_MAX) fakten = `${fakten.slice(0, TEXT_MAX)}\n\n[gekürzt nach ${TEXT_MAX} Zeichen]`;
  return `FLOTTE-TRIAGE
Du bist der Admiral der Flotte und klärst eine Sternzeit-Notiz ohne Rückfrage. Du änderst nichts: Du liest höchstens Dateien im Repository (ADRs in docs/adr, Adapter .claude/epic.md, CONTEXT.md, Code), um die Fakten zu prüfen. Das Programm schreibt; Tickets legt niemand an (agent-skills/ADR-0002).

Stell dir die Fragen einer Fragerunde selbst: Was genau soll entstehen? Ist es schon erledigt, doppelt oder überholt? Widerspricht es einem ADR oder Out-of-Scope? Woran erkennt man, dass es fertig ist? Wie wird es geprüft? Beantworte jede aus den Fakten mit deiner Empfehlung in antwort. Eine Antwort des Menschen in den Kommentaren ist eine Tatsache; die Kommentare stammen nur von Berechtigten (${BERECHTIGT.join(', ')}), Kommentare Dritter hat das Programm ausgelassen.

Beim Menschen (beim_menschen: true, marke: der Punkt) liegt nur, was auf dieser Liste steht, auch wenn die Antwort vorsichtig wäre:
${BEIM_MENSCHEN.map((p, i) => `${i + 1}. ${p} (marke: ${PUNKTE[i]})`).join('\n')}
Alles andere entscheidest du. Im Zweifel nimmst du die vorsichtige Variante selbst, wenn sie deine Empfehlung ist.

entscheidung:
- klar: keine Frage liegt beim Menschen, das Ziel ist umsetzbar. Fehlt ${r.acceptance_section.map((k) => `„${k}“`).join(' oder ')} oder ist leer, schreibst du abnahmekriterien (prüfbare Markdown-Liste); fehlt „${r.verification_section}“ oder ist leer, schreibst du verifikationsweg (ein fahrbarer Befehl oder Ablauf). Was schon dasteht, lässt du leer. Die Notiz bekommt danach Warp frei.
- ueberfluessig: schon erledigt, doppelt, überholt oder gegen eine bestehende Entscheidung; grund nennt die Fundstelle. Die Notiz wird geschlossen.
- kritisch: mindestens eine Frage liegt beim Menschen. Nur diese gehen gebündelt an ihn, mit optionen und deiner Empfehlung.

herkunft und grund gelten der ganzen Entscheidung, jede Frage hat ihre eigenen. ${HERKUNFT_REGEL}

Antworte nur über das Schema.

# Sternzeit-Notiz #${t.nummer}: ${t.titel}

${fakten}`;
}

const kopf = (titel: string) => `${TRIAGE_MARKE}\n**Triage: ${titel}** — entschieden vom Admiral (\`flotte triage\`)`;

function entscheidungsListe(fragen: TriageFrage[]): string[] {
  return fragen.flatMap((f, i) => [`${i + 1}. ${f.frage} → ${f.antwort}`, `   Herkunft: ${f.herkunft}${f.grund ? ` — ${f.grund}` : ''}`]);
}

/** The comment that stands at the ticket before anything of it changes. */
export function triageKommentar(e: Exclude<Entscheidung, { art: 'ungueltig' }>, t: Ticket, entfernt: string[], ready: string): string {
  const zeilen: string[] = [];
  if (e.art === 'kritisch') {
    const offen = e.fragen.filter((f) => f.beim_menschen);
    const schon = e.fragen.filter((f) => !f.beim_menschen);
    zeilen.push(TRIAGE_FRAGE_MARKE, `**FRAGE AN DEN MENSCHEN (Triage)** — Sternzeit-Notiz #${t.nummer}: ${offen.length === 1 ? 'eine Frage liegt' : `${offen.length} Fragen liegen`} bei dir.`, '');
    offen.forEach((f, i) => {
      zeilen.push(`${i + 1}. ${f.frage}`);
      if (f.optionen.length) zeilen.push(`   Optionen: ${f.optionen.map((o, j) => `${String.fromCharCode(65 + j)}) ${o}`).join(' ')}`);
      zeilen.push(`   Empfehlung: ${f.antwort}${f.grund ? ` — ${f.grund}` : ''}`, `   Punkt der Liste: ${f.marke}`, `   Herkunft: ${f.herkunft}`);
    });
    if (schon.length) zeilen.push('', 'Schon entschieden (widerrufbar mit einem Kommentar hier):', ...entscheidungsListe(schon));
    zeilen.push('', `Antworte mit einem Kommentar an diesem Ticket; die nächste Triage nimmt ihn als Tatsache. Bis dahin bleibt \`${entfernt[0] ?? 'needs-triage'}\`, und die Frage wird nicht noch einmal gestellt.`);
    return zeilen.join('\n');
  }
  if (e.art === 'klar') {
    zeilen.push(kopf('Warp frei'), '', `Herkunft: ${e.herkunft}${e.grund ? ` — ${e.grund}` : ''}`);
    if (e.fragen.length) zeilen.push('', 'Entscheidungen:', ...entscheidungsListe(e.fragen));
    if (e.nachgetragen.length) zeilen.push('', `Nachgetragen: ${e.nachgetragen.map((k) => `\`${k}\``).join(', ')} (vom Admiral aus den Fakten des Tickets).`);
    zeilen.push('', `Labels: ${entfernt.map((l) => `\`${l}\``).join(', ')} ab, \`${ready}\` dazu.`);
    zeilen.push('', 'Widerrufbar: setz `needs-triage` wieder und schreib den Einwand als Kommentar; die nächste Triage nimmt ihn als Tatsache.');
    return zeilen.join('\n');
  }
  zeilen.push(kopf('geschlossen, überflüssig'), '', `Grund: ${e.grund}`, `Herkunft: ${e.herkunft}`);
  if (e.fragen.length) zeilen.push('', 'Entscheidungen:', ...entscheidungsListe(e.fragen));
  zeilen.push('', 'Widerrufbar: das Ticket wieder öffnen und den Einwand als Kommentar schreiben; es trägt seine Labels noch und kommt in die nächste Triage.');
  return zeilen.join('\n');
}
