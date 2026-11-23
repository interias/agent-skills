// flotte mission: the package loop of /mission as a program (#69). A state machine per package —
// wartend → startbereit → implementer → reviewer → pruefung → merge → fertig or zurueckgelassen —
// and around it the window, the RAM brake, the escalation ladder, max_rounds, blocking successors,
// state and resume. Language models are only the content of a state, each one call (Aufrufe);
// scripts, tests, git and the forge stand behind Mechanik. Stage 1 (#65) runs both as stand-ins
// with a script (attrappe.ts); stage 2 (#66) put the real Mechanik behind the interface, stage 3
// (#67) the real calls (aufrufe.ts) with their schemata (schemata.ts) and orders (auftraege.ts).
//
// One takt: apply what has finished, take answers, then fill the window. Everything that waits
// (a call, the test runs of 4c, a merge) runs beside the loop; the loop never waits on it. The
// state is written after every transition; each transition can be repeated without harm.

import { buchstabenAus } from '../werkzeuge/bloecke.ts';
import type { LaufErgebnis } from '../werkzeuge/lauf.ts';
import type { Ram } from '../werkzeuge/ressourcen.ts';
import { entsperren, lebt, sperren } from '../werkzeuge/zustand.ts';
import { commitNachricht, implementerAuftrag, konfliktAuftrag, reviewerAuftrag, schnittAuftrag, type Kontext } from './auftraege.ts';
import { alleNachfolger, bewerteAufruf, endeBlock, flakeKandidaten, frageBlock, hoeher, IMPLEMENTER, istEnde, laeuft, nachfolger, nachpruefung, REVIEWER, rot, startbereit, wahl, geparkt, type BlockFrage, type Nachpruefung } from './regeln.ts';
import { abdeckungFehler, type Paket, type Rolle } from './schema.ts';
import { SCHEMATA, type JsonSchema } from './schemata.ts';
import { epicDir, liesLauf, neuesPaket, schreibeLauf, type AufrufStand, type EpicLaufZustand, type Ereignis, type PaketZustand, type Testlauf } from './zustand.ts';

export interface Aufruf {
  rolle: Rolle;
  paket: string | null;
  runde: number;
  /** agent type of the role (agents/), null for cut and conflict */
  agent: string | null;
  modell: string;
  effort: string;
  /** CLAUDE_CONFIG_DIR of the account the driver gives the epic */
  konto: string;
  cwd: string;
  auftrag: string;
  /** the session to continue; null: a new call */
  resume: string | null;
  /** the output schema of the role (schemata.ts), for --json-schema */
  schema: JsonSchema;
}

/** the language-model points: each a `claude -p --output-format stream-json --json-schema` (decision 2) */
export interface Aufrufe {
  /** beiSitzung as soon as the init event names the session, before any result */
  rufe(a: Aufruf, beiSitzung: (sitzung: string) => void): Promise<LaufErgebnis>;
  /** the account takes calls again after a limit (P20) */
  kontoFrei(): Promise<boolean>;
}

/** commit null: the branch has no commits of its own and is in the epic branch already, nothing to merge */
export type MergeVersuch = { ok: true; commit: string | null } | { ok: false; dateien: string[] };

export type StatusLabel = 'status/in-arbeit' | 'status/blockiert' | 'status/haengt';

/** one entry of worktree.ps1 CleanupStale */
export interface Aufgeraeumt {
  kind: string;
  id?: string | number | null;
  path?: string | null;
  branch?: string | null;
  action: 'stopped' | 'removed' | 'skipped' | string;
  reason?: string | null;
}

/** scripts of mission/scripts (called, not rebuilt), the adapter's test commands, git and the forge */
export interface Mechanik {
  /** worktree.ps1 CleanupStale at every program start: what dead sessions left behind (the locks of this epic stay, they have a holder) */
  aufraeumen(): Promise<Aufgeraeumt[]>;
  /** worktree.ps1 Up: takes an existing branch again; port and isolation of the worktree for the order of 4a, kopf its HEAD (the epic head the package starts on, for the order of 4b) */
  up(name: string, branch: string, von: string): Promise<{ worktree: string; port?: number | null; isolation?: string | null; kopf?: string | null }>;
  /** worktree.ps1 Down; a dirty worktree stays */
  down(name: string): Promise<{ schmutzig: boolean }>;
  /** git branch -d in the epic worktree */
  branchLoeschen(branch: string): Promise<void>;
  /** ram.ps1 */
  ram(): Promise<Ram>;
  /** the slot (mission/SKILL.md, rule 12): busy while a full stack of the project runs */
  slot(): Promise<{ belegt: boolean }>;
  /** test_commands of the adapter, all suites */
  volllauf(worktree: string): Promise<Testlauf>;
  /** one red file alone, with the adapter's worker limit: true when green */
  einzeln(worktree: string, datei: string): Promise<boolean>;
  /** lint_commands: findings per file */
  lint(worktree: string): Promise<Record<string, number>>;
  /** files the package changed against its start */
  beruehrt(worktree: string): Promise<string[]>;
  /** 4d: commits what the package left in its worktree on its branch; the commit, null when nothing was left */
  sichern(worktree: string, nachricht: string): Promise<string | null>;
  /** the merge commit that brought the package branch into the epic branch; null when it is not there (git merge-base --is-ancestor, git log --merges) */
  imEpic(branch: string): Promise<string | null>;
  /** git merge --no-ff in the epic worktree */
  merge(branch: string): Promise<MergeVersuch>;
  /** commits a merge whose conflict the conflict call resolved; the merge commit */
  mergeAbschliessen(): Promise<string>;
  /** git merge --abort; nothing to do when no merge is in progress (a repeated abort after a stop) */
  mergeAbbrechen(): Promise<void>;
  /** git diff --quiet <branch> HEAD: the tree after the merge is the one 4c checked */
  baumGleich(branch: string): Promise<boolean>;
  /** git revert -m 1 <commit>; the revert commit */
  revert(commit: string): Promise<string>;
  /** graph.ps1: build the code graph (phase 0b) and rebuild it after a merge; optional, not available is no error; pfad: its graph.json */
  graph(): Promise<{ available: boolean; grund?: string; pfad?: string }>;
  /** the body of an issue (the target issue: children and user stories for the check of the cut) */
  body(ticket: number): Promise<string>;
  kommentare(ticket: number): Promise<string[]>;
  kommentar(ticket: number, text: string): Promise<void>;
  /** sets one status label and takes the other two off, then reads it back (mission/SKILL.md, "Die Statuslabels"); a text when it still is wrong after a second try (a Glut point, no stop) */
  status(ticket: number, label: StatusLabel): Promise<string | null>;
  /** 2d: the target issue gets status/in-arbeit and epic_label; a text as with status */
  eroeffnung(): Promise<string | null>;
  /** Phase 6: push, pull request (title of the issue, WIP: while something lies with the person), the target issue loses status/in-arbeit (fehler: as with status); never a merge */
  abschluss(x: { wip: boolean; body: string }): Promise<{ pr: string | null; fehler?: string | null }>;
}

