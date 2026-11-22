// Frachtraum (#116): the Sternzeit-Notizen of every project, from `frachtraum` of /api/tafel (the driver
// reads them from the forge, the bridge bundles them by project and topic). Per project: the critical
// questions of the triage with a button per option (the recommendation marked) and a free text, the
// decisions of the triage runs to read and revoke, the notes by topic, and "Triage-Lauf starten" (also
// for all projects). Every action needs the PIN; the driver carries it out from its next turn on, always
// as a comment at the ticket. The shell (huelle.js) calls zeichne(t, el) on every load while the area is
// visible; t is null before the first load, then the helpers of app.js do not exist yet. All scripts of
// the page share one scope: keep every name inside this call.
'use strict';

(() => {
  const KOPF = '<h2 class="ek bereich-kopf">Frachtraum</h2>';
  const ERGEBNIS = { klar: 'Warp frei', ueberfluessig: 'geschlossen' };
  const WIDERRUF = { klar: 'Warp frei wird zurückgenommen, die Notiz wird wieder eine Sternzeit-Notiz.', ueberfluessig: 'Die Notiz wird wieder geöffnet.' };
  // drafts: question id -> { wahl, text }, decision id -> { text }; the 10 s load draws again
  const entwuerfe = new Map();
  const offen = new Set(); // opened revocation forms
  let letzte = null; // the board of the last drawing, for the clicks
  let flaeche = null; // the section of the area

  const link = (url, text, cls = '') => (url ? `<a${cls ? ` class="${cls}"` : ''} href="${esc(url)}">${text}</a>` : `<span${cls ? ` class="${cls}"` : ''}>${text}</span>`);
  const wann = (iso) => {
    const d = datum(iso);
    if (!d) return '';
    return d.toDateString() === new Date().toDateString() ? uhrzeit(iso) : `${d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${uhrzeit(iso)}`;
  };
  const unterwegs = (h, was) => `<span class="status gut">${esc(was)} · ${uhrzeit(h.zeit)} · ${h.abgeholt ? 'abgeholt, der Treiber führt es aus' : 'angekommen, der Treiber holt es im nächsten Takt ab'}</span>`;
  const zahl = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;

  // ---- a critical question: one button per option, the recommendation marked, a free text always possible

  const sendeText = (f, e) => {
    if (e.wahl) return `${e.wahl} senden`;
    if (f.empfohlen.length && !(e.text || '').trim()) return `${f.empfohlen[0]} nehmen · Empfehlung`;
    return 'Senden';
  };

  function frageHtml(f, pin) {
    const e = entwuerfe.get(f.id) || {};
    const kopf = `<div class="fr-zeile">${link(f.issueUrl, `#${f.ticket}`, 'nr')}<span class="fr-titel">${esc(f.titel)}</span><span class="fr-seit">Frage ${f.nr} · seit ${esc(wann(f.seit))}</span></div>`;
    const marke = f.marke ? `<div class="marken"><span class="m">${esc(f.marke)}</span></div>` : '';
    const vorne = `${kopf}<h4 class="fr-frage">${esc(f.frage)}</h4>${marke}${f.grund ? `<p class="warum"><b>Liegt bei dir:</b> ${esc(f.grund)}</p>` : ''}${f.herkunft ? `<p class="warum"><b>Herkunft:</b> ${esc(f.herkunft)}</p>` : ''}`;
    if (f.handlung) {
      let a = {};
      try { a = JSON.parse(f.handlung.text); } catch { /* shown without the answer */ }
      return `${vorne}<div class="angekommen"><span>Deine Antwort: <b>${esc([a.option, a.text].filter(Boolean).join(' — '))}</b></span>${unterwegs(f.handlung, 'Angekommen')}<span class="fr-klein">Der Treiber schreibt sie als Kommentar ans Ticket; der nächste Triage-Lauf nimmt sie als Tatsache.</span></div>`;
    }
    const zu = pin ? '' : ' disabled';
    const opts = f.optionen.map((o) => {
      const emp = f.empfohlen.includes(o.buchstabe);
      const an = e.wahl === o.buchstabe;
      return `<button type="button" class="opt${emp ? ' empfohlen' : ''}${an ? ' gewaehlt' : ''}" data-option="${esc(o.buchstabe)}" aria-pressed="${an}"${zu}><span class="b">${esc(o.buchstabe)}</span><span>${esc(o.text)}${emp ? '<span class="empf">Empfehlung</span>' : ''}</span></button>`;
    }).join('');
    const empf = !f.empfohlen.length && f.empfehlung ? `<p class="warum"><b>Empfehlung:</b> ${esc(f.empfehlung)}</p>` : '';
    return `${vorne}${opts ? `<div class="optionen">${opts}</div>` : ''}${empf}
<textarea placeholder="${f.optionen.length ? 'Eigener Text, steht unverändert am Ticket (optional)' : 'Deine Antwort, steht unverändert am Ticket'}" aria-label="Eigener Text zu Frage ${f.nr} an #${f.ticket}" data-text${zu}>${esc(e.text || '')}</textarea>
<div class="knoepfe"><button type="button" class="knopf haupt" data-antworten${zu}>${esc(sendeText(f, e))}</button><span class="status" role="status">${pin ? '' : 'Antworten abgeschaltet: keine PIN gesetzt'}</span></div>`;
  }

  // ---- a decision of a triage run: what, why, from where, and "Widerrufen" with the objection

  function entscheidungHtml(d, pin) {
    const kopf = `<div class="fr-zeile">${link(d.issueUrl, `#${d.nr}`, 'nr')}<span class="fr-titel">${esc(d.titel)}</span><span class="fr-ergebnis ${esc(d.ergebnis)}">${esc(ERGEBNIS[d.ergebnis] ?? d.ergebnis)}</span><span class="fr-seit">${esc(wann(d.zeit))}</span></div>`;
    const warum = `<p class="warum">${esc(d.grund)}${d.herkunft ? ` <span class="fr-herkunft">(${esc(d.herkunft)})</span>` : ''}</p>`;
    let fuss = '';
    if (d.widerrufen) fuss = `<p class="warum widerrufen">widerrufen → ${esc(d.widerrufen)}</p>`;
    else if (d.handlung) fuss = `<div>${unterwegs(d.handlung, 'Widerruf')}</div>`;
    else if (pin && d.widerrufbar) {
      const auf = offen.has(d.id);
      fuss = `<button type="button" class="wider" data-wider aria-expanded="${auf}">› Widerrufen</button>${auf ? `<div class="wider-form"><p class="fr-klein">${esc(WIDERRUF[d.ergebnis] ?? '')} Dein Einwand steht vorher als Kommentar am Ticket; der nächste Triage-Lauf nimmt ihn als Tatsache.</p><textarea placeholder="Dein Einwand" aria-label="Einwand gegen die Entscheidung zu #${d.nr}" data-text>${esc(entwuerfe.get(d.id)?.text ?? '')}</textarea><div class="knoepfe"><button type="button" class="knopf haupt" data-widerrufen>Widerruf senden</button><button type="button" class="knopf zweit" data-wzu>Abbrechen</button><span class="status" role="status"></span></div></div>` : ''}`;
    }
    return `${kopf}${warum}${fuss}`;
  }

  // ---- the Sternzeit-Notizen by topic; a ticket with two topics stands in both

  const ticketHtml = (x, thema) => `<li class="fr-ticket${x.frage ? ' gefragt' : ''}">${link(x.issueUrl, `#${x.nr}`, 'nr')}<span class="fr-titel">${esc(x.titel)}</span>${x.frage ? '<span class="fr-marke">Frage an dich</span>' : ''}${x.themen.filter((t) => t !== thema).map((t) => `<span class="fr-label">${esc(t)}</span>`).join('')}</li>`;

  function startHtml(p, pin) {
    if (p.laeuft) return '<span class="status gut">Triage-Lauf läuft</span>';
    if (p.handlung) return unterwegs(p.handlung, 'Triage-Lauf');
    return pin ? `<button type="button" class="knopf zweit" data-start="${esc(p.forge)}">Triage-Lauf starten</button>` : '';
  }

  function projektHtml(p, pin) {
    const still = p.veraltet ? ' · Treiber still' : p.aktiv ? '' : ' · beendet';
    const gelesen = p.gelesen ? `Stand der Forge ${esc(wann(p.gelesen))}` : 'Der Treiber hat die Forge noch nicht gelesen';
    const fragen = p.fragen.length ? `<h4 class="fr-unter">Fragen an dich</h4><div class="fr-reihe">${p.fragen.map((f) => `<article class="fr-karte fr-frage-karte" data-id="${esc(f.id)}">${frageHtml(f, pin)}</article>`).join('')}</div>` : '';
    const entsch = p.entscheidungen.length ? `<h4 class="fr-unter">Entscheidungen des Triage-Laufs</h4><ol class="fr-liste">${p.entscheidungen.map((d) => `<li class="fr-karte fr-entscheidung ${esc(d.ergebnis)}" data-id="${esc(d.id)}">${entscheidungHtml(d, pin)}</li>`).join('')}</ol>` : '';
    const themen = p.themen.length
      ? `<h4 class="fr-unter">Sternzeit-Notizen nach Thema</h4><div class="fr-themen">${p.themen.map((t) => `<section class="fr-thema"><h5>${esc(t.thema)} <span class="fr-anzahl">${t.tickets.length}</span></h5><ul class="fr-tickets">${t.tickets.map((x) => ticketHtml(x, t.thema)).join('')}</ul></section>`).join('')}</div>`
      : '<p class="bereich-leer">Keine offene Sternzeit-Notiz.</p>';
    return `<section class="fr-projekt${p.veraltet ? ' veraltet' : ''}" data-forge="${esc(p.forge)}">
<h3 class="fr-kopf">${link(p.url, esc(p.kurz), 'fr-name')}<span class="fr-zahl">${zahl(p.zahl, 'Sternzeit-Notiz', 'Sternzeit-Notizen')}${p.fragen.length ? ` · ${zahl(p.fragen.length, 'Frage', 'Fragen')} an dich` : ''}${still}</span></h3>
<div class="knoepfe fr-start">${startHtml(p, pin)}<span class="fr-klein">${gelesen}</span><span class="status" role="status"></span></div>
${fragen}${entsch}${themen}</section>`;
  }

  function html(t) {
    const ps = t.frachtraum ?? [];
    if (!ps.length) return `${KOPF}<p class="bereich-leer">Noch kein Treiber meldet Sternzeit-Notizen.</p>`;
    const frei = ps.filter((p) => !p.laeuft && !p.handlung);
    const alle = t.pin && ps.length > 1 ? `<div class="knoepfe fr-alle"><button type="button" class="knopf zweit" data-start="alle"${frei.length ? '' : ' disabled'}>Triage-Lauf für alle</button><span class="status" role="status"></span></div>` : '';
    const hinweis = `<p class="fr-hinweis">Der Triage-Lauf klärt jede Sternzeit-Notiz selbst; nur was nach der Liste „beim Menschen“ zu dir gehört, steht hier als Frage. Antworten und Widerrufe stehen als Kommentar am Ticket, nichts nur hier. ${t.pin ? 'Jede Handlung braucht die PIN und wirkt ab dem nächsten Takt des Treibers.' : 'Handeln abgeschaltet: keine PIN gesetzt.'}</p>`;
    return `${KOPF}${hinweis}${alle}${ps.map((p) => projektHtml(p, t.pin)).join('')}`;
  }

  // ---- drawing: a form in use keeps its DOM, the same html leaves it alone

  function zeichnen(el, t, erzwingen = false) {
    const neu = html(t);
    if (!erzwingen && el.contains(document.activeElement) && document.activeElement.matches('textarea')) return;
    if (erzwingen || el.dataset.sig !== neu) {
      el.innerHTML = neu;
      el.dataset.sig = neu;
    }
  }

  const finde = (id) => {
    for (const p of letzte?.frachtraum ?? []) {
      const x = p.fragen.find((f) => f.id === id) ?? p.entscheidungen.find((d) => d.id === id);
      if (x) return x;
    }
    return null;
  };

  async function starten(b) {
    const ziel = b.dataset.start;
    const p = (letzte?.frachtraum ?? []).find((x) => x.forge === ziel);
    const wer = ziel === 'alle' ? 'alle Projekte' : p?.kurz ?? ziel;
    if (!(await bestaetigen(`Triage-Lauf für ${wer} starten? Der Admiral klärt jede offene Sternzeit-Notiz und schreibt seine Entscheidung als Kommentar ans Ticket; was bei dir liegt, kommt hierher als Frage.`, 'Starten'))) return;
    const zeile = b.closest('.knoepfe');
    if (await senden('/api/handlung', { forge: ziel, epic: 0, art: 'triage', nr: null, seit: null, text: null }, zeile, zeile.querySelector('.status'))) await laden();
  }

  async function antworten(karte) {
    const f = finde(karte.dataset.id);
    if (!f) return;
    const e = entwuerfe.get(f.id) || {};
    const text = (e.text || '').trim();
    // one tap on the recommendation: nothing chosen and no text sends the recommended option
    const option = e.wahl || (text ? null : f.empfohlen[0] ?? null);
    const status = karte.querySelector('.status');
    if (!option && !text) {
      status.className = 'status schlecht';
      status.textContent = 'Option wählen oder Text schreiben';
      return;
    }
    if (await senden('/api/handlung', { forge: f.forge, epic: f.ticket, art: 'triage-antwort', nr: f.nr, seit: f.seit, text: JSON.stringify({ option, text: text || null }) }, karte, status)) {
      entwuerfe.delete(f.id);
      karte.querySelector('textarea').value = '';
      await laden();
    }
  }

  async function widerrufen(karte) {
    const d = finde(karte.dataset.id);
    if (!d) return;
    const text = (entwuerfe.get(d.id)?.text || '').trim();
    const status = karte.querySelector('.wider-form .status');
    if (!text) {
      status.className = 'status schlecht';
      status.textContent = 'Einwand schreiben';
      return;
    }
    if (await senden('/api/handlung', { forge: d.forge, epic: d.nr, art: 'triage-widerruf', nr: null, seit: d.zeit, text }, karte, status)) {
      offen.delete(d.id);
      entwuerfe.delete(d.id);
      karte.querySelector('textarea').value = '';
      await laden();
    }
  }

  function klick(ev) {
    const b = ev.target.closest?.('button');
    if (!b || b.disabled) return;
    const karte = b.closest('[data-id]');
    if (b.dataset.start) return starten(b);
    if (!karte) return;
    const id = karte.dataset.id;
    if (b.dataset.option) {
      const e = entwuerfe.get(id) || {};
      entwuerfe.set(id, { ...e, wahl: e.wahl === b.dataset.option ? null : b.dataset.option });
      return zeichnen(flaeche, letzte, true);
    }
    if (b.matches('[data-antworten]')) return antworten(karte);
    if (b.matches('[data-wider]')) {
      offen.add(id);
      zeichnen(flaeche, letzte, true);
      return [...flaeche.querySelectorAll('[data-id]')].find((x) => x.dataset.id === id)?.querySelector('textarea')?.focus();
    }
    if (b.matches('[data-wzu]')) {
      offen.delete(id);
      entwuerfe.delete(id);
      return zeichnen(flaeche, letzte, true);
    }
    if (b.matches('[data-widerrufen]')) return widerrufen(karte);
  }

  function eingabe(ev) {
    const feld = ev.target;
    const karte = feld.closest?.('[data-id]');
    if (!karte || !feld.matches('textarea')) return;
    entwuerfe.set(karte.dataset.id, { ...(entwuerfe.get(karte.dataset.id) || {}), text: feld.value });
    const f = finde(karte.dataset.id);
    const knopf = karte.querySelector('[data-antworten]');
    if (f && knopf) knopf.textContent = sendeText(f, entwuerfe.get(f.id));
  }

  huelle.bereich({
    name: 'frachtraum',
    titel: 'Frachtraum',
    zeichne(t, el) {
      if (!t) {
        if (!el.childElementCount) el.innerHTML = `${KOPF}<p class="bereich-leer">Lädt …</p>`;
        return;
      }
      letzte = t;
      flaeche = el;
      if (!el.dataset.verdrahtet) {
        el.dataset.verdrahtet = '1';
        el.addEventListener('click', klick);
        el.addEventListener('input', eingabe);
      }
      zeichnen(el, t);
    },
    // the command line finds every Sternzeit-Notiz and every question by number or title
    treffer(t) {
      const mehrere = (t.frachtraum ?? []).length > 1;
      const hin = (sel, pruefe) => () => [...(flaeche?.querySelectorAll(sel) ?? [])].find(pruefe) ?? null;
      const liste = [];
      for (const p of t.frachtraum ?? []) {
        for (const f of p.fragen) liste.push({ art: 'Frage', titel: `#${f.ticket} ${f.frage}`, info: mehrere ? p.kurz : '', ziel: hin('.fr-frage-karte', (x) => x.dataset.id === f.id) });
        const gesehen = new Set();
        for (const th of p.themen) {
          for (const x of th.tickets) {
            if (gesehen.has(x.nr)) continue;
            gesehen.add(x.nr);
            liste.push({ art: 'Sternzeit-Notiz', titel: `#${x.nr} ${x.titel}`, info: mehrere ? p.kurz : '', ziel: hin(`.fr-projekt[data-forge="${CSS.escape(p.forge)}"] .fr-ticket`, (li) => li.querySelector('.nr')?.textContent === `#${x.nr}`) });
          }
        }
      }
      return liste;
    },
  });
})();
