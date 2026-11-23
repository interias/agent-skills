// The triage run (#115): the admiral clears Sternzeit-Notizen (needs-triage, needs-info) without
// asking. #146: one `claude -p --json-schema` call per project (the cut plan below) asks the questions of
// a question round for every note itself, answers them from the facts (body, comments, ADRs, code) and
// decides under the decision right of the admiral (BEIM_MENSCHEN in treiber/admiral.ts): per note its
// place in the plan, missing acceptance and verification sections (checked like the order writer checks
// a draft), or one bundled question to the person. Only notes over the size of one call are split into
// a few packages by topic. The program decides what the model's answer allows, writes the comment first
// and changes the ticket only when the comment stands. Formats of the comments and the JSON:
// flotte/README.md, "Triage".
// #117: a proposal of the learning loop at lern_issue is no note but a comment at a collecting issue; each
// gets its own call (Lernvorschlag below): clear becomes a Missionsziel through the order writer,
// superfluous only a comment, critical one question.

import { abschnittInhalt, pruefen, TRIAGE_LABEL, type AuftragsRegeln } from './auftrag/auftrag.ts';
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

/** The questions of a question round in the schema: of a proposal (triageSchema) and of each note of the cut plan. */
const FRAGEN_SCHEMA = {
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
};
const ABNAHME_SCHEMA = { type: 'string', description: 'Markdown, nur wenn der Abschnitt fehlt oder leer ist, sonst leer' };
const VERIFIKATION_SCHEMA = { type: 'string', description: 'nur wenn der Abschnitt fehlt oder leer ist, sonst leer' };

