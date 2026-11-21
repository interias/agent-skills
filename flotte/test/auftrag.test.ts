// The order writer (#72): the shared cases against the in-memory forge and against the GitHub layer
// over a stand-in for gh; the draft reader, the section check, the adapter keys and the command.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Aufrufer, Ergebnis } from '../src/aufruf.ts';
import { abschnittInhalt, auftragAusfuehren, entwurfLesen, missionBody, pruefen } from '../src/auftrag/auftrag.ts';
import { githubForge } from '../src/auftrag/github.ts';
import { auftrag, regelnAus } from '../src/befehle/auftrag.ts';
import { auftragFaelle, ENTWURF_DREI, ENTWURF_EINZELN, ENTWURF_LUECKE, type IssueStand, REGELN, speicherForge } from './auftrag-faelle.ts';

/** A stand-in for gh with the few calls the GitHub layer makes; an unknown label fails like on GitHub. */
function ghAttrappe(repo = 'o/r') {
  const issues: IssueStand[] = [];
  const labels = new Set<string>();
  const aufrufe: string[][] = [];
  const ok = (stdout = ''): Ergebnis => ({ code: 0, stdout, stderr: '' });
  const nein = (stderr: string): Ergebnis => ({ code: 1, stdout: '', stderr });
  const wert = (args: string[], name: string) => args[args.indexOf(name) + 1];
  const aufrufer: Aufrufer = (programm, args, o) => {
    aufrufe.push([programm, ...args]);
    if (programm === 'git') return ok(`https://github.com/${repo}.git\n`);
    if (args[0] === 'label' && args[1] === 'create') {
      if (labels.has(args[2])) return nein(`label with name "${args[2]}" already exists`);
      labels.add(args[2]);
      return ok();
    }
    if (args[0] === 'issue' && args[1] === 'create') {
      const ls = args.flatMap((x, i) => (x === '--label' ? [args[i + 1]] : []));
      const fehlt = ls.find((l) => !labels.has(l));
      if (fehlt) return nein(`could not add label: '${fehlt}' not found`);
      const nummer = issues.length + 1;
      issues.push({ nummer, titel: wert(args, '--title'), body: o?.eingabe ?? '', labels: ls, verknuepft: [] });
      return ok(`Creating issue in ${repo}\n\nhttps://github.com/${repo}/issues/${nummer}\n`);
    }
    if (args[0] === 'issue' && args[1] === 'edit') {
      issues[Number(args[2]) - 1].body = o?.eingabe ?? '';
      return ok();
    }
    if (args[0] === 'api' && args[2] === '--jq') return ok(`${1000 + Number(args[1].split('/').pop())}\n`);
    if (args[0] === 'api' && wert(args, '--method') === 'POST') {
      const mission = Number(/issues\/(\d+)\/sub_issues$/.exec(args[3])![1]);
      issues[mission - 1].verknuepft.push(Number(wert(args, '-F').split('=')[1]) - 1000);
      return ok('{}');
    }
    return nein(`unerwartet: ${args.join(' ')}`);
  };
  return { aufrufer, aufrufe, issues: async () => issues.map((i) => ({ ...i, verknuepft: [...i.verknuepft] })) };
}

describe('auftrag: shared cases, in-memory forge', () => {
  auftragFaelle(() => speicherForge());
});

describe('auftrag: shared cases, GitHub layer over a gh stand-in', () => {
  auftragFaelle(() => {
    const gh = ghAttrappe();
    return { forge: githubForge(gh.aufrufer, 'o/r'), issues: gh.issues };
  });

  it('calls gh as the forge reference says: labels once, body on stdin, sub-issue by database id', async () => {
    const gh = ghAttrappe();
    await auftragAusfuehren(ENTWURF_DREI, REGELN, githubForge(gh.aufrufer, 'o/r'), { starten: false, trocken: false });
    const z = gh.aufrufe.map((a) => a.slice(1).join(' '));
    expect(z.filter((x) => x.startsWith('label create'))).toEqual([
      'label create epic --repo o/r --color ff2bd6 --description Epic: wartet auf seine Kinder (gesetzt von /epic, gelesen von KIBO)',
      'label create needs-triage --repo o/r',
    ]);
    expect(z).toContain('issue create --repo o/r --title Probe des Auftragsschreibers --label epic --label needs-triage --body-file -');
    expect(z).toContain('api repos/o/r/issues/2 --jq .id');
    expect(z).toContain('api --method POST repos/o/r/issues/1/sub_issues -F sub_issue_id=1002');
    expect(z[z.length - 1]).toBe('issue edit 1 --repo o/r --body-file -');
  });

  it('a draft with a gap calls gh not once, not even for a label', async () => {
    const gh = ghAttrappe();
    await expect(auftragAusfuehren(ENTWURF_LUECKE, REGELN, githubForge(gh.aufrufer, 'o/r'), { starten: true, trocken: false })).rejects.toThrow(/Nichts angelegt/);
    expect(gh.aufrufe).toEqual([]);
  });
});

