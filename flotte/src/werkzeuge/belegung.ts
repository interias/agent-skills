// flotte belegung <repo> <owner/name> #a #b ... [--laufend #x,#y] [--gemergt #z] [--obergrenze 4]
// Collision levels and order edges (flotte/references/belegung.md) from the adapter and the issues,
// and the occupancy: the largest set of epics in which every pair keeps the limit of its level.
// The levels are a draft in the skill; in doubt this takes the higher one and names the evidence.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { type ForgeZugriff, type Issue, zugriffFuer } from '../forge/zugriff.ts';
import { mergeVorschlag } from '../treiber/admiral.ts';

export type Kollision = 'keine' | 'klein' | 'mittel' | 'gross';

/** at most this many epics at once when the worst pair has this level; 'klein' takes 3 of "3–4" */
export const GRENZE: Record<Kollision, number> = { keine: 4, klein: 3, mittel: 2, gross: 1 };
const RANG: Record<Kollision, number> = { keine: 0, klein: 1, mittel: 2, gross: 3 };

export interface EpicBild {
  nr: number;
  module: string[];
  dateien: string[];
  exklusiv: boolean;
  migration: boolean;
  /** epics that must be merged before this one starts */
  nach: number[];
  /** prio_label on the epic or one of its children: goes into the next occupancy first */
  prio?: boolean;
  /** child tickets of the epic (its checklist and Kinder: list), for the package bar of the bridge */
  kinder?: number[];
  /** #112: why a person should look at the merge (the content touches BEIM_MENSCHEN); missing without a hit */
  mergeVorschlag?: string;
}

export interface Adapter {
  exclusive_paths: string[];
  always_collide: string[];
  modules_section: string;
  epic_label: string;
  /** release label: without --epics the driver takes the open epics that carry it, or one of whose children does */
  ready_label: string;
  /** priority label (default prio/hoch): a startable epic with it goes into the next occupancy first */
  prio_label: string;
  /** finished epics measured by the driver before the bridge shows a forecast */
  prognose_ab: number;
  /** the folder of the prototypes, relative to the repository root (Holodeck, #44) */
  prototype_dir: string;
  /** places at once, at most 3: `window`, else 3 with test_isolation_env or isolation: none-needed, else 1 (references/adapter.md) */
  window: number;
  /** the base of the epic PRs (from-issue: per epic); null: main_branch, else the default branch */
  base_branch: string | null;
  main_branch: string | null;
  /** who merges (references/adapter.md, "Andocken"): only nach_gate lets the driver call merge.ps1 */
  merge: 'mensch' | 'nach_gate';
  /** commands after a merge, run in the main checkout (#14, stage 3) */
  nach_merge: string[];
  /** the collecting issue of the learning loop (Sparpaket, package 6); null: the loop only prints */
  lern_issue: number | null;
  /** the merge gate of the project, run by the driver in the epic worktree (#14, round 5); null: the run does it */
  gate_command: string | null;
  gate_heading: string | null;
  gate_green: string | null;
  gate_base: string | null;
  gate_head: string | null;
  /** a regular expression on a context line of the gate block: that context came from the gate's cache */
  gate_cached: string | null;
  /** abolished keys the adapter still names (ABGESCHAFFT): they act no more, the driver says so once */
  abgeschafft: string[];
}

/** Keys of the partial gate run, abolished: the head of the merge queue always runs gate_command. */
export const ABGESCHAFFT = ['gate_areas', 'gate_always_command', 'gate_partial'];

export interface Paar {
  a: number;
  b: number;
  stufe: Kollision;
  beleg: string;
}

