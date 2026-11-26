// The forge layer of the driver (#127, agent-skills/ADR-0002): everything the driver and the commands around
// it do at the forge goes through one ForgeZugriff, with an implementation for GitHub (src/forge/github.ts,
// the only place that calls gh) and one for Gitea (src/forge/gitea.ts, curl against the API). Chosen by the
// adapter key `forge`; Gitea takes its address from `api` and its token from `token_env` (#125).
// Every method throws on a forge that does not answer; the message carries the forge's own text.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Aufrufer } from '../aufruf.ts';
import { schluessel } from '../befehle/adapter.ts';
import { giteaRepoAus, giteaZugang } from '../befehle/auftrag.ts';
import { giteaZugriff } from './gitea.ts';
import { githubZugriff } from './github.ts';

export interface Kommentar {
  body: string;
  autor: string;
  zeit: string;
  /** OWNER, MEMBER, COLLABORATOR or NONE, as GitHub's author_association */
  rolle: string;
  url: string;
}

export interface Issue {
  nummer: number;
  titel: string;
  body: string;
  url: string;
  zustand: 'OPEN' | 'CLOSED';
  labels: string[];
  geschlossenAm: string | null;
  /** only read when `comments` is among the fields */
  kommentare: Kommentar[];
}

export interface Pr {
  nummer: number;
  titel: string;
  body: string;
  url: string;
  zustand: 'OPEN' | 'CLOSED' | 'MERGED';
  mergebar: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  /** head and base branch, the commit of the head */
  kopf: string;
  basis: string;
  kopfSha: string;
  erstellt: string;
  gemergtAm: string | null;
}

/** A Missionsziel of a mission: GitHub's sub-issue, Gitea's dependency of the mission. */
export interface Kind {
  nummer: number;
  zustand: 'OPEN' | 'CLOSED';
  labels: string[];
}

/**
 * `felder` are the field names of `gh --json` (number, title, body, url, state, labels, closedAt, comments;
 * for pull requests also mergeable, headRefName, baseRefName, headRefOid, createdAt, mergedAt). GitHub reads
 * only those; Gitea reads the whole object and fetches comments only when they are asked for.
 */
export interface ForgeZugriff {
  art: 'github' | 'gitea';
  /** owner/name */
  repo: string;
  /** the web page of the repository, https://github.com/<owner>/<name> or the Gitea host's */
  web: string;
  /** the web link of a pull request */
  prLink(nr: number): string;
  issue(nr: number, felder: string[]): Issue;
  /** open issues with the label, oldest page first */
  issues(label: string, felder: string[], limit?: number): Issue[];
  kommentieren(nr: number, text: string): void;
  /** returns the number of the new issue */
  anlegen(titel: string, body: string, labels: string[]): number;
  bodySetzen(nr: number, body: string): void;
  /** with a comment first; nichtGeplant: GitHub's reason "not planned" (Gitea has none) */
  schliessen(nr: number, o?: { kommentar?: string; nichtGeplant?: boolean }): void;
  oeffnen(nr: number): void;
  labelsAendern(nr: number, o: { dazu?: string[]; weg?: string[] }): void;
  /** creates the label when it is missing; an existing one stays as it is */
  labelAnlegen(name: string, farbe?: string, beschreibung?: string): void;
  labelNamen(): string[];
  kinder(mission: number): Kind[];
  /** the mission a Missionsziel hangs on, null when none */
  mission(nr: number): number | null;
  kindLoesen(mission: number, kind: number): void;
  /** the role of the author of an issue (OWNER, MEMBER, COLLABORATOR, NONE) */
  autorRolle(nr: number): string;
  /** whether the label was ever put on the issue (also when it was taken off since) */
  labelJeGesetzt(nr: number, label: string): boolean;
  pr(nr: number, felder: string[]): Pr;
  /** kopf: only pull requests of this head branch; zustand merged: only merged ones */
  prs(o: { zustand: 'open' | 'merged' | 'all'; kopf?: string; limit?: number; felder: string[] }): Pr[];
  /** returns the link of the new pull request */
  prAnlegen(basis: string, kopf: string, titel: string, body: string): string;
  prBodySetzen(nr: number, body: string): void;
  standardZweig(): string;
  zweige(): string[];
  /** commits of kopf that basis lacks */
  voraus(basis: string, kopf: string): number;
  /** what merge.ps1 needs beyond -Repo and -Pr: Gitea's -Api, and its Authorization header in the environment of that process only */
  mergeSkript(): { args: string[]; env: Record<string, string> };
}

/** an error of the forge as a short line, for events and reports */
export const fehlerText = (e: unknown) => (e instanceof Error ? e.message : String(e)).trim().slice(0, 300);

/** The adapter text of a checkout; empty without one. */
export const adapterText = (repo: string) => {
  const d = join(repo, '.claude', 'epic.md');
  return existsSync(d) ? readFileSync(d, 'utf8') : '';
};

/**
 * The ForgeZugriff of a project: Gitea when its adapter says `forge: gitea` (owner/name from `api`), else GitHub
 * with `github` as owner/name. The Gitea token is read on the first call only, so a dry run needs none.
 */
export function zugriffFuer(repo: string, a: Aufrufer, github: string): ForgeZugriff {
  const text = adapterText(repo);
  if (schluessel(text, 'forge') !== 'gitea') return githubZugriff(a, github);
  let kopf: string | null = null;
  return giteaZugriff(a, schluessel(text, 'api')!, () => (kopf ??= giteaZugang(text, repo, a)), schluessel(text, 'epic_label') ?? 'epic');
}

/** owner/name of the project's forge: Gitea from the adapter, else the GitHub repository given. */
export function forgeRepoFuer(repo: string, github: string): string {
  const text = adapterText(repo);
  return schluessel(text, 'forge') === 'gitea' ? giteaRepoAus(text) : github;
}
