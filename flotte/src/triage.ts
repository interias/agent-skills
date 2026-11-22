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
// #117: a proposal of the learning loop at lern_issue is a unit of the triage like a ticket (Lernvorschlag
// below): clear becomes a Missionsziel through the order writer, superfluous only a comment.

import { abschnittInhalt, pruefen, type AuftragsRegeln } from './auftrag/auftrag.ts';
import { LERN_MARKE } from './lernen.ts';
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

/** A critical question read back from the comment of the triage (#116); seit is the comment's time, with nr the key. */
export interface OffeneFrage {
  nr: number;
  frage: string;
  optionen: string[];
  empfehlung: string;
  grund: string;
  marke: string;
  herkunft: string;
  seit: string;
}

/**
 * #116: the questions of the last comment of the triage that still wait for an answer (wartetAufAntwort),
 * read back from the form triageKommentar writes; [] when the last one is no question.
 */
export function offeneFragen(t: Ticket): OffeneFrage[] {
  if (!wartetAufAntwort(t)) return [];
  const k = t.kommentare.findLast((k) => berechtigt(k) && (k.body.includes(TRIAGE_MARKE) || k.body.includes(TRIAGE_FRAGE_MARKE)));
  if (!k?.body.includes(TRIAGE_FRAGE_MARKE)) return [];
  const zeilen = k.body.split(/\r?\n/);
  const fragen: OffeneFrage[] = [];
  // the questions start below the heading and end at the first empty line after one ("Schon entschieden" follows)
  for (const z of zeilen.slice(zeilen.findIndex((z) => z.startsWith('**FRAGE AN DEN MENSCHEN')) + 1)) {
    const f = fragen.at(-1);
    const neu = /^(\d+)\. (.*)$/.exec(z);
    const feld = /^\s+(Optionen|Empfehlung|Punkt der Liste|Herkunft): (.*)$/.exec(z);
    if (!z.trim()) {
      if (f) break;
    } else if (neu) {
      fragen.push({ nr: Number(neu[1]), frage: neu[2].trim(), optionen: [], empfehlung: '', grund: '', marke: '', herkunft: '', seit: k.zeit });
    } else if (f && feld?.[1] === 'Optionen') {
      f.optionen = feld[2].split(/(?:^|\s)[A-Z]\) /).map((o) => o.trim()).filter(Boolean);
    } else if (f && feld?.[1] === 'Empfehlung') {
      const [empfehlung, ...grund] = feld[2].split(' — ');
      f.empfehlung = empfehlung.trim();
      f.grund = grund.join(' — ').trim();
    } else if (f && feld) {
      f[feld[1] === 'Herkunft' ? 'herkunft' : 'marke'] = feld[2].trim();
    }
  }
  return fragen;
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

