// Tag J: the history of a mission's runs, read only. On the desktop a drawer on the right beside the board (the board
// stays usable, another card switches the mission), on the phone a sheet from below with three tabs. While it is
// open it loads GET /api/verlauf every 5 s and draws anew only what changed; open groups and the scroll position stay.
// Loaded after app.js: it uses esc, datum, uhrzeit, jetzt, zeitHtml, setze, lebenszeichen, koppelnFragen,
// ETIKETT, PAKET and BREIT from there. Nothing here sends anything to a run.
'use strict';

(() => {
  const NACHLADEN_MS = 5000;
  const STAND = { fehler: 'Fehler', abgebrochen: 'abgebrochen' };
  const FILTER = [['alles', 'Alles'], ['text', 'Gesprochen'], ['wz', 'Werkzeuge'], ['ent', 'Entscheidungen']];
  const REITER = [['verlauf', 'Verlauf'], ['pakete', 'Pakete'], ['ent', 'Entscheidungen']];

  const z = { offen: false, schluessel: null, x: null, weit: false, filter: 'alles', folgen: true, reiter: 'verlauf', daten: null, fehler: null, neu: false };
  const gruppen = new Map(); // group id -> open, only as the person left it
  const befehle = new Set(); // opened "Befehl zeigen"
  let gesehen = new Set(); // entry ids already drawn for this mission: the others light up once
  let karten = []; // the cards under Unterwegs in their order: { id, x }
  let anfrage = 0;

  const schluessel = (x) => `${x.forge}#${x.nr}`;

  // ---- the panel: one element for drawer and sheet, the media query decides which

  const box = document.createElement('aside');
  box.className = 'vl';
  box.id = 'verlauf';
  box.setAttribute('aria-label', 'Verlauf der Mission');
  box.innerHTML = '<button type="button" class="vl-griff" data-vl-zu aria-label="Verlauf schließen"></button><div class="vl-kopf" id="vl-kopf"></div><div class="vl-reiter" id="vl-reiter" role="tablist" aria-label="Ansicht"></div><div class="vl-liste" id="vl-liste" tabindex="-1"></div>';
  document.body.append(box);
  const kopfEl = box.querySelector('#vl-kopf');
  const reiterEl = box.querySelector('#vl-reiter');
  const listeEl = box.querySelector('#vl-liste');

  // ---- durations: short ones in seconds, a running one counts up on the page

  function kurz(s) {
    const g = Math.max(0, Math.round(s));
    if (g < 60) return `${g} s`;
    const m = Math.floor(g / 60);
    if (m < 60) return g % 60 ? `${m}:${String(g % 60).padStart(2, '0')} min` : `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  const zwischen = (a, b) => (datum(a) && datum(b) ? (datum(b) - datum(a)) / 1000 : null);
  const laeuftHtml = (ab, text = 'läuft {}') => (datum(ab) ? `<span class="vl-dauer lf" data-vl-ab="${esc(ab)}" data-vl-text="${esc(text)}"></span>` : '<span class="vl-dauer lf">läuft</span>');

  function ticken() {
    for (const el of box.querySelectorAll('[data-vl-ab]')) {
      const neu = el.dataset.vlText.replace('{}', kurz((jetzt() - datum(el.dataset.vlAb)) / 1000));
      if (el.textContent !== neu) el.textContent = neu;
    }
  }

  // ---- entries

  function kontexteHtml() {
    const k = z.x?.lage?.gate?.kontexte ?? [];
    if (!k.length) return '';
    return `<span class="vl-ctx">${k.map((c) => `<span class="${c.stand === 'fertig' ? 'f' : 'l'}">${esc(c.name)}${c.stand === 'fertig' ? ' ✓' : ' …'}</span>`).join('')}</span>`;
  }

  function eintragHtml(e) {
    const neu = gesehen.size && !gesehen.has(e.id) ? ' neu' : '';
    const kopf = `<time class="vl-zeit" datetime="${esc(e.zeit ?? '')}">${esc(uhrzeit(e.zeit))}</time><span class="vl-sym" aria-hidden="true"><i></i></span>`;
    if (e.art === 'werkzeug') {
      const lf = e.stand === 'laeuft';
      const d = zwischen(e.zeit, e.bis);
      const dauer = lf ? laeuftHtml(e.zeit) : d != null ? `<span class="vl-dauer">${esc(kurz(d))}</span>` : '';
      const marke = STAND[e.stand] ? `<span class="vl-marke ${esc(e.stand)}">${STAND[e.stand]}</span>` : '';
      const gate = lf && e.wz === 'Andockprüfung' ? kontexteHtml() : '';
      const roh = e.roh ? `<details class="vl-roh" data-vl-roh="${esc(e.id)}"${befehle.has(e.id) ? ' open' : ''}><summary>Befehl zeigen</summary><pre>${esc(e.roh)}</pre></details>` : '';
      return `<div class="vl-e vl-wz${lf ? ' laeuft' : ''}${e.stand === 'fehler' ? ' fehler' : ''}${neu}">${kopf}<div class="vl-inh"><span class="vl-art">${esc(e.wz || 'Werkzeug')}</span>${esc(e.text)}${gate}${dauer}${marke}${roh}</div></div>`;
    }
    if (e.art === 'entscheidung') return `<div class="vl-e vl-ent${neu}">${kopf}<div class="vl-inh"><span class="vl-klein">Entscheidung${e.von ? ` · ${esc(e.von)}` : ''}</span>${esc(e.text)}</div></div>`;
    if (e.art === 'frage') {
      const st = e.stand === 'laeuft' ? ' · offen' : e.stand === 'fertig' ? ' · beantwortet' : '';
      return `<div class="vl-e vl-frage${neu}">${kopf}<div class="vl-inh"><span class="vl-klein">Frage des Laufs${st}</span>${esc(e.text)}</div></div>`;
    }
    return `<div class="vl-e vl-text${neu}">${kopf}<div class="vl-inh">${esc(e.text)}</div></div>`;
  }

  function gruppeHtml(g, kinder) {
    const vorgabe = g.stand === 'laeuft';
    const offen = gruppen.has(g.id) ? gruppen.get(g.id) : vorgabe;
    const eo = /offizier/i.test(g.rolle ?? '');
    const d = zwischen(g.zeit, g.bis);
    const stand = g.stand === 'laeuft' ? `<span class="vl-gstand lf">${laeuftHtml(g.zeit)}</span>`
      : g.stand === 'fertig' ? `<span class="vl-gstand">fertig${g.bis ? ` ${esc(uhrzeit(g.bis))}` : ''}${d != null ? ` · ${esc(kurz(d))}` : ''}</span>`
        : STAND[g.stand] ? `<span class="vl-gstand ${esc(g.stand)}">${STAND[g.stand]}</span>` : '';
    const rolle = `${esc(g.rolle || 'Subagent')}${g.paket ? ` · ${esc(g.paket)}` : ''}`;
    const inhalt = kinder || '<p class="vl-leer klein">Noch nichts in dieser Gruppe.</p>';
    return `<details class="vl-gruppe${g.stand === 'laeuft' ? ' laeuft' : ''}" data-vl-gruppe="${esc(g.id)}" data-vl-war="${offen ? 1 : 0}"${offen ? ' open' : ''}><summary><span class="vl-pfeil" aria-hidden="true">▸</span><span class="vl-rolle${eo ? ' eo' : ''}">${rolle}</span><span class="vl-gz">${esc(g.text)}</span>${stand}</summary><div class="vl-kinder">${inhalt}</div></details>`;
  }

  // the flat list as a tree: an entry belongs to the group its gruppe names, else it stands on top
  function baum(eintraege) {
    const ids = new Set(eintraege.filter((e) => e.art === 'gruppe').map((e) => e.id));
    const kinder = new Map();
    const oben = [];
    for (const e of eintraege) {
      if (e.gruppe && ids.has(e.gruppe) && e.gruppe !== e.id) {
        if (!kinder.has(e.gruppe)) kinder.set(e.gruppe, []);
        kinder.get(e.gruppe).push(e);
      } else oben.push(e);
    }
    return { oben, kinder };
  }

  function baumHtml(eintraege, { neuOben = false, ohne = null } = {}) {
    const { oben, kinder } = baum(eintraege);
    const reihe = (l) => (neuOben ? l.slice().reverse() : l);
    const zeichne = (l, tiefe) => reihe(l).filter((e) => e.art !== ohne).map((e) => (e.art === 'gruppe' && tiefe < 4 ? gruppeHtml(e, zeichne(kinder.get(e.id) ?? [], tiefe + 1)) : eintragHtml(e))).join('');
    return zeichne(oben, 0);
  }

  // ---- the panel's parts

  function lageZeile(x) {
    const l = x.lage;
    if (!l) return x.schritt ? `<p class="vl-lage lagez">${esc(x.schritt)}</p>` : '';
    const seit = datum(l.seit) ? `<span class="lage-seit">&nbsp;· ${zeitHtml(l.seit, 'seit {}')}</span>` : '';
    return `<p class="vl-lage lagez"><span class="etikett ${esc(l.etikett)}">${esc(ETIKETT[l.etikett] ?? l.etikett)}</span> <span class="satz">${esc(l.satz)}</span>${seit}</p>`;
  }

  function kopfHtml() {
    const x = z.x;
    const titel = `<h2 class="vl-titel" title="${esc(x.titel ?? '')}">#${esc(x.nr)}${x.titel ? ` · ${esc(x.titel)}` : ''}</h2>`;
    const zu = '<button type="button" class="vl-knopf" data-vl-zu aria-label="Verlauf schließen" title="Schließen (Esc)">✕</button>';
    if (!BREIT.matches) return `<div class="vl-oben">${titel}${zu}</div>${lageZeile(x)}`;
    const i = karten.findIndex((k) => schluessel(k.x) === z.schluessel);
    const n = karten.length;
    const zahl = i >= 0 ? `<span class="vl-zahl" title="Pfeiltasten links und rechts wechseln die Mission">${i + 1}/${n}</span>` : '';
    const wechsel = n > 1 ? '<button type="button" class="vl-knopf" data-vl-schritt="-1" aria-label="vorige Mission" title="Vorige Mission (←)">‹</button><button type="button" class="vl-knopf" data-vl-schritt="1" aria-label="nächste Mission" title="Nächste Mission (→)">›</button>' : '';
    const filter = FILTER.map(([w, t]) => `<button type="button" class="vl-knopf" data-vl-filter="${w}" aria-pressed="${z.filter === w}">${t}</button>`).join('');
    const stand = z.daten?.stand ? `<span class="vl-stand" title="Stand des Verlaufs, wie der Treiber ihn zuletzt schickte">Stand ${esc(uhrzeit(z.daten.stand))}</span>` : '';
    const folgen = `<button type="button" class="vl-knopf${z.folgen ? ' an' : ''}" data-vl-folgen aria-pressed="${z.folgen}" title="An: neue Einträge holen die Liste ans Ende">Mitlaufen</button>`;
    return `<div class="vl-oben">${wechsel}${titel}${zahl}<button type="button" class="vl-knopf" data-vl-weit aria-pressed="${z.weit}">${z.weit ? 'Schmal' : 'Weit'}</button>${zu}</div>${lageZeile(x)}<div class="vl-filter" role="group" aria-label="Filter">${filter}<span class="vl-luft"></span>${stand}${folgen}</div>`;
  }

  function reiterHtml() {
    if (BREIT.matches) return '';
    return REITER.map(([w, t]) => `<button type="button" role="tab" data-vl-reiter="${w}" aria-selected="${z.reiter === w}">${t}</button>`).join('');
  }

  function paketeHtml(x) {
    if (!x.pakete?.length) return '<p class="vl-leer">Noch keine Pakete geschnitten.</p>';
    return `<ol class="vl-pakete">${x.pakete.map((p) => `<li class="${esc(p.stand)}"><span class="vl-punkt" aria-hidden="true"></span><span class="vl-pn">${esc(p.name)}</span><span class="vl-pt">${esc(p.titel)}</span><span class="vl-ps">${esc(PAKET[p.stand] ?? p.stand)}</span></li>`).join('')}</ol>`;
  }

  function listeHtml() {
    if (!BREIT.matches && z.reiter === 'pakete') return paketeHtml(z.x);
    if (z.fehler === 'geraet') return '<div class="vl-leer"><p>Dieses Gerät ist nicht gekoppelt: den Verlauf sieht nur ein gekoppeltes Gerät.</p><button type="button" class="knopf haupt klein" data-vl-koppeln>Gerät koppeln</button></div>';
    if (z.fehler === 'leer') return '<p class="vl-leer">Noch kein Verlauf für diese Mission.</p>';
    if (!z.daten) return `<p class="vl-leer">${z.fehler === 'netz' ? 'Brücke nicht erreichbar.' : 'Lade Verlauf …'}</p>`;
    const alle = z.daten.eintraege ?? [];
    const breit = BREIT.matches;
    const nurEnt = breit ? z.filter === 'ent' : z.reiter === 'ent';
    let html;
    if (nurEnt) {
      const l = alle.filter((e) => e.art === 'frage' || e.art === 'entscheidung');
      html = (breit ? l : l.slice().reverse()).map(eintragHtml).join('');
    } else {
      html = baumHtml(alle, { neuOben: !breit, ohne: breit ? { text: 'werkzeug', wz: 'text' }[z.filter] ?? null : null });
    }
    const netz = z.fehler === 'netz' ? '<p class="vl-hinweis">Brücke gerade nicht erreichbar, der Verlauf ist vom letzten Abruf.</p>' : '';
    return netz + (html || '<p class="vl-leer">Noch nichts in diesem Ausschnitt.</p>');
  }

  // ---- drawing: the head and the list each only when their html changed

  function zeichnen({ ende = false } = {}) {
    if (!z.offen || !z.x) return;
    setze(kopfEl, kopfHtml());
    setze(reiterEl, reiterHtml());
    reiterEl.hidden = BREIT.matches;
    const html = listeHtml();
    if (listeEl.dataset.sig !== html) {
      const oben = listeEl.scrollTop;
      listeEl.innerHTML = html;
      listeEl.dataset.sig = html;
      // follow: on the desktop the newest stands at the end, on the phone at the top
      if (BREIT.matches && (z.folgen || ende)) listeEl.scrollTop = listeEl.scrollHeight;
      else listeEl.scrollTop = ende ? 0 : oben;
    }
    if (z.daten) for (const e of z.daten.eintraege ?? []) gesehen.add(e.id);
    ticken();
    lebenszeichen();
  }

  function markieren() {
    const id = z.offen ? karten.find((k) => schluessel(k.x) === z.schluessel)?.id : null;
    for (const el of document.querySelectorAll('#e2-liste > [data-id]')) {
      const an = el.dataset.id === id;
      el.classList.toggle('vl-gewaehlt', an);
      if (an) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    }
  }

  async function holen() {
    if (!z.offen || document.hidden || !z.x) return;
    const nr = ++anfrage;
    const x = z.x;
    let daten = z.daten;
    let fehler = null;
    try {
      const r = await fetch(`/api/verlauf?forge=${encodeURIComponent(x.forge)}&epic=${encodeURIComponent(x.nr)}`, { cache: 'no-store' });
      if (r.status === 401) { daten = null; fehler = 'geraet'; }
      else if (r.status === 404) { daten = null; fehler = 'leer'; }
      else if (!r.ok) fehler = 'netz';
      else daten = await r.json();
    } catch {
      fehler = 'netz';
    }
    // a newer request (another mission, a later tick) wins
    if (nr !== anfrage || schluessel(x) !== z.schluessel) return;
    const erstes = !z.daten && daten;
    z.daten = daten;
    z.fehler = fehler;
    zeichnen({ ende: Boolean(erstes) && z.neu });
    if (erstes) z.neu = false;
  }

  // ---- open, switch, close

  function oeffnen(k) {
    const neu = schluessel(k.x) !== z.schluessel;
    z.x = k.x;
    if (neu) {
      z.schluessel = schluessel(k.x);
      z.daten = null;
      z.fehler = null;
      z.neu = true;
      gesehen = new Set();
      delete listeEl.dataset.sig;
    }
    z.offen = true;
    document.body.classList.add('vl-offen');
    document.body.classList.toggle('vl-weit', z.weit);
    box.classList.add('auf');
    markieren();
    zeichnen({ ende: true });
    holen();
  }

  function schliessen() {
    if (!z.offen) return;
    z.offen = false;
    box.classList.remove('auf');
    document.body.classList.remove('vl-offen', 'vl-weit');
    // the focus goes back to the card it came from
    const karte = document.querySelector('#e2-liste > .vl-gewaehlt');
    if (box.contains(document.activeElement)) karte?.querySelector('[data-verlauf]')?.focus({ preventScroll: true });
    markieren();
  }

  function schritt(d) {
    if (!karten.length) return;
    const i = karten.findIndex((k) => schluessel(k.x) === z.schluessel);
    oeffnen(karten[(i + d + karten.length) % karten.length]);
  }

  // ---- the board's cards: a tap on a card or on its button; links and buttons in the card keep their own effect

  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const karte = t.closest?.('#e2-liste > [data-id]');
    if (!karte) return;
    // the level around the cards is a <details> too: only what lies inside the card counts
    const eigen = t.closest('a, button, summary, details, input, textarea, select, label, .detail');
    if (!t.closest('[data-verlauf]') && ((eigen && karte.contains(eigen)) || String(getSelection?.() ?? ''))) return;
    const k = karten.find((c) => c.id === karte.dataset.id);
    if (!k) return;
    if (z.offen && schluessel(k.x) === z.schluessel && !t.closest('[data-verlauf]')) schliessen();
    else oeffnen(k);
  });

  box.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (t.closest('[data-vl-zu]')) return schliessen();
    const s = t.closest('[data-vl-schritt]');
    if (s) return schritt(Number(s.dataset.vlSchritt));
    if (t.closest('[data-vl-weit]')) {
      z.weit = !z.weit;
      document.body.classList.toggle('vl-weit', z.weit);
      return zeichnen();
    }
    const f = t.closest('[data-vl-filter]');
    if (f) {
      z.filter = f.dataset.vlFilter;
      return zeichnen({ ende: true });
    }
    if (t.closest('[data-vl-folgen]')) {
      z.folgen = !z.folgen;
      if (z.folgen) listeEl.scrollTop = listeEl.scrollHeight;
      return zeichnen();
    }
    const r = t.closest('[data-vl-reiter]');
    if (r) {
      z.reiter = r.dataset.vlReiter;
      return zeichnen({ ende: true });
    }
    if (t.closest('[data-vl-koppeln]') && (await koppelnFragen())) holen();
  });

  // a group or a command the person opened or closed stays so; the parser's own toggle of a drawn one does not count
  box.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (d.dataset?.vlGruppe != null && d.open !== (d.dataset.vlWar === '1')) {
      gruppen.set(d.dataset.vlGruppe, d.open);
      d.dataset.vlWar = d.open ? '1' : '0';
    }
    if (d.dataset?.vlRoh != null) (d.open ? befehle.add(d.dataset.vlRoh) : befehle.delete(d.dataset.vlRoh));
  }, true);

  document.addEventListener('keydown', (ev) => {
    if (!z.offen || ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || document.querySelector('dialog[open]')) return;
    if (ev.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      schliessen();
    } else if (BREIT.matches && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
      ev.preventDefault();
      schritt(ev.key === 'ArrowRight' ? 1 : -1);
    }
  });

  // another area than the bridge: the board's drawer closes
  addEventListener('hashchange', () => {
    if (location.hash && location.hash !== '#bruecke') schliessen();
  });

  BREIT.addEventListener('change', () => {
    delete listeEl.dataset.sig;
    zeichnen({ ende: true });
  });

  // ---- after each load of the board: the cards, the open mission's card and label from the newest stand

  huelle.beiTafel((t) => {
    karten = [...t.unterwegs.laeufe.map((l) => ({ id: l.id, x: l })), ...t.unterwegs.schlange.map((s) => ({ id: `${s.id}:s`, x: s }))];
    if (z.offen) {
      const k = karten.find((c) => schluessel(c.x) === z.schluessel);
      if (k) z.x = k.x;
      zeichnen();
    }
    markieren();
  });

  setInterval(() => { if (z.offen && !document.hidden) holen(); }, NACHLADEN_MS);
  setInterval(() => { if (z.offen) ticken(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) holen(); });
})();
