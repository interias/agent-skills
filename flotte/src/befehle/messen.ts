// flotte messen <einsaetze.json> [--name <einsatz>]
// Measures deployments from transcripts of both accounts, the forge and usage.ps1 (#14, "Messen").
// Prints one JSON object: per deployment the seven metrics, each with how it was measured.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { aufrufen, pwshJson, type Aufrufer } from '../aufruf.ts';
import { kopfdaten, leseDatei, type Eintrag } from '../transkript.ts';
import { aufrufLog, epicKennzahlen, epicSumme, epicVerlauf, istFehlstart, kalteNeustarts, kalteZeit,modellzeit, ORCHESTRIERUNG, paketMerges, prDauern, programmEreignisse, rolleAus, rueckfragen, runde, treiberKennzahlen, ungueltigeAusgaben, verteilung, type Arbeit, type Fenster, type ProgrammZustand, type PullRequest, type Rolle, type Rueckfrage, type TreiberZustand } from '../messen.ts';
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
  /** epic runs measured by role (#64); their sessions come from the driver logs next to treiberZustand and from `sitzungen` */
  epicLaeufe?: EpicLauf[];
  /** places of the window of the epic runs (adapter `window`), default 3 */
  fenster?: number;
  quelle?: string;
}

export interface EpicLauf {
  epic: number;
  /** hard predecessors per package for the window loss, e.g. { "60": ["59"] } */
  kanten?: Record<string, string[]>;
  /** further sessions of the run; rolle and paket for a session that is not an orchestrator (`flotte mission`: one `claude -p` per role) */
  sitzungen?: (SitzungRef & { rolle?: Rolle; paket?: string })[];
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

  // #211: turns after more than 60 min of silence, by what woke them
  const neustarts = laeufe
    .map((t) => {
      const fl = fensterVon(e, t.ref);
      return { sitzung: `${t.ref.konto}/${basename(t.pfad, '.jsonl').slice(0, 14)}`, ...kalteNeustarts(t.eintraege.filter((x) => x.zeit >= fl.von && x.zeit <= fl.bis)) };
    })
    .filter((k) => k.mensch + k.limit + k.eigen > 0);
  const summeAus = (k: 'mensch' | 'limit' | 'eigen') => neustarts.reduce((s, n) => s + n[k], 0);

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
    kalte_neustarts: { mensch: summeAus('mensch'), limit: summeAus('limit'), eigen: summeAus('eigen'), je_lauf: neustarts, methode: 'Zug des Modells nach über 60 min Stille, nach der Eingabe, die ihn weckte: Mensch oder Treiber (mensch), Limit im Text (limit), eigene Hintergrundarbeit oder Werkzeugergebnis (eigen); Stille nach dem letzten Eintrag nicht gezählt' },
    fehlstarts: treiber
      ? { starts: treiber.starts, fehlstarts: treiber.fehlstarts, anteil: treiber.starts ? runde(treiber.fehlstarts / treiber.starts) : null, sitzungen: [], methode: 'Treiber: Starts und Fortsetzungen; Fehlstart = „Start ohne Ergebnis"' }
      : { starts: starts.length, fehlstarts: fehlstarts.length, anteil: starts.length ? runde(fehlstarts.length / starts.length) : null, sitzungen: fehlstarts.map((t) => `${t.ref.konto}/${t.ref.id}`), methode: 'keine Antwort des Modells in den ersten 3 min; Lauf-Agenten zählen nicht als Start' },
    pr_bereit_bis_gemergt_min: { ...verteilung(dauern.map((d) => d.minuten)), geschaetzt: dauern.filter((d) => d.geschaetzt).length, prs: dauern.map((d) => ({ pr: d.pr, minuten: runde(d.minuten), geschaetzt: d.geschaetzt })) },
    orchestrierung: { weighted: Math.round(summe), je_epic: e.epics.length ? Math.round(summe / e.epics.length) : null, sitzungen: gewichte, methode: 'usage.ps1 ohne Modellgewichte, im Fenster der Sitzung' },
    tokens: tokenKennzahlen(laeufe.flatMap((t) => agentLaeufe(t, e))),
    verlauf: zustand ? epicVerlauf(zustand, f) : null,
    reste: reste(u, e),
    prognose: prognoseKennzahlen(e),
    epic_laeufe: e.epicLaeufe ? epicLaeufe(konf, e, u, fehler) : null,
    fehler,
  };
}