export function triageAuftrag(t: Ticket, r: AuftragsRegeln, lern?: Lernvorschlag): string {
  // strangers' comments never reach the model: no answer of a third party, no injected instruction
  const zugelassen = t.kommentare.filter(berechtigt);
  const fremde = t.kommentare.length - zugelassen.length;
  const kommentare = zugelassen.length ? zugelassen.map((k) => `### ${k.autor} (${k.rolle}), ${k.zeit}\n${k.body}`).join('\n\n') : '(keine)';
  let fakten = `## Text\n${t.body.trim() || '(leer)'}\n\n## Kommentare, älteste zuerst\n${kommentare}${fremde ? `\n\n(${fremde} Kommentar${fremde === 1 ? '' : 'e'} Dritter ausgelassen)` : ''}`;
  if (fakten.length > TEXT_MAX) fakten = `${fakten.slice(0, TEXT_MAX)}\n\n[gekürzt nach ${TEXT_MAX} Zeichen]`;
  return `FLOTTE-TRIAGE
Du bist der Admiral der Flotte und klärst ${lern ? 'einen Vorschlag der Lernschleife' : 'eine Sternzeit-Notiz'} ohne Rückfrage. Du änderst nichts: Du liest höchstens Dateien im Repository (ADRs in docs/adr, Adapter .claude/epic.md, CONTEXT.md, Code), um die Fakten zu prüfen. Das Programm schreibt; ${lern ? 'aus einem klaren Vorschlag legt es über den Auftragsschreiber ein Missionsziel an' : 'Tickets legt niemand an'} (agent-skills/ADR-0002).

Stell dir die Fragen einer Fragerunde selbst: Was genau soll entstehen? Ist es schon erledigt, doppelt oder überholt? Widerspricht es einem ADR oder Out-of-Scope? Woran erkennt man, dass es fertig ist? Wie wird es geprüft? Beantworte jede aus den Fakten mit deiner Empfehlung in antwort. Eine Antwort des Menschen in den Kommentaren ist eine Tatsache; die Kommentare stammen nur von Berechtigten (${BERECHTIGT.join(', ')}), Kommentare Dritter hat das Programm ausgelassen.

Beim Menschen (beim_menschen: true, marke: der Punkt) liegt nur, was auf dieser Liste steht, auch wenn die Antwort vorsichtig wäre:
${BEIM_MENSCHEN.map((p, i) => `${i + 1}. ${p} (marke: ${PUNKTE[i]})`).join('\n')}
Alles andere entscheidest du. Im Zweifel nimmst du die vorsichtige Variante selbst, wenn sie deine Empfehlung ist.

entscheidung:
- klar: keine Frage liegt beim Menschen, das Ziel ist umsetzbar. Fehlt ${r.acceptance_section.map((k) => `„${k}“`).join(' oder ')} oder ist leer, schreibst du abnahmekriterien (prüfbare Markdown-Liste); fehlt „${r.verification_section}“ oder ist leer, schreibst du verifikationsweg (ein fahrbarer Befehl oder Ablauf). Was schon dasteht, lässt du leer. ${lern ? 'Der Vorschlag wird danach ein Missionsziel mit Warp frei.' : 'Die Notiz bekommt danach Warp frei.'}
- ueberfluessig: schon erledigt, doppelt, überholt oder gegen eine bestehende Entscheidung; grund nennt die Fundstelle. ${lern ? 'Es wird nichts angelegt.' : 'Die Notiz wird geschlossen.'}
- kritisch: mindestens eine Frage liegt beim Menschen. Nur diese gehen gebündelt an ihn, mit optionen und deiner Empfehlung.

herkunft und grund gelten der ganzen Entscheidung, jede Frage hat ihre eigenen. ${HERKUNFT_REGEL}

Antworte nur über das Schema.

# ${lern ? `${lern.kennung} (Sammel-Issue #${t.nummer})` : `Sternzeit-Notiz #${t.nummer}`}: ${t.titel}

${fakten}`;
}

const kopf = (titel: string) => `${TRIAGE_MARKE}\n**Triage: ${titel}** — entschieden vom Admiral (\`flotte triage\`)`;

function entscheidungsListe(fragen: TriageFrage[]): string[] {
  return fragen.flatMap((f, i) => [`${i + 1}. ${f.frage} → ${f.antwort}`, `   Herkunft: ${f.herkunft}${f.grund ? ` — ${f.grund}` : ''}`]);
}

/** The questions with the person in the form offeneFragen reads back. */
function fragenZeilen(offen: TriageFrage[]): string[] {
  return offen.flatMap((f, i) => [
    `${i + 1}. ${f.frage}`,
    ...(f.optionen.length ? [`   Optionen: ${f.optionen.map((o, j) => `${String.fromCharCode(65 + j)}) ${o}`).join(' ')}`] : []),
    `   Empfehlung: ${f.antwort}${f.grund ? ` — ${f.grund}` : ''}`,
    `   Punkt der Liste: ${f.marke}`,
    `   Herkunft: ${f.herkunft}`,
  ]);
}

/** The comment that stands at the ticket before anything of it changes. */
export function triageKommentar(e: Exclude<Entscheidung, { art: 'ungueltig' }>, t: Ticket, entfernt: string[], ready: string): string {
  const zeilen: string[] = [];
  if (e.art === 'kritisch') {
    const offen = e.fragen.filter((f) => f.beim_menschen);
    const schon = e.fragen.filter((f) => !f.beim_menschen);
    zeilen.push(TRIAGE_FRAGE_MARKE, `**FRAGE AN DEN MENSCHEN (Triage)** — Sternzeit-Notiz #${t.nummer}: ${offen.length === 1 ? 'eine Frage liegt' : `${offen.length} Fragen liegen`} bei dir.`, '');
    zeilen.push(...fragenZeilen(offen));
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

// ---- #117: the proposals of the learning loop, triaged like tickets

/** Label and topic of a Lernvorschlag in the Frachtraum. */
export const LERN_THEMA = 'Lernschleife';
const KENNUNG = /Lernvorschlag \d+\/\d+(?!\d)/g;

export interface Lernvorschlag {
  /** `Lernvorschlag <id of the comment>/<n>`: stands in every comment of the triage about it and in every answer to it */
  kennung: string;
  n: number;
  /** link of the comment of the learning loop */
  quelle: string;
  /** the proposal as a ticket: nummer the collecting issue, body the proposal, kommentare those naming the kennung */
  ticket: Ticket;
}

/** The comment names this kennung (and not only a longer one). */
const nennt = (body: string, kennung: string) => [...body.matchAll(KENNUNG)].some((m) => m[0] === kennung);

/**
 * A comment belongs to each proposal its head names: a comment of the triage its first two lines (mark and
 * heading), any other its first line. A kennung quoted further down (a reason, a question) does not count.
 */
function gehoertZu(body: string, kennung: string): boolean {
  const triage = body.includes(TRIAGE_MARKE) || body.includes(TRIAGE_FRAGE_MARKE);
  return nennt(body.split(/\r?\n/).slice(0, triage ? 2 : 1).join('\n'), kennung);
}

/** Heading of the clear decision about a proposal; the comment with the number of the Missionsziel follows it. */
const MISSIONSZIEL_KOPF = 'wird Missionsziel, Warp frei';

/**
 * The proposal waits, and the last comment of the triage about it is the clear decision without the comment
 * `→ #<neu>` after it: creating the Missionsziel (or the comment with its number) failed. Nothing is created
 * again by itself; a person checks and writes a comment naming the kennung.
 */
export function missionszielFehlt(t: Ticket): boolean {
  if (missionszielAngelegt(t)) return false;
  if (!wartetAufAntwort(t)) return false;
  const k = t.kommentare.findLast((k) => berechtigt(k) && (k.body.includes(TRIAGE_MARKE) || k.body.includes(TRIAGE_FRAGE_MARKE)));
  return Boolean(k?.body.split(/\r?\n/)[1]?.includes(` ${MISSIONSZIEL_KOPF}**`));
}

/**
 * The Missionsziel of the proposal exists: an entitled comment of the triage `… → #<neu>, widerrufbar` names it
 * (lernAngelegtKommentar). The proposal is decided for good; a later comment naming its kennung changes nothing,
 * revoked is at the Missionsziel. So a second Missionsziel never comes from the same proposal.
 */
export function missionszielAngelegt(t: Ticket): boolean {
  return t.kommentare.some((k) => berechtigt(k) && k.body.includes(TRIAGE_MARKE) && / → #\d+, widerrufbar \(/.test(k.body.split(/\r?\n/)[1] ?? ''));
}

/**
 * The proposals of the comments of the learning loop (LERN_MARKE, form lernKommentar) at the collecting
 * issue. Only a comment of an entitled role counts: anyone can comment in a public repository.
 */
export function lernvorschlaege(issue: number, kommentare: (Ticket['kommentare'][number] & { url: string })[]): Lernvorschlag[] {
  const out: Lernvorschlag[] = [];
  for (const k of kommentare) {
    const id = /#issuecomment-(\d+)$/.exec(k.url)?.[1];
    if (!id || !berechtigt(k) || !k.body.includes(LERN_MARKE)) continue;
    let v: { n: number; titel: string; felder: string[] } | null = null;
    const fertig = () => {
      if (!v) return;
      const kennung = `Lernvorschlag ${id}/${v.n}`;
      const body = `Vorschlag ${v.n} der Lernschleife (${kennung}).\n\n${v.felder.join('\n')}\n\nHerkunft: ${k.url}`;
      out.push({ kennung, n: v.n, quelle: k.url, ticket: { nummer: issue, titel: v.titel, body, url: k.url, labels: [], kommentare: kommentare.filter((x) => !x.body.includes(LERN_MARKE) && gehoertZu(x.body, kennung)) } });
      v = null;
    };
    for (const z of k.body.split(/\r?\n/)) {
      const kopf = /^(\d+)\. \*\*(.+)\*\* — Form: (.+)$/.exec(z);
      const feld = /^\s+- (Beleg|Umsetzung|Dafür entfällt): (.*)$/.exec(z);
      if (kopf) {
        fertig();
        v = { n: Number(kopf[1]), titel: kopf[2].trim(), felder: [`- Form: ${kopf[3].trim()}`] };
      } else if (v && feld) v.felder.push(`- ${feld[1]}: ${feld[2].trim()}`);
      // a field over several lines: a following line that is not empty belongs to the last field
      else if (v && z.trim()) v.felder[v.felder.length - 1] += `\n  ${z.trim()}`;
      else fertig();
    }
    fertig();
  }
  return out;
}

const bezug = (v: Lernvorschlag) => `${v.kennung} („${v.ticket.titel}“, Vorschlag ${v.n} aus ${v.quelle})`;

/** The comment at the collecting issue before anything is created; with a question, it is all. */
export function lernTriageKommentar(e: Exclude<Entscheidung, { art: 'ungueltig' }>, v: Lernvorschlag, ready: string): string {
  const zeilen: string[] = [];
  if (e.art === 'kritisch') {
    const offen = e.fragen.filter((f) => f.beim_menschen);
    const schon = e.fragen.filter((f) => !f.beim_menschen);
    zeilen.push(TRIAGE_FRAGE_MARKE, `**FRAGE AN DEN MENSCHEN (Triage)** — ${bezug(v)}: ${offen.length === 1 ? 'eine Frage liegt' : `${offen.length} Fragen liegen`} bei dir.`, '', ...fragenZeilen(offen));
    if (schon.length) zeilen.push('', `Schon entschieden (widerrufbar mit einem Kommentar hier, der \`${v.kennung}\` nennt):`, ...entscheidungsListe(schon));
    zeilen.push('', `Antworte mit einem Kommentar an diesem Issue, der \`${v.kennung}\` nennt; die nächste Triage nimmt ihn als Tatsache. Bis dahin wird nichts angelegt, und die Frage wird nicht noch einmal gestellt.`);
    return zeilen.join('\n');
  }
  const klar = e.art === 'klar';
  zeilen.push(kopf(`${v.kennung} ${klar ? MISSIONSZIEL_KOPF : 'überflüssig, nichts angelegt'}`), bezug(v), '');
  if (!klar) zeilen.push(`Grund: ${e.grund}`, `Herkunft: ${e.herkunft}`);
  else zeilen.push(`Herkunft: ${e.herkunft}${e.grund ? ` — ${e.grund}` : ''}`);
  if (e.fragen.length) zeilen.push('', 'Entscheidungen:', ...entscheidungsListe(e.fragen));
  if (klar && e.nachgetragen.length) zeilen.push('', `Nachgetragen: ${e.nachgetragen.map((k) => `\`${k}\``).join(', ')} (vom Admiral aus den Fakten des Vorschlags).`);
  if (klar) zeilen.push('', `Der Auftragsschreiber (\`flotte auftrag\`, agent-skills/ADR-0002) legt das Missionsziel mit \`${ready}\` an; seine Nummer folgt im nächsten Kommentar.`);
  else zeilen.push('', `Widerrufbar: schreib den Einwand als Kommentar hier und nenne \`${v.kennung}\`; die nächste Triage nimmt ihn als Tatsache.`);
  return zeilen.join('\n');
}

/** The comment at the collecting issue after the Missionsziel exists. */
export function lernAngelegtKommentar(v: Lernvorschlag, neu: { nummer: number; url: string }, ready: string): string {
  return [
    TRIAGE_MARKE,
    `Vorschlag ${v.n} aus ${v.quelle} → #${neu.nummer}, widerrufbar (${v.kennung})`,
    '',
    `Widerruf: am Missionsziel #${neu.nummer} \`${ready}\` ab, \`needs-triage\` an und den Einwand dort als Kommentar; die nächste Triage nimmt ihn als Tatsache.`,
    `Herkunft: die Triage oben; angelegt vom Auftragsschreiber (agent-skills/ADR-0002), ${neu.url}`,
  ].join('\n');
}
