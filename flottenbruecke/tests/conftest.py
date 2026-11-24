import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import GERAET_COOKIE, RECHNERPORT, Einstellung, erzeuge

BEISPIEL = json.loads((Path(__file__).parent.parent / 'beispiel' / 'bericht.json').read_text(encoding='utf-8'))


def am_rechner(c: TestClient) -> TestClient:
    """The same app over the entry of the machine itself (#46), as a browser on localhost reaches it."""
    return TestClient(c.app, base_url=f'http://localhost:{RECHNERPORT}')


def fremd(c: TestClient) -> TestClient:
    """A client on the same app without the cookie: a device that was never paired."""
    return TestClient(c.app)


def koppeln(c: TestClient, handeln: bool = True, name: str = 'Testgerät', pin: str = '4711') -> dict:
    """#46: pairs the client as a device; with handeln the machine gives it the right to act too. The cookie is Secure:
    the test client talks plain HTTP, so it carries the key as an ordinary cookie."""
    r = c.post('/api/geraete/koppeln', json={'name': name}, headers={'X-Bruecke-Pin': pin})
    assert r.status_code == 200, r.text
    c.cookies.clear()
    c.cookies.set(GERAET_COOKIE, r.cookies[GERAET_COOKIE])
    g = r.json()['geraet']
    if handeln:
        rr = am_rechner(c).post(f"/api/geraete/{g['id']}/rechte", json={'antworten': True, 'handeln': True}, headers={'X-Bruecke-Pin': pin})
        assert rr.status_code == 200, rr.text
    return g


class Uhr:
    def __init__(self):
        self.t = datetime(2026, 11, 20, 14, 31, 10, tzinfo=timezone.utc)

    def __call__(self):
        return self.t


@pytest.fixture
def uhr():
    return Uhr()


@pytest.fixture
def bruecke(tmp_path, uhr):
    # paired with every right (#46) whenever a PIN is set: the tests of the actions start from a device that may act
    def baue(pin='4711', token=''):
        c = TestClient(erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin=pin, token=token, uhr=uhr)))
        if pin:
            koppeln(c, pin=pin)
        return c

    return baue


@pytest.fixture
def client(bruecke):
    return bruecke()


@pytest.fixture
def bericht():
    return copy.deepcopy(BEISPIEL)
