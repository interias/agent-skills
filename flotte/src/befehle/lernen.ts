// flotte lernen [<repo>] --pr <n> [--epic <n>] [--forge <owner/name>] [--konto <k>] [--modell <m>] [--trocken]
// The learning loop after a merged epic (src/lernen.ts). The driver calls lerne() after each merge
// when the adapter names lern_issue; /mission-aufraeumen calls the command by hand. Prints one JSON
// object: the comment, whether it was posted, the proposals and the tokens of the call.

import { resolve } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { lernAuftrag, lernBeleg, lernErgebnisAus, lernKommentar, lernKommentare, lernRegeln, lernSchema, regelTexte, streichKandidaten } from '../lernen.ts';
import { forgeRepoFuer, zugriffFuer } from '../forge/zugriff.ts';
import { forgeAus } from '../treiber/treiber.ts';
import { adapterAus } from '../werkzeuge/belegung.ts';
import { kontoAus } from '../werkzeuge/konten.ts';
import { starte, type LaufErgebnis, type Start } from '../werkzeuge/lauf.ts';
import { SKRIPTE } from '../werkzeuge/ressourcen.ts';

export interface LernAuftrag {
  repo: string;
  forge: string;
  pr: number;
  epic: number | null;
  /** the collecting issue; null: only print */
  issue: number | null;
  konto: string;
  modell: string;
  /** the installed skills (to find the rules of the loop) */
  skills: string | null;
  log?: string | null;
  programm?: Pick<Start, 'programm' | 'programmArgs'>;
}

export interface LernWelt {
  aufrufer: Aufrufer;
  starte: (s: Start) => Promise<LaufErgebnis>;
  heute: () => string;
}

export async function lerne(o: LernAuftrag, w: LernWelt) {
  const regeln = lernRegeln(regelTexte(o.repo, o.skills));
  const ids = regeln.map((r) => r.regel);
  const zugriff = zugriffFuer(o.repo, w.aufrufer, o.forge);
  const streichen = o.issue === null ? [] : streichKandidaten(lernKommentare(zugriff, o.issue)).filter((r) => ids.includes(r));
  const beleg = lernBeleg(zugriff, o.pr, o.epic);
  const r = await w.starte({
    ...(o.programm ?? {}),
    repo: o.repo,
    konto: o.konto,
    auftrag: lernAuftrag(beleg, regeln, streichen),
    modell: o.modell,
    // no tools: everything the model needs stands in the order
    extraArgs: ['--json-schema', JSON.stringify(lernSchema(ids)), '--tools', ''],
    leerlaufMs: 10 * 60_000,
    log: o.log ?? null,
  });
  const ergebnis = lernErgebnisAus(r.strukturiert);
  if (!ergebnis) return { gepostet: false, issue: o.issue, kommentar: null, fehler: `keine Antwort im Schema (${r.fehler ?? `Exit ${r.code}`})`, sitzung: r.sitzung, dauer_s: Math.round(r.dauerMs / 1000) };
  const kommentar = lernKommentar(ergebnis, o.pr, o.epic, w.heute(), ids, streichen);
  let gepostet = false;
  if (o.issue !== null) {
    try {
      zugriff.kommentieren(o.issue, kommentar);
      gepostet = true;
    } catch {
      // not posted: the result says so
    }
  }
  return { gepostet, issue: o.issue, kommentar, vorschlaege: ergebnis.vorschlaege.length, streichen, regeln: ids, sitzung: r.sitzung, dauer_s: Math.round(r.dauerMs / 1000) };
}

function wert(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function lernen(argv: string[], aufrufer: Aufrufer = aufrufen): Promise<unknown> {
  const AUFRUF = 'Aufruf: flotte lernen [<repo>] --pr <n> [--epic <n>] [--forge <owner/name>] [--konto <k>] [--modell <m>] [--trocken]';
  const repo = resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : process.cwd());
  const pr = Number(wert(argv, '--pr'));
  if (!(pr > 0)) throw new Error(AUFRUF);
  const epic = wert(argv, '--epic') ? Number(wert(argv, '--epic')) : null;
  // #127: a Gitea project names owner/name in its adapter (api), a GitHub one in origin
  let forge = wert(argv, '--forge') ?? (forgeRepoFuer(repo, '') || null);
  if (!forge) {
    const r = aufrufer('git', ['-C', repo, 'remote', 'get-url', 'origin']);
    forge = r.code ? null : forgeAus(r.stdout);
    if (!forge) throw new Error(`Die Forge lässt sich nicht aus origin lesen; --forge angeben. ${AUFRUF}`);
  }
  const adapter = adapterAus(repo);
  const issue = argv.includes('--trocken') ? null : adapter.lern_issue;
  return lerne(
    { repo, forge, pr, epic, issue, konto: kontoAus(wert(argv, '--konto') ?? '1'), modell: wert(argv, '--modell') ?? 'haiku', skills: resolve(SKRIPTE, '../..') },
    { aufrufer, starte, heute: () => new Date().toISOString().slice(0, 10) },
  );
}
