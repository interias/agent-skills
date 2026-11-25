// Counting for 4c (#69, decision 6): suites, tests and red tests from the output of the adapter's
// test_commands, lint findings per file from the output of lint_commands. Known formats are bun
// test, Pester (3 to 5), pytest and the summary of a context gate (hexanite, flotte-probe); any
// other output is an error, never a count of 0. Paths come
// back relative to the worktree with forward slashes, as `git diff --name-only` gives them, so the
// Lastflake rule can hold them against the files the package touched.

import { posix } from 'node:path';

export interface Gezaehlt {
  /** test files; null when the format does not report them (pytest -q with all green) */
  dateien: number | null;
  tests: number;
  rot: { datei: string; test: string }[];
}

/** `cd sub && …` (also `cd /d sub && …`): the folder the command's paths are relative to */
export function verzeichnisAus(befehl: string): string {
  const m = /^\s*cd\s+(?:\/d\s+)?(?:"([^"]+)"|([^\s&]+))\s*&&/i.exec(befehl);
  return m ? normal(m[1] ?? m[2]) : '';
}

function normal(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** a path from the output, relative to the worktree */
export function pfadIm(worktree: string, verzeichnis: string, p: string): string {
  const n = normal(p.trim());
  const wt = normal(worktree);
  if (/^[A-Za-z]:\//.test(n) || n.startsWith('/')) {
    return n.toLowerCase().startsWith(`${wt.toLowerCase()}/`) ? n.slice(wt.length + 1) : n;
  }
  return posix.normalize(verzeichnis ? `${verzeichnis}/${n}` : n);
}

const ohneDauer = (t: string) => t.replace(/\s+\[[\d.]+\s*m?s\]\s*$/, '').trim();

function bun(text: string, ort: (p: string) => string): Gezaehlt | null {
  const sum = /Ran (\d+) tests? across (\d+) files?/.exec(text);
  if (!sum) return null;
  const rot: Gezaehlt['rot'] = [];
  let datei = '';
  for (const zeile of text.split(/\r?\n/)) {
    const kopf = /^(?![\s(])(.+\.[cm]?[jt]sx?):\s*$/.exec(zeile);
    if (kopf) datei = ort(kopf[1]);
    const fail = /^\(fail\)\s+(.*)$/.exec(zeile);
    if (fail) rot.push({ datei, test: ohneDauer(fail[1]) });
  }
  const fails = Number(/^\s*(\d+) fail\s*$/m.exec(text)?.[1] ?? 0) + Number(/^\s*(\d+) errors?\s*$/m.exec(text)?.[1] ?? 0);
  for (let i = rot.length; i < fails; i++) rot.push({ datei, test: 'Fehler außerhalb eines Tests' });
  return { dateien: Number(sum[2]), tests: Number(sum[1]), rot };
}

function pester(text: string, befehl: string, ort: (p: string) => string): Gezaehlt | null {
  const p3 = /Passed:\s*(\d+)\s+Failed:\s*(\d+)(?:\s+Skipped:\s*(\d+))?(?:\s+Pending:\s*(\d+))?(?:\s+Inconclusive:\s*(\d+))?/.exec(text);
  const p5 = /Tests Passed:\s*(\d+),\s*Failed:\s*(\d+),\s*Skipped:\s*(\d+)(?:,?\s*NotRun:\s*(\d+))?/.exec(text);
  const sum = p5 ?? p3;
  if (!sum || !/Tests completed in/.test(text)) return null;
  const tests = sum.slice(1).reduce((n, x) => n + Number(x ?? 0), 0);
  const ausBefehl = [...befehl.matchAll(/([^\s"']+\.Tests\.ps1)/gi)].map((m) => ort(m[1]));
  const ausAusgabe = [...text.matchAll(/(?:Executing script|Running tests from)\s+'?([^'\r\n]+\.Tests\.ps1)/gi)].map((m) => ort(m[1]));
  const dateien = [...new Set(ausBefehl.length ? ausBefehl : ausAusgabe)];
  const rot: Gezaehlt['rot'] = [];
  let datei = dateien.length === 1 ? dateien[0] : '';
  for (const zeile of text.split(/\r?\n/)) {
    const kopf = /(?:Executing script|Running tests from)\s+'?([^'\r\n]+\.Tests\.ps1)/i.exec(zeile);
    if (kopf) datei = ort(kopf[1]);
    const fail = /^\s*\[-\]\s+(.+?)\s+[\d.]+\s*m?s\s*$/.exec(zeile);
    if (fail) rot.push({ datei, test: fail[1] });
  }
  for (let i = rot.length; i < Number(sum[2]); i++) rot.push({ datei, test: 'ohne Namen in der Ausgabe' });
  return { dateien: dateien.length || null, tests, rot };
}

function pytest(text: string, ort: (p: string) => string): Gezaehlt | null {
  const zeilen = text.split(/\r?\n/);
  const sum = [...zeilen].reverse().find((z) => /\bin [\d.]+s\b/.test(z) && /(\d+ (passed|failed|errors?|skipped|xfailed|xpassed)|no tests ran)/.test(z));
  if (!sum) return null;
  const zahl = (wort: string) => Number(new RegExp(`(\\d+) ${wort}\\b`).exec(sum)?.[1] ?? 0);
  const tests = zahl('passed') + zahl('failed') + zahl('errors?') + zahl('skipped') + zahl('xfailed') + zahl('xpassed');
  const rot: Gezaehlt['rot'] = [];
  const dateien = new Set<string>();
  for (const z of zeilen) {
    const f = /^(FAILED|ERROR)\s+([^\s:]+\.py)(?:::(\S+))?/.exec(z);
    if (f) rot.push({ datei: ort(f[2]), test: f[3] ?? 'Sammelfehler' });
    const fortschritt = /^(\S+\.py) [.FEsxX]+/.exec(z);
    if (fortschritt) dateien.add(ort(fortschritt[1]));
  }
  const fehlend = zahl('failed') + zahl('errors?') - rot.length;
  for (let i = 0; i < fehlend; i++) rot.push({ datei: '', test: 'ohne Namen in der Ausgabe' });
  return { dateien: dateien.size || null, tests, rot };
}

/**
 * A duration of a gate line in seconds: `m:ss`, `h:mm:ss` or `<n> s`. In `<n> s` a separator before
 * groups of three digits is a thousands separator (PowerShell's N0: `1.558 s` is 1558 s), otherwise a
 * decimal point. Anything else is null: nothing is guessed.
 */
export function dauerSekunden(text: string): number | null {
  const t = text.trim();
  const uhr = /^(?:(\d+):)?(\d+):(\d{2})$/.exec(t);
  // seconds above 59, or minutes above 59 under hours, are not guessed
  if (uhr) return Number(uhr[3]) > 59 || (uhr[1] !== undefined && Number(uhr[2]) > 59) ? null : Number(uhr[1] ?? 0) * 3600 + Number(uhr[2]) * 60 + Number(uhr[3]);
  const s = /^(\d+(?:[.,']\d+)*)\s*s$/.exec(t);
  if (!s) return null;
  if (/^\d{1,3}(?:[.,']\d{3})+$/.test(s[1])) return Number(s[1].replace(/[.,']/g, ''));
  return /^\d+(?:[.,]\d+)?$/.test(s[1]) ? Number(s[1].replace(',', '.')) : null;
}

const DAUER = String.raw`(?:\d+:)?\d+:\d{2}|\d+(?:[.,']\d+)*\s*s`;

/**
 * One context line of a gate block: `  <context> <result> [<duration>] [<rest>]`, indented, the result
 * one word of letters (grün, ROT, übersprungen …); grün and rot come back as gruen and rot, any other
 * word lower case. The duration is null when the line has none this reader knows. null: no context line.
 */
export function gateKontext(zeile: string): { name: string; ergebnis: string; dauerS: number | null; rest: string } | null {
  const m = new RegExp(String.raw`^\s+(\S+)\s+(\p{L}+)(?:\s+(${DAUER}))?(?:\s+(.*?))?\s*$`, 'u').exec(zeile);
  if (!m) return null;
  const wort = m[2].toLowerCase();
  const ergebnis = /^(grün|gruen|green)$/.test(wort) ? 'gruen' : /^(rot|red)$/.test(wort) ? 'rot' : wort;
  return { name: m[1], ergebnis, dauerS: m[3] ? dauerSekunden(m[3]) : null, rest: m[4] ?? '' };
}

/**
 * The context lines below the heading of a gate block: those indented like the first context line.
 * Deeper ones are detail of a context (`    Gruppen: alle 11`, `    Log: …`), never a context of their own.
 */
export function gateKontexte(zeilen: string[]): { zeile: string; kontext: NonNullable<ReturnType<typeof gateKontext>> }[] {
  let tiefe: number | null = null;
  return zeilen.flatMap((zeile) => {
    const kontext = gateKontext(zeile);
    if (!kontext) return [];
    const t = /^\s*/.exec(zeile)![0].length;
    tiefe ??= t;
    return t === tiefe ? [{ zeile, kontext }] : [];
  });
}

/**
 * The summary of a context gate (the form of hexanite's gate, of flotte-probe's werkzeug/gate.ps1 and of
 * this repository's gate.ps1): after the last `== Gate: …` line one line per context (gateKontext),
 * skipped contexts without a time, then `Gate grün.` or `Gate rot.`. A context with a result and a time
 * is a test; a red context names itself as the file (its tests have no files of their own).
 */
function gate(text: string): Gezaehlt | null {
  const ende = /^Gate (gr\S{1,2}n|rot)\.\s*$/im.exec(text);
  if (!ende) return null;
  const zeilen = text.slice(0, ende.index).split(/\r?\n/);
  const kopf = zeilen.map((z) => /^== Gate: /.test(z)).lastIndexOf(true);
  let tests = 0;
  const rot: Gezaehlt['rot'] = [];
  for (const { kontext: k } of gateKontexte(zeilen.slice(kopf + 1))) {
    if (k.dauerS === null || (k.ergebnis !== 'gruen' && k.ergebnis !== 'rot')) continue;
    tests++;
    if (k.ergebnis === 'rot') rot.push({ datei: k.name, test: k.rest.trim() || 'rot' });
  }
  return tests ? { dateien: null, tests, rot } : null;
}

/** One suite: the output of its command; an unknown format throws. */
export function zaehle(ausgabe: string, befehl: string, worktree: string): Gezaehlt {
  const ort = (p: string) => pfadIm(worktree, verzeichnisAus(befehl), p);
  const r = bun(ausgabe, ort) ?? pester(ausgabe, befehl, ort) ?? pytest(ausgabe, ort) ?? gate(ausgabe);
  if (!r) throw new Error(`Ausgabe von "${befehl}" in keinem bekannten Format (bun test, Pester, pytest, Andockprüfung); keine Zählung. Ende der Ausgabe: ${ausgabe.trim().slice(-300)}`);
  return r;
}

/**
 * Lint findings per file: `datei:zeile[:spalte]:`, `datei(zeile,spalte):` and the stylish form of
 * eslint (a path line, below it `zeile:spalte  error|warning`). Counted from the output, not the
 * exit code; an exit ≠ 0 without a finding in a known form throws.
 */
export function zaehleLint(ausgabe: string, befehl: string, worktree: string, code: number): Record<string, number> {
  const ort = (p: string) => pfadIm(worktree, verzeichnisAus(befehl), p);
  const out: Record<string, number> = {};
  const zaehl = (p: string) => (out[ort(p)] = (out[ort(p)] ?? 0) + 1);
  let kopf: string | null = null;
  for (const zeile of ausgabe.split(/\r?\n/)) {
    const kompakt = /^\s*([^\s(]+?\.[A-Za-z0-9]+)(?::\d+(?::\d+)?:|\(\d+,\d+\):?)/.exec(zeile);
    if (kompakt) {
      zaehl(kompakt[1]);
      continue;
    }
    if (kopf && /^\s+\d+:\d+\s+(error|warning)\b/i.test(zeile)) {
      zaehl(kopf);
      continue;
    }
    if (/^\S[^:]*\.[A-Za-z0-9]+\s*$/.test(zeile) || /^[A-Za-z]:[\\/]\S*\.[A-Za-z0-9]+\s*$/.test(zeile)) kopf = zeile.trim();
    else if (!zeile.trim()) kopf = null;
  }
  if (!Object.keys(out).length && code !== 0) throw new Error(`lint "${befehl}" endete mit Exit ${code}, aber ohne Befund in bekannter Form (Datei:Zeile:Spalte, Datei(Zeile,Spalte), eslint stylish). Ende der Ausgabe: ${ausgabe.trim().slice(-300)}`);
  return out;
}
