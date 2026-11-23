// Sternenkarte (#43): the projects with their open epics and backlog, from the flat view
// `projekte[].epics` of /api/tafel (the bridge asks no forge). #61: the epics of the deployment are
// steered here with the PIN (pause, continue, priority; #112 the switch for Andocken), the released ones outside it (`freigegeben`)
// can be taken in; the driver carries every action out from its next turn on. The shell (huelle.js)
// calls zeichne(t, el) on every load while the area is visible; t is null before the first load, then
// the helpers of app.js do not exist yet. All scripts of the page share one scope: keep every name
// inside this call.
'use strict';

(() => {
  const KOPF = '<h2 class="ek bereich-kopf">Sternenkarte</h2>';
  const STUFE = { laeuft: 'läuft', nacharbeit: 'Nacharbeit', frage: 'Frage', pr: 'PR', wartend: 'wartet', blockiert: 'blockiert', abgebrochen: 'abgebrochen', gemergt: 'angedockt' };
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

  // #61: an action on its way to the driver, in place of its buttons until the driver acknowledges it
  const unterwegsHtml = (h) => `<span class="status gut">${esc(HANDLUNG[h.art] ?? h.art)}${h.art === 'prioritaet' ? ` ${esc(h.text)}` : h.art === 'merge' ? `: ${esc(andockenWort(h.text))}` : ''} · ${uhrzeit(h.zeit)} · ${h.abgeholt ? 'abgeholt, der Treiber führt es aus' : 'angekommen, der Treiber holt es im nächsten Takt ab'}</span>`;
  const knopfHtml = (p, nr, art, text, wort, cls = 'zweit') => `<button type="button" class="knopf ${cls}" data-steuern="${art}" data-forge="${esc(p.forge)}" data-epic="${nr}"${text ? ` data-text="${text}"` : ''}>${wort}</button>`;

  const steuernHtml = (e, p, pin) => {
    if (!pin || !e.imEinsatz) return '';
    const pause = e.pause ? unterwegsHtml(e.pause) : e.pausiert ? knopfHtml(p, e.nr, 'fortsetzen', null, 'Fortsetzen', 'haupt') : knopfHtml(p, e.nr, 'pausieren', null, 'Pausieren');
    const vorrang = e.vorrang ? unterwegsHtml(e.vorrang) : e.prio ? knopfHtml(p, e.nr, 'prioritaet', 'normal', 'Priorität normal') : knopfHtml(p, e.nr, 'prioritaet', 'hoch', 'Priorität hoch');
    return `<div class="knoepfe sk-steuern">${pause}${vorrang}${andockenKnoepfe(e, p)}<span class="status"></span></div>`;
  };

  // #112: how the epic merges now and why; the switch overrules the proposal and the project, automatisch only where the driver offers it
  const HERKUNFT_ANDOCKEN = { projekt: 'Einstellung des Projekts', vorschlag: 'Vorschlag', epic: 'Schalter an der Mission' };
  const andockenHtml = (e) => {
    if (!e.merge) return '';
    const m = e.merge;
    const grund = m.grund ? (m.herkunft === 'epic' ? ` (Vorschlag war: ${esc(m.grund)})` : `: ${esc(m.grund)}`) : '';
    return `<div class="sk-warum sk-andocken ${esc(m.stellung)}">Andocken: <b>${esc(ANDOCKEN[m.stellung] ?? m.stellung)}</b> · ${esc(HERKUNFT_ANDOCKEN[m.herkunft] ?? m.herkunft)}${grund}</div>`;
  };
  const andockenKnoepfe = (e, p) => {
    if (!e.merge) return '';
    if (e.andocken) return unterwegsHtml(e.andocken);
    const frei = (p.einstellungen ?? []).find((x) => x.name === 'merge')?.werte?.includes('automatisch');
    const anders = e.merge.stellung === 'mensch' ? (frei ? 'automatisch' : null) : 'mensch';
    return [
      anders ? knopfHtml(p, e.nr, 'merge', anders, anders === 'mensch' ? 'Mensch prüft' : 'Automatisch andocken') : '',
      e.merge.herkunft === 'epic' ? knopfHtml(p, e.nr, 'merge', null, 'Zurück zum Vorschlag') : '',
    ].join('');
  };

  const markenHtml = (e) => [
    e.prio ? `<span class="prio" title="${e.prioritaet ? 'Priorität von der Brücke' : 'Label prio/hoch'}">prio</span>` : '',
    e.pausiert ? `<span class="sk-marke pausiert" title="pausiert seit ${esc(uhrzeit(e.pausiert))}: startet nichts Neues, ein laufender Zug läuft zu Ende">pausiert</span>` : '',
    e.imEinsatz ? '' : '<span class="sk-marke">nicht im Einsatz</span>',
  ].join('');

  const epicHtml = (e, p, pin) => {
    const k = `${p.forge}#${e.nr}`;
    const vor = e.nach.filter((x) => x.offen);
    const warum = e.warum || (e.stufe === 'frage' ? `wartet auf dich${e.fragen ? ` (${e.fragen} ${e.fragen === 1 ? 'Frage' : 'Fragen'})` : ''}` : e.stufe === 'wartend' && vor.length ? `wartet auf ${vor.map((x) => `#${x.nr}`).join(', ')}` : '');
    const pause = e.pausiert && e.stufe !== 'wartend' ? `pausiert seit ${uhrzeit(e.pausiert)}, ${['laeuft', 'nacharbeit', 'frage'].includes(e.stufe) ? 'der laufende Zug läuft zu Ende' : 'kein weiterer Zug'}` : '';
    const kanten = [
      e.nach.length ? `<span class="sk-kanten"><span class="sk-eti">nach</span> ${e.nach.map((x) => kanteHtml(x, p)).join(' ')}</span>` : '',
      e.folgen.length ? `<span class="sk-kanten"><span class="sk-eti">danach</span> ${e.folgen.map((n) => `<button type="button" class="sk-kante" data-sprung="${esc(`${p.forge}#${n}`)}">#${n}</button>`).join(' ')}</span>` : '',
    ].join('');
    const pr = e.pr ? link(e.prUrl, `PR #${e.pr}`) : '';
    const prognose = e.prognose ? `<span class="sk-prog" title="Prognose aus den gemessenen Missionen dieses Projekts, ohne Wartezeit auf Fragen">voraussichtlich ${esc(spanne(e.prognose))}</span>` : '';
    return `<li class="sk-epic ${esc(e.stufe)}${e.prio ? ' prio-hoch' : ''}${e.pausiert ? ' pausiert' : ''}" data-k="${esc(k)}">
<div class="sk-zeile">${link(e.issueUrl, `#${e.nr}`, 'nr')}<span class="sk-titel">${esc(e.titel)}</span><span class="sk-marken">${markenHtml(e)}<button type="button" class="sk-stufe ${esc(e.stufe)}" data-karte="${esc(k)}" title="Karte auf der Brücke zeigen">${esc(STUFE[e.stufe] ?? e.stufe)}</button></span></div>
${warum || pause || e.konto || pr || prognose ? `<div class="sk-warum">${[warum ? esc(warum) : '', pause ? esc(pause) : '', e.konto && e.stufe !== 'wartend' ? esc(e.konto) : '', pr, prognose].filter(Boolean).join(' · ')}</div>` : ''}
${andockenHtml(e)}${kanten ? `<div class="sk-kantenzeile">${kanten}</div>` : ''}${paketeHtml(e, k)}${steuernHtml(e, p, pin)}</li>`;
  };

  // #61: released, not in the deployment: the driver checks label and release again when it takes it in
  const freiHtml = (f, p, pin) => `<li class="sk-epic frei" data-k="${esc(`${p.forge}#${f.nr}`)}">
<div class="sk-zeile">${link(f.issueUrl, `#${f.nr}`, 'nr')}<span class="sk-titel">${esc(f.titel)}</span><span class="sk-marken"><span class="sk-marke">nicht im Einsatz</span></span></div>
${pin ? `<div class="knoepfe sk-steuern">${f.handlung ? unterwegsHtml(f.handlung) : knopfHtml(p, f.nr, 'aufnehmen', null, 'Aufnehmen', 'haupt')}<span class="status"></span></div>` : ''}</li>`;

  const projektHtml = (p, pin) => {
    const epics = p.epics ?? [];
    const frei = p.freigegeben ?? [];
    const prognose = p.prognose ? `<p class="sk-prognose">${prognoseHtml({ ...p.prognose, kurz: p.kurz, mehrere: false })}</p>` : '';
    const zahl = `${epics.length ? `${epics.length} ${epics.length === 1 ? 'offene Mission' : 'offene Missionen'}` : 'keine offenen Missionen'}${frei.length ? ` · ${frei.length} freigegeben, nicht im Einsatz` : ''}`;
    const still = p.veraltet ? ' · Treiber still' : p.aktiv ? '' : ' · beendet';
    const freiListe = frei.length ? `<h4 class="sk-unter">Freigegeben, nicht im Einsatz</h4><ol class="sk-liste">${frei.map((f) => freiHtml(f, p, pin)).join('')}</ol>` : '';
    return `<section class="sk-projekt${p.veraltet ? ' veraltet' : ''}"><h3 class="sk-kopf">${link(p.url, esc(p.kurz), 'sk-name')}<span class="sk-zahl">${zahl}${still}</span></h3>${prognose}${epics.length ? `<ol class="sk-liste">${epics.map((e) => epicHtml(e, p, pin)).join('')}</ol>` : ''}${freiListe}</section>`;
  };

  // #61: with the PIN, like the actions on the Brücke; taking an epic in asks once more
  async function steuern(b) {
    const { steuern: art, forge, epic, text } = b.dataset;
    const zeile = b.closest('.sk-steuern');
    if (art === 'aufnehmen' && !(await bestaetigen(`Mission #${epic} in den Einsatz aufnehmen? Der Treiber prüft Freigabe und Label selbst und startet sie, sobald die Belegung einen Platz hat.`, 'Aufnehmen'))) return;
    if (await senden('/api/handlung', { forge, epic: Number(epic), art, nr: null, seit: null, text: text ?? null }, zeile, zeile.querySelector('.status'))) await laden();
  }

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
          const steuerknopf = ev.target.closest?.('[data-steuern]');
          if (steuerknopf) {
            steuern(steuerknopf);
            return;
          }
          const knopf = ev.target.closest?.('[data-sprung], [data-karte]');
          if (!knopf) return;
          const [art, k] = knopf.dataset.sprung ? ['sprung', knopf.dataset.sprung] : ['karte', knopf.dataset.karte];
          const forge = k.slice(0, k.lastIndexOf('#'));
          const epic = (letzte?.projekte.find((p) => p.forge === forge)?.epics ?? []).find((e) => `${forge}#${e.nr}` === k);
          if (art === 'sprung') huelle.springe('sternenkarte', () => [...el.querySelectorAll('.sk-epic')].find((li) => li.dataset.k === k) ?? null);
          else if (epic) huelle.springe('bruecke', () => karteIn(KARTE[epic.stufe] ?? 'e2-liste', epic.stufe === 'pr' ? `${epic.id}:s` : epic.id));
        });
      }
      const hinweis = t.pin && t.projekte.some((p) => (p.epics ?? []).length || (p.freigegeben ?? []).length) ? '<p class="sk-hinweis">Pausieren, Fortsetzen, Priorität, Andocken und Aufnehmen wirken ab dem nächsten Takt des Treibers, nichts Laufendes wird abgebrochen. Jede Handlung braucht die PIN.</p>' : '';
      const html = t.projekte.length ? `${KOPF}${hinweis}${t.projekte.map((p) => projektHtml(p, t.pin)).join('')}` : `${KOPF}<p class="bereich-leer">Noch kein Projekt gemeldet.</p>`;
      // same html: leave the DOM alone (the 10 s load, text selection, scroll)
      if (el.dataset.sig !== html) {
        el.innerHTML = html;
        el.dataset.sig = html;
      }
    },
  });
})();
