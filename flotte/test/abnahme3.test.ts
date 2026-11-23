// The findings 2, 3, 4 and 7 of acceptance 3 at #14 (comment 7040727108).

import { describe, expect, it } from 'vitest';
import { admiralAuftrag, BEIM_MENSCHEN } from '../src/treiber/admiral.ts';
import { fahre, PR_FRAGE } from '../src/treiber/treiber.ts';
import { gateForm, gateKern, gateLaeufeImLog } from '../src/treiber/gate.ts';
import { leseBlock, type FrageBlock } from '../src/werkzeuge/bloecke.ts';
import { liesAdapter } from '../src/werkzeuge/belegung.ts';
import { admiral, aufbau, drehbuch, ende, frage, GATE_BLOCK, GATE_BODY, gateAufruf, gateGefahren, lauf, ping, werkzeug } from './flotte-welt.ts';

const T = 30_000;
const form = gateForm(liesAdapter('---\nmerge: nach_gate\n---\n'));
const texte = (z: { ereignisse: { epic: number | null; text: string }[] }) => z.ereignisse.map((e) => `${e.epic ? `#${e.epic} ` : ''}${e.text}`);

describe('Befund 2: Gate-Nachweis im Log des Laufs', () => {
  const BEFEHLE = ["$env:HIVE_TESTBETT='0'; npm run gate -- --voll", 'npm run gate:immer'];
  const imLog = (schritte: { zeile?: unknown; text?: string }[]) =>
    gateLaeufeImLog(schritte.map((s) => JSON.stringify(s.zeile ?? { type: 'assistant', message: { content: [{ type: 'text', text: s.text }] } })).join('\n') + '\nkein json', form, BEFEHLE);
  const voll = { base: 'aaaaaaa', head: 'bbbbbbbb', gruen: true, teil: false };

  it('the core of a gate command drops leading environment assignments', () => {
    expect(gateKern("$env:HIVE_TESTBETT='0'; npm run gate -- --voll")).toBe('npm run gate -- --voll');
    expect(gateKern('HIVE_TESTBETT=0 CI=1 npm run gate')).toBe('npm run gate');
    expect(gateKern('set X=0 && npm run gate')).toBe('npm run gate');
    expect(gateKern('npm run gate')).toBe('npm run gate');
  });

  it('a PR text seen with gh pr view is no gate run', () => {
    expect(imLog(werkzeug('Bash', { command: 'gh pr view 13 --json body' }, GATE_BODY))).toEqual([]);
  });

  it('the snippet after an Edit is no gate run', () => {
    expect(imLog(werkzeug('Edit', { file_path: 'pr.md', old_string: 'x', new_string: GATE_BLOCK }, `The file pr.md has been updated:\n${GATE_BLOCK}`))).toEqual([]);
  });

  it('an echo of a block is no gate run', () => {
    expect(imLog(werkzeug('Bash', { command: `echo "${GATE_BLOCK}"` }, GATE_BLOCK))).toEqual([]);
  });

  it('a Read of a gate output file is no gate run, nor a block the run only wrote', () => {
    expect(imLog([...werkzeug('Read', { file_path: 'gate.log' }, `     1\t${GATE_BLOCK.split('\n').join('\n     2\t')}`), { text: GATE_BLOCK }])).toEqual([]);
  });

  it('a real gate call counts: Bash or PowerShell, with or without the env prefix, also in a subagent, as text parts', () => {
    const teile = werkzeug('PowerShell', { command: 'npm run gate:immer' }, '');
    (teile[1].zeile.message.content[0] as { content: unknown }).content = [{ type: 'text', text: '\x1b[32m== Gate: Immer-Teil, Basis origin/main @ ccccccc (HEAD dddddddd)\x1b[0m\nGate grün.' }];
    const l = imLog([
      ...werkzeug('Bash', { command: 'npm run gate -- --voll 2>&1 | tail -40' }, `> gate\n${GATE_BLOCK}`),
      ...werkzeug('PowerShell', { command: "$env:HIVE_TESTBETT='0'; npm run gate -- --voll" }, '== Gate: Basis origin/main @ 1111111 (HEAD 22222222)\nGate ROT.', { parent: 'toolu_sub' }),
      ...teile,
    ]);
    expect(l).toEqual([voll, { base: '1111111', head: '22222222', gruen: false, teil: false }, { base: 'ccccccc', head: 'dddddddd', gruen: true, teil: true }]);
  });

  it('without gate commands nothing counts', () => {
    expect(gateLaeufeImLog(werkzeug('Bash', { command: 'npm run gate' }, GATE_BLOCK).map((s) => JSON.stringify(s.zeile)).join('\n'), form, [])).toEqual([]);
  });

  it('a block the run only wrote is no gate: without gate_command a person merges, merge.ps1 is not called', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate', pr: (_nr, n) => ({ state: n < 2 ? 'OPEN' : 'MERGED' }) });
    // the block in the run's text and in the PR, but no tool call ran the gate (kurz-lauf in probe 3)
    const buch = drehbuch([lauf(3, [{ text: `${GATE_BLOCK}\n\n${ende(3, 13)}` }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(t.p.merges).toEqual([]);
    expect(t.p.kommentare.find((k) => k.text.startsWith('**PR bereit'))?.text).toMatch(/kein Aufruf der Andockprüfung im Log des Laufs zum Andockblock \(Basis aaaaaaa, HEAD bbbbbbbb\), und der Adapter hat kein gate_command/);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('a gate call on another head or a red one is no proof either', async () => {
    for (const schritt of [gateAufruf('== Gate: Basis origin/main @ aaaaaaa (HEAD cccccccc)\nGate grün.'), gateAufruf('== Gate: Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)\nGate ROT.')]) {
      const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll', pr: (_nr, n) => ({ state: n < 2 ? 'OPEN' : 'MERGED' }) });
      const buch = drehbuch([lauf(3, [...schritt, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3]), t.welt);
      expect(t.p.merges).toEqual([]);
    }
  }, T);

  it('the proof may come from an earlier turn of the epic', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll' });
    const buch = drehbuch([lauf(3, [...gateGefahren(), { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(t.p.merges).toEqual([13]);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);
});

// #110 replaced the extra list for merge: nach_gate by the one list BEIM_MENSCHEN: the boundary of
// the admiral no longer depends on the merge mode.
describe('Befund 3: Grenze des Admirals bei merge: nach_gate', () => {
  const block = leseBlock(frage(3, 'tor', [{ betrifft: 'Lauf' }])) as FrageBlock;

  it('#110: no extra list for nach_gate; schema, scope and ADR without a break are no longer the person\'s', () => {
    const text = admiralAuftrag(block, 'k');
    expect(text).not.toMatch(/nach_gate|Schema oder Migration|gilt „Folge der Empfehlung des Laufs" nicht/);
    for (const p of BEIM_MENSCHEN) expect(text).toContain(p);
  });

  it('the driver gives the admiral the same decision right in both merge modes', async () => {
    const auftraege: string[] = [];
    for (const merge of ['nach_gate', 'mensch']) {
      const t = aufbau({ adapter: `merge: ${merge}\ngate_command: gate voll` });
      const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [...gateGefahren(), { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3]), t.welt);
      const a = buch.gesehen().find((g) => g.eingabe.startsWith('FLOTTE-ADMIRAL'))!;
      for (const p of BEIM_MENSCHEN) expect(a.eingabe).toContain(p);
      auftraege.push(a.eingabe.slice(0, a.eingabe.indexOf('Mission #3 in ')));
    }
    expect(auftraege[0]).toBe(auftraege[1]);
  }, T);
});

describe('Befund 4: der PR aus FLOTTE-ENDE gehört zum Epic', () => {
  for (const [fall, info] of [
    ['a foreign branch', { headRefName: 'epic/49-fremd', state: 'OPEN' }],
    ['a PR of the epic that is no longer open', { headRefName: 'epic/3-x', state: 'MERGED' }],
  ] as const) {
    it(`${fall}: no merge, nothing watched, a question to the person; the answer resumes the run`, async () => {
      const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll', prInfo: () => ({ ...info, baseRefName: 'main', headRefOid: 'b'.repeat(40), body: GATE_BODY }) });
      const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 49) }])]);
      const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 2500 }), t.welt);
      expect(t.p.merges).toEqual([]);
      expect(z.epics['3']).toMatchObject({ stufe: 'frage', pr: null });
      expect(z.fragen).toEqual([expect.objectContaining({ epic: 3, nr: PR_FRAGE, ganzerLauf: true })]);
      expect(t.p.kommentare.find((k) => k.nr === 3 && k.text.startsWith('**FRAGE AN DEN MENSCHEN'))?.text).toMatch(/PR #49 aus FLOTTE-ENDE .*Welcher Pull Request gehört zu Mission #3\?/);
      expect(texte(z).some((x) => /PR #49 gemergt/.test(x))).toBe(false);
    }, T);
  }
});

describe('Befund 7: Konto des Admirals und --konto-max', () => {
  it('--admiral: the runs on their account, every admiral call on its own', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.1] });
    const [k1, k2, admiralKonto] = t.konten;
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [k2], admiralKonto }), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    const g = buch.gesehen();
    expect(g.filter((x) => x.eingabe.startsWith('Flotte, Mission #3')).map((x) => x.konto)).toEqual([k2, k2]);
    expect(g.find((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL'))!.konto).toBe(admiralKonto);
    expect(k1).not.toBe(admiralKonto);
  }, T);

  it('--konto-max counts the epics at work on the account at the same time, not all of the deployment', async () => {
    const t = aufbau({ bodies: { 3: '## Betroffene Module\n- a', 4: '> **Reihenfolge:** nach #3\n\n## Betroffene Module\n- b' }, pr: (_nr, n) => ({ state: n < 2 ? 'OPEN' : 'MERGED' }) });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }]), lauf(4, [{ text: ende(4, 14) }])]);
    const z = await fahre(t.einstellung(buch, [3, 4], { kontoMax: { [t.konten[0]]: 1, [t.konten[1]]: 0 } }), t.welt);
    expect(Object.values(z.epics).map((e) => [e.stufe, e.konto])).toEqual([
      ['fertig', t.konten[0]],
      ['fertig', t.konten[0]],
    ]);
  }, T);
});

