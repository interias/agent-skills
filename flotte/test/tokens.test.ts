import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheQuote, kategorie, ladeSitzung, leseTokens, tokenKennzahlen } from '../src/tokens.ts';
import { epicVerlauf } from '../src/messen.ts';
import { ergebnis, mensch, min, T0 } from './hilfen.ts';

const fenster = { von: T0 - 60 * 60_000, bis: T0 + 600 * 60_000 };

function antwort(m: number, id: string, u: { i: number; w: number; r: number; o: number }, tools: { id: string; name: string }[] = [], model = 'claude-haiku-5-5'): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: min(m),
    message: { id, role: 'assistant', model, content: tools.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: {} })), usage: { input_tokens: u.i, cache_creation_input_tokens: u.w, cache_read_input_tokens: u.r, output_tokens: u.o } },
  });
}

describe('leseTokens', () => {
  it('counts a message once, skips <synthetic> and lines outside the window, sums tool result sizes per tool', () => {
    const zeilen = [
      mensch(0, '/epic-stapel #43'),
      antwort(1, 'm1', { i: 10, w: 100, r: 0, o: 5 }, [{ id: 't1', name: 'Bash' }]),
      antwort(1, 'm1', { i: 10, w: 100, r: 0, o: 5 }),
      ergebnis(2, 't1', 'x'.repeat(1200)),
      antwort(3, 'm2', { i: 2, w: 0, r: 300, o: 7 }),
      antwort(4, 'syn', { i: 999, w: 999, r: 999, o: 999 }, [], '<synthetic>'),
      antwort(9000, 'spaet', { i: 1, w: 1, r: 1, o: 1 }),
    ];
    const r = leseTokens(zeilen.join('\n'), fenster);
    expect(r.tokens).toEqual({ eingabe: 12, cache_schreiben: 100, cache_lesen: 300, ausgabe: 12, nachrichten: 2 });
    expect(r.zeichen).toEqual({ Bash: 1200 });
    expect(r.ersterText).toBe('/epic-stapel #43');
    expect(cacheQuote(r.tokens)).toBe(0.728);
  });
});

describe('ladeSitzung and tokenKennzahlen', () => {
  it('splits a run into host and subagents per type, epic and package, and counts review rounds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flotte-tokens-'));
    const sitzung = join(dir, 'aaaa.jsonl');
    writeFileSync(sitzung, [mensch(0, 'Auftrag: /epic-stapel #43 unter dem Treiber'), antwort(1, 'h1', { i: 5, w: 1000, r: 0, o: 50 })].join('\n'));
    const sub = join(dir, 'aaaa', 'subagents');
    mkdirSync(sub, { recursive: true });
    const agent = (name: string, typ: string, beschreibung: string, u: { i: number; w: number; r: number; o: number }) => {
      writeFileSync(join(sub, `agent-${name}.jsonl`), [mensch(2, 'Auftrag'), antwort(3, `${name}-1`, u, [{ id: `${name}-t`, name: 'Bash' }]), ergebnis(4, `${name}-t`, 'y'.repeat(100))].join('\n'));
      writeFileSync(join(sub, `agent-${name}.meta.json`), JSON.stringify({ agentType: typ, description: beschreibung }));
    };
    agent('i1', 'ingenieur-standard', 'Implementer #43-p1', { i: 1, w: 200, r: 800, o: 40 });
    agent('r1', 'erster-offizier-standard', 'Reviewer #43-p1', { i: 1, w: 100, r: 400, o: 20 });
    agent('i2', 'ingenieur-standard', 'Implementer #43-p1 Runde 2', { i: 1, w: 50, r: 900, o: 10 });
    agent('r2', 'erster-offizier-standard', 'Reviewer #43-p1 Runde 2', { i: 1, w: 10, r: 200, o: 5 });
    agent('k', 'kundschafter', 'Kundschafter Behauptungen', { i: 1, w: 10, r: 0, o: 1 });
    writeFileSync(join(sub, 'agent-leer.jsonl'), mensch(2, 'nichts'));

    const laeufe = ladeSitzung(sitzung, fenster, [43, 44]);
    expect(laeufe).toHaveLength(6);
    expect(laeufe.every((l) => l.epic === 43)).toBe(true);

    const k = tokenKennzahlen(laeufe);
    expect(k.summe.ausgabe).toBe(126);
    expect(k.je_agent_typ['ingenieur-standard']).toMatchObject({ agenten: 2, eingabe: 2, cache_schreiben: 250, cache_lesen: 1700, ausgabe: 50, ergebnis_zeichen: { Bash: 200 } });
    expect(k.je_agent_typ['ingenieur-standard'].cache_quote).toBe(0.871);
    expect(k.je_agent_typ.lauf).toMatchObject({ agenten: 1, cache_quote: 0 });
    expect(Object.keys(k.je_epic)).toEqual(['#43']);
    expect(k.je_paket).toEqual([expect.objectContaining({ epic: 43, paket: '43-p1', implementer_laeufe: 2, review_runden: 2, ausgabe: 75 })]);
    expect(k.review_runden).toEqual({ pakete: 1, mittel: 2, ueber_eins: 1 });
  });
});

