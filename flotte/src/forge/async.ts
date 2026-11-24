// The part of the forge layer (#127) that `flotte mission` needs, without blocking: its Mechanik reads and
// writes labels, comments and the pull request while packages run, through an AsyncAufrufer with a time
// limit. Same choice and same rules as zugriff.ts; GitHub through gh, Gitea through curl against the API.

import type { AsyncAufrufer, Ergebnis } from '../aufruf.ts';
import { schluessel } from '../befehle/adapter.ts';
import { giteaZugang } from '../befehle/auftrag.ts';
import { aufrufen } from '../aufruf.ts';
import { curlAsync } from './curl.ts';
import { adapterText } from './zugriff.ts';

export interface ForgeAsync {
  labelNamen(): Promise<string[]>;
  /** only for a label that is missing; throws when it cannot be created */
  labelAnlegen(name: string, farbe: string, beschreibung: string): Promise<void>;
  labels(nr: number): Promise<string[]>;
  labelsAendern(nr: number, dazu: string[], weg: string[]): Promise<void>;
  body(nr: number): Promise<string>;
  titel(nr: number): Promise<string>;
  kommentare(nr: number): Promise<string[]>;
  kommentieren(nr: number, text: string): Promise<void>;
  /** numbers of the Missionsziele linked at the forge; a forge without the feature: none */
  kinder(nr: number): Promise<number[]>;
  /** link of the open pull request of the head branch, null when there is none */
  offenerPr(kopf: string): Promise<string | null>;
  /** returns the link of the new pull request */
  prAnlegen(basis: string, kopf: string, titel: string, body: string): Promise<string | null>;
}

const ZEIT = 120_000;

export function githubAsync(a: AsyncAufrufer, repo: string): ForgeAsync {
  const gh = async (args: string[], eingabe?: string): Promise<string> => {
    const r: Ergebnis = await a('gh', args, { eingabe, timeoutMs: ZEIT });
    if (r.code) throw new Error(`gh ${args.slice(0, 3).join(' ')}: Exit ${r.code}: ${(r.stderr || r.stdout).replace(/\s+/g, ' ').trim().slice(0, 600)}`);
    return r.stdout;
  };
  const json = async (args: string[]): Promise<any> => {
    const aus = await gh(args);
    try {
      return JSON.parse(aus || 'null');
    } catch (x) {
      throw new Error(`gh ${args.slice(0, 3).join(' ')}: Antwort nicht lesbar: ${(x as Error).message}`);
    }
  };
  const issue = (nr: number, feld: string) => json(['issue', 'view', String(nr), '--repo', repo, '--json', feld]);
  return {
    labelNamen: async () => (((await json(['label', 'list', '--repo', repo, '--json', 'name', '--limit', '500'])) ?? []) as { name: string }[]).map((l) => l.name),
    async labelAnlegen(name, farbe, beschreibung) {
      await gh(['label', 'create', name, '--repo', repo, '--color', farbe, '--description', beschreibung]);
    },
    labels: async (nr) => (((await issue(nr, 'labels')).labels ?? []) as { name: string }[]).map((l) => l.name),
    async labelsAendern(nr, dazu, weg) {
      await gh(['issue', 'edit', String(nr), '--repo', repo, ...(dazu.length ? ['--add-label', dazu.join(',')] : []), ...(weg.length ? ['--remove-label', weg.join(',')] : [])]);
    },
    body: async (nr) => String((await issue(nr, 'body')).body ?? ''),
    titel: async (nr) => String((await issue(nr, 'title')).title ?? `Mission #${nr}`),
    kommentare: async (nr) => (((await issue(nr, 'comments')).comments ?? []) as { body: string }[]).map((k) => k.body),
    async kommentieren(nr, text) {
      // from a file (stdin), never from a shell string (mission/references/forge.md, "Stolperstellen")
      await gh(['issue', 'comment', String(nr), '--repo', repo, '--body-file', '-'], text);
    },
    async kinder(nr) {
      try {
        return (await gh(['api', `repos/${repo}/issues/${nr}/sub_issues`, '--paginate', '--jq', '.[].number'])).split(/\s+/).filter(Boolean).map(Number);
      } catch (f) {
        // a forge without sub-issues answers 404: no children linked there, the body still counts
        if (/HTTP 404|Not Found/.test((f as Error).message)) return [];
        throw f;
      }
    },
    offenerPr: async (kopf) => (((await json(['pr', 'list', '--repo', repo, '--head', kopf, '--state', 'open', '--json', 'url'])) ?? []) as { url: string }[])[0]?.url ?? null,
    prAnlegen: async (basis, kopf, titel, body) => /https?:\/\/\S+/.exec(await gh(['pr', 'create', '--repo', repo, '--base', basis, '--head', kopf, '--title', titel, '--body-file', '-'], body))?.[0] ?? null,
  };
}

