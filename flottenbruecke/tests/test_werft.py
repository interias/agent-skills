"""The Werft on the bridge (#90, agent-skills/ADR-0005): the bridge takes the report of each machine's Werft
and holds its stand, the actions of the person (only with the PIN) and the messages; it never calls the Werft."""

import copy
import json
from pathlib import Path

import pytest

BEISPIEL = Path(__file__).parent.parent / 'beispiel'
WERFT = json.loads((BEISPIEL / 'werft.json').read_text(encoding='utf-8'))
FORGE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}


@pytest.fixture
def werft():
    return copy.deepcopy(WERFT)


def arbeit(w):
    return next(s for s in w['repos'][0]['stacks'] if s['name'] == 'api')['arbeit']


def freigabe_text(a):
    return json.dumps({'commit': a['commit'], 'sicherung': a['sicherung'], 'pruefsumme': a['pruefsumme']})


def handeln(c, art, stack=None, text=None, pin='4711', forge=FORGE, rechner='werkstatt'):
    body = {'rechner': rechner, 'forge': forge, 'stack': stack, 'art': art, 'text': text}
    return c.post('/api/werft/handlung', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def einstellen(c, name, wert, stack=None, pin='4711'):
    return handeln(c, 'einstellen', stack, json.dumps({'name': name, 'wert': wert}), pin)


def offene(c, rechner='werkstatt', **koepfe):
    r = c.get('/api/werft/handlungen', params={'rechner': rechner}, headers=koepfe)
    assert r.status_code == 200, r.text
    return r.json()


def werft_tafel(c):
    return c.get('/api/tafel').json()['werft']


# ---- Annahme: POST /api/werft


def test_bericht_wird_angenommen_und_steht_in_der_tafel(client, werft):
    assert client.post('/api/werft', json=werft).json() == {'ok': True}
    [r] = werft_tafel(client)
    assert (r['rechner'], r['forge'], r['kurz'], r['branch'], r['stand'], r['abfrageS'], r['an'], r['migrationTest'], r['fehler'], r['veraltet']) == ('werkstatt', FORGE, 'flotte-probe', 'main', werft['repos'][0]['stand'], 120, True, True, None, False)
    st = {s['name']: s for s in r['stacks']}
    assert [s['name'] for s in r['stacks']] == ['web', 'api', 'worker', 'doku']
    assert (st['web']['status'], st['web']['commit'], st['web']['zeit']) == ('gruen', werft['repos'][0]['stand'], '2026-11-20T14:12:08Z')
    assert st['worker']['status'] == 'rot' and 'lockfile' in st['worker']['protokoll']
    assert st['api']['arbeit']['zustand'] == 'wartet' and st['api']['arbeit']['sicherung'] == '2026-11-20-141351-api.sql.gz'
    assert st['doku']['an'] is False
    assert all(s['nachziehen'] is None and s['freigabe'] is None for s in r['stacks'])


def test_der_bericht_eines_rechners_ersetzt_seinen_vorigen(client, werft):
    client.post('/api/werft', json=werft)
    werft['repos'][0]['stacks'] = werft['repos'][0]['stacks'][:1]
    werft['meldungen'] = []
    client.post('/api/werft', json=werft)
    anderer = {**copy.deepcopy(werft), 'rechner': 'buero'}
    client.post('/api/werft', json=anderer)
    t = werft_tafel(client)
    assert [(r['rechner'], len(r['stacks'])) for r in t] == [('buero', 1), ('werkstatt', 1)]


def test_bericht_braucht_den_treiber_token(bruecke, werft):
    c = bruecke(token='geheim')
    assert c.post('/api/werft', json=werft).status_code == 401
    assert c.post('/api/werft', json=werft, headers={'X-Bruecke-Token': 'falsch'}).status_code == 401
    assert c.post('/api/werft', json=werft, headers={'X-Bruecke-Token': 'geheim'}).status_code == 200
    assert c.get('/api/werft/handlungen', params={'rechner': 'werkstatt'}).status_code == 401
    assert c.post('/api/werft/handlungen/1/quittung').status_code == 401


@pytest.mark.parametrize('kaputt', [
    lambda w: w['repos'][0]['stacks'][0].update(status='gelb'),
    lambda w: w['repos'][0]['stacks'][1]['arbeit'].update(zustand='vielleicht'),
    # the backup by its file name only, never a path
    lambda w: w['repos'][0]['stacks'][1]['arbeit'].update(sicherung='C:\\Users\\x\\api.sql.gz'),
    lambda w: w['repos'][0]['stacks'][1]['arbeit'].update(sicherung='/var/sicherung/api.sql.gz'),
    lambda w: w['repos'][0].update(forge='C:\\git\\flotte-probe'),
    lambda w: w.pop('rechner'),
])
def test_ungueltige_berichte_sind_422(client, werft, kaputt):
    kaputt(werft)
    assert client.post('/api/werft', json=werft).status_code == 422
    assert werft_tafel(client) == []


def test_eine_lange_meldung_kippt_den_bericht_nicht(client, werft):
    werft['meldungen'] = ['x' * 9000]
    assert client.post('/api/werft', json=werft).status_code == 200
    assert len(next(e for e in client.get('/api/tafel').json()['ereignisse'] if e['kurz'] == 'Werft')['text']) <= 4000


def test_alte_werft_ohne_die_felder_von_90(client, werft):
    r = werft['repos'][0]
    for k in ('an', 'migrationTest', 'abfrageGesetzt'):
        r.pop(k)
    for s in r['stacks']:
        s.pop('an')
    assert client.post('/api/werft', json=werft).status_code == 200
    [x] = werft_tafel(client)
    assert x['an'] is True and x['migrationTest'] is True and all(s['an'] for s in x['stacks'])


def test_meldungen_kommen_ins_laufband_und_bleiben_nach_einem_leeren_takt(client, werft):
    client.post('/api/werft', json=werft)
    werft['meldungen'] = []
    werft['zeit'] = '2026-11-20T14:31:00Z'
    client.post('/api/werft', json=werft)
    ev = [e for e in client.get('/api/tafel').json()['ereignisse'] if e['kurz'] == 'Werft']
    assert len(ev) == 3
    assert {e['forge'] for e in ev} == {FORGE} and all(e['zeit'] == '2026-11-20T14:30:45Z' and e['epic'] is None for e in ev)
    assert any('worker rot' in e['text'] for e in ev)


def test_ohne_werft_ist_die_liste_leer(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert werft_tafel(client) == []


# ---- PIN-Pflicht: POST /api/werft/handlung


@pytest.mark.parametrize('art,stack,text', [
    ('nachziehen', 'worker', None),
    ('migration_freigeben', 'api', freigabe_text(arbeit(WERFT))),
    ('einstellen', None, json.dumps({'name': 'an', 'wert': False})),
    ('einstellen', 'doku', json.dumps({'name': 'an', 'wert': True})),
    ('einstellen', None, json.dumps({'name': 'abfrage_s', 'wert': 300})),
    ('einstellen', None, json.dumps({'name': 'migration_test', 'wert': False})),
])
def test_jede_handlung_nur_mit_pin(client, werft, art, stack, text):
    client.post('/api/werft', json=werft)
    assert handeln(client, art, stack, text, pin=None).status_code == 401
    assert handeln(client, art, stack, text, pin='0000').status_code == 401
    assert offene(client) == []
    r = handeln(client, art, stack, text)
    assert r.status_code == 200, r.text
    [h] = offene(client)
    assert (h['id'], h['forge'], h['stack'], h['art'], h['herkunft']) == (r.json()['id'], FORGE, stack, art, 'Mensch über die Brücke')
    assert json.loads(h['text']) == json.loads(text) if text else h['text'] is None


def test_ohne_gesetzte_pin_ist_alles_abgeschaltet(bruecke, werft):
    c = bruecke(pin='')
    c.post('/api/werft', json=werft)
    assert handeln(c, 'nachziehen', 'worker').status_code == 403
    assert offene(c) == []


def test_fuenf_falsche_pins_sperren_auch_hier(client, werft):
    client.post('/api/werft', json=werft)
    for _ in range(5):
        assert handeln(client, 'nachziehen', 'worker', pin='0000').status_code == 401
    assert handeln(client, 'nachziehen', 'worker').status_code == 429
    assert offene(client) == []


# ---- abholen, quittieren: GET /api/werft/handlungen, POST /api/werft/handlungen/{id}/quittung


def test_abholen_quittieren_und_die_tafel(client, werft):
    client.post('/api/werft', json=werft)
    handeln(client, 'nachziehen', 'worker')
    handeln(client, 'migration_freigeben', 'api', freigabe_text(arbeit(werft)))
    einstellen(client, 'abfrage_s', 300)
    [r] = werft_tafel(client)
    st = {s['name']: s for s in r['stacks']}
    assert (st['worker']['nachziehen']['abgeholt'], st['api']['freigabe']['abgeholt']) == (False, False)
    assert {e['name']: e for e in r['einstellungen']}['abfrage_s']['offen'] == {'wert': 300, 'zeit': '2026-11-20T14:31:10+00:00', 'abgeholt': False}
    # only the Werft of that machine gets them
    assert offene(client, rechner='buero') == []
    geholt = offene(client)
    assert [h['art'] for h in geholt] == ['nachziehen', 'migration_freigeben', 'einstellen']
    assert werft_tafel(client)[0]['stacks'][2]['nachziehen']['abgeholt'] is True
    # unacknowledged: they come again (a nachziehen that could not work waits for the next takt)
    assert [h['id'] for h in offene(client)] == [h['id'] for h in geholt]
    for h in geholt:
        assert client.post(f"/api/werft/handlungen/{h['id']}/quittung").json() == {'ok': True}
    assert client.post(f"/api/werft/handlungen/{geholt[0]['id']}/quittung").json() == {'ok': True}
    assert offene(client) == []
    assert client.post('/api/werft/handlungen/999/quittung').status_code == 404
    [r] = werft_tafel(client)
    assert all(s['nachziehen'] is None and s['freigabe'] is None for s in r['stacks'])
    assert all(e['offen'] is None for e in r['einstellungen'])


def test_abholen_folgt_dem_vertrag(client, werft):
    client.post('/api/werft', json=werft)
    vertrag = json.loads((BEISPIEL / 'werft-handlungen.json').read_text(encoding='utf-8'))
    for v in vertrag:
        assert handeln(client, v['art'], v['stack'], v['text']).status_code == 200, v
    geholt = offene(client)
    assert [set(h) for h in geholt] == [set(v) for v in vertrag]
    assert [(h['forge'], h['stack'], h['art'], json.loads(h['text']) if h['text'] else None) for h in geholt] == [(v['forge'], v['stack'], v['art'], json.loads(v['text']) if v['text'] else None) for v in vertrag]


def test_die_letzte_gilt_bis_zum_abholen_danach_409(client, werft):
    client.post('/api/werft', json=werft)
    einstellen(client, 'abfrage_s', 300)
    einstellen(client, 'abfrage_s', 600)
    einstellen(client, 'an', False, stack='web')
    handeln(client, 'nachziehen', 'worker')
    handeln(client, 'nachziehen', 'worker')
    geholt = offene(client)
    assert [(h['art'], h['stack'], h['text'] and json.loads(h['text'])) for h in geholt] == [('einstellen', None, {'name': 'abfrage_s', 'wert': 600}), ('einstellen', 'web', {'name': 'an', 'wert': False}), ('nachziehen', 'worker', None)]
    assert einstellen(client, 'abfrage_s', 900).status_code == 409
    assert handeln(client, 'nachziehen', 'worker').status_code == 409
    # another stack is another target
    assert handeln(client, 'nachziehen', 'web').status_code == 200


# ---- what the bridge turns down before the Werft sees it


def test_freigabe_nur_fuer_eine_wartende_migration(client, werft):
    client.post('/api/werft', json=werft)
    a = arbeit(werft)
    # no working migration at all, an unknown stack, an unknown repository or machine
    assert handeln(client, 'migration_freigeben', 'worker', freigabe_text(a)).status_code == 409
    assert handeln(client, 'migration_freigeben', 'gibtsnicht', freigabe_text(a)).status_code == 404
    assert handeln(client, 'migration_freigeben', 'api', freigabe_text(a), forge='interias/andere').status_code == 404
    assert handeln(client, 'migration_freigeben', 'api', freigabe_text(a), rechner='buero').status_code == 404
    # bound to what the person saw: another commit, backup or checksum is not the waiting migration
    for k, v in [('commit', 'f' * 40), ('sicherung', 'andere.sql.gz'), ('pruefsumme', '0' * 64)]:
        assert handeln(client, 'migration_freigeben', 'api', json.dumps({**json.loads(freigabe_text(a)), k: v})).status_code == 409, k
    for text in (None, '{}', 'kein json', json.dumps({'commit': a['commit']})):
        assert handeln(client, 'migration_freigeben', 'api', text).status_code == 422, text
    for zustand in ('gesperrt', 'laeuft', 'migriert', 'rot'):
        w = copy.deepcopy(werft)
        arbeit(w)['zustand'] = zustand
        client.post('/api/werft', json=w)
        assert handeln(client, 'migration_freigeben', 'api', freigabe_text(a)).status_code == 409, zustand
    assert offene(client) == []


def test_nichts_fuer_eine_werft_oder_einen_stack_der_aus_ist(client, werft):
    client.post('/api/werft', json=werft)
    assert handeln(client, 'nachziehen', 'doku').status_code == 409
    werft['repos'][0]['an'] = False
    client.post('/api/werft', json=werft)
    assert handeln(client, 'nachziehen', 'worker').status_code == 409
    assert handeln(client, 'migration_freigeben', 'api', freigabe_text(arbeit(werft))).status_code == 409
    # switching it on again goes
    assert einstellen(client, 'an', True).status_code == 200


@pytest.mark.parametrize('name,wert,stack,code', [
    ('an', 'aus', None, 422),
    ('an', 1, None, 422),
    ('an', False, 'gibtsnicht', 404),
    ('migration_test', 'nein', None, 422),
    ('migration_test', False, 'api', 422),
    ('abfrage_s', 14, None, 422),
    ('abfrage_s', 86401, None, 422),
    ('abfrage_s', 30.5, None, 422),
    ('abfrage_s', True, None, 422),
    ('abfrage_s', 60, 'api', 422),
    ('gibtsnicht', True, None, 422),
    ('abfrage_s', 15, None, 200),
    ('abfrage_s', 86400, None, 200),
    ('abfrage_s', None, None, 200),
    ('migration_test', True, None, 200),
])
def test_grenzen_der_einstellungen(client, werft, name, wert, stack, code):
    client.post('/api/werft', json=werft)
    assert einstellen(client, name, wert, stack).status_code == code


def test_nachziehen_braucht_einen_stack_und_keinen_text(client, werft):
    client.post('/api/werft', json=werft)
    assert handeln(client, 'nachziehen', None).status_code == 422
    assert handeln(client, 'gibtsnicht', 'worker').status_code == 422


def test_einstellungen_der_werft_in_der_tafel(client, werft):
    werft['repos'][0]['abfrageGesetzt'] = 300
    werft['repos'][0]['abfrageS'] = 300
    werft['repos'][0]['migrationTest'] = False
    client.post('/api/werft', json=werft)
    einstellen(client, 'an', True, stack='doku')
    e = {x['name']: x for x in werft_tafel(client)[0]['einstellungen']}
    assert [x['name'] for x in werft_tafel(client)[0]['einstellungen']] == ['an', 'stacks', 'abfrage_s', 'migration_test']
    assert (e['an']['wert'], e['an']['werte'], e['an']['herkunft']) == ('an', ['an', 'aus'], 'standard')
    assert (e['stacks']['wert'], e['stacks']['auswahl'], e['stacks']['herkunft']) == (['web', 'api', 'worker'], ['web', 'api', 'worker', 'doku'], 'bruecke')
    assert e['stacks']['offen']['wert'] == ['web', 'api', 'worker', 'doku']
    assert (e['abfrage_s']['wert'], e['abfrage_s']['leer'], e['abfrage_s']['min'], e['abfrage_s']['max'], e['abfrage_s']['herkunft']) == (300, True, 15, 86400, 'bruecke')
    assert (e['migration_test']['wert'], e['migration_test']['herkunft']) == ('nein', 'bruecke')


def test_werft_handlungen_stoeren_die_des_treibers_nicht(client, werft, bericht):
    client.post('/api/bericht', json=bericht)
    client.post('/api/werft', json=werft)
    handeln(client, 'nachziehen', 'worker')
    assert client.get('/api/handlungen', params={'forge': FORGE}).json() == []


def test_werft_auf_einem_alten_volume(tmp_path, uhr, werft):
    import sqlite3

    from fastapi.testclient import TestClient

    from app.main import Einstellung, erzeuge

    db = tmp_path / 'alt.db'
    with sqlite3.connect(db) as alt:
        alt.execute('create table projekte (forge text primary key, angelegt text not null, empfangen text not null, bericht text not null)')
    c = TestClient(erzeuge(Einstellung(db=str(db), pin='4711', uhr=uhr)))
    assert c.post('/api/werft', json=werft).status_code == 200
    assert handeln(c, 'nachziehen', 'worker').status_code == 200


def test_quittierte_werft_handlungen_stehen_als_mensch_im_logbuch(client, werft):
    """Epic #62: every change stands in the logbook, like the driver's settings, not only as a message of the Werft."""
    client.post('/api/werft', json=werft)
    einstellen(client, 'an', False, stack='web')
    einstellen(client, 'migration_test', False)
    einstellen(client, 'abfrage_s', 300)
    handeln(client, 'migration_freigeben', 'api', freigabe_text(arbeit(werft)))
    handeln(client, 'nachziehen', 'worker')
    geholt = offene(client)
    # not acknowledged yet: nothing in the logbook
    assert [x for x in client.get('/api/tafel').json()['erledigt'] if x.get('werft')] == []
    for h in geholt:
        client.post(f"/api/werft/handlungen/{h['id']}/quittung")
    x = [x for x in client.get('/api/tafel').json()['erledigt'] if x.get('werft')]
    assert {(e['handlung'], e.get('titel'), e.get('wert'), e['stack']) for e in x} == {
        ('einstellen', 'Werft · Stack web', 'aus', 'web'),
        ('einstellen', 'Werft · Test-Migrationen selbst', 'nein', None),
        ('einstellen', 'Werft · Abfrageabstand (s)', 300, None),
        ('migration_freigeben', None, None, 'api'),
        ('nachziehen', None, None, 'worker'),
    }
    assert all(e['art'] == 'handlung' and e['epic'] is None and e['forge'] == FORGE and e['repo'] == 'flotte-probe' for e in x)
