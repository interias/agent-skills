// The findings 2, 3, 4 and 7 of acceptance 3 at #14 (comment 7040727108).

import { describe, expect, it } from 'vitest';
import { admiralAuftrag, NACH_GATE } from '../src/treiber/admiral.ts';
import { fahre, PR_FRAGE } from '../src/treiber/treiber.ts';
import { gateForm, gateLaeufeImLog } from '../src/treiber/gate.ts';
import { leseBlock, type FrageBlock } from '../src/werkzeuge/bloecke.ts';
import { liesAdapter } from '../src/werkzeuge/belegung.ts';
import { admiral, aufbau, drehbuch, ende, frage, GATE_BLOCK, GATE_BODY, gateGefahren, lauf, werkzeugErgebnis } from './flotte-welt.ts';

const T = 30_000;
const form = gateForm(liesAdapter('---\nmerge: nach_gate\n---\n'));
const texte = (z: { ereignisse: { epic: number | null; text: string }[] }) => z.ereignisse.map((e) => `${e.epic ? `#${e.epic} ` : ''}${e.text}`);

describe('Befund 2: Gate-Nachweis im Log des Laufs', () => {
  it('reads gate runs only from tool results: plain, as text parts, read from a file with line numbers', () => {
    const zeilen = [
      { type: 'assistant', message: { content: [{ type: 'text', text: GATE_BLOCK }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: `npm run gate\n${GATE_BLOCK}` }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '== Gate: Immer-Teil, Basis origin/main @ ccccccc (HEAD dddddddd)\nGate grün.' }] }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: '    41\t== Gate: Basis origin/main @ eeeeeee (HEAD ffffffff)\n    42\t  web grün\n    43\tGate grün.' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: '== Gate: Basis origin/main @ 1111111 (HEAD 22222222)\nGate ROT.' }] } },
    ];
    const l = gateLaeufeImLog(zeilen.map((z) => JSON.stringify(z)).join('\n') + '\nkein json', form);
    expect(l).toEqual([
      { base: 'aaaaaaa', head: 'bbbbbbbb', gruen: true, teil: false },
      { base: 'ccccccc', head: 'dddddddd', gruen: true, teil: true },
      { base: 'eeeeeee', head: 'ffffffff', gruen: true, teil: false },
      { base: '1111111', head: '22222222', gruen: false, teil: false },
    ]);
  });

  it('a block the run only wrote is no gate: without gate_command a person merges, merge.ps1 is not called', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate', pr: (_nr, n) => ({ state: n < 2 ? 'OPEN' : 'MERGED' }) });
    // the block in the run's text and in the PR, but no tool call ran the gate (kurz-lauf in probe 3)
    const buch = drehbuch([lauf(3, [{ text: `${GATE_BLOCK}\n\n${ende(3, 13)}` }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(t.p.merges).toEqual([]);
    expect(t.p.kommentare.find((k) => k.text.startsWith('**PR bereit'))?.text).toMatch(/kein Gate-Aufruf im Log des Laufs zum Gate-Block \(Basis aaaaaaa, HEAD bbbbbbbb\), und der Adapter hat kein gate_command/);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);

  it('a gate call on another head or a red one is no proof either', async () => {
    for (const schritt of [werkzeugErgebnis('== Gate: Basis origin/main @ aaaaaaa (HEAD cccccccc)\nGate grün.'), werkzeugErgebnis('== Gate: Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)\nGate ROT.')]) {
      const t = aufbau({ adapter: 'merge: nach_gate', pr: (_nr, n) => ({ state: n < 2 ? 'OPEN' : 'MERGED' }) });
      const buch = drehbuch([lauf(3, [schritt, { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3]), t.welt);
      expect(t.p.merges).toEqual([]);
    }
  }, T);

  it('the proof may come from an earlier turn of the epic', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate' });
    const buch = drehbuch([lauf(3, [gateGefahren(), { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(t.p.merges).toEqual([13]);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);
});

describe('Befund 3: Grenze des Admirals bei merge: nach_gate', () => {
  const block = leseBlock(frage(3, 'tor', [{ betrifft: 'Lauf' }])) as FrageBlock;

  it('names schema, ADR, scope, deleting data and everything visible outside, and lifts the rule to follow the run', () => {
    expect(NACH_GATE).toMatch(/Schema oder Migration/);
    expect(NACH_GATE).toMatch(/ein ADR/);
    expect(NACH_GATE).toMatch(/Umfang des Epics/);
    expect(NACH_GATE).toMatch(/Löschen von Daten/);
    expect(NACH_GATE).toMatch(/nach außen Sichtbare/);
    expect(NACH_GATE).toMatch(/gilt „Folge der Empfehlung des Laufs" nicht/);
    expect(admiralAuftrag(block, 'k', 'nach_gate')).toContain(NACH_GATE);
    expect(admiralAuftrag(block, 'k', 'mensch')).not.toContain(NACH_GATE);
    expect(admiralAuftrag(block, 'k')).not.toContain(NACH_GATE);
  });

  it('the driver gives the admiral the merge mode of the adapter', async () => {
    for (const merge of ['nach_gate', 'mensch']) {
      const t = aufbau({ adapter: `merge: ${merge}` });
      const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [gateGefahren(), { text: ende(3, 13) }])]);
      await fahre(t.einstellung(buch, [3]), t.welt);
      const a = buch.gesehen().find((g) => g.eingabe.startsWith('FLOTTE-ADMIRAL'))!;
      expect(a.eingabe.includes(NACH_GATE)).toBe(merge === 'nach_gate');
    }
  }, T);
});

describe('Befund 4: der PR aus FLOTTE-ENDE gehört zum Epic', () => {
  for (const [fall, info] of [
    ['a foreign branch', { headRefName: 'epic/49-fremd', state: 'OPEN' }],
    ['a PR of the epic that is no longer open', { headRefName: 'epic/3-x', state: 'MERGED' }],
  ] as const) {
    it(`${fall}: no merge, nothing watched, a question to the person; the answer resumes the run`, async () => {
      const t = aufbau({ adapter: 'merge: nach_gate', prInfo: () => ({ ...info, baseRefName: 'main', headRefOid: 'b'.repeat(40), body: GATE_BODY }) });
      const buch = drehbuch([lauf(3, [gateGefahren(), { text: ende(3, 49) }])]);
      const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 2500 }), t.welt);
      expect(t.p.merges).toEqual([]);
      expect(z.epics['3']).toMatchObject({ stufe: 'frage', pr: null });
      expect(z.fragen).toEqual([expect.objectContaining({ epic: 3, nr: PR_FRAGE, ganzerLauf: true })]);
      expect(t.p.kommentare.find((k) => k.nr === 3 && k.text.startsWith('**FRAGE AN DEN MENSCHEN'))?.text).toMatch(/PR #49 aus FLOTTE-ENDE .*Welcher Pull Request gehört zu Epic #3\?/);
      expect(texte(z).some((x) => /PR #49 gemergt/.test(x))).toBe(false);
    }, T);
  }
});

describe('Befund 7: Konto des Admirals und --konto-max', () => {
  it('--admiral-konto: the runs on their account, every admiral call on its own', async () => {
    const t = aufbau({ verbrauch: [0.1, 0.1, 0.1] });
    const [k1, k2, admiralKonto] = t.konten;
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3], { konten: [k2], admiralKonto }), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    const g = buch.gesehen();
    expect(g.filter((x) => x.eingabe.startsWith('Flotte, Epic #3')).map((x) => x.konto)).toEqual([k2, k2]);
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
