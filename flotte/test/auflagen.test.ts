// The findings of the acceptance at #14 (comment 7013038104): each with a test of its own.

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { admiralWerkzeuge, antwortenAus, laufWerkzeuge, schemaFuer } from '../src/treiber/admiral.ts';
import { fahre, SPERREN_GRENZE, standard } from '../src/treiber/treiber.ts';
import { hookRegel } from '../src/werkzeuge/lauf.ts';
import { leseBlock, type FrageBlock } from '../src/werkzeuge/bloecke.ts';
import { flotteDir } from '../src/werkzeuge/zustand.ts';
import { admiral, aufbau, drehbuch, ende, frage, lauf, ping } from './flotte-welt.ts';

const T = 30_000;
const fuer = <G extends { eingabe: string }>(gesehen: G[], nr: number): G[] => gesehen.filter((g) => new RegExp(`^Flotte, Epic #${nr}\\b`).test(g.eingabe));
const index = (liste: string[], muster: RegExp) => liste.findIndex((z) => muster.test(z));
const block = (nr: number, n: number) => leseBlock(frage(nr, 'tor', Array.from({ length: n }, () => ({ betrifft: 'Lauf' })))) as FrageBlock;

describe('Befund 1: Admiral-Antworten mit falscher nr', () => {
  it('the schema allows only the question numbers; answers numbered by the epic are taken in order', () => {
    const b = block(12, 2);
    expect(schemaFuer(b).properties.antworten.items.properties.nr).toEqual({ type: 'integer', enum: [1, 2] });
    const a = antwortenAus({ antworten: [{ nr: 12, antwort: 'A', herkunft: 'Skill-Empfehlung', grund: 'x', beim_menschen: false, einflussreich: false }, { nr: 13, antwort: 'B', herkunft: 'h', grund: 'y', beim_menschen: false, einflussreich: true }] }, b);
    expect(a.map((x) => [x.nr, x.antwort, x.beim_menschen])).toEqual([
      [1, 'A', false],
      [2, 'B', false],
    ]);
    // one fitting number: the others are not guessed by position
    const teil = antwortenAus({ antworten: [{ nr: 2, antwort: 'B', herkunft: 'h', grund: 'y', beim_menschen: false, einflussreich: false }, { nr: 7, antwort: 'A', herkunft: 'h', grund: 'y', beim_menschen: false, einflussreich: false }] }, b);
    expect(teil.map((x) => x.beim_menschen)).toEqual([true, false]);
  });

  it('the driver takes the decision of an admiral that answered with the epic number (dress rehearsal #12)', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(12, [{ text: frage(12, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(12, [{ nr: 12, antwort: 'A', beim_menschen: false }]), lauf(12, [{ text: ende(12, 20) }])]);
    const z = await fahre(t.einstellung(buch, [12]), t.welt);
    expect(z.fragen).toHaveLength(0);
    expect(z.entscheidungen).toHaveLength(1);
    expect(fuer(buch.gesehen(), 12)[1].eingabe).toMatch(/1\. A — Herkunft/);
    const admiralArgs = buch.gesehen().find((g) => g.eingabe.startsWith('FLOTTE-ADMIRAL'))!.args;
    expect(admiralArgs[admiralArgs.indexOf('--json-schema') + 1]).toMatch(/"enum":\[1\]/);
  }, T);
});

describe('Befund 2: keine Konnektoren und MCP-Werkzeuge', () => {
  it('admiral and runs start with --strict-mcp-config; the admiral only with the read tools', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    await fahre(t.einstellung(buch, [3]), t.welt);
    const a = buch.gesehen().find((g) => g.eingabe.startsWith('FLOTTE-ADMIRAL'))!;
    expect(a.args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--tools', 'Read,Grep,Glob']));
    for (const g of fuer(buch.gesehen(), 3)) expect(g.args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--disallowedTools']));
  }, T);

  it('checks the tool list of the init event (live in flotte-probe, 19.11.2026: admiral Glob, Grep, Read, StructuredOutput; runs without mcp__)', () => {
    expect(admiralWerkzeuge(['Glob', 'Grep', 'Read', 'StructuredOutput'])).toBeNull();
    expect(admiralWerkzeuge(['Glob', 'Grep', 'Read', 'StructuredOutput', 'mcp__claude_ai_Gmail__send_message'])).toMatch(/mcp__claude_ai_Gmail__send_message/);
    expect(admiralWerkzeuge(['Read', 'Bash'])).toMatch(/Bash/);
    expect(laufWerkzeuge(['Task', 'Bash', 'Edit', 'Read', 'Skill', 'WebFetch'])).toBeNull();
    expect(laufWerkzeuge(['Bash', 'mcp__claude_ai_Claude_Docs__delete'])).toMatch(/Claude_Docs__delete/);
    expect(laufWerkzeuge(['Bash', 'PushNotification'])).toMatch(/PushNotification/);
  });

  it('an admiral that sees a connector is stopped, its answer discarded, the question goes to the person', async () => {
    const t = aufbau();
    const leck = { ...admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), werkzeuge: ['Glob', 'Grep', 'Read', 'StructuredOutput', 'mcp__claude_ai_Gmail__send_message'] };
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), leck]);
    const z = await fahre(t.einstellung(buch, [3], { maxDauerMs: 1500 }), t.welt);
    expect(z.entscheidungen).toHaveLength(0);
    expect(z.fragen).toHaveLength(1);
    expect(t.p.meldungen.some((m) => /Admiral mit unerwarteten Werkzeugen: mcp__claude_ai_Gmail__send_message/.test(m))).toBe(true);
  }, T);

  it('a run that sees an MCP tool is killed before it works; the epic is blocked', async () => {
    const t = aufbau();
    const buch = drehbuch([{ ...lauf(3, [{ warte: 5000 }, { text: ende(3, 13) }]), werkzeuge: ['Bash', 'mcp__claude_ai_Gmail__send_message'] }]);
    const anfang = Date.now();
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(Date.now() - anfang).toBeLessThan(4000);
    expect(z.epics['3'].stufe).toBe('blockiert');
    expect(z.epics['3'].notiz).toMatch(/Lauf mit verbotenen Werkzeugen: mcp__claude_ai_Gmail__send_message/);
  }, T);
});

