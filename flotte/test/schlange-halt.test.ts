// Step 8 of the gate rework: a red night run (flotte nachtlauf) holds the driver's merge queue. No new docking starts
// while schlange-halt.json lies in the fleet's state folder; the head already docking ends; the missions work on.
// Released by a person with `flotte nachtlauf --freigeben`, read in the next tick, also after a restart.

import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HALT_DATEI, type NachtErgebnis, nachtlauf, type SchlangeHalt, STAND_DATEI } from '../src/befehle/nachtlauf.ts';
import { githubZugriff } from '../src/forge/github.ts';
import type { Bericht } from '../src/treiber/bruecke.ts';
import { fahre } from '../src/treiber/treiber.ts';
import { flotteDir } from '../src/werkzeuge/zustand.ts';
import { aufbau, drehbuch, ende, gateGefahren, lauf } from './flotte-welt.ts';

const T = 60_000;
const ADAPTER = 'merge: nach_gate\ngate_command: gate voll';
const HALT: SchlangeHalt = { seit: '2026-11-25T02:41:00.000Z', grund: 'Nachtlauf rot auf origin/main @ abc1234, auch in der Wiederholung (rot: flotte)', commit: 'abc1234def5678', basis: 'main', issue: 77, teile: ['flotte'], log: 'nachtlauf/x-2.log' };

