"""#242: the Maschinenraum in three sub-tabs (Betrieb, Einstellungen, Einrichtung), one card per account and per
project, the settings as compact rows with one bar that takes over every draft. The page has no build and no
browser in the tests: like the other UI tests these read the sources and pin the parts the behaviour rests on."""
import re
from pathlib import Path

STATIC = Path(__file__).parent.parent / 'app' / 'static'
MR = (STATIC / 'bereiche' / 'maschinenraum.js').read_text(encoding='utf-8')
MR_CSS = (STATIC / 'bereiche' / 'maschinenraum.css').read_text(encoding='utf-8')
HUELLE = (STATIC / 'huelle.js').read_text(encoding='utf-8')
APP = (STATIC / 'app.js').read_text(encoding='utf-8')


def _fn(src: str, start: str, ende: str = '\n  }\n') -> str:
    i = src.index(start)
    return src[i:src.index(ende, i) + len(ende)]


# ---- the shell: an anchor names the area and, after a slash, the sub-tab

def test_huelle_trennt_bereich_und_unteranker():
    teile = _fn(HUELLE, 'const teile = () =>', '\n  };\n')
    assert ".split('/')" in teile and 'sektionen.has(' in teile
    # the area reads its sub-tab from the shell
    assert 'unter: () => teile()[1]' in HUELLE
    # a new sub-tab of the open area draws it again instead of returning early
    zeigen = _fn(HUELLE, 'function zeigen() {')
    assert 'unter === aktivUnter' in zeigen


def test_unvollstaendige_einrichtung_oeffnet_den_unterreiter_einrichtung():
    assert "if (stand === null && !location.hash && t.einrichten && !t.einrichten.fertig) gehe('maschinenraum/einrichtung');" in HUELLE


def test_fuss_fuehrt_zum_stand_oder_zum_banner():
    fuss = _fn(APP, 'function fussStand(t) {', '\n}\n')
    assert "'#maschinenraum/betrieb'" in fuss and "'#maschinenraum/einrichtung'" in fuss


# ---- three sub-tabs with their own anchors

def test_drei_unterreiter_mit_eigenem_anker():
    for name in ('betrieb', 'einstellungen', 'einrichtung'):
        assert f"'{name}'" in MR
    assert "const UNTER = ['betrieb', 'einstellungen', 'einrichtung'];" in MR
    assert 'href="#maschinenraum/${u}"' in MR
    # without a sub-anchor (or an unknown one) Betrieb opens
    assert "UNTER.includes(u) ? u : 'betrieb'" in MR
    # the tab Einstellungen counts the open drafts
    reiter = _fn(MR, 'function reiterHtml(')
    assert 'entwuerfe.size' in reiter


def test_kopf_zeigt_dieses_geraet_und_den_not_aus():
    kopf = _fn(MR, 'function kopfHtml(t) {')
    assert 'Dieses Gerät' in kopf and 'data-notaus' in kopf and 'mr-notaus' in kopf
    # the device list itself moved to Einrichtung
    assert 'geraeteHtml(t)' not in kopf


# ---- Betrieb: one card per account and per project, one line per machine

def test_eine_karte_je_konto_mit_tanks_und_knoepfen():
    karte = _fn(MR, 'const kontoHtml = ', '\n  };\n')
    for teil in ("'Hauptenergie'", "'Reserveenergie'", 'missionenHtml(', 'data-konto=', 'Vorsprung', 'Bremse', 'Anmeldung'):
        assert teil in karte, teil
    # the second list of accounts is gone
    assert 'kontenListeHtml' not in MR


def test_rechner_als_eine_zeile_ohne_takt():
    zeile = _fn(MR, 'const rechnerHtml = ', '\n  };\n')
    assert 'RAM' in zeile and 'Platte' in zeile and 'Obergrenze' in zeile
    assert 'Takt' not in zeile


def test_eine_karte_je_projekt_statt_der_entfallenen_abschnitte():
    karte = _fn(MR, 'function projektKarteHtml(t, p) {')
    for teil in ('Takt', 'quelle(p', 'forgeZeileHtml(t, p)', 'lueckenHtml(p)', 'nachtlaufHtml(p)', 'schalterHtml(t, p, AUTOMATIK)', 'schalterHtml(t, p, LERNEN)', 'laufend', 'wartend', 'freigegeben, nicht eingesammelt', 'andockpruefungen'):
        assert teil in karte, teil
    # the last three gate runs, the rest under "Mehr"
    assert '.slice(0, 3)' in karte and '.slice(3' in karte and 'Mehr' in karte
    for weg in ('Automatik je Projekt', 'Lernschleife je Projekt', 'function forgeHtml', 'function automatikHtml', 'function lernschleifeHtml', 'function andockpruefungenHtml'):
        assert weg not in MR, weg


def test_forge_verknuepfen_nur_wenn_etwas_fehlt():
    forge = _fn(MR, 'function forgeZeileHtml(t, p) {')
    assert 'data-forge-verknuepfen' in forge
    assert "f && f.angemeldet && f.rechte === 'ok'" in forge


