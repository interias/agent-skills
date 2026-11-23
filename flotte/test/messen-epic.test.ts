import { describe, expect, it } from 'vitest';
import { leseText, kopfdaten } from '../src/transkript.ts';
import { aufrufLog, epicKennzahlen, epicSumme, modellzeit, paketMerges, programmEreignisse, quantil, rolleAus, stufeAus, ungueltigeAusgaben, type Arbeit } from '../src/messen.ts';
import { T0, min, mensch, assistent, ergebnis } from './hilfen.ts';

const t = (m: number) => T0 + m * 60_000;
const arbeit = (rolle: Arbeit['rolle'], paket: string | null, von: number, bis: number, weighted: number, agentType: string | null = null): Arbeit => ({ rolle, paket, start: t(von), ende: t(bis), weighted, agentType });

describe('roles of an epic run', () => {
  it('maps agent types and listed roles, and the escalation ladder', () => {
    expect(rolleAus('ingenieur-urteil-hoch')).toBe('implementer');
    expect(rolleAus('erster-offizier-standard')).toBe('reviewer');
    expect(rolleAus('kundschafter')).toBe('kundschafter');
    expect(rolleAus('epic-lauf')).toBe('orchestrator');
    expect(rolleAus('konflikt')).toBe('konflikt');
    expect(rolleAus('general-purpose')).toBe('andere');
    expect(rolleAus(null)).toBe('andere');
    expect([stufeAus('ingenieur-mechanisch'), stufeAus('ingenieur-standard'), stufeAus('ingenieur-urteil'), stufeAus('ingenieur-urteil-hoch'), stufeAus('erster-offizier-urteil')]).toEqual([0, 1, 2, 3, -1]);
  });

  it('still reads the agent types of transcripts from before the Sprachraum (ADR-0003)', () => {
    expect([rolleAus('epic-implementer-urteil-hoch'), rolleAus('epic-reviewer-standard'), rolleAus('epic-kundschafter')]).toEqual(['implementer', 'reviewer', 'kundschafter']);
    expect([stufeAus('epic-implementer-mechanisch'), stufeAus('epic-implementer-urteil-hoch'), stufeAus('epic-reviewer-urteil')]).toEqual([0, 3, -1]);
  });

  it('reads span and agent of a transcript, sidechain lines included', () => {
    const k = kopfdaten([JSON.stringify({ type: 'user', isSidechain: true, timestamp: min(3), message: { content: 'x' } }), 'kaputt', JSON.stringify({ type: 'user', timestamp: min(1), agentSetting: 'ingenieur-standard' }), JSON.stringify({ type: 'assistant', timestamp: min(2) })].join('\n'));
    expect(k).toEqual({ von: t(1), bis: t(3), agent: 'ingenieur-standard' });
  });
});

