import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ausEreignis, bewerte, lies, schreibe, type Verbrauch } from '../src/werkzeuge/verbrauch.ts';
import { messe, messeRam, naechsteBremse } from '../src/werkzeuge/ressourcen.ts';
import { aufrufen, aufrufenAsync, type AsyncAufrufer } from '../src/aufruf.ts';

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

  it('rates a used-up weekly window red until its reset (#132)', () => {
    const b = bewerte(v(0.04, 2, { woche: [1, 5] }), jetzt);
    expect(b).toMatchObject({ stufe: 'rot', grund: expect.stringContaining('Wochenlimit erschöpft bis') });
    // also when the 5-hour window has reset since the reading, and when the account is driven empty
    expect(bewerte({ ...v(0.9, 4.9, { woche: [1, 5] }), fuenf: { anteil: 0.9, reset: jetzt - 60_000 } }, jetzt).stufe).toBe('rot');
    expect(bewerte(v(0.04, 2, { woche: [1, 5] }), jetzt, 30, { gelb: 60, rot: 85, leerfahren: true }).stufe).toBe('rot');
    // once the weekly window has reset, it no longer holds
    expect(bewerte({ ...v(0.04, 2), sieben: { anteil: 1, reset: jetzt - 60_000 } }, jetzt).stufe).toBe('gruen');
  });

  it('lowers the fleet limit by the weekly projection', () => {
    expect(bewerte(v(0.1, 2, { woche: [0.5, 3] }), jetzt).obergrenze).toBe(2); // 117 %
    expect(bewerte(v(0.1, 2, { woche: [0.8, 3] }), jetzt).obergrenze).toBe(1); // 187 %
    expect(bewerte(v(0.1, 2, { woche: [0.3, 3] }), jetzt).obergrenze).toBe(4);
  });

  it('takes the 5-hour thresholds set on the bridge (#58)', () => {
    expect(bewerte(v(0.65, 4.5), jetzt, 30, { gelb: 70, rot: 85 }).stufe).toBe('gruen');
    expect(bewerte(v(0.75, 4.5), jetzt, 30, { gelb: 70, rot: 85 }).stufe).toBe('gelb');
    expect(bewerte(v(0.75, 4.5), jetzt, 30, { gelb: 60, rot: 70 }).stufe).toBe('rot');
    // the projection keeps its own thresholds
    expect(bewerte(v(0.5, 2), jetzt, 30, { gelb: 70, rot: 95 }).stufe).toBe('rot');
  });

  it('an account driven to 100 %: neither projection nor yellow hold it, red only when used up (#58)', () => {
    const leer = { gelb: 60, rot: 85, leerfahren: true };
    expect(bewerte(v(0.5, 2), jetzt, 30, leer)).toMatchObject({ stufe: 'gruen', grund: expect.stringContaining('bis 100 % leerfahren') });
    expect(bewerte(v(0.95, 4.9), jetzt, 30, leer).stufe).toBe('gruen');
    expect(bewerte(v(1, 4.9), jetzt, 30, leer).stufe).toBe('rot');
    // a stale value stays red
    expect(bewerte(v(0.1, 2, { alterMin: 31 }), jetzt, 30, leer).stufe).toBe('rot');
  });
});

const ramStub = (out: string, code = 0): AsyncAufrufer => async (p, args) => {
  gesehen.push(args);
  return p === 'pwsh' ? { code, stdout: out, stderr: code ? 'kaputt' : '' } : { code: 1, stdout: '', stderr: '' };
};
const gesehen: string[][] = [];

describe('ressourcen', () => {
  it('takes the level from ram.ps1 and hands it --ram-warn', async () => {
    expect(await messeRam(ramStub('{"percent_used":72.1,"free_gb":17.5,"total_gb":62.9,"level":"ok"}'), 'C:/r')).toEqual({ level: 'ok', percent_used: 72.1, free_gb: 17.5 });
    await messeRam(ramStub('{"level":"ok"}'), 'C:/r', 'ram.ps1', 80);
    expect(gesehen.at(-1)?.slice(-2)).toEqual(['-WarnPercent', '80']);
  });

  it('measures the machine only: the pause of an epic in a holder file never reaches the driver (#61)', async () => {
    let env: Record<string, string> | undefined;
    await messeRam(async (_p, _a, o) => ((env = o?.env), { code: 0, stdout: '{"level":"ok"}', stderr: '' }), 'C:/r');
    expect(env).toEqual({ EPIC_LOCK_HOLDER: '' });
  });

  it('counts a failed measurement as hold (D7)', async () => {
    expect(await messeRam(ramStub('', 1), 'C:/r')).toMatchObject({ level: 'hold', percent_used: null });
    expect((await messeRam(ramStub('kein json'), 'C:/r')).level).toBe('hold');
  });

  it('measures after a long wait on a child: no spawnSync timeout under Bun (acceptance finding 8)', async () => {
    await aufrufenAsync(process.execPath, ['-e', 'setTimeout(() => {}, 1500)']);
    const r = await aufrufenAsync(process.execPath, ['-e', 'console.log(JSON.stringify({ level: "ok", percent_used: 50, free_gb: 30 }))'], { timeoutMs: 1000 });
    expect(r.code).toBe(0);
    expect(aufrufen(process.execPath, ['-e', 'console.log(1)']).code).toBe(0);
  }, 10_000);

  it('starts nothing when the disk is below the threshold or unknown (D9)', async () => {
    const a = ramStub('{"level":"ok","percent_used":50,"free_gb":30}');
    expect((await messe(a, 'C:/r', 20, () => 12)).platte).toEqual({ frei_gb: 12, min_gb: 20, genug: false });
    expect((await messe(a, 'C:/r', 20, () => null)).platte.genug).toBe(false);
    expect((await messe(a, 'C:/r', 20, () => 50)).platte.genug).toBe(true);
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

  it('a hold from a failed reading ends with the next good reading, without hysteresis (acceptance finding 8)', () => {
    let b = naechsteBremse({ halt: false, stufe: 'ok' }, { level: 'hold', percent_used: null, free_gb: null, fehler: 'ram.ps1 Exit 1' });
    expect(b).toEqual({ halt: true, stufe: 'hold', fehler: true });
    b = naechsteBremse(b, { level: 'ok', percent_used: 72, free_gb: 18 });
    expect(b).toEqual({ halt: false, stufe: 'ok' });
  });
});