def test_gesperrter_schalter_nennt_den_grund_sichtbar():
    schalter = _fn(MR, 'function schalterHtml(t, p, name) {')
    assert 'Gesperrt:' in schalter and 'e.hinweis' in schalter
    assert 'aria-pressed' in schalter


# ---- Einstellungen: groups of compact rows, one bar for all drafts

def test_einstellungen_in_gruppen():
    gruppen = MR[MR.index('const GRUPPEN = ['):]
    gruppen = gruppen[:gruppen.index('];') + 2]
    for titel, namen in (('Kapazität', ['obergrenze', 'paketeJeEpic', 'konten', 'admiral']), ('Bremsen', ['verbrauchGelb', 'verbrauchRot', 'leerfahren', 'ramWarn', 'platteMinGb', 'leerlaufMin']), ('Andocken und Modelle', ['merge', 'triageModell', 'admiralModell', 'triageLesenMax']), ('Meldung', ['meldung'])):
        assert f"titel: '{titel}'" in gruppen
        for n in namen:
            assert f"'{n}'" in gruppen, n


def test_zeile_zeigt_name_wert_herkunft_und_oeffnet_den_regler():
    zeile = _fn(MR, 'function zeileHtml(p, i, e, darf, t) {')
    assert 'aria-expanded' in zeile and 'mr-herkunft' in zeile and 'reglerHtml(' in zeile
    # what the row waits for stays visible on the row itself
    assert 'wartet auf' in zeile and 'unterschiedlich' in zeile
    # no button per row any more
    assert 'data-uebernehmen' not in zeile


def test_eine_leiste_uebernimmt_alle_entwuerfe():
    leiste = _fn(MR, 'function leisteHtml(t) {')
    assert 'entwuerfe.size' in leiste and 'Änderungen übernehmen' in leiste and 'Verwerfen' in leiste
    assert 'data-alle-uebernehmen' in leiste and 'data-alle-verwerfen' in leiste
    alle = _fn(MR, 'async function alleUebernehmen(')
    # one action per draft, as before: einstellen to every driver of the row, or the Werft's own
    assert 'for (const [k, w] of [...entwuerfe])' in alle
    assert "art: 'einstellen'" in alle and '/api/werft/handlung' in alle and '/api/handlung' in alle
    assert 'entwuerfe.delete(k)' in alle
    assert 'entwuerfe.clear()' in _fn(MR, 'function verwerfen(')
    # the bar sticks to the bottom above the safe area
    assert 'position: fixed' in MR_CSS and 'env(safe-area-inset-bottom' in MR_CSS


def test_unterschiedlich_je_treiber_gleicht_auch_mit_demselben_wert_an():
    geaendert = _fn(MR, 'function geaendert(ev) {')
    assert '!(e.je && !e.einig)' in geaendert


# ---- texts: one sentence, the rest behind ⓘ (a button, never a title tooltip) or "Mehr"

def test_kein_title_tooltip_und_info_ist_ein_knopf():
    assert 'title="' not in MR
    info = _fn(MR, 'const info = ', ';\n')
    assert '<button type="button" class="mr-info"' in info and 'aria-expanded=' in info and 'aria-controls=' in info
    # its text stays open across the 10 s redraw
    assert 'aufInfo.has(id)' in info


def test_fehlende_werte_heissen_nicht_gemeldet():
    assert 'meldet der Treiber nicht' not in MR
    assert 'nicht gemeldet' in MR


def test_projekt_hinzufuegen_erklaert_nur_einmal_lang():
    # the long paragraph about the own driver of a new project stands once, under "Mehr"; the step and the card say one sentence
    assert MR.count('erster Bericht legt das Projekt') == 1
    hinzu = _fn(MR, 'function hinzufuegenHtml(t) {')
    assert '<summary>Mehr</summary>' in hinzu
    for s in re.findall(r"text: '([^']*)'", MR[MR.index('const SCHRITT = {'):MR.index('const STAND_SCHRITT')]):
        assert s.count('. ') == 0, s


# ---- phone

def test_handy_teilt_die_breite_und_hat_daumengrosse_knoepfe():
    handy = MR_CSS[MR_CSS.index('@media (max-width: 700px)'):]
    assert '.mr-reiter a { flex: 1 1 0' in handy
    assert 'min-height: 44px' in handy


def test_verwerfen_zeichnet_neu_auch_ohne_neue_tafel():
    # a draft changes the DOM directly, the signature of the last drawing stays: Verwerfen must not compare against it
    verwerfen = _fn(MR, 'function verwerfen(')
    assert 'delete el.dataset.sig' in verwerfen and 'entwuerfe.clear()' in verwerfen


def test_fehler_der_leiste_bleibt_stehen():
    alle = _fn(MR, 'async function alleUebernehmen(')
    # the reason a request failed survives the redraw of the bar
    assert alle.index('leisteZeigen(el)') < alle.rindex('fehler')


def test_offene_details_merken_nur_abweichungen_vom_standard():
    # a step that becomes fertig folds away again unless the person opened it
    assert "'standard' in d.dataset" in MR and 'aufDetails.delete(key)' in MR
