// The GitHub side of the driver's forge layer (#127): the only place under src/ besides the order writer
// (src/auftrag/github.ts) and the link check (src/befehle/forge.ts) that calls gh.

import type { Aufrufer } from '../aufruf.ts';
import type { ForgeZugriff, Issue, Kind, Kommentar, Pr } from './zugriff.ts';

const namen = (labels: unknown) => ((labels ?? []) as { name?: string }[]).map((l) => String(l?.name ?? ''));

const kommentareAus = (liste: unknown): Kommentar[] =>
  ((liste ?? []) as any[]).map((c) => ({ body: String(c.body ?? ''), autor: String(c.author?.login ?? '?'), zeit: String(c.createdAt ?? ''), rolle: String(c.authorAssociation ?? 'NONE'), url: String(c.url ?? '') }));

export const issueAus = (j: any): Issue => ({
  nummer: Number(j.number ?? 0),
  titel: String(j.title ?? ''),
  body: String(j.body ?? ''),
  url: String(j.url ?? ''),
  zustand: String(j.state ?? '').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN',
  labels: namen(j.labels),
  geschlossenAm: j.closedAt ? String(j.closedAt) : null,
  kommentare: kommentareAus(j.comments),
});

const prAus = (j: any): Pr => ({
  nummer: Number(j.number ?? 0),
  titel: String(j.title ?? ''),
  body: String(j.body ?? ''),
  url: String(j.url ?? ''),
  zustand: (['OPEN', 'CLOSED', 'MERGED'].includes(String(j.state)) ? String(j.state) : 'OPEN') as Pr['zustand'],
  mergebar: (['MERGEABLE', 'CONFLICTING'].includes(String(j.mergeable)) ? String(j.mergeable) : 'UNKNOWN') as Pr['mergebar'],
  kopf: String(j.headRefName ?? ''),
  basis: String(j.baseRefName ?? ''),
  kopfSha: String(j.headRefOid ?? ''),
  erstellt: String(j.createdAt ?? ''),
  gemergtAm: j.mergedAt ? String(j.mergedAt) : null,
});

