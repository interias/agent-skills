// Stand-ins for both forges of the driver's forge layer (#127): one forge state in memory (Bestand), read and
// written once through `gh` (as src/forge/github.ts calls it) and once through curl against the Gitea API (as
// src/forge/gitea.ts calls it). test/forge-faelle.ts runs the same cases against both.

import type { Aufrufer, Ergebnis } from '../src/aufruf.ts';
import { curlLesen } from '../src/forge/curl.ts';

export interface BIssue {
  nummer: number;
  titel: string;
  body: string;
  labels: string[];
  offen: boolean;
  autor: string;
  kommentare: { body: string; autor: string }[];
  /** Missionsziele (GitHub sub-issues, Gitea dependencies of the mission) */
  kinder: number[];
  /** every label ever put on */
  gesetzt: string[];
}

export interface BPr {
  nummer: number;
  titel: string;
  body: string;
  kopf: string;
  basis: string;
  zustand: 'OPEN' | 'CLOSED' | 'MERGED';
}

export interface Bestand {
  owner: string;
  name: string;
  issues: BIssue[];
  prs: BPr[];
  labels: string[];
  /** branch → commits ahead of the default branch */
  zweige: Record<string, number>;
  standard: string;
  /** logins with write access besides the owner */
  mitarbeiter: string[];
  /** every call: program and arguments */
  aufrufe: string[][];
}

export function bestand(): Bestand {
  return { owner: 'o', name: 'r', issues: [], prs: [], labels: [], zweige: { main: 0 }, standard: 'main', mitarbeiter: [], aufrufe: [] };
}

const naechste = (b: Bestand) => Math.max(0, ...b.issues.map((i) => i.nummer), ...b.prs.map((p) => p.nummer)) + 1;

export function issueAnlegen(b: Bestand, x: Partial<BIssue> & { titel: string }): BIssue {
  const i: BIssue = { nummer: naechste(b), body: '', labels: [], offen: true, autor: b.owner, kommentare: [], kinder: [], gesetzt: [...(x.labels ?? [])], ...x };
  for (const l of i.labels) if (!b.labels.includes(l)) b.labels.push(l);
  b.issues.push(i);
  return i;
}

