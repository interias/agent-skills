// Schiffsliste (#41): the side bar on every page. All runs and sessions per project over all accounts
// as dots by level; read only, nothing here acts on the driver or on a session. A run jumps to its
// card on the bridge, a session opens its details in place. On a wide screen the bar folds to a thin
// column in which the dots stay, on the phone (up to 700 px) it is a drawer from the left.
//
// Where a dot gets its colour is the table ZUORDNUNG below (and in the README). No dot blinks: the
// red alarm belongs to "Braucht dich" alone.
//
// The shell (huelle.js) hands over every new tafel: huelle.beiTafel(). All scripts of the page share
// one scope: every name stays in this function.
'use strict';

(() => {
  const SCHLUESSEL_ZU = 'flottenbruecke.schiffsliste.zu';
  // the Holodeck's rule for "new" (bereiche/holodeck.js): the key holds the last visit of this device
  const SCHLUESSEL_HOLODECK = 'flottenbruecke.holodeck.besucht';
  // from this many entries on the resting ones fold up
  const VIELE = 12;

  // colour, wording and filter chip of a dot; the source column is the table of the README
  const ZUORDNUNG = {
    blau: { text: 'Freigabe', chip: 'freigabe', quelle: 'Mission in der Andock-Schlange (Stufe pr)' },
    lila: { text: 'Frage', chip: 'braucht', quelle: 'offene Frage, blockiert, abgebrochen (Braucht dich)' },
    gruen: { text: 'läuft', chip: 'laeuft', quelle: 'laeuft, nacharbeit, frage mit Prozess; Sitzung busy' },
    gelb: { text: 'neuer Prototyp', chip: null, quelle: 'Projekt mit einem neuen Prototyp (Regel des Holodecks), am Projektkopf' },
    grau: { text: 'ruht', chip: 'ruht', quelle: 'wartend, heute angedockt; Sitzung idle' },
  };
  const REIHE = ['lila', 'blau', 'gruen', 'grau'];
  const CHIPS = [['alle', 'Alle'], ['braucht', 'Braucht dich'], ['freigabe', 'Freigabe'], ['laeuft', 'Läuft'], ['sitzung', 'Sitzungen'], ['ruht', 'Ruht']];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = (x) => document.getElementById(x);
  const seite = $('seite');
  const PHONE = matchMedia('(max-width: 700px)');
  const lies = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const merke = (k, w) => { try { localStorage.setItem(k, w); } catch { /* private window: the bar starts as by default */ } };

  let stand = null;
  let filter = 'alle';
  let ruhendOffen = false;
  const offeneSitzungen = new Set();
  let zu = lies(SCHLUESSEL_ZU) === null ? !matchMedia('(min-width: 1000px)').matches : lies(SCHLUESSEL_ZU) === '1';
  let auf = false;
  let sig = '';

  // ---- what the list holds

  const neuerPrototyp = (p, besucht) => !besucht || Date.parse(p.geaendert) > Date.parse(besucht);
  const uhr = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const heute = d.toDateString() === new Date().toDateString();
    return d.toLocaleString('de-DE', heute ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  // each epic once, where it stands first: level 1, the runs, the queue, the ready ones, merged today
  function laeufe(t) {
    const da = new Map();
    // #61: a pause and the priority show beside the level, the colour stays the level's
    const dazu = (x, nr, farbe, text, box, id) => {
      const k = `${x.forge}#${nr}`;
      if (nr == null || da.has(k)) return;
      da.set(k, { art: 'lauf', k, forge: x.forge, nr, titel: x.titel || '', konto: x.konto || '', farbe, text, box, id, pausiert: Boolean(x.pausiert), prio: Boolean(x.prio) });
    };
    for (const x of t.braucht) dazu(x, x.epic, 'lila', x.art === 'blockade' ? (x.stufe === 'abgebrochen' ? 'abgebrochen' : 'blockiert') : x.art === 'ursache' ? 'wartet auf dich' : ZUORDNUNG.lila.text, 'e1-liste', x.id);
    for (const l of t.unterwegs.laeufe) {
      const frage = l.stufe === 'frage';
      const farbe = frage && !l.fragen ? (l.prozess ? 'gruen' : 'grau') : frage ? 'lila' : 'gruen';
      dazu(l, l.nr, farbe, l.stufe === 'nacharbeit' ? 'Nacharbeit' : frage && farbe === 'grau' ? 'wartet' : ZUORDNUNG[farbe].text, 'e2-liste', l.id);
    }
    for (const s of t.unterwegs.schlange) dazu(s, s.nr, 'blau', ZUORDNUNG.blau.text, 'e2-liste', `${s.id}:s`);
    for (const b of t.unterwegs.bereit) dazu(b, b.nr, 'grau', 'wartet', 'bereit', b.id);
    for (const x of t.erledigt) if (x.art === 'gemergt') dazu(x, x.nr, 'grau', 'angedockt', 'e3-liste', x.id);
    return [...da.values()];
  }

  function sitzungen(t) {
    return (t.sitzungen ?? []).map((s) => {
      const farbe = s.status === 'busy' ? 'gruen' : 'grau';
      return { art: 'sitzung', k: `${s.konto}|${s.projekt}|${s.name}|${s.seit}`, forge: s.forge, farbe, text: ZUORDNUNG[farbe].text, konto: s.konto, name: s.name || s.projekt || 'Sitzung', s };
    });
  }

  const passt = (e) => filter === 'alle' || (filter === 'sitzung' ? e.art === 'sitzung' : ZUORDNUNG[e.farbe].chip === filter);

  // ---- drawing

  function eintragHtml(e) {
    const punkt = `<span class="punkt ${e.farbe}" aria-hidden="true"></span>`;
    if (e.art === 'lauf') {
      const nr = `#${e.nr}`;
      const kopf = `<span class="si-titel">${e.prio ? '<span class="prio">prio</span>' : ''}<b>${esc(nr)}</b> ${esc(e.titel)}</span>`;
      const zustand = [e.text, e.pausiert ? 'pausiert' : ''].filter(Boolean).join(' · ');
      const klein = `<small>${[e.konto, zustand].filter(Boolean).map(esc).join(' · ')}</small>`;
      return `<li><button type="button" class="si" data-aktion="lauf" data-k="${esc(e.k)}" title="${esc(`${nr} ${e.titel} · ${zustand}${e.prio ? ' · Priorität hoch' : ''}`)}">${punkt}<span class="si-text">${kopf}${klein}</span></button></li>`;
    }
    const s = e.s;
    const zeile = (n, w) => (w ? `<dt>${n}</dt><dd>${esc(w)}</dd>` : '');
    const detail = `<dl class="si-detail">${zeile('Name', s.name)}${zeile('Konto', s.konto)}${zeile('Ordner', s.projekt)}${zeile('Art', s.kind)}${zeile('Status', s.status)}${zeile('Seit', uhr(s.seit))}</dl>`;
    return `<li><details class="sitzung" data-k="${esc(e.k)}"${offeneSitzungen.has(e.k) ? ' open' : ''}><summary class="si" title="${esc(`Sitzung ${e.name} · ${e.text}`)}">${punkt}<span class="si-text"><span class="si-titel"><i class="si-art">Sitzung</i> ${esc(e.name)}</span><small>${[e.konto, e.text].filter(Boolean).map(esc).join(' · ')}</small></span></summary>${detail}</details></li>`;
  }

  function gruppeHtml(name, kurz, eintraege, neu, ruhendeFalten) {
    // by level, runs before sessions, runs by number, sessions by name
    const sicht = eintraege.filter(passt).sort((a, b) => REIHE.indexOf(a.farbe) - REIHE.indexOf(b.farbe) || (a.art === 'lauf' ? 0 : 1) - (b.art === 'lauf' ? 0 : 1) || (a.nr ?? 0) - (b.nr ?? 0) || (a.name ?? '').localeCompare(b.name ?? ''));
    if (!sicht.length && filter !== 'alle') return '';
    const gelb = neu ? `<button type="button" class="sp-neu" data-aktion="holodeck" title="${neu} neue${neu === 1 ? 'r' : ''} Prototyp${neu === 1 ? '' : 'en'}: zum Holodeck"><span class="punkt gelb" aria-hidden="true"></span><span class="si-text">${neu} neu</span></button>` : '';
    const kopf = `<h3 class="sp-kopf"><span class="sp-voll">${esc(name)}</span><span class="sp-kurz" aria-hidden="true">${esc(kurz)}</span>${gelb}</h3>`;
    const zeigen = ruhendeFalten ? sicht.filter((e) => e.farbe !== 'grau') : sicht;
    const leer = sicht.length ? '' : '<p class="sp-leer">Nichts los</p>';
    return `<section class="sp" aria-label="${esc(name)}">${kopf}${leer}<ul class="sp-liste">${zeigen.map(eintragHtml).join('')}</ul></section>`;
  }

  function zeichne() {
    const t = stand;
    if (!t) return;
    const besucht = lies(SCHLUESSEL_HOLODECK);
    const alle = [...laeufe(t), ...sitzungen(t)];
    const bekannt = new Set(t.projekte.map((p) => p.forge));
    const gruppen = t.projekte.map((p) => ({
      name: p.kurz, kurz: p.kurz.slice(0, 3), forge: p.forge,
      eintraege: alle.filter((e) => e.forge === p.forge),
      neu: (t.prototypen ?? []).filter((x) => x.forge === p.forge && neuerPrototyp(x, besucht)).length,
    }));
    const sonst = alle.filter((e) => !bekannt.has(e.forge));
    if (sonst.length) gruppen.push({ name: 'Sonstige', kurz: 'Son', forge: null, eintraege: sonst, neu: 0 });

    // many entries: the resting ones fold up (not while the chip "Ruht" asks for them)
    const sichtbar = alle.filter(passt);
    const falten = sichtbar.length > VIELE && filter !== 'ruht' && !ruhendOffen;
    const ruhende = falten ? sichtbar.filter((e) => e.farbe === 'grau').length : 0;
    const zahl = (f) => alle.filter((e) => (f === 'alle' ? true : f === 'sitzung' ? e.art === 'sitzung' : ZUORDNUNG[e.farbe].chip === f)).length;

    const chips = CHIPS.map(([f, text]) => `<button type="button" class="chip" data-aktion="filter" data-filter="${f}" aria-pressed="${filter === f}">${text} <span>${zahl(f)}</span></button>`).join('');
    let liste = gruppen.map((g) => gruppeHtml(g.name, g.kurz, g.eintraege, g.neu, falten)).join('');
    if (!liste) liste = `<p class="sp-leer">${t.projekte.length ? 'Nichts zu diesem Filter' : 'Noch kein Bericht'}</p>`;
    const gesamt = alle.filter((e) => e.farbe === 'grau' && passt(e)).length;
    if (sichtbar.length > VIELE && filter !== 'ruht' && gesamt) {
      liste += `<button type="button" class="sp-mehr" data-aktion="ruhende" aria-expanded="${!falten}">${falten ? `+ ${ruhende} ruhende` : 'Ruhende einklappen'}</button>`;
    }

    const neu = `${chips}\n${liste}`;
    if (neu === sig) return;
    sig = neu;
    // a chip or a button keeps the focus through the redrawing
    const a = document.activeElement;
    const wieder = seite.contains(a) && a.dataset?.aktion ? `[data-aktion="${a.dataset.aktion}"]${a.dataset.filter ? `[data-filter="${a.dataset.filter}"]` : ''}` : null;
    $('seite-chips').innerHTML = chips;
    $('seite-liste').innerHTML = liste;
    if (wieder) seite.querySelector(wieder)?.focus();
  }

  // ---- fold, drawer

  function anwenden() {
    seite.dataset.zu = String(zu);
    const k = $('seite-zu');
    k.setAttribute('aria-expanded', String(!zu));
    k.setAttribute('aria-label', zu ? 'Schiffsliste ausklappen' : 'Schiffsliste einklappen');
  }

  function schublade(offen) {
    if (auf === offen) return;
    auf = offen;
    seite.classList.toggle('auf', offen);
    $('seite-schleier').hidden = !offen;
    $('seite-auf').setAttribute('aria-expanded', String(offen));
    if (offen) $('seite-schliessen').focus();
    else if (seite.contains(document.activeElement)) $('seite-auf').focus();
  }

  seite.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-aktion]');
    if (!b) return;
    const aktion = b.dataset.aktion;
    if (aktion === 'filter') {
      filter = b.dataset.filter;
      zeichne();
    } else if (aktion === 'ruhende') {
      ruhendOffen = !ruhendOffen;
      zeichne();
    } else if (aktion === 'lauf') {
      const e = laeufe(stand).find((x) => x.k === b.dataset.k);
      if (!e) return;
      schublade(false);
      huelle.springe('bruecke', () => karteIn(e.box, e.id));
    } else if (aktion === 'holodeck') {
      schublade(false);
      huelle.springe('holodeck');
    }
  });
  // a session opens in place; which ones are open survives the redrawing
  seite.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!d.matches?.('details.sitzung')) return;
    if (d.open) offeneSitzungen.add(d.dataset.k);
    else offeneSitzungen.delete(d.dataset.k);
  }, true);

  $('seite-zu').addEventListener('click', () => {
    zu = !zu;
    merke(SCHLUESSEL_ZU, zu ? '1' : '0');
    anwenden();
  });
  $('seite-auf').addEventListener('click', () => schublade(!auf));
  $('seite-schliessen').addEventListener('click', () => schublade(false));
  $('seite-schleier').addEventListener('click', () => schublade(false));
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && auf && !ev.defaultPrevented) schublade(false);
  });
  PHONE.addEventListener('change', () => schublade(false));
  // the Holodeck stores its visit when it is entered: the yellow dot goes out with the next look
  addEventListener('hashchange', () => setTimeout(zeichne, 0));

  anwenden();
  huelle.beiTafel((t) => {
    stand = t;
    zeichne();
  });
})();
