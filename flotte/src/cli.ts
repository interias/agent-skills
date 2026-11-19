#!/usr/bin/env bun
// flotte <befehl> [...]: every command prints exactly one JSON object on stdout; messages go to
// stderr. Exit 1 when the command could not do its job, 2 on a usage error.

import { messen } from './befehle/messen.ts';

const befehle: Record<string, (argv: string[]) => unknown> = {
  messen,
};

export function main(argv: string[]): number {
  const [befehl, ...rest] = argv;
  const f = befehl ? befehle[befehl] : undefined;
  if (!f) {
    process.stderr.write(`Aufruf: flotte <${Object.keys(befehle).join('|')}> ...\n`);
    return 2;
  }
  try {
    process.stdout.write(JSON.stringify(f(rest), null, 2) + '\n');
    return 0;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
