// Flottenbrücke v3 (#40): the shell around the areas. One line on top: logo, the command line
// (search and jump; #47: and the commands of the areas, which act only through their existing requests with device
// and PIN, never a free command on the machine), the counter "Braucht dich" and the areas as pills (on
// the phone at the bottom). The board of v2 is the area "Brücke" and draws itself (app.js). Every
// other area lives in its own file under bereiche/ and registers itself:
//
//   huelle.bereich({ name, titel, zeichne(t, el), treffer(t) })
//
//   zeichne  draws the area into its section el: on every load of /api/tafel while the area is
//            visible and when it becomes visible (t is null before the first load). Optional.
//   treffer  hits of the area for the command line: [{ art, titel, info, ziel, ausfuehren }], where ziel()
//            returns the element to jump to (or nothing: then the jump only opens the area). treffer(t, eingabe)
//            gets the typed text; a hit with ausfuehren() is a command: it matches the text itself and runs after the jump.
//            Optional; the board gives epics and projects this way, the Holodeck its prototypes.
//
// Besides the areas: huelle.springe(bereich, ziel) goes to an area and brings an element of it into
// view like a hit of the command line (ziel: the element or a function returning it), and
// huelle.beiTafel(f) calls f(t) after every load of /api/tafel (at once when one is there already);
// the ship list (#41) draws itself that way. huelle.ohnePin(t) names why acting is off: no PIN set, or
// (#48) view only over the remote entry, where the board comes with nurAnsicht and the page never asks for the PIN.
//
// Routing over location.hash (#bruecke is the default, an unknown hash shows the bridge); a jump
// sets the hash, so the Back button goes back. #242: after a slash the hash names a sub-tab of the area
// (#maschinenraum/einstellungen); huelle.unter() gives it to the area, a new one draws the area again. All scripts of the page share one global scope: the
// shell keeps its names inside this function, an area inside its registration.
'use strict';

