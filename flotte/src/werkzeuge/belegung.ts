// flotte belegung <repo> <owner/name> #a #b ... [--laufend #x,#y] [--gemergt #z] [--obergrenze 4]
// Collision levels and order edges (epic-flotte/SKILL.md, Phase 1) from the adapter and the issues,
// and the occupancy: the largest set of epics in which every pair keeps the limit of its level.
// The levels are a draft in the skill; in doubt this takes the higher one and names the evidence.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { bereicheAus, bereicheVon } from '../treiber/gate.ts';

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
  /** gate_areas of the files the epic names (#14, round 5); empty when it names none */
  bereiche?: string[];
}

export interface Adapter {
  exclusive_paths: string[];
  always_collide: string[];
  modules_section: string;
  epic_label: string;
  /** who merges (references/adapter.md, "Merge"): only nach_gate lets the driver call merge.ps1 */
  merge: 'mensch' | 'nach_gate';
  /** commands after a merge, run in the main checkout (#14, stage 3) */
  nach_merge: string[];
  /** the merge gate of the project, run by the driver in the epic worktree (#14, round 5); null: the run does it */
  gate_command: string | null;
  /** only the part of the gate that always runs (hexanite: wurzel) */
  gate_always_command: string | null;
  /** `<pattern> = <name>` per area of the gate */
  gate_areas: string[];
  gate_heading: string | null;
  gate_green: string | null;
  gate_base: string | null;
  gate_head: string | null;
  gate_partial: string | null;
}

export interface Paar {
  a: number;
  b: number;
  stufe: Kollision;
  beleg: string;
}

/** Flat keys of the YAML frontmatter, as the scripts of epic/ read it (references/adapter.md, "Form"). */
export function liesAdapter(text: string): Adapter {
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
  return {
    exclusive_paths: werte.get('exclusive_paths') ?? ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'uv.lock', 'poetry.lock', 'migrations/'],
    always_collide: werte.get('always_collide') ?? [],
    modules_section: werte.get('modules_section')?.[0] ?? '## Betroffene Module',
    epic_label: werte.get('epic_label')?.[0] ?? 'epic',
    merge: werte.get('merge')?.[0] === 'nach_gate' ? 'nach_gate' : 'mensch',
    nach_merge: werte.get('nach_merge') ?? [],
    gate_command: werte.get('gate_command')?.[0] ?? null,
    gate_always_command: werte.get('gate_always_command')?.[0] ?? null,
    gate_areas: werte.get('gate_areas') ?? [],
    gate_heading: werte.get('gate_heading')?.[0] ?? null,
    gate_green: werte.get('gate_green')?.[0] ?? null,
    gate_base: werte.get('gate_base')?.[0] ?? null,
    gate_head: werte.get('gate_head')?.[0] ?? null,
    gate_partial: werte.get('gate_partial')?.[0] ?? null,
  };
}

