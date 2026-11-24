// Tag J: the history of a mission's runs for the bridge (verlauf.ts): tool calls in plain words, the log condensed,
// secrets masked and local paths shortened before anything leaves the machine. The fixture is a real excerpt of a
// run's log (stream-json), masked by hand: user name replaced, tool outputs replaced, long prompts cut.

import { describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fragenUndEntscheidungen, klartextAus, kuerzePfade, maskiere, uebersetze, Verdichter, type VerlaufEintrag, Verlaufleser } from '../src/treiber/verlauf.ts';

const LOG = readFileSync(join(import.meta.dirname, 'lauf-verlauf.jsonl'), 'utf8');
const WT = 'C:\\Users\\nutzer\\git\\hexanite-worktrees\\epic-482';
const WT480 = 'C:\\Users\\nutzer\\git\\hexanite-worktrees\\480';
const O = { gate: ['npm run gate'], wurzeln: [WT, WT480, 'C:\\Users\\nutzer\\git\\hexanite'] };

function verdichtet(log = LOG, max = 300): VerlaufEintrag[] {
  const v = new Verdichter(O);
  for (const z of log.split('\n')) v.zeile(z);
  return v.eintraege(max);
}

describe('uebersetze: a tool call in plain words', () => {
  it('reading, editing, writing and searching name the file relative to the worktree', () => {
    expect(uebersetze('Read', { file_path: `${WT480}\\gate\\logik.mts` }, O)).toEqual({ wz: 'Lesen', ziel: 'gate/logik.mts', roh: null });
    expect(uebersetze('Edit', { file_path: `${WT}\\stanze\\conftest.py`, old_string: 'a', new_string: 'b' }, O)).toEqual({ wz: 'Bearbeiten', ziel: 'stanze/conftest.py', roh: null });
    expect(uebersetze('Write', { file_path: 'C:/Users/nutzer/git/hexanite-worktrees/epic-482/doku/messung.md', content: 'x' }, O)).toEqual({ wz: 'Schreiben', ziel: 'doku/messung.md', roh: null });
    expect(uebersetze('Grep', { pattern: 'journal', path: `${WT}\\stanze\\kern` }, O)).toEqual({ wz: 'Suchen', ziel: '„journal“ in stanze/kern', roh: null });
    expect(uebersetze('Glob', { pattern: '**/*.py' }, O)?.ziel).toBe('**/*.py');
  });

  it('a shell call: tests, gate, pull request, commit, ticket and git by the command, else Befehl with its description', () => {
    const t = uebersetze('PowerShell', { command: `Set-Location ${WT}\\stanze; python -m pytest -q -n 8`, description: 'Stanze-Tests mit 8 Workern' }, O)!;
    expect(t).toEqual({ wz: 'Tests', ziel: 'Stanze-Tests mit 8 Workern', roh: 'Set-Location stanze; python -m pytest -q -n 8' });
    expect(uebersetze('Bash', { command: 'cd flotte && bun test test/lage.test.ts' }, O)).toMatchObject({ wz: 'Tests', ziel: 'cd flotte && bun test test/lage.test.ts' });
    expect(uebersetze('PowerShell', { command: "Invoke-Pester -Path install.Tests.ps1 -PassThru" }, O)?.wz).toBe('Tests');
    expect(uebersetze('Bash', { command: `cd ${WT.replaceAll('\\', '/')} && npm run gate -- --voll`, description: 'Gate' }, O)).toMatchObject({ wz: 'Andockprüfung', ziel: 'des Laufs' });
    expect(uebersetze('Bash', { command: "gh pr create --title 'Stanze parallel' --body-file b.md" }, O)?.wz).toBe('Pull Request');
    expect(uebersetze('Bash', { command: 'gh pr merge 485 --merge' }, O)?.wz).toBe('Pull Request');
    expect(uebersetze('Bash', { command: "git commit -m 'feat: x'" }, O)?.wz).toBe('Commit');
    expect(uebersetze('Bash', { command: 'gh issue comment 481 --body-file k.md' }, O)?.wz).toBe('Ticket');
    expect(uebersetze('Bash', { command: 'git fetch origin main -q' }, O)?.wz).toBe('Git');
    expect(uebersetze('Bash', { command: 'echo messung > stanze/_m.txt', description: 'Create marker files' }, O)).toEqual({ wz: 'Befehl', ziel: 'Create marker files', roh: 'echo messung > stanze/_m.txt' });
  });

  it('subagents, skills, waiting and the web; bookkeeping tools are left out', () => {
    expect(uebersetze('Agent', { description: 'Implementer #481 Stanze parallel', subagent_type: 'ingenieur-standard', prompt: 'lang' }, O)).toEqual({ wz: 'Subagent', ziel: 'Implementer #481 Stanze parallel', roh: null });
    expect(uebersetze('Skill', { skill: 'tdd' }, O)).toEqual({ wz: 'Skill', ziel: 'tdd', roh: null });
    expect(uebersetze('Monitor', { command: 'until …; done', description: 'Gate-Volllauf beendet' }, O)).toMatchObject({ wz: 'Warten', ziel: 'Gate-Volllauf beendet' });
    expect(uebersetze('WebFetch', { url: 'https://docs.example.org/a/b?x=1', prompt: 'p' }, O)).toEqual({ wz: 'Recherche', ziel: 'docs.example.org', roh: null });
    expect(uebersetze('ToolSearch', { query: 'select:Monitor' }, O)).toBeNull();
    expect(uebersetze('TodoWrite', { todos: [] }, O)).toBeNull();
  });
});