describe('Befund 3: CleanupStale verschont wartende Läufe', () => {
  it('a run carries its holder file; it stays while the epic waits and goes when the epic is merged', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate' });
    const buch = drehbuch([
      lauf(3, [{ warte: 300 }, { text: ende(3, 13) }]),
      lauf(4, [{ text: frage(4, 'tor', [{ betrifft: 'Lauf' }]) }]),
      admiral(4, [{ nr: 1, antwort: 'A', beim_menschen: true }]),
    ]);
    const z = await fahre(t.einstellung(buch, [3, 4], { maxDauerMs: 2500 }), t.welt);
    const halten = join(flotteDir(t.repo), 'halten');
    expect(fuer(buch.gesehen(), 4)[0].halter).toBe(join(halten, '4.json'));
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(t.p.aufraeumen).toBeGreaterThan(0);
    // epic 4 waits for the person: its locks are held through the cleanup after the merge of #13
    expect(existsSync(join(halten, '4.json'))).toBe(true);
    expect(existsSync(join(halten, '3.json'))).toBe(false);
  }, T);
});

describe('Befund 4: ein langer Zug macht sein Konto nicht rot', () => {
  it('pings while a run works on the account; another epic of the account continues before that turn ends', async () => {
    const t = aufbau({ verbrauch: [0.1] });
    const buch = drehbuch([
      ping(0.1),
      lauf(3, [{ warte: 6000 }, { text: ende(3, 13) }]),
      lauf(4, [{ warte: 3000 }, { text: frage(4, 'tor', [{ betrifft: 'Lauf' }]) }]),
      admiral(4, [{ nr: 1, antwort: 'A', beim_menschen: false }]),
      lauf(4, [{ text: ende(4, 14) }]),
    ]);
    // a value counts as stale after 2.4 s here, as after 30 min in real use
    const z = await fahre(t.einstellung(buch, [3, 4], { verbrauchMaxAlterMin: 0.04 }), t.welt);
    expect(buch.gesehen().some((g) => g.eingabe.startsWith('FLOTTE-PING'))).toBe(true);
    expect(index(t.p.zeitleiste, /^#4 Lauf fortgesetzt/)).toBeGreaterThan(-1);
    expect(index(t.p.zeitleiste, /^#4 Lauf fortgesetzt/)).toBeLessThan(index(t.p.zeitleiste, /^#3 FLOTTE-ENDE/));
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.epics['4'].stufe).toBe('fertig');
  }, T);

  it('no pings while everything waits for the person', async () => {
    const t = aufbau({ verbrauch: [0.1] });
    const buch = drehbuch([ping(0.1), lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }])]);
    await fahre(t.einstellung(buch, [3], { verbrauchMaxAlterMin: 0.02, maxDauerMs: 3000 }), t.welt);
    expect(buch.gesehen().filter((g) => g.eingabe.startsWith('FLOTTE-PING'))).toHaveLength(0);
  }, T);
});

