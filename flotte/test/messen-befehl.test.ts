import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { messeEinsatz, type Konfiguration } from '../src/befehle/messen.ts';
import type { Aufrufer } from '../src/aufruf.ts';
import { min, mensch, nachricht, assistent, ergebnis, frage } from './hilfen.ts';

function konto(): string {
  return mkdtempSync(join(tmpdir(), 'flotte-messen-'));
}

function sitzung(kontoDir: string, ordner: string, id: string, zeilen: string[]): string {
  const dir = join(kontoDir, 'projects', ordner);
  mkdirSync(dir, { recursive: true });
  const datei = join(dir, `${id}.jsonl`);
  writeFileSync(datei, zeilen.join('\n'));
  return datei;
}

function subagent(kontoDir: string, ordner: string, id: string, agent: string, agentType: string, zeilen: string[]) {
  const dir = join(kontoDir, 'projects', ordner, id, 'subagents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-${agent}.jsonl`), zeilen.join('\n'));
  writeFileSync(join(dir, `agent-${agent}.meta.json`), JSON.stringify({ agentType, description: 'Lauf #1' }));
}

const aufrufe: string[][] = [];
const stub: Aufrufer = (programm, args) => {
  aufrufe.push([programm, ...args]);
  const a = args.join(' ');
  if (programm === 'gh' && a.startsWith('pr list')) return { code: 0, stdout: JSON.stringify([{ number: 10, createdAt: min(20), mergedAt: min(80) }]), stderr: '' };
  if (programm === 'gh' && a === 'api repos/o/korb --jq .default_branch') return { code: 0, stdout: 'main\n', stderr: '' };
  if (programm === 'gh' && a.startsWith('api --paginate')) return { code: 0, stdout: 'main\nepic/1-x\nagent/2-y\n', stderr: '' };
  if (programm === 'gh' && a.includes('compare/main...epic%2F1-x')) return { code: 0, stdout: '3\n', stderr: '' };
  if (programm === 'gh' && a.includes('compare/')) return { code: 0, stdout: '0\n', stderr: '' };
  if (programm === 'pwsh') return { code: 0, stdout: JSON.stringify({ weighted: 900, roles: [{ role: 'host', weighted: 600 }, { role: 'epic-lauf', weighted: 300 }] }), stderr: '' };
  if (programm === 'git') return { code: 0, stdout: 'worktree C:/r\nHEAD x\n\nworktree C:/r-wt/epic-1\nHEAD y\n', stderr: '' };
  if (programm === 'docker') return { code: 0, stdout: 'korb-epic-1-db-1\nkorb-db-1\nfremd\n', stderr: '' };
  return { code: 1, stdout: '', stderr: 'unbekannt' };
};

describe('messeEinsatz', () => {
  it('measures orchestration, runs from folders and subagents, misses, PRs and remains', () => {
    const k1 = konto();
    const k2 = konto();
    sitzung(k1, 'C--r-korb', 'aaaa1111-leitstand', [
      mensch(0, '/leitstand flotte korb'),
      assistent(1, '', { tools: [{ id: 'q', name: 'AskUserQuestion', input: { questions: [frage('Epic #1 Tailnet?', ['Nein (Recommended)', 'Ja'])] } }] }),
      ergebnis(31, 'q', '"Epic #1 Tailnet?"="Nein (Recommended)"'),
    ]);
    sitzung(k2, 'C--r-korb', 'bbbb2222-admiral', [mensch(0, '/epic-flotte'), assistent(1, 'los')]);
    subagent(k2, 'C--r-korb', 'bbbb2222-admiral', 'x1', 'epic-lauf', [mensch(2, 'Lauf #1'), assistent(3, 'FLOTTE-FRAGE 1 tor', { stop: 'end_turn' }), nachricht(43), assistent(44, 'weiter')]);
    subagent(k2, 'C--r-korb', 'bbbb2222-admiral', 'x2', 'epic-implementer-standard', [mensch(2, 'Paket'), assistent(3, 'fertig', { stop: 'end_turn' }), nachricht(100)]);
    sitzung(k1, 'C--r-korb', 'cccc3333-lauf', [mensch(10, 'Background (from the session that started this one): /epic #1'), assistent(11, 'FLOTTE-ENDE 1 https://x/pull/10', { stop: 'end_turn' }), nachricht(26), assistent(27, 'ok')]);
    sitzung(k2, 'C--r-korb', 'dddd4444-leer', [mensch(12, '<system-reminder>hook</system-reminder>')]);
    sitzung(k1, 'C--r-korb', 'eeee5555-fremd', [mensch(13, 'RAM-Upgrade?'), assistent(14, 'x')]);
    sitzung(k1, 'C--r-korb', 'ffff6666-vorher', [mensch(-500, 'alt'), assistent(-499, 'x')]);

    const konf: Konfiguration = {
      konten: { k1, k2 },
      einsaetze: [
        {
          name: 'korb',
          repo: 'o/korb',
          repoPfad: 'C:/r',
          von: min(0),
          bis: min(200),
          epics: [1, 2],
          orchestrierung: [
            { konto: 'k1', id: 'aaaa1111' },
            { konto: 'k2', id: 'bbbb2222' },
          ],
          laeufe: [{ konto: 'k2', id: 'bbbb2222', agentType: 'epic-lauf' }],
          startOrdner: ['C--r-korb'],
          laeufeAusOrdnern: true,
          ausschliessen: ['eeee5555'],
        },
      ],
    };
    const r = messeEinsatz(konf, konf.einsaetze[0], { aufrufer: stub, usageSkript: 'usage.ps1' });

    expect(r.sitzungen).toEqual({ orchestrierung: 2, laeufe: 3 });
    expect(r.rueckfragen).toMatchObject({ anzahl: 1, je_epic: 0.5, empfehlung_gefolgt: { beurteilbar: 1, gefolgt: 1 } });
    expect(r.rueckfragen.verteilung_epics).toEqual({ '#1': { anzahl: 1, wartenMin: 30 } });
    expect(r.wartezeit_min).toMatchObject({ n: 1, summe: 30, je_epic: 15 });
    expect(r.kalte_zeit_min.summe).toBe(55);
    expect(r.fehlstarts).toMatchObject({ starts: 2, fehlstarts: 1, anteil: 0.5 });
    expect(r.fehlstarts.sitzungen[0]).toContain('dddd4444');
    expect(r.pr_bereit_bis_gemergt_min).toMatchObject({ n: 1, summe: 69, geschaetzt: 0 });
    expect(r.orchestrierung).toMatchObject({ weighted: 1200, je_epic: 600 });
    expect(r.reste).toEqual({ worktrees: 1, branches: 1, container: 1, hinweise: [] });
    expect(r.fehler).toEqual([]);
    expect(aufrufe.filter((a) => a[0] === 'pwsh').every((a) => a.includes('-Since') && a.includes('-Until'))).toBe(true);
  });

  it('reads questions, waits, cold time and starts of a driver deployment from zustand.json (acceptance finding 14)', () => {
    const dir = konto();
    const ev = (m: number, epic: number | null, text: string) => ({ zeit: min(m), epic, text });
    const zustand = {
      ereignisse: [
        ev(0, 12, 'Lauf gestartet'),
        ev(5, 12, 'Zug zu Ende (300 s)'),
        ev(6, 12, '❓ Frage 1 liegt beim Menschen (wartet: der ganze Lauf)'),
        ev(30, 12, 'Antwort des Menschen auf Frage 1'),
        ev(30.2, 12, 'Lauf fortgesetzt'),
        ev(40, 12, 'Zug zu Ende (590 s)'),
        ev(41, 12, 'FLOTTE-ENDE, PR #16'),
        ev(44, 12, 'merge.ps1: GATE FEHLT #16: kein Abschnitt'),
        ev(44.1, 12, 'Lauf fortgesetzt'),
        ev(0, 13, 'Lauf gestartet'),
        ev(1, 13, 'Zug zu Ende (60 s)'),
        ev(1, 13, 'Start ohne Ergebnis (kein_ergebnis, Exit 1), Neustart 1 von 2'),
        ev(1.5, 13, 'Lauf gestartet'),
      ],
      fragen: [{ epic: 12, nr: 1, frage: 'Tor?', empfehlung: 'A', beantwortet: 'A, wie empfohlen' }],
      // #52: an answer of the person kept as a decision is no decision of the admiral
      entscheidungen: [{ epic: 13 }, { epic: 12, von: 'mensch' }],
    };
    writeFileSync(join(dir, 'zustand.json'), JSON.stringify(zustand));
    const konf: Konfiguration = { konten: { k1: konto() }, einsaetze: [{ name: 'probe', repo: 'o/korb', von: min(-1), bis: min(200), epics: [12, 13], orchestrierung: [], laeufe: [], treiberZustand: join(dir, 'zustand.json') }] };
    const r = messeEinsatz(konf, konf.einsaetze[0], { aufrufer: stub, usageSkript: 'u' });
    expect(r.rueckfragen).toMatchObject({ anzahl: 1, form: { treiber: 1 }, empfehlung_gefolgt: { beurteilbar: 1, gefolgt: 1 }, entscheidungen_admiral: 1 });
    expect(r.wartezeit_min).toMatchObject({ n: 1, summe: 24 });
    // #12: 5 → 30.2 is 25.2 min, 24 of them waiting for the person (under 2 min: not counted); 40 → 44.1 is 4.1 min
    expect(r.kalte_zeit_min.je_lauf).toEqual([
      { sitzung: 'treiber/#12', minuten: 4.1 },
      { sitzung: 'treiber/#13', minuten: 0 },
    ]);
    expect(r.fehlstarts).toMatchObject({ starts: 5, fehlstarts: 1 });
    // no forecast records yet: the threshold says how many are missing
    expect(r.prognose).toMatchObject({ status: 'zu_wenig', ab: 5, bisher: 0 });
    writeFileSync(join(dir, 'messungen.jsonl'), [1, 2].map((e) => JSON.stringify({ epic: e, titel: '', konto: null, start: '', ende: '', arbeitS: 3600 * e, menschWartenS: 600, gateS: 300, pakete: [{ name: '#1', klasse: 'urteil', eskalationen: 1 }], prognose: null, treffer: e === 1 })).join('\n') + '\n');
    const r2 = messeEinsatz(konf, konf.einsaetze[0], { aufrufer: stub, usageSkript: 'u' });
    expect(r2.prognose).toMatchObject({ status: 'zu_wenig', bisher: 2, treffer: 1, geprueft: 2, pakete_je_klasse: { urteil: 2 }, eskalationen: 2, arbeit_min: { n: 2, summe: 180 } });
  });

  it('splits an epic run by role: driver logs, subagents, a listed -p session, merges, run time (#64)', () => {
    const k3 = konto();
    const treiber = konto();
    const init = (id: string) => JSON.stringify({ type: 'system', subtype: 'init', cwd: 'C:/p', session_id: id });
    mkdirSync(join(treiber, 'laeufe'), { recursive: true });
    mkdirSync(join(treiber, 'admiral'), { recursive: true });
    // the run of epic 7: started, resumed in the same session; the admiral answered once without structured output
    writeFileSync(join(treiber, 'laeufe', '7-1-0.jsonl'), [init('aaaa1111-orch'), JSON.stringify({ type: 'result', subtype: 'success' })].join('\n'));
    writeFileSync(join(treiber, 'laeufe', '7-2-1.jsonl'), init('aaaa1111-orch'));
    writeFileSync(join(treiber, 'laeufe', '8-1-0.jsonl'), init('ffff0000-fremd'));
    writeFileSync(join(treiber, 'admiral', '7-1.jsonl'), [init('bbbb2222-adm'), JSON.stringify({ type: 'result', subtype: 'success', result: 'Text' })].join('\n'));
    const ev = (m: number, text: string) => ({ zeit: min(m), epic: 7, text });
    writeFileSync(join(treiber, 'zustand.json'), JSON.stringify({ ereignisse: [ev(0, 'Lauf gestartet'), ev(2, 'Lauf fortgesetzt'), ev(25, 'Lauf gestartet')], fragen: [], entscheidungen: [] }));
    writeFileSync(join(treiber, 'messungen.jsonl'), JSON.stringify({ epic: 7, titel: '', konto: null, start: '', ende: '', arbeitS: 1800, menschWartenS: 0, gateS: 0, pakete: [], prognose: null, treffer: null }) + '\n');

    const bash = (id: string, command: string) => ({ id, name: 'Bash', input: { command } });
    sitzung(k3, 'C--p', 'aaaa1111-orch', [
      mensch(0, '/epic-stapel #7'),
      assistent(1, 'Tor'),
      assistent(14, '', { tools: [bash('m1', 'git merge --no-ff agent/9-a')] }),
      ergebnis(15, 'm1', 'Merge made'),
      assistent(30, 'FLOTTE-ENDE'),
    ]);
    subagent(k3, 'C--p', 'aaaa1111-orch', 'i1', 'epic-implementer-standard', [mensch(2, 'Paket'), assistent(8, 'fertig')]);
    subagent(k3, 'C--p', 'aaaa1111-orch', 'r1', 'epic-reviewer-standard', [mensch(9, 'Review'), assistent(12, 'ok')]);
    sitzung(k3, 'C--p', 'bbbb2222-adm', [mensch(1, 'Frageblock'), assistent(1.5, '{}')]);
    // a session of `flotte epic`: claude -p --agent writes agentSetting into its lines
    sitzung(k3, 'C--p', 'cccc3333-impl', [JSON.stringify({ type: 'user', timestamp: min(16), agentSetting: 'epic-implementer-urteil', message: { content: 'Paket 10' } }), assistent(20, 'fertig')]);

    const gewichte: Record<string, unknown> = {
      aaaa1111: { agents: [{ id: 'host', role: 'host', package: null, weighted: 600 }, { id: 'i1', role: 'epic-implementer-standard', package: '9', weighted: 200 }, { id: 'r1', role: 'epic-reviewer-standard', package: '9', weighted: 100 }] },
      bbbb2222: { agents: [{ id: 'host', role: 'host', package: null, weighted: 20 }] },
      cccc3333: { agents: [{ id: 'host', role: 'host', package: null, weighted: 80 }] },
    };
    const usage: string[][] = [];
    const stubEpic: Aufrufer = (programm, args) => {
      if (programm !== 'pwsh') return stub(programm, args);
      usage.push(args);
      const t = args[args.indexOf('-Transcript') + 1];
      const k = Object.keys(gewichte).find((x) => t.includes(x));
      return k ? { code: 0, stdout: JSON.stringify(gewichte[k]), stderr: '' } : { code: 1, stdout: '', stderr: 'x' };
    };
    const konf: Konfiguration = {
      konten: { k3 },
      einsaetze: [{ name: 'probe', repo: 'o/korb', von: min(-1), bis: min(60), epics: [7], orchestrierung: [], laeufe: [], treiberZustand: join(treiber, 'zustand.json'), fenster: 2, epicLaeufe: [{ epic: 7, sitzungen: [{ konto: 'k3', id: 'cccc3333', paket: '10' }] }] }],
    };
    const r = messeEinsatz(konf, konf.einsaetze[0], { aufrufer: stubEpic, usageSkript: 'u' });
    expect(r.fehler).toEqual([]);
    const l = r.epic_laeufe!.laeufe[0];
    expect(l.sitzungen).toEqual({ orchestrator: 1, admiral: 1, implementer: 1 });
    expect(l.verbrauch).toMatchObject({ weighted: 1000, orchestrierung: { weighted: 620, anteil: 62 } });
    expect(l.verbrauch.je_rolle.implementer).toMatchObject({ weighted: 280, auftraege: 2 });
    expect(l.pakete.map((p) => [p.paket, p.implementer, p.reviewer, p.merges])).toEqual([
      ['9', 200, 100, 1],
      ['10', 80, 0, 0],
    ]);
    // reviewer back at 12, merged at 15, next start at 16; model time in between: 14 - 12
    expect(l.zeiten).toMatchObject({ durchlauf_min: 30, gemergt_bis_naechster_start_s: { n: 1, median: 60 }, pruefzeit_s: { n: 1, median: 180, modell_s: 120 } });
    expect(l.neustart.neustarts).toEqual([{ zeit: min(25), bis_erster_worker_s: null }]);
    expect(l.ungueltige_ausgaben).toEqual({ aufrufe: 1, ungueltig: 1 });
    expect(r.epic_laeufe!.summe).toMatchObject({ epics: 1, pakete: 2, verbrauch_je_epic: 1000 });
    expect(usage.every((a) => a.includes('-ModelWeights') && a[a.indexOf('-ModelWeights') + 1] === 'opus=2;sonnet=1;haiku=0.33')).toBe(true);
    expect(usage.some((a) => a.some((x) => x.includes('ffff0000')))).toBe(false);
  });

  it('names a session it cannot find instead of guessing', () => {
    const konf: Konfiguration = {
      konten: { k1: konto() },
      einsaetze: [{ name: 'x', repo: 'o/x', von: min(0), bis: min(10), epics: [], orchestrierung: [{ konto: 'k1', id: 'fehlt' }], laeufe: [] }],
    };
    const r = messeEinsatz(konf, konf.einsaetze[0], { aufrufer: stub, usageSkript: 'u' });
    expect(r.fehler).toContain('Sitzung k1/fehlt nicht gefunden');
  });
});
