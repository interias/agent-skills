// #167: the program lays the facts nearly every triage decision needs before the model (ADRs, adapter, last merges,
// the files the notes name); the model reads only what is missing, at most a set number of file accesses per call,
// held by --max-turns. Each run reports duration and tool calls of its admiral calls.

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { regelnAus } from '../src/befehle/auftrag.ts';
import { triagiere } from '../src/befehle/triage.ts';
import { faktenpaket, genannteDateien, LESEN_MAX } from '../src/triage-fakten.ts';
import type { Ticket } from '../src/triage.ts';
import { Auswertung, type LaufErgebnis, type Start } from '../src/werkzeuge/lauf.ts';

const REGELN = regelnAus('');

function repo(): string {
  const r = mkdtempSync(join(tmpdir(), 'triage-fakten-'));
  mkdirSync(join(r, 'docs', 'adr'), { recursive: true });
  mkdirSync(join(r, '.claude'));
  mkdirSync(join(r, 'src'));
  writeFileSync(join(r, 'docs', 'adr', '0001-erste.md'), '# ADR-0001 — Erste Entscheidung\n\n**Status:** Entschieden\n');
  writeFileSync(join(r, 'docs', 'adr', '0002-zweite.md'), '# ADR-0002 — Zweite\n\n**Status:** Abgelöst\n');
  writeFileSync(join(r, '.claude', 'epic.md'), '---\nforge: github\nready_label: ready-for-agent\n---\n');
  writeFileSync(join(r, 'src', 'port.ts'), 'export const PORT = 4747;\n');
  writeFileSync(join(r, 'src', 'gross.ts'), 'x'.repeat(10_000));
  return r;
}

const notiz = (nummer: number, body: string): Ticket => ({ nummer, titel: `Notiz ${nummer}`, body, url: '', labels: ['needs-triage'], kommentare: [] });
const merges = (_p: string, args: string[]) => (args[0] === 'pr' && args[1] === 'list' ? { code: 0, stdout: JSON.stringify([{ number: 12, title: 'Port prüfen' }]), stderr: '' } : { code: 0, stdout: '', stderr: '' });

describe('#167 Faktenpaket der Triage', () => {
  it('holds the ADRs with status, the adapter, the last merges and the named files that exist, cut', () => {
    const r = repo();
    const f = faktenpaket(r, 'o/r', merges, [notiz(1, 'Der Port in `src/port.ts` und src/fehlt.ts'), notiz(2, 'Siehe src/gross.ts und src/port.ts')]);
    expect(f).toContain('- ADR-0001 — Erste Entscheidung (Entschieden; docs/adr/0001-erste.md)');
    expect(f).toContain('- ADR-0002 — Zweite (Abgelöst; docs/adr/0002-zweite.md)');
    expect(f).toContain('ready_label: ready-for-agent');
    expect(f).toContain('- #12 Port prüfen');
    expect(f).toContain('### src/port.ts (genannt in #1)\n```\nexport const PORT = 4747;');
    expect(f).not.toContain('src/fehlt.ts');
    // a path leading out of the repository is never read
    writeFileSync(join(r, '..', `${basename(r)}-draussen.txt`), 'geheim');
    expect(faktenpaket(r, 'o/r', merges, [notiz(3, `Siehe ../${basename(r)}-draussen.txt`)])).not.toContain('geheim');
    // a file named twice stands once; a long one is cut and says so
    expect(f.match(/### src\/port\.ts/g)).toHaveLength(1);
    expect(f).toContain('### src/gross.ts (genannt in #2, gekürzt auf 4000 von 10000 Bytes)');
  });

  it('a part the forge does not answer says so instead of failing the run', () => {
    const f = faktenpaket(repo(), 'o/r', () => ({ code: 1, stdout: '', stderr: 'HTTP 502' }), []);
    expect(f).toContain('## Zuletzt angedockt (höchstens 15 PRs)\n(nicht lesbar)');
    expect(f).toContain('(keine, oder keine im Repository)');
  });

  it('finds repository paths in a text, not URLs or words', () => {
    expect(genannteDateien('In `flotte/src/treiber/treiber.ts` und ./docs/adr/0001-x.md, nicht https://x.org/a/b.html oder Version 1.2')).toEqual(['flotte/src/treiber/treiber.ts', 'docs/adr/0001-x.md']);
  });

  it('counts every tool call of a run from its stream', () => {
    const a = new Auswertung();
    a.zeile(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'lese' }, { type: 'tool_use', name: 'Read', input: {} }, { type: 'tool_use', name: 'Grep', input: {} }] } }));
    a.zeile(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Glob', input: {} }] } }));
    // the answer through the schema is no file access
    a.zeile(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: {} }] } }));
    a.zeile(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }));
    expect(a.ergebnis(0, false, 10, '').zugriffe).toBe(3);
  });
});

describe('#167 Triage-Lauf mit Faktenpaket und Grenze', () => {
  const welt = (r: string, gestartet: Start[]) => ({
    aufrufer: (_p: string, args: string[]) => {
      if (args[0] === 'issue' && args[1] === 'list' && args.includes('needs-triage')) return { code: 0, stdout: JSON.stringify([{ number: 5, title: 'Port', body: 'In src/port.ts', url: 'u', labels: [{ name: 'needs-triage' }], comments: [] }]), stderr: '' };
      if (args[0] === 'api' && args.includes('.author_association')) return { code: 0, stdout: 'OWNER\n', stderr: '' };
      if (args[0] === 'issue' && args[1] === 'list') return { code: 0, stdout: '[]', stderr: '' };
      return merges(_p, args);
    },
    starte: async (s: Start): Promise<LaufErgebnis> => {
      gestartet.push(s);
      return { code: 0, sitzung: 's', dauerMs: 42_000, strukturiert: null, zugriffe: 4 } as unknown as LaufErgebnis;
    },
    r,
  });

  it('the order of the cut plan carries the facts and the limit; --max-turns goes to the call; the run reports duration and accesses', async () => {
    const r = repo();
    const gestartet: Start[] = [];
    const w = welt(r, gestartet);
    const e = await triagiere({ ziele: [{ repo: r, forge: 'o/r', regeln: REGELN }], konto: 'k', modell: 'opus', trocken: true, lesenMax: 5 }, w);
    expect(gestartet).toHaveLength(1);
    const s = gestartet[0];
    expect(s.auftrag).toContain('höchstens 5 Dateizugriffe (Read, Grep, Glob) in diesem Aufruf');
    expect(s.auftrag).toContain('# Fakten (vom Programm gelesen)');
    expect(s.auftrag).toContain('- ADR-0001 — Erste Entscheidung (Entschieden; docs/adr/0001-erste.md)');
    expect(s.auftrag).toContain('### src/port.ts (genannt in #5)');
    expect(s.extraArgs!.slice(-2)).toEqual(['--max-turns', '8']);
    expect(e.messung).toEqual({ aufrufe: 1, dauerMs: 42_000, zugriffe: 4 });
  });

  it('without a setting the limit is LESEN_MAX', async () => {
    const gestartet: Start[] = [];
    await triagiere({ ziele: [{ repo: repo(), forge: 'o/r', regeln: REGELN }], konto: 'k', modell: 'opus', trocken: true }, welt('', gestartet));
    expect(gestartet[0].auftrag).toContain(`höchstens ${LESEN_MAX} Dateizugriffe`);
    expect(gestartet[0].extraArgs!.slice(-2)).toEqual(['--max-turns', String(LESEN_MAX + 3)]);
  });
});