/** Model weights of the measurement of epic #69 (list prices): Opus twice Sonnet; Haiku a third of Sonnet (assumption, same ratio). */
export const MODELLGEWICHTE = 'opus=2;sonnet=1;haiku=0.33';

interface UsageZeile {
  id: string;
  role: string;
  package: string | null;
  weighted: number;
}

/** Session ids in the stream-json logs of the driver for one epic: <dir>/<unter>/<nr>-*.jsonl, from the init events. */
function sitzungenAusLogs(dir: string, unter: string, nr: number): { ids: string[]; texte: string[] } {
  const d = join(dir, unter);
  if (!existsSync(d)) return { ids: [], texte: [] };
  const texte = readdirSync(d)
    .filter((n) => n.startsWith(`${nr}-`) && n.endsWith('.jsonl'))
    .map((n) => readFileSync(join(d, n), 'utf8'));
  return { ids: [...new Set(texte.flatMap(initIds))], texte };
}

const initIds = (text: string) => [...text.matchAll(/"subtype":"init"[^\n]*?"session_id":"([\w-]+)"|"session_id":"([\w-]+)"[^\n]*?"subtype":"init"/g)].map((m) => m[1] ?? m[2]);

/**
 * The calls of `flotte mission` (#68): sessions from the init lines of <epic dir>/aufrufe/*.jsonl, role
 * and package from the file name. Cut and conflict are orchestration of the whole epic, so they
 * carry no package (as the conflicts the orchestrator of /mission solves itself).
 */
function sitzungenAusAufrufen(d: string): { refs: { id: string; rolle: Rolle; paket: string | null }[]; texte: string[] } {
  if (!existsSync(d)) return { refs: [], texte: [] };
  const refs: { id: string; rolle: Rolle; paket: string | null }[] = [];
  const texte: string[] = [];
  for (const n of readdirSync(d).sort()) {
    const log = aufrufLog(n);
    if (!log) continue;
    const text = readFileSync(join(d, n), 'utf8');
    texte.push(text);
    for (const id of new Set(initIds(text))) refs.push({ id, rolle: log.rolle, paket: ORCHESTRIERUNG.includes(log.rolle) ? null : log.paket });
  }
  return { refs, texte };
}

/** The transcript of a session in the named account, without a name in any account of the configuration. */
function findeSitzung(konf: Konfiguration, id: string, nur?: string): { konto: string; datei: string } | null {
  for (const [konto, dir] of Object.entries(konf.konten)) {
    if (nur && konto !== nur) continue;
    const datei = sitzungsdatei(pfadAus(dir), id);
    if (datei) return { konto, datei };
  }
  return null;
}

/**
 * One epic run split by role (#64): every session of the run with usage.ps1 (model weights), its
 * subagents by agentType; package merges and model time from the orchestrator transcripts; run time
 * from messungen.jsonl of the driver; restarts from its events. A run of `flotte mission` (#68) brings
 * its state next to the driver's (epics/<nr>/): its calls by role from the call logs; merges,
 * restarts, worker starts and invalid outputs from its events; the model time of the check from its
 * cut and conflict calls (the shell under the driver takes no part in it).
 */
