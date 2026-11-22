// flotte triage [<repo>...] [--forge <owner/name>] [--konto <k>] [--modell <m>] [--trocken]
// The triage run (#115, src/triage.ts) over the open Sternzeit-Notizen of one or more repositories.
// Holds no state of its own: a decided ticket no longer carries its triage label, an open question
// waits for a comment below it. So it can run on a schedule (flotte/README.md, "Triage"). Prints one
// JSON object: per ticket what was decided and written, and the questions to the person.
// #117: with lern_issue in the adapter also each proposal of the learning loop there, like a ticket;
// a clear one becomes a Missionsziel through the order writer.
// #146: before the single clearing one admiral call per project cuts a plan over all its notes (schneide).

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { auftragAusfuehren, TRIAGE_LABEL, type AuftragsRegeln } from '../auftrag/auftrag.ts';
import { githubForge } from '../auftrag/github.ts';
import { admiralWerkzeuge } from '../treiber/admiral.ts';
import { kommentar } from '../treiber/forge.ts';
import { BERECHTIGT, entscheidungAus, GESCHLOSSEN, INFO_LABEL, lernAngelegtKommentar, lernTriageKommentar, lernvorschlaege, missionszielAngelegt, missionszielFehlt, offeneFragen, schnittplanAuftrag, schnittplanAus, schnittplanKommentar, schnittplanSchema, triageAuftrag, triageKommentar, triageSchema, wartetAufAntwort, type Lernvorschlag, type NeueMission, type OffeneMission, type Ticket, type Zuordnung } from '../triage.ts';
import { liesAdapter } from '../werkzeuge/belegung.ts';
import { kontoAus } from '../werkzeuge/konten.ts';
import { starte, type LaufErgebnis, type Start } from '../werkzeuge/lauf.ts';
import { schluessel } from './adapter.ts';
import { githubRepoAus, regelnAus } from './auftrag.ts';

const LABELS = [TRIAGE_LABEL, INFO_LABEL];
/** A mission with a run on it (epic/mechanik.ts): its children are read already, it takes no new ones. */
const IM_EINSATZ = 'status/in-arbeit';

