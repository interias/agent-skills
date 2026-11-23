// Stage 3 of #69 (#67): the cut checked by the program, the JSON schemata against the types, the
// orders of 4a/4b, the commit of 4d, the gate block after a restart, the real calls (through the
// stand-in for claude -p) and the line to the driver of a direct run.

import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aufrufen } from '../src/aufruf.ts';
import { dateiLeitung, wartetNurAufAntwort } from '../src/befehle/epic.ts';
import { attrappe, neueWelt, type EpicDrehbuch } from '../src/epic/attrappe.ts';
import { echteAufrufe } from '../src/epic/aufrufe.ts';
import { commitNachricht, implementerAuftrag, modellName, reviewerAuftrag, schnittAuftrag, konfliktAuftrag, type Kontext } from '../src/epic/auftraege.ts';
import { echteMechanik } from '../src/epic/mechanik.ts';
import { fahreEpic, type EpicEinstellung } from '../src/epic/motor.ts';
import { abdeckungFehler, pruefeAusgabe, type ImplementerBericht, type KonfliktBericht, type Paket, type ReviewerBericht, type Rolle, type Schnitt, type TorPunkt } from '../src/epic/schema.ts';
import { SCHEMATA, type JsonSchema } from '../src/epic/schemata.ts';
import { zaehle } from '../src/epic/zaehlen.ts';
import { epicDir, neuerLauf, neuesPaket, schreibeLauf } from '../src/epic/zustand.ts';
import { leseBlock } from '../src/werkzeuge/bloecke.ts';
import { ATTRAPPE, drehbuch } from './attrappe.ts';
import { ADAPTER, fixture } from './epic-fixture.ts';

const T = 60_000;

const paket = (nr: string, o: Partial<Paket> = {}): Paket => ({ nr, titel: `Paket ${nr}`, klasse: 'standard', abnahme: [`${nr} tut, was es soll`], decisions: [], outOfScope: [], testing: [], verifikation: '', lektuere: [], dateien: [`src/p${nr}.ts`], nach: [], kollision: [], exklusiv: false, ...o });
const zu = (pakete: Paket[]) => pakete.map((p) => ({ story: `#${p.nr}`, paket: p.nr }));
const schnitt = (o: Partial<Schnitt> = {}): Schnitt => {
  const pakete = o.pakete ?? [paket('1'), paket('2', { nach: ['1'] })];
  return { version: 1, modus: 'tickets', pakete, zuordnung: zu(pakete), uebersprungen: [], tor: [], ...o };
};

function neuesRepo(): string {
  const r = mkdtempSync(join(tmpdir(), 'flotte-epic3-'));
  aufrufen('git', ['init', '-q', r]);
  return r;
}

const einstellung = (repo: string, o: Partial<EpicEinstellung> = {}): EpicEinstellung => ({ repo, epic: 69, epicBranch: 'epic/69-programm', basis: 'origin/main', fenster: 3, maxRunden: 3, konto: '/konten/2', ...o });

