#!/usr/bin/env python3
"""Dark matter limit database: find new exclusion curves on arXiv, store them, publish them.

Python 3 standard library only.  Typical use on the web server:

    python3 tools/limits.py update      # nightly from cron: scrape, extract, export
    python3 tools/limits.py serve       # review/digitize UI on http://127.0.0.1:8787/Limits.html
    python3 tools/limits.py list        # what is in the database
    python3 tools/limits.py add 2207.03764 curve.csv --label "LZ 2022" --channel SI

How curves get in (tried in this order for every candidate paper)
  1. HEPData      tables published by the collaboration            -> status "auto"
  2. ancillary    data files inside the arXiv source package        -> "auto" if the units are
                                                                       unambiguous, else "pending"
  3. figures      curves read out of the vector figures in the      -> always "pending"
                  arXiv source package (tools/figures.py; needs        (exact coordinates, but a
                  `pip install pymupdf`).  No key needed.               person picks which lines to keep)
  4. AI           optional, off unless you pass --ai: Claude reads  -> always "pending"
                  the PDF and digitizes (needs ANTHROPIC_API_KEY; approximate)
  5. manual       the digitizer in the review UI, or `add`          -> "approved"

Four kinds of entry are kept (column `kind`):
  limit       a published exclusion limit                     (drawn solid)
  projection  a projected sensitivity of a future experiment  (drawn dashed)
  discovery   a 3-sigma or 5-sigma discovery contour          (drawn dashed, shorter dashes)
  model       a region or line predicted by a theory model    (drawn as a filled region)
Model predictions come from theory papers found with the MODELS search list below.  They are
almost always figure-only, so they depend on the AI step and always wait for review.

Everything is kept in tools/limits.db (SQLite).  `export` writes data/limits.json, which is
what the public page reads.  Curves are stored in GeV and cm^2 (couplings are unitless).
"""
import argparse
import base64
import hashlib
import datetime as dt
import io
import json
import math
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, ".."))
DB_PATH = os.path.join(HERE, "limits.db")
EXPORT_PATH = os.path.join(SITE, "data", "limits.json")
DUMP_PATH = os.path.join(HERE, "limits.sql")     # the database as text: this file, not limits.db, goes into git
BACKUP_DIR = os.path.join(HERE, "backups")       # daily copies of the database and the published file
KEEP_BACKUPS = 21

ARXIV_API = "https://export.arxiv.org/api/query"
ARXIV_SRC = "https://export.arxiv.org/e-print/"
ARXIV_PDF = "https://export.arxiv.org/pdf/"
INSPIRE = "https://inspirehep.net/api/arxiv/"
HEPDATA = "https://www.hepdata.net/record/ins%s?format=json"
HEPDATA_SEARCH = "https://www.hepdata.net/search/?q=%s&format=json"
ANTHROPIC = "https://api.anthropic.com/v1/messages"
AI_MODEL = os.environ.get("LIMITS_MODEL", "claude-sonnet-5-5")
UA = {"User-Agent": "ucr-darkmatter-limits/1.0"}
NS = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}

# Plot types.  x is always a mass stored in GeV; y is cm^2 unless y_unit is "".
CHANNELS = {
    "SI":        {"name": "Spin-independent DM-nucleon", "x": "Dark matter mass", "y": "SI DM-nucleon cross-section", "y_unit": "cm2"},
    "SD-p":      {"name": "Spin-dependent DM-proton", "x": "Dark matter mass", "y": "SD DM-proton cross-section", "y_unit": "cm2"},
    "SD-n":      {"name": "Spin-dependent DM-neutron", "x": "Dark matter mass", "y": "SD DM-neutron cross-section", "y_unit": "cm2"},
    "DMe-heavy": {"name": "DM-electron, heavy mediator", "x": "Dark matter mass", "y": "DM-electron cross-section (F=1)", "y_unit": "cm2"},
    "DMe-light": {"name": "DM-electron, light mediator", "x": "Dark matter mass", "y": "DM-electron cross-section (F∝1/q²)", "y_unit": "cm2"},
    "dark-photon": {"name": "Dark photon absorption", "x": "Dark photon mass", "y": "Kinetic mixing ε", "y_unit": ""},
    "ALP":       {"name": "Axion-like particle absorption", "x": "ALP mass", "y": "Axion-electron coupling g_ae", "y_unit": ""},
    "UHDM-A4":   {"name": "Ultra-heavy DM-nucleon (A⁴ scaling)", "x": "Dark matter mass",
                  "y": "DM-nucleon cross-section (A⁴ scaling)", "y_unit": "cm2"},
    "UHDM-A":    {"name": "Ultra-heavy DM-nucleus (A-independent)", "x": "Dark matter mass",
                  "y": "DM-nucleus cross-section (A-independent)", "y_unit": "cm2"},
    "other":     {"name": "Other", "x": "Mass", "y": "Limit", "y_unit": ""},
}

# Collaborations to watch: (experiment name shown in the UI, words searched in title/abstract).
COLLABS = [
    ("XENON", ["XENONnT", "XENON1T", "XENON100"]), ("LZ", ["LUX-ZEPLIN", "LZ experiment"]), ("LUX", ["LUX"]),
    ("PandaX", ["PandaX"]), ("DarkSide", ["DarkSide"]), ("DEAP-3600", ["DEAP-3600"]),
    ("SuperCDMS", ["SuperCDMS", "CDMSlite"]), ("CRESST", ["CRESST"]), ("EDELWEISS", ["EDELWEISS"]),
    ("DAMIC", ["DAMIC"]), ("SENSEI", ["SENSEI"]), ("PICO", ["PICO-60", "PICO-40L", "PICO-2L"]),
    ("COSINE", ["COSINE-100"]), ("CDEX", ["CDEX"]), ("NEWS-G", ["NEWS-G"]), ("XMASS", ["XMASS"]),
    ("TESSERACT", ["TESSERACT"]), ("COSINUS", ["COSINUS"]), ("ANAIS", ["ANAIS-112"]),
    ("Oscura", ["Oscura"]), ("SBC", ["Scintillating Bubble Chamber"]), ("KIMS", ["KIMS"]),
]
# Planned experiments, watched for projected sensitivities and discovery contours.
COLLABS += [
    ("XLZD", ["XLZD"]), ("DARWIN", ["DARWIN"]), ("DarkSide-20k", ["DarkSide-20k"]), ("ARGO", ["ARGO"]),
    ("Global Argon DM", ["Global Argon Dark Matter Collaboration"]), ("PandaX-xT", ["PandaX-xT"]),
    ("DAMIC-M", ["DAMIC-M"]), ("PICO-500", ["PICO-500"]), ("CYGNUS", ["CYGNUS"]), ("SABRE", ["SABRE"]),
    ("HeRALD", ["HeRALD"]), ("SPICE", ["SPICE"]), ("DarkSide-LowMass", ["DarkSide-LowMass"]),
]
# Theory models whose predicted regions are worth overlaying: (name shown in the UI, search phrases).
MODELS = [
    # (name shown in the UI, phrases searched on arXiv, what the paper's TITLE must mention)
    ("Supersymmetry (global fits)", ["pMSSM", "CMSSM", "MSSM global fit", "GAMBIT", "MasterCode"],
     r"MSSM|neutralino|GAMBIT|MasterCode|supersymmetr"),
    ("Higgsino / wino", ["Higgsino dark matter", "wino dark matter", "minimal dark matter"],
     r"higgsino|\bwino\b|minimal dark matter"),
    ("Higgs portal", ["Higgs portal dark matter", "singlet scalar dark matter"], r"higgs[- ]portal|singlet scalar|scalar singlet"),
    ("Inert doublet", ["inert doublet"], r"inert doublet"),
    ("Thermal relic targets", ["thermal relic target", "freeze-out target", "thermal target"], r"thermal (relic|target)|freeze-?out"),
    ("Freeze-in", ["freeze-in dark matter"], r"freeze-?in"),
    ("Asymmetric dark matter", ["asymmetric dark matter"], r"asymmetric dark matter"),
    ("SIMP / ELDER", ["strongly interacting massive particle", "ELDER dark matter"], r"\bSIMPs?\b|\bELDERs?\b|strongly interacting massive"),
    ("Dark photon mediator", ["dark photon mediator", "kinetically mixed dark photon"], r"dark photon|kinetic(ally)?[- ]mix"),
    ("Neutrino fog", ["neutrino fog", "neutrino floor"], r"neutrino (fog|floor)"),
]
KINDS = ("limit", "projection", "discovery", "model")
PROJ_RE = re.compile(r"project(ed|ion)|sensitivity (of|to|study|projection|reach)|discovery potential|"
                     r"physics reach|prospects|design report|will (be able|reach|probe)|future", re.I)
RESULT_RE = re.compile(r"we report|no (significant |statistically significant )?(excess|evidence|signal)|"
                       r"search results|first results|live[- ]days|were observed|exposure of|data (taken|collected|acquired)", re.I)
# A paper must look like it reports a curve, judged mostly by its title: this keeps out detector,
# calibration and analysis-technique papers that merely mention limits or future sensitivity.
TITLE_RE = re.compile(r"search|limits?\b|constraints?|results?\b|exclu|sensitivity|prospects|projected|discovery|"
                      r"reach\b|first .*(data|run)|bounds?\b", re.I)
CURVE_RE = re.compile(r"cross[- ]sections?|coupling|kinetic mixing|parameter space|exclu\w+|wimp[- ]nucleon", re.I)
OFF_TOPIC_RE = re.compile(r"\bLHC\b|collider|displaced|indirect detection|gamma[- ]ray|gravitational[- ]wave|"
                          r"neutrino mass|cosmic[- ]ray|\bCMB\b|neutron stars?|white dwarf|paleo-?detector|"
                          r"formalism|state of the art|review|Super-Kamiokande|Fermi-LAT|boosted", re.I)
# Collaboration papers that are not dark matter curves: other physics, and analysis-method papers.
NOT_DM_TITLE_RE = re.compile(r"double[- ]beta|neutrinoless|0\s?ν\s?ββ|background model|modell?ing and|"
                             r"statistical inference|calibration|simulation", re.I)
MIN_COLLAB_AUTHORS = 20     # a paper without "Collaboration" in its author list needs this many authors
MODEL_RE = re.compile(r"predict\w*|benchmark|favou?red|preferred|viable|allowed (region|parameter)|"
                      r"global fit|target|parameter space|relic (density|abundance)", re.I)
LIMIT_RE = re.compile(r"\b(upper limits?|limits? (?:on|are|is)|exclu\w+|constrain\w*|90\s?% C\.?L|"
                      r"confidence level|new limits?|world-leading|most stringent|strongest)\b", re.I)
MASS_UNITS = {"ev": 1e-9, "kev": 1e-6, "mev": 1e-3, "gev": 1.0, "tev": 1e3, "pev": 1e6, "eev": 1e9,
              "g": 5.60959e23, "kg": 5.60959e26}       # grams appear on ultra-heavy plots (1 g = 5.61e23 GeV/c²)
UHDM = ("UHDM-A4", "UHDM-A")
UHDM_RE = re.compile(r"ultra-?\s?heavy|super-?\s?heavy|planck[- ](scale|mass)|multi(ple)?[- ]?scatter|\buhdm\b|"
                     r"a\s?\^?\s?\{?4\}?\s*scal|a⁴|a-independent|σ\s?_?\{?χ\s?a\b|sigma\s?_?\{?\\?chi\s?a\b|per[- ]nucleus")
UHDM_NUCLEUS_RE = re.compile(r"a-independent|per[- ]nucleus|(dm|dark matter|χ)[- ]nucleus cross|σ\s?_?\{?χ\s?a\b|"
                             r"sigma\s?_?\{?\\?chi\s?a\b|nuclear cross[- ]section")