/** the driver protocol (decision 5): FLOTTE-FRAGE and FLOTTE-ENDE out, answers in */
export interface Leitung {
  melde(block: string): void;
  antworten(): { frage: number; antwort: string }[];
}

export interface Umgebung {
  aufrufe: Aufrufe;
  mechanik: Mechanik;
  leitung: Leitung;
  /** until the next takt */
  warte(): Promise<void>;
  jetzt(): number;
}

export interface EpicEinstellung {
  repo: string;
  epic: number;
  epicBranch: string;
  /** where the epic branch comes from: <push_remote>/<basis> */
  basis: string;
  /** places of the window, at most 3 */
  fenster: number;
  maxRunden: number;
  konto: string;
  /** .claude/epic.md of the target repository for the orders and the commit of 4d; missing: '' */
  adapter?: string;
  /** the lock's owner; tests set another pid and liveness */
  pid?: number;
  istLebendig?: (pid: number) => boolean;
}

type MergeErgebnis = { art: 'gemergt' } | { art: 'rot' } | { art: 'konflikt' } | { art: 'inhaltlich'; grund: string } | { art: 'fehler'; grund: string };

type Erledigt = { art: 'aufruf'; schluessel: string; rolle: Rolle; r: LaufErgebnis } | { art: 'pruefung'; nr: string; n: Nachpruefung } | { art: 'merge'; nr: string; m: MergeErgebnis };

const SCHNITT = 'schnitt';
/** under the driver there is no run board (mission/references/lauftafel.md, "Lauftafel aus") */
const LAUFTAFEL = 'Lauftafel aus (Flotten-Treiber)';
const FUENF_MIN = 5 * 60_000;
const flach = (s: string) => s.replace(/\s+/g, ' ').trim();
const FORTSETZEN = 'Setze deine Arbeit an der Stelle fort, an der du warst, und gib dein Ergebnis im Schema aus.';

/** Runs one epic until FLOTTE-ENDE. A second program for the same epic is refused (P21). */
export async function fahreEpic(e: EpicEinstellung, u: Umgebung): Promise<EpicLaufZustand> {
  const dir = epicDir(e.repo, e.epic);
  const pid = e.pid ?? process.pid;
  const sperre = sperren(dir, pid, e.istLebendig ?? lebt);
  if (!sperre.ok) throw new Error(`flotte mission ${e.epic} läuft schon (PID ${sperre.pid} seit ${sperre.seit}); kein zweites Programm für dieselbe Mission`);
  try {
    return await new EpicLauf({ ...e, fenster: Math.min(3, Math.max(1, e.fenster)) }, u, dir).fahre();
  } finally {
    entsperren(dir, pid);
  }
}

class EpicLauf {
  readonly z: EpicLaufZustand;
  private readonly m: Mechanik;
  private readonly erledigt: Erledigt[] = [];
  /** calls started whose result is not applied yet */
  private readonly laufend = new Set<string>();
  /** the package in the command channel (4c or merge): never two full runs at once */
  private befehl: string | null = null;
  private fehler: unknown = null;
  /** labels and opening comment at the target issue, once per program run (both repeatable) */
  private eroeffnet = false;

  constructor(
    private readonly e: EpicEinstellung,
    private readonly u: Umgebung,
    private readonly dir: string,
  ) {
    this.z = liesLauf(dir, e.epic);
    this.m = u.mechanik;
  }

  private speichere() {
    schreibeLauf(this.dir, this.z);
  }

  private zeit() {
    return new Date(this.u.jetzt()).toISOString();
  }

  private ereignis(art: Ereignis['art'], paket: string | null, text: string, rolle?: Rolle) {
    this.z.ereignisse.push({ takt: this.z.takt, zeit: this.zeit(), paket, art, ...(rolle ? { rolle } : {}), text });
  }

  private paket(nr: string): Paket {
    return this.z.schnitt.ergebnis!.pakete.find((p) => p.nr === nr)!;
  }

  private ticket(nr: string): number {
    return /^\d+$/.test(nr) ? Number(nr) : this.e.epic;
  }

  /** a comment only once: the marker says it is there already (decision 7) */
  private async kommentiere(nr: string, art: string, text: string) {
    const ticket = this.ticket(nr);
    const marker = `<!-- flotte-epic:${this.e.epic}:${nr}:${art} -->`;
    if ((await this.m.kommentare(ticket)).some((k) => k.includes(marker))) return;
    await this.m.kommentar(ticket, `${text}\n\n${marker}`);
  }

  /** status labels go to a package's own ticket; a package of a spec without children has none */
  private async status(nr: string, label: StatusLabel) {
    if (/^\d+$/.test(nr)) this.glut(await this.m.status(Number(nr), label), nr);
  }

  /** a Glut point (a label that would not stick): an event and an open point at the end, the run goes on */
  private glut(text: string | null | undefined, paket: string | null) {
    if (!text) return;
    (this.z.offenePunkte ??= []).push(text);
    this.ereignis('glut', paket, text);
    this.speichere();
  }

  async fahre(): Promise<EpicLaufZustand> {
    const z = this.z;
    if (z.phase === 'fertig' || z.phase === 'abgebrochen') return z;
    // a start on a state with events is a restart; flotte messen measures from here to the first worker (#68)
    if (z.ereignisse.length) this.ereignis('neustart', null, 'Programm neu gestartet, laufende Aufrufe gehen mit --resume weiter');
    // Phase 0a: what dead sessions left behind, at every start; the locks of this epic stay. A failed
    // step ("failed: …", exit 1), a dirty worktree or a remnant is reported too, only living or held locks are not
    for (const r of await this.m.aufraeumen()) if (r.action !== 'skipped' || !(r.kind === 'lock' && /^(held by|session )/.test(r.reason ?? ''))) this.ereignis('aufraeumen', null, `${r.kind} ${r.path ?? r.id ?? ''}: ${r.action}${r.reason ? ` (${r.reason})` : ''}`);
    // Phase 0 and 3: epic worktree and Ausgangszahlen
    if (!z.epicWorktree) {
      try {
        z.epicWorktree = (await this.m.up(`epic-${this.e.epic}`, this.e.epicBranch, this.e.basis)).worktree;
      } catch (f) {
        // exit 1 of Up: the message word for word, nothing done by hand (mission/SKILL.md, Phase 3)
        await this.abbrechen(`Missions-Worktree nicht gerüstet: ${(f as Error).message}`, false);
        return z;
      }
      this.speichere();
    }
    if (!z.basis) {
      z.basis = await this.m.volllauf(z.epicWorktree);
      z.basisLint = await this.m.lint(z.epicWorktree);
      this.speichere();
    }
    // Phase 0b: the code graph goes into every order (4a, 4b); not available is no error
    if (z.graph === undefined) {
      const g = await this.m.graph();
      z.graph = g.available ? (g.pfad ?? null) : null;
      this.speichere();
    }
    if (z.phase === 'ruesten') {
      z.phase = 'schnitt';
      this.speichere();
    }
    // a restart while gate points are open: the driver gets the open block again (it holds no state of ours)
    this.offeneFragen();
    for (;;) {
      if (this.fehler) throw this.fehler;
      z.takt++;
      for (const x of this.erledigt.splice(0)) await this.anwenden(x);
      await this.antworten();
      if (z.phase === 'schnitt') await this.schnitt();
      if (z.phase === 'tor') await this.tor();
      // schnitt() and tor() may have ended the run
      if ((z.phase as string) === 'abgebrochen') return z;
      if (z.phase === 'pakete') {
        if (!this.eroeffnet) await this.eroeffnen();
        await this.blockiereNachfolger();
        await this.konto();
        await this.starte();
        this.aufrufe();
        this.befehle();
        this.startbereitNachtragen();
        if (Object.values(z.pakete).every(istEnde) && !this.laufend.size && !this.befehl) {
          await this.abschluss();
          return z;
        }
      }
      this.speichere();
      await this.u.warte();
    }
  }