/** Flat keys of the YAML frontmatter, as the scripts of epic/ read it (references/adapter.md, "Form"). */
export function liesAdapter(text: string): Adapter {
  const werte = frontmatter(text);
  return {
    exclusive_paths: werte.get('exclusive_paths') ?? ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'uv.lock', 'poetry.lock', 'migrations/'],
    always_collide: werte.get('always_collide') ?? [],
    modules_section: werte.get('modules_section')?.[0] ?? '## Betroffene Module',
    epic_label: werte.get('epic_label')?.[0] ?? 'epic',
    ready_label: werte.get('ready_label')?.[0] ?? 'ready-for-agent',
    prio_label: werte.get('prio_label')?.[0] ?? 'prio/hoch',
    prognose_ab: Math.max(1, Number(werte.get('prognose_ab')?.[0]) || 5),
    prototype_dir: werte.get('prototype_dir')?.[0] ?? 'prototypen/',
    window: Math.min(3, Math.max(1, Math.round(Number(werte.get('window')?.[0])) || (werte.has('test_isolation_env') || werte.get('isolation')?.[0]?.startsWith('none-needed') ? 3 : 1))),
    base_branch: werte.get('base_branch')?.[0] ?? null,
    main_branch: werte.get('main_branch')?.[0] ?? null,
    merge: werte.get('merge')?.[0] === 'nach_gate' ? 'nach_gate' : 'mensch',
    nach_merge: werte.get('nach_merge') ?? [],
    lern_issue: Number(werte.get('lern_issue')?.[0]?.replace(/^#/, '')) > 0 ? Number(werte.get('lern_issue')![0].replace(/^#/, '')) : null,
    gate_command: werte.get('gate_command')?.[0] ?? null,
    gate_heading: werte.get('gate_heading')?.[0] ?? null,
    gate_green: werte.get('gate_green')?.[0] ?? null,
    gate_base: werte.get('gate_base')?.[0] ?? null,
    gate_head: werte.get('gate_head')?.[0] ?? null,
    gate_cached: werte.get('gate_cached')?.[0] ?? null,
    abgeschafft: ABGESCHAFFT.filter((k) => werte.has(k)),
  };
}

/** Every flat key of the frontmatter with its values: `key: value`, `key: [a, b]` or a list of `- item`. */
export function frontmatter(text: string): Map<string, string[]> {
  const werte = new Map<string, string[]>();
  const zeilen = text.split(/\r?\n/);
  if (zeilen[0]?.trim() === '---') {
    let liste: string | null = null;
    for (let i = 1; i < zeilen.length && zeilen[i].trim() !== '---'; i++) {
      const z = zeilen[i];
      const punkt = /^\s+-\s+(.*)$/.exec(z);
      if (punkt && liste) {
        werte.get(liste)!.push(punkt[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, ''));
        continue;
      }
      const m = /^([A-Za-z_]+):\s*(.*)$/.exec(z);
      if (!m) continue;
      liste = null;
      const v = m[2].replace(/\s+#.*$/, '').trim();
      if (!v) {
        liste = m[1];
        werte.set(m[1], []);
      } else if (v.startsWith('[')) werte.set(m[1], v.slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
      else werte.set(m[1], [v.replace(/^['"]|['"]$/g, '')]);
    }
  }
  return werte;
}

export function abschnitt(body: string, kopf: string): string {
  const zeilen = body.split(/\r?\n/);
  const i = zeilen.findIndex((z) => z.trim().toLowerCase() === kopf.trim().toLowerCase());
  if (i < 0) return '';
  const ebene = (/^(#+)/.exec(kopf.trim())?.[1] ?? '##').length;
  const out: string[] = [];
  for (const z of zeilen.slice(i + 1)) {
    const h = /^(#+)\s/.exec(z);
    if (h && h[1].length <= ebene) break;
    out.push(z);
  }
  return out.join('\n');
}

const PFAD = /`([^`\s]+\/[^`\s]*|[^`\s]+\.[a-z0-9]{1,6})`/gi;

/** What an epic touches, from its body and the bodies of its children. */
export function bildAus(nr: number, bodies: string[], adapter: Adapter, epicNummern: number[], prio = false): EpicBild {
  const module = new Set<string>();
  const dateien = new Set<string>();
  let exklusiv = false;
  let migration = false;
  const nach = new Set<number>();
  bodies.forEach((body, i) => {
    const mod = abschnitt(body, adapter.modules_section);
    for (const z of mod.split(/\r?\n/)) {
      if (/^\s*[-*]\s+\[[ xX]\]/.test(z)) continue; // a child checklist, not a module
      const m = /^\s*[-*]\s+`?([^`—–:(]+?)`?(?:\s*[—–:(]|$)/.exec(z);
      if (m && m[1].trim()) module.add(m[1].trim().toLowerCase());
    }
    if (/\bExklusiv\b/.test(mod)) exklusiv = true;
    for (const m of body.matchAll(PFAD)) dateien.add(m[1].replace(/^\.\//, ''));
    if (/\bmigration/i.test(mod) || /\bSchema-Migration\b/i.test(body)) migration = true;
    if (i === 0) {
      // order edges: the header line, ## Blocked by; only edges to other epics of this deployment
      const kopf = /^>\s*\*\*Reihenfolge:\*\*(.*)$/m.exec(body)?.[1] ?? '';
      const ohneKinder = kopf.replace(/Kinder:\s*(#\d+[\s,]*)+/g, '');
      for (const m of ohneKinder.matchAll(/#(\d+)/g)) nach.add(Number(m[1]));
      for (const m of abschnitt(body, '## Blocked by').matchAll(/#(\d+)/g)) nach.add(Number(m[1]));
    }
  });
  for (const d of dateien) if (/(^|\/)migrations?\//i.test(d)) migration = true;
  const bild: EpicBild = { nr, module: [...module].sort(), dateien: [...dateien].sort(), exklusiv, migration, nach: [...nach].filter((n) => n !== nr && epicNummern.includes(n)).sort((a, b) => a - b) };
  if (prio) bild.prio = true;
  return bild;
}

const trifft = (datei: string, muster: string) => datei === muster || datei.startsWith(muster.endsWith('/') ? muster : `${muster}/`) || datei.endsWith(`/${muster}`);
const mechanisch = (d: string, adapter: Adapter) => adapter.always_collide.some((m) => trifft(d, m)) || /\.(md|txt)$/i.test(d);

export function kollision(a: EpicBild, b: EpicBild, adapter: Adapter): Paar {
  const p = (stufe: Kollision, beleg: string): Paar => ({ a: a.nr, b: b.nr, stufe, beleg });
  if (a.exklusiv || b.exklusiv) return p('gross', `Exklusiv in #${a.exklusiv ? a.nr : b.nr}`);
  if (a.migration && b.migration) return p('gross', 'Schema-Migration in beiden');
  const gemeinsam = a.dateien.filter((d) => b.dateien.includes(d));
  const echt = gemeinsam.filter((d) => !mechanisch(d, adapter));
  if (echt.length) return p('gross', `dieselben Dateien: ${echt.slice(0, 5).join(', ')}`);
  const exkl = [...a.dateien, ...b.dateien].filter((d) => adapter.exclusive_paths.some((m) => trifft(d, m)));
  if (exkl.length) return p('mittel', `exclusive_paths: ${[...new Set(exkl)].slice(0, 5).join(', ')}`);
  const module = a.module.filter((m) => b.module.includes(m));
  if (module.length) return p('mittel', `dasselbe Modul: ${module.join(', ')}`);
  if (gemeinsam.length) return p('klein', `nur mechanische Dateien: ${gemeinsam.slice(0, 5).join(', ')}`);
  return p('keine', 'keine gemeinsamen Module oder Dateien');
}

export interface Plan {
  paare: Paar[];
  startbereit: number[];
  wartend: { nr: number; wartetAuf: number[] }[];
  belegung: number[];
  neu: number[];
  /** startable epics with the priority label: started now, or why they wait */
  vorrang: { nr: number; startet: boolean; grund: string }[];
  /** #144: startable epics without the priority label left out of this occupancy, and why */
  zurueck: { nr: number; grund: string }[];
  /** #150: running epics without a picture; each of their pairs counts as a large collision */
  ohneBild: number[];
}

/**
 * The occupancy: running epics stay; startable ones are those whose predecessors are merged.
 * Largest set in which the size keeps the limit of its worst pair, never more than the cap (at
 * most 4). Ties: the set that unblocks most other epics, then the smaller numbers. Before all of
 * that, the startable epics with the priority label: as many of them as fit. One that does not fit
 * because of a collision is not overtaken: nothing new starts that collides with it. Order edges and
 * levels stay as they are, running epics are never stopped.
 */
export function belege(bilder: EpicBild[], adapter: Adapter, opts: { laufend: number[]; gemergt: number[]; obergrenze?: number; pausiert?: number[] }): Plan {
  const kappe = Math.min(4, opts.obergrenze ?? 4);
  const paare: Paar[] = [];
  for (let i = 0; i < bilder.length; i++) for (let j = i + 1; j < bilder.length; j++) paare.push(kollision(bilder[i], bilder[j], adapter));
  // #150: a running epic the collection missed has no picture: large with everything, never a crash
  const ohneBild = opts.laufend.filter((n) => !bilder.some((b) => b.nr === n));
  const alle = [...bilder.map((b) => b.nr), ...ohneBild];
  for (const n of ohneBild) for (const m of alle) if (m !== n && !paare.some((p) => (p.a === m && p.b === n) || (p.a === n && p.b === m))) paare.push({ a: m, b: n, stufe: 'gross', beleg: 'kein Bild der Mission: nicht eingesammelt' });
  const paar = (a: number, b: number) => paare.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))!;
  const stufe = (a: number, b: number) => paar(a, b).stufe;
  const offen = bilder.filter((b) => !opts.gemergt.includes(b.nr));
  const wartend = offen.filter((b) => !opts.laufend.includes(b.nr) && b.nach.some((n) => !opts.gemergt.includes(n))).map((b) => ({ nr: b.nr, wartetAuf: b.nach.filter((n) => !opts.gemergt.includes(n)) }));
  const startbereit = offen.filter((b) => !opts.laufend.includes(b.nr) && !wartend.some((w) => w.nr === b.nr)).map((b) => b.nr);
  const entsperrt = (nr: number) => bilder.filter((b) => b.nach.includes(nr)).length;
  const passt = (menge: number[]) => {
    let schlecht: Kollision = 'keine';
    for (let i = 0; i < menge.length; i++) for (let j = i + 1; j < menge.length; j++) {
      const s = stufe(menge[i], menge[j]);
      if (RANG[s] > RANG[schlecht]) schlecht = s;
    }
    return menge.length <= Math.min(kappe, GRENZE[schlecht]);
  };
  let beste: number[] = [...opts.laufend];
  const prio = new Set(bilder.filter((b) => b.prio).map((b) => b.nr));
  const wert = (m: number[]) => [m.filter((n) => prio.has(n)).length, m.length, m.reduce((s, n) => s + entsperrt(n), 0), -m.reduce((s, n) => s + n, 0)];
  const besser = (x: number[], y: number[]) => {
    const [a, b] = [wert(x), wert(y)];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  let kandidaten = [...startbereit].sort((a, b) => a - b);
  const suche = (start: number, menge: number[]) => {
    if (passt(menge) && besser(menge, beste)) beste = [...menge];
    if (menge.length >= kappe) return;
    for (let i = start; i < kandidaten.length; i++) suche(i + 1, [...menge, kandidaten[i]]);
  };
  // the running ones stay even when they break a limit (a brake lowered the cap); nothing joins them then
  if (passt(opts.laufend)) suche(0, [...opts.laufend]);
  // a priority epic left out because it collides: no new epic that collides with it overtakes it
  const draussen = startbereit.filter((n) => prio.has(n) && !beste.includes(n));
  const kollidiert = (a: number, b: number) => stufe(a, b) !== 'keine';
  if (draussen.length && passt(opts.laufend)) {
    kandidaten = kandidaten.filter((n) => prio.has(n) || !draussen.some((d) => kollidiert(n, d)));
    beste = [...opts.laufend];
    suche(0, [...opts.laufend]);
  }
  const vorrang = startbereit
    .filter((n) => prio.has(n))
    .sort((a, b) => a - b)
    .map((nr) => {
      if (beste.includes(nr)) return { nr, startet: true, grund: `${adapter.prio_label}: in dieser Belegung zuerst` };
      const mit = beste.filter((n) => n !== nr && kollidiert(n, nr)).map((n) => paar(n, nr));
      const grund = mit.length
        ? `${adapter.prio_label}, wartet: kollidiert mit ${mit.map((p) => `#${p.a === nr ? p.b : p.a} (${p.stufe}: ${p.beleg})`).join('; ')}; nichts Kollidierendes überholt`
        : `${adapter.prio_label}, wartet: die Plätze sind belegt (Obergrenze ${kappe})`;
      return { nr, startet: false, grund };
    });
  // #144: a collision that the set cannot take one more of names the epic it waits for; else the places are taken
  const grenze = (m: number[]) => (m.length > 1 ? Math.min(...m.flatMap((a, i) => m.slice(i + 1).map((b) => GRENZE[stufe(a, b)]))) : 4);
  const zurueck = startbereit
    .filter((n) => !prio.has(n) && !beste.includes(n))
    .sort((a, b) => a - b)
    .map((nr) => {
      const mit = beste.filter((n) => kollidiert(n, nr) && GRENZE[stufe(n, nr)] <= beste.length).map((n) => paar(n, nr));
      if (mit.length) return { nr, grund: `wartet auf ${mit.map((p) => `#${p.a === nr ? p.b : p.a}: Kollision ${p.stufe} (${p.beleg})`).join('; ')}` };
      const pausiert = beste.filter((n) => opts.pausiert?.includes(n)).length;
      return { nr, grund: `wartet auf einen freien Platz (${beste.length} von ${Math.min(kappe, grenze(beste))} belegt${pausiert ? `, davon ${pausiert} pausiert` : ''})` };
    });
  return { paare, startbereit, wartend, belegung: [...beste].sort((a, b) => a - b), neu: beste.filter((n) => !opts.laufend.includes(n)).sort((a, b) => a - b), vorrang, zurueck, ohneBild };
}

function liste(argv: string[], name: string): number[] {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? '').split(',').map((x) => Number(x.replace('#', ''))).filter((n) => n > 0) : [];
}

export function adapterAus(repo: string): Adapter {
  try {
    return liesAdapter(readFileSync(join(repo, '.claude', 'epic.md'), 'utf8'));
  } catch {
    return liesAdapter('');
  }
}

/** Children of an epic: its checklist lines and the Kinder: list of its header. */
export const kinderAus = (body: string) => [...new Set([...body.matchAll(/^\s*[-*]\s+\[[ xX]\]\s+#(\d+)/gm), ...(/Kinder:\s*((?:#\d+[\s,]*)+)/.exec(body)?.[1].matchAll(/#(\d+)/g) ?? [])].map((m) => Number(m[1])))];

/**
 * Without --epics (acceptance 3, decision B): the open issues with epic_label that carry ready_label
 * themselves or have an open child that does, as flotte/references/belegung.md collects them. An epic made
 * along the way waits for the person's label. ohneEpic: released issues that are no epic and no child
 * of one (a spec without epic_label waits silently otherwise; follow-up check of #27).
 */
export function freigegebene(z: ForgeZugriff, adapter: Adapter): { epics: number[]; ohneEpic: number[] } {
  const bereit = new Set(z.issues(adapter.ready_label, ['number']).map((i) => i.nummer));
  const alle = z.issues(adapter.epic_label, ['number', 'body']);
  const kinder = new Map(alle.map((e) => [e.nummer, kinderAus(e.body)]));
  const epics = alle.filter((e) => bereit.has(e.nummer) || kinder.get(e.nummer)!.some((k) => bereit.has(k))).map((e) => e.nummer);
  const erfasst = new Set([...alle.map((e) => e.nummer), ...[...kinder.values()].flat()]);
  return { epics: epics.sort((a, b) => a - b), ohneEpic: [...bereit].filter((n) => !erfasst.has(n)).sort((a, b) => a - b) };
}

export function sammle(z: ForgeZugriff, repo: string, nummern: number[]): { bilder: EpicBild[]; adapter: Adapter } {
  const adapter = adapterAus(repo);
  // the priority label on the epic or on one of its children
  const hatPrio = (labels: string[]) => labels.includes(adapter.prio_label);
  const bilder = nummern.map((nr) => {
    const j = z.issue(nr, ['body', 'labels', 'title']);
    const body = j.body;
    let prio = hatPrio(j.labels);
    // #112: title and body of the epic and of each child, for the merge proposal
    const texte = [{ nr, text: `${j.titel}\n${body}` }];
    const kinderBodies = kinderAus(body).map((k) => {
      let kj: Issue;
      try {
        kj = z.issue(k, ['body', 'labels', 'title']);
      } catch {
        return '';
      }
      prio ||= hatPrio(kj.labels);
      texte.push({ nr: k, text: `${kj.titel}\n${kj.body}` });
      return kj.body;
    });
    const bild = bildAus(nr, [body, ...kinderBodies], adapter, nummern, prio);
    const kinder = kinderAus(body);
    if (kinder.length) bild.kinder = kinder;
    const vorschlag = mergeVorschlag(texte);
    if (vorschlag) bild.mergeVorschlag = vorschlag;
    return bild;
  });
  return { bilder, adapter };
}

export function belegung(argv: string[], aufrufer: Aufrufer = aufrufen): unknown {
  const [repo, forgeRepo, ...rest] = argv;
  // the value after a switch (--obergrenze 3) is no epic
  const nummern = rest.filter((a, i) => /^#?\d+$/.test(a) && !rest[i - 1]?.startsWith('--')).map((a) => Number(a.replace('#', '')));
  if (!repo || !forgeRepo || !nummern.length) throw new Error('Aufruf: flotte belegung <repo> <owner/name> #a #b ... [--laufend #x,#y] [--gemergt #z] [--obergrenze 4]');
  const { bilder, adapter } = sammle(zugriffFuer(repo, aufrufer, forgeRepo), repo, nummern);
  const i = rest.indexOf('--obergrenze');
  return { bilder, ...belege(bilder, adapter, { laufend: liste(rest, '--laufend'), gemergt: liste(rest, '--gemergt'), obergrenze: i >= 0 ? Number(rest[i + 1]) : 4 }) };
}
