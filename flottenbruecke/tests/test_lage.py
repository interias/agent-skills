"""The line of a card (lage): the driver says in one sentence what happens with an epic, with a label, since when
and the person's step. The bridge only passes it on to the cards; an older driver sends none."""

import re
from pathlib import Path
from typing import get_args

import pytest

from app.modelle import DeinSchritt, Lage

APP_JS = (Path(__file__).parent.parent / 'app' / 'static' / 'app.js').read_text(encoding='utf-8')


def tafel(c):
    return c.get('/api/tafel').json()


def karten(t):
    u = t['unterwegs']
    return {
        'laeufe': {x['nr']: x for x in u['laeufe']},
        'schlange': {x['nr']: x for x in u['schlange']},
        'bereit': {x['nr']: x for x in u['bereit']},
        'blockade': {x['epic']: x for x in t['braucht'] if x['art'] == 'blockade'},
        'sternenkarte': {x['nr']: x for x in t['projekte'][0]['epics']},
    }


def test_lage_kommt_auf_jede_karte(client, bericht):
    assert client.post('/api/bericht', json=bericht).status_code == 200
    k = karten(tafel(client))
    assert k['laeufe'][38]['lage'] == {'etikett': 'prueft', 'satz': 'Erster Offizier prüft #54', 'seit': '2026-11-20T14:20:00Z', 'deinSchritt': None, 'gate': None}
    assert k['laeufe'][39]['lage']['deinSchritt'] == {'text': 'Frage beantworten', 'ziel': 'frage'}
    assert k['schlange'][36]['lage']['gate'] == {'kontexte': [{'name': 'buero', 'stand': 'fertig'}, {'name': 'wurzel', 'stand': 'laeuft'}], 'von': 3, 'seit': '2026-11-20T14:27:45Z'}
    assert k['bereit'][41]['lage']['etikett'] == 'wartet'
    assert k['blockade'][40]['lage']['deinSchritt']['ziel'] == 'einreihen'
    assert k['sternenkarte'][38]['lage']['satz'] == 'Erster Offizier prüft #54'
    # the old fields stay: the step moves into the detail of the page, the bridge still gives it
    assert k['laeufe'][38]['schritt'] == 'Paket P2: Tests grün, Erster Offizier prüft'


def test_frage_behaelt_ihre_eigene_lage(client, bericht):
    # a question card has its own "lage" (the situation of the question, a text): the epic's line does not replace it
    client.post('/api/bericht', json=bericht)
    frage = next(x for x in tafel(client)['braucht'] if x['art'] == 'frage')
    assert isinstance(frage['lage'], str)


def test_aelterer_treiber_ohne_lage(client, bericht):
    for ep in bericht['epics']:
        ep.pop('lage')
    assert client.post('/api/bericht', json=bericht).status_code == 200
    k = karten(tafel(client))
    for art in ('laeufe', 'schlange', 'bereit', 'blockade', 'sternenkarte'):
        assert k[art] and all(x['lage'] is None for x in k[art].values()), art
    assert k['laeufe'][39]['wartetAufDich'] is False and k['laeufe'][38]['schritt']


def test_lage_ohne_seit_schritt_und_gate(client, bericht):
    bericht['epics'][1]['lage'] = {'etikett': 'arbeitet', 'satz': 'Ingenieur an #53 (Standard), 1 von 3 Paketen fertig'}
    assert client.post('/api/bericht', json=bericht).status_code == 200
    assert karten(tafel(client))['laeufe'][38]['lage'] == {'etikett': 'arbeitet', 'satz': 'Ingenieur an #53 (Standard), 1 von 3 Paketen fertig', 'seit': None, 'deinSchritt': None, 'gate': None}


GRENZEN = [
    (lambda l: l.update(satz='x' * 500), 200),
    (lambda l: l.update(satz='x' * 501), 422),
    (lambda l: l.update(deinSchritt={'text': 'x' * 300, 'ziel': 'pr'}), 200),
    (lambda l: l.update(deinSchritt={'text': 'x' * 301, 'ziel': 'pr'}), 422),
    (lambda l: l.update(deinSchritt={'text': 'Frage beantworten', 'ziel': 'chat'}), 422),
    (lambda l: l.update(etikett='laeuft'), 422),
    (lambda l: l.update(seit='x' * 41), 422),
    (lambda l: l.update(gate={'kontexte': [{'name': f'k{i}', 'stand': 'fertig'} for i in range(40)], 'von': 40}), 200),
    (lambda l: l.update(gate={'kontexte': [{'name': f'k{i}', 'stand': 'fertig'} for i in range(41)], 'von': 41}), 422),
    (lambda l: l.update(gate={'kontexte': [{'name': 'x' * 100, 'stand': 'laeuft'}]}), 200),
    (lambda l: l.update(gate={'kontexte': [{'name': 'x' * 101, 'stand': 'laeuft'}]}), 422),
    (lambda l: l.update(gate={'kontexte': [{'name': 'wurzel', 'stand': 'rot'}]}), 422),
    (lambda l: l.update(gate={'kontexte': [], 'von': 0}), 422),
    (lambda l: l.pop('satz'), 422),
]


@pytest.mark.parametrize('aendern,code', GRENZEN)
def test_grenzen(client, bericht, aendern, code):
    aendern(bericht['epics'][1]['lage'])
    assert client.post('/api/bericht', json=bericht).status_code == code


def test_seite_kennt_jedes_etikett_und_ziel():
    # the page names every label of the contract and leads every target somewhere
    etiketten = get_args(Lage.model_fields['etikett'].annotation)
    zeile = next(z for z in APP_JS.splitlines() if z.startswith('const ETIKETT = '))
    assert sorted(re.findall(r'(\w+): \'', zeile)) == sorted(etiketten)
    for ziel in get_args(DeinSchritt.model_fields['ziel'].annotation):
        assert f"'{ziel}'" in APP_JS or f'{ziel}:' in APP_JS, ziel
