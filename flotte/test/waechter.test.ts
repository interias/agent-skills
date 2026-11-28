// Guard against old terms (#80, agent-skills/ADR-0003): skill texts, docs and the texts of the
// Brücke speak the vocabulary of CONTEXT.md ("Sprachraum"). Every hit is named with file, line and
// word, counted per top-level area. The test is meant to stay red until the rename is merged; it
// has no switch, no threshold and no skip. The word list and the exception list each stand in one
// place below; an exception without a reason does not belong there.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = fileURLToPath(new URL('../..', import.meta.url));

// ---- The word list --------------------------------------------------------------------------
// Each part of a word (split at hyphens) is checked; a part that starts with an old term hits, so
// compounds and inflection hit as well (Epic-Branch, Epics, Gate-Block, Merge-Konflikt, Reviewers,
// Mergekonflikt). Case matters only through the exceptions: a bare lowercase `epic` or `merge` is
// a label or key, `Epic` is a word.
const ALTBEGRIFFE: { wort: string; muster: RegExp }[] = [
  { wort: 'Epic', muster: /^epic/i },
  { wort: 'Epic', muster: /\p{Ll}epic/u }, // closed compound, e.g. Folgeepic
  { wort: 'Gate', muster: /^gate(?!keeper|way)/i }, // Gatekeeper, Gateway: English words without relation to the Andockprüfung
  { wort: 'Merge', muster: /^merge(?!l)/i }, // Mergel (marl) is German without relation
  { wort: 'Merge', muster: /^gemerg/i }, // gemergt, gemergte
  { wort: 'Merge', muster: /^merg(t|te|ten)$/i }, // er mergt, mergte
  { wort: 'Merge', muster: /[a-df-zäöüß]merge/u }, // Sofortmerge; not emerge, emergency
  { wort: 'Implementer', muster: /^implementer/i },
  { wort: 'Reviewer', muster: /^reviewer/i },
  { wort: 'Grilling', muster: /^grilling/i },
  // Case matters: the German noun is capitalised; lowercase `kind`/`kinder` are English or keys,
  // `KIND` is licence text. Not Kindprozess, Kindheit.
  { wort: 'Kind', muster: /^Kind(er|ern|es|s)?$/ }, // Kind-Ticket, Kinder, Kindern
  { wort: 'Kind', muster: /^Kind(er)?(ticket|issue|paket)/ }, // Kindticket, Kinderpakete
];
// Old skill and agent names and the old command, checked on the whole hyphenated word.
const ALTE_NAMEN: RegExp[] = [/^epic-nacharbeit$/, /^epic-aufraeumen$/, /^epic-implementer(-[\w-]+)?$/, /^epic-reviewer(-[\w-]+)?$/, /^epic-kundschafter$/];
// Also in compounds (/epic-Lauf); not in paths or old names (/epic-graph, /epic-nacharbeit).
const ALTER_BEFEHL = /(?<![\p{L}\p{N}_/.-])\/epic(?![\p{L}\p{N}_/]|-\p{Ll})/gu;

