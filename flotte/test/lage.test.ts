// Tag H: the line of a mission on the cards of the bridge (lage.ts) and the gate from its logs (pruefprotokolle.ts).

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateSatz, type LageEingang, lageArt, lageVon } from '../src/treiber/lage.ts';
import { GATE_STILL_MS, gateStand, missionsWorktrees } from '../src/treiber/pruefprotokolle.ts';

const JETZT = Date.parse('2026-11-24T10:00:00Z');
const vor = (min: number) => new Date(JETZT - min * 60_000).toISOString();

const basis = (mehr: Partial<LageEingang> = {}): LageEingang => ({
  nr: 482,
  jetzt: JETZT,
  stufe: 'laeuft',
  notiz: '',
  pr: null,
  prozess: true,
  beimAdmiral: null,
  frageWartet: false,
  fragen: { anzahl: 0, ganz: false, seit: null },
  pausiert: null,
  limitBis: null,
  ramHalt: false,
  schlangePlatz: null,
  schlangeSeit: null,
  andockpruefung: null,
  gateLauf: null,
  gateStand: null,
  agenten: [],
  pakete: { fertig: 1, gesamt: 3 },
  schritt: 'Bash: git status',
  merge: { stellung: 'mensch', herkunft: 'projekt' },
  haltUrsache: null,
  haltGrund: null,
  haltZeit: null,
  gemergtAm: null,
  gestartetAm: vor(120),
  ...mehr,
});
const kurz = (e: LageEingang) => {
  const x = lageVon(e);
  return `${x.etikett} · ${x.satz}${x.deinSchritt ? ` → ${x.deinSchritt.ziel}: ${x.deinSchritt.text}` : ''}`;
};

