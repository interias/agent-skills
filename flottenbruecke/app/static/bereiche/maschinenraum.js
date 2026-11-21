// Maschinenraum (#42): accounts as tanks, the machines (RAM, disk, fleet limit) and the beat of each
// driver, all from /api/tafel; below them the settings of each driver (#59), changeable with the PIN.
// With several drivers, the settings of accounts and machine stand once for all of them.
// A field the report lacks gets an honest empty line, never a made-up value.
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

  // ---- settings (#59): the effective values with their origin, a control per value, a change only after "Übernehmen"
  const HERKUNFT = { start: 'Start', bruecke: 'Brücke', standard: 'Standard', gemischt: 'je Treiber' };
  // accounts and the machine are shared by every driver: shown once, "Übernehmen" goes to each of them
  const GEMEINSAM = ['konten', 'admiral', 'verbrauchGelb', 'verbrauchRot', 'leerfahren', 'ramWarn', 'platteMinGb'];
  const ALLE = '*';
  const HILFE = {
    obergrenze: 'Mehr Epics laufen nie gleichzeitig; automatisch folgt die Grenze der Wochen-Hochrechnung.',
    paketeJeEpic: 'So viele Pakete eines Epics arbeiten gleichzeitig; /epic senkt das Fenster ab dem nächsten frei werdenden Platz, nichts wird abgebrochen.',
    konten: 'Neue Epics starten nur auf diesen Konten, laufende bleiben auf ihrem; ein Neustart setzt --konten wieder ein.',
    admiral: 'Dieses Konto beantwortet die nächsten Fragen des Admirals; automatisch das Konto des Epics.',
    verbrauchGelb: 'Über diesem Verbrauch im 5-Stunden-Fenster startet nichts Neues; muss unter Rot liegen.',
    verbrauchRot: 'Darüber halten auch Fortsetzungen an; muss über Gelb liegen.',
    leerfahren: 'Diese Konten bremsen erst bei 100 %, nicht schon bei Hochrechnung oder Gelb.',
    ramWarn: 'Ab dieser RAM-Auslastung warnt der Treiber; automatisch gilt die Vorgabe des Projekts.',
    platteMinGb: 'Unter so viel freiem Plattenplatz startet nichts Neues.',
    leerlaufMin: 'Nach so vielen Minuten ohne Lebenszeichen fasst der Treiber nach oder bricht den Zug ab.',
  };
  // drafts: "forge|name" -> the value the person picked and has not sent yet
  const entwuerfe = new Map();
  let letzte = null;
  const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const art = (e) => (Array.isArray(e.wert) || Array.isArray(e.standard) ? 'liste' : e.auswahl ? 'konto' : e.max - e.min <= 3 ? 'stufe' : 'zahl');
  const anzeige = (e, w) => (w == null ? (e.name === 'admiral' ? 'Konto des Epics' : 'automatisch') : Array.isArray(w) ? (w.length ? w.join(', ') : 'keine') : String(w));
  // what the driver runs now, or what is on its way there
  const basis = (e) => (e.offen ? e.offen.wert : e.wert);
  const wann = (iso) => {
    const d = datum(iso);
    if (!d) return '';
    return d.toDateString() === new Date().toDateString() ? uhrzeit(iso) : `${d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${uhrzeit(iso)}`;
  };
  const mitEinstellungen = (t) => (t?.projekte ?? []).filter((p) => p.einstellungen);
  const gemeinsam = (t) => mitEinstellungen(t).length > 1;
  // the drivers a row speaks for: one, or all of them for a shared row
  const ziele = (t, zeile) => (zeile.dataset.forge === ALLE ? mitEinstellungen(t) : (t?.projekte ?? []).filter((p) => p.forge === zeile.dataset.forge));
  const finde = (t, zeile) => {
    const es = ziele(t, zeile).map((p) => p.einstellungen?.find((x) => x.name === zeile.dataset.name)).filter(Boolean);
    return zeile.dataset.forge === ALLE ? vereint(es) : es[0];
  };
  // one setting of several drivers as one: the common value, or the first one and stand naming each
  function vereint(es) {
    if (!es.length) return undefined;
    const einig = es.every((e) => gleich(basis(e), basis(es[0])));
    const herkunft = es.every((e) => e.herkunft === es[0].herkunft) ? es[0].herkunft : 'gemischt';
    return { ...es[0], herkunft, offen: einig ? es.find((e) => e.offen)?.offen ?? null : null, einig, je: es };
  }

  function gueltig(e, w) {
    if (w === undefined) return false;
    if (w === null) return !!e.leer;
    if (Array.isArray(w)) return e.name !== 'konten' || w.length > 0;
    return typeof w !== 'number' || (Number.isInteger(w) && w >= e.min && w <= e.max);
  }

  function reglerHtml(e, id, w, aus) {
    const a = art(e);
    const chip = (typ, name, wert, text, an) => `<label class="mr-chip"><input type="${typ}" name="${name}" value="${esc(wert)}"${an ? ' checked' : ''}${aus ? ' disabled' : ''}><span>${esc(text)}</span></label>`;
    if (a === 'liste') return e.auswahl.map((k) => chip('checkbox', id, k, k, (w ?? []).includes(k))).join('');
    if (a === 'konto') return chip('radio', id, '', 'Konto des Epics', w == null) + e.auswahl.map((k) => chip('radio', id, k, k, w === k)).join('');
    if (a === 'stufe') {
      const stufen = Array.from({ length: e.max - e.min + 1 }, (_, i) => e.min + i);
      return (e.leer ? chip('radio', id, '', 'automatisch', w == null) : '') + stufen.map((n) => chip('radio', id, n, n, w === n)).join('');
    }
    const auto = e.leer ? chip('checkbox', `${id}-auto`, 'auto', 'automatisch', w == null) : '';
    return `<input type="number" class="mr-zahl" name="${id}" min="${e.min}" max="${e.max}" step="1" inputmode="numeric" aria-label="${esc(e.titel)}, ${e.min} bis ${e.max}" value="${w == null ? '' : esc(w)}"${aus || w == null ? ' disabled' : ''}><span class="mr-bereich">${e.min} bis ${e.max}</span>${auto}`;
  }

  // the value a row's controls show now; undefined: nothing valid picked yet
  function lies(zeile, e) {
    const a = art(e);
    if (a === 'liste') return [...zeile.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);
    if (a === 'zahl') {
      if (zeile.querySelector('input[type=checkbox]:checked')) return null;
      const v = zeile.querySelector('input[type=number]').value;
      return v === '' ? undefined : Number(v);
    }
    const r = zeile.querySelector('input[type=radio]:checked');
    if (!r) return undefined;
    return r.value === '' ? null : a === 'stufe' ? Number(r.value) : r.value;
  }

  function zeileHtml(p, i, e, darf, t) {
    const w = entwuerfe.has(`${p.forge}|${e.name}`) ? entwuerfe.get(`${p.forge}|${e.name}`) : basis(e);
    const geholt = e.offen?.abgeholt ?? false;
    const id = esc(`mr-e-${i}-${e.name}`);
    const stand = e.je && !e.einig
      ? `<span class="mr-wartet">unterschiedlich</span> · ${e.je.map((x, k) => `${esc(mitEinstellungen(t)[k].kurz)} <b>${esc(anzeige(x, basis(x)))}</b>`).join(' · ')}`
      : e.offen
      ? `<span class="mr-wartet">wartet auf den Treiber</span> · neu <b>${esc(anzeige(e, e.offen.wert))}</b>${geholt ? ' · abgeholt, Quittung folgt' : ''} <span class="mr-seit">(jetzt <b>${esc(anzeige(e, e.wert))}</b>)</span>`
      : `<b>${esc(anzeige(e, e.wert))}</b> · wirksam seit ${esc(wann(e.seit))}`;
    return `<div class="mr-karte mr-einst-zeile${e.offen ? ' wartet' : ''}" role="group" aria-labelledby="${id}-t" data-forge="${esc(p.forge)}" data-name="${esc(e.name)}">
<h4 id="${id}-t">${esc(e.titel)} <span class="mr-herkunft ${esc(e.herkunft)}">${esc(HERKUNFT[e.herkunft] ?? e.herkunft)}</span></h4>
<p class="mr-hilfe">${esc(HILFE[e.name] ?? '')}</p>
<p class="mr-stand">${stand}</p>
<div class="mr-regler">${reglerHtml(e, id, w, !darf || geholt)}</div>
<div class="knoepfe"><button type="button" class="knopf haupt" data-uebernehmen${darf && !geholt && gueltig(e, w) && (!gleich(w, basis(e)) || (e.je && !e.einig)) ? '' : ' disabled'}>Übernehmen</button><span class="status" role="status"></span></div></div>`;
  }

  function einstellungenHtml(t) {
    const mehrere = t.projekte.length > 1;
    const geteilt = gemeinsam(t);
    const hinweisText = (p) => (!t.pin ? 'Ändern abgeschaltet: keine PIN gesetzt.' : p?.veraltet ? 'Der Treiber meldet sich gerade nicht: eine Änderung wirkt ab seinem nächsten Takt.' : 'Eine Änderung wirkt ab dem nächsten Takt, nichts Laufendes wird abgebrochen. Übernehmen braucht die PIN.');
    let html = '';
    if (geteilt) {
      const ps = mitEinstellungen(t);
      const namen = ps[0].einstellungen.map((e) => e.name).filter((n) => GEMEINSAM.includes(n));
      const zeilen = namen.map((n) => vereint(ps.map((p) => p.einstellungen.find((e) => e.name === n)).filter(Boolean))).filter(Boolean);
      const still = ps.some((p) => p.veraltet);
      html += `<h3 class="mr-titel">Einstellungen · alle Treiber</h3><p class="mr-hinweis">${esc(`Konten und Rechner teilen sich alle Treiber: Übernehmen gilt für ${ps.map((p) => p.kurz).join(' und ')}. ${hinweisText(still ? { veraltet: true } : null)}`)}</p><div class="mr-reihe mr-einst">${zeilen.map((e) => zeileHtml({ forge: ALLE }, 'alle', e, t.pin, t)).join('')}</div>`;
    }
    return html + t.projekte.map((p, i) => {
      const kopf = `<h3 class="mr-titel">Einstellungen${mehrere ? ` · ${esc(p.kurz)}` : ''}</h3>`;
      if (!p.einstellungen) {
        const r = t.rechner.find((x) => x.name === p.rechner);
        const bekannt = [r?.obergrenze != null ? `Epics gleichzeitig <b>${r.obergrenze}</b>` : '', p.leerlaufS != null ? `Leerlauf <b>${Math.round(p.leerlaufS / 60)} min</b>` : ''].filter(Boolean).join(' · ');
        return `${kopf}<p class="mr-hinweis">Dieser Treiber meldet keine Einstellungen (älterer Stand): hier nur lesend${bekannt ? `, bekannt ist ${bekannt}` : ''}. Ändern geht, sobald der Treiber aktualisiert ist.</p>`;
      }
      const eigene = geteilt ? p.einstellungen.filter((e) => !GEMEINSAM.includes(e.name)) : p.einstellungen;
      return `${kopf}<p class="mr-hinweis">${esc(hinweisText(p))}</p><div class="mr-reihe mr-einst">${eigene.map((e) => zeileHtml(p, i, e, t.pin, t)).join('')}</div>`;
    }).join('');
  }

  // a control changed: keep the draft (the 10 s load draws again), enable "Übernehmen" at once
  function geaendert(ev) {
    const zeile = ev.target.closest('.mr-einst-zeile');
    const e = zeile && finde(letzte, zeile);
    if (!e) return;
    if (ev.target.type === 'checkbox' && ev.target.name.endsWith('-auto')) {
      const z = zeile.querySelector('input[type=number]');
      z.disabled = ev.target.checked;
      if (!z.disabled) z.focus();
    }
    const w = lies(zeile, e);
    const k = `${zeile.dataset.forge}|${e.name}`;
    if (w === undefined || gleich(w, basis(e))) entwuerfe.delete(k);
    else entwuerfe.set(k, w);
    zeile.querySelector('[data-uebernehmen]').disabled = !(gueltig(e, w) && (!gleich(w, basis(e)) || (e.je && !e.einig)));
  }

  async function uebernehmen(ev) {
    const zeile = ev.target.closest('.mr-einst-zeile');
    const e = zeile && finde(letzte, zeile);
    if (!e) return;
    const text = JSON.stringify({ name: e.name, wert: lies(zeile, e) });
    let alle = true;
    for (const p of ziele(letzte, zeile)) {
      if (!(await senden('/api/handlung', { forge: p.forge, epic: 0, art: 'einstellen', nr: null, seit: null, text }, zeile, zeile.querySelector('.status')))) {
        alle = false;
        break;
      }
    }
    if (alle) {
      entwuerfe.delete(`${zeile.dataset.forge}|${e.name}`);
      await laden();
    }
  }

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
      const html = `${KOPF}<h3 class="mr-titel">Konten</h3>${konten}<h3 class="mr-titel">Rechner und Treiber</h3>${rechner}${einstellungenHtml(t)}`;
      letzte = t;
      if (!el.dataset.verdrahtet) {
        el.dataset.verdrahtet = '1';
        el.addEventListener('input', geaendert);
        el.addEventListener('click', (ev) => { if (ev.target.closest('[data-uebernehmen]')) uebernehmen(ev); });
      }
      // a control in use keeps its DOM: the load must not take the focus or a half typed number away
      if (el.contains(document.activeElement) && document.activeElement.closest('.mr-einst-zeile')) return;
      // same html: leave the DOM alone (the 10 s load, text selection, scroll)
      if (el.dataset.sig !== html) {
        el.innerHTML = html;
        el.dataset.sig = html;
      }
    },
  });
})();
