# "Braucht dich" as a Web-Push (#37): the events of level 1 the bridge has not reported yet, sent to
# every device that subscribed with the PIN. Off without a VAPID key. #243: the content is what the card
# says: the short line of the cause and the person's step with the missions it holds, for a question the
# question in one sentence and the recommendation; never a path or a transcript.
# `python -m app.meldung` prints a new VAPID key for .env.

import base64
import json
import logging
import re

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pywebpush import WebPushException, webpush

from .tafel import tafel

TITEL_MAX = 90
TEXT_MAX = 200
# local paths become <pfad>, as the driver's filter does (UNC, drive, POSIX home folders)
PFADE = [re.compile(r'\\\\[^\s"\'`<>|,;\\]+\\[^\s"\'`<>|,;]*'), re.compile(r'\b[A-Za-z]:[\\/][^\s"\'`<>|,;]*'), re.compile(r'(?<![\w.~-])/(?:home|Users|root)/[^\s"\'`<>|,;]*')]
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


def ohne_pfade(text: str) -> str:
    for muster in PFADE:
        text = muster.sub('<pfad>', text)
    return text


def empfehlung(x: dict) -> str:
    """'B · eigener PR' for a recommendation that names an option, else the recommendation as it is."""
    e = (x.get('empfehlung') or '').strip()
    o = next((o for o in x.get('optionen') or [] if o['buchstabe'] == e), None)
    return f"{e} · {o['text']}" if o else e


def _meldung(x: dict) -> tuple[str, str]:
    """Title and text of one card: the question and its recommendation, or the short line and the step with the missions it holds."""
    if x['art'] == 'frage':
        e = empfehlung(x)
        return x.get('kurz') or x['frage'] or f"Frage zu #{x['epic']}", f"→ {f'Empfohlen: {e}' if e else 'Antwort in der Brücke'} · #{x['epic']}"
    haelt = ', '.join(f"#{m['nr']}" for m in x.get('missionen') or [{'nr': x['epic']}])
    u = x.get('ursache')
    if u:
        return u['kurz'], f"→ {u['schritt'].removesuffix('.')} · hält {haelt}"
    # an older driver without a cause: the mission's title as before
    return f"{'Abgebrochen' if x.get('stufe') == 'abgebrochen' else 'Blockiert'}: {x['titel'] or '#' + str(x['epic'])}", f'→ Ursache ansehen · hält {haelt}'


def ereignisse(projekt: dict, stufen_seit: dict, jetzt, tz) -> list[dict]:
    """The events of level 1 of one project, each with a key that changes when it comes anew (a new question, blocked
    again, the base red again); what the fleet repairs itself and "Dein Schritt bald" ring nothing."""
    braucht = tafel([projekt], stufen_seit, [], jetzt, tz, False)['braucht']
    aus = []
    for x in braucht:
        titel, text = _meldung(x)
        schluessel = x['id'] if x['art'] == 'frage' else f"{x['id']}#{x['seit']}" if x['art'] == 'ursache' else f"{x['id']}#{x['stufe']}#{x['seit']}"
        aus.append({'schluessel': schluessel, 'kurz': x['repo'], 'epic': x['epic'], 'art': x['art'], 'titel': ohne_pfade(titel), 'text': ohne_pfade(text)})
    return aus


def kuerze(titel: str, n: int = TITEL_MAX) -> str:
    return titel if len(titel) <= n else titel[: n - 1].rstrip() + '…'


def inhalt(neu: list[dict]) -> dict:
    """One push: a single event as the card says it, with the project; several with their number and one title per line."""
    if len(neu) == 1:
        x = neu[0]
        return {'titel': kuerze(x['titel']), 'text': kuerze(f"{x['text']} ({x['kurz']})", TEXT_MAX)}
    projekte = ', '.join(sorted({x['kurz'] for x in neu}))
    return {'titel': f'Braucht dich: {len(neu)} neue Meldungen ({projekte})', 'text': '\n'.join(kuerze(x['titel']) for x in neu)}


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
