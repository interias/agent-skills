// HTTP to the Gitea API through curl (mission/references/forge.md: without the CLI everything goes through
// curl against the API). curl runs through the Aufrufer like gh, so it is synchronous where the driver is
// and replaced by a stand-in in tests. The request goes as a curl config on stdin: the token never shows
// in a process list, a long body never hits the length limit of a command line.

import type { AsyncAufrufer, Aufrufer, Ergebnis } from '../aufruf.ts';

export interface Anfrage {
  methode: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  /** the Authorization header value */
  kopf: string;
  body?: unknown;
}

export interface Antwort {
  status: number;
  text: string;
}

/** a quoted value of a curl config: backslash, quote and line breaks escaped */
const zitat = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;

/** -w appends the status on a line of its own; --config - reads url, method, headers and body from stdin */
export const CURL_ARGS = ['-sS', '--config', '-', '-w', '\\n%{http_code}'];

export function curlKonfig(x: Anfrage): string {
  const zeilen = [`url = ${zitat(x.url)}`, `request = ${zitat(x.methode)}`, `header = ${zitat(`Authorization: ${x.kopf}`)}`, `header = ${zitat('Accept: application/json')}`];
  if (x.body !== undefined) zeilen.push(`header = ${zitat('Content-Type: application/json')}`, `data-binary = ${zitat(JSON.stringify(x.body))}`);
  return `${zeilen.join('\n')}\n`;
}

/** The status from the last line; a curl that did not reach the server is status 0 with its error text. */
export function curlAntwort(r: Ergebnis): Antwort {
  const aus = r.stdout.replace(/\r?\n$/, '');
  const i = aus.lastIndexOf('\n');
  const status = Number(i < 0 ? aus : aus.slice(i + 1));
  if (r.code || !Number.isInteger(status) || status === 0) return { status: 0, text: (r.stderr || r.stdout).trim() || `curl Exit ${r.code}` };
  return { status, text: i < 0 ? '' : aus.slice(0, i) };
}

export const curl = (a: Aufrufer, x: Anfrage): Antwort => curlAntwort(a('curl', CURL_ARGS, { eingabe: curlKonfig(x) }));

export const curlAsync = async (a: AsyncAufrufer, x: Anfrage, timeoutMs = 120_000): Promise<Antwort> => curlAntwort(await a('curl', CURL_ARGS, { eingabe: curlKonfig(x), timeoutMs }));

/** The request of a curl call as the stand-ins read it back (test/gitea-attrappe.ts). */
export function curlLesen(eingabe: string): { methode: string; url: string; kopf: string; body: unknown } {
  const werte = new Map<string, string[]>();
  for (const z of eingabe.split('\n')) {
    const m = /^([\w-]+) = "((?:[^"\\]|\\.)*)"$/.exec(z);
    if (!m) continue;
    const wert = m[2].replace(/\\(.)/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c as 'n'] ?? c);
    werte.set(m[1], [...(werte.get(m[1]) ?? []), wert]);
  }
  const daten = werte.get('data-binary')?.[0];
  const auth = (werte.get('header') ?? []).find((h) => h.startsWith('Authorization: '));
  return { methode: werte.get('request')?.[0] ?? 'GET', url: werte.get('url')?.[0] ?? '', kopf: auth?.slice('Authorization: '.length) ?? '', body: daten === undefined ? undefined : JSON.parse(daten) };
}
