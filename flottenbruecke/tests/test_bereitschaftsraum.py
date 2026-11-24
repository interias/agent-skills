"""Bereitschaftsraum (#85, agent-skills/ADR-0004): the chat of the bridge. The person writes with the PIN,
the service `flotte chat` fetches, acknowledges and answers with the token (SCHNITTSTELLE.md, section 8,
beispiel/chat.json). The bridge stores only messages, answers and the state of each chat."""

import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import Einstellung, erzeuge
from conftest import koppeln

BEISPIEL = json.loads((Path(__file__).parent.parent / 'beispiel' / 'chat.json').read_text(encoding='utf-8'))
FORGE = 'interias/flotte-probe'
SITZUNG = BEISPIEL['antworten'][0]['sitzung']
PIN = {'X-Bruecke-Pin': '4711'}


def holen(c, rechner='STATION-A', konten='1,2', token=None):
    return c.get('/api/chat/nachrichten', params={'rechner': rechner, 'konten': konten}, headers={'X-Bruecke-Token': token} if token else {})


def quittung(c, id_, rechner='STATION-A', token=None):
    return c.post(f'/api/chat/nachrichten/{id_}/quittung', json={'rechner': rechner}, headers={'X-Bruecke-Token': token} if token else {})


def antwort(c, id_, body, token=None):
    return c.post(f'/api/chat/nachrichten/{id_}/antwort', json=body, headers={'X-Bruecke-Token': token} if token else {})


