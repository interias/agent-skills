"""#246, agent-skills/ADR-0008: the Klartext display. The term table (app/static/klartext.json) is the one file with the
plain developer terms; the page and the push read it. These tests pin the replacement of driver and run texts (articles
and cases), what is never replaced, the second version of fixed texts, the switch per device and the push."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import klartext
from app.main import PERSON_FERN, Einstellung, erzeuge
from app.meldung import _meldung, schluessel_erzeugen
from conftest import fremd, koppeln

TABELLE = json.loads((Path(__file__).parent.parent / 'app' / 'static' / 'klartext.json').read_text(encoding='utf-8'))
LINKS = [s for s, _ in TABELLE['begriffe'] if s != 'Orchestrator']


# ---- the replacement of driver and run texts: articles and cases

@pytest.mark.parametrize('sprachraum, erwartet', [
    # texts of the example data (beispiel/*.json), as the driver and the runs send them
    ('Die Andockprüfung der Mission ist rot.', 'Das Gate des Epics ist rot.'),
    ('Fehler ansehen, dann neu einreihen: die Mission bessert nach.', 'Fehler ansehen, dann neu einreihen: das Epic bessert nach.'),
    ('#41 dockt erst an, wenn config/flotte.json auf main liegt.', '#41 mergt erst, wenn config/flotte.json auf main liegt.'),
    ('Andockprüfung des Treibers 1 von 3 Kontexten fertig, wurzel läuft (PR #44)', 'Gate des Treibers 1 von 3 Kontexten fertig, wurzel läuft (PR #44)'),
    ('Blockiert: Die Andockprüfung der Mission ist rot.', 'Blockiert: Das Gate des Epics ist rot.'),
    ('Erster Offizier prüft #54', 'Reviewer prüft #54'),
    ('PR #43 angedockt', 'PR #43 gemergt'),
    ('wartet auf das Andocken von #38', 'wartet auf den Merge von #38'),
    ('Andockprüfung auf dem Missions-Branch', 'Gate auf dem Epic-Branch'),
    ('Paket P3: Ingenieur arbeitet', 'Paket P3: Implementer arbeitet'),
    ('Angelegt mit Warp frei: Missionsziel #57 „Seite mit den letzten Läufen“.', 'Angelegt als freigegeben: Ticket #57 „Seite mit den letzten Läufen“.'),
    ('Paket #480 ist angedockt. Als Nächstes #481: die Stanze-Suite parallel fahren.', 'Paket #480 ist gemergt. Als Nächstes #481: die Stanze-Suite parallel fahren.'),
    ('Verbrauch der Mission: 1,9 Mio Tokens', 'Verbrauch des Epics: 1,9 Mio Tokens'),
    ('blockiert: 3 Andockprüfungen des Treibers, die Basis zog jedes Mal davon', 'blockiert: 3 Gates des Treibers, die Basis zog jedes Mal davon'),
    ('Folgt der Empfehlung des Laufs; bis zum Andocken umkehrbar.', 'Folgt der Empfehlung des Laufs; bis zum Merge umkehrbar.'),
    ('Kern der Mission', 'Kern des Epics'),
    ('Admiral zu Frage 2: Darf #41 vor der Konfigurationsdatei andocken?', 'Auto-Entscheider zu Frage 2: Darf #41 vor der Konfigurationsdatei mergen?'),
    ('Drei Sternzeit-Notizen wollen dasselbe: Einträge im Logbuch wiederfinden. Eine Mission statt drei einzelner Läufe.', 'Drei Ideen wollen dasselbe: Einträge im Log wiederfinden. Ein Epic statt drei einzelner Läufe.'),
    ('Antwort: eine Gruppe je Paket, in der Reihenfolge des Andockens', 'Antwort: eine Gruppe je Paket, in der Reihenfolge des Merges'),
    ('Modell des Admirals', 'Modell des Auto-Entscheiders'),
    ('Ton bei jedem Andocken', 'Ton bei jedem Merge'),
    ('Verbrauch Hauptenergie gelb über (%)', 'Verbrauch 5-Stunden-Limit gelb über (%)'),
    ('Pakete je Mission gleichzeitig', 'Pakete je Epic gleichzeitig'),
    ('PR #81 in der Andock-Schlange', 'PR #81 in der Merge-Queue'),
    ('Überholt durch die Sternenkarte.', 'Überholt durch die Epics.'),
])
def test_treibertexte_mit_artikel_und_fall(sprachraum, erwartet):
    assert klartext.ersetze(sprachraum) == erwartet


def test_jeder_treibertext_der_beispieldaten_ohne_sprachraum():
    """Every string the example data carries for display comes out without a term of the left column (titles aside)."""
    texte = []

    def sammle(x, schluessel=''):
        if isinstance(x, dict):
            for k, v in x.items():
                sammle(v, k)
        elif isinstance(x, list):
            for v in x:
                sammle(v, schluessel)
        elif isinstance(x, str) and schluessel not in ('titel', 'fundstelle', 'roh', 'entwurf', 'repo', 'forge', 'name'):
            texte.append(x)

    for datei in (Path(__file__).parent.parent / 'beispiel').glob('*.json'):
        sammle(json.loads(datei.read_text(encoding='utf-8')))
    rest = [(t, klartext.ersetze(t)) for t in texte if klartext.sprachraum_in(klartext.ersetze(t))]
    assert rest == []


def test_nie_ersetzt_code_pfade_und_links():
    assert klartext.ersetze('Siehe `Mission andocken` und docs/Mission.md') == 'Siehe `Mission andocken` und docs/Mission.md'
    assert klartext.ersetze('Link https://example.test/Mission/12 zur Mission') == 'Link https://example.test/Mission/12 zum Epic'
    assert klartext.ersetze(r'Datei C:\Mission\x.txt der Mission') == r'Datei C:\Mission\x.txt des Epics'


def test_der_name_flottenbruecke_bleibt():
    assert klartext.ersetze('Flottenbrücke: zur Brücke') == 'Flottenbrücke: zur Übersicht'


def test_satzanfang_grossgeschrieben():
    assert klartext.ersetze('Die Mission ist fertig. Der Mission fehlt nichts.') == 'Das Epic ist fertig. Des Epics fehlt nichts.'


def test_feste_texte_haben_ihre_zweite_fassung():
    """A fixed text is looked up whole (no word replacement); {} carries a part over unchanged."""
    texte = TABELLE['texte']
    for s, k in texte.items():
        assert s.count('{}') == k.count('{}'), s
        assert not klartext.sprachraum_in(k.replace('{}', '')), (s, k)
    eintrag = next(((s, k) for s, k in texte.items() if '{}' in s), None)
    if eintrag:
        s, k = eintrag
        assert klartext.fassung(s.replace('{}', '7')) == k.replace('{}', '7')


def test_ein_titel_mit_mission_bleibt_im_push():
    """A mission title is never replaced, also when it carries a term (the push of an older driver without a cause)."""
    x = {'art': 'blockiert', 'stufe': 'blockiert', 'titel': 'Mini-Mission: Andocken prüfen', 'epic': 7, 'missionen': None, 'ursache': None}
    titel, text = _meldung(x, klar=True)
    assert titel == 'Blockiert: Mini-Mission: Andocken prüfen'
    assert not klartext.sprachraum_in(text)


def test_linke_spalte_wird_erkannt():
    assert klartext.sprachraum_in('Die Mission') and klartext.sprachraum_in('im Maschinenraum')
    assert not klartext.sprachraum_in('Flottenbrücke') and not klartext.sprachraum_in('Treiber, Flotte, Paket, Not-Aus')
    assert set(LINKS) <= set(klartext.LINKS)


# ---- the switch per device: a paired device keeps it in the bridge, default Sprachraum

def test_gekoppeltes_geraet_hat_standard_sprachraum(client):
    t = client.get('/api/tafel').json()
    assert t['geraet']['anzeige'] == 'sprachraum'


def test_gekoppeltes_geraet_speichert_die_anzeige_in_der_bruecke(client):
    r = client.post('/api/geraete/anzeige', json={'anzeige': 'klartext'})
    assert r.status_code == 200, r.text
    assert client.get('/api/tafel').json()['geraet']['anzeige'] == 'klartext'
    # each device for itself: another paired device keeps the default
    andere = fremd(client)
    koppeln(andere, handeln=False, name='Zweites')
    assert andere.get('/api/tafel').json()['geraet']['anzeige'] == 'sprachraum'
    assert client.post('/api/geraete/anzeige', json={'anzeige': 'sprachraum'}).status_code == 200
    assert client.get('/api/tafel').json()['geraet']['anzeige'] == 'sprachraum'


def test_anzeige_nur_fuer_ein_gekoppeltes_geraet_und_nur_bekannte_werte(client):
    assert fremd(client).post('/api/geraete/anzeige', json={'anzeige': 'klartext'}).status_code == 401
    assert client.post('/api/geraete/anzeige', json={'anzeige': 'latein'}).status_code == 422


def test_anzeige_braucht_kein_recht_und_geht_ueber_den_fernweg(bruecke):
    c = bruecke()
    leser = fremd(c)
    koppeln(leser, handeln=False, name='Lesegeraet')
    assert leser.post('/api/geraete/anzeige', json={'anzeige': 'klartext'}).status_code == 200
    # ADR-0007: a way of the person, so the remote entry takes it like the LAN
    assert PERSON_FERN.match('/api/geraete/anzeige')


# ---- the push in the mode of the device

class Postbote:
    def __init__(self):
        self.gesendet = []

    def __call__(self, subscription_info, data, **_):
        self.gesendet.append((subscription_info['endpoint'], json.loads(data)))


ABO = {'endpoint': 'https://fcm.googleapis.com/fcm/send/{}', 'keys': {'p256dh': 'BPk', 'auth': 'au'}}


def _abo(c, n):
    a = {**ABO, 'endpoint': ABO['endpoint'].format(n)}
    assert c.post('/api/push', json=a).status_code == 200


def test_push_in_der_anzeige_des_geraets(tmp_path, uhr, bericht):
    post = Postbote()
    c = TestClient(erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin='4711', uhr=uhr, vapid=schluessel_erzeugen(), push_senden=post)))
    koppeln(c, name='Handy')
    _abo(c, 'klar')
    c.post('/api/geraete/anzeige', json={'anzeige': 'klartext'})
    zweit = fremd(c)
    koppeln(zweit, name='Tablet')
    _abo(zweit, 'raum')
    r = c.post('/api/bericht', json=bericht)
    assert r.status_code == 200, r.text
    je = {e.rsplit('/', 1)[1]: d for e, d in post.gesendet}
    assert set(je) == {'klar', 'raum'}
    klar = je['klar']['titel'] + '\n' + je['klar']['text']
    raum = je['raum']['titel'] + '\n' + je['raum']['text']
    assert not klartext.sprachraum_in(klar), klar
    assert klar != raum
