// Runs an external program and returns its output. Every tool of the driver calls programs only
// through a Aufrufer, so tests replace it with a stub.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Ergebnis {
  code: number;
  stdout: string;
  stderr: string;
}

/** Without a timeout on purpose: under Bun 1.3.14 spawnSync with a timeout fails at once (ETIMEDOUT) once the
 * program has waited longer than that on a child before (acceptance finding 8). Whatever needs a
 * timeout goes through AsyncAufrufer. */
export type Aufrufer = (programm: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv; eingabe?: string }) => Ergebnis;

export const aufrufen: Aufrufer = (programm, args, opts = {}) => {
  const r = spawnSync(programm === 'pwsh' ? pwshPfad() : programm, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.eingabe,
    // without input the child gets no open stdin: pwsh -File would otherwise wait on it
    stdio: [opts.eingabe === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error.message) : '') };
};

let pwshCache: string | null = null;

/**
 * The real pwsh.exe. A Store install puts only an app execution alias on PATH
 * (WindowsApps\pwsh), which spawn cannot start. Order: FLOTTE_PWSH, Program Files, the
 * install location of the Store package, else plain 'pwsh'.
 */
export function pwshPfad(): string {
  if (pwshCache) return pwshCache;
  const kandidaten: string[] = [];
  if (process.env.FLOTTE_PWSH) kandidaten.push(process.env.FLOTTE_PWSH);
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    try {
      for (const v of readdirSync(join(pf, 'PowerShell'))) kandidaten.push(join(pf, 'PowerShell', v, 'pwsh.exe'));
    } catch {
      /* not installed there */
    }
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-AppxPackage Microsoft.PowerShell | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const ort = (r.stdout ?? '').trim();
    if (ort) kandidaten.push(join(ort, 'pwsh.exe'));
  }
  pwshCache = kandidaten.find((k) => existsSync(k)) ?? 'pwsh';
  return pwshCache;
}

/** pwsh -NoProfile -File <script> <args>; the scripts of epic/ print exactly one JSON object. */
export function pwshJson(aufrufer: Aufrufer, skript: string, args: string[]): { code: number; json: unknown; stderr: string } {
  return jsonAus(aufrufer('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', skript, ...args]));
}

export async function pwshJsonAsync(aufrufer: AsyncAufrufer, skript: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; json: unknown; stderr: string }> {
  return jsonAus(await aufrufer('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', skript, ...args], { timeoutMs: opts.timeoutMs }));
}

function jsonAus(r: Ergebnis): { code: number; json: unknown; stderr: string } {
  let json: unknown = null;
  const text = r.stdout.trim();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      const letzte = text.split(/\r?\n/).filter(Boolean).pop() ?? '';
      try {
        json = JSON.parse(letzte);
      } catch {
        json = null;
      }
    }
  }
  return { code: r.code, json, stderr: r.stderr };
}

export type AsyncAufrufer = (programm: string, args: string[], opts?: { cwd?: string; eingabe?: string; timeoutMs?: number; env?: Record<string, string> }) => Promise<Ergebnis>;

/** For the slow scripts (merge.ps1 waits for checks): the event loop keeps reading the runs meanwhile. */
export const aufrufenAsync: AsyncAufrufer = (programm, args, opts = {}) =>
  new Promise((fertig) => {
    const kind = spawn(programm === 'pwsh' ? pwshPfad() : programm, args, { cwd: opts.cwd, env: opts.env ? { ...process.env, ...opts.env } : process.env, stdio: [opts.eingabe === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const uhr = opts.timeoutMs
      ? setTimeout(() => {
          stderr += `Zeitgrenze ${opts.timeoutMs} ms`;
          kind.kill();
        }, opts.timeoutMs)
      : null;
    kind.stdout?.setEncoding('utf8').on('data', (x: string) => (stdout += x));
    kind.stderr?.setEncoding('utf8').on('data', (x: string) => (stderr += x));
    kind.on('error', (e) => (stderr += e.message));
    kind.on('close', (code) => {
      if (uhr) clearTimeout(uhr);
      fertig({ code: code ?? 1, stdout, stderr });
    });
    if (opts.eingabe !== undefined) kind.stdin?.end(opts.eingabe);
  });