describe('Befund 5: Konten mit ~', () => {
  it('expands every ~, not only the first one the shell expands', () => {
    expect(standard('.', 'o/r', [1], ['~/.claude', '~/.claude-arbeitspferd']).konten).toEqual([join(homedir(), '.claude'), join(homedir(), '.claude-arbeitspferd')]);
  });

  it('refuses to start with an account folder that does not exist', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    await expect(fahre({ ...t.einstellung(buch, [3]), konten: [t.konten[0], join(t.repo, '~', '.claude-arbeitspferd')] }, t.welt)).rejects.toThrow(/Kontenverzeichnis fehlt/);
    expect(buch.gesehen()).toHaveLength(0);
  }, T);
});

describe('Befund 7: eine alte merge.ps1 mergt nicht', () => {
  it('with merge: nach_gate and a merge.ps1 that does not know the key, the driver does not call it; a person merges', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate', mergeSkript: '# old merge.ps1: waits for checks, then gh pr merge\n', pr: (_nr, n) => ({ state: n < 2 ? 'OPEN' : 'MERGED' }) });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(t.p.merges).toEqual([]);
    expect(t.p.kommentare.find((k) => k.text.startsWith('**PR bereit'))?.text).toMatch(/kennt den Adapterschlüssel merge nicht \(alte Fassung\)/);
    expect(z.epics['3'].stufe).toBe('fertig');
  }, T);
});

