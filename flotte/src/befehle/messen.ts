// flotte messen <einsaetze.json> [--name <einsatz>]
// Measures deployments from transcripts of both accounts, the forge and usage.ps1 (#14, "Messen").
// Prints one JSON object: per deployment the seven metrics, each with how it was measured.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { aufrufen, pwshJson, type Aufrufer } from '../aufruf.ts';
import { leseDatei, type Eintrag } from '../transkript.ts';
import { epicVerlauf, istFehlstart, kalteZeit, prDauern, rueckfragen, runde, treiberKennzahlen, verteilung, type Fenster, type PullRequest, type Rueckfrage, type TreiberZustand } from '../messen.ts';
import { adapterAus } from '../werkzeuge/belegung.ts';
import { ladeSitzung, tokenKennzahlen, type AgentLauf } from '../tokens.ts';
import { liesMessungen, stand as prognoseStand } from '../werkzeuge/prognose.ts';

export interface SitzungRef {
  konto: string;
  /** session id or its first characters */
  id: string;
  /** subagent transcripts of this session with this agentType instead of the session itself */
  agentType?: string;
  /** limit to this part of a session that did more than the deployment */
  von?: string;
  bis?: string;
}

export interface Einsatz {
  name: string;
  repo: string;
  repoPfad?: string;
  von: string;
  bis: string;
  epics: number[];
  orchestrierung: SitzungRef[];
  laeufe: SitzungRef[];
  /** project folder names (<config>/projects/<name>) whose unlisted sessions count as starts */
  startOrdner?: string[];
  /** every session in startOrdner inside the window is a run, besides the listed ones */
  laeufeAusOrdnern?: boolean;
  /** session ids (or first characters) in startOrdner that belong to something else */
  ausschliessen?: string[];
  /** zustand.json of the driver (<git common dir>/flotte): questions, waits, cold time and starts come from there */
  treiberZustand?: string;
  quelle?: string;
}

export interface Konfiguration {
  konten: Record<string, string>;
  einsaetze: Einsatz[];
}

export interface Umgebung {
  aufrufer: Aufrufer;
  usageSkript: string;
}

