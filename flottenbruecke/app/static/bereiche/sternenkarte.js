// Sternenkarte (#43): the projects with their open epics and backlog, read only, from the flat view
// `projekte[].epics` of /api/tafel (the bridge asks no forge). The shell (huelle.js) calls zeichne(t, el)
// on every load while the area is visible; t is null before the first load, then the helpers of app.js
// do not exist yet. All scripts of the page share one scope: keep every name inside this call.
'use strict';

(() => {
  const KOPF = '<h2 class="ek bereich-kopf">Sternenkarte</h2>';
  const STUFE = { laeuft: 'läuft', nacharbeit: 'Nacharbeit', frage: 'Frage', pr: 'PR', wartend: 'wartet', blockiert: 'blockiert', abgebrochen: 'abgebrochen' };
  // where the card of an epic stands on the Brücke: box and id
  const KARTE = { laeuft: 'e2-liste', nacharbeit: 'e2-liste', frage: 'e2-liste', pr: 'e2-liste', wartend: 'bereit', blockiert: 'e1-liste', abgebrochen: 'e1-liste' };
  const offen = new Set(); // the opened ticket lists survive the redrawing
  let letzte = null; // the board of the last drawing, for the clicks

  const link = (url, text, cls = '') => (url ? `<a${cls ? ` class="${cls}"` : ''} href="${esc(url)}">${text}</a>` : `<span${cls ? ` class="${cls}"` : ''}>${text}</span>`);

  const paketeHtml = (e, k) => {
    if (!e.pakete.length) return '';
    const fertig = e.pakete.filter((p) => p.stand === 'fertig').length;
    const n = e.pakete.length;
    const liste = e.pakete.map((p) => `<li class="${esc(p.stand)}"><span class="punkt"></span>${link(p.url, esc(p.name))} <span class="pt">${esc(p.titel)}</span><span class="ps">${esc(PAKET[p.stand] ?? p.stand)}</span></li>`).join('');
    return `<details class="sk-pakete" data-k="${esc(k)}"${offen.has(k) ? ' open' : ''}><summary><span class="segmente">${e.pakete.map((p) => `<span class="segment ${esc(p.stand)}"></span>`).join('')}</span><span class="pz">${n} ${n === 1 ? 'Ticket' : 'Tickets'} · ${fertig} fertig</span></summary><ol class="pakete">${liste}</ol></details>`;
  };

  // order edges: an open predecessor jumps to its row, a finished or unknown one links its issue
  const kanteHtml = (x, p) => (x.offen
    ? `<button type="button" class="sk-kante" data-sprung="${esc(`${p.forge}#${x.nr}`)}" title="${esc(x.titel)}">#${x.nr}<small> ${esc(STUFE[x.stufe] ?? x.stufe)}</small></button>`
    : link(x.issueUrl, `#${x.nr}<small> ${x.stufe === 'abgebrochen' ? 'aufgegeben' : x.stufe ? 'erledigt' : 'nicht mehr offen'}</small>`, 'sk-kante erledigt'));

  const epicHtml = (e, p) => {
    const k = `${p.forge}#${e.nr}`;
    const vor = e.nach.filter((x) => x.offen);
    const warum = e.warum || (e.stufe === 'frage' ? `wartet auf dich${e.fragen ? ` (${e.fragen} ${e.fragen === 1 ? 'Frage' : 'Fragen'})` : ''}` : e.stufe === 'wartend' && vor.length ? `wartet auf ${vor.map((x) => `#${x.nr}`).join(', ')}` : '');
    const kanten = [
      e.nach.length ? `<span class="sk-kanten"><span class="sk-eti">nach</span> ${e.nach.map((x) => kanteHtml(x, p)).join(' ')}</span>` : '',
      e.folgen.length ? `<span class="sk-kanten"><span class="sk-eti">danach</span> ${e.folgen.map((n) => `<button type="button" class="sk-kante" data-sprung="${esc(`${p.forge}#${n}`)}">#${n}</button>`).join(' ')}</span>` : '',
    ].join('');
    const pr = e.pr ? link(e.prUrl, `PR #${e.pr}`) : '';
    const prognose = e.prognose ? `<span class="sk-prog" title="Prognose aus den gemessenen Epics dieses Projekts, ohne Wartezeit auf Fragen">voraussichtlich ${esc(spanne(e.prognose))}</span>` : '';
    return `<li class="sk-epic ${esc(e.stufe)}${e.prio ? ' prio-hoch' : ''}" data-k="${esc(k)}">
<div class="sk-zeile">${link(e.issueUrl, `#${e.nr}`, 'nr')}<span class="sk-titel">${esc(e.titel)}</span><span class="sk-marken">${e.prio ? '<span class="prio">prio</span>' : ''}<button type="button" class="sk-stufe ${esc(e.stufe)}" data-karte="${esc(k)}" title="Karte auf der Brücke zeigen">${esc(STUFE[e.stufe] ?? e.stufe)}</button></span></div>
${warum || e.konto || pr || prognose ? `<div class="sk-warum">${[warum ? esc(warum) : '', e.konto && e.stufe !== 'wartend' ? esc(e.konto) : '', pr, prognose].filter(Boolean).join(' · ')}</div>` : ''}
${kanten ? `<div class="sk-kantenzeile">${kanten}</div>` : ''}${paketeHtml(e, k)}</li>`;
  };

  const projektHtml = (p) => {
    const epics = p.epics ?? [];
    const prognose = p.prognose ? `<p class="sk-prognose">${prognoseHtml({ ...p.prognose, kurz: p.kurz, mehrere: false })}</p>` : '';
    const zahl = epics.length ? `${epics.length} ${epics.length === 1 ? 'offenes Epic' : 'offene Epics'}` : 'keine offenen Epics';
    const still = p.veraltet ? ' · Treiber still' : p.aktiv ? '' : ' · beendet';
    return `<section class="sk-projekt${p.veraltet ? ' veraltet' : ''}"><h3 class="sk-kopf">${link(p.url, esc(p.kurz), 'sk-name')}<span class="sk-zahl">${zahl}${still}</span></h3>${prognose}${epics.length ? `<ol class="sk-liste">${epics.map((e) => epicHtml(e, p)).join('')}</ol>` : ''}</section>`;
  };

  huelle.bereich({
    name: 'sternenkarte',
    titel: 'Sternenkarte',
    zeichne(t, el) {
      if (!t) {
        if (!el.childElementCount) el.innerHTML = `${KOPF}<p class="bereich-leer">Lädt …</p>`;
        return;
      }
      letzte = t;
      if (!el.dataset.verdrahtet) {
        el.dataset.verdrahtet = '1';
        el.addEventListener('toggle', (ev) => {
          const d = ev.target;
          if (!d.matches?.('details.sk-pakete')) return;
          if (d.open) offen.add(d.dataset.k);
          else offen.delete(d.dataset.k);
        }, true);
        el.addEventListener('click', (ev) => {
          const knopf = ev.target.closest?.('[data-sprung], [data-karte]');
          if (!knopf) return;
          const [art, k] = knopf.dataset.sprung ? ['sprung', knopf.dataset.sprung] : ['karte', knopf.dataset.karte];
          const forge = k.slice(0, k.lastIndexOf('#'));
          const epic = (letzte?.projekte.find((p) => p.forge === forge)?.epics ?? []).find((e) => `${forge}#${e.nr}` === k);
          if (art === 'sprung') huelle.springe('sternenkarte', () => [...el.querySelectorAll('.sk-epic')].find((li) => li.dataset.k === k) ?? null);
          else if (epic) huelle.springe('bruecke', () => karteIn(KARTE[epic.stufe] ?? 'e2-liste', epic.stufe === 'pr' ? `${epic.id}:s` : epic.id));
        });
      }
      const html = t.projekte.length ? `${KOPF}${t.projekte.map(projektHtml).join('')}` : `${KOPF}<p class="bereich-leer">Noch kein Projekt gemeldet.</p>`;
      // same html: leave the DOM alone (the 10 s load, text selection, scroll)
      if (el.dataset.sig !== html) {
        el.innerHTML = html;
        el.dataset.sig = html;
      }
    },
  });
})();