def beginnen(c, text='Die Probe soll eine Seite mit den letzten Läufen bekommen.', konto='2', modell=None, pin='4711'):
    return c.post('/api/chat', json={'forge': FORGE, 'konto': konto, 'modell': modell, 'text': text}, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def raum(c):
    return c.get('/api/tafel').json()['bereitschaftsraum']


def chat(c, id_):
    return next(x for x in raum(c)['chats'] if x['id'] == id_)


def mit_entwurf():
    a = copy.deepcopy(BEISPIEL['antworten'][0])
    a['entwurf'] = BEISPIEL['nachrichten'][1]['entwurf']
    return a


@pytest.fixture
def bekannt(client):
    """A service on STATION-A has reported its accounts once."""
    assert holen(client).json() == []
    return client


def einmal_beantwortet(c, a=None):
    """A chat whose first message STATION-A answered; returns (chat id, message id)."""
    r = beginnen(c).json()
    assert quittung(c, r['id']).status_code == 200
    assert antwort(c, r['id'], a or BEISPIEL['antworten'][0]).status_code == 200
    return r['chat'], r['id']


# ---- the way of a message, as the contract has it

def test_nachricht_nach_vertrag(bekannt):
    r = beginnen(bekannt)
    assert r.status_code == 200 and r.json()['ok']
    geholt = holen(bekannt).json()
    vorbild = BEISPIEL['nachrichten'][0]
    assert len(geholt) == 1 and set(geholt[0]) == set(vorbild)
    n = geholt[0]
    assert (n['id'], n['chat'], n['forge'], n['art'], n['konto'], n['modell'], n['text'], n['entwurf'], n['starten'], n['sitzung']) == (r.json()['id'], r.json()['chat'], FORGE, 'text', '2', None, vorbild['text'], None, False, None)
    assert quittung(bekannt, n['id']).json() == {'ok': True}
    # again from the same machine: fine; the message stays with it until it has an answer
    assert quittung(bekannt, n['id']).json() == {'ok': True}
    assert [x['id'] for x in holen(bekannt).json()] == [n['id']]
    assert antwort(bekannt, n['id'], BEISPIEL['antworten'][0]).json() == {'ok': True}
    assert holen(bekannt).json() == []
    c = chat(bekannt, n['chat'])
    assert c['stand'] == 'offen' and c['rechner'] == 'STATION-A'
    assert c['karten'] == BEISPIEL['antworten'][0]['karten']
    assert [v['antwort']['text'] for v in c['verlauf']] == [BEISPIEL['antworten'][0]['text']]


def test_die_naechste_nachricht_traegt_die_sitzung_und_das_modell(bekannt):
    chat_id, _ = einmal_beantwortet(bekannt)
    assert bekannt.post(f'/api/chat/{chat_id}/einstellung', json={'konto': '2', 'modell': 'claude-sonnet-4-5'}, headers=PIN).json()['ok']
    assert bekannt.post(f'/api/chat/{chat_id}/nachricht', json={'text': 'Q1 A'}, headers=PIN).json()['ok']
    n = holen(bekannt).json()
    assert [(x['art'], x['text'], x['sitzung'], x['modell']) for x in n] == [('text', 'Q1 A', SITZUNG, 'claude-sonnet-4-5')]


def test_aelteste_zuerst_und_nur_mit_konto_des_rechners(bekannt):
    a = beginnen(bekannt, konto='1').json()
    b = beginnen(bekannt, konto='2').json()
    assert [x['id'] for x in holen(bekannt).json()] == [a['id'], b['id']]
    assert [x['id'] for x in holen(bekannt, rechner='STATION-B', konten='2').json()] == [b['id']]
    assert holen(bekannt, rechner='STATION-B', konten='').json() == []


# ---- binding to a machine

def test_die_erste_antwort_mit_sitzung_bindet_den_chat(bekannt):
    chat_id, _ = einmal_beantwortet(bekannt)
    bekannt.post(f'/api/chat/{chat_id}/nachricht', json={'text': 'Q1 A'}, headers=PIN)
    # another machine with the same account never sees it
    assert holen(bekannt, rechner='STATION-B', konten='1,2').json() == []
    assert len(holen(bekannt).json()) == 1


def test_eine_antwort_ohne_sitzung_bindet_nicht(bekannt):
    r = beginnen(bekannt).json()
    assert quittung(bekannt, r['id'], rechner='STATION-B').status_code == 200
    ohne = {'text': None, 'sitzung': None, 'fehler': 'Das Repository flotte-probe liegt auf dem Rechner STATION-B nicht im Ordner des Bereitschaftsraums.', 'karten': [], 'entwurf': None}
    assert antwort(bekannt, r['id'], ohne).status_code == 200
    assert chat(bekannt, r['chat'])['rechner'] is None
    bekannt.post(f"/api/chat/{r['chat']}/nachricht", json={'text': 'Noch einmal'}, headers=PIN)
    neu = holen(bekannt).json()
    assert len(neu) == 1 and quittung(bekannt, neu[0]['id']).status_code == 200
    assert antwort(bekannt, neu[0]['id'], BEISPIEL['antworten'][0]).status_code == 200
    assert chat(bekannt, r['chat'])['rechner'] == 'STATION-A'


# ---- acknowledgement: 409 and 404

def test_quittung_fremd_gebunden_fremd_quittiert_und_eine_je_chat(bekannt):
    chat_id, _ = einmal_beantwortet(bekannt)
    bekannt.post(f'/api/chat/{chat_id}/nachricht', json={'text': 'Q1 A'}, headers=PIN)
    n = holen(bekannt).json()[0]
    # the chat belongs to STATION-A
    assert quittung(bekannt, n['id'], rechner='STATION-B').status_code == 409
    # an unbound chat: STATION-B took the message, STATION-A may not
    frei = beginnen(bekannt).json()
    assert quittung(bekannt, frei['id'], rechner='STATION-B').status_code == 200
    assert quittung(bekannt, frei['id']).status_code == 409
    assert [x['id'] for x in holen(bekannt).json()] == [n['id']]
    # one acknowledged message without answer per chat
    assert quittung(bekannt, n['id']).status_code == 200
    bekannt.post(f'/api/chat/{chat_id}/nachricht', json={'text': 'Und noch etwas'}, headers=PIN)
    zweite = [x for x in holen(bekannt).json() if x['id'] != n['id']][0]
    assert quittung(bekannt, zweite['id']).status_code == 409
    assert quittung(bekannt, 999).status_code == 404


def test_antwort_zweimal_aendert_nichts_und_unbekannt_ist_404(bekannt):
    chat_id, id_ = einmal_beantwortet(bekannt)
    anders = dict(BEISPIEL['antworten'][0], text='Ein anderer Text')
    assert antwort(bekannt, id_, anders).json() == {'ok': True}
    assert chat(bekannt, chat_id)['verlauf'][0]['antwort']['text'] == BEISPIEL['antworten'][0]['text']
    assert antwort(bekannt, 999, BEISPIEL['antworten'][0]).status_code == 404


def test_antwort_braucht_text_oder_fehler_und_saubere_links(bekannt):
    r = beginnen(bekannt).json()
    quittung(bekannt, r['id'])
    assert antwort(bekannt, r['id'], {'text': None, 'sitzung': None, 'fehler': None, 'karten': [], 'entwurf': None}).status_code == 422
    schlecht = dict(BEISPIEL['antworten'][1], missionen=[{'nummer': 1, 'url': 'javascript:alert(1)', 'titel': 'x'}])
    assert antwort(bekannt, r['id'], schlecht).status_code == 422
    assert antwort(bekannt, r['id'], dict(BEISPIEL['antworten'][0], sitzung='../x')).status_code == 422


def test_antwort_mit_vielen_karten_und_optionen_wird_angenommen(bekannt):
    # the model's schema sets no limits: a refused answer would be delivered forever and block the chat
    r = beginnen(bekannt).json()
    quittung(bekannt, r['id'])
    viele = dict(BEISPIEL['antworten'][0], karten=[{'frage': f'Q{i}', 'optionen': [f'O{j}' for j in range(30)]} for i in range(25)], fehler='x' * 9000)
    assert antwort(bekannt, r['id'], viele).status_code == 200


# ---- creating is a release: only with the PIN and the draft word for word

def test_anlegen_nimmt_woertlich_den_letzten_entwurf(bekannt):
    chat_id, id_ = einmal_beantwortet(bekannt, mit_entwurf())
    c = chat(bekannt, chat_id)
    assert c['entwurf'] == {'von': id_, 'text': BEISPIEL['nachrichten'][1]['entwurf']}
    # a draft in the body is no input: the stored one goes
    r = bekannt.post(f'/api/chat/{chat_id}/anlegen', json={'starten': True, 'von': id_, 'entwurf': '# Missionsziel: etwas anderes'}, headers=PIN)
    assert r.status_code == 200 and r.json()['ok']
    n = holen(bekannt).json()
    vorbild = BEISPIEL['nachrichten'][1]
    assert [(x['art'], x['text'], x['entwurf'], x['starten'], x['sitzung'], x['konto']) for x in n] == [('anlegen', None, vorbild['entwurf'], True, SITZUNG, '2')]


def test_ohne_entwurf_oder_mit_altem_entsteht_keine_nachricht_anlegen(bekannt):
    chat_id, id_ = einmal_beantwortet(bekannt)
    assert bekannt.post(f'/api/chat/{chat_id}/anlegen', json={'starten': False, 'von': id_}, headers=PIN).status_code == 409
    # a newer answer brought a newer draft: the person did not see it, so the old one is refused
    bekannt.post(f'/api/chat/{chat_id}/nachricht', json={'text': 'Q1 A'}, headers=PIN)
    n = holen(bekannt).json()[0]
    quittung(bekannt, n['id'])
    antwort(bekannt, n['id'], mit_entwurf())
    assert bekannt.post(f'/api/chat/{chat_id}/anlegen', json={'starten': False, 'von': id_}, headers=PIN).status_code == 409
    # a message still waiting for its answer: the draft may change
    bekannt.post(f'/api/chat/{chat_id}/nachricht', json={'text': 'Noch eine Frage'}, headers=PIN)
    assert bekannt.post(f'/api/chat/{chat_id}/anlegen', json={'starten': False, 'von': n['id']}, headers=PIN).status_code == 409
    assert [x['art'] for x in holen(bekannt).json()] == ['text']


# ---- the PIN for everything the person does, the token for the service

def schreiben(c, chat_id, von, pin):
    h = {'X-Bruecke-Pin': pin} if pin is not None else {}
    return [
        c.post('/api/chat', json={'forge': FORGE, 'konto': '2', 'modell': None, 'text': 'Hallo'}, headers=h),
        c.post(f'/api/chat/{chat_id}/einstellung', json={'konto': '2', 'modell': 'opus'}, headers=h),
        c.post(f'/api/chat/{chat_id}/anlegen', json={'starten': True, 'von': von}, headers=h),
        c.post(f'/api/chat/{chat_id}/nachricht', json={'text': 'Q1 A'}, headers=h),
        c.post(f'/api/chat/{chat_id}/verwerfen', headers=h),
    ]


@pytest.mark.parametrize('pin', [None, '0000'])
def test_jede_handlung_im_bereitschaftsraum_braucht_die_pin(bekannt, bruecke, pin):
    chat_id, id_ = einmal_beantwortet(bekannt, mit_entwurf())
    vorher = raum(bekannt)
    assert [r.status_code for r in schreiben(bekannt, chat_id, id_, pin)] == [403] * 5
    assert raum(bekannt) == vorher
    assert holen(bekannt).json() == []
    # five wrong ones lock this client out; a fresh bridge on the same store: with the PIN each one goes through (verwerfen last)
    c = bruecke()
    assert [r.status_code for r in schreiben(c, chat_id, id_, '4711')] == [200] * 5
    assert chat(c, chat_id)['stand'] == 'verworfen'


def test_ohne_gesetzte_pin_ist_schreiben_abgeschaltet(bruecke):
    c = bruecke(pin='')
    holen(c)
    assert beginnen(c).status_code == 403
    assert [r.status_code for r in schreiben(c, 1, 1, '4711')] == [403] * 5
    assert raum(c)['chats'] == [] and raum(c)['pin'] is False


def test_der_dienst_braucht_das_token(bruecke):
    c = bruecke(token='geheim')
    assert holen(c).status_code == 401
    assert holen(c, token='falsch').status_code == 401
    assert holen(c, token='geheim').json() == []
    r = beginnen(c).json()
    assert quittung(c, r['id']).status_code == 401
    assert quittung(c, r['id'], token='geheim').json() == {'ok': True}
    assert antwort(c, r['id'], BEISPIEL['antworten'][0]).status_code == 401
    assert antwort(c, r['id'], BEISPIEL['antworten'][0], token='geheim').json() == {'ok': True}


def test_rechner_und_konten_in_der_form_des_vertrags(client):
    assert holen(client, konten='1,C:/Users/x').status_code == 422
    assert holen(client, rechner='').status_code == 422
    assert raum(client)['konten'] == []


# ---- account and model per chat

def test_konto_nur_aus_den_gemeldeten_und_modell_in_form(bekannt):
    assert beginnen(bekannt, konto='3').status_code == 409
    assert beginnen(bekannt, konto='C:/x').status_code == 422
    assert beginnen(bekannt, modell='opus; rm').status_code == 422
    assert beginnen(bekannt, text='   ').status_code == 422
    r = beginnen(bekannt, konto='1', modell='claude-opus-5-5').json()
    assert raum(bekannt)['konten'] == [{'konto': '1', 'rechner': ['STATION-A']}, {'konto': '2', 'rechner': ['STATION-A']}]
    assert chat(bekannt, r['chat'])['modell'] == 'claude-opus-5-5'
    # before the first session the account may change, after it not (a session lives in its account)
    assert bekannt.post(f"/api/chat/{r['chat']}/einstellung", json={'konto': '2', 'modell': None}, headers=PIN).status_code == 200
    quittung(bekannt, r['id'])
    # a machine runs the message on account 2: its session will live there
    assert bekannt.post(f"/api/chat/{r['chat']}/einstellung", json={'konto': '1', 'modell': None}, headers=PIN).status_code == 409
    antwort(bekannt, r['id'], BEISPIEL['antworten'][0])
    assert bekannt.post(f"/api/chat/{r['chat']}/einstellung", json={'konto': '1', 'modell': None}, headers=PIN).status_code == 409
    assert bekannt.post(f"/api/chat/{r['chat']}/einstellung", json={'konto': '2', 'modell': 'sonnet'}, headers=PIN).status_code == 200
    assert (chat(bekannt, r['chat'])['konto'], chat(bekannt, r['chat'])['modell']) == ('2', 'sonnet')
    assert bekannt.post('/api/chat/999/nachricht', json={'text': 'x'}, headers=PIN).status_code == 404


# ---- states: offen, angelegt, verworfen

def test_staende_offen_angelegt_mit_links(bekannt):
    chat_id, id_ = einmal_beantwortet(bekannt, mit_entwurf())
    assert chat(bekannt, chat_id)['stand'] == 'offen'
    bekannt.post(f'/api/chat/{chat_id}/anlegen', json={'starten': True, 'von': id_}, headers=PIN)
    n = holen(bekannt).json()[0]
    quittung(bekannt, n['id'])
    # a failed creation leaves the chat open
    gescheitert = {'text': None, 'sitzung': SITZUNG, 'fehler': 'Anlegen gescheitert: gh meldet einen Fehler.', 'karten': [], 'entwurf': None, 'missionen': []}
    antwort(bekannt, n['id'], gescheitert)
    assert chat(bekannt, chat_id)['stand'] == 'offen' and chat(bekannt, chat_id)['missionen'] == []
    # the draft stays the latest one: try again
    assert bekannt.post(f'/api/chat/{chat_id}/anlegen', json={'starten': True, 'von': id_}, headers=PIN).status_code == 200
    n = holen(bekannt).json()[0]
    quittung(bekannt, n['id'])
    assert antwort(bekannt, n['id'], BEISPIEL['antworten'][1]).status_code == 200
    c = chat(bekannt, chat_id)
    assert c['stand'] == 'angelegt' and c['missionen'] == BEISPIEL['antworten'][1]['missionen']
    # created: nothing more to write or create
    assert bekannt.post(f'/api/chat/{chat_id}/nachricht', json={'text': 'x'}, headers=PIN).status_code == 409
    assert bekannt.post(f'/api/chat/{chat_id}/anlegen', json={'starten': True, 'von': id_}, headers=PIN).status_code == 409


def test_verwerfen_ist_ein_klick_der_brucke(bekannt):
    r = beginnen(bekannt).json()
    assert bekannt.post(f"/api/chat/{r['chat']}/verwerfen", headers=PIN).json() == {'ok': True}
    assert (chat(bekannt, r['chat'])['stand'], chat(bekannt, r['chat'])['wartet']) == ('verworfen', False)
    # its waiting message no longer goes to the service, and nothing new comes in
    assert holen(bekannt).json() == []
    assert quittung(bekannt, r['id']).status_code == 409
    assert bekannt.post(f"/api/chat/{r['chat']}/nachricht", json={'text': 'x'}, headers=PIN).status_code == 409


# ---- #47: stop, continue, archive

def test_stoppen_haelt_den_chat_an_fortsetzen_gibt_die_nachricht_frei(bekannt):
    r = beginnen(bekannt).json()
    assert bekannt.post(f"/api/chat/{r['chat']}/stoppen", headers=PIN).json() == {'ok': True}
    c = chat(bekannt, r['chat'])
    assert (c['stand'], c['wartet']) == ('gestoppt', False)
    # the waiting message stays, but no service gets it, and nothing new comes in
    assert holen(bekannt).json() == []
    assert quittung(bekannt, r['id']).status_code == 409
    assert bekannt.post(f"/api/chat/{r['chat']}/nachricht", json={'text': 'x'}, headers=PIN).status_code == 409
    assert bekannt.post(f"/api/chat/{r['chat']}/stoppen", headers=PIN).status_code == 409
    assert bekannt.post(f"/api/chat/{r['chat']}/fortsetzen", headers=PIN).json() == {'ok': True}
    assert (chat(bekannt, r['chat'])['stand'], chat(bekannt, r['chat'])['wartet']) == ('offen', True)
    assert [n['id'] for n in holen(bekannt).json()] == [r['id']]
    assert bekannt.post(f"/api/chat/{r['chat']}/fortsetzen", headers=PIN).status_code == 409


def test_stoppen_waehrend_anlegen_macht_den_chat_trotzdem_angelegt(bekannt):
    chat_id, id_ = einmal_beantwortet(bekannt, mit_entwurf())
    bekannt.post(f'/api/chat/{chat_id}/anlegen', json={'starten': True, 'von': id_}, headers=PIN)
    n = holen(bekannt).json()[0]
    quittung(bekannt, n['id'])
    # the service is creating already; the person stops the chat, the answer still comes
    assert bekannt.post(f'/api/chat/{chat_id}/stoppen', headers=PIN).status_code == 200
    assert antwort(bekannt, n['id'], BEISPIEL['antworten'][1]).status_code == 200
    c = chat(bekannt, chat_id)
    assert c['stand'] == 'angelegt' and c['missionen'] == BEISPIEL['antworten'][1]['missionen']
    # no second creation of the same draft
    assert bekannt.post(f'/api/chat/{chat_id}/fortsetzen', headers=PIN).status_code == 409
    assert bekannt.post(f'/api/chat/{chat_id}/anlegen', json={'starten': True, 'von': id_}, headers=PIN).status_code == 409


def test_gestoppter_chat_laesst_sich_verwerfen(bekannt):
    r = beginnen(bekannt).json()
    bekannt.post(f"/api/chat/{r['chat']}/stoppen", headers=PIN)
    assert bekannt.post(f"/api/chat/{r['chat']}/verwerfen", headers=PIN).status_code == 200
    assert chat(bekannt, r['chat'])['stand'] == 'verworfen'


def test_archivieren_haelt_an_blendet_aus_und_holt_zurueck(bekannt):
    r = beginnen(bekannt).json()
    assert bekannt.post(f"/api/chat/{r['chat']}/archivieren", json={'archiviert': True}, headers=PIN).json() == {'ok': True}
    c = chat(bekannt, r['chat'])
    # an open chat stops on the way into the archive: nothing runs in a chat nobody sees
    assert (c['archiviert'] is not None, c['stand']) == (True, 'gestoppt')
    assert holen(bekannt).json() == []
    assert bekannt.post(f"/api/chat/{r['chat']}/archivieren", json={'archiviert': True}, headers=PIN).status_code == 409
    assert bekannt.post(f"/api/chat/{r['chat']}/archivieren", json={'archiviert': False}, headers=PIN).json() == {'ok': True}
    c = chat(bekannt, r['chat'])
    assert (c['archiviert'], c['stand']) == (None, 'gestoppt')
    assert bekannt.post(f'/api/chat/99/archivieren', json={'archiviert': True}, headers=PIN).status_code == 404


def test_stoppen_fortsetzen_archivieren_brauchen_geraet_und_pin(bekannt, bruecke):
    r = beginnen(bekannt).json()
    for weg in ('stoppen', 'fortsetzen', 'archivieren'):
        body = {'archiviert': True} if weg == 'archivieren' else None
        assert bekannt.post(f"/api/chat/{r['chat']}/{weg}", json=body, headers={'X-Bruecke-Pin': '0000'}).status_code == 403, weg
        fremd = TestClient(bekannt.app)
        assert fremd.post(f"/api/chat/{r['chat']}/{weg}", json=body, headers=PIN).status_code == 401, weg


def test_chats_je_repository_auf_der_tafel(bekannt, bericht):
    bekannt.post('/api/bericht', json=bericht)
    r = beginnen(bekannt).json()
    t = raum(bekannt)
    assert t['pin'] is True and t['modell'] == 'claude-opus-5-5'
    assert FORGE in t['projekte']
    c = chat(bekannt, r['chat'])
    assert (c['forge'], c['kurz'], c['stand'], c['wartet']) == (FORGE, 'flotte-probe', 'offen', True)
    assert c['titel'].startswith('Die Probe soll')


def test_der_stand_uebersteht_einen_neustart(tmp_path, uhr):
    def neu():
        return TestClient(erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin='4711', uhr=uhr)))

    c = neu()
    koppeln(c)
    holen(c)
    chat_id, _ = einmal_beantwortet(c)
    c.post(f'/api/chat/{chat_id}/verwerfen', headers=PIN)
    d = neu()
    x = chat(d, chat_id)
    assert (x['stand'], x['rechner'], x['konto']) == ('verworfen', 'STATION-A', '2')
    assert raum(d)['konten'][0]['konto'] == '1'