describe('Befund 9: eine bewegte Basis zählt nicht als Nachbesserung', () => {
  it('three refusals because another merge moved the base do not block the epic', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate', merge: (pr, n) => (n <= 3 ? `GATE FEHLT #${pr}: Gate lief gegen abc1234, die Basis steht auf def5678` : `GEMERGT #${pr} -> main`) });
    const buch = drehbuch([lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(t.p.merges).toEqual([13, 13, 13, 13]);
    expect(z.epics['3']).toMatchObject({ stufe: 'fertig', basisNachzuege: 3 });
    expect(z.epics['3'].mergeVersuche ?? 0).toBe(0);
  }, T);
});

describe('Befund 12: merge.ps1 hält die Schleife nicht an', () => {
  it('while merge.ps1 waits, the driver answers another run', async () => {
    const t = aufbau({ adapter: 'merge: nach_gate', mergeDauerMs: 2000 });
    const buch = drehbuch([
      lauf(3, [{ text: ende(3, 13) }]),
      lauf(4, [{ warte: 400 }, { text: frage(4, 'tor', [{ betrifft: 'Lauf' }]) }]),
      admiral(4, [{ nr: 1, antwort: 'A', beim_menschen: false }]),
      lauf(4, [{ warte: 2500 }, { text: ende(4, 14) }]),
    ]);
    const z = await fahre(t.einstellung(buch, [3, 4]), t.welt);
    expect(index(t.p.zeitleiste, /^#4 Lauf fortgesetzt/)).toBeLessThan(index(t.p.zeitleiste, /^gemergt 13$/));
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.epics['4'].stufe).toBe('fertig');
  }, T);
});

describe('Befund 13: Leerlauf', () => {
  it('a silent turn is resumed once; the next silent turn ends the epic', async () => {
    const t = aufbau();
    const einmal = drehbuch([lauf(3, [{ haenge: true }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(einmal, [3], { leerlaufMs: 600 }), t.welt);
    const laeufe = fuer(einmal.gesehen(), 3);
    expect(laeufe).toHaveLength(2);
    expect(laeufe[1].args).toEqual(expect.arrayContaining(['--resume', 's3']));
    expect(laeufe[1].eingabe).toMatch(/ohne Ausgabe und wurde beendet/);
    expect(z.epics['3'].stufe).toBe('fertig');

    const t2 = aufbau();
    const zweimal = drehbuch([lauf(3, [{ haenge: true }])]);
    const z2 = await fahre(t2.einstellung(zweimal, [3], { leerlaufMs: 600 }), t2.welt);
    expect(fuer(zweimal.gesehen(), 3)).toHaveLength(2);
    expect(z2.epics['3'].stufe).toBe('abgebrochen');
  }, T);
});

describe('Befund 15: guard.ps1 auch nach --resume', () => {
  it('every start and every continuation carries guard.ps1 as a session hook (--settings)', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]), lauf(3, [{ text: ende(3, 13) }])]);
    await fahre(t.einstellung(buch, [3]), t.welt);
    const laeufe = fuer(buch.gesehen(), 3);
    expect(laeufe).toHaveLength(2);
    expect(laeufe[1].args).toContain('--resume');
    for (const g of laeufe) {
      const settings = JSON.parse(g.args[g.args.indexOf('--settings') + 1]);
      const hook = settings.hooks.PreToolUse[0];
      expect(hook.matcher).toBe('Bash|PowerShell');
      expect(hook.hooks[0].command).toContain(join(t.repo, 'skripte', 'guard.ps1'));
      expect(hook.hooks[0].command).toMatch(/-Profile epic$/);
      // like the hook in the head of epic/SKILL.md: a hook that fails refuses, it never lets through (Nachprüfung A)
      expect(hook.hooks[0].onFailure).toBe('block');
    }
  }, T);
});

describe('Niedrig: Frage-Kommentar ohne lokalen Pfad', () => {
  it('the comment at the issue names no absolute path of this machine', async () => {
    const t = aufbau();
    const buch = drehbuch([lauf(3, [{ text: frage(3, 'tor', [{ betrifft: 'Lauf' }]) }]), admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: true }])]);
    await fahre(t.einstellung(buch, [3], { maxDauerMs: 1500 }), t.welt);
    const k = t.p.kommentare.find((x) => x.text.startsWith('**FRAGE AN DEN MENSCHEN'))!.text;
    expect(k).toMatch(/flotte antworten \. 3 1/);
    expect(k).not.toContain(t.repo);
  }, T);
});

// Nachprüfung at #14 (comment 7015405998), finding B: a refusal of guard.ps1 reaches the run as a
// tool error, and the run can change its way, as in a window.
let sperrNr = 0;
function sperre(regel: string, befehl: string) {
  const id = `toolu_sperre_${++sperrNr}`;
  const text = `PreToolUse:Bash hook error: Gesperrt durch Hook (${regel}: Text der Regel): '${befehl}'. Weg ändern, nicht in anderer Form wiederholen.`;
  return {
    zeile: { zeile: { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: text }] } } },
    verweigert: { tool_name: 'Bash', tool_use_id: id, tool_input: { command: befehl } },
  };
}

