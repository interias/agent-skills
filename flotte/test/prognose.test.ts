// The forecast (#28, Prognose): records per finished epic, the threshold, the Monte Carlo with a
// fixed seed, the self check, and the driver writing and reporting it.

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fahre } from '../src/treiber/treiber.ts';
import type { Bericht } from '../src/treiber/bruecke.ts';
import { flotteDir } from '../src/werkzeuge/zustand.ts';
import { getroffen, gewicht, liesMessungen, type Messung, paketeAusLogs, prognoseBacklog, prognoseEpic, stand } from '../src/werkzeuge/prognose.ts';
import { aufbau, drehbuch, ende, lauf, werkzeug } from './flotte-welt.ts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const T = 30_000;

const agent = (klasse: string, beschreibung: string) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: `epic-implementer-${klasse}`, description: beschreibung } }] } });
const log = (...zeilen: object[]) => zeilen.map((z) => JSON.stringify(z)).join('\n');

/** a finished epic: n packages of one class, its work time, gate time */
function messung(epic: number, klasse: Messung['pakete'][number]['klasse'], n: number, arbeitS: number, gateS = 600, extra: Partial<Messung> = {}): Messung {
  return { epic, titel: '', konto: 'Konto 1', start: '2026-11-01T08:00:00Z', ende: '2026-11-01T10:00:00Z', arbeitS, menschWartenS: 0, gateS, pakete: Array.from({ length: n }, (_, i) => ({ name: `#${epic * 10 + i}`, klasse, eskalationen: 0 })), prognose: null, treffer: null, ...extra };
}

describe('Prognose: records', () => {
  it('reads class and escalations of each package from the implementer calls of all turns', () => {
    const pakete = paketeAusLogs([
      log(agent('standard', 'Implementer #11 Schema'), agent('mechanisch', 'Implementer #12 Umbenennung'), { type: 'result', result: 'x' }),
      log(agent('urteil', 'Implementer #11 zweite Runde'), agent('urteil-hoch', 'Implementer #11 dritte Runde'), { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'epic-reviewer-standard', description: 'Reviewer #12' } }] } }, agent('standard', 'Implementer P3')),
    ]);
    expect(pakete).toEqual([
      { name: '#11', klasse: 'standard', eskalationen: 2 },
      { name: '#12', klasse: 'mechanisch', eskalationen: 0 },
      { name: 'P3', klasse: 'standard', eskalationen: 0 },
    ]);
  });

  it('weighs by class and escalation, spread over up to three packages at once', () => {
    expect(gewicht([])).toBe(0);
    expect(gewicht([{ klasse: 'urteil', eskalationen: 0 }])).toBe(2);
    expect(gewicht(Array.from({ length: 6 }, () => ({ klasse: 'standard' as const, eskalationen: 0 })))).toBe(2);
    expect(gewicht([{ klasse: 'standard', eskalationen: 1 }, { klasse: 'mechanisch', eskalationen: 0 }])).toBe(1.25);
  });
});

describe('Prognose: threshold and self check', () => {
  const fuenf = [1, 2, 3, 4, 5].map((e) => messung(e, 'standard', 2, 3600));

  it('shows nothing below the threshold, then counts by itself', () => {
    expect(prognoseEpic(fuenf.slice(0, 4), 2, 5)).toBeNull();
    expect(stand(fuenf.slice(0, 4), 5)).toMatchObject({ status: 'zu_wenig', bisher: 4, ab: 5 });
    expect(prognoseEpic(fuenf, 2, 5)).not.toBeNull();
    expect(stand(fuenf, 5).status).toBe('ok');
    // the threshold is the adapter's
    expect(prognoseEpic(fuenf.slice(0, 3), 2, 3)).not.toBeNull();
  });

  it('hides the forecast as too imprecise when fewer than 60 % of the checked epics fell into their span', () => {
    const geprueft = (treffer: boolean[]) => [...fuenf, ...treffer.map((t, i) => messung(10 + i, 'standard', 2, 3600, 600, { treffer: t }))];
    expect(stand(geprueft([true, true, true, false, false]), 5)).toMatchObject({ status: 'ok', treffer: 3, geprueft: 5 });
    expect(stand(geprueft([true, true, false, false, false]), 5)).toMatchObject({ status: 'ungenau', treffer: 2, geprueft: 5 });
    // too few checks say nothing yet
    expect(stand(geprueft([false, false]), 5).status).toBe('ok');
    expect(getroffen({ p10: 10, p50: 20, p90: 30 }, 30)).toBe(true);
    expect(getroffen({ p10: 10, p50: 20, p90: 30 }, 31)).toBe(false);
    expect(getroffen(null, 31)).toBeNull();
  });
});