describe('auftrag: building blocks', () => {
  it('reads mission and Missionsziele, ignoring headings inside code fences', () => {
    const e = entwurfLesen('# Mission: M\n\nText\n\n```\n# Missionsziel: kein Ziel\n```\n\n# Missionsziel: A\n## Was\nx\n');
    expect(e.mission).toEqual({ titel: 'M', text: 'Text\n\n```\n# Missionsziel: kein Ziel\n```' });
    expect(e.ziele).toEqual([{ titel: 'A', text: '## Was\nx' }]);
  });

  it('rejects drafts of the wrong shape with every reason at once', () => {
    expect(() => entwurfLesen('')).toThrow(/Keine Überschrift/);
    expect(() => entwurfLesen('vorweg\n# Mission: M\n')).toThrow(/Text vor der ersten Überschrift[\s\S]*kein Missionsziel/);
    expect(() => entwurfLesen('# Missionsziel: A\n# Missionsziel: B\n')).toThrow(/Mehrere Missionsziele ohne/);
    expect(() => entwurfLesen('# Missionsziel: A\n# Mission: M\n')).toThrow(/nicht am Anfang/);
    expect(() => entwurfLesen('# Missionsziel:\n')).toThrow(/ohne Titel/);
    expect(() => entwurfLesen('# Mission: M\n# Missionsziel: A\nx\n# Missionziel: B\ny\n')).toThrow(/weder `# Mission:` noch `# Missionsziel:`: # Missionziel: B/);
  });

  it('a section ends at the next heading of its level; deeper headings belong to it', () => {
    const t = '## Abnahmekriterien\n- a\n### Fein\n- b\n## Verifikationsweg\nv\n';
    expect(abschnittInhalt(t, '## Abnahmekriterien')).toBe('- a\n### Fein\n- b');
    expect(abschnittInhalt(t, '## Betroffene Module')).toBeNull();
  });

  it('acceptance: any of the defaults counts; an empty section counts as missing; modules only give a note', () => {
    const ziel = (text: string) => ({ mission: null, ziele: [{ titel: 'Z', text }] });
    expect(pruefen(ziel('## Acceptance criteria\n- a\n## Verifikationsweg\nv'), REGELN)).toEqual([expect.stringContaining('ohne `## Betroffene Module`')]);
    expect(() => pruefen(ziel('## Abnahmekriterien\n\n## Verifikationsweg\nv'), REGELN)).toThrow(/`## Abnahmekriterien` oder `## Akzeptanzkriterien` oder `## Acceptance criteria` fehlt/);
    expect(() => pruefen(ziel('## Abnahmekriterien\n- a'), REGELN)).toThrow(/`## Verifikationsweg` fehlt/);
    expect(pruefen(ziel('## Abnahmekriterien\n- a\n## Verifikationsweg\nv\n## Betroffene Module\n- x'), REGELN)).toEqual([]);
  });

  it('keeps an order line of the draft instead of adding the standard one', () => {
    const b = missionBody({ titel: 'M', text: 'Text\n\n> **Reihenfolge:** nach #9' }, [{ titel: 'A', nummer: 3 }]);
    expect(b).toBe('Text\n\n> **Reihenfolge:** nach #9\n\n## Missionsziele\n- [ ] #3 A\n');
  });

  it('adapter keys with their defaults, a single or listed acceptance section', () => {
    expect(regelnAus('')).toEqual(REGELN);
    const r = regelnAus('---\nready_label: los\nepic_label: type/epic\nacceptance_section: "## Abnahme"\nverification_section: ## Prüfung\nmodules_section: ## Module\n---\n');
    expect(r).toEqual({ epic_label: 'type/epic', ready_label: 'los', acceptance_section: ['## Abnahme'], verification_section: '## Prüfung', modules_section: '## Module' });
    expect(regelnAus('---\nacceptance_section: ["## A", "## B"]\n---\n').acceptance_section).toEqual(['## A', '## B']);
  });

  it('a forge failure midway names what already exists', async () => {
    const s = speicherForge();
    let n = 0;
    const forge = { ...s.forge, anlegen: (i: Parameters<typeof s.forge.anlegen>[0]) => (++n === 3 ? Promise.reject(new Error('API weg')) : s.forge.anlegen(i)) };
    await expect(auftragAusfuehren(ENTWURF_DREI, REGELN, forge, { starten: false, trocken: false })).rejects.toThrow(
      /Missionsziel „Datei `probe\/b\.md` anlegen“ anlegen gescheitert: API weg\nSchon angelegt: https:\/\/forge\.test\/o\/r\/issues\/101, https:\/\/forge\.test\/o\/r\/issues\/102/,
    );
  });
});

describe('flotte auftrag', () => {
  const ordner = (adapter: string | null) => {
    const dir = mkdtempSync(join(tmpdir(), 'flotte-auftrag-'));
    if (adapter !== null) {
      mkdirSync(join(dir, '.claude'));
      writeFileSync(join(dir, '.claude', 'epic.md'), adapter);
    }
    writeFileSync(join(dir, 'entwurf.md'), ENTWURF_DREI);
    writeFileSync(join(dir, 'einzeln.md'), ENTWURF_EINZELN);
    return dir;
  };

  it('reads repository and labels from the adapter and prints the links', async () => {
    const dir = ordner('---\nforge: github\napi: https://api.github.com/repos/acme/ziel\nready_label: los\n---\n');
    const gh = ghAttrappe('acme/ziel');
    const r = (await auftrag([dir, join(dir, 'entwurf.md'), '--starten'], gh.aufrufer)) as any;
    expect(r.forge).toBe('acme/ziel');
    expect(r.mission).toEqual({ nummer: 1, url: 'https://github.com/acme/ziel/issues/1', titel: 'Probe des Auftragsschreibers' });
    expect(r.ziele.map((z: any) => z.url)).toEqual([2, 3, 4].map((n) => `https://github.com/acme/ziel/issues/${n}`));
    expect(r.labels).toEqual({ mission: ['epic', 'los'], ziele: ['los'] });
    expect(gh.aufrufe.filter((a) => a[0] === 'gh').every((a) => a.join(' ').includes('acme/ziel'))).toBe(true);
  });

  it('without adapter: the GitHub repository of origin; --trocken calls no gh', async () => {
    const dir = ordner(null);
    const gh = ghAttrappe('acme/ohne');
    const r = (await auftrag([dir, join(dir, 'einzeln.md'), '--trocken'], gh.aufrufer)) as any;
    expect(r).toMatchObject({ forge: 'acme/ohne', trocken: true, mission: null, ziele: [{ titel: 'Einzelnes Ziel', labels: ['needs-triage'] }] });
    expect(gh.aufrufe.map((a) => a[0])).toEqual(['git']);
  });

  it('refuses another forge and a wrong call', async () => {
    const dir = ordner('---\nforge: gitea\n---\n');
    await expect(auftrag([dir, join(dir, 'entwurf.md')], ghAttrappe().aufrufer)).rejects.toThrow(/Forge gitea/);
    await expect(auftrag([dir], ghAttrappe().aufrufer)).rejects.toThrow(/Aufruf: flotte auftrag/);
    await expect(auftrag([dir, join(dir, 'entwurf.md'), '--start'], ghAttrappe().aufrufer)).rejects.toThrow(/Aufruf: flotte auftrag/);
    await expect(auftrag([dir, join(dir, 'fehlt.md')], ghAttrappe().aufrufer)).rejects.toThrow(/Entwurf fehlt/);
  });
});
