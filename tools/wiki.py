"""The group's internal wiki (Internal.html) is stored encrypted in data/internal.enc.json.

The browser decrypts it with the group password and re-encrypts it when someone saves an edit, so the
repository only ever holds ciphertext. This script does the same from the command line, for bulk edits
or for changing the password.

    python3 tools/wiki.py export  DIR     # decrypt every page into DIR/<id>.md (DIR must be outside the repo)
    python3 tools/wiki.py import  DIR     # encrypt DIR/*.md back into data/internal.enc.json
    python3 tools/wiki.py password        # change the password

The password is asked for interactively and never stored. Page order follows the file names (a numeric
prefix such as "03-" sets the order and is dropped from the page id); the first "# " line is the title.

Format: AES-256-GCM, key from PBKDF2-HMAC-SHA256 (600,000 iterations, 16-byte salt), 12-byte IV.
Needs the "cryptography" package (pip install cryptography).
"""
import base64
import datetime
import getpass
import json
import os
import re
import sys

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "..", "data", "internal.enc.json")
ITER = 600000
b64 = lambda b: base64.b64encode(b).decode()


def key(password, salt, iterations=ITER):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations).derive(password.encode())


def encrypt(obj, password):
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(key(password, salt)).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode(), None)
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "cipher": "AES-256-GCM", "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def decrypt(store, password):
    k = key(password, base64.b64decode(store["salt"]), store["iter"])
    return json.loads(AESGCM(k).decrypt(base64.b64decode(store["iv"]), base64.b64decode(store["ct"]), None))


def load(password):
    with open(STORE) as f:
        return decrypt(json.load(f), password)


def save(wiki, password):
    with open(STORE, "w") as f:
        json.dump(encrypt(wiki, password), f)
        f.write("\n")


def inside_repo(path):
    return os.path.abspath(path).startswith(os.path.abspath(os.path.join(HERE, "..")) + os.sep)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("export", "import", "password"):
        sys.exit(__doc__)
    cmd = sys.argv[1]
    if cmd in ("export", "import"):
        if len(sys.argv) < 3:
            sys.exit("Give a folder.")
        folder = sys.argv[2]
        if inside_repo(folder):
            sys.exit("Use a folder outside the website repository, so the plain text is never committed.")
    if cmd == "export":
        wiki = load(getpass.getpass("Wiki password: "))
        os.makedirs(folder, exist_ok=True)
        for i, p in enumerate(wiki["pages"], 1):
            with open(os.path.join(folder, "%02d-%s.md" % (i, p["id"])), "w") as f:
                f.write(p["body"].rstrip() + "\n")
        print("Wrote %d pages to %s" % (len(wiki["pages"]), folder))
    elif cmd == "import":
        password = getpass.getpass("Wiki password: ")
        if os.path.exists(STORE):
            load(password)                       # refuse a mistyped password rather than re-keying the wiki
        elif password != getpass.getpass("Repeat it: "):
            sys.exit("Passwords differ.")
        pages, today = [], datetime.date.today().isoformat()
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".md"):
                continue
            body = open(os.path.join(folder, name), encoding="utf-8").read()
            m = re.search(r"^#\s+(.+)$", body, re.M)
            pid = re.sub(r"^\d+-", "", name[:-3])
            pages.append({"id": pid, "title": m.group(1).strip() if m else pid, "body": body, "updated": today})
        save({"pages": pages, "updated": today}, password)
        print("Encrypted %d pages into %s" % (len(pages), os.path.relpath(STORE)))
    else:
        wiki = load(getpass.getpass("Current password: "))
        new = getpass.getpass("New password: ")
        if new != getpass.getpass("Repeat it: "):
            sys.exit("Passwords differ.")
        save(wiki, new)
        print("Re-encrypted with the new password. Commit data/internal.enc.json.")


if __name__ == "__main__":
    main()
