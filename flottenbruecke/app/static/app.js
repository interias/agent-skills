// Flottenbrücke v2 (#28): three levels by what the person has to do. The board refreshes itself
// every 10 s; items change in place and only when their content changed, a card someone is
// answering is left alone. Motion: the alarm of level 1, the life sign of each run, the beat in the
// elbow, the ticker of the logbook, cards that move between levels. prefers-reduced-motion stops it.
'use strict';

const TAKT_MS = 10000;
const PIN_KEY = 'flottenbruecke-pin';
const STILL = matchMedia('(prefers-reduced-motion: reduce)');
const BREIT = matchMedia('(min-width: 701px)');
const WORT = { ok: 'ok', warn: 'warn', hold: 'halt' };
const PHASE = { implementer: 'Ingenieur', review: 'Erster Offizier', nachbesserung: 'Nachbesserung', merge: 'Andocken', abgebrochen: 'Prüfung abgebrochen' };
const STUFE = { mechanisch: 'Mechanisch', standard: 'Standard', urteil: 'Urteil', 'urteil-hoch': 'Urteil hoch' };
const PAKET = { fertig: 'fertig', laeuft: 'läuft', geparkt: 'geparkt (Frage)', blockiert: 'blockiert', zurueckgelassen: 'zurückgelassen', offen: 'offen' };
const HANDLUNG = { einreihen: 'Neu einreihen', aufgeben: 'Aufgeben', widerruf: 'Widerruf', aufnehmen: 'Aufnehmen', pausieren: 'Pausieren', fortsetzen: 'Fortsetzen', prioritaet: 'Priorität', merge: 'Andocken' };
// #112: how a mission merges (the key stays merge): the driver after the gate, or a person looks at every PR
const ANDOCKEN = { automatisch: 'automatisch nach Andockprüfung', mensch: 'Mensch prüft jedes Andocken' };
const andockenWort = (text) => (text ? ANDOCKEN[text] ?? text : 'zurück zum Vorschlag');
const VON = { mensch: 'Mensch', admiral: 'Admiral', lauf: 'Lauf' };
// the label of a card's line (lage), from the driver
const ETIKETT = { arbeitet: 'Arbeitet', prueft: 'Prüft', wartet_auf_dich: 'Wartet auf dich', wartet: 'Wartet', gestoppt: 'Gestoppt', fertig: 'Fertig' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const datum = (iso) => { const t = iso ? new Date(iso) : null; return t && !isNaN(t) ? t : null; };
const uhrzeit = (iso) => datum(iso)?.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) ?? '';
const lager = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
  weg(k) { try { localStorage.removeItem(k); } catch { /* private window */ } },
};
// #46: the PIN pairs a device and, at the machine, gives rights and releases the emergency stop; a paired device with
// the right acts without it (Stefan, 24.11.2026). It never stays on the device: held only in this page's memory for the
// few requests of one change at the machine, and an older page's stored one is removed
lager.weg(PIN_KEY);
const PIN_FRIST_MS = 30000;
let pinKurz = null;
const pinHolen = () => (pinKurz && pinKurz.bis > Date.now() ? pinKurz.pin : null);
const pinMerken = (pin) => { pinKurz = pin ? { pin, bis: Date.now() + PIN_FRIST_MS } : null; };

let stand = null;
let versatz = 0; // server time minus local time
let erstes = true;
const entwurf = new Map(); // question key -> { wahl, text, frei, aendern }
const auf = new Set(); // opened details: lage, log, pakete, widerruf forms

