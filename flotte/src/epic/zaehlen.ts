// Counting for 4c (#69, decision 6): suites, tests and red tests from the output of the adapter's
// test_commands, lint findings per file from the output of lint_commands. Known formats are bun
// test, Pester (3 to 5) and pytest; any other output is an error, never a count of 0. Paths come
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

/** One suite: the output of its command; an unknown format throws. */
export function zaehle(ausgabe: string, befehl: string, worktree: string): Gezaehlt {
  const ort = (p: string) => pfadIm(worktree, verzeichnisAus(befehl), p);
  const r = bun(ausgabe, ort) ?? pester(ausgabe, befehl, ort) ?? pytest(ausgabe, ort);
  if (!r) throw new Error(`Ausgabe von "${befehl}" in keinem bekannten Format (bun test, Pester, pytest); keine Zählung. Ende der Ausgabe: ${ausgabe.trim().slice(-300)}`);
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
