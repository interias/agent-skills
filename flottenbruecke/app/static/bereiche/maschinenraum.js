// Maschinenraum (#42): accounts as tanks, the machines (RAM, disk, fleet limit) and the beat of each
// driver, all from /api/tafel. A field the report lacks gets an honest empty line, never a made-up value.
// The shell (huelle.js) calls zeichne(t, el) on every load while the area is visible; t is null
// before the first load, then the helpers of app.js do not exist yet. All scripts of the page share
// one scope: keep every name inside this call.
'use strict';

(() => {
  const KOPF = '<h2 class="ek bereich-kopf">Maschinenraum</h2>';
  const nichts = (was) => `<span class="mr-leer">${was} meldet der Treiber nicht</span>`;
  // the steps the driver brakes in: red is a colour only here, nothing blinks
  const STUFE = { gruen: 'frei', gelb: 'gebremst', rot: 'gestoppt' };

  const kontoHtml = (k) => {
    const alt = k.veraltet || (k.alterMin != null && k.alterMin > 30);
    const fenster = (name, f) => (f ? fensterHtml(name, f) : `<span class="fenster mr-aus">${name}: ${nichts('Wert')}</span>`);
    const anmeldung = k.anmeldung ? `<b>${esc(k.anmeldung)}</b>` : nichts('Anmeldung');
    const bremse = k.stufe === 'gruen' ? '<b class="ok">keine</b>' : `<b class="${esc(k.stufe)}">${esc(STUFE[k.stufe] ?? k.stufe)}</b> ${k.grund ? `<span>${esc(k.grund)}</span>` : nichts('Grund')}`;
    return `<article class="mr-karte ${esc(k.stufe)}${alt ? ' veraltet' : ''}">
<h3>${esc(k.konto)}</h3>
${fenster('5 h', k.fuenf)}${fenster('Woche', k.woche)}
<dl><dt>Anmeldung</dt><dd>${anmeldung}</dd><dt>Bremse</dt><dd>${bremse}</dd><dt>Wert</dt><dd>${k.alterMin != null ? `${Math.round(k.alterMin)} min alt` : nichts('Alter')}${k.veraltet ? ' · Treiber still' : ''}</dd></dl></article>`;
  };

  const rechnerHtml = (r, t) => {
    const projekte = t.projekte.filter((p) => p.rechner === r.name);
    const ram = r.ram
      ? `<b class="${esc(r.ram.stufe)}">${esc({ ok: 'ok', warn: 'warn', hold: 'halt' }[r.ram.stufe] ?? r.ram.stufe)}</b>${r.ram.prozent != null ? ` <span class="zahl">${Math.round(r.ram.prozent)} %</span>` : ''}${r.ram.halt ? ' · Bremse hält neue Läufe an' : ''}`
      : nichts('RAM');
    const platte = r.platte
      ? `<b class="${r.platte.genug ? 'ok' : 'knapp'}">${r.platte.genug ? 'ok' : 'knapp'}</b>${r.platte.freiGb != null ? ` <span class="zahl">${Math.round(r.platte.freiGb)} GB frei</span>` : ''}${r.platte.genug ? '' : ' · Bremse hält neue Läufe an'}`
      : nichts('Platte');
    const grenze = r.obergrenze != null ? `<b>${r.obergrenze}</b> <span>Läufe gleichzeitig</span>` : nichts('Obergrenze');
    const takt = projekte.length ? projekte.map((p) => `<span class="${p.veraltet ? 'knapp-text' : ''}"><b>${p.taktS} s</b> ${esc(p.kurz)} · ${p.veraltet ? `still seit ${esc(uhrzeit(p.empfangen))}` : p.aktiv ? `Bericht ${esc(uhrzeit(p.empfangen))}` : 'beendet'}</span>`).join('<br>') : nichts('Takt');
    return `<article class="mr-karte${r.veraltet ? ' veraltet' : ''}"><h3>${esc(r.name || 'Rechner')}</h3>
<dl><dt>RAM</dt><dd>${ram}</dd><dt>Platte</dt><dd>${platte}</dd><dt>Obergrenze</dt><dd>${grenze}</dd><dt>Takt</dt><dd>${takt}</dd></dl></article>`;
  };

  huelle.bereich({
    name: 'maschinenraum',
    titel: 'Maschinenraum',
    zeichne(t, el) {
      if (!t) {
        if (!el.childElementCount) el.innerHTML = `${KOPF}<p class="bereich-leer">Lädt …</p>`;
        return;
      }
      const konten = t.konten.length ? `<div class="mr-reihe">${t.konten.map(kontoHtml).join('')}</div>` : '<p class="bereich-leer">Noch kein Konto gemeldet.</p>';
      const rechner = t.rechner.length ? `<div class="mr-reihe">${t.rechner.map((r) => rechnerHtml(r, t)).join('')}</div>` : '<p class="bereich-leer">Noch kein Rechner gemeldet.</p>';
      const html = `${KOPF}<h3 class="mr-titel">Konten</h3>${konten}<h3 class="mr-titel">Rechner und Treiber</h3>${rechner}`;
      // same html: leave the DOM alone (the 10 s load, text selection, scroll)
      if (el.dataset.sig !== html) {
        el.innerHTML = html;
        el.dataset.sig = html;
      }
    },
  });
})();
