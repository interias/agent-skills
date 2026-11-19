// flotte fahren: the driver (#14, stage 3). A loop over the tools; language models are only the
// content of a state: the runs (/epic unchanged, ending every turn with a block) and one admiral
// call per question block. Everything the driver decides is in this file and tested by the
// scripts D1–D21 (test/drehbuecher.test.ts).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aufrufen, aufrufenAsync, type AsyncAufrufer, type Aufrufer } from '../aufruf.ts';
import { type Adapter, belege, type EpicBild, sammle } from '../werkzeuge/belegung.ts';
import { type EndeBlock, type FrageBlock, leseBlock } from '../werkzeuge/bloecke.ts';
import { type LaufErgebnis, liesLog, type Start, starte } from '../werkzeuge/lauf.ts';
import { type Bremse, freiGb, messeRam, naechsteBremse, type Ram, SKRIPTE } from '../werkzeuge/ressourcen.ts';
import { type Bewertung, bewerte, lies as liesVerbrauch } from '../werkzeuge/verbrauch.ts';
import { entsperren, type EpicZustand, flotteDir, lebt, lies as liesZustand, neuesEpic, schreibe as schreibeZustand, sperren, type Zustand } from '../werkzeuge/zustand.ts';
import { ADMIRAL_ARGS, admiralAuftrag, antwortenAus } from './admiral.ts';
import { kommentar, logbuchBody, logbuchFinden, logbuchSchreiben, prZustand } from './forge.ts';
import { schreibeTafel } from './tafel.ts';

export interface Einstellung {
  repo: string;
  forge: string;
  epics: number[];
  /** CLAUDE_CONFIG_DIR per account; ~/.claude is account 1 */
  konten: string[];
  skill: string;
  modell: string | null;
  admiralModell: string | null;
  admiralEffort: string | null;
  pingModell: string;
  leerlaufMs: number;
  taktMs: number;
  plattMinGb: number;
  ramWarn: number;
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
}

export function standard(repo: string, forge: string, epics: number[], konten: string[]): Einstellung {
  return {
    repo: resolve(repo),
    forge,
    epics,
    konten: konten.map((k) => resolve(k)),
    skill: 'epic',
    modell: null,
    admiralModell: 'fable',
    admiralEffort: 'high',
    pingModell: 'haiku',
    leerlaufMs: 30 * 60_000,
    taktMs: 60_000,
    plattMinGb: 20,
    ramWarn: 75,
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
  };
}

/** Everything outside the driver, replaceable in the tests. */
export interface Welt {
  aufrufer: Aufrufer;
  langsam: AsyncAufrufer;
  starte: (s: Start) => Promise<LaufErgebnis>;
  freiGb: (pfad: string) => number | null;
  jetzt: () => number;
  melde: (zeile: string) => void;
}

export const echteWelt: Welt = {
  aufrufer: aufrufen,
  langsam: aufrufenAsync,
  starte,
  freiGb,
  jetzt: Date.now,
  melde: (z) => process.stderr.write(`${z}\n`),
};

export interface MenschFrage {
  epic: number;
  nr: number;
  frage: string;
  empfehlung: string;
  /** what waits: 'der ganze Lauf' or the parked packages */
  wartet: string;
  ganzerLauf: boolean;
  seit: string;
  beantwortet?: string;
}

export interface Entscheidung {
  epic: number;
  nr: number;
  frage: string;
  antwort: string;
  herkunft: string;
  einflussreich: boolean;
  zeit: string;
}