UHDM_A4_RE = re.compile(r"a\s?\^?\s?\{?4\}?\s*scal|a⁴|nucleon|σ\s?_?\{?χ\s?n\b|sigma\s?_?\{?\\?chi\s?n\b")
XS_UNITS = {"cm2": 1.0, "cm^2": 1.0, "cm²": 1.0, "b": 1e-24, "mb": 1e-27, "pb": 1e-36, "fb": 1e-39,
            "ab": 1e-42, "zb": 1e-45, "yb": 1e-48}


def now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def log(msg):
    print(msg, file=sys.stderr, flush=True)


BROWSER_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0 Safari/537.36 ucr-darkmatter-limits/1.0")


def http_get(url, tries=3, timeout=120, headers=None):
    """GET with retries.  Errors name the host, so a log line says which service refused."""
    host = urllib.parse.urlsplit(url).netloc
    hdrs = dict(UA, Accept="application/json, application/atom+xml, */*", **(headers or {}))
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=hdrs), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as err:
            if err.code == 403 and hdrs["User-Agent"] != BROWSER_UA:
                hdrs["User-Agent"] = BROWSER_UA            # some services refuse script-like clients
                continue
            if err.code in (403, 404) or attempt == tries - 1:
                raise RuntimeError("%s answered HTTP %s" % (host, err.code)) from None
            time.sleep(8 * (attempt + 1))
        except Exception as err:
            if attempt == tries - 1:
                raise RuntimeError("%s: %s" % (host, err)) from None
            time.sleep(8 * (attempt + 1))
    raise RuntimeError("%s refused the request (HTTP 403)" % host)


# ------------------------------------------------------------------ database
def connect(path=DB_PATH):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript("""
    CREATE TABLE IF NOT EXISTS papers (
        arxiv_id TEXT PRIMARY KEY, title TEXT, abstract TEXT, authors TEXT, n_authors INTEGER,
        published TEXT, experiment TEXT, journal_ref TEXT, doi TEXT,
        status TEXT DEFAULT 'candidate',      -- candidate | skipped | ignored
        kind TEXT DEFAULT 'result',           -- result | projection | model
        extracted TEXT DEFAULT '',            -- when the extractors last ran ('' = not yet)
        log TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS curves (
        id INTEGER PRIMARY KEY AUTOINCREMENT, arxiv_id TEXT, label TEXT, experiment TEXT,
        channel TEXT, year INTEGER, limit_type TEXT DEFAULT '', points TEXT,
        kind TEXT DEFAULT 'limit',            -- limit | projection | discovery | model
        shape TEXT DEFAULT 'line',            -- line (sorted by mass) | region (closed outline) | path (open, drawing order)
        sigma INTEGER,                        -- 3 or 5 for discovery contours
        own INTEGER DEFAULT 0,                -- 1 = judged to be this paper's own main result
        source TEXT,                          -- hepdata | ancillary | ai | manual | demo
        source_url TEXT DEFAULT '', status TEXT DEFAULT 'pending',   -- auto | approved | pending | rejected
        notes TEXT DEFAULT '', created TEXT, updated TEXT);
    CREATE INDEX IF NOT EXISTS curves_paper ON curves(arxiv_id);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);   -- local bookkeeping, not in the text copy
    """)
    # databases made by an earlier version: add the newer columns
    have = lambda table: {r[1] for r in db.execute("PRAGMA table_info(%s)" % table)}
    for table, col, decl in (("papers", "kind", "TEXT DEFAULT 'result'"), ("curves", "kind", "TEXT DEFAULT 'limit'"),
                             ("curves", "shape", "TEXT DEFAULT 'line'"), ("curves", "sigma", "INTEGER"),
                             ("curves", "own", "INTEGER DEFAULT 0")):
        if col not in have(table):
            db.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, col, decl))
    db.commit()
    return db


def add_curve(db, arxiv_id, label, experiment, channel, points, source, status,
              limit_type="", source_url="", notes="", year=None, kind="limit", shape="line", sigma=None, own=0):
    points = [(float(x), float(y)) for x, y in points
              if x > 0 and y > 0 and math.isfinite(float(x)) and math.isfinite(float(y))]
    if shape in ("region", "path"):                # an outline or a boundary that turns back: keep the drawing order
        points = [p for i, p in enumerate(points) if i == 0 or p != points[i - 1]]
    else:
        shape, points = "line", sorted(set(points))
    if len(points) < 3:
        return None
    if channel not in CHANNELS:
        channel = "other"
    if kind not in KINDS:
        kind = "limit"
    if year is None:
        row = db.execute("SELECT published FROM papers WHERE arxiv_id=?", (arxiv_id,)).fetchone()
        year = int(row["published"][:4]) if row and row["published"] else None
    stamp = now()
    cur = db.execute(
        "INSERT INTO curves (arxiv_id,label,experiment,channel,year,limit_type,points,source,source_url,"
        "status,notes,created,updated,kind,shape,sigma,own) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (arxiv_id, clean(label)[:120], experiment, channel, year, clean(limit_type)[:80],
         json.dumps(points), source, source_url, status, clean(notes)[:400], stamp, stamp, kind, shape,
         sigma if sigma in (3, 5) else None, 1 if own else 0))
    db.commit()
    return cur.lastrowid


def guess_kind(text, paper_kind="result"):
    """(kind, sigma) for a curve, from its label/header text and the kind of paper it is in."""
    if paper_kind == "model":
        return "model", None
    m = re.search(r"([35])\s?(?:σ|sigma|-sigma)", text, re.I)
    if m or re.search(r"discovery|evidence contour", text, re.I):
        return "discovery", int(m.group(1)) if m else None
    if paper_kind == "projection" or re.search(r"proj(ect\w*)?\b|sensitivity|future|\bgoal\b", text, re.I):
        return "projection", None
    return "limit", None


def report_export(db, force=False):
    try:
        log("Exported %d curves" % export(db, force=force))
    except ExportRefused as err:
        log("WARNING: not exported: %s" % err)


def stored_points(text):
    """A curve's points as saved, without any value a browser cannot read (infinity, not-a-number)."""
    try:
        pts = json.loads(text, parse_constant=lambda name: None)
    except ValueError:
        return []
    return [p for p in pts if isinstance(p, list) and len(p) == 2 and all(
        isinstance(v, (int, float)) and math.isfinite(v) for v in p)]


# ------------------------------------------------------------------ text copy of the database (for git)
def _sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def write_dump(db, path=None):
    """Write the database as SQL text (tools/limits.sql).  It changes line by line as curves are
    added or edited, so git can show and merge the changes.  limits.db itself stays out of git."""
    path = path or DUMP_PATH
    lines = [line for line in db.iterdump()
             if not re.match(r'(CREATE TABLE IF NOT EXISTS |CREATE TABLE |INSERT INTO )"?meta"?[ (]', line)]
    text = "\n".join(lines) + "\n"
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)
    db.execute("INSERT OR REPLACE INTO meta VALUES ('dump_sha', ?)", (_sha(path),))
    db.commit()


def _has_real_curves(db_path):
    try:
        con = sqlite3.connect(db_path)
        n = con.execute("SELECT COUNT(*) FROM curves WHERE source!='demo'").fetchone()[0]
        con.close()
        return n > 0
    except sqlite3.Error:
        return False


def sync_from_dump(db_path, dump_path):
    """If the text copy changed since this database last wrote or read it (e.g. after `git pull`),
    rebuild the database from it.  The old database is backed up first."""
    if not os.path.exists(dump_path):
        return False
    current = _sha(dump_path)
    if os.path.exists(db_path) and os.path.getsize(db_path):
        try:
            con = sqlite3.connect(db_path)
            row = con.execute("SELECT value FROM meta WHERE key='dump_sha'").fetchone()
            con.close()
        except sqlite3.Error:
            row = None
        if row and row[0] == current:
            return False                                   # already in step
        if not row and _has_real_curves(db_path):
            # a database from before the switch to git: it is the real data, so adopt it instead of overwriting it
            con = connect(db_path)
            write_dump(con, dump_path)
            con.close()
            log("Adopted the existing database and wrote it to %s; run publish to send it to GitHub." % os.path.basename(dump_path))
            return False
        backup_db(db_path)
    tmp = db_path + ".rebuild"
    if os.path.exists(tmp):
        os.remove(tmp)
    con = sqlite3.connect(tmp)
    with open(dump_path, encoding="utf-8") as f:
        con.executescript(f.read())
    con.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    con.execute("INSERT OR REPLACE INTO meta VALUES ('dump_sha', ?)", (current,))
    con.commit()
    con.close()
    os.replace(tmp, db_path)
    log("Loaded the database from %s (it changed since this copy last used it)." % os.path.basename(dump_path))
    return True


def in_git():
    return bool(shutil.which("git")) and os.path.isdir(os.path.join(SITE, ".git"))


def git(*args):
    return subprocess.run(["git", "-C", SITE] + list(args), capture_output=True, text=True)


def _prune(prefix, suffix):
    files = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith(prefix) and f.endswith(suffix))
    for f in files[:-KEEP_BACKUPS]:
        os.remove(os.path.join(BACKUP_DIR, f))


def backup_db(db_path):
    """Once a day, copy the database to tools/backups/ before anything changes it."""
    if not os.path.exists(db_path) or os.path.getsize(db_path) == 0:
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    dst = os.path.join(BACKUP_DIR, "limits-%s.db" % dt.date.today().isoformat())
    if not os.path.exists(dst):
        src, out = sqlite3.connect(db_path), sqlite3.connect(dst)
        src.backup(out)                                   # a consistent copy, even while serve is running
        out.close()
        src.close()
    _prune("limits-", ".db")


