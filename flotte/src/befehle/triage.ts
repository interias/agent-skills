// flotte triage [<repo>...] [--forge <owner/name>] [--konto <k>] [--modell <m>] [--trocken]
// The triage run (#115, src/triage.ts) over the open Sternzeit-Notizen of one or more repositories.
// Holds no state of its own: a decided ticket no longer carries its triage label, an open question
// waits for a comment below it. So it can run on a schedule (flotte/README.md, "Triage"). Prints one
// JSON object: per ticket what was decided and written, and the questions to the person.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { TRIAGE_LABEL, type AuftragsRegeln } from '../auftrag/auftrag.ts';
import { admiralWerkzeuge } from '../treiber/admiral.ts';
import { kommentar } from '../treiber/forge.ts';
import { BERECHTIGT, entscheidungAus, INFO_LABEL, triageAuftrag, triageKommentar, triageSchema, wartetAufAntwort, type Ticket } from '../triage.ts';
import { kontoAus } from '../werkzeuge/konten.ts';
import { starte, type LaufErgebnis, type Start } from '../werkzeuge/lauf.ts';
import { schluessel } from './adapter.ts';
import { githubRepoAus, regelnAus } from './auftrag.ts';

const LABELS = [TRIAGE_LABEL, INFO_LABEL];

export interface TriageZiel {
  repo: string;
  forge: string;
  regeln: AuftragsRegeln;
}

export interface TriageAuftrag {
  ziele: TriageZiel[];
  konto: string;
  modell: string;
  trocken: boolean;
  log?: string | null;
  programm?: Pick<Start, 'programm' | 'programmArgs'>;
}

export interface TriageWelt {
  aufrufer: Aufrufer;
  starte: (s: Start) => Promise<LaufErgebnis>;
}

export interface TicketErgebnis {
  forge: string;
  nummer: number;
  titel: string;
  url: string;
  ergebnis: 'klar' | 'ueberfluessig' | 'kritisch' | 'wartet' | 'mission' | 'fremd' | 'ungueltig';
  geschrieben: boolean;
  kommentar: string | null;
  fehler?: string;
  /** --trocken, klar: the body with the filled-in sections */
  body?: string;
  sitzung?: string | null;
}

export interface KritischeFrage {
  forge: string;
  ticket: number;
  url: string;
  frage: string;
  optionen: string[];
  empfehlung: string;
  grund: string;
  herkunft: string;
  marke: string;
}

/** The open tickets with needs-triage or needs-info, each once, oldest first. */
export function triageTickets(a: Aufrufer, forge: string): Ticket[] {
  const alle = new Map<number, Ticket>();
  for (const label of LABELS) {
    const r = a('gh', ['issue', 'list', '--repo', forge, '--label', label, '--state', 'open', '--limit', '200', '--json', 'number,title,body,url,labels,comments']);
    if (r.code) throw new Error(`gh issue list ${forge} --label ${label}: ${(r.stderr || r.stdout).trim()}`);
    for (const i of JSON.parse(r.stdout) as any[]) {
      alle.set(Number(i.number), {
        nummer: Number(i.number),
        titel: String(i.title ?? ''),
        body: String(i.body ?? ''),
        url: String(i.url ?? ''),
        labels: (i.labels ?? []).map((l: { name: string }) => l.name),
        kommentare: (i.comments ?? []).map((c: any) => ({ body: String(c.body ?? ''), autor: String(c.author?.login ?? '?'), zeit: String(c.createdAt ?? ''), rolle: String(c.authorAssociation ?? 'NONE') })),
      });
    }
  }
  return [...alle.values()].sort((x, y) => x.nummer - y.nummer);
}

