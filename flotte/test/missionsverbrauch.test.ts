// Tag Q: what a mission costs, also while it runs (missionsverbrauch.ts): the tokens of its runs and subagents read on
// from the transcripts, each message id once, by package and role; the estimated share of the account's weekly limit;
// the mark against comparable missions; the line of the PR without any share of the plan's limit.

import { describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { leseTokens } from '../src/tokens.ts';
import { anteilWoche, auswerten, Fundstellen, imFenster, logbuchZeile, prBodyMitVerbrauch, prZeile, STUNDE, warnungen, wochenRate, Zaehler, type Quelle } from '../src/treiber/missionsverbrauch.ts';

const T0 = Date.parse('2026-11-25T08:00:00Z');

function nachricht(id: string, ms: number, u: { i?: number; w?: number; r?: number; o?: number }, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(T0 + ms).toISOString(),
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: u.i ?? 0, cache_creation_input_tokens: u.w ?? 0, cache_read_input_tokens: u.r ?? 0, output_tokens: u.o ?? 0 }, content: [{ type: 'text', text: 'ä' }] },
    ...extra,
  });
}

const ordner = () => mkdtempSync(join(tmpdir(), 'verbrauch-'));

function transkript(n = 40): string {
  const z: string[] = [JSON.stringify({ type: 'user', timestamp: new Date(T0).toISOString(), message: { content: 'Mission #491' } })];
  for (let i = 0; i < n; i++) {
    // a message comes in several lines with the same id; the last carries the final output
    z.push(nachricht(`m${i}`, i * 60_000, { i: 10, w: 1000, r: 20_000 + i, o: 50 }));
    z.push(nachricht(`m${i}`, i * 60_000, { i: 10, w: 1000, r: 20_000 + i, o: 300 + i }));
  }
  z.push(JSON.stringify({ type: 'assistant', timestamp: new Date(T0).toISOString(), message: { id: 'syn', model: '<synthetic>', usage: { input_tokens: 999 } } }));
  return `${z.join('\n')}\n`;
}

const Q = (pfad: string, rolle = 'Orchestrator', paket: string | null = null): Quelle => ({ pfad, konto: 'K', rolle, paket });

describe('Zaehler: reading on equals reading whole', () => {
  it('appended in pieces, cut inside a line and inside a character, the sum is the full count and that of tokens.ts', () => {
    const d = ordner();
    const datei = join(d, 's.jsonl');
    const text = transkript();
    const bytes = Buffer.from(text, 'utf8');
    writeFileSync(datei, '');
    const z = new Zaehler();
    // cuts of 97 bytes fall inside lines and inside the two bytes of 'ä'
    for (let i = 0; i < bytes.length; i += 97) {
      appendFileSync(datei, bytes.subarray(i, i + 97));
      z.lies(Q(datei));
    }
    const voll = new Zaehler();
    voll.lies(Q(datei));
    const a = auswerten(z.nachrichten.values());
    expect(a.tokens).toEqual(auswerten(voll.nachrichten.values()).tokens);
    expect(a.tokens).toEqual(leseTokens(text, { von: 0, bis: Infinity }).tokens);
    expect(a.tokens.ausgabe).toBe(40 * 300 + (39 * 40) / 2);
  });

  it('reads only what is new: a second reading without a new line changes nothing and reads no byte', () => {
    const d = ordner();
    const datei = join(d, 's.jsonl');
    writeFileSync(datei, transkript(3));
    const z = new Zaehler();
    expect(z.lies(Q(datei))).toBeGreaterThan(0);
    const vorher = auswerten(z.nachrichten.values()).tokens;
    expect(z.lies(Q(datei))).toBe(0);
    appendFileSync(datei, `${nachricht('neu', 0, { i: 5 })}\n`);
    expect(z.lies(Q(datei))).toBe(Buffer.byteLength(`${nachricht('neu', 0, { i: 5 })}\n`));
    expect(auswerten(z.nachrichten.values()).tokens.eingabe).toBe(vorher.eingabe + 5);
  });

  it('a message id in two files (a resumed session copies its history) counts once, under the first file', () => {
    const d = ordner();
    const a = join(d, 'a.jsonl');
    const b = join(d, 'b.jsonl');
    writeFileSync(a, `${nachricht('x', 0, { i: 100, o: 10 })}\n`);
    writeFileSync(b, `${nachricht('x', 0, { i: 100, o: 10 })}\n${nachricht('y', 0, { i: 1 })}\n`);
    const z = new Zaehler();
    z.lies(Q(a));
    z.lies(Q(b, 'Ingenieur', '#480'));
    const r = auswerten(z.nachrichten.values());
    expect(r.tokens.eingabe).toBe(101);
    expect(r.posten.find((p) => p.rolle === 'Orchestrator')!.tokens.eingabe).toBe(100);
  });
});