  // ---- calls

  private rufe(schluessel: string, stand: AufrufStand, a: Omit<Aufruf, 'auftrag' | 'resume' | 'konto' | 'schema'>, auftrag: () => string) {
    const resume = stand.sitzung;
    const text = resume ? (stand.fortsetzen ?? FORTSETZEN) : auftrag();
    stand.fortsetzen = null;
    this.laufend.add(schluessel);
    this.ereignis('aufruf', a.paket, `${a.rolle}${a.agent ? ` (${a.agent})` : ''}, Runde ${a.runde}${resume ? `, --resume ${resume}` : ''}`, a.rolle);
    this.u.aufrufe
      .rufe({ ...a, konto: this.e.konto, auftrag: text, resume, schema: SCHEMATA[a.rolle] }, (sitzung) => {
        stand.sitzung = sitzung;
        this.speichere();
      })
      .then(
        (r) => this.erledigt.push({ art: 'aufruf', schluessel, rolle: a.rolle, r }),
        (f) => (this.fehler ??= f),
      );
  }

  /**
   * A call without usable result: permission_denials block, an account limit waits, otherwise one
   * --resume with the error (P8, P9); after that the call is used up and the caller starts anew.
   */
  private fehlschlag(stand: AufrufStand, b: { art: string; fehler: string }, paket: string | null, rolle: Rolle): 'fortsetzen' | 'verbraucht' | 'verweigert' | 'konto' {
    // every invalid output stands in the log (#68 counts them)
    if (b.art === 'ungueltig') this.ereignis('ungueltig', paket, `${rolle} ungültig: ${b.fehler}`, rolle);
    if (b.art === 'verweigert') return 'verweigert';
    if (b.art === 'konto') {
      stand.wartet = 'konto';
      this.z.konto.gesperrt = true;
      this.ereignis('konto', paket, `wartet: ${b.fehler}`);
      return 'konto';
    }
    if (stand.resumes === 0 && stand.sitzung) {
      stand.resumes = 1;
      stand.fortsetzen =
        b.art === 'ungueltig'
          ? `Deine Ausgabe passt nicht zum Schema: ${b.fehler}. Gib dein Ergebnis im Schema aus.`
          : `Dein Aufruf endete ohne Ergebnis (${b.fehler}). Fahre jeden Befehl im Vordergrund zu Ende und gib dein Ergebnis im Schema aus.`;
      return 'fortsetzen';
    }
    stand.sitzung = null;
    stand.resumes = 0;
    stand.fortsetzen = null;
    return 'verbraucht';
  }

  private neuerAufruf(p: PaketZustand) {
    p.sitzung = null;
    p.resumes = 0;
    p.fortsetzen = null;
  }

  /** starts the call of every package and of the cut that has none running (also after a restart: --resume) */
  private aufrufe() {
    if (this.z.konto.gesperrt) return;
    for (const p of Object.values(this.z.pakete)) {
      if ((p.stufe !== 'implementer' && p.stufe !== 'reviewer') || p.wartet || this.laufend.has(p.nr)) continue;
      const b = p.stufe === 'implementer' ? IMPLEMENTER[p.klasse] : REVIEWER[p.klasse];
      this.rufe(p.nr, p, { rolle: p.stufe, paket: p.nr, runde: p.runde, agent: b.agent, modell: b.modell, effort: b.effort, cwd: p.worktree ?? '' }, () => (p.stufe === 'implementer' ? this.implementerAuftrag(p) : this.reviewerAuftrag(p)));
    }
    // an open merge conflict: the conflict call in the epic worktree, like any other call (session, --resume, account limit)
    for (const p of Object.values(this.z.pakete)) {
      const k = p.konflikt;
      if (p.stufe !== 'merge' || !k || k.ergebnis || p.wartet || this.laufend.has(p.nr)) continue;
      const b = IMPLEMENTER[p.klasse];
      this.rufe(p.nr, p, { rolle: 'konflikt', paket: p.nr, runde: p.runde, agent: null, modell: b.modell, effort: b.effort, cwd: this.z.epicWorktree! }, () => konfliktAuftrag(this.kontext(), this.paket(p.nr), p));
    }
  }

  private async schnitt() {
    const s = this.z.schnitt;
    if (s.wartet) await this.konto();
    if (s.wartet || this.z.konto.gesperrt || this.laufend.has(SCHNITT)) return;
    this.rufe(SCHNITT, s, { rolle: 'schnitt', paket: null, runde: 1, agent: null, modell: 'opus', effort: 'medium', cwd: this.z.epicWorktree! }, () => schnittAuftrag(this.kontext()));
  }

  // ---- applying results

  private async anwenden(x: Erledigt) {
    if (x.art === 'aufruf') {
      this.laufend.delete(x.schluessel);
      if (x.schluessel === SCHNITT) return this.schnittZurueck(x.r);
      const p = this.z.pakete[x.schluessel];
      if (!p || p.stufe !== (x.rolle === 'konflikt' ? 'merge' : x.rolle)) return;
      p.sitzung = x.r.sitzung ?? p.sitzung;
      if (x.rolle === 'konflikt') return this.konfliktZurueck(p, x.r);
      return x.rolle === 'implementer' ? this.implementerZurueck(p, x.r) : this.reviewerZurueck(p, x.r);
    }
    this.befehl = null;
    const p = this.z.pakete[x.nr];
    if (x.art === 'pruefung') return this.pruefungZurueck(p, x.n);
    return this.mergeZurueck(p, x.m);
  }