describe('Schnittprüfung durch das Programm (#67)', () => {
  it('every story goes to exactly one package; a package without story, an unknown package, a child at another package are invalid', () => {
    const pakete = [paket('1'), paket('2')];
    expect(pruefeAusgabe('schnitt', schnitt({ pakete }))).toBeNull();
    expect(pruefeAusgabe('schnitt', { ...schnitt({ pakete }), zuordnung: [] })).toBe('zuordnung fehlt oder ist leer');
    expect(pruefeAusgabe('schnitt', { ...schnitt({ pakete }), zuordnung: [...zu(pakete), { story: '#1', paket: '2' }] })).toBe('zuordnung: #1 steht bei den Paketen 1 und 2, jede Story gehört genau einem Paket');
    expect(pruefeAusgabe('schnitt', { ...schnitt({ pakete }), zuordnung: [...zu(pakete), { story: '#1', paket: '1' }] })).toBe('zuordnung: #1 steht doppelt, jede Story gehört genau einem Paket');
    expect(pruefeAusgabe('schnitt', { ...schnitt({ pakete }), zuordnung: [{ story: '#1', paket: '1' }] })).toBe('Paket 2 hat keine Story in der Zuordnung');
    expect(pruefeAusgabe('schnitt', { ...schnitt({ pakete }), zuordnung: [...zu(pakete), { story: '#3', paket: '3' }] })).toBe('zuordnung: #3 geht an das unbekannte Paket 3');
    // mode tickets: each workable child is its own package
    expect(pruefeAusgabe('schnitt', { ...schnitt({ pakete }), zuordnung: [{ story: '#1', paket: '2' }, { story: '#2', paket: '1' }] })).toBe('zuordnung: im Modus tickets ist jedes Missionsziel sein eigenes Paket, #1 geht an 2');
    // mode spec: several stories may go to one package
    const spec = [paket('69-p1'), paket('69-p2', { nach: ['69-p1'] })];
    expect(pruefeAusgabe('schnitt', { ...schnitt({ pakete: spec, modus: 'spec' }), zuordnung: [{ story: 'Als Admiral sehe ich …', paket: '69-p1' }, { story: 'Als Mensch prüfe ich …', paket: '69-p1' }, { story: 'Als Treiber lese ich …', paket: '69-p2' }] })).toBeNull();
  });

  it('no package without acceptance list (also one of blank lines), no cut without mode; the graph stays checked', () => {
    expect(pruefeAusgabe('schnitt', schnitt({ pakete: [paket('1', { abnahme: ['  '] })] }))).toBe('pakete[0] hat keine Abnahmeliste');
    expect(pruefeAusgabe('schnitt', { ...schnitt(), modus: 'beides' })).toBe('modus ist nicht tickets oder spec');
    expect(pruefeAusgabe('schnitt', schnitt({ pakete: [paket('1', { nach: ['2'] }), paket('2', { nach: ['1'] })] }))).toBe('Zyklus über harte Kanten: 1 → 2 → 1');
  });

  it('a cut whose stories are not covered: one --resume with the error, then FLOTTE-ENDE', async () => {
    const pakete = [paket('201'), paket('202')];
    const u = attrappe({ schnitt: { version: 1, pakete, tor: [], modus: 'tickets', zuordnung: [{ story: '#201', paket: '201' }] } });
    const z = await fahreEpic(einstellung(neuesRepo()), u);
    expect(u.welt.aufrufe.map((a) => [a.rolle, a.resume])).toEqual([
      ['schnitt', null],
      ['schnitt', 's-schnitt-0'],
    ]);
    expect(u.welt.aufrufe[1].auftrag).toMatch(/Paket 202 hat keine Story in der Zuordnung/);
    expect(z.phase).toBe('abgebrochen');
    expect(leseBlock(u.welt.bloecke[u.welt.bloecke.length - 1])).toMatchObject({ art: 'ende', pr: null });
    // every invalid output stands in the log (#68)
    expect(z.ereignisse.filter((e) => e.art === 'ungueltig').map((e) => [e.rolle, e.text])).toEqual([
      ['schnitt', 'schnitt ungültig: Paket 202 hat keine Story in der Zuordnung'],
      ['schnitt', 'schnitt ungültig: Paket 202 hat keine Story in der Zuordnung'],
    ]);
  }, T);

  it('against the issue, mode tickets: every child of the epic is a package or skipped with its reason, never neither, never both', () => {
    const body = '> **Reihenfolge:** Kinder: #301, #302, #303\n\n## Was\nx';
    const pakete = [paket('301'), paket('302')];
    expect(abdeckungFehler(schnitt({ pakete }), body)).toBe('Missionsziel #303 der Mission steht weder in zuordnung noch in uebersprungen');
    expect(abdeckungFehler(schnitt({ pakete, uebersprungen: [{ nr: '303', grund: 'blockiert durch #9', blocker: ['9'] }] }), body)).toBeNull();
    expect(abdeckungFehler(schnitt({ pakete, uebersprungen: [{ nr: '#302', grund: 'g', blocker: [] }, { nr: '303', grund: 'g', blocker: [] }] }), body)).toBe('Missionsziel #302 steht in zuordnung und in uebersprungen');
    // a body that names no child gives nothing to check
    expect(abdeckungFehler(schnitt({ pakete }), '## Was\nx')).toBeNull();
    // the form of uebersprungen
    expect(pruefeAusgabe('schnitt', schnitt({ pakete, uebersprungen: [{ nr: '301', grund: 'g', blocker: [] }] }))).toBe('uebersprungen: 301 ist zugleich ein Paket');
    expect(pruefeAusgabe('schnitt', schnitt({ pakete, uebersprungen: [{ nr: '303', grund: ' ', blocker: [] }] }))).toBe('uebersprungen[0] unvollständig');
  });

  it('against the issue, mode spec: as many distinct stories as the section User Stories has entries', () => {
    const body = '## User Stories\n1. Als Admiral sehe ich den Stand.\n2. Als Mensch prüfe ich den Schnitt.\n   - Unterpunkt zählt nicht\n3. Als Treiber lese ich den Block.\n\n## Implementation Decisions\n- d';
    const pakete = [paket('69-p1'), paket('69-p2')];
    const vier = schnitt({ modus: 'spec', pakete, zuordnung: [{ story: '1', paket: '69-p1' }, { story: '2', paket: '69-p2' }] });
    expect(abdeckungFehler(vier, body)).toBe('Das Issue hat 3 User Stories, die Zuordnung nennt 2; jede Story gehört genau einem Paket');
    expect(abdeckungFehler({ ...vier, zuordnung: [...vier.zuordnung, { story: '3', paket: '69-p2' }] }, body)).toBeNull();
    expect(abdeckungFehler(vier, '## Was\nohne Stories')).toBeNull();
  });

  it('a cut that leaves out a child: --resume with the error; skipped children get their comment and, when blocked, status/blockiert', async () => {
    const body = '> **Reihenfolge:** Kinder: #311, #312, #313';
    const pakete = [paket('311')];
    const fehlt = attrappe({ schnitt: { version: 1, pakete, tor: [], uebersprungen: [{ nr: '312', grund: 'ohne ready-for-agent', blocker: [] }] }, bodies: { 69: body } });
    expect((await fahreEpic(einstellung(neuesRepo()), fehlt)).phase).toBe('abgebrochen');
    expect(fehlt.welt.aufrufe[1].auftrag).toMatch(/Missionsziel #313 der Mission steht weder in zuordnung noch in uebersprungen/);
    const ganz = attrappe({ schnitt: { version: 1, pakete, tor: [], uebersprungen: [{ nr: '312', grund: 'ohne ready-for-agent; das Label schaltet es frei', blocker: [] }, { nr: '#313', grund: 'wartet auf #9', blocker: ['9'] }] }, bodies: { 69: body } });
    const z = await fahreEpic(einstellung(neuesRepo()), ganz);
    expect(z.phase).toBe('fertig');
    expect(ganz.welt.kommentare[312]?.[0]).toMatch(/^\*\*Übersprungen\*\* #312: .*Grund: ohne ready-for-agent; das Label schaltet es frei[^]*flotte-epic:69:312:uebersprungen/);
    expect(ganz.welt.kommentare[313]?.[0]).toMatch(/Blockiert durch #9\./);
    expect(ganz.welt.status[313]).toBe('status/blockiert');
    expect(ganz.welt.status[312]).toBeUndefined();
  }, T);

  it('children linked only as sub-issues (dependency_source api) count too, with the children of the body; a read error is no silent skip', async () => {
    const pakete = [paket('331'), paket('332')];
    // sub-issue #333 and #334 in neither list: error; the body names none
    expect(abdeckungFehler(schnitt({ pakete }), '## Was\nx', [331, 332, 333])).toBe('Missionsziel #333 der Mission steht weder in zuordnung noch in uebersprungen');
    expect(abdeckungFehler(schnitt({ pakete, uebersprungen: [{ nr: '333', grund: 'g', blocker: [] }] }), '## Was\nx', [331, 332, 333])).toBeNull();
    // union with the body: a child only in the body is checked as before
    expect(abdeckungFehler(schnitt({ pakete }), 'Kinder: #331, #335', [332])).toBe('Missionsziel #335 der Mission steht weder in zuordnung noch in uebersprungen');
    const fehlt = attrappe({ schnitt: { version: 1, pakete, tor: [] }, unterIssues: { 69: [331, 332, 333] } });
    expect((await fahreEpic(einstellung(neuesRepo()), fehlt)).phase).toBe('abgebrochen');
    expect(fehlt.welt.aufrufe[1].auftrag).toMatch(/Missionsziel #333 der Mission steht weder in zuordnung noch in uebersprungen/);
    const ganz = attrappe({ schnitt: { version: 1, pakete, tor: [], uebersprungen: [{ nr: '333', grund: 'g', blocker: [] }] }, unterIssues: { 69: [331, 332, 333] } });
    expect((await fahreEpic(einstellung(neuesRepo()), ganz)).phase).toBe('fertig');
    // a read error of the API stops like a read error of the body
    const kaputt = attrappe({ schnitt: { version: 1, pakete, tor: [] } });
    const echt = { ...kaputt.mechanik, unterIssues: async () => { throw new Error('gh api sub_issues: Exit 1'); } };
    await expect(fahreEpic(einstellung(neuesRepo()), { ...kaputt, mechanik: echt })).rejects.toThrow('sub_issues');
  }, T);

  it('an invalid implementer output is an event too', async () => {
    const u = attrappe({ schnitt: { version: 1, pakete: [paket('320')], tor: [] }, aufrufe: { 'implementer:320': [{ ohneAusgabe: true }, {}] } });
    const z = await fahreEpic(einstellung(neuesRepo()), u);
    expect(z.ereignisse.filter((e) => e.art === 'ungueltig').map((e) => [e.paket, e.rolle, e.text])).toEqual([['320', 'implementer', 'implementer ungültig: keine strukturierte Ausgabe']]);
    expect(z.pakete['320'].stufe).toBe('fertig');
  }, T);
});

// ---- JSON schemata against the types

/** a subset of JSON Schema: type, enum, anyOf, properties, required, additionalProperties, items, minItems, minimum */
function verstoss(s: JsonSchema, x: unknown, pfad = '$'): string | null {
  if (Array.isArray(s.anyOf)) return (s.anyOf as JsonSchema[]).some((t) => !verstoss(t, x, pfad)) ? null : `${pfad}: keine Variante`;
  if (Array.isArray(s.enum) && !s.enum.includes(x)) return `${pfad}: nicht in ${JSON.stringify(s.enum)}`;
  if (s.type === 'string') return typeof x === 'string' ? null : `${pfad}: kein Text`;
  if (s.type === 'boolean') return typeof x === 'boolean' ? null : `${pfad}: kein Wahrheitswert`;
  if (s.type === 'integer') return Number.isInteger(x) && (x as number) >= ((s.minimum as number) ?? -Infinity) ? null : `${pfad}: keine Zahl`;
  if (s.type === 'array') {
    if (!Array.isArray(x) || x.length < ((s.minItems as number) ?? 0)) return `${pfad}: keine Liste oder zu kurz`;
    for (const [i, y] of x.entries()) {
      const f = verstoss(s.items as JsonSchema, y, `${pfad}[${i}]`);
      if (f) return f;
    }
    return null;
  }
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return `${pfad}: kein Objekt`;
  const props = s.properties as Record<string, JsonSchema>;
  for (const k of s.required as string[]) if (!(k in x)) return `${pfad}.${k} fehlt`;
  for (const [k, v] of Object.entries(x)) {
    if (!(k in props)) return `${pfad}.${k} ist zu viel`;
    const f = verstoss(props[k], v, `${pfad}.${k}`);
    if (f) return f;
  }
  return null;
}

/** every key of the full sample is a property of the schema and the other way round, all the way down */
function schluesselGleich(s: JsonSchema, x: unknown, pfad = '$'): string[] {
  if (Array.isArray(s.anyOf)) return [];
  if (s.type === 'array') return (s.items as JsonSchema).type !== 'object' ? [] : Array.isArray(x) && x.length ?schluesselGleich(s.items as JsonSchema, x[0], `${pfad}[]`) : [`${pfad}: Beispiel ohne Eintrag`];
  if (s.type !== 'object') return [];
  const props = s.properties as Record<string, JsonSchema>;
  const a = Object.keys(props).sort().join(',');
  const b = Object.keys(x as object).sort().join(',');
  return [...(a === b ? [] : [`${pfad}: Schema ${a} ≠ Typ ${b}`]), ...Object.keys(props).flatMap((k) => schluesselGleich(props[k], (x as Record<string, unknown>)[k], `${pfad}.${k}`))];
}

// full samples: every key of every type is set, also the optional ones (the compiler checks the types)
const torVoll: TorPunkt = { frage: 'Weiter?', betrifft: ['1'], lage: 'x', optionen: [{ text: 'ja' }, { text: 'nein', abbruch: true }], empfehlung: 'A', grund: 'g', quelle: 'Skill mission, 2c' };
const BEISPIELE: { [R in Rolle]: Exclude<unknown, undefined> } = {
  schnitt: { version: 1, modus: 'tickets', pakete: [paket('1', { decisions: ['d'], outOfScope: ['o'], testing: ['t'], lektuere: ['l'], verifikation: 'v' })], zuordnung: [{ story: '#1', paket: '1' }], uebersprungen: [{ nr: '#2', grund: 'ohne ready-for-agent; das Label schaltet es frei', blocker: ['9'] }], tor: [{ ...torVoll, optionen: [{ text: 'nein', abbruch: true }] }] } satisfies Schnitt,
  implementer: { version: 1, dateien: ['a'], neueDateien: ['b'], abnahme: [{ punkt: 'p', satz: 's' }], volllauf: [{ suite: 'gate', dateien: 0, tests: 2, gruen: true }], nichtGekonnt: ['n'], fremdarbeit: ['f'], betreff: 'feat: x (#1)', warum: 'w' } satisfies ImplementerBericht,
  reviewer: { version: 1, befunde: [{ gruppe: 'muss', fundstelle: 'a.ts:1', text: 't' }], strukturell: false, schnittstelle: 's', selbstkorrekturen: ['k'] } satisfies ReviewerBericht,
  konflikt: { version: 1, ergebnis: 'geloest', begruendung: 'b' } satisfies KonfliktBericht,
};

describe('JSON-Schemata und Typen (#67, Entscheidung 4)', () => {
  it('each schema names exactly the keys of its type, all required except the optional ones; version 1', () => {
    for (const rolle of Object.keys(SCHEMATA) as Rolle[]) {
      const s = SCHEMATA[rolle];
      expect(schluesselGleich(s, BEISPIELE[rolle]), rolle).toEqual([]);
      expect(s.required, rolle).toEqual(Object.keys(s.properties as object));
      expect((s.properties as Record<string, JsonSchema>).version).toEqual({ type: 'integer', enum: [1] });
    }
    const props = (s: JsonSchema) => s.properties as Record<string, JsonSchema>;
    const option = props(props(SCHEMATA.schnitt).tor.items as JsonSchema).optionen.items as JsonSchema;
    expect(option.required).toEqual(['text']);
  });

  it('what the schema takes the program takes, and the other way round: a missing key, a wrong group, a second version', () => {
    for (const rolle of Object.keys(SCHEMATA) as Rolle[]) {
      expect(verstoss(SCHEMATA[rolle], BEISPIELE[rolle]), rolle).toBeNull();
      expect(pruefeAusgabe(rolle, BEISPIELE[rolle]), rolle).toBeNull();
      for (const k of SCHEMATA[rolle].required as string[]) {
        const ohne = { ...(BEISPIELE[rolle] as Record<string, unknown>) };
        delete ohne[k];
        expect(verstoss(SCHEMATA[rolle], ohne), `${rolle} ohne ${k}`).not.toBeNull();
        expect(pruefeAusgabe(rolle, ohne), `${rolle} ohne ${k}`).not.toBeNull();
      }
    }
    const falsch = { ...(BEISPIELE.reviewer as ReviewerBericht), befunde: [{ gruppe: 'blocker', fundstelle: 'a', text: 't' }] };
    expect(verstoss(SCHEMATA.reviewer, falsch)).not.toBeNull();
    expect(pruefeAusgabe('reviewer', falsch)).not.toBeNull();
    expect(verstoss(SCHEMATA.konflikt, { ...(BEISPIELE.konflikt as object), version: 2 })).not.toBeNull();
    expect(pruefeAusgabe('konflikt', { ...(BEISPIELE.konflikt as object), version: 2 })).not.toBeNull();
  });
});

// ---- orders of 4a and 4b, the commit of 4d

const ADAPTER3 = `---
must_read: [AGENTS.md, README.md]
glossary: CONTEXT.md
adr_dir: docs/adr
test_isolation_env: APP_TEST_NR
worktree_may_start: [dev_server, compose]
commit_style: conventional
commit_language: de
commit_umlauts: transliterate
test_commands:
  flotte: cd flotte && bun test
lint_commands:
  flotte: cd flotte && bunx tsc -p .
---

# Projektregeln
`;

function kontext(o: Partial<Kontext> = {}): Kontext {
  return { epic: 69, epicBranch: 'epic/69-programm', epicWorktree: '/wt/epic-69', adapter: ADAPTER3, graph: '/git/epic-graph/epic-69/graphify-out/graph.json', basis: [{ name: 'flotte', dateien: 25, tests: 314, rot: [] }], basisLint: { 'flotte/src/epic/motor.ts': 2, 'andere/x.ts': 9 }, ...o };
}

const urteilspaket = paket('67', {
  titel: 'Sprachmodell-Punkte',
  klasse: 'urteil',
  abnahme: ['Der Graph hat keinen Zyklus.', 'Kein Paket ohne Abnahmeliste.'],
  decisions: ['Aufrufe über das Modul lauf — nicht nachbauen, weil der Treiber es schon trägt.'],
  outOfScope: ['Slot-Fahrt in 4c'],
  testing: ['Attrappe hinter Aufrufe, Vorbild test/epic-drehbuecher.test.ts'],
  verifikation: 'cd flotte && bun test',
  lektuere: ['docs/adr/0003-wortschatz.md'],
  dateien: ['flotte/src/epic/motor.ts'],
  nach: ['66'],
});

function stand(o: Partial<ReturnType<typeof neuesPaket>> = {}) {
  return { ...neuesPaket(urteilspaket), worktree: '/wt/67', port: 4067, isolation: 'APP_TEST_NR=67', ...o };
}

describe('Aufträge nach mission/SKILL.md 4a und 4b (#67)', () => {
  it('implementer: worktree with port and isolation, acceptance list word for word, decisions, out of scope, testing, numbers, interface, reading, graph, rules with origin, targeted then once full, report form', () => {
    const t = implementerAuftrag(kontext(), urteilspaket, stand(), { vorgaenger: ['`Aufrufe { rufe(a), kontoFrei() }`'], torAntworten: ['Konto 2? → A'] });
    for (const teil of [
      'Ingenieur (`ingenieur-urteil`) für Paket 67 „Sprachmodell-Punkte“',
      'Worktree: `/wt/67`',
      'Port: 4067, Isolation: APP_TEST_NR=67 (Variable `APP_TEST_NR`',
      '- Der Graph hat keinen Zyklus.\n- Kein Paket ohne Abnahmeliste.',
      'nicht nachbauen, weil der Treiber es schon trägt',
      '- Slot-Fahrt in 4c',
      'Vorbild test/epic-drehbuecher.test.ts',
      'Ausgangszahlen (Phase 0, Missions-Worktree): flotte 314 Tests in 25 Dateien, 0 rot.',
      'Schnittstelle des Vorgängers (vom Ersten Offizier festgehalten, wörtlich — was tatsächlich dasteht):\n`Aufrufe { rufe(a), kontoFrei() }`',
      'Am Vorab-Tor entschieden: Konto 2? → A',
      'must_read (Adapter): AGENTS.md, README.md',
      'docs/adr/0003-wortschatz.md',
      'graphify explain "<symbol oder datei>" --graph /git/epic-graph/epic-69/graphify-out/graph.json',
      'graphify affected "<symbol oder datei>" --depth 1 --graph /git/epic-graph/epic-69/graphify-out/graph.json',
      'graphify path "<A>" "<B>" --graph /git/epic-graph/epic-69/graphify-out/graph.json',
      'Exit 3 heißt mehrdeutig',
      '**Erst den Graphen fragen, dann gezielt die genannten Stellen lesen**',
      '(Skill mission, Regel 6; Adapter `glossary`)',
      '**Nicht committen, nicht branchen** — das macht der Host (Skill mission, 4a und Regel 9).',
      'ein Worktree darf starten: dev_server, compose (Adapter `worktree_may_start`',
      '(Skill mission, Regel 13, #38)',
      '**Gezielt iterieren, einmal voll:** Während der Arbeit nur die betroffenen Tests',
      'Am Ende genau **ein** Volllauf je betroffener Suite; sein Protokoll geht in den Bericht. Testbefehle des Adapters: `cd flotte && bun test` (Suite flotte).',
      'Schema implementer (version 1)',
      '`commit_style` „conventional“, `commit_language` de, `commit_umlauts` transliterate (Adapter), mit der Issue-Nummer #67',
    ])
      expect(t).toContain(teil);
    expect(implementerAuftrag(kontext({ graph: null }), urteilspaket, stand(), { vorgaenger: [], torAntworten: [] })).toContain('Code-Graph: keiner gebaut');
  });

  it('reviewer: the diff command, the epic head, the new files by name, the lint basis of the touched modules, the interface in a chain, no full run, three groups, structural', () => {
    const s = stand({ stufe: 'reviewer', bericht: { ...(BEISPIELE.implementer as ImplementerBericht), neueDateien: ['flotte/src/epic/auftraege.ts', 'flotte/src/epic/schemata.ts'] } });
    const t = reviewerAuftrag(kontext(), urteilspaket, s, { kette: true });
    for (const teil of [
      'Erster Offizier (`erster-offizier-urteil`) für Paket 67',
      '**Diff: `git -C /wt/67 diff HEAD`.**',
      '`git -C /wt/67 rev-parse HEAD`',
      '**Neue Dateien — lies sie direkt**, sie stehen in keinem Diff:\n- flotte/src/epic/auftraege.ts\n- flotte/src/epic/schemata.ts',
      'Lint-Basis der betroffenen Module (Phase 0): flotte/src/epic/motor.ts: 2. Melde die Differenz',
      '**Spec:**',
      '**Standards:**',
      'Positivprobe und Gegenprobe',
      'jeden anderen Schreiber derselben Felder',
      '**Du fährst keinen Volllauf.**',
      '**Das Paket steht in einer Kette: halte in `schnittstelle` fest, was tatsächlich dasteht**',
      '`muss`',
      '`sollte`',
      '`kann`',
      '`strukturell`: `true` nur bei einer strukturellen Abweichung',
      'Schema reviewer (version 1)',
    ])
      expect(t).toContain(teil);
    expect(t).not.toContain('andere/x.ts');
    // the epic head as a hash once Up named it
    expect(reviewerAuftrag(kontext(), urteilspaket, { ...s, kopf: '5938b3b9cfaa' }, { kette: true })).toContain('Der Worktree steht auf dem Missions-Kopf beim Paketstart (`5938b3b9cfaa`)');
    expect(reviewerAuftrag(kontext({ adapter: '' }), urteilspaket, s, { kette: false })).toContain('der Lint-Vergleich entfällt');
  });

  it('cut and conflict: phase 1 and 2a–2c with the coverage the program checks; the conflict call does not commit', () => {
    const s = schnittAuftrag(kontext());
    for (const teil of ['Mission #69', '**Du liest nur.**', 'Zuordnung Story → Paket', '14. Ein Paket braucht einen Dienst', '`abbruch: true`', 'Schema schnitt (version 1)', '`69-p<k>`']) expect(s).toContain(teil);
    const k = konfliktAuftrag(kontext(), urteilspaket, stand({ stufe: 'merge', konflikt: { dateien: ['obst/REGISTER.md'], ergebnis: null, begruendung: '' } }));
    for (const teil of ['- obst/REGISTER.md', '**nicht committen**', '`inhaltlich`', 'Schema konflikt (version 1)']) expect(k).toContain(teil);
  });

  it('the commit of 4d after the adapter: style, language, umlauts, the issue number, the why, Co-Authored-By of the rung', () => {
    const s = stand({ bericht: { ...(BEISPIELE.implementer as ImplementerBericht), betreff: 'Schnittprüfung für Größe und Übergänge', warum: 'Das Programm prüft den Schnitt selbst, weil ein Zyklus sonst ewig wartet.' } });
    expect(commitNachricht(kontext(), urteilspaket, s, 67)).toBe('feat: Schnittpruefung fuer Groesse und Uebergaenge (#67)\n\nDas Programm prueft den Schnitt selbst, weil ein Zyklus sonst ewig wartet.\n\nUebernommen: f\n\nPaket 67 der Mission #69, abgenommen von flotte mission (4c).\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>\n');
    const plain = ADAPTER3.replace('commit_style: conventional', 'commit_style: plain').replace('commit_language: de', 'commit_language: en').replace('commit_umlauts: transliterate', 'commit_umlauts: keep');
    const t = commitNachricht(kontext({ adapter: plain }), urteilspaket, { ...s, klasse: 'standard', bericht: { ...s.bericht!, betreff: 'Check the cut (#67)', fremdarbeit: [] } }, 67);
    expect(t).toBe('Check the cut (#67)\n\nDas Programm prüft den Schnitt selbst, weil ein Zyklus sonst ewig wartet.\n\nPackage 67 of epic #69, accepted by flotte mission (4c).\n\nCo-Authored-By: Claude Sonnet <noreply@anthropic.com>\n');
  });

  it('Co-Authored-By names the model of the init line with its version; without one the rung', () => {
    expect([modellName('claude-sonnet-5-5'), modellName('claude-opus-4-1-20250805'), modellName('claude-haiku-4'), modellName('gpt-x'), modellName(null)]).toEqual(['Claude Sonnet 5.5', 'Claude Opus 4.1', 'Claude Haiku 4', null, null]);
    const s = stand({ modell: 'claude-opus-5-5', bericht: BEISPIELE.implementer as ImplementerBericht });
    expect(commitNachricht(kontext(), urteilspaket, s, 67)).toMatch(/\nCo-Authored-By: Claude Opus 5\.5 <noreply@anthropic\.com>\n$/);
    expect(commitNachricht(kontext(), urteilspaket, { ...s, modell: null }, 67)).toMatch(/\nCo-Authored-By: Claude Opus <noreply@anthropic\.com>\n$/);
  });

  it('pre_commit_checks run before the commit of 4d: red stops it, green commits', async () => {
    const f = fixture({ '.claude/epic.md': ADAPTER.replace('code_graph: off', 'code_graph: off\npre_commit_checks:\n  - bun pruefe.ts'), 'pruefe.ts': "import { existsSync } from 'node:fs';\nprocess.exit(existsSync('PATCHNOTES.md') ? 0 : 1);\n" });
    try {
      const m = echteMechanik({ repo: f.repo, epic: 69, epicBranch: 'main', basis: 'origin/main', forge: 'o/r', halter: join(f.wurzel, 'halter') });
      writeFileSync(join(f.repo, 'src', 'neu.txt'), 'x\n');
      await expect(m.sichern(f.repo, 'feat: neu (#9)\n')).rejects.toThrow(/pre_commit_checks: bun pruefe\.ts: Exit 1/);
      writeFileSync(join(f.repo, 'PATCHNOTES.md'), '- neu\n');
      expect(await m.sichern(f.repo, 'feat: neu (#9)\n')).toMatch(/^[0-9a-f]{40}$/);
      expect(f.git(['log', '-1', '--format=%s'])).toBe('feat: neu (#9)');
    } finally {
      f.weg();
    }
  }, T);
});

describe('Vorab-Tor nach einem Neustart (#67, von #66 übergeben)', () => {
  it('the program stops in phase tor; the restart reports the open block again, takes the answer and runs', async () => {
    const repo = neuesRepo();
    const tor: TorPunkt[] = [{ frage: 'Konto 2 nehmen?', betrifft: 'Lauf', lage: 'Konto 3 ist erschöpft', optionen: [{ text: 'ja' }, { text: 'nein', abbruch: true }], empfehlung: 'A', grund: 'g', quelle: 'Admiral' }];
    const welt = neueWelt();
    const buch: EpicDrehbuch = { schnitt: { version: 1, pakete: [paket('210')], tor }, maxTakte: 4 };
    await expect(fahreEpic(einstellung(repo), attrappe(buch, welt))).rejects.toThrow(/Drehbuch hängt/);
    expect(welt.bloecke).toHaveLength(1);
    const u = attrappe({ ...buch, maxTakte: 400, antworten: [{ frage: 1, antwort: 'A' }] }, welt);
    const z = await fahreEpic(einstellung(repo), u);
    // the restart is an event for flotte messen (#68), once per start on a state with events
    expect(z.ereignisse.filter((e) => e.art === 'neustart')).toHaveLength(1);
    const fragen = welt.bloecke.map((b) => leseBlock(b)).filter((b) => b?.art === 'frage');
    expect(fragen).toHaveLength(2);
    expect(fragen[1]).toMatchObject({ art: 'frage', epic: 69, phase: 'tor', fragen: [{ nr: 1, betrifft: 'Lauf' }] });
    expect(welt.aufrufe.filter((a) => a.rolle === 'schnitt')).toHaveLength(1);
    expect(z.phase).toBe('fertig');
    expect(z.pakete['210'].stufe).toBe('fertig');
  }, T);
});

describe('Leitung eines direkten Laufs (#67)', () => {
  it('blocks to stdout and bloecke.txt; answers from the file, each once; the run stops when only an answer could go on', () => {
    const repo = neuesRepo();
    const dir = epicDir(repo, 69);
    const datei = join(dir, 'antworten.txt');
    const raus: string[] = [];
    const l = dateiLeitung(dir, datei, (b) => raus.push(b));
    l.melde('FLOTTE-FRAGE 69 tor\n1. x');
    expect(raus).toEqual(['FLOTTE-FRAGE 69 tor\n1. x']);
    expect(readFileSync(join(dir, 'bloecke.txt'), 'utf8')).toContain('FLOTTE-FRAGE 69 tor');
    expect(l.antworten()).toEqual([]);
    writeFileSync(datei, '1: A\n2) weiter ohne 7\nkeine Antwort\n');
    expect(l.antworten()).toEqual([
      { frage: 1, antwort: 'A' },
      { frage: 2, antwort: 'weiter ohne 7' },
    ]);
    expect(l.antworten()).toEqual([]);
    const z = neuerLauf(69);
    z.phase = 'tor';
    schreibeLauf(dir, z);
    expect(wartetNurAufAntwort(dir, 69)).toMatch(/Vorab-Tor/);
    z.phase = 'pakete';
    z.schnitt.ergebnis = schnitt({ pakete: [paket('7'), paket('8')] });
    z.pakete = { '7': neuesPaket(paket('7')), '8': { ...neuesPaket(paket('8')), stufe: 'fertig' } };
    z.fragen = [{ nr: 1, art: 'tor', punkt: 0, betrifft: ['7'], antwort: null, abgelehnt: false, erledigt: false }];
    schreibeLauf(dir, z);
    expect(wartetNurAufAntwort(dir, 69)).toMatch(/geparkte Pakete/);
    z.pakete['8'].stufe = 'implementer';
    schreibeLauf(dir, z);
    expect(wartetNurAufAntwort(dir, 69)).toBeNull();
  });

  it('the gate summary of flotte-probe is a known test format: a context run is a test, a red context its file', () => {
    const gruen = ['', '== Gate: wurzel', '', '== Gate: Basis origin/main @ 05ec4e3, 0 geänderte Dateien (HEAD 05ec4e3a)', '  obst     übersprungen', '  verse    übersprungen', '  thema    übersprungen', '  wurzel   grün            0:00', 'Gate grün.'].join('\n');
    expect(zaehle(gruen, 'pwsh -NoProfile -File werkzeug/gate.ps1', '/wt/a')).toEqual({ dateien: null, tests: 1, rot: [] });
    const rot = ['== Gate: obst', '== Gate: wurzel', '', '== Gate: Basis origin/main @ 05ec4e3, 2 geänderte Dateien (HEAD 1)', '  obst     rot             0:01  obst/REGISTER.md nennt apfel.txt nicht', '  verse    übersprungen', '  thema    übersprungen', '  wurzel   grün            0:00', 'Gate rot.'].join('\n');
    expect(zaehle(rot, 'pwsh -NoProfile -File werkzeug/gate.ps1', '/wt/a')).toEqual({ dateien: null, tests: 2, rot: [{ datei: 'obst', test: 'obst/REGISTER.md nennt apfel.txt nicht' }] });
  });
});

describe('echte Aufrufe über das Modul lauf (#67, gegen die Attrappe für claude -p)', () => {
  it('an agent role runs as --agent with --json-schema and the account; cut and conflict get model and effort; a continuation is --resume; every call logs', async () => {
    const d = drehbuch([
      { wenn: 'Implementer', sitzung: 'sitzung-i', schritte: [{ zeile: { type: 'result', subtype: 'success', is_error: false, result: 'fertig', structured_output: BEISPIELE.implementer } }] },
      { wenn: 'Schnitt', sitzung: 'sitzung-s', schritte: [{ zeile: { type: 'result', subtype: 'success', is_error: false, result: 'fertig', structured_output: BEISPIELE.schnitt } }] },
      { wenn: 'Reviewer', schritte: [{ zeile: { type: 'result', subtype: 'success', is_error: false, result: 'fertig', structured_output: BEISPIELE.reviewer } }] },
      { wenn: 'Merge-Konflikt', schritte: [{ zeile: { type: 'result', subtype: 'success', is_error: false, result: 'fertig', structured_output: BEISPIELE.konflikt } }] },
    ]);
    process.env.FLOTTE_DREHBUCH = d.datei;
    const konto = mkdtempSync(join(tmpdir(), 'flotte-konto-'));
    const logDir = mkdtempSync(join(tmpdir(), 'flotte-aufrufe-'));
    const cwd = mkdtempSync(join(tmpdir(), 'flotte-wt-'));
    const a = echteAufrufe({ konto, logDir, programm: { programm: process.execPath, programmArgs: [ATTRAPPE] } });
    const sitzungen: string[] = [];
    const r = await a.rufe({ rolle: 'implementer', paket: '7', runde: 1, agent: 'ingenieur-standard', modell: 'sonnet', effort: 'medium', konto, cwd, auftrag: 'Implementer für Paket 7', resume: null, schema: SCHEMATA.implementer }, (s) => sitzungen.push(s));
    expect(sitzungen).toEqual(['sitzung-i']);
    expect(r.strukturiert).toEqual(BEISPIELE.implementer);
    await a.rufe({ rolle: 'implementer', paket: '7', runde: 1, agent: 'ingenieur-standard', modell: 'sonnet', effort: 'medium', konto, cwd, auftrag: 'Implementer: fortsetzen', resume: 'sitzung-i', schema: SCHEMATA.implementer }, () => {});
    await a.rufe({ rolle: 'schnitt', paket: null, runde: 1, agent: null, modell: 'opus', effort: 'medium', konto, cwd, auftrag: 'Schnitt und Vorab-Tor', resume: null, schema: SCHEMATA.schnitt }, () => {});
    await a.rufe({ rolle: 'reviewer', paket: '7', runde: 1, agent: 'erster-offizier-standard', modell: 'sonnet', effort: 'high', konto, cwd, auftrag: 'Reviewer für Paket 7', resume: null, schema: SCHEMATA.reviewer }, () => {});
    await a.rufe({ rolle: 'konflikt', paket: '7', runde: 1, agent: null, modell: 'sonnet', effort: 'medium', konto, cwd, auftrag: 'Merge-Konflikt im Epic-Worktree', resume: null, schema: SCHEMATA.konflikt }, () => {});
    const [i, fort, s, rv, k] = d.gesehen();
    // every role carries guard.ps1 of mission/scripts as its PreToolUse hook, profile epic, as the driver does
    for (const g of [i, fort, s, rv, k]) {
      const hook = JSON.parse(g.args[g.args.indexOf('--settings') + 1]).hooks.PreToolUse[0];
      expect(hook.matcher).toBe('Bash|PowerShell');
      expect(hook.hooks[0]).toMatchObject({ type: 'command', onFailure: 'block' });
      expect(hook.hooks[0].command).toMatch(/mission[\\/]scripts[\\/]guard\.ps1" -Profile epic$/);
    }
    expect(a.beendeLaufende()).toEqual([]);
    const wert = (args: string[], n: string) => args[args.indexOf(n) + 1];
    expect(wert(i.args, '--agent')).toBe('ingenieur-standard');
    expect(i.args).not.toContain('--model');
    expect(JSON.parse(wert(i.args, '--json-schema'))).toEqual(SCHEMATA.implementer);
    expect(i.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--permission-mode', 'auto']));
    expect(i.konto?.toLowerCase()).toBe(konto.toLowerCase());
    expect(i.cwd.toLowerCase()).toBe(cwd.toLowerCase());
    expect(i.eingabe).toBe('Implementer für Paket 7');
    expect(wert(fort.args, '--resume')).toBe('sitzung-i');
    expect(wert(fort.args, '--agent')).toBe('ingenieur-standard');
    expect([wert(s.args, '--model'), wert(s.args, '--effort')]).toEqual(['opus', 'medium']);
    expect(s.args).not.toContain('--agent');
    expect(existsSync(join(logDir, 'implementer-7-r1.jsonl'))).toBe(true);
    expect(existsSync(join(logDir, 'schnitt-r1.jsonl'))).toBe(true);
  }, T);

  it('a whole package through the program with real call processes: cut, implementer and reviewer each one claude -p with its schema', async () => {
    const pakete = [paket('220')];
    const ausgabe = (o: unknown) => [{ zeile: { type: 'result', subtype: 'success', is_error: false, result: 'fertig', structured_output: o } }];
    const d = drehbuch([
      { wenn: 'Schnitt und Vorab-Tor', schritte: ausgabe(schnitt({ pakete })) },
      { wenn: '^Ingenieur', schritte: [{ zeile: { type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', tools: [] } }, ...ausgabe({ ...(BEISPIELE.implementer as object), abnahme: [{ punkt: '220 tut, was es soll', satz: 'erfüllt' }] })] },
      { wenn: '^Erster Offizier', schritte: ausgabe({ ...(BEISPIELE.reviewer as object), befunde: [] }) },
    ]);
    process.env.FLOTTE_DREHBUCH = d.datei;
    const repo = neuesRepo();
    const u = attrappe({ schnitt: schnitt({ pakete }), maxTakte: 4000 });
    const takt = u.warte;
    u.warte = async () => {
      await new Promise((r) => setTimeout(r, 20));
      return takt();
    };
    const konto = mkdtempSync(join(tmpdir(), 'flotte-konto-'));
    // the stand-in's worktrees (/wt/<nr>) do not exist: the processes run in a temp folder
    const cwd = mkdtempSync(join(tmpdir(), 'flotte-wt-'));
    const echt = echteAufrufe({ konto, logDir: join(epicDir(repo, 69), 'aufrufe'), programm: { programm: process.execPath, programmArgs: [ATTRAPPE] } });
    u.aufrufe = { rufe: (a, beiSitzung) => echt.rufe({ ...a, cwd }, beiSitzung), kontoFrei: echt.kontoFrei };
    const z = await fahreEpic(einstellung(repo, { konto }), u);
    expect(z.phase).toBe('fertig');
    expect(z.pakete['220'].stufe).toBe('fertig');
    const gesehen = d.gesehen();
    expect(gesehen.map((g) => g.eingabe.split(/\s/)[0])).toEqual(['Schnitt', 'Ingenieur', 'Erster']);
    expect(gesehen.map((g) => JSON.parse(g.args[g.args.indexOf('--json-schema') + 1]))).toEqual([SCHEMATA.schnitt, SCHEMATA.implementer, SCHEMATA.reviewer]);
    expect(z.pakete['220'].bericht?.betreff).toBe('feat: x (#1)');
    expect(z.pakete['220'].modell).toBe('claude-sonnet-5-5');
  }, T);

  it('the program stops: the running call processes are ended, so a restart never runs a second one beside them', async () => {
    const d = drehbuch([{ sitzung: 'sitzung-h', schritte: [{ haenge: true }] }]);
    process.env.FLOTTE_DREHBUCH = d.datei;
    const konto = mkdtempSync(join(tmpdir(), 'flotte-konto-'));
    const a = echteAufrufe({ konto, logDir: mkdtempSync(join(tmpdir(), 'flotte-aufrufe-')), programm: { programm: process.execPath, programmArgs: [ATTRAPPE] } });
    let sitzung: string | null = null;
    const lauf = a.rufe({ rolle: 'implementer', paket: '7', runde: 1, agent: 'ingenieur-standard', modell: 'sonnet', effort: 'medium', konto, cwd: mkdtempSync(join(tmpdir(), 'flotte-wt-')), auftrag: 'Implementer', resume: null, schema: SCHEMATA.implementer }, (s) => (sitzung = s));
    for (let i = 0; i < 200 && !sitzung; i++) await new Promise((r) => setTimeout(r, 50));
    expect(sitzung).toBe('sitzung-h');
    const beendet = a.beendeLaufende();
    expect(beendet).toHaveLength(1);
    // the process is gone: the call returns (without result), nothing runs any more
    const r = await lauf;
    expect(r.ergebnisse).toHaveLength(0);
    expect(a.beendeLaufende()).toEqual([]);
  }, T);
});
