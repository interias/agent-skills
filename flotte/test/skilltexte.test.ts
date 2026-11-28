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

const phase4 = abschnitt('## Phase 4 — Das Fenster', '### Die RAM-Bremse');
const phase1 = abschnitt('## Phase 1 — Lesen', '## Phase 2');
const phase3 = abschnitt('## Phase 3 — Missions-Branch und Worktrees', '## Phase 4');
const worktreeMd = lies('mission/references/worktree.md');

describe('#200: relieve the orchestrator', () => {
  it('Phase 4: the check of a package starts alongside its Erster Offizier, the next Ingenieur as soon as a place is free', () => {
    expect(phase4).toContain('deine Nachprüfung (4c) startet **zugleich mit** seinem Ersten Offizier, nicht danach');
    expect(phase4).toContain('nicht erst nach der Nacharbeit des Andockens');
  });

  it('Phase 3 and references/worktree.md: no install per worktree where link_dirs names the folder', () => {
    expect(phase3).toMatch(/Kein `bun install`, `npm install` oder Gegenstück je Worktree/);
    expect(worktreeMd).toMatch(/Kein `bun install`, `npm install` oder Gegenstück je Worktree/);
  });

  it('Phase 1: the reading before the Vorab-Tor goes to Kundschafter', () => {
    expect(phase1).toContain('Die Lesearbeit vor dem Vorab-Tor — Behauptungen, Fundstellen, berührte Module, Kanten — geht an Kundschafter');
  });
});

describe('gate.ps1: the driver reads its stdout as UTF-8 (#75)', () => {
  it('sets the console output encoding to UTF-8 before anything is printed', () => {
    const gate = readFileSync(fileURLToPath(new URL('../../gate.ps1', import.meta.url)), 'utf8');
    const zeile = gate.indexOf('[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)');
    expect(zeile).toBeGreaterThan(-1);
    expect(zeile).toBeLessThan(gate.indexOf('$pesterLauf'));
  });
});

