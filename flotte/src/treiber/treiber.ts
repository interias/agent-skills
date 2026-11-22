// flotte fahren: the driver (#14, stage 3). A loop over the tools; language models are only the
// content of a state: the runs (/epic unchanged, ending every turn with a block) and one admiral
// call per question block. Everything the driver decides is in this file and tested by the
// scripts D1–D21 (test/drehbuecher.test.ts).

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { aufrufen, aufrufenAsync, type AsyncAufrufer, type Aufrufer } from '../aufruf.ts';
import { type Adapter, adapterAus, belege, type EpicBild, freigegebene, sammle } from '../werkzeuge/belegung.ts';
import { kontenTafel, kontoAus, kurzname } from '../werkzeuge/konten.ts';
import { type EndeBlock, type FrageBlock, leseBlock, nurBuchstaben, type Option } from '../werkzeuge/bloecke.ts';
import { beobachte, type LaufErgebnis, type Start, starte } from '../werkzeuge/lauf.ts';
import { type Bremse, freiGb, messeRam, naechsteBremse, type Ram, SKRIPTE } from '../werkzeuge/ressourcen.ts';
import { type Bewertung, bewerte, lies as liesVerbrauch, type Schwellen } from '../werkzeuge/verbrauch.ts';
import { entsperren, type EpicZustand, flotteDir, lebt, lies as liesZustand, neuesEpic, schreibe as schreibeZustand, sperren, startZeit, type Zustand } from '../werkzeuge/zustand.ts';
import { lerne } from '../befehle/lernen.ts';
import { admiralArgs, admiralAuftrag, admiralWerkzeuge, antwortenAus, LAUF_VERBOTEN, laufWerkzeuge } from './admiral.ts';
import { kommentar, logbuchBody, logbuchFinden, logbuchSchreiben, prZustand } from './forge.ts';
import { bereicheAus, blockAus, blockEinsetzen, gateForm, gateLaeufe, gateLaeufeImLog, gemeinsameBereiche, gleich, letzterVollLauf } from './gate.ts';
import { antwortZeile, type Bericht, type BerichtPaket, Bruecke, type BrueckenHandlung, ENTSCHEIDUNGEN_MAX, entscheidungFuerBericht, HERKUNFT_BRUECKE, HERKUNFT_FLOTTE, rechnerName } from './bruecke.ts';
import { liesPrototypen, prototypenStand } from './holodeck.ts';
import { liesSitzungen, SITZUNGEN_MS, type BerichtSitzung } from './sitzungen.ts';
import { schreibeTafel } from './tafel.ts';
import { type BerichtEinstellung, EINSTELLUNGEN, type EinstellungName, type Herkunft, istName, lies as liesEinstellung, NAMEN, NUR_NACH_GATE, setze as setzeEinstellung, START_PARAMETER, type Stellung, type Wert, wirksameStellung, type WirksameStellung, zeige } from './einstellungen.ts';
import { ableiten, type AgentEintrag, belegt, eintraegeAus, fuegeAn, kinderAusBetreff } from '../werkzeuge/detail.ts';
import { getroffen, liesMessungen, type Messung, paketeAusLogs, prognoseBacklog, prognoseEpic, schreibeMessung, type Spanne, stand as prognoseStand } from '../werkzeuge/prognose.ts';

export interface Einstellung {
  repo: string;
  forge: string;
  epics: number[];
  /** without --epics: the released epics of the forge, collected again every sammelnMs (acceptance 3, decision B) */
  auto: boolean;
  sammelnMs: number;
  /** --dauerhaft: with nothing left the driver waits for new released epics instead of ending */
  dauerhaft: boolean;
  /** CLAUDE_CONFIG_DIR per account; ~/.claude is account 1 */
  konten: string[];
  skill: string;
  modell: string | null;
  admiralModell: string | null;
  /** --admiral: CLAUDE_CONFIG_DIR of the admiral calls; null: the account of the epic (acceptance 3, decision D) */
  admiralKonto: string | null;
  admiralEffort: string | null;
  pingModell: string;
  /** model of the learning loop after a merge (Sparpaket, package 6) */
  lernModell: string;
  leerlaufMs: number;
  taktMs: number;
  plattMinGb: number;
  /** --ram-warn: warn threshold for ram.ps1 and the hysteresis; null: the adapter's or 75 */
  ramWarn: number | null;
  /** --obergrenze: a fixed fleet limit instead of the one from the 7-day projection (dress rehearsals) */
  obergrenze: number | null;
  /** #58: packages per epic at the same time; kept and reported only, /epic takes it from the order (#60) */
  paketeJeEpic: number;
  /** #58: the 5-hour thresholds of the usage brake in percent used */
  verbrauchGelb: number;
  verbrauchRot: number;
  /** #58: CLAUDE_CONFIG_DIR of the accounts that run until the 5-hour window is used up */
  leerfahren: string[];
  /** #112: how the project merges; the adapter's merge at the start, automatisch only with merge: nach_gate */
  merge: Stellung;
  /** #58: the settings given explicitly as start parameters; they win over the bridge's at the start */
  gesetzt?: EinstellungName[];
  /** --konto-max <dir>=<n>: at most n epics at the same time on that account (an account that must last) */
  kontoMax: Record<string, number>;
  verbrauchMaxAlterMin: number;
  /** /epic-nacharbeit while the PR is open when FLOTTE-ENDE names open points (Phase 4.1) */
  nacharbeit: boolean;
  sweepRoot: string | null;
  sweepDocker: boolean;
  /** -TempRoot of sweep.ps1; null: its default, the temp folder of the machine */
  sweepTemp: string | null;
  skripte: string;
  mergeSkript: string;
  admiralName: string;
  /** stops the loop after this long (tests, a safety net); null: until the work is done */
  maxDauerMs: number | null;
  programm?: string;
  programmArgs?: string[];
  /** --bruecke / FLOTTE_BRUECKE: base URL of the Flottenbrücke (#28); null: no reports */
  bruecke: string | null;
  /** FLOTTE_BRUECKE_TOKEN: X-Bruecke-Token when the bridge sets BRUECKE_TOKEN */
  brueckeToken: string | null;
  /** while questions wait for the person: how often the driver asks the bridge for answers */
  brueckeAbfrageMs: number;
}

export function standard(repo: string, forge: string, epics: number[], konten: string[]): Einstellung {
  return {
    repo: resolve(repo),
    forge,
    epics,
    auto: false,
    sammelnMs: 15 * 60_000,
    dauerhaft: false,
    // a second ~ in "~/.claude,~/.claude-arbeitspferd" reaches us unexpanded (acceptance finding 5);
    // short names 1, 2, 3 or a folder name in the home directory (acceptance 3, decision D)
    konten: konten.map((k) => kontoAus(k)),
    skill: 'epic',
    modell: null,
    admiralModell: 'fable',
    admiralKonto: null,
    admiralEffort: 'high',
    pingModell: 'haiku',
    lernModell: 'haiku',
    leerlaufMs: 60 * 60_000,
    taktMs: 60_000,
    plattMinGb: 20,
    ramWarn: null,
    obergrenze: null,
    paketeJeEpic: 3,
    verbrauchGelb: 60,
    verbrauchRot: 85,
    leerfahren: [],
    merge: 'mensch',
    kontoMax: {},
    verbrauchMaxAlterMin: 30,
    nacharbeit: true,
    sweepRoot: null,
    sweepDocker: true,
    sweepTemp: null,
    skripte: SKRIPTE,
    // repository layout, else installed: ~/.claude/skills/leitstand next to ~/.claude/skills/epic
    mergeSkript: [resolve(SKRIPTE, '../../arbeitspferd/leitstand/scripts/merge.ps1'), resolve(SKRIPTE, '../../leitstand/scripts/merge.ps1')].find((p) => existsSync(p)) ?? resolve(SKRIPTE, '../../leitstand/scripts/merge.ps1'),
    admiralName: 'Treiber',
    maxDauerMs: null,
    bruecke: null,
    brueckeToken: null,
    brueckeAbfrageMs: 10_000,
  };
}

/** Everything outside the driver, replaceable in the tests. */
export interface Welt {
  aufrufer: Aufrufer;
  langsam: AsyncAufrufer;
  starte: (s: Start) => Promise<LaufErgebnis>;
  freiGb: (pfad: string) => number | null;
  /** start of a process in epoch ms, null when unreadable (D16: a reused pid) */
  startZeit: (pid: number) => number | null;
  jetzt: () => number;
  melde: (zeile: string) => void;
}

export const echteWelt: Welt = {
  aufrufer: aufrufen,
  langsam: aufrufenAsync,
  starte,
  freiGb,
  startZeit,
  jetzt: Date.now,
  melde: (z) => process.stderr.write(`${z}\n`),
};

export interface MenschFrage {
  epic: number;
  nr: number;
  frage: string;
  /** the question complete, so the board shows it after a restart too (#28) */
  lage?: string;
  optionen?: Option[];
  /** several options at once (`— Auswahl: mehrere`) */
  mehrfach?: boolean;
  grund?: string;
  /** Betrifft as the run wrote it: 'Lauf', the packages, or '' */
  betrifft?: string;
  /** the question as the run wrote it; the whole block when it did not parse */
  roh?: string;
  /** id of the answer at the bridge that answered it */
  brueckeId?: number;
  /** why it lies with the person (#28, v2): the admiral's herkunft, a short mark, revocable until the merge */
  herkunft?: string;
  marke?: string;
  umkehrbar?: boolean | null;
  empfehlung: string;
  /** what waits: 'der ganze Lauf' or the parked packages */
  wartet: string;
  ganzerLauf: boolean;
  seit: string;
  beantwortet?: string;
  /** when the answer came: the wait for the person is left out of the measurement (Prognose) */
  beantwortetAm?: string;
  /** a repeat of an earlier question, closed with that one's answer (seit of the earlier one) */
  wiederholungVon?: string;
}

/** the same question again: same wording, or the same parked packages (not the whole run) */
export function gleicheFrage(a: { frage: string; betrifft?: string }, b: { frage: string; betrifft?: string }): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  if (a.frage && norm(a.frage) === norm(b.frage)) return true;
  return !!a.betrifft && a.betrifft !== 'Lauf' && a.betrifft === b.betrifft;
}

const betrifftText = (b: string[] | 'Lauf' | null): string => (b === null ? '' : b === 'Lauf' ? 'Lauf' : b.join(', '));

export interface Entscheidung {
  epic: number;
  nr: number;
  frage: string;
  antwort: string;
  herkunft: string;
  einflussreich: boolean;
  zeit: string;
  grund?: string;
  /** the person's new decision, revoked on the bridge */
  widerrufen?: string | null;
  /** who decided (#52): the person, the admiral, or the admiral following the run's recommendation */
  von?: 'mensch' | 'admiral' | 'lauf';
}

export interface FlottenEpic extends EpicZustand {
  pid?: number | null;
  /** when the driver spawned pid: tells a living run from a reused pid after a restart */
  pidSeit?: number | null;
  log?: string | null;
  /** what the run gets next, once the brakes allow it */
  auftrag?: { text: string; resume: boolean } | null;
  /** the admiral's answers held back while the whole run waits for the person */
  festgehalten?: string | null;
  /** #111: a question block that waits for an account with room for the admiral (all red); asked once one is free */
  wartendeFrage?: FrageBlock | null;
  /** answers of the person to deliver with the next turn */
  nachzureichen?: string[];
  nacharbeitGemacht?: boolean;
  /** merge refusals the run has to answer for: gate red or missing, a conflict when the base came in */
  mergeVersuche?: number;
  /** gate runs of the driver in this epic's worktree after it merged the base in (merge queue) */
  gateWiederholungen?: number;
  /** the driver laid out the epic worktree again (worktree.ps1 Up) and takes it down after the merge */
  worktreeSelbst?: boolean;
  /** the last step of the run from its log, for the board (#14, round 5, C4) */
  schritt?: string | null;
  schrittZeit?: string | null;
  /** resumes after a silent turn (acceptance finding 13) */
  leerlaeufe?: number;
  /** rules of guard.ps1 that refused a call of this epic's run, in order (acceptance finding B) */
  sperren?: string[];
  konfliktGemeldet?: boolean;
  prBereitGemeldet?: boolean;
  /** title of the issue, read once for the bridge */
  titel?: string | null;
  /** blocked or aborted: the whole reason and when (the blockade card of the bridge) */
  haltGrund?: string | null;
  haltZeit?: string | null;
  /** the person gave the epic up on the bridge */
  aufgegebenAm?: string | null;
  /** revocations of the person for the next turn: `widerruf: <Frage> → <neue Entscheidung>` */
  widerrufe?: string[];
  /** the limit of packages at once changed on the bridge (#60), handed to the run when it is continued */
  grenze?: number;
  /**
   * #61: paused by the person since (ISO): it does not start, and its next turn is held (auftrag stays)
   * until it is continued; a turn under way runs to its end
   */
  pausiert?: string | null;
  /** #61: the priority set on the bridge; it wins over the label for this epic */
  prioritaet?: 'hoch' | 'normal';
  /** #112: the person's switch on the bridge; it overrules the proposal and the project until the merge */
  merge?: Stellung | null;
  /** detail view (#51): the Agent calls of the runs with their returns, and how often a process was started or continued */
  agenten?: AgentEintrag[];
  starts?: number;
  /** the child tickets for the bridge, read from the forge at most every PAKETE_MS */
  pakete?: BerichtPaket[];
  paketeZeit?: number;
  /** first run started, joined the merge queue, the driver's gate started (ISO, for the bridge) */
  gestartetAm?: string | null;
  schlangeSeit?: string | null;
  gateSeit?: string | null;
  /** for the measurement (Prognose): last FLOTTE-ENDE, the driver's gate seconds, the forecast at the start */
  endeAm?: string | null;
  gateS?: number;
  prognose?: Spanne | null;
}

export interface FlottenZustand extends Zustand {
  epics: Record<string, FlottenEpic>;
  aktiv: boolean;
  stand: string;
  fragen: MenschFrage[];
  entscheidungen: Entscheidung[];
  antwortenGelesen: number;
  logbuch: number | null;
  ram: { at: string; epic: number; level: string; percent_used: number | null; free_gb: number | null }[];
  bremse: { ram: string; ramHalt: boolean; platteGenug: boolean; obergrenze: number; konten: { konto: string; stufe: string; grund: string }[] } | null;
  statistik: { starts: number; maxLaeufe: number; admiral: number; pings: number; immerGruen: boolean; gateWiederholungen?: number };
  /** merge: nach_gate: the epics with a finished PR in the order of their FLOTTE-ENDE; only the head is up */
  schlange: number[];
  /** ids of the bridge actions already carried out: one fetched twice acts once */
  handlungenErledigt?: number[];
  /** #58: the settings the person changed on the bridge, as the bridge sees them; they outlive a restart */
  einstellungen?: Partial<Record<EinstellungName, { wert: Wert; seit: string }>>;
  /** #61: epics taken into the deployment on the bridge; they join it again after a restart until they are done */
  aufgenommen?: number[];
}

/** green: pushed and the block in the PR; zurueck: to the run; mensch: a person merges */
type GateErgebnis = { art: 'gruen' | 'zurueck' | 'mensch'; text: string; teil?: boolean; gepusht?: boolean };

type PrInfo = { state?: string; headRefName: string; baseRefName: string; headRefOid: string; body: string };

/** #112: the reason of a PR held for a person by the epic's merge (not by the adapter) */
const MENSCH_PRUEFT = 'Andocken: Mensch prüft';

/** number of the driver's own question when the PR of FLOTTE-ENDE is not the epic's */
export const PR_FRAGE = 99;

/** gate runs of the driver per epic before it is blocked: the base kept moving while the gate ran */
export const GATE_GRENZE = 3;
const GATE_MAX_MS = 90 * 60_000;

/**
 * guard.ps1 as a hook of the session, not only of the skill: the hook in the frontmatter of /epic
 * holds in the turn that calls the skill and is gone after --resume (dress rehearsal 2, 19.11.2026:
 * `gh pr merge` passed in the second turn). Every answer of the driver is a --resume.
 */
export function guardArgs(guard: string): string[] {
  const befehl = `powershell -NoProfile -ExecutionPolicy Bypass -File "${guard}" -Profile epic`;
  return ['--settings', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: befehl, timeout: 30, onFailure: 'block' }] }] } })];
}

/** how often the driver reads the child tickets of an epic for the package bar of the bridge */
export const PAKETE_MS = 5 * 60_000;

/** hook refusals an epic may collect before it is blocked (acceptance finding B) */
export const SPERREN_GRENZE = 3;

/** Under the driver the bridge shows the state of a run; the run board (Lauftafel) of /epic is off. */
export const TAFEL_AUS = 'Lauftafel aus: Baue und pflege keine Lauftafel, die Flottenbrücke zeigt den Stand (epic/references/lauftafel.md, „Lauftafel aus").';

const BELEGT = new Set(['laeuft', 'frage', 'nacharbeit']);
const ENDE = new Set(['fertig', 'blockiert', 'abgebrochen']);
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fahre(e: Einstellung, w: Welt = echteWelt): Promise<FlottenZustand> {
  const dir = flotteDir(e.repo, w.aufrufer);
  const sperre = sperren(dir);
  if (!sperre.ok) throw new Error(`In diesem Repository läuft schon ein Treiber (pid ${sperre.pid}, seit ${sperre.seit}). Kein zweiter Start (D20).`);
  try {
    return await new Treiber(e, w, dir).fahre();
  } finally {
    entsperren(dir);
  }
}

class Treiber {
  z!: FlottenZustand;
  laufend = new Map<number, Promise<void>>();
  fertig: { nr: number; r: LaufErgebnis }[] = [];
  bilder: EpicBild[] = [];
  adapter!: Adapter;
  ramBremse: Bremse = { halt: false, stufe: 'ok' };
  ram: Ram | null = null;
  platteGenug = true;
  bewertung = new Map<string, Bewertung>();
  letzterPing = new Map<string, number>();
  /** pings and merges run beside the loop; the loop wakes up when one ends */
  nebenher = new Set<Promise<void>>();
  /** the head of the merge queue while the driver works on it */
  kopfAktiv: number | null = null;
  mergesOffen = new Set<number>();
  /** the board needs a new page (a step of a run), the logbook not */
  tafelAlt = false;
  /** why merge.ps1 cannot merge for us (missing or an old version), null when it can */
  mergeAlt: string | null = null;
  geaendert = true;
  /** when the released epics were last collected (auto) */
  gesammelt = 0;
  /** default branch of the forge, read once */
  standardZweig: string | null | undefined;
  /** issues with ready_label that are no epic and no child of one, already reported */
  ohneEpicGemeldet = new Set<number>();
  bruecke: Bruecke | null = null;
  /** null: not yet tried */
  brueckeDa: boolean | null = null;
  /** answers of the bridge in the state, to acknowledge after the next save */
  zuQuittieren: number[] = [];
  handlungenZuQuittieren: number[] = [];
  freiGbWert: number | null = null;
  /** a report right after an event is on its way */
  meldungGeplant = false;
  haltGemeldet = false;
  /** the finished epics of this repository (messungen.jsonl), the forecast reads them */
  messungen: Messung[] = [];
  prognoseCache: { schluessel: string; wert: Bericht['prognose'] } | null = null;
  /** stage and parked packages of an epic when its children were last read */
  paketeStand = new Map<number, string>();
  /** the set of prototypes the bridge holds (names and contents) and the messages reported once */
  holodeckStand: string | null = null;
  holodeckGemeldet = new Set<string>();
  /** the sessions of the accounts (#41), read in the background at most every SITZUNGEN_MS; the report carries the last reading */
  sitzungen: BerichtSitzung[] = [];
  sitzungenGelesen = 0;
  sitzungenLaeuft = false;
  /** #58: where each setting comes from and since when; --konten as given at the start (its standard) */
  herkunft = new Map<EinstellungName, { herkunft: Herkunft; seit: string }>();
  startKonten: string[] = [];
  /** #61: the released epics of the forge outside the deployment, read for the bridge at most every PAKETE_MS, and their titles */
  freigegeben: number[] = [];
  freigegebenZeit = 0;
  freiTitel = new Map<number, string>();

  constructor(
    readonly e: Einstellung,
    readonly w: Welt,
    readonly dir: string,
  ) {}