function messeEpicLauf(konf: Konfiguration, e: Einsatz, lauf: EpicLauf, u: Umgebung, fehler: string[]) {
  const dir = e.treiberZustand ? dirname(pfadAus(e.treiberZustand)) : null;
  const ausLaeufen = dir ? sitzungenAusLogs(dir, 'laeufe', lauf.epic) : { ids: [], texte: [] };
  const ausAdmiral = dir ? sitzungenAusLogs(dir, 'admiral', lauf.epic) : { ids: [], texte: [] };
  const programmDir = dir ? join(dir, 'epics', String(lauf.epic)) : null;
  const pz = programmDir && existsSync(join(programmDir, 'zustand.json')) ? (JSON.parse(readFileSync(join(programmDir, 'zustand.json'), 'utf8')) as ProgrammZustand) : null;
  const ausAufrufen = pz && programmDir ? sitzungenAusAufrufen(join(programmDir, 'aufrufe')) : { refs: [], texte: [] };
  const alle: { id: string; konto?: string; rolle: Rolle | null; vorgabe: Rolle; paket: string | null }[] = [
    ...ausLaeufen.ids.map((id) => ({ id, rolle: null, vorgabe: 'orchestrator' as Rolle, paket: null })),
    ...ausAdmiral.ids.map((id) => ({ id, rolle: 'admiral' as Rolle, vorgabe: 'admiral' as Rolle, paket: null })),
    ...ausAufrufen.refs.map((r) => ({ ...r, vorgabe: r.rolle })),
    ...(lauf.sitzungen ?? []).map((s) => ({ id: s.id, konto: s.konto, rolle: s.rolle ?? null, vorgabe: 'orchestrator' as Rolle, paket: s.paket ?? null })),
  ];
  const refs = alle.filter((r, i) => alle.findIndex((x) => x.id === r.id) === i);

  const arbeiten: Arbeit[] = [];
  const orchestratoren: Eintrag[][] = [];
  const programmOrchestrierung: Eintrag[][] = [];
  const orchestrierungsDateien: string[] = [];
  const zeilen: Record<string, number> = {};
  for (const r of refs) {
    const gefunden = findeSitzung(konf, r.id, r.konto);
    if (!gefunden) {
      fehler.push(`Epic #${lauf.epic}: Sitzung ${r.id} nicht gefunden`);
      continue;
    }
    const kopf = kopfdaten(readFileSync(gefunden.datei, 'utf8'));
    const rolle = r.rolle ?? (kopf.agent ? rolleAus(kopf.agent) : r.vorgabe);
    const j = pwshJson(u.aufrufer, u.usageSkript, ['-Transcript', gefunden.datei, '-ModelWeights', MODELLGEWICHTE]).json as { agents?: UsageZeile[] } | null;
    if (!j?.agents) {
      fehler.push(`Epic #${lauf.epic}: usage.ps1 lieferte nichts für ${r.id}`);
      continue;
    }
    zeilen[rolle] = (zeilen[rolle] ?? 0) + 1;
    const sub = join(dirname(gefunden.datei), basename(gefunden.datei, '.jsonl'), 'subagents');
    for (const a of j.agents) {
      if (a.role === 'host') {
        arbeiten.push({ rolle, agentType: kopf.agent, paket: r.paket, start: kopf.von ?? 0, ende: kopf.bis ?? 0, weighted: Number(a.weighted) });
        continue;
      }
      const datei = join(sub, `agent-${a.id}.jsonl`);
      const k = existsSync(datei) ? kopfdaten(readFileSync(datei, 'utf8')) : { von: null, bis: null };
      arbeiten.push({ rolle: rolleAus(a.role), agentType: a.role, paket: a.package ?? null, start: k.von ?? 0, ende: k.bis ?? 0, weighted: Number(a.weighted) });
    }
    if (rolle === 'orchestrator') orchestratoren.push(leseDatei(gefunden.datei));
    if (rolle === 'schnitt' || rolle === 'konflikt') programmOrchestrierung.push(leseDatei(gefunden.datei));
    if (ORCHESTRIERUNG.includes(rolle)) orchestrierungsDateien.push(gefunden.datei);
  }

  const z = e.treiberZustand && existsSync(pfadAus(e.treiberZustand)) ? (JSON.parse(readFileSync(pfadAus(e.treiberZustand), 'utf8')) as TreiberZustand) : null;
  const starts = (z?.ereignisse ?? []).filter((x) => x.epic === lauf.epic && /^Lauf gestartet/.test(x.text)).map((x) => Date.parse(x.zeit)).sort((a, b) => a - b);
  const messung = dir ? liesMessungen(dir).filter((m) => m.epic === lauf.epic).at(-1) : undefined;

  const pe = pz ? programmEreignisse(pz) : null;
  const pruefer = pz ? programmOrchestrierung : orchestratoren;

  const k = epicKennzahlen({
    arbeiten,
    merges: pe ? pe.merges : orchestratoren.flatMap(paketMerges),
    fenster: e.fenster ?? 3,
    kanten: lauf.kanten,
    arbeitMs: messung ? messung.arbeitS * 1000 : null,
    modellzeit: pz || orchestratoren.length ? (von, bis) => pruefer.reduce((s, o) => s + modellzeit(o, von, bis), 0) : undefined,
    neustarts: [...starts.slice(1), ...(pe?.neustarts ?? [])].sort((a, b) => a - b),
    ...(pe ? { workerStarts: pe.workerStarts, neueAufrufe: pe.neueAufrufe } : {}),
  });
  // usage of the orchestration from a restart to its first worker: what the rebuild cost in model calls
  const neustart = {
    ...k.neustart,
    neustarts: k.neustart.neustarts.map((n) => {
      if (n.bis_erster_worker_s === null) return { ...n, verbrauch_bis_worker: null };
      const bis = new Date(Date.parse(n.zeit) + n.bis_erster_worker_s * 1000).toISOString();
      const w = orchestrierungsDateien.reduce((s, d) => {
        const j = pwshJson(u.aufrufer, u.usageSkript, ['-Transcript', d, '-ModelWeights', MODELLGEWICHTE, '-Since', n.zeit, '-Until', bis]).json as { agents?: UsageZeile[] } | null;
        return s + Number(j?.agents?.find((a) => a.role === 'host')?.weighted ?? 0);
      }, 0);
      return { ...n, verbrauch_bis_worker: Math.round(w) };
    }),
  };
  if (k.pakete.length && !k.pakete.some((p) => p.merges)) fehler.push(`Epic #${lauf.epic}: ${pz ? 'kein Ereignis gemergt im Programm' : 'kein Paket-Merge im Orchestrator'} gefunden; Merge-Zeiten, Prüfzeit und Fensterverlust ohne Merge`);
  return {
    epic: lauf.epic,
    sitzungen: zeilen,
    ...k,
    neustart,
    ungueltige_ausgaben: ungueltigeAusgaben([...ausAdmiral.texte, ...ausAufrufen.texte]),
    ...(pe ? { programm: { aufrufe: pe.aufrufe, ungueltig_ereignisse: pe.ungueltig } } : {}),
  };
}