def published_count(path=EXPORT_PATH):
    """(number of curves, is it demo data) in the published file, or (0, True) if there is none."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return len(data.get("curves", [])), bool(data.get("demo"))
    except Exception:
        return 0, True


class ExportRefused(Exception):
    pass


def export(db, path=EXPORT_PATH, force=False):
    write_dump(db)                                        # keep the text copy in step with every change
    curves = []
    for r in db.execute("SELECT * FROM curves WHERE status!='rejected' ORDER BY year DESC, experiment, id"):
        c = dict(r)
        c["points"] = stored_points(c["points"])
        c.pop("created", None)
        if len(c["points"]) >= 2:
            curves.append(c)
    queue = [dict(r) for r in db.execute(
        "SELECT arxiv_id,title,experiment,published,kind FROM papers p WHERE status='candidate' AND extracted!='' "
        "AND NOT EXISTS (SELECT 1 FROM curves c WHERE c.arxiv_id=p.arxiv_id AND c.status!='rejected') "
        "ORDER BY published DESC")]
    payload = {"generated": now(), "channels": CHANNELS, "curves": curves, "awaiting_curves": queue,
               "demo": any(c["source"] == "demo" for c in curves)}
    old, old_demo = published_count(path)
    if not force and old and not old_demo and len(curves) < 0.5 * old:
        # never let a missing or damaged database blank the public page
        raise ExportRefused("the database has %d curves but the published file has %d, so the file was left as it is. "
                            "If this drop is intended (e.g. you rejected many curves), run: python3 tools/limits.py export --force"
                            % (len(curves), old))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:                                                  # nothing but the timestamp would change: leave the file alone
        with open(path, encoding="utf-8") as f:
            prev = json.load(f)
        prev.pop("generated", None)
        if prev == json.loads(json.dumps(dict(payload, generated=None), allow_nan=False)) or \
                prev == json.loads(json.dumps({k: v for k, v in payload.items() if k != "generated"}, allow_nan=False)):
            return len(curves)
    except (OSError, ValueError):
        pass
    if old and not old_demo:                              # keep a daily copy of the published file too
        os.makedirs(BACKUP_DIR, exist_ok=True)
        keep = os.path.join(BACKUP_DIR, "limits-%s.json" % dt.date.today().isoformat())
        if not os.path.exists(keep):
            shutil.copyfile(path, keep)
        _prune("limits-", ".json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)
    return len(curves)


# ------------------------------------------------------------------ units and guesses
def guess_channel(text, default="SI"):
    t = text.lower().replace("_", " ")
    if UHDM_RE.search(t):                          # ultra-heavy: per-nucleus (A-independent) or per-nucleon (A^4)
        return "UHDM-A" if UHDM_NUCLEUS_RE.search(t) and not UHDM_A4_RE.search(t) else "UHDM-A4"
    if re.search(r"dark[- ]photon|kinetic mixing|hidden photon", t):
        return "dark-photon"
    if re.search(r"axion|\balp\b|g_?\{?ae", t):
        return "ALP"
    if re.search(r"electron (scatter|recoil|coupl|cross)|dm-?e\b|dark matter-electron|-electron scattering|sigma_?\{?e\b|σ.?_?\{?e\b", t):
        return "DMe-light" if re.search(r"light mediator|1/q|ultra-?light|massless", t) else "DMe-heavy"
    if re.search(r"spin[- ]dependent|(?<![a-z])sd(?![a-z])|sdp|sdn|sd[- ]?(p|n)\b", t):
        if re.search(r"spin[- ]independent", t):
            return default                         # mentions both: not decidable from this text
        return "SD-n" if re.search(r"neutron|sd[- ]?n\b|sdn", t) and not re.search(r"proton|sd[- ]?p\b|sdp", t) else "SD-p"
    if re.search(r"spin[- ]independent|(?<![a-z])si(?![a-z])", t):
        return "SI"
    return default


def unit_factor(hint, table):
    """Factor for the unit named in a header such as 'Mass [GeV/c^2]' or 'sigma (zb)'."""
    h = (hint or "").lower().replace("/c^2", "").replace("/c2", "").replace("/c²", "")
    for name in sorted(table, key=len, reverse=True):
        if re.search(r"(?<![a-z])%s(?![a-z])" % re.escape(name), h):
            return table[name]
    return None


def to_canonical(xs, ys, x_hint, y_hint, channel):
    """Convert to GeV and cm^2.  Returns (points, confident, note)."""
    fx = unit_factor(x_hint, MASS_UNITS)
    note, confident = [], True
    if fx is None:
        fx, confident = 1.0, False
        note.append("mass unit assumed GeV")
    fy = 1.0
    if CHANNELS.get(channel, {}).get("y_unit") == "cm2":
        fy = unit_factor(y_hint, XS_UNITS)
        if fy is None:
            top = max(ys)
            if top < (1e-12 if channel in UHDM else 1e-24):
                fy = 1.0                       # only cm^2 gives numbers this small
                note.append("cross-section unit inferred as cm^2 from magnitude")
            else:
                fy, confident = 1.0, False
                note.append("cross-section unit unknown, check before approving")
    return [(x * fx, y * fy) for x, y in zip(xs, ys)], confident, "; ".join(note)


def parse_columns(text):
    """Read a two-or-more column numeric text file.  Returns (header, rows)."""
    header, rows = "", []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        parts = [p for p in re.split(r"[,\s;|]+", s.lstrip("#%").strip()) if p]
        try:
            nums = [float(p) for p in parts]
        except ValueError:
            if not rows:
                header = s
            continue
        if len(nums) >= 2:
            rows.append(nums)
    return header, rows


# ------------------------------------------------------------------ arXiv scraping
def parse_feed(xml_bytes):
    out = []
    for e in ET.fromstring(xml_bytes).findall("a:entry", NS):
        names = [clean(a.findtext("a:name", default="", namespaces=NS)) for a in e.findall("a:author", NS)]
        out.append({
            "arxiv_id": re.sub(r"v\d+$", "", clean(e.findtext("a:id", default="", namespaces=NS)).split("/abs/")[-1]),
            "title": clean(e.findtext("a:title", default="", namespaces=NS)),
            "abstract": clean(e.findtext("a:summary", default="", namespaces=NS)),
            "authors": ", ".join(names[:5]), "n_authors": len(names),
            "collab_author": any("collaboration" in n.lower() for n in names),
            "published": clean(e.findtext("a:published", default="", namespaces=NS))[:10],
            "journal_ref": clean(e.findtext("x:journal_ref", default="", namespaces=NS)),
            "doi": clean(e.findtext("x:doi", default="", namespaces=NS)),
            "comment": clean(e.findtext("x:comment", default="", namespaces=NS)),
        })
    return out


def classify(p, terms):
    """'result', 'projection' or None for a paper that names a collaboration.
    Only papers written by the collaboration count, not recasts of its data by others."""
    text = p["title"] + " " + p["abstract"]
    named = any(re.search(r"(?<![A-Za-z])%s(?![A-Za-z])" % re.escape(t), text) for t in terms)
    by_collab = p["collab_author"] or p["n_authors"] >= MIN_COLLAB_AUTHORS or "collaboration" in p.get("comment", "").lower()
    if not (named and by_collab and re.search(r"dark matter|wimp", text, re.I)):
        return None
    if not (TITLE_RE.search(p["title"]) and CURVE_RE.search(text)) or NOT_DM_TITLE_RE.search(p["title"]):
        return None
    if re.search(r"sensitivity|projected|prospects|discovery potential|physics reach", p["title"], re.I):
        return "projection"                            # the title says so, whatever the abstract mentions
    reports = re.search(r"search (for|with|results)|limits?\b|constraints?|results?\b", p["title"], re.I)
    if PROJ_RE.search(text) and not RESULT_RE.search(text) and not reports:
        return "projection"
    return "result" if LIMIT_RE.search(text) else None


def is_candidate(p, terms):
    return classify(p, terms) == "result"


def classify_model(p, terms, title_re):
    """'model' for a theory paper that predicts where dark matter should show up in direct detection.
    The model must be the subject of the paper (named in the title), not just mentioned in passing."""
    text = p["title"] + " " + p["abstract"]
    if not re.search(title_re, p["title"], re.I) or OFF_TOPIC_RE.search(p["title"]):
        return None
    return "model" if (p["n_authors"] <= 12 and MODEL_RE.search(text)
                       and re.search(r"direct detection", text, re.I)
                       and re.search(r"cross[- ]sections?|scattering rate|recoil", text, re.I)) else None


def reclassify(db):
    """Re-apply the paper filter to papers the extractors have not processed yet, so a change to
    the rules above takes effect on papers that are already in the database."""
    terms = dict(COLLABS)
    models = {name: (words, title_re) for name, words, title_re in MODELS}
    changed = 0
    for r in db.execute("SELECT * FROM papers WHERE extracted='' AND status IN ('candidate','skipped')").fetchall():
        p = {"title": r["title"], "abstract": r["abstract"], "n_authors": r["n_authors"] or 0, "comment": "",
             "collab_author": "collaboration" in (r["authors"] or "").lower()}
        kind = classify_model(p, *models[r["experiment"]]) if r["experiment"] in models else \
            classify(p, terms.get(r["experiment"], [r["experiment"]]))
        status = "candidate" if kind else "skipped"
        if status != r["status"] or (kind and kind != r["kind"]):
            db.execute("UPDATE papers SET status=?, kind=? WHERE arxiv_id=?", (status, kind or r["kind"], r["arxiv_id"]))
            changed += 1
    db.commit()
    return changed


def scrape(db, since, pause=3.5, max_pages=20, model_pages=2):
    added = 0
    jobs = [(name, terms, classify, '(%s) AND (abs:"dark matter" OR abs:WIMP)', max_pages) for name, terms in COLLABS]
    jobs += [(name, terms, (lambda p, t, rx=title_re: classify_model(p, t, rx)),
              '(%s) AND abs:"dark matter" AND abs:"direct detection"', model_pages) for name, terms, title_re in MODELS]
    for experiment, terms, judge, template, pages in jobs:
        names = " OR ".join('ti:"%s" OR abs:"%s"' % (t, t) for t in terms)
        for page in range(pages):
            params = urllib.parse.urlencode({"search_query": template % names, "sortBy": "submittedDate",
                                             "sortOrder": "descending", "start": page * 50, "max_results": 50})
            try:
                batch = parse_feed(http_get(ARXIV_API + "?" + params))
            except Exception as err:
                log("  arXiv: %s skipped (%s)" % (experiment, err))
                break
            time.sleep(pause)
            fresh = 0
            for p in batch:
                if p["published"][:4] < str(since):
                    continue
                if db.execute("SELECT 1 FROM papers WHERE arxiv_id=?", (p["arxiv_id"],)).fetchone():
                    continue
                kind = judge(p, terms)
                db.execute("INSERT INTO papers (arxiv_id,title,abstract,authors,n_authors,published,experiment,"
                           "journal_ref,doi,status,kind) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                           (p["arxiv_id"], p["title"], p["abstract"], p["authors"], p["n_authors"], p["published"],
                            experiment, p["journal_ref"], p["doi"], "candidate" if kind else "skipped", kind or "result"))
                fresh += 1
                added += bool(kind)
            db.commit()
            # stop paging once a page brings nothing new, or we are past the start year
            if not fresh or len(batch) < 50 or batch[-1]["published"][:4] < str(since):
                break
    return added


# ------------------------------------------------------------------ extractor 1: HEPData
def hepdata_tables(record):
    """Yield (name, description, json_url) for each table of a HEPData record reply."""
    for t in record.get("data_tables", []) or []:
        url = (t.get("data") or {}).get("json")
        if url:
            yield t.get("name", ""), t.get("description", ""), url


def hepdata_curves(table, context):
    """Turn one HEPData table (JSON format) into curves: [(label, channel, pts, confident, note)]."""
    headers = [h.get("name", "") for h in table.get("headers", [])]
    values = table.get("values", [])
    if not values or not values[0].get("x") or not values[0].get("y"):
        return []
    n_x = len(values[0]["x"])
    if n_x != 1:
        return []                                  # 2-D tables are not exclusion curves
    out = []
    for j in range(len(values[0]["y"])):
        y_head = headers[n_x + j] if len(headers) > n_x + j else ""
        text = " ".join([context, table.get("name", ""), table.get("description", ""), y_head])
        # judge the column by its own header; fall back to the table's text only if it has none
        if not re.search(r"limit|exclu|cross|sigma|σ|coupling|mixing|sensitiv", y_head or text, re.I):
            continue
        xs, ys = [], []
        for row in values:
            try:
                x = row["x"][0]
                xv = float(x["value"]) if "value" in x else (float(x["low"]) * float(x["high"])) ** 0.5
                yv = float(row["y"][j]["value"])
            except (KeyError, ValueError, TypeError, IndexError):
                continue
            if xv > 0 and yv > 0:
                xs.append(xv)
                ys.append(yv)
        if len(xs) < 3:
            continue
        channel = guess_channel(text)
        pts, confident, note = to_canonical(xs, ys, headers[0] if headers else "", y_head, channel)
        out.append((clean(y_head or table.get("name", "")), channel, pts, confident, note))
    return out


HEPDATA_BLOCKED = False     # set once HEPData turns a request away; the rest of the run skips it


class Blocked(Exception):
    pass


def hepdata_get(url):
    """HEPData sits behind a bot check that refuses scripts (HTTP 403).  Ask once; if refused,
    stop asking for the rest of this run and let the other extractors carry on."""
    global HEPDATA_BLOCKED
    if HEPDATA_BLOCKED:
        raise Blocked()
    try:
        return http_get(url, tries=2, timeout=60)
    except RuntimeError as err:
        if "403" in str(err):
            HEPDATA_BLOCKED = True
            log("  HEPData is refusing automated requests (bot check); skipping it for this run")
            raise Blocked() from None
        raise


def hepdata_record(arxiv_id):
    """The HEPData record for an arXiv paper, or None if the paper has none.
    The INSPIRE number is looked up at INSPIRE; if INSPIRE refuses, HEPData's own search is tried."""
    recid, problems = None, []
    try:
        rec = json.loads(http_get(INSPIRE + arxiv_id + "?fields=control_number", tries=2, timeout=60))
        recid = (rec.get("metadata") or {}).get("control_number")
    except RuntimeError as err:
        if "HTTP 404" in str(err):
            return None, None                          # INSPIRE does not know the paper yet
        problems.append(str(err))
    if not recid:
        try:
            found = json.loads(hepdata_get(HEPDATA_SEARCH % urllib.parse.quote("arxiv:" + arxiv_id)))
            for hit in found.get("results", []) or []:
                if arxiv_id in str(hit.get("arxiv_id", "")):
                    recid = hit.get("inspire_id")
        except RuntimeError as err:
            problems.append(str(err))
    if not recid:
        if problems:
            raise RuntimeError("; ".join(problems))
        return None, None
    try:
        return recid, json.loads(hepdata_get(HEPDATA % recid))
    except RuntimeError as err:
        if "HTTP 404" in str(err):
            return recid, None                         # known to INSPIRE, no HEPData entry
        raise


