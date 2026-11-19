// The fleet board (#14, decision 7): a local HTML page from the state file, no artifact. It
// reloads itself; the driver rewrites it on every event.

import { renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FlottenZustand } from './treiber.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function tafelHtml(z: FlottenZustand, forge: string): string {
  const epics = Object.values(z.epics).sort((a, b) => a.nr - b.nr);
  const zeilen = epics
    .map((e) => `<tr class="${esc(e.stufe)}"><td><a href="https://github.com/${esc(forge)}/issues/${e.nr}">#${e.nr}</a></td><td>${esc(e.stufe)}</td><td>${esc(e.konto ? basename(e.konto) : '')}</td><td>${e.pr ? `<a href="https://github.com/${esc(forge)}/pull/${e.pr}">#${e.pr}</a>` : ''}</td><td>${esc(e.geparkt.join(', '))}</td><td>${esc(e.notiz)}</td></tr>`)
    .join('\n');
  const fragen = (z.fragen ?? []).filter((f) => !f.beantwortet).map((f) => `<li>#${f.epic} Frage ${f.nr}: ${esc(f.frage)} <em>Empfehlung: ${esc(f.empfehlung)}</em> — wartet: ${esc(f.wartet)}<br><code>flotte antworten ${esc(z.repo)} ${f.epic} ${f.nr} "&lt;Antwort&gt;"</code></li>`).join('\n');
  const entscheidungen = (z.entscheidungen ?? []).slice(-50).reverse().map((d) => `<li>${d.einflussreich ? '<b>✔ einflussreich</b>' : '✔'} #${d.epic} F${d.nr}: ${esc(d.frage)} → <b>${esc(d.antwort)}</b> — ${esc(d.herkunft)}</li>`).join('\n');
  const ereignisse = z.ereignisse.slice(-60).reverse().map((e) => `<li><time>${esc(e.zeit.slice(11, 19))}</time> ${e.epic ? `#${e.epic} ` : ''}${esc(e.text)}</li>`).join('\n');
  const b = z.bremse;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="refresh" content="15"><title>Flottentafel</title>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#1d1d1f;--mu:#6e6e73;--li:#e5e5ea;--rot:#c62828;--gelb:#b26a00;--gruen:#2e7d32}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f2f2f7;--mu:#a1a1a6;--li:#3a3a3c}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--li);padding:4px 8px;text-align:left}
.blockiert td,.abgebrochen td{color:var(--rot)}.fertig td{color:var(--mu)}time{color:var(--mu);font-variant-numeric:tabular-nums}
.gruen{color:var(--gruen)}.gelb{color:var(--gelb)}.rot{color:var(--rot)}h2{margin-top:24px;font-size:16px}code{font-size:12px}</style></head><body>
<h1>Flotte ${esc(basename(z.repo))}</h1>
<p>${z.aktiv ? 'läuft' : 'beendet'} · Stand ${esc(z.stand ?? '')} · Verbrauch: ${(b?.konten ?? []).map((k) => `<span class="${esc(k.stufe)}">${esc(basename(k.konto))} ${esc(k.stufe)}</span>`).join(', ')} · RAM: ${esc(b?.ram ?? '')}${b?.ramHalt ? ' (hält)' : ''} · Platte: ${b?.platteGenug === false ? '<span class="rot">zu wenig</span>' : 'genug'} · Obergrenze ${esc(b?.obergrenze ?? '')}</p>
<table><tr><th>Epic</th><th>Stufe</th><th>Konto</th><th>PR</th><th>geparkt</th><th>Notiz</th></tr>
${zeilen}</table>
<h2>Liegt beim Menschen</h2><ul>${fragen || '<li>nichts</li>'}</ul>
<h2>Entscheidungen</h2><ul>${entscheidungen || '<li>keine</li>'}</ul>
<h2>Ereignisse</h2><ul>${ereignisse}</ul>
</body></html>`;
}

export function schreibeTafel(dir: string, z: FlottenZustand, forge: string): string {
  const datei = join(dir, 'tafel.html');
  writeFileSync(`${datei}.tmp`, tafelHtml(z, forge));
  renameSync(`${datei}.tmp`, datei);
  return datei;
}