function epicLaeufe(konf: Konfiguration, e: Einsatz, u: Umgebung, fehler: string[]) {
  const laeufe = (e.epicLaeufe ?? []).map((l) => messeEpicLauf(konf, e, l, u, fehler));
  return {
    laeufe,
    summe: epicSumme(laeufe),
    methode: `Sitzungen je Epic aus den Treiber-Logs (laeufe/, admiral/) und der Liste; Rolle: Subagent nach agentType, Sitzung nach agentSetting (claude -p --agent) oder Liste, sonst Orchestrator bzw. Admiral; Verbrauch usage.ps1 mit ${MODELLGEWICHTE}; Paket-Merge = git merge … agent/<nr> des Orchestrators; unter flotte mission Aufrufe aus epics/<nr>/aufrufe (Rolle aus dem Dateinamen, Schnitt und Konflikt als Orchestrierung), Merge = Ereignis gemergt, Neustart = Ereignis neustart bis zum nächsten Aufruf von Implementer oder Reviewer (auch --resume), Modellzeit der Prüfzeit aus Schnitt und Konflikt; Durchlauf = arbeitS aus messungen.jsonl; Fensterverlust ohne Kollisionskanten (obere Schranke)`,
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
  return { aufrufer: aufrufen, usageSkript: resolve(hier, '../../../mission/scripts/usage.ps1') };
}