  private async schnittZurueck(r: LaufErgebnis) {
    const s = this.z.schnitt;
    s.sitzung = r.sitzung ?? s.sitzung;
    let b = bewerteAufruf('schnitt', r);
    // the form against the target issue: a story or a child left out of the model's own lists
    if (b.art === 'ok') {
      const f = abdeckungFehler(b.daten, await this.m.body(this.e.epic));
      if (f) b = { art: 'ungueltig', fehler: f };
    }
    if (b.art !== 'ok') {
      const folge = this.fehlschlag(s, b, null, 'schnitt');
      if (folge === 'fortsetzen' || folge === 'konto') return this.speichere();
      return this.abbrechen(`Schnitt ohne gültiges Ergebnis: ${b.fehler}`);
    }
    s.ergebnis = b.daten;
    s.sitzung = null;
    s.resumes = 0;
    for (const p of b.daten.pakete) this.z.pakete[p.nr] ??= neuesPaket(p);
    const fragen: BlockFrage[] = [];
    b.daten.tor.forEach((t, i) => {
      const nr = this.z.fragen.length + 1;
      this.z.fragen.push({ nr, art: 'tor', punkt: i, betrifft: t.betrifft, antwort: null, abgelehnt: false, erledigt: false });
      fragen.push({ nr, frage: t.frage, betrifft: t.betrifft, lage: t.lage, optionen: t.optionen.map((o) => o.text), empfehlung: t.empfehlung, grund: t.grund, quelle: t.quelle });
    });
    this.z.phase = b.daten.tor.some((t) => t.betrifft === 'Lauf') ? 'tor' : 'pakete';
    if (fragen.length) {
      this.ereignis('frage', null, `Vorab-Tor: ${fragen.length} Punkte`);
      this.u.leitung.melde(frageBlock(this.e.epic, 'tor', fragen, `Vorab-Tor, ${b.daten.pakete.length} Pakete geschnitten`));
    }
    this.speichere();
  }

  private async implementerZurueck(p: PaketZustand, r: LaufErgebnis) {
    const b = bewerteAufruf('implementer', r);
    // the model the init line names, for the Co-Authored-By line of 4d
    p.modell = r.modell ?? p.modell ?? null;
    if (b.art === 'ok') {
      p.bericht = b.daten;
      p.zeiten.implementerZurueck = this.zeit();
      p.stufe = 'reviewer';
      p.uebernehmen = false;
      p.befund = [];
      this.neuerAufruf(p);
      this.ereignis('zurueck', p.nr, `Ingenieur zurück, Runde ${p.runde}`, 'implementer');
      return this.speichere();
    }
    const folge = this.fehlschlag(p, b, p.nr, 'implementer');
    if (folge === 'verweigert') return this.zuruecklassen(p, `Ingenieur: ${b.fehler}`);
    if (folge === 'verbraucht') return this.neueRunde(p, [`Ingenieur ohne gültigen Bericht: ${b.fehler}`], false, 'implementer', true);
    this.speichere();
  }

  private async reviewerZurueck(p: PaketZustand, r: LaufErgebnis) {
    const b = bewerteAufruf('reviewer', r);
    if (b.art === 'ok') {
      p.review = b.daten;
      p.zeiten.reviewerZurueck = this.zeit();
      this.neuerAufruf(p);
      this.ereignis('zurueck', p.nr, `Erster Offizier zurück, Runde ${p.runde}, ${b.daten.befunde.length} Befunde${b.daten.strukturell ? ', strukturell' : ''}`, 'reviewer');
      // only a Muss finding starts a round (mission/SKILL.md, 4b); a structural one a rung higher
      const muss = b.daten.befunde.filter((f) => f.gruppe === 'muss');
      if (!muss.length) {
        p.stufe = 'pruefung';
        return this.speichere();
      }
      return this.neueRunde(p, muss.map((f) => `${f.fundstelle}: ${f.text}`), b.daten.strukturell, 'implementer', false);
    }
    const folge = this.fehlschlag(p, b, p.nr, 'reviewer');
    if (folge === 'verweigert') return this.zuruecklassen(p, `Erster Offizier: ${b.fehler}`);
    if (folge === 'verbraucht') return this.neueRunde(p, [`Erster Offizier ohne gültigen Bericht: ${b.fehler}`], false, 'reviewer', false);
    this.speichere();
  }

  /** the next round, or left behind after max_rounds (P5, P6, P7) */
  private async neueRunde(p: PaketZustand, befund: string[], strukturell: boolean, rolle: 'implementer' | 'reviewer', uebernehmen: boolean) {
    if (p.runde >= this.e.maxRunden) return this.zuruecklassen(p, `max_rounds (${this.e.maxRunden}) erreicht; letzter Befund: ${befund.join('; ')}`);
    p.runde++;
    p.stufe = rolle;
    p.befund = rolle === 'implementer' ? befund : p.befund;
    p.uebernehmen = uebernehmen;
    this.neuerAufruf(p);
    if (strukturell && hoeher(p.klasse) !== p.klasse) {
      const von = p.klasse;
      p.klasse = hoeher(von);
      const grund = befund.join('; ');
      p.eskalationen.push({ runde: p.runde, von, nach: p.klasse, grund });
      this.ereignis('eskalation', p.nr, `${von} → ${p.klasse}: ${grund}`);
      this.speichere();
      await this.kommentiere(p.nr, `eskalation-${p.runde}`, `**Eskalation** Paket ${p.nr}, Runde ${p.runde}: ${von} → ${p.klasse}, der Erste Offizier folgt (${REVIEWER[p.klasse].agent}). Die Paketklasse war falsch geschätzt.\nBefund: ${grund}`);
    }
    this.speichere();
  }

  private async pruefungZurueck(p: PaketZustand, n: Nachpruefung) {
    if (p.stufe !== 'pruefung') return;
    for (const f of n.lastflakes) {
      p.lastflakes.push(f);
      this.ereignis('lastflake', p.nr, f);
    }
    if (!n.ok) return this.neueRunde(p, n.befunde, false, 'implementer', false);
    p.stufe = 'merge';
    p.zeiten.abgenommen = this.zeit();
    this.ereignis('abgenommen', p.nr, n.lastflakes.length ? `abgenommen, Lastflake vermerkt` : 'abgenommen');
    this.speichere();
  }

  /**
   * The verdict of the conflict call; the merge job finishes or aborts the merge. A call without a
   * usable result is resumed once, an account limit waits (P20); after that, or on denials, the
   * conflict counts as not resolved.
   */
  private async konfliktZurueck(p: PaketZustand, r: LaufErgebnis) {
    const k = p.konflikt!;
    const b = bewerteAufruf('konflikt', r);
    if (b.art === 'ok') {
      k.ergebnis = b.daten.ergebnis;
      k.begruendung = b.daten.begruendung;
      this.neuerAufruf(p);
      this.ereignis('zurueck', p.nr, `Konflikt-Aufruf zurück: ${k.ergebnis}`, 'konflikt');
      return this.speichere();
    }
    const folge = this.fehlschlag(p, b, p.nr, 'konflikt');
    if (folge === 'verweigert' || folge === 'verbraucht') {
      k.ergebnis = 'inhaltlich';
      k.begruendung = `Konflikt-Aufruf ohne gültiges Ergebnis: ${b.fehler}`;
      this.neuerAufruf(p);
    }
    this.speichere();
  }

  private async mergeZurueck(p: PaketZustand, m: MergeErgebnis): Promise<void> {
    if (p.stufe !== 'merge') return;
    // the conflict call runs as a call of its own; the state already holds the conflict
    if (m.art === 'konflikt') return this.speichere();
    if (m.art === 'rot') return this.zuruecklassen(p, `Missions-Branch nach dem Andocken rot, zurückgenommen mit Revert ${p.revertCommit}`);
    if (m.art === 'inhaltlich') return this.zuruecklassen(p, `Andock-Konflikt, inhaltlich: ${m.grund}`);
    if (m.art === 'fehler') return this.mergeFehler(p, m.grund);
    p.stufe = 'fertig';
    p.zeiten.gemergt = this.zeit();
    p.zeiten.ende = p.zeiten.gemergt;
    this.ereignis('gemergt', p.nr, p.nichtsZuMergen ? `${p.branch}: nichts anzudocken` : `${p.branch} angedockt (${p.mergeCommit})`);
    this.speichere();
    await this.kommentiere(p.nr, 'gemergt', this.gemergtText(p));
  }