describe('gate.ps1: the driver suite runs with a generous limit per test (#233)', () => {
  it('runs bun test with 20 s per test instead of the default 5 s, so a busy machine does not fail a long git test', () => {
    const gate = readFileSync(fileURLToPath(new URL('../../gate.ps1', import.meta.url)), 'utf8');
    expect(gate).toMatch(/flotte\s+=\s+\{ Push-Location flotte; bun test --timeout 20000;/);
  });
});

describe('#169: an open prerequisite parks the mission, in step with the driver (#133)', () => {
  const vorbedingung = abschnitt('- **Vorbedingung prüfen:**', '- **Basis bestimmen**');
  it('the other two branches stay as they were', () => {
    expect(vorbedingung).toContain('werden diese Tickets im selben Lauf mitbearbeitet — ein Missions-Branch, ein Pull Request.');
    expect(vorbedingung).toContain('Hängen nur **einzelne** Missionsziele daran, werden diese übersprungen (Phase 2d).');
  });
  it('otherwise: no work surfaces, no pull request, a comment with reason and resumption', () => {
    expect(vorbedingung).toContain('Sonst **parkt die Mission**');
    expect(vorbedingung).toMatch(/kein Paket-Worktree, kein Pull Request/);
    expect(vorbedingung).toMatch(/Kommentar an der Mission nennt den Grund .* und die Wiederaufnahme/);
  });
  it('under the driver: FLOTTE-ENDE without a pull request naming every open prerequisite, which the driver turns into waiting', () => {
    expect(vorbedingung).toMatch(/endet der Zug mit `FLOTTE-ENDE` ohne Pull Request, das jede offene Vorbedingung als `#<n>` nennt/);
    expect(vorbedingung).toContain('wartend');
  });
});

describe('the Ingenieur and the Erster Offizier keep their prompt cache for an hour', () => {
  // A subagent caches for five minutes; the Ingenieur waits longer on his background full run and would
  // write his whole context again. 8ede2c9 set this on the run agent; #121 dropped that agent and the
  // setting with it.
  const wartende = readdirSync(fileURLToPath(new URL('../../agents', import.meta.url))).filter((n) => n.startsWith('ingenieur-') || n.startsWith('erster-offizier-'));

  it.each(wartende)('%s sets experimental.cacheTtl: 1h in its frontmatter', (n) => {
    const roh = readFileSync(fileURLToPath(new URL(`../../agents/${n}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
    const kopf = roh.slice(0, roh.indexOf('\n---', 4));
    expect(kopf).toMatch(/\nexperimental:\n {2}cacheTtl: 1h(\n|$)/);
  });
});

describe('#211: a long own wait stays warm, the rule stands word for word in 4a and every Ingenieur', () => {
  const regel = (text: string) => {
    const von = text.indexOf('**Warm bleiben (#211):**');
    return von < 0 ? '' : text.slice(von, text.indexOf('keine Schleife.', von) + 'keine Schleife.'.length);
  };

  it('4a carries the alarm clock with a time limit, no sleep, no loop', () => {
    const r = regel(phase4a);
    expect(r).toContain('länger als 50 Minuten');
    expect(r).toContain('startest du daneben `<skill>/scripts/wecker.ps1`');
    expect(r).toContain('Meldet er „Zeit um“, liest du das Log, meldest eine Zeile Stand und startest ihn neu');
    expect(r).toContain('ist die Arbeit fertig, beendest du ihn — kein `sleep`, keine Schleife.');
    expect(skill).toContain('startest du daneben den Wecker aus 4a („Warm bleiben“, auch bei Nachprüfung und Andockprüfung)');
  });

  it('every Ingenieur agent file has the same paragraph as 4a', () => {
    expect(ingenieure.length).toBe(4);
    expect(regel(phase4a)).not.toBe('');
    for (const { n, text } of ingenieure) expect(regel(text), n).toBe(regel(phase4a));
  });
});

describe('check once, do not chase the base (24.11.2026): only the head of the merge queue merges the base and checks again', () => {
  const phase6 = abschnitt('## Phase 6 — Abschluss', '- **Nicht andocken.**');
  const adapterMd = lies('mission/references/adapter.md');
  const andocken = adapterMd.slice(adapterMd.indexOf('### Andocken'), adapterMd.indexOf('### Werft'));

  it('Phase 6: the mission runs the gate once on its head and does not merge the base afterwards', () => {
    expect(phase6).toContain('Die Mission fährt die Andockprüfung **einmal**, nach ihrem letzten Commit auf ihrem Head');
    expect(phase6).toContain('Ein eigener Commit danach verlangt einen neuen Lauf und Block');
    expect(phase6).toContain('Eine Bewegung der Basis verlangt keinen: Die Basis holt erst nach, wer andockt, unter dem Treiber nur die Spitze der Andock-Schlange (`references/adapter.md`, „Andocken")');
    expect(phase6).not.toContain('gegen den aktuellen Stand der Basis');
  });

  it('by hand: bring the base in, gate, push and append the block, then merge.ps1 (adapter reference, short in AGENTS.md)', () => {
    expect(andocken).toContain('ohne Treiber der Mensch oder die Sitzung, die andockt');
    expect(andocken).toMatch(/1\. die Basis per `git merge <push_remote>\/<basis>` in den Missions-Branch holen, 2\. die Andockprüfung \(`gate_command`\) auf diesem Stand fahren, 3\. pushen und den neuen Block unter `gate_heading` an die PR-Beschreibung anhängen .* 4\. `merge\.ps1 -Repo <owner\/name> -Pr <nr>` aufrufen\./);
    expect(lies('AGENTS.md')).toContain('fährt es neu, pusht und hängt den Block an die PR-Beschreibung');
  });

  it('every docking onto the base goes through merge.ps1, for the driver, a person and an admiral session alike; one way, not one actor', () => {
    expect(andocken).toContain('**Jedes Andocken auf den Basiszweig geht über `merge.ps1`**: Bei `merge: nach_gate` ist es der eine Weg für jeden, der andockt — den Treiber, einen Menschen, eine Sitzung, auch eine Admiral-Sitzung.');
    expect(andocken).toContain('angedockt wird auf genau einem Weg, mit `merge.ps1`');
    expect(andocken).not.toContain('und der Lauf fährt die Andockprüfung neu');
    expect(skill).toContain('`merge.ps1` außerhalb des Laufs (`nach_gate`), der eine Weg für jeden, der andockt: Treiber, Mensch, Admiral-Sitzung.');
    const befugnisse = lies('docs/befugnisse.md');
    expect(befugnisse).toContain('Der Admiral des Treibers und die Läufe **docken nie an**.');
    expect(befugnisse).toContain('Jedes Andocken auf den Basiszweig geht über `merge.ps1`: Wer bei `nach_gate` doch von Hand andockt — du, eine Sitzung, auch eine Admiral-Sitzung —, nimmt dasselbe Skript wie der Treiber');
    expect(lies('AGENTS.md')).toContain('Jedes Andocken auf `main` geht über `mission/scripts/merge.ps1`');
    for (const datei of ['mission/SKILL.md', 'mission/references/adapter.md', 'mission/README.md', 'mission/scripts/README.md']) expect(lies(datei), datei).not.toMatch(/genau ein(em)? Akteur/);
  });
});

describe('only software (24.11.2026): content goals go to the person, every place that releases or cuts says it', () => {
  const regeln = abschnitt('## Die Regeln, die nicht verhandelbar sind', '## Die Statuslabels');
  const tor = abschnitt('### 2c — Das Vorab-Tor', '### 2d');

  it('rule 14: the mission builds software, no content', () => {
    expect(regeln).toContain('14. **Die Mission baut Software, keinen Inhalt.**');
    expect(regeln).toContain('Ein Inhaltsziel ist ein Punkt fürs Vorab-Tor (2c, Punkt 15)');
  });

  it('Vorab-Tor point 15: judged by the result, recommendation ready-for-human, mixed goals build the software part', () => {
    expect(tor).toContain('15. **Ein Inhaltsziel** (Regel 14)');
    expect(tor).toContain('Maßstab ist das Ergebnis, nicht ein Wort im Text');
    expect(tor).toContain('Empfehlung: herauslösen — das Ticket bekommt `ready-for-human` statt des Freigabelabels');
    expect(tor).toContain('der Inhaltsanteil wird offener Punkt im Pull Request');
  });

  it('every place draws the line the same way (24.11.2026): what is made for the software is built, content the person works out in it is not', () => {
    // test data stays the fleet's work; master and business data of the business are the person's
    const baut = 'Was für die Software gemacht wird, baut die Flotte, auch Testdaten und beschlossene Gestaltung wie Piktogramme, Farben oder Oberflächentexte';
    const inhalt = 'Inhalt, den der Mensch in der Software erarbeitet und dort pflegt — Konzeptrunden, Konstruktionen, Stamm- und Geschäftsdaten des Betriebs, Recherche dafür';
    const orte = { regel14: regeln, tor15: tor, triage: lies('flotte/src/triage.ts'), befugnisse: lies('docs/befugnisse.md'), nacharbeit: lies('mission-nacharbeit/SKILL.md'), bereitschaftsraum: lies('bereitschaftsraum/SKILL.md') };
    for (const [ort, text] of Object.entries(orte)) {
      // point 15 of the gate refers to rule 14 for what the fleet builds
      if (ort !== 'tor15') expect(text, ort).toContain(baut);
      expect(text, ort).toContain(inhalt);
      expect(text, ort).not.toContain('gestaltete Motive');
    }
  });

  it('Bereitschaftsraum, Nacharbeit, adapter reference and befugnisse carry it', () => {
    expect(lies('bereitschaftsraum/SKILL.md')).toContain('nur „anlegen“, nie „anlegen und starten“: Die Triage empfiehlt dann `ready-for-human`');
    expect(lies('mission-nacharbeit/SKILL.md')).toContain('**Inhalt** ist nie Sitzung (`mission/SKILL.md`, Regel 14)');
    expect(lies('mission/references/adapter.md')).toContain('So kann ein Projekt auch Regel 14 („nur Software“, `SKILL.md`) schärfen');
    expect(lies('docs/befugnisse.md')).toContain('bekommt es `ready-for-human`, nicht `ready-for-agent`');
  });
});