const jetzt = () => Date.now() + versatz;
const minuten = (s) => Math.max(0, Math.round(s / 60));
function dauer(s) {
  const m = minuten(s);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
// a duration the page counts itself between reports: {} in data-text becomes the time since data-ab
// (or up to data-bis); the html stays the same, so a card is not drawn anew every minute
const zeitHtml = (ab, text, bis, cls = 'rel') => (datum(ab) ? `<span class="${cls}" data-ab="${esc(ab)}"${bis ? ` data-bis="${esc(bis)}"` : ''} data-text="${esc(text)}"></span>` : '');
const seitS = (iso) => (datum(iso) ? (jetzt() - datum(iso)) / 1000 : null);

// ---- Tag Q: the usage of a mission (tokens, cache share, estimated share of the week), shared with verlauf.js and the
// Maschinenraum. The share is always an estimate, so it always carries ≈; no money value anywhere
const VERBRAUCH_METHODE = '≈ geschätzt: Wochenanteil des Kontos geteilt durch die gewichteten Tokens aller Missionsläufe auf dem Konto in diesem Wochenfenster, mal die gewichteten Tokens der Mission; andere Arbeit auf dem Konto zählt mit, die Zahl liegt eher zu hoch.';
const VERBRAUCH_MARKE = 'Markiert ab dem Doppelten des Mittels vergleichbarer abgeschlossener Missionen (gleiche Paketzahl ± 1, sonst alle) oder bei einer Cache-Quote unter 70 % (ab 500 000 Eingabe-Tokens).';
const kontoKurz = (k) => String(k ?? '').replace(/^Konto (\d+)$/, 'K$1');
function tokZahl(n) {
  const z = (x, d) => x.toLocaleString('de-DE', { maximumFractionDigits: d });
  if (n >= 999500) return `${z(n / 1e6, 1)} Mio`;
  if (n >= 1000) return `${z(Math.round(n / 1e3), 0)} Tsd`;
  return z(n ?? 0, 0);
}
function tokText(n) {
  return `${tokZahl(n)} Tok`;
}
function anteilText(a) {
  return a == null ? '' : `≈${a.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}
function cacheText(q) {
  return q == null ? '' : `Cache ${Math.round(q * 100)} %`;
}
// the breakdown behind a sum, one kind per line (the title of the card's line, the sheet's sum and each row)
function verbrauchTitel(v) {
  return [`Eingabe ${tokZahl(v.eingabe)}`, `Cache-Schreiben ${tokZahl(v.cache_schreiben)}`, `Cache-Lesen ${tokZahl(v.cache_lesen)}`, `Ausgabe ${tokZahl(v.ausgabe)}`, `gewichtet ${tokZahl(v.gewichtet)} (Eingabe + 1,25 × Schreiben + 0,1 × Lesen + 5 × Ausgabe)`].join('\n');
}

// ---- header: clock, accounts as tanks, RAM and disk, projects

function rest(f) {
  return f ? Math.max(0, Math.min(100, 100 - f.verbraucht)) : null;
}
function fensterHtml(name, f) {
  if (!f) return '';
  const r = rest(f);
  const farbe = r < 20 ? 'var(--rot)' : r < 40 ? 'var(--gold)' : 'var(--gruen)';
  const t = datum(f.reset);
  const tag = t && t - jetzt() > 20 * 3600e3 ? t.toLocaleDateString('de-DE', { weekday: 'short' }) + ' ' : '';
  return `<span class="fenster" title="${esc(name)}: ${Math.round(r)} % übrig, zurückgesetzt ${esc(tag)}${esc(uhrzeit(f.reset))}"><span>${esc(name)}</span><span class="roehre"><i style="--w:${r}%;--f:${farbe}"></i></span><span><b>${Math.round(r)} %</b> <span class="uebrig">übrig</span> <span class="reset">bis ${esc(tag)}${esc(uhrzeit(f.reset))}</span></span></span>`;
}

function kopf(t) {
  $('uhr').textContent = uhrzeit(t.jetzt);
  const neuester = t.projekte.map((p) => p.empfangen).sort().pop();
  $('stand').textContent = neuester ? `Bericht ${uhrzeit(neuester)}` : 'Kein Bericht';
  const teile = [];
  for (const k of t.konten) {
    const alt = k.veraltet || (k.alterMin != null && k.alterMin > 30);
    const fenster = fensterHtml('Hauptenergie', k.fuenf) + fensterHtml('Reserveenergie', k.woche);
    teile.push(`<span class="tank ${esc(k.stufe)}${alt ? ' veraltet' : ''}" title="Verbrauch ${esc(k.konto)}: Stufe ${esc(k.stufe)}${k.alterMin != null ? `, Wert ${Math.round(k.alterMin)} min alt` : ''}"><span class="tank-name">${esc(k.konto.replace(/^Konto /, 'K'))}</span>${fenster || `<span class="fenster">${esc(k.stufe)}</span>`}</span>`);
  }
  const mehrere = t.rechner.length > 1;
  for (const r of t.rechner) {
    const wo = mehrere && r.name ? `${esc(r.name)} · ` : '';
    const v = r.veraltet ? ' veraltet' : '';
    if (r.ram) teile.push(`<span class="anzeige${v}">${wo}RAM <b class="${esc(r.ram.stufe)}">${esc(WORT[r.ram.stufe] ?? r.ram.stufe)}</b>${r.ram.prozent != null ? ` <span class="zahl">${Math.round(r.ram.prozent)} %</span>` : ''}</span>`);
    if (r.platte) teile.push(`<span class="anzeige${v}">${wo}Platte <b class="${r.platte.genug ? 'ok' : 'knapp'}">${r.platte.genug ? 'ok' : 'knapp'}</b>${r.platte.freiGb != null ? ` <span class="zahl">${Math.round(r.platte.freiGb)} GB</span>` : ''}</span>`);
  }
  setze($('anzeigen'), teile.join(''));
  setze($('projekte'), t.projekte.map((p) => {
    const art = p.veraltet ? 'veraltet' : p.aktiv ? '' : 'aus';
    const was = p.veraltet ? `still seit ${uhrzeit(p.empfangen)}` : p.aktiv ? `${uhrzeit(p.empfangen)}` : 'beendet';
    const name = p.url ? `<a href="${esc(p.url)}" style="color:inherit">${esc(p.kurz)}</a>` : esc(p.kurz);
    return `<span class="projekt ${art}" title="${esc(p.forge)}">${name} <small>${esc(was)}</small></span>`;
  }).join(''));
  $('leer').hidden = t.projekte.length > 0;
}

function setze(el, html) {
  if (el.dataset.sig !== html) {
    el.innerHTML = html;
    el.dataset.sig = html;
  }
}

// ---- keyed lists: an item changes only when its html changed and nobody works on it

function liste(box, items, html, verdrahten, tag = 'article') {
  const da = new Map([...box.children].filter((el) => el.dataset.id).map((el) => [el.dataset.id, el]));
  const reihe = [];
  for (const it of items) {
    let el = da.get(it.id);
    const h = html(it);
    if (!el) {
      el = document.createElement(tag);
      el.dataset.id = it.id;
    }
    if (el.dataset.sig !== h && !inArbeit(el)) {
      el.innerHTML = h;
      el.dataset.sig = h;
      verdrahten?.(el, it);
    }
    el.className = klasse(it);
    if (it.flip) el.dataset.flip = it.flip;
    reihe.push(el);
    da.delete(it.id);
  }
  for (const el of da.values()) el.remove();
  for (const el of [...box.children]) if (!el.dataset.id) el.remove();
  reihe.forEach((el, i) => { if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null); });
}

function klasse(it) {
  return {
    frage: 'karte frage', blockade: 'karte blockade',
    lauf: `karte lauf${wartetAufDich(it) ? ' wartet' : ''}`, schlange: 'karte lauf schlange', bereit: 'b-ep',
  }[it.form] ?? (it.form === 'zeile' ? `${it.art}${it.neu ? ' neu' : ''}` : '');
}

function inArbeit(el) {
  if (el.contains(document.activeElement) && document.activeElement !== document.body) return true;
  // a revocation being written, on level 3 or in the detail of an epic (#52)
  if ([...el.querySelectorAll('.wider-form textarea')].some((f) => f.value.trim())) return true;
  const e = entwurf.get(el.dataset.id);
  return Boolean(e && (e.wahl?.length || e.text || e.aendern));
}

// ---- level 1: questions and blockades

function ebene1(t) {
  const n = t.braucht.length;
  const e1 = $('e1');
  e1.classList.toggle('alarm', n > 0);
  e1.classList.toggle('ruhig', n === 0);
  $('e1-zahl').textContent = n;
  const aeltest = Math.max(0, ...t.braucht.map((x) => seitS(x.seit) ?? 0));
  $('e1-klein').textContent = n ? `älteste wartet ${dauer(aeltest)}` : '';
  const box = $('e1-liste');
  if (!n) {
    setze(box, '<p class="ruhe">Nichts wartet auf dich.</p>');
    return;
  }
  if (box.dataset.sig) { box.innerHTML = ''; delete box.dataset.sig; }
  liste(box, t.braucht.map((x) => ({ ...x, form: x.art, flip: x.art === 'blockade' ? x.id : x.id })), (x) => (x.art === 'frage' ? frageHtml(x, t) : blockadeHtml(x, t)), (el, x) => (x.art === 'frage' ? frageVerdrahten(el, x) : blockadeVerdrahten(el, x)));
}

function nrLink(x, nr = x.epic) {
  return x.issueUrl ? `<a class="nr" href="${esc(x.issueUrl)}">#${nr}</a>` : `<span class="nr">#${nr}</span>`;
}

function haelt(x) {
  if (x.ganzerLauf) return 'hält den ganzen Lauf';
  const n = x.geparkt?.length || 1;
  return `hält ${n}${x.paketeGesamt ? ` von ${x.paketeGesamt}` : ''} ${n === 1 && !x.paketeGesamt ? 'Paket' : 'Paketen'}`.replace(/hält 1 Paketen/, 'hält 1 Paket');
}

// "A) <…, Folge>": the part after the first comma is the consequence, shown softer
function teile(text) {
  const i = text.indexOf(', ');
  return i > 0 && i < text.length - 2 ? [text.slice(0, i), text.slice(i + 2)] : [text, ''];
}

function marken(x) {
  const m = [];
  if (x.umkehrbar === true) m.push('<span class="m um">umkehrbar bis zum Andocken</span>');
  else if (x.umkehrbar === false) m.push(`<span class="m bleibt">${esc(x.marke || 'Entscheidung')} · bleibt</span>`);
  else if (x.marke) m.push(`<span class="m">${esc(x.marke)}</span>`);
  return m.length ? `<div class="marken">${m.join('')}</div>` : '';
}

function frageHtml(x, t) {
  const e = entwurf.get(x.id) || {};
  const titel = x.frage ? esc(x.frage) : 'Der Lauf fragt (Wortlaut)';
  const kopfz = `<div class="kopfz">${nrLink(x)}<span class="art">Frage ${x.nr} · ${esc(x.repo)}${x.konto ? ` · ${esc(x.konto)}` : ''}</span><span class="warte">${zeitHtml(x.seit, 'wartet {}')} · ${esc(haelt(x))}</span></div>`;
  const lage = x.frage
    ? (x.lage ? `<p class="lage kurz${auf.has(`lage:${x.id}`) ? ' auf' : ''}">${esc(x.lage)}</p>${x.lage.length > 220 ? `<button type="button" class="mehr-lage" data-lage>${auf.has(`lage:${x.id}`) ? 'weniger' : 'ganze Lage'}</button>` : ''}` : '')
    : `<div class="roh">${esc(x.roh || '(leer)')}</div>`;
  const warum = x.grund ? `<p class="warum"><b>Liegt bei dir:</b> ${esc(x.grund)}</p>` : '';
  const wortlaut = x.frage && x.roh ? `<details class="wortlaut"><summary>Wortlaut des Laufs</summary><div class="roh">${esc(x.roh)}</div></details>` : '';
  const vorne = `${kopfz}<h3>${titel}</h3>${lage}${marken(x)}${warum}`;
  if (x.antwort && (x.antwort.abgeholt || !e.aendern)) {
    const st = x.antwort.abgeholt ? 'Angekommen, Lauf setzt fort' : x.aktiv ? 'Angekommen · der Treiber holt sie im nächsten Takt ab' : 'Angekommen · kein Treiber läuft, er holt sie bei seinem nächsten Start ab';
    const aendern = x.antwort.abgeholt ? '' : '<button type="button" class="knopf zweit klein" data-aendern>ändern</button>';
    const text = [x.antwort.option, x.antwort.text].filter(Boolean).join(' — ');
    return `${vorne}<div class="angekommen"><span>Deine Antwort: <b>${esc(text)}</b></span><span class="status gut">${uhrzeit(x.antwort.zeit)} · ${st}</span>${aendern ? `<div>${aendern}</div>` : ''}</div>${wortlaut}`;
  }
  const wahl = e.wahl || [];
  const opts = x.optionen.map((o) => {
    const emp = x.empfohlen.includes(o.buchstabe);
    const an = wahl.includes(o.buchstabe);
    const [haupt, folge] = teile(o.text);
    const rolle = x.mehrfach ? `role="checkbox" aria-checked="${an}"` : `aria-pressed="${an}"`;
    return `<button type="button" class="opt${x.mehrfach ? ' kaestchen' : ''}${emp ? ' empfohlen' : ''}${an ? ' gewaehlt' : ''}" data-b="${esc(o.buchstabe)}" ${rolle}><span class="b">${esc(o.buchstabe)}</span><span>${esc(haupt)}${emp ? '<span class="empf">Empfehlung</span>' : ''}</span>${folge ? `<span class="folge">${esc(folge)}</span>` : ''}</button>`;
  }).join('');
  const frei = e.frei || !x.optionen.length;
  const zu = t.pin ? '' : ' disabled';
  const empf = !x.empfohlen.length && x.empfehlung ? `<p class="warum"><b>Empfehlung:</b> ${esc(x.empfehlung)}</p>` : '';
  return `${vorne}${x.mehrfach && x.optionen.length ? '<span class="hinweis">mehrere möglich</span>' : ''}${opts ? `<div class="optionen">${opts}</div>` : ''}${empf}
${frei ? `<textarea placeholder="${x.optionen.length ? 'Freitext, erreicht den Lauf unverändert (optional)' : 'Deine Antwort, erreicht den Lauf unverändert'}" aria-label="Freitext"${zu}>${esc(e.text || '')}</textarea>` : ''}
<div class="knoepfe"><button type="button" class="knopf haupt" data-senden${zu}>${esc(sendeText(x, e))}</button>${x.optionen.length && !frei ? `<button type="button" class="knopf zweit" data-frei${zu}>Freitext</button>` : ''}<span class="status">${t.pin ? '' : `Antworten abgeschaltet: ${huelle.ohnePin(t)}`}</span></div>${wortlaut}`;
}

function sendeText(x, e) {
  const wahl = e.wahl || [];
  if (wahl.length) return `${wahl.join(', ')} senden`;
  if (x.empfohlen.length && !(e.text || '').trim()) return `${x.empfohlen.join(', ')} nehmen · Empfehlung`;
  return 'Senden';
}

function frageVerdrahten(el, x) {
  const e = () => entwurf.get(x.id) || {};
  const neu = (w) => entwurf.set(x.id, { ...e(), ...w });
  const neuZeichnen = () => {
    el.dataset.sig = '';
    el.innerHTML = frageHtml(x, stand);
    el.dataset.sig = el.innerHTML;
    frageVerdrahten(el, x);
    lebenszeichen();
  };
  el.querySelector('[data-lage]')?.addEventListener('click', () => {
    auf.has(`lage:${x.id}`) ? auf.delete(`lage:${x.id}`) : auf.add(`lage:${x.id}`);
    neuZeichnen();
  });
  el.querySelector('[data-aendern]')?.addEventListener('click', () => {
    neu({ aendern: true, wahl: x.antwort?.option ? x.antwort.option.split(', ') : [], text: x.antwort?.text || '', frei: Boolean(x.antwort?.text) });
    neuZeichnen();
  });
  el.querySelector('[data-frei]')?.addEventListener('click', () => {
    neu({ frei: true });
    neuZeichnen();
    el.querySelector('textarea')?.focus();
  });
  for (const b of el.querySelectorAll('.opt')) {
    b.addEventListener('click', () => {
      // single choice: one or none; multiple choice: each box on its own
      const alt = e().wahl || [];
      const da = alt.includes(b.dataset.b);
      const wahl = x.mehrfach ? (da ? alt.filter((y) => y !== b.dataset.b) : [...alt, b.dataset.b].sort()) : da ? [] : [b.dataset.b];
      neu({ wahl });
      for (const o of el.querySelectorAll('.opt')) {
        const an = wahl.includes(o.dataset.b);
        o.classList.toggle('gewaehlt', an);
        o.setAttribute(x.mehrfach ? 'aria-checked' : 'aria-pressed', String(an));
      }
      el.querySelector('[data-senden]').textContent = sendeText(x, e());
    });
  }
  const feld = el.querySelector('textarea');
  feld?.addEventListener('input', () => {
    neu({ text: feld.value });
    el.querySelector('[data-senden]').textContent = sendeText(x, e());
  });
  el.querySelector('[data-senden]')?.addEventListener('click', () => antworten(x, el));
}

async function antworten(x, el) {
  const e = entwurf.get(x.id) || {};
  const frei = (e.text || '').trim();
  // one tap on the recommendation: nothing chosen and no text sends the recommended letters
  const option = (e.wahl?.length ? e.wahl : frei ? [] : x.empfohlen).join(', ');
  const status = el.querySelector('.status');
  if (!option && !frei) {
    status.className = 'status schlecht';
    status.textContent = 'Option wählen oder Text schreiben';
    return;
  }
  const r = await senden('/api/antwort', { forge: x.forge, epic: x.epic, nr: x.nr, seit: x.seit, option: option || null, text: frei || null }, el, status);
  if (r) {
    entwurf.delete(x.id);
    await laden();
  }
}

function blockadeHtml(x, t) {
  const grund = x.grund || x.notiz || 'ohne Grund gemeldet';
  const [erste, ...rest] = grund.split('\n');
  // parked for the person: her step leads to the ticket; requeueing before it only repeats the same end
  const geparkt = x.lage?.etikett === 'wartet_auf_dich';
  const kopfz = `<div class="kopfz">${nrLink(x)}<span class="art">${x.stufe === 'abgebrochen' ? 'Abgebrochen' : geparkt ? 'Geparkt' : 'Blockiert'} · ${esc(x.repo)}${x.konto ? ` · ${esc(x.konto)}` : ''}</span><span class="warte">${zeitHtml(x.seit, 'seit {}')} · Mission steht ganz</span></div>`;
  const titel = x.titel ? `<p class="lage">${esc(x.titel)}${x.prUrl ? ` · <a href="${esc(x.prUrl)}">PR #${x.pr}</a>` : ''}</p>` : '';
  const lage = rest.join('\n').trim() ? `<p class="lage kurz${auf.has(`kurz:${x.id}`) ? ' auf' : ''}">${esc(rest.join('\n').trim())}</p>` : '';
  const log = auf.has(`log:${x.id}`) ? `<ol class="log">${(x.log.length ? x.log : ['(keine Ereignisse gemeldet)']).map((z) => `<li>${esc(z)}</li>`).join('')}</ol>` : '';
  let unten;
  if (x.handlung) {
    const st = x.handlung.abgeholt ? 'Angekommen, der Treiber führt es aus' : x.aktiv ? 'Angekommen · der Treiber holt es im nächsten Takt ab' : 'Angekommen · kein Treiber läuft, er holt es bei seinem nächsten Start ab';
    unten = `<div class="angekommen"><span>${esc(HANDLUNG[x.handlung.art])}</span><span class="status gut">${uhrzeit(x.handlung.zeit)} · ${st}</span></div>`;
  } else {
    const zu = t.pin ? '' : ' disabled';
    unten = `<div class="knoepfe"><button type="button" class="knopf ${geparkt ? 'zweit' : 'haupt'}" data-h="einreihen"${zu}>Neu einreihen</button><button type="button" class="knopf zweit" data-log aria-expanded="${auf.has(`log:${x.id}`)}">Log ansehen</button><button type="button" class="knopf zweit" data-h="aufgeben"${zu}>Aufgeben</button><span class="status"></span></div>${x.aktiv ? '' : '<span class="hinweis">Der Treiber meldet sich gerade nicht: die Handlung wirkt bei seinem nächsten Start.</span>'}`;
  }
  // the driver's sentence usually names the reason already, a parked card its step: then no heading repeats it
  const kopf = geparkt || x.lage?.satz.includes(erste) ? '' : `<h3>${esc(erste)}</h3>`;
  return `${kopfz}${lageHtml(x)}${kopf}${titel}${lage}${log}${unten}`;
}

function blockadeVerdrahten(el, x) {
  el.querySelector('[data-log]')?.addEventListener('click', () => {
    auf.has(`log:${x.id}`) ? auf.delete(`log:${x.id}`) : auf.add(`log:${x.id}`);
    el.dataset.sig = '';
    el.innerHTML = blockadeHtml(x, stand);
    blockadeVerdrahten(el, x);
    lebenszeichen();
  });
  for (const b of el.querySelectorAll('[data-h]')) {
    b.addEventListener('click', async () => {
      const art = b.dataset.h;
      if (art === 'aufgeben' && !(await bestaetigen(`Mission #${x.epic} aufgeben? Der Treiber setzt sie auf „abgebrochen“ und startet sie nicht mehr. Branch, Pull Request und Issue bleiben, wie sie sind.`, 'Aufgeben'))) return;
      if (await senden('/api/handlung', { forge: x.forge, epic: x.epic, art }, el, el.querySelector('.status'))) await laden();
    });
  }
}

// ---- level 2: runs, the merge queue, the ready ones

function ebene2(t) {
  const u = t.unterwegs;
  // with the driver's line a card counts by its label (a PR may wait for the person too), else as before
  const laufen = u.laeufe.filter((l) => !wartetAufDich(l)).length;
  const warten = [...u.laeufe, ...u.schlange].filter(wartetAufDich).length;
  const schlange = u.schlange.filter((x) => !wartetAufDich(x)).length;
  $('e2-zahl').textContent = u.laeufe.length + u.schlange.length;
  $('e2-klein').textContent = [laufen ? `${laufen} ${laufen === 1 ? 'läuft' : 'laufen'}` : '', warten ? `${warten} wartet auf dich` : '', schlange ? `${schlange} in der Schlange` : '', u.bereit.length ? `${u.bereit.length} bereit` : ''].filter(Boolean).join(' · ') || 'nichts unterwegs';
  const items = [...u.laeufe.map((l) => ({ ...l, form: 'lauf', flip: l.id })), ...u.schlange.map((s) => ({ ...s, id: `${s.id}:s`, form: 'schlange', flip: s.id }))];
  liste($('e2-liste'), items, laufHtml, paketeVerdrahten);
  const box = $('bereit');
  if (!u.bereit.length) {
    setze(box, '<span class="b-ep"><small>keins wartet</small></span>');
    return;
  }
  if (box.dataset.sig) { box.innerHTML = ''; delete box.dataset.sig; }
  liste(box, u.bereit.map((b) => ({ ...b, form: 'bereit' })), bereitHtml, paketeVerdrahten, 'div');
}

// a ready epic: one line, below it its child tickets as the bar of level 2 (in spec mode the run's packages, none before its start)
function bereitHtml(b) {
  const nr = b.issueUrl ? `<a class="nr" href="${esc(b.issueUrl)}">#${b.nr}</a>` : `<span class="nr">#${b.nr}</span>`;
  return `<span class="b-zeile">${b.prio ? '<span class="prio">prio</span>' : ''}${nr} ${esc(b.titel)}${b.notiz ? ` <small>· ${esc(b.notiz)}</small>` : ''}${b.prognose ? ` <small class="prognose" title="Prognose aus den gemessenen Missionen dieses Projekts, ohne Wartezeit auf Fragen">· voraussichtlich ${esc(spanne(b.prognose))}</small>` : ''}</span>${paketeHtml(b)}`;
}

// #51: phase, round, class and times of a package; every part only when the driver reported it
function paketDetail(p) {
  const t = [];
  if (p.phase) t.push(`<b>${esc(PHASE[p.phase] ?? p.phase)}</b>${p.phaseSeit ? ` ${zeitHtml(p.phaseSeit, 'seit {}')}` : ''}`);
  if (p.erstAufruf) t.push(zeitHtml(p.erstAufruf, 'gesamt {}', p.ende));
  if (p.runde) t.push(`Runde ${p.runde}`);
  if (p.stufe) t.push(`Stufe ${esc(p.stufeStart ? `${STUFE[p.stufeStart] ?? p.stufeStart} → ` : '')}${esc(STUFE[p.stufe] ?? p.stufe)}`);
  if (p.phase && p.lebenszeichen) t.push(`<span title="letzter Protokolleintrag des Laufs zu diesem Paket">Lebenszeichen ${esc(uhrzeit(p.lebenszeichen))}</span>`);
  const lang = p.lang ? '<span class="lang" title="läuft seit mehr als dem 1,5-Fachen des Medians der fertigen Pakete dieses Projekts">länger als üblich</span>' : '';
  return t.length || lang ? `<span class="pd">${t.join(' · ')}${lang}</span>` : '';
}

function paketeListe(x) {
  return `<ol class="pakete">${x.pakete.map((p) => `<li class="${esc(p.stand)}"><span class="punkt"></span>${p.url ? `<a href="${esc(p.url)}">${esc(p.name)}</a>` : `<span>${esc(p.name)}</span>`} <span class="pt">${esc(p.titel)}</span><span class="ps">${esc(PAKET[p.stand] ?? p.stand)}${p.beginn ? ` · ${zeitHtml(p.beginn, p.ende ? 'in {}' : 'seit {}', p.ende)}` : ''}</span>${paketDetail(p)}</li>`).join('')}</ol>`;
}

// a point in time gone by: today the clock, else the day before it
function gewesen(iso) {
  const t = datum(iso);
  if (!t) return '';
  return t.toDateString() === new Date(jetzt()).toDateString() ? uhrzeit(iso) : `${t.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${uhrzeit(iso)}`;
}

// #52: the decisions of the epic until the merge, newest first: the person's answers, the admiral's and the run's influential ones
function entscheidungenHtml(x) {
  if (!x.entscheidungen?.length) return '';
  const zeilen = x.entscheidungen.map((d) => `<li data-ent="${esc(d.id)}"><span class="von ${esc(d.von)}">${esc(VON[d.von] ?? d.von)}</span><time datetime="${esc(d.zeit)}">${esc(gewesen(d.zeit))}</time><span class="et"><b>Frage ${d.nr} → ${esc(d.antwort)}</b> · ${esc(d.frage)} <small title="${esc(d.grund)}">(${esc(d.herkunft)})</small>${widerrufHtml(d)}</span></li>`).join('');
  return `<section class="entscheidungen" aria-label="Entscheidungen bis zum Andocken"><h4>Entscheidungen bis zum Andocken</h4><ol>${zeilen}</ol></section>`;
}

// with the driver's line (lage) the run's last step and the contexts of the gate move into the detail
function lageDetailHtml(x) {
  if (!x.lage) return '';
  const schritt = x.schritt ? `<p class="d-schritt"><b>Letzter Schritt:</b> ${esc(x.schritt)}${x.schrittZeit ? ` (${esc(uhrzeit(x.schrittZeit))})` : ''}</p>` : '';
  const g = x.lage.gate;
  if (!g?.kontexte?.length) return schritt;
  const fertig = g.kontexte.filter((k) => k.stand === 'fertig').length;
  const kopf = `Andockprüfung · ${fertig} von ${g.von ?? g.kontexte.length} fertig${datum(g.seit) ? ` · ${zeitHtml(g.seit, 'seit {}')}` : ''}`;
  return `${schritt}<section class="d-gate" aria-label="Andockprüfung"><h4>${kopf}</h4><ul>${g.kontexte.map((k) => `<li class="${esc(k.stand)}"><span class="punkt"></span><span>${esc(k.name)}</span><span class="ps">${k.stand === 'fertig' ? 'fertig' : 'läuft'}</span></li>`).join('')}</ul></section>`;
}

// a duration as the block of the Andockprüfung prints it: m:ss, from an hour on h:mm:ss
function gateDauer(s) {
  if (s == null) return '';
  const t = Math.round(s);
  const [h, m, sek] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), String(t % 60).padStart(2, '0')];
  return h ? `${h}:${String(m).padStart(2, '0')}:${sek}` : `${m}:${sek}`;
}
// n of the contexts that ran took their result from the cache; empty when the adapter says nothing about it
const gateCacheText = (a) => (a?.mitCache ? `${a.ausCache} von ${a.mitCache} Kontexten aus dem Cache` : '');
const ERGEBNIS = { gruen: 'grün', rot: 'rot' };