/** #117: the schema of the clearing of one proposal of the learning loop. */
export function triageSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['entscheidung', 'herkunft', 'grund', 'fragen', 'abnahmekriterien', 'verifikationsweg'],
    properties: {
      entscheidung: { type: 'string', enum: [...ENTSCHEIDUNGEN] },
      herkunft: { type: 'string' },
      grund: { type: 'string' },
      fragen: FRAGEN_SCHEMA,
      abnahmekriterien: ABNAHME_SCHEMA,
      verifikationsweg: VERIFIKATION_SCHEMA,
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

/**
 * Fills a section that is missing (appended) or empty (content under its heading). #147: the text that was
 * there stays character for character (line ends, trailing spaces); only the new content is added.
 */
function nachtragen(body: string, ueberschrift: string, inhalt: string): string {
  if (abschnittInhalt(body, ueberschrift) === null) return `${body}${body && !body.endsWith('\n') ? '\n' : ''}${body ? '\n' : ''}${ueberschrift}\n${inhalt.trim()}\n`;
  let pos = 0;
  for (const z of body.split('\n')) {
    const ende = pos + z.length;
    if (z.trim() === ueberschrift.trim()) {
      const eol = z.endsWith('\r') ? '\r\n' : '\n';
      return ende < body.length ? `${body.slice(0, ende + 1)}${inhalt.trim()}${eol}${body.slice(ende + 1)}` : `${body}${eol}${inhalt.trim()}${eol}`;
    }
    pos = ende + 1;
  }
  return body;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The questions of an answer that keep the schema; one with the person carries its point of the list. */
function fragenAus(x: unknown): TriageFrage[] {
  if (!Array.isArray(x)) return [];
  return (x as Record<string, unknown>[])
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
}

/**
 * The body with the sections the admiral wrote for those missing or empty (the text that was there stays), and
 * the error of the order writer's check when they still fail it.
 */
export function ergaenzt(titel: string, body: string, o: { abnahmekriterien?: unknown; verifikationsweg?: unknown }, r: AuftragsRegeln): { body: string; nachgetragen: string[]; fehler?: string } {
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
    return { body: neu, nachgetragen, fehler: (e as Error).message.replace('Nichts angelegt, ', 'Nichts geändert, ') };
  }
  return { body: neu, nachgetragen };
}

/**
 * What the model's answer about a proposal allows. A question with the person makes it critical whatever
 * the model chose; critical without such a question, clear whose sections still fail the order writer's
 * check, superfluous without a reason, or an answer outside the schema change nothing.
 */
export function entscheidungAus(x: unknown, titel: string, body: string, r: AuftragsRegeln): Entscheidung {
  const o = x as Record<string, unknown> | null;
  if (!o || !ENTSCHEIDUNGEN.includes(o.entscheidung as never) || !Array.isArray(o.fragen)) return { art: 'ungueltig', fehler: 'keine Antwort im Schema' };
  const grund = text(o.grund);
  const herkunft = text(o.herkunft) || `Eigenes Urteil: ${grund || 'ohne Angabe'}`;
  const fragen = fragenAus(o.fragen);
  if (fragen.some((f) => f.beim_menschen)) return { art: 'kritisch', herkunft, grund, fragen };
  if (o.entscheidung === 'kritisch') return { art: 'ungueltig', fehler: 'kritisch, aber keine Frage liegt nach der Liste beim Menschen' };
  if (o.entscheidung === 'ueberfluessig') return grund ? { art: 'ueberfluessig', herkunft, grund, fragen } : { art: 'ungueltig', fehler: 'überflüssig ohne Grund' };
  const neu = ergaenzt(titel, body, o, r);
  if (neu.fehler) return { art: 'ungueltig', fehler: neu.fehler };
  return { art: 'klar', herkunft, grund, fragen, body: neu.body, nachgetragen: neu.nachgetragen };
}

/**
 * Body and entitled comments of a ticket within max characters; h is the heading level of its parts. #148: over max
 * the oldest comments go first (with a note how many), then the text is cut; the newest comment (an answer, a
 * revocation of the person) stays. Only a newest comment longer than max itself is cut at its end.
 */
function faktenAus(t: Ticket, max: number, h = '##'): string {
  // strangers' comments never reach the model: no answer of a third party, no injected instruction
  const zugelassen = t.kommentare.filter(berechtigt);
  const fremde = t.kommentare.length - zugelassen.length;
  const text = t.body.trim() || '(leer)';
  const bau = (body: string, alt: number) => {
    const ks = zugelassen.slice(alt);
    const kommentare = ks.length ? ks.map((k) => `${h}# ${k.autor} (${k.rolle}), ${k.zeit}\n${k.body}`).join('\n\n') : '(keine)';
    const weg = alt ? `(${alt} ältere${alt === 1 ? 'r' : ''} Kommentar${alt === 1 ? '' : 'e'} ausgelassen)\n\n` : '';
    return `${h} Text\n${body}\n\n${h} Kommentare, älteste zuerst\n${weg}${kommentare}${fremde ? `\n\n(${fremde} Kommentar${fremde === 1 ? '' : 'e'} Dritter ausgelassen)` : ''}`;
  };
  let alt = 0;
  let fakten = bau(text, 0);
  while (fakten.length > max && alt < zugelassen.length - 1) fakten = bau(text, ++alt);
  if (fakten.length <= max) return fakten;
  const rest = max - bau('', alt).length - 40;
  if (rest > 0) return bau(`${text.slice(0, rest)}\n[gekürzt nach ${rest} Zeichen]`, alt);
  return `${fakten.slice(0, max)}\n\n[gekürzt nach ${max} Zeichen]`;
}

/** The questions of a question round, the list of what lies with the person: the same in the cut plan and for a proposal. */
const FRAGERUNDE = `Stell dir die Fragen einer Fragerunde selbst: Was genau soll entstehen? Ist es schon erledigt, doppelt oder überholt? Widerspricht es einem ADR oder Out-of-Scope? Woran erkennt man, dass es fertig ist? Wie wird es geprüft? Beantworte jede aus den Fakten mit deiner Empfehlung in antwort (fragen). Eine Antwort des Menschen in den Kommentaren ist eine Tatsache; die Kommentare stammen nur von Berechtigten (${BERECHTIGT.join(', ')}), Kommentare Dritter hat das Programm ausgelassen.

Beim Menschen (beim_menschen: true, marke: der Punkt) liegt nur, was auf dieser Liste steht, auch wenn die Antwort vorsichtig wäre:
${BEIM_MENSCHEN.map((p, i) => `${i + 1}. ${p} (marke: ${PUNKTE[i]})`).join('\n')}
Alles andere entscheidest du. Im Zweifel nimmst du die vorsichtige Variante selbst, wenn sie deine Empfehlung ist.`;

const abschnitte = (r: AuftragsRegeln) =>
  `Fehlt ${r.acceptance_section.map((k) => `„${k}“`).join(' oder ')} oder ist leer, schreibst du abnahmekriterien (prüfbare Markdown-Liste); fehlt „${r.verification_section}“ oder ist leer, schreibst du verifikationsweg (ein fahrbarer Befehl oder Ablauf). Was schon dasteht, lässt du leer.`;

/** #117: the order for the clearing of one proposal of the learning loop. */
export function triageAuftrag(t: Ticket, r: AuftragsRegeln, lern: Lernvorschlag): string {
  const fakten = faktenAus(t, TEXT_MAX);
  return `FLOTTE-TRIAGE
Du bist der Admiral der Flotte und klärst einen Vorschlag der Lernschleife ohne Rückfrage. Du änderst nichts: Du liest höchstens Dateien im Repository (ADRs in docs/adr, Adapter .claude/epic.md, CONTEXT.md, Code), um die Fakten zu prüfen. Das Programm schreibt; aus einem klaren Vorschlag legt es über den Auftragsschreiber ein Missionsziel an (agent-skills/ADR-0002).

${FRAGERUNDE}

entscheidung:
- klar: keine Frage liegt beim Menschen, das Ziel ist umsetzbar. ${abschnitte(r)} Der Vorschlag wird danach ein Missionsziel mit Warp frei.
- ueberfluessig: schon erledigt, doppelt, überholt oder gegen eine bestehende Entscheidung; grund nennt die Fundstelle. Es wird nichts angelegt.
- kritisch: mindestens eine Frage liegt beim Menschen. Nur diese gehen gebündelt an ihn, mit optionen und deiner Empfehlung.

herkunft und grund gelten der ganzen Entscheidung, jede Frage hat ihre eigenen. ${HERKUNFT_REGEL}

Antworte nur über das Schema.

# ${lern.kennung} (Sammel-Issue #${t.nummer}): ${t.titel}

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

/**
 * The comment with the questions of a note that lie with the person (the decided ones below them); nothing else
 * of the note changes. offeneFragen reads it back.
 */
export function triageKommentar(e: { fragen: TriageFrage[] }, t: Ticket, entfernt: string[]): string {
  const offen = e.fragen.filter((f) => f.beim_menschen);
  const schon = e.fragen.filter((f) => !f.beim_menschen);
  const zeilen = [TRIAGE_FRAGE_MARKE, `**FRAGE AN DEN MENSCHEN (Triage)** — Sternzeit-Notiz #${t.nummer}: ${offen.length === 1 ? 'eine Frage liegt' : `${offen.length} Fragen liegen`} bei dir.`, ''];
  zeilen.push(...fragenZeilen(offen));
  if (schon.length) zeilen.push('', 'Schon entschieden (widerrufbar mit einem Kommentar hier):', ...entscheidungsListe(schon));
  zeilen.push('', `Antworte mit einem Kommentar an diesem Ticket; die nächste Triage nimmt ihn als Tatsache. Bis dahin bleibt \`${entfernt[0] ?? 'needs-triage'}\`, und die Frage wird nicht noch einmal gestellt.`);
  return zeilen.join('\n');
}

// ---- #146: the cut plan over all Sternzeit-Notizen of a project, their clearing in the same call

/** At most this many new missions per run, at most this many children per mission (existing ones count). */
export const NEUE_MISSIONEN_MAX = 4;
export const KINDER_MAX = 8;
const NOTIZ_MAX = 6_000;
const MISSION_MAX = 2_000;
/** Total budget of the order: an order too large fails the call, and an invalid plan holds back the whole project. */
const NOTIZEN_GESAMT = 120_000;
const MISSIONEN_GESAMT = 30_000;
const ZUORDNUNGEN = ['mission', 'neue_mission', 'zusammengefuehrt', 'ueberfluessig', 'verworfen', 'triage'] as const;
export type Zuordnungsart = (typeof ZUORDNUNGEN)[number];
/** The kinds the triage closes (`not planned`), the comment with origin first. */
export const GESCHLOSSEN: Zuordnungsart[] = ['zusammengefuehrt', 'ueberfluessig', 'verworfen'];

/** An open mission a note may join: open, not `status/in-arbeit`, its number of children read. */
export interface OffeneMission {
  nummer: number;
  titel: string;
  body: string;
  kinder: number;
}

export interface Zuordnung {
  notiz: number;
  art: Zuordnungsart;
  grund: string;
  herkunft: string;
  /** art mission: the open mission */
  mission?: number;
  /** art neue_mission: the key of the new mission */
  neue_mission?: string;
  /** art zusammengefuehrt: the note that stays */
  in?: number;
  /** art ueberfluessig: where it is done, doubled or overtaken */
  fundstelle?: string;
  /** #146: the questions of the question round about the note, decided by the admiral or (beim_menschen) with the person */
  fragen: TriageFrage[];
  /** #146: the sections the admiral wrote for a note joining a mission, where they are missing or empty */
  abnahmekriterien?: string;
  verifikationsweg?: string;
}

export interface NeueMission {
  schluessel: string;
  titel: string;
  begruendung: string;
  kinder: number[];
}

export type Schnittplan = { art: 'plan'; neue_missionen: NeueMission[]; zuordnungen: Zuordnung[] } | { art: 'ungueltig'; fehler: string };

export function schnittplanSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['neue_missionen', 'zuordnungen'],
    properties: {
      neue_missionen: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['schluessel', 'titel', 'begruendung'],
          properties: { schluessel: { type: 'string' }, titel: { type: 'string' }, begruendung: { type: 'string' } },
        },
      },
      zuordnungen: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['notiz', 'art', 'grund', 'herkunft', 'fragen'],
          properties: {
            notiz: { type: 'integer' },
            art: { type: 'string', enum: [...ZUORDNUNGEN] },
            grund: { type: 'string' },
            herkunft: { type: 'string' },
            mission: { type: 'integer', description: 'nur bei art mission: Nummer der offenen Mission' },
            neue_mission: { type: 'string', description: 'nur bei art neue_mission: schluessel aus neue_missionen' },
            in: { type: 'integer', description: 'nur bei art zusammengefuehrt: die Notiz, die bleibt' },
            fundstelle: { type: 'string', description: 'bei art ueberfluessig: wo es erledigt, doppelt oder überholt ist' },
            fragen: FRAGEN_SCHEMA,
            abnahmekriterien: { ...ABNAHME_SCHEMA, description: `bei art mission und neue_mission ohne Frage beim Menschen: ${ABNAHME_SCHEMA.description}` },
            verifikationsweg: { ...VERIFIKATION_SCHEMA, description: `bei art mission und neue_mission ohne Frage beim Menschen: ${VERIFIKATION_SCHEMA.description}` },
          },
        },
      },
    },
  };
}

