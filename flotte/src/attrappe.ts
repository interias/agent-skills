#!/usr/bin/env bun
// A stand-in for `claude -p` (#14, stage 3): started instead of claude, it plays a script.
// FLOTTE_DREHBUCH names a JSON file { "aufrufe": [ Aufruf, ... ] }. A start plays the first unused
// Aufruf whose "wenn" (a regex) matches its stdin and arguments, or that has no "wenn"; when every
// fitting one is used, the last fitting one again. Runs of several epics run at once, so their
// order is not fixed: "wenn" ties an Aufruf to its epic. Every start is logged next to the script
// (<drehbuch>.aufrufe.jsonl: args, stdin, cwd, account) so a test can check what the driver sent.
//
// Aufruf: { "wenn"?: string, "sitzung"?: string, "schritte": Schritt[], "exit"?: number }
// Schritt: { "text": string, "fehler"?: boolean, "grund"?: string, "verweigert"?: unknown[] }  -> a result line
//        | { "zeile": object }                                                                -> any stream-json line
//        | { "verbrauch": [fuenf, sieben] }                                                   -> a rate_limit_event (shares 0..1)
//        | { "warte": ms } | { "stderr": string } | { "haenge": true }                        -> wait, write stderr, never end

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

type Schritt =
  | { text: string; fehler?: boolean; grund?: string; verweigert?: unknown[] }
  | { zeile: Record<string, unknown> }
  | { verbrauch: [number, number] }
  | { warte: number }
  | { stderr: string }
  | { haenge: true };

interface Aufruf {
  wenn?: string;
  sitzung?: string;
  schritte: Schritt[];
  exit?: number;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function liesEingabe(): Promise<string> {
  return new Promise((fertig) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (x) => (text += x));
    process.stdin.on('end', () => fertig(text));
    process.stdin.on('error', () => fertig(text));
  });
}

async function main(): Promise<number> {
  const datei = process.env.FLOTTE_DREHBUCH;
  if (!datei || !existsSync(datei)) {
    process.stderr.write('FLOTTE_DREHBUCH fehlt\n');
    return 2;
  }
  const buch = JSON.parse(readFileSync(datei, 'utf8')) as { aufrufe: Aufruf[] };
  const log = `${datei}.aufrufe.jsonl`;
  const eingabe = await liesEingabe();
  const args = process.argv.slice(2);
  const frueher = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z) as { i: number }) : [];
  const n = frueher.length;
  const benutzt = new Set(frueher.map((x) => x.i));
  const passend = buch.aufrufe.map((a, i) => ({ a, i })).filter(({ a }) => !a.wenn || new RegExp(a.wenn).test(`${eingabe}\n${args.join(' ')}`));
  const wahl = passend.find(({ i }) => !benutzt.has(i)) ?? passend[passend.length - 1];
  if (!wahl) {
    process.stderr.write(`kein Aufruf passt: ${eingabe.slice(0, 80)}\n`);
    return 3;
  }
  const { a: aufruf, i } = wahl;
  appendFileSync(log, JSON.stringify({ n, i, args, eingabe, cwd: process.cwd(), konto: process.env.CLAUDE_CONFIG_DIR ?? null, decke: process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? null }) + '\n');

  const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
  const sitzung = resume ?? aufruf.sitzung ?? `sitzung-${n}`;
  const raus = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
  raus({ type: 'system', subtype: 'init', session_id: sitzung, permissionMode: 'auto' });
  for (const s of aufruf.schritte) {
    if ('warte' in s) await pause(s.warte);
    else if ('stderr' in s) process.stderr.write(s.stderr + '\n');
    else if ('haenge' in s) await pause(24 * 3_600_000);
    else if ('zeile' in s) raus({ session_id: sitzung, ...s.zeile });
    else if ('verbrauch' in s) {
      const jetzt = Math.floor(Date.now() / 1000);
      raus({ type: 'rate_limit_event', session_id: sitzung, rate_limit_info: { unifiedWindows: { five_hour: { utilization: s.verbrauch[0], resetsAt: jetzt + 3 * 3600 }, seven_day: { utilization: s.verbrauch[1], resetsAt: jetzt + 4 * 86400 } } } });
    } else {
      raus({ type: 'assistant', session_id: sitzung, message: { role: 'assistant', content: [{ type: 'text', text: s.text }] } });
      raus({ type: 'result', subtype: 'success', session_id: sitzung, is_error: Boolean(s.fehler), result: s.text, terminal_reason: s.grund ?? null, permission_denials: s.verweigert ?? [] });
    }
  }
  return aufruf.exit ?? 0;
}

main().then((code) => process.exit(code));
