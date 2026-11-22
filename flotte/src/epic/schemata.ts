// The JSON schemata of the four language-model points (#69, decision 4), handed to
// `claude -p --json-schema`. Each is built from its type in schema.ts: `objekt<T>` wants a schema for
// every key of T and no other (the compiler checks), and every key is required unless T has it as
// optional. Version 1 is the version of the outputs (schema.ts); a change of a type that breaks an
// output raises both.

import type { Befund, ImplementerBericht, KonfliktBericht, Paket, ReviewerBericht, Rolle, Schnitt, TorOption, TorPunkt, Uebersprungen, Volllauf, Zuordnung } from './schema.ts';

export type JsonSchema = Record<string, unknown>;

/** the keys T has as optional */
export type Optional<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T];

export function objekt<T>(properties: { [K in keyof T]-?: JsonSchema }, optional: Optional<T>[] = []): JsonSchema {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties).filter((k) => !(optional as string[]).includes(k)), properties };
}

const text: JsonSchema = { type: 'string' };
const ja: JsonSchema = { type: 'boolean' };
const zahl: JsonSchema = { type: 'integer' };
const liste = (items: JsonSchema, minItems = 0): JsonSchema => ({ type: 'array', items, ...(minItems ? { minItems } : {}) });
const texte = liste(text);
const wahl = (...werte: string[]): JsonSchema => ({ type: 'string', enum: werte });
export const VERSION = 1;
const version: JsonSchema = { type: 'integer', enum: [VERSION] };

const paket = objekt<Paket>({
  nr: text,
  titel: text,
  klasse: wahl('mechanisch', 'standard', 'urteil'),
  abnahme: liste(text, 1),
  decisions: texte,
  outOfScope: texte,
  testing: texte,
  verifikation: text,
  lektuere: texte,
  dateien: texte,
  nach: texte,
  kollision: texte,
  exklusiv: ja,
});

const option = objekt<TorOption>({ text, abbruch: ja }, ['abbruch']);

const torPunkt = objekt<TorPunkt>({
  frage: text,
  betrifft: { anyOf: [wahl('Lauf'), liste(text, 1)] },
  lage: text,
  optionen: liste(option, 1),
  empfehlung: text,
  grund: text,
  quelle: text,
});

const schnitt = objekt<Schnitt>({
  version,
  modus: wahl('tickets', 'spec'),
  pakete: liste(paket, 1),
  zuordnung: liste(objekt<Zuordnung>({ story: text, paket: text }), 1),
  uebersprungen: liste(objekt<Uebersprungen>({ nr: text, grund: text, blocker: texte })),
  tor: liste(torPunkt),
});

const implementer = objekt<ImplementerBericht>({
  version,
  dateien: texte,
  neueDateien: texte,
  abnahme: liste(objekt<ImplementerBericht['abnahme'][number]>({ punkt: text, satz: text })),
  volllauf: liste(objekt<Volllauf>({ suite: text, dateien: zahl, tests: zahl, gruen: ja })),
  nichtGekonnt: texte,
  fremdarbeit: texte,
  betreff: text,
  warum: text,
});

const reviewer = objekt<ReviewerBericht>({
  version,
  befunde: liste(objekt<Befund>({ gruppe: wahl('muss', 'sollte', 'kann'), fundstelle: text, text })),
  strukturell: ja,
  schnittstelle: text,
  selbstkorrekturen: texte,
});

const konflikt = objekt<KonfliktBericht>({ version, ergebnis: wahl('geloest', 'inhaltlich'), begruendung: text });

export const SCHEMATA: Record<Rolle, JsonSchema> = { schnitt, implementer, reviewer, konflikt };
