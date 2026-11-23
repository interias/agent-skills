// The order writer (#72): the shared cases against the in-memory forge and against the GitHub layer
// over a stand-in for gh; the draft reader, the section check, the adapter keys and the command.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Aufrufer, Ergebnis } from '../src/aufruf.ts';
import { abschnittInhalt, auftragAusfuehren, entwurfLesen, missionBody, pruefen } from '../src/auftrag/auftrag.ts';
import { giteaForge } from '../src/auftrag/gitea.ts';
import { githubForge } from '../src/auftrag/github.ts';
import { auftrag, giteaZugang, regelnAus } from '../src/befehle/auftrag.ts';
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
    return { forge: githubForge(gh.aufrufer, 'o/r', REGELN), issues: gh.issues };
  });

  it('calls gh as the forge reference says: labels once, body on stdin, sub-issue by database id', async () => {
    const gh = ghAttrappe();
    await auftragAusfuehren(ENTWURF_DREI, REGELN, githubForge(gh.aufrufer, 'o/r', REGELN), { starten: false, trocken: false });
    const z = gh.aufrufe.map((a) => a.slice(1).join(' '));
    expect(z.filter((x) => x.startsWith('label create'))).toEqual([
      'label create epic --repo o/r --color ff2bd6 --description Mission: wartet auf ihre Missionsziele (gesetzt von /mission, gelesen von KIBO)',
      'label create needs-triage --repo o/r',
    ]);
    expect(z).toContain('issue create --repo o/r --title Probe des Auftragsschreibers --label epic --label needs-triage --body-file -');
    expect(z).toContain('api repos/o/r/issues/2 --jq .id');
    expect(z).toContain('api --method POST repos/o/r/issues/1/sub_issues -F sub_issue_id=1002');
    expect(z[z.length - 1]).toBe('issue edit 1 --repo o/r --body-file -');
  });

  it('a draft with a gap calls gh not once, not even for a label', async () => {
    const gh = ghAttrappe();
    await expect(auftragAusfuehren(ENTWURF_LUECKE, REGELN, githubForge(gh.aufrufer, 'o/r', REGELN), { starten: true, trocken: false })).rejects.toThrow(/Nichts angelegt/);
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
    const dir = ordner('---\nforge: gitlab\n---\n');
    await expect(auftrag([dir, join(dir, 'entwurf.md')], ghAttrappe().aufrufer)).rejects.toThrow(/Forge gitlab: flotte auftrag spricht nur GitHub und Gitea/);
    await expect(auftrag([dir], ghAttrappe().aufrufer)).rejects.toThrow(/Aufruf: flotte auftrag/);
    await expect(auftrag([dir, join(dir, 'entwurf.md'), '--start'], ghAttrappe().aufrufer)).rejects.toThrow(/Aufruf: flotte auftrag/);
    await expect(auftrag([dir, join(dir, 'fehlt.md')], ghAttrappe().aufrufer)).rejects.toThrow(/Entwurf fehlt/);
  });
});