describe('Prognose: Monte Carlo', () => {
  it('the same pace everywhere gives one exact value: complexity counts by class, not by ticket count', () => {
    // a judgement package took twice as long as a standard one: the same pace per weight
    const hist = [messung(1, 'standard', 2, 3600), messung(2, 'urteil', 2, 7200), messung(3, 'standard', 2, 3600), messung(4, 'urteil', 2, 7200), messung(5, 'mechanisch', 2, 1800)];
    const s = prognoseEpic(hist, 3, 5)!;
    // 3 packages drawn from the pool: per draw weight/3 × 3600 s + 600 s gate
    expect(s.p10).toBeGreaterThanOrEqual(1800 + 600);
    expect(s.p90).toBeLessThanOrEqual(7200 + 600);
    const gleich = [1, 2, 3, 4, 5].map((e) => messung(e, 'standard', 2, 3600));
    expect(prognoseEpic(gleich, 4, 5)).toEqual({ p10: 5400, p50: 5400, p90: 5400 });
  });

  it('is deterministic with a fixed seed and spreads with the measured spread', () => {
    const hist = [1800, 3600, 5400, 7200, 9000, 3600].map((a, i) => messung(i + 1, 'standard', 2, a));
    expect(prognoseEpic(hist, 2, 5, 7)).toEqual(prognoseEpic(hist, 2, 5, 7));
    const s = prognoseEpic(hist, 2, 5)!;
    expect(s.p10).toBeLessThan(s.p50);
    expect(s.p50).toBeLessThan(s.p90);
  });

  it('the backlog on the places of the fleet limit; a running epic needs only what is left', () => {
    const gleich = [1, 2, 3, 4, 5].map((e) => messung(e, 'standard', 2, 3600, 0));
    const drei = [{ n: 2, bisherS: 0 }, { n: 2, bisherS: 0 }, { n: 2, bisherS: 0 }];
    expect(prognoseBacklog(gleich, drei, 1, 5)!.p50).toBe(3 * 3600);
    expect(prognoseBacklog(gleich, drei, 2, 5)!.p50).toBe(2 * 3600);
    expect(prognoseBacklog(gleich, drei, 3, 5)!.p50).toBe(3600);
    expect(prognoseBacklog(gleich, [{ n: 2, bisherS: 2700 }], 1, 5)!.p50).toBe(900);
    expect(prognoseBacklog(gleich, [], 1, 5)).toBeNull();
    expect(prognoseBacklog(gleich.slice(0, 2), drei, 1, 5)).toBeNull();
  });
});

describe('Prognose: the driver', () => {
  it('measures a finished epic with its packages, reports the threshold, and with enough history a span per waiting epic and the backlog', async () => {
    const berichte: Bericht[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/api/bericht') berichte.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(req.method === 'GET' ? '[]' : '{"ok":true}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const t = aufbau({ bodies: { 3: '## Betroffene Module\n- m3\n\n- [ ] #31\n- [ ] #32', 4: '## Betroffene Module\n- m4\n\n- [ ] #41' } });
      const dir = flotteDir(t.repo);
      mkdirSync(dir, { recursive: true });
      // five finished epics of earlier deployments in this repository
      writeFileSync(join(dir, 'messungen.jsonl'), [1, 2, 3, 4, 5].map((e) => JSON.stringify(messung(100 + e, 'standard', 2, 3600))).join('\n') + '\n');
      const buch = drehbuch([
        lauf(3, [...werkzeug('Agent', { subagent_type: 'epic-implementer-standard', description: 'Implementer #31 Schema' }, 'ok'), ...werkzeug('Agent', { subagent_type: 'epic-implementer-urteil', description: 'Implementer #32 API' }, 'ok'), { text: ende(3, 13) }]),
        lauf(4, [{ text: ende(4, 14) }]),
      ]);
      await fahre(t.einstellung(buch, [3, 4], { bruecke: url, obergrenze: 1, maxDauerMs: 6000 }), t.welt);
      const m = liesMessungen(dir).filter((x) => x.epic === 3);
      expect(m).toHaveLength(1);
      expect(m[0].pakete).toEqual([
        { name: '#31', klasse: 'standard', eskalationen: 0 },
        { name: '#32', klasse: 'urteil', eskalationen: 0 },
      ]);
      expect(m[0].arbeitS).toBeGreaterThanOrEqual(0);
      // the forecast shown at its start is kept and checked
      expect(m[0].prognose).not.toBeNull();
      expect(typeof m[0].treffer).toBe('boolean');
      const mitWartendem = berichte.find((b) => b.epics.some((e) => e.nr === 4 && e.stufe === 'wartend'))!;
      expect(mitWartendem.prognose).toMatchObject({ status: 'ok', ab: 5, bisher: 5 });
      expect(mitWartendem.prognose.backlog).not.toBeNull();
      const p4 = mitWartendem.epics.find((e) => e.nr === 4)!.prognose!;
      expect(p4.p50).toBeLessThanOrEqual(p4.p90);
      // the running one has no line of its own
      expect(mitWartendem.epics.find((e) => e.nr === 3)!.prognose).toBeNull();
      // across deployments: the records of #3 and #4 join the five of before
      expect(liesMessungen(dir)).toHaveLength(7);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, T);

  it('below the threshold the report says how many there are so far', async () => {
    const berichte: Bericht[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/api/bericht') berichte.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(req.method === 'GET' ? '[]' : '{"ok":true}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const t = aufbau({ adapter: 'merge: mensch\nprognose_ab: 3' });
      await fahre(t.einstellung(drehbuch([lauf(3, [{ text: ende(3, 13) }])]), [3], { bruecke: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, maxDauerMs: 3000 }), t.welt);
      expect(berichte[0].prognose).toMatchObject({ status: 'zu_wenig', ab: 3, bisher: 0, backlog: null });
      expect(berichte[0].epics[0].prognose).toBeNull();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, T);
});
