// #112: merge per project and epic: the setting, the proposal from the content, the epic's switch.
// The driver's side over the bridge is in bruecke.test.ts ("Andocken je Projekt und Epic").

import { describe, expect, it } from 'vitest';
import type { Aufrufer } from '../src/aufruf.ts';
import { BEIM_MENSCHEN, MERKMALE, mergeVorschlag } from '../src/treiber/admiral.ts';
import { wirksameStellung } from '../src/treiber/einstellungen.ts';
import { sammle } from '../src/werkzeuge/belegung.ts';

describe('Andocken: Stellung, Vorschlag, Schalter (#112)', () => {
  it('the position from the setting: the project decides while nothing else does; automatisch only with merge: nach_gate', () => {
    expect(wirksameStellung('automatisch', 'nach_gate', null, null)).toEqual({ stellung: 'automatisch', herkunft: 'projekt', grund: null });
    expect(wirksameStellung('mensch', 'nach_gate', null, undefined)).toEqual({ stellung: 'mensch', herkunft: 'projekt', grund: null });
    // the bridge only tightens: whatever was stored, merge: mensch in the adapter keeps a person on every PR
    expect(wirksameStellung('automatisch', 'mensch', null, null)).toEqual({ stellung: 'mensch', herkunft: 'projekt', grund: null });
  });

  it('the proposal from the content overrules the project; the epic overrules both, the reason stays visible', () => {
    const grund = 'Geld: „Rechnung“ in #12';
    expect(wirksameStellung('automatisch', 'nach_gate', grund, null)).toEqual({ stellung: 'mensch', herkunft: 'vorschlag', grund });
    expect(wirksameStellung('automatisch', 'nach_gate', grund, 'automatisch')).toEqual({ stellung: 'automatisch', herkunft: 'epic', grund });
    expect(wirksameStellung('automatisch', 'nach_gate', null, 'mensch')).toEqual({ stellung: 'mensch', herkunft: 'epic', grund: null });
    // an epic switch automatisch under merge: mensch does not hold: back to the proposal or the project
    expect(wirksameStellung('mensch', 'mensch', grund, 'automatisch')).toEqual({ stellung: 'mensch', herkunft: 'vorschlag', grund });
    expect(wirksameStellung('mensch', 'mensch', null, 'automatisch')).toEqual({ stellung: 'mensch', herkunft: 'projekt', grund: null });
  });

  it('one entry of marker words per point of BEIM_MENSCHEN, in its order', () => {
    expect(MERKMALE).toHaveLength(BEIM_MENSCHEN.length);
    for (const m of MERKMALE) expect(m.woerter.length).toBeGreaterThan(0);
  });

  it('the proposal from the content: the first hit with its point, word and issue; nothing without one', () => {
    const v = (text: string, nr = 7) => mergeVorschlag([{ nr, text }]);
    expect(v('Schickt eine E-Mail an neue Nutzer')).toBe('nach außen: „E-Mail“ in #7');
    expect(v('Zahlungen über Stripe')).toBe('Geld: „Zahlung“ in #7');
    expect(v('Backfill der Produktivdaten')).toBe('Produktivdaten: „Produktivdaten“ in #7');
    expect(v('API-Token rotieren')).toBe('Sicherheit und Zugänge: „Token“ in #7');
    expect(v('Text für Kunden')).toBe('Kundentext: „Kunde“ in #7');
    expect(v('eine neue  Abhängigkeit für PDFs')).toBe('Architektur: „neue Abhängigkeit“ in #7');
    expect(v('Bruch mit ADR-0003')).toBe('Architektur: „Bruch mit ADR-0003“ in #7');
    expect(v('Das bricht mit ADR-0005')).toBe('Architektur: „bricht mit ADR-0005“ in #7');
    // the point asks for a break: a mention of an ADR, LLM tokens or a rectangle are none
    expect(v('Adapter-Schlüssel bleiben technisch (agent-skills/ADR-0003)')).toBeNull();
    expect(v('siehe ADR-0003')).toBeNull();
    expect(v('221 k Tokens im Lauf')).toBeNull();
    expect(v('ein Rechteck auf der Karte')).toBeNull();
    // whole words still count: a token of the forge, rights
    expect(v('Forge-Token rotieren')).toBe('Sicherheit und Zugänge: „Token“ in #7');
    // capitals count only as a whole word in capitals; any other word only from the start of a word
    expect(v('die Adresse der Brücke, Kundgebung, Datenmodell, ein Abort')).toBeNull();
    expect(v('Zählerdatei und Changelog')).toBeNull();
    // the epic before its children; the first child with a hit names its number
    expect(mergeVorschlag([{ nr: 3, text: 'Epic ohne Treffer' }, { nr: 11, text: 'Kind ohne' }, { nr: 12, text: 'Passwort zurücksetzen' }])).toBe('Sicherheit und Zugänge: „Passwort“ in #12');
  });

  it('reads the proposal with the forge reading of the occupancy: titles and bodies of the epic and its children', () => {
    const issues: Record<number, { title: string; body: string }> = {
      3: { title: 'Begrüßung', body: '## Betroffene Module\n- web\n\n- [ ] #11\n- [ ] #12' },
      4: { title: 'Zähler', body: '## Betroffene Module\n- core' },
      11: { title: 'Seite', body: 'nur Layout' },
      12: { title: 'Begrüßungsmail an Kunden', body: '' },
    };
    const gesehen: string[][] = [];
    const gh: Aufrufer = (_p, args) => {
      gesehen.push(args);
      return { code: 0, stdout: JSON.stringify({ ...issues[Number(args[2])], labels: [] }), stderr: '' };
    };
    const { bilder } = sammle(gh, '/nirgends', 'o/r', [3, 4]);
    expect(bilder.find((b) => b.nr === 3)!.mergeVorschlag).toBe('Kundentext: „Kunde“ in #12');
    expect(bilder.find((b) => b.nr === 4)!.mergeVorschlag).toBeUndefined();
    // no extra service: the same gh issue view as before, with the title
    expect(gesehen.every((a) => a[0] === 'issue' && a[1] === 'view' && a.at(-1) === 'body,labels,title')).toBe(true);
  });
});