// the last Andockprüfung of the driver for the mission: duration, result, cache share, the contexts
function andockHtml(a) {
  if (!a) return '';
  const kopf = ['Letzte Andockprüfung', gateDauer(a.dauerS), a.gruen ? 'grün' : 'rot', gateCacheText(a), uhrzeit(a.zeit)].filter(Boolean).join(' · ');
  const li = (a.kontexte ?? []).map((k) => `<li class="${k.ergebnis === 'gruen' ? 'fertig' : k.ergebnis === 'rot' ? 'rot' : 'aus'}"><span class="punkt"></span><span>${esc(k.name)}</span><span class="ps">${esc([ERGEBNIS[k.ergebnis] ?? k.ergebnis, gateDauer(k.dauerS), k.cache ? 'Cache' : ''].filter(Boolean).join(' '))}</span></li>`).join('');
  return `<section class="d-gate d-andock" aria-label="Letzte Andockprüfung"><h4>${esc(kopf)}</h4>${li ? `<ul>${li}</ul>` : ''}</section>`;
}

// the opened detail of an epic: one section per entry
const abschnitte = (x) => [lageDetailHtml(x), andockHtml(x.andockpruefung), x.pakete?.length ? paketeListe(x) : '', entscheidungenHtml(x)];

function paketeHtml(x) {
  const e = x.entscheidungen?.length ?? 0;
  const mehr = Boolean((x.lage && (x.schritt || x.lage.gate?.kontexte?.length)) || x.andockpruefung);
  if (!x.pakete?.length && !e && !mehr) return '';
  const n = x.pakete?.length ?? 0;
  const fertig = (x.pakete ?? []).filter((p) => p.stand === 'fertig').length;
  const offen = auf.has(`pakete:${x.id}`);
  const liste = offen ? `<div class="detail">${abschnitte(x).join('')}</div>` : '';
  const zahl = [n ? (x.form === 'bereit' ? `${n} ${n === 1 ? 'Ticket' : 'Tickets'}${fertig ? ` · ${fertig} fertig` : ''}` : `${fertig} von ${n} fertig`) : '', e ? `${e} ${e === 1 ? 'Entscheidung' : 'Entscheidungen'}` : ''].filter(Boolean).join(' · ') || 'Details';
  return `<button type="button" class="paketleiste" data-pakete aria-expanded="${offen}" title="Pakete und Entscheidungen: antippen für die Liste"><span class="segmente">${(x.pakete ?? []).map((p) => `<span class="segment ${esc(p.stand)}"></span>`).join('')}</span><span class="pz">${zahl}</span></button>${liste}`;
}

