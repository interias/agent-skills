import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { messeEinsatz, type Konfiguration } from '../src/befehle/messen.ts';
import type { Aufrufer } from '../src/aufruf.ts';
import { min, mensch, nachricht, assistent, ergebnis, frage } from './hilfen.ts';

function konto(): string {
  return mkdtempSync(join(tmpdir(), 'flotte-messen-'));
}

function sitzung(kontoDir: string, ordner: string, id: string, zeilen: string[]): string {
  const dir = join(kontoDir, 'projects', ordner);
  mkdirSync(dir, { recursive: true });
  const datei = join(dir, `${id}.jsonl`);
  writeFileSync(datei, zeilen.join('\n'));
  return datei;
}

function subagent(kontoDir: string, ordner: string, id: string, agent: string, agentType: string, zeilen: string[]) {
  const dir = join(kontoDir, 'projects', ordner, id, 'subagents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-${agent}.jsonl`), zeilen.join('\n'));
  writeFileSync(join(dir, `agent-${agent}.meta.json`), JSON.stringify({ agentType, description: 'Lauf #1' }));
}

const aufrufe: string[][] = [];
const stub: Aufrufer = (programm, args) => {
  aufrufe.push([programm, ...args]);
  const a = args.join(' ');
  if (programm === 'gh' && a.startsWith('pr list')) return { code: 0, stdout: JSON.stringify([{ number: 10, createdAt: min(20), mergedAt: min(80) }]), stderr: '' };
  if (programm === 'gh' && a === 'api repos/o/korb --jq .default_branch') return { code: 0, stdout: 'main\n', stderr: '' };
  if (programm === 'gh' && a.startsWith('api --paginate')) return { code: 0, stdout: 'main\nepic/1-x\nagent/2-y\n', stderr: '' };
  if (programm === 'gh' && a.includes('compare/main...epic%2F1-x')) return { code: 0, stdout: '3\n', stderr: '' };
  if (programm === 'gh' && a.includes('compare/')) return { code: 0, stdout: '0\n', stderr: '' };
  if (programm === 'pwsh') return { code: 0, stdout: JSON.stringify({ weighted: 900, roles: [{ role: 'host', weighted: 600 }, { role: 'epic-lauf', weighted: 300 }] }), stderr: '' };
  if (programm === 'git') return { code: 0, stdout: 'worktree C:/r\nHEAD x\n\nworktree C:/r-wt/epic-1\nHEAD y\n', stderr: '' };
  if (programm === 'docker') return { code: 0, stdout: 'korb-epic-1-db-1\nkorb-db-1\nfremd\n', stderr: '' };
  return { code: 1, stdout: '', stderr: 'unbekannt' };
};

describe('messeEinsatz', () => {
  it('measures orchestration, runs from folders and subagents, misses, PRs and remains', () => {
    const k1 = konto();
    const k2 = konto();
    sitzung(k1, 'C--r-korb', 'aaaa1111-leitstand', [
      mensch(0, '/leitstand flotte korb'),
      assistent(1, '', { tools: [{ id: 'q', name: 'AskUserQuestion', input: { questions: [frage('Epic #1 Tailnet?', ['Nein (Recommended)', 'Ja'])] } }] }),
      ergebnis(31, 'q', '"Epic #1 Tailnet?"="Nein (Recommended)"'),
    ]);
    sitzung(k2, 'C--r-korb', 'bbbb2222-admiral', [mensch(0, '/epic-flotte'), assistent(1, 'los')]);
    subagent(k2, 'C--r-korb', 'bbbb2222-admiral', 'x1', 'epic-lauf', [mensch(2, 'Lauf #1'), assistent(3, 'FLOTTE-FRAGE 1 tor', { stop: 'end_turn' }), nachricht(43), assistent(44, 'weiter')]);
    subagent(k2, 'C--r-korb', 'bbbb2222-admiral', 'x2', 'epic-implementer-standard', [mensch(2, 'Paket'), assistent(3, 'fertig', { stop: 'end_turn' }), nachricht(100)]);
    sitzung(k1, 'C--r-korb', 'cccc3333-lauf', [mensch(10, 'Background (from the session that started this one): /epic #1'), assistent(11, 'FLOTTE-ENDE 1 https://x/pull/10', { stop: 'end_turn' }), nachricht(26), assistent(27, 'ok')]);
    sitzung(k2, 'C--r-korb', 'dddd4444-leer', [mensch(12, '<system-reminder>hook</system-reminder>')]);
    sitzung(k1, 'C--r-korb', 'eeee5555-fremd', [mensch(13, 'RAM-Upgrade?'), assistent(14, 'x')]);
    sitzung(k1, 'C--r-korb', 'ffff6666-vorher', [mensch(-500, 'alt'), assistent(-499, 'x')]);

    const konf: Konfiguration = {
      konten: { k1, k2 },
      einsaetze: [
        {
          name: 'korb',
          repo: 'o/korb',
          repoPfad: 'C:/r',
          von: min(0),
          bis: min(200),
          epics: [1, 2],
          orchestrierung: [
            { konto: 'k1', id: 'aaaa1111' },
            { konto: 'k2', id: 'bbbb2222' },
          ],
          laeufe: [{ konto: 'k2', id: 'bbbb2222', agentType: 'epic-lauf' }],
          startOrdner: ['C--r-korb'],
          laeufeAusOrdnern: true,
          ausschliessen: ['eeee5555'],
        },
      ],
    };
    const r = messeEinsatz(konf, konf.einsaetze[0], { aufrufer: stub, usageSkript: 'usage.ps1' });

    expect(r.sitzungen).toEqual({ orchestrierung: 2, laeufe: 3 });
    expect(r.rueckfragen).toMatchObject({ anzahl: 1, je_epic: 0.5, empfehlung_gefolgt: { beurteilbar: 1, gefolgt: 1 } });
    expect(r.rueckfragen.verteilung_epics).toEqual({ '#1': { anzahl: 1, wartenMin: 30 } });
    expect(r.wartezeit_min).toMatchObject({ n: 1, summe: 30, je_epic: 15 });
    expect(r.kalte_zeit_min.summe).toBe(55);
    expect(r.fehlstarts).toMatchObject({ starts: 2, fehlstarts: 1, anteil: 0.5 });
    expect(r.fehlstarts.sitzungen[0]).toContain('dddd4444');
    expect(r.pr_bereit_bis_gemergt_min).toMatchObject({ n: 1, summe: 69, geschaetzt: 0 });
    expect(r.orchestrierung).toMatchObject({ weighted: 1200, je_epic: 600 });
    expect(r.reste).toEqual({ worktrees: 1, branches: 1, container: 1, hinweise: [] });
    expect(r.fehler).toEqual([]);
    expect(aufrufe.filter((a) => a[0] === 'pwsh').every((a) => a.includes('-Since') && a.includes('-Until'))).toBe(true);
  });

  it('names a session it cannot find instead of guessing', () => {
    const konf: Konfiguration = {
      konten: { k1: konto() },
      einsaetze: [{ name: 'x', repo: 'o/x', von: min(0), bis: min(10), epics: [], orchestrierung: [{ konto: 'k1', id: 'fehlt' }], laeufe: [] }],
    };
    const r = messeEinsatz(konf, konf.einsaetze[0], { aufrufer: stub, usageSkript: 'u' });
    expect(r.fehler).toContain('Sitzung k1/fehlt nicht gefunden');
  });
});
