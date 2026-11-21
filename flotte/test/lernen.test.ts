// The learning loop after a merged epic (Sparpaket, package 6): schema, rule ids, deletion
// candidates, the comment, and the driver calling it after a merge only when lern_issue is set.

import { describe, expect, it } from 'vitest';
import { lerne } from '../src/befehle/lernen.ts';
import { LERN_MARKE, lernErgebnisAus, lernKommentar, lernRegeln, lernSchema, streichKandidaten } from '../src/lernen.ts';
import { fahre } from '../src/treiber/treiber.ts';
import type { LaufErgebnis, Start } from '../src/werkzeuge/lauf.ts';
import { aufbau, drehbuch, ende, gateGefahren, lauf } from './flotte-welt.ts';

const T = 30_000;
const V = { titel: 'Port vor dem Start prüfen', beleg: 'https://github.com/o/r/issues/3#issuecomment-1', form: 'test' as const, umsetzung: 'ein Test in e2e/start.spec.ts', wegfallen: 'nichts' };

describe('lernen: building blocks', () => {
  it('the schema allows at most three proposals and only the known rule ids', () => {
    const s = lernSchema(['L1', 'L2']) as any;
    expect(s.properties.vorschlaege.maxItems).toBe(3);
    expect(s.properties.vorschlaege.items.properties.form.enum).toEqual(['test', 'adapterregel', 'skilltext', 'doku']);
    expect(s.properties.gegriffen.items.properties.regel.enum).toEqual(['L1', 'L2']);
  });

  it('finds rule ids in adapter and skill texts, first place wins, sorted by number', () => {
    const r = lernRegeln([
      { datei: '.claude/epic.md', text: 'a\n- Port prüfen (Lernschleife L2, 2026-11-20)\n' },
      { datei: 'epic/SKILL.md', text: 'Regel (Lernschleife L1, 2026-11-01)\nnoch einmal Lernschleife L2' },
    ]);
    expect(r.map((x) => [x.regel, x.datei])).toEqual([['L1', 'epic/SKILL.md'], ['L2', '.claude/epic.md']]);
  });

  it('proposes a rule for deletion only after n loops in a row without it applying', () => {
    const k = (z: string) => `${LERN_MARKE}\n**Lernschleife**\n\nGegriffen: ${z}`;
    const nein = Array.from({ length: 3 }, () => k('L1 nein, L2 nein'));
    expect(streichKandidaten([k('L2 ja'), ...nein], 3)).toEqual(['L1', 'L2']);
    expect(streichKandidaten([...nein.slice(1), k('L1 nein, L2 ja')], 3)).toEqual(['L1']); // L2 applied last time
    expect(streichKandidaten(['Gegriffen: L1 nein', 'Gegriffen: L1 nein'], 2)).toEqual([]); // no marker: not a loop comment
  });

  it('drops proposals without evidence or with an unknown form and keeps at most three', () => {
    const e = lernErgebnisAus({ vorschlaege: [V, { ...V, beleg: ' ' }, { ...V, form: 'adr' }, V, V, V], gegriffen: [{ regel: 'L1', ja: true }, { regel: 3 }] });
    expect(e?.vorschlaege).toHaveLength(3);
    expect(e?.gegriffen).toEqual([{ regel: 'L1', ja: true }]);
    expect(lernErgebnisAus({ vorschlaege: 'x' })).toBeNull();
  });

  it('the comment names evidence, form and trade-off, the next id with date, and the applied line', () => {
    const k = lernKommentar({ vorschlaege: [V], gegriffen: [{ regel: 'L1', ja: true }] }, 13, 3, '2026-11-21', ['L1', 'L2'], ['L2']);
    expect(k.startsWith(LERN_MARKE)).toBe(true);
    expect(k).toContain('1. **Port vor dem Start prüfen** — Form: test');
    expect(k).toContain('Beleg: https://github.com/o/r/issues/3#issuecomment-1');
    expect(k).toContain('Dafür entfällt: nichts');
    expect(k).toContain('`Lernschleife L3, 2026-11-21`');
    expect(k).toContain('Gegriffen: L1 ja, L2 nein');
    expect(k).toContain('**Zum Streichen vorgeschlagen:** L2');
    expect(lernKommentar({ vorschlaege: [], gegriffen: [] }, 13, null, '2026-11-21', [], [])).toContain('Keine Vorschläge');
  });
});