describe('epicVerlauf', () => {
  it('measures lead time without waiting for the person, counts give-backs and halts as errors, leaves running epics out', () => {
    const ev = (m: number, epic: number, text: string) => ({ zeit: min(m), epic, text });
    const z = {
      ereignisse: [
        ev(0, 1, 'Lauf gestartet'),
        ev(5, 1, '❓ Frage 1 liegt beim Menschen (wartet: Lauf)'),
        ev(15, 1, 'Antwort des Menschen auf Frage 1'),
        ev(30, 1, 'FLOTTE-ENDE, PR #9'),
        ev(0, 2, 'Lauf gestartet'),
        ev(20, 2, 'FLOTTE-ENDE, PR #10'),
        ev(25, 2, 'zurück an den Lauf (1 von 2), danach ans Ende der Schlange: Gate rot'),
        ev(0, 3, 'Lauf gestartet'),
        ev(40, 3, 'blockiert: Gesperrt durch guard.ps1'),
        ev(0, 4, 'Lauf gestartet'),
      ],
      fragen: [],
      entscheidungen: [],
    };
    const v = epicVerlauf(z, fenster);
    expect(v.epics.map((e) => [e.epic, e.durchlauf_min, e.fehler])).toEqual([
      [1, 20, false],
      [2, 20, true],
      [3, null, true],
      [4, null, false],
    ]);
    expect(v.epics[3].offen).toBe(true);
    expect(v.epics[2].halt).toBe('blockiert');
    expect(v.fehlerquote).toBe(0.7);
    expect(v.durchlauf_min.mittel).toBe(20);
  });
});

describe('kontext', () => {
  it('sorts tool results into categories', () => {
    expect(kategorie('Bash', 'npm run gate -- --voll')).toBe('gate');
    expect(kategorie('PowerShell', 'npx vitest run src/a.test.ts')).toBe('test');
    expect(kategorie('Bash', 'git -C /wt diff HEAD --stat')).toBe('git-diff');
    expect(kategorie('Bash', 'ls')).toBe('shell');
    expect(kategorie('Read', '')).toBe('lesen');
    expect(kategorie('Agent', '')).toBe('andere');
  });

  it('charges a result its cache write and one read per later model call', () => {
    function mitBefehl(m: number, id: string, cmd: string) {
      return JSON.stringify({ type: 'assistant', timestamp: min(m), message: { id, role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: `${id}-t`, name: 'Bash', input: { command: cmd } }], usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } } });
    }
    const zeilen = [mitBefehl(1, 'a', 'npm test'), ergebnis(2, 'a-t', 'x'.repeat(400)), antwort(3, 'b', { i: 0, w: 0, r: 0, o: 1 }), antwort(4, 'c', { i: 0, w: 0, r: 0, o: 1 })];
    // 400 characters = 100 tokens: 125 written, read by the two later calls: 2 x 10
    expect(leseTokens(zeilen.join('\n'), fenster).kontext).toEqual({ test: 145 });
  });
});