def test_gestoppt_und_archiviert_ueberstehen_einen_neustart(tmp_path, uhr):
    def neu():
        return TestClient(erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin='4711', uhr=uhr)))

    c = neu()
    koppeln(c)
    holen(c)
    a, b = beginnen(c).json(), beginnen(c, text='Zweiter').json()
    c.post(f"/api/chat/{a['chat']}/stoppen", headers=PIN)
    c.post(f"/api/chat/{b['chat']}/archivieren", json={'archiviert': True}, headers=PIN)
    d = neu()
    assert chat(d, a['chat'])['stand'] == 'gestoppt'
    assert chat(d, b['chat'])['archiviert'] is not None
    # still stopped after the restart: no service gets its message
    assert holen(d).json() == []



BEREITSCHAFTSRAUM_JS = (Path(__file__).parent.parent / 'app' / 'static' / 'bereiche' / 'bereitschaftsraum.js').read_text(encoding='utf-8')


def test_befehl_chat_anlegen_nur_ueber_beginnen():
    # #47: the command of the command line sends like the button (beginnen -> senden with device and PIN), nothing else
    teil = BEREITSCHAFTSRAUM_JS[BEREITSCHAFTSRAUM_JS.index('function chatAnlegen'):BEREITSCHAFTSRAUM_JS.index('huelle.bereich(')]
    assert 'ausfuehren: () => (text && formular() ? beginnen(formular())' in teil
    assert 'fetch(' not in teil and 'senden(' not in teil
    # off without a PIN or over the remote entry, and only for the whole word "chat"
    assert 'if (!r?.pin || t.nurAnsicht' in teil
    assert "klein(worte[0]) !== 'chat'" in teil
