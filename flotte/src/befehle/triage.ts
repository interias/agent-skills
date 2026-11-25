// flotte triage [<repo>...] [--forge <owner/name>] [--konto <k>] [--modell <m>] [--trocken]
// The triage run (#115, src/triage.ts) over the open Sternzeit-Notizen of one or more repositories.
// Holds no state of its own: a decided ticket no longer carries its triage label, an open question
// waits for a comment below it. So it can run on a schedule (flotte/README.md, "Triage"). Prints one
// JSON object: per ticket what was decided and written, and the questions to the person.
// #117: with lern_issue in the adapter also each proposal of the learning loop there, like a ticket
// (Tag O: only while the switch Lernschleife of the project is on, out of the box off);
// #170: a clear one becomes a Sternzeit-Notiz through the order writer, cut into a mission by the same plan.
// #146: one admiral call per project cuts a plan over all its notes and clears them in it (schneide); only
// notes over the size of one call are split into a few packages by topic.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { auftragAusfuehren, entwurfLesen, missionAnlegen, missionszielAnhaengen, mitMissionszielen, TRIAGE_LABEL, zielBody, type AuftragsRegeln, type Forge } from '../auftrag/auftrag.ts';
import { giteaForge } from '../auftrag/gitea.ts';
import { githubForge } from '../auftrag/github.ts';
import { adapterText, fehlerText, zugriffFuer, type ForgeZugriff, type Issue } from '../forge/zugriff.ts';
import { admiralWerkzeuge } from '../treiber/admiral.ts';
import { lernIssueFuer } from '../lernen.ts';
import { kommentar } from '../treiber/forge.ts';
import { abschlusspruefung, loseFreigaben, type Abschluss } from '../triage-abschluss.ts';
import { faktenpaket, LESEN_MAX, maxTurns } from '../triage-fakten.ts';
import { BERECHTIGT, entscheidungAus, ergaenzt, GESCHLOSSEN, INFO_LABEL, lernAngelegtKommentar, lernTriageKommentar, lernvorschlaege, missionAnhaengenKommentar, missionsName, missionszielAngelegt, missionszielFehlt, nachfreigabeKommentar, NEUE_MISSIONEN_MAX, neueMissionKommentar, offeneFragen, pakete, schnittplanAuftrag, schnittplanAus, schnittplanKlarKommentar, schnittplanKommentar, schnittplanReparatur, schnittplanSchema, triageAuftrag, triageKommentar, triageSchema, vonDerTriageAngelegt, wartetAufAntwort, type Entscheidung, type Kontext, type Lernvorschlag, type NeueMission, type OffeneMission, type Ticket, type Zuordnung, type Zuordnungsart } from '../triage.ts';
import { liesAdapter } from '../werkzeuge/belegung.ts';
import { kontoAus } from '../werkzeuge/konten.ts';
import { starte, type LaufErgebnis, type Start } from '../werkzeuge/lauf.ts';
import { schluessel } from './adapter.ts';
import { giteaRepoAus, giteaZugang, githubRepoAus, regelnAus } from './auftrag.ts';

const LABELS = [TRIAGE_LABEL, INFO_LABEL];
/** A mission with a run on it (epic/mechanik.ts): its children are read already, it takes no new ones. */
const IM_EINSATZ = 'status/in-arbeit';

export interface TriageZiel {
  repo: string;
  forge: string;
  regeln: AuftragsRegeln;
  /** #117: the collecting issue of the learning loop (adapter key lern_issue); its proposals are triaged too */
  lernIssue?: number | null;
  /** only these notes in this run (the choice in the Frachtraum; lernIssue stands for its proposals); without it all */
  nummern?: number[];
}

export interface TriageAuftrag {
  ziele: TriageZiel[];
  konto: string;
  modell: string;
  trocken: boolean;
  log?: string | null;
  programm?: Pick<Start, 'programm' | 'programmArgs'>;
  /** #167: file accesses of the model per call (setting triageLesenMax), LESEN_MAX without */
  lesenMax?: number;
}

export interface TriageWelt {
  aufrufer: Aufrufer;
  starte: (s: Start) => Promise<LaufErgebnis>;
  /** #147: the run was aborted (Ctrl+C, a stopping driver): from then on nothing is written, no final check */
  abgebrochen?: () => boolean;
  /** #127: HTTP of the order writer's Gitea side (default fetch); everything else goes through the aufrufer */
  abruf?: typeof fetch;
}