export interface TriageZiel {
  repo: string;
  forge: string;
  regeln: AuftragsRegeln;
  /** #117: the collecting issue of the learning loop (adapter key lern_issue); its proposals are triaged too */
  lernIssue?: number | null;
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
  /** #116: origin and reason of a valid decision (klar, ueberfluessig, kritisch), for the Frachtraum of the bridge */
  herkunft?: string;
  grund?: string;
  sitzung?: string | null;
  /** #117: a proposal of the learning loop (nummer is then the collecting issue, url the comment of the loop) */
  lernvorschlag?: string;
  /** #117, klar: the Missionsziel the order writer created */
  missionsziel?: number;
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
  /** #117: the question belongs to this proposal (ticket is then the collecting issue) */
  lernvorschlag?: string;
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

/** #117: the proposals of the learning loop at the collecting issue, each with the comments naming it. */
export function lernTickets(a: Aufrufer, forge: string, issue: number): Lernvorschlag[] {
  const r = a('gh', ['issue', 'view', String(issue), '--repo', forge, '--json', 'comments']);
  if (r.code) throw new Error(`gh issue view ${forge}#${issue}: ${(r.stderr || r.stdout).trim()}`);
  const kommentare = (JSON.parse(r.stdout).comments ?? []).map((c: any) => ({ body: String(c.body ?? ''), autor: String(c.author?.login ?? '?'), zeit: String(c.createdAt ?? ''), rolle: String(c.authorAssociation ?? 'NONE'), url: String(c.url ?? '') }));
  return lernvorschlaege(issue, kommentare);
}

/** #117: the questions still open below a waiting ticket or proposal, in the form of the new ones. */
function nochOffen(t: Ticket, forge: string, url: string, lernvorschlag?: string): KritischeFrage[] {
  return offeneFragen(t).map((f) => ({ forge, ticket: t.nummer, url, frage: f.frage, optionen: f.optionen, empfehlung: f.empfehlung, grund: f.grund, herkunft: f.herkunft, marke: f.marke, ...(lernvorschlag ? { lernvorschlag } : {}) }));
}

/** #146: the cut plan of one project in the output; zuordnungen of a closed kind carry what was written. */
export interface SchnittplanErgebnis {
  forge: string;
  neue_missionen: NeueMission[];
  zuordnungen: (Zuordnung & { titel: string; url: string; geschrieben?: boolean; kommentar?: string; fehler?: string })[];
  sitzung?: string | null;
  /** an invalid plan, or the open missions not readable: nothing written, no single clearing in this run */
  fehler?: string;
}

/**
 * #146: the open missions a note may join: open, not `status/in-arbeit` (a run there has read its children
 * already), with the number of their children. One whose children cannot be read is left out.
 */
export function offeneMissionen(a: Aufrufer, forge: string, regeln: AuftragsRegeln): OffeneMission[] {
  const r = a('gh', ['issue', 'list', '--repo', forge, '--label', regeln.epic_label, '--state', 'open', '--limit', '200', '--json', 'number,title,body,labels']);
  if (r.code) throw new Error(`gh issue list ${forge} --label ${regeln.epic_label}: ${(r.stderr || r.stdout).trim()}`);
  const out: OffeneMission[] = [];
  for (const i of JSON.parse(r.stdout) as any[]) {
    if ((i.labels ?? []).some((l: { name: string }) => l.name === IM_EINSATZ)) continue;
    const k = a('gh', ['api', `repos/${forge}/issues/${i.number}`, '--jq', '.sub_issues_summary.total']);
    const kinder = Number(k.stdout.trim());
    if (k.code || !k.stdout.trim() || !Number.isInteger(kinder)) continue;
    out.push({ nummer: Number(i.number), titel: String(i.title ?? ''), body: String(i.body ?? ''), kinder });
  }
  return out;
}

/**
 * fragen: the questions to the person asked in this run; offen (#117): those of earlier runs still without
 * an answer, so a reader of the output needs no comment of the forge. schnittplan (#146): per project the
 * cut plan made before the single clearing.
 */
export async function triagiere(o: TriageAuftrag, w: TriageWelt) {
  const tickets: TicketErgebnis[] = [];
  const fragen: KritischeFrage[] = [];
  const offen: KritischeFrage[] = [];
  const fehler: { forge: string; fehler: string }[] = [];
  const schnittplan: SchnittplanErgebnis[] = [];
  for (const z of o.ziele) {
    let liste: Ticket[];
    try {
      liste = triageTickets(w.aufrufer, z.forge);
    } catch (err) {
      fehler.push({ forge: z.forge, fehler: (err as Error).message });
      continue;
    }
    const notizen: Ticket[] = [];
    for (const t of liste) {
      const basis = { forge: z.forge, nummer: t.nummer, titel: t.titel, url: t.url };
      // a mission is released through its mission goals, not triaged itself
      if (t.labels.includes(z.regeln.epic_label)) {
        tickets.push({ ...basis, ergebnis: 'mission', geschrieben: false, kommentar: null });
        continue;
      }
      if (wartetAufAntwort(t)) {
        tickets.push({ ...basis, ergebnis: 'wartet', geschrieben: false, kommentar: null });
        offen.push(...nochOffen(t, z.forge, t.url));
        continue;
      }
      // a stranger's ticket never reaches the model: its body could lift itself to ready_label
      const rolle = w.aufrufer('gh', ['api', `repos/${z.forge}/issues/${t.nummer}`, '--jq', '.author_association']);
      if (rolle.code || !BERECHTIGT.includes(rolle.stdout.trim())) {
        tickets.push({ ...basis, ergebnis: 'fremd', geschrieben: false, kommentar: null, ...(rolle.code ? { fehler: `Rolle des Autors nicht lesbar: ${(rolle.stderr || rolle.stdout).trim().slice(0, 300)}` } : {}) });
        continue;
      }
      notizen.push(t);
    }
    const bleiben = notizen.length ? await schneide(o, w, z, notizen, schnittplan) : [];
    for (const t of bleiben) {
      const basis = { forge: z.forge, nummer: t.nummer, titel: t.titel, url: t.url };
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
      const warum = { herkunft: e.herkunft, grund: e.grund };
      const text = triageKommentar(e, t, entfernt, z.regeln.ready_label);
      if (e.art === 'kritisch') {
        for (const f of e.fragen.filter((f) => f.beim_menschen)) fragen.push({ forge: z.forge, ticket: t.nummer, url: t.url, frage: f.frage, optionen: f.optionen, empfehlung: f.antwort, grund: f.grund, herkunft: f.herkunft, marke: f.marke ?? '' });
      }
      if (o.trocken) {
        tickets.push({ ...basis, ergebnis: e.art, geschrieben: false, kommentar: text, sitzung: r.sitzung, ...warum, ...(e.art === 'klar' ? { body: e.body } : {}) });
        continue;
      }
      // the comment first: no ticket changes without its origin standing at it
      if (!kommentar(w.aufrufer, z.forge, t.nummer, text)) {
        tickets.push({ ...basis, ergebnis: e.art, geschrieben: false, kommentar: text, fehler: 'Kommentar gescheitert, nichts geändert', sitzung: r.sitzung, ...warum });
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
      tickets.push({ ...basis, ergebnis: e.art, geschrieben: true, kommentar: text, ...(gescheitert ? { fehler: gescheitert } : {}), sitzung: r.sitzung, ...warum });
    }
    if (z.lernIssue) await lernTriage(o, w, z, z.lernIssue, { tickets, fragen, offen, fehler });
  }
  return { trocken: o.trocken, tickets, fragen, offen, fehler, schnittplan };
}

/**
 * #146: one admiral call cuts the plan over all notes of the project that go to the model; the program checks
 * it (schnittplanAus). An invalid plan writes nothing and leaves no note for the single clearing. A valid one
 * closes the merged, superfluous and rejected notes (the comment with origin first, then `not planned`, never
 * deleted) and returns the notes that stay, for the single clearing as before.
 */
async function schneide(o: TriageAuftrag, w: TriageWelt, z: TriageZiel, notizen: Ticket[], out: SchnittplanErgebnis[]): Promise<Ticket[]> {
  let missionen: OffeneMission[];
  try {
    missionen = offeneMissionen(w.aufrufer, z.forge, z.regeln);
  } catch (err) {
    out.push({ forge: z.forge, neue_missionen: [], zuordnungen: [], fehler: `offene Missionen nicht lesbar: ${(err as Error).message.slice(0, 300)}` });
    return [];
  }
  const r = await w.starte({
    ...(o.programm ?? {}),
    repo: z.repo,
    konto: o.konto,
    auftrag: schnittplanAuftrag(notizen, missionen),
    modell: o.modell,
    // read only, like the single clearing
    extraArgs: ['--json-schema', JSON.stringify(schnittplanSchema()), '--tools', 'Read,Grep,Glob'],
    werkzeuge: admiralWerkzeuge,
    leerlaufMs: 10 * 60_000,
    log: o.log ?? null,
  });
  const p = schnittplanAus(r.strukturiert, notizen, missionen);
  if (p.art === 'ungueltig') {
    out.push({ forge: z.forge, neue_missionen: [], zuordnungen: [], sitzung: r.sitzung, fehler: r.strukturiert ? p.fehler : `${p.fehler} (${r.fehler ?? `Exit ${r.code}`})` });
    return [];
  }
  const ergebnis: SchnittplanErgebnis = { forge: z.forge, neue_missionen: p.neue_missionen, zuordnungen: [], sitzung: r.sitzung };
  out.push(ergebnis);
  const bleiben: Ticket[] = [];
  for (const x of p.zuordnungen) {
    const t = notizen.find((n) => n.nummer === x.notiz)!;
    const basis = { ...x, titel: t.titel, url: t.url };
    if (!GESCHLOSSEN.includes(x.art)) {
      ergebnis.zuordnungen.push(basis);
      bleiben.push(t);
      continue;
    }
    const text = schnittplanKommentar(x);
    if (o.trocken) {
      ergebnis.zuordnungen.push({ ...basis, geschrieben: false, kommentar: text });
      continue;
    }
    // the comment first: no note is closed without its origin standing at it
    if (!kommentar(w.aufrufer, z.forge, t.nummer, text)) {
      ergebnis.zuordnungen.push({ ...basis, geschrieben: false, kommentar: text, fehler: 'Kommentar gescheitert, nichts geändert' });
      continue;
    }
    const c = w.aufrufer('gh', ['issue', 'close', String(t.nummer), '--repo', z.forge, '--reason', 'not planned']);
    ergebnis.zuordnungen.push({ ...basis, geschrieben: true, kommentar: text, ...(c.code ? { fehler: `Kommentar steht, Schließen gescheitert: ${(c.stderr || c.stdout).trim().slice(0, 300)}` } : {}) });
  }
  // the single clearing in the order of the tickets, as before
  return notizen.filter((t) => bleiben.includes(t));
}

/**
 * #117: each proposal of the learning loop at the collecting issue through the same procedure as a
 * ticket. All comments go to the collecting issue and name the kennung of the proposal; clear: the
 * decision first, then the Missionsziel through the order writer (with ready_label), then its number.
 * Decided proposals and open questions wait for an answer naming the kennung in its first line.
 */
async function lernTriage(o: TriageAuftrag, w: TriageWelt, z: TriageZiel, issue: number, out: { tickets: TicketErgebnis[]; fragen: KritischeFrage[]; offen: KritischeFrage[]; fehler: { forge: string; fehler: string }[] }) {
  let liste: Lernvorschlag[];
  try {
    liste = lernTickets(w.aufrufer, z.forge, issue);
  } catch (err) {
    out.fehler.push({ forge: z.forge, fehler: (err as Error).message });
    return;
  }
  for (const v of liste) {
    const t = v.ticket;
    // its Missionsziel exists: decided for good, a later comment naming the kennung starts nothing (no second Missionsziel)
    if (missionszielAngelegt(t)) continue;
    const basis = { forge: z.forge, nummer: issue, titel: t.titel, url: v.quelle, lernvorschlag: v.kennung };
    if (wartetAufAntwort(t)) {
      // a decided proposal stays silent in every later run; an open question shows as waiting, and so does a
      // clear one whose Missionsziel is missing (never created again by itself: a person checks first)
      const fehlt = missionszielFehlt(t);
      if (offeneFragen(t).length || fehlt) out.tickets.push({ ...basis, ergebnis: 'wartet', geschrieben: false, kommentar: null, ...(fehlt ? { fehler: 'Missionsziel fehlt' } : {}) });
      out.offen.push(...nochOffen(t, z.forge, v.quelle, v.kennung));
      continue;
    }
    const r = await w.starte({
      ...(o.programm ?? {}),
      repo: z.repo,
      konto: o.konto,
      auftrag: triageAuftrag(t, z.regeln, v),
      modell: o.modell,
      extraArgs: ['--json-schema', JSON.stringify(triageSchema()), '--tools', 'Read,Grep,Glob'],
      werkzeuge: admiralWerkzeuge,
      leerlaufMs: 10 * 60_000,
      log: o.log ?? null,
    });
    const e = entscheidungAus(r.strukturiert, t.titel, t.body, z.regeln);
    if (e.art === 'ungueltig') {
      out.tickets.push({ ...basis, ergebnis: 'ungueltig', geschrieben: false, kommentar: null, fehler: r.strukturiert ? e.fehler : `${e.fehler} (${r.fehler ?? `Exit ${r.code}`})`, sitzung: r.sitzung });
      continue;
    }
    const warum = { herkunft: e.herkunft, grund: e.grund };
    const text = lernTriageKommentar(e, v, z.regeln.ready_label);
    if (e.art === 'kritisch') {
      for (const f of e.fragen.filter((f) => f.beim_menschen)) out.fragen.push({ forge: z.forge, ticket: issue, url: v.quelle, frage: f.frage, optionen: f.optionen, empfehlung: f.antwort, grund: f.grund, herkunft: f.herkunft, marke: f.marke ?? '', lernvorschlag: v.kennung });
    }
    if (o.trocken) {
      out.tickets.push({ ...basis, ergebnis: e.art, geschrieben: false, kommentar: text, sitzung: r.sitzung, ...warum, ...(e.art === 'klar' ? { body: e.body } : {}) });
      continue;
    }
    // the comment first: no Missionsziel without its origin standing at the collecting issue
    if (!kommentar(w.aufrufer, z.forge, issue, text)) {
      out.tickets.push({ ...basis, ergebnis: e.art, geschrieben: false, kommentar: text, fehler: 'Kommentar gescheitert, nichts angelegt', sitzung: r.sitzung, ...warum });
      continue;
    }
    let neu: { nummer: number; url: string } | undefined;
    let gescheitert: string | undefined;
    if (e.art === 'klar') {
      try {
        const a = await auftragAusfuehren(`# Missionsziel: ${t.titel}\n\n${e.body}`, z.regeln, githubForge(w.aufrufer, z.forge, z.regeln), { starten: true, trocken: false });
        neu = a.trocken ? undefined : a.ziele[0];
        if (!neu) throw new Error('kein Missionsziel angelegt');
        if (!kommentar(w.aufrufer, z.forge, issue, lernAngelegtKommentar(v, neu, z.regeln.ready_label))) gescheitert = `Missionsziel #${neu.nummer} angelegt, Kommentar mit seiner Nummer gescheitert`;
      } catch (err) {
        gescheitert = `Kommentar steht, Missionsziel gescheitert: ${(err as Error).message.slice(0, 300)}`;
      }
    }
    out.tickets.push({ ...basis, ergebnis: e.art, geschrieben: true, kommentar: text, ...(neu ? { missionsziel: neu.nummer } : {}), ...(gescheitert ? { fehler: gescheitert } : {}), sitzung: r.sitzung, ...warum });
  }
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
      ziele.push({ repo, forge: wert(argv, '--forge') ?? githubRepoAus(text, repo, aufrufer), regeln: regelnAus(text), lernIssue: liesAdapter(text).lern_issue });
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