// ---- The exception list ---------------------------------------------------------------------
const AUSNAHMEN = {
  // Paths relative to the repository root that are not checked at all.
  pfade: [
    { muster: /^docs\/adr\//, grund: 'ADRs are history; ADR-0003 itself has to name the old terms' },
    { muster: /(^|\/)UMSTELLUNG\.md$/, grund: 'the migration guide (#82) names every old command, old → new' },
    { muster: /(^|\/)(node_modules|\.git)(\/|$)/, grund: 'not part of the repository texts' },
    { muster: /^flottenbruecke\/app\/static\/klartext\.json$/, grund: 'the term table of the Klartext display (#246, agent-skills/ADR-0008): the one file that carries the plain developer terms' },
  ],
  // Whole words (after splitting at spaces and punctuation, hyphens kept) that are technical names.
  woerter: [
    // labels
    { wort: 'epic', grund: 'label `epic`, also the folder, the skill and the branch prefix `epic/`' },
    // adapter keys from epic/references/adapter.md, all of them; only those starting with an old term could hit
    ...['forge', 'api', 'token_env', 'token_file', 'push_remote', 'forbidden_remotes', 'issue_offset', 'issue_form', 'ready_label', 'prognose_ab', 'prio_label', 'prototype_dir', 'skip_labels', 'epic_label', 'dependency_source', 'write_back_dependencies', 'transitive', 'acceptance_section', 'verification_section', 'modules_section', 'base_branch', 'main_branch', 'glossary', 'glossary_forbidden_marker', 'adr_dir', 'read_all_adrs', 'must_read', 'out_of_scope_dir', 'test_commands', 'known_red', 'lint_commands', 'writers', 'test_isolation_env', 'isolation', 'window', 'max_rounds', 'code_graph', 'min_package_class', 'exclusive_paths', 'always_collide', 'pre_commit_checks', 'worktree_root', 'env_files', 'link_dirs', 'always_link', 'port_env', 'shared_services', 'service_start', 'worktree_may_start', 'acceptance_commands', 'ram_warn_percent', 'ram_hold_percent', 'ram_min_free_gb', 'commit_style', 'commit_language', 'commit_umlauts', 'plan_artifact', 'gate_approvals', 'no_access', 'lern_issue', 'merge', 'gate_heading', 'gate_green', 'gate_base', 'gate_head', 'gate_command', 'gate_always_command', 'gate_areas', 'gate_partial'].map((wort) => ({ wort, grund: 'adapter key (ADR-0003: keys stay technical)' })),
    // step 8 of the gate rework: the night run
    { wort: 'gate_night_command', grund: 'adapter key (ADR-0003: keys stay technical)' },
    // step 7 of the gate rework: the cache statement of a context line
    { wort: 'gate_cached', grund: 'adapter key (ADR-0003: keys stay technical)' },
    // script and role names
    { wort: 'gate', grund: 'script name `gate.ps1`, CSS class' },
    { wort: 'implementer', grund: 'role key in the driver protocol' },
    { wort: 'reviewer', grund: 'role key in the driver protocol' },
    { wort: 'grilling', grund: 'name of the external skill `mattpocock-skills:grilling`' },
    // names of git and gh, quoted in the driver source
    { wort: 'merges', grund: 'git option `--merges`' },
    { wort: 'MERGE_HEAD', grund: 'git file `MERGE_HEAD`' },
    { wort: 'MERGED', grund: 'state of a pull request in the GitHub API' },
    { wort: 'mergedAt', grund: 'JSON field of `gh pr`' },
    { wort: 'mergeable', grund: 'JSON field of `gh pr`' },
    { wort: 'MERGEABLE', grund: 'value of the field `mergeable` of `gh pr`, kept by the forge layer for both forges (#127)' },
  ],
  // Spots inside a text that are not checked, cut out before matching.
  stellen: [
    { muster: /\bKinder:(?=\s*(?:#|\{\{))/g, grund: 'parser word of the header line `> **Reihenfolge:** Kinder: #a, #b` (`dependency_source: header`); it stays as long as missions carry it' },
    { muster: /### Was das Epic offen lässt/g, grund: 'fixed heading that runs write under FLOTTE-ENDE and the driver parses (werkzeuge/bloecke.ts); it stays as long as existing runs deliver it' },
    { muster: /--(epics|gemergt)\b/g, grund: 'options `--epics` of `flotte fahren` and `--gemergt` of `flotte belegung`' },
    { muster: /\bepics\//g, grund: 'folder `epics/` in the state of the driver' },
    { muster: /## Gate\b|\bGate grün\./g, grund: 'defaults of the adapter keys `gate_heading` and `gate_green`: what gate.ps1 prints and runs copy into the pull request; the driver reads them' },
    { muster: /\bGate ROT\./g, grund: 'the red closing line gate.ps1 prints; the night run reads it to take a gate block as complete' },
  ],
  // Parts of a file that are not checked.
  bereiche: [
    { art: 'markdown-code', grund: 'code identifiers: inline code (backticks) and code blocks (``` or ~~~) in Markdown' },
    { art: 'markdown-adresse', grund: 'link targets `](…)`, reference definitions and URLs are addresses, not text' },
    { art: 'quelltext', grund: 'in .py/.js/.ts/.css/.webmanifest only string literals are text; comments, docstrings (triple quotes) and code are not, nor a literal that is one lowercase identifier (key, class, state such as \'gemergt\')' },
    { art: 'html', grund: 'in .html/.svg only text between tags and the attributes title, alt, placeholder, aria-label, aria-description, content are text' },
  ],
  // Lines of CONTEXT.md that name the old terms to forbid them.
  zeilen: [
    { datei: 'CONTEXT.md', abschnitt: /^#+\s*Sprachraum/, zeile: /^\s*\|/, grund: 'the table "Sprachraum" maps new terms to the old ones' },
    { datei: 'CONTEXT.md', abschnitt: /./, zeile: /^\s*_Avoid_/, grund: 'the _Avoid_ lines forbid the old terms by name' },
  ],
};

// ---- Scope --------------------------------------------------------------------------------
// Every Markdown file of the repository, plus the texts of the Brücke a person sees and the string
// literals of the driver source flotte/src (#183: log book, events, forge comments, Tafel, the
// prompts it hands to runs) and the HTML sources of the pictures under assets/ (#183).
const BRUECKE = /^flottenbruecke\/app\/([^/]+\.py|static\/.+\.(html|js|css|svg|webmanifest|json))$/;
const TREIBER = /^flotte\/src\/.+\.ts$/;
const BILDER = /^assets\/.+\.html$/;

function dateien(): string[] {
  const out: string[] = [];
  const gehe = (ordner: string) => {
    for (const n of readdirSync(ordner)) {
      const voll = join(ordner, n);
      const rel = relative(WURZEL, voll).replace(/\\/g, '/');
      if (AUSNAHMEN.pfade.some((a) => a.muster.test(rel) || a.muster.test(`${rel}/`))) continue;
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (rel.endsWith('.md') || BRUECKE.test(rel) || TREIBER.test(rel) || BILDER.test(rel)) out.push(rel);
    }
  };
  gehe(WURZEL);
  return out.sort();
}

type Stueck = { zeile: number; text: string };

// ---- Splitting text from code -----------------------------------------------------------------
function markdown(datei: string, inhalt: string): Stueck[] {
  const out: Stueck[] = [];
  const regeln = AUSNAHMEN.zeilen.filter((r) => r.datei === datei);
  let zaun: string | null = null;
  let abschnitt = '';
  inhalt.split(/\r?\n/).forEach((zeile, i) => {
    const z = /^\s{0,3}(`{3,}|~{3,})/.exec(zeile);
    if (zaun) {
      if (z && z[1][0] === zaun[0] && z[1].length >= zaun.length && zeile.trim() === z[1]) zaun = null;
      return;
    }
    if (z) return void (zaun = z[1]);
    if (/^#/.test(zeile)) abschnitt = zeile;
    if (regeln.some((r) => r.abschnitt.test(abschnitt) && r.zeile.test(zeile))) return;
    const text = zeile
      .replace(/(`+)[^`][\s\S]*?\1/g, ' ')
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/^\s*\[[^\]]+\]:\s*\S+/, ' ')
      .replace(/<?https?:\/\/[^\s)>]+>?/g, ' ');
    out.push({ zeile: i + 1, text });
  });
  return out;
}

const bezeichner = (s: string) => /^[a-z][\w.-]*$/.test(s);

// String literals of JavaScript (template parts outside `${…}`, recursing into it) and Python.
function literale(inhalt: string, sprache: 'js' | 'py' | 'css'): Stueck[] {
  const out: Stueck[] = [];
  let i = 0;
  let zeile = 1;
  const weiter = (n: number) => {
    for (let k = 0; k < n; k++) if (inhalt[i + k] === '\n') zeile++;
    i += n;
  };
  const merke = (text: string, ab: number) => {
    if (bezeichner(text)) return;
    text.split('\n').forEach((t, k) => out.push({ zeile: ab + k, text: t }));
  };
  const einfach = (q: string) => {
    const ab = zeile;
    weiter(1);
    let text = '';
    while (i < inhalt.length && inhalt[i] !== q && inhalt[i] !== '\n') {
      if (inhalt[i] === '\\') { text += inhalt[i + 1] ?? ''; weiter(2); continue; }
      text += inhalt[i];
      weiter(1);
    }
    weiter(1);
    merke(text, ab);
  };
  const vorlage = () => {
    weiter(1);
    let ab = zeile;
    let text = '';
    while (i < inhalt.length && inhalt[i] !== '`') {
      if (inhalt[i] === '\\') { text += inhalt[i + 1] ?? ''; weiter(2); continue; }
      if (inhalt[i] === '$' && inhalt[i + 1] === '{') {
        merke(text, ab);
        weiter(2);
        code('}');
        weiter(1);
        ab = zeile;
        text = '';
        continue;
      }
      text += inhalt[i];
      weiter(1);
    }
    weiter(1);
    merke(text, ab);
  };
  // reads code up to an unmatched closing character (or the end)
  const code = (ende: string | null) => {
    let tiefe = 0;
    let letztes = '';
    while (i < inhalt.length) {
      const c = inhalt[i];
      const n = inhalt[i + 1];
      if (ende && c === ende && tiefe === 0) return;
      if (c === '{') tiefe++;
      if (c === '}') tiefe--;
      if (sprache === 'py' && c === '#') { while (i < inhalt.length && inhalt[i] !== '\n') weiter(1); continue; }
      if (sprache === 'js' && c === '/' && n === '/') { while (i < inhalt.length && inhalt[i] !== '\n') weiter(1); continue; }
      if (sprache !== 'py' && c === '/' && n === '*') { const e = inhalt.indexOf('*/', i + 2); weiter((e < 0 ? inhalt.length : e + 2) - i); continue; }
      if (sprache === 'py' && (inhalt.startsWith('"""', i) || inhalt.startsWith("'''", i))) {
        const q = inhalt.slice(i, i + 3);
        const e = inhalt.indexOf(q, i + 3);
        weiter((e < 0 ? inhalt.length : e + 3) - i);
        letztes = 'x';
        continue;
      }
      if (sprache === 'js' && c === '/' && /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(letztes)) {
        // regular expression literal
        weiter(1);
        let klasse = false;
        while (i < inhalt.length && inhalt[i] !== '\n' && (klasse || inhalt[i] !== '/')) {
          if (inhalt[i] === '\\') { weiter(2); continue; }
          if (inhalt[i] === '[') klasse = true;
          if (inhalt[i] === ']') klasse = false;
          weiter(1);
        }
        weiter(1);
        letztes = 'x';
        continue;
      }
      if (c === '"' || c === "'") { einfach(c); letztes = 'x'; continue; }
      if (sprache === 'js' && c === '`') { vorlage(); letztes = 'x'; continue; }
      if (!/\s/.test(c)) letztes = c;
      weiter(1);
    }
  };
  code(null);
  return out;
}

const HTML_ATTRIBUTE = /\s(?:title|alt|placeholder|aria-label|aria-description|content)\s*=\s*("[^"]*"|'[^']*')/gi;

function html(inhalt: string): Stueck[] {
  const out: Stueck[] = [];
  const nimm = (text: string, ab: number) => text.split('\n').forEach((t, k) => out.push({ zeile: ab + k, text: t }));
  const zeileBei = (pos: number) => inhalt.slice(0, pos).split('\n').length;
  const leer = (m: string) => m.replace(/[^\n]/g, ' ');
  const ohne = inhalt.replace(/<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1>/gi, leer);
  for (const m of ohne.matchAll(/<[^>]*>/g)) for (const a of m[0].matchAll(HTML_ATTRIBUTE)) nimm(a[1].slice(1, -1), zeileBei(m.index! + a.index!));
  nimm(ohne.replace(/<[^>]*>/g, leer), 1);
  return out;
}

function stuecke(datei: string, inhalt: string): Stueck[] {
  const endung = extname(datei);
  if (endung === '.md') return markdown(datei, inhalt);
  if (endung === '.html' || endung === '.svg') return html(inhalt);
  if (endung === '.py') return literale(inhalt, 'py');
  if (endung === '.css') return literale(inhalt, 'css');
  return literale(inhalt, 'js'); // .js, .webmanifest (JSON)
}

// ---- Matching ---------------------------------------------------------------------------------
const AUSGENOMMEN = new Set(AUSNAHMEN.woerter.map((w) => w.wort));

function treffer(roh: string): string[] {
  const out: string[] = [];
  const text = AUSNAHMEN.stellen.reduce((t, s) => t.replace(s.muster, ' '), roh);
  for (const m of text.matchAll(/[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*/gu)) {
    const wort = m[0];
    if (AUSGENOMMEN.has(wort)) continue;
    if (ALTE_NAMEN.some((r) => r.test(wort))) { out.push(wort); continue; }
    if (wort.split('-').some((teil) => !AUSGENOMMEN.has(teil) && ALTBEGRIFFE.some((a) => a.muster.test(teil)))) out.push(wort);
  }
  for (const m of text.matchAll(ALTER_BEFEHL)) out.push(m[0]);
  return out;
}

type Fund = { datei: string; zeile: number; wort: string };

function funde(): Fund[] {
  const out: Fund[] = [];
  for (const datei of dateien()) {
    const inhalt = readFileSync(join(WURZEL, datei), 'utf8');
    for (const s of stuecke(datei, inhalt)) for (const wort of treffer(s.text)) out.push({ datei, zeile: s.zeile, wort });
  }
  return out.sort((a, b) => a.datei.localeCompare(b.datei) || a.zeile - b.zeile);
}

const bereich = (datei: string) => datei.split('/')[0];

function bericht(f: Fund[]): string {
  if (!f.length) return 'keine Altbegriffe';
  const je: Record<string, number> = {};
  for (const x of f) je[bereich(x.datei)] = (je[bereich(x.datei)] ?? 0) + 1;
  const kopf = `${f.length} Altbegriffe; je Bereich: ${Object.entries(je).sort(([a], [b]) => a.localeCompare(b)).map(([b, n]) => `${b} ${n}`).join(', ')}`;
  return [kopf, ...f.map((x) => `${x.datei}:${x.zeile}: ${x.wort}`)].join('\n');
}

describe('Wächter gegen Altbegriffe', () => {
  it('hits old terms in compounds and inflection, and old skill names and the old command', () => {
    expect(treffer('Der Epic-Branch, zwei Epics, ein Gate-Block, ein Merge-Konflikt, die Reviewers, der Implementer.')).toEqual(['Epic-Branch', 'Epics', 'Gate-Block', 'Merge-Konflikt', 'Reviewers', 'Implementer']);
    expect(treffer('nach dem Grilling gemergt, ein Sofortmerge, ein Haupt-Epic')).toEqual(['Grilling', 'gemergt', 'Sofortmerge', 'Haupt-Epic']);
    expect(treffer('mit epic-nacharbeit, epic-aufraeumen, epic-implementer-urteil, epic-reviewer-standard, epic-kundschafter und /epic 83')).toEqual(['epic-nacharbeit', 'epic-aufraeumen', 'epic-implementer-urteil', 'epic-reviewer-standard', 'epic-kundschafter', '/epic']);
    expect(treffer('eines /epic-Laufs, /epic-nacharbeit, .git/epic-graph')).toEqual(['epic-nacharbeit', '/epic']);
    expect(treffer('ein Kind-Ticket, die Kinder, den Kindern, des Kindes, ein Kindticket')).toEqual(['Kind-Ticket', 'Kinder', 'Kindern', 'Kindes', 'Kindticket']);
  });

  it('leaves the parser word Kinder: and words that only start like Kind alone', () => {
    expect(treffer('> **Reihenfolge:** Kinder: #4, #5 und Kinder: {{kinder}}; ein Kindprozess, Kindheit, kind of, KIND, === kind a1')).toEqual([]);
    expect(treffer('die Kinder: alle')).toEqual(['Kinder']);
  });

  it('leaves names of git, gh and the command line alone', () => {
    expect(treffer("flotte fahren --epics 3,4; git log --merges; MERGE_HEAD; state MERGED; --json mergedAt,mergeable")).toEqual([]);
  });

  it('leaves words without relation, labels, adapter keys, paths and identifiers alone', () => {
    expect(treffer('Gatekeeper, Gateway, Mergel, emergency, istEpic, das Label epic, merge: mensch, gate_command, gate.ps1, Ordner epic/references, Branch epic/83-x, agent-skills/epic/SKILL.md')).toEqual([]);
  });

  it('skips code in Markdown, link targets, and the forbidding lines of CONTEXT.md', () => {
    const md = ['Ein `Epic` im Code.', '```', 'Epic im Block', '```', 'Siehe [Doku](epic-nacharbeit/README.md) und https://x.test/epic-nacharbeit', 'ein Epic im Text'].join('\n');
    expect(markdown('x.md', md).flatMap((s) => treffer(s.text).map((w) => `${s.zeile}: ${w}`))).toEqual(['6: Epic']);
    const ctx = ['### Sprachraum', '| **Mission** | ein Epic | `epic` |', '_Avoid_: Epic, Gate', '', '### Weiter', 'ein Epic'].join('\n');
    expect(markdown('CONTEXT.md', ctx).flatMap((s) => treffer(s.text).map((w) => `${s.zeile}: ${w}`))).toEqual(['6: Epic']);
  });

  it('checks only the visible text of the Brücke code', () => {
    const js = "// Epic im Kommentar\nconst a = { merge: 'Merge', art: 'gemergt' };\nconst b = `${n('gemergt')} gemergt`;\nconst r = /Epic/.test(x) / 2;";
    expect(literale(js, 'js').flatMap((s) => treffer(s.text).map((w) => `${s.zeile}: ${w}`))).toEqual(['2: Merge', '3: gemergt']);
    const py = "class Epic:\n    '''Epic docstring'''\n    x = 'gemergt'  # Merge\n    raise E(409, 'Das Epic ist weg.')";
    expect(literale(py, 'py').flatMap((s) => treffer(s.text).map((w) => `${s.zeile}: ${w}`))).toEqual(['4: Epic']);
    const h = '<div class="epic">\n<input aria-label="Suche: Epic" id="lb-epic">\n<script>const Epic = 1;</script>\n<p>Merge</p>';
    expect(html(h).flatMap((s) => treffer(s.text).map((w) => `${s.zeile}: ${w}`)).sort()).toEqual(['2: Epic', '4: Merge']);
  });

  it('checks the HTML sources of the pictures under assets/ (#183)', () => {
    expect(dateien().filter((d) => d.startsWith('assets/') && d.endsWith('.html'))).toContain('assets/readme/ablauf.html');
  });

  it('takes out the term table of the Klartext display and nothing else of the Brücke (#246)', () => {
    const tabelle = 'flottenbruecke/app/static/klartext.json';
    expect(BRUECKE.test(tabelle)).toBe(true);
    expect(dateien()).not.toContain(tabelle);
    // the table does carry the plain terms: without the exception the guard would hit it
    expect(literale(readFileSync(join(WURZEL, tabelle), 'utf8'), 'js').flatMap((s) => treffer(s.text)).length).toBeGreaterThan(0);
    expect(AUSNAHMEN.pfade.filter((a) => a.muster.source.startsWith('^flottenbruecke'))).toHaveLength(1);
  });

  it('every exception names its reason', () => {
    const alle = [...AUSNAHMEN.pfade, ...AUSNAHMEN.woerter, ...AUSNAHMEN.bereiche, ...AUSNAHMEN.zeilen, ...AUSNAHMEN.stellen];
    expect(alle.filter((a) => !a.grund)).toEqual([]);
  });

  // Red while an old term stands — on purpose, without skip or threshold.
  it('skill texts, docs, the Brücke, the driver and the pictures contain no old terms', () => {
    expect(bericht(funde())).toBe('keine Altbegriffe');
  });
});
