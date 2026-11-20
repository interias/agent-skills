// A driver in a process of its own for D16: the test kills it in the middle of a turn.
// bun test/treiber-prozess.ts '<json: { repo, konten, datei, epics }>'

import { fahre } from '../src/treiber/treiber.ts';
import { aufbau } from './flotte-welt.ts';

const { repo, konten, datei, epics } = JSON.parse(process.argv[2]) as { repo: string; konten: string[]; datei: string; epics: number[] };
const t = aufbau({ vorhanden: { repo, konten } });
await fahre(t.einstellung({ datei }, epics, { maxDauerMs: 60_000 }), t.welt);
