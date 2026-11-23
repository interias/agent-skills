// Guards on the orders of a Außeneinsatz that only a skill text carries: mission/SKILL.md and the
// agent files under agents/. A language model follows the text, so the sentences are pinned here.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lies = (datei: string) => readFileSync(fileURLToPath(new URL(`../../${datei}`, import.meta.url)), 'utf8').replace(/\s+/g, ' ');
const skill = lies('mission/SKILL.md');
const abschnitt = (von: string, bis: string) => skill.slice(skill.indexOf(von), skill.indexOf(bis, skill.indexOf(von)));
const phase4a = abschnitt('### 4a — Ingenieur-Subagent', '### 4b');
const phase4b = abschnitt('### 4b — Erster-Offizier-Subagent', '### 4c');
const ingenieure = readdirSync(fileURLToPath(new URL('../../agents', import.meta.url))).filter((n) => n.startsWith('ingenieur-')).map((n) => ({ n, text: lies(`agents/${n}`) }));

describe('#190: the Ingenieur runs the full suite exactly once, in the background with a log file', () => {
  it('4a: targeted tests while working, one full run at the end as a background command with a log file', () => {
    expect(phase4a).toContain('Während der Arbeit nur die Tests der berührten Dateien');
    expect(phase4a).toMatch(/Am Ende \*\*genau ein\*\* Volllauf je betroffener Suite, \*\*als Hintergrundbefehl mit Logdatei\*\*/);
    expect(phase4a).toMatch(/kein `sleep`, keine Schleife/);
    expect(phase4a).toContain('Ein Aufruf über 10 Minuten im Vordergrund ist verboten');
  });

  it('4b: the Erster Offizier runs no full suite, only targeted tests', () => {
    expect(phase4b).toContain('**Der Erste Offizier fährt keinen Volllauf.**');
    expect(phase4b).toContain('fährt gezielt die betroffenen Tests');
  });

  it('every Ingenieur agent file says the same and no longer splits a long suite', () => {
    expect(ingenieure.length).toBe(4);
    for (const { n, text } of ingenieure) {
      expect(text, n).toMatch(/Den einen Volllauf am Ende startest du als Hintergrundbefehl mit Logdatei/);
      expect(text, n).toMatch(/kein `sleep`, keine Schleife/);
      expect(text, n).not.toContain('fährst du sie in Teilen');
    }
  });
});

const phase2b = abschnitt('### 2b — Der Graph', '### 2c');

describe('#201: independent packages at the same time, the Ingenieur checks himself before the report', () => {
  it('2b: packages without an edge and without a shared file start at the same time', () => {
    expect(phase2b).toContain('Pakete ohne Kante und ohne gemeinsame Datei starten gleichzeitig');
    expect(phase2b).toMatch(/„nacheinander“ nur mit genannter Kante oder Datei/);
  });

  it('4a and every Ingenieur agent file: each acceptance point checked by himself, with its evidence', () => {
    expect(phase4a).toContain('prüft er vor dem Bericht jeden Abnahmepunkt selbst und nennt je Punkt den Beleg');
    for (const { n, text } of ingenieure) expect(text, n).toContain('**Vor dem Bericht** prüfst du jeden Abnahmepunkt deines Pakets selbst');
  });

  it('the Erster Offizier stays unchanged: still checks each point against evidence', () => {
    expect(phase4b).toContain('Ist jeder Abnahmepunkt erfüllt — nachweisbar, nicht behauptet?');
  });
});
