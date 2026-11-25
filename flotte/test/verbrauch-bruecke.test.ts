// Tag Q: the driver counts a mission's tokens from the transcripts of its runs while it works, reports them to the bridge
// (sum, per package and role, the estimated share of the weekly limit, per account today and this week), writes the end
// sum into the logbook of the bridge and a line into the PR, tokens only. A mission without transcripts reports nothing.

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fahre } from '../src/treiber/treiber.ts';
import { aufbau, drehbuch, ende, lauf } from './flotte-welt.ts';

const T = 30_000;

async function bruecke() {
  const berichte: any[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/api/bericht') berichte.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(req.method === 'GET' ? '[]' : '{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, berichte, zu: () => new Promise<void>((r) => server.close(() => r())) };
}

const zeile = (id: string, u: Record<string, number>) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id, model: 'claude-opus-5-5', usage: u, content: [] } });

/** the transcript of session s3 (the stand-in's run of mission 3) and an engineer for #31 in the account's projects */
function transkripte(konto: string): void {
  const dir = join(konto, 'projects', 'C--irgendwo');
  mkdirSync(join(dir, 's3', 'subagents'), { recursive: true });
  writeFileSync(join(dir, 's3.jsonl'), `${zeile('h1', { input_tokens: 100_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 9_000_000, output_tokens: 90_000 })}\n`);
  writeFileSync(join(dir, 's3', 'subagents', 'agent-a.jsonl'), `${zeile('i1', { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 10_000 })}\n`);
  writeFileSync(join(dir, 's3', 'subagents', 'agent-a.meta.json'), JSON.stringify({ agentType: 'ingenieur-standard', description: 'Ingenieur #31 Anmeldung' }));
}

describe('Tag Q: the usage of a mission on the bridge', () => {
  it('counted while it works, by package and role, with the estimated weekly share; end sum in the logbook, the PR line without any share', async () => {
    const b = await bruecke();
    try {
      // 10 % of the weekly window used on account 1
      const t = aufbau({ adapter: 'merge: mensch', woche: [0.1, 0.1] });
      transkripte(t.konten[0]);
      const buch = drehbuch([lauf(3, [{ warte: 400 }, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url, maxDauerMs: 4000 }), t.welt);

      const mit = b.berichte.flatMap((x) => x.epics.filter((e: any) => e.nr === 3 && e.verbrauch));
      expect(mit.length).toBeGreaterThan(0);
      const v = mit.at(-1).verbrauch;
      expect(v).toMatchObject({ eingabe: 100_000, cache_schreiben: 0, cache_lesen: 10_000_000, ausgabe: 100_000, summe: 10_200_000, gewichtet: 1_600_000, cache_quote: 0.99 });
      // the only mission runs on the account: its whole weekly share is its own
      expect(v.anteil_woche).toBe(10);
      expect(v.konten).toHaveLength(1);
      expect(v.rollen.map((r: any) => [r.paket, r.rolle, r.summe])).toEqual([
        [null, 'Orchestrator', 9_190_000],
        ['#31', 'Ingenieur', 1_010_000],
      ]);
      expect(v.warnung).toEqual([]);
      const konto = b.berichte.at(-1).konten.find((k: any) => k.missionen);
      expect(konto.missionen).toEqual([{ epic: 3, heute: { summe: 10_200_000, anteil: 10 }, woche: { summe: 10_200_000, anteil: 10 } }]);

      // the logbook of the bridge: the end sum after the merge
      expect(t.p.meldungen.some((m) => /^#3 Verbrauch der Mission: 10,2 Mio Tok \(Eingabe 100 Tsd, Cache-Schreiben 0, Cache-Lesen 10 Mio, Ausgabe 100 Tsd\), Cache 99 %, gewichtet 1,6 Mio, ≈10 % Woche$/.test(m))).toBe(true);
      // the PR: the line with tokens, the rest of the body kept, no share of the plan's limit
      const edits = t.p.prEdits.filter((e) => e.pr === 13);
      expect(edits.length).toBeGreaterThan(0);
      for (const e of edits) {
        expect(e.body).toContain('Verbrauch: 10,2 Mio Tok (Eingabe 100 Tsd, Cache-Schreiben 0, Cache-Lesen 10 Mio, Ausgabe 100 Tsd), Cache 99 %');
        expect(e.body).toContain('Gate grün.');
        expect(e.body).not.toMatch(/Woche|≈|Limit/);
      }
      // the measurement of the finished mission keeps the sum for the comparison
      const messungen = join(t.repo, '.git', 'flotte', 'messungen.jsonl');
      expect(existsSync(messungen)).toBe(true);
      expect(JSON.parse(readFileSync(messungen, 'utf8').trim().split('\n').at(-1)!).verbrauch).toEqual({ summe: 10_200_000, gewichtet: 1_600_000, cache_quote: 0.99 });
    } finally {
      await b.zu();
    }
  }, T);

  it('a mission without transcripts reports no usage and leaves the PR as it is', async () => {
    const b = await bruecke();
    try {
      const t = aufbau({ adapter: 'merge: mensch' });
      const buch = drehbuch([lauf(3, [{ warte: 400 }, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url, maxDauerMs: 4000 }), t.welt);
      expect(b.berichte.length).toBeGreaterThan(0);
      for (const x of b.berichte) {
        for (const e of x.epics) expect(e).not.toHaveProperty('verbrauch');
        for (const k of x.konten) expect(k).not.toHaveProperty('missionen');
      }
      expect(t.p.prEdits).toEqual([]);
      expect(t.p.meldungen.some((m) => m.includes('Verbrauch der Mission'))).toBe(false);
    } finally {
      await b.zu();
    }
  }, T);
});
