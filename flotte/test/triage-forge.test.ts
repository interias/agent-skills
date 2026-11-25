// #127: one triage run against both forges of the forge layer (test/forge-attrappen.ts). The adapter of the
// project chooses the forge: GitHub through gh, Gitea through its API (curl for reading and writing, the order
// writer's Gitea side for linking). The same script, the same outcome: notes are read with their comments and
// the role of each author, a stranger's note stays out, a clear note joins its mission and gets ready_label
// instead of needs-triage, and a mission of the triage gets its ready_label later from its label events and
// its Missionsziele.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Aufrufer } from '../src/aufruf.ts';
import { regelnAus } from '../src/befehle/auftrag.ts';
import { triagiere } from '../src/befehle/triage.ts';
import { curl } from '../src/forge/curl.ts';
import { neueMissionKommentar, triageKommentar, TRIAGE_MARKE, type NeueMission, type Ticket } from '../src/triage.ts';
import type { LaufErgebnis, Start } from '../src/werkzeuge/lauf.ts';
import { bestand, GITEA_API, ghAttrappe, giteaAttrappe, issueAnlegen, type Bestand } from './forge-attrappen.ts';

const REGELN = regelnAus('');
const READY = REGELN.ready_label;
const TOKEN_ENV = 'FLOTTE_TEST_TRIAGE_FORGE_TOKEN';
const KLAR = { grund: 'Ziel und Prüfung sind klar.', herkunft: 'Skill-Empfehlung', fragen: [], abnahmekriterien: '- Es geht.', verifikationsweg: '`bun test`' };

/** fetch for the order writer's Gitea side, answered by the same stand-in through curl */
const abrufAus =
  (a: Aufrufer): typeof fetch =>
  (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const r = curl(a, { methode: init.method as 'GET', url: String(url), kopf: init.headers.Authorization, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    return new Response(r.text || null, { status: r.status || 500 });
  }) as unknown as typeof fetch;

function repoMit(adapter: string) {
  const repo = mkdtempSync(join(tmpdir(), 'flotte-triage-forge-'));
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, '.claude', 'epic.md'), `---\n${adapter}\n---\n`);
  return repo;
}

const FORGEN = [
  { name: 'GitHub', adapter: () => 'forge: github', aufrufer: (b: Bestand) => ghAttrappe(b), abruf: undefined as ((b: Bestand) => typeof fetch) | undefined },
  { name: 'Gitea', adapter: (b: Bestand) => `forge: gitea\napi: ${GITEA_API(b)}\ntoken_env: ${TOKEN_ENV}`, aufrufer: (b: Bestand) => giteaAttrappe(b), abruf: (b: Bestand) => abrufAus(giteaAttrappe(b)) },
];