describe('Nachprüfung B: eine Hook-Sperre blockiert das Epic nicht sofort', () => {
  it('reads the rule from the text of guard.ps1', () => {
    expect(hookRegel("PreToolUse:Bash hook error: Gesperrt durch Hook (Skill epic, Regel 1: Ein Lauf mergt nie): 'gh pr merge 1'.")).toBe('Skill epic, Regel 1');
  });

  it('a run that changes its way after a refusal goes on; the refusal is on the board', async () => {
    const t = aufbau();
    const a = sperre('Skill epic, Regel 1', 'gh pr merge 13');
    const buch = drehbuch([lauf(3, [a.zeile, { text: ende(3, 13), verweigert: [a.verweigert] }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].stufe).toBe('fertig');
    expect(z.epics['3'].sperren).toEqual(['Skill epic, Regel 1']);
    expect(index(t.p.zeitleiste, /Hook-Sperre: Skill epic, Regel 1/)).toBeGreaterThanOrEqual(0);
  }, T);

  it('the same rule a second time blocks the epic: the run tried again in another form', async () => {
    const t = aufbau();
    const a = sperre('Skill epic, Regel 1', 'gh pr merge 13');
    const b = sperre('Skill epic, Regel 1', 'gh api -X PUT repos/x/y/pulls/13/merge');
    const buch = drehbuch([
      lauf(3, [a.zeile, { text: frage(3, 'tor', [{ betrifft: 'Lauf' }]), verweigert: [a.verweigert] }]),
      admiral(3, [{ nr: 1, antwort: 'A', beim_menschen: false }]),
      lauf(3, [b.zeile, { text: ende(3, 13), verweigert: [b.verweigert] }]),
    ]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(fuer(buch.gesehen(), 3)).toHaveLength(2);
    expect(z.epics['3'].stufe).toBe('blockiert');
    expect(z.epics['3'].notiz).toMatch(/Regel „Skill epic, Regel 1" sperrte zweimal/);
    expect(t.p.kommentare.some((k) => k.text.includes('gh api -X PUT'))).toBe(true);
  }, T);

  it(`blocks at the ${SPERREN_GRENZE}rd refusal of an epic, even by different rules`, async () => {
    const t = aufbau();
    const s = ['Skill epic, Regel 1', 'Skill epic, Regel 2', 'Skill epic, Regel 11'].map((r, i) => sperre(r, `befehl ${i}`));
    const buch = drehbuch([lauf(3, [...s.map((x) => x.zeile), { text: ende(3, 13), verweigert: s.map((x) => x.verweigert) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].stufe).toBe('blockiert');
    expect(z.epics['3'].notiz).toMatch(/3 Hook-Sperren/);
  }, T);

  it('a turn that fails at the refusal (no block) blocks at once, without asking again', async () => {
    const t = aufbau();
    const a = sperre('Skill epic, Regel 1', 'gh pr merge 13');
    const buch = drehbuch([lauf(3, [a.zeile, { text: 'Gesperrt, ich weiß nicht weiter.', verweigert: [a.verweigert] }]), lauf(3, [{ text: ende(3, 13) }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(fuer(buch.gesehen(), 3)).toHaveLength(1);
    expect(z.epics['3'].stufe).toBe('blockiert');
    expect(z.epics['3'].notiz).toMatch(/der Zug scheiterte daran/);
  }, T);

  it('a refusal that is not the hook\'s still blocks at once (D19), also next to a hook refusal', async () => {
    const t = aufbau();
    const a = sperre('Skill epic, Regel 1', 'gh pr merge 13');
    const buch = drehbuch([lauf(3, [a.zeile, { text: ende(3, 13), verweigert: [a.verweigert, { tool_name: 'Write', tool_use_id: 'toolu_auto', tool_input: {} }] }])]);
    const z = await fahre(t.einstellung(buch, [3]), t.welt);
    expect(z.epics['3'].stufe).toBe('blockiert');
    expect(z.epics['3'].notiz).toMatch(/Erlaubnis verweigert: Write/);
  }, T);
});