export interface FlottenEpic extends EpicZustand {
  pid?: number | null;
  log?: string | null;
  /** what the run gets next, once the brakes allow it */
  auftrag?: { text: string; resume: boolean } | null;
  /** the admiral's answers held back while the whole run waits for the person */
  festgehalten?: string | null;
  /** answers of the person to deliver with the next turn */
  nachzureichen?: string[];
  nacharbeitGemacht?: boolean;
  mergeVersuche?: number;
  konfliktGemeldet?: boolean;
  prBereitGemeldet?: boolean;
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
  statistik: { starts: number; maxLaeufe: number; admiral: number; pings: number; immerGruen: boolean };
}

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
  geaendert = true;

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
      statistik: { starts: 0, maxLaeufe: 0, admiral: 0, pings: 0, immerGruen: true },
      ...alt,
      version: 1,
      repo: this.e.repo,
      epics: (alt.epics ?? {}) as Record<string, FlottenEpic>,
      ereignisse: alt.ereignisse ?? [],
      aktiv: true,
      stand: '',
    };
    for (const nr of this.e.epics) this.z.epics[nr] ??= neuesEpic(nr);
    const { bilder, adapter } = sammle(this.w.aufrufer, this.e.repo, this.e.forge, this.e.epics);
    this.bilder = bilder;
    this.adapter = adapter;
    this.z.logbuch ??= logbuchFinden(this.w.aufrufer, this.e.forge, this.logbuchText());
    this.ereignis(null, `Einsatz gestartet: ${this.e.epics.map((n) => `#${n}`).join(', ')}`);
    this.wiederaufnehmen();

    for (;;) {
      this.antwortenLesen();
      this.messen();
      await this.pings();
      await this.mergeWache();
      this.verteile();
      this.belege();
      this.speichern();
      if (!this.fertig.length && !this.laufend.size && this.istZuEnde()) break;
      if (this.e.maxDauerMs !== null && this.w.jetzt() - anfang > this.e.maxDauerMs) {
        this.ereignis(null, `Zeitgrenze von ${Math.round(this.e.maxDauerMs / 1000)} s erreicht, Treiber hält an`);
        await Promise.all(this.laufend.values());
        while (this.fertig.length) await this.verarbeite(this.fertig.shift()!);
        break;
      }
      if (!this.fertig.length) await Promise.race([...this.laufend.values(), pause(this.e.taktMs)]);
      while (this.fertig.length) await this.verarbeite(this.fertig.shift()!);
    }
    await this.abschluss();
    return this.z;
  }

  // ---- state, board, logbook

  ereignis(epic: number | null, text: string): void {
    this.z.ereignisse.push({ zeit: new Date(this.w.jetzt()).toISOString(), epic, text });
    this.w.melde(`${epic ? `#${epic} ` : ''}${text}`);
    this.geaendert = true;
  }

  epic(nr: number): FlottenEpic {
    return this.z.epics[String(nr)];
  }

  speichern(): void {
    this.z.stand = new Date(this.w.jetzt()).toISOString();
    schreibeZustand(this.dir, this.z);
    if (!this.geaendert) return;
    this.geaendert = false;
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
      epics: Object.values(this.z?.epics ?? {}).map((ep) => ({ number: ep.nr, stage: stage[ep.stufe] ?? 'waiting', carrier: 'agent' as const, paused: Boolean(ep.auftrag) && !this.laufend.has(ep.nr), note: ep.notiz })),
      questions: (this.z?.fragen ?? []).filter((f) => !f.beantwortet).map((f) => ({ number: f.epic, text: f.frage })),
      history: { deployments: 0, max_runs: this.z?.statistik.maxLaeufe ?? 0, all_green: 0 },
    });
  }

  // ---- D16: continue from the state file

  wiederaufnehmen(): void {
    for (const ep of Object.values(this.z.epics)) {
      if (!ep.pid) continue;
      const { pid, log } = ep;
      this.ereignis(ep.nr, lebt(pid) ? `Lauf (pid ${pid}) lebt noch: wird beobachtet, nicht neu gestartet` : `Lauf (pid ${pid}) endete ohne Treiber: Ergebnis aus dem Log`);
      const p = (async () => {
        while (lebt(pid)) await pause(Math.min(this.e.taktMs, 1000));
        const r = log && existsSync(log) ? liesLog(log) : liesLog(this.leeresLog(ep.nr));
        this.fertig.push({ nr: ep.nr, r });
      })().finally(() => this.laufend.delete(ep.nr));
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

  messen(): void {
    this.ram = messeRam(this.w.aufrufer, this.e.repo, join(this.e.skripte, 'ram.ps1'));
    const vorher = this.ramBremse.halt;
    this.ramBremse = naechsteBremse(this.ramBremse, this.ram, this.e.ramWarn);
    if (this.ramBremse.halt !== vorher) this.ereignis(null, this.ramBremse.halt ? `RAM ${this.ram.level} (${this.ram.percent_used ?? '?'} %): nichts Neues` : `RAM wieder ok (${this.ram.percent_used} %): es geht weiter`);
    const frei = this.w.freiGb(this.e.repo);
    const genug = frei !== null && frei >= this.e.plattMinGb;
    if (genug !== this.platteGenug) this.ereignis(null, genug ? 'Platte wieder über der Schwelle' : `Platte: ${frei ?? 'unbekannt'} GB frei, Schwelle ${this.e.plattMinGb} GB: kein Start`);
    this.platteGenug = genug;
    for (const k of this.e.konten) {
      const b = bewerte(liesVerbrauch(k), this.w.jetzt(), this.e.verbrauchMaxAlterMin);
      const alt = this.bewertung.get(k)?.stufe;
      if (alt && alt !== b.stufe) this.ereignis(null, `Verbrauch ${this.kontoName(k)}: ${b.stufe} (${b.grund})`);
      if (b.stufe !== 'gruen' && this.laufend.size) this.z.statistik.immerGruen = false;
      this.bewertung.set(k, b);
    }
    this.z.bremse = {
      ram: this.ram.level,
      ramHalt: this.ramBremse.halt,
      platteGenug: this.platteGenug,
      obergrenze: this.obergrenze(),
      konten: this.e.konten.map((k) => ({ konto: k, stufe: this.bewertung.get(k)!.stufe, grund: this.bewertung.get(k)!.grund })),
    };
  }

  kontoName(k: string): string {
    return `Konto ${this.e.konten.indexOf(k) + 1}`;
  }

  obergrenze(): number {
    const gruen = this.e.konten.map((k) => this.bewertung.get(k)).filter((b): b is Bewertung => b?.stufe === 'gruen');
    return gruen.length ? Math.min(4, ...gruen.map((b) => b.obergrenze)) : 0;
  }

  /** Decision 1 at HALT 1: a stale value is red; a small haiku run fetches a fresh one when nothing runs on the account. */
  async pings(): Promise<void> {
    for (const k of this.e.konten) {
      const b = this.bewertung.get(k)!;
      if (b.alterMin !== null && b.alterMin <= this.e.verbrauchMaxAlterMin) continue;
      if (Object.values(this.z.epics).some((ep) => ep.konto === k && this.laufend.has(ep.nr))) continue;
      const zuletzt = this.letzterPing.get(k) ?? 0;
      if (this.w.jetzt() - zuletzt < (this.e.verbrauchMaxAlterMin * 60_000) / 2) continue;
      this.letzterPing.set(k, this.w.jetzt());
      this.z.statistik.pings++;
      const r = await this.w.starte({ ...this.programm(), repo: this.e.repo, konto: k, auftrag: 'FLOTTE-PING Antworte nur mit OK.', modell: this.e.pingModell, leerlaufMs: 5 * 60_000 });
      this.ereignis(null, `Verbrauch ${this.kontoName(k)} veraltet: Mini-Lauf ${r.verbrauch ? 'lieferte einen frischen Wert' : `ohne Wert (${r.fehler ?? 'kein rate_limit_event'})`}`);
      const neu = bewerte(liesVerbrauch(k), this.w.jetzt(), this.e.verbrauchMaxAlterMin);
      this.bewertung.set(k, neu);
    }
  }

  programm(): Pick<Start, 'programm' | 'programmArgs'> {
    return { programm: this.e.programm, programmArgs: this.e.programmArgs };
  }

  darfFortsetzen(konto: string | null): boolean {
    return !this.ramBremse.halt && (!konto || this.bewertung.get(konto)?.stufe !== 'rot');
  }

  // ---- starting and continuing runs

  startText(nr: number): string {
    return `Flotte, Epic #${nr}: Rufe den Skill ${this.e.skill} mit #${nr} auf. Du läufst unter dem Flotten-Treiber ohne Fenster: Frag nie den Menschen direkt und warte nicht auf ihn. Beende jeden Zug mit FLOTTE-FRAGE oder FLOTTE-ENDE (epic-flotte/SKILL.md, „Die Blöcke"). Mergen ist nicht deine Aufgabe.`;
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
    const laeufe = join(this.dir, 'laeufe');
    mkdirSync(laeufe, { recursive: true });
    ep.log = join(laeufe, `${nr}-${this.w.jetzt()}-${this.z.statistik.starts}.jsonl`);
    this.z.statistik.starts++;
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
        beimStart: (pid) => {
          ep.pid = pid;
          schreibeZustand(this.dir, this.z);
        },
      })
      .then((r) => {
        this.fertig.push({ nr, r });
      })
      .finally(() => this.laufend.delete(nr));
    this.laufend.set(nr, p);
    this.z.statistik.maxLaeufe = Math.max(this.z.statistik.maxLaeufe, this.laufend.size);
    this.ereignis(nr, resume ? 'Lauf fortgesetzt' : 'Lauf gestartet');
  }

  verteile(): void {
    for (const ep of Object.values(this.z.epics)) {
      if (!ep.auftrag || this.laufend.has(ep.nr) || !this.darfFortsetzen(ep.konto)) continue;
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
    const gruen = this.e.konten.filter((k) => this.bewertung.get(k)?.stufe === 'gruen');
    if (!gruen.length) return;
    const laufend = Object.values(this.z.epics).filter((ep) => BELEGT.has(ep.stufe) || this.laufend.has(ep.nr)).map((ep) => ep.nr);
    const gemergt = Object.values(this.z.epics).filter((ep) => ep.stufe === 'gemergt' || ep.stufe === 'fertig').map((ep) => ep.nr);
    const im = this.bilder.filter((b) => {
      const s = this.epic(b.nr).stufe;
      return s === 'wartend' || laufend.includes(b.nr) || gemergt.includes(b.nr);
    });
    const plan = belege(im, this.adapter, { laufend, gemergt, obergrenze: this.obergrenze() });
    for (const w of plan.wartend) {
      const notiz = `wartet auf den Merge von ${w.wartetAuf.map((n) => `#${n}`).join(', ')}`;
      if (this.epic(w.nr).notiz !== notiz) this.epic(w.nr).notiz = notiz;
    }
    for (const nr of plan.neu) {
      const ep = this.epic(nr);
      // fewest running runs; on a tie the account with fewer epics so far (dress rehearsal: with
      // a limit of 1 every tie went to account 1)
      const konto = [...gruen].sort((a, b) => this.aufKonto(a) - this.aufKonto(b) || this.epicsAuf(a) - this.epicsAuf(b))[0];
      ep.konto = konto;
      ep.stufe = 'laeuft';
      ep.notiz = '';
      const p = plan.paare.filter((x) => (x.a === nr || x.b === nr) && laufend.includes(x.a === nr ? x.b : x.a));
      if (p.length) this.ereignis(nr, `Belegung: ${p.map((x) => `mit #${x.a === nr ? x.b : x.a} ${x.stufe} (${x.beleg})`).join('; ')}`);
      if (this.ram) this.z.ram.push({ at: new Date(this.w.jetzt()).toISOString().slice(0, 16), epic: nr, level: this.ram.level, percent_used: this.ram.percent_used, free_gb: this.ram.free_gb });
      laufend.push(nr);
      this.starteLauf(ep, this.startText(nr), false);
    }
  }

  aufKonto(k: string): number {
    return Object.values(this.z.epics).filter((ep) => ep.konto === k && this.laufend.has(ep.nr)).length;
  }

  epicsAuf(k: string): number {
    return Object.values(this.z.epics).filter((ep) => ep.konto === k).length;
  }

  // ---- results

  async verarbeite({ nr, r }: { nr: number; r: LaufErgebnis }): Promise<void> {
    const ep = this.epic(nr);
    ep.pid = null;
    if (r.sitzung) ep.sitzung = r.sitzung;
    if (r.verweigert.length) {
      // D19: on the board, blocked, never tried again in another form
      const was = r.verweigert.map((d) => (d as { tool_name?: string }).tool_name ?? JSON.stringify(d).slice(0, 80)).join(', ');
      return this.halt(ep, 'blockiert', `Erlaubnis verweigert: ${was}. Kein zweiter Versuch in anderer Form.`);
    }
    if (r.fehler === 'leerlauf') {
      await this.aufraeumen(nr);
      return this.halt(ep, 'abgebrochen', `Leerlauf: ${Math.round(this.e.leerlaufMs / 60_000)} min ohne Ausgabe`, true);
    }
    if (r.fehler === 'anmeldung') return this.halt(ep, 'blockiert', `Konto ${this.kontoName(ep.konto ?? '')} ist nicht angemeldet. Ein Mensch meldet es an.`);
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
    const block = leseBlock(r.text);
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
        ep.auftrag = { resume: true, text: this.an(nr, 'Dein Zug endete ohne FLOTTE-FRAGE oder FLOTTE-ENDE. Kannst du fortsetzen? Beende den Zug mit einem der beiden Blöcke.') };
        this.ereignis(nr, 'Zug ohne Block, einmal nachgefragt');
        return;
      }
      return this.halt(ep, 'abgebrochen', `Zug ohne Block, auch nach der Nachfrage. Letzter Stand des Laufs:\n\n${r.text.slice(-1500) || '(kein Text)'}`, true);
    }
    ep.nachfragen = 0;
    if (block.art === 'frage') await this.frage(ep, block);
    else await this.ende(ep, block);
  }

  halt(ep: FlottenEpic, stufe: 'blockiert' | 'abgebrochen', grund: string, amIssue = false): void {
    ep.stufe = stufe;
    ep.notiz = grund.split('\n')[0];
    this.ereignis(ep.nr, `${stufe}: ${grund.split('\n')[0]}`);
    if (amIssue || stufe === 'blockiert') kommentar(this.w.aufrufer, this.e.forge, ep.nr, `**Flotte (${this.e.admiralName})** — Epic ${stufe}.\n\n${grund}`);
  }

  async aufraeumen(nr: number | null): Promise<void> {
    const r = await this.w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(this.e.skripte, 'worktree.ps1'), '-Action', 'CleanupStale', '-RepoRoot', this.e.repo], { cwd: this.e.repo, timeoutMs: 15 * 60_000 });
    this.ereignis(nr, r.code ? `CleanupStale meldet Fehler: ${(r.stderr || r.stdout).trim().split('\n').pop()}` : 'Reste abgeräumt (CleanupStale)');
  }

  // ---- question blocks (D2, D3)

  async frage(ep: FlottenEpic, block: FrageBlock): Promise<void> {
    const nr = ep.nr;
    if (block.phase === 'ram') {
      ep.auftrag = { resume: true, text: this.an(nr, 'Antwort auf FLOTTE-FRAGE ram: A) warten bis ok. Der Speicher ist wieder unter der Schwelle, weiter.') };
      ep.notiz = 'wartet auf RAM ok';
      this.ereignis(nr, 'RAM-Frage: weiter, sobald die Bremse frei ist');
      return;
    }
    this.z.statistik.admiral++;
    const frueher = this.z.entscheidungen.filter((d) => d.epic === nr).map((d) => `- Frage „${d.frage}" → ${d.antwort} (${d.herkunft})`);
    const kontext = `Epic #${nr} in ${this.e.forge}, Repository ${this.e.repo}.${frueher.length ? `\nFrühere Entscheidungen zu diesem Epic:\n${frueher.join('\n')}` : ''}`;
    const r = await this.w.starte({
      ...this.programm(),
      repo: this.e.repo,
      konto: ep.konto!,
      auftrag: admiralAuftrag(block, kontext),
      modell: this.e.admiralModell,
      extraArgs: [...ADMIRAL_ARGS, ...(this.e.admiralEffort ? ['--effort', this.e.admiralEffort] : [])],
      leerlaufMs: 15 * 60_000,
      log: join(this.dir, 'admiral', `${nr}-${this.w.jetzt()}.jsonl`),
    });
    const antworten = antwortenAus(r.strukturiert, block);
    const zeilen: string[] = [];
    const geparkt: string[] = [];
    let ganzerLauf = false;
    for (const a of antworten) {
      const f = block.fragen.find((x) => x.nr === a.nr)!;
      const zeit = new Date(this.w.jetzt()).toISOString();
      if (!a.beim_menschen) {
        zeilen.push(`${a.nr}. ${/^[A-H]$/.test(a.antwort.trim()) ? a.antwort.trim() : `Antwort: ${a.antwort}`} — Herkunft: ${a.herkunft}`);
        this.z.entscheidungen.push({ epic: nr, nr: a.nr, frage: f.frage, antwort: a.antwort, herkunft: a.herkunft, einflussreich: a.einflussreich, zeit });
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
      this.z.fragen.push({ epic: nr, nr: a.nr, frage: f.frage, empfehlung: a.antwort, wartet, ganzerLauf: lauf, seit: zeit });
      zeilen.push(`${a.nr}. liegt beim Menschen${lauf ? '' : `; geparkt: ${wartet}`}`);
      kommentar(this.w.aufrufer, this.e.forge, nr, `**FRAGE AN DEN MENSCHEN (Flotte)** — ${f.frage}\nLage: ${f.lage}\nOptionen: ${f.optionen.map((o) => `${o.buchstabe}) ${o.text}`).join(' ')}\nEmpfehlung: ${a.antwort} — ${a.grund}\nOhne Antwort wartet: ${wartet}. Alles andere läuft weiter.\nAntworten: \`flotte antworten ${this.e.repo} ${nr} ${a.nr} "<Antwort>"\``);
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
      const f = this.z.fragen.find((x) => x.epic === a.epic && x.nr === a.nr && !x.beantwortet);
      const ep = this.epic(a.epic);
      if (!f || !ep) {
        this.ereignis(a.epic ?? null, `Antwort auf Frage ${a.nr} passt zu keiner offenen Frage`);
        continue;
      }
      f.beantwortet = a.text;
      ep.nachzureichen = [...(ep.nachzureichen ?? []), `${a.nr}. ${a.text}`];
      kommentar(this.w.aufrufer, this.e.forge, a.epic, `**Antwort des Menschen (über die Flotte)** — ${f.frage}\nAntwort: ${a.text}`);
      this.ereignis(a.epic, `Antwort des Menschen auf Frage ${a.nr}`);
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
    }
    this.z.antwortenGelesen = zeilen.length;
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
    const offen = block.offen.trim();
    if (this.e.nacharbeit && !ep.nacharbeitGemacht && offen && !/^[-–—]?\s*(keine|nichts)?\.?$/i.test(offen)) {
      ep.nacharbeitGemacht = true;
      ep.stufe = 'nacharbeit';
      ep.auftrag = { resume: true, text: this.an(nr, `Rufe den Skill epic-nacharbeit mit #${nr} auf. Fragerunden kommen als FLOTTE-FRAGE nacharbeit, am Ende FLOTTE-ENDE.`) };
      this.ereignis(nr, `FLOTTE-ENDE mit PR #${ep.pr}, offene Punkte: Nacharbeit`);
      return;
    }
    ep.stufe = 'pr';
    if (!ep.pr) return this.halt(ep, 'blockiert', 'FLOTTE-ENDE ohne Pull Request');
    this.ereignis(nr, `FLOTTE-ENDE, PR #${ep.pr}`);
    if (this.adapter.merge === 'nach_gate') await this.mergen(ep);
    else this.prBereit(ep, 'merge: mensch');
  }

  prBereit(ep: FlottenEpic, warum: string): void {
    ep.notiz = `PR #${ep.pr} bereit, ein Mensch mergt (${warum})`;
    if (ep.prBereitGemeldet) return;
    ep.prBereitGemeldet = true;
    const d = this.z.entscheidungen.filter((x) => x.epic === ep.nr && x.einflussreich);
    kommentar(this.w.aufrufer, this.e.forge, ep.nr, `**PR bereit (Flotte)** — #${ep.pr}. Gemergt wird von einem Menschen (${warum}).${d.length ? `\nEinflussreiche Entscheidungen zu diesem Epic:\n${d.map((x) => `- ${x.frage} → ${x.antwort} (${x.herkunft})`).join('\n')}` : ''}`);
    this.ereignis(ep.nr, `PR #${ep.pr} bereit, ein Mensch mergt`);
  }

  async mergen(ep: FlottenEpic): Promise<void> {
    const r = await this.w.langsam('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.e.mergeSkript, '-Repo', this.e.forge, '-Pr', String(ep.pr)], { cwd: this.e.repo, timeoutMs: 40 * 60_000 });
    const zeile = (r.stdout.trim().split(/\r?\n/).pop() || r.stderr.trim().split(/\r?\n/).pop() || `merge.ps1 Exit ${r.code}`).trim();
    this.ereignis(ep.nr, `merge.ps1: ${zeile}`);
    if (/^GEMERGT/.test(zeile)) return this.nachMerge(ep);
    if (/^(GATE FEHLT|GATE UNGEPRUEFT|KONFLIKT|CHECKS ROT)/.test(zeile)) {
      // D10: never merged; the run brings its PR in order
      ep.mergeVersuche = (ep.mergeVersuche ?? 0) + 1;
      if (ep.mergeVersuche > 2) return this.halt(ep, 'blockiert', `Merge nach zwei Nachbesserungen weiter abgelehnt: ${zeile}`);
      ep.stufe = 'laeuft';
      ep.auftrag = { resume: true, text: this.an(ep.nr, `Der Merge wurde abgelehnt: ${zeile}. Bring den Pull Request in Ordnung: Basis in den Epic-Branch mergen, nur mechanische Konflikte lösen, das Gate neu laufen lassen und den Gate-Block in der PR-Beschreibung ersetzen. Dann FLOTTE-ENDE.`) };
      return;
    }
    if (/^NICHT GEMERGT.*merge:/.test(zeile)) return this.prBereit(ep, 'Adapter auf der Basis sagt merge: mensch');
    this.prBereit(ep, zeile);
  }

  /** D12/D13: merged by a person, or a conflict after another merge. */
  async mergeWache(): Promise<void> {
    for (const ep of Object.values(this.z.epics)) {
      if (ep.stufe !== 'pr' || !ep.pr || this.laufend.has(ep.nr) || ep.auftrag) continue;
      const pz = prZustand(this.w.aufrufer, this.e.forge, ep.pr);
      if (!pz) continue;
      if (pz.state === 'MERGED') {
        this.ereignis(ep.nr, `PR #${ep.pr} gemergt`);
        await this.nachMerge(ep);
      } else if (pz.state === 'CLOSED') this.halt(ep, 'abgebrochen', `PR #${ep.pr} wurde ohne Merge geschlossen`);
      else if (pz.mergeable === 'CONFLICTING' && !ep.konfliktGemeldet) {
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
    await this.aufraeumen(ep.nr);
    ep.stufe = 'fertig';
    ep.notiz = `PR #${ep.pr} gemergt`;
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
  }
}

function wert(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const nummern = (s: string | undefined) => (s ?? '').split(',').map((x) => Number(x.trim().replace('#', ''))).filter((n) => n > 0);

export async function fahren(argv: string[]): Promise<unknown> {
  const repo = argv[0];
  const forge = wert(argv, '--forge');
  const epics = nummern(wert(argv, '--epics'));
  const konten = (wert(argv, '--konten') ?? '').split(',').filter(Boolean);
  if (!repo || repo.startsWith('--') || !forge || !epics.length || !konten.length) {
    throw new Error('Aufruf: flotte fahren <repo> --forge <owner/name> --epics 3,4 --konten <dir>[,<dir>] [--skill epic] [--modell m] [--admiral-modell fable] [--admiral-effort high] [--ping-modell haiku] [--leerlauf-min 30] [--takt-s 60] [--platte-min-gb 20] [--ram-warn 75] [--sweep-root <dir>] [--sweep-temp <dir>] [--ohne-docker] [--ohne-nacharbeit] [--merge-skript <merge.ps1>] [--max-min n]');
  }
  const e = standard(repo, forge, epics, konten);
  e.skill = wert(argv, '--skill') ?? e.skill;
  e.modell = wert(argv, '--modell') ?? e.modell;
  e.admiralModell = wert(argv, '--admiral-modell') ?? e.admiralModell;
  e.admiralEffort = wert(argv, '--admiral-effort') ?? e.admiralEffort;
  if (e.admiralEffort === 'keine') e.admiralEffort = null;
  e.pingModell = wert(argv, '--ping-modell') ?? e.pingModell;
  e.leerlaufMs = Number(wert(argv, '--leerlauf-min') ?? 30) * 60_000;
  e.taktMs = Number(wert(argv, '--takt-s') ?? 60) * 1000;
  e.plattMinGb = Number(wert(argv, '--platte-min-gb') ?? e.plattMinGb);
  e.ramWarn = Number(wert(argv, '--ram-warn') ?? e.ramWarn);
  e.sweepRoot = wert(argv, '--sweep-root') ?? null;
  e.sweepTemp = wert(argv, '--sweep-temp') ?? null;
  e.sweepDocker = !argv.includes('--ohne-docker');
  e.mergeSkript = resolve(wert(argv, '--merge-skript') ?? e.mergeSkript);
  e.nacharbeit = !argv.includes('--ohne-nacharbeit');
  const max = wert(argv, '--max-min');
  e.maxDauerMs = max ? Number(max) * 60_000 : null;
  const z = await fahre(e);
  return {
    aktiv: z.aktiv,
    epics: Object.values(z.epics).map((ep) => ({ nr: ep.nr, stufe: ep.stufe, pr: ep.pr, notiz: ep.notiz })),
    offeneFragen: z.fragen.filter((f) => !f.beantwortet),
    statistik: z.statistik,
    tafel: join(flotteDir(e.repo), 'tafel.html'),
  };
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