describe('auswerten: by package and role, per account and hour', () => {
  it('splits the sum by package and role and keeps each account\'s weighted tokens per hour', () => {
    const d = ordner();
    const host = join(d, 'h.jsonl');
    const ing = join(d, 'i.jsonl');
    const eo = join(d, 'e.jsonl');
    writeFileSync(host, `${nachricht('h1', 0, { i: 1000, r: 9000 })}\n`);
    writeFileSync(ing, `${nachricht('i1', 2 * STUNDE, { i: 100, w: 400, o: 100 })}\n`);
    writeFileSync(eo, `${nachricht('e1', 2 * STUNDE, { r: 1000 })}\n`);
    const z = new Zaehler();
    z.lies(Q(host));
    z.lies({ pfad: ing, konto: 'K2', rolle: 'Ingenieur', paket: '#480' });
    z.lies({ pfad: eo, konto: 'K2', rolle: 'Erster Offizier', paket: '#480' });
    const r = auswerten(z.nachrichten.values());
    expect(r.posten.map((p) => `${p.paket ?? '-'} ${p.rolle}`)).toEqual(['- Orchestrator', '#480 Ingenieur', '#480 Erster Offizier']);
    expect(r.posten[1].tokens).toEqual({ eingabe: 100, cache_schreiben: 400, cache_lesen: 0, ausgabe: 100, nachrichten: 1 });
    expect(r.konten).toEqual({ K: 1000 + 900, K2: 100 + 500 + 500 + 100 });
    const stunde = String(Math.floor((T0 + 2 * STUNDE) / STUNDE));
    expect(r.stunden.K2[stunde]).toEqual([100 + 400 + 100 + 1000, 1100 + 100]);
    expect(imFenster(r.stunden.K2, T0 + STUNDE, T0 + 3 * STUNDE)).toEqual({ summe: 1600, gewichtet: 1200 });
    expect(imFenster(r.stunden.K, T0 + STUNDE, T0 + 3 * STUNDE)).toEqual({ summe: 0, gewichtet: 0 });
  });
});