/** @param kopf the Authorization header value, asked for on the first call */
export function giteaAsync(a: AsyncAufrufer, api: string, kopf: () => string, epicLabel = 'epic'): ForgeAsync {
  const basis = api.replace(/\/+$/, '');
  const aufruf = async (methode: 'GET' | 'POST' | 'PATCH' | 'DELETE', pfad: string, body?: unknown): Promise<any> => {
    const r = await curlAsync(a, { methode, url: `${basis}${pfad}`, kopf: kopf(), body }, ZEIT);
    if (r.status < 200 || r.status > 299) throw new Error(`Gitea ${methode} ${pfad}: ${r.status ? `HTTP ${r.status}` : 'keine Verbindung'} ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`.trim());
    try {
      return r.text ? JSON.parse(r.text) : null;
    } catch (x) {
      throw new Error(`Gitea ${methode} ${pfad}: Antwort nicht lesbar: ${(x as Error).message}`);
    }
  };
  const alle = async (pfad: string): Promise<any[]> => {
    const out: any[] = [];
    for (let seite = 1; ; seite++) {
      const liste = ((await aufruf('GET', `${pfad}${pfad.includes('?') ? '&' : '?'}limit=50&page=${seite}`)) ?? []) as any[];
      out.push(...liste);
      if (liste.length < 50) return out;
    }
  };
  let ids: Map<string, number> | null = null;
  const labelIds = async () => (ids ??= new Map((await alle('/labels')).map((l) => [String(l.name), Number(l.id)])));
  const namen = (labels: unknown) => ((labels ?? []) as { name: string }[]).map((l) => l.name);
  return {
    labelNamen: async () => [...(await labelIds()).keys()],
    async labelAnlegen(name, farbe, beschreibung) {
      const neu = await aufruf('POST', '/labels', { name, color: `#${farbe}`, description: beschreibung });
      (await labelIds()).set(name, Number(neu.id));
    },
    labels: async (nr) => namen((await aufruf('GET', `/issues/${nr}`)).labels),
    async labelsAendern(nr, dazu, weg) {
      let karte = await labelIds();
      // a name not in the list read earlier: read it once more, someone else may have made the label
      if ([...dazu, ...weg].some((l) => !karte.has(l))) {
        ids = null;
        karte = await labelIds();
      }
      const id = (l: string) => {
        if (!karte.has(l)) throw new Error(`Gitea: Label ${l} gibt es im Repository nicht`);
        return karte.get(l)!;
      };
      if (dazu.length) await aufruf('POST', `/issues/${nr}/labels`, { labels: dazu.map(id) });
      for (const l of weg) if (karte.has(l)) await aufruf('DELETE', `/issues/${nr}/labels/${karte.get(l)}`);
    },
    body: async (nr) => String((await aufruf('GET', `/issues/${nr}`)).body ?? ''),
    titel: async (nr) => String((await aufruf('GET', `/issues/${nr}`)).title ?? `Mission #${nr}`),
    kommentare: async (nr) => (await alle(`/issues/${nr}/comments`)).map((k) => String(k.body ?? '')),
    async kommentieren(nr, text) {
      await aufruf('POST', `/issues/${nr}/comments`, { body: text });
    },
    // a blocker with the epic label is an order edge between missions, no Missionsziel (forge.md)
    kinder: async (nr) => (await alle(`/issues/${nr}/dependencies`)).filter((i) => !namen(i.labels).includes(epicLabel)).map((i) => Number(i.number)),
    offenerPr: async (kopfZweig) => (await alle('/pulls?state=open')).find((p) => p.head?.ref === kopfZweig)?.html_url ?? null,
    prAnlegen: async (basisZweig, kopfZweig, titel, body) => (await aufruf('POST', '/pulls', { base: basisZweig, head: kopfZweig, title: titel, body })).html_url ?? null,
  };
}

/** The ForgeAsync of a project, chosen like zugriffFuer: Gitea by the adapter key forge, else GitHub. */
export function forgeAsyncFuer(repo: string, a: AsyncAufrufer, github: string): ForgeAsync {
  const text = adapterText(repo);
  if (schluessel(text, 'forge') !== 'gitea') return githubAsync(a, github);
  let kopf: string | null = null;
  // the token comes from token_env or token_file; the credential store is asked once, synchronously
  return giteaAsync(a, schluessel(text, 'api')!, () => (kopf ??= giteaZugang(text, repo, aufrufen)), schluessel(text, 'epic_label') ?? 'epic');
}