function paketeVerdrahten(el, x) {
  const neu = () => {
    el.dataset.sig = '';
    el.innerHTML = (x.form === 'bereit' ? bereitHtml : laufHtml)(x);
    el.dataset.sig = el.innerHTML;
    paketeVerdrahten(el, x);
    lebenszeichen();
  };
  el.querySelector('[data-pakete]')?.addEventListener('click', () => {
    auf.has(`pakete:${x.id}`) ? auf.delete(`pakete:${x.id}`) : auf.add(`pakete:${x.id}`);
    neu();
  });
  for (const d of x.entscheidungen ?? []) {
    const wo = () => [...el.querySelectorAll('[data-ent]')].find((li) => li.dataset.ent === d.id);
    if (wo()) widerrufVerdrahten(wo, d, neu);
  }
}

// #151: the gate under way (Andockprüfung), the run's or the driver's: which run of it and since when
function gateLaufHtml(g) {
  if (!g) return '';
  return `<span class="gate-lauf">Andockprüfung ${esc(g.n)}${datum(g.seit) ? ` · Start ${esc(uhrzeit(g.seit))}, ${zeitHtml(g.seit, 'seit {}', null, 'rel gate')}` : ''}</span>`;
}

// Tag J: every card under Unterwegs opens the history of its mission (verlauf.js); a tap on the card does the same
const VERLAUF_KNOPF = '<button type="button" class="verlauf-auf" data-verlauf aria-label="Verlauf der Mission öffnen">Verlauf ›</button>';

