// Runs an external program and returns its output. Every tool of the driver calls programs only
// through a Aufrufer, so tests replace it with a stub.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Ergebnis {
  code: number;
  stdout: string;
  stderr: string;
}

export type Aufrufer = (programm: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv; eingabe?: string; timeoutMs?: number }) => Ergebnis;

export const aufrufen: Aufrufer = (programm, args, opts = {}) => {
  const r = spawnSync(programm === 'pwsh' ? pwshPfad() : programm, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.eingabe,
    // without input the child gets no open stdin: pwsh -File would otherwise wait on it
    stdio: [opts.eingabe === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: opts.timeoutMs,
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
export function pwshJson(aufrufer: Aufrufer, skript: string, args: string[], opts: { timeoutMs?: number } = {}): { code: number; json: unknown; stderr: string } {
  const r = aufrufer('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', skript, ...args], { timeoutMs: opts.timeoutMs });
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