describe('maskiere: secrets never leave the machine', () => {
  it.each([
    ['$env:GH_TOKEN=\'ghp_abcdefghijklmnopqrstuvwxyz0123456789\'; gh pr list', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXRlc3Q" https://x', 'eyJhbGciOiJIUzI1NiJ9'],
    ['ANTHROPIC_API_KEY=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv bun run x', 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv'],
    ['export OPENAI_KEY=sk-proj-1234567890abcdefXYZ', 'sk-proj-1234567890abcdefXYZ'],
    ['git clone https://nutzer:geheimes-pw@github.com/a/b', 'geheimes-pw'],
    ['echo BRUECKE_TOKEN=abc123def456 >> .env', 'abc123def456'],
    ['curl -H "X-Bruecke-Pin: 4711" http://localhost:8000', '4711'],
    ['psql "password=hunter2 host=db"', 'hunter2'],
    ['gh auth login --with-token github_pat_11ABCDEFG0123456789_abcdefghijklmnop', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop'],
    ['aws s3 ls # AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ])('%s', (text, geheim) => {
    const m = maskiere(text);
    expect(m).not.toContain(geheim);
    expect(m).toContain('***');
  });

  it('leaves ordinary text alone', () => {
    const t = 'cd hive/backend && pytest -q -m beschaffung -n 4; git log --oneline -2; sk-Kontext bleibt';
    expect(maskiere(t)).toBe(t);
  });
});

describe('kuerzePfade: local paths relative to the worktree, else below ~', () => {
  it('every spelling of a root: backslash, slash, Git Bash', () => {
    expect(kuerzePfade(`Set-Location ${WT}\\stanze`, [WT])).toBe('Set-Location stanze');
    expect(kuerzePfade('cd C:/Users/nutzer/git/hexanite-worktrees/epic-482/stanze && x', [WT])).toBe('cd stanze && x');
    expect(kuerzePfade('cd /c/Users/nutzer/git/hexanite-worktrees/epic-482 && x', [WT])).toBe('cd . && x');
    expect(kuerzePfade('tail /c/Users/nutzer/git/hexanite-worktrees/_m482/a.log', [WT])).toBe('tail ~/git/hexanite-worktrees/_m482/a.log');
    expect(kuerzePfade('C:\\Users\\nutzer\\AppData\\Local\\Temp\\x', [])).toBe('~\\AppData\\Local\\Temp\\x');
  });

  it('the longest root wins: a package worktree inside a folder of worktrees', () => {
    expect(kuerzePfade(`${WT480}\\hive\\api\\conftest.py`, ['C:\\Users\\nutzer\\git\\hexanite-worktrees', WT480])).toBe('hive\\api\\conftest.py');
  });
});

describe('Verdichter: the real log condensed', () => {
  const e = verdichtet();
  const json = JSON.stringify(e);

  it('carries no tool output and no local user path', () => {
    expect(json).not.toContain('AUSGABE-DIE-NIE-GESENDET-WIRD');
    expect(json).not.toContain('Async agent launched');
    expect(json).not.toMatch(/Users[\\/]+nutzer/i);
  });

  it('the run speaks: its text, in order', () => {
    const texte = e.filter((x) => x.art === 'text' && !x.gruppe).map((x) => x.text);
    expect(texte[0]).toBe('Admiral-Antworten übernommen; ich lege den Missions-Worktree an.');
    expect(texte).toContain('Worktree für #480 steht; ich starte den Ingenieur (Urteil).');
  });

  it('one line per tool with kind, target, start and end; the raw command only as detail', () => {
    const t = e.find((x) => x.id === 'toolu_019mRoobWfDFpqHadHk3rnyC')!;
    expect(t).toMatchObject({ art: 'werkzeug', wz: 'Befehl', text: 'Read gate context commands', stand: 'fertig', bis: '2026-11-24T06:46:05.759Z' });
    expect(t.roh).toContain('sed -n 290,365p gate/logik.mts');
    expect(Date.parse(t.zeit!)).toBeLessThanOrEqual(Date.parse(t.bis!));
  });

  it('the gate: a background call stays open until its notification, failed is fehler', () => {
    const erstes = e.find((x) => x.id === 'toolu_01Wyt8ZGWeHBBfTWeEtDi1pR')!;
    expect(erstes).toMatchObject({ wz: 'Andockprüfung', text: 'des Laufs', stand: 'fehler' });
    expect(erstes.bis).toBeTruthy();
    const zweites = e.find((x) => x.id === 'toolu_01PpAFFgC11gh4qktiTHkzwM')!;
    expect(zweites).toMatchObject({ wz: 'Andockprüfung', stand: 'laeuft' });
    expect(zweites.bis).toBeUndefined();
  });

  it('a subagent is a group with role and package; its work belongs to it', () => {
    const g = e.find((x) => x.id === 'toolu_015Nrrz74nP5N6tfBLcvYUHT')!;
    expect(g).toMatchObject({ art: 'gruppe', rolle: 'Ingenieur', paket: '#480', text: 'hive-api Testsuite', stand: 'fertig' });
    const kinder = e.filter((x) => x.gruppe === g.id);
    expect(kinder[0]).toMatchObject({ art: 'text', text: 'Ich lese zuerst die betroffenen Stellen in Gate und hive-api-Testgerüst, bevor ich etwas ändere.' });
    expect(kinder.find((x) => x.id === 'toolu_01PB8CDx5apSBYZyUqEPEKcz')).toMatchObject({ wz: 'Lesen', text: 'gate/logik.mts', stand: 'fertig' });
    // its call is no tool line of its own
    expect(e.filter((x) => x.id === g.id)).toHaveLength(1);
  });

  it('the latest max entries; the header of a group whose work is in the window stays', () => {
    const kurz = verdichtet(LOG, 4);
    expect(kurz.filter((x) => x.art !== 'gruppe')).toHaveLength(4);
    expect(kurz[0]).toMatchObject({ art: 'gruppe', id: 'toolu_015Nrrz74nP5N6tfBLcvYUHT' });
  });

  it('a line read twice (a restarted driver reads the log anew) is one entry', () => {
    const v = new Verdichter(O);
    for (const z of LOG.split('\n')) v.zeile(z);
    const n = v.eintraege(1000).length;
    for (const z of LOG.split('\n')) v.zeile(z);
    expect(v.eintraege(1000)).toHaveLength(n);
  });

  it('a secret in a command is masked in the raw detail and in the target', () => {
    const zeile = JSON.stringify({ type: 'assistant', timestamp: '2026-11-24T07:00:00Z', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: "GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 gh pr list", description: 'PRs mit GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789' } }] } });
    const x = verdichtet(zeile).find((y) => y.id === 't1')!;
    expect(JSON.stringify(x)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(x.roh).toContain('***');
  });

  it('long text is cut to what the bridge takes', () => {
    const zeile = JSON.stringify({ type: 'assistant', timestamp: '2026-11-24T07:00:00Z', message: { id: 'm2', content: [{ type: 'text', text: 'x'.repeat(5000) }] } });
    expect(verdichtet(zeile)[0].text.length).toBeLessThanOrEqual(2000);
  });
});

describe('klartextAus: the card sentence of the latest line', () => {
  const zeilen = LOG.split('\n').filter(Boolean).map((z) => JSON.parse(z));
  const gruppe = (id: string) => (id === 'toolu_015Nrrz74nP5N6tfBLcvYUHT' ? { rolle: 'Ingenieur', paket: 480 } : null);

  it('work of a subagent: role, package and what it does', () => {
    const lesen = zeilen.find((d) => d.message?.content?.some((c: any) => c.id === 'toolu_01PB8CDx5apSBYZyUqEPEKcz'));
    expect(klartextAus(lesen, gruppe, O)).toEqual({ rolle: 'Ingenieur', paket: 480, satz: 'liest gate/logik.mts' });
  });

  it('the run itself: no role; a background gate is the Andockprüfung', () => {
    const gate = zeilen.find((d) => d.message?.content?.some((c: any) => c.id === 'toolu_01Wyt8ZGWeHBBfTWeEtDi1pR'));
    expect(klartextAus(gate, gruppe, O)).toEqual({ rolle: null, paket: null, satz: 'fährt die Andockprüfung' });
    const agent = zeilen.find((d) => d.message?.content?.some((c: any) => c.id === 'toolu_015Nrrz74nP5N6tfBLcvYUHT'));
    expect(klartextAus(agent, gruppe, O)).toEqual({ rolle: null, paket: null, satz: 'startet Ingenieur für #480' });
  });

  it('text: the first line, quoted; other lines give nothing', () => {
    const text = zeilen.find((d) => d.type === 'assistant' && d.message.content[0]?.type === 'text');
    expect(klartextAus(text, gruppe, O)).toEqual({ rolle: null, paket: null, satz: '„Admiral-Antworten übernommen; ich lege den Missions-Worktree an.“' });
    expect(klartextAus(zeilen.find((d) => d.type === 'user'), gruppe, O)).toBeNull();
  });
});

describe('Verlaufleser: the logs of a mission, read on as they grow', () => {
  it('reads every run of the mission in order, only the new bytes, a half line once it is whole', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verlauf-'));
    const zeile = (id: string, text: string) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-24T07:00:00Z', message: { id, content: [{ type: 'text', text }] } });
    writeFileSync(join(dir, '482-1000-1.jsonl'), `${zeile('a', 'erster Zug')}\n`);
    writeFileSync(join(dir, '482-2000-2.jsonl'), `${zeile('b', 'zweiter Zug')}\n${zeile('c', 'halb').slice(0, 30)}`);
    writeFileSync(join(dir, '48-3000-3.jsonl'), `${zeile('x', 'andere Mission')}\n`);
    writeFileSync(join(dir, '482-2000-2.jsonl.err'), 'kein Log');
    const l = new Verlaufleser(O);
    l.lies(dir, 482);
    expect(l.eintraege().map((e) => e.text)).toEqual(['erster Zug', 'zweiter Zug']);
    appendFileSync(join(dir, '482-2000-2.jsonl'), `${zeile('c', 'halb').slice(30)}\n`);
    l.lies(dir, 482);
    expect(l.eintraege().map((e) => e.text)).toEqual(['erster Zug', 'zweiter Zug', 'halb']);
  });

  it('a long mission: only the newest runs up to the byte limit, the newest always', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verlauf-'));
    const zeile = (id: string, text: string) => `${JSON.stringify({ type: 'assistant', timestamp: '2026-11-24T07:00:00Z', message: { id, content: [{ type: 'text', text }] } })}\n`;
    writeFileSync(join(dir, '482-1000-1.jsonl'), zeile('a', 'alt'.repeat(100)));
    writeFileSync(join(dir, '482-2000-2.jsonl'), zeile('b', 'neu'));
    const l = new Verlaufleser(O, 200);
    l.lies(dir, 482);
    expect(l.eintraege().map((e) => e.text)).toEqual(['neu']);
  });
});

