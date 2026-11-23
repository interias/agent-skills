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
import { auftragAusfuehren, missionAnlegen, missionszielAnhaengen, mitMissionszielen, TRIAGE_LABEL, type AuftragsRegeln } from '../auftrag/auftrag.ts';
import { githubForge } from '../auftrag/github.ts';
import { admiralWerkzeuge } from '../treiber/admiral.ts';
import { abschlusspruefung, type Abschluss } from '../triage-abschluss.ts';
import { kommentar } from '../treiber/forge.ts';
import { BERECHTIGT, entscheidungAus, GESCHLOSSEN, INFO_LABEL, lernAngelegtKommentar, lernTriageKommentar, lernvorschlaege, missionAnhaengenKommentar, missionsName, missionszielAngelegt, missionszielFehlt, nachfreigabeKommentar, neueMissionKommentar, offeneFragen, schnittplanAuftrag, schnittplanAus, schnittplanKlarKommentar, schnittplanKommentar, schnittplanReparatur, schnittplanSchema, triageAuftrag, triageKommentar, triageSchema, vonDerTriageAngelegt, wartetAufAntwort, type Entscheidung, type Lernvorschlag, type NeueMission, type OffeneMission, type Ticket, type Zuordnung, type Zuordnungsart } from '../triage.ts';
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
  /** #147: the kind the cut plan gave the note (mission, neue_mission, triage) */
  zuordnung?: Zuordnungsart;
  /** #147, klar: the mission the note hangs on now (an open one, or the one created in this run) */
  mission?: number;
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
  /** #147: a new mission is created only with at least one clear child; then nummer and url (not --trocken) */
  neue_missionen: (NeueMission & { nummer?: number; url?: string; labels?: string[]; body?: string; angehaengt?: number[]; kommentar?: string; geschrieben?: boolean; fehler?: string })[];
  /** #147: the open missions clear notes joined in this run; body: --trocken, the list that would be written */
  missionen?: { nummer: number; titel: string; kinder: number[]; angehaengt: number[]; kommentar: string; geschrieben: boolean; body?: string; fehler?: string }[];
  zuordnungen: (Zuordnung & { titel: string; url: string; geschrieben?: boolean; kommentar?: string; fehler?: string })[];
  /** the session whose plan counts (after a repair: the repair's) */
  sitzung?: string | null;
  /** #147: the first plan was invalid and got one repair call; its session and error */
  reparatur?: { sitzung: string | null; fehler: string };
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

/** #149: a mission the triage created whose ready_label a later run set (or, --trocken, would set) */
export interface Nachgeholt {
  forge: string;
  nummer: number;
  titel: string;
  /** its open children with ready_label */
  kinder: number[];
  kommentar: string;
  geschrieben: boolean;
  fehler?: string;
}

/**
 * fragen: the questions to the person asked in this run; offen (#117): those of earlier runs still without
 * an answer, so a reader of the output needs no comment of the forge. schnittplan (#146): per project the
 * cut plan made before the single clearing. nachgeholt (#149): the missions of the triage released later.
 * abschluss (#147): the final check of every note of the input (the notes for the model and the waiting ones)
 * against the forge after writing; zustand: unvollstaendig when a note misses its end state.
 */