function pfadAus(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

interface Transkript {
  ref: SitzungRef;
  pfad: string;
  eintraege: Eintrag[];
}

function sitzungsdatei(kontoDir: string, id: string): string | null {
  const projekte = join(kontoDir, 'projects');
  if (!existsSync(projekte)) return null;
  for (const ordner of readdirSync(projekte)) {
    const dir = join(projekte, ordner);
    let namen: string[] = [];
    try {
      namen = readdirSync(dir);
    } catch {
      continue;
    }
    const treffer = namen.find((n) => n.startsWith(id) && n.endsWith('.jsonl'));
    if (treffer) return join(dir, treffer);
  }
  return null;
}

function ladeRef(konf: Konfiguration, ref: SitzungRef, fehler: string[]): Transkript[] {
  const kontoDir = pfadAus(konf.konten[ref.konto] ?? '');
  const datei = kontoDir && sitzungsdatei(kontoDir, ref.id);
  if (!datei) {
    fehler.push(`Sitzung ${ref.konto}/${ref.id} nicht gefunden`);
    return [];
  }
  if (!ref.agentType) return [{ ref, pfad: datei, eintraege: leseDatei(datei) }];
  const sub = join(dirname(datei), basename(datei, '.jsonl'), 'subagents');
  if (!existsSync(sub)) {
    fehler.push(`Sitzung ${ref.konto}/${ref.id} hat keine Subagenten`);
    return [];
  }
  const out: Transkript[] = [];
  for (const n of readdirSync(sub).filter((x) => x.endsWith('.meta.json'))) {
    try {
      const meta = JSON.parse(readFileSync(join(sub, n), 'utf8'));
      const jsonl = join(sub, n.replace(/\.meta\.json$/, '.jsonl'));
      if (meta.agentType === ref.agentType && existsSync(jsonl)) out.push({ ref, pfad: jsonl, eintraege: leseDatei(jsonl) });
    } catch {
      fehler.push(`Subagent ${n} nicht lesbar`);
    }
  }
  return out;
}

function fensterVon(e: Einsatz, ref?: SitzungRef): Fenster {
  return { von: Date.parse(ref?.von ?? e.von), bis: Date.parse(ref?.bis ?? e.bis) };
}

/** Sessions in the start folders that began inside the window and are not listed. */
function weitereStarts(konf: Konfiguration, e: Einsatz, bekannt: Set<string>): Transkript[] {
  const out: Transkript[] = [];
  const f = fensterVon(e);
  for (const [konto, dir] of Object.entries(konf.konten)) {
    for (const ordner of e.startOrdner ?? []) {
      const p = join(pfadAus(dir), 'projects', ordner);
      if (!existsSync(p)) continue;
      for (const n of readdirSync(p).filter((x) => x.endsWith('.jsonl'))) {
        const datei = join(p, n);
        if (bekannt.has(resolve(datei)) || (e.ausschliessen ?? []).some((x) => n.startsWith(x))) continue;
        const eintraege = leseDatei(datei);
        const start = eintraege.length ? eintraege[0].zeit : statSync(datei).mtimeMs;
        if (start < f.von || start > f.bis) continue;
        out.push({ ref: { konto, id: n.slice(0, 8) }, pfad: datei, eintraege });
      }
    }
  }
  return out;
}

function prs(u: Umgebung, e: Einsatz): { liste: PullRequest[]; fehler?: string } {
  const r = u.aufrufer('gh', ['pr', 'list', '--repo', e.repo, '--state', 'merged', '--limit', '200', '--json', 'number,createdAt,mergedAt']);
  if (r.code) return { liste: [], fehler: `gh pr list: ${r.stderr.trim().slice(0, 200)}` };
  return { liste: JSON.parse(r.stdout) as PullRequest[] };
}

function weighted(u: Umgebung, t: Transkript, f: Fenster): number | null {
  const args = ['-Transcript', t.pfad, '-Since', new Date(f.von).toISOString(), '-Until', new Date(f.bis).toISOString()];
  const r = pwshJson(u.aufrufer, u.usageSkript, args);
  // only the session itself: its subagents (Lauf-Agenten, implementers) are not orchestration
  const j = r.json as { roles?: { role: string; weighted: number }[] } | null;
  if (r.code || !j) return null;
  return Number(j.roles?.find((x) => x.role === 'host')?.weighted ?? 0);
}

interface Reste {
  worktrees: number | null;
  branches: number | null;
  container: number | null;
  hinweise: string[];
}

function reste(u: Umgebung, e: Einsatz): Reste {
  const hinweise: string[] = [];
  let worktrees: number | null = null;
  if (e.repoPfad) {
    const r = u.aufrufer('git', ['-C', e.repoPfad, 'worktree', 'list', '--porcelain']);
    if (!r.code) worktrees = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).length - 1;
    else hinweise.push('git worktree list fehlgeschlagen');
  }
  let branches: number | null = null;
  const repo = u.aufrufer('gh', ['api', `repos/${e.repo}`, '--jq', '.default_branch']);
  const list = u.aufrufer('gh', ['api', '--paginate', `repos/${e.repo}/branches`, '--jq', '.[].name']);
  if (!repo.code && !list.code) {
    const basis = repo.stdout.trim();
    branches = 0;
    for (const b of list.stdout.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && x !== basis)) {
      const c = u.aufrufer('gh', ['api', `repos/${e.repo}/compare/${basis}...${encodeURIComponent(b)}`, '--jq', '.ahead_by']);
      if (!c.code && Number(c.stdout.trim()) > 0) branches++;
    }
  } else hinweise.push('Branches über gh nicht lesbar');
  let container: number | null = null;
  const name = e.repo.split('/')[1];
  const d = u.aufrufer('docker', ['ps', '-a', '--format', '{{.Names}}']);
  if (!d.code) container = d.stdout.split(/\r?\n/).filter((n) => n.includes(name) && /epic|agent|wt|-\d+-/.test(n)).length;
  else hinweise.push('docker nicht erreichbar');
  return { worktrees, branches, container, hinweise };
}

