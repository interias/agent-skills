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
    assert k['laeufe'][39]['lage']['deinSchritt'] == {'text': 'Frage beantworten', 'ziel': 'frage', 'ref': None, 'url': None}
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


GEPARKT = {'etikett': 'wartet_auf_dich', 'satz': 'Geparkt, wartet auf #45', 'seit': '2026-11-20T14:05:44Z', 'deinSchritt': {'text': 'Ticket #45 erledigen, dann `ready-for-agent` wieder setzen', 'ziel': 'issue', 'ref': '#45'}, 'gate': None}


@pytest.mark.parametrize('ref,ziel,url', [
    ('#45', 'issue', 'https://github.com/interias/flotte-probe/issues/45'),
    ('#46', 'pr', 'https://github.com/interias/flotte-probe/pull/46'),
    ('interias/infra#7', 'issue', 'https://github.com/interias/infra/issues/7'),
    (None, 'issue', None),
])
def test_geparkte_mission_verlinkt_das_genannte_ticket(client, bericht, ref, ziel, url):
    # the run named what the person waits for: her step leads there, not to the mission and not to "Neu einreihen"
    ep = next(x for x in bericht['epics'] if x['nr'] == 40)
    ep['lage'] = {**GEPARKT, 'deinSchritt': {**GEPARKT['deinSchritt'], 'ref': ref, 'ziel': ziel}}
    assert client.post('/api/bericht', json=bericht).status_code == 200
    d = karten(tafel(client))['blockade'][40]['lage']['deinSchritt']
    assert d['ref'] == ref and d['url'] == url


def test_eine_gitea_forge_verlinkt_ihre_eigene_seite_und_pulls(client, bericht):
    # the driver reports the forge's own page; Gitea shows a pull request under /pulls/<nr>, not GitHub's /pull/
    bericht['url'] = 'http://gitea.example:3003/interias/flotte-probe'
    ep = next(x for x in bericht['epics'] if x['nr'] == 40)
    ep['lage'] = {**GEPARKT, 'deinSchritt': {**GEPARKT['deinSchritt'], 'ref': '#46', 'ziel': 'pr'}}
    assert client.post('/api/bericht', json=bericht).status_code == 200
    k = karten(tafel(client))['blockade'][40]
    assert k['lage']['deinSchritt']['url'] == 'http://gitea.example:3003/interias/flotte-probe/pulls/46'
    assert k['issueUrl'] == 'http://gitea.example:3003/interias/flotte-probe/issues/40'


def test_dein_schritt_ohne_ref_bleibt_wie_zuvor(client, bericht):
    assert client.post('/api/bericht', json=bericht).status_code == 200
    assert karten(tafel(client))['blockade'][40]['lage']['deinSchritt'] == {'text': 'Ursache prüfen, dann neu einreihen oder aufgeben', 'ziel': 'einreihen', 'ref': None, 'url': None}


@pytest.mark.parametrize('ref,code', [('x' * 100, 200), ('x' * 101, 422)])
def test_ref_grenze(client, bericht, ref, code):
    bericht['epics'][1]['lage']['deinSchritt'] = {'text': 'x', 'ziel': 'issue', 'ref': ref}
    assert client.post('/api/bericht', json=bericht).status_code == code


def test_geparkte_blockade_ohne_einreihen_als_hauptknopf():
    # a mission that waits for the person: requeueing it before her step only repeats the same end (observed three times)
    k = re.search(r'function blockadeHtml\(x, t\) \{.*?\n\}', APP_JS, re.S).group(0)
    assert "const geparkt = x.lage?.etikett === 'wartet_auf_dich'" in k
    assert 'class="knopf ${geparkt ? \'zweit\' : \'haupt\'}" data-h="einreihen"' in k


def test_schritt_ist_aufklappbar():
    # the step of a card and the reason of a blockade are never cut for good: a click shows the whole text
    assert re.search(r"\.schritt\.auf \{[^}]*-webkit-line-clamp: unset", (Path(__file__).parent.parent / 'app' / 'static' / 'app.css').read_text(encoding='utf-8'))
    assert "closest('.schritt, .lage.kurz')" in APP_JS