def extract_hepdata(db, paper):
    recid, record = hepdata_record(paper["arxiv_id"])
    if not record:
        return 0
    made = 0
    for name, desc, url in hepdata_tables(record):
        if not re.search(r"limit|exclu|cross|sigma|sensitiv|coupling|mixing", name + " " + desc, re.I):
            continue
        table = json.loads(hepdata_get(url))
        table.setdefault("name", name)
        table.setdefault("description", desc)
        for label, channel, pts, confident, note in hepdata_curves(table, paper["title"]):
            kind, sigma = guess_kind(name + " " + desc + " " + label, paper["kind"])
            made += bool(add_curve(db, paper["arxiv_id"], "%s: %s" % (name, label), paper["experiment"], channel, pts,
                                   "hepdata", "auto" if confident else "pending", kind=kind, sigma=sigma,
                                   source_url="https://www.hepdata.net/record/ins%s" % recid, notes=note))
        time.sleep(0.5)
    return made


def check_services():
    """Try each outside service once with a paper known to have data, and say what happened."""
    arxiv_id = "2207.03764"                            # LZ first results
    tests = [
        ("arXiv search", ARXIV_API + "?search_query=id:" + arxiv_id + "&max_results=1", lambda b: b"<entry>" in b),
        ("arXiv source package", ARXIV_SRC + arxiv_id, lambda b: len(b) > 1000),
        ("arXiv PDF", ARXIV_PDF + arxiv_id, lambda b: b[:4] == b"%PDF"),
        ("INSPIRE lookup", INSPIRE + arxiv_id + "?fields=control_number", lambda b: b"control_number" in b),
        ("HEPData search", HEPDATA_SEARCH % urllib.parse.quote("arxiv:" + arxiv_id), lambda b: b"results" in b),
    ]
    recid = None
    for name, url, good in tests:
        try:
            body = http_get(url, tries=1, timeout=60)
            print("%-22s %s" % (name, "ok" if good(body) else "answered, but not in the expected form: %r" % body[:120]))
            if name == "INSPIRE lookup":
                recid = (json.loads(body).get("metadata") or {}).get("control_number")
        except Exception as err:
            print("%-22s FAILED: %s" % (name, err))
        time.sleep(3)
    if recid:
        try:
            record = json.loads(http_get(HEPDATA % recid, tries=1, timeout=60))
            tables = list(hepdata_tables(record))
            print("%-22s ok, %d tables%s" % ("HEPData record", len(tables), ": " + ", ".join(t[0] for t in tables[:4]) if tables else
                                             "  (keys: %s)" % ", ".join(sorted(record)[:12])))
            if tables:
                table = json.loads(http_get(tables[0][2], tries=1, timeout=60))
                print("%-22s ok, keys: %s" % ("HEPData table", ", ".join(sorted(table)[:10])))
        except Exception as err:
            print("%-22s FAILED: %s" % ("HEPData record", err))
    import figures
    print("%-22s %s" % ("Figure reader", "ok (PyMuPDF found)" if figures.available() else "NOT AVAILABLE: run  python3 tools/figures.py --install"))
    print("%-22s %s" % ("EPS figures", "ok (Ghostscript found)" if shutil.which("gs") else
                        "skipped: Ghostscript (gs) not installed; PDF figures still work"))
    print("%-22s %s" % ("AI key", "set" if os.environ.get("ANTHROPIC_API_KEY") else "not set (AI figure reading is off)"))


# ------------------------------------------------------------------ extractor 2: arXiv ancillary files
DATA_NAME = re.compile(r"\.(csv|txt|dat|tsv)$", re.I)
CURVE_NAME = re.compile(r"limit|excl|sigma|curve|wimp|result|constraint|upper|si_|sd_|xsec|cross", re.I)


def ancillary_curves(tar_bytes, context):
    out = []
    try:
        tar = tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:*")
    except tarfile.TarError:
        return out                                 # single-file submissions are not archives
    for m in tar.getmembers():
        base = os.path.basename(m.name)
        in_anc = m.name.startswith("anc/") or "/anc/" in m.name
        if not m.isfile() or m.size > 2_000_000 or not DATA_NAME.search(base):
            continue
        if not (in_anc or CURVE_NAME.search(base)):
            continue
        try:
            text = tar.extractfile(m).read().decode("utf-8", "replace")
        except Exception:
            continue
        header, rows = parse_columns(text)
        if len(rows) < 5:
            continue
        xs, ys = [r[0] for r in rows], [r[1] for r in rows]
        if min(xs) <= 0 or min(ys) <= 0:
            continue
        # the file's own name and header say more than the paper's abstract does
        channel = guess_channel(base + " " + header, None) or guess_channel(context)
        cols = [c for c in re.split(r"[,\t;|]+|\s{2,}", header.lstrip("#% ")) if c.strip()]
        pts, confident, note = to_canonical(xs, ys, cols[0] if cols else header,
                                            (cols[1] if len(cols) > 1 else header) + " " + re.sub(r"[_.\-]", " ", base), channel)
        out.append((base, channel, pts, confident and in_anc, (note + "; " if note else "") + "from " + m.name))
    return out


def source_package(paper):
    """The paper's arXiv source package, downloaded once per paper and shared by the extractors."""
    if "_src" not in paper:
        paper["_src"] = http_get(ARXIV_SRC + paper["arxiv_id"], tries=2)
    return paper["_src"]


def extract_ancillary(db, paper):
    data = source_package(paper)
    made = 0
    for label, channel, pts, confident, note in ancillary_curves(data, paper["title"] + " " + paper["abstract"]):
        kind, sigma = guess_kind(label, paper["kind"])
        made += bool(add_curve(db, paper["arxiv_id"], "%s (%s)" % (paper["experiment"], label), paper["experiment"],
                               channel, pts, "ancillary", "auto" if confident and kind == "limit" else "pending",
                               kind=kind, sigma=sigma,
                               source_url="https://arxiv.org/abs/" + paper["arxiv_id"], notes=note))
    return made


# ------------------------------------------------------------------ extractor 3: vector figures
FIG_NAME = re.compile(r"\.(pdf|eps|ps)$", re.I)
MASS_AXIS = re.compile(r"(?<![a-z])(ev|kev|mev|gev|tev)(?![a-z])|mass|m_?\{?(χ|chi|dm|wimp)", re.I)
LIMIT_AXIS = re.compile(r"cm|(?<![a-z])(pb|fb|zb|ab|barn)(?![a-z])|σ|sigma|cross|coupling|mixing|ε|epsilon|g_?\{?a", re.I)
OWN_RESULT = re.compile(r"this (work|result|paper|analysis|search)|\bours?\b|observed|\bthis\b", re.I)
MAX_FIGURE_CURVES = 40
# Experiments that show up as comparison curves but are not in the watch list above.
OTHER_EXPERIMENTS = ["DAMA", "CoGeNT", "ZEPLIN", "PICASSO", "IceCube", "Super-Kamiokande", "Super-K", "SuperK", "ANTARES",
                     "CMS", "ATLAS", "LHC", "CDMS", "CDMSlite", "XENON10", "PICO", "COUPP", "SIMPLE", "DRIFT", "NEWAGE",
                     "Borexino", "Fermi", "HESS", "MAGIC", "PandaX-II", "PandaX-4T", "XENON1T", "XENONnT", "XENON100",
                     "DarkSide-50", "LUX", "SuperCDMS", "DAMIC-M", "EDELWEISS", "CRESST-II", "CRESST-III", "KIMS", "ANAIS",
                     "COSINE-100", "NEWS-G", "SENSEI", "DEAP-3600", "PICO-60", "PICO-40L", "protoSENSEI", "Hitomi", "MiniBooNE"]
REFERENCE_LINE = re.compile(r"neutrino\s*(fog|floor)|ν\s*[- ]?(fog|floor)|cevns|thermal relic|freeze-?(in|out)", re.I)
SECONDARY = re.compile(r"expected|median|sensitivity|unconstrained|[12]\s?σ|sigma band|±|band\b|uncert", re.I)


def named_experiments(label):
    """Names of experiments mentioned in a curve label, e.g. 'XENONnT (2023)' -> {'XENON'}."""
    found = set()

    def has(word):
        return re.search(r"(?<![A-Za-z])%s(?![A-Za-z])" % re.escape(word), label, re.I)
    for name, words in COLLABS:
        if any(has(w) for w in [name] + list(words)) or re.search(r"(?<![A-Za-z])%s[\w-]*" % re.escape(name), label, re.I):
            found.add(name)
    for word in OTHER_EXPERIMENTS:
        if has(word):
            found.add(next((name for name, _ in COLLABS if word.lower().startswith(name.lower())), word))
    if re.search(r"LUX[- ]ZEPLIN", label, re.I):
        found.discard("LUX")                               # LUX-ZEPLIN is LZ, not LUX or ZEPLIN
        found.discard("ZEPLIN")
        found.add("LZ")
    return found


def display_experiment(paper):
    """The experiment as the paper's title writes it: 'XENONnT', 'PandaX-4T', 'DEAP-3600', 'LZ'."""
    name = paper.get("experiment", "")
    if not name:
        return ""
    m = re.search(r"(?<![A-Za-z])%s[\w-]*" % re.escape(name), paper.get("title", ""))
    return m.group(0).rstrip("-") if m else name


def exposure(paper):
    """'4.2 t·yr' from '4.2 Tonne-Years of Exposure', if the title or abstract states one."""
    rx = r"(\d+(?:\.\d+)?)\s*[- ]?\$?(?:\\cdot)?\$?\s*(tonne|ton|kg|t|g)\$?\s*(?:\\cdot|[-·×x* ])?\$?\s*(years?|yrs?|y|days?|d)\b"
    for text in (paper.get("title", ""), paper.get("abstract", "")):
        m = re.search(rx, text, re.I)
        if m:
            mass = {"tonne": "t", "ton": "t"}.get(m.group(2).lower(), m.group(2).lower())
            time_unit = "yr" if m.group(3).lower().startswith("y") else "d"
            return "%s %s·%s" % (m.group(1), mass, time_unit)
    return ""


