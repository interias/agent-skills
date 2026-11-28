// Maschinenraum (#42): accounts as tanks, the machines (RAM, disk, fleet limit), the projects of the drivers, the Werft,
// the settings of the drivers (#59) and the setup (#96, #126, #46, #37, #154), all from /api/tafel.
// #242: three sub-tabs with their own anchor (#maschinenraum/betrieb, /einstellungen, /einrichtung; huelle.unter()),
// all three drawn at once and shown by the anchor, so drafts and typed text survive a switch. Betrieb: one card per
// account (tanks and the account of konten.json together), one line per machine, one card per project (forge, switches,
// counts, night run, last Andockprüfungen), the Werft. Einstellungen: compact rows in groups, a tap opens the control,
// one bar at the bottom takes over every draft. Einrichtung: steps, adding and removing, devices, push, stand.
// Above them always this device and the emergency stop. Every hint is one sentence; the rest is behind ⓘ (a button,
// never a title tooltip) or "Mehr". A field the report lacks says "nicht gemeldet", never a made-up value.
// The shell (huelle.js) calls zeichne(t, el) on every load while the area is visible and when the anchor changes; t is
// null before the first load, then the helpers of app.js do not exist yet. All scripts of the page share one scope:
// keep every name inside this call.
'use strict';

(() => {
  const KOPF = '<h2 class="ek bereich-kopf">Maschinenraum</h2>';
  const UNTER = ['betrieb', 'einstellungen', 'einrichtung'];
  const UNTER_TITEL = { betrieb: 'Betrieb', einstellungen: 'Einstellungen', einrichtung: 'Einrichtung' };
  const unterJetzt = () => {
    const u = huelle.unter();
    return UNTER.includes(u) ? u : 'betrieb';
  };
  const nichts = (was) => `<span class="mr-leer">${was ? `${was} ` : ''}nicht gemeldet</span>`;
  // the steps the driver brakes in: red is a colour only here, nothing blinks
  const STUFE = { gruen: 'frei', gelb: 'gebremst', rot: 'gestoppt' };

  // ---- what the person opened stays open across the 10 s redraw: ⓘ hints, <details>, settings rows
  const aufInfo = new Set();
  const aufDetails = new Map();
  const offeneZeilen = new Set();
  const info = (id, label) => `<button type="button" class="mr-info" aria-expanded="${aufInfo.has(id)}" aria-controls="${esc(id)}" aria-label="${esc(label)}">i</button>`;
  const infoText = (id, html) => `<p class="mr-info-text" id="${esc(id)}"${aufInfo.has(id) ? '' : ' hidden'}>${html}</p>`;
  // data-auf names a <details>, data-standard its drawn default; only a state that differs from it is kept
  const auf = (key, standard = false) => ` data-auf="${esc(key)}"${standard ? ' data-standard' : ''}${(aufDetails.has(key) ? aufDetails.get(key) : standard) ? ' open' : ''}`;
  const marke = (farbe, text) => `<b class="mr-marke ${farbe}">${esc(text)}</b>`;

  // ---- head: this device and the emergency stop, on every sub-tab

  function kopfHtml(t) {
    const g = t.geraet;
    const recht = (an, name) => marke(an ? 'gruen' : 'aus', name);
    const geraet = g
      ? `Dieses Gerät <b>${esc(g.name)}</b> ${recht(g.antworten, 'Antworten')} ${recht(g.handeln, 'Handeln')}`
      : t.amRechner ? 'Dieses Gerät <b>der Rechner selbst</b>' : 'Dieses Gerät <b>nicht gekoppelt</b>';
    const koppeln = !g && t.pin ? '<button type="button" class="knopf haupt klein" data-geraet-koppeln>Koppeln</button>' : '';
    const n = t.notaus;
    const notaus = n
      ? `<p class="mr-notaus" role="status"><b>Not-Aus</b> seit ${esc(wann(n.seit))} (${esc(n.geraet)}): die Brücke nimmt keine Antwort und keine Handlung an.</p>`
      : g && !t.nurAnsicht ? '<button type="button" class="knopf warn" data-notaus>Not-Aus</button>' : '';
    const ohne = t.pin ? '' : `<p class="mr-hilfe mr-ohne">Knöpfe abgeschaltet: ${huelle.ohnePin(t)}.</p>`;
    return `<header class="mr-kopf">${KOPF}<p class="mr-geraet">${geraet}</p><div class="knoepfe mr-kopf-knoepfe">${koppeln}${notaus}<span class="status" role="status"></span></div></header>${ohne}`;
  }

  function reiterHtml() {
    const n = entwuerfe.size;
    return `<nav class="mr-reiter" aria-label="Bereiche des Maschinenraums">${UNTER.map((u) => `<a href="#maschinenraum/${u}" data-unter="${u}">${UNTER_TITEL[u]}${u === 'einstellungen' ? ` <span class="mr-zaehler" data-entwuerfe${n ? '' : ' hidden'}>${n}</span>` : ''}</a>`).join('')}</nav>`;
  }

  // ---- Betrieb: accounts

  // Tag Q: which missions used how much on the account today and this week (since the start of its weekly window);
  // the share is an estimate (≈). Without data nothing, as before
  const missionenHtml = (k) => {
    if (!k.missionen?.length) return '';
    const wert = (z) => (z ? [anteilText(z.anteil), tokText(z.summe)].filter(Boolean).join(' · ') : '–');
    // the project names the mission once several projects report on the account
    const mehrere = new Set(k.missionen.map((m) => m.projekt)).size > 1;
    const zeilen = k.missionen.map((m) => `<li><b>${mehrere && m.projekt ? `${esc(m.projekt)} ` : ''}#${esc(m.epic)}</b><span>heute ${esc(wert(m.heute))}</span><span>Woche ${esc(wert(m.woche))}</span></li>`).join('');
    return `<details class="mr-mehr"${auf(`missionen:${k.konto}`)}><summary>Missionen (${k.missionen.length})</summary><ul class="mr-missionen">${zeilen}</ul></details>`;
  };

  // a tank: name, tube, "x % übrig", reset; on a phone the name stands above tube and value
  const tankHtml = (name, f) => {
    if (!f) return `<div class="mr-tank"><span>${name}</span>${nichts()}</div>`;
    const r = rest(f);
    const farbe = r < 20 ? 'var(--rot)' : r < 40 ? 'var(--gold)' : 'var(--gruen)';
    const d = datum(f.reset);
    const tag = d && d - jetzt() > 20 * 3600e3 ? `${d.toLocaleDateString('de-DE', { weekday: 'short' })} ` : '';
    return `<div class="mr-tank"><span>${name}</span><span class="roehre"><i style="--w:${r}%;--f:${farbe}"></i></span><b class="zahl">${Math.round(r)} % übrig</b><span class="mr-reset">Reset ${esc(tag)}${esc(uhrzeit(f.reset))}</span></div>`;
  };

  // #96: the accounts of konten.json with their buttons; the sign-in itself happens at the machine
  const ANMELDUNG = { angemeldet: 'angemeldet', 'nicht angemeldet': 'nicht angemeldet', 'ordner fehlt': 'Ordner fehlt', unklar: 'unklar' };
  const wartetAufRechner = (h) => (h ? `<span class="mr-wartet">${h.art === 'konto_anmelden' ? 'Anmelden' : h.art === 'konto_anlegen' ? 'Anlegen' : h.art === 'konto_aktivieren' ? 'Aktivieren' : 'Deaktivieren'} wartet auf den Rechner${h.abgeholt ? ' · abgeholt' : ''}</span>` : '');

  // one card per account: the tanks the drivers report (by "Konto <nr>") and the entry of konten.json together
  function kontenKarten(t) {
    const liste = t.kontenListe ?? [];
    const name = (e) => `Konto ${e.nr}`;
    const karten = liste.map((e) => ({ ...(t.konten.find((k) => k.konto === name(e)) ?? { konto: name(e) }), eintrag: e }));
    for (const k of t.konten) if (!liste.some((e) => name(e) === k.konto)) karten.push({ ...k, eintrag: null });
    return karten;
  }

  const kontoHtml = (k, t) => {
    const e = k.eintrag;
    const tank = k.stufe !== undefined;
    const alt = k.veraltet || (k.alterMin != null && k.alterMin > 30);
    const vorsprung = !tank || k.vorsprung == null ? nichts() : marke(k.vorsprung >= 0 ? 'gruen' : '', `${k.vorsprung > 0 ? '+' : k.vorsprung < 0 ? '−' : ''}${Math.abs(Math.round(k.vorsprung))} Punkte`);
    const wertAlter = !tank ? '' : `<span class="mr-leer">${k.alterMin != null ? `Wert ${Math.round(k.alterMin)} min alt` : 'Alter nicht gemeldet'}${k.veraltet ? ' · Treiber still' : ''}</span>`;
    const bremse = !tank ? nichts() : k.stufe === 'gruen' ? `${marke('gruen', 'keine')} ${wertAlter}` : `${marke(k.stufe, STUFE[k.stufe] ?? k.stufe)} ${k.grund ? esc(k.grund) : nichts('Grund')} ${wertAlter}`;
    const anm = e?.anmeldung ?? k.anmeldung;
    const anmeldung = anm ? marke(anm === 'angemeldet' ? 'gruen' : 'rot', ANMELDUNG[anm] ?? anm) : nichts();
    const zu = !t.pin || e?.handlung ? ' disabled' : '';
    const knoepfe = e
      ? `<div class="knoepfe">${e.anmeldung === 'angemeldet' ? '' : `<button type="button" class="knopf haupt klein" data-konto="konto_anmelden"${zu}>Am Rechner anmelden</button>`}<button type="button" class="knopf zweit klein" data-konto="${e.aktiv ? 'konto_deaktivieren' : 'konto_aktivieren'}"${zu}>${e.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button><span class="status" role="status">${wartetAufRechner(e.handlung)}</span></div>`
      : '';
    const daten = e ? ` data-forge="${esc(e.forge)}" data-nr="${esc(e.nr)}" data-name="${esc(e.name)}"` : '';
    const leise = [e ? k.konto : '', e?.rechner].filter(Boolean).join(' · ');
    return `<article class="mr-karte mr-konto ${tank ? esc(k.stufe) : ''}${e && !e.aktiv ? ' mr-aus' : ''}${alt || e?.veraltet ? ' veraltet' : ''}"${daten}>
<h3>${e ? `<span class="mr-farbe" style="background:${esc(e.farbe)}"></span>${esc(e.name)}` : esc(k.konto)}${leise ? ` <span class="mr-leise">${esc(leise)}</span>` : ''}</h3>
${tankHtml('Hauptenergie', k.fuenf)}${tankHtml('Reserveenergie', k.woche)}
<dl><dt>Vorsprung</dt><dd>${vorsprung}</dd><dt>Bremse</dt><dd>${bremse}</dd><dt>Anmeldung</dt><dd>${anmeldung}</dd>${e && !e.aktiv ? '<dt>Aktiv</dt><dd><b>nein</b> · bekommt keine neue Mission</dd>' : ''}</dl>
${missionenHtml(k)}${knoepfe}</article>`;
  };

  function kontenHtml(t) {
    const karten = kontenKarten(t);
    const text = `Vorsprung: übrige Reserveenergie (Wochenlimit) minus übriger Anteil der Woche bis zu ihrem Reset, in Punkten; so leeren sich die Konten gleichmäßig, auch mit Arbeit außerhalb der Flotte. Missionen je Konto: heute und seit Beginn des Wochenfensters. ${esc(VERBRAUCH_METHODE)}`;
    return `<h3 class="mr-titel">Konten <small>Neue Missionen starten zuerst auf dem freien Konto mit dem größten Vorsprung ${info('mr-i-vorsprung', 'Was ist der Vorsprung?')}</small></h3>${infoText('mr-i-vorsprung', text)}${karten.length ? `<div class="mr-reihe">${karten.map((k) => kontoHtml(k, t)).join('')}</div>` : '<p class="bereich-leer">Noch kein Konto gemeldet.</p>'}`;
  }

  // ---- Betrieb: one line per machine, one brake in colour; the beat of each driver stands at its project
  const rechnerHtml = (r) => {
    const ram = r.ram
      ? `${marke({ ok: 'gruen', warn: 'gelb', hold: 'rot' }[r.ram.stufe] ?? '', { ok: 'ok', warn: 'warn', hold: 'halt' }[r.ram.stufe] ?? r.ram.stufe)}${r.ram.prozent != null ? ` <b class="zahl">${Math.round(r.ram.prozent)} %</b>` : ''}${r.ram.halt ? ' · Bremse hält neue Läufe an' : ''}`
      : nichts();
    const platte = r.platte
      ? `${marke(r.platte.genug ? 'gruen' : 'rot', r.platte.genug ? 'ok' : 'knapp')}${r.platte.freiGb != null ? ` <b class="zahl">${Math.round(r.platte.freiGb)} GB frei</b>` : ''}${r.platte.genug ? '' : ' · Bremse hält neue Läufe an'}`
      : nichts();
    const grenze = r.obergrenze != null ? `<b class="zahl">${r.obergrenze}</b> Läufe gleichzeitig` : nichts();
    return `<div class="mr-rechner${r.veraltet ? ' veraltet' : ''}"><h4>${esc(r.name || 'Rechner')}</h4><span><span class="mr-dt">RAM</span>${ram}</span><span><span class="mr-dt">Platte</span>${platte}</span><span><span class="mr-dt">Obergrenze</span>${grenze}</span></div>`;
  };

  // ---- Betrieb: one card per project

  // the repository with its source: a link to the forge's page (the internal Gitea or GitHub), else the name
  const quelle = (p, name) => (p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\//, ''))}</a>` : esc(name));

  // #125: the forge as one line; "Am Rechner verknüpfen" (the machine opens a terminal: gh auth login, or the Gitea
  // token into its credential store) only when something is missing; never a token here
  const FORGE_NAME = { github: 'GitHub', gitea: 'Gitea' };
  function forgeZeileHtml(t, p) {
    const f = p.forgeStatus;
    if (!f) return nichts();
    const gut = f && f.angemeldet && f.rechte === 'ok';
    const stand = !f.angemeldet ? marke('rot', 'nicht angemeldet') : `als <b>${esc(f.konto || '–')}</b> ${f.rechte === 'ok' ? marke('gruen', 'Schreiben') : `${marke('rot', 'Rechte fehlen')} das Konto darf nicht pushen`}`;
    const knopf = p.meldetForge && (!gut || p.verknuepfen) ? ` <span class="knoepfe mr-einzeln"><button type="button" class="knopf haupt klein" data-forge-verknuepfen="${esc(p.forge)}"${!t.pin || p.verknuepfen ? ' disabled' : ''}>Am Rechner verknüpfen</button><span class="status" role="status">${p.verknuepfen ? `<span class="mr-wartet">Verknüpfen wartet auf den Rechner${p.verknuepfen.abgeholt ? ' · abgeholt' : ''}</span>` : ''}</span></span>` : '';
    return `${esc(FORGE_NAME[f.art] ?? f.art)} · ${stand}${knopf}`;
  }

  async function forgeKnopf(ev) {
    const b = ev.target.closest('[data-forge-verknuepfen]');
    if (!(await bestaetigen('Am Rechner ein Terminal zum Verknüpfen der Forge öffnen? Dort meldest du dich an; kein Token geht durch die Brücke.', 'Öffnen'))) return;
    const zeile = b.closest('.knoepfe');
    if (await senden('/api/handlung', { forge: b.dataset.forgeVerknuepfen, epic: 0, art: 'forge_verknuepfen', nr: null, seit: null, text: null }, zeile, zeile.querySelector('.status'))) await laden();
  }

  // an adapter with gaps of the template starts no mission: the card names the person's step
  const lueckenHtml = (p) =>
    p.adapterLuecken?.length
      ? `<p class="dein-schritt"><b>Dein Schritt:</b> Adapter ausfüllen (in einem eigenen Chat)</p><p class="mr-hilfe">Noch auszufüllen in <code>.claude/epic.md</code>: ${p.adapterLuecken.map((k) => `<code>${esc(k)}</code>`).join(', ')}; bis dahin startet hier keine Mission.</p>`
      : '';
  // step 8 of the gate rework: a red night run holds the merge queue until the person releases it at the machine
  const nachtZeit = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');
  const nachtlaufHtml = (p) => {
    const n = p.nachtlauf;
    if (!n) return '';
    const h = n.halt;
    const issue = h?.issue ? (p.url ? `<a href="${esc(p.url)}/issues/${h.issue}" target="_blank" rel="noopener">Issue #${h.issue}</a>` : `Issue #${h.issue}`) : 'kein Issue';
    const halt = h
      ? `<p class="mr-halt"><b>Andock-Schlange hält</b> seit ${esc(nachtZeit(h.seit))}: ${esc(h.grund)}${h.commit ? ` (<code>${esc(h.commit.slice(0, 7))}</code>)` : ''}, ${issue}${h.gruen ? `, danach grün auf <code>${esc(h.gruen.commit.slice(0, 7))}</code>` : ''}; Missionen arbeiten weiter, freigeben am Rechner im Projektordner mit <code>flotte nachtlauf --freigeben</code>.</p>`
      : '';
    const l = n.letzter;
    const wort = { gruen: 'grün', rot: 'rot', fehler: 'nicht gefahren' };
    const letzter = l ? `<p class="mr-hilfe">Letzter Nachtlauf ${esc(nachtZeit(l.zeit))}: ${wort[l.ergebnis] ?? esc(l.ergebnis)}${l.commit ? ` auf <code>${esc(l.commit.slice(0, 7))}</code>` : ''}${l.wiederholt ? ', wiederholt' : ''}${l.grund ? ` (${esc(l.grund)})` : ''}.</p>` : '';
    return halt + letzter;
  };

  // #193 and Tag O: the switches einsammeln and lernschleife per project, changed like every setting (einstellen);
  // the settings in Einstellungen leave them out. A locked switch says why, visibly.
  const AUTOMATIK = 'einsammeln';
  const LERNEN = 'lernschleife';
  const JE_PROJEKT = [AUTOMATIK, LERNEN];
  const SCHALTER = {
    [AUTOMATIK]: { titel: 'Einsammeln', info: 'An: der Treiber sammelt jede freigegebene Mission selbst ein und wartet danach auf neue wie mit <code>--dauerhaft</code>. Aus: keine neue Mission; laufende, wartende und aufgenommene laufen weiter, nichts hält an. Wirkt ab dem nächsten Takt; ein Start mit <code>--dauerhaft</code> oder <code>--epics</code> setzt den Wert neu.' },
    [LERNEN]: { titel: 'Lernschleife', info: 'Ab Werk aus. An: nach jedem Andocken liest ein billiges Modell den Lauf und schreibt höchstens drei belegte Vorschläge als Kommentar an das Sammel-Issue <code>lern_issue</code> des Projekts; der Triage-Lauf entscheidet sie, der Frachtraum zeigt sie unter „Lernschleife“, umgesetzt wird nichts von selbst. Einschalten geht nur, wenn der Adapter <code>lern_issue</code> nennt. Wirkt ab dem nächsten Takt; ein Start mit <code>--lernschleife</code> setzt den Wert neu („Start“ heißt auch: beim ersten Start nach dem Update aus der bestehenden Einrichtung übernommen).' },
  };

  function schalterHtml(t, p, name) {
    const e = p.einstellungen?.find((x) => x.name === name);
    const s = SCHALTER[name];
    const id = `mr-i-${name}-${p.forge}`;
    if (!e) return `<div class="mr-schalter-feld"><span class="mr-schalter-knopf mr-aus">${s.titel} ${nichts()}</span></div>`;
    const an = basis(e) === 'an';
    // locked: on is not to be had (no lern_issue); off stays possible while it is still on
    const gesperrt = !an && !e.werte?.includes('an');
    const pille = gesperrt ? marke('aus', 'gesperrt') : marke(an ? 'gruen' : 'aus', an ? 'an' : 'aus');
    const wartet = e.offen ? `<span class="mr-wartet">wartet auf den Treiber · neu <b>${esc(e.offen.wert)}</b>${e.offen.abgeholt ? ' · abgeholt' : ''}</span>` : '';
    const grund = gesperrt ? `<span class="mr-grenze">Gesperrt: ${esc(e.hinweis ?? 'der Treiber nimmt an nicht an')}.</span>` : '';
    return `<div class="mr-schalter-feld"><div class="mr-schalter-zeile"><button type="button" class="mr-schalter-knopf" data-schalter="${esc(name)}" data-forge="${esc(p.forge)}" data-wert="${an ? 'aus' : 'an'}" aria-pressed="${an}"${!t.pin || e.offen?.abgeholt || gesperrt ? ' disabled' : ''}><span>${s.titel}</span>${pille}</button>${info(id, `Was macht ${s.titel}?`)}</div>${wartet || grund ? `<p class="mr-hilfe">${wartet}${grund}</p>` : ''}${infoText(id, `${s.info} <span class="mr-herkunft ${esc(e.herkunft)}">${esc(HERKUNFT[e.herkunft] ?? e.herkunft)}</span>`)}</div>`;
  }

  async function schalterKnopf(ev) {
    const knopf = ev.target.closest('[data-schalter]');
    const karte = knopf.closest('.mr-projekt');
    const text = JSON.stringify({ name: knopf.dataset.schalter, wert: knopf.dataset.wert });
    if (await senden('/api/handlung', { forge: knopf.dataset.forge, epic: 0, art: 'einstellen', nr: null, seit: null, text }, karte.querySelector('.mr-schalter'), karte.querySelector('.mr-schalter-status'))) await laden();
  }

  // the last Andockprüfungen of the driver, newest first: result, duration and the share of the contexts whose result
  // came from the cache (adapter gate_cached); without that key only the duration
  const andockZeile = (m) => `<li><span class="mr-andock-nr">#${esc(m.epic)}</span>${marke(m.gruen ? 'gruen' : 'rot', m.gruen ? 'grün' : 'rot')}<span class="zahl">${esc(gateDauer(m.dauerS))}</span><span class="mr-andock-cache">${esc(m.mitCache ? `${m.ausCache} von ${m.mitCache} aus dem Cache` : '')}</span><time>${esc(uhrzeit(m.zeit))}</time></li>`;

  function projektKarteHtml(t, p) {
    const z = p.sammeln ?? { laufend: 0, wartend: 0, freigegeben: 0 };
    const bericht = p.veraltet ? `still seit ${esc(uhrzeit(p.empfangen))}` : p.aktiv ? `Bericht ${esc(uhrzeit(p.empfangen))}` : 'beendet';
    const kopf = [esc(p.rechner || ''), `Takt ${esc(p.taktS)} s`, bericht].filter(Boolean).join(' · ');
    const gitea = p.forgeStatus && !p.forgeStatus.treiber ? '<p class="mr-hilfe">Der Treiber spricht noch kein Gitea (#127): Missionen dieses Projekts fährt er noch nicht.</p>' : '';
    const a = (p.andockpruefungen ?? []).slice(0, 10);
    const andock = a.length
      ? `<div class="mr-andock-block"><h4>Letzte Andockprüfungen ${info(`mr-i-andock-${p.forge}`, 'Was zeigen die Andockprüfungen?')}</h4>${infoText(`mr-i-andock-${p.forge}`, 'Die Andockprüfungen, die der Treiber an der Spitze der Andock-Schlange fuhr, neueste zuerst: Ergebnis, Dauer und wie viele der gelaufenen Kontexte ihr Ergebnis aus dem Cache nahmen; nennt der Adapter dafür kein Muster, steht nur die Dauer da.')}<ol class="mr-andock">${a.slice(0, 3).map(andockZeile).join('')}</ol>${a.length > 3 ? `<details class="mr-mehr"${auf(`andock:${p.forge}`)}><summary>Mehr (${a.length - 3})</summary><ol class="mr-andock">${a.slice(3).map(andockZeile).join('')}</ol></details>` : ''}</div>`
      : '<p class="mr-hilfe">Noch keine Andockprüfung.</p>';
    const zahl = (n, was) => `<span><b class="zahl">${n}</b> ${was}</span>`;
    return `<article class="mr-karte mr-projekt${p.veraltet ? ' veraltet' : ''}" data-forge="${esc(p.forge)}"><h3>${esc(p.kurz)} <span class="mr-leise">${kopf}</span></h3>
<dl><dt>Repository</dt><dd>${quelle(p, p.forge)}</dd><dt>Forge</dt><dd>${forgeZeileHtml(t, p)}</dd></dl>${gitea}${lueckenHtml(p)}${nachtlaufHtml(p)}
<div class="mr-schalter">${schalterHtml(t, p, AUTOMATIK)}${schalterHtml(t, p, LERNEN)}</div><span class="status mr-schalter-status" role="status"></span>
<p class="mr-zahlen">${zahl(z.laufend, 'laufend')}${zahl(z.wartend, 'wartend')}${zahl(z.freigegeben, 'freigegeben, nicht eingesammelt')}</p>
${andock}</article>`;
  }

  const projekteHtml = (t) => `<h3 class="mr-titel">Projekte</h3>${t.projekte.length ? `<div class="mr-reihe">${t.projekte.map((p) => projektKarteHtml(t, p)).join('')}</div>` : '<p class="bereich-leer">Noch kein Projekt gemeldet.</p>'}`;

  // ---- Werft (#90): per repository and machine the stand of each stack, its last log and the two buttons;
  // the bridge only stores what the person asks, the Werft fetches it in its next takt (every 15 s)
  const WERFT = 'werft:';
  const istWerft = (key) => String(key).startsWith(WERFT);
  const kurzSha = (sha) => (sha ? sha.slice(0, 7) : '');
  const STAND = { gruen: 'grün', rot: 'rot', wartet: 'wartet', aus: 'aus', neu: 'noch nicht gezogen' };
  const ARBEIT = {
    wartet: (a) => `wartet auf deine Freigabe · Sicherung <code>${esc(a.sicherung)}</code> geprüft`,
    gesperrt: () => 'gesperrt: keine geprüfte Sicherung · „Jetzt nachziehen“ nimmt eine neue',
    laeuft: (a) => `läuft seit ${esc(wann(a.zeit))}`,
    migriert: (a) => `migriert ${esc(wann(a.zeit))}`,
    rot: () => 'rot, siehe Protokoll · „Jetzt nachziehen“ nimmt eine neue Sicherung',
  };
  const findeWerft = (t, key) => (t?.werft ?? []).find((w) => w.id === key);
  const unterwegs = (h, was) => (h ? `<span class="mr-wartet">${was} wartet auf die Werft${h.abgeholt ? ' · abgeholt, Quittung folgt' : ''}</span>` : '');

  function stackHtml(w, s, darf) {
    const aus = !w.an || !s.an;
    const a = s.arbeit;
    const stand = aus ? 'aus' : s.nachziehen || a?.zustand === 'wartet' ? 'wartet' : s.status ?? 'neu';
    const farbe = { gruen: 'gruen', rot: 'rot', wartet: 'gelb' }[stand] ?? '';
    const zu = !darf || aus ? ' disabled' : '';
    // locked or red: pulling again takes a new backup, so that is the main button then
    const neuSichern = a && (a.zustand === 'gesperrt' || a.zustand === 'rot');
    const nachziehen = `<button type="button" class="knopf ${neuSichern || s.status === 'rot' ? 'haupt' : 'zweit'} klein" data-nachziehen${zu || s.nachziehen?.abgeholt ? ' disabled' : ''}>Jetzt nachziehen</button>`;
    const freigeben = a?.zustand === 'wartet' ? `<button type="button" class="knopf haupt klein" data-freigeben${zu || s.freigabe?.abgeholt ? ' disabled' : ''}>Arbeits-Migration freigeben</button>` : '';
    const migration = s.migration?.arbeit ? `<dt>Arbeits-Migration</dt><dd>${a ? ARBEIT[a.zustand]?.(a) ?? esc(a.zustand) : '<span class="mr-leer">noch keine</span>'}${a?.commit ? ` · <code>${esc(kurzSha(a.commit))}</code>` : ''}</dd>` : '';
    const test = s.migration?.test ? `<dt>Test-Migration</dt><dd>${w.migrationTest ? 'läuft nach jedem Nachziehen selbst' : 'aus'}</dd>` : '';
    const key = `protokoll:${w.id}:${s.name}`;
    const protokoll = s.protokoll ? `<details class="mr-protokoll"${auf(key, s.status === 'rot')}><summary>Letztes Protokoll</summary><pre>${esc(s.protokoll)}</pre></details>` : '';
    return `<article class="mr-karte mr-stack ${farbe}" data-werft="${esc(w.id)}" data-stack="${esc(s.name)}">
<h4>${esc(s.name)} ${marke(farbe || 'aus', STAND[stand])}</h4>
<dl><dt>Stand</dt><dd>${s.commit ? `<code>${esc(kurzSha(s.commit))}</code> · ${esc(wann(s.zeit))}` : '<span class="mr-leer">noch nicht gezogen</span>'}${s.commit && w.stand && s.commit !== w.stand && !aus ? ' · <span class="mr-leer">älter als der Stand</span>' : ''}</dd>${test}${migration}</dl>
${protokoll}${unterwegs(s.nachziehen, 'Nachziehen')}${unterwegs(s.freigabe, 'Freigabe')}
<div class="knoepfe">${freigeben}${nachziehen}<span class="status" role="status"></span></div></article>`;
  }

  function werftHtml(t) {
    const liste = t.werft ?? [];
    if (!liste.length) return '';
    const mehrere = new Set(liste.map((w) => w.rechner)).size > 1;
    return liste.map((w) => {
      const kopf = `${esc(w.kurz)}${mehrere ? ` · ${esc(w.rechner)}` : ''}`;
      const lage = !w.an ? 'Die Werft ist für dieses Repository aus: sie holt nichts und zieht nichts nach.' : w.veraltet ? `Die Werft meldet sich seit ${wann(w.empfangen)} nicht: Knöpfe wirken ab ihrem nächsten Takt.` : '';
      return `<div class="mr-werft${w.veraltet ? ' veraltet' : ''}"><h3 class="mr-titel">Werft <small>${kopf} · ${esc(w.branch)} bei <code>${esc(kurzSha(w.stand)) || '–'}</code> · geprüft ${esc(wann(w.geprueft)) || '–'} · alle ${esc(w.abfrageS)} s</small></h3>${w.fehler ? `<p class="mr-hinweis mr-fehler">${esc(w.fehler)}</p>` : ''}${lage ? `<p class="mr-hinweis">${esc(lage)}</p>` : ''}
<div class="mr-reihe">${w.stacks.map((s) => stackHtml(w, s, t.pin)).join('') || '<p class="bereich-leer">Der Adapter nennt keine Stacks.</p>'}</div></div>`;
    }).join('');
  }

  async function werftKnopf(ev, art) {
    const karte = ev.target.closest('.mr-stack');
    const w = karte && findeWerft(letzte, karte.dataset.werft);
    const s = w?.stacks.find((x) => x.name === karte.dataset.stack);
    if (!s) return;
    let text = null;
    if (art === 'migration_freigeben') {
      const a = s.arbeit;
      if (!(await bestaetigen(`Arbeits-Migration von ${s.name} (${w.kurz}) beim Stand ${kurzSha(a.commit)} freigeben? Die Werft fährt sie genau einmal, gebunden an die Sicherung ${a.sicherung}. Eine neuere Sicherung braucht eine eigene Freigabe.`, 'Freigeben'))) return;
      text = JSON.stringify({ commit: a.commit, sicherung: a.sicherung, pruefsumme: a.pruefsumme });
    }
    if (await senden('/api/werft/handlung', { rechner: w.rechner, forge: w.forge, stack: s.name, art, text }, karte, karte.querySelector('.status'))) await laden();
  }

  // ---- #154: a newer stand as a banner on top of Betrieb; the stand of bridge and drivers in Einrichtung
  const kurz = (c) => (c ? c.slice(0, 7) : null);
  const standWert = (c, d) => (c ? `<code>${esc(kurz(c))}</code>${d ? ` · ${esc(wann(d))}` : ''}` : nichts());
  const mitVersion = (t) => t.projekte.filter((p) => p.version);
  const kannEinspielen = (t, p) => t.pin && p.version && !p.version.einspielen && !(p.einspielen && p.einspielen.abgeholt);

  function einspielenStand(t, p) {
    const v = p.version;
    if (v.einspielen) {
      const w = v.einspielen.wartetAuf;
      return `<span class="mr-wartet">${w.length ? `Wartet auf das Andocken von ${w.map((n) => `#${n}`).join(', ')}` : 'Hält an'}</span>, dann spielt der Treiber ein und startet neu.`;
    }
    if (p.einspielen) return `<span class="mr-wartet">wartet auf den Treiber</span>${p.einspielen.abgeholt ? ' · abgeholt' : ''}`;
    return '';
  }

  function bannerHtml(t) {
    const ps = mitVersion(t);
    const neu = ps.filter((p) => p.version.neu);
    if (!neu.length) return '';
    const n = neu[0].version.neu;
    const alle = ps.length > 1;
    const ziel = alle ? 'alle' : neu[0].forge;
    const kann = alle ? ps.some((p) => kannEinspielen(t, p)) : kannEinspielen(t, neu[0]);
    const status = ps.map((p) => einspielenStand(t, p)).find(Boolean) ?? '';
    return `<div class="mr-banner" role="status"><p><b>Neuer Stand verfügbar</b> · <code>${esc(kurz(n.commit))}</code>, ${esc(wann(n.datum))} · <span translate="no">${esc(n.titel)}</span>${alle && neu.length < ps.length ? ` <span class="mr-leer">(${neu.map((p) => esc(p.kurz)).join(', ')})</span>` : ''}</p><div class="knoepfe"><button type="button" class="knopf haupt klein" data-einspielen="${esc(ziel)}"${kann ? '' : ' disabled'}>${alle ? 'Einspielen und alle Treiber neu starten' : 'Einspielen und Treiber neu starten'}</button><span class="status" role="status">${status}</span></div></div>`;
  }

  function treiberStandHtml(t, p) {
    const v = p.version;
    if (!v) return `<article class="mr-karte mr-stand-karte${p.veraltet ? ' veraltet' : ''}"><h3>Treiber · ${esc(p.kurz)}</h3><p class="mr-hilfe">Dieser Treiber meldet keinen Stand (älterer Stand): einspielen von Hand.</p></article>`;
    const neu = v.neu
      ? `<p class="mr-neu">Neu: <code>${esc(kurz(v.neu.commit))}</code>, ${esc(wann(v.neu.datum))}, <span translate="no">${esc(v.neu.titel)}</span></p>`
      : `<p class="mr-hilfe">${v.geprueft ? `Aktuell mit main, geprüft ${esc(wann(v.geprueft))}.` : v.commit ? 'Noch nicht mit main verglichen.' : ''}</p>`;
    return `<article class="mr-karte mr-stand-karte${v.neu ? ' neu' : ''}${p.veraltet ? ' veraltet' : ''}" data-forge="${esc(p.forge)}"><h3>Treiber · ${esc(p.kurz)}</h3>
<dl><dt>Stand</dt><dd>${standWert(v.commit, v.datum)}</dd><dt>Eingespielt</dt><dd>${v.installiert ? esc(wann(v.installiert)) : nichts()}</dd><dt>Gestartet</dt><dd>${esc(wann(v.gestartet))}</dd></dl>
${neu}<div class="knoepfe"><button type="button" class="knopf ${v.neu ? 'haupt' : 'zweit'} klein" data-einspielen="${esc(p.forge)}"${kannEinspielen(t, p) ? '' : ' disabled'}>Einspielen und Treiber neu starten</button><span class="status" role="status">${einspielenStand(t, p)}</span></div></article>`;
  }

  function standHtml(t) {
    const b = t.bruecke ?? {};
    const bruecke = `<article class="mr-karte mr-stand-karte"><h3>Flottenbrücke</h3><dl><dt>Stand</dt><dd>${standWert(b.commit, b.datum)}</dd></dl>${b.commit ? '' : '<p class="mr-hilfe">Gebaut ohne Stand: beim nächsten Einspielen über den Treiber kommt er dazu.</p>'}</article>`;
    const ps = mitVersion(t);
    const alle = t.pin && ps.length > 1 ? `<div class="knoepfe mr-alle"><button type="button" class="knopf zweit klein" data-einspielen="alle"${ps.some((p) => kannEinspielen(t, p)) ? '' : ' disabled'}>Einspielen und alle Treiber neu starten</button><span class="status" role="status"></span></div>` : '';
    const text = 'Einspielen hält den Treiber an: Er startet nichts Neues, ein laufendes Andocken läuft zu Ende, laufende Läufe arbeiten weiter; dann holt er main, spielt den Skill-Satz ein, baut die Brücke neu, wenn sie sich geändert hat, startet mit derselben Kommandozeile neu und übernimmt die Läufe.';
    return `<h3 class="mr-titel">Stand <small>Brücke und je Treiber ${info('mr-i-stand', 'Was macht Einspielen?')}</small></h3>${infoText('mr-i-stand', esc(text))}${alle}<div class="mr-reihe">${bruecke}${t.projekte.map((p) => treiberStandHtml(t, p)).join('')}</div>`;
  }

  async function einspielenKnopf(ev) {
    const b = ev.target.closest('[data-einspielen]');
    const ziel = b.dataset.einspielen;
    const p = (letzte?.projekte ?? []).find((x) => x.forge === ziel);
    const wer = ziel === 'alle' ? 'alle Treiber' : `den Treiber von ${p?.kurz ?? ziel}`;
    if (!(await bestaetigen(`Neuen Stand für ${wer} einspielen und neu starten? Laufende Läufe arbeiten weiter und werden danach übernommen; ein offenes Andocken wartet der Treiber ab.`, 'Einspielen'))) return;
    const zeile = b.closest('.knoepfe');
    if (await senden('/api/handlung', { forge: ziel, epic: 0, art: 'einspielen', nr: null, seit: null, text: null }, zeile, zeile.querySelector('.status'))) await laden();
  }

  // ---- Einstellungen (#59): the effective values with their origin as compact rows in groups; a tap opens the control,
  // a pick is a draft, one bar at the bottom sends every draft as before (einstellen per driver, or the Werft's own)
  const HERKUNFT = { start: 'Start', bruecke: 'Flottenbrücke', standard: 'Standard', gemischt: 'je Treiber' };
  const GRUPPEN = [
    { titel: 'Kapazität', namen: ['obergrenze', 'paketeJeEpic', 'konten', 'admiral'] },
    { titel: 'Bremsen', namen: ['verbrauchGelb', 'verbrauchRot', 'leerfahren', 'ramWarn', 'platteMinGb', 'leerlaufMin'] },
    { titel: 'Andocken und Modelle', namen: ['merge', 'triageModell', 'admiralModell', 'triageLesenMax'] },
    { titel: 'Meldung', namen: ['meldung'] },
  ];
  // every setting holds for the whole fleet: shown once, "Übernehmen" goes to each driver
  const ALLE = '*';
  const HILFE = {
    obergrenze: 'Mehr Missionen laufen nie gleichzeitig; automatisch folgt die Grenze der Wochen-Hochrechnung.',
    paketeJeEpic: 'So viele Pakete einer Mission arbeiten gleichzeitig; /mission senkt das Fenster ab dem nächsten frei werdenden Platz, nichts wird abgebrochen.',
    konten: 'Neue Missionen starten nur auf diesen Konten, laufende bleiben auf ihrem; ein Neustart setzt --konten wieder ein.',
    admiral: 'Dieses Konto beantwortet die nächsten Fragen des Admirals; automatisch das Konto der Mission.',
    verbrauchGelb: 'Über diesem Verbrauch im 5-Stunden-Fenster startet nichts Neues; muss unter Rot liegen.',
    verbrauchRot: 'Darüber halten auch Fortsetzungen an; muss über Gelb liegen.',
    leerfahren: 'Diese Konten bremsen erst bei 100 %, nicht schon bei Hochrechnung oder Gelb.',
    ramWarn: 'Ab dieser RAM-Auslastung warnt der Treiber; automatisch gilt die Vorgabe des Projekts.',
    platteMinGb: 'Unter so viel freiem Plattenplatz startet nichts Neues.',
    leerlaufMin: 'Nach so vielen Minuten ohne Lebenszeichen fasst der Treiber nach oder bricht den Zug ab.',
    meldung: 'An: bei einer neuen Frage oder Blockade zeigt der Rechner des Treibers eine Windows-Meldung, mehrere im selben Takt als eine mit der Zahl.',
    merge: 'Automatisch dockt der Treiber nach grüner Andockprüfung an, sonst prüft ein Mensch jedes Andocken; berührt eine Mission die Liste „beim Menschen“, schlägt er dort „Mensch prüft“ vor (Schalter je Mission auf der Sternenkarte).',
    triageModell: 'Mit diesem Modell läuft der nächste Triage-Lauf samt Schnittplan; ein laufender behält seines.',
    admiralModell: 'Mit diesem Modell beantwortet der Admiral den nächsten Frageblock; Startwert ist --admiral-modell.',
    triageLesenMax: 'So viele Dateien darf das Modell der Triage je Aufruf selbst lesen (die üblichen Fakten legt das Programm vor), ab dem nächsten Aufruf.',
    // #90: the settings of the Werft of a repository
    an: 'Aus: die Werft holt nichts, zieht nichts nach, fährt keine Migration und lehnt eine Freigabe ab; wieder an, zieht sie nach, was inzwischen kam.',
    stacks: 'Nur diese Stacks zieht die Werft nach, auch auf Knopfdruck nur sie und ohne Migration; wieder an, holt ein Stack nach, was ihn inzwischen berührt hat.',
    abfrage_s: 'So oft schaut die Werft nach einem neuen Stand; automatisch gilt der Wert aus dem Adapter des Projekts.',
    migration_test: 'Ja: nach jedem Nachziehen läuft die Test-Migration von selbst; die Arbeits-Migration wartet immer auf deine Freigabe.',
  };
  // drafts: "forge|name" -> the value the person picked and has not sent yet
  const entwuerfe = new Map();
  let letzte = null;
  const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const art = (e) => (Array.isArray(e.wert) || Array.isArray(e.standard) ? 'liste' : e.werte ? 'wahl' : e.auswahl ? 'konto' : e.max - e.min <= 3 ? 'stufe' : 'zahl');
  const anzeige = (e, w) => (w == null ? (e.name === 'admiral' ? 'Konto der Mission' : e.adapter ? `automatisch (${e.adapter} s)` : 'automatisch') : Array.isArray(w) ? (w.length ? w.join(', ') : 'keine') : e.werte ? ANDOCKEN[w] ?? String(w) : String(w));
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
  const ziele = (t, forge) => (forge === ALLE ? mitEinstellungen(t) : (t?.projekte ?? []).filter((p) => p.forge === forge));
  const finde = (t, forge, name) => {
    if (istWerft(forge)) return findeWerft(t, forge)?.einstellungen.find((x) => x.name === name);
    const es = ziele(t, forge).map((p) => p.einstellungen?.find((x) => x.name === name)).filter(Boolean);
    return forge === ALLE ? vereint(es) : es[0];
  };
  const teileKey = (k) => [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
  // one setting of several drivers as one: the common value, or the first one and the row naming each
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
    // #112: a choice of words, only those the driver takes now
    if (a === 'wahl') return e.werte.map((x) => chip('radio', id, x, ANDOCKEN[x] ?? x, w === x)).join('');
    if (a === 'konto') return chip('radio', id, '', 'Konto der Mission', w == null) + e.auswahl.map((k) => chip('radio', id, k, k, w === k)).join('');
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
    const k = `${p.forge}|${e.name}`;
    const entwurf = entwuerfe.has(k);
    const w = entwurf ? entwuerfe.get(k) : e.je && !e.einig ? undefined : basis(e);
    const geholt = e.offen?.abgeholt ?? false;
    const id = esc(`mr-e-${i}-${e.name}`);
    const aufZeile = offeneZeilen.has(k);
    // what the row waits for, or that the drivers differ, stays visible on the row itself
    const stand = e.je && !e.einig
      ? `<span class="mr-wartet">unterschiedlich je Treiber</span> · ${e.je.map((x, n) => `${esc(mitEinstellungen(t)[n].kurz)} <b>${esc(anzeige(x, basis(x)))}</b>`).join(' · ')}`
      : e.offen
      ? `<span class="mr-wartet">wartet auf ${istWerft(p.forge) ? 'die Werft' : 'den Treiber'}</span> · neu <b>${esc(anzeige(e, e.offen.wert))}</b>${geholt ? ' · abgeholt, Quittung folgt' : ''} <span class="mr-seit">(jetzt <b>${esc(anzeige(e, e.wert))}</b>)</span>`
      : '';
    return `<div class="mr-einst-zeile${e.offen ? ' wartet' : ''}${entwurf ? ' entwurf-da' : ''}" data-forge="${esc(p.forge)}" data-name="${esc(e.name)}">
<button type="button" class="mr-zeile-kopf" aria-expanded="${aufZeile}" aria-controls="${id}-o"><span class="mr-name" id="${id}-t">${esc(e.titel)}</span><span class="mr-wert">${esc(w === undefined ? 'unterschiedlich' : anzeige(e, w))}</span><span class="mr-herkunft ${esc(e.herkunft)}">${esc(HERKUNFT[e.herkunft] ?? e.herkunft)}</span></button>
${stand ? `<p class="mr-stand">${stand}</p>` : ''}<div class="mr-offen" id="${id}-o" role="group" aria-labelledby="${id}-t"${aufZeile ? '' : ' hidden'}><p class="mr-hilfe">${esc(HILFE[e.name] ?? '')}${e.seit && !e.offen ? ` <span class="mr-seit">Wirksam seit ${esc(wann(e.seit))}.</span>` : ''}</p>${e.hinweis ? `<p class="mr-hilfe mr-grenze">${esc(e.hinweis)}</p>` : ''}
<div class="mr-regler">${reglerHtml(e, id, w, !darf || geholt)}</div></div></div>`;
  }

  // the rows of one driver (or of all, shared) in the groups; a value no group names comes under "Weitere"
  function gruppenHtml(p, i, es, t, zusatz = '') {
    const bekannt = GRUPPEN.flatMap((g) => g.namen);
    const gruppen = [...GRUPPEN, { titel: 'Weitere', namen: es.map((e) => e.name).filter((n) => !bekannt.includes(n)) }];
    return gruppen.map((g) => {
      const zeilen = g.namen.map((n) => es.find((e) => e.name === n)).filter(Boolean);
      return zeilen.length ? `<div class="mr-gruppe"><h3>${esc(g.titel)}${zusatz}</h3>${zeilen.map((e) => zeileHtml(p, i, e, t.pin, t)).join('')}</div>` : '';
    }).join('');
  }

  function einstellungenHtml(t) {
    const geteilt = gemeinsam(t);
    const mehrere = t.projekte.length > 1;
    const still = mitEinstellungen(t).some((p) => p.veraltet);
    const fuer = geteilt ? `Gilt für alle Treiber (${mitEinstellungen(t).map((p) => esc(p.kurz)).join(' und ')}) ab ihrem nächsten Takt` : 'Gilt ab dem nächsten Takt des Treibers';
    const text = `Nichts Laufendes bricht ab; jede Änderung steht im Logbuch.${geteilt ? ' „Missionen gleichzeitig“ zählt je Treiber.' : ''}${(t.werft ?? []).length ? ' Die Werft holt eine Änderung in ihrem nächsten Takt ab (alle 15 s).' : ''}${still ? ' Ein Treiber meldet sich gerade nicht: dort wirkt eine Änderung ab seinem nächsten Takt.' : ''}`;
    let html = `<p class="mr-hinweis">${fuer}; Zeile antippen zum Ändern. ${info('mr-i-einst', 'Mehr zu den Einstellungen')}</p>${infoText('mr-i-einst', esc(text))}`;
    let gruppen = '';
    if (geteilt) {
      const ps = mitEinstellungen(t);
      const namen = ps[0].einstellungen.map((e) => e.name).filter((n) => !JE_PROJEKT.includes(n));
      const es = namen.map((n) => vereint(ps.map((p) => p.einstellungen.find((e) => e.name === n)).filter(Boolean))).filter(Boolean);
      gruppen += gruppenHtml({ forge: ALLE }, 'alle', es, t);
    }
    // a driver without settings (older version) still gets its read-only note
    for (const [i, p] of t.projekte.entries()) {
      if (geteilt && p.einstellungen) continue;
      if (!p.einstellungen) {
        const r = t.rechner.find((x) => x.name === p.rechner);
        const bekannt = [r?.obergrenze != null ? `Missionen gleichzeitig <b>${r.obergrenze}</b>` : '', p.leerlaufS != null ? `Leerlauf <b>${Math.round(p.leerlaufS / 60)} min</b>` : ''].filter(Boolean).join(' · ');
        html += `<p class="mr-hinweis">${mehrere ? `<b>${esc(p.kurz)}</b>: ` : ''}Dieser Treiber meldet keine Einstellungen (älterer Stand), ändern geht nach dem Aktualisieren${bekannt ? `; bekannt ist ${bekannt}` : ''}.</p>`;
        continue;
      }
      gruppen += gruppenHtml(p, i, p.einstellungen.filter((e) => !JE_PROJEKT.includes(e.name)), t, mehrere ? ` <small>${esc(p.kurz)}</small>` : '');
    }
    gruppen += werftEinstellungenHtml(t);
    return `${html}<div class="mr-reihe mr-gruppen">${gruppen}</div>`;
  }

  // #90: the settings of the Werft, per repository and machine, as a group of their own
  function werftEinstellungenHtml(t) {
    const liste = t.werft ?? [];
    const mehrere = new Set(liste.map((w) => w.rechner)).size > 1;
    return liste.map((w, i) => `<div class="mr-gruppe"><h3>Werft · ${esc(w.kurz)}${mehrere ? ` · ${esc(w.rechner)}` : ''}${w.veraltet ? ' <small>meldet sich gerade nicht</small>' : ''}</h3>${w.einstellungen.map((e) => zeileHtml({ forge: w.id }, `w${i}`, e, t.pin, t)).join('')}</div>`).join('');
  }

  // what a draft sends to the Werft: one change per stack switched, else the setting itself
  function werftAenderungen(e, w) {
    if (e.name === 'stacks') return e.auswahl.filter((n) => w.includes(n) !== basis(e).includes(n)).map((n) => ({ stack: n, name: 'an', wert: w.includes(n) }));
    return [{ stack: null, name: e.name, wert: e.name === 'abfrage_s' ? w : w === 'an' || w === 'ja' }];
  }

  // the bar at the bottom: every draft at once, "n Änderungen übernehmen" or "Verwerfen"
  function leisteHtml(t) {
    const n = entwuerfe.size;
    if (!n || !t) return '';
    const liste = [...entwuerfe].map(([k, w]) => {
      const [forge, name] = teileKey(k);
      const e = finde(t, forge, name);
      return e ? `${esc(e.titel)} → <b>${esc(anzeige(e, w))}</b>` : '';
    }).filter(Boolean).join(' · ');
    const gut = [...entwuerfe].every(([k, w]) => {
      const e = finde(t, ...teileKey(k));
      return !e || gueltig(e, w);
    });
    return `<div class="mr-leiste-innen"><p><b>${n} ${n === 1 ? 'Änderung wartet' : 'Änderungen warten'}</b>: ${liste}</p><button type="button" class="knopf zweit" data-alle-verwerfen>Verwerfen</button><button type="button" class="knopf haupt" data-alle-uebernehmen${t.pin && gut ? '' : ' disabled'}>${n === 1 ? 'Änderung übernehmen' : `${n} Änderungen übernehmen`}</button><span class="status" role="status"></span></div>`;
  }

  // the bar and the count on the tab follow a draft at once, without drawing the rest
  function leisteZeigen(el) {
    const box = el.querySelector('.mr-leiste');
    if (box) {
      box.innerHTML = leisteHtml(letzte);
      box.hidden = !entwuerfe.size;
    }
    const z = el.querySelector('[data-entwuerfe]');
    if (z) {
      z.textContent = entwuerfe.size;
      z.hidden = !entwuerfe.size;
    }
  }

  // a control changed: keep the draft (the 10 s load draws again); a row whose drivers differ keeps even the same value,
  // so the bar can bring them together
  function geaendert(ev) {
    const zeile = ev.target.closest('.mr-einst-zeile');
    const e = zeile && finde(letzte, zeile.dataset.forge, zeile.dataset.name);
    if (!e) return;
    if (ev.target.type === 'checkbox' && ev.target.name.endsWith('-auto')) {
      const z = zeile.querySelector('input[type=number]');
      z.disabled = ev.target.checked;
      if (!z.disabled) z.focus();
    }
    const w = lies(zeile, e);
    const k = `${zeile.dataset.forge}|${e.name}`;
    if (w === undefined || (gleich(w, basis(e)) && !(e.je && !e.einig))) entwuerfe.delete(k);
    else entwuerfe.set(k, w);
    zeile.classList.toggle('entwurf-da', entwuerfe.has(k));
    zeile.querySelector('.mr-wert').textContent = anzeige(e, entwuerfe.has(k) ? w : basis(e));
    leisteZeigen(ev.currentTarget);
  }

  // one action per draft, as before; the first that fails stops, the rest stays as drafts
  async function alleUebernehmen(ev, el) {
    const leiste = ev.target.closest('.mr-leiste');
    const status = leiste.querySelector('.status');
    for (const [k, w] of [...entwuerfe]) {
      const [forge, name] = teileKey(k);
      const e = finde(letzte, forge, name);
      if (!e) {
        entwuerfe.delete(k);
        continue;
      }
      let gut = true;
      const werft = istWerft(forge) && findeWerft(letzte, forge);
      for (const x of werft ? werftAenderungen(e, w) : []) {
        if (!(await senden('/api/werft/handlung', { rechner: werft.rechner, forge: werft.forge, stack: x.stack, art: 'einstellen', text: JSON.stringify({ name: x.name, wert: x.wert }) }, leiste, status))) {
          gut = false;
          break;
        }
      }
      for (const p of werft ? [] : ziele(letzte, forge)) {
        if (!(await senden('/api/handlung', { forge: p.forge, epic: 0, art: 'einstellen', nr: null, seit: null, text: JSON.stringify({ name, wert: w }) }, leiste, status))) {
          gut = false;
          break;
        }
      }
      if (!gut) break;
      entwuerfe.delete(k);
    }
    const fehler = status.className.includes('schlecht') ? status.textContent : '';
    leisteZeigen(el);
    const neu = el.querySelector('.mr-leiste .status');
    if (fehler && neu) {
      neu.className = 'status schlecht';
      neu.textContent = fehler;
    }
    await laden();
  }

  function verwerfen(el) {
    entwuerfe.clear();
    // a draft changed the DOM directly; the signature of the last drawing does not know it
    delete el.dataset.sig;
    malen(letzte, el, true);
  }

  // ---- Einrichtung: the guided start (#96), what is still missing in this order; finished steps fold away
  const SCHRITT = {
    konto: { titel: 'Konto anlegen', text: 'Ein Konto ist ein Claude-Konfigordner auf dem Rechner: „Konto anlegen“ unten legt mit laufendem Treiber das nächste an, ohne Treiber am Rechner <code>flotte konten anlegen</code>.' },
    anmeldung: { titel: 'Am Rechner anmelden', text: '„Am Rechner anmelden“ an der Kontokarte unter Betrieb öffnet dort ein Terminal mit <code>claude</code> für <code>/login</code> (nichts davon geht durch die Brücke), ohne Treiber <code>flotte konten anmelden &lt;nr&gt;</code>.' },
    forge: { titel: 'Forge verknüpfen', text: '„Am Rechner verknüpfen“ an der Projektkarte unter Betrieb öffnet dort <code>gh auth login</code> (Gitea: Benutzer und Token in den Credential-Speicher), ohne Treiber <code>flotte forge verknuepfen &lt;repo&gt;</code>; fertig, wenn ein Treiber die Forge mit Schreibrecht meldet.' },
    projekt: { titel: 'Projekt hinzufügen', text: '„Projekt hinzufügen“ unten nimmt einen Ordner oder Link am Rechner, ohne laufenden Treiber <code>flotte projekt hinzufuegen &lt;ordner&gt; [--autostart]</code> und dann das Startskript.' },
  };
  const STAND_SCHRITT = { offen: 'offen', wartet: 'wartet auf den Rechner', fertig: 'fertig' };

  function einrichtenHtml(t) {
    const e = t.einrichten;
    if (!e) return '';
    // #240: without a driver report the bridge cannot know the steps; the check runs at the machine
    if (e.ohneTreiber) return '<h3 class="mr-titel">Einrichten</h3><p class="mr-hilfe">ohne Treiber: <code>flotte pruefen</code> am Rechner. Es zeigt Konto, Anmeldung, Forge und Projekt als Checkliste; hier erscheinen die Schritte, sobald ein Treiber berichtet.</p>';
    const fertig = e.schritte.filter((s) => s.stand === 'fertig').length;
    const schritte = `<ol class="mr-schritte">${e.schritte.map((s) => `<li class="mr-schritt ${esc(s.stand)}"><details${auf(`schritt:${s.schritt}`, s.stand !== 'fertig')}><summary>${marke(s.stand === 'fertig' ? 'gruen' : s.stand === 'wartet' ? 'gelb' : 'aus', STAND_SCHRITT[s.stand] ?? s.stand)} ${esc(SCHRITT[s.schritt]?.titel ?? s.schritt)}</summary><p class="mr-hilfe">${SCHRITT[s.schritt]?.text ?? ''}</p></details></li>`).join('')}</ol>`;
    if (!e.fertig) return `<h3 class="mr-titel">Einrichten <small>${fertig} von ${e.schritte.length} Schritten fertig</small></h3>${schritte}`;
    return `<h3 class="mr-titel">Einrichten <small>alles erledigt</small></h3><details class="mr-mehr"${auf('einrichten')}><summary>${fertig} von ${e.schritte.length} Schritten fertig</summary>${schritte}</details>`;
  }

  // ---- Einrichtung: adding a project (#126) goes to a running driver of a reported project, which writes adapter and
  // start script in the folder at its machine; the new project gets a driver of its own, which nothing here starts.
  // "Entfernen" halts a project's driver and takes it from the list, nothing is deleted. The typed folder survives the
  // reload of the page; with a link the driver clones first, the folder is proposed from the link until one is typed.
  let ordnerEntwurf = '';
  let linkEntwurf = '';
  let ordnerVorschlag = '';
  const linkName = (link) => /^https:\/\/[^/?#]+\/[\w.-]+\/([\w.-]+?)(?:\.git)?\/?$/.exec(link.trim())?.[1] ?? '';
  const holtProjekte = (t) => t.projekte.filter((p) => p.meldetProjekte && !p.veraltet);
  const projektWartet = (h, was) => (h ? `<span class="mr-wartet">${was} wartet auf den Rechner${h.abgeholt ? ' · abgeholt' : ''}</span>` : '');

  function hinzufuegenHtml(t) {
    const zu = !t.pin ? ' disabled' : '';
    const treiber = holtProjekte(t);
    if (!treiber.length) return '<h3 class="mr-titel">Projekt hinzufügen</h3><p class="mr-hilfe">Hinzufügen holt ein laufender Treiber ab, gerade meldet sich keiner; am Rechner: <code>flotte projekt hinzufuegen &lt;ordner&gt; [--autostart]</code> oder <code>flotte projekt hinzufuegen [&lt;ordner&gt;] --klonen &lt;https-Link&gt;</code>.</p>';
    const wartet = t.projekte.find((p) => p.hinzufuegen);
    const wahl = treiber.length > 1 ? `<label class="mr-feld">am Rechner des Treibers von<select class="mr-ordner" name="projekt-ueber"${zu}>${treiber.map((p) => `<option value="${esc(p.forge)}">${esc(p.kurz)}${p.rechner ? ` · ${esc(p.rechner)}` : ''}</option>`).join('')}</select></label>` : '';
    const klont = treiber.some((p) => p.klonAngebot);
    const gitea = [...new Set(treiber.flatMap((p) => p.klonAngebot?.gitea ?? []))].map((g) => g.replace(/^https:\/\//, ''));
    const linkFeld = klont ? `<label class="mr-feld">Link zum Repository<input type="url" class="mr-ordner" name="projekt-link" maxlength="300" autocomplete="off" spellcheck="false" inputmode="url" placeholder="https://github.com/owner/name" value="${esc(linkEntwurf)}"${zu}></label>` : '';
    const linkMehr = klont
      ? ` Mit Link klont der Rechner im Hintergrund mit seiner eigenen Git- und gh-Anmeldung (keine Zugangsdaten über die Brücke), nur <code>https://</code>-Links auf github.com${gitea.length ? ` oder ${gitea.map((g) => `<code>${esc(g)}</code>`).join(', ')}` : ''}; der Ordner wird aus dem Link vorgeschlagen, gibt es ihn schon, prüft der Rechner nur, ob sein <code>origin</code> passt. Danach prüft er Schreibrecht und Issues, legt fehlende Labels der Flotte an und nennt, was zum Einrichten fehlt (Abhängigkeiten, <code>.env</code>), ohne es auszuführen.`
      : '';
    const mehr = `Der laufende Treiber richtet das Projekt an seinem Rechner nur ein: Er prüft den Ordner (vorhanden, ein Git-Repository), schreibt den Adapter <code>.claude/epic.md</code> aus der Vorlage, wenn er fehlt, und das Startskript <code>~/.claude/flotte/start/&lt;name&gt;.ps1</code>, fährt das neue Repository aber nicht selbst. Der neue Treiber startet mit Autostart bei der nächsten Anmeldung, sonst von Hand mit dem Startskript; erst sein erster Bericht legt das Projekt hier an, und solange der Adapter Lücken der Vorlage hat, startet dort keine Mission.${linkMehr} „Entfernen“ hält den Treiber an; eine geplante Aufgabe „Flotte &lt;name&gt;“ (Autostart) startet ihn bei jeder Anmeldung wieder, abschalten in der Aufgabenplanung.`;
    return `<h3 class="mr-titel">Projekt hinzufügen</h3><article class="mr-karte mr-projekt-neu" data-ueber="${esc(treiber[0].forge)}"><div class="knoepfe">${wahl}${linkFeld}<label class="mr-feld">${klont ? 'oder Ordner am Rechner (bei Link: Vorschlag)' : 'Ordner am Rechner'}<input type="text" class="mr-ordner" name="projekt-ordner" maxlength="260" autocomplete="off" spellcheck="false" placeholder="C:\\pfad\\zum\\repository" value="${esc(ordnerEntwurf)}"${zu}></label></div>
<div class="knoepfe"><label class="mr-chip"><input type="checkbox" name="projekt-autostart"${zu}><span>Autostart beim Anmelden</span></label><button type="button" class="knopf haupt" data-projekt-hinzufuegen${zu || (wartet ? ' disabled' : '')}>Projekt hinzufügen</button><span class="status" role="status">${projektWartet(wartet?.hinzufuegen, 'Hinzufügen')}</span></div>
<p class="mr-hilfe">Der Rechner legt Adapter und Startskript an; das Projekt bekommt einen eigenen Treiber.</p><details class="mr-mehr"${auf('hinzufuegen')}><summary>Mehr</summary><p class="mr-hilfe">${mehr}</p></details></article>`;
  }

  // Konto anlegen per machine and Entfernen per project, together
  function verwaltenHtml(t) {
    const anlegen = (t.anlegen ?? []).map((a) => `<span class="knoepfe mr-einzeln" data-forge="${esc(a.forge)}" data-rechner="${esc(a.rechner)}"><button type="button" class="knopf zweit" data-konto="konto_anlegen"${!t.pin || a.handlung ? ' disabled' : ''}>Konto anlegen${(t.anlegen ?? []).length > 1 ? ` auf ${esc(a.rechner)}` : ''}</button><span class="status" role="status">${wartetAufRechner(a.handlung)}</span></span>`).join('');
    const entfernen = t.projekte.filter((p) => p.meldetProjekte).map((p) => `<span class="knoepfe mr-einzeln"><button type="button" class="knopf zweit" data-projekt-entfernen="${esc(p.forge)}"${!t.pin || p.entfernen ? ' disabled' : ''}>${esc(p.kurz)} entfernen</button><span class="status" role="status">${projektWartet(p.entfernen, 'Entfernen')}</span></span>`).join('');
    if (!anlegen && !entfernen) return '';
    return `<h3 class="mr-titel">Konten und Projekte verwalten</h3><div class="mr-verwalten">${anlegen}${entfernen}</div>`;
  }

  // the folder proposed from the link: next to the projects of the chosen driver's machine; a typed folder stays
  function linkGetippt(feld) {
    linkEntwurf = feld.value;
    const zeile = feld.closest('.mr-projekt-neu');
    const ordnerFeld = zeile.querySelector('[name="projekt-ordner"]');
    const ueber = zeile.querySelector('[name="projekt-ueber"]')?.value ?? zeile.dataset.ueber;
    const eltern = (letzte?.projekte ?? []).find((p) => p.forge === ueber)?.klonAngebot?.eltern;
    const name = linkName(feld.value);
    if (!eltern || (ordnerFeld.value.trim() && ordnerFeld.value !== ordnerVorschlag)) return;
    const trenner = eltern.includes('\\') ? '\\' : '/';
    ordnerVorschlag = name ? `${eltern.replace(/[\\/]+$/, '')}${trenner}${name}` : '';
    ordnerFeld.value = ordnerVorschlag;
    ordnerEntwurf = ordnerVorschlag;
  }

  async function projektKnopf(ev) {
    const entfernen = ev.target.closest('[data-projekt-entfernen]');
    if (entfernen) {
      const p = (letzte?.projekte ?? []).find((x) => x.forge === entfernen.dataset.projektEntfernen);
      if (!(await bestaetigen(`${p?.kurz ?? 'Das Projekt'} entfernen? Sein Treiber hält an (ein offenes Andocken läuft zu Ende), das Projekt verschwindet aus der Liste. Nichts wird gelöscht; ein neuer Start des Treibers bringt es zurück. Eine geplante Aufgabe „Flotte …“ (Autostart) bleibt und startet ihn bei jeder Anmeldung wieder: in der Aufgabenplanung deaktivieren oder löschen, wenn es wegbleiben soll.`, 'Entfernen'))) return;
      const zeile = entfernen.closest('.knoepfe');
      if (await senden('/api/handlung', { forge: entfernen.dataset.projektEntfernen, epic: 0, art: 'projekt_entfernen', nr: null, seit: null, text: null }, zeile, zeile.querySelector('.status'))) await laden();
      return;
    }
    const zeile = ev.target.closest('.mr-projekt-neu');
    const status = zeile.querySelector('.status');
    const ordner = zeile.querySelector('[name="projekt-ordner"]').value.trim();
    const url = zeile.querySelector('[name="projekt-link"]')?.value.trim() ?? '';
    const ueber = zeile.querySelector('[name="projekt-ueber"]')?.value ?? zeile.dataset.ueber;
    const fehlt = !ordner && !url ? 'Erst den Ordner oder einen Link angeben.' : url && !(letzte?.projekte ?? []).find((p) => p.forge === ueber)?.klonAngebot ? 'Dieser Treiber klont nicht (älterer Stand); einen anderen wählen oder den Ordner am Rechner angeben.' : '';
    if (fehlt) {
      status.className = 'status schlecht';
      status.textContent = fehlt;
      return;
    }
    const autostart = zeile.querySelector('[name="projekt-autostart"]').checked;
    const mit = autostart ? ', mit Autostart beim Anmelden' : '';
    const frage = url
      ? `Das Repository ${url} ${ordner ? `nach ${ordner} ` : ''}klonen und als Projekt hinzufügen${mit}? Der Rechner klont mit seiner eigenen Anmeldung, legt fehlende Labels an und schreibt Adapter (wenn er fehlt) und Startskript; Abhängigkeiten und .env richtet er nicht ein. Das Projekt bekommt einen eigenen Treiber, der danach nicht von selbst läuft: ${autostart ? 'er startet bei der nächsten Anmeldung oder' : 'starten'} von Hand mit dem Startskript.`
      : `Den Ordner ${ordner} als Projekt hinzufügen${mit}? Der Rechner schreibt nur Adapter (wenn er fehlt) und Startskript. Das Projekt bekommt einen eigenen Treiber, der danach nicht von selbst läuft: ${autostart ? 'er startet bei der nächsten Anmeldung oder' : 'starten'} von Hand mit dem Startskript.`;
    if (!(await bestaetigen(frage, url ? 'Klonen' : 'Hinzufügen'))) return;
    const wunsch = { ...(ordner ? { ordner } : {}), ...(url ? { url } : {}), autostart };
    if (await senden('/api/handlung', { forge: ueber, epic: 0, art: 'projekt_hinzufuegen', nr: null, seit: null, text: JSON.stringify(wunsch) }, zeile, status)) {
      ordnerEntwurf = '';
      linkEntwurf = '';
      ordnerVorschlag = '';
      await laden();
    }
  }

  async function kontoKnopf(ev) {
    const b = ev.target.closest('[data-konto]');
    const art = b.dataset.konto;
    const karte = b.closest('[data-forge]');
    const nr = art === 'konto_anlegen' ? 0 : Number(karte.dataset.nr);
    const frage = {
      konto_anlegen: 'Ein neues Konto anlegen? Der Rechner legt seinen Ordner an; anmelden musst du dich danach dort.',
      konto_anmelden: `Am Rechner ein Terminal zum Anmelden von ${karte.dataset.name} öffnen? Dort gibst du /login ein.`,
      konto_deaktivieren: `${karte.dataset.name} deaktivieren? Es bekommt keine neue Mission, laufende laufen dort zu Ende; der Ordner bleibt.`,
      konto_aktivieren: `${karte.dataset.name} wieder aktivieren?`,
    }[art];
    if (!(await bestaetigen(frage, b.textContent))) return;
    const zeile = b.closest('.knoepfe');
    if (await senden('/api/handlung', { forge: karte.dataset.forge, epic: nr, art, nr: null, seit: null, text: null }, zeile, zeile.querySelector('.status'))) await laden();
  }

  // ---- Einrichtung: #46 the paired devices; rights, unpairing and releasing the emergency stop only on the machine itself
  function geraetHtml(t, g) {
    const dieses = t.geraet?.id === g.id ? ' <span class="mr-leise">dieses Gerät</span>' : '';
    const knoepfe = t.amRechner
      ? `<div class="knoepfe"><button type="button" class="knopf zweit klein" data-geraet-recht="antworten">${g.antworten ? 'Antworten nehmen' : 'Antworten geben'}</button><button type="button" class="knopf ${g.handeln ? 'zweit' : 'haupt'} klein" data-geraet-recht="handeln">${g.handeln ? 'Handeln nehmen' : 'Handeln geben'}</button><button type="button" class="knopf warn klein" data-geraet-entkoppeln>Entkoppeln</button><span class="status" role="status"></span></div>`
      : '';
    return `<article class="mr-karte mr-geraet" data-geraet="${esc(g.id)}" data-antworten="${g.antworten ? '1' : ''}" data-handeln="${g.handeln ? '1' : ''}" data-name="${esc(g.name)}"><h3>${esc(g.name)}${dieses}</h3>
<dl><dt>Rechte</dt><dd>${marke('gruen', 'Ansehen')} ${marke(g.antworten ? 'gruen' : 'aus', 'Antworten')} ${marke(g.handeln ? 'gruen' : 'aus', 'Handeln')}</dd><dt>Gekoppelt</dt><dd>${esc(wann(g.gekoppelt))}</dd><dt>Zuletzt</dt><dd>${g.zuletzt ? esc(wann(g.zuletzt)) : '<span class="mr-leer">–</span>'}</dd></dl>${knoepfe}</article>`;
  }

  function geraeteHtml(t) {
    const satz = t.amRechner ? 'Am Rechner: Rechte geben und nehmen, entkoppeln und den Not-Aus lösen, jeweils mit PIN.' : 'Rechte gibt nur der Rechner selbst (localhost).';
    const text = 'Jede Antwort braucht ein gekoppeltes Gerät, jede Handlung ein Gerät mit dem Recht „Handeln“; die PIN braucht es nur zum Koppeln und am Rechner, dort öffnet man die Brücke über localhost (Port BRUECKE_RECHNER_PORT).';
    const loesen = t.notaus && t.amRechner ? '<div class="knoepfe mr-alle"><button type="button" class="knopf haupt" data-notaus-loesen>Not-Aus lösen</button><span class="status" role="status"></span></div>' : '';
    const liste = t.geraete.length ? `<div class="mr-reihe">${t.geraete.map((g) => geraetHtml(t, g)).join('')}</div>` : '<p class="bereich-leer">Noch kein Gerät gekoppelt.</p>';
    return `<h3 class="mr-titel">Geräte <small>${esc(satz)} ${info('mr-i-geraete', 'Mehr zu Geräten und Rechten')}</small></h3>${infoText('mr-i-geraete', esc(text))}${loesen}${liste}`;
  }

  async function geraetKnopf(ev) {
    const b = ev.target.closest('button');
    const zeile = b.closest('.knoepfe');
    const status = zeile.querySelector('.status');
    if (b.dataset.geraetKoppeln !== undefined) {
      if (await koppelnFragen()) await laden();
      return;
    }
    if (b.dataset.notaus !== undefined) {
      if (!(await bestaetigen('Not-Aus auslösen? Die Brücke nimmt danach keine Antwort und keine Handlung mehr an, bis der Rechner ihn löst. Laufende Läufe der Treiber laufen weiter.', 'Not-Aus'))) return;
      // stopping needs no PIN: one request, no dialog
      const r = await fetch('/api/notaus', { method: 'POST' }).catch(() => null);
      status.className = r?.ok ? 'status' : 'status schlecht';
      status.textContent = r?.ok ? 'Not-Aus ausgelöst.' : !r ? 'Brücke nicht erreichbar' : (await r.json().catch(() => ({}))).detail || `Fehler ${r.status}`;
      await laden();
      return;
    }
    if (b.dataset.notausLoesen !== undefined) {
      if (await senden('/api/notaus/loesen', {}, zeile, status)) await laden();
      return;
    }
    const karte = b.closest('.mr-geraet');
    const id = karte.dataset.geraet;
    if (b.dataset.geraetEntkoppeln !== undefined) {
      if (!(await bestaetigen(`${karte.dataset.name} entkoppeln? Das Gerät muss danach neu gekoppelt werden.`, 'Entkoppeln'))) return;
      if (await senden(`/api/geraete/${id}/entkoppeln`, {}, zeile, status)) await laden();
      return;
    }
    const rechte = { antworten: !!karte.dataset.antworten, handeln: !!karte.dataset.handeln };
    rechte[b.dataset.geraetRecht] = !rechte[b.dataset.geraetRecht];
    if (await senden(`/api/geraete/${id}/rechte`, rechte, zeile, status)) await laden();
  }

  // ---- Einrichtung: #246 the display of this device, Sprachraum or Klartext (agent-skills/ADR-0008); a paired device
  // keeps it in the bridge (the push speaks it too), any other in this browser
  const ANZEIGE = [['sprachraum', 'Sprachraum'], ['klartext', 'Klartext']];
  const anzeigeHtml = () => {
    const jetzt = klartext.modus();
    const wo = klartext.gekoppelt() ? 'Die Brücke merkt sich die Wahl für dieses Gerät, auch für seine Meldungen.' : 'Dieser Browser merkt sich die Wahl; nach dem Koppeln die Brücke.';
    const knopf = ([wert, name]) => `<button type="button" class="knopf ${wert === jetzt ? 'haupt' : 'zweit'} klein" data-anzeige="${wert}" aria-pressed="${wert === jetzt}">${name}</button>`;
    return `<h3 class="mr-titel">Anzeige</h3><div class="mr-reihe"><div class="mr-karte mr-anzeige" role="group" aria-label="Anzeige auf diesem Gerät"><p class="mr-hilfe">Sprachraum spricht die Begriffe der Flotte (<span translate="no">Mission, Andocken, Erster Offizier</span> …), Klartext die üblichen Entwicklerbegriffe. Titel, Antworten, Chat, Code und Namen bleiben, wie sie sind. <span>${esc(wo)}</span></p>
<div class="knoepfe">${ANZEIGE.map(knopf).join('')}<span class="status" role="status"></span></div></div></div>`;
  };

  async function anzeigeKnopf(ev, el) {
    const b = ev.target.closest('[data-anzeige]');
    const status = b.closest('.knoepfe').querySelector('.status');
    if (!(await klartext.setzen(b.dataset.anzeige))) {
      status.className = 'status schlecht';
      status.textContent = 'Ging nicht: Brücke nicht erreichbar.';
      return;
    }
    aboBinden();
    malen(letzte, el, true);
  }

  // a subscription from before #246 does not know its device and stays in the Sprachraum: on a switch, the own one
  // goes to the bridge again, now tied to this device (quietly; without one or without the right nothing happens)
  async function aboBinden() {
    if (!kannPush() || !letzte?.push || !letzte?.geraet?.antworten) return;
    try {
      const abo = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
      if (abo) await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(abo.toJSON()) });
    } catch { /* no service worker: nothing to tie */ }
  }

  // ---- Einrichtung: Web-Push (#37); this device subscribes (a paired device with the right Antworten), the bridge
  // pushes each new event of "Braucht dich"
  const kannPush = () => isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  // what this browser says about itself: an own subscription and the permission; read after each drawing, kept here
  // so the next drawing shows it at once
  let pushStand = null;
  const PUSH_STAND = { an: ['gruen', 'eingeschaltet'], aus: ['aus', 'aus'], gesperrt: ['rot', 'im Browser blockiert'] };
  const pushStandHtml = () => (pushStand ? `<b class="mr-marke mr-push-stand ${PUSH_STAND[pushStand][0]}">${PUSH_STAND[pushStand][1]}</b>` : '<b class="mr-marke mr-push-stand aus">wird gelesen …</b>');
  async function pushStandLesen() {
    if (!kannPush()) return;
    let s = 'aus';
    try {
      if (Notification.permission === 'denied') s = 'gesperrt';
      else if (Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (reg && (await reg.pushManager.getSubscription())) s = 'an';
      }
    } catch { /* no service worker yet: off */ }
    if (s === pushStand) return;
    pushStand = s;
    document.querySelectorAll('.mr-push-stand').forEach((e) => { e.outerHTML = pushStandHtml(); });
  }

  const pushHtml = (t) => {
    if (!t.push) return '';
    const text = kannPush()
      ? 'Neue Fragen und Blockaden kommen als Meldung, auch bei geschlossener App: Projekt, Nummer, Art und Titel, nie die Frage selbst.'
      : 'Dieses Gerät kann hier keine Meldungen empfangen: nur über HTTPS (Zertifikat der Brücke) in einem Browser mit Web-Push.';
    const zu = kannPush() && t.pin ? '' : ' disabled';
    if (kannPush()) queueMicrotask(pushStandLesen);
    const stand = kannPush() ? `<dl><dt>Stand</dt><dd>${pushStandHtml()}</dd></dl>` : '';
    return `<h3 class="mr-titel">Meldungen auf diesem Gerät</h3><div class="mr-reihe"><div class="mr-karte mr-push" role="group" aria-label="Meldungen auf diesem Gerät">${stand}<p class="mr-hilfe">${esc(text)}</p>
<div class="knoepfe"><button type="button" class="knopf haupt klein" data-push="an"${zu}>Einschalten</button><button type="button" class="knopf zweit klein" data-push="aus"${zu}>Abschalten</button><span class="status" role="status"></span></div></div></div>`;
  };

  // the applicationServerKey as bytes (base64url from the board)
  const bytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));

  async function push(ev) {
    const karte = ev.target.closest('.mr-push');
    const status = karte.querySelector('.status');
    const melde = (text, schlecht) => { status.className = schlecht ? 'status schlecht' : 'status'; status.textContent = text; };
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      if (ev.target.closest('[data-push]').dataset.push === 'aus') {
        const abo = await reg.pushManager.getSubscription();
        if (!abo) return melde('Dieses Gerät hat kein Abo.');
        if (await senden('/api/push/abmelden', { endpoint: abo.endpoint }, karte, status)) {
          await abo.unsubscribe();
          melde('Abgeschaltet.');
          pushStandLesen();
        }
        return;
      }
      if ((await Notification.requestPermission()) !== 'granted') {
        pushStandLesen();
        return melde('Meldungen sind für die Brücke nicht erlaubt (Einstellungen des Browsers).', true);
      }
      const abo = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(letzte.push) }));
      if (await senden('/api/push', abo.toJSON(), karte, status)) melde('Eingeschaltet.');
      pushStandLesen();
    } catch (err) {
      melde(`Ging nicht: ${err.message || err}`, true);
    }
  }

  // ---- drawing: all three sub-tabs at once, the anchor picks the one shown

  function zeigeUnter(el) {
    const u = unterJetzt();
    el.querySelectorAll('[data-ansicht]').forEach((s) => { s.hidden = s.dataset.ansicht !== u; });
    el.querySelectorAll('.mr-reiter a').forEach((a) => {
      if (a.dataset.unter === u) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function verdrahten(el) {
    el.dataset.verdrahtet = '1';
    el.addEventListener('input', (ev) => {
      if (ev.target.name === 'projekt-ordner') ordnerEntwurf = ev.target.value;
      else if (ev.target.name === 'projekt-link') linkGetippt(ev.target);
      else geaendert(ev);
    });
    // <details> do not bubble their toggle: listen while it comes down
    el.addEventListener('toggle', (ev) => {
      const d = ev.target;
      const key = d.dataset?.auf;
      if (!key) return;
      if (d.open === 'standard' in d.dataset) aufDetails.delete(key);
      else aufDetails.set(key, d.open);
    }, true);
    el.addEventListener('click', (ev) => {
      const i = ev.target.closest('.mr-info');
      if (i) {
        const id = i.getAttribute('aria-controls');
        const zu = aufInfo.has(id);
        if (zu) aufInfo.delete(id);
        else aufInfo.add(id);
        i.setAttribute('aria-expanded', String(!zu));
        const h = el.querySelector(`[id="${CSS.escape(id)}"]`);
        if (h) h.hidden = zu;
        return;
      }
      const kopf = ev.target.closest('.mr-zeile-kopf');
      if (kopf) {
        const zeile = kopf.closest('.mr-einst-zeile');
        const k = `${zeile.dataset.forge}|${zeile.dataset.name}`;
        const zu = offeneZeilen.has(k);
        if (zu) offeneZeilen.delete(k);
        else offeneZeilen.add(k);
        kopf.setAttribute('aria-expanded', String(!zu));
        zeile.querySelector('.mr-offen').hidden = zu;
        return;
      }
      if (ev.target.closest('[data-alle-uebernehmen]')) alleUebernehmen(ev, el);
      else if (ev.target.closest('[data-alle-verwerfen]')) verwerfen(el);
      else if (ev.target.closest('[data-nachziehen]')) werftKnopf(ev, 'nachziehen');
      else if (ev.target.closest('[data-freigeben]')) werftKnopf(ev, 'migration_freigeben');
      else if (ev.target.closest('[data-push]')) push(ev);
      else if (ev.target.closest('[data-anzeige]')) anzeigeKnopf(ev, el);
      else if (ev.target.closest('[data-einspielen]')) einspielenKnopf(ev);
      else if (ev.target.closest('[data-konto]')) kontoKnopf(ev);
      else if (ev.target.closest('[data-forge-verknuepfen]')) forgeKnopf(ev);
      else if (ev.target.closest('[data-projekt-entfernen], [data-projekt-hinzufuegen]')) projektKnopf(ev);
      else if (ev.target.closest('[data-schalter]')) schalterKnopf(ev);
      else if (ev.target.closest('[data-geraet-koppeln], [data-notaus], [data-notaus-loesen], [data-geraet-recht], [data-geraet-entkoppeln]')) geraetKnopf(ev);
    });
  }

  function malen(t, el, erzwingen = false) {
    letzte = t;
    const betrieb = `${bannerHtml(t)}${kontenHtml(t)}<h3 class="mr-titel">Rechner</h3>${t.rechner.length ? `<div class="mr-rechner-liste">${t.rechner.map(rechnerHtml).join('')}</div>` : '<p class="bereich-leer">Noch kein Rechner gemeldet.</p>'}${projekteHtml(t)}${werftHtml(t)}`;
    const einrichtung = `${einrichtenHtml(t)}${hinzufuegenHtml(t)}${verwaltenHtml(t)}${geraeteHtml(t)}${anzeigeHtml()}${pushHtml(t)}${standHtml(t)}`;
    const html = `${kopfHtml(t)}${reiterHtml()}<div class="mr-ansicht" data-ansicht="betrieb">${betrieb}</div><div class="mr-ansicht mr-einst-ansicht" data-ansicht="einstellungen" hidden>${einstellungenHtml(t)}</div><div class="mr-ansicht" data-ansicht="einrichtung" hidden>${einrichtung}</div><div class="mr-leiste" role="region" aria-label="Änderungen übernehmen"${entwuerfe.size ? '' : ' hidden'}>${leisteHtml(t)}</div>`;
    if (!el.dataset.verdrahtet) verdrahten(el);
    // a control in use keeps its DOM: the load must not take the focus or a half typed number away
    const inArbeit = el.contains(document.activeElement) && document.activeElement.closest('.mr-einst-zeile, .mr-projekt-neu');
    // same html: leave the DOM alone (the 10 s load, text selection, scroll)
    if ((erzwingen || !inArbeit) && el.dataset.sig !== html) {
      el.innerHTML = html;
      el.dataset.sig = html;
    }
    zeigeUnter(el);
  }

  huelle.bereich({
    name: 'maschinenraum',
    titel: 'Maschinenraum',
    zeichne(t, el) {
      if (!t) {
        if (!el.childElementCount) el.innerHTML = `${KOPF}<p class="bereich-leer">Lädt …</p>`;
        return;
      }
      malen(t, el);
    },
  });
})();