/** #127: the forge of a project as its adapter names it: the forge layer, and the order writer's side like flotte auftrag. */
function forgeVon(z: TriageZiel, w: TriageWelt): { zugriff: ForgeZugriff; auftrag: Forge } {
  const text = adapterText(z.repo);
  const zugriff = zugriffFuer(z.repo, w.aufrufer, z.forge);
  if (zugriff.art !== 'gitea') return { zugriff, auftrag: githubForge(w.aufrufer, z.forge, z.regeln) };
  return { zugriff, auftrag: giteaForge(schluessel(text, 'api')!, () => giteaZugang(text, z.repo, w.aufrufer), z.regeln, w.abruf) };
}

const ticketAus = (i: Issue): Ticket => ({
  nummer: i.nummer,
  titel: i.titel,
  body: i.body,
  url: i.url,
  labels: i.labels,
  kommentare: i.kommentare.map((k) => ({ body: k.body, autor: k.autor, zeit: k.zeit, rolle: k.rolle })),
});

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
  /** #146: the program left the note on `triage`, its sections failed the check (why, and where it was to go) */
  herabgestuft?: string;
  /** #146: the plan left the note on `triage` without a question with the person; the program asked one */
  fragenErgaenzt?: boolean;
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
export function triageTickets(z: ForgeZugriff): Ticket[] {
  const alle = new Map<number, Ticket>();
  for (const label of LABELS) {
    let liste: Issue[];
    try {
      liste = z.issues(label, ['number', 'title', 'body', 'url', 'labels', 'comments'], 200);
    } catch (e) {
      throw new Error(`Notizen ${z.repo} mit ${label} nicht lesbar: ${fehlerText(e)}`);
    }
    for (const i of liste) alle.set(i.nummer, ticketAus(i));
  }
  return [...alle.values()].sort((x, y) => x.nummer - y.nummer);
}

/** #117: the proposals of the learning loop at the collecting issue, each with the comments naming it. */
export function lernTickets(z: ForgeZugriff, issue: number): Lernvorschlag[] {
  let i: Issue;
  try {
    i = z.issue(issue, ['comments']);
  } catch (e) {
    throw new Error(`Sammel-Issue ${z.repo}#${issue} nicht lesbar: ${fehlerText(e)}`);
  }
  return lernvorschlaege(issue, i.kommentare);
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
  /** the session whose plan counts (after a repair: the repair's; with packages: the last one's) */
  sitzung?: string | null;
  /** #147: the first plan was invalid and got one repair call; its session and error */
  reparatur?: { sitzung: string | null; fehler: string };
  /** #146: the admiral calls for the notes of this project: 1, one more per repair, one per package above the size limit */
  aufrufe: number;
  /** #146: only when the notes were split by topic: per package its notes, session and repair */
  pakete?: { notizen: number[]; sitzung: string | null; reparatur?: { sitzung: string | null; fehler: string } }[];
  /** an invalid plan, or the open missions not readable: nothing written for the notes of this project in this run */
  fehler?: string;
}

/**
 * #146: the open missions a note may join: open, not `status/in-arbeit` (a run there has read its children
 * already), with the number of their children. One whose children cannot be read is left out.
 */
