#!/usr/bin/env python3
"""
Wikipedia / Wikimedia Commons enrichment for the Auckland suburb site.

For each SA2 it tries to find the matching Wikipedia article (validated by
coordinates inside the Auckland region, or an explicit Auckland mention) and
takes: a one-to-two-sentence description (CC BY-SA, attributed in the UI) and
the lead photo. Where the article has no usable photo, it falls back to a
Wikimedia Commons geosearch around the SA2 centroid. Every image gets artist +
license attribution pulled from Commons metadata.

Results are cached in data/raw/wiki_cache.json so re-runs are cheap, and
written to docs/data/extras.json keyed by SA2 code. Suburbs with no confident
match simply get no entry - the site shows a neutral data-derived line instead.
Never invents descriptions.

Run after build.py:  python3 enrich.py
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE_PATH = ROOT / "data" / "raw" / "wiki_cache.json"
OUT_PATH = ROOT / "docs" / "data" / "extras.json"

UA = "AucklandSuburbProfiles/1.0 (https://query.co.nz; jason.duong77@gmail.com)"
# Auckland region bounding box (generous)
LAT = (-37.75, -35.75)
LON = (173.8, 176.2)

_cache = json.loads(CACHE_PATH.read_text()) if CACHE_PATH.exists() else {}


def api(url):
    key = "GET " + url
    if key in _cache:
        return _cache[key]
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except Exception:
        data = None
    _cache[key] = data
    time.sleep(0.05)
    return data


def summary(title):
    return api("https://en.wikipedia.org/api/rest_v1/page/summary/"
               + urllib.parse.quote(title.replace(" ", "_"), safe="") + "?redirect=true")


def in_auckland(s):
    if not s or s.get("type") not in ("standard", "disambiguation"):
        return False
    if s.get("type") == "disambiguation":
        return False
    c = s.get("coordinates")
    if c:
        return LAT[0] <= c["lat"] <= LAT[1] and LON[0] <= c["lon"] <= LON[1]
    text = (s.get("extract") or "") + " " + (s.get("description") or "")
    return "Auckland" in text


def find_article(cands):
    tried = set()
    for cand in cands:
        for title in (cand, cand + ", New Zealand", cand + ", Auckland"):
            if not title or title in tried:
                continue
            tried.add(title)
            s = summary(title)
            if in_auckland(s):
                return s
    # last resort: search
    for cand in cands[:2]:
        q = urllib.parse.quote(cand + " Auckland suburb")
        res = api("https://en.wikipedia.org/w/api.php?action=query&list=search"
                  "&srsearch=%s&srlimit=3&format=json" % q)
        for hit in ((res or {}).get("query", {}).get("search", []) or []):
            if hit["title"] in tried:
                continue
            tried.add(hit["title"])
            s = summary(hit["title"])
            # search results must look specifically like the place we asked for
            if in_auckland(s) and cand.lower() in s["title"].lower():
                return s
    return None


def first_sentences(text, max_chars=280):
    if not text:
        return None
    # protect common abbreviations from the sentence splitter
    guard = text.replace("St.", "St‡").replace("Mt.", "Mt‡").replace("no.", "no‡")
    parts = re.split(r"(?<=[.!?])\s+", guard)
    out = ""
    for p in parts:
        if out and len(out) + len(p) + 1 > max_chars:
            break
        out = (out + " " + p).strip()
        if len(out) >= 120:
            break
    return out.replace("‡", ".") or None


def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def commons_imageinfo(file_title):
    """file_title like 'File:Foo.jpg' -> dict with thumb/page/artist/license."""
    q = urllib.parse.quote(file_title)
    res = api("https://commons.wikimedia.org/w/api.php?action=query&titles=%s"
              "&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json" % q)
    pages = (res or {}).get("query", {}).get("pages", {})
    for p in pages.values():
        info = (p.get("imageinfo") or [None])[0]
        if not info:
            continue
        meta = info.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        artist = strip_html(meta.get("Artist", {}).get("value", ""))[:80]
        return {"img": info.get("thumburl") or info.get("url"),
                "img_page": info.get("descriptionurl"),
                "artist": artist or None, "license": lic or None}
    return None


def lead_image(article_title):
    q = urllib.parse.quote(article_title)
    res = api("https://en.wikipedia.org/w/api.php?action=query&titles=%s"
              "&prop=pageimages&piprop=name&format=json" % q)
    pages = (res or {}).get("query", {}).get("pages", {})
    for p in pages.values():
        name = p.get("pageimage")
        if name and re.search(r"\.(jpe?g|png|webp)$", name, re.I):
            return commons_imageinfo("File:" + name)
    return None


def geosearch_image(lat, lon):
    res = api("https://commons.wikimedia.org/w/api.php?action=query&list=geosearch"
              "&gscoord=%.5f|%.5f&gsradius=1500&gsnamespace=6&gslimit=10&format=json"
              % (lat, lon))
    for hit in ((res or {}).get("query", {}).get("geosearch", []) or []):
        t = hit["title"]
        if not re.search(r"\.(jpe?g|webp)$", t, re.I):
            continue
        if re.search(r"map|diagram|logo|plan|chart", t, re.I):
            continue
        info = commons_imageinfo(t)
        if info and info["img"]:
            return info
    return None


def centroids(geojson_path):
    fc = json.loads(Path(geojson_path).read_text())
    out = {}
    for f in fc["features"]:
        b = [180, 90, -180, -90]
        def scan(cs):
            for c in cs:
                if isinstance(c[0], (int, float)):
                    b[0] = min(b[0], c[0]); b[1] = min(b[1], c[1])
                    b[2] = max(b[2], c[0]); b[3] = max(b[3], c[1])
                else:
                    scan(c)
        scan(f["geometry"]["coordinates"])
        out[f["properties"]["code"]] = ((b[1] + b[3]) / 2, (b[0] + b[2]) / 2)
    return out


DIRECTIONAL = re.compile(
    r"\s+(North|South|East|West|Central|Nth|Sth)(\s+(East|West))?$", re.I)


def main():
    data = json.loads((ROOT / "docs" / "data" / "suburbs.json").read_text())
    cents = centroids(ROOT / "docs" / "data" / "auckland.geojson")
    extras = {}
    n_desc = n_img = 0
    for i, s in enumerate(data["suburbs"]):
        code, name = s["code"], s["name"]
        base = re.sub(r"\s*\(.*\)$", "", name)          # "Avondale (Auckland)" -> Avondale
        stripped = DIRECTIONAL.sub("", base)
        cands = []
        for c in (s.get("colloquial"), base, stripped if stripped != base else None):
            if c and c not in cands:
                cands.append(c)
        if any(w in name for w in ("Inlet", "Oceanic", "Islands", "Bays ")):
            cands = cands[:1] if s.get("colloquial") else []

        art = find_article(cands) if cands else None
        e = {}
        if art:
            desc = first_sentences(art.get("extract"))
            if desc:
                e["desc"] = desc
                e["wiki"] = art.get("content_urls", {}).get("desktop", {}).get("page")
                e["wiki_title"] = art.get("title")
        img = lead_image(art["title"]) if art else None
        if not img and code in cents:
            img = geosearch_image(*cents[code])
        if img and img.get("img"):
            e.update(img)
        if e:
            extras[code] = e
            n_desc += 1 if "desc" in e else 0
            n_img += 1 if "img" in e else 0
        if (i + 1) % 50 == 0:
            print("  %d/%d done (desc %d, img %d)" % (i + 1, len(data["suburbs"]),
                                                      n_desc, n_img))
            CACHE_PATH.write_text(json.dumps(_cache))
    CACHE_PATH.write_text(json.dumps(_cache))
    OUT_PATH.write_text(json.dumps(extras, ensure_ascii=False, separators=(",", ":")))
    print("wrote %s: %d/%d suburbs with a description, %d with a photo"
          % (OUT_PATH.name, n_desc, len(data["suburbs"]), n_img))


if __name__ == "__main__":
    main()
