// The Gitea side of the driver's forge layer (#127), straight against the API through curl
// (mission/references/forge.md). Its quirks hold here too: lists are capped at 50 per page, labels go by id,
// a Missionsziel is a dependency of its mission (the mission is blocked by it), an issue with open blockers
// cannot be closed (HTTP 412), anonymous calls answer 404.

import type { Aufrufer } from '../aufruf.ts';
import { curl } from './curl.ts';
import type { ForgeZugriff, Issue, Kind, Kommentar, Pr } from './zugriff.ts';

const SEITE = 50;
const LABEL_FARBE_STANDARD = 'ededed';

const zustandAus = (s: unknown): 'OPEN' | 'CLOSED' => (String(s) === 'closed' ? 'CLOSED' : 'OPEN');
const namen = (labels: unknown) => ((labels ?? []) as { name?: string }[]).map((l) => String(l?.name ?? ''));

/**
 * @param api `<host>/api/v1/repos/<owner>/<repo>`
 * @param kopf the Authorization header value, asked for on the first call
 * @param epicLabel a blocker with it is an order edge between missions, no Missionsziel (forge.md, "Abhängigkeiten lesen")
 */
export function giteaZugriff(a: Aufrufer, api: string, kopf: () => string, epicLabel = 'epic'): ForgeZugriff {
  const basis = api.replace(/\/+$/, '');
  const [owner, name] = /\/repos\/([^/]+)\/([^/]+)$/.exec(basis)?.slice(1) ?? [];
  if (!owner) throw new Error(`Gitea-api ohne /repos/<owner>/<repo>: ${basis}`);
  const web = `${new URL(basis).origin}/${owner}/${name}`;
  const roh = (methode: 'GET' | 'POST' | 'PATCH' | 'DELETE', pfad: string, body?: unknown) => {
    const url = pfad.startsWith('/api/') ? `${new URL(basis).origin}${pfad}` : `${basis}${pfad}`;
    return curl(a, { methode, url, kopf: kopf(), body });
  };
  const aufruf = (methode: 'GET' | 'POST' | 'PATCH' | 'DELETE', pfad: string, body?: unknown): any => {
    const r = roh(methode, pfad, body);
    if (r.status < 200 || r.status > 299) {
      const grund = r.status === 412 ? ' (offene Blocker: ein Issue mit offenen Abhängigkeiten lässt sich nicht schließen)' : r.status === 404 ? ' (oder Token fehlt: Gitea antwortet anonym mit 404)' : '';
      throw new Error(`Gitea ${methode} ${pfad}: ${r.status ? `HTTP ${r.status}` : 'keine Verbindung'}${grund} ${r.text.slice(0, 200)}`.trim());
    }
    try {
      return r.text ? JSON.parse(r.text) : null;
    } catch {
      throw new Error(`Gitea ${methode} ${pfad}: Antwort nicht lesbar: ${r.text.slice(0, 200)}`);
    }
  };
  /** every page of a list, at most `bis` entries */
  const alle = (pfad: string, bis = Infinity): any[] => {
    const out: any[] = [];
    for (let seite = 1; out.length < bis; seite++) {
      const liste = (aufruf('GET', `${pfad}${pfad.includes('?') ? '&' : '?'}limit=${SEITE}&page=${seite}`) ?? []) as any[];
      out.push(...liste);
      if (liste.length < SEITE) break;
    }
    return out.slice(0, bis);
  };

  const rollen = new Map<string, string>();
  /** GitHub's author_association for a login: the owner, a collaborator with write access, or nobody */
  const rolle = (login: string): string => {
    if (!rollen.has(login)) {
      let wert = 'NONE';
      if (login === owner) wert = 'OWNER';
      else {
        const r = roh('GET', `/collaborators/${encodeURIComponent(login)}/permission`);
        if (r.status === 200 && ['admin', 'write', 'owner'].includes(String(JSON.parse(r.text || '{}').permission))) wert = 'COLLABORATOR';
        else if (r.status !== 200 && r.status !== 403 && r.status !== 404) throw new Error(`Gitea GET /collaborators/${login}/permission: HTTP ${r.status} ${r.text.slice(0, 200)}`);
      }
      rollen.set(login, wert);
    }
    return rollen.get(login)!;
  };
  const kommentare = (nr: number): Kommentar[] =>
    alle(`/issues/${nr}/comments`).map((c) => {
      const autor = String(c.user?.login ?? '?');
      return { body: String(c.body ?? ''), autor, zeit: String(c.created_at ?? ''), rolle: rolle(autor), url: String(c.html_url ?? '') };
    });
  const issueAus = (j: any, felder: string[]): Issue => ({
    nummer: Number(j.number),
    titel: String(j.title ?? ''),
    body: String(j.body ?? ''),
    url: String(j.html_url ?? ''),
    zustand: zustandAus(j.state),
    labels: namen(j.labels),
    geschlossenAm: j.closed_at ? String(j.closed_at) : null,
    kommentare: felder.includes('comments') ? kommentare(Number(j.number)) : [],
  });
  const prAus = (j: any): Pr => ({
    nummer: Number(j.number),
    titel: String(j.title ?? ''),
    body: String(j.body ?? ''),
    url: String(j.html_url ?? ''),
    zustand: j.merged ? 'MERGED' : zustandAus(j.state),
    mergebar: j.mergeable === true ? 'MERGEABLE' : j.mergeable === false ? 'CONFLICTING' : 'UNKNOWN',
    kopf: String(j.head?.ref ?? ''),
    basis: String(j.base?.ref ?? ''),
    kopfSha: String(j.head?.sha ?? ''),
    erstellt: String(j.created_at ?? ''),
    gemergtAm: j.merged_at ? String(j.merged_at) : null,
  });

  let labelIds: Map<string, number> | null = null;
  const ids = () => (labelIds ??= new Map(alle('/labels').map((l) => [String(l.name), Number(l.id)])));
  const idVon = (label: string) => {
    const id = ids().get(label);
    if (id === undefined) throw new Error(`Gitea: Label ${label} gibt es im Repository nicht`);
    return id;
  };
  const labelAnlegen = (label: string, farbe?: string, beschreibung?: string) => {
    if (ids().has(label)) return;
    const neu = aufruf('POST', '/labels', { name: label, color: `#${farbe ?? LABEL_FARBE_STANDARD}`, description: beschreibung ?? '' });
    ids().set(label, Number(neu.id));
  };

  return {
    art: 'gitea',
    repo: `${owner}/${name}`,
    prLink: (nr) => `${web}/pulls/${nr}`,
    issue: (nr, felder) => issueAus(aufruf('GET', `/issues/${nr}`), felder),
    issues: (label, felder, limit = 500) => alle(`/issues?state=open&type=issues&labels=${encodeURIComponent(label)}`, limit).map((j) => issueAus(j, felder)),
    kommentieren(nr, text) {
      aufruf('POST', `/issues/${nr}/comments`, { body: text });
    },
    anlegen(titel, body, labels) {
      for (const l of labels) labelAnlegen(l);
      return Number(aufruf('POST', '/issues', { title: titel, body, labels: labels.map(idVon) }).number);
    },
    bodySetzen(nr, body) {
      aufruf('PATCH', `/issues/${nr}`, { body });
    },
    schliessen(nr, o = {}) {
      if (o.kommentar !== undefined) aufruf('POST', `/issues/${nr}/comments`, { body: o.kommentar });
      aufruf('PATCH', `/issues/${nr}`, { state: 'closed' });
    },
    oeffnen(nr) {
      aufruf('PATCH', `/issues/${nr}`, { state: 'open' });
    },
    labelsAendern(nr, o) {
      if (o.dazu?.length) aufruf('POST', `/issues/${nr}/labels`, { labels: o.dazu.map(idVon) });
      for (const l of o.weg ?? []) {
        const id = ids().get(l);
        // a label the repository does not know is not on the issue either
        if (id !== undefined) aufruf('DELETE', `/issues/${nr}/labels/${id}`);
      }
    },
    labelAnlegen,
    labelNamen: () => [...ids().keys()],
    kinder: (mission): Kind[] =>
      alle(`/issues/${mission}/dependencies`)
        .filter((i) => !namen(i.labels).includes(epicLabel))
        .map((i) => ({ nummer: Number(i.number), zustand: zustandAus(i.state), labels: namen(i.labels) })),
    mission(nr) {
      // the issues nr blocks; the mission among them carries the epic label
      const m = alle(`/issues/${nr}/blocks`).find((i) => namen(i.labels).includes(epicLabel));
      return m ? Number(m.number) : null;
    },
    kindLoesen(mission, kind) {
      aufruf('DELETE', `/issues/${mission}/dependencies`, { owner, repo: name, index: kind });
    },
    autorRolle: (nr) => rolle(String(aufruf('GET', `/issues/${nr}`).user?.login ?? '')),
    labelJeGesetzt: (nr, label) => alle(`/issues/${nr}/timeline`).some((e) => e.type === 'label' && e.label?.name === label && String(e.body ?? '1') === '1'),
    pr: (nr) => prAus(aufruf('GET', `/pulls/${nr}`)),
    prs(o) {
      const liste = alle(`/pulls?state=${o.zustand === 'all' ? 'all' : o.zustand === 'merged' ? 'closed' : 'open'}`)
        .map(prAus)
        .filter((p) => (!o.kopf || p.kopf === o.kopf) && (o.zustand !== 'merged' || p.zustand === 'MERGED'));
      return o.limit ? liste.slice(0, o.limit) : liste;
    },
    prAnlegen: (basisZweig, kopfZweig, titel, body) => String(aufruf('POST', '/pulls', { base: basisZweig, head: kopfZweig, title: titel, body }).html_url ?? ''),
    prBodySetzen(nr, body) {
      aufruf('PATCH', `/pulls/${nr}`, { body });
    },
    standardZweig: () => String(aufruf('GET', '').default_branch ?? ''),
    zweige: () => alle('/branches').map((b) => String(b.name)),
    voraus: (basisZweig, kopfZweig) => Number(aufruf('GET', `/compare/${encodeURIComponent(basisZweig)}...${encodeURIComponent(kopfZweig)}`).total_commits ?? 0),
    mergeSkript: () => ({ args: ['-Api', basis], env: { FLOTTE_FORGE_KOPF: kopf() } }),
  };
}