/**
 * What the model's plan allows: each note of the input exactly once, missions and notes only known ones,
 * the limits kept (neuMax: the new missions still free in this run), closing only with a reason. #146: a note
 * joining a mission without a question with the person carries its sections (they pass the order writer's
 * check), a closed one asks no question. Anything else is invalid as a whole and changes nothing.
 */
export function schnittplanAus(x: unknown, notizen: Ticket[], missionen: OffeneMission[], r: AuftragsRegeln, neuMax = NEUE_MISSIONEN_MAX): Schnittplan {
  const o = x as Record<string, unknown> | null;
  const nein = (fehler: string): Schnittplan => ({ art: 'ungueltig', fehler });
  if (!o || !Array.isArray(o.neue_missionen) || !Array.isArray(o.zuordnungen)) return nein('kein Schnittplan im Schema');
  const nummer = (v: unknown) => (Number.isInteger(v) ? (v as number) : undefined);
  const neu: NeueMission[] = [];
  for (const m of o.neue_missionen as Record<string, unknown>[]) {
    const schluessel = text(m?.schluessel);
    if (!schluessel || !text(m.titel) || !text(m.begruendung)) return nein('neue Mission ohne Schlüssel, Titel oder Begründung');
    if (neu.some((n) => n.schluessel === schluessel)) return nein(`neue Mission „${schluessel}“ doppelt`);
    neu.push({ schluessel, titel: text(m.titel), begruendung: text(m.begruendung), kinder: [] });
  }
  if (neu.length > neuMax) return nein(`mehr als ${neuMax} neue Missionen (${neu.length})`);
  const bekannt = new Set(notizen.map((t) => t.nummer));
  const zuordnungen: Zuordnung[] = [];
  for (const z of o.zuordnungen as Record<string, unknown>[]) {
    const notiz = nummer(z?.notiz);
    if (notiz === undefined || !bekannt.has(notiz)) return nein(`unbekannte Sternzeit-Notiz #${String(z?.notiz)}`);
    if (zuordnungen.some((y) => y.notiz === notiz)) return nein(`Sternzeit-Notiz #${notiz} doppelt zugeordnet`);
    if (!ZUORDNUNGEN.includes(z.art as never)) return nein(`Sternzeit-Notiz #${notiz} ohne gültige Art`);
    const grund = text(z.grund);
    zuordnungen.push({
      notiz,
      art: z.art as Zuordnungsart,
      grund,
      herkunft: text(z.herkunft) || `Eigenes Urteil: ${grund || 'ohne Angabe'}`,
      ...(z.art === 'mission' ? { mission: nummer(z.mission) } : {}),
      ...(z.art === 'neue_mission' ? { neue_mission: text(z.neue_mission) } : {}),
      ...(z.art === 'zusammengefuehrt' ? { in: nummer(z.in) } : {}),
      ...(z.art === 'ueberfluessig' ? { fundstelle: text(z.fundstelle) } : {}),
      fragen: fragenAus(z.fragen),
      ...(text(z.abnahmekriterien) ? { abnahmekriterien: text(z.abnahmekriterien) } : {}),
      ...(text(z.verifikationsweg) ? { verifikationsweg: text(z.verifikationsweg) } : {}),
    });
  }
  const fehlt = notizen.find((t) => !zuordnungen.some((z) => z.notiz === t.nummer));
  if (fehlt) return nein(`Sternzeit-Notiz #${fehlt.nummer} ohne Zuordnung`);
  const neueKinder = new Map<number, number>();
  for (const z of zuordnungen) {
    const nr = `Sternzeit-Notiz #${z.notiz}`;
    const frage = z.fragen.some((f) => f.beim_menschen);
    if (frage && GESCHLOSSEN.includes(z.art)) return nein(`${nr}: ${z.art}, aber eine Frage liegt beim Menschen`);
    if (!frage && (z.art === 'mission' || z.art === 'neue_mission')) {
      const t = notizen.find((t) => t.nummer === z.notiz)!;
      const e = ergaenzt(t.titel, t.body, z, r);
      if (e.fehler) return nein(`${nr}: abnahmekriterien oder verifikationsweg fehlt (${e.fehler.replace(/^[^\n]*\n- /, '')})`);
    }
    if (z.art === 'mission') {
      if (!missionen.some((m) => m.nummer === z.mission)) return nein(`${nr}: Mission #${z.mission ?? '?'} ist nicht offen, im Außeneinsatz oder unbekannt`);
      neueKinder.set(z.mission!, (neueKinder.get(z.mission!) ?? 0) + 1);
    } else if (z.art === 'neue_mission') {
      const m = neu.find((n) => n.schluessel === z.neue_mission);
      if (!m) return nein(`${nr}: neue Mission „${z.neue_mission}“ nicht im Plan`);
      m.kinder.push(z.notiz);
    } else if (z.art === 'zusammengefuehrt') {
      const ziel = zuordnungen.find((y) => y.notiz === z.in);
      if (!ziel || z.in === z.notiz || GESCHLOSSEN.includes(ziel.art)) return nein(`${nr}: zusammengeführt in #${z.in ?? '?'}, die nicht bleibt`);
    } else if (z.art === 'ueberfluessig' && (!z.grund || !z.fundstelle)) return nein(`${nr}: überflüssig ohne Grund oder Fundstelle`);
    else if (z.art === 'verworfen' && !z.grund) return nein(`${nr}: verworfen ohne Grund`);
  }
  for (const [nr, n] of neueKinder) {
    const m = missionen.find((m) => m.nummer === nr)!;
    if (m.kinder + n > KINDER_MAX) return nein(`Mission #${nr} hätte mehr als ${KINDER_MAX} Kinder (${m.kinder} + ${n})`);
  }
  for (const m of neu) {
    if (!m.kinder.length) return nein(`neue Mission „${m.schluessel}“ ohne Kinder`);
    if (m.kinder.length > KINDER_MAX) return nein(`neue Mission „${m.schluessel}“ hätte mehr als ${KINDER_MAX} Kinder (${m.kinder.length})`);
  }
  return { art: 'plan', neue_missionen: neu, zuordnungen };
}

