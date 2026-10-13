"""Build a reply draft (.eml, X-Unsent) that Outlook opens as an editable, unsent message.

Usage: python -P antwort_entwurf.py <original.eml> <body.html> <out.eml> [image ...]

body.html is an HTML fragment. <img src="name.png"> whose name matches a passed image is
rewritten to an inline cid reference. The original message is quoted below the body.
"""
import html
import os
import re
import sys
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import formatdate, getaddresses, make_msgid, parseaddr


def quoted(orig):
    body = orig.get_body(preferencelist=("plain",))
    text = body.get_content() if body else ""
    text = re.sub(r"\[cid:[^\]]+\]", "", text).strip()
    head = (
        f"<b>Von:</b> {html.escape(orig['From'] or '')}<br>"
        f"<b>Gesendet:</b> {html.escape(orig['Date'] or '')}<br>"
        f"<b>An:</b> {html.escape(orig['To'] or '')}<br>"
        f"<b>Betreff:</b> {html.escape(orig['Subject'] or '')}"
    )
    return (
        '<hr style="border:none;border-top:1px solid #b5c4df">'
        f'<div style="font-size:10pt">{head}</div><br>'
        f'<div style="white-space:pre-wrap;font-size:10pt">{html.escape(text)}</div>'
    )


def plain(fragment):
    t = re.sub(r"<(br|/p|/div|/li|/h\d)[^>]*>", "\n", fragment, flags=re.I)
    t = re.sub(r"<li[^>]*>", "- ", t, flags=re.I)
    t = re.sub(r"<img[^>]*>", "[Bild]", t, flags=re.I)
    return html.unescape(re.sub(r"<[^>]+>", "", t)).strip()


def main(orig_path, body_path, out_path, *images):
    orig = BytesParser(policy=policy.default).parse(open(orig_path, "rb"))
    fragment = open(body_path, encoding="utf-8").read()

    me = [a for _, a in getaddresses(orig.get_all("To", []))]
    sender = parseaddr(orig["Reply-To"] or orig["From"])[1]
    cc = [a for _, a in getaddresses(orig.get_all("Cc", [])) if a.lower() not in {m.lower() for m in me}]
    subject = orig["Subject"] or ""
    if not re.match(r"^\s*(aw|re|wg|fw)\s*:", subject, re.I):
        subject = f"AW: {subject}"

    cids = {}
    for path in images:
        name = os.path.basename(path)
        cids[name] = make_msgid(domain="antwort.local")[1:-1]
        fragment = re.sub(rf'src=["\']{re.escape(name)}["\']', f'src="cid:{cids[name]}"', fragment)

    msg = EmailMessage()
    msg["X-Unsent"] = "1"
    if me:
        msg["From"] = me[0]
    msg["To"] = sender
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    if orig["Message-ID"]:
        msg["In-Reply-To"] = orig["Message-ID"]
        msg["References"] = " ".join(filter(None, [orig["References"], orig["Message-ID"]]))
    msg.set_content(plain(fragment))
    page = (
        '<html><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt">'
        f"{fragment}<br>{quoted(orig)}</body></html>"
    )
    msg.add_alternative(page, subtype="html")
    html_part = msg.get_payload()[1]
    for path in images:
        name = os.path.basename(path)
        sub = name.rsplit(".", 1)[-1].lower().replace("jpg", "jpeg")
        html_part.add_related(open(path, "rb").read(), "image", sub, cid=f"<{cids[name]}>", filename=name)

    open(out_path, "wb").write(msg.as_bytes(policy=policy.SMTP))
    unused = [n for n in cids if f"cid:{cids[n]}" not in page]
    print(f"{out_path}  An: {sender}  Betreff: {subject}")
    if unused:
        print(f"WARNUNG: im Text nicht referenziert: {', '.join(unused)}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