function laufHtml(x) {
  const nr = x.issueUrl ? `<a class="nr" href="${esc(x.issueUrl)}">#${x.nr}</a>` : `<span class="nr">#${x.nr}</span>`;
  // how long the epic runs (since its first run); a tap shows the start as clock time
  const laeuft = x.form === 'lauf' && datum(x.gestartetAm) ? `<button type="button" class="laeuft-seit" data-ab="${esc(x.gestartetAm)}" data-text="läuft seit {}" data-start="Start ${esc(uhrzeit(x.gestartetAm))}" title="seit dem ersten Lauf der Mission"></button>` : '';
  const kopfz = `<div class="kopfz">${nr}<span class="art">${esc(x.repo)}${x.konto ? ` · ${esc(x.konto)}` : ''}${x.stufe === 'nacharbeit' ? ' · Nacharbeit' : ''}</span>${laeuft}</div>`;
  // Tag Q: the usage line stands under the title on every card under Unterwegs
  const titel = `${x.titel ? `<span class="titel">${esc(x.titel)}</span>` : ''}${verbrauchHtml(x)}`;
  // #51: the places in use against the window and the restarts of the run; Laufzeit is the button above
  // Tag H: with the line of the mission the gate stands there once, not again above it
  const meta = x.form === 'lauf' ? [x.lage ? '' : gateLaufHtml(x.gateLauf), x.plaetze ? `Plätze ${x.plaetze.belegt}${x.plaetze.von ? `/${x.plaetze.von}` : ' belegt'}` : '', x.neustarts ? `<span title="Neustarts und Fortsetzungen des Laufs seit dem ersten Start">${x.neustarts} ${x.neustarts === 1 ? 'Neustart' : 'Neustarts'}</span>` : ''].filter(Boolean) : [];
  const kopfmeta = meta.length ? `<span class="epic-meta">${meta.join(' · ')}</span>` : '';
  if (x.form === 'schlange') {
    const pr = x.prUrl ? `<a href="${esc(x.prUrl)}">PR #${x.pr}</a>` : x.pr ? `PR #${x.pr}` : '';
    const gate = x.lage ? '' : x.gateLauf ? gateLaufHtml(x.gateLauf) : x.gateSeit ? zeitHtml(x.gateSeit, 'Andockprüfung seit {}', null, 'rel gate') : '';
    // the driver's line says what happens; the PR stays a link in the line below, which the phone shows too
    if (x.lage) return `${kopfz}${titel}${lageHtml(x)}${paketeHtml(x)}<div class="zeile"><span>${x.position ? `Platz ${x.position}` : 'Schlange'}</span><span>${pr ? `${pr} · ` : ''}${zeitHtml(x.seit, 'in der Schlange seit {}')}${gate ? ` · ${gate}` : ''}</span></div>${VERLAUF_KNOPF}`;
    return `${kopfz}${titel}<span class="schritt">${pr}${x.notiz ? ` · ${esc(x.notiz)}` : ''}</span>${paketeHtml(x)}<div class="zeile"><span>${x.position ? `Platz ${x.position}` : 'Schlange'}</span><span>${zeitHtml(x.seit, 'in der Schlange seit {}')}${gate ? ` · ${gate}` : ''}</span></div>${VERLAUF_KNOPF}`;
  }
  if (x.lage) return `${kopfz}${titel}${kopfmeta}${lageHtml(x)}${paketeHtml(x)}${lebenHtml(x)}${VERLAUF_KNOPF}`;
  const was = x.wartetAufDich ? `wartet auf dich${x.fragen ? ` (${x.fragen} ${x.fragen === 1 ? 'Frage' : 'Fragen'})` : ''}` : x.notiz && x.notiz !== x.schritt ? x.notiz : '';
  const offen = auf.has(`kurz:${x.id}`) ? ' auf' : '';
  const schritt = x.schritt ? `<span class="schritt${offen}">${esc(x.schritt)}${was ? ` · ${esc(was)}` : ''}</span>` : was ? `<span class="schritt${offen}">${esc(was)}</span>` : '';
  return `${kopfz}${titel}${kopfmeta}${schritt}${paketeHtml(x)}${lebenHtml(x)}${VERLAUF_KNOPF}`;
}

// Tag Q: the usage of the mission so far in one line under the head with its running time: estimated share of the week,
// accounts, tokens, cache share; the breakdown in the title. A mark only colours it and names why, nothing halts.
// An older driver sends none: the card as before
function verbrauchHtml(x) {
  const v = x.verbrauch;
  if (!v) return '';
  const teile = [v.anteil_woche != null ? `${anteilText(v.anteil_woche)} Woche` : '', (v.konten ?? []).map(kontoKurz).join(', '), tokText(v.summe), cacheText(v.cache_quote)].filter(Boolean);
  const warn = v.warnung?.length ? v.warnung : null;
  const titel = [verbrauchTitel(v), v.anteil_woche != null ? VERBRAUCH_METHODE : '', warn ? `Markiert: ${warn.join('; ')}\n${VERBRAUCH_MARKE}` : ''].filter(Boolean).join('\n\n');
  return `<p class="verbrauch${warn ? ' warnung' : ''}" title="${esc(titel)}">${teile.map((t) => `<span>${esc(t)}</span>`).join(' · ')}${warn ? `<span class="vb-warn">${esc(warn.join(' · '))}</span>` : ''}</p>`;
}

// the driver's line (lage): a label, the sentence with its reason, since when; below it the person's step with
// a link to where it is done. An older driver sends none: the card draws its step as before
const wartetAufDich = (x) => (x.lage ? x.lage.etikett === 'wartet_auf_dich' : Boolean(x.wartetAufDich));

function lageHtml(x) {
  const l = x.lage;
  if (!l) return '';
  // the dot sticks to the last word: a wrapped line never starts with it
  const seit = datum(l.seit) ? `<span class="lage-seit">&nbsp;· ${zeitHtml(l.seit, 'seit {}')}</span>` : '';
  return `<p class="lagez"><span class="etikett ${esc(l.etikett)}">${esc(ETIKETT[l.etikett] ?? l.etikett)}</span> <span class="satz">${esc(l.satz)}</span>${seit}</p>${deinSchrittHtml(x)}`;
}

function deinSchrittHtml(x) {
  const d = x.lage?.deinSchritt;
  if (!d) return '';
  const inhalt = `<b>Dein Schritt:</b> ${esc(d.text)}`;
  const pfeil = ' <span class="pfeil" aria-hidden="true">›</span>';
  const url = d.url ?? { pr: x.prUrl, issue: x.issueUrl }[d.ziel];
  if (url) return `<a class="dein-schritt" href="${esc(url)}">${inhalt}${pfeil}</a>`;
  if (d.ziel === 'frage' || d.ziel === 'einreihen') return `<button type="button" class="dein-schritt" data-dein="${esc(d.ziel)}" data-forge="${esc(x.forge)}" data-nr="${esc(x.nr ?? x.epic)}">${inhalt}${pfeil}</button>`;
  return `<p class="dein-schritt">${inhalt}</p>`;
}

// a text the card cuts (the step, the reason of a blockade) opens on a click and stays open across refreshes
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('.schritt, .lage.kurz');
  const id = t?.closest('[data-id]')?.dataset.id;
  if (!id || ev.target.closest('a, button')) return;
  const k = `kurz:${id}`;
  auf.has(k) ? auf.delete(k) : auf.add(k);
  t.classList.toggle('auf', auf.has(k));
});

// where "Dein Schritt" leads on the board: the first open question of the mission, or its blockade with "Neu einreihen"
function deinZiel(b) {
  const { dein, forge } = b.dataset;
  const nr = Number(b.dataset.nr);
  if (dein === 'frage') {
    const f = stand?.braucht.find((x) => x.art === 'frage' && x.forge === forge && x.epic === nr);
    return f ? karteIn('e1-liste', f.id) : null;
  }
  const k = karteIn('e1-liste', `epic:${forge}#${nr}`);
  return k?.querySelector('[data-h="einreihen"]') ?? k;
}

// the life sign: a pulse while the run speaks, a bar up to the idle limit (yellow from half, red near it)
function lebenHtml(x) {
  if (!x.prozess || x.wartetAufDich) {
    const was = x.wartetAufDich ? 'wartet auf dich' : 'kein Zug gerade';
    return `<div class="leben ruht"><span class="puls"></span><span class="text">${esc(x.konto ?? '')} · ${was}${x.schrittZeit ? ` · letzter Schritt ${uhrzeit(x.schrittZeit)}` : ''}</span></div>`;
  }
  return `<div class="leben" data-schritt="${esc(x.schrittZeit ?? '')}" data-leerlauf="${x.leerlaufS ?? 3600}"><span class="puls"></span><span class="text"></span><span class="roehre"><i></i></span></div>`;
}