  /**
   * A step of the merge job failed. Before the epic branch was checked, the merge is taken back
   * (an open merge aborted, a merge commit reverted) and the package left behind; after it, the
   * package is in the epic branch and only the clean-up failed: merged, the failure an open point.
   */
  private async mergeFehler(p: PaketZustand, grund: string): Promise<void> {
    if (p.epicGeprueft) {
      this.glut(`Paket ${p.nr}: Aufräumen nach dem Andocken gescheitert: ${grund}`, p.nr);
      return this.mergeZurueck(p, { art: 'gemergt' });
    }
    let text = `Andock-Schritt gescheitert: ${grund}`;
    try {
      await this.m.mergeAbbrechen();
      if (p.mergeCommit && !p.revertCommit) {
        p.revertCommit = await this.m.revert(p.mergeCommit);
        this.speichere();
      }
    } catch (f) {
      text += `; Zurücknehmen gescheitert: ${flach(f instanceof Error ? f.message : String(f))}`;
    }
    return this.zuruecklassen(p, text);
  }

  private zahlen(t: Testlauf): string {
    return t.map((s) => `${s.name} ${s.tests} Tests in ${s.dateien ?? '?'} Dateien, ${s.rot.length} rot`).join('; ');
  }

  /** mission/SKILL.md, Phase 5, point 4: acceptance points with their places, verification against phase 0, the line Zeiten: */
  private gemergtText(p: PaketZustand): string {
    const z = p.zeiten;
    const ms = (x?: string) => (x ? Date.parse(x) : NaN);
    const warten = (
      [
        [z.reviewerZurueck, z.pruefungBeginn, 'Nachprüfung wartete auf den Befehlskanal (Volllauf oder Andocken eines anderen Pakets)'],
        [z.abgenommen, z.mergeBeginn, 'Andocken wartete auf den Befehlskanal'],
      ] as [string | undefined, string | undefined, string][]
    )
      .filter(([von, bis]) => ms(bis) - ms(von) > FUENF_MIN)
      .map(([von, bis, grund]) => `${Math.round((ms(bis) - ms(von)) / 60_000)} min ${grund}`);
    const warn = this.z.ereignisse.filter((e) => e.art === 'ram' && e.text.startsWith('warn') && (e.text.split('Start: ')[1] ?? '').split(', ').includes(p.nr));
    const epicLauf = p.nichtsZuMergen
      ? 'Lauf auf dem Missions-Branch entfällt: nichts angedockt'
      : p.epicLauf
        ? `Missions-Branch nach dem Andocken: ${this.zahlen(p.epicLauf)}`
        : `Lauf auf dem Missions-Branch entfällt: git diff --quiet ${p.branch} HEAD endete mit 0`;
    return [
      p.nichtsZuMergen
        ? `**Angedockt** Paket ${p.nr}: nichts anzudocken, ${p.branch} hat keine eigenen Commits und liegt schon im Missions-Branch ${this.e.epicBranch}; kein Andock-Commit.`
        : `**Angedockt** Paket ${p.nr}: ${p.branch} im Missions-Branch ${this.e.epicBranch}, Andock-Commit ${p.mergeCommit}.`,
      ...(p.bericht?.abnahme.length ? ['Abnahme:', ...p.bericht.abnahme.map((x) => `- ${x.punkt}: ${x.satz}`)] : []),
      `Verifikation (4c, Volllauf im Paket-Worktree): ${p.testlauf ? this.zahlen(p.testlauf) : 'keine Zahlen'}; Ausgangszahlen: ${this.zahlen(this.z.basis ?? [])}.`,
      epicLauf,
      ...(p.review?.selbstkorrekturen.length ? [`Vom Ersten Offizier selbst korrigiert: ${p.review.selbstkorrekturen.join('; ')}`] : []),
      ...(p.lastflakes.length ? [`Lastflakes: ${p.lastflakes.join('; ')}`] : []),
      ...(p.eskalationen.length ? [`Eskalationen: ${p.eskalationen.map((x) => `Runde ${x.runde} ${x.von} → ${x.nach}`).join('; ')}`] : []),
      ...warn.map((e) => `RAM beim Start: ${e.text}`),
      `Zeiten: Start ${z.start}, Ingenieur zurück ${z.implementerZurueck}, Erster Offizier zurück ${z.reviewerZurueck}, abgenommen ${z.abgenommen}, angedockt ${z.gemergt}${warten.length ? `; Wartezeiten: ${warten.join('; ')}` : ''}`,
    ].join('\n');
  }

  private commitNachricht(p: PaketZustand): string {
    return commitNachricht(this.kontext(), this.paket(p.nr), p, this.ticket(p.nr));
  }

  // ---- leaving behind and blocking

  /** mission/SKILL.md, "Zurücklassen": the branch stays, Down, comment, status/haengt; the run goes on */
  private async zuruecklassen(p: PaketZustand, grund: string) {
    if (istEnde(p)) return;
    if (p.worktree) {
      const d = await this.m.down(p.nr);
      if (d.schmutzig) grund += '; der Worktree ist schmutzig und bleibt stehen';
    }
    await this.kommentiere(p.nr, 'zurueckgelassen', `**Zurückgelassen** Paket ${p.nr}: ${grund}. Der Branch ${p.branch} bleibt stehen.${p.revertCommit ? ` Revert-Commit ${p.revertCommit}; zurückholen = Revert des Reverts.` : ''}`);
    await this.status(p.nr, 'status/haengt');
    p.stufe = 'zurueckgelassen';
    p.grund = grund;
    p.wartet = null;
    p.zeiten.ende = this.zeit();
    this.neuerAufruf(p);
    this.ereignis('zurueckgelassen', p.nr, grund);
    this.speichere();
  }

  /** every successor of a package left behind or blocked: blocked, commented, status/blocked (P7) */
  private async blockiereNachfolger() {
    for (const q of Object.values(this.z.pakete)) {
      if (q.stufe !== 'zurueckgelassen' && q.stufe !== 'blockiert') continue;
      for (const n of alleNachfolger(this.z, q.nr)) {
        const s = this.z.pakete[n];
        if (!s || !['wartend', 'startbereit'].includes(s.stufe)) continue;
        const durch = q.stufe === 'blockiert' ? (q.blockiertDurch ?? q.nr) : q.nr;
        await this.kommentiere(n, 'blockiert', `**Blockiert** Paket ${n}: es hängt an Paket ${durch}, das zurückgelassen wurde.`);
        await this.status(n, 'status/blockiert');
        s.stufe = 'blockiert';
        s.blockiertDurch = durch;
        s.grund = `blockiert durch ${durch}`;
        s.zeiten.ende = this.zeit();
        this.ereignis('blockiert', n, `blockiert durch ${durch}`);
        this.speichere();
      }
    }
  }

