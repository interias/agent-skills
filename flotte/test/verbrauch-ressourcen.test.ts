import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ausEreignis, bewerte, lies, schreibe, type Verbrauch } from '../src/werkzeuge/verbrauch.ts';
import { messe, messeRam, naechsteBremse } from '../src/werkzeuge/ressourcen.ts';
import type { Aufrufer } from '../src/aufruf.ts';

const H = 3_600_000;
const jetzt = Date.parse('2026-11-19T12:00:00Z');

/** a 5-hour window that started `stunden` ago with the given used share */
function v(anteil: number, stunden: number, opts: { alterMin?: number; woche?: [number, number] } = {}): Verbrauch {
  const [wAnteil, wTage] = opts.woche ?? [0.1, 1];
  return {
    zeit: jetzt - (opts.alterMin ?? 1) * 60_000,
    fuenf: { anteil, reset: jetzt + (5 - stunden) * H },
    sieben: { anteil: wAnteil, reset: jetzt + (7 - wTage) * 24 * H },
  };
}

describe('verbrauch', () => {
  it('reads both windows of a rate_limit_event', () => {
    const e = ausEreignis({ unifiedWindows: { five_hour: { utilization: 0.49, resetsAt: 1795086600 }, seven_day: { utilization: 0.61, resetsAt: 1795420800 } } }, jetzt);
    expect(e).toEqual({ zeit: jetzt, fuenf: { anteil: 0.49, reset: 1795086600000 }, sieben: { anteil: 0.61, reset: 1795420800000 } });
  });

  it('writes and reads the file per account', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flotte-v-'));
    schreibe(dir, v(0.2, 2));
    expect(lies(dir)?.fuenf?.anteil).toBe(0.2);
  });

  it('rates green, yellow and red by projection and used share (D8)', () => {
    expect(bewerte(v(0.2, 2), jetzt).stufe).toBe('gruen'); // 50 %
    expect(bewerte(v(0.4, 2), jetzt).stufe).toBe('gelb'); // projection 100 %
    expect(bewerte(v(0.61, 4.5), jetzt).stufe).toBe('gelb'); // used over 60 %
    expect(bewerte(v(0.5, 2), jetzt).stufe).toBe('rot'); // projection 125 %
    expect(bewerte(v(0.86, 4.9), jetzt).stufe).toBe('rot'); // used over 85 %
  });

  it('ignores the projection in the first 30 minutes', () => {
    const b = bewerte(v(0.2, 0.25), jetzt);
    expect(b.fuenf?.hochrechnung).toBeNull();
    expect(b.stufe).toBe('gruen');
  });

  it('rates a stale value and a missing file red (D8)', () => {
    expect(bewerte(v(0.1, 2, { alterMin: 31 }), jetzt)).toMatchObject({ stufe: 'rot', grund: expect.stringContaining('31 min alt') });
    expect(bewerte(null, jetzt).stufe).toBe('rot');
  });

  it('is green after the window has reset since the reading', () => {
    expect(bewerte({ ...v(0.95, 4.9), fuenf: { anteil: 0.95, reset: jetzt - 60_000 } }, jetzt).stufe).toBe('gruen');
  });

  it('lowers the fleet limit by the weekly projection', () => {
    expect(bewerte(v(0.1, 2, { woche: [0.5, 3] }), jetzt).obergrenze).toBe(2); // 117 %
    expect(bewerte(v(0.1, 2, { woche: [0.8, 3] }), jetzt).obergrenze).toBe(1); // 187 %
    expect(bewerte(v(0.1, 2, { woche: [0.3, 3] }), jetzt).obergrenze).toBe(4);
  });
});

const ramStub = (out: string, code = 0): Aufrufer => (p) => (p === 'pwsh' ? { code, stdout: out, stderr: code ? 'kaputt' : '' } : { code: 1, stdout: '', stderr: '' });

describe('ressourcen', () => {
  it('takes the level from ram.ps1', () => {
    expect(messeRam(ramStub('{"percent_used":72.1,"free_gb":17.5,"total_gb":62.9,"level":"ok"}'), 'C:/r')).toEqual({ level: 'ok', percent_used: 72.1, free_gb: 17.5 });
  });

  it('counts a failed measurement as hold (D7)', () => {
    expect(messeRam(ramStub('', 1), 'C:/r')).toMatchObject({ level: 'hold', percent_used: null });
    expect(messeRam(ramStub('kein json'), 'C:/r').level).toBe('hold');
  });

  it('starts nothing when the disk is below the threshold or unknown (D9)', () => {
    const a = ramStub('{"level":"ok","percent_used":50,"free_gb":30}');
    expect(messe(a, 'C:/r', 20, () => 12).platte).toEqual({ frei_gb: 12, min_gb: 20, genug: false });
    expect(messe(a, 'C:/r', 20, () => null).platte.genug).toBe(false);
    expect(messe(a, 'C:/r', 20, () => 50).platte.genug).toBe(true);
  });

  it('holds on warn and hold and resumes only after the hysteresis (D6)', () => {
    let b = { halt: false, stufe: 'ok' as const } as ReturnType<typeof naechsteBremse>;
    b = naechsteBremse(b, { level: 'warn', percent_used: 76, free_gb: 10 });
    expect(b.halt).toBe(true);
    b = naechsteBremse(b, { level: 'hold', percent_used: 86, free_gb: 5 });
    expect(b).toEqual({ halt: true, stufe: 'hold' });
    b = naechsteBremse(b, { level: 'ok', percent_used: 73, free_gb: 12 });
    expect(b.halt).toBe(true); // ok, but within 5 points of warn
    b = naechsteBremse(b, { level: 'ok', percent_used: 69, free_gb: 14 });
    expect(b).toEqual({ halt: false, stufe: 'ok' });
  });
});