function lebenszeichen() {
  for (const el of document.querySelectorAll('[data-ab]')) {
    const ab = datum(el.dataset.ab);
    const bis = datum(el.dataset.bis);
    if (!ab) continue;
    const neu = el.classList.contains('start') ? el.dataset.start : el.dataset.text.replace('{}', dauer(((bis ? bis.getTime() : jetzt()) - ab) / 1000));
    if (el.textContent !== neu) el.textContent = neu;
  }
  for (const el of document.querySelectorAll('.leben[data-schritt]')) {
    const s = seitS(el.dataset.schritt);
    const grenze = Number(el.dataset.leerlauf) || 3600;
    const anteil = s == null ? 0 : Math.min(1, s / grenze);
    el.classList.toggle('gelb', anteil >= 0.5 && anteil < 0.85);
    el.classList.toggle('rot', anteil >= 0.85);
    el.querySelector('i').style.width = `${(anteil * 100).toFixed(2)}%`;
    const konto = el.closest('.karte')?.querySelector('.art')?.textContent.split(' · ')[1] ?? '';
    const text = s == null ? 'Lauf gestartet' : s < 60 ? 'letzter Schritt gerade eben' : `letzter Schritt vor ${dauer(s)}`;
    const neu = `${konto ? `${konto} · ` : ''}${text}${anteil >= 0.85 ? ' · gleich Leerlauf' : ''}`;
    const t = el.querySelector('.text');
    if (t.textContent !== neu) t.textContent = neu;
  }
}

// ---- level 3: merged, the admiral's decisions, your answers and actions

function ebene3(t, vorher) {
  const e = t.erledigt;
  $('e3-zahl').textContent = e.length;
  const n = (a) => e.filter((x) => x.art === a).length;
  $('e3-klein').textContent = [n('gemergt') ? `${n('gemergt')} angedockt` : '', n('admiral') ? `${n('admiral')} vom Admiral entschieden` : '', n('antwort') + n('handlung') ? `${n('antwort') + n('handlung')} von dir` : '', n('aufgegeben') ? `${n('aufgegeben')} aufgegeben` : ''].filter(Boolean).join(' · ') + (e.length && !$('e3').open ? ' · antippen' : '');
  const neueMerges = e.filter((x) => x.art === 'gemergt' && !erstes && !vorher.has(x.id));
  if (neueMerges.length && !STILL.matches) {
    const e3 = $('e3');
    e3.classList.remove('blitz');
    void e3.offsetWidth;
    e3.classList.add('blitz');
  }
  // first the forecast of each project: when the backlog is empty
  const prognosen = t.projekte.filter((p) => p.prognose).map((p) => ({ id: `prognose:${p.forge}`, art: 'prognose', form: 'zeile', kurz: p.kurz, mehrere: t.projekte.length > 1, ...p.prognose }));
  liste($('e3-liste'), [...prognosen, ...e.map((x) => ({ ...x, form: 'zeile', neu: neueMerges.includes(x), flip: x.art === 'gemergt' || x.art === 'aufgegeben' ? x.id : undefined }))], zeileHtml, zeileVerdrahten, 'li');
}

// a span of seconds as the board says it: "40–70 min" or "3–5 h"
function spanne(s) {
  const [a, b] = [s.p50 / 60, s.p90 / 60];
  if (b < 90) return `${Math.max(1, Math.round(a))}–${Math.max(1, Math.round(b))} min`;
  const h = (m) => (m < 600 ? Math.round(m / 30) / 2 : Math.round(m / 60)).toLocaleString('de-DE');
  return h(a) === h(b) ? `etwa ${h(a)} h` : `${h(a)}–${h(b)} h`;
}

// a point in time ahead: today with the clock, else the weekday
function wann(iso, sekunden) {
  const t = new Date(Date.parse(iso) + sekunden * 1000);
  const tag = (d) => new Date(jetzt() + d * 864e5).toDateString();
  const uhr = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (tag(0) === t.toDateString()) return `heute ${uhr}`;
  if (tag(1) === t.toDateString()) return `morgen ${uhr}`;
  return t.toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function prognoseHtml(x) {
  const wo = x.mehrere ? `${esc(x.kurz)}: ` : '';
  const quote = x.geprueft ? ` · traf ${x.treffer} von ${x.geprueft}` : '';
  if (x.status === 'zu_wenig') return `<time></time><span>${wo}Prognose ab ${x.ab} Missionen · bisher ${x.bisher}</span>`;
  if (x.status === 'ungenau') return `<time></time><span>${wo}Prognose ausgeblendet: zu ungenau für dieses Projekt${quote}</span>`;
  if (!x.backlog) return `<time></time><span>${wo}Backlog leer · Prognose aus ${x.bisher} Missionen${quote}</span>`;
  return `<time></time><span>${wo}<b>Backlog leer etwa ${esc(wann(x.berechnet, x.backlog.p50))} – ${esc(wann(x.berechnet, x.backlog.p90))}</b>${quote} · <small>aus ${x.bisher} Missionen, ohne Wartezeit auf deine Antworten</small></span>`;
}

function zeileHtml(x) {
  if (x.art === 'prognose') return prognoseHtml(x);
  const nr = `#${x.epic ?? x.nr}`;
  const zeit = `<time>${uhrzeit(x.zeit)}</time>`;
  if (x.art === 'gemergt') return `${zeit}<span><b>${nr} angedockt</b> · ${esc(x.titel)}${x.pr ? ` · ${x.prUrl ? `<a href="${esc(x.prUrl)}">PR #${x.pr}</a>` : `PR #${x.pr}`}` : ''}</span>`;
  if (x.art === 'aufgegeben') return `${zeit}<span><b>${nr} aufgegeben</b> · ${esc(x.titel)}</span>`;
  if (x.art === 'antwort') return `${zeit}<span>Du: <b>${nr} Frage ${x.nr} → ${esc([x.option, x.text].filter(Boolean).join(' — '))}</b></span>`;
  if (x.art === 'handlung' && x.handlung === 'einstellen') return `${zeit}<span>Du: <b>Einstellung ${esc(x.titel)} → ${esc(Array.isArray(x.wert) ? x.wert.join(', ') || 'keine' : x.wert ?? 'automatisch')}</b> <small>${esc(x.repo)}</small></span>`;
  // #116: an action of the Frachtraum belongs to a ticket or the project, not to an epic
  if (x.art === 'handlung' && (x.handlung.startsWith('triage') || x.handlung.startsWith('konto_') || x.handlung === 'forge_verknuepfen' || x.handlung.startsWith('projekt_') || x.handlung === 'einspielen' || x.werft)) return `${zeit}<span>Du: <b>${handlungWort(x)}</b> <small>${esc(x.repo)}</small></span>`;
  if (x.art === 'handlung') return `${zeit}<span>Du: <b>${nr} ${handlungWort(x)}</b></span>`;
  // admiral
  return `${zeit}<span>Admiral: <b>${nr} Frage ${x.nr} → ${esc(x.antwort)}</b> <span title="${esc(x.grund)}">(${esc(x.herkunft)})</span> · ${esc(x.frage)}${widerrufHtml(x)}</span>`;
}

// what an acknowledged action of the person did, for "Erledigt heute" and the logbook (escaped)
function handlungWort(x) {
  const wort = { einreihen: 'neu eingereiht', aufnehmen: 'in den Einsatz aufgenommen', pausieren: 'pausiert', fortsetzen: 'fortgesetzt' }[x.handlung];
  if (wort) return wort;
  if (x.handlung === 'prioritaet') return `Priorität ${esc(x.text)}`;
  if (x.handlung === 'merge') return `Andocken: ${esc(andockenWort(x.text))}`;
  if (x.handlung === 'triage') return 'Triage-Lauf gestartet';
  if (x.handlung === 'einspielen') return 'Einspielen und Treiber neu starten';
  if (x.handlung === 'forge_verknuepfen') return 'Forge am Rechner verknüpfen';
  // #126: the folder by its name only
  if (x.handlung === 'projekt_hinzufuegen') return `Projekt ${esc(x.link ?? x.ordner)} ${x.link ? 'klonen und ' : ''}hinzufügen${x.autostart ? ' (mit Autostart)' : ''}`;
  if (x.handlung === 'projekt_entfernen') return 'Projekt entfernen, Treiber hält an';
  // #95: an account of the machine
  if (x.handlung === 'konto_anlegen') return `Konto anlegen${x.text ? ` (${esc(x.text)})` : ''}`;
  if (x.handlung === 'konto_anmelden') return `Konto ${esc(x.konto)}: am Rechner anmelden`;
  if (x.handlung === 'konto_deaktivieren') return `Konto ${esc(x.konto)} deaktiviert`;
  if (x.handlung === 'konto_aktivieren') return `Konto ${esc(x.konto)} aktiviert`;
  // #90: an action for the Werft of a repository
  if (x.handlung === 'nachziehen') return `Werft: ${esc(x.stack)} jetzt nachziehen`;
  if (x.handlung === 'migration_freigeben') return `Werft: Arbeits-Migration von ${esc(x.stack)} freigegeben`;
  if (x.handlung === 'triage-widerruf') return `#${x.ticket} Triage-Entscheidung widerrufen → ${esc(x.text)}`;
  // #148: the epic is the mission
  if (x.handlung === 'schnitt-widerruf') return `Mission aus dem Schnittplan widerrufen → ${esc(x.text)}`;
  if (x.handlung === 'triage-antwort') {
    let a = {};
    try { a = JSON.parse(x.text); } catch { /* the question without the answer */ }
    return `#${x.ticket} Frage ${x.nr} → ${esc([a.option, a.text].filter(Boolean).join(' — '))}`;
  }
  return `Widerruf Frage ${x.nr} → ${esc(x.text)}`;
}

function zeileVerdrahten(el, x) {
  const neu = () => {
    el.dataset.sig = '';
    el.innerHTML = zeileHtml(x);
    zeileVerdrahten(el, x);
    lebenszeichen();
  };
  if (x.art === 'admiral') widerrufVerdrahten(() => el, x, neu);
}

// ---- revoking a decision with the PIN until the merge: on level 3 and in the detail of the epic (#52).
// One decision has one open form and one draft, wherever it is shown.

const widerrufSchluessel = (d) => `wider:${d.forge}#${d.epic}#${d.nr}#${d.seit}`;

function widerrufHtml(d) {
  if (d.widerrufen) return `<span class="widerrufen"> · widerrufen → ${esc(d.widerrufen)}</span>`;
  if (d.handlung) return `<span class="status gut"> · Widerruf angekommen${d.handlung.abgeholt ? ', geht an den Lauf' : ''}</span>`;
  if (!d.widerrufbar || !stand?.pin) return '';
  const k = widerrufSchluessel(d);
  const knopf = `<button type="button" class="wider" data-wider aria-expanded="${auf.has(k)}">› Zurücknehmen</button>`;
  return auf.has(k) ? `${knopf}<div class="wider-form"><textarea placeholder="Neue Entscheidung, erreicht den Lauf unverändert" aria-label="Neue Entscheidung">${esc(entwurf.get(k)?.text ?? '')}</textarea><div class="knoepfe"><button type="button" class="knopf haupt klein" data-wsenden>Widerruf senden</button><button type="button" class="knopf zweit klein" data-wzu>Abbrechen</button><span class="status"></span></div></div>` : knopf;
}

// wo() gives the element of the decision as it stands now: a redraw of the card replaces it
function widerrufVerdrahten(wo, d, neu) {
  const k = widerrufSchluessel(d);
  const el = wo();
  el.querySelector('[data-wider]')?.addEventListener('click', () => {
    auf.add(k);
    neu();
    wo()?.querySelector('.wider-form textarea')?.focus();
  });
  el.querySelector('[data-wzu]')?.addEventListener('click', () => {
    auf.delete(k);
    entwurf.delete(k);
    neu();
  });
  const feld = el.querySelector('.wider-form textarea');
  feld?.addEventListener('input', () => entwurf.set(k, { text: feld.value }));
  el.querySelector('[data-wsenden]')?.addEventListener('click', async () => {
    const text = (feld?.value || '').trim();
    const status = el.querySelector('.wider-form .status');
    if (!text) {
      status.className = 'status schlecht';
      status.textContent = 'Neue Entscheidung schreiben';
      return;
    }
    if (await senden('/api/handlung', { forge: d.forge, epic: d.epic, art: 'widerruf', nr: d.nr, seit: d.seit, text }, el, status)) {
      auf.delete(k);
      entwurf.delete(k);
      // the sent text would hold the card in inArbeit and keep the answered form on screen
      feld.value = '';
      await laden();
    }
  });
}

// ---- sending from a paired device (#46); the PIN only where the machine itself is asked

const MIT_PIN = /^\/api\/(geraete\/|notaus\/loesen)/;

async function senden(pfad, body, el, status) {
  // #48: over the remote entry the bridge refuses it anyway; no PIN dialog there
  if (stand?.nurAnsicht) return false;
  const mitPin = MIT_PIN.test(pfad);
  for (let versuch = 0; versuch < 3; versuch++) {
    const pin = mitPin ? pinHolen() || (await pinFragen()) : null;
    if (mitPin && !pin) return false;
    const knoepfe = [...el.querySelectorAll('button')];
    knoepfe.forEach((b) => (b.disabled = true));
    if (status) { status.className = 'status'; status.textContent = 'sende …'; }
    let r;
    try {
      r = await fetch(pfad, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(pin ? { 'X-Bruecke-Pin': pin } : {}) }, body: JSON.stringify(body) });
    } catch {
      r = null;
    }
    knoepfe.forEach((b) => (b.disabled = false));
    const grund = r?.headers.get('X-Bruecke-Grund');
    // an unknown device pairs once, a wrong PIN is asked for again; then the same request once more
    if (grund === 'geraet') {
      if (!(await koppelnFragen())) return false;
      continue;
    }
    if (grund === 'pin') {
      pinMerken(null);
      continue;
    }
    if (!r || !r.ok) {
      if (status) {
        status.className = 'status schlecht';
        status.textContent = !r ? 'Brücke nicht erreichbar' : (await r.json().catch(() => ({}))).detail || `Fehler ${r.status}`;
      }
      return false;
    }
    document.activeElement?.blur?.();
    return true;
  }
  return false;
}

