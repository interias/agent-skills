// Holodeck (#44): the prototypes of each project as tiles, read only and sealed off. The driver sends
// the HTML files of the project's folder (adapter key prototype_dir, default prototypen/); the bridge
// delivers them from its store under /holodeck/<forge>/<name> with a sandbox header. Here every frame
// is sandboxed as well: the view with scripts but without same origin (no access to the bridge's
// localStorage, cookies or API), the previews without scripts at all.
//
// "New since the last visit" (also for the ship list, #41): localStorage key
// flottenbruecke.holodeck.besucht holds the ISO time this device last opened the Holodeck; a
// prototype is new when its geaendert is later, or when there is no visit yet. Entering the area
// stores the new time; the dots of this visit stay until the area is left.
//
// The shell (huelle.js) calls zeichne(t, el) on every load while the area is visible; t is null
// before the first load. All scripts of the page share one scope: every name stays in this function.
'use strict';

(() => {
  const SCHLUESSEL = 'flottenbruecke.holodeck.besucht';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const lies = () => { try { return localStorage.getItem(SCHLUESSEL); } catch { return null; } };
  const merke = (w) => { try { localStorage.setItem(SCHLUESSEL, w); } catch { /* private window: every prototype stays new */ } };
  const neu = (p, besucht) => !besucht || Date.parse(p.geaendert) > Date.parse(besucht);
  const datum = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const id = (p) => `${p.forge}/${p.name}`;

  let stand = null;
  let sektion = null;
  // the visit before this one; drin: the area is shown right now
  let besucht = null;
  let drin = false;
  let filter = '';
  let offen = null;
  let geraet = 'schreibtisch';
  const sig = { galerie: '', ansicht: '' };

  addEventListener('hashchange', () => { if (location.hash !== '#holodeck') drin = false; });

  const liste = () => stand?.prototypen ?? [];
  const gefunden = () => liste().find((p) => offen && id(p) === offen) ?? null;

  function galerie(el) {
    const alle = liste();
    const s = JSON.stringify([stand ? alle : null, filter, besucht]);
    if (s !== sig.galerie) {
      sig.galerie = s;
      zeichneGalerie(el, alle);
    }
    // the open one is marked without drawing again: the previews keep their frames
    for (const li of el.querySelectorAll('.holo-kachel')) li.classList.toggle('offen', li.dataset.id === offen);
  }

  function zeichneGalerie(el, alle) {
    el.querySelector('.holo-zahl').textContent = alle.length;
    const ziel = el.querySelector('.holo-galerie');
    if (!stand) { ziel.innerHTML = ''; return; }
    if (!alle.length) {
      ziel.innerHTML = '<p class="bereich-leer">Noch keine Prototypen. Lege HTML-Dateien in den Ordner <code>prototypen/</code> eines Projekts (Adapterschlüssel <code>prototype_dir</code> in <code>.claude/epic.md</code>); der Treiber schickt sie mit seinem nächsten Takt. Unterordner zählen nicht.</p>';
      return;
    }
    const projekte = [...new Set(alle.map((p) => p.forge))];
    if (filter && !projekte.includes(filter)) filter = '';
    const pille = (forge, text, n) => `<button type="button" class="holo-pille" data-aktion="filter" data-forge="${esc(forge)}" aria-pressed="${filter === forge}">${esc(text)} <span>${n}</span></button>`;
    const leiste = projekte.length > 1 ? `<div class="holo-filter" role="group" aria-label="Nach Projekt filtern">${pille('', 'Alle', alle.length)}${projekte.map((f) => pille(f, f.split('/').pop(), alle.filter((p) => p.forge === f).length)).join('')}</div>` : '';
    const kachel = (p) => {
      const n = neu(p, besucht);
      return `<li class="holo-kachel" data-id="${esc(id(p))}">
        <div class="holo-vorschau" aria-hidden="true"><iframe sandbox="" loading="lazy" tabindex="-1" referrerpolicy="no-referrer" title="" src="${esc(p.url)}?v=${encodeURIComponent(p.geaendert)}"></iframe></div>
        <button type="button" class="holo-oeffnen" data-aktion="oeffnen" data-id="${esc(id(p))}">${n ? '<span class="holo-unsichtbar">Neu: </span>' : ''}${esc(p.titel || p.name)}</button>
        <small class="holo-meta">${esc(p.kurz)} · ${esc(p.name)} · ${esc(datum(p.geaendert))}</small>
        ${n ? '<span class="holo-neu" title="Neu seit deinem letzten Besuch"></span>' : ''}
      </li>`;
    };
    ziel.innerHTML = leiste + projekte.filter((f) => !filter || f === filter).map((f) => {
      const eigene = alle.filter((p) => p.forge === f).sort((a, b) => (b.geaendert > a.geaendert ? 1 : b.geaendert < a.geaendert ? -1 : 0));
      return `<section class="holo-projekt" aria-label="${esc(f)}"><h3 class="holo-projekt-kopf">${esc(f.split('/').pop())} <small>${esc(f)}</small></h3><ul class="holo-kacheln">${eigene.map(kachel).join('')}</ul></section>`;
    }).join('');
  }

  function ansicht(el) {
    const p = gefunden();
    const s = JSON.stringify(p);
    if (s === sig.ansicht) return;
    sig.ansicht = s;
    const ziel = el.querySelector('.holo-ansicht');
    ziel.hidden = !p;
    if (!p) { ziel.innerHTML = ''; return; }
    const knopf = (g, text) => `<button type="button" class="knopf klein zweit" data-aktion="geraet" data-geraet="${g}" aria-pressed="${geraet === g}">${text}</button>`;
    ziel.innerHTML = `<div class="holo-ansicht-kopf">
        <div class="holo-ansicht-titel"><b>${esc(p.titel || p.name)}</b><small>${esc(p.forge)} · ${esc(p.name)} · ${esc(datum(p.geaendert))}</small></div>
        <div class="holo-geraete" role="group" aria-label="Gerät">${knopf('schreibtisch', 'Schreibtisch')}${knopf('telefon', 'Telefon')}</div>
        <button type="button" class="knopf klein zweit" data-aktion="kopieren">Rückmeldung kopieren</button>
        <button type="button" class="knopf klein zweit" data-aktion="schliessen">Schließen</button>
      </div>
      <p class="holo-meldung" role="status"></p>
      <div class="holo-rueck"></div>
      <div class="holo-buehne ${geraet}"><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="Prototyp: ${esc(p.titel || p.name)}" src="${esc(p.url)}?v=${encodeURIComponent(p.geaendert)}"></iframe></div>`;
  }

  // #47: the feedback goes as a message into an open chat of the Bereitschaftsraum (with device and PIN like writing
  // there); drawn apart from the stage, so the prototype keeps running while the chats change
  let rueckText = '';
  let rueckChat = null;
  function rueckmeldung(el) {
    const p = gefunden();
    const ziel = el.querySelector('.holo-rueck');
    if (!p || !ziel) return;
    const r = stand?.bereitschaftsraum;
    const chats = (r?.chats ?? []).filter((c) => c.stand === 'offen' && !c.archiviert).sort((a, b) => (a.forge === p.forge ? 0 : 1) - (b.forge === p.forge ? 0 : 1));
    if (!chats.some((c) => c.id === rueckChat)) rueckChat = chats[0]?.id ?? null;
    const s = JSON.stringify([id(p), chats.map((c) => [c.id, c.titel, c.kurz]), r?.pin, rueckChat]);
    if (ziel.dataset.sig === s || ziel.contains(document.activeElement)) return;
    ziel.dataset.sig = s;
    if (!r?.pin || stand.nurAnsicht) { ziel.innerHTML = `<p class="holo-hinweis">Rückmeldung an den Chat abgeschaltet: ${esc(huelle.ohnePin(stand))}.</p>`; return; }
    if (!chats.length) { ziel.innerHTML = '<p class="holo-hinweis">Kein offener Chat: im Bereitschaftsraum einen beginnen, dann geht die Rückmeldung von hier hinein.</p>'; return; }
    ziel.innerHTML = `<form class="holo-rueck-form" data-form="rueck">
      <label>Chat<select name="chat">${chats.map((c) => `<option translate="no" value="${c.id}"${c.id === rueckChat ? ' selected' : ''}>${esc(c.kurz)} · ${esc(c.titel)}</option>`).join('')}</select></label>
      <textarea name="text" aria-label="Rückmeldung zum Prototyp" placeholder="Was passt, was nicht?">${esc(rueckText)}</textarea>
      <div class="knoepfe"><button type="submit" class="knopf klein haupt">Rückmeldung an den Chat</button><span class="status" role="status"></span></div>
    </form>`;
  }

  async function rueckSenden(form) {
    const p = gefunden();
    const text = rueckText.trim();
    const status = form.querySelector('.status');
    if (!p || !text) { status.className = 'status schlecht'; status.textContent = 'Text schreiben'; return; }
    if (await senden(`/api/chat/${rueckChat}/nachricht`, { text: `Rückmeldung zu Prototyp ${p.forge}/${p.name}: ${text}` }, form, status)) {
      rueckText = '';
      form.querySelector('textarea').value = '';
      status.className = 'status gut';
      status.textContent = 'Im Chat abgelegt.';
      await laden();
    }
  }

  async function kopiere(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* not a secure context (http in the LAN): the old way */ }
    const feld = document.createElement('textarea');
    feld.value = text;
    feld.setAttribute('readonly', '');
    feld.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(feld);
    feld.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    feld.remove();
    return ok;
  }

  async function klick(ev, el) {
    const b = ev.target.closest('[data-aktion]');
    if (!b || !el.contains(b)) return;
    const aktion = b.dataset.aktion;
    if (aktion === 'filter') {
      filter = b.dataset.forge;
      galerie(el);
    } else if (aktion === 'oeffnen') {
      offen = b.dataset.id;
      ansicht(el);
      rueckmeldung(el);
      galerie(el);
      el.querySelector('.holo-ansicht').scrollIntoView({ block: 'start' });
    } else if (aktion === 'schliessen') {
      const war = offen;
      offen = null;
      ansicht(el);
      galerie(el);
      [...el.querySelectorAll('.holo-oeffnen')].find((x) => x.dataset.id === war)?.focus();
    } else if (aktion === 'geraet') {
      // only the stage changes: the prototype keeps running
      geraet = b.dataset.geraet;
      el.querySelector('.holo-buehne').className = `holo-buehne ${geraet}`;
      for (const k of el.querySelectorAll('[data-aktion="geraet"]')) k.setAttribute('aria-pressed', String(k.dataset.geraet === geraet));
    } else if (aktion === 'kopieren') {
      const p = gefunden();
      if (!p) return;
      const text = `Rückmeldung zu Prototyp ${p.forge}/${p.name}: `;
      const meldung = el.querySelector('.holo-meldung');
      if (await kopiere(text)) meldung.textContent = 'In der Zwischenablage: Text dahinter schreiben und in den Chat einfügen.';
      else meldung.innerHTML = `Kopieren ging nicht. Zum Markieren: <code>${esc(text)}</code>`;
    }
  }

  huelle.bereich({
    name: 'holodeck',
    titel: 'Holodeck',
    zeichne(t, el) {
      if (!sektion) {
        sektion = el;
        el.innerHTML = '<h2 class="ek bereich-kopf"><span>Holodeck</span><span class="zahl holo-zahl">0</span><small>nur ansehen · abgeschottet</small></h2><div class="holo-ansicht" hidden></div><div class="holo-galerie"></div>';
        el.addEventListener('click', (ev) => klick(ev, el));
        el.addEventListener('input', (ev) => {
          if (ev.target.closest('[data-form="rueck"]') && ev.target.name === 'text') rueckText = ev.target.value;
        });
        el.addEventListener('change', (ev) => {
          if (ev.target.closest('[data-form="rueck"]') && ev.target.name === 'chat') rueckChat = Number(ev.target.value);
        });
        el.addEventListener('submit', (ev) => {
          const form = ev.target.closest('[data-form="rueck"]');
          if (!form) return;
          ev.preventDefault();
          rueckSenden(form);
        });
      }
      if (!drin) {
        drin = true;
        besucht = lies();
        merke(new Date().toISOString());
      }
      stand = t;
      // the open prototype was removed: close the view
      if (offen && t && !gefunden()) offen = null;
      ansicht(el);
      rueckmeldung(el);
      galerie(el);
    },
    treffer(t) {
      return (t.prototypen ?? []).map((p) => ({
        art: 'Prototyp',
        titel: p.titel || p.name,
        info: `${p.kurz} · ${p.name}`,
        ziel: () => {
          if (!sektion) return null;
          if (filter && filter !== p.forge) {
            filter = '';
            galerie(sektion);
          }
          return [...sektion.querySelectorAll('.holo-kachel')].find((x) => x.dataset.id === id(p)) ?? null;
        },
      }));
    },
  });
})();