  // ---- the window

  /** RAM brake and slot before starting (mission/SKILL.md, "Die RAM-Bremse", rule 12): hold or a busy slot starts nothing; ok, a release or a free slot goes on (P19) */
  private async starte() {
    if (this.z.konto.gesperrt) return;
    const kandidaten = wahl(this.z, this.e.fenster);
    if (!kandidaten.length) return;
    const ram = await this.m.ram();
    const hold = ram.level === 'hold' || Boolean(ram.fehler);
    let starts = kandidaten;
    if (hold && !this.z.ram.freigabe) {
      if (!this.z.ram.halt) {
        this.z.ram.halt = true;
        this.ereignis('ram', null, `hold${ram.percent_used !== null ? ` bei ${ram.percent_used} %` : ''}${ram.fehler ? `: ${ram.fehler}` : ''}; kein neuer Start, laufende Pakete laufen weiter`);
      }
      if (this.z.ram.frage === null) {
        const nr = this.z.fragen.length + 1;
        this.z.fragen.push({ nr, art: 'ram', punkt: null, betrifft: kandidaten, antwort: null, abgelehnt: false, erledigt: false });
        this.z.ram.frage = nr;
        this.u.leitung.melde(
          frageBlock(this.e.epic, 'ram', [{ nr, frage: 'Die RAM-Bremse steht auf hold. Warten oder trotzdem starten?', betrifft: kandidaten, lage: ram.fehler ? `Messung fehlgeschlagen: ${ram.fehler}` : `ram.ps1 meldet hold (${ram.percent_used ?? '?'} % belegt); laufende Pakete laufen weiter`, optionen: ['warten bis ok', 'trotz hold starten (gilt für den nächsten Start)'], empfehlung: 'A', grund: 'ein voller Speicher reißt alle laufenden Pakete mit', quelle: 'mission/SKILL.md, Die RAM-Bremse' }], 'RAM-Bremse hold, kein neuer Start'),
        );
      }
      this.speichere();
      return;
    }
    // the slot is busy (a full stack of the project runs): wait like hold, running packages go on (P19)
    const slot = await this.m.slot();
    if (slot.belegt !== this.z.slot.belegt) {
      this.z.slot.belegt = slot.belegt;
      this.ereignis('slot', null, slot.belegt ? 'belegt: ein voller Stack des Projekts läuft; kein neuer Start, laufende Pakete laufen weiter' : 'frei, Starts gehen weiter');
      this.speichere();
    }
    if (slot.belegt) return;
    if (hold) {
      // a release counts for the next start
      starts = kandidaten.slice(0, 1);
      this.z.ram.freigabe = false;
    } else if (this.z.ram.halt) {
      this.z.ram.halt = false;
      const f = this.z.fragen.find((x) => x.nr === this.z.ram.frage);
      if (f && f.antwort === null) f.erledigt = true;
      this.z.ram.frage = null;
      this.ereignis('ram', null, `${ram.level}, Starts gehen weiter`);
    }
    // warn starts; the reading stands with the start (mission/SKILL.md, "Die RAM-Bremse")
    if (ram.level === 'warn') this.ereignis('ram', null, `warn bei ${ram.percent_used ?? '?'} %, Start: ${starts.join(', ')}`);
    for (const nr of starts) await this.starteEines(this.z.pakete[nr]);
  }

  private async starteEines(p: PaketZustand) {
    let w: Awaited<ReturnType<Mechanik['up']>>;
    try {
      w = await this.m.up(p.nr, p.branch, this.e.epicBranch);
    } catch (f) {
      // exit 1 of Up holds the package: the message word for word, nothing done by hand
      return this.zuruecklassen(p, `Worktree nicht gerüstet: ${(f as Error).message}`);
    }
    await this.status(p.nr, 'status/in-arbeit');
    p.worktree = w.worktree;
    p.port = w.port ?? null;
    p.isolation = w.isolation ?? null;
    p.kopf = w.kopf ?? null;
    p.stufe = 'implementer';
    p.zeiten.start = this.zeit();
    this.ereignis('start', p.nr, `gestartet auf ${this.e.epicBranch}, Klasse ${p.klasse}`);
    this.speichere();
  }

  private startbereitNachtragen() {
    const laufend = Object.values(this.z.pakete).filter(laeuft).map((p) => p.nr);
    const park = geparkt(this.z);
    for (const p of Object.values(this.z.pakete)) {
      if (p.stufe !== 'wartend' && p.stufe !== 'startbereit') continue;
      p.stufe = startbereit(this.z, p.nr, laufend, park) ? 'startbereit' : 'wartend';
    }
  }

  private async konto() {
    if (!this.z.konto.gesperrt || !(await this.u.aufrufe.kontoFrei())) return;
    this.z.konto.gesperrt = false;
    for (const s of [this.z.schnitt, ...Object.values(this.z.pakete)]) {
      if (s.wartet !== 'konto') continue;
      s.wartet = null;
      s.fortsetzen = 'Das Kontolimit ist vorbei. Setze an derselben Stelle fort und gib dein Ergebnis im Schema aus.';
    }
    this.ereignis('konto', null, 'Konto wieder frei');
    this.speichere();
  }

  // ---- the command channel: 4c and the merge, one after the other

  private befehle() {
    if (this.befehl) return;
    const z = this.z;
    // an open conflict leaves the epic worktree mid-merge: nothing else goes there until its verdict
    if (Object.values(z.pakete).some((p) => p.stufe === 'merge' && p.konflikt && !p.konflikt.ergebnis)) return;
    const reihe = (stufe: 'merge' | 'pruefung', zeit: 'abgenommen' | 'reviewerZurueck') =>
      Object.values(z.pakete)
        .filter((p) => p.stufe === stufe)
        .sort((a, b) => (a.zeiten[zeit] ?? '').localeCompare(b.zeiten[zeit] ?? '') || a.nr.localeCompare(b.nr));
    // a merge frees a place: it goes before a verification
    const p = reihe('merge', 'abgenommen')[0] ?? reihe('pruefung', 'reviewerZurueck')[0];
    if (!p) return;
    this.befehl = p.nr;
    if (p.stufe === 'pruefung') p.zeiten.pruefungBeginn ??= this.zeit();
    else p.zeiten.mergeBeginn ??= this.zeit();
    // what goes wrong in a command is the package's matter (mission/SKILL.md, rule 10): a finding in 4c, left behind in the merge
    const meldung = (f: unknown) => flach(f instanceof Error ? f.message : String(f));
    const job: Promise<Erledigt> =
      p.stufe === 'pruefung'
        ? this.pruefe(p).then(
            (n): Erledigt => ({ art: 'pruefung', nr: p.nr, n }),
            (f): Erledigt => ({ art: 'pruefung', nr: p.nr, n: { ok: false, befunde: [`Nachprüfung gescheitert: ${meldung(f)}`], lastflakes: [] } }),
          )
        : this.merge(p).then(
            (m): Erledigt => ({ art: 'merge', nr: p.nr, m }),
            (f): Erledigt => ({ art: 'merge', nr: p.nr, m: { art: 'fehler', grund: meldung(f) } }),
          );
    job.then(
      (x) => this.erledigt.push(x),
      (f) => (this.fehler ??= f),
    );
  }