export async function triagiere(o: TriageAuftrag, w: TriageWelt) {
  const tickets: TicketErgebnis[] = [];
  const fragen: KritischeFrage[] = [];
  const offen: KritischeFrage[] = [];
  const fehler: { forge: string; fehler: string }[] = [];
  const schnittplan: SchnittplanErgebnis[] = [];
  const nachgeholt: Nachgeholt[] = [];
  const abschluss: Abschluss = o.trocken ? { geprueft: 0, sauber: 0, abweichungen: [], entfaellt: 'trocken: nichts geschrieben, keine Abschlussprüfung' } : { geprueft: 0, sauber: 0, abweichungen: [] };
  for (const z of o.ziele) {
    let liste: Ticket[];
    try {
      liste = triageTickets(w.aufrufer, z.forge);
    } catch (err) {
      fehler.push({ forge: z.forge, fehler: (err as Error).message });
      continue;
    }
    // before the notes: only what an earlier run left; a release failing in this run waits for the next one
    try {
      nachgeholt.push(...nachfreigeben(o, w, z));
    } catch (err) {
      fehler.push({ forge: z.forge, fehler: (err as Error).message });
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
    const plan = notizen.length ? await schneide(o, w, z, notizen, schnittplan) : null;
    // #147: the clear notes per mission of the plan; written after the single clearing, mission by mission
    const klare = new Map<string, Klar[]>();
    for (const { t, zu } of plan?.bleiben ?? []) {
      const basis = { forge: z.forge, nummer: t.nummer, titel: t.titel, url: t.url, zuordnung: zu.art };
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
      const warum = { herkunft: e.herkunft, grund: e.grund };
      if (e.art === 'klar') {
        // #147: never released on its own (else each note were a run again); `triage` in the plan stays in triage,
        // a later cut plan puts it into a mission. The others wait for their mission below.
        const erg: TicketErgebnis = { ...basis, ergebnis: 'klar', geschrieben: false, kommentar: null, sitzung: r.sitzung, ...warum };
        tickets.push(erg);
        if (zu.art === 'triage') continue;
        const ziel = zu.art === 'mission' ? `#${zu.mission}` : `neu:${zu.neue_mission}`;
        klare.set(ziel, [...(klare.get(ziel) ?? []), { t, zu, e, erg }]);
        continue;
      }
      const entfernt = LABELS.filter((l) => t.labels.includes(l));
      const text = triageKommentar(e, t, entfernt, z.regeln.ready_label);
      if (e.art === 'kritisch') {
        for (const f of e.fragen.filter((f) => f.beim_menschen)) fragen.push({ forge: z.forge, ticket: t.nummer, url: t.url, frage: f.frage, optionen: f.optionen, empfehlung: f.antwort, grund: f.grund, herkunft: f.herkunft, marke: f.marke ?? '' });
      }
      if (o.trocken) {
        tickets.push({ ...basis, ergebnis: e.art, geschrieben: false, kommentar: text, sitzung: r.sitzung, ...warum });
        continue;
      }
      // the comment first: no ticket changes without its origin standing at it
      if (!kommentar(w.aufrufer, z.forge, t.nummer, text)) {
        tickets.push({ ...basis, ergebnis: e.art, geschrieben: false, kommentar: text, fehler: 'Kommentar gescheitert, nichts geändert', sitzung: r.sitzung, ...warum });
        continue;
      }
      let gescheitert: string | undefined;
      if (e.art === 'ueberfluessig') {
        const x = w.aufrufer('gh', ['issue', 'close', String(t.nummer), '--repo', z.forge, '--reason', 'not planned']);
        if (x.code) gescheitert = `Kommentar steht, Schließen gescheitert: ${(x.stderr || x.stdout).trim().slice(0, 300)}`;
      }
      tickets.push({ ...basis, ergebnis: e.art, geschrieben: true, kommentar: text, ...(gescheitert ? { fehler: gescheitert } : {}), sitzung: r.sitzung, ...warum });
    }
    if (plan && klare.size) await freigeben(o, w, z, plan, klare);
    if (z.lernIssue) await lernTriage(o, w, z, z.lernIssue, { tickets, fragen, offen, fehler });
    if (!o.trocken) {
      // #147: a mission and a stranger's ticket are no notes the run works off (README, "Triage")
      const eingabe = liste.filter((t) => notizen.includes(t) || (!t.labels.includes(z.regeln.epic_label) && wartetAufAntwort(t)));
      const neu = schnittplan.filter((p) => p.forge === z.forge).flatMap((p) => p.neue_missionen.flatMap((m) => (m.nummer === undefined ? [] : [m.nummer])));
      const abw = abschlusspruefung(w.aufrufer, z.forge, z.regeln, eingabe, neu);
      abschluss.geprueft += eingabe.length;
      abschluss.sauber += eingabe.length - abw.length;
      abschluss.abweichungen.push(...abw);
    }
  }
  const zustand: 'beendet' | 'unvollstaendig' = abschluss.abweichungen.length ? 'unvollstaendig' : 'beendet';
  return { trocken: o.trocken, tickets, fragen, offen, fehler, schnittplan, nachgeholt, abschluss, zustand };
}

/**
 * #146: one admiral call cuts the plan over all notes of the project that go to the model; the program checks
 * it (schnittplanAus). An invalid plan writes nothing and leaves no note for the single clearing. A valid one
 * closes the merged, superfluous and rejected notes (the comment with origin first, then `not planned`, never
 * deleted) and returns the notes that stay, for the single clearing as before.
 */
async function schneide(o: TriageAuftrag, w: TriageWelt, z: TriageZiel, notizen: Ticket[], out: SchnittplanErgebnis[]): Promise<Geplant | null> {
  let missionen: OffeneMission[];
  try {
    missionen = offeneMissionen(w.aufrufer, z.forge, z.regeln);
  } catch (err) {
    out.push({ forge: z.forge, neue_missionen: [], zuordnungen: [], fehler: `offene Missionen nicht lesbar: ${(err as Error).message.slice(0, 300)}` });
    return null;
  }
  const fahre = (auftrag: string) =>
    w.starte({
      ...(o.programm ?? {}),
      repo: z.repo,
      konto: o.konto,
      auftrag,
      modell: o.modell,
      // read only, like the single clearing
      extraArgs: ['--json-schema', JSON.stringify(schnittplanSchema()), '--tools', 'Read,Grep,Glob'],
      werkzeuge: admiralWerkzeuge,
      leerlaufMs: 10 * 60_000,
      log: o.log ?? null,
    });
  const auftrag = schnittplanAuftrag(notizen, missionen);
  let r = await fahre(auftrag);
  let p = schnittplanAus(r.strukturiert, notizen, missionen);
  let reparatur: SchnittplanErgebnis['reparatur'];
  // #147: the model answered, but the plan breaks a rule: one repair call with the error and its answer. Without an
  // answer the call itself failed (exit, timeout, limit); the same order again would fail the same way.
  if (p.art === 'ungueltig' && r.strukturiert) {
    reparatur = { sitzung: r.sitzung, fehler: p.fehler };
    r = await fahre(schnittplanReparatur(auftrag, p.fehler, r.strukturiert));
    p = schnittplanAus(r.strukturiert, notizen, missionen);
  }
  if (p.art === 'ungueltig') {
    out.push({ forge: z.forge, neue_missionen: [], zuordnungen: [], sitzung: r.sitzung, ...(reparatur ? { reparatur } : {}), fehler: r.strukturiert ? p.fehler : `${p.fehler} (${r.fehler ?? `Exit ${r.code}`})` });
    return null;
  }
  const ergebnis: SchnittplanErgebnis = { forge: z.forge, neue_missionen: p.neue_missionen, zuordnungen: [], sitzung: r.sitzung, ...(reparatur ? { reparatur } : {}) };
  out.push(ergebnis);
  const bleiben: Geplant['bleiben'] = [];
  for (const x of p.zuordnungen) {
    const t = notizen.find((n) => n.nummer === x.notiz)!;
    const basis = { ...x, titel: t.titel, url: t.url };
    if (!GESCHLOSSEN.includes(x.art)) {
      ergebnis.zuordnungen.push(basis);
      bleiben.push({ t, zu: x });
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
  return { ergebnis, missionen, bleiben: notizen.flatMap((t) => bleiben.filter((b) => b.t === t)) };
}

/** #147: what the cut plan of a project leaves for the single clearing, and what it needs to write afterwards. */
interface Geplant {
  ergebnis: SchnittplanErgebnis;
  missionen: OffeneMission[];
  bleiben: { t: Ticket; zu: Zuordnung }[];
}

/** #147: a note the single clearing found clear, waiting for its mission. */
interface Klar {
  t: Ticket;
  zu: Zuordnung;
  e: Extract<Entscheidung, { art: 'klar' }>;
  erg: TicketErgebnis;
}

/**
 * #147: the clear notes into their missions, mission by mission. Per note first the comment with origin, then
 * its missing sections appended (an edit only when something is added); a note whose step fails stays out.
 * Then the mission: a new one through the order writer (with ready_label, its list and links), its comment
 * right after; an open one gets its comment first, then each note linked and listed. Last, Warp frei for each
 * note that hangs on it. Any failed step leaves the triage comment the last one at the note: the next run
 * waits there (wartetAufAntwort) instead of repeating a step, so nothing is created or commented twice.
 */
async function freigeben(o: TriageAuftrag, w: TriageWelt, z: TriageZiel, plan: Geplant, klare: Map<string, Klar[]>) {
  const forge = githubForge(w.aufrufer, z.forge, z.regeln);
  const ready = z.regeln.ready_label;
  const kurz = (err: unknown) => (err as Error).message.slice(0, 300);
  let labelDa = false;
  for (const [ziel, liste] of klare) {
    const neu = ziel.startsWith('neu:') ? plan.ergebnis.neue_missionen.find((m) => `neu:${m.schluessel}` === ziel)! : null;
    const alt = neu ? null : plan.missionen.find((m) => `#${m.nummer}` === ziel)!;
    const name = missionsName(neu ?? alt!);
    const bereit: Klar[] = [];
    for (const k of liste) {
      const text = schnittplanKlarKommentar(k.e, k.zu, name, LABELS.filter((l) => k.t.labels.includes(l)), ready);
      k.erg.kommentar = text;
      if (o.trocken) {
        k.erg.body = k.e.body;
        bereit.push(k);
        continue;
      }
      if (!kommentar(w.aufrufer, z.forge, k.t.nummer, text)) {
        k.erg.fehler = 'Kommentar gescheitert, nichts geändert';
        continue;
      }
      k.erg.geschrieben = true;
      if (k.e.body !== k.t.body) {
        const x = w.aufrufer('gh', ['issue', 'edit', String(k.t.nummer), '--repo', z.forge, '--body-file', '-'], { eingabe: k.e.body });
        if (x.code) {
          k.erg.fehler = `Kommentar steht, Ergänzung des Textes gescheitert: ${(x.stderr || x.stdout).trim().slice(0, 300)}`;
          continue;
        }
      }
      bereit.push(k);
    }
    if (!bereit.length) continue;
    const ziele = bereit.map((k) => ({ titel: k.t.titel, nummer: k.t.nummer }));
    const haengen: Klar[] = [];
    let neuNummer: number | undefined;
    if (neu) {
      const spaeter = neu.kinder.filter((n) => !bereit.some((k) => k.t.nummer === n)).map((n) => plan.bleiben.find((b) => b.t.nummer === n)?.t).filter((t): t is Ticket => Boolean(t));
      const text = neueMissionKommentar(neu, bereit.map((k) => k.t), spaeter, ready);
      Object.assign(neu, { kommentar: text, geschrieben: false, angehaengt: [] as number[] });
      try {
        const a = await missionAnlegen({ titel: neu.titel, text: neu.begruendung }, ziele, z.regeln, forge, { trocken: o.trocken });
        Object.assign(neu, { labels: a.mission.labels, body: a.mission.body });
        if (o.trocken) {
          neu.angehaengt = ziele.map((x) => x.nummer);
          continue;
        }
        if (a.trocken) continue;
        Object.assign(neu, { nummer: a.mission.nummer, url: a.mission.url });
        bereit.forEach((k) => (k.erg.mission = a.mission.nummer));
        if (!kommentar(w.aufrufer, z.forge, a.mission.nummer, text)) {
          neu.fehler = `Mission #${a.mission.nummer} angelegt, Kommentar mit Herkunft gescheitert; sie und ihre Missionsziele bleiben ohne ${ready}`;
          bereit.forEach((k) => (k.erg.fehler = `an Mission #${a.mission.nummer} angehängt, deren Kommentar gescheitert: ohne ${ready}`));
          continue;
        }
        neu.geschrieben = true;
        neu.angehaengt = ziele.map((x) => x.nummer);
        neuNummer = a.mission.nummer;
        haengen.push(...bereit);
      } catch (err) {
        // created, but a link failed: the mission exists (without ready_label), its number belongs in the output
        const da = (err as { mission?: { nummer: number; url: string } }).mission;
        if (da) Object.assign(neu, { nummer: da.nummer, url: da.url });
        neu.fehler = kurz(err);
        bereit.forEach((k) => (k.erg.fehler = `Kommentar steht, Mission „${neu.titel}“ nicht angelegt: ${kurz(err)}`));
        continue;
      }
    } else {
      const m = alt!;
      const text = missionAnhaengenKommentar(bereit.map((k) => ({ t: k.t, zu: k.zu })), ready);
      const eintrag: NonNullable<SchnittplanErgebnis['missionen']>[number] = { nummer: m.nummer, titel: m.titel, kinder: ziele.map((x) => x.nummer), angehaengt: [], kommentar: text, geschrieben: false };
      (plan.ergebnis.missionen ??= []).push(eintrag);
      if (o.trocken) {
        Object.assign(eintrag, { angehaengt: ziele.map((x) => x.nummer), body: mitMissionszielen(m.body, ziele) });
        continue;
      }
      // the comment at the mission before its list and its children change
      if (!kommentar(w.aufrufer, z.forge, m.nummer, text)) {
        eintrag.fehler = 'Kommentar gescheitert, nichts angehängt';
        bereit.forEach((k) => (k.erg.fehler = `Kommentar steht, Kommentar an Mission #${m.nummer} gescheitert: nicht angehängt`));
        continue;
      }
      eintrag.geschrieben = true;
      let body = m.body;
      for (const k of bereit) {
        try {
          body = await missionszielAnhaengen(forge, { nummer: m.nummer, body }, { titel: k.t.titel, nummer: k.t.nummer });
          eintrag.angehaengt.push(k.t.nummer);
          k.erg.mission = m.nummer;
          haengen.push(k);
        } catch (err) {
          k.erg.fehler = `Kommentar steht, Anhängen an Mission #${m.nummer} gescheitert: ${kurz(err)}`;
        }
      }
      m.body = body;
    }
    // Warp frei last: a note with ready_label that hangs on no mission would be a run of its own
    for (const k of haengen) {
      if (!labelDa) w.aufrufer('gh', ['label', 'create', ready, '--repo', z.forge]); // fails when it exists, which is fine
      labelDa = true;
      const entfernt = LABELS.filter((l) => k.t.labels.includes(l));
      const x = w.aufrufer('gh', ['issue', 'edit', String(k.t.nummer), '--repo', z.forge, '--add-label', ready, ...(entfernt.length ? ['--remove-label', entfernt.join(',')] : [])]);
      if (x.code) {
        k.erg.fehler = `an Mission #${k.erg.mission} angehängt, Freigabe gescheitert: ${(x.stderr || x.stdout).trim().slice(0, 300)}`;
        continue;
      }
      // a new mission gets Warp frei with its first released child, never before (its comment stands already)
      if (neu && neuNummer !== undefined) {
        const y = w.aufrufer('gh', ['issue', 'edit', String(neuNummer), '--repo', z.forge, '--add-label', ready]);
        if (y.code) neu.fehler = `Freigabe der Mission #${neuNummer} gescheitert: ${(y.stderr || y.stdout).trim().slice(0, 300)}`;
        else neu.labels = [...(neu.labels ?? []), ready];
        neuNummer = undefined;
      }
    }
  }
}

/**
 * #149: a mission the triage created gets ready_label with its first released child (freigeben); when only that
 * step failed, it stays without, though its children are released, and no run would start it. A later run sets it:
 * for each open mission without ready_label that the triage created (vonDerTriageAngelegt: its comment stands, no
 * objection below it), that never carried ready_label (a person who took it off revoked it), with at least one open
 * sub-issue with ready_label. The comment with origin first; it fails: nothing changes. --trocken only reports.
 */
function nachfreigeben(o: TriageAuftrag, w: TriageWelt, z: TriageZiel): Nachgeholt[] {
  const ready = z.regeln.ready_label;
  const r = w.aufrufer('gh', ['issue', 'list', '--repo', z.forge, '--label', z.regeln.epic_label, '--state', 'open', '--limit', '200', '--json', 'number,title,labels,comments']);
  if (r.code) throw new Error(`gh issue list ${z.forge} --label ${z.regeln.epic_label}: ${(r.stderr || r.stdout).trim()}`);
  const out: Nachgeholt[] = [];
  for (const i of JSON.parse(r.stdout || '[]') as any[]) {
    const t: Ticket = {
      nummer: Number(i.number),
      titel: String(i.title ?? ''),
      body: '',
      url: '',
      labels: (i.labels ?? []).map((l: { name: string }) => l.name),
      kommentare: (i.comments ?? []).map((c: any) => ({ body: String(c.body ?? ''), autor: String(c.author?.login ?? '?'), zeit: String(c.createdAt ?? ''), rolle: String(c.authorAssociation ?? 'NONE') })),
    };
    if (t.labels.includes(ready) || !vonDerTriageAngelegt(t)) continue;
    // read with jq, so --paginate gives lines, not concatenated arrays; a forge that does not answer: left alone
    const einmal = w.aufrufer('gh', ['api', `repos/${z.forge}/issues/${t.nummer}/events`, '--paginate', '--jq', `.[] | select(.event == "labeled" and .label.name == ${JSON.stringify(ready)}) | .id`]);
    if (einmal.code || einmal.stdout.trim()) continue;
    const k = w.aufrufer('gh', ['api', `repos/${z.forge}/issues/${t.nummer}/sub_issues`, '--paginate', '--jq', `.[] | select(.state == "open" and any(.labels[]; .name == ${JSON.stringify(ready)})) | .number`]);
    const kinder = k.code ? [] : k.stdout.split('\n').filter((x) => /^\d+$/.test(x.trim())).map(Number);
    if (!kinder.length) continue;
    const text = nachfreigabeKommentar(kinder, ready);
    const e: Nachgeholt = { forge: z.forge, nummer: t.nummer, titel: t.titel, kinder, kommentar: text, geschrieben: false };
    out.push(e);
    if (o.trocken) continue;
    if (!kommentar(w.aufrufer, z.forge, t.nummer, text)) {
      e.fehler = 'Kommentar gescheitert, nichts geändert';
      continue;
    }
    e.geschrieben = true;
    const x = w.aufrufer('gh', ['issue', 'edit', String(t.nummer), '--repo', z.forge, '--add-label', ready]);
    if (x.code) e.fehler = `Kommentar steht, Freigabe gescheitert: ${(x.stderr || x.stdout).trim().slice(0, 300)}`;
  }
  return out;
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
