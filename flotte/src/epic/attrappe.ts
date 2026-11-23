// Stand-ins for `flotte mission` (#65, stage 1): every language-model call and every command plays a
// script. Calls come back as stream-json lines read by the driver's Auswertung, so the state
// machine sees the LaufErgebnis a real `claude -p` gives. The world (epic branch, comments, labels,
// what was called) outlives one program run, so a test can stop the program and start it again.

import { Auswertung, type LaufErgebnis } from '../werkzeuge/lauf.ts';
import { leseBlock } from '../werkzeuge/bloecke.ts';
import type { Ram, RamStufe } from '../werkzeuge/ressourcen.ts';
import type { Aufruf, Mechanik, MergeVersuch, Umgebung } from './motor.ts';
import type { Rolle, Schnitt } from './schema.ts';
import type { Testlauf } from './zustand.ts';

/** one scripted language-model call */
export interface Antwort {
  /** takts until it ends, default 1 */
  takte?: number;
  /** structured_output, merged over the default of the role (implementer and reviewer pass, conflict resolved) */
  ausgabe?: Record<string, unknown>;
  /** ends without structured_output (P8) */
  ohneAusgabe?: boolean;
  /** exit code ≠ 0 (P9) */
  exit?: number;
  /** no result line (P9) */
  ohneErgebnis?: boolean;
  /** permission_denials (P20) */
  verweigert?: unknown[];
  /** the result is an account limit (P20) */
  kontolimit?: boolean;
  /** the program dies while this call runs, after its session is known (P16) */
  abbruch?: boolean;
}

export interface EpicDrehbuch {
  /** the cut; without modus and zuordnung the stand-in gives mode tickets, each package its own child */
  schnitt: Omit<Schnitt, 'modus' | 'zuordnung' | 'uebersprungen'> & Partial<Pick<Schnitt, 'modus' | 'zuordnung' | 'uebersprungen'>>;
  /** body of an issue (the target issue: its children, its user stories); default empty */
  bodies?: Record<number, string>;
  /** 'schnitt' or '<rolle>:<paket>' → answers in order, the last one repeats; missing: the default */
  aufrufe?: Record<string, Antwort[]>;
  /** Ausgangszahlen of the epic worktree; default one suite of 249 tests in 18 files */
  basis?: Testlauf;
  /** package → its full runs in 4c in order, the last one repeats; default the basis */
  tests?: Record<string, Testlauf[]>;
  /** file → green when run alone */
  einzeln?: Record<string, boolean>;
  /** package → files it changed; default its files in the cut */
  beruehrt?: Record<string, string[]>;
  /** package → lint findings per file */
  lint?: Record<string, Record<string, number>>;
  /** package → its merge conflicts */
  konflikt?: Record<string, string[]>;
  /** packages after whose merge the epic branch is red */
  epicRot?: string[];
  /** RAM levels per reading, the last one repeats */
  ram?: RamStufe[];
  /** the slot is busy (a full stack runs) per reading, the last one repeats; default free */
  slot?: boolean[];
  /** answers of the driver, `nachTakten` after the question was asked (default 1) */
  antworten?: { frage: number; antwort: string; nachTakten?: number }[];
  /** takts after an account limit until the account is free (default 2) */
  kontoFreiNach?: number;
  /** the program dies in this Down (P17) */
  abbruchBeiDown?: string;
  /** the program dies right after this package's merge, before the state is written */
  abbruchNachMerge?: string;
  /** a guard against a script that never ends (default 400) */
  maxTakte?: number;
}

export interface Welt {
  takt: number;
  /** package branches in the epic branch, in merge order */
  gemergt: string[];
  kommentare: Record<number, string[]>;
  status: Record<number, string>;
  /** every command with the takt of the stand-ins */
  protokoll: { takt: number; was: string }[];
  aufrufe: (Aufruf & { takt: number; sitzung: string })[];
  bloecke: string[];
  /** full runs at once (decision 6: never two) */
  vollaeufe: { jetzt: number; max: number };
  /** epic merges at the Up of a worktree: the tree is the same after the merge when none came since */
  stand: Record<string, number>;
  nrVon: Record<string, string>;
  gestorben: string[];
  /** the epic worktree is mid-merge with this branch (a conflict) */
  offenerMerge: string | null;
  letzterMerge: string | null;
}