describe('Nachprüfung #27', () => {
  const fragt = () => drehbuch([lauf(3, [{ warte: 300 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);

  it('an admiral account outside --konten is judged; yellow warns ahead in the log book, the admiral still answers', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.4] });
    const admiralKonto = t.konten[2];
    const buch = fragt();
    const z = await fahre(t.einstellung(buch, [3], { konten: [t.konten[0]], admiralKonto }), t.welt);
    expect(z.bremse?.konten.map((k) => [k.konto, k.stufe])).toEqual([
      [t.konten[0], 'gruen'],
      [admiralKonto, 'gelb'],
    ]);
    expect(texte(z).some((x) => /^Admiral-Konto gelb \(.*\): bei Rot weicht der Admiral auf ein Konto mit Luft aus/.test(x))).toBe(true);
    expect(t.p.kommentare.some((k) => /Admiral-Konto gelb/.test(k.text))).toBe(true);
    expect(buch.gesehen().find((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL'))!.konto).toBe(admiralKonto);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  // #111: before, a red admiral account sent the questions to the person; now the admiral moves to
  // an account of the fleet with room (admiral-ausweichen.test.ts)
  it('a red admiral account is not called: the admiral answers on the fleet account with room', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.95] });
    const admiralKonto = t.konten[2];
    const buch = fragt();
    const z = await fahre(t.einstellung(buch, [3], { konten: [t.konten[0]], admiralKonto, maxDauerMs: 3000 }), t.welt);
    expect(buch.gesehen().filter((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL')).map((x) => x.konto)).toEqual([t.konten[0]]);
    expect(texte(z)).toContain('#3 Admiral-Konto rot: der Admiral weicht auf Konto 1 aus');
    expect(z.fragen).toEqual([]);
  }, T);

  it('a stale admiral account is pinged while a run may ask', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 'alt'] });
    const admiralKonto = t.konten[2];
    const buch = drehbuch([ping(0.1), lauf(3, [{ warte: 1500 }, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [t.konten[0]], admiralKonto }), t.welt);
    expect(buch.gesehen().filter((x) => x.eingabe.startsWith('FLOTTE-PING')).map((x) => x.konto)).toContain(admiralKonto);
    expect(buch.gesehen().some((x) => x.eingabe.startsWith('FLOTTE-ADMIRAL'))).toBe(true);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('a PR on another base than the expected one is not merged: a person looks', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll', prInfo: (nr) => ({ headRefName: `epic/${nr - 10}-x`, baseRefName: 'release', headRefOid: `bbbbbbbb${'2'.repeat(32)}`, body: GATE_BODY }) });
    const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(t.p.merges).toEqual([]);
    expect(t.p.gates).toEqual([]);
    expect(t.p.kommentare.find((k) => k.text.startsWith('**PR bereit'))?.text).toMatch(/Basis des PRs ist release, erwartet main/);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('base_branch in the adapter is the expected base', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll\nbase_branch: develop' });
    const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }])]);
    await fahre(t.einstellung(buch, [3]), t.welt);
    expect(t.p.merges).toEqual([]);
    expect(t.p.kommentare.find((k) => k.text.startsWith('**PR bereit'))?.text).toMatch(/Basis des PRs ist main, erwartet develop/);
  }, T);
});