export function githubZugriff(a: Aufrufer, repo: string): ForgeZugriff {
  const gh = (args: string[], eingabe?: string): string => {
    const r = a('gh', args, eingabe === undefined ? undefined : { eingabe });
    if (r.code) throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout;
  };
  const json = (args: string[]): any => {
    const aus = gh(args);
    try {
      return JSON.parse(aus || 'null');
    } catch {
      throw new Error(`gh ${args.slice(0, 2).join(' ')}: Antwort nicht lesbar: ${aus.trim().slice(0, 200)}`);
    }
  };
  /** --jq prints one JSON value per line, also across pages of --paginate */
  const zeilen = (args: string[]) => gh(args).split('\n').map((x) => x.trim()).filter(Boolean);
  return {
    art: 'github',
    repo,
    prLink: (nr) => `https://github.com/${repo}/pull/${nr}`,
    issue: (nr, felder) => issueAus(json(['issue', 'view', String(nr), '--repo', repo, '--json', felder.join(',')])),
    issues: (label, felder, limit = 500) => ((json(['issue', 'list', '--repo', repo, '--label', label, '--state', 'open', '--limit', String(limit), '--json', felder.join(',')]) ?? []) as any[]).map(issueAus),
    kommentieren(nr, text) {
      gh(['issue', 'comment', String(nr), '--repo', repo, '--body-file', '-'], text);
    },
    anlegen(titel, body, labels) {
      const url = gh(['issue', 'create', '--repo', repo, '--title', titel, ...labels.flatMap((l) => ['--label', l]), '--body-file', '-'], body).trim().split(/\r?\n/).pop() ?? '';
      const m = /\/issues\/(\d+)$/.exec(url);
      if (!m) throw new Error(`gh issue create: keine Issue-URL in der Ausgabe (${url})`);
      return Number(m[1]);
    },
    bodySetzen(nr, body) {
      gh(['issue', 'edit', String(nr), '--repo', repo, '--body-file', '-'], body);
    },
    schliessen(nr, o = {}) {
      gh(['issue', 'close', String(nr), '--repo', repo, ...(o.nichtGeplant ? ['--reason', 'not planned'] : []), ...(o.kommentar !== undefined ? ['--comment', o.kommentar] : [])]);
    },
    oeffnen(nr) {
      gh(['issue', 'reopen', String(nr), '--repo', repo]);
    },
    labelsAendern(nr, o) {
      const dazu = o.dazu ?? [];
      const weg = o.weg ?? [];
      if (!dazu.length && !weg.length) return;
      gh(['issue', 'edit', String(nr), '--repo', repo, ...(dazu.length ? ['--add-label', dazu.join(',')] : []), ...(weg.length ? ['--remove-label', weg.join(',')] : [])]);
    },
    labelAnlegen(name, farbe, beschreibung) {
      // fails when the label exists, which is fine; any other cause shows up where the label is used
      a('gh', ['label', 'create', name, '--repo', repo, ...(farbe ? ['--color', farbe] : []), ...(beschreibung ? ['--description', beschreibung] : [])]);
    },
    labelNamen: () => ((json(['label', 'list', '--repo', repo, '--json', 'name', '--limit', '500']) ?? []) as { name: string }[]).map((l) => l.name),
    kinder: (mission): Kind[] =>
      zeilen(['api', `repos/${repo}/issues/${mission}/sub_issues`, '--paginate', '--jq', '.[] | {number, state, labels: [.labels[].name]}']).map((z) => {
        const j = JSON.parse(z);
        return { nummer: Number(j.number), zustand: String(j.state).toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN', labels: (j.labels ?? []).map(String) };
      }),
    mission(nr) {
      const m = /\/issues\/(\d+)\s*$/.exec(gh(['api', `repos/${repo}/issues/${nr}`, '--jq', '.parent_issue_url']).trim());
      return m ? Number(m[1]) : null;
    },
    kindLoesen(mission, kind) {
      // the sub-issue API takes the database id of the child, not its number
      const id = gh(['api', `repos/${repo}/issues/${kind}`, '--jq', '.id']).trim();
      if (!/^\d+$/.test(id)) throw new Error(`gh api: keine Id für #${kind} (${id.slice(0, 100)})`);
      gh(['api', '--method', 'DELETE', `repos/${repo}/issues/${mission}/sub_issue`, '-F', `sub_issue_id=${id}`]);
    },
    autorRolle: (nr) => gh(['api', `repos/${repo}/issues/${nr}`, '--jq', '.author_association']).trim() || 'NONE',
    labelJeGesetzt: (nr, label) => zeilen(['api', `repos/${repo}/issues/${nr}/events`, '--paginate', '--jq', `.[] | select(.event == "labeled" and .label.name == ${JSON.stringify(label)}) | .id`]).length > 0,
    pr: (nr, felder) => prAus(json(['pr', 'view', String(nr), '--repo', repo, '--json', felder.join(',')])),
    prs: (o) => ((json(['pr', 'list', '--repo', repo, ...(o.kopf ? ['--head', o.kopf] : []), '--state', o.zustand, ...(o.limit ? ['--limit', String(o.limit)] : []), '--json', o.felder.join(',')]) ?? []) as any[]).map(prAus),
    prAnlegen: (basis, kopf, titel, body) => gh(['pr', 'create', '--repo', repo, '--base', basis, '--head', kopf, '--title', titel, '--body-file', '-'], body).trim().split(/\r?\n/).pop() ?? '',
    prBodySetzen(nr, body) {
      gh(['pr', 'edit', String(nr), '--repo', repo, '--body-file', '-'], body);
    },
    standardZweig: () => gh(['repo', 'view', repo, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']).trim(),
    zweige: () => zeilen(['api', '--paginate', `repos/${repo}/branches`, '--jq', '.[].name']),
    voraus: (basis, kopf) => Number(gh(['api', `repos/${repo}/compare/${basis}...${encodeURIComponent(kopf)}`, '--jq', '.ahead_by']).trim()),
  };
}