/** Words of a title that name no topic. */
const FUELLWOERTER = new Set(['aber', 'alle', 'auch', 'beim', 'damit', 'dass', 'eine', 'einem', 'einen', 'einer', 'kein', 'keine', 'mehr', 'nach', 'nicht', 'noch', 'ohne', 'oder', 'sich', 'soll', 'statt', 'über', 'wenn', 'wird']);
const themenWoerter = (t: Ticket) => [
  ...new Set([
    ...t.titel.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !FUELLWOERTER.has(w)),
    ...t.labels.filter((l) => l !== TRIAGE_LABEL && l !== INFO_LABEL).map((l) => `label:${l}`),
  ]),
];
/** The share of a note in the order: its facts up to the limit per note, with its heading. */
const umfang = (t: Ticket) => t.titel.length + 30 + faktenAus(t, NOTIZ_MAX, '###').length;

/**
 * #146: the notes of a project in packages of one admiral call each. All in one while their facts fit the budget
 * of one order (NOTIZEN_GESAMT). Above it by topic, without a model: a note's topic is the word of its title (or
 * a label) most other notes share, but not more than half of all (such a word names no topic); whole topics are
 * packed into as few packages as fit, a topic larger than one package is cut in the order of its notes. Never a
 * package per note.
 */
export function pakete(notizen: Ticket[], budget = NOTIZEN_GESAMT): Ticket[][] {
  const groesse = (s: Ticket[]) => s.reduce((n, t) => n + umfang(t), 0);
  if (groesse(notizen) <= budget) return notizen.length ? [notizen] : [];
  const haeufig = new Map<string, number>();
  for (const t of notizen) for (const w of themenWoerter(t)) haeufig.set(w, (haeufig.get(w) ?? 0) + 1);
  const themen = new Map<string, Ticket[]>();
  for (const t of notizen) {
    const thema = themenWoerter(t).filter((w) => haeufig.get(w)! > 1 && haeufig.get(w)! <= Math.max(2, notizen.length / 2)).sort((a, b) => haeufig.get(b)! - haeufig.get(a)! || a.localeCompare(b))[0] ?? '';
    themen.set(thema, [...(themen.get(thema) ?? []), t]);
  }
  const stuecke: Ticket[][] = [];
  for (const liste of themen.values()) {
    let s: Ticket[] = [];
    for (const t of liste) {
      if (s.length && groesse(s) + umfang(t) > budget) {
        stuecke.push(s);
        s = [];
      }
      s.push(t);
    }
    stuecke.push(s);
  }
  // the largest topics first, each into the first package with room left
  const out: Ticket[][] = [];
  for (const s of stuecke.sort((a, b) => groesse(b) - groesse(a))) {
    const p = out.find((p) => groesse(p) + groesse(s) <= budget);
    if (p) p.push(...s);
    else out.push([...s]);
  }
  return out.map((p) => p.sort((a, b) => a.nummer - b.nummer));
}