export async function triagiere(o: TriageAuftrag, w: TriageWelt) {
  const tickets: TicketErgebnis[] = [];
  const fragen: KritischeFrage[] = [];
  const fehler: { forge: string; fehler: string }[] = [];
  for (const z of o.ziele) {
    let liste: Ticket[];
    try {
      liste = triageTickets(w.aufrufer, z.forge);
    } catch (err) {
      fehler.push({ forge: z.forge, fehler: (err as Error).message });
      continue;
    }
    for (const t of liste) {
      const basis = { forge: z.forge, nummer: t.nummer, titel: t.titel, url: t.url };
      // a mission is released through its mission goals, not triaged itself
      if (t.labels.includes(z.regeln.epic_label)) {
        tickets.push({ ...basis, ergebnis: 'mission', geschrieben: false, kommentar: null });
        continue;
      }
      if (wartetAufAntwort(t)) {
        tickets.push({ ...basis, ergebnis: 'wartet', geschrieben: false, kommentar: null });
        continue;
      }
      // a stranger's ticket never reaches the model: its body could lift itself to ready_label
      const rolle = w.aufrufer('gh', ['api', `repos/${z.forge}/issues/${t.nummer}`, '--jq', '.author_association']);
      if (rolle.code || !BERECHTIGT.includes(rolle.stdout.trim())) {
        tickets.push({ ...basis, ergebnis: 'fremd', geschrieben: false, kommentar: null, ...(rolle.code ? { fehler: `Rolle des Autors nicht lesbar: ${(rolle.stderr || rolle.stdout).trim().slice(0, 300)}` } : {}) });
        continue;
      }
      const r = await w.starte({
        ...(o.programm ?? {}),
        repo: z.repo,
        konto: o.konto,
        auftrag: triageAuftrag(t, z.regeln),
        modell: o.modell,
        // read only, like the admiral: ADRs and code are facts
        extraArgs: ['--json-schema', JSON.stringify(triageSchema()), '--tools', 'Read,Grep,Glob'],
        werkzeuge: admiralWerkzeuge,
        leerlaufMs: 10 * 60_000,
        log: o.log ?? null,
      });
      const e = entscheidungAus(r.strukturiert, t.titel, t.body, z.regeln);
      if (e.art === 'ungueltig') {
        tickets.push({ ...basis, ergebnis: 'ungueltig', geschrieben: false, kommentar: null, fehler: r.strukturiert ? e.fehler : `${e.fehler} (${r.fehler ?? `Exit ${r.code}`})`, sitzung: r.sitzung });
        continue;
      }
      const entfernt = LABELS.filter((l) => t.labels.includes(l));
      const text = triageKommentar(e, t, entfernt, z.regeln.ready_label);
      if (e.art === 'kritisch') {
        for (const f of e.fragen.filter((f) => f.beim_menschen)) fragen.push({ forge: z.forge, ticket: t.nummer, url: t.url, frage: f.frage, optionen: f.optionen, empfehlung: f.antwort, grund: f.grund, herkunft: f.herkunft, marke: f.marke ?? '' });
      }
      if (o.trocken) {
        tickets.push({ ...basis, ergebnis: e.art, geschrieben: false, kommentar: text, sitzung: r.sitzung, ...(e.art === 'klar' ? { body: e.body } : {}) });
        continue;
      }
      // the comment first: no ticket changes without its origin standing at it
      if (!kommentar(w.aufrufer, z.forge, t.nummer, text)) {
        tickets.push({ ...basis, ergebnis: e.art, geschrieben: false, kommentar: text, fehler: 'Kommentar gescheitert, nichts geändert', sitzung: r.sitzung });
        continue;
      }
      let gescheitert: string | undefined;
      if (e.art !== 'kritisch') {
        if (e.art === 'klar') w.aufrufer('gh', ['label', 'create', z.regeln.ready_label, '--repo', z.forge]); // fails when it exists, which is fine
        const args =
          e.art === 'klar'
            ? ['issue', 'edit', String(t.nummer), '--repo', z.forge, '--body-file', '-', '--add-label', z.regeln.ready_label, ...(entfernt.length ? ['--remove-label', entfernt.join(',')] : [])]
            : ['issue', 'close', String(t.nummer), '--repo', z.forge, '--reason', 'not planned'];
        const x = w.aufrufer('gh', args, e.art === 'klar' ? { eingabe: e.body } : undefined);
        if (x.code) gescheitert = `Kommentar steht, ${e.art === 'klar' ? 'Freigabe' : 'Schließen'} gescheitert: ${(x.stderr || x.stdout).trim().slice(0, 300)}`;
      }
      tickets.push({ ...basis, ergebnis: e.art, geschrieben: true, kommentar: text, ...(gescheitert ? { fehler: gescheitert } : {}), sitzung: r.sitzung });
    }
  }
  return { trocken: o.trocken, tickets, fragen, fehler };
}

function wert(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function triage(argv: string[], aufrufer: Aufrufer = aufrufen): Promise<unknown> {
  const AUFRUF = 'Aufruf: flotte triage [<repo>...] [--forge <owner/name>] [--konto <k>] [--modell <m>] [--trocken]';
  const mitWert = ['--forge', '--konto', '--modell'];
  const pos = argv.filter((x, i) => !x.startsWith('--') && !mitWert.includes(argv[i - 1]));
  const unbekannt = argv.filter((x) => x.startsWith('--') && !mitWert.includes(x) && x !== '--trocken');
  if (unbekannt.length || (wert(argv, '--forge') && pos.length > 1)) throw new Error(AUFRUF);
  const repos = (pos.length ? pos : [process.cwd()]).map((p) => resolve(p));
  const ziele: TriageZiel[] = [];
  const fehler: { repo: string; fehler: string }[] = [];
  for (const repo of repos) {
    const datei = join(repo, '.claude', 'epic.md');
    const text = existsSync(datei) ? readFileSync(datei, 'utf8') : '';
    try {
      if (!existsSync(repo)) throw new Error('Repository fehlt');
      if (schluessel(text, 'forge') === 'gitea') throw new Error('Forge gitea: flotte triage spricht bisher nur GitHub');
      ziele.push({ repo, forge: wert(argv, '--forge') ?? githubRepoAus(text, repo, aufrufer), regeln: regelnAus(text) });
    } catch (e) {
      fehler.push({ repo, fehler: (e as Error).message });
    }
  }
  const r = await triagiere(
    { ziele, konto: kontoAus(wert(argv, '--konto') ?? '1'), modell: wert(argv, '--modell') ?? 'fable', trocken: argv.includes('--trocken') },
    { aufrufer, starte },
  );
  return { ...r, repos: ziele.map((z) => ({ repo: z.repo, forge: z.forge })), fehler: [...fehler, ...r.fehler] };
}