  async fahre(): Promise<FlottenZustand> {
    const anfang = this.w.jetzt();
    const alt = liesZustand(this.dir, this.e.repo) as Partial<FlottenZustand>;
    this.z = {
      fragen: [],
      entscheidungen: [],
      antwortenGelesen: 0,
      logbuch: null,
      ram: [],
      bremse: null,
      statistik: { starts: 0, maxLaeufe: 0, admiral: 0, pings: 0, immerGruen: true, gateWiederholungen: 0 },
      schlange: [],
      handlungenErledigt: [],
      ...alt,
      version: 1,
      repo: this.e.repo,
      epics: (alt.epics ?? {}) as Record<string, FlottenEpic>,
      ereignisse: alt.ereignisse ?? [],
      aktiv: true,
      stand: '',
    };
    const fehlt = [...this.e.konten, ...(this.e.admiralKonto ? [this.e.admiralKonto] : [])].filter((k) => !existsSync(k));
    if (fehlt.length) throw new Error(`Kontenverzeichnis fehlt: ${fehlt.join(', ')}. Pfade ausschreiben, nicht ~ (flotte/references/umschalten.md).`);
    // #112: the adapter's merge is the start value of the setting merge
    this.adapter = adapterAus(this.e.repo);
    this.e.merge = this.adapter.merge === 'nach_gate' ? 'automatisch' : 'mensch';
    this.einstellungenLaden(new Date(anfang).toISOString());
    if (this.e.auto) {
      this.e.epics = this.einsammeln(this.adapter);
      this.gesammelt = this.w.jetzt();
    }
    // #61: taken in on the bridge, the epic stays in the deployment until it is done
    this.z.aufgenommen = (this.z.aufgenommen ?? []).filter((n) => !['gemergt', 'fertig'].includes(this.z.epics[n]?.stufe ?? '') && !this.z.epics[n]?.aufgegebenAm);
    const wieder = this.z.aufgenommen.filter((n) => !this.e.epics.includes(n));
    if (wieder.length) {
      this.e.epics = [...this.e.epics, ...wieder];
      this.ereignis(null, `Über die Brücke aufgenommen, bleibt im Einsatz: ${wieder.map((n) => `#${n}`).join(', ')}`);
    }
    for (const nr of this.e.epics) this.z.epics[nr] ??= neuesEpic(nr);
    const { bilder, adapter } = sammle(this.w.aufrufer, this.e.repo, this.e.forge, this.e.epics);
    this.bilder = bilder;
    this.adapter = adapter;
    this.z.logbuch ??= logbuchFinden(this.w.aufrufer, this.e.forge, this.logbuchText());
    this.ereignis(null, `Einsatz gestartet: ${this.e.epics.map((n) => `#${n}`).join(', ') || 'keine freigegebenen Epics'}${this.e.auto ? ` (freigegeben mit ${this.adapter.ready_label}, neu eingesammelt alle ${Math.round(this.e.sammelnMs / 60_000)} min)` : ''}`);
    if (this.adapter.merge === 'nach_gate') {
      this.mergeAlt = this.pruefeMergeSkript();
      if (this.mergeAlt) this.ereignis(null, `${this.mergeAlt}: ein Mensch mergt`);
    }
    this.messungen = liesMessungen(this.dir);
    this.wiederaufnehmen();
    // #61: a pause outlives the restart in the holder file as well; a field the state no longer carries goes
    for (const ep of Object.values(this.z.epics)) this.pauseVermerken(ep);
    if (this.e.bruecke) this.bruecke = new Bruecke(this.e.bruecke, this.e.brueckeToken);
    this.wiederholungenSchliessen();
    this.optionenNachlesen();

    for (;;) {
      const halt = this.anhaltenGewuenscht();
      this.nachsammeln(false);
      await this.brueckeHolen();
      this.antwortenLesen();
      await this.messen();
      if (!halt) {
        this.pings();
        await this.mergeWache();
        this.schlangeWeiter();
        await this.wartendeFragen();
        this.verteile();
        this.belege();
      }
      this.paketeLesen();
      this.freigegebenLesen();
      this.speichern();
      await this.brueckeMelden();
      // flotte anhalten: nothing new started; once no merge of the driver is under way, it ends. The
      // runs work on in their own process group, a new start takes them over (D16).
      if (halt && !this.mergesOffen.size && !this.fertig.length) {
        rmSync(join(this.dir, 'anhalten'), { force: true });
        this.ereignis(null, `Angehalten auf Wunsch: kein Merge offen${this.laufend.size ? `, ${this.laufend.size} Lauf/Läufe arbeiten weiter und werden beim Neustart übernommen` : ''}`);
        this.speichern();
        await this.brueckeMelden();
        return this.z;
      }
      // nothing left: one more look for released epics, then the end (acceptance 3, decision C)
      if (!this.fertig.length && !this.laufend.size && !this.mergesOffen.size && this.istZuEnde() && !this.e.dauerhaft && !this.nachsammeln(true)) break;
      if (this.e.maxDauerMs !== null && this.w.jetzt() - anfang > this.e.maxDauerMs) {
        this.ereignis(null, `Zeitgrenze von ${Math.round(this.e.maxDauerMs / 1000)} s erreicht, Treiber hält an`);
        await Promise.all(this.laufend.values());
        while (this.fertig.length) await this.verarbeite(this.fertig.shift()!);
        while (this.kopfAktiv !== null) await Promise.race([...this.nebenher, pause(this.e.taktMs)]);
        break;
      }
      // while the person has open questions, an answer on the bridge wakes the loop (#28, Zeitnähe)
      const wache = this.bruecke && this.z.fragen.some((f) => !f.beantwortet) ? this.antwortWache() : null;
      if (!this.fertig.length) await Promise.race([...this.laufend.values(), ...this.nebenher, pause(this.e.taktMs), ...(wache ? [wache.p] : [])]);
      wache?.stop();
      while (this.fertig.length) await this.verarbeite(this.fertig.shift()!);
    }
    await Promise.all(this.nebenher);
    await this.abschluss();
    return this.z;
  }

  /** `flotte anhalten` left a file next to the state; reported once */
  anhaltenGewuenscht(): boolean {
    if (!existsSync(join(this.dir, 'anhalten'))) return false;
    if (!this.haltGemeldet) {
      this.haltGemeldet = true;
      this.ereignis(null, `Anhalten angefordert: nichts Neues mehr${this.mergesOffen.size ? `, warte auf den Merge von ${[...this.mergesOffen].map((n) => `#${n}`).join(', ')}` : ''}`);
    }
    return true;
  }

  /**
   * Without --epics: every sammelnMs (or now, when jetzt) the released epics of the forge; new ones
   * join the deployment, occupancy and order edges count for them. True when one joined.
   */
  nachsammeln(jetzt: boolean): boolean {
    if (!this.e.auto || (!jetzt && this.w.jetzt() - this.gesammelt < this.e.sammelnMs)) return false;
    this.gesammelt = this.w.jetzt();
    let neu: number[];
    try {
      neu = this.einsammeln(this.adapter).filter((n) => !this.e.epics.includes(n));
    } catch (err) {
      this.ereignis(null, `Epics nicht eingesammelt: ${String(err).slice(0, 200)}`);
      return false;
    }
    if (!neu.length) return false;
    this.e.epics = [...this.e.epics, ...neu];
    for (const nr of neu) this.z.epics[nr] ??= neuesEpic(nr);
    this.bilder = sammle(this.w.aufrufer, this.e.repo, this.e.forge, this.e.epics).bilder;
    this.ereignis(null, `Neu freigegeben: ${neu.map((n) => `#${n}`).join(', ')}`);
    return true;
  }

  /** The released epics; a released issue that is no epic and no child of one is reported once. */
  einsammeln(adapter: Adapter): number[] {
    const f = freigegebene(this.w.aufrufer, this.e.forge, adapter);
    const neu = f.ohneEpic.filter((n) => !this.ohneEpicGemeldet.has(n));
    for (const n of neu) this.ohneEpicGemeldet.add(n);
    if (neu.length) this.ereignis(null, `freigegeben, aber kein Epic: ${neu.map((n) => `#${n}`).join(', ')} (ohne ${adapter.epic_label} und nicht Kind eines Epics; mit --epics fahren oder das Label setzen)`);
    return f.epics;
  }

  nebenbei(p: Promise<void>): void {
    const q: Promise<void> = p.catch((e) => this.ereignis(null, `Fehler nebenher: ${e}`)).finally(() => this.nebenher.delete(q));
    this.nebenher.add(q);
  }

  /** Acceptance finding 7: an installed merge.ps1 older than the merge rule merges without a gate. */
  pruefeMergeSkript(): string | null {
    if (!existsSync(this.e.mergeSkript)) return `merge.ps1 fehlt (${this.e.mergeSkript})`;
    const text = readFileSync(this.e.mergeSkript, 'utf8');
    return /nach_gate/.test(text) && /gate_heading/.test(text) ? null : `merge.ps1 unter ${this.e.mergeSkript} kennt den Adapterschlüssel merge nicht (alte Fassung)`;
  }

  // ---- state, board, logbook

  ereignis(epic: number | null, text: string): void {
    this.z.ereignisse.push({ zeit: new Date(this.w.jetzt()).toISOString(), epic, text });
    this.w.melde(`${epic ? `#${epic} ` : ''}${text}`);
    this.geaendert = true;
    this.brueckeBald();
  }

  epic(nr: number): FlottenEpic {
    return this.z.epics[String(nr)];
  }

  speichern(): void {
    this.z.stand = new Date(this.w.jetzt()).toISOString();
    schreibeZustand(this.dir, this.z);
    if (!this.geaendert) {
      // a new step of a run changes the board, not the logbook
      if (this.tafelAlt) schreibeTafel(this.dir, this.z, this.e.forge);
      this.tafelAlt = false;
      return;
    }
    this.geaendert = false;
    this.tafelAlt = false;
    schreibeTafel(this.dir, this.z, this.e.forge);
    if (this.z.logbuch) logbuchSchreiben(this.w.aufrufer, this.e.forge, this.z.logbuch, this.logbuchText());
  }

  logbuchText(): string {
    const stage: Record<string, string> = { wartend: 'waiting', laeuft: 'packages', frage: 'gate', nacharbeit: 'followup', pr: 'merge', gemergt: 'cleanup', fertig: 'done', blockiert: 'waiting', abgebrochen: 'done' };
    const stufen = [...this.bewertung.values()].map((b) => b.stufe);
    const brake = stufen.includes('rot') ? 'rot' : stufen.includes('gelb') ? 'gelb' : 'gruen';
    return logbuchBody({
      active: this.z?.aktiv ?? true,
      admiral: this.e.admiralName,
      brake,
      ram: this.z?.ram ?? [],
      epics: Object.values(this.z?.epics ?? {}).map((ep) => ({ number: ep.nr, stage: stage[ep.stufe] ?? 'waiting', carrier: 'agent' as const, paused: (Boolean(ep.auftrag) && !this.laufend.has(ep.nr)) || Boolean(ep.pausiert), note: ep.notiz })),
      questions: (this.z?.fragen ?? []).filter((f) => !f.beantwortet).map((f) => ({ number: f.epic, text: f.frage })),
      history: { deployments: 0, max_runs: this.z?.statistik.maxLaeufe ?? 0, all_green: 0 },
    });
  }

  // ---- D16: continue from the state file

  wiederaufnehmen(): void {
    for (const ep of Object.values(this.z.epics)) {
      if (!ep.pid) continue;
      const { pid } = ep;
      // the same process only when it started when the driver spawned it: a pid is reused
      const seit = lebt(pid) ? this.w.startZeit(pid) : null;
      const derselbe = seit !== null && ep.pidSeit != null && Math.abs(seit - ep.pidSeit) < 10_000;
      // a living pid whose start cannot be compared is followed, but never killed
      const unklar = lebt(pid) && !derselbe && (seit === null || ep.pidSeit == null);
      const verfolgen = derselbe || unklar;
      this.ereignis(ep.nr, verfolgen ? `Lauf (pid ${pid}) lebt noch: wird beobachtet, nicht neu gestartet` : `Lauf (pid ${pid}) endete ohne Treiber: Ergebnis aus dem Log`);
      const log = ep.log && existsSync(ep.log) ? ep.log : this.leeresLog(ep.nr);
      const p = beobachte({ log, pid: verfolgen ? pid : null, leerlaufMs: this.e.leerlaufMs, konto: ep.konto ?? this.e.konten[0], beenden: derselbe, werkzeuge: laufWerkzeuge, beiSchritt: (s) => this.schritt(ep, s), beiZeile: (z, t) => this.agentZeile(ep, z, t, true) })
        .then((r) => {
          this.fertig.push({ nr: ep.nr, r });
        })
        .finally(() => this.laufend.delete(ep.nr));
      this.laufend.set(ep.nr, p);
    }
  }

  leeresLog(nr: number): string {
    const d = join(this.dir, 'laeufe');
    mkdirSync(d, { recursive: true });
    const f = join(d, `${nr}-leer.jsonl`);
    appendFileSync(f, '');
    return f;
  }

  // ---- measurements and brakes (D6–D9)

  async messen(): Promise<void> {
    // asynchronous: spawnSync with a timeout fails under Bun after a long wait on a child (acceptance finding 8)
    this.ram = await messeRam(this.w.langsam, this.e.repo, join(this.e.skripte, 'ram.ps1'), this.e.ramWarn);
    const vorher = this.ramBremse;
    this.ramBremse = naechsteBremse(this.ramBremse, this.ram, this.e.ramWarn ?? 75);
    if (this.ramBremse.halt !== vorher.halt || Boolean(this.ramBremse.fehler) !== Boolean(vorher.fehler)) {
      this.ereignis(null, !this.ramBremse.halt ? `RAM wieder ok (${this.ram.percent_used} %): es geht weiter` : this.ram.fehler ? `RAM-Messung fehlgeschlagen (${this.ram.fehler}): nichts Neues` : `RAM ${this.ram.level} (${this.ram.percent_used ?? '?'} %): nichts Neues`);
    }
    const frei = this.w.freiGb(this.e.repo);
    this.freiGbWert = frei;
    const genug = frei !== null && frei >= this.e.plattMinGb;
    if (genug !== this.platteGenug) this.ereignis(null, genug ? 'Platte wieder über der Schwelle' : `Platte: ${frei ?? 'unbekannt'} GB frei, Schwelle ${this.e.plattMinGb} GB: kein Start`);
    this.platteGenug = genug;
    for (const k of this.alleKonten()) {
      const b = bewerte(liesVerbrauch(k), this.w.jetzt(), this.e.verbrauchMaxAlterMin, this.schwellen(k));
      const alt = this.bewertung.get(k)?.stufe;
      if (alt && alt !== b.stufe) this.ereignis(null, `Verbrauch ${this.kontoName(k)}: ${b.stufe} (${b.grund})`);
      if (k === this.e.admiralKonto && b.stufe !== 'gruen' && alt !== b.stufe) this.admiralWarnung(b);
      if (b.stufe !== 'gruen' && this.laufend.size) this.z.statistik.immerGruen = false;
      this.bewertung.set(k, b);
    }
    this.z.bremse = {
      ram: this.ram.level,
      ramHalt: this.ramBremse.halt,
      platteGenug: this.platteGenug,
      obergrenze: this.obergrenze(),
      konten: this.alleKonten().map((k) => ({ konto: k, stufe: this.bewertung.get(k)!.stufe, grund: this.bewertung.get(k)!.grund })),
    };
  }

  /**
   * the accounts of the runs and, when it is not one of them, the admiral's (follow-up check of #27);
   * #58: also an account taken off on the bridge while an epic on it is open (its runs stay there)
   */
  alleKonten(): string[] {
    const a = this.e.admiralKonto;
    const offen = Object.values(this.z?.epics ?? {}).flatMap((ep) => (ep.konto && !ENDE.has(ep.stufe) && existsSync(ep.konto) ? [ep.konto] : []));
    return [...new Set([...this.e.konten, ...(a ? [a] : []), ...offen])];
  }

  schwellen(k: string): Schwellen {
    return { gelb: this.e.verbrauchGelb, rot: this.e.verbrauchRot, leerfahren: this.e.leerfahren.includes(k) };
  }

  /** Advance warning: from red on, the admiral moves to another account with room, or the question block waits (#111). */
  admiralWarnung(b: Bewertung): void {
    const text = b.stufe === 'rot' ? `Admiral-Konto rot (${b.grund}): der Admiral weicht auf ein Konto mit Luft aus, sonst wartet der Frageblock`  : `Admiral-Konto gelb (${b.grund}): bei Rot weicht der Admiral auf ein Konto mit Luft aus`;
    this.ereignis(null, text);
    if (this.z.logbuch) kommentar(this.w.aufrufer, this.e.forge, this.z.logbuch, `**Flotte (${this.e.admiralName})** — ${text}.`);
  }

  kontoName(k: string): string {
    const i = this.e.konten.indexOf(k);
    if (i >= 0) return `Konto ${i + 1}`;
    return k === this.e.admiralKonto ? 'Admiral-Konto' : kurzname(k, this.e.admiralKonto);
  }

  obergrenze(): number {
    const gruen = this.e.konten.map((k) => this.bewertung.get(k)).filter((b): b is Bewertung => b?.stufe === 'gruen');
    if (!gruen.length) return 0;
    return Math.min(4, this.e.obergrenze ?? Math.min(...gruen.map((b) => b.obergrenze)));
  }

  /**
   * Decision 1 at HALT 1: a stale value is red; a small haiku run fetches a fresh one. It comes at
   * half the threshold and also while a run works on the account: a run reports usage about once
   * per turn, so a long turn would make its own account red (acceptance finding 4). Only when
   * something on the account may start or continue: no pings while everything waits for the person.
   */
  pings(): void {
    for (const k of this.alleKonten()) {
      const b = this.bewertung.get(k)!;
      if (b.alterMin !== null && b.alterMin <= this.e.verbrauchMaxAlterMin / 2) continue;
      if (!this.brauchtVerbrauch(k)) continue;
      const zuletzt = this.letzterPing.get(k) ?? 0;
      if (this.w.jetzt() - zuletzt < (this.e.verbrauchMaxAlterMin * 60_000) / 2) continue;
      this.letzterPing.set(k, this.w.jetzt());
      this.z.statistik.pings++;
      this.nebenbei(
        this.w.starte({ ...this.programm(), repo: this.e.repo, konto: k, auftrag: 'FLOTTE-PING Antworte nur mit OK.', modell: this.e.pingModell, leerlaufMs: 5 * 60_000, extraArgs: ['--tools', ''] }).then((r) => {
          this.ereignis(null, `Verbrauch ${this.kontoName(k)} ${b.alterMin === null ? 'unbekannt' : `${b.alterMin} min alt`}: Mini-Lauf ${r.verbrauch ? 'lieferte einen frischen Wert' : `ohne Wert (${r.fehler ?? 'kein rate_limit_event'})`}`);
          this.bewertung.set(k, bewerte(liesVerbrauch(k), this.w.jetzt(), this.e.verbrauchMaxAlterMin, this.schwellen(k)));
        }),
      );
    }
  }

  brauchtVerbrauch(k: string): boolean {
    // the admiral's account while a run may still ask
    if (k === this.e.admiralKonto && Object.values(this.z.epics).some((ep) => BELEGT.has(ep.stufe) || this.laufend.has(ep.nr))) return true;
    // #111: without --admiral a waiting question block waits for the run's account; a stale value counts as red
    if (Object.values(this.z.epics).some((ep) => ep.wartendeFrage && ep.konto === k)) return true;
    return Object.values(this.z.epics).some((ep) => (ep.konto === k && this.laufend.has(ep.nr)) || (Boolean(ep.auftrag) && (!ep.konto || ep.konto === k)) || ep.stufe === 'wartend');
  }

  programm(): Pick<Start, 'programm' | 'programmArgs'> {
    return { programm: this.e.programm, programmArgs: this.e.programmArgs };
  }

  darfFortsetzen(konto: string | null): boolean {
    return !this.ramBremse.halt && (!konto || this.bewertung.get(konto)?.stufe !== 'rot');
  }

  // ---- starting and continuing runs

  startText(nr: number): string {
    return `Flotte, Epic #${nr}: Rufe den Skill ${this.e.skill} mit #${nr} auf. Du läufst unter dem Flotten-Treiber ohne Fenster: Frag nie den Menschen direkt und warte nicht auf ihn. Beende jeden Zug mit FLOTTE-FRAGE oder FLOTTE-ENDE (flotte/references/bloecke.md). ${this.blockForm(nr)} Mergen ist nicht deine Aufgabe. ${this.grenzText()} ${TAFEL_AUS}`;
  }

  /** The limit of packages at once for /epic (epic/SKILL.md, Phase 4, "Das Fenster"). */
  grenzText(): string {
    return `Auftrag: höchstens ${this.e.paketeJeEpic} Pakete gleichzeitig.`;
  }

  /** The head lines of the blocks, spelled out (probe 3: a Haiku run wrote a bare FLOTTE-ENDE without number and URL). */
  blockForm(nr: number): string {
    return `Die Kopfzeile steht allein in einer Zeile: \`FLOTTE-FRAGE ${nr} <phase>\` mit den nummerierten Fragen darunter, oder \`FLOTTE-ENDE ${nr} <URL des Pull Requests>\` mit \`### Was das Epic offen lässt\` darunter.`;
  }

  an(nr: number, text: string): string {
    return `Flotte, Epic #${nr}: ${text}`;
  }

  starteLauf(ep: FlottenEpic, text: string, resume: boolean): void {
    const nr = ep.nr;
    if (resume && ep.nachzureichen?.length) {
      text += `\nAntworten des Menschen, die Pakete sind damit wieder frei:\n${ep.nachzureichen.join('\n')}`;
      ep.nachzureichen = [];
      ep.geparkt = [];
    }
    if (resume && ep.widerrufe?.length) {
      // flotte/references/entscheidungsrecht.md, "Widerruf": the next package, or a point of the follow-up when the PR is open
      text += `\nWiderruf des Menschen, als nächstes Paket umsetzen (liegt dein Pull Request schon offen: als Punkt der Nacharbeit):\n${ep.widerrufe.join('\n')}`;
      ep.widerrufe = [];
    }
    if (resume && ep.grenze !== undefined) {
      text += `\nGeänderter ${this.grenzText()} Gilt ab dem nächsten frei werdenden Platz, laufende Pakete laufen zu Ende.`;
    }
    // a fresh start carries the current limit in its order already
    delete ep.grenze;
    const laeufe = join(this.dir, 'laeufe');
    mkdirSync(laeufe, { recursive: true });
    ep.log = join(laeufe, `${nr}-${this.w.jetzt()}-${this.z.statistik.starts}.jsonl`);
    this.z.statistik.starts++;
    ep.starts = (ep.starts ?? 0) + 1;
    const p = this.w
      .starte({
        ...this.programm(),
        repo: this.e.repo,
        konto: ep.konto!,
        auftrag: text,
        resume: resume ? ep.sitzung : null,
        modell: this.e.modell,
        leerlaufMs: this.e.leerlaufMs,
        log: ep.log,
        // the worktree locks of this run outlive its process between turns (acceptance finding 3)
        env: { EPIC_LOCK_HOLDER: this.halten(nr) },
        extraArgs: ['--disallowedTools', LAUF_VERBOTEN.join(','), ...guardArgs(join(this.e.skripte, 'guard.ps1'))],
        werkzeuge: laufWerkzeuge,
        beiSchritt: (s) => this.schritt(ep, s),
        beiZeile: (z, t) => this.agentZeile(ep, z, t, false),
        beimStart: (pid) => {
          ep.pid = pid;
          ep.pidSeit = Date.now();
          schreibeZustand(this.dir, this.z);
        },
      })
      .then((r) => {
        this.fertig.push({ nr, r });
      })
      .finally(() => this.laufend.delete(nr));
    this.laufend.set(nr, p);
    this.z.statistik.maxLaeufe = Math.max(this.z.statistik.maxLaeufe, this.laufend.size);
    if (!ep.gestartetAm) {
      ep.gestartetAm = new Date(this.w.jetzt()).toISOString();
      // the forecast shown before the run, kept for the self check at the end
      ep.prognose = prognoseEpic(this.messungen, this.kinderZahl(nr), this.adapter.prognose_ab);
    }
    this.ereignis(nr, resume ? 'Lauf fortgesetzt' : 'Lauf gestartet');
  }

  /**
   * #51: what a log line says about the Agent calls of the run, for phase, round and class on the
   * bridge. `nachlese`: a run taken over after a restart is read from its first line again; calls and
   * returns known already are kept, the times of work below a call are not taken anew. Without a
   * bridge nobody reads the fields: nothing is parsed or kept. The quick test lets calls, results and
   * the `task_notification` of a background agent pass (all carry `"tool_use`, the latter as `"tool_use_id"`).
   */
  agentZeile(ep: FlottenEpic, zeile: string, zeit: number, nachlese: boolean): void {
    if (!this.e.bruecke) return;
    if (!zeile.includes('"tool_use') && !zeile.includes('"parent_tool_use_id":"')) return;
    const neu = eintraegeAus(zeile, zeit).filter((e) => !(nachlese && e.art === 'unter'));
    if (neu.length) fuegeAn((ep.agenten ??= []), neu);
  }

  /** C4: the board shows the last step of each run; C1: a silence carried by a child process is an event. */
  schritt(ep: FlottenEpic, s: string): void {
    ep.schritt = s;
    ep.schrittZeit = new Date(this.w.jetzt()).toISOString();
    this.tafelAlt = true;
    if (s.startsWith('still seit')) this.ereignis(ep.nr, s);
  }

  /** The holder file: while it exists, CleanupStale keeps the worktree locks of this epic's runs. */
  halten(nr: number): string {
    const d = join(this.dir, 'halten');
    mkdirSync(d, { recursive: true });
    const f = join(d, `${nr}.json`);
    const pausiert = this.z.epics[nr]?.pausiert;
    if (!existsSync(f)) writeFileSync(f, JSON.stringify({ epic: nr, repo: this.e.repo, seit: new Date(this.w.jetzt()).toISOString(), ...(pausiert ? { pausiert } : {}) }));
    return f;
  }

  /**
   * #61: the pause in the holder file of a running epic. The run sees the file as EPIC_LOCK_HOLDER;
   * ram.ps1 answers hold while it carries pausiert, so the run starts no further package and ends its
   * turn with FLOTTE-FRAGE ram. Only the field changes; a missing or unreadable file stays as it is.
   */
  pauseVermerken(ep: FlottenEpic): void {
    const f = join(this.dir, 'halten', `${ep.nr}.json`);
    if (!existsSync(f)) return;
    try {
      const j = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
      if (ep.pausiert) j.pausiert = ep.pausiert;
      else delete j.pausiert;
      writeFileSync(f, JSON.stringify(j));
    } catch {
      this.ereignis(ep.nr, 'Haltedatei unlesbar, die Pause erreicht den laufenden Zug nicht');
    }
  }

  loslassen(nr: number): void {
    rmSync(join(this.dir, 'halten', `${nr}.json`), { force: true });
  }

  verteile(): void {
    for (const ep of Object.values(this.z.epics)) {
      // #61: a paused epic keeps its next turn until the person continues it
      if (!ep.auftrag || ep.pausiert || this.laufend.has(ep.nr) || !this.darfFortsetzen(ep.konto)) continue;
      const a = ep.auftrag;
      ep.auftrag = null;
      const fortsetzen = a.resume && Boolean(ep.sitzung);
      this.starteLauf(ep, fortsetzen ? a.text : this.startText(ep.nr), fortsetzen);
    }
  }

  belege(): void {
    // epics whose predecessor will never be merged cannot start
    for (const b of this.bilder) {
      const ep = this.epic(b.nr);
      const tot = b.nach.find((n) => ['blockiert', 'abgebrochen'].includes(this.epic(n)?.stufe ?? ''));
      if (ep.stufe === 'wartend' && tot) {
        ep.stufe = 'blockiert';
        ep.notiz = `Vorgänger #${tot} ist ${this.epic(tot).stufe}`;
        this.ereignis(b.nr, ep.notiz);
      }
    }
    if (this.ramBremse.halt || !this.platteGenug) return;
    const gruen = this.e.konten.filter((k) => this.bewertung.get(k)?.stufe === 'gruen' && this.aktivAuf(k) < (this.e.kontoMax[k] ?? Infinity));
    if (!gruen.length) return;
    const laufend = Object.values(this.z.epics).filter((ep) => BELEGT.has(ep.stufe) || this.laufend.has(ep.nr)).map((ep) => ep.nr);
    const gemergt = Object.values(this.z.epics).filter((ep) => ep.stufe === 'gemergt' || ep.stufe === 'fertig').map((ep) => ep.nr);
    // #61: a paused epic does not start; the priority of the bridge wins over the label
    const im = this.bilder
      .filter((b) => {
        const s = this.epic(b.nr).stufe;
        return (s === 'wartend' && !this.epic(b.nr).pausiert) || laufend.includes(b.nr) || gemergt.includes(b.nr);
      })
      .map((b) => ({ ...b, prio: this.prio(b.nr) }));
    const plan = belege(im, this.adapter, { laufend, gemergt, obergrenze: this.obergrenze() });
    for (const w of plan.wartend) {
      const notiz = `wartet auf den Merge von ${w.wartetAuf.map((n) => `#${n}`).join(', ')}`;
      if (this.epic(w.nr).notiz !== notiz) this.epic(w.nr).notiz = notiz;
    }
    // the priority label: why a startable one waits stands on the board and the bridge
    for (const v of plan.vorrang) {
      if (v.startet) continue;
      if (this.epic(v.nr).notiz !== v.grund) {
        this.epic(v.nr).notiz = v.grund;
        this.ereignis(v.nr, v.grund);
      }
    }
    for (const nr of plan.neu) {
      const ep = this.epic(nr);
      // fewest running runs; on a tie the account with fewer epics so far (dress rehearsal: with
      // a limit of 1 every tie went to account 1). --konto-max counts the epics at work on the
      // account, those placed in this tick too (probe 3: two new epics in one tick both went to the
      // capped account).
      const frei = gruen.filter((k) => this.aktivAuf(k) < (this.e.kontoMax[k] ?? Infinity));
      if (!frei.length) break;
      const konto = frei.sort((a, b) => this.aufKonto(a) - this.aufKonto(b) || this.epicsAuf(a) - this.epicsAuf(b))[0];
      ep.konto = konto;
      ep.stufe = 'laeuft';
      ep.notiz = '';
      const p = plan.paare.filter((x) => (x.a === nr || x.b === nr) && laufend.includes(x.a === nr ? x.b : x.a));
      const zuerst = plan.vorrang.find((v) => v.nr === nr && v.startet);
      if (p.length || zuerst) this.ereignis(nr, `Belegung: ${[...(zuerst ? [zuerst.grund] : []), ...p.map((x) => `mit #${x.a === nr ? x.b : x.a} ${x.stufe} (${x.beleg})`)].join('; ')}`);
      if (this.ram) this.z.ram.push({ at: new Date(this.w.jetzt()).toISOString().slice(0, 16), epic: nr, level: this.ram.level, percent_used: this.ram.percent_used, free_gb: this.ram.free_gb });
      laufend.push(nr);
      this.starteLauf(ep, this.startText(nr), false);
    }
  }

  /** the priority in effect (#61): the one set on the bridge, else the label on the epic or a child */
  prio(nr: number): boolean {
    const p = this.epic(nr)?.prioritaet;
    return p ? p === 'hoch' : Boolean(this.bilder.find((b) => b.nr === nr)?.prio);
  }

  aufKonto(k: string): number {
    return Object.values(this.z.epics).filter((ep) => ep.konto === k && this.laufend.has(ep.nr)).length;
  }

  /** epics of the account that are not done: running, asking, at the PR or waiting for their merge (--konto-max) */
  aktivAuf(k: string): number {
    return Object.values(this.z.epics).filter((ep) => ep.konto === k && !ENDE.has(ep.stufe) && ep.stufe !== 'wartend').length;
  }

  epicsAuf(k: string): number {
    return Object.values(this.z.epics).filter((ep) => ep.konto === k).length;
  }

  // ---- results

  async verarbeite({ nr, r }: { nr: number; r: LaufErgebnis }): Promise<void> {
    const ep = this.epic(nr);
    ep.pid = null;
    // flotte messen reads the cold time from here: turn end to the next start (finding 14)
    this.ereignis(nr, `Zug zu Ende (${Math.round(r.dauerMs / 1000)} s)`);
    if (r.sitzung) ep.sitzung = r.sitzung;
    if (r.fehler === 'werkzeuge') return this.halt(ep, 'blockiert', `${r.stderr.split('\n')[0]}. Der Lauf wurde beendet, bevor er arbeitete.`);
    const hookIds = new Set(r.sperren.map((s) => s.id));
    const fremd = r.verweigert.filter((d) => !hookIds.has(String((d as { tool_use_id?: string }).tool_use_id ?? '')));
    const block = leseBlock(r.text);
    let vermerk: string | undefined;
    if (fremd.length) {
      const was = fremd.map((d) => (d as { tool_name?: string }).tool_name ?? JSON.stringify(d).slice(0, 80)).join(', ');
      // D19: on the board, blocked, never tried again in another form
      if (!block) return this.halt(ep, 'blockiert', `Erlaubnis verweigert: ${was}. Kein zweiter Versuch in anderer Form.`);
      // #54: a block of the turn goes first; the denials are an event and noted at its questions
      vermerk = `Im selben Zug abgelehnt: ${was}.`;
      this.ereignis(nr, `Erlaubnis verweigert: ${was}; der Zug endete mit FLOTTE-${block.art === 'frage' ? 'FRAGE' : 'ENDE'}, nicht blockiert`);
    }
    if (r.sperren.length) {
      // acceptance finding B: guard.ps1 refused a call. In a window the run reads the reason and
      // changes its way; so does a run here. Blocked only when the turn fails at it (no block, an
      // error), when one rule refuses twice in the epic (the run tries again in another form, which
      // the hook forbids) or at the third refusal of the epic (the run keeps working against the rules).
      const frueher = ep.sperren ?? [];
      ep.sperren = [...frueher, ...r.sperren.map((s) => s.regel)];
      this.ereignis(nr, `Hook-Sperre: ${r.sperren.map((s) => s.regel).join('; ')}`);
      const doppelt = ep.sperren.find((x, i) => ep.sperren!.indexOf(x) !== i);
      const grund = doppelt ? `Regel „${doppelt}" sperrte zweimal` : ep.sperren.length >= SPERREN_GRENZE ? `${ep.sperren.length} Hook-Sperren in diesem Epic` : !block || r.fehler ? 'der Zug scheiterte daran' : null;
      if (grund) return this.halt(ep, 'blockiert', `Gesperrt durch guard.ps1, ${grund}:\n\n${r.sperren.map((s) => `- ${s.text}`).join('\n')}`);
    }
    if (r.fehler === 'leerlauf') {
      const min = Math.round(this.e.leerlaufMs / 60_000);
      if ((ep.leerlaeufe ?? 0) < 1 && ep.sitzung) {
        // acceptance finding 13: a long quiet command is no dead run; once more, then the end
        ep.leerlaeufe = (ep.leerlaeufe ?? 0) + 1;
        ep.auftrag = { resume: true, text: this.an(nr, `Dein Zug war ${min} min ohne Ausgabe und wurde beendet. Setze an derselben Stelle fort; lange Befehle im Hintergrund starten und dazwischen den Stand melden.`) };
        this.ereignis(nr, `Leerlauf: ${min} min ohne Ausgabe, einmal fortgesetzt`);
        return;
      }
      await this.aufraeumen(nr);
      return this.halt(ep, 'abgebrochen', `Leerlauf: ${Math.round(this.e.leerlaufMs / 60_000)} min ohne Ausgabe`, true);
    }
    if (r.fehler === 'anmeldung') return this.halt(ep, 'blockiert', `Konto ${this.kontoName(ep.konto ?? '')} ist nicht angemeldet. Ein Mensch meldet es an.`);
    if (r.fehler === 'limit') {
      // #132: the account is used up; red until the next measurement says otherwise, and the epic waits for it
      const konto = ep.konto ?? '';
      const grund = `Limit erreicht: ${r.text.trim().slice(0, 120) || 'usage_limit_reached'}`;
      const alt = this.bewertung.get(konto);
      if (alt) this.bewertung.set(konto, { ...alt, stufe: 'rot', grund });
      if (ep.sitzung) ep.auftrag = { resume: true, text: this.an(nr, 'Das Konto hatte sein Limit erreicht. Setze an derselben Stelle fort und beende den Zug mit FLOTTE-FRAGE oder FLOTTE-ENDE.') };
      else {
        await this.aufraeumen(nr);
        ep.auftrag = { resume: false, text: this.startText(nr) };
      }
      ep.notiz = `wartet auf ${this.kontoName(konto)}: ${grund}`;
      this.ereignis(nr, `${grund} (${this.kontoName(konto)}) — kein Fehlstart, der Lauf wartet, bis das Konto wieder Luft hat`);
      return;
    }
    if (r.fehler === 'netz') {
      if (ep.fortsetzungen < 2 && ep.sitzung) {
        ep.fortsetzungen++;
        ep.auftrag = { resume: true, text: this.an(nr, 'Die Verbindung brach ab. Setze an derselben Stelle fort.') };
        this.ereignis(nr, `Netzfehler, Fortsetzung ${ep.fortsetzungen} von 2`);
        return;
      }
      await this.aufraeumen(nr);
      return this.halt(ep, 'blockiert', 'Netzfehler nach zwei Fortsetzungen');
    }
    if (!block) {
      if (r.fehler) {
        // D1: no result or exit code, the run never got going
        await this.aufraeumen(nr);
        if (ep.neustarts < 2) {
          ep.neustarts++;
          ep.sitzung = null;
          ep.auftrag = { resume: false, text: this.startText(nr) };
          this.ereignis(nr, `Start ohne Ergebnis (${r.fehler}, Exit ${r.code}), Neustart ${ep.neustarts} von 2`);
          return;
        }
        return this.halt(ep, 'blockiert', `Start ohne Ergebnis nach zwei Neustarts (${r.fehler})`);
      }
      // D4: ask once, then aborted with the state at the issue
      if (ep.nachfragen < 1 && ep.sitzung) {
        ep.nachfragen++;
        ep.auftrag = { resume: true, text: this.an(nr, `Dein Zug endete ohne FLOTTE-FRAGE oder FLOTTE-ENDE in lesbarer Form. Kannst du fortsetzen? Beende den Zug mit einem der beiden Blöcke. ${this.blockForm(nr)}`) };
        this.ereignis(nr, 'Zug ohne Block, einmal nachgefragt');
        return;
      }
      return this.halt(ep, 'abgebrochen', `Zug ohne Block, auch nach der Nachfrage. Letzter Stand des Laufs:\n\n${r.text.slice(-1500) || '(kein Text)'}`, true);
    }
    ep.nachfragen = 0;
    if (block.art === 'frage') await this.frage(ep, block, vermerk);
    else await this.ende(ep, block);
  }

  halt(ep: FlottenEpic, stufe: 'blockiert' | 'abgebrochen', grund: string, amIssue = false): void {
    this.loslassen(ep.nr);
    ep.stufe = stufe;
    ep.notiz = grund.split('\n')[0];
    ep.haltGrund = grund.slice(0, 3000);
    ep.haltZeit = new Date(this.w.jetzt()).toISOString();
    ep.aufgegebenAm = null;
    this.ereignis(ep.nr, `${stufe}: ${grund.split('\n')[0]}`);
    if (amIssue || stufe === 'blockiert') kommentar(this.w.aufrufer, this.e.forge, ep.nr, `**Flotte (${this.e.admiralName})** — Epic ${stufe}.\n\n${grund}`);
  }

  /** CleanupStale is repository-wide; it spares the locks of every epic that still holds them (halten). */
  async aufraeumen(nr: number | null): Promise<void> {
    if (nr !== null) this.loslassen(nr);
    const r = await this.w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(this.e.skripte, 'worktree.ps1'), '-Action', 'CleanupStale', '-RepoRoot', this.e.repo], { cwd: this.e.repo, timeoutMs: 15 * 60_000 });
    this.ereignis(nr, r.code ? `CleanupStale meldet Fehler: ${(r.stderr || r.stdout).trim().split('\n').pop()}` : 'Reste abgeräumt (CleanupStale)');
  }

  // ---- question blocks (D2, D3)

  async frage(ep: FlottenEpic, block: FrageBlock, vermerk?: string): Promise<void> {
    const nr = ep.nr;
    if (block.phase === 'ram') {
      if (ep.pausiert) {
        // #61: ram.ps1 said hold because of the pause; verteile keeps the answer until fortsetzen
        ep.auftrag = { resume: true, text: this.an(nr, 'Antwort auf FLOTTE-FRAGE ram: A) warten bis ok. Der Mensch hat die Pause aufgehoben, weiter.') };
        ep.notiz = 'pausiert vom Menschen';
        this.ereignis(nr, 'RAM-Frage wegen der Pause: weiter nach fortsetzen');
        return;
      }
      ep.auftrag = { resume: true, text: this.an(nr, 'Antwort auf FLOTTE-FRAGE ram: A) warten bis ok. Der Speicher ist wieder unter der Schwelle, weiter.') };
      ep.notiz = 'wartet auf RAM ok';
      this.ereignis(nr, 'RAM-Frage: weiter, sobald die Bremse frei ist');
      return;
    }
    if (!block.fragen.length) return this.rohFrage(ep, block, vermerk);
    // a run that was told to go on without the parked packages may ask the same again at once: the
    // question already lies with the person, so neither the admiral nor the bridge sees it twice
    // (or he answered while the run was busy, and the answer still waits to be passed on)
    const nachgereicht = !!ep.nachzureichen?.length;
    const offen = this.z.fragen.filter((x) => x.epic === nr && (!x.beantwortet || nachgereicht));
    const neu = block.fragen.filter((f) => !offen.some((x) => gleicheFrage(x, { frage: f.frage, betrifft: betrifftText(f.betrifft) })));
    if (neu.length < block.fragen.length) this.ereignis(nr, `${block.fragen.length - neu.length} Frage(n) wiederholt: liegen schon beim Menschen, nicht neu gestellt`);
    if (!neu.length) {
      const text = this.an(nr, `Antwort auf FLOTTE-FRAGE ${block.phase}: Diese Fragen liegen schon beim Menschen. Seine Antwort kommt mit dieser Nachricht; stelle sie nicht noch einmal.`);
      if (nachgereicht) ep.auftrag = { resume: true, text };
      else {
        ep.stufe = 'frage';
        ep.notiz = 'wartet auf den Menschen';
        ep.festgehalten = text;
      }
      return;
    }
    block.fragen = neu;
    // #54: the denials of the turn stand in the situation of each question, for the admiral and the person
    if (vermerk) for (const f of block.fragen) f.lage = f.lage ? `${f.lage}\n${vermerk}` : vermerk;
    const konto = this.admiralKontoFuer(ep);
    if (!konto) {
      // #111: no account with room; the block waits in the state and goes to the admiral once one is
      // free (wartendeFragen), never to the person for this reason. The stage stays: the place stays
      // taken, and without an order (auftrag) the run gets no turn; on the bridge it waits for nobody.
      ep.wartendeFrage = block;
      ep.notiz = 'Frageblock wartet auf ein freies Konto';
      this.ereignis(nr, `${this.kontoName(this.e.admiralKonto ?? ep.konto!)} rot, kein Konto mit Luft: der Frageblock wartet auf ein freies Konto`);
      return;
    }
    return this.admiralFragen(ep, block, konto);
  }

  /**
   * #111: the account of the admiral's call: his own unless it is red; then another account of the
   * fleet with room, green before yellow, each in the order of --konten; null when all are red.
   * Without --admiral his own is the run's account (flotte/SKILL.md), which may turn red during the turn.
   */
  admiralKontoFuer(ep: FlottenEpic): string | null {
    const eigenes = this.e.admiralKonto ?? ep.konto!;
    if (this.bewertung.get(eigenes)?.stufe !== 'rot') return eigenes;
    const andere = this.e.konten.filter((k) => k !== eigenes);
    return andere.find((k) => this.bewertung.get(k)?.stufe === 'gruen') ?? andere.find((k) => this.bewertung.get(k)?.stufe === 'gelb') ?? null;
  }

  /** #111: waiting question blocks go to the admiral once an account is free; taken from the state first, so each is asked once. */
  async wartendeFragen(): Promise<void> {
    for (const ep of Object.values(this.z.epics)) {
      if (!ep.wartendeFrage || !BELEGT.has(ep.stufe) || this.laufend.has(ep.nr)) continue;
      const konto = this.admiralKontoFuer(ep);
      if (!konto) continue;
      const block = ep.wartendeFrage;
      ep.wartendeFrage = null;
      ep.notiz = '';
      this.ereignis(ep.nr, `${this.kontoName(konto)} hat Luft: der wartende Frageblock geht an den Admiral`);
      await this.admiralFragen(ep, block, konto);
    }
  }

  async admiralFragen(ep: FlottenEpic, block: FrageBlock, konto: string): Promise<void> {
    const nr = ep.nr;
    const eigenes = this.e.admiralKonto ?? ep.konto!;
    if (konto !== eigenes) this.ereignis(nr, `${this.kontoName(eigenes)} rot: der Admiral weicht auf ${this.kontoName(konto)} aus`);
    this.z.statistik.admiral++;
    // the admiral's own, as before #52: the person's answers are no precedent of his
    const frueher = this.z.entscheidungen.filter((d) => d.epic === nr && d.von !== 'mensch').map((d) => `- Frage „${d.frage}" → ${d.antwort} (${d.herkunft})`);
    const kontext = `Epic #${nr} in ${this.e.forge}, Repository ${this.e.repo}.${frueher.length ? `\nFrühere Entscheidungen zu diesem Epic:\n${frueher.join('\n')}` : ''}`;
    const r = await this.w.starte({
      ...this.programm(),
      repo: this.e.repo,
      konto,
      auftrag: admiralAuftrag(block, kontext),
      modell: this.e.admiralModell,
      extraArgs: [...admiralArgs(block), ...(this.e.admiralEffort ? ['--effort', this.e.admiralEffort] : [])],
      werkzeuge: admiralWerkzeuge,
      leerlaufMs: 15 * 60_000,
      log: join(this.dir, 'admiral', `${nr}-${this.w.jetzt()}.jsonl`),
    });
    if (r.fehler === 'werkzeuge') this.ereignis(nr, `${r.stderr.split('\n')[0]}: Admiral beendet, die Fragen gehen an den Menschen`);
    this.antwortenVerteilen(ep, block, antwortenAus(r.fehler === 'werkzeuge' ? null : r.strukturiert, block));
  }

  /** The admiral's answers: decided ones to the run, the rest to the person (the run waits or parks). */
  antwortenVerteilen(ep: FlottenEpic, block: FrageBlock, antworten: ReturnType<typeof antwortenAus>): void {
    const nr = ep.nr;
    const zeilen: string[] = [];
    const geparkt: string[] = [];
    let ganzerLauf = false;
    for (const a of antworten) {
      const f = block.fragen.find((x) => x.nr === a.nr)!;
      const zeit = new Date(this.w.jetzt()).toISOString();
      if (!a.beim_menschen) {
        zeilen.push(`${a.nr}. ${nurBuchstaben(a.antwort) ? a.antwort.trim() : `Antwort: ${a.antwort}`} — Herkunft: ${a.herkunft}`);
        this.z.entscheidungen.push({ epic: nr, nr: a.nr, frage: f.frage, antwort: a.antwort, herkunft: a.herkunft, einflussreich: a.einflussreich, zeit, grund: a.grund, von: f.empfehlung && f.empfehlung === a.antwort ? 'lauf' : 'admiral' });
        const text = `**Entschieden von der Flotte (Admiral ${this.e.admiralName})** — ${f.frage}\nEntscheidung: ${a.antwort}\nHerkunft: ${a.herkunft}\nGrund: ${a.grund}\nVerworfen: ${f.empfehlung && f.empfehlung !== a.antwort ? `Empfehlung des Laufs ${f.empfehlung}` : '—'}\nWiderrufen: Kommentar hier; der Lauf setzt es als nächstes Paket oder in der Nacharbeit um.`;
        kommentar(this.w.aufrufer, this.e.forge, nr, text);
        if (a.einflussreich && this.z.logbuch) kommentar(this.w.aufrufer, this.e.forge, this.z.logbuch, `**Protokoll Flotte (Admiral ${this.e.admiralName})** — Epic #${nr}, ${zeit.slice(0, 10)}\nFrage: ${f.frage}\nLage: ${f.lage}\nOptionen: ${f.optionen.map((o) => `${o.buchstabe}) ${o.text}`).join(' ')} (Empfehlung des Laufs: ${f.empfehlung ?? '—'})\nEntscheidung: ${a.antwort}\nWarum: ${a.grund}\nHerkunft: ${a.herkunft}`);
        this.ereignis(nr, `✔ Frage ${a.nr}: ${a.antwort} — ${a.herkunft}`);
        continue;
      }
      const lauf = f.betrifft === 'Lauf' || f.betrifft === null;
      if (lauf) ganzerLauf = true;
      else geparkt.push(...f.betrifft as string[]);
      const wartet = lauf ? 'der ganze Lauf' : (f.betrifft as string[]).join(', ');
      const betrifft = f.betrifft === null ? '' : f.betrifft === 'Lauf' ? 'Lauf' : f.betrifft.join(', ');
      this.z.fragen.push({ epic: nr, nr: a.nr, frage: f.frage, lage: f.lage, optionen: f.optionen, mehrfach: f.mehrfach, grund: a.grund, herkunft: a.herkunft, marke: a.marke ?? '', umkehrbar: a.umkehrbar ?? null, betrifft, roh: f.roh, empfehlung: a.antwort, wartet, ganzerLauf: lauf, seit: zeit });
      zeilen.push(`${a.nr}. liegt beim Menschen${lauf ? '' : `; geparkt: ${wartet}`}`);
      kommentar(this.w.aufrufer, this.e.forge, nr, `**FRAGE AN DEN MENSCHEN (Flotte)** — ${f.frage}\nLage: ${f.lage}\nOptionen: ${f.optionen.map((o) => `${o.buchstabe}) ${o.text}`).join(' ')}\nEmpfehlung: ${a.antwort} — ${a.grund}\nOhne Antwort wartet: ${wartet}. Alles andere läuft weiter.\nAntworten, im Repository: \`flotte antworten . ${nr} ${a.nr} "<Antwort>"\``);
      this.ereignis(nr, `❓ Frage ${a.nr} liegt beim Menschen (wartet: ${wartet})`);
    }
    const text = this.an(nr, `Antwort des Admirals auf FLOTTE-FRAGE ${block.phase}:\n${zeilen.join('\n')}${geparkt.length && !ganzerLauf ? `\nweiter ohne ${[...new Set(geparkt)].join(', ')}` : ''}`);
    if (ganzerLauf) {
      ep.stufe = 'frage';
      ep.festgehalten = text;
      ep.notiz = 'wartet auf den Menschen';
    } else {
      ep.geparkt = [...new Set([...ep.geparkt, ...geparkt])];
      ep.auftrag = { resume: true, text };
    }
  }

  /** Answers of the person: `flotte antworten` appends them to antworten.jsonl (no lock needed). */
  antwortenLesen(): void {
    const datei = join(this.dir, 'antworten.jsonl');
    if (!existsSync(datei)) return;
    const zeilen = readFileSync(datei, 'utf8').split('\n').filter(Boolean);
    for (const z of zeilen.slice(this.z.antwortenGelesen)) {
      let a: { epic: number; nr: number; text: string };
      try {
        a = JSON.parse(z);
      } catch {
        continue;
      }
      if (!this.antwortAnwenden(a)) this.ereignis(a.epic ?? null, `Antwort auf Frage ${a.nr} passt zu keiner offenen Frage`);
    }
    this.z.antwortenGelesen = zeilen.length;
  }

  /** One answer of the person, from `flotte antworten` or the bridge; false when it fits no open question. */
  antwortAnwenden(a: { epic: number; nr: number; text: string; seit?: string; brueckeId?: number; anzeige?: string }): boolean {
    const f = this.z.fragen.find((x) => x.epic === a.epic && x.nr === a.nr && (a.seit === undefined || x.seit === a.seit) && !x.beantwortet);
    const ep = this.epic(a.epic);
    if (!f || !ep) return false;
    const ueberBruecke = a.brueckeId !== undefined;
    f.beantwortet = a.text;
    const am = new Date(this.w.jetzt()).toISOString();
    f.beantwortetAm = am;
    if (ueberBruecke) f.brueckeId = a.brueckeId;
    // #52: the answer is a decision of the person, revocable on the bridge until the merge like the admiral's
    this.z.entscheidungen.push({ epic: a.epic, nr: a.nr, frage: f.frage || `Frage ${a.nr}`, antwort: a.anzeige ?? a.text, herkunft: ueberBruecke ? HERKUNFT_BRUECKE : HERKUNFT_FLOTTE, einflussreich: false, zeit: am, von: 'mensch' });
    ep.nachzureichen = [...(ep.nachzureichen ?? []), `${a.nr}. ${a.text}`];
    kommentar(this.w.aufrufer, this.e.forge, a.epic, ueberBruecke ? `**Antwort des Menschen (${HERKUNFT_BRUECKE})** — ${f.frage || `Frage ${a.nr}`}\nAntwort: ${a.anzeige ?? a.text}\nHerkunft: ${HERKUNFT_BRUECKE}` : `**Antwort des Menschen (über die Flotte)** — ${f.frage}\nAntwort: ${a.text}`);
    this.ereignis(a.epic, `Antwort des Menschen auf Frage ${a.nr}${ueberBruecke ? ' (über die Brücke)' : ''}`);
    this.wiederholungenSchliessen();
    const offen = this.z.fragen.some((x) => x.epic === a.epic && x.ganzerLauf && !x.beantwortet);
    if (ep.stufe === 'frage' && !offen) {
      ep.stufe = 'laeuft';
      ep.notiz = '';
      ep.auftrag = { resume: true, text: ep.festgehalten ?? this.an(a.epic, 'weiter') };
      ep.festgehalten = null;
    } else if (!this.laufend.has(a.epic) && !ep.auftrag && ep.stufe === 'pr') {
      ep.stufe = 'laeuft';
      ep.auftrag = { resume: true, text: this.an(a.epic, 'Arbeite die geparkten Pakete ab, dann FLOTTE-ENDE.') };
    }
    return true;
  }

  /** Open questions stored without options, from a run that wrote them into the text: read again from the wording. */
  optionenNachlesen(): void {
    for (const x of this.z.fragen) {
      if (x.beantwortet || x.optionen?.length || !x.roh) continue;
      const b = leseBlock(`FLOTTE-FRAGE ${x.epic} nachlesen\n${x.roh}`);
      const f = b?.art === 'frage' ? b.fragen[0] : undefined;
      if (!f?.optionen.length) continue;
      x.frage = f.frage;
      x.optionen = f.optionen;
    }
  }

  /** Open repeats of a question the person has answered since are closed with that answer (bridge shows each once). */
  wiederholungenSchliessen(): void {
    for (const x of this.z.fragen) {
      if (x.beantwortet) continue;
      const y = this.z.fragen.find((f) => f !== x && f.epic === x.epic && f.beantwortet && !f.wiederholungVon && (f.beantwortetAm ?? '') >= x.seit && gleicheFrage(f, x));
      if (!y) continue;
      x.beantwortet = y.beantwortet;
      x.beantwortetAm = y.beantwortetAm;
      x.wiederholungVon = y.seit;
      this.ereignis(x.epic, `Wiederholte Frage ${x.nr} geschlossen: beantwortet mit der Frage von ${y.seit.slice(11, 19)}`);
    }
  }

  /** A question block without a parsable question: the whole block goes to the person (#28, Rückfall). */
  rohFrage(ep: FlottenEpic, block: FrageBlock, vermerk?: string): void {
    const nr = ep.nr;
    const zeit = new Date(this.w.jetzt()).toISOString();
    this.z.fragen.push({ epic: nr, nr: 1, frage: '', lage: vermerk ?? '', optionen: [], grund: '', herkunft: 'Treiber: Block nicht zerlegbar', marke: 'Block unlesbar', betrifft: 'Lauf', roh: block.roh, empfehlung: '', wartet: 'der ganze Lauf', ganzerLauf: true, seit: zeit });
    kommentar(this.w.aufrufer, this.e.forge, nr, `**FRAGE AN DEN MENSCHEN (Flotte)** — Der Block FLOTTE-FRAGE ${block.phase} ließ sich nicht in Fragen zerlegen. Wortlaut:\n\n${block.roh}\n\nAntworten, im Repository: \`flotte antworten . ${nr} 1 "<Antwort>"\``);
    this.ereignis(nr, `❓ FLOTTE-FRAGE ${block.phase} nicht zerlegbar: der Wortlaut liegt beim Menschen`);
    ep.stufe = 'frage';
    ep.notiz = 'wartet auf den Menschen';
    ep.festgehalten = this.an(nr, `Antwort auf FLOTTE-FRAGE ${block.phase}: Der Block ließ sich nicht in Fragen zerlegen; der Mensch hat ihn gelesen und antwortet.`);
  }

  // ---- the Flottenbrücke (#28): only the driver talks to it; off or slow is no error

  async brueckeHolen(): Promise<void> {
    if (!this.bruecke) return;
    const liste = await this.bruecke.hole(this.e.forge);
    this.brueckeErreichbar(liste !== undefined);
    for (const a of liste ?? []) {
      // fetched again (the acknowledgement did not reach the bridge): the question already has it
      const schon = this.z.fragen.find((f) => f.epic === a.epic && f.nr === a.nr && f.seit === a.seit && f.beantwortet);
      if (schon) {
        if (schon.brueckeId !== a.id) this.ereignis(a.epic, `Antwort über die Brücke auf Frage ${a.nr} kam zu spät: schon beantwortet`);
      } else if (!this.antwortAnwenden({ epic: a.epic, nr: a.nr, seit: a.seit, text: antwortZeile(a), anzeige: [a.option, a.text].filter(Boolean).join(' — '), brueckeId: a.id })) {
        this.ereignis(a.epic, `Antwort über die Brücke auf Frage ${a.nr} passt zu keiner offenen Frage`);
      }
      if (!this.zuQuittieren.includes(a.id)) this.zuQuittieren.push(a.id);
    }
    if (liste === undefined) return;
    for (const h of (await this.bruecke.holeHandlungen(this.e.forge)) ?? []) {
      const erledigt = (this.z.handlungenErledigt ??= []);
      if (!erledigt.includes(h.id)) {
        this.handlungAnwenden(h);
        erledigt.push(h.id);
        if (erledigt.length > 200) erledigt.splice(0, erledigt.length - 200);
      }
      if (!this.handlungenZuQuittieren.includes(h.id)) this.handlungenZuQuittieren.push(h.id);
    }
  }

  /**
   * An action of the person on the bridge (#28, v2), carried out like an answer: requeue or give up a
   * blocked or aborted epic, revoke a decision of the admiral or an answer of the person (#52). One that no longer fits is an event.
   */
  handlungAnwenden(h: BrueckenHandlung): void {
    const ep = this.epic(h.epic);
    const jetzt = new Date(this.w.jetzt()).toISOString();
    const amIssue = (text: string) => kommentar(this.w.aufrufer, this.e.forge, h.epic, `${text}\nHerkunft: ${HERKUNFT_BRUECKE}`);
    if (h.art === 'einstellen') return this.einstellen(h);
    if (h.art === 'aufnehmen') return this.aufnehmen(h);
    if (!ep) return this.ereignis(h.epic, `Handlung ${h.art} über die Brücke: Epic gehört nicht zu diesem Einsatz`);
    if (h.art === 'widerruf') {
      const d = this.z.entscheidungen.find((x) => x.epic === h.epic && x.nr === h.nr && x.zeit === h.seit);
      if (!d) return this.ereignis(h.epic, `Widerruf über die Brücke zu Frage ${h.nr}: keine solche Entscheidung`);
      // once only, like the bridge (409): a report the bridge had not yet seen let a second one through
      if (d.widerrufen) return this.ereignis(h.epic, `Widerruf über die Brücke zu Frage ${h.nr}: schon widerrufen`);
      const text = h.text!.trim();
      d.widerrufen = text;
      amIssue(`**Widerruf des Menschen (${HERKUNFT_BRUECKE})** — ${d.frage}\nwiderrufen vom Menschen: ${text}\nVorher: ${d.antwort} (${d.herkunft})`);
      if (d.einflussreich && this.z.logbuch) kommentar(this.w.aufrufer, this.e.forge, this.z.logbuch, `**Protokoll Flotte** — Epic #${h.epic}, Frage: ${d.frage}\nwiderrufen vom Menschen: ${text}`);
      if (['gemergt', 'fertig'].includes(ep.stufe) || this.mergesOffen.has(ep.nr)) {
        return this.ereignis(h.epic, `Widerruf zu Frage ${h.nr} kam ${ep.stufe === 'fertig' ? 'nach' : 'während'} dem Merge: daraus wird nur ein Ticket, wenn es nötig ist (epic/SKILL.md, Regel 3)`);
      }
      ep.widerrufe = [...(ep.widerrufe ?? []), `widerruf: ${d.frage} → ${text}`];
      if (ep.stufe === 'pr' && !this.laufend.has(ep.nr) && !ep.auftrag) {
        ep.stufe = 'laeuft';
        ep.prBereitGemeldet = false;
        this.z.schlange = this.z.schlange.filter((n) => n !== ep.nr);
        ep.auftrag = { resume: true, text: this.an(ep.nr, `Setze den Widerruf um, dann FLOTTE-ENDE. ${this.blockForm(ep.nr)}`) };
      }
      return this.ereignis(h.epic, `Widerruf des Menschen zu Frage ${h.nr} (über die Brücke): ${text.slice(0, 120)}`);
    }
    if (h.art === 'pausieren' || h.art === 'fortsetzen' || h.art === 'prioritaet') return this.steuern(h, ep);
    if (h.art === 'merge') return this.mergeStellen(h, ep);
    if (!['blockiert', 'abgebrochen'].includes(ep.stufe) || ep.aufgegebenAm) return this.ereignis(h.epic, `Handlung ${h.art} über die Brücke: Epic ist ${ep.stufe}, nichts zu tun`);
    if (h.art === 'aufgeben') {
      ep.stufe = 'abgebrochen';
      ep.aufgegebenAm = jetzt;
      ep.auftrag = null;
      ep.notiz = 'aufgegeben vom Menschen';
      this.loslassen(ep.nr);
      amIssue(`**Epic aufgegeben vom Menschen (${HERKUNFT_BRUECKE})**\nGrund der Blockade war: ${ep.haltGrund?.split('\n')[0] ?? ep.notiz}`);
      return this.ereignis(h.epic, 'aufgegeben vom Menschen (über die Brücke)');
    }
    // einreihen: the counters start over; with a session the run continues where it stopped
    const grund = ep.haltGrund?.split('\n')[0] ?? ep.notiz;
    Object.assign(ep, { neustarts: 0, fortsetzungen: 0, nachfragen: 0, leerlaeufe: 0, sperren: [], mergeVersuche: 0, gateWiederholungen: 0, konfliktGemeldet: false, prBereitGemeldet: false, haltGrund: null, haltZeit: null, notiz: 'neu eingereiht vom Menschen' });
    if (ep.sitzung && ep.konto) {
      ep.stufe = 'laeuft';
      // #54: questions of the run still without an answer are said to be open, never decided by the run
      const offen = this.z.fragen.filter((f) => f.epic === ep.nr && !f.beantwortet).map((f) => `${f.nr}. ${f.frage || 'Block nicht zerlegbar'}`);
      const fragen = offen.length ? `\nOffen und ohne Antwort des Menschen:\n${offen.join('\n')}\nEntscheide sie nicht selbst. Stelle sie im nächsten FLOTTE-FRAGE erneut.` : '';
      ep.auftrag = { resume: true, text: this.an(ep.nr, `Der Mensch hat dein Epic nach der Blockade neu eingereiht. Grund der Blockade war: ${grund}. Setze an derselben Stelle fort und beende den Zug mit FLOTTE-FRAGE oder FLOTTE-ENDE. ${this.blockForm(ep.nr)}${fragen}`) };
    } else {
      ep.stufe = 'wartend';
      ep.konto = null;
      ep.auftrag = null;
    }
    amIssue(`**Epic neu eingereiht vom Menschen (${HERKUNFT_BRUECKE})**\nGrund der Blockade war: ${grund}`);
    this.ereignis(h.epic, `neu eingereiht vom Menschen (über die Brücke)${ep.stufe === 'wartend' ? ', wartet auf einen Platz' : ', der Lauf setzt fort'}`);
  }

  // ---- steering epics (#61)

  /** an event and a comment in the fleet logbook, like a setting */
  imLogbuch(epic: number | null, text: string): void {
    this.ereignis(epic, text);
    if (this.z.logbuch) kommentar(this.w.aufrufer, this.e.forge, this.z.logbuch, `**Flotte (${this.e.admiralName})** — ${text}.`);
  }

  /**
   * aufnehmen: an open epic with epic_label and the release label (on it or a child) joins the
   * deployment now, checked against the forge here; ready_label, merge rule and gate stay as they are.
   * It starts by the occupancy like every other epic and stays after a restart.
   */
  aufnehmen(h: BrueckenHandlung): void {
    const nr = h.epic;
    const nein = (grund: string) => this.ereignis(nr, `Aufnehmen über die Brücke abgelehnt: ${grund}`);
    if (this.e.epics.includes(nr)) return nein('schon im Einsatz');
    const ep = this.epic(nr);
    if (ep && (['gemergt', 'fertig'].includes(ep.stufe) || ep.aufgegebenAm)) return nein(`Epic ist ${ep.aufgegebenAm ? 'aufgegeben' : ep.stufe}`);
    try {
      if (!freigegebene(this.w.aufrufer, this.e.forge, this.adapter).epics.includes(nr)) return nein(`kein offenes Epic mit ${this.adapter.epic_label} und ${this.adapter.ready_label}`);
      this.bilder = sammle(this.w.aufrufer, this.e.repo, this.e.forge, [...this.e.epics, nr]).bilder;
    } catch (err) {
      return nein(`Forge nicht lesbar (${String(err).slice(0, 200)})`);
    }
    this.e.epics = [...this.e.epics, nr];
    this.z.epics[nr] ??= neuesEpic(nr);
    (this.z.aufgenommen ??= []).push(nr);
    this.freigegeben = this.freigegeben.filter((n) => n !== nr);
    this.imLogbuch(nr, `Epic #${nr} in den Einsatz aufgenommen, ${HERKUNFT_BRUECKE}`);
  }

  /**
   * pausieren, fortsetzen, prioritaet of an epic in the deployment. A pause stops nothing: a waiting
   * epic does not start, a turn under way runs to its end (its ram.ps1 reads the pause from the
   * holder file and holds before the next package start), the next turn (the admiral's answer, a
   * continuation) waits in auftrag until fortsetzen hands it over unchanged. The priority orders the
   * startable epics only; order edges and collisions keep their say (belege).
   */
  steuern(h: BrueckenHandlung, ep: FlottenEpic): void {
    const nr = ep.nr;
    const was = { pausieren: 'Pausieren', fortsetzen: 'Fortsetzen', prioritaet: 'Priorität' }[h.art as 'pausieren' | 'fortsetzen' | 'prioritaet'];
    const nein = (grund: string) => this.ereignis(nr, `${was} über die Brücke abgelehnt: ${grund}`);
    if (!this.e.epics.includes(nr)) return nein('Epic ist nicht im Einsatz');
    if (['gemergt', 'fertig'].includes(ep.stufe) || ep.aufgegebenAm) return nein(`Epic ist ${ep.aufgegebenAm ? 'aufgegeben' : ep.stufe}`);
    if (h.art === 'prioritaet') {
      const p = h.text?.trim();
      if (p !== 'hoch' && p !== 'normal') return nein(`unbekannte Priorität ${JSON.stringify(h.text ?? null).slice(0, 40)}`);
      const vorher = this.prio(nr) ? 'hoch' : 'normal';
      ep.prioritaet = p;
      return this.imLogbuch(nr, `Priorität von #${nr} von ${vorher} → auf ${p}, ${HERKUNFT_BRUECKE}`);
    }
    if (h.art === 'pausieren') {
      if (ep.pausiert) return nein('schon pausiert');
      ep.pausiert = new Date(this.w.jetzt()).toISOString();
      this.pauseVermerken(ep);
      if (ep.stufe === 'wartend') ep.notiz = 'pausiert vom Menschen';
      const lage = this.laufend.has(nr) ? ', der laufende Zug läuft zu Ende, danach wartet es' : ep.stufe === 'wartend' ? ', startet nicht' : ', kein weiterer Zug';
      return this.imLogbuch(nr, `Epic #${nr} pausiert${lage}; ${HERKUNFT_BRUECKE}`);
    }
    if (!ep.pausiert) return nein('nicht pausiert');
    ep.pausiert = null;
    this.pauseVermerken(ep);
    if (ep.notiz === 'pausiert vom Menschen') ep.notiz = '';
    this.imLogbuch(nr, `Epic #${nr} fortgesetzt${ep.auftrag && !this.laufend.has(nr) ? ', der zurückgehaltene Zug geht an den Lauf' : ''}; ${HERKUNFT_BRUECKE}`);
  }

  /**
   * #112: the person's switch for the merge of one epic: automatisch, mensch, or null (back to the
   * proposal). automatisch only while the adapter says merge: nach_gate. From this turn on: an epic
   * that waits in pr for a person because of its merge joins the merge queue (wiederAndocken); one in
   * the queue but not yet at its head stays out of it (kopf); a merge under way runs to its end.
   */
  mergeStellen(h: BrueckenHandlung, ep: FlottenEpic): void {
    const nr = ep.nr;
    const nein = (grund: string) => this.ereignis(nr, `Andocken über die Brücke abgelehnt: ${grund}`);
    if (!this.e.epics.includes(nr)) return nein('Epic ist nicht im Einsatz');
    if (['gemergt', 'fertig'].includes(ep.stufe) || ep.aufgegebenAm) return nein(`Epic ist ${ep.aufgegebenAm ? 'aufgegeben' : ep.stufe}`);
    const neu = h.text?.trim() || null;
    if (neu !== null && neu !== 'automatisch' && neu !== 'mensch') return nein(`unbekannte Stellung ${JSON.stringify(h.text).slice(0, 40)}`);
    const gesperrt = this.mergeGesperrt('merge', neu);
    if (gesperrt) return nein(gesperrt);
    const vorher = this.stellung(ep);
    ep.merge = neu;
    const jetzt = this.stellung(ep);
    this.imLogbuch(nr, `Andocken von #${nr} von ${vorher.stellung} → auf ${neu ?? `${jetzt.herkunft === 'vorschlag' ? 'den Vorschlag' : 'die Einstellung des Projekts'} (${jetzt.stellung})`}, ${HERKUNFT_BRUECKE}`);
    this.wiederAndocken();
  }

  /** #112: a PR held for a person only by its merge goes to the merge queue once its merge says automatisch */
  wiederAndocken(): void {
    for (const ep of Object.values(this.z.epics)) {
      if (ep.stufe !== 'pr' || !ep.pr || !ep.notiz.includes(MENSCH_PRUEFT) || this.z.schlange.includes(ep.nr) || this.laufend.has(ep.nr) || ep.auftrag || this.menschPrueft(ep)) continue;
      ep.prBereitGemeldet = false;
      this.andocken(ep);
    }
  }

  /** #61: the released epics outside the deployment for the bridge; a forge that does not answer keeps the last list */
  freigegebenLesen(): void {
    if (!this.bruecke || this.w.jetzt() - this.freigegebenZeit < PAKETE_MS) return;
    this.freigegebenZeit = this.w.jetzt();
    try {
      this.freigegeben = freigegebene(this.w.aufrufer, this.e.forge, this.adapter).epics.filter((n) => !this.e.epics.includes(n));
    } catch {
      // the list only offers aufnehmen; the driver asks the forge again when the action comes
    }
  }

  /** the title of a released epic outside the deployment, read once */
  freiTitelVon(nr: number): string {
    if (!this.freiTitel.has(nr)) {
      const r = this.w.aufrufer('gh', ['issue', 'view', String(nr), '--repo', this.e.forge, '--json', 'title']);
      let t = '';
      try {
        t = r.code ? '' : String((JSON.parse(r.stdout) as { title?: string }).title ?? '');
      } catch {
        t = '';
      }
      this.freiTitel.set(nr, t);
    }
    return this.freiTitel.get(nr)!;
  }

  // ---- settings (#58)

  /** short name → CLAUDE_CONFIG_DIR of the accounts that exist: the table's, those of the start, the runs', the admiral's */
  kontenAuswahl(): Map<string, string> {
    const m = new Map<string, string>();
    for (const d of [...Object.keys(kontenTafel()).map((n) => kontoAus(n)), ...this.startKonten, ...this.alleKonten()]) {
      const k = this.kontoKurz(d);
      if (!m.has(k) && existsSync(d)) m.set(k, d);
    }
    return m;
  }

  /** `Konto <n>` by the table, else the folder name; not `Admiral-Konto`, so a name stays when the admiral moves */
  kontoKurz(dir: string): string {
    return kurzname(dir);
  }

  einstellung(name: EinstellungName): Wert {
    return liesEinstellung(this.e, name, (d) => this.kontoKurz(d));
  }

  standardWert(name: EinstellungName): Wert {
    if (name === 'merge') return this.adapter.merge === 'nach_gate' ? 'automatisch' : 'mensch';
    return name === 'konten' ? this.startKonten.map((d) => this.kontoKurz(d)) : EINSTELLUNGEN[name].standard;
  }

  /** #112: the bridge only tightens: automatisch is refused while the adapter says merge: mensch (merge.ps1 would refuse it too) */
  mergeGesperrt(name: EinstellungName, wert: unknown): string | null {
    return name === 'merge' && wert === 'automatisch' && this.adapter.merge !== 'nach_gate' ? NUR_NACH_GATE : null;
  }

  /** #112: the merge of an epic now: the person's switch, else the proposal from its content, else the project */
  stellung(ep: FlottenEpic): WirksameStellung {
    return wirksameStellung(this.e.merge, this.adapter.merge, this.bilder.find((b) => b.nr === ep.nr)?.mergeVorschlag ?? null, ep.merge);
  }

  /**
   * At the start: a setting changed on the bridge holds again, unless a start parameter given
   * explicitly sets it; then the start parameter wins and an event says so. A stored value that no
   * longer fits (an account gone) is an event and is dropped.
   */
  einstellungenLaden(anfang: string): void {
    this.startKonten = [...this.e.konten];
    const gespeichert = (this.z.einstellungen ??= {});
    for (const name of NAMEN) {
      const jetzt = this.einstellung(name);
      const vomStart = this.e.gesetzt ? this.e.gesetzt.includes(name) : JSON.stringify(jetzt) !== JSON.stringify(this.standardWert(name));
      const b = gespeichert[name];
      if (b && vomStart) {
        delete gespeichert[name];
        if (JSON.stringify(b.wert) !== JSON.stringify(jetzt)) this.ereignis(null, `Einstellung ${EINSTELLUNGEN[name].titel}: Startparameter ${START_PARAMETER[name] ?? ''} gilt (${zeige(jetzt)}) statt ${zeige(b.wert)} von der Brücke`);
      } else if (b) {
        const fehler = this.mergeGesperrt(name, b.wert) ?? setzeEinstellung(this.e, name, b.wert, this.kontenAuswahl());
        if (!fehler) {
          this.herkunft.set(name, { herkunft: 'bruecke', seit: b.seit });
          continue;
        }
        delete gespeichert[name];
        this.ereignis(null, `Einstellung ${EINSTELLUNGEN[name].titel} von der Brücke (${zeige(b.wert)}) gilt nicht mehr: ${fehler}`);
      }
      this.herkunft.set(name, { herkunft: vomStart ? 'start' : 'standard', seit: anfang });
    }
  }

  /**
   * einstellen over the bridge (#58), with the PIN like a revocation: checked against the limits here,
   * in effect from this turn's brakes and occupancy on. Nothing running stops: a lower limit starts
   * fewer, an account taken off starts nothing new while its runs stay on it. A value that does not
   * fit is an event, nothing changes.
   */
  einstellen(h: BrueckenHandlung): void {
    let roh: { name?: unknown; wert?: unknown } | null;
    try {
      roh = JSON.parse(h.text ?? '');
    } catch {
      roh = null;
    }
    const name = roh?.name;
    if (!roh || typeof roh !== 'object' || !istName(name) || !('wert' in roh)) {
      return this.ereignis(null, `Einstellung über die Brücke abgelehnt: ${istName(name) ? 'kein Wert' : `unbekannte Einstellung ${JSON.stringify(name ?? null).slice(0, 60)}`}`);
    }
    const titel = EINSTELLUNGEN[name].titel;
    const vorher = this.einstellung(name);
    const gelb = name === 'verbrauchGelb' ? roh.wert : this.e.verbrauchGelb;
    const rot = name === 'verbrauchRot' ? roh.wert : this.e.verbrauchRot;
    const quer = (name === 'verbrauchGelb' || name === 'verbrauchRot') && typeof gelb === 'number' && typeof rot === 'number' && gelb >= rot ? `gelb (${gelb}) muss unter rot (${rot}) liegen` : null;
    const fehler = setzeEinstellung({ ...this.e }, name, roh.wert, this.kontenAuswahl()) ?? quer ?? this.mergeGesperrt(name, roh.wert);
    if (fehler) return this.ereignis(null, `Einstellung ${titel} über die Brücke abgelehnt: ${fehler}`);
    setzeEinstellung(this.e, name, roh.wert, this.kontenAuswahl());
    const nachher = this.einstellung(name);
    const seit = new Date(this.w.jetzt()).toISOString();
    this.herkunft.set(name, { herkunft: 'bruecke', seit });
    (this.z.einstellungen ??= {})[name] = { wert: nachher, seit };
    const text = `Einstellung ${titel} von ${zeige(vorher)} → auf ${zeige(nachher)}, ${HERKUNFT_BRUECKE}`;
    this.ereignis(null, text);
    if (this.z.logbuch) kommentar(this.w.aufrufer, this.e.forge, this.z.logbuch, `**Flotte (${this.e.admiralName})** — ${text}.`);
    if (name === 'merge') this.wiederAndocken();
    if (name === 'paketeJeEpic' && nachher !== vorher) for (const ep of Object.values(this.z.epics)) if (!ENDE.has(ep.stufe)) ep.grenze = this.e.paketeJeEpic;
  }

  /** The settings in effect for the report: value, origin, since when, and the limits or the accounts to choose from. */
  einstellungenBericht(): BerichtEinstellung[] {
    const auswahl = [...this.kontenAuswahl().keys()];
    return NAMEN.map((name) => {
      const a: { titel: string; leer: boolean; min?: number; max?: number; konto?: string; werte?: string[] } = EINSTELLUNGEN[name];
      const h = this.herkunft.get(name) ?? { herkunft: 'standard' as const, seit: this.z.stand };
      // #112: only the words the driver takes now, and why automatisch is missing
      const werte = a.werte?.filter((w) => !this.mergeGesperrt(name, w));
      const art = a.konto ? { auswahl } : werte ? { werte, hinweis: werte.length < a.werte!.length ? NUR_NACH_GATE : null } : { min: a.min, max: a.max };
      return { name, titel: a.titel, wert: this.einstellung(name), herkunft: h.herkunft, seit: h.seit, standard: this.standardWert(name), leer: a.leer, ...art };
    });
  }

  /** The report of this turn; acknowledgements only after the state with the answers is written. */
  async brueckeMelden(): Promise<void> {
    if (!this.bruecke) return;
    this.sitzungenLesen();
    const ok = await this.bruecke.melde(this.bericht());
    this.brueckeErreichbar(ok);
    if (!ok) return;
    for (const id of [...this.zuQuittieren]) if (await this.bruecke.quittiere(id)) this.zuQuittieren = this.zuQuittieren.filter((x) => x !== id);
    for (const id of [...this.handlungenZuQuittieren]) if (await this.bruecke.quittiereHandlung(id)) this.handlungenZuQuittieren = this.handlungenZuQuittieren.filter((x) => x !== id);
    await this.holodeckMelden();
  }

  /** Reads the sessions of all accounts without holding the turn up; a failure leaves the list empty. */
  sitzungenLesen(): void {
    if (this.sitzungenLaeuft || this.w.jetzt() - this.sitzungenGelesen < SITZUNGEN_MS) return;
    this.sitzungenLaeuft = true;
    this.sitzungenGelesen = this.w.jetzt();
    liesSitzungen(this.alleKonten().map((dir) => ({ dir, konto: kurzname(dir, this.e.admiralKonto) })), this.w.langsam)
      .then((s) => (this.sitzungen = s))
      .catch(() => (this.sitzungen = []))
      .finally(() => (this.sitzungenLaeuft = false));
  }

  /**
   * The prototypes of the project (Holodeck, #44), only when the set changed since the bridge last
   * took it; a removed file disappears there with the next set. A bridge without the Holodeck or one
   * that is off costs nothing more than the report.
   */
  async holodeckMelden(): Promise<void> {
    if (!this.bruecke) return;
    const { dateien, meldungen } = liesPrototypen(this.e.repo, this.adapter.prototype_dir);
    for (const m of meldungen) {
      if (this.holodeckGemeldet.has(m)) continue;
      this.holodeckGemeldet.add(m);
      this.ereignis(null, `Holodeck: ${m}`);
    }
    const stand = prototypenStand(dateien);
    if (stand !== this.holodeckStand && (await this.bruecke.holodeck(this.e.forge, dateien))) this.holodeckStand = stand;
  }

  /**
   * An event (a question for the person, a change of stage, a merge) goes to the board at once, not
   * only with the turn. Without acknowledgements: those wait for the saved state.
   */
  brueckeBald(): void {
    if (!this.bruecke || this.meldungGeplant) return;
    this.meldungGeplant = true;
    setTimeout(() => {
      this.meldungGeplant = false;
      this.bruecke?.melde(this.bericht()).then((ok) => this.brueckeErreichbar(ok));
    }, 50);
  }

  /** Asks the bridge every brueckeAbfrageMs; resolves when it holds an answer. */
  antwortWache(): { p: Promise<void>; stop: () => void } {
    let aus = false;
    let uhr: ReturnType<typeof setTimeout> | undefined;
    const schlaf = () => new Promise<void>((r) => (uhr = setTimeout(r, this.e.brueckeAbfrageMs)));
    const p = (async () => {
      while (!aus) {
        await schlaf();
        if (aus) return;
        if ((await this.bruecke!.hole(this.e.forge))?.length) return;
      }
    })();
    return { p, stop: () => ((aus = true), clearTimeout(uhr)) };
  }

  brueckeErreichbar(ja: boolean): void {
    if (this.brueckeDa === ja) return;
    this.brueckeDa = ja;
    this.ereignis(null, ja ? `Flottenbrücke erreichbar (${this.e.bruecke})` : `Flottenbrücke nicht erreichbar (${this.e.bruecke}): der Treiber arbeitet ohne sie weiter`);
  }

  /**
   * The child tickets of each epic, waiting ones ("Bereit") included, with title and stand (#28, Nachtrag 2), only with a bridge and at
   * most every PAKETE_MS per epic; a stage change reads them again. Spec mode has no children here.
   */
  paketeLesen(): void {
    if (!this.bruecke) return;
    for (const b of this.bilder) {
      const ep = this.epic(b.nr);
      if (!ep || !b.kinder?.length) continue;
      const schluessel = `${ep.stufe}|${ep.geparkt.join(',')}`;
      if (ep.paketeZeit && this.w.jetzt() - ep.paketeZeit < PAKETE_MS && this.paketeStand.get(b.nr) === schluessel) continue;
      if (ep.paketeZeit && ['fertig', 'abgebrochen'].includes(ep.stufe) && ep.pakete?.length) continue;
      this.paketeStand.set(b.nr, schluessel);
      ep.paketeZeit = this.w.jetzt();
      const alt = new Map((ep.pakete ?? []).map((p) => [p.nr, p]));
      const imBranch = this.imEpicBranch(b.nr);
      ep.pakete = b.kinder.map((k) => {
        const r = this.w.aufrufer('gh', ['issue', 'view', String(k), '--repo', this.e.forge, '--json', 'number,title,state,labels,closedAt']);
        let j: { title?: string; state?: string; labels?: { name?: string }[]; closedAt?: string | null } = {};
        try {
          j = r.code ? {} : JSON.parse(r.stdout);
        } catch {
          j = {};
        }
        const labels = (j.labels ?? []).map((l) => l?.name);
        const geparkt = ep.geparkt.some((g) => g.replace(/^#/, '') === String(k));
        const stand: BerichtPaket['stand'] = r.code
          ? (alt.get(k)?.stand ?? 'offen')
          : j.state === 'CLOSED' || imBranch.has(k)
            ? 'fertig'
            : geparkt
              ? 'geparkt'
              : labels.includes('status/haengt')
                ? 'zurueckgelassen'
                : labels.includes('status/blockiert')
                  ? 'blockiert'
                  : labels.includes('status/in-arbeit')
                    ? 'laeuft'
                    : 'offen';
        // first seen working: the start of a package; closedAt its end (both null for an open one)
        const beginn = alt.get(k)?.beginn ?? (stand === 'offen' || stand === 'fertig' ? null : new Date(this.w.jetzt()).toISOString());
        const ende = stand === 'fertig' ? (imBranch.get(k) ?? j.closedAt ?? alt.get(k)?.ende ?? null) : null;
        return { name: `#${k}`, nr: k, titel: String(j.title ?? alt.get(k)?.titel ?? ''), stand, beginn, ende };
      });
      this.tafelAlt = true;
    }
  }

  /**
   * The children already merged into the epic branch, with the time of that merge: a child stays open
   * (status/in-arbeit) until the epic PR closes it. One git log per epic read: the local branch
   * epic/<nr>-… (often only in the epic worktree), else origin/epic/<nr>-…, without the commits of
   * other branches (the base); a commit counts by
   * `Merge … agent/<kind>-…`, `(#<kind>)` or `Merge #<kind>: …` in its subject (kinderAusBetreff).
   */
  imEpicBranch(nr: number): Map<number, string> {
    const fertig = new Map<number, string>();
    const refs = this.w.aufrufer('git', ['-C', this.e.repo, 'for-each-ref', '--format=%(refname)', `refs/heads/epic/${nr}-*`, `refs/heads/epic/${nr}`, `refs/remotes/origin/epic/${nr}-*`, `refs/remotes/origin/epic/${nr}`]);
    if (refs.code) return fertig;
    const alle = refs.stdout.split('\n').map((z) => z.trim()).filter(Boolean);
    const ref = alle.find((r) => r.startsWith('refs/heads/')) ?? alle[0];
    if (!ref) return fertig;
    // only the epic's own commits: what the base (any other branch) already has does not count
    const log = this.w.aufrufer('git', ['-C', this.e.repo, 'log', '--first-parent', '-n', '500', '--format=%cI%x09%s', ref, '--not', '--exclude=epic/*', '--exclude=agent/*', '--branches', '--exclude=*/epic/*', '--exclude=*/agent/*', '--remotes']);
    if (log.code) return fertig;
    // newest first: the last hit of a child is its first merge
    for (const zeile of log.stdout.split('\n')) {
      const [zeit, betreff = ''] = zeile.split('\t');
      for (const k of kinderAusBetreff(betreff)) fertig.set(k, new Date(zeit).toISOString());
    }
    return fertig;
  }

  kinderZahl(nr: number): number | null {
    return this.bilder.find((b) => b.nr === nr)?.kinder?.length || null;
  }

  /** seconds the whole run of an epic waited for the person (answered or still open) */
  menschWartenS(nr: number): number {
    const jetzt = this.w.jetzt();
    return Math.round(
      this.z.fragen
        .filter((f) => f.epic === nr && f.ganzerLauf)
        .reduce((s, f) => s + Math.max(0, (f.beantwortetAm ? Date.parse(f.beantwortetAm) : f.beantwortet ? Date.parse(f.seit) : jetzt) - Date.parse(f.seit)), 0) / 1000,
    );
  }

  /**
   * One record per finished epic (Prognose): work time without the waits for the person, the
   * driver's gate time, the packages with class and escalations from all logs of its runs, and
   * whether it fell into the span shown at its start.
   */
  epicMessen(ep: FlottenEpic): void {
    if (!ep.gestartetAm || !ep.endeAm) return;
    const laeufe = join(this.dir, 'laeufe');
    const logs = existsSync(laeufe)
      ? readdirSync(laeufe)
          .filter((d) => d.startsWith(`${ep.nr}-`) && d.endsWith('.jsonl'))
          .map((d) => {
            try {
              return readFileSync(join(laeufe, d), 'utf8');
            } catch {
              return '';
            }
          })
      : [];
    const warten = this.menschWartenS(ep.nr);
    const arbeitS = Math.max(0, Math.round((Date.parse(ep.endeAm) - Date.parse(ep.gestartetAm)) / 1000) - warten);
    const m: Messung = {
      epic: ep.nr,
      titel: ep.titel ?? '',
      konto: ep.konto ? kurzname(ep.konto, this.e.admiralKonto) : null,
      start: ep.gestartetAm,
      ende: ep.endeAm,
      arbeitS,
      menschWartenS: warten,
      gateS: ep.gateS ?? 0,
      pakete: paketeAusLogs(logs),
      prognose: ep.prognose ?? null,
      treffer: getroffen(ep.prognose ?? null, arbeitS + (ep.gateS ?? 0)),
    };
    try {
      schreibeMessung(this.dir, m);
      this.messungen.push(m);
      this.prognoseCache = null;
      this.ereignis(ep.nr, `Gemessen für die Prognose: ${Math.round(arbeitS / 60)} min Arbeit, ${m.pakete.length} Pakete${m.treffer === null ? '' : m.treffer ? ', lag in der Spanne' : ', lag außerhalb der Spanne'}`);
    } catch (err) {
      this.ereignis(ep.nr, `Messung nicht geschrieben: ${String(err).slice(0, 200)}`);
    }
  }

  /** the forecast for the bridge; recomputed only when the measurements or the open epics change */
  prognoseBericht(): Bericht['prognose'] {
    const ab = this.adapter?.prognose_ab ?? 5;
    const offen = Object.values(this.z.epics).filter((ep) => ['wartend', 'laeuft', 'frage', 'nacharbeit', 'pr'].includes(ep.stufe));
    const schluessel = `${this.messungen.length}|${ab}|${this.z.bremse?.obergrenze ?? ''}|${offen.map((ep) => `${ep.nr}:${ep.stufe}`).join(',')}|${Math.floor(this.w.jetzt() / 600_000)}`;
    if (this.prognoseCache?.schluessel === schluessel) return this.prognoseCache.wert;
    const st = prognoseStand(this.messungen, ab);
    const jetzt = this.w.jetzt();
    // running ones first, they hold their places; then the waiting ones in the order of the occupancy
    const reihe = [...offen.filter((ep) => ep.stufe !== 'wartend'), ...offen.filter((ep) => ep.stufe === 'wartend')];
    const backlog = st.status === 'ok' ? prognoseBacklog(this.messungen, reihe.map((ep) => ({ n: this.kinderZahl(ep.nr), bisherS: ep.gestartetAm ? Math.max(0, (jetzt - Date.parse(ep.gestartetAm)) / 1000 - this.menschWartenS(ep.nr)) : 0 })), this.z.bremse?.obergrenze ?? 1, ab) : null;
    const wert = { ...st, backlog: backlog ? { p50: Math.round(backlog.p50), p90: Math.round(backlog.p90) } : null, berechnet: new Date(jetzt).toISOString() };
    this.prognoseCache = { schluessel, wert };
    return wert;
  }

  /** the span of a waiting epic for the line "Bereit" */
  prognoseFuer(ep: FlottenEpic): { p50: number; p90: number } | null {
    if (ep.stufe !== 'wartend' || this.prognoseBericht().status !== 'ok') return null;
    const s = prognoseEpic(this.messungen, this.kinderZahl(ep.nr), this.adapter?.prognose_ab ?? 5, ep.nr);
    return s ? { p50: Math.round(s.p50), p90: Math.round(s.p90) } : null;
  }

  titel(ep: FlottenEpic): string {
    if (ep.titel == null) {
      const r = this.w.aufrufer('gh', ['issue', 'view', String(ep.nr), '--repo', this.e.forge, '--json', 'title']);
      try {
        ep.titel = r.code ? '' : String((JSON.parse(r.stdout) as { title?: string }).title ?? '');
      } catch {
        ep.titel = '';
      }
    }
    return ep.titel;
  }

  /**
   * #51: phase, round and class per child from the Agent calls of the runs. A package merged into the
   * epic branch has no phase; while the epic is not at work (PR, queue) none has, the rest stays.
   */
  paketDetail(ep: FlottenEpic): ReturnType<typeof ableiten> {
    const alle = ableiten(ep.agenten ?? [], new Set((ep.pakete ?? []).filter((p) => p.stand === 'fertig' && p.nr != null).map((p) => p.nr!)));
    if (!['laeuft', 'nacharbeit', 'frage'].includes(ep.stufe)) {
      for (const d of alle.values()) {
        delete d.phase;
        delete d.phaseSeit;
      }
    }
    return alle;
  }

  bericht(): Bericht {
    const konto = (k: string) => kurzname(k, this.e.admiralKonto);
    return {
      forge: this.e.forge,
      url: `https://github.com/${this.e.forge}`,
      rechner: rechnerName(),
      stand: this.z.stand,
      aktiv: this.z.aktiv,
      taktS: Math.max(1, Math.round(this.e.taktMs / 1000)),
      epics: Object.values(this.z.epics).map((ep) => {
        const halt = ep.stufe === 'blockiert' || ep.stufe === 'abgebrochen';
        const detail = this.paketDetail(ep);
        return {
          nr: ep.nr,
          titel: this.titel(ep),
          stufe: ep.stufe,
          konto: ep.konto ? konto(ep.konto) : null,
          pr: ep.pr,
          notiz: ep.notiz,
          geparkt: ep.geparkt,
          pakete: (ep.pakete ?? []).map((p) => ({ ...p, ...(p.nr == null ? undefined : detail.get(p.nr)) })),
          schritt: ep.schritt ?? null,
          schrittZeit: ep.schrittZeit ?? null,
          prozess: this.laufend.has(ep.nr),
          grund: halt ? (ep.haltGrund ?? ep.notiz) : '',
          haltZeit: halt ? (ep.haltZeit ?? null) : null,
          // "Log ansehen" on the blockade card: the driver's last events of this epic
          log: halt ? this.z.ereignisse.filter((x) => x.epic === ep.nr).slice(-12).map((x) => `${new Date(x.zeit).toTimeString().slice(0, 5)} ${x.text.slice(0, 300)}`) : [],
          aufgegebenAm: ep.aufgegebenAm ?? null,
          prio: this.prio(ep.nr),
          imEinsatz: this.e.epics.includes(ep.nr),
          pausiert: ep.pausiert ?? null,
          prioritaet: ep.prioritaet ?? null,
          merge: this.stellung(ep),
          gestartetAm: ep.gestartetAm ?? null,
          schlangeSeit: this.z.schlange.includes(ep.nr) ? (ep.schlangeSeit ?? null) : null,
          gateSeit: ep.gateSeit ?? null,
          prognose: this.prognoseFuer(ep),
          nach: this.bilder.find((b) => b.nr === ep.nr)?.nach ?? [],
          ...(ep.starts ? { neustarts: ep.starts - 1 } : {}),
          ...(detail.size && ['laeuft', 'nacharbeit', 'frage'].includes(ep.stufe) ? { plaetze: { belegt: this.laufend.has(ep.nr) ? belegt(detail.values()) : 0, ...(this.adapter ? { von: this.adapter.window } : {}) } } : {}),
        };
      }),
      schlange: this.z.schlange,
      // usage per account (#28, v2): stage, both windows with reset; the logbook keeps the stage only
      konten: this.alleKonten()
        .filter((k) => this.bewertung.has(k))
        .map((k) => {
          const b = this.bewertung.get(k)!;
          const fenster = (f: Bewertung['fuenf']) => (f ? { verbraucht: f.verbraucht, reset: f.reset } : null);
          return { konto: konto(k), stufe: b.stufe, fuenf: fenster(b.fuenf), woche: fenster(b.sieben), alterMin: b.alterMin, ...(b.stufe === 'gruen' ? {} : { grund: b.grund.slice(0, 4000) }) };
        }),
      ram: this.ram ? { stufe: this.ram.level, halt: this.ramBremse.halt, prozent: this.ram.percent_used } : null,
      platte: { freiGb: this.freiGbWert, genug: this.platteGenug },
      obergrenze: this.z.bremse?.obergrenze ?? null,
      // the open questions only: an answered one leaves the board
      fragen: this.z.fragen.filter((f) => !f.beantwortet).map((f) => ({ epic: f.epic, nr: f.nr, frage: f.frage, lage: f.lage ?? '', optionen: f.optionen ?? [], mehrfach: f.mehrfach ?? false, empfehlung: f.empfehlung, grund: f.grund ?? '', betrifft: f.betrifft ?? '', wartet: f.wartet, ganzerLauf: f.ganzerLauf, seit: f.seit, roh: f.roh ?? '', beantwortet: null, herkunft: f.herkunft ?? '', marke: f.marke ?? '', umkehrbar: f.umkehrbar ?? null, geparkt: f.ganzerLauf ? [] : (f.betrifft ?? '').split(', ').filter(Boolean) })),
      leerlaufS: Math.round(this.e.leerlaufMs / 1000),
      ereignisse: this.z.ereignisse.slice(-30).map((x) => ({ zeit: x.zeit, epic: x.epic, text: x.text.slice(0, 300) })),
      // #52: the bridge shows them until the merge: every decision of an epic not merged, besides the
      // latest 100 (today's of merged ones); with the reason, for a revocation; the newest within the schema's limit
      entscheidungen: this.z.entscheidungen
        .filter((d, i, alle) => i >= alle.length - 100 || !['gemergt', 'fertig'].includes(this.epic(d.epic)?.stufe ?? 'fertig'))
        .slice(-ENTSCHEIDUNGEN_MAX)
        .map(entscheidungFuerBericht),
      prognose: this.prognoseBericht(),
      sitzungen: this.sitzungen,
      einstellungen: this.einstellungenBericht(),
      freigegeben: this.freigegeben.filter((n) => !this.e.epics.includes(n)).map((nr) => ({ nr, titel: this.freiTitelVon(nr).slice(0, 300) })),
    };
  }

  // ---- end blocks, merge (D10–D13, D21)

  async ende(ep: FlottenEpic, block: EndeBlock): Promise<void> {
    const nr = ep.nr;
    ep.pr = block.pr ?? ep.pr;
    ep.konfliktGemeldet = false;
    if (ep.nachzureichen?.length) {
      // answers for parked packages came in while the run worked: they belong into this PR
      ep.stufe = 'laeuft';
      ep.auftrag = { resume: true, text: this.an(nr, 'Antworten zu geparkten Paketen sind da. Arbeite die geparkten Pakete ab, dann FLOTTE-ENDE.') };
      this.ereignis(nr, `FLOTTE-ENDE mit PR #${ep.pr}, aber geparkte Pakete haben jetzt Antworten`);
      return;
    }
    if (ep.widerrufe?.length) {
      ep.stufe = 'laeuft';
      ep.auftrag = { resume: true, text: this.an(nr, `Setze den Widerruf um, dann FLOTTE-ENDE. ${this.blockForm(nr)}`) };
      this.ereignis(nr, `FLOTTE-ENDE mit PR #${ep.pr}, aber ein Widerruf des Menschen ist da`);
      return;
    }
    const offen = block.offen.trim();
    if (this.e.nacharbeit && !ep.nacharbeitGemacht && offen && !/^[-–—]?\s*(keine|nichts)?\.?$/i.test(offen)) {
      ep.nacharbeitGemacht = true;
      ep.stufe = 'nacharbeit';
      ep.auftrag = { resume: true, text: this.an(nr, `Rufe den Skill epic-nacharbeit mit #${nr} auf. Fragerunden kommen als FLOTTE-FRAGE nacharbeit, am Ende FLOTTE-ENDE. ${TAFEL_AUS}`) };
      this.ereignis(nr, `FLOTTE-ENDE mit PR #${ep.pr}, offene Punkte: Nacharbeit`);
      return;
    }
    ep.stufe = 'pr';
    if (!ep.pr) return this.halt(ep, 'blockiert', 'FLOTTE-ENDE ohne Pull Request');
    const fremd = this.fremderPr(ep);
    if (fremd) return this.prFrage(ep, fremd);
    this.ereignis(nr, `FLOTTE-ENDE, PR #${ep.pr}`);
    ep.endeAm = new Date(this.w.jetzt()).toISOString();
    this.andocken(ep);
  }

  /** #112: into the merge queue, unless the epic's merge says a person looks (or merge.ps1 cannot merge for us) */
  andocken(ep: FlottenEpic): void {
    const nr = ep.nr;
    if (this.adapter.merge !== 'nach_gate') return this.prBereit(ep, 'merge: mensch');
    const mensch = this.menschPrueft(ep);
    if (mensch) return this.prBereit(ep, mensch);
    if (this.mergeAlt) return this.prBereit(ep, this.mergeAlt);
    // the merge queue (#14, round 5): in the order of FLOTTE-ENDE, only the head is up; beside the
    // loop, since merge.ps1 and the gate take minutes (acceptance finding 12)
    if (!this.z.schlange.includes(nr)) {
      this.z.schlange.push(nr);
      ep.schlangeSeit = new Date(this.w.jetzt()).toISOString();
    }
    ep.notiz = `PR #${ep.pr}: Merge-Schlange, Platz ${this.z.schlange.indexOf(nr) + 1}`;
    this.ereignis(nr, `Schlange: Platz ${this.z.schlange.indexOf(nr) + 1} (${this.z.schlange.map((n) => `#${n}`).join(', ')})`);
    this.schlangeWeiter();
  }

  /** #112: why a person merges this epic by its merge (switch, proposal, project); null when the driver merges */
  menschPrueft(ep: FlottenEpic): string | null {
    const s = this.stellung(ep);
    if (s.stellung === 'automatisch') return null;
    return `${MENSCH_PRUEFT}, ${s.herkunft === 'epic' ? 'Schalter am Epic' : s.herkunft === 'vorschlag' ? `Vorschlag: ${s.grund}` : 'Einstellung des Projekts'}`;
  }

  prInfo(pr: number): PrInfo | null {
    const v = this.w.aufrufer('gh', ['pr', 'view', String(pr), '--repo', this.e.forge, '--json', 'state,headRefName,baseRefName,headRefOid,body']);
    try {
      return JSON.parse(v.stdout) as PrInfo;
    } catch {
      return null;
    }
  }

  /**
   * Acceptance 3, finding 4: the PR of FLOTTE-ENDE must be the open PR of this epic's branch
   * (epic/<nr>-<slug>, epic/SKILL.md, Phase 3); a foreign one is never watched or merged.
   */
  fremderPr(ep: FlottenEpic): string | null {
    const info = this.prInfo(ep.pr!);
    if (!info) return `PR #${ep.pr} aus FLOTTE-ENDE ist nicht lesbar`;
    if (!new RegExp(`^epic/${ep.nr}(-|$)`).test(info.headRefName ?? '')) return `PR #${ep.pr} aus FLOTTE-ENDE hat den Head ${info.headRefName ?? '?'}, nicht den Epic-Branch epic/${ep.nr}-…`;
    if (info.state !== 'OPEN') return `PR #${ep.pr} aus FLOTTE-ENDE ist nicht offen (${info.state ?? '?'})`;
    return null;
  }

  /** The PR of FLOTTE-ENDE does not belong to the epic: no merge, the whole run waits for the person. */
  prFrage(ep: FlottenEpic, grund: string): void {
    const nr = ep.nr;
    const zeit = new Date(this.w.jetzt()).toISOString();
    const frage = `${grund}. Welcher Pull Request gehört zu Epic #${nr}?`;
    this.z.fragen.push({ epic: nr, nr: PR_FRAGE, frage, lage: '', optionen: [], grund, herkunft: 'Treiber: fremder Pull Request', marke: 'fremder PR', betrifft: 'Lauf', roh: frage, empfehlung: 'den PR des Epic-Branches nennen; der Lauf prüft ihn und beendet den Zug neu mit FLOTTE-ENDE', wartet: 'der ganze Lauf', ganzerLauf: true, seit: zeit });
    kommentar(this.w.aufrufer, this.e.forge, nr, `**FRAGE AN DEN MENSCHEN (Flotte)** — ${frage}\nDer Treiber mergt und beobachtet diesen PR nicht.\nAntworten, im Repository: \`flotte antworten . ${nr} ${PR_FRAGE} "<Antwort>"\``);
    this.ereignis(nr, `❓ ${grund}: kein Merge, Frage an den Menschen`);
    ep.pr = null;
    ep.stufe = 'frage';
    ep.notiz = 'wartet auf den Menschen (PR gehört nicht zum Epic)';
    ep.festgehalten = this.an(nr, `${grund}. Der Treiber hat ihn nicht übernommen. Prüfe, welcher Pull Request zu deinem Epic-Branch gehört, und beende den Zug mit FLOTTE-ENDE und diesem PR. ${this.blockForm(nr)}`);
  }

  /** Starts the head of the merge queue when nothing works on it; an epic that left 'pr' drops out. */
  schlangeWeiter(): void {
    if (this.kopfAktiv !== null) return;
    while (this.z.schlange.length) {
      const ep = this.epic(this.z.schlange[0]);
      if (ep?.stufe === 'pr' && ep.pr && !ep.auftrag && !this.laufend.has(ep.nr)) break;
      this.z.schlange.shift();
    }
    const nr = this.z.schlange[0];
    if (nr === undefined) return;
    const ep = this.epic(nr);
    this.kopfAktiv = nr;
    this.mergesOffen.add(nr);
    ep.notiz = `PR #${ep.pr}: Kopf der Merge-Schlange`;
    this.ereignis(nr, `Kopf der Schlange${this.z.schlange.length > 1 ? `, dahinter ${this.z.schlange.slice(1).map((n) => `#${n}`).join(', ')}` : ''}`);
    this.nebenbei(
      this.kopf(ep)
        .catch((e) => this.prBereit(ep, `Fehler in der Merge-Schlange: ${e}`))
        .finally(() => {
          this.mergesOffen.delete(nr);
          this.kopfAktiv = null;
          this.z.schlange = this.z.schlange.filter((n) => n !== nr);
          this.geaendert = true;
          this.schlangeWeiter();
        }),
    );
  }

  async mergeAufruf(ep: FlottenEpic): Promise<string> {
    const r = await this.w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.e.mergeSkript, '-Repo', this.e.forge, '-Pr', String(ep.pr)], { cwd: this.e.repo, timeoutMs: 40 * 60_000 });
    const zeile = (r.stdout.trim().split(/\r?\n/).pop() || r.stderr.trim().split(/\r?\n/).pop() || `merge.ps1 Exit ${r.code}`).trim();
    this.ereignis(ep.nr, `merge.ps1: ${zeile}`);
    return zeile;
  }

  /**
   * The head of the queue: a gate block that is still valid is merged. Otherwise the driver merges
   * the base into the epic branch, runs the gate of the adapter in the epic worktree (only the part
   * that always runs when the base moved beside the epic's areas), writes the block into the PR,
   * pushes and merges. A conflict or a red gate goes back to the run; the epic queues up again at
   * its next FLOTTE-ENDE. Without gate_command in the adapter a person merges: nothing proves the gate.
   */
  async kopf(ep: FlottenEpic): Promise<void> {
    // #112: switched to mensch on the bridge while it waited in the queue
    const mensch = this.menschPrueft(ep);
    if (mensch) return this.prBereit(ep, mensch);
    let selbst: 'voll' | 'teil' | null = null;
    const info = this.prInfo(ep.pr!);
    // follow-up check of #27: only a PR on the expected base is merged
    const basis = this.erwarteteBasis();
    if (info && info.baseRefName !== basis) return this.prBereit(ep, basis === null ? 'base_branch: from-issue, die erwartete Basis ist nicht lesbar' : `Basis des PRs ist ${info.baseRefName}, erwartet ${basis}`);
    // acceptance 3, finding 2: a block the run only wrote is no gate. The last run of the gate
    // section must appear in the run's log as the output of a gate call; else the driver gates.
    const nachweis = info ? this.gateNachweis(ep, info.body) : 'PR nicht lesbar';
    if (nachweis) {
      if (!this.adapter.gate_command) return this.prBereit(ep, `${nachweis}, und der Adapter hat kein gate_command`);
      this.ereignis(ep.nr, `${nachweis}: der Treiber fährt das Gate selbst`);
      const g = await this.nachziehen(ep, nachweis);
      if (g.art === 'mensch') return this.prBereit(ep, g.text);
      if (g.art === 'zurueck') return this.zurueck(ep, g.text);
      selbst = 'voll';
    }
    for (;;) {
      const zeile = await this.mergeAufruf(ep);
      if (/^GEMERGT/.test(zeile)) return this.nachMerge(ep);
      if (/^NICHT GEMERGT.*Zustand MERGED/.test(zeile)) return this.nachMerge(ep);
      if (/^NICHT GEMERGT.*merge:/.test(zeile)) return this.prBereit(ep, 'Adapter auf der Basis sagt merge: mensch');
      if (/^CHECKS ROT/.test(zeile)) return this.zurueck(ep, `Der Merge wurde abgelehnt: ${zeile}. Bring den Pull Request in Ordnung, dann FLOTTE-ENDE.`);
      if (!/^(GATE FEHLT|GATE UNGEPRUEFT|KONFLIKT)/.test(zeile)) return this.prBereit(ep, zeile);
      const basisWeg = /Basis steht auf|enthaelt die aktuelle Basis nicht/.test(zeile);
      let voll = false;
      if (selbst) {
        // the driver's own block was refused: the base moved again (a person merged), or the forge
        // judged the areas differently; then once the full gate, else a person looks
        if (!basisWeg && selbst === 'voll') return this.prBereit(ep, `${zeile} (nach dem Gate des Treibers)`);
        voll = !basisWeg;
      }
      if ((ep.gateWiederholungen ?? 0) >= GATE_GRENZE) return this.halt(ep, 'blockiert', `${GATE_GRENZE} Gate-Läufe des Treibers, die Basis zog jedes Mal davon: ${zeile}`);
      const g = await this.nachziehen(ep, voll ? 'Teil-Lauf von merge.ps1 abgelehnt' : null);
      if (g.art === 'gruen') {
        selbst = g.teil ? 'teil' : 'voll';
        continue;
      }
      if (g.art === 'mensch') return this.prBereit(ep, g.text);
      return this.zurueck(ep, g.text);
    }
  }

  /** base_branch of the adapter, else main_branch, else the default branch of the forge; null for from-issue */
  erwarteteBasis(): string | null {
    const b = this.adapter.base_branch ?? this.adapter.main_branch;
    if (b) return b === 'from-issue' ? null : b;
    this.standardZweig ??= this.w.aufrufer('gh', ['repo', 'view', this.e.forge, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']).stdout.trim() || null;
    return this.standardZweig;
  }

  /**
   * null when the last run of the PR's gate section is green and appears, with the same base, head
   * and kind, as the output of a Bash or PowerShell call of gate_command or gate_always_command in a
   * log of this epic's runs; else why not.
   */
  gateNachweis(ep: FlottenEpic, body: string): string | null {
    const form = gateForm(this.adapter);
    const letzter = gateLaeufe(body ?? '', form)?.at(-1);
    if (!letzter || !letzter.gruen || !letzter.head) return 'kein grüner Gate-Lauf in der PR-Beschreibung';
    const befehle = [this.adapter.gate_command, this.adapter.gate_always_command].filter((b): b is string => Boolean(b));
    const laeufe = join(this.dir, 'laeufe');
    const logs = existsSync(laeufe) ? readdirSync(laeufe).filter((d) => d.startsWith(`${ep.nr}-`) && d.endsWith('.jsonl')) : [];
    for (const d of logs) {
      const im = gateLaeufeImLog(readFileSync(join(laeufe, d), 'utf8'), form, befehle);
      if (im.some((l) => l.gruen && l.teil === letzter.teil && gleich(l.base, letzter.base) && gleich(l.head, letzter.head))) return null;
    }
    return `kein Gate-Aufruf im Log des Laufs zum Gate-Block (Basis ${letzter.base}, HEAD ${letzter.head})`;
  }

  /** Back to the run with what failed; counts against the run (two, then blocked). */
  zurueck(ep: FlottenEpic, text: string): void {
    ep.mergeVersuche = (ep.mergeVersuche ?? 0) + 1;
    if (ep.mergeVersuche > 2) return this.halt(ep, 'blockiert', `Merge nach zwei Nachbesserungen weiter nicht möglich:\n\n${text}`);
    ep.stufe = 'laeuft';
    ep.auftrag = { resume: true, text: this.an(ep.nr, text) };
    this.ereignis(ep.nr, `zurück an den Lauf (${ep.mergeVersuche} von 2), danach ans Ende der Schlange: ${text.split('\n')[0].slice(0, 160)}`);
  }

  /** The worktree that has the head branch checked out, or null. */
  epicWorktree(branch: string): string | null {
    const r = this.w.aufrufer('git', ['-C', this.e.repo, 'worktree', 'list', '--porcelain']);
    if (r.code) return null;
    let pfad: string | null = null;
    for (const z of r.stdout.split(/\r?\n/)) {
      if (z.startsWith('worktree ')) pfad = z.slice(9).trim();
      else if (z.trim() === `branch refs/heads/${branch}` && pfad) return pfad;
    }
    return null;
  }

  /**
   * The epic worktree goes with the run's session (epic/SKILL.md, Phase 3), so after the run's last
   * turn it may be gone (probe 3). Like /epic-nacharbeit the driver lays it out again with `Up` on
   * the existing branch, fast-forwarded to the remote branch. The lock names the driver (Up wants a
   * living PID) and the epic's holder file; CleanupStale spares it while the driver lives, so the
   * driver takes it down itself with `Down` after the merge.
   */
  async epicWorktreeAnlegen(ep: FlottenEpic, branch: string): Promise<string | null> {
    const f = await this.w.langsam('git', ['-C', this.e.repo, 'fetch', 'origin', branch], { timeoutMs: 5 * 60_000 });
    if (f.code) return null;
    const r = await this.w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(this.e.skripte, 'worktree.ps1'), '-Action', 'Up', '-RepoRoot', this.e.repo, '-Package', `epic-${ep.nr}`, '-Branch', branch, '-From', `origin/${branch}`, '-SessionPid', String(process.pid)], { cwd: this.e.repo, timeoutMs: 15 * 60_000, env: { EPIC_LOCK_HOLDER: this.halten(ep.nr) } });
    let pfad: string | null = null;
    try {
      pfad = (JSON.parse(r.stdout.trim().split(/\r?\n/).pop() ?? '') as { path?: string }).path ?? null;
    } catch {
      pfad = null;
    }
    if (r.code || !pfad) {
      this.ereignis(ep.nr, `Epic-Worktree für ${branch} nicht angelegt: ${(r.stderr || r.stdout).trim().split('\n').pop()?.slice(0, 200)}`);
      return null;
    }
    ep.worktreeSelbst = true;
    const ff = this.w.aufrufer('git', ['-C', pfad, 'merge', '--ff-only', `origin/${branch}`]);
    this.ereignis(ep.nr, `Epic-Worktree neu angelegt (worktree.ps1 Up): ${pfad}${ff.code ? `, nicht auf origin/${branch} vorgespult` : ''}`);
    return pfad;
  }

  /**
   * Merges the base into the epic branch in its worktree and runs the gate there. Green: the merge is
   * pushed and the block appended to the gate section of the PR. Red or a conflict: nothing pushed,
   * the text goes to the run. 'mensch': the gate cannot give a block merge.ps1 would read.
   */
  async nachziehen(ep: FlottenEpic, voll: string | null): Promise<GateErgebnis> {
    const nr = ep.nr;
    const v = this.w.aufrufer('gh', ['pr', 'view', String(ep.pr), '--repo', this.e.forge, '--json', 'headRefName,baseRefName,headRefOid,body']);
    let info: { headRefName: string; baseRefName: string; headRefOid: string; body: string };
    try {
      info = JSON.parse(v.stdout);
    } catch {
      return { art: 'mensch', text: `PR #${ep.pr} nicht lesbar: ${v.stderr.trim().slice(0, 200)}` };
    }
    const auftrag = 'Bring den Pull Request in Ordnung: Basis in den Epic-Branch mergen, nur mechanische Konflikte lösen (sonst FLOTTE-FRAGE), Suiten und Gate neu, Gate-Block in der PR-Beschreibung ersetzen, pushen. Dann FLOTTE-ENDE.';
    const wt = this.epicWorktree(info.headRefName) ?? (await this.epicWorktreeAnlegen(ep, info.headRefName));
    if (!wt) return { art: 'zurueck', text: `Die Basis zog davon, und der Treiber konnte keinen Worktree für ${info.headRefName} anlegen; er kann nicht nachziehen. ${auftrag}` };
    const git = (...a: string[]) => this.w.aufrufer('git', ['-C', wt, ...a]);
    if (git('status', '--porcelain').stdout.trim()) return { art: 'zurueck', text: `Die Basis zog davon, aber der Epic-Worktree ${wt} ist nicht sauber; der Treiber zieht nicht nach. ${auftrag}` };
    if (!git('rev-parse', 'HEAD').stdout.trim().startsWith(info.headRefOid)) return { art: 'zurueck', text: `Der Epic-Worktree steht nicht auf dem Head des PR (${info.headRefOid.slice(0, 8)}); der Treiber zieht nicht nach. ${auftrag}` };
    // a gate is a heavy step: never while the RAM brake holds
    while (this.ramBremse.halt) await pause(this.e.taktMs);
    const f = await this.w.langsam('git', ['-C', wt, 'fetch', 'origin', info.baseRefName], { timeoutMs: 5 * 60_000 });
    if (f.code) return { art: 'mensch', text: `git fetch origin ${info.baseRefName} scheiterte: ${f.stderr.trim().slice(0, 200)}` };
    const ziel = `origin/${info.baseRefName}`;
    const m = git('merge', '--no-ff', '--no-edit', ziel);
    if (m.code) {
      const konflikt = git('diff', '--name-only', '--diff-filter=U').stdout.split(/\r?\n/).filter(Boolean);
      git('merge', '--abort');
      this.ereignis(nr, `Nachziehen: Konflikt mit ${ziel} in ${konflikt.join(', ') || '?'}`);
      return { art: 'zurueck', text: `Beim Nachziehen von ${ziel} gab es einen Konflikt${konflikt.length ? ` in ${konflikt.join(', ')}` : `: ${(m.stdout + m.stderr).trim().slice(-400)}`}. Der Treiber hat den Merge abgebrochen, nichts gepusht. ${auftrag}` };
    }
    // from here the worktree holds the driver's merge commit; unless it is green and pushed, the
    // worktree goes back to the head the run left (checked clean above), so the run finds its state
    const r = await this.gateFahren(ep, wt, info, ziel, voll);
    if (!r.gepusht) {
      const z = git('reset', '--hard', info.headRefOid);
      if (z.code) this.ereignis(nr, `Epic-Worktree nicht zurückgesetzt: ${z.stderr.trim().slice(0, 200)}`);
    }
    return r;
  }

  /** voll: why the full gate runs regardless of the areas, or null */
  async gateFahren(ep: FlottenEpic, wt: string, info: { headRefName: string; baseRefName: string; headRefOid: string; body: string }, ziel: string, voll: string | null): Promise<GateErgebnis> {
    const nr = ep.nr;
    const git = (...a: string[]) => this.w.aufrufer('git', ['-C', wt, ...a]);
    const form = gateForm(this.adapter);
    let teil = false;
    let warum = 'Adapter ohne gate_always_command oder gate_areas';
    if (voll) warum = voll;
    else if (this.adapter.gate_always_command && this.adapter.gate_areas.length) {
      const vorher = letzterVollLauf(gateLaeufe(info.body, form) ?? []);
      const d = (...a: string[]) => {
        const r = git('diff', '--name-only', '--no-renames', ...a);
        return r.code ? null : r.stdout.split(/\r?\n/).filter(Boolean);
      };
      const bewegt = vorher ? d(vorher.base, ziel) : null;
      const epic = d(`${ziel}...HEAD`);
      const seit = vorher ? d(vorher.head!, 'HEAD') : null;
      if (!vorher) warum = 'kein grüner Voll-Lauf im Gate-Block';
      else if (!bewegt || !epic || !seit) warum = 'Dateilisten nicht lesbar';
      else {
        const eigene = seit.filter((x) => !bewegt.includes(x));
        const beide = gemeinsameBereiche(bewegt, epic, bereicheAus(this.adapter.gate_areas));
        teil = !eigene.length && !beide.length;
        warum = eigene.length ? `eigene Änderungen seit dem Voll-Lauf: ${eigene.slice(0, 3).join(', ')}` : beide.length ? `Basis bewegte sich in Bereichen des Epics: ${beide.join(', ')}` : 'Basis bewegte sich nur in fremden Bereichen';
      }
    }
    const befehl = teil ? this.adapter.gate_always_command! : this.adapter.gate_command!;
    const kopf = git('rev-parse', 'HEAD').stdout.trim();
    const basis = git('rev-parse', ziel).stdout.trim();
    this.ereignis(nr, `Gate des Treibers (${teil ? 'Immer-Teil' : 'voll'}, ${warum}) auf ${kopf.slice(0, 8)} gegen ${ziel} @ ${basis.slice(0, 7)}`);
    const t0 = this.w.jetzt();
    ep.gateSeit = new Date(t0).toISOString();
    this.tafelAlt = true;
    let r: Awaited<ReturnType<AsyncAufrufer>>;
    try {
      r = await this.w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', befehl], { cwd: wt, timeoutMs: GATE_MAX_MS });
    } finally {
      ep.gateSeit = null;
    }
    ep.gateWiederholungen = (ep.gateWiederholungen ?? 0) + 1;
    ep.gateS = (ep.gateS ?? 0) + Math.round((this.w.jetzt() - t0) / 1000);
    this.z.statistik.gateWiederholungen = (this.z.statistik.gateWiederholungen ?? 0) + 1;
    const b = blockAus(r.stdout, form);
    const s = Math.round((this.w.jetzt() - t0) / 1000);
    const ende = (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-25).join('\n');
    if (!b) return { art: 'mensch', text: `Die Ausgabe von \`${befehl}\` nennt keine Basis (gate_base); merge.ps1 kann sie nicht prüfen` };
    const gruen = b.gruen && r.code === 0;
    this.ereignis(nr, `Gate des Treibers ${gruen ? 'grün' : 'rot'} nach ${s} s (Exit ${r.code})`);
    if (!gruen) return { art: 'zurueck', text: `Die Basis zog davon. Der Treiber hat ${ziel} in den Epic-Branch gemergt und das Gate gefahren (\`${befehl}\`): rot. Nichts gepusht, der Epic-Worktree steht wieder auf deinem Head.\n\n\`\`\`\n${ende}\n\`\`\`\n\nBasis selbst in den Epic-Branch mergen, das Gate grün machen, Gate-Block in der PR-Beschreibung ersetzen, pushen. Dann FLOTTE-ENDE.` };
    if (b.teil !== teil) return { art: 'mensch', text: `Die Ausgabe von \`${befehl}\` ist ${b.teil ? '' : 'k'}ein Teil-Lauf (gate_partial); der Treiber schreibt sie nicht in den PR` };
    const [bBase, bHead] = [form.base.exec(b.block)?.[1] ?? '', form.head.exec(b.block)?.[1] ?? ''];
    if (!basis.startsWith(bBase) || !bHead || !kopf.startsWith(bHead)) return { art: 'mensch', text: `Die Gate-Ausgabe nennt Basis ${bBase} und HEAD ${bHead || '?'}, der Worktree steht auf ${basis.slice(0, 7)} und ${kopf.slice(0, 8)}` };
    const p = await this.w.langsam('git', ['-C', wt, 'push', 'origin', `HEAD:refs/heads/${info.headRefName}`], { timeoutMs: 5 * 60_000 });
    if (p.code) return { art: 'mensch', text: `git push scheiterte: ${p.stderr.trim().slice(0, 200)}` };
    const e = this.w.aufrufer('gh', ['pr', 'edit', String(ep.pr), '--repo', this.e.forge, '--body-file', '-'], { eingabe: blockEinsetzen(info.body, form, b.block) });
    // pushed but without a block: a person looks; the worktree keeps the pushed state
    if (e.code) return { art: 'mensch', text: `gepusht, aber die PR-Beschreibung nicht geschrieben: ${e.stderr.trim().slice(0, 200)}`, gepusht: true };
    return { art: 'gruen', text: '', teil, gepusht: true };
  }

  prBereit(ep: FlottenEpic, warum: string): void {
    ep.notiz = `PR #${ep.pr} bereit, ein Mensch mergt (${warum})`;
    if (ep.prBereitGemeldet) return;
    ep.prBereitGemeldet = true;
    const d = this.z.entscheidungen.filter((x) => x.epic === ep.nr && x.einflussreich);
    kommentar(this.w.aufrufer, this.e.forge, ep.nr, `**PR bereit (Flotte)** — #${ep.pr}. Gemergt wird von einem Menschen (${warum}).${d.length ? `\nEinflussreiche Entscheidungen zu diesem Epic:\n${d.map((x) => `- ${x.frage} → ${x.antwort} (${x.herkunft})`).join('\n')}` : ''}`);
    this.ereignis(ep.nr, `PR #${ep.pr} bereit, ein Mensch mergt`);
  }

  /** D12/D13: merged by a person, or a conflict after another merge (the queue handles its own conflicts). */
  async mergeWache(): Promise<void> {
    for (const ep of Object.values(this.z.epics)) {
      if (ep.stufe !== 'pr' || !ep.pr || this.laufend.has(ep.nr) || ep.auftrag || this.mergesOffen.has(ep.nr)) continue;
      const pz = prZustand(this.w.aufrufer, this.e.forge, ep.pr);
      if (!pz) continue;
      if (pz.state === 'MERGED') {
        this.ereignis(ep.nr, `PR #${ep.pr} gemergt`);
        await this.nachMerge(ep);
      } else if (pz.state === 'CLOSED') this.halt(ep, 'abgebrochen', `PR #${ep.pr} wurde ohne Merge geschlossen`);
      else if (pz.mergeable === 'CONFLICTING' && !ep.konfliktGemeldet && !this.z.schlange.includes(ep.nr)) {
        ep.konfliktGemeldet = true;
        ep.stufe = 'laeuft';
        ep.prBereitGemeldet = false;
        ep.auftrag = { resume: true, text: this.an(ep.nr, `Dein Pull Request #${ep.pr} hat nach einem Merge in die Basis einen Konflikt. Basis in den Epic-Worktree mergen, nur mechanische Konflikte lösen (sonst FLOTTE-FRAGE), alle Suiten und das Gate neu, Gate-Block in der PR-Beschreibung ersetzen. Dann FLOTTE-ENDE.`) };
        this.ereignis(ep.nr, `PR #${ep.pr} hat einen Konflikt: Auftrag an den Lauf`);
      }
    }
  }

  async nachMerge(ep: FlottenEpic): Promise<void> {
    ep.stufe = 'gemergt';
    for (const befehl of this.adapter.nach_merge) {
      const r = await this.w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', befehl], { cwd: this.e.repo, timeoutMs: 30 * 60_000 });
      // D21: reported, cleanup still runs
      this.ereignis(ep.nr, r.code ? `nach_merge fehlgeschlagen (Exit ${r.code}): ${befehl}` : `nach_merge: ${befehl}`);
      if (r.code) this.w.melde(`FEHLER nach_merge #${ep.nr}: ${befehl}: ${(r.stderr || r.stdout).trim().slice(-500)}`);
    }
    if (ep.worktreeSelbst) {
      const d = await this.w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(this.e.skripte, 'worktree.ps1'), '-Action', 'Down', '-RepoRoot', this.e.repo, '-Package', `epic-${ep.nr}`], { cwd: this.e.repo, timeoutMs: 15 * 60_000 });
      this.ereignis(ep.nr, d.code ? `Epic-Worktree des Treibers nicht abgebaut (Exit ${d.code}): ${(d.stderr || d.stdout).trim().split('\n').pop()?.slice(0, 200)}` : 'Epic-Worktree des Treibers abgebaut (worktree.ps1 Down)');
    }
    await this.aufraeumen(ep.nr);
    this.lokalerBranchWeg(ep);
    ep.stufe = 'fertig';
    ep.notiz = `PR #${ep.pr} gemergt`;
    this.epicMessen(ep);
    if (this.adapter.lern_issue && ep.pr) this.nebenbei(this.lernschleife(ep, ep.pr, this.adapter.lern_issue));
  }

  /** Sparpaket, package 6: proposals from the merged run as one comment to lern_issue, applied by nobody. */
  async lernschleife(ep: FlottenEpic, pr: number, issue: number): Promise<void> {
    const r = await lerne(
      { repo: this.e.repo, forge: this.e.forge, pr, epic: ep.nr, issue, konto: ep.konto ?? this.e.konten[0], modell: this.e.lernModell, skills: resolve(this.e.skripte, '../..'), log: join(this.dir, 'lernen', `${ep.nr}-${this.w.jetzt()}.jsonl`), programm: this.programm() },
      { aufrufer: this.w.aufrufer, starte: (s) => this.w.starte(s), heute: () => new Date(this.w.jetzt()).toISOString().slice(0, 10) },
    );
    this.ereignis(ep.nr, r.gepostet ? `Lernschleife: ${r.vorschlaege} Vorschlag/Vorschläge an #${issue}` : `Lernschleife ohne Kommentar: ${r.fehler ?? 'Kommentar nicht gepostet'}`);
  }

  /**
   * The local epic branch of the main checkout, once all its commits are provably in the base on
   * origin (merge.ps1 does the same for the remote branch). A branch a worktree still holds stays.
   */
  lokalerBranchWeg(ep: FlottenEpic): void {
    const v = this.w.aufrufer('gh', ['pr', 'view', String(ep.pr), '--repo', this.e.forge, '--json', 'headRefName,baseRefName']);
    let j: { headRefName?: string; baseRefName?: string } = {};
    try {
      j = JSON.parse(v.stdout);
    } catch {
      return;
    }
    const { headRefName: kopf, baseRefName: basis } = j;
    if (!kopf || !basis) return;
    const git = (...a: string[]) => this.w.aufrufer('git', ['-C', this.e.repo, ...a]);
    if (git('rev-parse', '--verify', '--quiet', `refs/heads/${kopf}`).code) return;
    git('fetch', '-q', 'origin', basis);
    if (git('merge-base', '--is-ancestor', `refs/heads/${kopf}`, `origin/${basis}`).code) return this.ereignis(ep.nr, `lokaler Branch ${kopf} bleibt: nicht ganz in origin/${basis}`);
    const d = git('branch', '-D', kopf);
    this.ereignis(ep.nr, d.code ? `lokaler Branch ${kopf} bleibt: ${d.stderr.trim().split('\n')[0]}` : `lokaler Branch ${kopf} gelöscht (liegt ganz in origin/${basis})`);
  }

  // ---- end of the deployment

  istZuEnde(): boolean {
    const eps = Object.values(this.z.epics);
    if (eps.some((ep) => ep.auftrag || BELEGT.has(ep.stufe) || ep.stufe === 'pr' || ep.stufe === 'gemergt')) return false;
    return eps.every((ep) => ENDE.has(ep.stufe));
  }

  async abschluss(): Promise<void> {
    if (this.istZuEnde()) {
      if (this.e.sweepRoot) {
        const r = await this.w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(this.e.skripte, 'sweep.ps1'), '-Root', this.e.sweepRoot, ...(this.e.sweepTemp ? ['-TempRoot', this.e.sweepTemp] : []), ...(this.e.sweepDocker ? [] : ['-SkipDocker'])], { timeoutMs: 30 * 60_000 });
        this.ereignis(null, r.code ? 'sweep.ps1 meldet Fehler' : 'Einsatzende: sweep.ps1 gelaufen');
      }
      this.z.aktiv = false;
      this.ereignis(null, `Einsatz beendet: ${Object.values(this.z.epics).map((ep) => `#${ep.nr} ${ep.stufe}`).join(', ')}`);
    }
    this.geaendert = true;
    this.speichern();
    await this.brueckeMelden();
  }
}