describe('Gitea layer without a server', () => {
  const GITEA = '---\nforge: gitea\napi: http://gitea.test:3003/api/v1/repos/acme/ziel\ntoken_env: FLOTTE_TEST_KEIN_TOKEN\n---\n';
  const ordner = (adapter: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'flotte-auftrag-'));
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'epic.md'), adapter);
    writeFileSync(join(dir, 'einzeln.md'), ENTWURF_EINZELN);
    return dir;
  };

  it('--trocken names owner/name from api and asks for no login', async () => {
    const dir = ordner(GITEA);
    const aufrufe: string[] = [];
    const r = (await auftrag([dir, join(dir, 'einzeln.md'), '--trocken'], (p) => (aufrufe.push(p), { code: 1, stdout: '', stderr: '' }))) as any;
    expect(r).toMatchObject({ forge: 'acme/ziel', trocken: true, mission: null });
    expect(aufrufe).toEqual([]);
  });

  it('a Gitea adapter without api is refused', async () => {
    const dir = ordner('---\nforge: gitea\n---\n');
    await expect(auftrag([dir, join(dir, 'einzeln.md'), '--trocken'], ghAttrappe().aufrufer)).rejects.toThrow(/Forge gitea: der Adapter braucht `api/);
  });

  it('login: token from token_env, else Basic Auth from the Git credential store, else an error without secrets', () => {
    const nie: Aufrufer = () => {
      throw new Error('kein Aufruf erwartet');
    };
    process.env.FLOTTE_TEST_KEIN_TOKEN = 'geheim';
    try {
      expect(giteaZugang(GITEA, '.', nie)).toBe('token geheim');
    } finally {
      delete process.env.FLOTTE_TEST_KEIN_TOKEN;
    }
    const dir = mkdtempSync(join(tmpdir(), 'flotte-token-'));
    writeFileSync(join(dir, '.env'), 'ANDERE=1\r\nFLOTTE_TEST_KEIN_TOKEN="aus-datei"\r\n');
    expect(giteaZugang(GITEA.replace('\n---\n', '\ntoken_file: .env\n---\n'), dir, nie)).toBe('token aus-datei');
    let eingabe = '';
    const credential: Aufrufer = (p, args, o) => {
      eingabe = o?.eingabe ?? '';
      return { code: 0, stdout: 'protocol=http\nhost=gitea.test:3003\nusername=bot\npassword=pw\n', stderr: '' };
    };
    expect(giteaZugang(GITEA, '.', credential)).toBe(`Basic ${Buffer.from('bot:pw').toString('base64')}`);
    expect(eingabe).toBe('url=http://gitea.test:3003\n\n');
    expect(() => giteaZugang(GITEA, '.', () => ({ code: 1, stdout: '', stderr: 'fatal' }))).toThrow(/weder FLOTTE_TEST_KEIN_TOKEN noch ein Eintrag/);
  });

  it('reads the label list page by page (50 per page) and creates only what is missing', async () => {
    const seiten: string[] = [];
    const posts: any[] = [];
    const abruf = (async (url: string, o: RequestInit) => {
      const pfad = url.replace('http://g.test/api/v1/repos/o/r', '');
      if (o.method === 'GET') {
        seiten.push(pfad);
        const seite = Number(/page=(\d+)/.exec(pfad)![1]);
        const n = seite === 1 ? 50 : 1;
        return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: seite * 100 + i, name: seite === 2 ? 'needs-triage' : `l${i}` }))));
      }
      posts.push([pfad, JSON.parse(o.body as string)]);
      return new Response(JSON.stringify(pfad === '/labels' ? { id: 7 } : { number: 5, html_url: 'http://g.test/o/r/issues/5' }), { status: 201 });
    }) as unknown as typeof fetch;
    const forge = giteaForge('http://g.test/api/v1/repos/o/r/', () => 'token x', REGELN, abruf);
    expect(await forge.anlegen({ titel: 'T', body: 'B', labels: ['epic', 'needs-triage'] })).toEqual({ nummer: 5, url: 'http://g.test/o/r/issues/5' });
    expect(seiten).toEqual(['/labels?limit=50&page=1', '/labels?limit=50&page=2']);
    expect(posts).toEqual([
      ['/labels', { name: 'epic', color: '#ff2bd6', description: 'Mission: wartet auf ihre Missionsziele (gesetzt von /mission, gelesen von KIBO)' }],
      ['/issues', { title: 'T', body: 'B', labels: [7, 200] }],
    ]);
    await forge.verknuepfen(5, 6);
    expect(posts[2]).toEqual(['/issues/5/dependencies', { owner: 'o', repo: 'r', index: 6 }]);
  });

  it('#157: verknuepft reads the edges of the mission (Gitea) or the parent of the child (GitHub)', async () => {
    const abruf = (async (url: string) => new Response(JSON.stringify(url.includes('/issues/5/dependencies') ? [{ number: 6 }, { number: 9 }] : []))) as unknown as typeof fetch;
    const gitea = giteaForge('http://g.test/api/v1/repos/o/r', () => 'token x', REGELN, abruf);
    expect([await gitea.verknuepft(5, 6), await gitea.verknuepft(5, 7), await gitea.verknuepft(4, 6)]).toEqual([true, false, false]);
    const eltern: Record<string, string> = { '6': 'https://api.github.com/repos/o/r/issues/5', '7': 'null', '8': 'https://api.github.com/repos/o/r/issues/55' };
    const aufrufer: Aufrufer = (_p, args) => ({ code: 0, stdout: `${eltern[args[1].split('/').pop()!]}\n`, stderr: '' });
    const github = githubForge(aufrufer, 'o/r', REGELN);
    expect([await github.verknuepft(5, 6), await github.verknuepft(5, 7), await github.verknuepft(5, 8)]).toEqual([true, false, false]);
  });

  it('an API error is thrown with status, never with the login', async () => {
    const abruf = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const forge = giteaForge('http://g.test/api/v1/repos/o/r', () => 'token geheim', REGELN, abruf);
    await expect(forge.bodySetzen(1, 'x')).rejects.toThrow(/Gitea PATCH \/issues\/1: HTTP 404 nope$/);
  });
});
