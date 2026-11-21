// Logbuch (#42): the events of the drivers and the decisions of the admiral and the person in one
// list, newest first, filterable by epic and kind. The filter lives here and survives the 10 s load;
// the list is only drawn anew when its html changes. The shell (huelle.js) calls zeichne(t, el) on
// every load while the area is visible; t is null before the first load, then the helpers of app.js
// do not exist yet. All scripts of the page share one scope: keep every name inside this call.
'use strict';

(() => {
  const ARTEN = ['Ereignis', 'Admiral', 'Mensch'];
  const filter = { epic: '', art: '' };
  let letzte = null;
  let el = null;

  const $l = (id) => el.querySelector(`#${id}`);
  const schluessel = (x) => `${x.forge}#${x.epic}`;

  // the entries of /api/tafel: the ticker events and what level 3 knows (decisions, answers, actions)
  function eintraege(t) {
    const url = new Map(t.projekte.map((p) => [p.forge, p.url]));
    const e = (x, art, html) => ({ zeit: x.zeit, forge: x.forge, kurz: x.kurz ?? x.repo, epic: x.epic ?? null, art, html, url: x.epic != null && url.get(x.forge) ? `${url.get(x.forge)}/issues/${x.epic}` : null });
    const liste = t.ereignisse.map((x) => e(x, 'Ereignis', esc(x.text)));
    for (const x of t.erledigt) {
      if (x.art === 'admiral') liste.push(e(x, 'Admiral', `Frage ${x.nr} → <b>${esc(x.antwort)}</b> <small>(${esc(x.herkunft)})</small> · ${esc(x.frage)}${x.widerrufen ? ` <span class="lb-wider">· widerrufen → ${esc(x.widerrufen)}</span>` : ''}`));
      else if (x.art === 'antwort') liste.push(e(x, 'Mensch', `Frage ${x.nr} → <b>${esc([x.option, x.text].filter(Boolean).join(' — '))}</b>`));
      else if (x.art === 'handlung' && x.handlung === 'einstellen') liste.push(e(x, 'Mensch', `Einstellung ${esc(x.titel)} → <b>${esc(Array.isArray(x.wert) ? x.wert.join(', ') || 'keine' : x.wert ?? 'automatisch')}</b>`));
      else if (x.art === 'handlung') liste.push(e(x, 'Mensch', x.handlung === 'widerruf' ? `Widerruf Frage ${x.nr} → <b>${esc(x.text)}</b>` : `<b>${handlungWort(x)}</b>`));
      else if (x.art === 'aufgegeben') liste.push(e(x, 'Mensch', `<b>aufgegeben</b> · ${esc(x.titel)}`));
    }
    return liste.sort((a, b) => (a.zeit < b.zeit ? 1 : a.zeit > b.zeit ? -1 : 0));
  }

  function wann(iso) {
    const d = datum(iso);
    if (!d) return '';
    const uhr = uhrzeit(iso);
    return d.toDateString() === new Date().toDateString() ? uhr : `${d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${uhr}`;
  }

  function zeile(x, mehrere) {
    const nr = x.epic == null ? '' : `${x.url ? `<a class="nr" href="${esc(x.url)}">#${x.epic}</a>` : `<b>#${x.epic}</b>`} `;
    return `<li><time datetime="${esc(x.zeit)}">${esc(wann(x.zeit))}</time><span class="lb-art ${x.art.toLowerCase()}">${x.art}</span><span class="lb-text">${mehrere ? `<span class="wo">${esc(x.kurz)}</span> ` : ''}${nr}${x.html}</span></li>`;
  }

  function setze(ziel, html) {
    if (ziel.dataset.sig !== html) {
      ziel.innerHTML = html;
      ziel.dataset.sig = html;
    }
  }

  function geruest() {
    el.innerHTML = `<h2 class="ek bereich-kopf">Logbuch</h2>
<div class="lb-filter" role="group" aria-label="Filter">
<label>Epic <select id="lb-epic"></select></label>
<label>Art <select id="lb-art"></select></label>
<span class="lb-zahl" id="lb-zahl" aria-live="polite"></span>
</div>
<ol class="lb-liste" id="lb-liste" aria-label="Einträge"></ol>`;
    el.addEventListener('change', (ev) => {
      if (ev.target.id === 'lb-epic') filter.epic = ev.target.value;
      if (ev.target.id === 'lb-art') filter.art = ev.target.value;
      if (letzte) zeichneListe(letzte);
    });
  }

  function zeichneListe(t) {
    letzte = t;
    const alle = eintraege(t);
    const mehrere = t.projekte.length > 1;
    const epics = [...new Map(alle.filter((x) => x.epic != null).map((x) => [schluessel(x), x])).values()].sort((a, b) => b.epic - a.epic || (a.forge < b.forge ? -1 : 1));
    // a filter whose epic is gone from the log falls back to "alle"
    if (filter.epic && !epics.some((x) => schluessel(x) === filter.epic)) filter.epic = '';
    const optionen = (liste, wert) => `<option value="">alle</option>${liste.map(([v, text]) => `<option value="${esc(v)}"${v === wert ? ' selected' : ''}>${esc(text)}</option>`).join('')}`;
    // the options only change when the data does: a select the person has open stays open
    setze($l('lb-epic'), optionen(epics.map((x) => [schluessel(x), `${mehrere ? `${x.kurz} ` : ''}#${x.epic}`]), filter.epic));
    setze($l('lb-art'), optionen(ARTEN.map((a) => [a, a]), filter.art));
    const da = alle.filter((x) => (!filter.epic || schluessel(x) === filter.epic) && (!filter.art || x.art === filter.art));
    $l('lb-zahl').textContent = `${da.length} von ${alle.length}`;
    setze($l('lb-liste'), da.map((x) => zeile(x, mehrere)).join('') || `<li class="lb-leer">${alle.length ? 'Nichts für diesen Filter.' : 'Noch keine Einträge: der Treiber meldet noch keine Ereignisse.'}</li>`);
  }

  huelle.bereich({
    name: 'logbuch',
    titel: 'Logbuch',
    zeichne(t, sektion) {
      el = sektion;
      if (!el.childElementCount) geruest();
      if (t) zeichneListe(t);
    },
  });
})();
