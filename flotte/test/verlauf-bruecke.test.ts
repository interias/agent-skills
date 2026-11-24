// Tag J: the driver sends the condensed history of a mission to the bridge (POST /api/verlauf), only when it changed,
// without tool output, secrets masked, paths short; the report keeps its size and carries the step in plain words.

import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fahre } from '../src/treiber/treiber.ts';
import type { VerlaufEintrag } from '../src/treiber/verlauf.ts';
import { aufbau, drehbuch, ende, lauf } from './flotte-welt.ts';

const T = 30_000;
const GEHEIM = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

/** A stand-in bridge that records every history and every report. */
async function bruecke() {
  const verlaeufe: { forge: string; epic: number; stand: string; eintraege: VerlaufEintrag[] }[] = [];
  const berichte: any[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (x: unknown, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(x));
      };
      if (req.method === 'POST' && req.url === '/api/verlauf') {
        verlaeufe.push(JSON.parse(body));
        return json({ ok: true });
      }
      if (req.method === 'POST' && req.url === '/api/bericht') {
        berichte.push(JSON.parse(body));
        return json({ ok: true });
      }
      if (req.method === 'GET') return json([]);
      json({ ok: true });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, verlaeufe, berichte, zu: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('Tag J: the history of a mission on the bridge', () => {
  it('sent once per change, condensed, masked, with short paths; the report carries the step in plain words', async () => {
    const b = await bruecke();
    try {
      const t = aufbau({ adapter: 'merge: mensch' });
      const befehl = `cd ${t.repo} && GH_TOKEN=${GEHEIM} python -m pytest -q tests`;
      const buch = drehbuch([
        lauf(3, [
          { zeile: { type: 'assistant', timestamp: '2026-11-24T07:00:00Z', message: { id: 'm1', content: [{ type: 'text', text: 'Ich fahre die Tests.' }] } } },
          { zeile: { type: 'assistant', timestamp: '2026-11-24T07:00:01Z', message: { id: 'm2', content: [{ type: 'tool_use', id: 'toolu_t1', name: 'Bash', input: { command: befehl, description: 'Tests der Stanze' } }] } } },
          { zeile: { type: 'user', timestamp: '2026-11-24T07:00:09Z', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_t1', content: 'AUSGABE 12 passed', is_error: false }] } } },
          { warte: 400 },
          { text: ende(3, 13) },
        ]),
      ]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url, maxDauerMs: 4000 }), t.welt);
      expect(b.verlaeufe.length).toBeGreaterThan(0);
      // the same history is not sent twice
      const staende = b.verlaeufe.map((v) => JSON.stringify(v.eintraege));
      expect(new Set(staende).size).toBe(staende.length);
      const letzter = b.verlaeufe.at(-1)!;
      expect(letzter).toMatchObject({ forge: 'o/r', epic: 3 });
      const tests = letzter.eintraege.find((e) => e.id === 'toolu_t1')!;
      expect(tests).toMatchObject({ art: 'werkzeug', wz: 'Tests', text: 'Tests der Stanze', stand: 'fertig', zeit: '2026-11-24T07:00:01Z', bis: '2026-11-24T07:00:09Z' });
      expect(tests.roh).toBe('cd . && GH_TOKEN=*** python -m pytest -q tests');
      expect(letzter.eintraege[0]).toMatchObject({ art: 'text', text: 'Ich fahre die Tests.' });
      const alles = JSON.stringify(b.verlaeufe);
      expect(alles).not.toContain('AUSGABE');
      expect(alles).not.toContain(GEHEIM);
      expect(alles).not.toContain(t.repo.replaceAll('\\', '\\\\'));
      // the report: no history in it, the step without a raw command or a local path
      const berichte = JSON.stringify(b.berichte);
      expect(berichte).not.toContain('toolu_t1');
      expect(berichte).not.toContain(GEHEIM);
      const schritte = b.berichte.flatMap((x) => x.epics.map((e: any) => e.schritt)).filter(Boolean);
      expect(schritte).toContain('Orchestrierung fährt Tests: Tests der Stanze');
    } finally {
      await b.zu();
    }
  }, T);
});