export function schnittplanAuftrag(notizen: Ticket[], missionen: OffeneMission[], r: AuftragsRegeln, neuMax = NEUE_MISSIONEN_MAX): string {
  const jeNotiz = Math.min(NOTIZ_MAX, Math.floor(NOTIZEN_GESAMT / Math.max(1, notizen.length)));
  const jeMission = Math.min(MISSION_MAX, Math.floor(MISSIONEN_GESAMT / Math.max(1, missionen.length)));
  // #147: the free places spelled out; the limit alone in the text did not keep the model from overfilling
  const plaetze = (m: OffeneMission) => (m.kinder >= KINDER_MAX ? `${m.kinder} Kinder, voll, keine neuen Kinder` : `${m.kinder} Kinder, noch ${KINDER_MAX - m.kinder} frei`);
  const offen = missionen.length
    ? missionen.map((m) => `## Mission #${m.nummer}: ${m.titel} (${plaetze(m)})\n${m.body.trim().slice(0, jeMission) || '(leer)'}`).join('\n\n')
    : '(keine)';
  return `FLOTTE-SCHNITTPLAN
Du bist der Admiral der Flotte und schneidest alle offenen Sternzeit-Notizen eines Projekts zusammen und klärst sie dabei ohne Rückfrage, alle in diesem einen Aufruf; eine Einzelklärung danach gibt es nicht. Du änderst nichts: Du liest höchstens Dateien im Repository (ADRs in docs/adr, Adapter .claude/epic.md, CONTEXT.md, Code), um die Fakten zu prüfen. Das Programm prüft deinen Plan und schreibt; Tickets legt niemand an (agent-skills/ADR-0002).

Ordne jede Notiz unten genau einmal zu (art):
- mission: Kind einer offenen Mission unten, wenn sie thematisch passt und noch Plätze frei hat (mission = deren Nummer). Vorrang vor einer neuen Mission: Die offenen Missionen stammen oft aus früheren Läufen, neue Notizen gehören bevorzugt dorthin; eine neue Mission nur, wenn keine offene passt oder frei ist.
- neue_mission: Kind einer neuen Mission für ein Thema mit mehreren Notizen (neue_mission = schluessel aus neue_missionen, mit titel und begruendung). Eine einzelne Notiz wird nur dann eine eigene Mission, wenn sie nirgends passt und groß genug ist.
- zusammengefuehrt: Duplikat oder Teilstück derselben Sache wie eine andere Notiz (in = die Notiz, die bleibt und selbst mission, neue_mission oder triage ist). Sie wird mit Verweis geschlossen.
- ueberfluessig: schon erledigt, doppelt oder überholt; grund und fundstelle nennen wo. Sie wird geschlossen.
- verworfen: lohnt sich nicht oder passt nicht zur Richtung; grund nennt warum. Sie wird als „not planned“ geschlossen, nicht gelöscht.
- triage: bleibt in der Triage, weil eine Frage beim Menschen liegt oder sie zu dünn ist; grund nennt was fehlt.

Grenzen: höchstens ${neuMax} neue Missionen, eine Mission höchstens ${KINDER_MAX} Kinder (vorhandene zählen mit; die freien Plätze stehen bei jeder offenen Mission, alle Notizen dieses Plans zusammen dürfen sie nicht überschreiten). Aus einer Notiz entsteht nie ein neues Ticket; die Notiz selbst wird das Kind. Fehlt eine Notiz, steht eine doppelt oder ist eine Grenze überschritten, verwirft das Programm den ganzen Plan.

Kläre jede Notiz in derselben Antwort. ${FRAGERUNDE}

Je Zuordnung dazu:
- fragen: die Fragen der Fragerunde zu dieser Notiz mit deiner Antwort. Liegt eine beim Menschen, gehen nur diese gebündelt mit optionen und deiner Empfehlung als Kommentar an die Notiz; sie bleibt in der Triage und kommt erst nach seiner Antwort in ihre Mission. Eine Notiz, die geschlossen wird (zusammengefuehrt, ueberfluessig, verworfen), hat keine Frage beim Menschen.
- abnahmekriterien, verifikationsweg: bei mission und neue_mission ohne Frage beim Menschen. ${abschnitte(r)} Das Programm ergänzt den Text der Notiz damit (der bisherige Text bleibt stehen) und prüft ihn wie der Auftragsschreiber; fehlt dann ein Abschnitt, verwirft es den Plan.

herkunft gilt je Zuordnung, jede Frage hat ihre eigene. ${HERKUNFT_REGEL}

Antworte nur über das Schema.

# Offene Missionen

${offen}

# Sternzeit-Notizen

${notizen.map((t) => `## Sternzeit-Notiz #${t.nummer}: ${t.titel}\n${faktenAus(t, jeNotiz, '###')}`).join('\n\n')}`;
}