describe('Tag H: die Lage einer Mission in einer Zeile', () => {
  it('a run at work: engineer with package and class, first officer, orchestration, follow-up work', () => {
    const impl = { zeit: JETZT, art: 'aufruf' as const, id: 'a', rolle: 'implementer' as const, klasse: 'standard' as const, paket: 483 };
    expect(kurz(basis({ agenten: [impl] }))).toBe('arbeitet · Ingenieur an #483 (Standard), 1 von 3 Paketen fertig');
    const rev = { zeit: JETZT, art: 'aufruf' as const, id: 'b', rolle: 'reviewer' as const, paket: 484 };
    expect(kurz(basis({ agenten: [rev] }))).toBe('prueft · Erster Offizier prüft #484, 1 von 3 Paketen fertig');
    // a returned call is no work any more
    expect(kurz(basis({ agenten: [impl, { zeit: JETZT, art: 'rueckkehr', id: 'a' }] }))).toBe('arbeitet · Orchestrierung: Bash: git status');
    expect(kurz(basis({ agenten: [{ ...impl, paket: '482-p2' }] }))).toBe('arbeitet · Ingenieur an P2 (Standard), 1 von 3 Paketen fertig');
    expect(kurz(basis({ stufe: 'nacharbeit', schritt: 'Bash: gh pr view' }))).toBe('arbeitet · Nacharbeit: Bash: gh pr view');
  });

  it('waits for its own background work, and the gate of the run with its contexts', () => {
    expect(kurz(basis({ schritt: 'still seit 61 min, Kindprozess lebt: pwsh.exe, node.exe' }))).toBe('arbeitet · wartet auf eigene Hintergrundarbeit (pwsh.exe, node.exe)');
    const g = { kontexte: [{ name: 'wurzel', stand: 'fertig' as const, zeit: 1 }, { name: 'stanze', stand: 'fertig' as const, zeit: 2 }, { name: 'hive-api', stand: 'fertig' as const, zeit: 3 }, { name: 'buero', stand: 'laeuft' as const, zeit: 4 }], von: 5, seit: vor(52), zuletzt: 4 };
    const x = lageVon(basis({ gateLauf: vor(52), gateStand: g }));
    expect(x).toMatchObject({ etikett: 'prueft', satz: 'Andockprüfung 3 von 5 Kontexten fertig, buero läuft', seit: vor(52) });
    expect(x.gate).toEqual({ kontexte: [{ name: 'wurzel', stand: 'fertig' }, { name: 'stanze', stand: 'fertig' }, { name: 'hive-api', stand: 'fertig' }, { name: 'buero', stand: 'laeuft' }], von: 5, seit: vor(52) });
    expect(gateSatz({ ...g, von: null })).toBe('Andockprüfung: 3 Kontexte fertig, buero läuft');
    // without logs only "Gate läuft"
    expect(kurz(basis({ gateLauf: vor(5) }))).toBe('prueft · Andockprüfung läuft');
    // a gate found by its logs alone (the run's call not recognised) counts too
    expect(lageVon(basis({ gateStand: { ...g, von: null } })).etikett).toBe('prueft');
  });

  it('questions: to the person (with her step), at the admiral, waiting for an account', () => {
    expect(lageVon(basis({ stufe: 'frage', prozess: false, fragen: { anzahl: 2, ganz: true, seit: vor(42) } }))).toMatchObject({ etikett: 'wartet_auf_dich', satz: '2 Fragen an dich', seit: vor(42), deinSchritt: { ziel: 'frage', text: 'Fragen beantworten' } });
    expect(kurz(basis({ stufe: 'frage', prozess: false, beimAdmiral: vor(1) }))).toBe('wartet · Frage beim Admiral');
    expect(kurz(basis({ prozess: false, frageWartet: true, notiz: 'Frageblock wartet auf ein freies Konto' }))).toBe('wartet · Frage beim Admiral, wartet auf ein Konto mit Luft');
    // a parked package's question while the run goes on: the run's line, the person's step
    expect(kurz(basis({ fragen: { anzahl: 1, ganz: false, seit: vor(3) } }))).toBe('arbeitet · Orchestrierung: Bash: git status; eine Frage an dich, ihr Paket ist geparkt → frage: Frage beantworten');
  });

  it('waits for another mission, a limit, a 429, the RAM, the person’s pause', () => {
    expect(kurz(basis({ stufe: 'wartend', prozess: false, notiz: 'wartet auf das Andocken von #477' }))).toBe('wartet · wartet auf das Andocken von #477');
    expect(kurz(basis({ stufe: 'wartend', prozess: false, notiz: 'Kollision mit #480 (Modul hive)' }))).toBe('wartet · Kollision mit #480 (Modul hive)');
    const bis = new Date(JETZT + 30 * 60_000);
    expect(kurz(basis({ prozess: false, limitBis: bis.toISOString(), notiz: 'wartet bis … (Reset des Limits + 2 min): Limit erreicht' }))).toBe(`wartet · Limit, weiter um ${bis.toTimeString().slice(0, 5)}`);
    expect(kurz(basis({ prozess: false, limitBis: bis.toISOString(), notiz: 'wartet bis 10:30 (429 auf Konto 2)' }))).toMatch(/^wartet · Limit, weiter um \d\d:\d\d \(429\)$/);
    expect(kurz(basis({ prozess: false, notiz: 'wartet auf Konto 2: Limit erreicht: usage_limit_reached' }))).toBe('wartet · Limit auf Konto 2, weiter sobald es Luft hat');
    expect(kurz(basis({ prozess: false, notiz: 'wartet auf RAM ok' }))).toBe('wartet · Speicher knapp, weiter sobald RAM ok');
    expect(lageVon(basis({ prozess: false, pausiert: vor(10), notiz: 'pausiert vom Menschen' }))).toMatchObject({ etikett: 'wartet', satz: 'von dir pausiert', seit: vor(10) });
    // paused with a question to the whole run: no parked package to name
    expect(lageVon(basis({ prozess: false, pausiert: vor(10), fragen: { anzahl: 1, ganz: true, seit: vor(5) } })).satz).toBe('von dir pausiert; eine Frage an dich');
  });

  it('the merge queue, the Andockprüfung, a PR the person merges (with the reason and the switch)', () => {
    expect(lageVon(basis({ stufe: 'pr', pr: 490, prozess: false, schlangePlatz: 2, schlangeSeit: vor(8), notiz: 'PR #490: Andock-Schlange, wartet auf das Andocken von #478' }))).toMatchObject({ etikett: 'wartet', satz: 'Andock-Schlange Platz 2, PR #490, wartet auf das Andocken von #478', seit: vor(8) });
    expect(kurz(basis({ stufe: 'pr', pr: 490, prozess: false, schlangePlatz: 1, andockpruefung: vor(20) }))).toBe('prueft · Andockprüfung des Treibers läuft (PR #490)');
    const notiz = 'PR #478 bereit, ein Mensch dockt an (Andocken: Mensch prüft, Vorschlag: Sicherheit und Zugänge: „Token“ in #463)';
    const x = lageVon(basis({ stufe: 'pr', pr: 478, prozess: false, notiz, merge: { stellung: 'mensch', herkunft: 'vorschlag' } }));
    expect(x).toMatchObject({ etikett: 'wartet_auf_dich', satz: 'PR #478 fertig, Andocken nur durch dich (Andocken: Mensch prüft, Vorschlag: Sicherheit und Zugänge: „Token“ in #463)', deinSchritt: { ziel: 'pr', text: 'PR #478 andocken oder Schalter an der Mission auf automatisch' } });
    // the project's setting: no switch to name
    expect(lageVon(basis({ stufe: 'pr', pr: 478, prozess: false, notiz: 'PR #478 bereit, ein Mensch dockt an (merge: mensch)' })).deinSchritt).toEqual({ ziel: 'pr', text: 'PR #478 andocken' });
  });

  it('blocked, aborted (her step: requeue), merged', () => {
    expect(lageVon(basis({ stufe: 'blockiert', prozess: false, haltUrsache: 'Limit', haltGrund: 'Konto 2 ist nicht angemeldet.\nmehr', haltZeit: vor(30) }))).toMatchObject({ etikett: 'gestoppt', satz: 'Blockiert, Ursache Limit: Konto 2 ist nicht angemeldet.', seit: vor(30), deinSchritt: { ziel: 'einreihen' } });
    expect(kurz(basis({ stufe: 'abgebrochen', prozess: false, haltGrund: 'Leerlauf: 60 min ohne Ausgabe' }))).toBe('gestoppt · Abgebrochen: Leerlauf: 60 min ohne Ausgabe → einreihen: Ursache prüfen, dann neu einreihen oder aufgeben');
    expect(kurz(basis({ stufe: 'gemergt', pr: 478, prozess: false }))).toBe('fertig · PR #478 angedockt');
  });

  it('the kind of a line keeps its time while only the step or a number moves', () => {
    const a = lageVon(basis({ schritt: 'Bash: a' }));
    const b = lageVon(basis({ schritt: 'Read: b' }));
    expect(lageArt(a)).toBe(lageArt(b));
    const platz = (n: number) => lageArt(lageVon(basis({ stufe: 'pr', pr: 5, prozess: false, schlangePlatz: n })));
    expect(platz(2)).toBe(platz(3));
    expect(lageArt(a)).not.toBe(lageArt(lageVon(basis({ gateLauf: vor(1) }))));
  });
});