const huelle = (() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const id = (x) => document.getElementById(x);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sektionen = new Map([...document.querySelectorAll('.bereich[data-bereich]')].map((el) => [el.dataset.bereich, el]));
  const defs = new Map();
  let stand = null;
  let aktiv = null;
  let aktivUnter = '';

  // ---- areas and routing

  // the area and its sub-tab: "maschinenraum/einrichtung" -> ['maschinenraum', 'einrichtung']
  const teile = () => {
    let h = location.hash.slice(1);
    try { h = decodeURIComponent(h); } catch { /* malformed: the bridge */ }
    const [name, ...rest] = h.split('/');
    return sektionen.has(name) ? [name, rest.join('/')] : ['bruecke', ''];
  };
  const ausHash = () => teile()[0];
  const titel = (name) => defs.get(name)?.titel ?? sektionen.get(name)?.getAttribute('aria-label') ?? name;

  function zeichnen(name) {
    const d = defs.get(name);
    if (!d?.zeichne) return;
    try { d.zeichne(stand, sektionen.get(name)); } catch (err) { console.error(err); }
  }

  function zeigen() {
    const [name, unter] = teile();
    if (name === aktiv && unter === aktivUnter) return;
    const erst = aktiv === null;
    aktivUnter = unter;
    if (name === aktiv) {
      scrollTo(0, 0);
      zeichnen(name);
      return;
    }
    aktiv = name;
    for (const [n, el] of sektionen) el.hidden = n !== name;
    for (const a of document.querySelectorAll('.pille[data-bereich]')) {
      if (a.dataset.bereich === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    if (!erst) scrollTo(0, 0);
    zeichnen(name);
  }

  // a name with a sub-tab goes there; a bare area name keeps the sub-tab that is open
  function gehe(name) {
    if (name.includes('/') ? teile().join('/') !== name : ausHash() !== name) location.hash = name;
    zeigen();
  }

  // a jump to an element: open the levels around it, bring it into view, mark it for a moment
  function hin(el, markieren = true) {
    if (!el) return;
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    el.scrollIntoView({ block: 'center', behavior: still.matches ? 'auto' : 'smooth' });
    if (!markieren) return;
    el.dataset.ziel = '';
    setTimeout(() => delete el.dataset.ziel, 2500);
  }

  // a jump from outside the area: the shell's own for the command line and the ship list
  function springe(name, ziel) {
    gehe(name);
    const el = typeof ziel === 'function' ? ziel() : ziel;
    if (el) hin(el);
  }

  function bereich(d) {
    defs.set(d.name, d);
    if (d.name === aktiv) zeichnen(d.name);
  }

  // ---- after each load of /api/tafel (app.js): the counter, then the visible area

  const lauscher = [];

  function beiTafel(f) {
    lauscher.push(f);
    if (stand) f(stand);
  }

  function tafel(t) {
    // #96: a bridge that is not set up yet opens the Maschinenraum with its steps (#242: the sub-tab Einrichtung); a link
    // to an area stays where it points
    if (stand === null && !location.hash && t.einrichten && !t.einrichten.fertig) gehe('maschinenraum/einrichtung');
    stand = t;
    id('nur-ansicht').hidden = !t.nurAnsicht;
    // #46: the emergency stop holds until the machine releases it
    id('notaus-marke').hidden = !t.notaus;
    const n = t.braucht.length;
    const z = id('zaehler');
    z.classList.toggle('alarm', n > 0);
    z.classList.toggle('ruhig', n === 0);
    z.setAttribute('aria-label', `Braucht dich: ${n}`);
    id('zaehler-zahl').textContent = n;
    const p = id('pille-zahl');
    p.textContent = n;
    p.hidden = n === 0;
    zeichnen(aktiv);
    for (const f of lauscher) {
      try { f(t); } catch (err) { console.error(err); }
    }
  }

  id('zaehler').addEventListener('click', (ev) => {
    ev.preventDefault();
    gehe('bruecke');
    hin(id('e1'), false);
  });

  // ---- the command line: a combobox over the areas and the hits the areas give

  const feld = id('suche');
  const box = id('suche-treffer');
  let treffer = [];
  let wahl = -1;

  // the areas get what was typed: a command (#47, art "Befehl") matches it itself and carries ausfuehren()
  function alle(eingabe) {
    const t = [...sektionen.keys()].map((n) => ({ art: 'Bereich', titel: titel(n), bereich: n }));
    for (const [n, d] of defs) {
      if (!d.treffer || !stand) continue;
      try { for (const x of d.treffer(stand, eingabe) || []) t.push({ ...x, bereich: n }); } catch (err) { console.error(err); }
    }
    return t;
  }

  const norm = (s) => String(s ?? '').toLocaleLowerCase('de-DE').replace(/#/g, '');

  function suchen() {
    const worte = norm(feld.value).split(/\s+/).filter(Boolean);
    const liste = alle(feld.value);
    treffer = [...liste.filter((x) => x.ausfuehren), ...liste.filter((x) => {
      if (x.ausfuehren) return false;
      const h = norm(`${x.art} ${x.titel} ${x.info ?? ''}`);
      return worte.every((w) => h.includes(w));
    })].slice(0, 12);
    box.innerHTML = treffer.map((x, i) => `<li role="option" id="treffer-${i}" aria-selected="false"><span class="t-art">${esc(x.art)}</span><span class="t-titel">${esc(x.titel)}</span>${x.info ? `<small>${esc(x.info)}</small>` : ''}</li>`).join('')
      || '<li class="t-leer">Kein Treffer</li>';
    oeffnen(true);
    waehlen(treffer.length ? 0 : -1);
  }

  function oeffnen(auf) {
    box.hidden = !auf;
    feld.setAttribute('aria-expanded', String(auf));
    if (!auf) feld.removeAttribute('aria-activedescendant');
  }

  function waehlen(i) {
    wahl = i;
    for (const [j, li] of [...box.querySelectorAll('[role="option"]')].entries()) {
      li.setAttribute('aria-selected', String(j === i));
      if (j === i) li.scrollIntoView({ block: 'nearest' });
    }
    if (i >= 0) feld.setAttribute('aria-activedescendant', `treffer-${i}`);
    else feld.removeAttribute('aria-activedescendant');
  }

  function aufTreffer(x) {
    if (!x) return;
    oeffnen(false);
    feld.value = '';
    feld.blur();
    springe(x.bereich, x.ziel);
    // a command runs like its button in the area: the same request, device and PIN
    if (x.ausfuehren) x.ausfuehren();
  }

  feld.addEventListener('input', suchen);
  feld.addEventListener('focus', suchen);
  feld.addEventListener('blur', () => oeffnen(false));
  feld.addEventListener('keydown', (ev) => {
    const n = treffer.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (box.hidden) return suchen();
      if (n) waehlen((wahl + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      aufTreffer(treffer[wahl]);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      if (!box.hidden) oeffnen(false);
      else { feld.value = ''; feld.blur(); }
    }
  });
  // keep the focus in the field while a hit is clicked, so the list does not close before the click
  box.addEventListener('mousedown', (ev) => ev.preventDefault());
  box.addEventListener('click', (ev) => {
    const li = ev.target.closest('[role="option"]');
    if (li) aufTreffer(treffer[Number(li.id.replace('treffer-', ''))]);
  });

  document.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.key.toLowerCase() !== 'k') return;
    if (document.querySelector('dialog[open]')) return;
    ev.preventDefault();
    if (document.activeElement === feld) suchen();
    else feld.focus();
    feld.select();
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform)) id('suche-taste').textContent = '⌘K';

  addEventListener('hashchange', zeigen);
  zeigen();

  return { bereich, tafel, springe, beiTafel, unter: () => teile()[1] };
})();
huelle.ohnePin = (t) => (t?.nurAnsicht ? 'nur Ansicht über den Fernweg' : 'keine PIN gesetzt');
