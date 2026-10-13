"""Split an .eml into headers, plain text and image files.

Usage: python -P eml_zerlegen.py <mail.eml> <out_dir>

Writes <out_dir>/mail.json, <out_dir>/mail.txt, <out_dir>/mail.html (if present) and every
image part under its file name. Small images are flagged as likely signature graphics.
"""
import email
import json
import os
import sys
from email import policy
from email.utils import getaddresses, parseaddr

SIGNATURE_MAX_BYTES = 40_000


def image_size(data):
    try:
        from io import BytesIO
        from PIL import Image
        with Image.open(BytesIO(data)) as im:
            return im.size
    except Exception:
        return None


def main(path, out):
    os.makedirs(out, exist_ok=True)
    msg = email.message_from_bytes(open(path, "rb").read(), policy=policy.default)
    text, html, images = "", "", []
    for i, part in enumerate(msg.walk()):
        if part.is_multipart():
            continue
        ct = part.get_content_type()
        if ct.startswith("image/"):
            data = part.get_payload(decode=True) or b""
            name = os.path.basename(part.get_filename() or f"bild{i}.{ct.split('/')[-1]}")
            open(os.path.join(out, name), "wb").write(data)
            size = image_size(data)
            images.append({
                "file": name,
                "cid": (part["Content-ID"] or "").strip("<>") or None,
                "bytes": len(data),
                "width": size[0] if size else None,
                "height": size[1] if size else None,
                "likely_signature": len(data) < SIGNATURE_MAX_BYTES,
            })
        elif ct == "text/plain" and not part.get_filename() and not text:
            text = part.get_content()
        elif ct == "text/html" and not part.get_filename() and not html:
            html = part.get_content()
        elif part.get_filename():
            name = os.path.basename(part.get_filename())
            open(os.path.join(out, name), "wb").write(part.get_payload(decode=True) or b"")
            images.append({"file": name, "cid": None, "bytes": None, "attachment": ct})

    sender_name, sender = parseaddr(msg["From"] or "")
    info = {
        "from": sender,
        "from_name": sender_name,
        "reply_to": parseaddr(msg["Reply-To"] or "")[1] or None,
        "to": [a for _, a in getaddresses(msg.get_all("To", []))],
        "cc": [a for _, a in getaddresses(msg.get_all("Cc", []))],
        "date": msg["Date"],
        "subject": msg["Subject"],
        "message_id": msg["Message-ID"],
        "references": msg["References"],
        "parts": images,
    }
    open(os.path.join(out, "mail.txt"), "w", encoding="utf-8").write(text)
    if html:
        open(os.path.join(out, "mail.html"), "w", encoding="utf-8").write(html)
    json.dump(info, open(os.path.join(out, "mail.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
