#!/usr/bin/env bun
// flotte <befehl> [...]: every command prints exactly one JSON object on stdout; messages go to
// stderr. Exit 1 when the command could not do its job, 2 on a usage error.

import { adapter } from './befehle/adapter.ts';
import { auftrag } from './befehle/auftrag.ts';
import { lernen } from './befehle/lernen.ts';
import { messen } from './befehle/messen.ts';
import { zuschauen } from './befehle/zuschauen.ts';
import { belegung } from './werkzeuge/belegung.ts';
import { bloecke } from './werkzeuge/bloecke.ts';
import { lauf } from './werkzeuge/lauf.ts';
import { ressourcen } from './werkzeuge/ressourcen.ts';
import { verbrauch } from './werkzeuge/verbrauch.ts';
import { zustand } from './werkzeuge/zustand.ts';
import { anhalten, antworten, fahren } from './treiber/treiber.ts';

const befehle: Record<string, (argv: string[]) => unknown> = {
  messen,
  bloecke,
  verbrauch,
  ressourcen: (argv) => ressourcen(argv),
  zustand,
  lauf,
  belegung: (argv) => belegung(argv),
  fahren,
  antworten,
  anhalten,
  zuschauen: (argv) => zuschauen(argv),
  adapter: (argv) => adapter(argv),
  lernen: (argv) => lernen(argv),
  auftrag: (argv) => auftrag(argv),
};

export async function main(argv: string[]): Promise<number> {
  const [befehl, ...rest] = argv;
  const f = befehl ? befehle[befehl] : undefined;
  if (!f) {
    process.stderr.write(`Aufruf: flotte <${Object.keys(befehle).join('|')}> ...\n`);
    return 2;
  }
  try {
    process.stdout.write(JSON.stringify(await f(rest), null, 2) + '\n');
    return 0;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) main(process.argv.slice(2)).then((code) => process.exit(code));