function pinFragen() {
  const d = $('pin-dialog');
  const feld = $('pin-feld');
  const fehler = $('pin-fehler');
  feld.value = '';
  fehler.textContent = '';
  return new Promise((fertig) => {
    const ende = (wert) => {
      $('pin-form').onsubmit = null;
      $('pin-abbruch').onclick = null;
      d.onclose = null;
      if (d.open) d.close();
      fertig(wert);
    };
    $('pin-abbruch').onclick = () => ende(null);
    d.onclose = () => ende(null);
    $('pin-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const pin = feld.value.trim();
      const r = await fetch('/api/pin', { method: 'POST', headers: { 'X-Bruecke-Pin': pin } }).catch(() => null);
      if (r && r.status === 204) {
        pinMerken(pin);
        ende(pin);
        return;
      }
      fehler.textContent = !r ? 'Brücke nicht erreichbar' : (await r.json().catch(() => ({}))).detail || 'PIN falsch';
      feld.select();
    };
    d.showModal();
    feld.focus();
  });
}

// #46: the bridge sets the device's key as an HttpOnly cookie; the page never sees it
function koppelnFragen() {
  const d = $('koppeln-dialog');
  const name = $('koppeln-name');
  const feld = $('koppeln-pin');
  const fehler = $('koppeln-fehler');
  feld.value = '';
  fehler.textContent = '';
  return new Promise((fertig) => {
    const ende = (wert) => {
      $('koppeln-form').onsubmit = null;
      $('koppeln-abbruch').onclick = null;
      d.onclose = null;
      if (d.open) d.close();
      fertig(wert);
    };
    $('koppeln-abbruch').onclick = () => ende(false);
    d.onclose = () => ende(false);
    $('koppeln-form').onsubmit = async (ev) => {
      ev.preventDefault();
      // the cookie is Secure: over plain HTTP in the LAN the browser would drop it
      if (!isSecureContext) {
        fehler.textContent = 'Koppeln geht nur über HTTPS (Zertifikat der Brücke) oder am Rechner über localhost.';
        return;
      }
      const pin = feld.value.trim();
      const r = await fetch('/api/geraete/koppeln', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bruecke-Pin': pin }, body: JSON.stringify({ name: name.value.trim() }) }).catch(() => null);
      // the browser may drop the cookie (private window, blocked cookies): no retry that pairs again and again
      const behalten = r && r.ok && (await fetch('/api/tafel', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({}))).geraet;
      if (behalten) {
        pinMerken(pin);
        ende(true);
        laden();
        return;
      }
      if (r && r.ok) {
        fehler.textContent = 'Gekoppelt, aber der Browser behält den Geräteschlüssel nicht (Cookies gesperrt oder privates Fenster).';
        return;
      }
      fehler.textContent = !r ? 'Brücke nicht erreichbar' : (await r.json().catch(() => ({}))).detail || `Fehler ${r.status}`;
    };
    d.showModal();
    (name.value ? feld : name).focus();
  });
}

function bestaetigen(text, ja) {
  const d = $('ja-dialog');
  $('ja-text').textContent = text;
  $('ja-knopf').textContent = ja;
  return new Promise((fertig) => {
    d.onclose = () => fertig(d.returnValue === 'ja');
    d.returnValue = '';
    d.showModal();
  });
}

// ---- the alarm in tab title and favicon

const ICONS = [...document.querySelectorAll('link[rel="icon"]')].map((l) => [l, l.href, l.type]);
let alarmIcon = null;
let alarmZahl = -1;
function tabAlarm(n) {
  if (n === alarmZahl) return;
  alarmZahl = n;
  document.title = n ? `(${n}) Flottenbrücke` : 'Flottenbrücke';
  if (!n) {
    for (const [l, href, type] of ICONS) { l.href = href; l.type = type; }
    return;
  }
  const setzen = () => { for (const [l] of ICONS) { l.href = alarmIcon; l.type = 'image/png'; } };
  if (alarmIcon) return setzen();
  const bild = new Image();
  bild.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.drawImage(bild, 0, 0, 32, 32);
    g.fillStyle = '#e0605a';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(24, 8, 7, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    alarmIcon = c.toDataURL('image/png');
    if (alarmZahl > 0) setzen();
  };
  bild.src = '/static/icon-32.png';
}

// ---- the beat in the elbow: fills smoothly until the next report, overruns red when it stays out

function takt() {
  const t = stand;
  const ecke = document.querySelector('.ecke');
  const balken = $('takt').firstElementChild;
  const aktiv = t ? t.projekte.filter((p) => p.aktiv || p.veraltet) : [];
  if (!aktiv.length) {
    ecke.classList.add('still');
    ecke.classList.remove('ueber');
    balken.style.transform = 'scaleX(0)';
    $('takt-text').textContent = t?.projekte.length ? 'Treiber beendet' : 'Takt';
    return;
  }
  ecke.classList.remove('still');
  // the project that is most overdue speaks
  let anteil = 0;
  for (const p of aktiv) anteil = Math.max(anteil, (seitS(p.empfangen) ?? 0) / Math.max(1, p.taktS));
  const ueber = anteil > 1.5;
  ecke.classList.toggle('ueber', ueber);
  balken.style.transform = `scaleX(${Math.min(1, anteil).toFixed(4)})`;
  const s = Math.round(Math.max(...aktiv.map((p) => seitS(p.empfangen) ?? 0)));
  $('takt-text').textContent = ueber ? `Bericht fehlt · ${dauer(s)}` : 'Takt';
}

function schleife() {
  takt();
  if (STILL.matches) setTimeout(schleife, 1000);
  else requestAnimationFrame(schleife);
}

// ---- #154: the stand of bridge and driver in the foot of every page, details in the Maschinenraum

function fussStand(t) {
  const k = (c) => (c ? c.slice(0, 7) : '?');
  const treiber = [...new Set(t.projekte.filter((p) => p.version?.commit).map((p) => p.version.commit))];
  const neu = t.projekte.some((p) => p.version?.neu);
  const el = $('fuss-stand');
  el.textContent = `B ${k(t.bruecke?.commit)} · T ${treiber.length > 1 ? `${treiber.length} Stände` : k(treiber[0])}${neu ? ' · neu' : ''}`;
  el.classList.toggle('neu', neu);
  // #242: a newer stand leads to its banner in Betrieb, else to the stand in Einrichtung
  el.href = neu ? '#maschinenraum/betrieb' : '#maschinenraum/einrichtung';
  const lang = t.projekte.filter((p) => p.version).map((p) => `Treiber ${p.kurz}: ${k(p.version.commit)}${p.version.datum ? ` vom ${datum(p.version.datum)?.toLocaleString('de-DE') ?? ''}` : ''}, gestartet ${datum(p.version.gestartet)?.toLocaleString('de-DE') ?? ''}${p.version.neu ? `; neuer Stand ${k(p.version.neu.commit)}` : ''}`);
  el.title = [`Brücke: ${k(t.bruecke?.commit)}${t.bruecke?.datum ? ` vom ${datum(t.bruecke.datum)?.toLocaleString('de-DE') ?? ''}` : ''}`, ...lang].join('\n');
}

// ---- the ticker of the logbook in the lower bar

function laufband(t) {
  const ev = t.ereignisse;
  const mehrere = t.projekte.length > 1;
  const eintrag = (e) => `<span><b>${uhrzeit(e.zeit)}</b> ${mehrere ? `${esc(e.kurz)} ` : ''}${e.epic ? `#${e.epic} ` : ''}${esc(e.text)}</span>`;
  const spur = $('laufband-spur');
  const html = ev.length ? ev.slice(0, 12).reverse().map(eintrag).join('') : '<span>Noch keine Ereignisse</span>';
  if (spur.dataset.sig !== html) {
    spur.innerHTML = html;
    spur.dataset.sig = html;
    const s = Math.max(30, Math.min(ev.length, 12) * 9);
    spur.style.setProperty('--dauer', `${s}s`);
    // start with the text already in view instead of an empty band (the track has the band's width as left padding)
    const breite = $('laufband').clientWidth;
    if (spur.scrollWidth) spur.style.animationDelay = `-${((breite * 0.85) / spur.scrollWidth) * s}s`;
  }
  setze($('logbuch-liste'), (ev.map((e) => `<li><time>${uhrzeit(e.zeit)}</time><span class="wo">${esc(e.kurz)}</span><span>${e.epic ? `<b>#${e.epic}</b> ` : ''}${esc(e.text)}</span></li>`).join('') || '<li>Noch keine Ereignisse</li>') + '<li style="display:block"><a href="#logbuch">Alle im Logbuch</a></li>');
}

document.addEventListener('click', (ev) => {
  const d = ev.target.closest?.('button[data-dein]');
  if (d) {
    const ziel = deinZiel(d);
    if (ziel) huelle.springe('bruecke', ziel);
    return;
  }
  const b = ev.target.closest?.('.laeuft-seit');
  if (!b) return;
  b.classList.toggle('start');
  lebenszeichen();
});

$('laufband').addEventListener('click', () => {
  const band = $('laufband');
  const offen = band.classList.toggle('halt');
  band.setAttribute('aria-expanded', String(offen));
  $('logbuch-liste').hidden = !offen;
});

// the link to the Logbuch page closes the ticker's list, which would else lie over that page
$('logbuch-liste').addEventListener('click', (ev) => {
  if (!ev.target.closest('a')) return;
  $('laufband').classList.remove('halt');
  $('laufband').setAttribute('aria-expanded', 'false');
  $('logbuch-liste').hidden = true;
});

// ---- moving cards: from where they stood to where they stand now (FLIP), once

function positionen() {
  const m = new Map();
  for (const el of document.querySelectorAll('[data-flip]')) {
    const r = el.getBoundingClientRect();
    if (r.width) m.set(el.dataset.flip, r);
  }
  return m;
}

function wandern(vorher) {
  if (STILL.matches || erstes) return;
  for (const el of document.querySelectorAll('[data-flip]')) {
    const a = vorher.get(el.dataset.flip);
    const b = el.getBoundingClientRect();
    if (!a || !b.width) continue;
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.2, .7, .2, 1)' });
  }
}

// ---- loading

async function laden() {
  try {
    const r = await fetch('/api/tafel', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const t = await r.json();
    // #48: over the remote entry only viewing: every area draws itself as without a PIN
    if (t.nurAnsicht) t.pin = false;
    versatz = Date.parse(t.jetzt) - Date.now();
    const vorher = positionen();
    const vorherErledigt = new Set((stand?.erledigt ?? []).map((x) => x.id));
    stand = t;
    // on the phone only level 1 is open, unless nothing waits there
    if (erstes) $('e2').open = BREIT.matches || !t.braucht.length;
    // #37: with Web-Push on (HTTPS, VAPID key) the service worker belongs to the installed app
    if (erstes && t.push && isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    kopf(t);
    ebene1(t);
    ebene2(t);
    ebene3(t, vorherErledigt);
    laufband(t);
    fussStand(t);
    tabAlarm(t.braucht.length);
    huelle.tafel(t);
    lebenszeichen();
    wandern(vorher);
    erstes = false;
  } catch (err) {
    $('stand').textContent = 'Brücke nicht erreichbar';
    console.error(err);
  }
}

// ---- the board in the shell (#40): it draws itself in laden(), the command line gets its epics and projects

function karteIn(box, id) {
  return [...$(box).children].find((el) => el.dataset.id === id) ?? null;
}

function brueckeTreffer(t) {
  const mehrere = t.projekte.length > 1;
  const epics = new Map();
  // each epic once, where it stands first: level 1, the runs, the queue, the ready ones, level 3
  const dazu = (x, nr, box, id) => {
    const k = `${x.forge}#${nr}`;
    if (nr == null || epics.has(k)) return;
    const name = x.titel || x.frage || '';
    epics.set(k, { art: 'Mission', titel: `#${nr}${name ? ` ${name}` : ''}`, info: mehrere ? x.repo : '', ziel: () => karteIn(box, id) });
  };
  for (const x of t.braucht) dazu(x, x.epic, 'e1-liste', x.id);
  for (const l of t.unterwegs.laeufe) dazu(l, l.nr, 'e2-liste', l.id);
  for (const s of t.unterwegs.schlange) dazu(s, s.nr, 'e2-liste', `${s.id}:s`);
  for (const b of t.unterwegs.bereit) dazu(b, b.nr, 'bereit', b.id);
  for (const x of t.erledigt) dazu(x, x.epic ?? x.nr, 'e3-liste', x.id);
  const projekte = t.projekte.map((p, i) => ({ art: 'Projekt', titel: p.kurz, info: p.forge, ziel: () => $('projekte').children[i] ?? null }));
  return [...epics.values(), ...projekte];
}

huelle.bereich({ name: 'bruecke', titel: 'Brücke', treffer: brueckeTreffer });

$('e3').addEventListener('toggle', () => stand && ebene3(stand, new Set(stand.erledigt.map((x) => x.id))));
laden();
schleife();
setInterval(lebenszeichen, 1000);
setInterval(() => { if (!document.hidden) laden(); }, TAKT_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) laden(); });
