// Maschinenraum (#42): accounts as tanks, the machines (RAM, disk, fleet limit) and the beat of each
// driver, all from /api/tafel; below them the settings of each driver (#59), changeable with the PIN,
// and (#37) the Web-Push of this device, when the bridge has a VAPID key. #154: the stand of the bridge and of
// each driver, a newer main of the source, and "Einspielen und Treiber neu starten" (PIN), one driver or all.
// With several drivers, every setting stands once for all of them.
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
${fenster('Hauptenergie', k.fuenf)}${fenster('Reserveenergie', k.woche)}
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
    const nachziehen = `<button type="button" class="knopf ${neuSichern || s.status === 'rot' ? 'haupt' : 'zweit'}" data-nachziehen${zu || s.nachziehen?.abgeholt ? ' disabled' : ''}>Jetzt nachziehen</button>`;
    const freigeben = a?.zustand === 'wartet' ? `<button type="button" class="knopf haupt" data-freigeben${zu || s.freigabe?.abgeholt ? ' disabled' : ''}>Arbeits-Migration freigeben</button>` : '';
    const migration = s.migration?.arbeit ? `<dt>Arbeits-Migration</dt><dd>${a ? ARBEIT[a.zustand]?.(a) ?? esc(a.zustand) : '<span class="mr-leer">noch keine</span>'}${a?.commit ? ` · <code>${esc(kurzSha(a.commit))}</code>` : ''}</dd>` : '';
    const test = s.migration?.test ? `<dt>Test-Migration</dt><dd>${w.migrationTest ? 'läuft nach jedem Nachziehen selbst' : 'aus'}</dd>` : '';
    const protokoll = s.protokoll ? `<details class="mr-protokoll"${s.status === 'rot' ? ' open' : ''}><summary>Letztes Protokoll</summary><pre>${esc(s.protokoll)}</pre></details>` : '';
    return `<article class="mr-karte mr-stack ${farbe}" data-werft="${esc(w.id)}" data-stack="${esc(s.name)}">
<h4>${esc(s.name)} <b class="mr-marke ${farbe || 'aus'}">${esc(STAND[stand])}</b></h4>
<dl><dt>Stand</dt><dd>${s.commit ? `<code>${esc(kurzSha(s.commit))}</code> · ${esc(wann(s.zeit))}` : '<span class="mr-leer">noch nicht gezogen</span>'}${s.commit && w.stand && s.commit !== w.stand && !aus ? ' · <span class="mr-leer">älter als der Stand</span>' : ''}</dd>${test}${migration}</dl>
${protokoll}${unterwegs(s.nachziehen, 'Nachziehen')}${unterwegs(s.freigabe, 'Freigabe')}
<div class="knoepfe">${freigeben}${nachziehen}<span class="status" role="status"></span></div></article>`;
  }

  function werftHtml(t) {
    const liste = t.werft ?? [];
    if (!liste.length) return '';
    const mehrere = new Set(liste.map((w) => w.rechner)).size > 1;
    return `<h3 class="mr-titel">Werft</h3>${liste.map((w) => {
      const kopf = `${esc(w.kurz)}${mehrere ? ` · ${esc(w.rechner)}` : ''}`;
      const lage = !w.an ? 'Die Werft ist für dieses Repository aus: sie holt nichts und zieht nichts nach.' : w.veraltet ? `Die Werft meldet sich seit ${wann(w.empfangen)} nicht: Knöpfe wirken ab ihrem nächsten Takt.` : '';
      return `<div class="mr-werft${w.veraltet ? ' veraltet' : ''}"><p class="mr-hinweis"><b>${kopf}</b> · ${esc(w.branch)} bei <code>${esc(kurzSha(w.stand)) || '–'}</code> · geprüft ${esc(wann(w.geprueft)) || '–'} · alle ${esc(w.abfrageS)} s${w.fehler ? `<br><span class="mr-fehler">${esc(w.fehler)}</span>` : ''}${lage ? `<br>${esc(lage)}` : ''}</p>
<div class="mr-reihe">${w.stacks.map((s) => stackHtml(w, s, t.pin)).join('') || '<p class="bereich-leer">Der Adapter nennt keine Stacks.</p>'}</div></div>`;
    }).join('')}`;
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

  // ---- settings (#59): the effective values with their origin, a control per value, a change only after "Übernehmen"
  const HERKUNFT = { start: 'Start', bruecke: 'Brücke', standard: 'Standard', gemischt: 'je Treiber' };
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
    meldung: 'An: Bei einer neuen Frage oder Blockade zeigt der Rechner des Treibers eine Windows-Meldung, mehrere im selben Takt als eine mit der Zahl.',
    merge: 'Automatisch dockt der Treiber nach grüner Andockprüfung an, sonst prüft ein Mensch jedes Andocken. Berührt eine Mission einen Punkt der Liste „beim Menschen“, schlägt der Treiber dort „Mensch prüft“ vor; den Schalter je Mission gibt es auf der Sternenkarte.',
    // #90: the settings of the Werft of a repository
    an: 'Aus: die Werft holt nichts, zieht nichts nach und fährt keine Migration; eine Freigabe lehnt sie ab. Wieder an, zieht sie nach, was inzwischen kam.',
    stacks: 'Nur diese Stacks zieht die Werft nach. Ein abgeschalteter Stack wird nicht gezogen, auch nicht auf Knopfdruck, und keine Migration läuft; wieder an, holt er nach, was ihn inzwischen berührt hat.',
    abfrage_s: 'So oft schaut die Werft nach einem neuen Stand; automatisch gilt der Wert aus dem Adapter des Projekts.',
    migration_test: 'Ja: nach jedem Nachziehen läuft die Test-Migration von selbst. Die Arbeits-Migration wartet immer auf deine Freigabe.',
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
  const ziele = (t, zeile) => (zeile.dataset.forge === ALLE ? mitEinstellungen(t) : (t?.projekte ?? []).filter((p) => p.forge === zeile.dataset.forge));
  const finde = (t, zeile) => {
    if (istWerft(zeile.dataset.forge)) return findeWerft(t, zeile.dataset.forge)?.einstellungen.find((x) => x.name === zeile.dataset.name);
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
    const w = entwuerfe.has(`${p.forge}|${e.name}`) ? entwuerfe.get(`${p.forge}|${e.name}`) : basis(e);
    const geholt = e.offen?.abgeholt ?? false;
    const id = esc(`mr-e-${i}-${e.name}`);
    const stand = e.je && !e.einig
      ? `<span class="mr-wartet">unterschiedlich</span> · ${e.je.map((x, k) => `${esc(mitEinstellungen(t)[k].kurz)} <b>${esc(anzeige(x, basis(x)))}</b>`).join(' · ')}`
      : e.offen
      ? `<span class="mr-wartet">wartet auf ${istWerft(p.forge) ? 'die Werft' : 'den Treiber'}</span> · neu <b>${esc(anzeige(e, e.offen.wert))}</b>${geholt ? ' · abgeholt, Quittung folgt' : ''} <span class="mr-seit">(jetzt <b>${esc(anzeige(e, e.wert))}</b>)</span>`
      : `<b>${esc(anzeige(e, e.wert))}</b>${e.seit ? ` · wirksam seit ${esc(wann(e.seit))}` : ''}`;
    return `<div class="mr-karte mr-einst-zeile${e.offen ? ' wartet' : ''}" role="group" aria-labelledby="${id}-t" data-forge="${esc(p.forge)}" data-name="${esc(e.name)}">
<h4 id="${id}-t">${esc(e.titel)} <span class="mr-herkunft ${esc(e.herkunft)}">${esc(HERKUNFT[e.herkunft] ?? e.herkunft)}</span></h4>
<p class="mr-hilfe">${esc(HILFE[e.name] ?? '')}</p>${e.hinweis ? `<p class="mr-hilfe mr-grenze">${esc(e.hinweis)}</p>` : ''}
<p class="mr-stand">${stand}</p>
<div class="mr-regler">${reglerHtml(e, id, w, !darf || geholt)}</div>
<div class="knoepfe"><button type="button" class="knopf haupt" data-uebernehmen${darf && !geholt && gueltig(e, w) && (!gleich(w, basis(e)) || (e.je && !e.einig)) ? '' : ' disabled'}>Übernehmen</button><span class="status" role="status"></span></div></div>`;
  }

  function einstellungenHtml(t) {
    const mehrere = t.projekte.length > 1;
    const geteilt = gemeinsam(t);
    const hinweisText = (p) => (!t.pin ? `Ändern abgeschaltet: ${huelle.ohnePin(t)}.` : p?.veraltet ? 'Der Treiber meldet sich gerade nicht: eine Änderung wirkt ab seinem nächsten Takt.' : 'Eine Änderung wirkt ab dem nächsten Takt, nichts Laufendes wird abgebrochen. Übernehmen braucht die PIN.');
    let html = '';
    if (geteilt) {
      const ps = mitEinstellungen(t);
      const namen = ps[0].einstellungen.map((e) => e.name);
      const zeilen = namen.map((n) => vereint(ps.map((p) => p.einstellungen.find((e) => e.name === n)).filter(Boolean))).filter(Boolean);
      const still = ps.some((p) => p.veraltet);
      html += `<h3 class="mr-titel">Einstellungen · alle Treiber</h3><p class="mr-hinweis">${esc(`Übernehmen gilt für ${ps.map((p) => p.kurz).join(' und ')}; „Missionen gleichzeitig“ zählt je Treiber. ${hinweisText(still ? { veraltet: true } : null)}`)}</p><div class="mr-reihe mr-einst">${zeilen.map((e) => zeileHtml({ forge: ALLE }, 'alle', e, t.pin, t)).join('')}</div>`;
    }
    // a driver without settings (older version) still gets its read-only note
    return html + t.projekte.filter((p) => !geteilt || !p.einstellungen).map((p, i) => {
      const kopf = `<h3 class="mr-titel">Einstellungen${mehrere ? ` · ${esc(p.kurz)}` : ''}</h3>`;
      if (!p.einstellungen) {
        const r = t.rechner.find((x) => x.name === p.rechner);
        const bekannt = [r?.obergrenze != null ? `Missionen gleichzeitig <b>${r.obergrenze}</b>` : '', p.leerlaufS != null ? `Leerlauf <b>${Math.round(p.leerlaufS / 60)} min</b>` : ''].filter(Boolean).join(' · ');
        return `${kopf}<p class="mr-hinweis">Dieser Treiber meldet keine Einstellungen (älterer Stand): hier nur lesend${bekannt ? `, bekannt ist ${bekannt}` : ''}. Ändern geht, sobald der Treiber aktualisiert ist.</p>`;
      }
      return `${kopf}<p class="mr-hinweis">${esc(hinweisText(p))}</p><div class="mr-reihe mr-einst">${p.einstellungen.map((e) => zeileHtml(p, i, e, t.pin, t)).join('')}</div>`;
    }).join('') + werftEinstellungenHtml(t);
  }

  // #90: the settings of the Werft, per repository and machine, drawn like those of a driver
  function werftEinstellungenHtml(t) {
    const liste = t.werft ?? [];
    const mehrere = new Set(liste.map((w) => w.rechner)).size > 1;
    return liste.map((w, i) => {
      const hinweis = !t.pin ? 'Ändern abgeschaltet: keine PIN gesetzt.' : w.veraltet ? 'Die Werft meldet sich gerade nicht: eine Änderung wirkt ab ihrem nächsten Takt.' : 'Eine Änderung wirkt ab dem nächsten Takt der Werft (alle 15 s), nichts Laufendes wird abgebrochen. Übernehmen braucht die PIN.';
      return `<h3 class="mr-titel">Einstellungen · Werft ${esc(w.kurz)}${mehrere ? ` · ${esc(w.rechner)}` : ''}</h3><p class="mr-hinweis">${esc(hinweis)}</p><div class="mr-reihe mr-einst">${w.einstellungen.map((e) => zeileHtml({ forge: w.id }, `w${i}`, e, t.pin, t)).join('')}</div>`;
    }).join('');
  }

  // what "Übernehmen" sends to the Werft: one change per stack switched, else the setting itself
  function werftAenderungen(e, w) {
    if (e.name === 'stacks') return e.auswahl.filter((n) => w.includes(n) !== basis(e).includes(n)).map((n) => ({ stack: n, name: 'an', wert: w.includes(n) }));
    return [{ stack: null, name: e.name, wert: e.name === 'abfrage_s' ? w : w === 'an' || w === 'ja' }];
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
    const werft = istWerft(zeile.dataset.forge) && findeWerft(letzte, zeile.dataset.forge);
    for (const x of werft ? werftAenderungen(e, lies(zeile, e)) : []) {
      if (!(await senden('/api/werft/handlung', { rechner: werft.rechner, forge: werft.forge, stack: x.stack, art: 'einstellen', text: JSON.stringify({ name: x.name, wert: x.wert }) }, zeile, zeile.querySelector('.status')))) {
        alle = false;
        break;
      }
    }
    for (const p of werft ? [] : ziele(letzte, zeile)) {
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

  // ---- #154: the stand of bridge and drivers; the update is an action the driver fetches (ADR-0005)
  const kurz = (c) => (c ? c.slice(0, 7) : null);
  const standWert = (c, d) => (c ? `<code>${esc(kurz(c))}</code>${d ? ` · ${esc(wann(d))}` : ''}` : nichts('Stand'));
  const mitVersion = (t) => t.projekte.filter((p) => p.version);
  const kannEinspielen = (t, p) => t.pin && p.version && !p.version.einspielen && !(p.einspielen && p.einspielen.abgeholt);

  function einspielenStand(t, p) {
    const v = p.version;
    if (v.einspielen) {
      const w = v.einspielen.wartetAuf;
      return `<span class="mr-wartet">${w.length ? `Wartet auf das Andocken von ${w.map((n) => `#${n}`).join(', ')}` : 'Hält an'}</span>, dann spielt der Treiber ein und startet neu.`;
    }
    if (p.einspielen) return `<span class="mr-wartet">wartet auf den Treiber</span>${p.einspielen.abgeholt ? ' · abgeholt' : ''}`;
    return t.pin ? '' : `Einspielen abgeschaltet: ${huelle.ohnePin(t)}.`;
  }

  function treiberStandHtml(t, p) {
    const v = p.version;
    if (!v) return `<article class="mr-karte mr-stand-karte${p.veraltet ? ' veraltet' : ''}"><h3>Treiber · ${esc(p.kurz)}</h3><p class="mr-hilfe">Dieser Treiber meldet keinen Stand (älterer Stand): einspielen von Hand.</p></article>`;
    const neu = v.neu
      ? `<p class="mr-neu" role="status">Neuer Stand verfügbar: <code>${esc(kurz(v.neu.commit))}</code>, ${esc(wann(v.neu.datum))}, ${esc(v.neu.titel)}</p>`
      : `<p class="mr-hilfe">${v.geprueft ? `Aktuell mit main, geprüft ${esc(wann(v.geprueft))}.` : v.commit ? 'Noch nicht mit main verglichen.' : ''}</p>`;
    const status = einspielenStand(t, p);
    return `<article class="mr-karte mr-stand-karte${v.neu ? ' neu' : ''}${p.veraltet ? ' veraltet' : ''}" data-forge="${esc(p.forge)}"><h3>Treiber · ${esc(p.kurz)}</h3>
<dl><dt>Stand</dt><dd>${standWert(v.commit, v.datum)}</dd><dt>Eingespielt</dt><dd>${v.installiert ? esc(wann(v.installiert)) : nichts('Zeitpunkt')}</dd><dt>Gestartet</dt><dd>${esc(wann(v.gestartet))}</dd></dl>
${neu}<div class="knoepfe"><button type="button" class="knopf ${v.neu ? 'haupt' : 'zweit'}" data-einspielen="${esc(p.forge)}"${kannEinspielen(t, p) ? '' : ' disabled'}>Einspielen und Treiber neu starten</button><span class="status" role="status">${status}</span></div></article>`;
  }

  function standHtml(t) {
    const b = t.bruecke ?? {};
    const bruecke = `<article class="mr-karte mr-stand-karte"><h3>Brücke</h3><dl><dt>Stand</dt><dd>${standWert(b.commit, b.datum)}</dd></dl>${b.commit ? '' : '<p class="mr-hilfe">Gebaut ohne Stand: beim nächsten Einspielen über den Treiber kommt er dazu.</p>'}</article>`;
    const ps = mitVersion(t);
    const alle = t.pin && ps.length > 1 ? `<div class="knoepfe mr-alle"><button type="button" class="knopf zweit" data-einspielen="alle"${ps.some((p) => kannEinspielen(t, p)) ? '' : ' disabled'}>Einspielen und alle Treiber neu starten</button><span class="status" role="status"></span></div>` : '';
    const hinweis = '<p class="mr-hinweis">Einspielen hält den Treiber an: Er startet nichts Neues, ein laufendes Andocken läuft zu Ende, laufende Läufe arbeiten weiter. Dann holt er main, spielt den Skill-Satz ein, baut die Brücke neu, wenn sie sich geändert hat, und startet mit derselben Kommandozeile neu; die Läufe übernimmt er. Braucht die PIN.</p>';
    return `<h3 class="mr-titel">Stand</h3>${hinweis}${alle}<div class="mr-reihe">${bruecke}${t.projekte.map((p) => treiberStandHtml(t, p)).join('')}</div>`;
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

  // ---- Web-Push (#37): this device subscribes with the PIN; the bridge pushes each new event of "Braucht dich"
  const kannPush = () => isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const pushHtml = (t) => {
    if (!t.push) return '';
    const text = kannPush()
      ? 'Bei einer neuen Frage oder Blockade meldet sich dieses Gerät, auch bei geschlossener App: Projekt, Nummer, Art und Titel, nie die Frage selbst. Einschalten und Abschalten brauchen die PIN.'
      : 'Dieses Gerät kann hier keine Meldungen empfangen: nur über HTTPS (Zertifikat der Brücke) in einem Browser mit Web-Push.';
    const zu = kannPush() && t.pin ? '' : ' disabled';
    return `<h3 class="mr-titel">Meldungen auf diesem Gerät</h3><div class="mr-reihe"><div class="mr-karte mr-push" role="group" aria-label="Meldungen auf diesem Gerät"><p class="mr-hilfe">${esc(text)}</p>
<div class="knoepfe"><button type="button" class="knopf haupt" data-push="an"${zu}>Einschalten</button><button type="button" class="knopf zweit" data-push="aus"${zu}>Abschalten</button><span class="status" role="status"></span></div></div></div>`;
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
        }
        return;
      }
      if ((await Notification.requestPermission()) !== 'granted') return melde('Meldungen sind für die Brücke nicht erlaubt (Einstellungen des Browsers).', true);
      const abo = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(letzte.push) }));
      if (await senden('/api/push', abo.toJSON(), karte, status)) melde('Eingeschaltet.');
    } catch (err) {
      melde(`Ging nicht: ${err.message || err}`, true);
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
      const html = `${KOPF}<h3 class="mr-titel">Konten</h3>${konten}<h3 class="mr-titel">Rechner und Treiber</h3>${rechner}${werftHtml(t)}${standHtml(t)}${einstellungenHtml(t)}${pushHtml(t)}`;
      letzte = t;
      if (!el.dataset.verdrahtet) {
        el.dataset.verdrahtet = '1';
        el.addEventListener('input', geaendert);
        el.addEventListener('click', (ev) => {
          if (ev.target.closest('[data-uebernehmen]')) uebernehmen(ev);
          else if (ev.target.closest('[data-nachziehen]')) werftKnopf(ev, 'nachziehen');
          else if (ev.target.closest('[data-freigeben]')) werftKnopf(ev, 'migration_freigeben');
          else if (ev.target.closest('[data-push]')) push(ev);
          else if (ev.target.closest('[data-einspielen]')) einspielenKnopf(ev);
        });
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