describe('fragenUndEntscheidungen: what the person and the admiral decided, highlighted in the history', () => {
  it('the questions and decisions of the mission, masked; others stay out', () => {
    const x = fragenUndEntscheidungen(482, [
      { epic: 482, nr: 1, frage: 'Darf ich mit TOKEN=abc123def456 testen?', seit: '2026-11-24T07:00:00Z', beantwortet: '2026-11-24T07:05:00Z' },
      { epic: 482, nr: 2, frage: 'Zwei Testbetten?', seit: '2026-11-24T08:00:00Z' },
      { epic: 479, nr: 1, frage: 'fremd', seit: '2026-11-24T08:00:00Z' },
    ], [
      { epic: 482, nr: 1, frage: 'Darf ich?', antwort: 'B', herkunft: 'Admiral', zeit: '2026-11-24T07:05:00Z', von: 'admiral' },
      { epic: 479, nr: 1, frage: 'fremd', antwort: 'A', herkunft: 'Mensch', zeit: '2026-11-24T08:00:00Z', von: 'mensch' },
    ]);
    expect(x).toEqual([
      { id: 'frage:1:2026-11-24T07:00:00Z', art: 'frage', zeit: '2026-11-24T07:00:00Z', text: 'Darf ich mit TOKEN=*** testen?', stand: 'fertig' },
      { id: 'frage:2:2026-11-24T08:00:00Z', art: 'frage', zeit: '2026-11-24T08:00:00Z', text: 'Zwei Testbetten?', stand: 'laeuft' },
      { id: 'ent:1:2026-11-24T07:05:00Z', art: 'entscheidung', zeit: '2026-11-24T07:05:00Z', text: 'Frage 1 → B · Darf ich?', von: 'Admiral' },
    ]);
  });
});
