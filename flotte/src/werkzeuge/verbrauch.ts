// flotte verbrauch <CLAUDE_CONFIG_DIR> [--max-alter-min 30]
// The usage brake (epic-flotte/SKILL.md, "Verbrauchsbremse"). The driver writes
// <config>/flotte/verbrauch.json from the rate_limit_event of every run on that account (#14,
// decision 6 as answered at HALT 1) and reads only that file. A value older than the threshold is
// red. /api/oauth/usage is not used.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ersetze } from './zustand.ts';

const STUNDE = 3_600_000;

export interface Fenster {
  /** used share 0..1 */
  anteil: number;
  /** reset as epoch milliseconds */
  reset: number;
}

export interface Verbrauch {
  zeit: number;
  fuenf: Fenster | null;
  sieben: Fenster | null;
}

export type Stufe = 'gruen' | 'gelb' | 'rot';

export interface Bewertung {
  stufe: Stufe;
  grund: string;
  /** fleet limit from the 7-day window: 4, 2 or 1 */
  obergrenze: number;
  fuenf: { verbraucht: number; hochrechnung: number | null; reset: string } | null;
  sieben: { verbraucht: number; hochrechnung: number | null; reset: string } | null;
  alterMin: number | null;
}

interface RateLimitInfo {
  unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }>;
}

/** The two windows of a stream-json rate_limit_event (rate_limit_info). */
export function ausEreignis(info: RateLimitInfo, jetzt: number): Verbrauch {
  const w = info?.unifiedWindows ?? {};
  const fenster = (k: string): Fenster | null =>
    typeof w[k]?.utilization === 'number' && typeof w[k]?.resetsAt === 'number' ? { anteil: w[k].utilization!, reset: w[k].resetsAt! * 1000 } : null;
  return { zeit: jetzt, fuenf: fenster('five_hour'), sieben: fenster('seven_day') };
}

export function dateiVon(configDir: string): string {
  return join(configDir.startsWith('~') ? join(homedir(), configDir.slice(1)) : configDir, 'flotte', 'verbrauch.json');
}

export function schreibe(configDir: string, v: Verbrauch): void {
  const datei = dateiVon(configDir);
  mkdirSync(join(datei, '..'), { recursive: true });
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...v, zeit_iso: new Date(v.zeit).toISOString() }, null, 2));
  ersetze(tmp, datei);
}

export function lies(configDir: string): Verbrauch | null {
  const datei = dateiVon(configDir);
  if (!existsSync(datei)) return null;
  try {
    const j = JSON.parse(readFileSync(datei, 'utf8'));
    return { zeit: Number(j.zeit), fuenf: j.fuenf ?? null, sieben: j.sieben ?? null };
  } catch {
    return null;
  }
}

/** used ÷ elapsed share of the window; null in the first 30 minutes, where it swings too much */
function hochrechnung(f: Fenster, laenge: number, jetzt: number): number | null {
  const vergangen = (jetzt - (f.reset - laenge)) / laenge;
  if (vergangen * laenge < 0.5 * STUNDE || vergangen <= 0) return null;
  return f.anteil / Math.min(1, vergangen);
}

const pct = (x: number) => Math.round(x * 1000) / 10;

export function bewerte(v: Verbrauch | null, jetzt: number, maxAlterMin = 30): Bewertung {
  if (!v) return { stufe: 'rot', grund: 'keine Verbrauchsdatei', obergrenze: 4, fuenf: null, sieben: null, alterMin: null };
  const alterMin = Math.round((jetzt - v.zeit) / 6_000) / 10;
  const bild = (f: Fenster | null, laenge: number) => (f ? { verbraucht: pct(f.anteil), hochrechnung: ((h) => (h === null ? null : pct(h)))(hochrechnung(f, laenge, jetzt)), reset: new Date(f.reset).toISOString() } : null);
  const fuenf = bild(v.fuenf, 5 * STUNDE);
  const sieben = bild(v.sieben, 7 * 24 * STUNDE);
  let obergrenze = 4;
  if (sieben?.hochrechnung != null && sieben.hochrechnung > 130) obergrenze = 1;
  else if (sieben?.hochrechnung != null && sieben.hochrechnung > 100) obergrenze = 2;
  const basis = { obergrenze, fuenf, sieben, alterMin };
  if (alterMin > maxAlterMin) return { stufe: 'rot', grund: `Wert ${alterMin} min alt (Schwelle ${maxAlterMin})`, ...basis };
  if (!fuenf) return { stufe: 'rot', grund: '5-Stunden-Fenster fehlt', ...basis };
  // a window whose reset lies in the past has started over
  if (v.fuenf && v.fuenf.reset <= jetzt) return { stufe: 'gruen', grund: '5-Stunden-Fenster seit der Messung zurückgesetzt', ...basis };
  const h = fuenf.hochrechnung;
  if ((h !== null && h > 120) || fuenf.verbraucht > 85) return { stufe: 'rot', grund: `verbraucht ${fuenf.verbraucht} %, Hochrechnung ${h ?? '–'} %`, ...basis };
  if ((h !== null && h >= 90) || fuenf.verbraucht > 60) return { stufe: 'gelb', grund: `verbraucht ${fuenf.verbraucht} %, Hochrechnung ${h ?? '–'} %`, ...basis };
  return { stufe: 'gruen', grund: `verbraucht ${fuenf.verbraucht} %, Hochrechnung ${h ?? '–'} %`, ...basis };
}

export function verbrauch(argv: string[]): unknown {
  const dir = argv.find((a) => !a.startsWith('--'));
  if (!dir) throw new Error('Aufruf: flotte verbrauch <CLAUDE_CONFIG_DIR> [--max-alter-min 30]');
  const i = argv.indexOf('--max-alter-min');
  return bewerte(lies(dir), Date.now(), i >= 0 ? Number(argv[i + 1]) : 30);
}