describe('lerne', () => {
  const welt = (strukturiert: unknown, gesehen: Start[], kommentare: string[]) => ({
    aufrufer: (_p: string, args: string[], o?: { eingabe?: string }) => {
      if (args[0] === 'issue' && args[1] === 'comment') {
        kommentare.push(o?.eingabe ?? '');
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'pr') return { code: 0, stdout: JSON.stringify({ number: 13, title: 'Epic 3', url: 'u', body: 'Gate grün', mergedAt: '2026-11-21T10:00:00Z' }), stderr: '' };
      return { code: 1, stdout: '', stderr: 'nein' };
    },
    starte: async (s: Start): Promise<LaufErgebnis> => {
      gesehen.push(s);
      return { code: 0, sitzung: 's', dauerMs: 4000, strukturiert } as LaufErgebnis;
    },
    heute: () => '2026-11-21',
  });
  const auftrag = { repo: '.', forge: 'o/r', pr: 13, epic: 3, konto: 'k', modell: 'haiku', skills: null };

  it('runs the cheap model without tools and posts one comment to the collecting issue', async () => {
    const gesehen: Start[] = [];
    const kommentare: string[] = [];
    const r = await lerne({ ...auftrag, issue: 50 }, welt({ vorschlaege: [V], gegriffen: [] }, gesehen, kommentare));
    expect(gesehen[0].modell).toBe('haiku');
    expect(gesehen[0].extraArgs).toEqual(expect.arrayContaining(['--tools', '']));
    expect(gesehen[0].auftrag).toContain('Gate grün');
    expect(r).toMatchObject({ gepostet: true, vorschlaege: 1 });
    expect(kommentare).toHaveLength(1);
  });

  it('without an issue (--trocken) it only returns the comment', async () => {
    const kommentare: string[] = [];
    const r = await lerne({ ...auftrag, issue: null }, welt({ vorschlaege: [], gegriffen: [] }, [], kommentare));
    expect(r).toMatchObject({ gepostet: false, issue: null });
    expect(r.kommentar).toContain('Keine Vorschläge');
    expect(kommentare).toEqual([]);
  });

  it('an answer outside the schema posts nothing', async () => {
    const kommentare: string[] = [];
    const r = await lerne({ ...auftrag, issue: 50 }, welt(null, [], kommentare));
    expect(r).toMatchObject({ gepostet: false, kommentar: null });
    expect(kommentare).toEqual([]);
  });
});

const lernAntwort = { wenn: '^Du bist die Lernschleife', schritte: [{ zeile: { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { vorschlaege: [V], gegriffen: [] } } }] };

describe('driver: learning loop after the merge', () => {
  it('with lern_issue the driver posts the proposals there after the merge', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll\nlern_issue: "#50"' });
    const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }]), lernAntwort]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    const k = t.p.kommentare.filter((x) => x.nr === 50);
    expect(k).toHaveLength(1);
    expect(k[0].text).toContain('**Lernschleife** — PR #13, Epic #3');
    expect(t.p.meldungen.some((m) => /Lernschleife: 1 Vorschlag/.test(m))).toBe(true);
  }, T);

  it('without lern_issue no learning run starts', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate\ngate_command: gate voll' });
    const buch = drehbuch([lauf(3, [...gateGefahren(), { text: ende(3, 13) }]), lernAntwort]);
    await fahre(t.einstellung(buch, [3]), t.welt);
    expect(buch.gesehen().some((g) => /Lernschleife/.test(JSON.stringify(g)))).toBe(false);
    expect(t.p.kommentare.filter((x) => x.nr === 50)).toEqual([]);
  }, T);
});
