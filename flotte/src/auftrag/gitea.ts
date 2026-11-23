// The Gitea side of the order writer's forge layer (agent-skills/ADR-0002), straight against the API
// (mission/references/forge.md). It carries no rule: it only turns the three methods into API calls.

import { labelArt, type AngelegtesIssue, type AuftragsRegeln, type Forge } from './auftrag.ts';

/** Gitea requires a colour; labels without a house colour get a neutral one. */
const LABEL_FARBE_STANDARD = 'ededed';

/**
 * @param api `<host>/api/v1/repos/<owner>/<repo>`
 * @param kopf the Authorization header value; asked for on the first call only, so a dry run needs no login
 */
export function giteaForge(api: string, kopf: () => string | Promise<string>, regeln: AuftragsRegeln, abruf: typeof fetch = fetch): Forge {
  const basis = api.replace(/\/+$/, '');
  const [owner, repo] = /\/repos\/([^/]+)\/([^/]+)$/.exec(basis)?.slice(1) ?? [];
  if (!owner) throw new Error(`Gitea-api ohne /repos/<owner>/<repo>: ${basis}`);
  const aufruf = async (methode: string, pfad: string, body?: unknown): Promise<any> => {
    const r = await abruf(`${basis}${pfad}`, {
      method: methode,
      headers: { Authorization: await kopf(), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Gitea ${methode} ${pfad}: HTTP ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
  let ids: Map<string, number> | null = null;
  /** label name to id; the lists are capped at 50 per page */
  const labelIds = async (namen: string[]): Promise<number[]> => {
    if (!ids) {
      ids = new Map();
      for (let seite = 1; ; seite++) {
        const liste: { id: number; name: string }[] = await aufruf('GET', `/labels?limit=50&page=${seite}`);
        for (const l of liste) ids.set(l.name, l.id);
        if (liste.length < 50) break;
      }
    }
    const karte = ids;
    const ergebnis: number[] = [];
    for (const name of namen) {
      if (!karte.has(name)) {
        const art = labelArt(name, regeln);
        const neu = await aufruf('POST', '/labels', { name, color: `#${art?.farbe ?? LABEL_FARBE_STANDARD}`, description: art?.beschreibung ?? '' });
        karte.set(name, neu.id);
      }
      ergebnis.push(karte.get(name)!);
    }
    return ergebnis;
  };
  return {
    async anlegen({ titel, body, labels }): Promise<AngelegtesIssue> {
      const neu = await aufruf('POST', '/issues', { title: titel, body, labels: await labelIds(labels) });
      return { nummer: neu.number, url: neu.html_url };
    },
    async bodySetzen(nummer, body) {
      await aufruf('PATCH', `/issues/${nummer}`, { body });
    },
    async verknuepfen(mission, ziel) {
      // the mission waits for its Missionsziel: "blocked by" points from epic to child (forge.md, "Abhängigkeiten lesen")
      await aufruf('POST', `/issues/${mission}/dependencies`, { owner, repo, index: ziel });
    },
  };
}
