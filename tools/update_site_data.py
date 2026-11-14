#!/usr/bin/env python3
"""Refresh the data files the website is drawn from.

  data/publications.json   every arXiv paper matching --query (default au:Westerdale),
                           with citation counts and collaboration names added from INSPIRE
  data/github.json         stars, language, last update and latest release for each
                           repository named in data/tools.json

Needs only the Python 3 standard library. Run it nightly from cron on the web server:

    15 3 * * *  /usr/bin/python3 /path/to/Public/tools/update_site_data.py

Each step is independent. If a service is down, that step is skipped and the existing
file is left as it was, so a failed run never empties a page.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ARXIV = "https://export.arxiv.org/api/query"
INSPIRE = "https://inspirehep.net/api/literature"
GITHUB = "https://api.github.com/repos/"
NS = {
    "a": "http://www.w3.org/2005/Atom",
    "x": "http://arxiv.org/schemas/atom",
    "os": "http://a9.com/-/spec/opensearch/1.1/",
}
PAGE = 100          # arXiv entries per request (collaboration papers carry 1000+ authors each)
PAUSE = 3.5         # seconds between arXiv requests, as arXiv asks
KEEP_AUTHORS = 10   # authors stored per paper; the highlighted author is always kept
UA = {"User-Agent": "ucr-darkmatter-lab-site/1.0"}


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def get(url, tries=4, timeout=120):
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as err:  # services are occasionally slow or return 503; retry politely
            if attempt == tries - 1:
                raise
            print("  retrying after error: %s" % err, file=sys.stderr)
            time.sleep(10 * (attempt + 1))


def write_json(path, payload):
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- arXiv
def parse_arxiv(xml_bytes, highlight):
    root = ET.fromstring(xml_bytes)
    total = int(root.findtext("os:totalResults", default="0", namespaces=NS))
    papers = []
    for e in root.findall("a:entry", NS):
        names = [clean(a.findtext("a:name", default="", namespaces=NS)) for a in e.findall("a:author", NS)]
        shown = names[:KEEP_AUTHORS]
        for n in names:
            if highlight.search(n) and n not in shown:
                shown.append(n)
                break
        cat = e.find("x:primary_category", NS)
        raw_id = clean(e.findtext("a:id", default="", namespaces=NS))
        papers.append({
            "id": re.sub(r"v\d+$", "", raw_id.split("/abs/")[-1]),
            "title": clean(e.findtext("a:title", default="", namespaces=NS)),
            "abstract": clean(e.findtext("a:summary", default="", namespaces=NS)),
            "published": clean(e.findtext("a:published", default="", namespaces=NS))[:10],
            "updated": clean(e.findtext("a:updated", default="", namespaces=NS))[:10],
            "authors": shown,
            "n_authors": len(names),
            "journal_ref": clean(e.findtext("x:journal_ref", default="", namespaces=NS)),
            "doi": clean(e.findtext("x:doi", default="", namespaces=NS)),
            "comment": clean(e.findtext("x:comment", default="", namespaces=NS)),
            "category": cat.get("term") if cat is not None else "",
        })
    return total, papers


def fetch_arxiv(query, highlight):
    papers, start, total = [], 0, None
    while total is None or start < total:
        params = urllib.parse.urlencode({
            "search_query": query, "sortBy": "submittedDate", "sortOrder": "descending",
            "start": start, "max_results": PAGE,
        })
        t, batch = parse_arxiv(get(ARXIV + "?" + params), highlight)
        total = t if total is None else total
        if not batch:
            break
        papers.extend(batch)
        start += PAGE
        if start < total:
            time.sleep(PAUSE)
    seen, unique = set(), []
    for p in papers:
        if p["id"] not in seen:
            seen.add(p["id"])
            unique.append(p)
    if not unique or (total and len(unique) < 0.9 * total):
        raise RuntimeError("arXiv returned %d of %s papers" % (len(unique), total))
    unique.sort(key=lambda p: p["published"], reverse=True)
    return unique


# ---------------------------------------------------------------- INSPIRE
def parse_inspire(payload):
    """Map arXiv id -> {citations, collaboration, journal_ref, doi} from an INSPIRE reply."""
    out = {}
    for hit in payload.get("hits", {}).get("hits", []):
        m = hit.get("metadata", {})
        info = {"citations": m.get("citation_count", 0)}
        collabs = [c.get("value") for c in m.get("collaborations", []) if c.get("value")]
        if collabs:
            info["collaboration"] = ", ".join(collabs)
        for pub in m.get("publication_info", []):
            if pub.get("journal_title") and pub.get("year"):
                bits = [pub["journal_title"], pub.get("journal_volume", ""), "(%s)" % pub["year"],
                        pub.get("artid") or pub.get("page_start") or ""]
                info["journal_ref"] = clean(" ".join(b for b in bits if b))
                break
        if m.get("dois"):
            info["doi"] = m["dois"][0].get("value", "")
        for ep in m.get("arxiv_eprints", []):
            if ep.get("value"):
                out[ep["value"]] = info
    return out


def fetch_inspire(query):
    found, page = {}, 1
    while page <= 10:
        params = urllib.parse.urlencode({
            "q": query, "size": 250, "page": page,
            "fields": "arxiv_eprints,citation_count,collaborations,publication_info,dois",
        })
        payload = json.loads(get(INSPIRE + "?" + params, tries=2, timeout=60))
        batch = parse_inspire(payload)
        found.update(batch)
        if len(payload.get("hits", {}).get("hits", [])) < 250:
            break
        page += 1
        time.sleep(1)
    return found


def enrich(papers, extra):
    for p in papers:
        info = extra.get(p["id"])
        if not info:
            continue
        p["citations"] = info.get("citations", 0)
        if info.get("collaboration"):
            p["collaboration"] = info["collaboration"]
        if not p["journal_ref"] and info.get("journal_ref"):   # published, but arXiv not yet updated
            p["journal_ref"] = info["journal_ref"]
        if not p["doi"] and info.get("doi"):
            p["doi"] = info["doi"]
    return sum(p.get("citations", 0) for p in papers)


# ---------------------------------------------------------------- GitHub
def fetch_github(repos):
    out = {}
    for repo in repos:
        try:
            j = json.loads(get(GITHUB + repo, tries=2, timeout=30))
            info = {"stars": j.get("stargazers_count"), "language": j.get("language"),
                    "pushed": j.get("pushed_at"), "description": j.get("description")}
            try:
                rel = json.loads(get(GITHUB + repo + "/releases/latest", tries=1, timeout=30))
                info["release"] = rel.get("tag_name")
            except Exception:
                pass                       # no releases published; that is fine
            out[repo] = info
        except Exception as err:
            print("  GitHub: skipped %s (%s)" % (repo, err), file=sys.stderr)
    return out


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="Refresh the website's data files.")
    ap.add_argument("--query", default="au:Westerdale", help="arXiv API search_query")
    ap.add_argument("--inspire-query", default="a Westerdale, S", help="INSPIRE literature search; '' to skip")
    ap.add_argument("--highlight", default="westerdale", help="author name (regex) always kept in author lists")
    ap.add_argument("--data", default=os.path.join(here, "..", "data"), help="the site's data folder")
    args = ap.parse_args()
    ok = True

    print("arXiv: %s" % args.query)
    try:
        papers = fetch_arxiv(args.query, re.compile(args.highlight, re.I))
        payload = {"generated": now(), "query": args.query, "papers": papers}
        if args.inspire_query:
            try:
                payload["total_citations"] = enrich(papers, fetch_inspire(args.inspire_query))
                print("  INSPIRE: citation counts added")
            except Exception as err:
                print("  INSPIRE: skipped (%s)" % err, file=sys.stderr)
        write_json(os.path.join(args.data, "publications.json"), payload)
        print("  wrote %d papers" % len(papers))
    except Exception as err:
        ok = False
        print("  arXiv: FAILED, kept the existing file (%s)" % err, file=sys.stderr)

    print("GitHub")
    try:
        with open(os.path.join(args.data, "tools.json"), encoding="utf-8") as f:
            tools = json.load(f)
        repos = [t["repo"] for group in ("lab", "other") for t in tools.get(group, []) if t.get("repo")]
        info = fetch_github(repos)
        if info:
            write_json(os.path.join(args.data, "github.json"), {"generated": now(), "repos": info})
            print("  wrote %d repositories" % len(info))
    except Exception as err:
        ok = False
        print("  GitHub: FAILED (%s)" % err, file=sys.stderr)

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