function wert(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const nummern = (s: string | undefined) => (s ?? '').split(',').map((x) => Number(x.trim().replace('#', ''))).filter((n) => n > 0);

/** owner/name of a GitHub remote URL (https or ssh), or null */
export function forgeAus(url: string): string | null {
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null;
}

const AUFRUF = 'Aufruf: flotte fahren [<repo>] [--forge <owner/name>] [--epics 3,4] --konten <konto>[,<konto>] [--admiral <konto>] [--dauerhaft] [--skill epic] [--modell m] [--admiral-modell fable] [--admiral-effort high] [--ping-modell haiku] [--leerlauf-min 60] [--takt-s 60] [--platte-min-gb 20] [--ram-warn 75] [--obergrenze n] [--konto-max <konto>=n] [--sweep-root <dir>] [--sweep-temp <dir>] [--ohne-docker] [--ohne-nacharbeit] [--merge-skript <merge.ps1>] [--max-min n] [--bruecke <url>]. Ein Konto ist 1, 2, 3, ein Ordnername im Benutzerverzeichnis oder ein Pfad.';

/**
 * The settings of `flotte fahren` (acceptance 3, decisions A, B, D): without <repo> the repository of
 * the current folder (its main checkout), without --forge the GitHub repository of origin, without
 * --epics the released epics.
 */
export function einstellungAus(argv: string[], cwd: string = process.cwd(), aufrufer: Aufrufer = aufrufen): Einstellung {
  const explizit = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
  let repo = explizit;
  if (!repo) {
    const r = aufrufer('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (r.code) throw new Error(`Kein Git-Repository in ${cwd}. ${AUFRUF}`);
    const common = r.stdout.trim();
    repo = /[\\/]\.git$/.test(common) ? resolve(common, '..') : resolve(cwd);
  }
  let forge = wert(argv, '--forge') ?? null;
  if (!forge) {
    const r = aufrufer('git', ['-C', repo, 'remote', 'get-url', 'origin']);
    forge = r.code ? null : forgeAus(r.stdout);
    if (!forge) throw new Error(`Die Forge lässt sich nicht aus origin lesen (${(r.stdout || r.stderr).trim() || 'kein origin'}); --forge <owner/name> angeben. ${AUFRUF}`);
  }
  const epics = nummern(wert(argv, '--epics'));
  if (argv.includes('--epics') && !epics.length) throw new Error(`--epics ohne Nummern. ${AUFRUF}`);
  const konten = (wert(argv, '--konten') ?? '').split(',').filter(Boolean);
  if (!konten.length) throw new Error(AUFRUF);
  const e = standard(repo, forge, epics, konten);
  e.auto = !epics.length;
  e.dauerhaft = argv.includes('--dauerhaft');
  e.skill = wert(argv, '--skill') ?? e.skill;
  e.modell = wert(argv, '--modell') ?? e.modell;
  e.admiralModell = wert(argv, '--admiral-modell') ?? e.admiralModell;
  e.admiralEffort = wert(argv, '--admiral-effort') ?? e.admiralEffort;
  if (e.admiralEffort === 'keine') e.admiralEffort = null;
  const ak = wert(argv, '--admiral');
  if (ak) e.admiralKonto = kontoAus(ak);
  e.pingModell = wert(argv, '--ping-modell') ?? e.pingModell;
  e.lernModell = wert(argv, '--lern-modell') ?? e.lernModell;
  e.leerlaufMs = Number(wert(argv, '--leerlauf-min') ?? 60) * 60_000;
  e.taktMs = Number(wert(argv, '--takt-s') ?? 60) * 1000;
  e.plattMinGb = Number(wert(argv, '--platte-min-gb') ?? e.plattMinGb);
  e.gesetzt = (Object.keys(START_PARAMETER) as EinstellungName[]).filter((n) => argv.includes(START_PARAMETER[n]!));
  const ramWarn = wert(argv, '--ram-warn');
  e.ramWarn = ramWarn ? Number(ramWarn) : null;
  const grenze = wert(argv, '--obergrenze');
  e.obergrenze = grenze ? Number(grenze) : null;
  for (const t of (wert(argv, '--konto-max') ?? '').split(',').filter(Boolean)) {
    const i = t.lastIndexOf('=');
    const k = i < 0 ? '' : kontoAus(t.slice(0, i));
    if (i < 0 || !e.konten.includes(k) || !(Number(t.slice(i + 1)) >= 0)) throw new Error(`--konto-max ${t}: <konto aus --konten>=<zahl>`);
    e.kontoMax[k] = Number(t.slice(i + 1));
  }
  e.sweepRoot = wert(argv, '--sweep-root') ?? null;
  e.sweepTemp = wert(argv, '--sweep-temp') ?? null;
  e.sweepDocker = !argv.includes('--ohne-docker');
  e.mergeSkript = resolve(wert(argv, '--merge-skript') ?? e.mergeSkript);
  e.nacharbeit = !argv.includes('--ohne-nacharbeit');
  const max = wert(argv, '--max-min');
  e.maxDauerMs = max ? Number(max) * 60_000 : null;
  e.bruecke = wert(argv, '--bruecke') ?? process.env.FLOTTE_BRUECKE ?? null;
  if (e.bruecke && !/^https?:\/\//.test(e.bruecke)) throw new Error(`--bruecke ${e.bruecke}: eine URL wie http://127.0.0.1:4747`);
  e.brueckeToken = process.env.FLOTTE_BRUECKE_TOKEN || null;
  return e;
}

export async function fahren(argv: string[]): Promise<unknown> {
  const e = einstellungAus(argv);
  // Ctrl+C: the lock goes, the state is already written; the runs finish their turn in their own
  // process group and a new start reads their logs (D16)
  process.once('SIGINT', () => {
    entsperren(flotteDir(e.repo));
    process.stderr.write('Treiber angehalten. Laufende Züge arbeiten weiter; ein neuer Start liest ihre Logs.\n');
    process.exit(130);
  });
  const z = await fahre(e);
  return {
    aktiv: z.aktiv,
    epics: Object.values(z.epics).map((ep) => ({ nr: ep.nr, stufe: ep.stufe, pr: ep.pr, notiz: ep.notiz })),
    offeneFragen: z.fragen.filter((f) => !f.beantwortet),
    statistik: z.statistik,
    tafel: join(flotteDir(e.repo), 'tafel.html'),
  };
}

/**
 * flotte anhalten <repo>: the safe way to stop the driver for an update. It starts nothing new (no
 * run, no turn, no merge), lets a merge of the queue finish (merge.ps1 and the gate are its children
 * and would die with Ctrl+C), then ends. Runs keep working; the same command as before starts it again.
 */
export function anhalten(argv: string[]): unknown {
  const repo = argv[0];
  if (!repo) throw new Error('Aufruf: flotte anhalten <repo>');
  const dir = flotteDir(repo);
  const datei = join(dir, 'anhalten');
  writeFileSync(datei, new Date().toISOString());
  let sperre: unknown = null;
  try {
    sperre = JSON.parse(readFileSync(join(dir, 'treiber.lock'), 'utf8'));
  } catch {
    sperre = null;
  }
  return { datei, treiber: sperre, hinweis: sperre ? 'Der Treiber hält an, sobald kein Merge mehr offen ist (Ereignis „Angehalten auf Wunsch“).' : 'Kein Treiber läuft; die Datei wird beim nächsten Start sofort wirksam. Löschen, wenn nicht gewollt.' };
}

/** flotte antworten <repo> <epic> <frage> <text>: an answer of the person for the running driver. */
export function antworten(argv: string[]): unknown {
  const [repo, epic, nr, ...text] = argv;
  if (!repo || !Number(epic) || !Number(nr) || !text.length) throw new Error('Aufruf: flotte antworten <repo> <epic> <frage> <Antwort>');
  const dir = flotteDir(repo);
  const eintrag = { epic: Number(String(epic).replace('#', '')), nr: Number(nr), text: text.join(' '), zeit: new Date().toISOString() };
  appendFileSync(join(dir, 'antworten.jsonl'), JSON.stringify(eintrag) + '\n');
  return { gespeichert: eintrag, datei: join(dir, 'antworten.jsonl') };
}