def triage(label, kind, shape, paper):
    """Decide what a figure curve is.  Returns (own, quoted_from):
    own          True if it is this paper's own main result (the thing worth keeping)
    quoted_from  a name if the curve is someone else's result or a reference line drawn for
                 comparison; such curves are rejected automatically (the review page can restore them)."""
    mine = paper.get("experiment", "")
    is_model_paper = paper.get("kind") == "model"
    if not label:
        return False, None
    names = named_experiments(label)
    years = [int(y) for y in re.findall(r"\b((?:19|20)\d\d)\b", label)]
    earlier = bool(years and paper.get("published") and max(years) < int(paper["published"][:4]))
    if is_model_paper:
        if names:
            return False, ", ".join(sorted(names))         # experiments' limits shown for comparison
        return (shape == "region" or kind == "model"), None
    if REFERENCE_LINE.search(label):
        return False, "reference line"
    if names and mine not in names:
        return False, ", ".join(sorted(names))
    if names and earlier:
        return False, "an earlier %s result" % mine
    if SECONDARY.search(label) and kind == "limit":
        return False, None                                 # the paper's own, but not its headline limit
    if names or OWN_RESULT.search(label) or re.search(r"upper limit|90\s?%|limit\b|discovery|projected|sensitivity", label, re.I):
        return True, None
    return False, None


def suggested_name(label, kind, sigma, paper):
    """A name that still makes sense outside the paper: 'LZ 2024 (4.2 t·yr)', '... 3σ discovery'."""
    if paper.get("kind") == "model":
        first = (paper.get("authors") or "").split(",")[0].strip().split(" ")[-1]
        tail = " ".join(x for x in (first, (paper.get("published") or "")[:4]) if x)
        return "%s (%s)" % (label, tail) if tail else label
    base = " ".join(x for x in (display_experiment(paper), (paper.get("published") or "")[:4]) if x)
    exp = exposure(paper)
    if exp:
        base += " (%s)" % exp
    if kind == "discovery":
        base += " %sσ discovery" % sigma if sigma else " discovery"
    elif kind == "projection":
        base += " projected"
    return base or label


def figure_candidates(paper, verbose=False):
    """Curves found in the vector figures of a paper's source package, as add_curve keyword sets.
    Only figures whose axes look like mass against a cross-section or coupling are used."""
    import figures
    if not figures.available():
        raise RuntimeError("PyMuPDF is not installed: run  python3 tools/figures.py --install")
    try:
        tar = tarfile.open(fileobj=io.BytesIO(source_package(paper)), mode="r:*")
    except tarfile.TarError:
        return [], ["source is not an archive (PDF-only or single-file submission)"]
    found, report, seen = [], [], set()
    context = paper.get("title", "") + " " + paper.get("abstract", "")
    for m in tar.getmembers():
        base = os.path.basename(m.name)
        if not m.isfile() or not FIG_NAME.search(base) or m.size > 8_000_000:
            continue
        try:
            curves, remark = figures.figure_curves(tar.extractfile(m).read(), base)
        except Exception as err:
            report.append("%s: failed (%s)" % (base, str(err)[:60]))
            continue
        kept = 0
        if curves:                                      # what the reader made of the axes, for checking
            c0 = curves[0]
            axes_seen = "x %s, labels %s; y %s, labels %s" % (
                "log" if c0["x_log"] else "linear", " ".join("%g" % v for v in c0["xvals"][:8]),
                "log" if c0["y_log"] else "linear", " ".join("%g" % v for v in c0["yvals"][:8]))
        for i, c in enumerate(curves):
            if not (MASS_AXIS.search(c["xtitle"]) and LIMIT_AXIS.search(c["ytitle"])):
                remark = remark or "axes are not mass against cross-section"
                continue
            xs, ys = [q[0] for q in c["points"]], [q[1] for q in c["points"]]
            if min(xs) <= 0 or min(ys) <= 0:
                continue
            channel = guess_channel(c["ytitle"] + " " + c["label"], None) or guess_channel(c["text"], None) or guess_channel(context)
            if channel in ("SI", "other") and min(xs) * (unit_factor(c["xtitle"], MASS_UNITS) or 1) > 1e5 and \
                    UHDM_RE.search((c["text"] + " " + context).lower()):
                channel = guess_channel(c["ytitle"] + " " + c["text"], None) if UHDM_RE.search(c["ytitle"].lower()) else "UHDM-A4"
                channel = channel if channel in UHDM else "UHDM-A4"
            pts, confident, unit_note = to_canonical(xs, ys, c["xtitle"], c["ytitle"], channel)
            ok = confident and c["misfit"] < 1.5 and min(c["n_ticks"]) >= 3
            top = 1e-5 if channel in UHDM else 1e-20      # ultra-heavy cross-sections reach far higher
            if CHANNELS[channel]["y_unit"] == "cm2" and not 1e-55 < min(q[1] for q in pts) < top:
                remark = remark or "values are not in the range of a cross-section; skipped"
                continue                                # better no curve than a wrong one
            style = "%s%s %s" % (c["colour"], " dashed" if c["dashed"] else "", "outline" if c["shape"] == "region" else "line")
            sig = (c["label"], len(xs), round(math.log10(xs[0]), 4), round(math.log10(ys[0]), 4), round(math.log10(ys[-1]), 4))
            if sig in seen:
                continue                                    # the same curve again in a supplementary copy of the figure
            seen.add(sig)
            kind, sigma = guess_kind(c["label"], paper.get("kind", "result"))
            shape = c["shape"]
            if channel in UHDM and shape == "line":
                # an excluded island drawn as one open line turns back in mass: keep its drawing order
                steps = [b[0] - a[0] for a, b in zip(c["points"], c["points"][1:]) if b[0] != a[0]]
                if steps and min(sum(1 for d in steps if d > 0), sum(1 for d in steps if d < 0)) > 0.1 * len(steps):
                    shape = "path"
            c["shape"] = shape
            if c["shape"] == "region" and kind == "limit" and channel not in UHDM:
                kind = "model"                              # a filled outline is a favoured region, not a limit line
            own, quoted = triage(c["label"], kind, c["shape"], paper)
            raw = c["label"] or "%s: %s" % (os.path.splitext(base)[0], style)
            label = suggested_name(c["label"], kind, sigma, paper) if own else raw
            notes = "%s%sExact path from %s%s (%s). %s%s" % (
                "Auto-rejected: quoted for comparison (%s). " % quoted if quoted else "",
                "Likely this paper's own result; figure label: “%s”. " % c["label"] if own else "",
                base, ", panel %d" % c["panel"] if c["panel"] else "", style,
                ("" if ok else "Axis reading uncertain: check the scale against the figure. ") +
                ("Minus signs of the axis exponents were unreadable and were inferred from the axis direction. " if c.get("sign_restored") else ""),
                unit_note)
            found.append((0 if own else 2 if quoted else 1,
                          dict(label=label, raw=raw, channel=channel, points=pts, kind=kind, sigma=sigma, shape=c["shape"],
                               notes=notes, own=own, status="rejected" if quoted else "pending")))
            kept += 1
        report.append("%s: %d curves%s%s" % (base, kept, " (%s)" % remark if remark else "",
                                             "\n      axes read as: " + axes_seen if kept else ""))
    found.sort(key=lambda f: f[0])
    cands = [f[1] for f in found[:MAX_FIGURE_CURVES]]
    # two own curves that would get the same name (two analyses in one paper) keep their figure label
    names = {}
    for c in cands:
        if c["own"]:
            names.setdefault((c["label"], c["channel"]), []).append(c)
    for group in names.values():
        if len(group) > 1:
            for c in group:
                c["label"] = "%s: %s" % (c["label"], c["raw"])
    return cands, report


def extract_figures(db, paper):
    cands, report = figure_candidates(paper)
    made = 0
    for c in cands:
        made += bool(add_curve(db, paper["arxiv_id"], c["label"], paper["experiment"], c["channel"], c["points"],
                               "figure", c["status"], kind=c["kind"], sigma=c["sigma"], shape=c["shape"], notes=c["notes"],
                               own=c["own"], source_url="https://arxiv.org/abs/" + paper["arxiv_id"]))
    return made


# ------------------------------------------------------------------ extractor 4: AI figure reading (optional)
AI_FORMAT = """
Read points off the figure: 20 to 40 points spread along the whole curve, denser where it
bends.  Read the axis scales carefully (they are usually logarithmic) and report values in the
axis's own units.

Reply with JSON only, in this form:
{"found": true,
 "curves": [{"label": "short name, e.g. 'LZ 2022 SI (4.2 t y)'",
             "kind": "%s",
             "sigma": 3 or 5 for a discovery contour, otherwise null,
             "shape": "line, or region for a closed area (give its outline as points in order around it)",
             "channel": "one of: SI, SD-p, SD-n, DMe-heavy, DMe-light, UHDM-A4, UHDM-A, dark-photon, ALP, other",
             "limit_type": "e.g. 'observed, 90%% CL', '200 t y exposure', '95%% credible region'",
             "figure": "e.g. 'Fig. 5'",
             "x_unit": "eV, keV, MeV, GeV, TeV, or g (grams)",
             "y_unit": "cm2, pb, zb, ... or '' for a dimensionless coupling",
             "points": [[mass, value], ...],
             "notes": "anything a reviewer should know, e.g. 'curve partly hidden by legend'"}]}
If the paper has nothing of this kind, reply {"found": false, "curves": []}."""

AI_PROMPT = """You are extracting dark matter direct detection curves from the attached paper for a database.

Find every figure that shows a NEW RESULT OF THIS PAPER of one of these kinds:
  limit       an exclusion limit (upper limit) from data
  projection  a projected sensitivity or projected exclusion for a future run or experiment
  discovery   a 3-sigma or 5-sigma discovery (evidence) contour
Ignore curves quoted from other experiments, +-1/2 sigma sensitivity bands and theory predictions.
Use the channels SI, SD-p, SD-n, DMe-heavy and DMe-light only for standard halo dark matter with
that interaction (limits obtained through the Migdal effect or bremsstrahlung still count).  For
any other scenario (boosted or solar-reflected dark matter, inelastic dark matter,
effective-operator or mediator-specific limits, annual-modulation regions) use channel "other"
and name the scenario in limit_type, so the curve is not drawn among ordinary limits.
Ultra-heavy dark matter (masses up to the Planck scale, multiple-scatter searches) has two channels
of its own: "UHDM-A4" for a DM-nucleon cross-section that assumes σ_χA = A⁴ σ_χN, and "UHDM-A" for
an A-independent DM-nucleus cross-section.  Its excluded areas are usually closed islands bounded
above and below: give each as shape "region" with its outline in order around it.
""" + AI_FORMAT % "limit, projection or discovery"

AI_MODEL_PROMPT = """You are extracting theory predictions from the attached dark matter paper for a database.

Find every figure drawn in a direct detection plane (dark matter mass against a scattering
cross-section or coupling) that shows where THIS PAPER'S MODEL predicts dark matter to be:
favoured or allowed regions, scan envelopes, credible regions, or target lines such as a
freeze-out or freeze-in line.  Give a region as its closed outline (shape "region"); give a target
line as shape "line".  For a scatter plot of scan points, give the outline of the populated area.
Ignore experimental limits and projections that the figure shows for comparison.
""" + AI_FORMAT % "model"


def parse_ai_reply(text, paper_kind="result"):
    m = re.search(r"\{.*\}", text, re.S)
    data = json.loads(m.group(0)) if m else {}
    out = []
    for c in data.get("curves", []) or []:
        try:
            pts = [(float(p[0]), float(p[1])) for p in c.get("points", [])]
        except (TypeError, ValueError, IndexError):
            continue
        channel = c.get("channel") if c.get("channel") in CHANNELS else "other"
        fx = MASS_UNITS.get(str(c.get("x_unit", "GeV")).lower(), 1.0)
        fy = 1.0
        if CHANNELS[channel]["y_unit"] == "cm2":
            fy = XS_UNITS.get(str(c.get("y_unit", "cm2")).lower().replace(" ", ""), 1.0)
        kind = "model" if paper_kind == "model" else (c.get("kind") if c.get("kind") in KINDS[:3] else "limit")
        out.append({"label": c.get("label", ""), "channel": channel, "limit_type": c.get("limit_type", ""),
                    "kind": kind, "sigma": c.get("sigma") if kind == "discovery" else None,
                    "shape": "region" if c.get("shape") == "region" else "line",
                    "points": [(x * fx, y * fy) for x, y in pts],
                    "notes": clean("AI-digitized from %s; approximate. %s" % (c.get("figure", "figure"), c.get("notes", "")))})
    return out


