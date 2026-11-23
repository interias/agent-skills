// Compiled once per test file to a program named like the one it stands for (claude, gh): a real
// executable that PATH and spawn find on every platform (a .cmd file would be re-parsed by cmd.exe,
// which breaks the `|` and the quotes in the arguments of claude -p). It runs `bun <script> <args>`,
// the script from FLOTTE_TEST_<NAME> (set by test/mission-prozess.test.ts).
// bun build --compile test/kurzbefehl.ts --outfile <dir>/claude

import { spawn } from 'node:child_process';
import { basename } from 'node:path';

const name = basename(process.execPath).replace(/\.exe$/i, '').toUpperCase();
const kind = spawn(process.env.FLOTTE_TEST_BUN!, [process.env[`FLOTTE_TEST_${name}`]!, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
kind.on('close', (code) => process.exit(code ?? 1));
