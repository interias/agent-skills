import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import Einstellung, erzeuge

BEISPIEL = json.loads((Path(__file__).parent.parent / 'beispiel' / 'bericht.json').read_text(encoding='utf-8'))


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
    def baue(pin='4711', token=''):
        return TestClient(erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin=pin, token=token, uhr=uhr)))

    return baue


@pytest.fixture
def client(bruecke):
    return bruecke()


@pytest.fixture
def bericht():
    return copy.deepcopy(BEISPIEL)
