# "Braucht dich" as a Web-Push (#37): the events of level 1 the bridge has not reported yet, sent to
# every device that subscribed with the PIN. Off without a VAPID key. The content names the project's
# short name, the epic number, the kind and a short title, never the question, a path or a transcript.
# `python -m app.meldung` prints a new VAPID key for .env.

import base64
import json
import logging

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pywebpush import WebPushException, webpush

from .tafel import tafel

TITEL_MAX = 60
ART = {'frage': 'Frage', 'blockade': 'Blockade'}
# a device offline gets the push within this time, then the push service drops it
TTL_S = 24 * 3600
TIMEOUT_S = 10

log = logging.getLogger('uvicorn.error')


def b64(roh: bytes) -> str:
    return base64.urlsafe_b64encode(roh).rstrip(b'=').decode()


def schluessel_erzeugen() -> str:
    """A new VAPID private key, raw and base64url as BRUECKE_VAPID_SCHLUESSEL takes it."""
    v = Vapid()
    v.generate_keys()
    return b64(v.private_key.private_numbers().private_value.to_bytes(32, 'big'))


def oeffentlich(schluessel: str) -> str:
    """The public key of the VAPID key, the applicationServerKey of the page."""
    return b64(Vapid.from_string(schluessel).public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))


def ereignisse(projekt: dict, stufen_seit: dict, jetzt, tz) -> list[dict]:
    """The events of level 1 of one project, each with a key that changes when it comes anew (a new question, blocked again)."""
    braucht = tafel([projekt], stufen_seit, [], jetzt, tz, False)['braucht']
    return [{'schluessel': x['id'] if x['art'] == 'frage' else f"{x['id']}#{x['stufe']}#{x['seit']}", 'kurz': x['repo'], 'epic': x['epic'], 'art': x['art'], 'titel': x['titel']} for x in braucht]


def kuerze(titel: str) -> str:
    return titel if len(titel) <= TITEL_MAX else titel[: TITEL_MAX - 1].rstrip() + '…'


def inhalt(neu: list[dict]) -> dict:
    """One push: a single event with its project and number in the title, several with their number."""
    was = lambda x: ART[x['art']] + (f" · {kuerze(x['titel'])}" if x['titel'] else '')
    if len(neu) == 1:
        x = neu[0]
        return {'titel': f"Braucht dich: {x['kurz']} #{x['epic']}", 'text': was(x)}
    return {'titel': f'Braucht dich: {len(neu)} neue Meldungen', 'text': '\n'.join(f"{x['kurz']} #{x['epic']} {was(x)}" for x in neu)}


class Push:
    def __init__(self, schluessel: str, kontakt: str, senden=None):
        self.schluessel = schluessel
        self.kontakt = kontakt
        self.senden = senden or webpush
        self.oeffentlich = oeffentlich(schluessel)

    def verschicke(self, speicher, nachricht: dict) -> None:
        """To every subscription; one the push service reports gone (404, 410) is deleted, any other failure leaves it."""
        daten = json.dumps(nachricht, ensure_ascii=False)
        for abo in speicher.abos():
            try:
                self.senden(subscription_info={'endpoint': abo['endpoint'], 'keys': {'p256dh': abo['p256dh'], 'auth': abo['auth']}}, data=daten, vapid_private_key=self.schluessel, vapid_claims={'sub': self.kontakt}, ttl=TTL_S, timeout=TIMEOUT_S)
            except WebPushException as x:
                status = getattr(x.response, 'status_code', None)
                if status in (404, 410):
                    speicher.abo_loeschen(abo['endpoint'])
                    log.info('Web-Push: Abo abgelaufen (%s), gelöscht', status)
                else:
                    log.warning('Web-Push fehlgeschlagen (%s), Abo bleibt', status)
            except Exception as x:  # network, timeout: the next event tries again
                log.warning('Web-Push fehlgeschlagen (%s), Abo bleibt', type(x).__name__)


if __name__ == '__main__':
    print(f'BRUECKE_VAPID_SCHLUESSEL={schluessel_erzeugen()}')