  /** 4c as code (decision 6): full run, Lastflake rule, counts and lint against phase 0 */
  private async pruefe(p: PaketZustand): Promise<Nachpruefung> {
    const wt = p.worktree!;
    const lauf = await this.m.volllauf(wt);
    p.testlauf = lauf;
    const beruehrt = await this.m.beruehrt(wt);
    const einzeln: Record<string, boolean> = {};
    for (const d of flakeKandidaten(lauf, beruehrt)) einzeln[d] = await this.m.einzeln(wt, d);
    const lint = await this.m.lint(wt);
    return nachpruefung({ basis: this.z.basis!, lauf, beruehrt, einzeln, basisLint: this.z.basisLint ?? {}, lint });
  }

  /**
   * Phase 5: merge only when the branch is not in the epic branch yet; then its merge commit is taken
   * over (P17, also after a stop before the state was written). A conflict adds an edge and ends the
   * job: the conflict call runs as a call of its own, and the next merge job finishes or aborts the
   * merge with its verdict. Tests on the epic branch unless the tree is the one 4c checked; red is
   * reverted with -m 1 (P13); then Down, branch, graph.
   */
  private async merge(p: PaketZustand): Promise<MergeErgebnis> {
    if (p.revertCommit) return { art: 'rot' };
    if (!p.mergeCommit && !p.nichtsZuMergen) {
      const drin = await this.m.imEpic(p.branch);
      if (drin) p.mergeCommit = drin;
      else if (p.konflikt?.ergebnis === 'inhaltlich') {
        await this.m.mergeAbbrechen();
        return { art: 'inhaltlich', grund: p.konflikt.begruendung };
      } else if (p.konflikt?.ergebnis === 'geloest') {
        p.mergeCommit = await this.m.mergeAbschliessen();
      } else {
        // 4d: what the package left in its worktree goes onto its branch first
        if (p.worktree) await this.m.sichern(p.worktree, this.commitNachricht(p));
        const v = await this.m.merge(p.branch);
        if (!v.ok) {
          p.konflikt = { dateien: v.dateien, ergebnis: null, begruendung: '' };
          this.kanteNachtragen(p, v.dateien);
          return { art: 'konflikt' };
        }
        if (v.commit === null) {
          // no commits of its own: no merge commit, no run on the epic branch, nothing to revert
          p.nichtsZuMergen = true;
          p.epicGeprueft = true;
        } else p.mergeCommit = v.commit;
      }
      this.speichere();
    }
    if (!p.epicGeprueft) {
      if (p.konflikt?.ergebnis === 'geloest' || !(await this.m.baumGleich(p.branch))) {
        const t = await this.m.volllauf(this.z.epicWorktree!);
        p.epicLauf = t;
        if (rot(t)) {
          p.revertCommit = await this.m.revert(p.mergeCommit!);
          this.speichere();
          return { art: 'rot' };
        }
      }
      p.epicGeprueft = true;
      this.speichere();
    }
    await this.m.down(p.nr);
    await this.m.branchLoeschen(p.branch);
    await this.m.graph();
    return { art: 'gemergt' };
  }

  /** a conflict is a statement about the graph: the packages merged since this one started collide with it */
  private kanteNachtragen(p: PaketZustand, dateien: string[]) {
    // merged after this package started: its worktree did not contain them
    const start = this.z.ereignisse.findIndex((e) => e.paket === p.nr && e.art === 'start');
    const partner = Object.values(this.z.pakete).filter((q) => q.nr !== p.nr && q.stufe === 'fertig' && this.z.ereignisse.findIndex((e) => e.paket === q.nr && e.art === 'gemergt') > start);
    for (const q of partner) if (!this.z.kanten.some((k) => (k.a === q.nr && k.b === p.nr) || (k.a === p.nr && k.b === q.nr))) this.z.kanten.push({ a: q.nr, b: p.nr, art: 'kollision', grund: `Andock-Konflikt in ${dateien.join(', ')}` });
    this.ereignis('kante', p.nr, `Andock-Konflikt in ${dateien.join(', ')}; Kollisionskante nachgetragen zu ${partner.map((q) => q.nr).join(', ') || 'keinem bekannten Paket'}`);
    this.speichere();
  }

  // ---- questions and answers

  /** the gate points still without answer, as one block (after a restart in phase tor or with parked packages) */
  private offeneFragen() {
    const offen = this.z.fragen.filter((f) => f.art === 'tor' && f.antwort === null && !f.erledigt);
    if (!offen.length || !this.z.schnitt.ergebnis) return;
    const fragen = offen.map((f): BlockFrage => {
      const t = this.z.schnitt.ergebnis!.tor[f.punkt!];
      return { nr: f.nr, frage: t.frage, betrifft: t.betrifft, lage: t.lage, optionen: t.optionen.map((o) => o.text), empfehlung: t.empfehlung, grund: t.grund, quelle: t.quelle };
    });
    this.ereignis('frage', null, `Vorab-Tor nach Neustart erneut gemeldet: ${fragen.length} offene Punkte`);
    this.speichere();
    this.u.leitung.melde(frageBlock(this.e.epic, 'tor', fragen, `Vorab-Tor, ${fragen.length} Punkte offen (nach Neustart)`));
  }

  private async antworten() {
    for (const a of this.u.leitung.antworten()) {
      const f = this.z.fragen.find((x) => x.nr === a.frage);
      if (!f || f.antwort !== null || f.erledigt) continue;
      f.antwort = a.antwort;
      const buchstabe = buchstabenAus(a.antwort)?.split(', ')[0] ?? null;
      this.ereignis('antwort', null, `Frage ${f.nr}: ${a.antwort}`);
      if (f.art === 'ram') {
        if (buchstabe === 'B') this.z.ram.freigabe = true;
        // a release asks again at the next hold; waiting keeps the question until the reading is ok
        if (buchstabe === 'B' && this.z.ram.frage === f.nr) this.z.ram.frage = null;
        this.speichere();
        continue;
      }
      const punkt = this.z.schnitt.ergebnis!.tor[f.punkt!];
      const option = buchstabe ? punkt.optionen[buchstabe.charCodeAt(0) - 65] : undefined;
      f.abgelehnt = Boolean(option?.abbruch);
      this.speichere();
      if (f.abgelehnt && Array.isArray(f.betrifft)) for (const nr of f.betrifft) if (this.z.pakete[nr]) await this.zuruecklassen(this.z.pakete[nr], `am Vorab-Tor abgelehnt: ${punkt.frage} → ${a.antwort}`);
    }
  }