/** The comment that stands at a note before the triage closes it after the cut plan. */
export function schnittplanKommentar(z: Zuordnung): string {
  const zeilen =
    z.art === 'zusammengefuehrt'
      ? [kopf(`zusammengeführt in #${z.in}`), '', `Zusammengeführt in #${z.in}: Duplikat oder Teilstück derselben Sache.`, ...(z.grund ? [`Grund: ${z.grund}`] : [])]
      : z.art === 'ueberfluessig'
        ? [kopf('geschlossen, überflüssig'), '', `Grund: ${z.grund}`, `Fundstelle: ${z.fundstelle}`]
        : [kopf('geschlossen, verworfen (not planned)'), '', `Grund: ${z.grund}`];
  zeilen.push(`Herkunft: ${z.herkunft}`, '', 'Aus dem Schnittplan über alle offenen Sternzeit-Notizen dieses Projekts.');
  zeilen.push('', 'Widerrufbar: das Ticket wieder öffnen und den Einwand als Kommentar schreiben; es trägt seine Labels noch und kommt in die nächste Triage.');
  return zeilen.join('\n');
}

/** #147: the one repair call after an invalid plan: the same order, the error and the answer, correct only that. */
export function schnittplanReparatur(auftrag: string, fehler: string, antwort: unknown): string {
  return `${auftrag}

# Korrektur

Dein Plan oben war ungültig: ${fehler}
Deine Antwort war:
${JSON.stringify(antwort)}

Korrigiere nur das und gib den ganzen Plan noch einmal über das Schema zurück; alles andere bleibt, wie du es entschieden hast.`;
}

