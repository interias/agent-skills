// The board refreshes itself every 10 s. Cards change in place and only when their content
// changed; a question card someone is answering is left alone, so nothing jumps.
'use strict';

const TAKT_MS = 10000;
const PIN_KEY = 'flottenbruecke-pin';
const FARBE = { bereit: 'var(--himmel)', laeuft: 'var(--orange)', frage: 'var(--lila)', schlange: 'var(--gold)', gemergt: 'var(--gruen)', blockiert: 'var(--rot)' };
const KURZ = { bereit: 'Bereit', laeuft: 'Läuft', frage: 'Frage', schlange: 'Schlange', gemergt: 'Gemergt', blockiert: 'Blockiert' };

const WORT = { gruen: 'grün', gelb: 'gelb', rot: 'rot', ok: 'ok', warn: 'warn', hold: 'halt' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uhrzeit = (iso) => {
  const t = iso ? new Date(iso) : null;
  return t && !isNaN(t) ? t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
};
const lager = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
  weg(k) { try { localStorage.removeItem(k); } catch { /* private window */ } },
};

let stand = null;
const entwurf = new Map(); // question key -> { b, text, offen }

function frageKey(c, f) { return `${c.forge}#${f.epic}#${f.nr}#${f.seit}`; }

// ---- header

function kopf(t) {
  $('uhr').textContent = uhrzeit(t.jetzt);
  const neuester = t.projekte.map((p) => p.empfangen).sort().pop();
  $('stand').textContent = neuester ? `Bericht ${uhrzeit(neuester)}` : 'Kein Bericht';
  const teile = [];
  for (const k of t.konten) teile.push(`<span class="anzeige${k.veraltet ? ' veraltet' : ''}">${esc(k.konto)} <b class="${esc(k.stufe)}">${esc(WORT[k.stufe] ?? k.stufe)}</b></span>`);
  const mehrere = t.rechner.length > 1;
  for (const r of t.rechner) {
    const wo = mehrere && r.name ? `${esc(r.name)} · ` : '';
    const v = r.veraltet ? ' veraltet' : '';
    if (r.ram) teile.push(`<span class="anzeige${v}">${wo}RAM <b class="${esc(r.ram.stufe)}">${esc(WORT[r.ram.stufe] ?? r.ram.stufe)}</b>${r.ram.prozent != null ? ` <span class="zahl">${Math.round(r.ram.prozent)} %</span>` : ''}</span>`);
    if (r.platte) teile.push(`<span class="anzeige${v}">${wo}Platte <b class="${r.platte.genug ? 'ok' : 'rot'}">${r.platte.genug ? 'ok' : 'knapp'}</b>${r.platte.freiGb != null ? ` <span class="zahl">${Math.round(r.platte.freiGb)} GB</span>` : ''}</span>`);
    if (r.obergrenze != null) teile.push(`<span class="anzeige${v}">${wo}Obergrenze <span class="zahl">${esc(r.obergrenze)}</span></span>`);
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

// ---- board

function spalten(t) {
  const tafel = $('tafel');
  setze($('sprung'), t.spalten.map((s) => `<a href="#s-${s.id}" style="background:${FARBE[s.id]}">${KURZ[s.id]} <span class="zahl">${s.karten.length}</span></a>`).join(''));
  for (const s of t.spalten) {
    let sp = $(`s-${s.id}`);
    if (!sp) {
      sp = document.createElement('section');
      sp.id = `s-${s.id}`;
      sp.className = `spalte s-${s.id}`;
      sp.innerHTML = `<h2 class="spalte-kopf"><span>${esc(s.titel)}</span><span class="zahl"></span></h2><div class="karten"></div>`;
      tafel.appendChild(sp);
    }
    sp.querySelector('.spalte-kopf .zahl').textContent = s.karten.length;
    const liste = sp.querySelector('.karten');
    const da = new Map([...liste.querySelectorAll(':scope > .karte')].map((el) => [el.dataset.id, el]));
    const reihe = [];
    for (const c of s.karten) {
      let el = da.get(c.id) || document.querySelector(`.karte[data-id="${CSS.escape(c.id)}"]`);
      const html = karte(c, t);
      if (!el) {
        el = document.createElement('article');
        el.className = 'karte';
        el.dataset.id = c.id;
      }
      if (el.dataset.sig !== html && !inArbeit(el)) {
        el.innerHTML = html;
        el.dataset.sig = html;
        verdrahte(el, c);
      }
      reihe.push(el);
      da.delete(c.id);
    }
    for (const el of da.values()) if (!reihe.includes(el)) el.remove();
    let leer = liste.querySelector(':scope > .keine');
    if (!reihe.length && !leer) {
      leer = document.createElement('div');
      leer.className = 'keine';
      leer.textContent = 'leer';
      liste.appendChild(leer);
    } else if (reihe.length && leer) leer.remove();
    reihe.forEach((el, i) => { if (liste.children[i] !== el) liste.insertBefore(el, liste.children[i] || null); });
  }
  // a card that left every column (an epic merged yesterday) goes
  const ids = new Set(t.spalten.flatMap((s) => s.karten.map((c) => c.id)));
  for (const el of tafel.querySelectorAll('.karte')) if (!ids.has(el.dataset.id)) el.remove();
}

function inArbeit(el) {
  if (el.contains(document.activeElement) && document.activeElement !== document.body) return true;
  return [...el.querySelectorAll('.frage')].some((f) => {
    const e = entwurf.get(f.dataset.key);
    return e && (e.b || e.text);
  });
}

function karte(c, t) {
  const meta = [
    c.position ? `<span class="pos">${c.position}.</span>` : '',
    `<span>${esc(c.repo)}</span>`,
    c.konto ? `<span>${esc(c.konto)}</span>` : '',
    c.pr ? (c.prUrl ? `<a href="${esc(c.prUrl)}">PR #${c.pr}</a>` : `<span>PR #${c.pr}</span>`) : '',
    c.gemergtAm && c.stufe !== 'pr' && ['gemergt', 'fertig'].includes(c.stufe) ? `<span>gemergt ${uhrzeit(c.gemergtAm)}</span>` : '',
  ].join('');
  const nr = c.issueUrl ? `<a class="karte-nr" href="${esc(c.issueUrl)}">#${c.nr}</a>` : `<span class="karte-nr">#${c.nr}</span>`;
  const seg = c.pakete.length ? `<div class="segmente" title="${esc(c.pakete.map((p) => `${p.name}: ${p.stand}`).join(', '))}">${c.pakete.map((p) => `<span class="segment ${esc(p.stand)}"></span>`).join('')}</div>` : '';
  const schritt = c.schritt ? `<div class="schritt"><time>${uhrzeit(c.schrittZeit)}</time>${esc(c.schritt)}</div>` : '';
  const notiz = c.notiz && c.notiz !== c.schritt ? `<div class="notiz">${esc(c.notiz)}</div>` : '';
  const fragen = c.fragen.map((f) => frage(c, f, t)).join('');
  return `<div class="karte-kopf">${nr}<span class="karte-titel">${esc(c.titel)}</span></div><div class="karte-meta">${meta}</div>${seg}${schritt}${notiz}${fragen}`;
}

function frage(c, f, t) {
  const key = frageKey(c, f);
  const e = entwurf.get(key) || {};
  const kopf = `<div class="frage-titel">Frage ${f.nr}: ${esc(f.frage)}</div>${f.lage ? `<div class="lage">${esc(f.lage)}</div>` : ''}<div class="wartet">wartet: ${esc(f.wartet || 'der ganze Lauf')}</div>`;
  if (f.antwort && (f.antwort.abgeholt || !e.offen)) {
    const st = f.antwort.quittiert ? 'quittiert, der Lauf setzt fort' : f.antwort.abgeholt ? 'vom Treiber abgeholt' : 'gespeichert, wartet auf den Treiber';
    const aendern = f.antwort.abgeholt ? '' : ' <button type="button" class="knopf blau klein" data-aendern>ändern</button>';
    return `<div class="frage" data-key="${esc(key)}">${kopf}<div class="gesendet">Antwort: <b>${esc(f.antwort.text)}</b>${aendern}<span class="status gut">${uhrzeit(f.antwort.zeit)} · ${st}</span></div></div>`;
  }
  const opts = f.optionen.map((o) => {
    const emp = o.buchstabe === f.empfohlen;
    return `<button type="button" class="opt${emp ? ' empfohlen' : ''}${e.b === o.buchstabe ? ' gewaehlt' : ''}" data-b="${esc(o.buchstabe)}" aria-pressed="${e.b === o.buchstabe}"><span class="b">${esc(o.buchstabe)}</span><span>${esc(o.text)}${emp ? '<span class="empf">Empfehlung</span>' : ''}</span></button>`;
  }).join('');
  const empf = !f.empfohlen && f.empfehlung ? `<div class="lage">Empfehlung: ${esc(f.empfehlung)}</div>` : '';
  const zu = t.pin ? '' : ' disabled';
  return `<div class="frage" data-key="${esc(key)}">${kopf}${opts ? `<div class="optionen">${opts}</div>` : ''}${empf}
<textarea placeholder="Freitext (optional)" aria-label="Freitext"${zu}>${esc(e.text || '')}</textarea>
<div class="senden-zeile"><button type="button" class="knopf orange" data-senden${zu}>Antworten</button><span class="status">${t.pin ? '' : 'Antworten abgeschaltet: keine PIN gesetzt'}</span></div></div>`;
}

function verdrahte(el, c) {
  for (const box of el.querySelectorAll('.frage')) {
    const key = box.dataset.key;
    const f = c.fragen.find((x) => frageKey(c, x) === key);
    const e = () => entwurf.get(key) || {};
    const neu = (x) => entwurf.set(key, { ...e(), ...x });
    box.querySelector('[data-aendern]')?.addEventListener('click', () => {
      neu({ offen: true, text: f.antwort?.text || '' });
      el.dataset.sig = '';
      el.innerHTML = karte(c, stand);
      verdrahte(el, c);
    });
    for (const b of box.querySelectorAll('.opt')) {
      b.addEventListener('click', () => {
        const wahl = e().b === b.dataset.b ? null : b.dataset.b;
        neu({ b: wahl });
        for (const x of box.querySelectorAll('.opt')) {
          x.classList.toggle('gewaehlt', x.dataset.b === wahl);
          x.setAttribute('aria-pressed', String(x.dataset.b === wahl));
        }
      });
    }
    const feld = box.querySelector('textarea');
    feld?.addEventListener('input', () => neu({ text: feld.value }));
    box.querySelector('[data-senden]')?.addEventListener('click', () => senden(c, f, box));
  }
}

async function senden(c, f, box) {
  const key = frageKey(c, f);
  const e = entwurf.get(key) || {};
  const frei = (e.text || '').trim();
  const text = e.b && frei ? `${e.b} — ${frei}` : e.b || frei;
  const status = box.querySelector('.status');
  if (!text) {
    status.className = 'status schlecht';
    status.textContent = 'Option wählen oder Text schreiben';
    return;
  }
  const knopf = box.querySelector('[data-senden]');
  for (let versuch = 0; versuch < 2; versuch++) {
    const pin = lager.get(PIN_KEY) || (await pinFragen());
    if (!pin) return;
    knopf.disabled = true;
    status.className = 'status';
    status.textContent = 'sende …';
    let r;
    try {
      r = await fetch('/api/antwort', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bruecke-Pin': pin }, body: JSON.stringify({ forge: c.forge, epic: f.epic, nr: f.nr, seit: f.seit, text }) });
    } catch {
      knopf.disabled = false;
      status.className = 'status schlecht';
      status.textContent = 'Brücke nicht erreichbar';
      return;
    }
    knopf.disabled = false;
    if (r.status === 401) {
      lager.weg(PIN_KEY);
      continue;
    }
    if (!r.ok) {
      status.className = 'status schlecht';
      status.textContent = (await r.json().catch(() => ({}))).detail || `Fehler ${r.status}`;
      return;
    }
    entwurf.delete(key);
    document.activeElement?.blur?.();
    await laden();
    return;
  }
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
        lager.set(PIN_KEY, pin);
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

async function laden() {
  try {
    const r = await fetch('/api/tafel', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    stand = await r.json();
    kopf(stand);
    spalten(stand);
  } catch {
    $('stand').textContent = 'Brücke nicht erreichbar';
  }
}

laden();
setInterval(() => { if (!document.hidden) laden(); }, TAKT_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) laden(); });