describe('paketMerges and modellzeit', () => {
  it('counts a package merge at its result, not a conflict, an abort or a merge-base', () => {
    const bash = (id: string, command: string) => ({ id, name: 'Bash', input: { command } });
    const e = leseText(
      [
        assistent(10, '', { tools: [bash('m1', 'git -C /wt/epic merge --no-ff agent/55-apfel -m "merge: Paket 55"')] }),
        ergebnis(11, 'm1', "Merge made by the 'ort' strategy."),
        assistent(12, '', { tools: [bash('m2', 'git merge --no-ff agent/56-birne')] }),
        ergebnis(12, 'm2', 'CONFLICT (content): Merge conflict in obst/REGISTER.md\nAutomatic merge failed'),
        assistent(13, '', { tools: [bash('m3', 'git merge --abort agent/56-birne'), bash('m4', 'git merge-base HEAD agent/56-birne')] }),
        assistent(20, '', { tools: [{ id: 'm5', name: 'PowerShell', input: { command: 'git merge --no-ff agent/56-birne' } }] }),
        ergebnis(22, 'm5', 'Merge made'),
      ].join('\n'),
    );
    expect(paketMerges(e)).toEqual([
      { paket: '55', zeit: t(11) },
      { paket: '56', zeit: t(22) },
    ]);
  });

  it('sums the gaps before the model answers inside the span, at most 10 minutes each', () => {
    const e = leseText([mensch(0, '/mission #1'), assistent(1, 'a'), ergebnis(2, 'x', 'r'), assistent(30, 'b'), assistent(30, 'c')].join('\n'));
    expect(modellzeit(e, t(0), t(60))).toBe(11 * 60_000);
    expect(modellzeit(e, t(25), t(60))).toBe(5 * 60_000);
  });

  it('takes the nearest-rank quantile', () => {
    expect(quantil([5, 1, 3, 2, 4, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(quantil([], 0.5)).toBeNull();
  });
});

describe('epicKennzahlen', () => {
  // window 2; 57 needs 55; 56 escalates from Standard to Urteil
  const arbeiten = [
    arbeit('orchestrator', null, 0, 45, 300),
    arbeit('admiral', null, 1, 2, 60),
    arbeit('implementer', '55', 0, 10, 100, 'ingenieur-standard'),
    arbeit('reviewer', '55', 10, 15, 50, 'erster-offizier-standard'),
    arbeit('implementer', '56', 0, 20, 100, 'ingenieur-standard'),
    arbeit('reviewer', '56', 20, 25, 40, 'erster-offizier-standard'),
    arbeit('implementer', '56', 25, 35, 200, 'ingenieur-urteil'),
    arbeit('reviewer', '56', 35, 40, 50, 'erster-offizier-urteil'),
    arbeit('implementer', '57', 18, 28, 80, 'ingenieur-standard'),
    arbeit('reviewer', '57', 28, 30, 20, 'erster-offizier-standard'),
  ];
  const merges = [
    { paket: '55', zeit: t(17) },
    { paket: '57', zeit: t(31) },
    { paket: '56', zeit: t(42) },
  ];
  const k = epicKennzahlen({ arbeiten, merges, fenster: 2, kanten: { '57': ['55'] }, arbeitMs: 50 * 60_000, modellzeit: (von, bis) => (bis - von) / 10, neustarts: [t(19)] });

  it('splits the usage by role and package, the orchestration shared out evenly', () => {
    expect(k.verbrauch.weighted).toBe(1000);
    expect(k.verbrauch.orchestrierung).toEqual({ weighted: 360, anteil: 36 });
    expect(k.verbrauch.je_rolle.implementer).toEqual({ weighted: 480, anteil: 48, auftraege: 4 });
    expect(k.pakete.map((p) => [p.paket, p.summe, p.implementer_auftraege, p.eskalationen])).toEqual([
      ['55', 270, 1, 0],
      ['56', 510, 2, 1],
      ['57', 220, 1, 0],
    ]);
    expect(k.verbrauch.je_paket).toBe(333);
    expect(k.verbrauch.implementer_reviewer_je_paket).toBe(213);
    expect(k.implementer_auftraege_je_paket).toBe(1.3);
    expect(k.eskalationen).toBe(1);
  });

  it('measures merge to next start, reviewer back to next start and the check time with its model share', () => {
    expect(k.zeiten.durchlauf_min).toBe(50);
    expect(k.zeiten.gemergt_bis_naechster_start_s).toMatchObject({ n: 1, median: 60, p90: 60 });
    expect(k.zeiten.reviewer_zurueck_bis_naechster_start_s).toMatchObject({ n: 1, median: 180 });
    expect(k.zeiten.pruefzeit_s).toMatchObject({ n: 3, median: 120, max: 120, modell_s: 30 });
  });

  it('measures from a merge only to a package that was ready at that merge', () => {
    // mini-epic B: b3 merges first, b2 waits for b1; only the merge of b1 frees b2
    const b = epicKennzahlen({
      arbeiten: [arbeit('implementer', '1', 0, 10, 1), arbeit('implementer', '3', 0, 4, 1), arbeit('implementer', '2', 11, 15, 1)],
      merges: [
        { paket: '3', zeit: t(5) },
        { paket: '1', zeit: t(10.5) },
      ],
      fenster: 3,
      kanten: { '2': ['1'] },
    });
    expect(b.zeiten.gemergt_bis_naechster_start_s).toMatchObject({ n: 1, median: 30 });
  });

  it('counts window loss only while a ready package waits for a free place', () => {
    // from 17 to 18 one place is free and 57 is ready (55 merged); 56 alone after 31 has nothing waiting
    expect(k.zeiten.fensterverlust).toEqual({ minuten: 1, laufzeit_min: 42, anteil: 2.4 });
    const ohneKante = epicKennzahlen({ arbeiten, merges, fenster: 2 });
    expect(ohneKante.zeiten.fensterverlust.minuten).toBe(1);
    const eng = epicKennzahlen({ arbeiten, merges, fenster: 2, kanten: { '57': ['56'] } });
    expect(eng.zeiten.fensterverlust.minuten).toBe(0);
  });

  it('measures a restart to its first worker and finds double starts and double merges', () => {
    expect(k.neustart).toEqual({ neustarts: [{ zeit: new Date(t(19)).toISOString(), bis_erster_worker_s: 60, neue_aufrufe_bis_worker: null }], doppelt_gestartete_pakete: 0, doppelte_merges: 0 });
    const doppelt = epicKennzahlen({ arbeiten: [...arbeiten, arbeit('implementer', '55', 5, 12, 10, 'ingenieur-standard')], merges: [...merges, { paket: '55', zeit: t(44) }], fenster: 2 });
    expect(doppelt.neustart).toMatchObject({ doppelt_gestartete_pakete: 1, doppelte_merges: 1 });
  });

  it('works for a run of separate sessions without merges from a transcript', () => {
    const p = epicKennzahlen({ arbeiten: [arbeit('schnitt', null, 0, 2, 10), arbeit('implementer', '9', 2, 5, 30, 'ingenieur-standard')], merges: [], fenster: 3 });
    expect(p.verbrauch.orchestrierung.anteil).toBe(25);
    expect(p.zeiten).toMatchObject({ durchlauf_min: null, pruefzeit_s: { n: 0, modell_s: null }, fensterverlust: { minuten: 0, laufzeit_min: 3 } });
  });
});

describe('epicSumme and ungueltigeAusgaben', () => {
  it('counts results without structured output as invalid', () => {
    const log = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'a' }),
      JSON.stringify({ type: 'result', subtype: 'success', structured_output: { antworten: [] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'Text statt Schema' }),
      'kaputt "result"',
    ].join('\n');
    const fehler = JSON.stringify({ type: 'result', subtype: 'error_max_structured_output_retries' });
    expect(ungueltigeAusgaben([log, fehler])).toEqual({ aufrufe: 3, ungueltig: 2 });
  });

  it('sums epics: means per epic and package, single values pooled', () => {
    const a = { ...epicKennzahlen({ arbeiten: [arbeit('orchestrator', null, 0, 20, 100), arbeit('implementer', '1', 0, 10, 100), arbeit('reviewer', '1', 10, 12, 0)], merges: [{ paket: '1', zeit: t(14) }], fenster: 3, arbeitMs: 20 * 60_000 }), ungueltige_ausgaben: { aufrufe: 2, ungueltig: 0 } };
    const b = { ...epicKennzahlen({ arbeiten: [arbeit('orchestrator', null, 0, 20, 200), arbeit('implementer', '2', 0, 10, 300), arbeit('implementer', '3', 0, 10, 100)], merges: [], fenster: 3, arbeitMs: 40 * 60_000 }), ungueltige_ausgaben: { aufrufe: 2, ungueltig: 1 } };
    const s = epicSumme([a, b]);
    expect(s).toMatchObject({ epics: 2, pakete: 3, verbrauch_je_epic: 400, verbrauch_je_paket: 267, anteil_orchestrierung: 37.5, implementer_reviewer_je_paket: 167, implementer_auftraege_je_paket: 1, eskalationen: 0 });
    expect(s.durchlauf_min).toMatchObject({ n: 2, mittel: 30 });
    expect(s.pruefzeit_s).toMatchObject({ n: 1, median: 120 });
    expect(s.ungueltige_ausgaben).toEqual({ aufrufe: 4, ungueltig: 1, anteil: 25 });
  });
});

describe('flotte mission as the source of an epic run (#68)', () => {
  const ev = (m: number, art: string, text: string, paket: string | null = null, rolle?: string) => ({ zeit: new Date(t(m)).toISOString(), paket, art, ...(rolle ? { rolle } : {}), text });
  const z = {
    ereignisse: [
      ev(0, 'aufruf', 'schnitt, Runde 1', null, 'schnitt'),
      ev(2, 'aufruf', 'implementer (ingenieur-standard), Runde 1', '55', 'implementer'),
      ev(6, 'ungueltig', 'implementer ungültig: Pflichtfeld fehlt', '55', 'implementer'),
      ev(7, 'neustart', 'Programm neu gestartet'),
      ev(7.5, 'aufruf', 'implementer (ingenieur-standard), Runde 1, --resume abc', '55', 'implementer'),
      ev(10, 'aufruf', 'reviewer (erster-offizier-standard), Runde 1', '55', 'reviewer'),
      ev(12, 'gemergt', 'agent/55-apfel gemergt (abc123)', '55'),
      ev(13, 'neustart', 'Programm neu gestartet'),
      ev(13.2, 'aufruf', 'konflikt, Runde 1', '56', 'konflikt'),
      ev(14, 'aufruf', 'implementer (ingenieur-standard), Runde 1', '56', 'implementer'),
    ],
  };

  it('reads role, package and round from the name of a call log', () => {
    expect(aufrufLog('implementer-104-r1.jsonl')).toEqual({ rolle: 'implementer', paket: '104', runde: 1 });
    expect(aufrufLog('konflikt-105-r2.jsonl')).toEqual({ rolle: 'konflikt', paket: '105', runde: 2 });
    expect(aufrufLog('schnitt-r1.jsonl')).toEqual({ rolle: 'schnitt', paket: null, runde: 1 });
    expect(aufrufLog('reviewer-41-p2-r3.jsonl')).toEqual({ rolle: 'reviewer', paket: '41-p2', runde: 3 });
    expect(aufrufLog('schnitt-r1.jsonl.err')).toBeNull();
  });

  it('takes merges, restarts, worker starts, calls started anew and invalid outputs from the events', () => {
    const p = programmEreignisse(z);
    expect(p.merges).toEqual([{ paket: '55', zeit: t(12) }]);
    expect(p.neustarts).toEqual([t(7), t(13)]);
    expect(p.workerStarts).toEqual([t(2), t(7.5), t(10), t(14)]);
    expect(p.neueAufrufe).toEqual([t(0), t(2), t(10), t(13.2), t(14)]);
    expect([p.aufrufe, p.ungueltig]).toEqual([6, 1]);
  });

  it('measures a restart to the first worker process, a --resume included, and counts the calls started anew before it', () => {
    const p = programmEreignisse(z);
    // the transcript of the resumed implementer starts at 2; the process after the restart at 7.5
    const arbeiten = [arbeit('implementer', '55', 2, 9, 100, 'ingenieur-standard'), arbeit('reviewer', '55', 10, 11, 20), arbeit('implementer', '56', 14, 16, 50, 'ingenieur-standard')];
    const k = epicKennzahlen({ arbeiten, merges: p.merges, fenster: 3, neustarts: p.neustarts, workerStarts: p.workerStarts, neueAufrufe: p.neueAufrufe });
    expect(k.neustart.neustarts).toEqual([
      { zeit: new Date(t(7)).toISOString(), bis_erster_worker_s: 30, neue_aufrufe_bis_worker: 0 },
      { zeit: new Date(t(13)).toISOString(), bis_erster_worker_s: 60, neue_aufrufe_bis_worker: 1 },
    ]);
    // without the program's worker starts the first worker after 7 is the reviewer at 10
    expect(epicKennzahlen({ arbeiten, merges: p.merges, fenster: 3, neustarts: [t(7)] }).neustart.neustarts[0]).toMatchObject({ bis_erster_worker_s: 180, neue_aufrufe_bis_worker: null });
    expect(epicSumme([{ ...k, ungueltige_ausgaben: { aufrufe: 7, ungueltig: 1 } }]).neustart).toMatchObject({ bis_erster_worker_s: [30, 60], neue_aufrufe_bis_worker: [0, 1] });
  });
});