describe('Fundstellen: from the logs of the runs to the transcripts of the account', () => {
  it('finds the session of each run log by its init line, its transcript below the account and its subagents with role and package', () => {
    const d = ordner();
    const laeufe = join(d, 'laeufe');
    const konto = join(d, 'konto');
    mkdirSync(laeufe);
    const cwd = 'C:\\Users\\nutzer\\git\\projekt-worktrees\\epic-491';
    writeFileSync(join(laeufe, '491-1000.jsonl'), `${JSON.stringify({ type: 'system', subtype: 'init', cwd, session_id: 'sitzung-a' })}\n`);
    writeFileSync(join(laeufe, '492-1000.jsonl'), `${JSON.stringify({ type: 'system', subtype: 'init', cwd, session_id: 'fremd' })}\n`);
    const proj = join(konto, 'projects', 'C--Users-nutzer-git-projekt-worktrees-epic-491');
    mkdirSync(join(proj, 'sitzung-a', 'subagents'), { recursive: true });
    writeFileSync(join(proj, 'sitzung-a.jsonl'), '');
    writeFileSync(join(proj, 'fremd.jsonl'), '');
    const sub = join(proj, 'sitzung-a', 'subagents');
    writeFileSync(join(sub, 'agent-1.jsonl'), '');
    writeFileSync(join(sub, 'agent-1.meta.json'), JSON.stringify({ agentType: 'ingenieur-standard', description: 'Ingenieur #480 Login' }));
    writeFileSync(join(sub, 'agent-2.jsonl'), '');
    writeFileSync(join(sub, 'agent-2.meta.json'), JSON.stringify({ agentType: 'erster-offizier-urteil', description: 'Erster Offizier #45-p2' }));
    writeFileSync(join(sub, 'agent-3.jsonl'), '');
    writeFileSync(join(sub, 'agent-3.meta.json'), JSON.stringify({ agentType: 'kundschafter', description: 'Fundstellen für das Vorab-Tor' }));
    writeFileSync(join(sub, 'agent-4.jsonl'), '');
    writeFileSync(join(sub, 'agent-4.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Andockprüfung der Mission' }));
    const q = new Fundstellen().quellen(laeufe, 491, [join(d, 'anderes'), konto]);
    expect(q.map((x) => [relative(proj, x.pfad).replace(/\\/g, '/'), x.konto === konto, x.rolle, x.paket])).toEqual([
      ['sitzung-a.jsonl', true, 'Orchestrator', null],
      ['sitzung-a/subagents/agent-1.jsonl', true, 'Ingenieur', '#480'],
      ['sitzung-a/subagents/agent-2.jsonl', true, 'Erster Offizier', '#45-p2'],
      ['sitzung-a/subagents/agent-3.jsonl', true, 'Kundschafter', null],
      ['sitzung-a/subagents/agent-4.jsonl', true, 'Andockprüfung', null],
    ]);
  });

  it('a log without its init line yet is asked again; a subagent that appears later is found then', () => {
    const d = ordner();
    const laeufe = join(d, 'laeufe');
    const konto = join(d, 'konto');
    mkdirSync(laeufe);
    const log = join(laeufe, '7-1.jsonl');
    writeFileSync(log, '');
    const f = new Fundstellen();
    expect(f.quellen(laeufe, 7, [konto])).toEqual([]);
    appendFileSync(log, `${JSON.stringify({ type: 'system', subtype: 'init', cwd: '/tmp/x', session_id: 's7' })}\n`);
    const proj = join(konto, 'projects', '-tmp-x');
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, 's7.jsonl'), '');
    expect(f.quellen(laeufe, 7, [konto]).length).toBe(1);
    mkdirSync(join(proj, 's7', 'subagents'), { recursive: true });
    writeFileSync(join(proj, 's7', 'subagents', 'agent-9.jsonl'), '');
    expect(f.quellen(laeufe, 7, [konto]).map((x) => x.rolle)).toEqual(['Orchestrator', 'Subagent']);
  });

  it('a transcript in another project folder is found by searching the account once', () => {
    const d = ordner();
    const laeufe = join(d, 'laeufe');
    const konto = join(d, 'konto');
    mkdirSync(laeufe);
    writeFileSync(join(laeufe, '8-1.jsonl'), `${JSON.stringify({ type: 'system', subtype: 'init', cwd: '/anders', session_id: 's8' })}\n`);
    mkdirSync(join(konto, 'projects', 'woanders'), { recursive: true });
    writeFileSync(join(konto, 'projects', 'woanders', 's8.jsonl'), '');
    expect(new Fundstellen().quellen(laeufe, 8, [konto]).map((x) => x.pfad)).toEqual([join(konto, 'projects', 'woanders', 's8.jsonl')]);
  });
});

describe('the share of the weekly limit', () => {
  it('the account\'s share over the weighted tokens of its mission runs in the window; too little to measure: none', () => {
    expect(wochenRate(12, 4_000_000)).toBe(3);
    expect(wochenRate(12, 400_000)).toBeNull();
    expect(wochenRate(0.2, 4_000_000)).toBeNull();
  });

  it('a mission\'s share is its weighted tokens per account times that account\'s rate; an account without a rate: none', () => {
    expect(anteilWoche({ K1: 1_000_000, K2: 500_000 }, { K1: 3, K2: 2 })).toBe(4);
    expect(anteilWoche({ K1: 1_000_000, K2: 500_000 }, { K1: 3, K2: null })).toBeNull();
    expect(anteilWoche({ K1: 1_234_567, K2: 0 }, { K1: 2.5 })).toBe(3.1);
    expect(anteilWoche({}, {})).toBeNull();
  });
});