export const neueWelt = (): Welt => ({ takt: 0, gemergt: [], kommentare: {}, status: {}, protokoll: [], aufrufe: [], bloecke: [], vollaeufe: { jetzt: 0, max: 0 }, stand: {}, nrVon: {}, gestorben: [], offenerMerge: null, letzterMerge: null });

const BASIS: Testlauf = [{ name: 'flotte', dateien: 18, tests: 249, rot: [] }];
const nachstes = <T>(liste: T[] | undefined, i: number): T | undefined => (liste?.length ? liste[Math.min(i, liste.length - 1)] : undefined);

export function attrappe(buch: EpicDrehbuch, welt: Welt = neueWelt(), jetzt: () => number = Date.now): Umgebung & { welt: Welt } {
  const wartende: { bis: number; weiter: () => void }[] = [];
  const zaehler: Record<string, number> = {};
  const gefragt = new Map<number, number>();
  const geliefert = new Set<number>();
  let kontoSeit: number | null = null;
  // the program dies in a command: that command never ends, the loop throws at the end of the takt
  // (a throw inside the command would be the package's matter, mission/SKILL.md rule 10)
  let tod: string | null = null;
  const sterben = (text: string) => {
    tod = text;
    return new Promise<never>(() => {});
  };
  let ramN = 0;
  let slotN = 0;
  const log = (was: string) => welt.protokoll.push({ takt: welt.takt, was });
  // before the first takt (phase 0) nothing waits: the loop that ends a takt has not begun
  let begonnen = false;
  const bis = (takt: number) => new Promise<void>((weiter) => (!begonnen || takt <= welt.takt ? weiter() : wartende.push({ bis: takt, weiter })));
  const nrAus = (worktree: string) => worktree.replace(/^\/wt\//, '');

  function standard(rolle: Rolle, paket: string | null): Record<string, unknown> {
    if (rolle === 'schnitt') return { modus: 'tickets', zuordnung: buch.schnitt.pakete.map((p) => ({ story: `#${p.nr}`, paket: p.nr })), uebersprungen: [], ...buch.schnitt };
    const p = buch.schnitt.pakete.find((x) => x.nr === paket);
    if (rolle === 'implementer') return { version: 1, dateien: p?.dateien ?? [], neueDateien: [], abnahme: (p?.abnahme ?? []).map((punkt) => ({ punkt, satz: 'erfüllt' })), volllauf: [], nichtGekonnt: [], fremdarbeit: [], betreff: `feat: ${p?.titel ?? paket}`, warum: 'Das Drehbuch verlangt es.' };
    if (rolle === 'reviewer') return { version: 1, befunde: [], strukturell: false, schnittstelle: `Schnittstelle von ${paket}`, selbstkorrekturen: [] };
    return { version: 1, ergebnis: 'geloest', begruendung: 'getrennte Zeilen' };
  }

  function ergebnis(a: Antwort, rolle: Rolle, paket: string | null, sitzung: string): LaufErgebnis {
    const aus = new Auswertung();
    aus.zeile(JSON.stringify({ type: 'system', subtype: 'init', session_id: sitzung, tools: [] }));
    if (!a.ohneErgebnis) {
      const ausgabe = a.ohneAusgabe || a.kontolimit ? {} : { structured_output: { ...standard(rolle, paket), ...(a.ausgabe ?? {}) } };
      aus.zeile(JSON.stringify({ type: 'result', subtype: 'success', session_id: sitzung, is_error: Boolean(a.kontolimit), result: a.kontolimit ? "You've hit your limit · resets 3pm" : 'fertig', permission_denials: a.verweigert ?? [], ...ausgabe }));
    }
    return aus.ergebnis(a.exit ?? 0, false, 0, a.exit ? 'abgestürzt' : '');
  }

  const mechanik: Mechanik = {
    async aufraeumen() {
      log('aufraeumen');
      return [];
    },
    async up(name, branch, von) {
      log(`up ${name} ${branch} von ${von} [${welt.gemergt.join(' ')}]`);
      welt.stand[name] = welt.gemergt.length;
      welt.nrVon[branch] = name;
      return { worktree: `/wt/${name}` };
    },
    async down(name) {
      if (buch.abbruchBeiDown === name && !welt.gestorben.includes(`down ${name}`)) {
        welt.gestorben.push(`down ${name}`);
        return sterben(`Programm beendet vor Down ${name} (Drehbuch)`);
      }
      log(`down ${name}`);
      return { schmutzig: false };
    },
    async branchLoeschen(branch) {
      log(`branch -d ${branch}`);
    },
    async ram(): Promise<Ram> {
      const level = nachstes(buch.ram, ramN++) ?? 'ok';
      log(`ram ${level}`);
      return { level, percent_used: level === 'hold' ? 88 : level === 'warn' ? 78 : 50, free_gb: 10 };
    },
    async slot() {
      const belegt = nachstes(buch.slot, slotN++) ?? false;
      log(`slot ${belegt ? 'belegt' : 'frei'}`);
      return { belegt };
    },
    async volllauf(worktree) {
      welt.vollaeufe.jetzt++;
      welt.vollaeufe.max = Math.max(welt.vollaeufe.max, welt.vollaeufe.jetzt);
      log(`volllauf ${worktree}`);
      await bis(welt.takt + 1);
      welt.vollaeufe.jetzt--;
      const nr = nrAus(worktree);
      if (nr.startsWith('epic-')) {
        const basis = buch.basis ?? BASIS;
        const p = welt.letzterMerge ? welt.nrVon[welt.letzterMerge] : null;
        return p && buch.epicRot?.includes(p) ? basis.map((s) => ({ ...s, rot: [{ datei: 'epic.test.ts', test: 'nach dem Merge' }] })) : basis;
      }
      const n = (zaehler[`volllauf:${nr}`] = (zaehler[`volllauf:${nr}`] ?? -1) + 1);
      return nachstes(buch.tests?.[nr], n) ?? buch.basis ?? BASIS;
    },
    async einzeln(worktree, datei) {
      log(`einzeln ${nrAus(worktree)} ${datei}`);
      return buch.einzeln?.[datei] ?? false;
    },
    async lint(worktree) {
      return buch.lint?.[nrAus(worktree)] ?? {};
    },
    async beruehrt(worktree) {
      const nr = nrAus(worktree);
      return buch.beruehrt?.[nr] ?? buch.schnitt.pakete.find((p) => p.nr === nr)?.dateien ?? [];
    },
    async sichern(worktree) {
      log(`sichern ${nrAus(worktree)}`);
      return null;
    },
    async imEpic(branch) {
      const i = welt.gemergt.indexOf(branch);
      return i < 0 ? null : `m${i + 1}`;
    },
    async merge(branch): Promise<MergeVersuch> {
      // as git: no merge while the epic worktree is mid-merge (MERGE_HEAD)
      if (welt.offenerMerge) throw new Error(`merge ${branch}: der Epic-Worktree steckt mitten im Merge von ${welt.offenerMerge}`);
      log(`merge --no-ff ${branch}`);
      const konflikt = buch.konflikt?.[welt.nrVon[branch]];
      if (konflikt?.length) {
        welt.offenerMerge = branch;
        return { ok: false, dateien: konflikt };
      }
      welt.gemergt.push(branch);
      welt.letzterMerge = branch;
      if (buch.abbruchNachMerge === welt.nrVon[branch] && !welt.gestorben.includes(`merge ${branch}`)) {
        welt.gestorben.push(`merge ${branch}`);
        return sterben(`Programm beendet nach dem Merge von ${branch} (Drehbuch)`);
      }
      return { ok: true, commit: `m${welt.gemergt.length}` };
    },
    async mergeAbschliessen() {
      log(`merge abgeschlossen ${welt.offenerMerge}`);
      welt.gemergt.push(welt.offenerMerge!);
      welt.letzterMerge = welt.offenerMerge;
      welt.offenerMerge = null;
      return `m${welt.gemergt.length}`;
    },
    async mergeAbbrechen() {
      log(`merge --abort ${welt.offenerMerge}`);
      welt.offenerMerge = null;
    },
    async baumGleich(branch) {
      return welt.stand[welt.nrVon[branch]] === welt.gemergt.length - 1;
    },
    async revert(commit) {
      log(`revert -m 1 ${commit}`);
      return `r-${commit}`;
    },
    async graph() {
      log('graph');
      return { available: true };
    },
    async body(ticket) {
      return buch.bodies?.[ticket] ?? '';
    },
    async kommentare(ticket) {
      return welt.kommentare[ticket] ?? [];
    },
    async kommentar(ticket, text) {
      (welt.kommentare[ticket] ??= []).push(text);
    },
    async status(ticket, label) {
      log(`status ${ticket} ${label}`);
      welt.status[ticket] = label;
      return null;
    },
    async eroeffnung() {
      log('eroeffnung');
      return null;
    },
    async abschluss({ wip }) {
      log(`abschluss${wip ? ' WIP' : ''}`);
      return { pr: 'https://github.com/o/r/pull/100' };
    },
  };

  return {
    welt,
    jetzt,
    mechanik,
    aufrufe: {
      async rufe(a, beiSitzung) {
        const schluessel = a.rolle === 'schnitt' ? 'schnitt' : `${a.rolle}:${a.paket}`;
        const n = (zaehler[schluessel] = (zaehler[schluessel] ?? -1) + 1);
        const antwort = nachstes(buch.aufrufe?.[schluessel], n) ?? {};
        const sitzung = a.resume ?? `s-${schluessel}-${n}`;
        welt.aufrufe.push({ ...a, takt: welt.takt, sitzung });
        beiSitzung(sitzung);
        await bis(welt.takt + (antwort.takte ?? 1));
        if (antwort.abbruch) throw new Error(`Programm beendet während ${schluessel} (Drehbuch)`);
        if (antwort.kontolimit) kontoSeit = welt.takt;
        return ergebnis(antwort, a.rolle, a.paket, sitzung);
      },
      async kontoFrei() {
        return kontoSeit !== null && welt.takt >= kontoSeit + (buch.kontoFreiNach ?? 2);
      },
    },
    leitung: {
      melde(block) {
        welt.bloecke.push(block);
        const b = leseBlock(block);
        if (b?.art === 'frage') for (const f of b.fragen) gefragt.set(f.nr, welt.takt);
      },
      antworten() {
        const out: { frage: number; antwort: string }[] = [];
        for (const [i, a] of (buch.antworten ?? []).entries()) {
          const seit = gefragt.get(a.frage);
          if (geliefert.has(i) || seit === undefined || welt.takt < seit + (a.nachTakten ?? 1)) continue;
          geliefert.add(i);
          out.push({ frage: a.frage, antwort: a.antwort });
        }
        return out;
      },
    },
    async warte() {
      if (tod) throw new Error(tod);
      begonnen = true;
      welt.takt++;
      if (welt.takt > (buch.maxTakte ?? 400)) throw new Error(`Drehbuch hängt nach ${welt.takt} Takten`);
      for (const w of wartende.splice(0)) {
        if (w.bis <= welt.takt) w.weiter();
        else wartende.push(w);
      }
      await new Promise((r) => setImmediate(r));
    },
  };
}