def extract_ai(db, paper, key):
    pdf = http_get(ARXIV_PDF + paper["arxiv_id"], tries=2)
    if len(pdf) > 30_000_000:
        return 0
    body = json.dumps({
        "model": AI_MODEL, "max_tokens": 8000,
        "messages": [{"role": "user", "content": [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                            "data": base64.b64encode(pdf).decode()}},
            {"type": "text", "text": AI_MODEL_PROMPT if paper["kind"] == "model" else AI_PROMPT}]}]}).encode()
    req = urllib.request.Request(ANTHROPIC, data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            reply = json.loads(r.read())
    except urllib.error.HTTPError as err:                # say why, not just "400"
        detail = err.read().decode("utf-8", "replace")[:200]
        raise RuntimeError("Anthropic API answered HTTP %s: %s" % (err.code, clean(detail))) from None
    text = "".join(b.get("text", "") for b in reply.get("content", []) if b.get("type") == "text")
    made = 0
    for c in parse_ai_reply(text, paper["kind"]):
        made += bool(add_curve(db, paper["arxiv_id"], c["label"], paper["experiment"], c["channel"], c["points"],
                               "ai", "pending", limit_type=c["limit_type"], kind=c["kind"], shape=c["shape"], sigma=c["sigma"],
                               source_url="https://arxiv.org/abs/" + paper["arxiv_id"], notes=c["notes"]))
    return made


def extract_all(db, limit=None, use_ai=False, only=None):
    """Run the extractors on waiting papers (newest first), or on the papers named in `only`."""
    key = os.environ.get("ANTHROPIC_API_KEY") if use_ai else None
    if only:
        todo = [r for i in only for r in db.execute("SELECT * FROM papers WHERE arxiv_id=?", (i,)).fetchall()]
    else:
        todo = db.execute("SELECT * FROM papers WHERE status='candidate' AND extracted='' ORDER BY published DESC").fetchall()
    for paper in todo[:limit]:
        notes, made = [], 0
        paper = dict(paper)
        # theory papers do not publish to HEPData; go straight to their data files and figures
        steps = [("ancillary", extract_ancillary), ("figures", extract_figures)] if paper["kind"] == "model" else \
                [("hepdata", extract_hepdata), ("ancillary", extract_ancillary), ("figures", extract_figures)]
        if key:
            steps.append(("ai", lambda d, p: extract_ai(d, p, key)))
        for name, fn in steps:
            if made and name == "ai":
                break                              # real data found; no need to read the figure
            try:
                n = fn(db, paper)
                made += n
                notes.append("%s: %d" % (name, n))
            except Blocked:
                notes.append("hepdata: blocked")
            except Exception as err:
                notes.append("%s: failed (%s)" % (name, str(err)[:140]))
            if name != "figures":
                time.sleep(3)                          # be polite to the services; figures work offline
        db.execute("UPDATE papers SET extracted=?, log=? WHERE arxiv_id=?", (now(), "; ".join(notes), paper["arxiv_id"]))
        db.commit()
        log("  %s  %s  [%s]" % (paper["arxiv_id"], paper["title"][:60], "; ".join(notes)))
    return len(todo[:limit])


# ------------------------------------------------------------------ demo data (so the page works before the first run)
def seed_demo(db):
    import math
    if db.execute("SELECT 1 FROM curves LIMIT 1").fetchone():
        return 0

    def curve(m_min, m_max, floor, m0, steep, rise=1.0):
        pts = []
        for i in range(40):
            m = m_min * (m_max / m_min) ** (i / 39.0)
            pts.append((m, floor * (math.exp(steep * m0 / m) + (m / (8 * m0)) ** rise)))
        return pts
    demo = [
        ("Example Xe 2019", "Example-Xe", "SI", 2019, curve(6, 1e4, 4e-47, 30, 1.6)),
        ("Example Xe 2023", "Example-Xe", "SI", 2023, curve(4, 1e4, 6e-48, 30, 1.5)),
        ("Example Ar 2022", "Example-Ar", "SI", 2022, curve(15, 1e5, 9e-46, 100, 1.3)),
        ("Example Ar low-mass 2023", "Example-Ar", "SI", 2023, curve(1.2, 12, 2e-43, 3, 2.2, 0.2)),
        ("Example cryogenic 2021", "Example-Cryo", "SI", 2021, curve(0.2, 15, 3e-41, 1.0, 1.8, 0.3)),
        ("Example Xe 2023", "Example-Xe", "SD-n", 2023, curve(5, 1e4, 3e-42, 30, 1.5)),
        ("Example bubble chamber 2020", "Example-BC", "SD-p", 2020, curve(3, 1e4, 3e-41, 25, 1.4)),
        ("Example Xe 2023", "Example-Xe", "SD-p", 2023, curve(5, 1e4, 9e-41, 30, 1.5)),
        ("Example CCD 2022", "Example-CCD", "DMe-heavy", 2022, curve(5e-4, 1, 2e-37, 3e-3, 1.5, 0.8)),
        ("Example Ar S2-only 2023", "Example-Ar", "DMe-heavy", 2023, curve(1.5e-2, 1, 1e-39, 5e-2, 1.4, 0.8)),
    ]
    for label, exp, ch, year, pts in demo:
        add_curve(db, "", label, exp, ch, pts, "demo", "approved", limit_type="synthetic demo curve",
                  notes="Synthetic curve for demonstration. Not a real result.", year=year)

    def island(m_lo, m_hi, s_lo, s_hi, n=24):    # an ultra-heavy excluded island: rising lower edge, gently rising top
        ms = [m_lo * (m_hi / m_lo) ** (i / (n - 1.0)) for i in range(n)]
        lo = [(m, s_lo * (m / m_lo) ** 0.12) for m in ms]
        hi = [(m, s_hi * (m / m_lo) ** 0.03) for m in reversed(ms)]
        return lo + hi

    def blob(m_c, s_c, dm, ds, tilt=0.0, n=36):                 # an ellipse in log-log space
        pts = []
        for i in range(n):
            a = 2 * math.pi * i / n
            u, v = dm * math.cos(a), ds * math.sin(a)
            pts.append((m_c * 10 ** u, s_c * 10 ** (v + tilt * u)))
        return pts
    extra = [
        ("Example Xe next-gen (projected)", "Example-Xe", "SI", 2025, "projection", "line", None, curve(4, 1e4, 2.5e-49, 30, 1.5)),
        ("Example Ar next-gen (projected)", "Example-Ar", "SI", 2025, "projection", "line", None, curve(15, 1e5, 4e-48, 100, 1.3)),
        ("Example Ar next-gen 5σ discovery", "Example-Ar", "SI", 2025, "discovery", "line", 5, curve(18, 1e5, 1.4e-47, 100, 1.3)),
        ("Example Ar next-gen 3σ evidence", "Example-Ar", "SI", 2025, "discovery", "line", 3, curve(17, 1e5, 8e-48, 100, 1.3)),
        ("Example model A (favoured region)", "Example models", "SI", 2024, "model", "region", None, blob(700, 6e-47, 0.55, 0.9, -0.4)),
        ("Example model B (scan envelope)", "Example models", "SI", 2023, "model", "region", None, blob(60, 3e-48, 0.5, 1.1, 0.5)),
        ("Example thermal target", "Example models", "DMe-heavy", 2024, "model", "line", None,
         [(m, 3e-40 * (m / 0.01) ** 2) for m in [10 ** (-3 + 3 * i / 29.0) for i in range(30)]]),
        ("Example CCD next-gen (projected)", "Example-CCD", "DMe-heavy", 2025, "projection", "line", None, curve(5e-4, 1, 2e-40, 3e-3, 1.5, 0.8)),
        ("Example Ar multiple-scatter 2022", "Example-Ar", "UHDM-A4", 2022, "limit", "region", None, island(1e7, 1e19, 3e-35, 2e-30)),
        ("Example Xe multiple-scatter 2024", "Example-Xe", "UHDM-A4", 2024, "limit", "region", None, island(3e8, 3e18, 8e-36, 5e-31)),
        ("Example Ar multiple-scatter 2022", "Example-Ar", "UHDM-A", 2022, "limit", "region", None, island(1e7, 1e19, 2e-28, 1e-23)),
        ("Example Xe multiple-scatter 2024", "Example-Xe", "UHDM-A", 2024, "limit", "region", None, island(3e8, 3e18, 3e-27, 2e-22)),
    ]
    for label, exp, ch, year, kind, shape, sigma, pts in extra:
        add_curve(db, "", label, exp, ch, pts, "demo", "approved", limit_type="synthetic demo curve",
                  notes="Synthetic curve for demonstration. Not a real result.", year=year, kind=kind, shape=shape, sigma=sigma)
    return len(demo) + len(extra)


# ------------------------------------------------------------------ review server (localhost only)
class Handler(SimpleHTTPRequestHandler):
    db_path = DB_PATH

    def __init__(self, *a, **k):
        super().__init__(*a, directory=SITE, **k)

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, allow_nan=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/state"):
            db = connect(self.db_path)
            curves = [dict(r, points=stored_points(r["points"])) for r in db.execute("SELECT * FROM curves ORDER BY id DESC")]
            curves = [c for c in curves if len(c["points"]) >= 2]
            papers = [dict(r) for r in db.execute(
                "SELECT arxiv_id,title,experiment,published,status,log,kind FROM papers WHERE status='candidate' "
                "ORDER BY published DESC")]
            return self._json({"admin": True, "channels": CHANNELS, "curves": curves, "papers": papers})
        if self.path.split("?")[0].endswith(".db"):
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        if self.headers.get("X-Limits-Admin") != "1":          # blocks cross-site form posts
            return self._json({"error": "missing header"}, 403)
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
        except ValueError:
            return self._json({"error": "bad JSON"}, 400)
        db = connect(self.db_path)
        if self.path == "/api/curve":                          # create or edit a curve
            fields = {k: data[k] for k in ("label", "experiment", "channel", "limit_type", "status", "notes", "year", "kind", "shape", "sigma") if k in data}
            if fields.get("kind", "limit") not in KINDS or fields.get("shape", "line") not in ("line", "region", "path"):
                return self._json({"error": "bad kind or shape"}, 400)
            if "sigma" in fields and fields["sigma"] not in (3, 5):
                fields["sigma"] = None
            if "year" in fields:
                try:
                    fields["year"] = int(fields["year"]) if str(fields["year"]).strip() else None
                except ValueError:
                    return self._json({"error": "year must be a number"}, 400)
            if "label" in fields and not str(fields["label"]).strip():
                return self._json({"error": "a curve needs a name"}, 400)
            if fields.get("channel", "SI") not in CHANNELS or fields.get("status", "approved") not in ("auto", "approved", "pending", "rejected"):
                return self._json({"error": "bad channel or status"}, 400)
            if data.get("id"):
                if "points" in data:
                    pts = [(float(x), float(y)) for x, y in data["points"]]
                    fields["points"] = json.dumps(pts if fields.get("shape") in ("region", "path") else sorted(pts))
                fields["updated"] = now()
                db.execute("UPDATE curves SET %s WHERE id=?" % ",".join(k + "=?" for k in fields), list(fields.values()) + [data["id"]])
                db.commit()
                cid = data["id"]
            else:
                cid = add_curve(db, data.get("arxiv_id", ""), data.get("label", "Untitled"), data.get("experiment", ""),
                                data.get("channel", "SI"), data.get("points", []), "manual", data.get("status", "approved"),
                                limit_type=data.get("limit_type", ""), notes=data.get("notes", ""), year=data.get("year"),
                                kind=data.get("kind", "limit"), shape=data.get("shape", "line"), sigma=data.get("sigma"),
                                source_url=("https://arxiv.org/abs/" + data["arxiv_id"]) if data.get("arxiv_id") else "")
                if not cid:
                    return self._json({"error": "a curve needs at least 3 points with positive values"}, 400)
        elif self.path == "/api/paper":                        # e.g. {"arxiv_id": "...", "status": "ignored"}
            if data.get("status") not in ("candidate", "ignored"):
                return self._json({"error": "bad status"}, 400)
            db.execute("UPDATE papers SET status=? WHERE arxiv_id=?", (data["status"], data.get("arxiv_id")))
            db.commit()
            cid = None
        else:
            return self._json({"error": "unknown endpoint"}, 404)
        try:
            export(db)
        except ExportRefused as err:
            return self._json({"ok": True, "id": cid, "warning": "Saved, but not published: %s" % err})
        return self._json({"ok": True, "id": cid})


# ------------------------------------------------------------------ command line
def main():
    ap = argparse.ArgumentParser(description="Dark matter limit database")
    ap.add_argument("--db", default=DB_PATH)
    sub = ap.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("update", help="scrape arXiv, extract curves, write data/limits.json")
    u.add_argument("--since", type=int, default=2015, help="ignore papers before this year")
    u.add_argument("--max-papers", type=int, default=25, help="papers to run the extractors on per run")
    u.add_argument("--ai", action="store_true", help="also let Claude read figures when nothing else finds a curve "
                                                     "(needs ANTHROPIC_API_KEY; off unless you ask for it)")
    u.add_argument("--no-ai", action="store_true", help=argparse.SUPPRESS)      # accepted for old cron lines; AI is off by default
    u.add_argument("--retry-failed", action="store_true", help="run the extractors again on papers where a step failed")
    xp = sub.add_parser("export", help="rewrite data/limits.json from the database")
    xp.add_argument("--force", action="store_true", help="write it even if it holds far fewer curves than the current file")
    rs = sub.add_parser("restore", help="rebuild the database from a backup (.db) or from a published file (limits.json)")
    rs.add_argument("file")
    pb = sub.add_parser("publish", help="send your review changes to GitHub; the website follows a few minutes later")
    pb.add_argument("-m", "--message", default="Review of dark matter limit curves", help="commit message")
    s = sub.add_parser("serve", help="review UI on localhost")
    s.add_argument("--no-pull", action="store_true", help="do not fetch the latest changes from GitHub first")
    s.add_argument("--port", type=int, default=8787)
    ls = sub.add_parser("list", help="show curves and the papers still waiting for one")
    ls.add_argument("--search", default="", help="only curves whose name, experiment or arXiv number contains this")
    ed = sub.add_parser("edit", help='change a curve\'s name or details, e.g.  edit 735 --label "SuperCDMS 2024"')
    ed.add_argument("ids", nargs="+", type=int, help="curve numbers, as `list` shows them")
    ed.add_argument("--label", help="the name shown in the legend and the curve list")
    ed.add_argument("--experiment", help="the group the curve is listed under")
    ed.add_argument("--year", type=int)
    ed.add_argument("--channel", choices=list(CHANNELS), help="plot type")
    ed.add_argument("--kind", choices=list(KINDS))
    ed.add_argument("--sigma", type=int, choices=[3, 5], help="for discovery contours")
    ed.add_argument("--details", help="e.g. 'observed, 90%% CL'")
    ed.add_argument("--status", choices=["approved", "pending", "rejected"])
    for name in ("approve", "reject"):
        sub.add_parser(name, help=name + " curves by id").add_argument("ids", nargs="+", type=int)
    a = sub.add_parser("add", help="import a two-column file (mass, limit) as an approved curve")
    a.add_argument("arxiv_id")
    a.add_argument("file")
    a.add_argument("--label", required=True)
    a.add_argument("--experiment", default="")
    a.add_argument("--channel", default="SI", choices=list(CHANNELS))
    a.add_argument("--x-unit", default="GeV")
    a.add_argument("--y-unit", default="cm2")
    a.add_argument("--year", type=int)
    a.add_argument("--kind", default="limit", choices=list(KINDS))
    a.add_argument("--shape", default="line", choices=["line", "region", "path"],
                   help="region = closed outline, rows in order around it; path = open line kept in row order")
    a.add_argument("--sigma", type=int, choices=[3, 5], help="for discovery contours")
    sub.add_parser("demo", help="fill an empty database with synthetic demo curves")
    sub.add_parser("check", help="test the connection to arXiv, INSPIRE and HEPData")
    sub.add_parser("doctor", help="check that the database and data/limits.json are readable by the web page")
    hd = sub.add_parser("add-hepdata", help="import HEPData tables you downloaded in a browser (JSON format)")
    hd.add_argument("arxiv_id")
    hd.add_argument("files", nargs="+", help="table files saved from HEPData with 'JSON' as the download format")
    hd.add_argument("--experiment", default="")
    ex = sub.add_parser("extract", help="run the extractors on particular papers now, e.g. extract 2410.17036")
    ex.add_argument("ids", nargs="*", metavar="ARXIV_ID")
    ex.add_argument("--pending", action="store_true", help="redo every paper that still has unreviewed curves "
                                                           "(use after updating the scripts)")
    ex.add_argument("--experiment", default="", help="experiment name, if the paper is not in the database yet")
    ex.add_argument("--ai", action="store_true", help="also use AI figure reading (needs ANTHROPIC_API_KEY)")
    fg = sub.add_parser("figures", help="show what the figure reader finds in one paper (nothing is saved)")
    fg.add_argument("arxiv_id")
    fg.add_argument("--dump", metavar="FILE", help="print everything the reader sees in one figure file, e.g. figure5.pdf")
    q = sub.add_parser("queue", help="list the papers waiting for extraction")
    q.add_argument("-n", type=int, default=40)
    args = ap.parse_args()
    global DUMP_PATH
    DUMP_PATH = os.path.splitext(os.path.abspath(args.db))[0] + ".sql"
    if args.cmd == "serve" and not args.no_pull and in_git() and args.db == DB_PATH:
        r = git("pull", "--ff-only", "-q")
        log("Fetched the latest curves from GitHub." if r.returncode == 0 else
            "Could not fetch from GitHub (%s). Reviewing the copy on this computer." % (r.stderr.strip().splitlines() or ["?"])[-1])
    if args.cmd != "restore":
        sync_from_dump(args.db, DUMP_PATH)
    missing = not os.path.exists(args.db) or os.path.getsize(args.db) == 0
    n_pub, pub_demo = published_count()
    if missing and n_pub and not pub_demo and args.cmd not in ("restore", "check", "figures"):
        sys.exit("STOPPED: there is no database at %s, but data/limits.json holds %d published curves.\n"
                 "If you replaced or moved the site folder, copy tools/limits.db back from the old copy.\n"
                 "Otherwise rebuild the database from the published file:\n"
                 "    python3 tools/limits.py restore data/limits.json\n"
                 "or from a daily backup:  python3 tools/limits.py restore tools/backups/limits-YYYY-MM-DD.db"
                 % (args.db, n_pub))
    if args.cmd not in ("check", "figures", "list", "queue"):
        backup_db(args.db)
    db = connect(args.db)

    if args.cmd == "update":
        log("Scraping arXiv")
        log("  %d new candidate papers" % scrape(db, args.since))
        if args.retry_failed:
            db.execute("UPDATE papers SET extracted='' WHERE log LIKE '%failed%' OR log LIKE '%blocked%'")
            db.commit()
        changed = reclassify(db)
        if changed:
            log("  %d waiting papers re-sorted by the current filter rules" % changed)
        n = db.execute("SELECT kind, COUNT(*) FROM papers WHERE status='candidate' AND extracted='' GROUP BY kind").fetchall()
        log("  waiting for extraction: " + (", ".join("%d %s" % (c, k) for k, c in n) or "none"))
        use_ai = args.ai and not args.no_ai
        if use_ai and not os.environ.get("ANTHROPIC_API_KEY"):
            log("  --ai was given but ANTHROPIC_API_KEY is not set; continuing without AI")
        log("Extracting curves%s" % (" (with AI figure reading)" if use_ai else ""))
        extract_all(db, args.max_papers, use_ai)
        if db.execute("SELECT 1 FROM curves WHERE source!='demo' AND status!='rejected'").fetchone():
            db.execute("DELETE FROM curves WHERE source='demo'")      # real data replaces the demo set
            db.commit()
        report_export(db)
    elif args.cmd == "export":
        report_export(db, force=args.force)
    elif args.cmd == "restore":
        src = os.path.abspath(args.file)
        if not os.path.exists(src):
            sys.exit("No such file: %s" % src)
        have = db.execute("SELECT COUNT(*) FROM curves WHERE source!='demo'").fetchone()[0]
        if have:
            sys.exit("The database already holds %d curves; restore only fills an empty one. "
                     "Move tools/limits.db aside first (a copy is in tools/backups/)." % have)
        db.close()
        if src.endswith(".db"):
            shutil.copyfile(src, args.db)
            db = connect(args.db)
        else:
            with open(src, encoding="utf-8") as f:
                data = json.load(f)
            os.remove(args.db) if os.path.exists(args.db) else None
            db = connect(args.db)
            cols = ("arxiv_id", "label", "experiment", "channel", "year", "limit_type", "source", "source_url", "status",
                    "notes", "updated", "kind", "shape", "sigma", "own")
            for c in data.get("curves", []):
                if c.get("source") == "demo":
                    continue
                vals = [c.get(k) for k in cols] + [json.dumps(c.get("points", [])), c.get("updated") or now()]
                db.execute("INSERT INTO curves (%s, points, created) VALUES (%s)" % (",".join(cols), ",".join("?" * (len(cols) + 2))), vals)
            for arxiv_id in {c.get("arxiv_id") for c in data.get("curves", []) if c.get("arxiv_id")}:
                # mark the papers as done, so the next update does not extract them again
                db.execute("INSERT OR IGNORE INTO papers (arxiv_id, title, status, extracted, log) VALUES (?,?,?,?,?)",
                           (arxiv_id, "", "candidate", now(), "restored from %s" % os.path.basename(src)))
            db.commit()
        n = dict(db.execute("SELECT status, COUNT(*) FROM curves GROUP BY status").fetchall())
        print("Restored: %d approved/auto, %d pending, %d rejected curves." % (
            n.get("approved", 0) + n.get("auto", 0), n.get("pending", 0), n.get("rejected", 0)))
        print("Papers still to process will be found again by the next update; rejected curves are not in a "
              "published file, so a restore from limits.json does not bring those back.")
        report_export(db)
    elif args.cmd == "publish":
        if not in_git():
            sys.exit("This copy of the site is not a git clone, so there is nothing to publish to. See the README.")
        write_dump(db)
        db.close()
        # Only the text database is yours to commit; GitHub rebuilds data/limits.json from it after the push.
        git("checkout", "--", "data/limits.json")
        git("add", "tools/limits.sql")
        if git("diff", "--cached", "--quiet").returncode == 0:
            r = git("status", "-sb")
            ahead = "ahead" in (r.stdout.splitlines() or [""])[0]
            if not ahead:
                print("Nothing new to publish.")
                return
        else:
            r = git("commit", "-q", "-m", args.message)
            if r.returncode:
                sys.exit("git commit failed: " + r.stderr.strip())
        for attempt in range(3):
            r = git("pull", "--rebase", "-q")
            if r.returncode:
                git("rebase", "--abort")
                sys.exit("Someone else changed the same curves while you were reviewing, so git could not combine the two.\n"
                         "Your changes are kept in a local commit. To finish, run:\n"
                         "    git pull --rebase      (then fix tools/limits.sql where git marks a conflict)\n"
                         "    git add tools/limits.sql && git rebase --continue && git push")
            sync_from_dump(args.db, DUMP_PATH)        # the database now includes everyone's changes
            r = git("push", "-q")
            if r.returncode == 0:
                print("Published. GitHub is rebuilding the public data now; the website shows the changes within "
                      "about 15 minutes (when the server next pulls).")
                return
            time.sleep(5)
        sys.exit("Could not push to GitHub: " + r.stderr.strip()[-300:] +
                 "\nYour changes are committed locally; run  python3 tools/limits.py publish  again to retry.")
    elif args.cmd == "serve":
        Handler.db_path = args.db
        report_export(db)
        log("Review UI: http://127.0.0.1:%d/Limits.html   (Ctrl-C to stop)" % args.port)
        ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
    elif args.cmd == "list":
        q = "%" + args.search + "%"
        for r in db.execute("SELECT id,status,CASE WHEN own THEN 'own' ELSE '' END,kind,source,channel,year,label,arxiv_id "
                            "FROM curves WHERE label LIKE ? OR experiment LIKE ? OR arxiv_id LIKE ? "
                            "ORDER BY status,arxiv_id,id", (q, q, q)):
            print("%4d  %-8s %-3s %-10s %-9s %-10s %s  %s  %s" % tuple(r))
        waiting = db.execute("SELECT COUNT(*) FROM papers p WHERE status='candidate' AND NOT EXISTS "
                             "(SELECT 1 FROM curves c WHERE c.arxiv_id=p.arxiv_id AND c.status!='rejected')").fetchone()[0]
        print("%d candidate papers have no curve yet" % waiting)
        n = dict(db.execute("SELECT status, COUNT(*) FROM curves GROUP BY status").fetchall())
        print("curves: %d approved/auto (shown to everyone), %d pending (hidden until approved), %d rejected" % (
            n.get("approved", 0) + n.get("auto", 0), n.get("pending", 0), n.get("rejected", 0)))
    elif args.cmd == "edit":
        changes = {"label": args.label, "experiment": args.experiment, "year": args.year, "channel": args.channel,
                   "kind": args.kind, "sigma": args.sigma, "limit_type": args.details, "status": args.status}
        changes = {k: v for k, v in changes.items() if v is not None}
        if not changes:
            sys.exit("Nothing to change: give at least one of --label --experiment --year --channel --kind --sigma --details --status.")
        changes["updated"] = now()
        for cid in args.ids:
            if not db.execute("SELECT 1 FROM curves WHERE id=?", (cid,)).fetchone():
                print("curve %d: no such curve" % cid)
                continue
            db.execute("UPDATE curves SET %s WHERE id=?" % ",".join(k + "=?" for k in changes), list(changes.values()) + [cid])
            r = db.execute("SELECT id,status,kind,channel,year,experiment,label FROM curves WHERE id=?", (cid,)).fetchone()
            print("curve %d now: %s, %s, %s, %s, %s, \"%s\"" % tuple(r))
        db.commit()
        report_export(db)
    elif args.cmd in ("approve", "reject"):
        db.executemany("UPDATE curves SET status=?, updated=? WHERE id=?",
                       [("approved" if args.cmd == "approve" else "rejected", now(), i) for i in args.ids])
        db.commit()
        report_export(db)
    elif args.cmd == "add":
        with open(args.file, encoding="utf-8", errors="replace") as f:
            _, rows = parse_columns(f.read())
        fx = MASS_UNITS[args.x_unit.lower()]
        fy = XS_UNITS.get(args.y_unit.lower(), 1.0) if CHANNELS[args.channel]["y_unit"] else 1.0
        cid = add_curve(db, args.arxiv_id, args.label, args.experiment, args.channel,
                        [(r[0] * fx, r[1] * fy) for r in rows], "manual", "approved", year=args.year,
                        kind=args.kind, shape=args.shape, sigma=args.sigma,
                        source_url="https://arxiv.org/abs/" + args.arxiv_id)
        report_export(db)
        print("added curve %s" % cid if cid else "no usable rows found")
    elif args.cmd == "add-hepdata":
        row = db.execute("SELECT * FROM papers WHERE arxiv_id=?", (args.arxiv_id,)).fetchone()
        paper = dict(row) if row else {"title": "", "kind": "result", "experiment": args.experiment}
        made = 0
        for path in args.files:
            with open(path, encoding="utf-8") as f:
                table = json.load(f)
            for label, channel, pts, confident, note in hepdata_curves(table, paper["title"]):
                kind, sigma = guess_kind(table.get("name", "") + " " + table.get("description", "") + " " + label, paper["kind"])
                cid = add_curve(db, args.arxiv_id, "%s: %s" % (table.get("name", os.path.basename(path)), label),
                                args.experiment or paper["experiment"], channel, pts, "hepdata",
                                "auto" if confident else "pending", kind=kind, sigma=sigma, notes=note,
                                source_url="https://arxiv.org/abs/" + args.arxiv_id)
                made += bool(cid)
                print("  curve %s: %s [%s, %s]%s" % (cid, label, channel, kind, "" if confident else "  (units unclear: review)"))
        report_export(db)
        print("added %d curves" % made)
    elif args.cmd == "check":
        check_services()
    elif args.cmd == "doctor":
        bad = 0
        for r in db.execute("SELECT id,label,points FROM curves").fetchall():
            try:
                raw = json.loads(r["points"])
            except ValueError:
                raw = None
            good = stored_points(r["points"])
            if raw is None or len(good) != len(raw):
                bad += 1
                print("curve %d (%s): %s" % (r["id"], r["label"], "unreadable points" if raw is None else
                                             "%d of %d points were not finite numbers" % (len(raw) - len(good), len(raw))))
                db.execute("UPDATE curves SET points=? WHERE id=?", (json.dumps(good), r["id"]))
        db.commit()
        print("database: %d curves, %d repaired" % (db.execute("SELECT COUNT(*) FROM curves").fetchone()[0], bad))
        report_export(db)
        try:
            with open(EXPORT_PATH, encoding="utf-8") as f:
                data = json.load(f, parse_constant=lambda name: (_ for _ in ()).throw(ValueError("contains " + name)))
            print("data/limits.json: ok, %d curves, %d channels, %.0f kB" % (
                len(data["curves"]), len(data["channels"]), os.path.getsize(EXPORT_PATH) / 1000))
        except Exception as err:
            print("data/limits.json: NOT readable by a browser (%s)" % err)
        missing = [f for f in ("Limits.html", "assets/limits.js", "assets/limits.css", "assets/style.css", "assets/site.js")
                   if not os.path.exists(os.path.join(SITE, f))]
        print("page files: %s" % ("all present" if not missing else "MISSING " + ", ".join(missing)))
        with open(os.path.join(SITE, "Limits.html"), encoding="utf-8") as f:
            html = f.read()
        with open(os.path.join(SITE, "assets", "limits.js"), encoding="utf-8") as f:
            js = f.read()
        ids = set(re.findall(r"\$\('([\w-]+)'\)", js))
        absent = sorted(i for i in ids if 'id="%s"' % i not in html)
        print("Limits.html and limits.js: %s" % ("match" if not absent else
              "DO NOT MATCH (Limits.html is an older copy; it lacks: %s). Replace Limits.html." % ", ".join(absent)))
    elif args.cmd == "extract":
        if args.pending:
            args.ids = list(args.ids) + [r[0] for r in db.execute(
                "SELECT DISTINCT arxiv_id FROM curves WHERE status='pending' AND source IN ('figure','ai') AND arxiv_id!=''")
                if r[0] not in args.ids]
        if not args.ids:
            sys.exit("Give one or more arXiv numbers, or --pending.")
        for arxiv_id in args.ids:
            if not db.execute("SELECT 1 FROM papers WHERE arxiv_id=?", (arxiv_id,)).fetchone():
                found = parse_feed(http_get(ARXIV_API + "?id_list=" + urllib.parse.quote(arxiv_id) + "&max_results=1"))
                if not found:
                    print("%s: not found on arXiv" % arxiv_id)
                    continue
                p = found[0]
                text = p["title"] + " " + p["abstract"]
                guess = args.experiment or next((name for name, words in COLLABS if any(
                    re.search(r"(?<![A-Za-z])%s(?![A-Za-z])" % re.escape(w), text) for w in words)), "")
                db.execute("INSERT INTO papers (arxiv_id,title,abstract,authors,n_authors,published,experiment,journal_ref,doi,"
                           "status,kind) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                           (arxiv_id, p["title"], p["abstract"], p["authors"], p["n_authors"], p["published"], guess,
                            p["journal_ref"], p["doi"], "candidate", "result"))
            # start clean: drop this paper's unreviewed candidates so a re-run does not pile up copies
            db.execute("DELETE FROM curves WHERE arxiv_id=? AND (status='pending' OR notes LIKE 'Auto-rejected%')", (arxiv_id,))
            db.execute("UPDATE papers SET status='candidate', extracted='' WHERE arxiv_id=?", (arxiv_id,))
            db.commit()
        extract_all(db, None, args.ai, only=args.ids)
        if db.execute("SELECT 1 FROM curves WHERE source!='demo' AND status!='rejected'").fetchone():
            db.execute("DELETE FROM curves WHERE source='demo'")
            db.commit()
        report_export(db)
    elif args.cmd == "figures":
        row = db.execute("SELECT * FROM papers WHERE arxiv_id=?", (args.arxiv_id,)).fetchone()
        paper = dict(row) if row else {"arxiv_id": args.arxiv_id, "title": "", "abstract": "", "experiment": "", "kind": "result"}
        if args.dump:
            import figures
            tar = tarfile.open(fileobj=io.BytesIO(source_package(paper)), mode="r:*")
            for m in tar.getmembers():
                if os.path.basename(m.name) == args.dump:
                    figures.dump(tar.extractfile(m).read(), args.dump)
                    break
            else:
                print("No file called %s in the source package." % args.dump)
            return
        cands, report = figure_candidates(paper)
        print("Figure files:")
        for line in report:
            print("  " + line)
        print("%d candidate curves:" % len(cands))
        for c in cands:
            xs, ys = [q[0] for q in c["points"]], [q[1] for q in c["points"]]
            verdict = "KEEP  " if c["own"] else "reject" if c["status"] == "rejected" else "review"
            print("  %s %-10s %-9s %-40s %4d pts  mass %.3g..%.3g GeV  value %.3g..%.3g\n             %s" % (
                verdict, c["kind"], c["channel"], c["label"][:40], len(xs), min(xs), max(xs), min(ys), max(ys), c["notes"]))
        print("KEEP = judged this paper's own result (one click approves these); reject = quoted from another "
              "experiment, rejected automatically; review = left for you to decide.")
    elif args.cmd == "queue":
        reclassify(db)
        for r in db.execute("SELECT arxiv_id,kind,experiment,title FROM papers WHERE status='candidate' AND extracted='' "
                            "ORDER BY published DESC LIMIT ?", (args.n,)):
            print("%-11s %-10s %-14s %s" % (r["arxiv_id"], r["kind"], r["experiment"][:14], r["title"][:90]))
    elif args.cmd == "demo":
        print("added %d demo curves" % seed_demo(db))
        report_export(db)


if __name__ == "__main__":
    main()
