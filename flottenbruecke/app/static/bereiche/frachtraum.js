// Frachtraum (#116): the Sternzeit-Notizen of every project, from `frachtraum` of /api/tafel (the driver
// reads them from the forge, the bridge bundles them by project and topic). Per project: the critical
// questions of the triage with a button per option (the recommendation marked) and a free text, the
// decisions of the triage runs to read and revoke, (#148) the cut plan of the last run with "Widerrufen" per
// mission, (#147) how the last run ended, the notes by topic, and "Triage-Lauf starten" (also for all projects). Every action needs the PIN; the driver carries it out from its next turn on, always
// as a comment at the ticket. The shell (huelle.js) calls zeichne(t, el) on every load while the area is
// visible; t is null before the first load, then the helpers of app.js do not exist yet. All scripts of
// the page share one scope: keep every name inside this call.
'use strict';

(() => {
  const KOPF = '<h2 class="ek bereich-kopf">Frachtraum</h2>';
  const ERGEBNIS = { klar: 'Warp frei', ueberfluessig: 'geschlossen' };
  const WIDERRUF = { klar: 'Warp frei wird zurückgenommen, die Notiz wird wieder eine Sternzeit-Notiz.', ueberfluessig: 'Die Notiz wird wieder geöffnet.' };
  // #148: the state of a mission of the cut plan, what closed a note, what a revocation does
  const ZUSTAND = { frei: 'Warp frei', offen: 'nicht freigegeben', widerrufen: 'widerrufen', fehler: 'Fehler' };
  const GESCHLOSSEN = { zusammengefuehrt: 'zusammengeführt', ueberfluessig: 'überflüssig', verworfen: 'verworfen' };
  const MISSION_WIDERRUF = {
    neu: 'Warp frei wird zurückgenommen, ein laufender Außeneinsatz angehalten; die Missionsziele kehren als Sternzeit-Notizen in die Triage zurück, die Mission wird als „not planned“ geschlossen (nicht gelöscht).',
    alt: 'Nur die Missionsziele, die der Triage-Lauf angehängt hat, kehren als Sternzeit-Notizen in die Triage zurück; die Mission bleibt, wie sie ist.',
  };
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
<div class="knoepfe"><button type="button" class="knopf haupt" data-antworten${zu}>${esc(sendeText(f, e))}</button><span class="status" role="status">${pin ? '' : `Antworten abgeschaltet: ${huelle.ohnePin(letzte)}`}</span></div>`;
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
      fuss = `<button type="button" class="wider" data-wider aria-expanded="${auf}">› Widerrufen</button>${auf ? widerrufForm(d.id, WIDERRUF[d.ergebnis] ?? '', `Einwand gegen die Entscheidung zu #${d.nr}`) : ''}`;
    }
    return `${kopf}${warum}${fuss}`;
  }

  // ---- #148: the cut plan of the last triage run: each mission with its children and "Widerrufen", the closed notes

  function widerrufForm(id, erklaerung, label) {
    return `<div class="wider-form"><p class="fr-klein">${esc(erklaerung)} Dein Einwand steht vorher als Kommentar am Ticket; der nächste Triage-Lauf nimmt ihn als Tatsache.</p><textarea placeholder="Dein Einwand" aria-label="${esc(label)}" data-text>${esc(entwuerfe.get(id)?.text ?? '')}</textarea><div class="knoepfe"><button type="button" class="knopf haupt" data-widerrufen>Widerruf senden</button><button type="button" class="knopf zweit" data-wzu>Abbrechen</button><span class="status" role="status"></span></div></div>`;
  }

  function missionHtml(m, pin) {
    const kopf = `<div class="fr-zeile">${link(m.issueUrl, `#${m.nr}`, 'nr')}<span class="fr-titel">${esc(m.titel)}</span><span class="fr-ergebnis ${esc(m.zustand)}">${esc(ZUSTAND[m.zustand] ?? m.zustand)}</span><span class="fr-seit">${m.neu ? 'neue Mission' : 'bestehende Mission'}</span></div>`;
    const warum = m.begruendung ? `<p class="warum">${esc(m.begruendung)}</p>` : '';
    const fehler = m.fehler ? `<p class="warum fr-fehler"><b>Fehler:</b> ${esc(m.fehler)}</p>` : '';
    const kinder = m.kinder.length
      ? `<ul class="fr-tickets fr-kinder" aria-label="Missionsziele von #${m.nr}">${m.kinder.map((k) => `<li class="fr-ticket">${link(k.issueUrl, `#${k.nr}`, 'nr')}<span class="fr-titel">${esc(k.titel)}${k.grund ? ` <span class="fr-herkunft">— ${esc(k.grund)}</span>` : ''}</span></li>`).join('')}</ul>`
      : '<p class="fr-klein">Kein Missionsziel angehängt.</p>';
    let fuss = '';
    if (m.widerrufen) fuss = `<p class="warum widerrufen">widerrufen → ${esc(m.widerrufen)}</p>`;
    else if (m.handlung) fuss = `<div>${unterwegs(m.handlung, 'Widerruf')}</div>`;
    else if (pin && m.widerrufbar) {
      const auf = offen.has(m.id);
      fuss = `<button type="button" class="wider" data-wider aria-expanded="${auf}">› Widerrufen</button>${auf ? widerrufForm(m.id, MISSION_WIDERRUF[m.neu ? 'neu' : 'alt'], `Einwand gegen Mission #${m.nr}`) : ''}`;
    }
    return `${kopf}${warum}${fehler}<h5 class="fr-klein-kopf">Missionsziele</h5>${kinder}${fuss}`;
  }

  function notizHtml(n) {
    const wie = n.art === 'zusammengefuehrt' && n.verweis ? `zusammengeführt in ${link(n.verweisUrl, `#${n.verweis}`)}` : esc(GESCHLOSSEN[n.art] ?? n.art);
    const fund = n.fundstelle ? ` <span class="fr-herkunft">(Fundstelle: ${esc(n.fundstelle)})</span>` : '';
    return `<li class="fr-ticket">${link(n.issueUrl, `#${n.nr}`, 'nr')}<span class="fr-titel">${esc(n.titel)}</span><span class="fr-label">${wie}</span><span class="fr-grund">${esc(n.grund)}${fund}${n.fehler ? ` <span class="fr-fehler">Fehler: ${esc(n.fehler)}</span>` : ''}</span></li>`;
  }

  function schnittHtml(s, pin) {
    if (!s) return '';
    const kopf = `<h4 class="fr-unter">Schnittplan <span class="fr-klein">des letzten Triage-Laufs · ${esc(wann(s.zeit))}</span></h4>`;
    const fehler = s.fehler ? `<p class="warum fr-fehler"><b>Kein Schnittplan:</b> ${esc(s.fehler)}</p>` : '';
    const missionen = s.missionen.length ? `<ol class="fr-liste">${s.missionen.map((m) => `<li class="fr-karte fr-mission ${esc(m.zustand)}" data-id="${esc(m.id)}">${missionHtml(m, pin)}</li>`).join('')}</ol>` : '';
    const notizen = s.notizen.length ? `<section class="fr-thema fr-geschlossen"><h5>Zusammengeführt und geschlossen <span class="fr-anzahl">${s.notizen.length}</span></h5><ul class="fr-tickets">${s.notizen.map(notizHtml).join('')}</ul></section>` : '';
    if (!fehler && !missionen && !notizen) return `${kopf}<p class="fr-klein">Der letzte Lauf hat keine Mission angelegt oder ergänzt und keine Notiz geschlossen.</p>`;
    return `${kopf}${fehler}${missionen}${notizen}`;
  }

  // ---- #147: how the last triage run ended: the notes not cleanly worked off, or why it was aborted

  function abschlussHtml(a) {
    if (!a || a.zustand === 'beendet') return '';
    if (a.zustand === 'abgebrochen') return `<p class="warum fr-fehler"><b>Triage-Lauf abgebrochen</b> · ${esc(wann(a.zeit))}${a.grund ? `: ${esc(a.grund)}` : ''}</p>`;
    const liste = a.abweichungen.map((x) => `<li class="fr-ticket">${link(x.issueUrl, `#${x.nr}`, 'nr')}<span class="fr-titel">${esc(x.titel)}</span><span class="fr-label">${esc(x.zustand)}</span><span class="fr-grund fr-fehler">${esc(x.grund)}</span></li>`).join('');
    return `<section class="fr-thema fr-unsauber"><h5 class="fr-fehler">${zahl(a.abweichungen.length, 'Notiz', 'Notizen')} nicht sauber abgearbeitet <span class="fr-klein">Triage-Lauf unvollständig · ${esc(wann(a.zeit))}</span></h5><ul class="fr-tickets">${liste}</ul></section>`;
  }

  // ---- the Sternzeit-Notizen by topic; a ticket with two topics stands in both

  const ticketHtml = (x, thema) => `<li class="fr-ticket${x.frage ? ' gefragt' : ''}">${link(x.issueUrl, `#${x.nr}`, 'nr')}<span class="fr-titel">${esc(x.titel)}</span>${x.frage ? '<span class="fr-marke">Frage an dich</span>' : ''}${x.themen.filter((t) => t !== thema).map((t) => `<span class="fr-label">${esc(t)}</span>`).join('')}</li>`;

  // #148: the short info in the head of the project: started (waits for the driver), running, ended; the board decides which
  function kurzHtml(p) {
    const k = p.kurzinfo;
    if (!k) return '';
    const zeit = wann(k.seit);
    const seit = zeit ? `<span class="fr-klein">${k.zustand === 'beendet' ? 'beendet' : 'gestartet'} ${esc(zeit)}</span>` : '';
    if (k.zustand === 'unterwegs') return `<div class="fr-kurz" role="status"><b>Triage-Lauf gestartet — wartet auf den Treiber</b>${seit}${k.abgeholt ? '<span class="fr-klein">abgeholt, der Treiber startet ihn gleich</span>' : ''}</div>`;
    if (k.zustand === 'laeuft' && k.still) return `<div class="fr-kurz still" role="status"><b>Triage-Lauf läuft laut letztem Bericht — der Treiber meldet sich nicht.</b>${seit}</div>`;
    if (k.zustand === 'laeuft') return `<div class="fr-kurz laeuft" role="status"><b>Triage-Lauf läuft — bitte warten.</b> <span>Danach erscheinen hier Fragen an dich, darunter die Entscheidungen und der Schnittplan.</span>${seit}${k.fortschritt ? `<span class="fr-klein">Notiz ${k.fortschritt.n} von ${k.fortschritt.m}</span>` : ''}</div>`;
    if (k.gescheitert) return `<div class="fr-kurz gescheitert" role="status"><b>Triage-Lauf gescheitert</b>${k.fehler ? `<span>${esc(k.fehler)}</span>` : ''}${seit}</div>`;
    if (k.fehler) return `<div class="fr-kurz gescheitert" role="status"><b>Triage-Lauf beendet — Schnittplan ungültig, nichts geschrieben</b><span>${esc(k.fehler)}</span>${seit}</div>`;
    const sprung = k.fragen && p.fragen.length ? '<button type="button" class="knopf zweit" data-zu-fragen>Zu den Fragen</button>' : '';
    // #147: the same run ended aborted or incomplete: the line says so, the list of the notes stands below it
    if (k.abschluss?.zustand === 'abgebrochen') return `<div class="fr-kurz gescheitert" role="status"><b>Triage-Lauf abgebrochen${k.abschluss.grund ? `: ${esc(k.abschluss.grund)}` : ''}</b><span>Was bis dahin geschrieben war, steht unten.</span>${seit}${sprung}</div>`;
    if (k.abschluss?.zustand === 'unvollstaendig') return `<div class="fr-kurz gescheitert" role="status"><b>Triage-Lauf unvollständig: ${zahl(k.epics, 'Epic', 'Epics')}, ${zahl(k.fragen, 'Frage', 'Fragen')} an dich — ${zahl(k.abschluss.unsauber, 'Notiz', 'Notizen')} nicht sauber abgearbeitet</b><span>Liste unten.</span>${seit}${sprung}</div>`;
    return `<div class="fr-kurz beendet" role="status"><b>Triage-Lauf beendet: ${zahl(k.epics, 'Epic', 'Epics')}, ${zahl(k.fragen, 'Frage', 'Fragen')} an dich</b>${seit}${sprung}</div>`;
  }

  function startHtml(p, pin) {
    if (p.laeuft || p.handlung) return '';
    return pin ? `<button type="button" class="knopf zweit" data-start="${esc(p.forge)}">Triage-Lauf starten</button>` : '';
  }

  function projektHtml(p, pin) {
    const still = p.veraltet ? ' · Treiber still' : p.aktiv ? '' : ' · beendet';
    const gelesen = p.gelesen ? `Stand der Forge ${esc(wann(p.gelesen))}` : 'Der Treiber hat die Forge noch nicht gelesen';
    const fragen = p.fragen.length ? `<h4 class="fr-unter fr-fragen" tabindex="-1">Fragen an dich</h4><div class="fr-reihe">${p.fragen.map((f) => `<article class="fr-karte fr-frage-karte" data-id="${esc(f.id)}">${frageHtml(f, pin)}</article>`).join('')}</div>` : '';
    const entsch = p.entscheidungen.length ? `<h4 class="fr-unter">Entscheidungen des Triage-Laufs</h4><ol class="fr-liste">${p.entscheidungen.map((d) => `<li class="fr-karte fr-entscheidung ${esc(d.ergebnis)}" data-id="${esc(d.id)}">${entscheidungHtml(d, pin)}</li>`).join('')}</ol>` : '';
    const themen = p.themen.length
      ? `<h4 class="fr-unter">Sternzeit-Notizen nach Thema</h4><div class="fr-themen">${p.themen.map((t) => `<section class="fr-thema"><h5>${esc(t.thema)} <span class="fr-anzahl">${t.tickets.length}</span></h5><ul class="fr-tickets">${t.tickets.map((x) => ticketHtml(x, t.thema)).join('')}</ul></section>`).join('')}</div>`
      : '<p class="bereich-leer">Keine offene Sternzeit-Notiz.</p>';
    return `<section class="fr-projekt${p.veraltet ? ' veraltet' : ''}" data-forge="${esc(p.forge)}">
<h3 class="fr-kopf">${link(p.url, esc(p.kurz), 'fr-name')}<span class="fr-zahl">${zahl(p.zahl, 'Sternzeit-Notiz', 'Sternzeit-Notizen')}${p.fragen.length ? ` · ${zahl(p.fragen.length, 'Frage', 'Fragen')} an dich` : ''}${still}</span></h3>
${kurzHtml(p)}
<div class="knoepfe fr-start">${startHtml(p, pin)}<span class="fr-klein">${gelesen}</span><span class="status" role="status"></span></div>
${abschlussHtml(p.abschluss)}${fragen}${schnittHtml(p.schnittplan, pin)}${entsch}${themen}</section>`;
  }

  function html(t) {
    const ps = t.frachtraum ?? [];
    if (!ps.length) return `${KOPF}<p class="bereich-leer">Noch kein Treiber meldet Sternzeit-Notizen.</p>`;
    const frei = ps.filter((p) => !p.laeuft && !p.handlung);
    const alle = t.pin && ps.length > 1 ? `<div class="knoepfe fr-alle"><button type="button" class="knopf zweit" data-start="alle"${frei.length ? '' : ' disabled'}>Triage-Lauf für alle</button><span class="status" role="status"></span></div>` : '';
    const hinweis = `<p class="fr-hinweis">Der Triage-Lauf klärt jede Sternzeit-Notiz selbst; nur was nach der Liste „beim Menschen“ zu dir gehört, steht hier als Frage. Die Missionen seines Schnittplans gibt er selbst frei; du kannst jede widerrufen. Antworten und Widerrufe stehen als Kommentar am Ticket, nichts nur hier. ${t.pin ? 'Jede Handlung braucht die PIN und wirkt ab dem nächsten Takt des Treibers.' : `Handeln abgeschaltet: ${huelle.ohnePin(t)}.`}</p>`;
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
      const x = p.fragen.find((f) => f.id === id) ?? p.entscheidungen.find((d) => d.id === id) ?? p.schnittplan?.missionen.find((m) => m.id === id);
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
    // #148: a mission of the cut plan, else a decision of the triage run
    const body = d.id.startsWith('schnitt:') ? { forge: d.forge, epic: d.nr, art: 'schnitt-widerruf', nr: null, seit: null, text } : { forge: d.forge, epic: d.nr, art: 'triage-widerruf', nr: null, seit: d.zeit, text };
    if (await senden('/api/handlung', body, karte, status)) {
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
    if (b.matches('[data-zu-fragen]')) {
      const ziel = b.closest('.fr-projekt')?.querySelector('.fr-fragen');
      ziel?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return ziel?.focus({ preventScroll: true });
    }
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
        for (const m of p.schnittplan?.missionen ?? []) liste.push({ art: 'Mission', titel: `#${m.nr} ${m.titel}`, info: mehrere ? p.kurz : '', ziel: hin('.fr-mission', (x) => x.dataset.id === m.id) });
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