/** #147: a note's way into a mission in the comments: `Mission #40 „Tafel“` or `neue Mission „Portprüfung“`. */
export function missionsName(m: { nummer?: number; titel: string }): string {
  return m.nummer === undefined ? `neue Mission „${m.titel}“` : `Mission #${m.nummer} „${m.titel}“`;
}

/**
 * #147: the comment at a clear note before it changes: the decision, its place in the cut plan, the sections
 * appended (the text that was there stays), then joined to the mission and Warp frei.
 */
export function schnittplanKlarKommentar(e: Extract<Entscheidung, { art: 'klar' }>, z: Zuordnung, mission: string, entfernt: string[], ready: string): string {
  const zeilen = [kopf(`Missionsziel von ${mission}, Warp frei`), '', `Schnittplan: Missionsziel von ${mission}${z.grund ? ` — ${z.grund}` : ''}`, `Herkunft: ${z.herkunft}`];
  if (e.fragen.length) zeilen.push('', 'Entscheidungen:', ...entscheidungsListe(e.fragen));
  if (e.nachgetragen.length) {
    zeilen.push('', 'Ergänzt, vom Admiral aus den Fakten des Tickets (der bisherige Text bleibt unverändert stehen):');
    for (const k of e.nachgetragen) zeilen.push('', k, (abschnittInhalt(e.body, k) ?? '').trim());
  }
  zeilen.push('', `Danach: an ${mission} angehängt (Sub-Issue und Liste \`## Missionsziele\`), Labels: ${entfernt.map((l) => `\`${l}\``).join(', ')} ab, \`${ready}\` dazu.`);
  zeilen.push('', 'Widerrufbar: setz `needs-triage` wieder und schreib den Einwand als Kommentar; die nächste Triage nimmt ihn als Tatsache.');
  return zeilen.join('\n');
}