const ok = (stdout: unknown): Ergebnis => ({ code: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' });
const nein = (text: string): Ergebnis => ({ code: 1, stdout: '', stderr: text });
const rolleVon = (b: Bestand, login: string) => (login === b.owner ? 'OWNER' : b.mitarbeiter.includes(login) ? 'COLLABORATOR' : 'NONE');
const elternteil = (b: Bestand, nr: number) => b.issues.find((m) => m.kinder.includes(nr));

/** `gh` as src/forge/github.ts calls it, answered from the Bestand. */
export function ghAttrappe(b: Bestand): Aufrufer {
  const repo = `${b.owner}/${b.name}`;
  return (programm, args, opts = {}) => {
    b.aufrufe.push([programm, ...args]);
    if (programm !== 'gh') return nein(`${programm} unbekannt`);
    const nach = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
    const alleNach = (n: string) => args.flatMap((x, i) => (x === n ? [args[i + 1]] : []));
    if (args.includes('--repo') && nach('--repo') !== repo) return nein('falsches Repository');
    const [a, c] = args;
    const issue = (n: string | undefined) => b.issues.find((i) => i.nummer === Number(n));
    const ghIssue = (i: BIssue) => ({
      number: i.nummer,
      title: i.titel,
      body: i.body,
      url: `https://github.com/${repo}/issues/${i.nummer}`,
      state: i.offen ? 'OPEN' : 'CLOSED',
      labels: i.labels.map((name) => ({ name })),
      closedAt: i.offen ? null : '2026-01-01T00:00:00Z',
      comments: i.kommentare.map((k) => ({ body: k.body, author: { login: k.autor }, createdAt: '2026-01-01T00:00:00Z', authorAssociation: rolleVon(b, k.autor), url: '' })),
    });
    const ghPr = (p: BPr) => ({ number: p.nummer, title: p.titel, body: p.body, url: `https://github.com/${repo}/pull/${p.nummer}`, state: p.zustand, mergeable: 'MERGEABLE', headRefName: p.kopf, baseRefName: p.basis, headRefOid: `sha-${p.kopf}`, createdAt: '2026-01-01T00:00:00Z', mergedAt: p.zustand === 'MERGED' ? '2026-01-02T00:00:00Z' : null });
    if (a === 'issue') {
      const i = issue(c === 'list' || c === 'create' ? undefined : args[2]);
      if (c === 'view') return i ? ok(ghIssue(i)) : nein('Could not resolve to an issue');
      if (c === 'list') return ok(b.issues.filter((x) => x.offen && x.labels.includes(nach('--label')!)).map(ghIssue));
      if (c === 'create') return ok(`https://github.com/${repo}/issues/${issueAnlegen(b, { titel: nach('--title')!, body: opts.eingabe ?? '', labels: alleNach('--label') }).nummer}\n`);
      if (!i) return nein('Could not resolve to an issue');
      if (c === 'comment') i.kommentare.push({ body: opts.eingabe ?? '', autor: b.owner });
      else if (c === 'close') {
        if (nach('--comment') !== undefined) i.kommentare.push({ body: nach('--comment')!, autor: b.owner });
        i.offen = false;
      } else if (c === 'reopen') i.offen = true;
      else if (c === 'edit') {
        if (args.includes('--body-file')) i.body = opts.eingabe ?? '';
        for (const l of (nach('--add-label') ?? '').split(',').filter(Boolean)) {
          if (!b.labels.includes(l)) return nein(`'${l}' not found`);
          if (!i.labels.includes(l)) i.labels.push(l);
          i.gesetzt.push(l);
        }
        const weg = (nach('--remove-label') ?? '').split(',').filter(Boolean);
        i.labels = i.labels.filter((l) => !weg.includes(l));
      } else return nein(`gh issue ${c} unbekannt`);
      return ok('');
    }
    if (a === 'label') {
      if (c === 'list') return ok(b.labels.map((name) => ({ name })));
      if (c === 'create') {
        if (b.labels.includes(args[2])) return nein('already exists');
        b.labels.push(args[2]);
        return ok('');
      }
    }
    if (a === 'pr') {
      const p = b.prs.find((x) => x.nummer === Number(args[2]));
      if (c === 'view') return p ? ok(ghPr(p)) : nein('no pull requests found');
      if (c === 'list') {
        const zustand = nach('--state');
        const liste = b.prs.filter((x) => (!nach('--head') || x.kopf === nach('--head')) && (zustand === 'all' || x.zustand === zustand!.toUpperCase())).reverse();
        return ok(liste.slice(0, Number(nach('--limit') ?? 30)).map(ghPr));
      }
      if (c === 'create') {
        const neu: BPr = { nummer: naechste(b), titel: nach('--title')!, body: opts.eingabe ?? '', kopf: nach('--head')!, basis: nach('--base')!, zustand: 'OPEN' };
        b.prs.push(neu);
        return ok(`https://github.com/${repo}/pull/${neu.nummer}\n`);
      }
      if (c === 'edit' && p) {
        p.body = opts.eingabe ?? '';
        return ok('');
      }
    }
    if (a === 'repo' && c === 'view') return ok(`${b.standard}\n`);
    if (a === 'api') {
      const pfad = args.find((x) => x.startsWith(`repos/${repo}`))!.slice(`repos/${repo}`.length);
      const jq = nach('--jq');
      let m: RegExpExecArray | null;
      if ((m = /^\/issues\/(\d+)\/sub_issues$/.exec(pfad))) return ok(issue(m[1])!.kinder.map((k) => issue(String(k))!).map((k) => `${JSON.stringify({ number: k.nummer, state: k.offen ? 'open' : 'closed', labels: k.labels })}\n`).join(''));
      if ((m = /^\/issues\/(\d+)\/sub_issue$/.exec(pfad)) && nach('--method') === 'DELETE') {
        const mission = issue(m[1])!;
        const kind = Number(nach('-F')!.split('=')[1]) - 1000;
        if (!mission.kinder.includes(kind)) return nein('not a sub-issue');
        mission.kinder = mission.kinder.filter((k) => k !== kind);
        return ok('');
      }
      if ((m = /^\/issues\/(\d+)\/events$/.exec(pfad))) {
        const label = JSON.parse(/\.label\.name == ("(?:[^"\\]|\\.)*")/.exec(jq!)![1]);
        return ok(issue(m[1])!.gesetzt.filter((l) => l === label).map((_, i) => `${i + 1}\n`).join(''));
      }
      if ((m = /^\/issues\/(\d+)$/.exec(pfad))) {
        const i = issue(m[1]);
        if (!i) return nein('Not Found');
        if (jq === '.id') return ok(`${1000 + i.nummer}\n`);
        if (jq === '.author_association') return ok(`${rolleVon(b, i.autor)}\n`);
        if (jq === '.parent_issue_url') {
          const e = elternteil(b, i.nummer);
          return ok(e ? `https://api.github.com/repos/${repo}/issues/${e.nummer}\n` : '\n');
        }
      }
      if (pfad === '/branches') return ok(Object.keys(b.zweige).map((z) => `${z}\n`).join(''));
      if ((m = /^\/compare\/([^.]+)\.\.\.(.+)$/.exec(pfad))) return ok(`${b.zweige[decodeURIComponent(m[2])] ?? 0}\n`);
    }
    return nein(`gh-Attrappe kennt ${args.join(' ')} nicht`);
  };
}

/** curl against the Gitea API as src/forge/gitea.ts calls it, answered from the Bestand. */
export function giteaAttrappe(b: Bestand, token = 'token geheim'): Aufrufer {
  const basis = `http://gitea.invalid/api/v1/repos/${b.owner}/${b.name}`;
  const web = `http://gitea.invalid/${b.owner}/${b.name}`;
  let labelId = 0;
  const ids = new Map<string, number>();
  const idVon = (l: string) => (ids.has(l) ? ids.get(l)! : (ids.set(l, ++labelId), labelId));
  const labelAus = (l: string) => ({ id: idVon(l), name: l });
  const giteaIssue = (i: BIssue) => ({ number: i.nummer, title: i.titel, body: i.body, html_url: `${web}/issues/${i.nummer}`, state: i.offen ? 'open' : 'closed', labels: i.labels.map(labelAus), closed_at: i.offen ? null : '2026-01-01T00:00:00Z', user: { login: i.autor } });
  const giteaPr = (p: BPr) => ({ number: p.nummer, title: p.titel, body: p.body, html_url: `${web}/pulls/${p.nummer}`, state: p.zustand === 'OPEN' ? 'open' : 'closed', merged: p.zustand === 'MERGED', mergeable: true, head: { ref: p.kopf, sha: `sha-${p.kopf}` }, base: { ref: p.basis }, created_at: '2026-01-01T00:00:00Z', merged_at: p.zustand === 'MERGED' ? '2026-01-02T00:00:00Z' : null });
  const antwort = (status: number, wert?: unknown): Ergebnis => ({ code: 0, stdout: `${wert === undefined ? '' : JSON.stringify(wert)}\n${status}`, stderr: '' });
  /** a list with Gitea's paging: at most limit (capped at 50) from page */
  const seite = (q: URLSearchParams, liste: unknown[]) => {
    const limit = Math.min(50, Number(q.get('limit') ?? 50));
    const s = Number(q.get('page') ?? 1);
    return antwort(200, liste.slice((s - 1) * limit, s * limit));
  };
  return (programm, args, opts = {}) => {
    b.aufrufe.push([programm, ...args]);
    if (programm !== 'curl' || !args.includes('--config')) return { code: 1, stdout: '', stderr: `${programm} unbekannt` };
    const x = curlLesen(opts.eingabe ?? '');
    if (x.kopf !== token) return antwort(404, { message: 'not found' });
    const u = new URL(x.url);
    if (!u.pathname.startsWith(new URL(basis).pathname)) return antwort(404);
    const pfad = u.pathname.slice(new URL(basis).pathname.length);
    const q = u.searchParams;
    const body = (x.body ?? {}) as any;
    const issue = (n: string) => b.issues.find((i) => i.nummer === Number(n));
    let m: RegExpExecArray | null;
    if (pfad === '' && x.methode === 'GET') return antwort(200, { default_branch: b.standard, permissions: { push: true } });
    if (pfad === '/labels') {
      if (x.methode === 'GET') return seite(q, b.labels.map(labelAus));
      if (b.labels.includes(body.name)) return antwort(409);
      b.labels.push(body.name);
      return antwort(201, labelAus(body.name));
    }
    if (pfad === '/issues' && x.methode === 'GET') return seite(q, b.issues.filter((i) => (q.get('state') !== 'open' || i.offen) && (!q.get('labels') || i.labels.includes(q.get('labels')!))).map(giteaIssue));
    if (pfad === '/issues' && x.methode === 'POST') {
      const namen = (body.labels as number[]).map((id) => [...ids].find(([, v]) => v === id)![0]);
      return antwort(201, giteaIssue(issueAnlegen(b, { titel: body.title, body: body.body, labels: namen })));
    }
    if ((m = /^\/issues\/(\d+)$/.exec(pfad))) {
      const i = issue(m[1]);
      if (!i) return antwort(404);
      if (x.methode === 'PATCH') {
        if (body.body !== undefined) i.body = body.body;
        if (body.state === 'closed') {
          if (i.kinder.some((k) => issue(String(k))!.offen)) return antwort(412, { message: 'cannot close: open dependencies' });
          i.offen = false;
        }
        if (body.state === 'open') i.offen = true;
      }
      return antwort(x.methode === 'PATCH' ? 201 : 200, giteaIssue(i));
    }
    if ((m = /^\/issues\/(\d+)\/comments$/.exec(pfad))) {
      const i = issue(m[1])!;
      if (x.methode === 'POST') {
        i.kommentare.push({ body: body.body, autor: b.owner });
        return antwort(201, {});
      }
      return seite(q, i.kommentare.map((k, n) => ({ body: k.body, user: { login: k.autor }, created_at: '2026-01-01T00:00:00Z', html_url: `${web}/issues/${i.nummer}#c${n}` })));
    }
    if ((m = /^\/issues\/(\d+)\/labels$/.exec(pfad)) && x.methode === 'POST') {
      const i = issue(m[1])!;
      for (const id of body.labels as number[]) {
        const l = [...ids].find(([, v]) => v === id)?.[0];
        if (!l || !b.labels.includes(l)) return antwort(422);
        if (!i.labels.includes(l)) i.labels.push(l);
        i.gesetzt.push(l);
      }
      return antwort(200, i.labels.map(labelAus));
    }
    if ((m = /^\/issues\/(\d+)\/labels\/(\d+)$/.exec(pfad)) && x.methode === 'DELETE') {
      const i = issue(m[1])!;
      i.labels = i.labels.filter((l) => idVon(l) !== Number(m![2]));
      return antwort(204);
    }
    if ((m = /^\/issues\/(\d+)\/dependencies$/.exec(pfad))) {
      const i = issue(m[1])!;
      if (x.methode === 'DELETE') {
        i.kinder = i.kinder.filter((k) => k !== body.index);
        return antwort(200, {});
      }
      return seite(q, i.kinder.map((k) => giteaIssue(issue(String(k))!)));
    }
    if ((m = /^\/issues\/(\d+)\/blocks$/.exec(pfad))) return seite(q, b.issues.filter((e) => e.kinder.includes(Number(m![1]))).map(giteaIssue));
    if ((m = /^\/issues\/(\d+)\/timeline$/.exec(pfad))) return seite(q, issue(m[1])!.gesetzt.map((l) => ({ type: 'label', body: '1', label: labelAus(l) })));
    if ((m = /^\/collaborators\/([^/]+)\/permission$/.exec(pfad))) {
      const login = decodeURIComponent(m[1]);
      return b.mitarbeiter.includes(login) ? antwort(200, { permission: 'write' }) : antwort(404);
    }
    if (pfad === '/pulls' && x.methode === 'GET') {
      const z = q.get('state');
      return seite(q, b.prs.filter((p) => z === 'all' || (z === 'open') === (p.zustand === 'OPEN')).reverse().map(giteaPr));
    }
    if (pfad === '/pulls' && x.methode === 'POST') {
      const neu: BPr = { nummer: naechste(b), titel: body.title, body: body.body, kopf: body.head, basis: body.base, zustand: 'OPEN' };
      b.prs.push(neu);
      return antwort(201, giteaPr(neu));
    }
    if ((m = /^\/pulls\/(\d+)$/.exec(pfad))) {
      const p = b.prs.find((y) => y.nummer === Number(m![1]));
      if (!p) return antwort(404);
      if (x.methode === 'PATCH') p.body = body.body;
      return antwort(200, giteaPr(p));
    }
    if (pfad === '/branches') return seite(q, Object.keys(b.zweige).map((name) => ({ name })));
    if ((m = /^\/compare\/(.+)\.\.\.(.+)$/.exec(pfad))) return antwort(200, { total_commits: b.zweige[decodeURIComponent(m[2])] ?? 0 });
    return antwort(404, { message: `Gitea-Attrappe kennt ${x.methode} ${pfad} nicht` });
  };
}

export const GITEA_API = (b: Bestand) => `http://gitea.invalid/api/v1/repos/${b.owner}/${b.name}`;