const halten = (repo: string, h: SchlangeHalt = HALT) => writeFileSync(join(flotteDir(repo), HALT_DATEI), JSON.stringify(h));
const texte = (z: { ereignisse: { epic: number | null; text: string }[] }) => z.ereignisse.map((e) => `${e.epic ? `#${e.epic} ` : ''}${e.text}`);

/** a bridge that takes the reports and has nothing to answer */
async function bruecke() {
  const berichte: Bericht[] = [];
  const server = createServer((req, res) => {
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

describe('Halt der Andock-Schlange (Nachtlauf rot)', () => {
  it('no new docking starts while the queue holds; the mission itself ended normally; note, board and bridge name the halt', async () => {
    const t = aufbau({ adapter: ADAPTER, pr: () => ({ state: 'OPEN' }) });
    halten(t.repo);
    const letzter: NachtErgebnis = { ergebnis: 'rot', commit: HALT.commit, basis: 'main', zeit: '2026-11-25T02:30:00.000Z', dauerS: 660, log: 'nachtlauf/x-2.log', wiederholt: true, teile: ['flotte'], erstesRot: ['flotte'] };
    writeFileSync(join(flotteDir(t.repo), STAND_DATEI), JSON.stringify({ letzter, verlauf: [letzter] }));
    const b = await bruecke();
    try {
      const z = await fahre(t.einstellung(drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }])]), [3], { maxDauerMs: 2500, bruecke: b.url }), t.welt);
      expect(t.p.merges).toEqual([]);
      expect(z.epics['3'].stufe).toBe('pr');
      expect(z.schlange).toEqual([3]);
      expect(z.epics['3'].notiz).toBe('PR #13: Andock-Schlange, Platz 1; die Schlange hält (Nachtlauf rot auf abc1234 seit 2026-11-25 02:41, Issue #77)');
      expect(texte(z)).toContain('Andock-Schlange hält: Nachtlauf rot auf origin/main @ abc1234, auch in der Wiederholung (rot: flotte), Issue #77; neue Andockungen warten, laufende Missionen arbeiten weiter; freigeben am Rechner: flotte nachtlauf --freigeben');
      const tafel = readFileSync(join(flotteDir(t.repo), 'tafel.html'), 'utf8');
      expect(tafel).toContain('Andock-Schlange hält');
      expect(tafel).toContain('issues/77');
      expect(texte(z)).toContain('Nachtlauf rot auf origin/main @ abc1234 nach 11 min, wiederholt');
      const bericht = b.berichte.at(-1)!;
      expect(bericht.nachtlauf?.halt).toMatchObject({ seit: HALT.seit, commit: HALT.commit, issue: 77, grund: HALT.grund });
      expect(bericht.nachtlauf?.letzter).toMatchObject({ ergebnis: 'rot', commit: HALT.commit, zeit: letzter.zeit, dauerS: 660 });
      // the bridge gets no path of the log
      expect(JSON.stringify(bericht.nachtlauf)).not.toContain('x-2.log');
      expect(bericht.epics.find((e) => e.nr === 3)?.notiz).toMatch(/die Schlange hält/);
    } finally {
      await b.zu();
    }
  }, T);

  it('a docking under way when the halt comes ends; the next mission in the queue waits', async () => {
    const t = aufbau({
      adapter: ADAPTER,
      pr: () => ({ state: 'OPEN' }),
      signale: { nach13: /gemergt 13/ },
      // the night run sets the halt while #13 is the head and merge.ps1 runs
      merge: (pr) => {
        if (pr === 13) halten(t.repo);
        return `GEMERGT #${pr} -> main`;
      },
    });
    const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }]), lauf(4, [{ signal: 'nach13' }, ...gateGefahren(), { text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: 4000 }), t.welt);
    expect(t.p.merges).toEqual([13]);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.epics['4'].stufe).toBe('pr');
    expect(z.schlange).toEqual([4]);
    expect(z.epics['4'].notiz).toMatch(/^PR #14: Andock-Schlange, Platz 1; die Schlange hält/);
  }, T);

  it('a restart with the halt set keeps holding; after --freigeben the next tick docks, and the event says so', async () => {
    const t = aufbau({ adapter: ADAPTER, pr: () => ({ state: 'OPEN' }) });
    halten(t.repo);
    const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }])]);
    await fahre(t.einstellung(buch, [3], { maxDauerMs: 2000 }), t.welt);
    const t2 = aufbau({ adapter: ADAPTER, vorhanden: { repo: t.repo, konten: t.konten }, pr: () => ({ state: 'OPEN' }) });
    const z2 = await fahre(t2.einstellung(buch, [3], { maxDauerMs: 1500 }), t2.welt);
    expect(t2.p.merges).toEqual([]);
    expect(z2.epics['3'].notiz).toMatch(/die Schlange hält/);
    // released by the person while the driver runs: it docks in its next tick
    let n = 0;
    const t3 = aufbau({ adapter: ADAPTER, vorhanden: { repo: t.repo, konten: t.konten }, pr: () => ({ state: 'OPEN' }) });
    const frei = t3.welt.freiGb;
    t3.welt.freiGb = (pfad) => {
      if (++n === 3) void nachtlauf([t.repo, '--forge', 'o/r', '--freigeben'], { aufrufer: t3.welt.aufrufer, forge: () => githubZugriff(t3.welt.aufrufer, 'o/r') });
      return frei(pfad);
    };
    const z3 = await fahre(t3.einstellung(buch, [3], { maxDauerMs: 20_000 }), t3.welt);
    expect(t3.p.merges).toEqual([13]);
    expect(z3.epics['3'].stufe).toBe('fertig');
    expect(texte(z3)).toContain('Andock-Schlange freigegeben: das Andocken geht weiter');
    expect(z3.schlangeHalt ?? null).toBeNull();
  }, T);

  it('a green night under the halt is an event, and the queue keeps holding', async () => {
    const t = aufbau({ adapter: ADAPTER, pr: () => ({ state: 'OPEN' }) });
    halten(t.repo, { ...HALT, gruen: { zeit: '2026-11-26T02:50:00.000Z', commit: 'fedcba9876543' } });
    const z = await fahre(t.einstellung(drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }])]), [3], { maxDauerMs: 2000 }), t.welt);
    expect(t.p.merges).toEqual([]);
    expect(texte(z)).toContain('Nachtlauf grün auf fedcba9 nach dem Halt: die Schlange hält weiter, bis ein Mensch freigibt (flotte nachtlauf --freigeben)');
  }, T);

  it('without a halt nothing changes: the queue docks', async () => {
    const t = aufbau({ adapter: ADAPTER, pr: () => ({ state: 'OPEN' }) });
    const z = await fahre(t.einstellung(drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }])]), [3]), t.welt);
    expect(t.p.merges).toEqual([13]);
    expect(z.epics['3'].stufe).toBe('fertig');
    rmSync(join(flotteDir(t.repo), HALT_DATEI), { force: true });
  }, T);
});
