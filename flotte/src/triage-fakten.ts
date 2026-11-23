// #167: the facts nearly every decision of the triage needs, read by the program instead of the model: the
// ADRs (title, status), the adapter, the last merges, and the files the notes name (cut). The open missions with
// their children stand in the order of the cut plan already (only those a note may join).
// The model reads only when a fact is missing, at most lesenMax file accesses per call (setting triageLesenMax),
// held by --max-turns. One package per project and run; the cut plan and each learning proposal get the same.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Aufrufer } from './aufruf.ts';
import type { Ticket } from './triage.ts';

/** File accesses of the model per call when no setting says otherwise. */
export const LESEN_MAX = 15;
const ADAPTER_MAX = 3_000;
const DATEI_MAX = 4_000;
const DATEIEN_GESAMT = 40_000;
const DATEIEN_JE_NOTIZ = 5;
const MERGES = 15;

/** Title and status of each ADR under docs/adr, in the order of their numbers. */
export function adrListe(repo: string): string[] {
  const ordner = join(repo, 'docs', 'adr');
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner)
    .filter((d) => d.endsWith('.md'))
    .sort()
    .map((d) => {
      const text = readFileSync(join(ordner, d), 'utf8');
      const titel = /^#\s+(.+)$/m.exec(text)?.[1].trim() ?? d;
      const status = /^\*\*Status:\*\*\s*(.+)$/m.exec(text)?.[1].trim() ?? 'ohne Status';
      return `- ${titel} (${status}; docs/adr/${d})`;
    });
}

/** Repository paths a text names (with a directory and an extension), each once, in order. */
export function genannteDateien(text: string): string[] {
  return [...new Set([...text.matchAll(/(?<![\w./-])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+)(?![\w/])/g)].map((m) => m[1].replace(/^\.\//, '')))];
}

/** The first bytes of a file as text, without reading a large one whole. */
function anfang(datei: string, max: number): string {
  const fd = openSync(datei, 'r');
  try {
    const b = Buffer.alloc(max);
    return b.subarray(0, readSync(fd, b, 0, max, 0)).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** The files the notes name that exist in the repository, cut per file and in total. */
function dateien(repo: string, notizen: Ticket[]): string[] {
  const out: string[] = [];
  const gesehen = new Set<string>();
  let rest = DATEIEN_GESAMT;
  for (const t of notizen) {
    for (const p of genannteDateien(`${t.titel}\n${t.body}`).slice(0, DATEIEN_JE_NOTIZ)) {
      if (gesehen.has(p) || rest <= 0) continue;
      gesehen.add(p);
      const voll = resolve(repo, p);
      // only files inside the repository: a path with `..` never reads beyond it
      if (relative(resolve(repo), voll).startsWith('..') || !existsSync(voll) || !statSync(voll).isFile()) continue;
      const groesse = statSync(voll).size;
      const teil = anfang(voll, Math.min(DATEI_MAX, rest));
      rest -= teil.length;
      out.push(`### ${p} (genannt in #${t.nummer}${Buffer.byteLength(teil) < groesse ? `, gekürzt auf ${Buffer.byteLength(teil)} von ${groesse} Bytes` : ''})\n\`\`\`\n${teil}\n\`\`\``);
    }
  }
  return out;
}

/** The facts of one project for the orders of a triage run. A part the program cannot read says so. */
export function faktenpaket(repo: string, forge: string, a: Aufrufer, notizen: Ticket[]): string {
  const adr = adrListe(repo);
  const adapterDatei = join(repo, '.claude', 'epic.md');
  const adapter = existsSync(adapterDatei) ? readFileSync(adapterDatei, 'utf8').slice(0, ADAPTER_MAX) : '(kein Adapter)';
  const m = a('gh', ['pr', 'list', '--repo', forge, '--state', 'merged', '--limit', String(MERGES), '--json', 'number,title']);
  let merges = '(nicht lesbar)';
  try {
    if (!m.code) merges = (JSON.parse(m.stdout || '[]') as { number: number; title: string }[]).map((p) => `- #${p.number} ${p.title}`).join('\n') || '(keine)';
  } catch {
    // an answer that is no JSON stays unreadable
  }
  const genannt = dateien(repo, notizen);
  return `# Fakten (vom Programm gelesen)

## ADRs (docs/adr)
${adr.length ? adr.join('\n') : '(keine)'}

## Adapter (.claude/epic.md${adapter.length >= ADAPTER_MAX ? `, gekürzt auf ${ADAPTER_MAX} Zeichen` : ''})
\`\`\`
${adapter.trim()}
\`\`\`

## Zuletzt angedockt (höchstens ${MERGES} PRs)
${merges}

## Von den Notizen genannte Dateien
${genannt.length ? genannt.join('\n\n') : '(keine, oder keine im Repository)'}`;
}

/** The rule about reading in every order of the triage. */
export function lesenRegel(max: number): string {
  return `Die Fakten unten hat das Programm gelesen (ADRs, Adapter, zuletzt angedockte PRs, die genannten Dateien; die offenen Missionen, an die eine Notiz darf, stehen im Schnittplan). Lies nur, wenn ein Fakt fehlt, und höchstens ${max} Dateizugriffe (Read, Grep, Glob) in diesem Aufruf; danach antwortest du mit dem, was du hast.`;
}

/** --max-turns for a call with at most max file accesses: one turn per access, a few for the answer. */
export const maxTurns = (max: number) => String(max + 3);