describe('the mark: twice the mean of comparable missions, or a cache rate under 70 %', () => {
  const t = (eingabe: number, lesen: number) => ({ eingabe, cache_schreiben: 0, cache_lesen: lesen, ausgabe: 0, nachrichten: 1 });
  const frueher = [
    { pakete: 3, gewichtet: 1_000_000 },
    { pakete: 4, gewichtet: 1_200_000 },
    { pakete: 9, gewichtet: 10_000_000 },
  ];

  it('compares with missions of the same package count ± 1', () => {
    expect(warnungen(t(0, 10_000_000), 2_200_000, 3, frueher)).toEqual(['2-mal das Mittel von 2 vergleichbaren abgeschlossenen Missionen (1,1 Mio gewichtet)']);
    expect(warnungen(t(0, 10_000_000), 2_100_000, 3, frueher)).toEqual([]);
  });

  it('without comparable ones with all; without any finished mission no mark', () => {
    expect(warnungen(t(0, 10_000_000), 8_000_000, 20, frueher)).toEqual([]);
    expect(warnungen(t(0, 10_000_000), 9_000_000, 20, frueher)).toEqual(['2,2-mal das Mittel von 3 vergleichbaren abgeschlossenen Missionen (4,1 Mio gewichtet)']);
    expect(warnungen(t(0, 10_000_000), 9_000_000, 3, [])).toEqual([]);
  });

  it('a cache rate under 70 % marks from 500 000 input tokens on', () => {
    expect(warnungen(t(200_000, 300_000), 0, 3, [])).toEqual(['Cache-Quote 60 % unter 70 %']);
    expect(warnungen(t(200_000, 299_999), 0, 3, [])).toEqual([]);
    expect(warnungen(t(150_000, 350_000), 0, 3, [])).toEqual([]);
  });
});

describe('the PR line and the logbook: tokens, never a share of the plan\'s limit', () => {
  const tokens = { eingabe: 12_000, cache_schreiben: 180_000, cache_lesen: 2_200_000, ausgabe: 40_000, nachrichten: 9 };

  it('names the tokens and the cache rate, no share of the weekly limit', () => {
    const z = prZeile(tokens);
    expect(z).toBe('Verbrauch: 2,4 Mio Tok (Eingabe 12 Tsd, Cache-Schreiben 180 Tsd, Cache-Lesen 2,2 Mio, Ausgabe 40 Tsd), Cache 92 %');
    expect(z).not.toMatch(/Woche|Limit|%\s*Woche|≈/);
  });

  it('replaces its line in the body, else stands before the generated line, else at the end', () => {
    const z = prZeile(tokens);
    expect(prBodyMitVerbrauch('Text\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)', z)).toBe(`Text\n\n${z}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`);
    expect(prBodyMitVerbrauch(`Text\n\n${prZeile({ ...tokens, ausgabe: 1 })}\n\nEnde`, z)).toBe(`Text\n\n${z}\n\nEnde`);
    expect(prBodyMitVerbrauch('Text\n', z)).toBe(`Text\n\n${z}\n`);
    expect(prBodyMitVerbrauch('', z)).toBe(z);
  });

  it('the logbook carries the end sum with the weighted tokens and the estimated share', () => {
    expect(logbuchZeile(tokens, 3.1)).toBe('Verbrauch der Mission: 2,4 Mio Tok (Eingabe 12 Tsd, Cache-Schreiben 180 Tsd, Cache-Lesen 2,2 Mio, Ausgabe 40 Tsd), Cache 92 %, gewichtet 657 Tsd, ≈3,1 % Woche');
    expect(logbuchZeile(tokens, null)).toBe('Verbrauch der Mission: 2,4 Mio Tok (Eingabe 12 Tsd, Cache-Schreiben 180 Tsd, Cache-Lesen 2,2 Mio, Ausgabe 40 Tsd), Cache 92 %, gewichtet 657 Tsd');
  });
});