  /** a gate point about the whole run holds every start; rejected: nothing starts, the run ends (P22) */
  private async tor() {
    const lauf = this.z.fragen.filter((f) => f.art === 'tor' && f.betrifft === 'Lauf');
    const nein = lauf.find((f) => f.abgelehnt);
    if (nein) {
      const punkt = this.z.schnitt.ergebnis!.tor[nein.punkt!];
      return this.abbrechen(`Vorab-Tor abgelehnt: ${punkt.frage} → ${nein.antwort}. Kein Paket gestartet.`);
    }
    if (lauf.every((f) => f.antwort !== null)) {
      this.z.phase = 'pakete';
      this.speichere();
    }
  }

  // ---- end

  private async abbrechen(grund: string, abraeumen = true) {
    if (abraeumen) await this.m.down(`epic-${this.e.epic}`);
    this.z.phase = 'abgebrochen';
    this.z.ende = endeBlock(this.e.epic, null, grund, `- ${grund}${abraeumen ? ` Der Missions-Worktree ist abgeräumt, der Missions-Branch ${this.e.epicBranch} bleibt.` : ''}`);
    this.ereignis('ende', null, grund);
    this.speichere();
    this.u.leitung.melde(this.z.ende);
  }

  /** 2d: labels at the target issue and the opening comment, Lauftafel aus */
  private async eroeffnen() {
    this.eroeffnet = true;
    this.glut(await this.m.eroeffnung(), null);
    const pakete = this.z.schnitt.ergebnis!.pakete;
    // 2d: skipped children get their reason now, before the first package; a blocking ticket: status/blockiert
    for (const u of this.z.schnitt.ergebnis!.uebersprungen ?? []) {
      const nr = u.nr.replace(/^#/, '');
      if (!/^\d+$/.test(nr)) continue;
      await this.kommentiere(nr, 'uebersprungen', `**Übersprungen** #${nr}: Der Lauf von Mission #${this.e.epic} (flotte mission) bearbeitet es nicht. Grund: ${u.grund}${u.blocker.length ? ` Blockiert durch ${u.blocker.map((x) => `#${x.replace(/^#/, '')}`).join(', ')}.` : ''}`);
      if (u.blocker.length) await this.status(nr, 'status/blockiert');
    }
    await this.kommentiere(String(this.e.epic), 'eroeffnung', [`**Lauf beginnt** Mission #${this.e.epic} mit flotte mission: Basis ${this.e.basis}, Missions-Branch ${this.e.epicBranch}, Fenster ${this.e.fenster}.`, `Pakete: ${pakete.map((p) => `${p.nr} „${p.titel}“ (${p.klasse})`).join(', ')}`, LAUFTAFEL].join('\n'));
  }

  private async abschluss() {
    const pakete = Object.values(this.z.pakete);
    const anzahl = (s: string) => pakete.filter((p) => p.stufe === s).length;
    const offen = [
      ...pakete.filter((p) => p.stufe === 'zurueckgelassen').map((p) => `- Paket ${p.nr} zurückgelassen: ${p.grund} (Branch ${p.branch})`),
      ...pakete.filter((p) => p.stufe === 'blockiert').map((p) => `- Paket ${p.nr} blockiert durch ${p.blockiertDurch}`),
      ...pakete.flatMap((p) => p.eskalationen.map((x) => `- Eskalation Paket ${p.nr}, Runde ${x.runde}: ${x.von} → ${x.nach} (${x.grund})`)),
      ...this.z.kanten.map((k) => `- Kante nachgetragen: ${k.a} – ${k.b} (${k.grund})`),
      ...pakete.flatMap((p) => p.lastflakes.map((f) => `- Lastflake in Paket ${p.nr}: ${f}`)),
      ...(this.z.offenePunkte ?? []).map((x) => `- ${x}`),
    ];
    // Phase 6: WIP while something lies with the person; Closes only a fully accepted child, never the target issue
    const wip = anzahl('zurueckgelassen') + anzahl('blockiert') > 0;
    const zeile = (p: PaketZustand) => `- Paket ${p.nr}: ${p.stufe === 'fertig' ? `${p.nichtsZuMergen ? 'nichts anzudocken' : `angedockt (${p.mergeCommit})`}, Runde ${p.runde}, Klasse ${p.klasse}` : p.stufe === 'blockiert' ? `blockiert durch ${p.blockiertDurch}` : `zurückgelassen: ${p.grund} (Branch ${p.branch})`}`;
    const closes = pakete.filter((p) => p.stufe === 'fertig' && /^\d+$/.test(p.nr) && Number(p.nr) !== this.e.epic).map((p) => `Closes #${p.nr}`);
    const teststand = `Ausgangszahlen: ${this.zahlen(this.z.basis ?? [])}`;
    const body = ['## Pakete', ...pakete.map(zeile), '', teststand, '', '## Offene Punkte', offen.join('\n') || 'keine', '', LAUFTAFEL, ...(closes.length ? ['', ...closes] : [])].join('\n');
    const { pr, fehler } = await this.m.abschluss({ wip, body });
    if (fehler) {
      this.glut(fehler, null);
      offen.push(`- ${fehler}`);
    }
    await this.kommentiere(String(this.e.epic), 'abschluss', [`**Abschluss** Mission #${this.e.epic}: Pull Request ${pr ?? 'keiner'}. ${LAUFTAFEL}.`, ...pakete.map(zeile), teststand, '', '### Was das Epic offen lässt', offen.join('\n') || 'nichts'].join('\n'));
    this.z.phase = 'fertig';
    this.z.ende = endeBlock(this.e.epic, pr, `Mission #${this.e.epic}: ${anzahl('fertig')} Pakete angedockt, ${anzahl('zurueckgelassen')} zurückgelassen, ${anzahl('blockiert')} blockiert.`, offen.join('\n'));
    this.ereignis('ende', null, `${anzahl('fertig')} angedockt, ${anzahl('zurueckgelassen')} zurückgelassen, ${anzahl('blockiert')} blockiert`);
    this.speichere();
    this.u.leitung.melde(this.z.ende);
  }

  // ---- orders (auftraege.ts writes them from the fields of the cut and the state)

  private kontext(): Kontext {
    return { epic: this.e.epic, epicBranch: this.e.epicBranch, epicWorktree: this.z.epicWorktree ?? '', adapter: this.e.adapter ?? '', graph: this.z.graph ?? null, basis: this.z.basis ?? [], basisLint: this.z.basisLint ?? {} };
  }

  private torAntworten(nr: string): string[] {
    return this.z.fragen
      .filter((f) => f.art === 'tor' && f.antwort !== null && (f.betrifft === 'Lauf' || f.betrifft.includes(nr)))
      .map((f) => `${this.z.schnitt.ergebnis!.tor[f.punkt!].frage} → ${f.antwort}`);
  }

  private implementerAuftrag(p: PaketZustand): string {
    const k = this.paket(p.nr);
    const vorgaenger = k.nach.map((v) => this.z.pakete[v]?.review?.schnittstelle).filter((x): x is string => Boolean(x));
    return implementerAuftrag(this.kontext(), k, p, { vorgaenger, torAntworten: this.torAntworten(p.nr) });
  }

  private reviewerAuftrag(p: PaketZustand): string {
    const k = this.paket(p.nr);
    return reviewerAuftrag(this.kontext(), k, p, { kette: k.nach.length > 0 || nachfolger(this.z, p.nr).length > 0 });
  }
}