export function offeneMissionen(z: ForgeZugriff, regeln: AuftragsRegeln): OffeneMission[] {
  let liste: Issue[];
  try {
    liste = z.issues(regeln.epic_label, ['number', 'title', 'body', 'labels'], 200);
  } catch (e) {
    throw new Error(`Missionen ${z.repo} mit ${regeln.epic_label} nicht lesbar: ${fehlerText(e)}`);
  }
  const out: OffeneMission[] = [];
  for (const i of liste) {
    if (i.labels.includes(IM_EINSATZ)) continue;
    let kinder: number;
    try {
      kinder = z.kinder(i.nummer).length;
    } catch {
      continue;
    }
    out.push({ nummer: i.nummer, titel: i.titel, body: i.body, kinder, labels: i.labels });
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
 * cut plan that cleared its notes. nachgeholt (#149): the missions of the triage released later.
 * abschluss (#147): the final check of every note of the input (the notes for the model and the waiting ones)
 * against the forge after writing; zustand: unvollstaendig when a note misses its end state.
 */
export async function triagiere(o: TriageAuftrag, welt: TriageWelt) {
  // #167: duration and tool calls (the file accesses) of every admiral call of the run, for the logbook
  const messung = { aufrufe: 0, dauerMs: 0, zugriffe: 0 };
  const w: TriageWelt = {
    ...welt,
    starte: async (s) => {
      const r = await welt.starte(s);
      messung.aufrufe++;
      messung.dauerMs += r.dauerMs ?? 0;
      messung.zugriffe += r.zugriffe ?? 0;
      return r;
    },
  };
  const tickets: TicketErgebnis[] = [];
  const fragen: KritischeFrage[] = [];
  const offen: KritischeFrage[] = [];
  const fehler: { forge: string; fehler: string }[] = [];
  const schnittplan: SchnittplanErgebnis[] = [];
  const nachgeholt: Nachgeholt[] = [];
  const ab = () => w.abgebrochen?.() ?? false;
  const abschluss: Abschluss = o.trocken ? { geprueft: 0, sauber: 0, abweichungen: [], entfaellt: 'trocken: nichts geschrieben, keine Abschlussprüfung' } : { geprueft: 0, sauber: 0, abweichungen: [] };
  for (const z of o.ziele) {
    let liste: Ticket[];
    let f: ReturnType<typeof forgeVon>;
    try {
      f = forgeVon(z, w);
      liste = triageTickets(f.zugriff);
    } catch (err) {
      fehler.push({ forge: z.forge, fehler: (err as Error).message });
      continue;
    }
    // the notes not chosen stay untouched with their label for the next run, outside the final check too
    const gewaehlt = z.nummern ? new Set(z.nummern) : null;
    if (gewaehlt) liste = liste.filter((t) => gewaehlt.has(t.nummer));
    // before the notes: only what an earlier run left; a release failing in this run waits for the next one
    try {
      if (!ab()) nachgeholt.push(...nachfreigeben(o, f.zugriff, z));
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
      let rolle: string | null = null;
      let unlesbar: string | null = null;
      try {
        rolle = f.zugriff.autorRolle(t.nummer);
      } catch (e) {
        unlesbar = fehlerText(e);
      }
      if (rolle === null || !BERECHTIGT.includes(rolle)) {
        tickets.push({ ...basis, ergebnis: 'fremd', geschrieben: false, kommentar: null, ...(unlesbar !== null ? { fehler: `Rolle des Autors nicht lesbar: ${unlesbar}` } : {}) });
        continue;
      }
      notizen.push(t);
    }
    // #167: the facts of the project, read once before the first admiral call of the run
    let gelesen: Kontext | undefined;
    const kontext = () => (gelesen ??= { fakten: faktenpaket(z.repo, f.zugriff, notizen), lesenMax: o.lesenMax ?? LESEN_MAX });
    // #170: before the plan, so a clear proposal joins it as a note and never stands loose with ready_label
    if (z.lernIssue && (!gewaehlt || gewaehlt.has(z.lernIssue)) && !ab()) notizen.push(...(await lernTriage(o, w, f, z, z.lernIssue, { tickets, fragen, offen, fehler }, kontext)));
    const plan = notizen.length && !ab() ? await schneide(o, w, f.zugriff, z, notizen, schnittplan, kontext) : null;
    // #146: the plan has cleared every note that stays (no call per note); #147: the clear ones per mission of the
    // plan, written mission by mission below
    const klare = new Map<string, Klar[]>();
    // #147: aborted after the plan: its questions are not written either
    for (const { t, zu, sitzung } of ab() ? [] : (plan?.bleiben ?? [])) {
      const basis = { forge: z.forge, nummer: t.nummer, titel: t.titel, url: t.url, zuordnung: zu.art, sitzung, herkunft: zu.herkunft, grund: zu.grund, ...(zu.herabgestuft ? { herabgestuft: zu.herabgestuft } : {}), ...(zu.fragenErgaenzt ? { fragenErgaenzt: true } : {}) };
      const offen = zu.fragen.filter((f) => f.beim_menschen);
      if (!offen.length) {
        // #147: never released on its own (else each note were a run again); they wait for their mission below.
        // #146: `triage` never gets here, schnittplanAus gave it a question.
        const erg: TicketErgebnis = { ...basis, ergebnis: 'klar', geschrieben: false, kommentar: null };
        tickets.push(erg);
        // the sections passed the check in schnittplanAus already
        const neu = ergaenzt(t.titel, t.body, zu, z.regeln);
        const e = { art: 'klar', herkunft: zu.herkunft, grund: zu.grund, fragen: zu.fragen, body: neu.body, nachgetragen: neu.nachgetragen } as const;
        const ziel = zu.art === 'mission' ? `#${zu.mission}` : `neu:${zu.neue_mission}`;
        klare.set(ziel, [...(klare.get(ziel) ?? []), { t, zu, e, erg }]);
        continue;
      }
      // a question with the person: only the comment, the note stays in triage and joins its mission after the answer
      const text = triageKommentar(zu, t, LABELS.filter((l) => t.labels.includes(l)));
      for (const f of offen) fragen.push({ forge: z.forge, ticket: t.nummer, url: t.url, frage: f.frage, optionen: f.optionen, empfehlung: f.antwort, grund: f.grund, herkunft: f.herkunft, marke: f.marke ?? '' });
      if (o.trocken) {
        tickets.push({ ...basis, ergebnis: 'kritisch', geschrieben: false, kommentar: text });
        continue;
      }
      const steht = kommentar(f.zugriff, t.nummer, text);
      tickets.push({ ...basis, ergebnis: 'kritisch', geschrieben: steht, kommentar: text, ...(steht ? {} : { fehler: 'Kommentar gescheitert, nichts geändert' }) });
    }
    // #147: before each block that writes: after an abort nothing more
    if (plan && klare.size && !ab()) await freigeben(o, f, z, plan, klare);
    if (!o.trocken && !ab()) {
      // #147: a mission and a stranger's ticket are no notes the run works off (README, "Triage"); #170: the notes
      // of the learning loop are
      const eingabe = [...liste, ...notizen.filter((t) => !liste.includes(t))].filter((t) => notizen.includes(t) || (!t.labels.includes(z.regeln.epic_label) && wartetAufAntwort(t)));
      const neu = schnittplan.filter((p) => p.forge === z.forge).flatMap((p) => p.neue_missionen.flatMap((m) => (m.nummer === undefined ? [] : [m.nummer])));
      const abw = abschlusspruefung(f.zugriff, z.regeln, eingabe, neu);
      abschluss.geprueft += eingabe.length;
      abschluss.sauber += eingabe.length - abw.length;
      abschluss.abweichungen.push(...abw);
      // #170: and every other open ticket with ready_label that hangs on no open mission: no run would start it
      try {
        abschluss.abweichungen.push(...loseFreigaben(f.zugriff, z.regeln, new Set(eingabe.map((t) => t.nummer))));
      } catch (err) {
        fehler.push({ forge: z.forge, fehler: (err as Error).message });
      }
    }
  }
  if (ab()) Object.assign(abschluss, { geprueft: 0, sauber: 0, abweichungen: [], entfaellt: 'abgebrochen: nach dem Abbruch nichts mehr geschrieben, keine Abschlussprüfung' });
  const zustand: 'beendet' | 'unvollstaendig' | 'abgebrochen' = ab() ? 'abgebrochen' : abschluss.abweichungen.length ? 'unvollstaendig' : 'beendet';
  return { trocken: o.trocken, tickets, fragen, offen, fehler, schnittplan, nachgeholt, abschluss, zustand, messung };
}

/**
 * #146: one admiral call cuts the plan over all notes of the project that go to the model and clears each of them
 * in it (questions, sections); the program checks it (schnittplanAus). Notes over the size of one call go in a few
 * packages by topic (pakete), one call each; the limits hold over all packages together, each next one gets what
 * the earlier ones left. An invalid plan (of any package) writes nothing for the project. A valid one closes the
 * merged, superfluous and rejected notes (the comment with origin first, then `not planned`, never deleted) and
 * returns the notes that stay.
 */
async function schneide(o: TriageAuftrag, w: TriageWelt, forge: ForgeZugriff, z: TriageZiel, notizen: Ticket[], out: SchnittplanErgebnis[], kontext: () => Kontext): Promise<Geplant | null> {
  let missionen: OffeneMission[];
  try {
    missionen = offeneMissionen(forge, z.regeln);
  } catch (err) {
    out.push({ forge: z.forge, neue_missionen: [], zuordnungen: [], aufrufe: 0, fehler: `offene Missionen nicht lesbar: ${(err as Error).message.slice(0, 300)}` });
    return null;
  }
  const fahre = (auftrag: string) =>
    w.starte({
      ...(o.programm ?? {}),
      repo: z.repo,
      konto: o.konto,
      auftrag,
      modell: o.modell,
      // read only, like the admiral: ADRs and code are facts; #167: most of them come with the order, the rest is capped
      extraArgs: ['--json-schema', JSON.stringify(schnittplanSchema()), '--tools', 'Read,Grep,Glob', '--max-turns', maxTurns(kontext().lesenMax)],
      werkzeuge: admiralWerkzeuge,
      leerlaufMs: 10 * 60_000,
      log: o.log ?? null,
    });
  const teile = pakete(notizen);
  const ergebnis: SchnittplanErgebnis = { forge: z.forge, neue_missionen: [], zuordnungen: [], aufrufe: 0 };
  const geplant: { zu: Zuordnung; sitzung: string | null }[] = [];
  // the free places of the open missions and the new missions left, for the next package
  const frei = missionen.map((m) => ({ ...m }));
  let neuMax = NEUE_MISSIONEN_MAX;
  for (const [i, teil] of teile.entries()) {
    const auftrag = schnittplanAuftrag(teil, frei, z.regeln, neuMax, kontext());
    let r = await fahre(auftrag);
    ergebnis.aufrufe++;
    let p = schnittplanAus(r.strukturiert, teil, frei, z.regeln, neuMax);
    let reparatur: SchnittplanErgebnis['reparatur'];
    // #147: the model answered, but the plan breaks a rule: one repair call with the error and its answer, the only
    // second call (#146). Without an answer the call itself failed (exit, timeout, limit); the same order again
    // would fail the same way.
    if (p.art === 'ungueltig' && r.strukturiert) {
      reparatur = { sitzung: r.sitzung, fehler: p.fehler };
      r = await fahre(schnittplanReparatur(auftrag, p.fehler, r.strukturiert));
      ergebnis.aufrufe++;
      // the last plan: a note whose sections still fail stays on `triage`, the rest of the plan counts
      p = schnittplanAus(r.strukturiert, teil, frei, z.regeln, neuMax, true);
    }
    ergebnis.sitzung = r.sitzung;
    if (reparatur) ergebnis.reparatur = reparatur;
    if (teile.length > 1) (ergebnis.pakete ??= []).push({ notizen: teil.map((t) => t.nummer), sitzung: r.sitzung, ...(reparatur ? { reparatur } : {}) });
    if (p.art === 'ungueltig') {
      out.push({ ...ergebnis, neue_missionen: [], zuordnungen: [], fehler: r.strukturiert ? p.fehler : `${p.fehler} (${r.fehler ?? `Exit ${r.code}`})` });
      return null;
    }
    // a key of an earlier package stays its own: the later new mission gets the number of its package behind it,
    // as often as the new key is taken, by an earlier package or by another mission of this one
    const vergeben = (m: NeueMission) => ergebnis.neue_missionen.some((n) => n.schluessel === m.schluessel) || p.neue_missionen.some((n) => n !== m && n.schluessel === m.schluessel);
    for (const m of p.neue_missionen) {
      const alt = m.schluessel;
      if (!ergebnis.neue_missionen.some((n) => n.schluessel === alt)) continue;
      while (vergeben(m)) m.schluessel = `${m.schluessel}-${i + 1}`;
      for (const x of p.zuordnungen) if (x.art === 'neue_mission' && x.neue_mission === alt) x.neue_mission = m.schluessel;
    }
    ergebnis.neue_missionen.push(...p.neue_missionen);
    neuMax -= p.neue_missionen.length;
    for (const x of p.zuordnungen) {
      if (x.art === 'mission') frei.find((m) => m.nummer === x.mission)!.kinder++;
      geplant.push({ zu: x, sitzung: r.sitzung });
    }
  }
  // #147: aborted meanwhile: the plan is not written
  if (w.abgebrochen?.()) {
    out.push({ ...ergebnis, neue_missionen: [], zuordnungen: [], fehler: 'abgebrochen, nichts geschrieben' });
    return null;
  }
  out.push(ergebnis);
  const bleiben: Geplant['bleiben'] = [];
  for (const { zu: x, sitzung } of geplant) {
    const t = notizen.find((n) => n.nummer === x.notiz)!;
    const basis = { ...x, titel: t.titel, url: t.url };
    if (!GESCHLOSSEN.includes(x.art)) {
      ergebnis.zuordnungen.push(basis);
      bleiben.push({ t, zu: x, sitzung });
      continue;
    }
    const text = schnittplanKommentar(x);
    if (o.trocken) {
      ergebnis.zuordnungen.push({ ...basis, geschrieben: false, kommentar: text });
      continue;
    }
    // the comment first: no note is closed without its origin standing at it
    if (!kommentar(forge, t.nummer, text)) {
      ergebnis.zuordnungen.push({ ...basis, geschrieben: false, kommentar: text, fehler: 'Kommentar gescheitert, nichts geändert' });
      continue;
    }
    let zu: string | null = null;
    try {
      forge.schliessen(t.nummer, { nichtGeplant: true });
    } catch (e) {
      zu = fehlerText(e);
    }
    ergebnis.zuordnungen.push({ ...basis, geschrieben: true, kommentar: text, ...(zu !== null ? { fehler: `Kommentar steht, Schließen gescheitert: ${zu}` } : {}) });
  }
  // in the order of the tickets
  return { ergebnis, missionen, bleiben: notizen.flatMap((t) => bleiben.filter((b) => b.t === t)) };
}

/** #147: the notes the cut plan of a project leaves open (with the session of their plan), and what it needs to write afterwards. */
interface Geplant {
  ergebnis: SchnittplanErgebnis;
  missionen: OffeneMission[];
  bleiben: { t: Ticket; zu: Zuordnung; sitzung: string | null }[];
}

/** #147: a note the cut plan found clear, waiting for its mission. */
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
async function freigeben(o: TriageAuftrag, f: ReturnType<typeof forgeVon>, z: TriageZiel, plan: Geplant, klare: Map<string, Klar[]>) {
  const forge = f.auftrag;
  const zugriff = f.zugriff;
  /** a label change; the forge's text when it fails, else null */
  const labels = (nr: number, x: { dazu?: string[]; weg?: string[] }) => {
    try {
      zugriff.labelsAendern(nr, x);
      return null;
    } catch (e) {
      return fehlerText(e);
    }
  };
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
      if (!kommentar(zugriff, k.t.nummer, text)) {
        k.erg.fehler = 'Kommentar gescheitert, nichts geändert';
        continue;
      }
      k.erg.geschrieben = true;
      if (k.e.body !== k.t.body) {
        try {
          zugriff.bodySetzen(k.t.nummer, k.e.body);
        } catch (e) {
          k.erg.fehler = `Kommentar steht, Ergänzung des Textes gescheitert: ${fehlerText(e)}`;
          continue;
        }
      }
      bereit.push(k);
    }
    if (!bereit.length) continue;
    const ziele = bereit.map((k) => ({ titel: k.t.titel, nummer: k.t.nummer }));
    const haengen: Klar[] = [];
    let neuNummer: number | undefined;
    // #170: the triage labels an open mission still carries; its comment names them, they go with its first released child
    let abnehmen: string[] = [];
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
        if (!kommentar(zugriff, a.mission.nummer, text)) {
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
      abnehmen = LABELS.filter((l) => m.labels?.includes(l));
      const text = missionAnhaengenKommentar(bereit.map((k) => ({ t: k.t, zu: k.zu })), ready, abnehmen);
      const eintrag: NonNullable<SchnittplanErgebnis['missionen']>[number] = { nummer: m.nummer, titel: m.titel, kinder: ziele.map((x) => x.nummer), angehaengt: [], kommentar: text, geschrieben: false };
      (plan.ergebnis.missionen ??= []).push(eintrag);
      if (o.trocken) {
        Object.assign(eintrag, { angehaengt: ziele.map((x) => x.nummer), body: mitMissionszielen(m.body, ziele) });
        continue;
      }
      // the comment at the mission before its list and its children change
      if (!kommentar(zugriff, m.nummer, text)) {
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
      try {
        // an existing one stays as it is; a failure shows up in the release below
        if (!labelDa) zugriff.labelAnlegen(ready);
      } catch {}
      labelDa = true;
      const x = labels(k.t.nummer, { dazu: [ready], weg: LABELS.filter((l) => k.t.labels.includes(l)) });
      if (x !== null) {
        k.erg.fehler = `an Mission #${k.erg.mission} angehängt, Freigabe gescheitert: ${x}`;
        continue;
      }
      // a new mission gets Warp frei with its first released child, never before (its comment stands already)
      if (neu && neuNummer !== undefined) {
        const y = labels(neuNummer, { dazu: [ready] });
        if (y !== null) neu.fehler = `Freigabe der Mission #${neuNummer} gescheitert: ${y}`;
        else neu.labels = [...(neu.labels ?? []), ready];
        neuNummer = undefined;
      }
      if (alt && abnehmen.length) {
        const y = labels(alt.nummer, { weg: abnehmen });
        const eintrag = plan.ergebnis.missionen?.find((x) => x.nummer === alt.nummer);
        if (y !== null && eintrag) eintrag.fehler = `${abnehmen.join(', ')} an der Mission nicht abgenommen: ${y}`;
        else alt.labels = alt.labels?.filter((l) => !abnehmen.includes(l));
        abnehmen = [];
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
function nachfreigeben(o: TriageAuftrag, forge: ForgeZugriff, z: TriageZiel): Nachgeholt[] {
  const ready = z.regeln.ready_label;
  let liste: Issue[];
  try {
    liste = forge.issues(z.regeln.epic_label, ['number', 'title', 'labels', 'comments'], 200);
  } catch (e) {
    throw new Error(`Missionen ${forge.repo} mit ${z.regeln.epic_label} nicht lesbar: ${fehlerText(e)}`);
  }
  const out: Nachgeholt[] = [];
  for (const i of liste) {
    const t: Ticket = { ...ticketAus(i), body: '', url: '' };
    if (t.labels.includes(ready) || !vonDerTriageAngelegt(t)) continue;
    // a forge that does not answer: left alone
    let kinder: number[];
    try {
      if (forge.labelJeGesetzt(t.nummer, ready)) continue;
      kinder = forge.kinder(t.nummer).filter((k) => k.zustand === 'OPEN' && k.labels.includes(ready)).map((k) => k.nummer);
    } catch {
      continue;
    }
    if (!kinder.length) continue;
    const text = nachfreigabeKommentar(kinder, ready);
    const e: Nachgeholt = { forge: z.forge, nummer: t.nummer, titel: t.titel, kinder, kommentar: text, geschrieben: false };
    out.push(e);
    if (o.trocken) continue;
    if (!kommentar(forge, t.nummer, text)) {
      e.fehler = 'Kommentar gescheitert, nichts geändert';
      continue;
    }
    e.geschrieben = true;
    try {
      forge.labelsAendern(t.nummer, { dazu: [ready] });
    } catch (err) {
      e.fehler = `Kommentar steht, Freigabe gescheitert: ${fehlerText(err)}`;
    }
  }
  return out;
}

/**
 * #117: each proposal of the learning loop at the collecting issue through the same procedure as a
 * ticket. All comments go to the collecting issue and name the kennung of the proposal; clear: the
 * decision first, then the note through the order writer, then its number. #170: the note carries
 * needs-triage, not ready_label; returned, it joins the cut plan of the same run like any note, so a
 * proposal never becomes a loose Missionsziel. Decided proposals and open questions wait for an answer
 * naming the kennung in its first line.
 */
async function lernTriage(o: TriageAuftrag, w: TriageWelt, f: ReturnType<typeof forgeVon>, z: TriageZiel, issue: number, out: { tickets: TicketErgebnis[]; fragen: KritischeFrage[]; offen: KritischeFrage[]; fehler: { forge: string; fehler: string }[] }, kontext: () => Kontext): Promise<Ticket[]> {
  let liste: Lernvorschlag[];
  try {
    liste = lernTickets(f.zugriff, issue);
  } catch (err) {
    out.fehler.push({ forge: z.forge, fehler: (err as Error).message });
    return [];
  }
  const notizen: Ticket[] = [];
  for (const v of liste) {
    if (w.abgebrochen?.()) break;
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
      auftrag: triageAuftrag(t, z.regeln, v, kontext()),
      modell: o.modell,
      extraArgs: ['--json-schema', JSON.stringify(triageSchema()), '--tools', 'Read,Grep,Glob', '--max-turns', maxTurns(kontext().lesenMax)],
      werkzeuge: admiralWerkzeuge,
      leerlaufMs: 10 * 60_000,
      log: o.log ?? null,
    });
    // #147: aborted during the call: nothing is written for it
    if (w.abgebrochen?.()) break;
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
    if (!kommentar(f.zugriff, issue, text)) {
      out.tickets.push({ ...basis, ergebnis: e.art, geschrieben: false, kommentar: text, fehler: 'Kommentar gescheitert, nichts angelegt', sitzung: r.sitzung, ...warum });
      continue;
    }
    let neu: { nummer: number; url: string } | undefined;
    let gescheitert: string | undefined;
    if (e.art === 'klar') {
      try {
        const entwurf = `# Missionsziel: ${t.titel}\n\n${e.body}`;
        const a = await auftragAusfuehren(entwurf, z.regeln, f.auftrag, { starten: false, trocken: false });
        neu = a.trocken ? undefined : a.ziele[0];
        if (!neu) throw new Error('keine Sternzeit-Notiz angelegt');
        if (!kommentar(f.zugriff, issue, lernAngelegtKommentar(v, neu, z.regeln.ready_label))) gescheitert = `Sternzeit-Notiz #${neu.nummer} angelegt, Kommentar mit ihrer Nummer gescheitert`;
        // the body as the order writer wrote it, so the plan appends nothing that is there already
        notizen.push({ nummer: neu.nummer, titel: t.titel, body: zielBody(entwurfLesen(entwurf).ziele[0], undefined), url: neu.url, labels: [TRIAGE_LABEL], kommentare: [] });
      } catch (err) {
        gescheitert = `Kommentar steht, Missionsziel gescheitert: ${(err as Error).message.slice(0, 300)}`;
      }
    }
    out.tickets.push({ ...basis, ergebnis: e.art, geschrieben: true, kommentar: text, ...(neu ? { missionsziel: neu.nummer } : {}), ...(gescheitert ? { fehler: gescheitert } : {}), sitzung: r.sitzung, ...warum });
  }
  return notizen;
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
      // #127: a Gitea project takes owner/name from its api; the forge itself is chosen by the adapter (forgeVon)
      const forge = schluessel(text, 'forge') === 'gitea' ? giteaRepoAus(text) : (wert(argv, '--forge') ?? githubRepoAus(text, repo, aufrufer));
      // Tag O: the proposals only while the switch Lernschleife of the project is on (the driver's state)
      ziele.push({ repo, forge, regeln: regelnAus(text), lernIssue: lernIssueFuer(repo, liesAdapter(text).lern_issue, aufrufer) });
    } catch (e) {
      fehler.push({ repo, fehler: (e as Error).message });
    }
  }
  // #147: Ctrl+C ends the admiral call under way with its whole process tree (it runs detached), then the run
  // writes nothing more and prints what it wrote so far
  const abbruch = new AbortController();
  const stopp = () => abbruch.abort('Ctrl+C');
  process.once('SIGINT', stopp);
  let r: Awaited<ReturnType<typeof triagiere>>;
  try {
    r = await triagiere(
      { ziele, konto: kontoAus(wert(argv, '--konto') ?? '1'), modell: wert(argv, '--modell') ?? 'fable', trocken: argv.includes('--trocken') },
      { aufrufer, starte: (s) => starte({ ...s, abbruch: abbruch.signal }), abgebrochen: () => abbruch.signal.aborted },
    );
  } finally {
    process.off('SIGINT', stopp);
  }
  if (abbruch.signal.aborted) process.exitCode = 130;
  return { ...r, repos: ziele.map((z) => ({ repo: z.repo, forge: z.forge })), fehler: [...fehler, ...r.fehler] };
}