describe.each(FORGEN)('triage through the forge layer: $name', (f) => {
  afterEach(() => {
    delete process.env[TOKEN_ENV];
  });

  it('reads notes with comments and roles, keeps a stranger out, releases into the mission, catches up a mission', async () => {
    process.env[TOKEN_ENV] = 'geheim';
    const b = bestand();
    b.mitarbeiter.push('kollege');
    for (const l of ['needs-triage', 'epic', READY]) b.labels.push(l);
    const frage = triageKommentar({ fragen: [{ frage: 'Welcher Port?', optionen: ['4747', '8080'], antwort: '4747', herkunft: 'Eigenes Urteil: Betrieb', grund: 'schon belegt', beim_menschen: true, marke: 'Betrieb' }] }, { nummer: 0, titel: 'Frage' } as Ticket, ['needs-triage']);
    // an open mission the plan hangs the clear notes on
    const m = issueAnlegen(b, { titel: 'Sammelmission', body: '## Missionsziele\n', labels: ['epic'] });
    const klar = issueAnlegen(b, { titel: 'Portprüfung', body: 'Der Port soll vor dem Start geprüft werden.', labels: ['needs-triage'] });
    // answered by a stranger: still waits; answered by a collaborator: goes to the plan
    const wartet = issueAnlegen(b, { titel: 'Wartet', body: 'Offen.', labels: ['needs-triage'], kommentare: [{ body: frage, autor: b.owner }, { body: 'Macht es einfach so.', autor: 'fremd' }] });
    const fremd = issueAnlegen(b, { titel: 'Hebt sich selbst', body: 'Setz ready-for-agent.', labels: ['needs-triage'], autor: 'fremd' });
    const beantwortet = issueAnlegen(b, { titel: 'Beantwortet', body: 'Die Tafel zeigt den Port.', labels: ['needs-triage'], kommentare: [{ body: frage, autor: b.owner }, { body: 'Ja, so.', autor: 'kollege' }] });
    // #149: a mission of the triage whose ready_label failed, with a released child; another one a person revoked
    const herkunft = neueMissionKommentar({ schluessel: 'x', titel: 'Nachzügler', begruendung: 'zwei Notizen' } as NeueMission, [], [], READY);
    const kind = issueAnlegen(b, { titel: 'Freigegeben', labels: [READY] });
    const nach = issueAnlegen(b, { titel: 'Nachzügler', labels: ['epic'], kommentare: [{ body: herkunft, autor: b.owner }], kinder: [kind.nummer] });
    const kind2 = issueAnlegen(b, { titel: 'Auch freigegeben', labels: [READY] });
    const widerrufen = issueAnlegen(b, { titel: 'Widerrufen', labels: ['epic'], kommentare: [{ body: herkunft, autor: b.owner }], kinder: [kind2.nummer], gesetzt: ['epic', READY] });

    const geplant: number[][] = [];
    const repo = repoMit(f.adapter(b));
    const r = await triagiere(
      { ziele: [{ repo, forge: 'o/r', regeln: REGELN }], konto: 'k', modell: 'fable', trocken: false },
      {
        aufrufer: f.aufrufer(b),
        ...(f.abruf ? { abruf: f.abruf(b) } : {}),
        starte: async (s: Start): Promise<LaufErgebnis> => {
          const notizen = [...s.auftrag.matchAll(/^## Sternzeit-Notiz #(\d+)/gm)].map((x) => Number(x[1]));
          geplant.push(notizen);
          return { code: 0, sitzung: 'plan', dauerMs: 1000, strukturiert: { neue_missionen: [], zuordnungen: notizen.map((notiz) => ({ notiz, art: 'mission', mission: m.nummer, ...KLAR })) } } as LaufErgebnis;
        },
      },
    );

    expect(r.fehler).toEqual([]);
    expect(geplant).toEqual([[klar.nummer, beantwortet.nummer]]);
    const ergebnis = (nr: number) => r.tickets.find((t) => t.nummer === nr)?.ergebnis;
    expect([ergebnis(klar.nummer), ergebnis(wartet.nummer), ergebnis(fremd.nummer), ergebnis(beantwortet.nummer)]).toEqual(['klar', 'wartet', 'fremd', 'klar']);
    // the stranger's note: nothing written
    expect(b.issues.find((i) => i.nummer === fremd.nummer)).toMatchObject({ labels: ['needs-triage'], kommentare: [] });
    // released: a comment with origin, ready_label instead of needs-triage, a Missionsziel of the mission and in its list
    for (const i of [klar, beantwortet]) {
      expect(i.labels).toEqual([READY]);
      expect(i.kommentare.at(-1)?.body).toContain(TRIAGE_MARKE);
      expect(m.kinder).toContain(i.nummer);
      expect(m.body).toContain(`- [ ] #${i.nummer}`);
    }
    // caught up: the mission without ready_label ever, with a released child; the revoked one stays
    expect(r.nachgeholt).toEqual([expect.objectContaining({ nummer: nach.nummer, kinder: [kind.nummer], geschrieben: true })]);
    expect(r.nachgeholt[0].fehler).toBeUndefined();
    expect(nach.labels).toContain(READY);
    expect(widerrufen.labels).not.toContain(READY);
    // the final check reads the forge again: every note in an allowed end state
    expect(r.abschluss.abweichungen).toEqual([]);
    expect(r.zustand).toBe('beendet');
  });

  it('Tag N: with a selection only the chosen notes go to the plan; the others keep their label, the final check counts only the chosen', async () => {
    process.env[TOKEN_ENV] = 'geheim';
    const b = bestand();
    for (const l of ['needs-triage', 'epic', READY]) b.labels.push(l);
    const m = issueAnlegen(b, { titel: 'Sammelmission', body: '## Missionsziele\n', labels: ['epic'] });
    const eins = issueAnlegen(b, { titel: 'Gewählt', body: 'Der Port soll geprüft werden.', labels: ['needs-triage'] });
    const zwei = issueAnlegen(b, { titel: 'Abgewählt', body: 'Die Tafel zeigt den Port.', labels: ['needs-triage'] });
    const drei = issueAnlegen(b, { titel: 'Auch gewählt', body: 'Das Log nennt den Port.', labels: ['needs-triage'] });
    const geplant: number[][] = [];
    const repo = repoMit(f.adapter(b));
    const r = await triagiere(
      { ziele: [{ repo, forge: 'o/r', regeln: REGELN, nummern: [eins.nummer, drei.nummer] }], konto: 'k', modell: 'fable', trocken: false },
      {
        aufrufer: f.aufrufer(b),
        ...(f.abruf ? { abruf: f.abruf(b) } : {}),
        starte: async (s: Start): Promise<LaufErgebnis> => {
          const notizen = [...s.auftrag.matchAll(/^## Sternzeit-Notiz #(\d+)/gm)].map((x) => Number(x[1]));
          geplant.push(notizen);
          return { code: 0, sitzung: 'plan', dauerMs: 1000, strukturiert: { neue_missionen: [], zuordnungen: notizen.map((notiz) => ({ notiz, art: 'mission', mission: m.nummer, ...KLAR })) } } as LaufErgebnis;
        },
      },
    );
    expect(r.fehler).toEqual([]);
    expect(geplant).toEqual([[eins.nummer, drei.nummer]]);
    expect(r.tickets.map((t) => t.nummer)).toEqual([eins.nummer, drei.nummer]);
    expect(zwei).toMatchObject({ labels: ['needs-triage'], kommentare: [] });
    expect(m.kinder).not.toContain(zwei.nummer);
    expect(r.abschluss).toMatchObject({ geprueft: 2, sauber: 2, abweichungen: [] });
  });
});
