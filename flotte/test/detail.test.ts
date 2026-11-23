// Detail view of an epic (#51): phase, round and class per package from the Agent calls of a run,
// the merge patterns of the epic branch, and the fields in the report. The sample log
// (protokoll-detail.jsonl) is invented: stream-json shaped lines with a time each.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { aufrufen } from '../src/aufruf.ts';
import { liesAdapter } from '../src/werkzeuge/belegung.ts';
import { ableiten, type AgentEintrag, belegt, eintraegeAus, fuegeAn, kinderAusBetreff } from '../src/werkzeuge/detail.ts';
import { fahre } from '../src/treiber/treiber.ts';
import type { Bericht } from '../src/treiber/bruecke.ts';
import { aufbau, drehbuch, ende, lauf, werkzeug } from './flotte-welt.ts';

const T = 30_000;
const zeilen = readFileSync(fileURLToPath(new URL('./protokoll-detail.jsonl', import.meta.url)), 'utf8').split('\n').filter(Boolean);
const eintraege = (bis?: string, ohneZeit = false): AgentEintrag[] =>
  fuegeAn(
    [],
    zeilen
      .filter((z) => !bis || JSON.parse(z).timestamp <= bis)
      .flatMap((z) => eintraegeAus(ohneZeit ? z.replace(/"timestamp":"[^"]*",/, '') : z)),
  );
const um = (m: number) => `2026-11-20T12:${String(m).padStart(2, '0')}:00.000Z`;

describe('Detailansicht: Erkennung gegen das Beispielprotokoll (#51)', () => {
  const d = ableiten(eintraege(), new Set([106]));

  it('only the calls of an epic-implementer or epic-reviewer with a child number count', () => {
    expect([...d.keys()]).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it('Implementer: first round, class, start and the last sign of life from work below the call', () => {
    expect(d.get(103)).toEqual({ phase: 'implementer', runde: 1, stufe: 'standard', eskaliert: false, erstAufruf: um(0), phaseSeit: um(0), lebenszeichen: um(25) });
  });

  it('Review: the reviewer runs', () => {
    expect(d.get(104)).toMatchObject({ phase: 'review', runde: 1, phaseSeit: um(30), lebenszeichen: um(30) });
  });

  it('Merge: the reviewer came back, the package is not in the epic branch yet', () => {
    expect(d.get(101)).toEqual({ phase: 'merge', runde: 1, stufe: 'standard', eskaliert: false, erstAufruf: um(0), phaseSeit: um(15), lebenszeichen: um(15) });
  });

  it('Nachbesserung in the same class is no escalation', () => {
    expect(d.get(105)).toEqual({ phase: 'nachbesserung', runde: 2, stufe: 'standard', eskaliert: false, erstAufruf: um(31), phaseSeit: um(35), lebenszeichen: um(35) });
  });

  it('Eskalation Standard → Urteil → Urteil hoch: round, class and the class it began with', () => {
    // after the review of round 1 the second round runs as Urteil
    expect(ableiten(eintraege('2026-11-20T12:19:00Z')).get(102)).toMatchObject({ phase: 'nachbesserung', runde: 2, stufe: 'urteil', stufeStart: 'standard', eskaliert: true, phaseSeit: um(16) });
    // after the second review the third round runs as Urteil hoch
    expect(d.get(102)).toEqual({ phase: 'nachbesserung', runde: 3, stufe: 'urteil-hoch', stufeStart: 'standard', eskaliert: true, erstAufruf: um(0), phaseSeit: um(22), lebenszeichen: um(22) });
  });

  it('merged into the epic branch: no phase, round and class stay', () => {
    expect(d.get(106)).toEqual({ runde: 1, stufe: 'standard', eskaliert: false, erstAufruf: um(36), lebenszeichen: um(38) });
  });

  it('without times (no timestamp in the line, none given) the phase stays and no time is guessed', () => {
    const o = ableiten(eintraege(undefined, true)).get(102)!;
    expect(o).toMatchObject({ phase: 'nachbesserung', runde: 3, stufe: 'urteil-hoch' });
    expect(o.phaseSeit).toBeUndefined();
    expect(o.lebenszeichen).toBeUndefined();
    expect(o.erstAufruf).toBeUndefined();
  });

  it('the time the driver read the line stands in for a missing timestamp', () => {
    const z = zeilen[0].replace(/"timestamp":"[^"]*",/, '');
    expect(eintraegeAus(z, 1234)[0].zeit).toBe(1234);
  });

  it('places in use: implementer, review and nachbesserung, not merge', () => {
    expect(belegt(d.values())).toBe(6);
  });

  it('a return of an unknown call is dropped, a call is kept once, work below a call keeps the newest time', () => {
    const liste: AgentEintrag[] = [];
    const aufruf = eintraegeAus(zeilen[0], 1)[0];
    fuegeAn(liste, [aufruf, aufruf, { zeit: 2, art: 'rueckkehr', id: 'fremd' }, { zeit: 3, art: 'unter', id: aufruf.id }, { zeit: 4, art: 'unter', id: aufruf.id }]);
    expect(liste.map((e) => [e.art, e.zeit])).toEqual([['aufruf', Date.parse('2026-11-20T12:00:00Z')], ['unter', 4]]);
  });
});

describe('Detailansicht: Agenten im Hintergrund (#51)', () => {
  const d = ableiten(eintraege(), new Set([106]));
  const zeile = (id: string) => zeilen.filter((z) => z.includes(`"tool_use_id":"${id}"`));
  const meldung = (status: string) => JSON.stringify({ type: 'system', subtype: 'task_notification', task_id: 't', tool_use_id: 'c1', status });

  it('the result "Async agent launched" is the start, not the return: as array and as string', () => {
    expect(eintraegeAus(zeile('c107r')[0], 1)).toEqual([]);
    expect(eintraegeAus(zeile('c109a')[0], 1)).toEqual([]);
  });

  it('a started reviewer keeps the phase review, a started implementer the phase implementer', () => {
    expect(d.get(107)).toMatchObject({ phase: 'review', runde: 1, phaseSeit: um(45), lebenszeichen: um(45) });
    expect(d.get(109)).toMatchObject({ phase: 'implementer', runde: 1, phaseSeit: um(42) });
  });

  it('the task_notification of the call ends it; without timestamp the moment the driver read it is the time', () => {
    expect(d.get(108)).toMatchObject({ phase: 'merge', runde: 1, lebenszeichen: um(50) });
    expect(d.get(108)!.phaseSeit).toBeUndefined();
    const gelesen = Date.parse('2026-11-20T13:00:00Z');
    const erste = zeilen.findIndex((z) => z.includes('"task_notification"') && z.includes('"c108r"'));
    const mitZeit = ableiten(fuegeAn([], zeilen.flatMap((z, i) => eintraegeAus(z, gelesen + i * 1000))));
    expect(mitZeit.get(108)).toMatchObject({ phase: 'merge', phaseSeit: new Date(gelesen + erste * 1000).toISOString() });
  });

  it('completed, failed, killed and stopped end the call; another status does not', () => {
    for (const s of ['completed', 'failed', 'killed', 'stopped']) expect(eintraegeAus(meldung(s), 5)).toEqual([{ zeit: 5, art: 'rueckkehr', id: 'c1' }]);
    expect(eintraegeAus(meldung('running'), 5)).toEqual([]);
  });

  it('a second notification of the same call changes nothing, one of an unknown task is dropped', () => {
    const alle = eintraege();
    expect(alle.filter((e) => e.art === 'rueckkehr' && e.id === 'c108r')).toHaveLength(1);
    expect(alle.some((e) => e.id === 'b1')).toBe(false);
  });

  it('an implementer called again without a review between (restart of the run) is the same round', () => {
    const a = (id: string, rolle: 'implementer' | 'reviewer', zeit: number): AgentEintrag => ({ zeit, art: 'aufruf', id, rolle, klasse: rolle === 'implementer' ? 'standard' : undefined, paket: 7 });
    expect(ableiten([a('i1', 'implementer', 1), a('i2', 'implementer', 2)]).get(7)).toMatchObject({ phase: 'implementer', runde: 1, eskaliert: false });
    expect(ableiten([a('i1', 'implementer', 1), a('i2', 'implementer', 2), a('r1', 'reviewer', 3), a('i3', 'implementer', 4)]).get(7)).toMatchObject({ phase: 'nachbesserung', runde: 2 });
  });

  it('places in use in the background: review and implementer count, merge does not', () => {
    expect(belegt([107, 108, 109].map((nr) => d.get(nr)!))).toBe(2);
  });
});

describe('Merge-Muster im Epic-Branch (#51)', () => {
  it('several numbers in one subject: each pattern counts', () => {
    expect(kinderAusBetreff('Merge #11: x (#12)')).toEqual(expect.arrayContaining([11, 12]));
    expect(kinderAusBetreff('Merge #409: Fach (#4090)')).toEqual(expect.arrayContaining([409, 4090]));
  });

  it('no hit from the merge pattern for a space before the colon, lower case or a pull request merge', () => {
    for (const s of ['Merge #409 : x', 'merge #409: x', 'Merge pull request #39 from someone/feat/x']) expect(kinderAusBetreff(s)).toEqual([]);
  });

  it('knows Merge … agent/<nr>-…, (#<nr>) and Merge #<nr>: …', () => {
    expect(kinderAusBetreff("Merge branch 'agent/409-fach-etikett' into epic/400-x")).toEqual([409]);
    expect(kinderAusBetreff('feat(app): Fach-Etikett neu (#409)')).toEqual([409]);
    expect(kinderAusBetreff('Merge #409: Fach-Etikett neu in den Epic-Branch')).toEqual([409]);
  });

  it('a number anywhere else in the text is no merge', () => {
    for (const s of ['Refs #409', 'fix: wie in #409 beschrieben', 'Merge #4090: andere Sache', 'Merge branch main into epic/9-x siehe #409']) {
      expect(kinderAusBetreff(s)).not.toContain(409);
    }
    expect(kinderAusBetreff('Merge #4090: andere Sache')).toEqual([4090]);
    expect(kinderAusBetreff('Merge branch agent/4090-x')).toEqual([4090]);
  });

  it('the driver marks a child merged as "Merge #<nr>: …" as fertig, while "Refs #<nr>" does not', async () => {
    const b = await attrappe();
    try {
      const t = aufbau({ bodies: { 3: '## Betroffene Module\n- m3\n\n- [ ] #11\n- [ ] #12\n- [ ] #13' }, titel: { 11: 'A', 12: 'B', 13: 'C' }, labels: { 11: ['status/in-arbeit'], 12: ['status/in-arbeit'], 13: ['status/in-arbeit'] } });
      const git = (datum: string, ...a: string[]) => aufrufen('git', ['-C', t.repo, '-c', 'user.name=t', '-c', 'user.email=t@example.org', ...a], { env: { ...process.env, GIT_COMMITTER_DATE: datum, GIT_AUTHOR_DATE: datum } });
      git('2026-01-01T08:00:00Z', 'commit', '-q', '--allow-empty', '-m', 'Start');
      git('2026-01-01T08:00:00Z', 'branch', 'epic/3-x');
      git('2026-01-01T08:00:00Z', 'checkout', '-q', 'epic/3-x');
      git('2026-01-02T09:00:00Z', 'commit', '-q', '--allow-empty', '-m', 'Merge #11: Schema neu in den Epic-Branch');
      git('2026-01-02T10:00:00Z', 'commit', '-q', '--allow-empty', '-m', 'Refs #12');
      git('2026-01-02T11:00:00Z', 'commit', '-q', '--allow-empty', '-m', 'Merge #130: andere Sache');
      git('2026-01-02T11:00:00Z', 'checkout', '-q', '-');
      const buch = drehbuch([lauf(3, [{ warte: 300 }, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      const pakete = b.berichte.find((x) => x.epics[0].pakete.length)!.epics[0].pakete;
      expect(pakete.map((p) => [p.nr, p.stand, p.ende])).toEqual([
        [11, 'fertig', '2026-01-02T09:00:00.000Z'],
        [12, 'laeuft', null],
        [13, 'laeuft', null],
      ]);
    } finally {
      await b.zu();
    }
  }, T);
});

describe('Detailansicht im Bericht (#51)', () => {
  it('window of the adapter: the key, else 3 with an isolation, else 1, never above 3', () => {
    expect(liesAdapter('---\nwindow: 2\n---\n').window).toBe(2);
    expect(liesAdapter('---\nwindow: 7\n---\n').window).toBe(3);
    expect(liesAdapter('---\ntest_isolation_env: APP_TEST_NR\n---\n').window).toBe(3);
    expect(liesAdapter('---\nisolation: none-needed  # nichts geteilt\n---\n').window).toBe(3);
    expect(liesAdapter('---\nmerge: mensch\n---\n').window).toBe(1);
    expect(liesAdapter('---\nwindow: 3\ntest_isolation_env: X\n---\n').window).toBe(3);
  });

  it('a run with Agent calls reports phase, round, class, places and its starts in the shape of beispiel/bericht.json', async () => {
    const b = await attrappe();
    try {
      const t = aufbau({ adapter: 'merge: mensch\nwindow: 3', bodies: { 3: '## Betroffene Module\n- m3\n\n- [ ] #11\n- [ ] #12\n- [ ] #13' }, titel: { 11: 'A', 12: 'B', 13: 'C' }, labels: { 11: ['status/in-arbeit'], 12: ['status/in-arbeit'], 13: ['status/in-arbeit'] } });
      const agent = (typ: string, beschreibung: string) => werkzeug('Agent', { subagent_type: typ, description: beschreibung, prompt: 'x' }, 'ok');
      const offen = { zeile: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_offen', name: 'Agent', input: { subagent_type: 'ingenieur-standard', description: 'Implementer #12 B', prompt: 'x' } }] } } };
      // the reviewer of #11 runs in the background: its end is the task_notification, which must pass the driver's quick test
      const hintergrund = [
        { zeile: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_rev11', name: 'Agent', input: { subagent_type: 'erster-offizier-standard', description: 'Reviewer #11 A', prompt: 'x', run_in_background: true } }] } } },
        { zeile: { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_rev11', content: [{ type: 'text', text: 'Async agent launched successfully.' }] }] } } },
        { zeile: { type: 'system', subtype: 'task_notification', task_id: 't11', tool_use_id: 'toolu_rev11', status: 'completed' } },
      ];
      const buch = drehbuch([lauf(3, [...agent('ingenieur-standard', 'Implementer #11 A'), ...hintergrund, offen, { zeile: { type: 'assistant', parent_tool_use_id: 'toolu_offen', message: { role: 'assistant', content: [{ type: 'text', text: 'arbeitet' }] } } }, { warte: 700 }, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      const e = b.berichte.map((x) => x.epics[0]).find((x) => x.prozess && x.pakete.some((p) => p.phase) && x.plaetze)!;
      const [a, zwei, drei] = e.pakete;
      expect(a).toMatchObject({ nr: 11, phase: 'merge', runde: 1, stufe: 'standard', eskaliert: false });
      expect(zwei).toMatchObject({ nr: 12, phase: 'implementer', runde: 1, stufe: 'standard' });
      expect(zwei.lebenszeichen).toEqual(expect.any(String));
      expect(zwei.phaseSeit! <= zwei.lebenszeichen!).toBe(true);
      // a package without a call has no detail fields
      expect(Object.keys(drei).sort()).toEqual(['beginn', 'ende', 'name', 'nr', 'stand', 'titel']);
      expect(e.plaetze).toEqual({ belegt: 1, von: 3 });
      expect(e.neustarts).toBe(0);
      // the shape: the keys of the sample are the keys of the report, the optional ones included
      const muster = JSON.parse(readFileSync(fileURLToPath(new URL('../../flottenbruecke/beispiel/bericht.json', import.meta.url)), 'utf8'));
      const mp = muster.epics.flatMap((x: { pakete: object[] }) => x.pakete).filter((p: { phase?: string }) => p.phase);
      expect(new Set(mp.map((p: { phase: string }) => p.phase))).toEqual(new Set(['implementer', 'review', 'nachbesserung', 'merge']));
      expect(mp.some((p: { eskaliert: boolean }) => p.eskaliert)).toBe(true);
      for (const p of mp) expect(Object.keys(p).sort()).toEqual(expect.arrayContaining(['runde', 'stufe', 'eskaliert']));
      const mit = muster.epics.find((x: { plaetze?: object }) => x.plaetze);
      expect(Object.keys(mit.plaetze).sort()).toEqual(Object.keys(e.plaetze!).sort());
      expect(typeof mit.neustarts).toBe('number');
    } finally {
      await b.zu();
    }
  }, T);

  it('an epic without any Agent call reports no detail fields: an older run, the spec mode', async () => {
    const b = await attrappe();
    try {
      const t = aufbau({ adapter: 'merge: mensch\nwindow: 3', bodies: { 3: '## Betroffene Module\n- m3\n\n- [ ] #11' }, titel: { 11: 'A' }, labels: { 11: ['status/in-arbeit'] } });
      const buch = drehbuch([lauf(3, [{ warte: 300 }, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3], { bruecke: b.url }), t.welt);
      for (const x of b.berichte) {
        const e = x.epics[0];
        expect(e.plaetze).toBeUndefined();
        for (const p of e.pakete) expect(Object.keys(p).sort()).toEqual(['beginn', 'ende', 'name', 'nr', 'stand', 'titel']);
      }
    } finally {
      await b.zu();
    }
  }, T);
});

/** a stand-in bridge that keeps the reports */
async function attrappe() {
  const berichte: Bericht[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.method === 'POST' && req.url === '/api/bericht') berichte.push(JSON.parse(body) as Bericht);
      res.end(req.method === 'GET' ? '[]' : '{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, berichte, zu: () => new Promise<void>((r) => server.close(() => r())) };
}