export function messeEinsatz(konf: Konfiguration, e: Einsatz, u: Umgebung) {
  const fehler: string[] = [];
  const f = fensterVon(e);
  const orchestrierung = e.orchestrierung.flatMap((r) => ladeRef(konf, r, fehler));
  const gelistet = e.laeufe.flatMap((r) => ladeRef(konf, r, fehler));
  const bekannt = new Set([...orchestrierung, ...gelistet].map((t) => resolve(t.pfad)));
  const extra = weitereStarts(konf, e, bekannt);
  const laeufe = e.laeufeAusOrdnern ? [...gelistet, ...extra] : gelistet;

  // 1, 2: questions to a person and the wait for the answer (orchestrators and runs alike)
  const fragen: Rueckfrage[] = [];
  for (const t of [...orchestrierung, ...laeufe]) fragen.push(...rueckfragen(t.eintraege, e.epics, fensterVon(e, t.ref)));
  const zustand = e.treiberZustand ? (JSON.parse(readFileSync(pfadAus(e.treiberZustand), 'utf8')) as TreiberZustand) : null;
  const treiber = zustand ? treiberKennzahlen(zustand, f) : null;
  if (treiber) fragen.push(...treiber.fragen);
  const mitUrteil = fragen.filter((q) => q.gefolgt !== null);
  const jeEpic: Record<string, { anzahl: number; wartenMin: number }> = {};
  for (const q of fragen) {
    const k = q.epic === null ? 'ohne_epic' : `#${q.epic}`;
    jeEpic[k] ??= { anzahl: 0, wartenMin: 0 };
    jeEpic[k].anzahl++;
    jeEpic[k].wartenMin = runde(jeEpic[k].wartenMin + (q.wartenMin ?? 0));
  }

  // 3: cold time of the runs
  const kalt = treiber
    ? treiber.kalt.map((k) => ({ sitzung: `treiber/#${k.epic}`, minuten: runde(k.minuten) }))
    : laeufe.map((t) => ({ sitzung: `${t.ref.konto}/${basename(t.pfad, '.jsonl').slice(0, 14)}`, minuten: runde(kalteZeit(t.eintraege, fensterVon(e, t.ref))) }));

  // 4: misses per start
  const starts = e.laeufeAusOrdnern ? laeufe.filter((t) => !t.ref.agentType) : [...laeufe.filter((t) => !t.ref.agentType), ...extra];
  const fehlstarts = starts.filter((t) => istFehlstart(t.eintraege));

  // 5: ready to merged
  const p = prs(u, e);
  if (p.fehler) fehler.push(p.fehler);
  const dauern = prDauern(p.liste, laeufe.map((t) => t.eintraege), f);

  // 6: orchestration weighted per epic
  const gewichte = orchestrierung.map((t) => ({ sitzung: `${t.ref.konto}/${basename(t.pfad, '.jsonl').slice(0, 14)}`, weighted: weighted(u, t, fensterVon(e, t.ref)) }));
  const summe = gewichte.reduce((s, g) => s + (g.weighted ?? 0), 0);
  if (gewichte.some((g) => g.weighted === null)) fehler.push('usage.ps1 lieferte nicht für jede Orchestrierungs-Sitzung einen Wert');

  return {
    name: e.name,
    repo: e.repo,
    fenster: { von: e.von, bis: e.bis },
    epics: e.epics,
    quelle: e.quelle ?? null,
    sitzungen: { orchestrierung: orchestrierung.length, laeufe: laeufe.length },
    rueckfragen: {
      anzahl: fragen.length,
      je_epic: e.epics.length ? runde(fragen.length / e.epics.length) : null,
      verteilung_epics: jeEpic,
      form: { ask: fragen.filter((q) => q.form === 'ask').length, text: fragen.filter((q) => q.form === 'text').length, treiber: fragen.filter((q) => q.form === 'treiber').length },
      entscheidungen_admiral: treiber?.entscheidungen ?? null,
      empfehlung_gefolgt: { beurteilbar: mitUrteil.length, gefolgt: mitUrteil.filter((q) => q.gefolgt).length },
      methode: 'AskUserQuestion mit Antwort und Empfehlungslabel; Textrunden je ❓ ohne Urteil über die Empfehlung; unter dem Treiber seine Fragen an den Menschen aus zustand.json',
    },
    wartezeit_min: { ...verteilung(fragen.map((q) => q.wartenMin).filter((x): x is number => x !== null)), je_epic: e.epics.length ? runde(fragen.reduce((s, q) => s + (q.wartenMin ?? 0), 0) / e.epics.length) : null },
    kalte_zeit_min: { summe: runde(kalt.reduce((s, k) => s + k.minuten, 0)), je_lauf: kalt, methode: treiber ? 'Treiber: „Zug zu Ende" bis zum nächsten Start des Epics, ohne das Warten auf den Menschen dazwischen, ab 2 min' : 'Zugende ohne eigene Hintergrundarbeit bis zur nächsten Eingabe von außen, ab 2 min; Warten nach dem letzten Zug nicht gezählt' },
    fehlstarts: treiber
      ? { starts: treiber.starts, fehlstarts: treiber.fehlstarts, anteil: treiber.starts ? runde(treiber.fehlstarts / treiber.starts) : null, sitzungen: [], methode: 'Treiber: Starts und Fortsetzungen; Fehlstart = „Start ohne Ergebnis"' }
      : { starts: starts.length, fehlstarts: fehlstarts.length, anteil: starts.length ? runde(fehlstarts.length / starts.length) : null, sitzungen: fehlstarts.map((t) => `${t.ref.konto}/${t.ref.id}`), methode: 'keine Antwort des Modells in den ersten 3 min; Lauf-Agenten zählen nicht als Start' },
    pr_bereit_bis_gemergt_min: { ...verteilung(dauern.map((d) => d.minuten)), geschaetzt: dauern.filter((d) => d.geschaetzt).length, prs: dauern.map((d) => ({ pr: d.pr, minuten: runde(d.minuten), geschaetzt: d.geschaetzt })) },
    orchestrierung: { weighted: Math.round(summe), je_epic: e.epics.length ? Math.round(summe / e.epics.length) : null, sitzungen: gewichte, methode: 'usage.ps1 ohne Modellgewichte, im Fenster der Sitzung' },
    tokens: tokenKennzahlen(laeufe.flatMap((t) => agentLaeufe(t, e))),
    verlauf: zustand ? epicVerlauf(zustand, f) : null,
    reste: reste(u, e),
    prognose: prognoseKennzahlen(e),
    fehler,
  };
}

