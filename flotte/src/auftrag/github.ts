// The GitHub side of the order writer's forge layer (agent-skills/ADR-0002), only through gh.

import type { Aufrufer } from '../aufruf.ts';
import { labelArt, type AngelegtesIssue, type AuftragsRegeln, type Forge } from './auftrag.ts';

export function githubForge(a: Aufrufer, repo: string, regeln: AuftragsRegeln): Forge {
  const gh = (args: string[], eingabe?: string) => {
    const r = a('gh', args, eingabe === undefined ? undefined : { eingabe });
    if (r.code) throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout;
  };
  const geprueft = new Set<string>();
  return {
    async anlegen({ titel, body, labels }): Promise<AngelegtesIssue> {
      for (const l of labels.filter((l) => !geprueft.has(l))) {
        // fails when the label exists, which is fine; any other cause shows up in issue create
        const art = labelArt(l, regeln);
        a('gh', ['label', 'create', l, '--repo', repo, ...(art ? ['--color', art.farbe, '--description', art.beschreibung] : [])]);
        geprueft.add(l);
      }
      const url = gh(['issue', 'create', '--repo', repo, '--title', titel, ...labels.flatMap((l) => ['--label', l]), '--body-file', '-'], body).trim().split(/\r?\n/).pop() ?? '';
      const m = /\/issues\/(\d+)$/.exec(url);
      if (!m) throw new Error(`gh issue create: keine Issue-URL in der Ausgabe (${url})`);
      return { nummer: Number(m[1]), url };
    },
    async bodySetzen(nummer, body) {
      gh(['issue', 'edit', String(nummer), '--repo', repo, '--body-file', '-'], body);
    },
    async verknuepfen(mission, ziel) {
      // the sub-issue API takes the database id of the child, not its number
      const id = gh(['api', `repos/${repo}/issues/${ziel}`, '--jq', '.id']).trim();
      if (!/^\d+$/.test(id)) throw new Error(`gh api: keine Id für #${ziel} (${id})`);
      gh(['api', '--method', 'POST', `repos/${repo}/issues/${mission}/sub_issues`, '-F', `sub_issue_id=${id}`]);
    },
    async verknuepft(mission, ziel) {
      // a sub-issue has one parent: the child names it
      return new RegExp(`/issues/${mission}$`).test(gh(['api', `repos/${repo}/issues/${ziel}`, '--jq', '.parent_issue_url']).trim());
    },
  };
}