describe('Tag H: das Gate aus seinen Logs', () => {
  it('finds the worktrees of a mission: the mission worktree and the package worktrees', () => {
    const liste = ['worktree /r', 'branch refs/heads/main', '', 'worktree /w/e', 'branch refs/heads/epic/482-sicht', '', 'worktree /w/k', 'branch refs/heads/agent/483-x', '', 'worktree /w/s', 'branch refs/heads/agent/482-p2-y', '', 'worktree /w/f', 'branch refs/heads/epic/4820-z', '', 'worktree /w/g', 'branch refs/heads/agent/4831-q'].join('\n');
    expect(missionsWorktrees(liste, 482, [483])).toEqual(['/w/e', '/w/k', '/w/s']);
  });

  it('contexts written lately run, older ones are done; an earlier run is dropped; without a running one no gate', () => {
    const wt = mkdtempSync(join(tmpdir(), 'flotte-gate-'));
    const dir = join(wt, '.gate', 'logs');
    mkdirSync(dir, { recursive: true });
    const jetzt = Date.now();
    const log = (name: string, alterMs: number) => {
      writeFileSync(join(dir, `${name}.log`), 'x');
      const t = new Date(jetzt - alterMs);
      utimesSync(join(dir, `${name}.log`), t, t);
    };
    log('wurzel', 40 * 60_000);
    log('stanze', 20 * 60_000);
    log('buero', 10_000);
    log('alt', 5 * 60 * 60_000);
    const g = gateStand([wt, join(wt, 'fehlt')], jetzt, jetzt - 50 * 60_000)!;
    expect(g.kontexte.map((k) => `${k.name}:${k.stand}`)).toEqual(['wurzel:fertig', 'stanze:fertig', 'buero:laeuft']);
    expect(gateSatz(g)).toBe('Andockprüfung: 2 Kontexte fertig, buero läuft');
    expect(g.seit).toBe(new Date(jetzt - 50 * 60_000).toISOString());
    // no known start: a running context makes it a gate; a log hours before the others is an earlier run, and the start stays unknown
    const ohne = gateStand([wt], jetzt)!;
    expect(ohne.kontexte.map((k) => k.name)).toEqual(['wurzel', 'stanze', 'buero']);
    expect(ohne.seit).toBeNull();
    expect(gateStand([wt], jetzt + GATE_STILL_MS)).toBeNull();
  });
});
