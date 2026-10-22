"""Extract attachments from a Gmail RAW get_message result.
Usage: python3 -I decode_mail.py <json_or_raw_file> <outdir>
The input is either the JSON tool result ({"raw": "..."}) or a file holding the bare raw string.
Prints one line per attachment written."""
import sys, os, json, base64, email

src, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
txt = open(src, encoding="utf-8").read().strip()
try:
    raw = json.loads(txt)["raw"]
except (ValueError, KeyError, TypeError):
    raw = txt
pad = "=" * (-len(raw) % 4)
msg = email.message_from_bytes(base64.urlsafe_b64decode(raw + pad))
for part in msg.walk():
    fn = part.get_filename()
    if not fn:
        continue
    data = part.get_payload(decode=True)
    path = os.path.join(outdir, os.path.basename(fn))
    with open(path, "wb") as f:
        f.write(data)
    print(f"{path}\t{len(data)}")