function abschnitt(body: string, kopf: string): string {
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
export function bildAus(nr: number, bodies: string[], adapter: Adapter, epicNummern: number[]): EpicBild {
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
  if (adapter.gate_areas.length) bild.bereiche = dateien.size ? [...bereicheVon([...dateien], bereicheAus(adapter.gate_areas))].sort() : [];
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
}

/**
 * The occupancy: running epics stay; startable ones are those whose predecessors are merged.
 * Largest set in which the size keeps the limit of its worst pair, never more than the cap (at
 * most 4). Ties: the set that unblocks most other epics, then the smaller numbers.
 */
export function belege(bilder: EpicBild[], adapter: Adapter, opts: { laufend: number[]; gemergt: number[]; obergrenze?: number }): Plan {
  const kappe = Math.min(4, opts.obergrenze ?? 4);
  const paare: Paar[] = [];
  for (let i = 0; i < bilder.length; i++) for (let j = i + 1; j < bilder.length; j++) paare.push(kollision(bilder[i], bilder[j], adapter));
  const stufe = (a: number, b: number) => paare.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))!.stufe;
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
  // on a tie, epics from different gate areas: after a merge the next one then often needs only the
  // part of the gate that always runs (#14, round 5)
  const bereich = new Map(bilder.map((b) => [b.nr, b.bereiche ?? []]));
  const geteilt = (m: number[]) => {
    let n = 0;
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) if (bereich.get(m[i])!.some((x) => bereich.get(m[j])!.includes(x))) n++;
    return n;
  };
  const wert = (m: number[]) => [m.length, m.reduce((s, n) => s + entsperrt(n), 0), -geteilt(m), -m.reduce((s, n) => s + n, 0)];
  const besser = (x: number[], y: number[]) => {
    const [a, b] = [wert(x), wert(y)];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  const kandidaten = [...startbereit].sort((a, b) => a - b);
  const suche = (start: number, menge: number[]) => {
    if (passt(menge) && besser(menge, beste)) beste = [...menge];
    if (menge.length >= kappe) return;
    for (let i = start; i < kandidaten.length; i++) suche(i + 1, [...menge, kandidaten[i]]);
  };
  // the running ones stay even when they break a limit (a brake lowered the cap); nothing joins them then
  if (passt(opts.laufend)) suche(0, [...opts.laufend]);
  return { paare, startbereit, wartend, belegung: [...beste].sort((a, b) => a - b), neu: beste.filter((n) => !opts.laufend.includes(n)).sort((a, b) => a - b) };
}

function liste(argv: string[], name: string): number[] {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? '').split(',').map((x) => Number(x.replace('#', ''))).filter((n) => n > 0) : [];
}

export function sammle(aufrufer: Aufrufer, repo: string, forgeRepo: string, nummern: number[]): { bilder: EpicBild[]; adapter: Adapter } {
  let adapterText = '';
  try {
    adapterText = readFileSync(join(repo, '.claude', 'epic.md'), 'utf8');
  } catch {
    /* defaults */
  }
  const adapter = liesAdapter(adapterText);
  const bilder = nummern.map((nr) => {
    const r = aufrufer('gh', ['issue', 'view', String(nr), '--repo', forgeRepo, '--json', 'body']);
    if (r.code) throw new Error(`gh issue view ${nr}: ${r.stderr.trim()}`);
    const body = String(JSON.parse(r.stdout).body ?? '');
    const kinder = [...body.matchAll(/^\s*[-*]\s+\[[ xX]\]\s+#(\d+)/gm), ...(/Kinder:\s*((?:#\d+[\s,]*)+)/.exec(body)?.[1].matchAll(/#(\d+)/g) ?? [])].map((m) => Number(m[1]));
    const kinderBodies = [...new Set(kinder)].map((k) => {
      const c = aufrufer('gh', ['issue', 'view', String(k), '--repo', forgeRepo, '--json', 'body']);
      return c.code ? '' : String(JSON.parse(c.stdout).body ?? '');
    });
    return bildAus(nr, [body, ...kinderBodies], adapter, nummern);
  });
  return { bilder, adapter };
}

export function belegung(argv: string[], aufrufer: Aufrufer = aufrufen): unknown {
  const [repo, forgeRepo, ...rest] = argv;
  // the value after a switch (--obergrenze 3) is no epic
  const nummern = rest.filter((a, i) => /^#?\d+$/.test(a) && !rest[i - 1]?.startsWith('--')).map((a) => Number(a.replace('#', '')));
  if (!repo || !forgeRepo || !nummern.length) throw new Error('Aufruf: flotte belegung <repo> <owner/name> #a #b ... [--laufend #x,#y] [--gemergt #z] [--obergrenze 4]');
  const { bilder, adapter } = sammle(aufrufer, repo, forgeRepo, nummern);
  const i = rest.indexOf('--obergrenze');
  return { bilder, ...belege(bilder, adapter, { laufend: liste(rest, '--laufend'), gemergt: liste(rest, '--gemergt'), obergrenze: i >= 0 ? Number(rest[i + 1]) : 4 }) };
}
