// Bereitschaftsraum (#85, agent-skills/ADR-0004): the chat of the bridge, from `bereitschaftsraum` of
// /api/tafel. The chats by repository with their state (offen, angelegt, verworfen); the open chat with
// its course, the question cards of the last answer as buttons (they go back as text, `Q1 A`), a free
// text, the draft with "Anlegen" and "Anlegen und starten", the links to the created missions, account
// and model per chat. The bridge starts no claude: the service `flotte chat` on a machine fetches the
// messages and answers (SCHNITTSTELLE.md, section 8). Everything the person does needs the PIN. The
// shell (huelle.js) calls zeichne(t, el) on every load while the area is visible; t is null before the
// first load, then the helpers of app.js do not exist yet. All scripts of the page share one scope:
// keep every name inside this call.
'use strict';

(() => {
  const KOPF = (n) => `<h2 class="ek bereich-kopf"><span>Bereitschaftsraum</span><span class="zahl">${n}</span><small>Gespräch → Mission · liest nur im Repository</small></h2>`;
  const STAND = { offen: 'offen', gestoppt: 'gestoppt', angelegt: 'angelegt', verworfen: 'verworfen' };
  const MODELLE = ['claude-opus-5-5', 'opus', 'sonnet', 'haiku'];
  // drafts: chat id -> { text, wahl: { card index: [letters] } }; 'neu' -> the form of a new chat
  const entwuerfe = new Map();
  let letzte = null; // the board of the last drawing, for the clicks
  let flaeche = null; // the section of the area
  let gewaehlt = null; // the chat shown, 'neu' for the form, null: the newest open one
  let neuester = false; // after "Chat beginnen": show the newest chat once it is there
  let archivZeigen = false; // #47: the archived chats in the list

  const raum = () => letzte?.bereitschaftsraum ?? { chats: [], konten: [], projekte: [], pin: false, modell: MODELLE[0] };
  const wann = (iso) => {
    const d = datum(iso);
    if (!d) return '';
    return d.toDateString() === new Date().toDateString() ? uhrzeit(iso) : `${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })} ${uhrzeit(iso)}`;
  };
  // the answer is Markdown: shown as written, only `code` set apart
  const absatz = (s) => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>');
  const marke = (stand) => `<span class="br-stand ${esc(stand)}">${esc(STAND[stand] ?? stand)}</span>`;
  const kontoText = (k) => `Konto ${esc(k.konto)}${k.rechner?.length ? ` · ${esc(k.rechner.join(', '))}` : ''}`;
  const modelle = (id) => `<datalist id="${id}">${MODELLE.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>`;

  // a card: `Q1 — …` gives its label, `A — …` the letter of an option; several letters only where the card says so
  const kartenLabel = (k, i) => k.frage.match(/^\s*(Q\d+)/)?.[1] ?? `Q${i + 1}`;
  const buchstabe = (o) => o.match(/^\s*([A-Z])\b/)?.[1] ?? o.trim();
  const mehrfach = (k) => /mehrfach/i.test(k.frage);

  function gesucht() {
    const r = raum();
    if (gewaehlt === 'neu') return null;
    const sichtbar = r.chats.filter((c) => archivZeigen || !c.archiviert);
    return r.chats.find((c) => c.id === gewaehlt) ?? sichtbar.find((c) => c.stand === 'offen') ?? sichtbar[0] ?? null;
  }

  // ---- the list: chats by repository

  function listeHtml(r, c) {
    const gruppen = new Map();
    const archiv = r.chats.filter((x) => x.archiviert).length;
    for (const x of r.chats.filter((y) => archivZeigen || !y.archiviert)) {
      if (!gruppen.has(x.forge)) gruppen.set(x.forge, []);
      gruppen.get(x.forge).push(x);
    }
    const zeile = (x) => `<li><button type="button" class="br-chat${c && x.id === c.id ? ' aktiv' : ''}" data-chat="${x.id}"${c && x.id === c.id ? ' aria-current="true"' : ''}>
<span class="br-chat-titel">${esc(x.titel)}</span>${marke(x.stand)}${x.archiviert ? '<span class="br-stand archiviert">Archiv</span>' : ''}
<small>${x.wartet ? '<b class="br-wartet">wartet</b> · ' : ''}Konto ${esc(x.konto)} · ${esc(x.modell || r.modell)} · ${esc(wann(x.geaendert))}</small></button></li>`;
    const neu = `<button type="button" class="knopf haupt br-neu" data-neu${gewaehlt === 'neu' ? ' aria-pressed="true"' : ''}>Neuer Chat</button>`;
    if (!r.chats.length) return `${neu}<p class="br-klein">Noch kein Chat.</p>`;
    const umschalter = archiv ? `<button type="button" class="knopf klein zweit br-archiv" data-archiv-zeigen aria-pressed="${archivZeigen}">${archivZeigen ? 'Archiv ausblenden' : `Archiv (${archiv})`}</button>` : '';
    return `${neu}${umschalter}${[...gruppen].map(([forge, xs]) => `<section class="br-repo" aria-label="${esc(forge)}"><h3>${esc(forge.split('/').pop())} <small>${esc(forge)}</small></h3><ul>${xs.map(zeile).join('')}</ul></section>`).join('')}`;
  }

  // ---- a new chat: repository, account, model, the first message

  function neuHtml(r) {
    const e = entwuerfe.get('neu') || {};
    const zu = r.pin && r.konten.length ? '' : ' disabled';
    const hinweis = !r.pin ? `Schreiben abgeschaltet: ${huelle.ohnePin(letzte)}.`
      : !r.konten.length ? 'Noch meldet kein Rechner seine Konten: Starte dort <code>flotte chat --repos &lt;ordner&gt; --bruecke &lt;url&gt;</code>.' : '';
    const konto = e.konto ?? r.konten[0]?.konto ?? '';
    return `<form class="br-form" data-form="neu">
<h3 class="br-unter">Neuer Chat</h3>
<p class="br-klein">Ein Gespräch über ein Repository, aus dem eine Mission, ein Missionsziel oder nichts entsteht. Das Modell liest nur im Repository; angelegt wird erst auf deinen Knopf.</p>
${hinweis ? `<p class="br-klein br-achtung">${hinweis}</p>` : ''}
<div class="br-felder">
<label>Repository<input name="forge" list="br-projekte" required placeholder="owner/name" autocomplete="off" spellcheck="false" value="${esc(e.forge ?? r.projekte[0] ?? '')}"${zu}></label>
<datalist id="br-projekte">${r.projekte.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
<label>Konto<select name="konto"${zu}>${r.konten.map((k) => `<option value="${esc(k.konto)}"${k.konto === konto ? ' selected' : ''}>${kontoText(k)}</option>`).join('')}</select></label>
<label>Modell<input name="modell" list="br-modelle-neu" autocomplete="off" spellcheck="false" value="${esc(e.modell ?? r.modell)}"${zu}></label>${modelle('br-modelle-neu')}
</div>
<textarea name="text" placeholder="Worum geht es? Was soll entstehen?" aria-label="Erste Nachricht"${zu}>${esc(e.text ?? '')}</textarea>
<div class="knoepfe"><button type="submit" class="knopf haupt"${zu}>Chat beginnen</button><span class="status" role="status"></span></div>
</form>`;
  }

  // ---- one chat: head with account and model, the course, cards, draft, missions, the free text

  function verlaufHtml(c, r) {
    return c.verlauf.map((n) => {
      const mensch = n.art === 'anlegen'
        ? `<li class="br-mensch anlegen"><b>${n.starten ? 'Anlegen und starten' : 'Anlegen'}</b> — der Entwurf unten<small>${esc(wann(n.zeit))}</small></li>`
        : `<li class="br-mensch"><div class="br-text">${absatz(n.text)}</div><small>${esc(wann(n.zeit))}</small></li>`;
      if (!n.antwort && c.stand === 'gestoppt' && !n.quittiert) return `${mensch}<li class="br-antwort warten">Angehalten: geht nach „Fortsetzen“ an den Dienst.</li>`;
      if (!n.antwort && c.stand !== 'offen' && !n.quittiert) return `${mensch}<li class="br-antwort warten">Nicht mehr an den Dienst gegangen.</li>`;
      if (!n.antwort) {
        const wo = n.quittiert ? `Übernommen von ${esc(n.rechner)} — die Antwort kommt.` : 'Wartet auf den Dienst <code>flotte chat</code> eines Rechners mit Konto ' + esc(c.konto) + '.';
        return `${mensch}<li class="br-antwort warten" role="status"><span class="br-punkt" aria-hidden="true"></span>${wo}</li>`;
      }
      const a = n.antwort;
      const fehler = a.fehler ? `<p class="br-fehler"><b>Fehler:</b> ${esc(a.fehler)}</p>` : '';
      const text = a.text ? `<div class="br-text">${absatz(a.text)}</div>` : '';
      const entwurf = a.entwurf ? `<p class="br-klein">${c.entwurf?.von === n.id ? 'Mit Entwurf (unten).' : 'Mit einem älteren Entwurf.'}</p>` : '';
      return `${mensch}<li class="br-antwort${a.fehler ? ' fehler' : ''}">${fehler}${text}${entwurf}<small>${esc(wann(a.zeit))}${n.rechner ? ` · ${esc(n.rechner)}` : ''}</small></li>`;
    }).join('');
  }

  function kartenHtml(c, schreibt) {
    if (!c.karten.length || c.wartet || c.stand !== 'offen') return '';
    const wahl = entwuerfe.get(c.id)?.wahl || {};
    const zu = schreibt ? '' : ' disabled';
    return `<div class="br-karten">${c.karten.map((k, i) => {
      const an = wahl[i] || [];
      const opts = k.optionen.map((o) => {
        const b = buchstabe(o);
        const gew = an.includes(b);
        return `<button type="button" class="opt${mehrfach(k) ? ' kaestchen' : ''}${gew ? ' gewaehlt' : ''}" data-karte="${i}" data-option="${esc(b)}" aria-pressed="${gew}"${zu}><span class="b">${esc(b.length === 1 ? b : '·')}</span><span>${esc(o.replace(/^\s*[A-Z]\s*[—–-]\s*/, ''))}</span></button>`;
      }).join('');
      return `<article class="br-karte"><h4>${esc(k.frage)}</h4>${mehrfach(k) ? '<p class="br-klein">Mehrfachwahl</p>' : ''}<div class="optionen" role="group" aria-label="${esc(kartenLabel(k, i))}">${opts}</div></article>`;
    }).join('')}</div>`;
  }

  function entwurfHtml(c, schreibt) {
    if (!c.entwurf) return '';
    const knoepfe = c.anlegbar && schreibt
      ? `<div class="knoepfe"><button type="button" class="knopf zweit" data-anlegen="0">Anlegen</button><button type="button" class="knopf haupt" data-anlegen="1">Anlegen und starten</button><span class="status" role="status"></span></div>
<p class="br-klein">„Anlegen“ legt die Mission und ihre Missionsziele als Sternzeit-Notiz an. „Anlegen und starten“ gibt sie dazu mit Warp frei der Flotte frei. Angelegt wird genau dieser Entwurf.</p>`
      : c.stand === 'offen' && c.wartet ? '<p class="br-klein">Anlegen geht, sobald die Antwort da ist.</p>' : '';
    return `<section class="br-entwurf" aria-label="Entwurf"><h4 class="br-unter">Entwurf</h4><pre>${esc(c.entwurf.text)}</pre>${knoepfe}</section>`;
  }

  function missionenHtml(c) {
    if (!c.missionen.length) return '';
    return `<section class="br-missionen" aria-label="Angelegt"><h4 class="br-unter">Angelegt</h4><ul>${c.missionen.map((m) => `<li><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer"><b>#${esc(m.nummer)}</b> ${esc(m.titel)}</a></li>`).join('')}</ul></section>`;
  }

  function chatHtml(c, r) {
    const schreibt = r.pin && c.stand === 'offen';
    const e = entwuerfe.get(c.id) || {};
    const konten = c.konten.includes(c.konto) ? c.konten : [c.konto, ...c.konten];
    const wahlZu = schreibt ? '' : ' disabled';
    const wahl = `<form class="br-wahl" data-form="einstellung">
<label>Konto<select name="konto"${wahlZu}${c.rechner ? ' title="Das Konto steht fest, seit der Chat eine Sitzung hat."' : ''}>${konten.map((k) => `<option value="${esc(k)}"${k === c.konto ? ' selected' : ''}${c.rechner && k !== c.konto ? ' disabled' : ''}>Konto ${esc(k)}</option>`).join('')}</select></label>
<label>Modell<input name="modell" list="br-modelle" autocomplete="off" spellcheck="false" value="${esc(c.modell || r.modell)}"${wahlZu}></label>${modelle('br-modelle')}
<button type="submit" class="knopf klein zweit"${wahlZu}>Übernehmen</button><span class="status" role="status"></span></form>`;
    // #47: stop, continue, archive; each with the PIN like writing
    const zu = r.pin ? '' : ' disabled';
    const lauf = c.stand === 'offen' ? `<button type="button" class="knopf klein zweit" data-steuern="stoppen"${zu}>Stoppen</button>`
      : c.stand === 'gestoppt' ? `<button type="button" class="knopf klein haupt" data-steuern="fortsetzen"${zu}>Fortsetzen</button>` : '';
    const steuern = `<div class="knoepfe br-steuern">${lauf}<button type="button" class="knopf klein zweit" data-steuern="archivieren"${zu}>${c.archiviert ? 'Aus dem Archiv' : 'Archivieren'}</button><span class="status" role="status"></span></div>`;
    const kopf = `<header class="br-kopf"><h3><span class="br-repo-name">${esc(c.kurz)}</span> ${esc(c.titel)}</h3>${marke(c.stand)}${c.archiviert ? '<span class="br-stand archiviert">Archiv</span>' : ''}
<small class="br-klein">${c.rechner ? `Rechner ${esc(c.rechner)}` : 'noch an keinen Rechner gebunden'} · begonnen ${esc(wann(c.angelegt))}</small>${wahl}${steuern}</header>`;
    const nWahl = Object.values(e.wahl || {}).filter((x) => x.length).length;
    const schreiben = c.stand === 'offen' ? `<form class="br-schreiben" data-form="schreiben">
<textarea name="text" placeholder="${c.karten.length ? 'Eigene Antwort oder Ergänzung (optional zu den Karten)' : 'Nachricht'}" aria-label="Nachricht an den Bereitschaftsraum"${schreibt ? '' : ' disabled'}>${esc(e.text ?? '')}</textarea>
<div class="knoepfe"><button type="submit" class="knopf haupt"${schreibt ? '' : ' disabled'}>${nWahl ? 'Antwort senden' : 'Senden'}</button><button type="button" class="knopf zweit" data-verwerfen${schreibt ? '' : ' disabled'}>Verwerfen</button><span class="status" role="status">${r.pin ? '' : `Schreiben abgeschaltet: ${esc(huelle.ohnePin(letzte))}`}</span></div></form>`
      : `<p class="br-klein">${c.stand === 'gestoppt' ? 'Gestoppt: Kein Rechner bekommt eine Nachricht dieses Chats, bis du ihn fortsetzt. Der Stand bleibt, auch über einen Neustart.' : c.stand === 'angelegt' ? 'Angelegt: Dieser Chat ist abgeschlossen.' : 'Verworfen: Hier entsteht nichts mehr.'}</p>`;
    return `${kopf}<ol class="br-verlauf">${verlaufHtml(c, r)}</ol>${kartenHtml(c, schreibt)}${missionenHtml(c)}${entwurfHtml(c, schreibt)}${schreiben}`;
  }

  function html(t) {
    const r = t.bereitschaftsraum;
    const c = gesucht();
    const offen = r.chats.filter((x) => x.stand === 'offen').length;
    const rechts = c ? chatHtml(c, r) : neuHtml(r);
    return `${KOPF(offen)}<div class="br-flaeche"><nav class="br-liste" aria-label="Chats">${listeHtml(r, c)}</nav><section class="br-gespraech" aria-label="${c ? 'Chat' : 'Neuer Chat'}" tabindex="-1">${rechts}</section></div>`;
  }

  // ---- drawing: a form in use keeps its DOM, the same html leaves it alone

  function zeichnen(el, t, erzwingen = false) {
    if (neuester) {
      const r = t.bereitschaftsraum;
      gewaehlt = r.chats.reduce((m, x) => (x.id > (m ?? 0) ? x.id : m), null);
      neuester = false;
    }
    const neu = html(t);
    if (!erzwingen && el.contains(document.activeElement) && document.activeElement.matches('textarea, input, select')) return;
    if (erzwingen || el.dataset.sig !== neu) {
      el.innerHTML = neu;
      el.dataset.sig = neu;
    }
  }

  const status = (form) => form.querySelector('.status');
  const fehlt = (form, text) => {
    const s = status(form);
    s.className = 'status schlecht';
    s.textContent = text;
  };

  async function beginnen(form) {
    const f = new FormData(form);
    const body = { forge: String(f.get('forge') || '').trim(), konto: String(f.get('konto') || ''), modell: String(f.get('modell') || '').trim() || null, text: String(f.get('text') || '').trim() };
    if (!body.forge || !body.text) return fehlt(form, 'Repository und Nachricht');
    if (await senden('/api/chat', body, form, status(form))) {
      entwuerfe.delete('neu');
      neuester = true;
      await laden();
    }
  }

  async function schreibenSenden(form, c) {
    const e = entwuerfe.get(c.id) || {};
    const zeilen = c.karten.map((k, i) => ((e.wahl || {})[i]?.length ? `${kartenLabel(k, i)} ${e.wahl[i].join(', ')}` : null)).filter(Boolean);
    const frei = (e.text || '').trim();
    if (frei) zeilen.push(frei);
    if (!zeilen.length) return fehlt(form, c.karten.length ? 'Option wählen oder Text schreiben' : 'Text schreiben');
    if (await senden(`/api/chat/${c.id}/nachricht`, { text: zeilen.join('\n') }, form, status(form))) {
      entwuerfe.delete(c.id);
      await laden();
    }
  }

  async function einstellen(form, c) {
    const f = new FormData(form);
    const body = { konto: String(f.get('konto') || c.konto), modell: String(f.get('modell') || '').trim() || null };
    if (await senden(`/api/chat/${c.id}/einstellung`, body, form, status(form))) await laden();
  }

  async function anlegen(b, c) {
    const starten = b.dataset.anlegen === '1';
    const frage = starten
      ? `Diesen Entwurf anlegen und starten? Die Mission und ihre Missionsziele entstehen als Issues in ${c.forge} und bekommen Warp frei: die Flotte kann sie sofort aufnehmen.`
      : `Diesen Entwurf in ${c.forge} anlegen? Die Mission und ihre Missionsziele entstehen als Issues, noch ohne Warp frei.`;
    if (!(await bestaetigen(frage, starten ? 'Anlegen und starten' : 'Anlegen'))) return;
    const zeile = b.closest('.knoepfe');
    if (await senden(`/api/chat/${c.id}/anlegen`, { starten, von: c.entwurf.von }, zeile, zeile.querySelector('.status'))) await laden();
  }

  async function verwerfen(b, c) {
    if (!(await bestaetigen(`Chat „${c.titel}“ verwerfen? Es entsteht nichts; eine noch wartende Nachricht geht nicht mehr an den Dienst. Der Verlauf bleibt zu lesen.`, 'Verwerfen'))) return;
    const zeile = b.closest('.knoepfe');
    if (await senden(`/api/chat/${c.id}/verwerfen`, {}, zeile, zeile.querySelector('.status'))) await laden();
  }

  async function steuern(b, c) {
    const weg = b.dataset.steuern;
    if (weg === 'stoppen' && !(await bestaetigen(`Chat „${c.titel}“ stoppen? Eine wartende Nachricht geht an keinen Rechner, bis du fortsetzt; eine schon laufende Antwort kommt noch.`, 'Stoppen'))) return;
    const zeile = b.closest('.knoepfe');
    const body = weg === 'archivieren' ? { archiviert: !c.archiviert } : {};
    if (await senden(`/api/chat/${c.id}/${weg}`, body, zeile, zeile.querySelector('.status'))) await laden();
  }

  function zumGespraech() {
    const g = flaeche.querySelector('.br-gespraech');
    // on the phone the conversation stands below the list
    if (g && !matchMedia('(min-width: 901px)').matches) g.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    g?.focus({ preventScroll: true });
  }

  function klick(ev) {
    const b = ev.target.closest?.('button');
    if (!b || b.disabled || b.type === 'submit') return;
    const c = gesucht();
    if (b.dataset.chat) {
      gewaehlt = Number(b.dataset.chat);
      zeichnen(flaeche, letzte, true);
      return zumGespraech();
    }
    if (b.matches('[data-archiv-zeigen]')) {
      archivZeigen = !archivZeigen;
      return zeichnen(flaeche, letzte, true);
    }
    if (b.matches('[data-neu]')) {
      gewaehlt = 'neu';
      zeichnen(flaeche, letzte, true);
      zumGespraech();
      return flaeche.querySelector('[data-form="neu"] textarea')?.focus();
    }
    if (!c) return;
    if (b.dataset.option) {
      const i = Number(b.dataset.karte);
      const e = entwuerfe.get(c.id) || {};
      const wahl = { ...(e.wahl || {}) };
      const an = wahl[i] || [];
      const o = b.dataset.option;
      wahl[i] = an.includes(o) ? an.filter((x) => x !== o) : mehrfach(c.karten[i]) ? [...an, o].sort() : [o];
      entwuerfe.set(c.id, { ...e, wahl });
      return zeichnen(flaeche, letzte, true);
    }
    if (b.dataset.anlegen) return anlegen(b, c);
    if (b.matches('[data-verwerfen]')) return verwerfen(b, c);
    if (b.dataset.steuern) return steuern(b, c);
  }

  function absenden(ev) {
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    const c = gesucht();
    if (form.dataset.form === 'neu') return beginnen(form);
    if (!c) return;
    if (form.dataset.form === 'schreiben') return schreibenSenden(form, c);
    if (form.dataset.form === 'einstellung') return einstellen(form, c);
  }

  function eingabe(ev) {
    const feld = ev.target;
    const form = feld.closest?.('form[data-form]');
    if (!form || !feld.name) return;
    if (form.dataset.form === 'neu') entwuerfe.set('neu', { ...(entwuerfe.get('neu') || {}), [feld.name]: feld.value });
    else if (form.dataset.form === 'schreiben') {
      const c = gesucht();
      if (c) entwuerfe.set(c.id, { ...(entwuerfe.get(c.id) || {}), text: feld.value });
    }
  }

  // #47, the command line: "chat anlegen [repository] <first message>" (beginnings of the words suffice). It fills the
  // form of a new chat and sends it like its button, with device and PIN; without a message it only opens the form
  function chatAnlegen(t, eingabe) {
    const r = t.bereitschaftsraum;
    if (!r?.pin || t.nurAnsicht || !r.konten.length || !r.projekte.length) return [];
    const worte = String(eingabe ?? '').trim().split(/\s+/).filter(Boolean);
    const klein = (w) => w.toLocaleLowerCase('de-DE');
    if (worte.length < 2 || !'chat'.startsWith(klein(worte[0])) || !'anlegen'.startsWith(klein(worte[1]))) return [];
    let rest = worte.slice(2);
    const genannt = rest.length && r.projekte.find((f) => [klein(f), klein(f.split('/').pop())].includes(klein(rest[0])));
    if (genannt) rest = rest.slice(1);
    const forge = genannt || r.projekte[0];
    const text = rest.join(' ');
    const formular = () => flaeche?.querySelector('[data-form="neu"]');
    return [{
      art: 'Befehl',
      titel: 'Chat anlegen',
      info: `${forge.split('/').pop()} · ${text ? text.slice(0, 60) : 'Text dahinter wird die erste Nachricht'}`,
      ziel: () => {
        if (!flaeche) return null;
        gewaehlt = 'neu';
        entwuerfe.set('neu', { ...(entwuerfe.get('neu') || {}), forge, text });
        zeichnen(flaeche, letzte, true);
        return formular();
      },
      ausfuehren: () => (text && formular() ? beginnen(formular()) : formular()?.querySelector('textarea')?.focus()),
    }];
  }

  huelle.bereich({
    name: 'bereitschaftsraum',
    titel: 'Bereitschaftsraum',
    zeichne(t, el) {
      if (!t) {
        if (!el.childElementCount) el.innerHTML = `${KOPF(0)}<p class="bereich-leer">Lädt …</p>`;
        return;
      }
      letzte = t;
      flaeche = el;
      if (!el.dataset.verdrahtet) {
        el.dataset.verdrahtet = '1';
        el.addEventListener('click', klick);
        el.addEventListener('submit', absenden);
        el.addEventListener('input', eingabe);
        el.addEventListener('change', eingabe);
      }
      zeichnen(el, t);
    },
    // the command line finds every chat by its first line or repository, and (#47) runs "Chat anlegen"
    treffer(t, eingabe) {
      return [...chatAnlegen(t, eingabe), ...(t.bereitschaftsraum?.chats ?? []).map((c) => ({
        art: 'Chat',
        titel: c.titel,
        info: `${c.kurz} · ${STAND[c.stand] ?? c.stand}`,
        ziel: () => {
          if (!flaeche) return null;
          gewaehlt = c.id;
          zeichnen(flaeche, letzte, true);
          return flaeche.querySelector('.br-gespraech');
        },
      }))];
    },
  });
})();