/** A run session with its subagents; a listed subagent (agentType, e.g. epic-lauf) alone, under its type. */
function agentLaeufe(t: Transkript, e: Einsatz): AgentLauf[] {
  const f = fensterVon(e, t.ref);
  if (!t.ref.agentType) return ladeSitzung(t.pfad, f, e.epics);
  return ladeSitzung(t.pfad, f, e.epics, t.ref.agentType).slice(0, 1);
}

/**
 * The records of the forecast next to the driver state (messungen.jsonl, per repository, across
 * deployments): how many, work time per epic without waits for the person, the hit rate of the
 * self check, and whether the bridge shows the forecast.
 */
function prognoseKennzahlen(e: Einsatz): unknown {
  if (!e.treiberZustand) return null;
  const m = liesMessungen(dirname(pfadAus(e.treiberZustand)));
  let ab = 5;
  try {
    if (e.repoPfad) ab = adapterAus(e.repoPfad).prognose_ab;
  } catch {
    ab = 5;
  }
  const st = prognoseStand(m, ab);
  return {
    ...st,
    arbeit_min: verteilung(m.map((x) => x.arbeitS / 60)),
    mensch_warten_min: verteilung(m.map((x) => x.menschWartenS / 60)),
    gate_min: verteilung(m.map((x) => x.gateS / 60)),
    pakete_je_klasse: m.flatMap((x) => x.pakete).reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.klasse]: (acc[p.klasse] ?? 0) + 1 }), {}),
    eskalationen: m.flatMap((x) => x.pakete).reduce((s, p) => s + p.eskalationen, 0),
    methode: 'messungen.jsonl des Treibers: Arbeitszeit = erster Start bis letztes FLOTTE-ENDE ohne die Zeit, in der der ganze Lauf auf den Menschen wartete; Treffer = Dauer samt Gate zwischen P10 und P90 der Prognose beim Start',
  };
}

export function messen(argv: string[], u: Umgebung = standardUmgebung()): unknown {
  const datei = argv.find((a) => !a.startsWith('--'));
  if (!datei) throw new Error('Aufruf: flotte messen <einsaetze.json> [--name <einsatz>]');
  const konf = JSON.parse(readFileSync(datei, 'utf8')) as Konfiguration;
  const i = argv.indexOf('--name');
  const name = i >= 0 ? argv[i + 1] : null;
  const auswahl = konf.einsaetze.filter((e) => !name || e.name === name);
  return { gemessen: new Date().toISOString(), einsaetze: auswahl.map((e) => messeEinsatz(konf, e, u)) };
}

export function standardUmgebung(): Umgebung {
  const hier = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  return { aufrufer: aufrufen, usageSkript: resolve(hier, '../../../epic/scripts/usage.ps1') };
}