/** #147: heading of the comment at a mission the triage created (neueMissionKommentar) */
const NEUE_MISSION_KOPF = 'Mission aus dem Schnittplan';

/** #147: the comment at a mission the triage created from the cut plan, right after it exists. */
export function neueMissionKommentar(m: NeueMission, kinder: Ticket[], spaeter: Ticket[], ready: string): string {
  const zeilen = [kopf(NEUE_MISSION_KOPF), '', `Titel: ${m.titel}`, `Begründung: ${m.begruendung}`];
  zeilen.push(`Herkunft: Eigenes Urteil des Admirals im Schnittplan über alle offenen Sternzeit-Notizen dieses Projekts; angelegt vom Auftragsschreiber (agent-skills/ADR-0002).`);
  zeilen.push(`Warp frei: Die Mission bekommt \`${ready}\` erst, wenn ihr erstes Missionsziel freigegeben ist; gelingt das nicht, bleibt sie ohne und startet keinen Außeneinsatz.`);
  zeilen.push('', 'Missionsziele (die Sternzeit-Notizen selbst, kein neues Ticket):', ...kinder.map((t) => `- #${t.nummer} ${t.titel}`));
  if (spaeter.length) zeilen.push('', 'Kommen später dazu, sobald ihre Frage beantwortet ist:', ...spaeter.map((t) => `- #${t.nummer} ${t.titel}`));
  zeilen.push('', `Widerrufbar: an dieser Mission \`${ready}\` abnehmen und den Einwand hier als Kommentar schreiben; dann startet kein Außeneinsatz.`);
  return zeilen.join('\n');
}

/**
 * #149: the triage created this mission: an entitled comment of the triage with the heading of neueMissionKommentar
 * stands at it (its body comes from the order writer, like that of a mission a person orders), and no entitled
 * comment without the marks of the triage follows it: an objection or a revocation there leaves the mission alone.
 */
export function vonDerTriageAngelegt(t: Ticket): boolean {
  const i = t.kommentare.findIndex((k) => berechtigt(k) && k.body.includes(TRIAGE_MARKE) && (k.body.split(/\r?\n/)[1] ?? '').startsWith(`**Triage: ${NEUE_MISSION_KOPF}**`));
  return i >= 0 && !t.kommentare.slice(i + 1).some((k) => berechtigt(k) && !k.body.includes(TRIAGE_MARKE) && !k.body.includes(TRIAGE_FRAGE_MARKE));
}

/** #149: the comment at a mission of the triage before ready_label is set on it later. */
export function nachfreigabeKommentar(kinder: number[], ready: string): string {
  return [
    `${TRIAGE_MARKE}\n**Triage: Warp frei der Mission nachgeholt** — vom Programm (\`flotte triage\`)`,
    '',
    `Herkunft: Regel der Triage (#147): Eine Mission aus dem Schnittplan bekommt \`${ready}\` mit ihrem ersten freigegebenen Missionsziel. Das Setzen an der Mission war gescheitert; ein späterer Lauf holt es nach (#149).`,
    `Freigegebene Missionsziele: ${kinder.map((n) => `#${n}`).join(', ')}`,
    '',
    `Danach: \`${ready}\` an dieser Mission.`,
    '',
    `Widerrufbar: an dieser Mission \`${ready}\` abnehmen und den Einwand hier als Kommentar schreiben; dann startet kein Außeneinsatz, und keine Triage setzt es wieder.`,
  ].join('\n');
}

/** #147: the comment at an open mission before notes join it. */
export function missionAnhaengenKommentar(neu: { t: Ticket; zu: Zuordnung }[], ready: string): string {
  const zeilen = [kopf(`${neu.length === 1 ? 'ein neues Missionsziel' : `${neu.length} neue Missionsziele`} aus dem Schnittplan`), ''];
  for (const { t, zu: z } of neu) zeilen.push(`- #${t.nummer} ${t.titel}${z.grund ? ` — ${z.grund}` : ''}`, `  Herkunft: ${z.herkunft}`);
  zeilen.push('', `Sie werden als Sub-Issue verknüpft und in die Liste \`## Missionsziele\` eingetragen (\`- [ ] #<nr> <Titel>\`), danach bekommen sie \`${ready}\`.`);
  zeilen.push('', 'Widerrufbar: an der Notiz `needs-triage` wieder setzen und den Einwand dort als Kommentar schreiben.');
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
