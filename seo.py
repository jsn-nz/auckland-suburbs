#!/usr/bin/env python3
"""
Static, crawlable pages for search engines.

The interactive map is a single page that routes on #fragments, which search
engines do not index. This script reads the data build.py already produced
(docs/data/) and writes plain HTML pages with the same figures:

  docs/<region>/index.html            one per region: map of its suburbs + table
  docs/<region>/<suburb>/index.html   one per populated suburb (SA2)
  docs/sitemap.xml, docs/robots.txt

Pages share the site's look (css/style.css tokens, same cards and bars) and
carry small inline SVG maps drawn from the same boundaries as the live map.
Every page links to its spot on the interactive map (/#region/suburb).
Nothing here is invented: suppressed or missing figures are simply left out.

Run after build.py:  python3 seo.py
"""
import html
import json
import math
import re
import shutil
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOCS = ROOT / "docs"
DATA = DOCS / "data"
SITE = "https://population.co.nz"
NAME = "NZ Census"
MIN_POP = 100   # skip water-only / near-empty areas: nothing useful to say about them
SEQ6 = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"]  # as palette.js

e = html.escape


def slug(name):
    """Same rule as slug() in docs/js/app.js, so page URLs match map links."""
    s = unicodedata.normalize("NFKD", name.lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def num(v):
    return None if v is None else format(int(round(v)), ",")


def money(v):
    return None if v is None else "$" + format(int(round(v)), ",")


def pct(v):
    return None if v is None else "%.1f%%" % v


def signed(v):
    return None if v is None else ("+" if v > 0 else "") + "%.1f%%" % v


def dec1(v):
    return None if v is None else "%.1f" % v


_index = (DOCS / "index.html").read_text()


def _grab(pattern):
    m = re.search(pattern, _index, re.S)
    return m.group(0) if m else ""


# reuse the analytics tags + icon from the main page so they stay in one place
GTM_HEAD = _grab(r"<!-- Google Tag Manager -->.*?<!-- End Google Tag Manager -->")
GTM_BODY = _grab(r"<!-- Google Tag Manager \(noscript\) -->.*?<!-- End Google Tag Manager \(noscript\) -->")
ICON = _grab(r'<link rel="icon"[^>]*>')

CSS = """
body{display:block;height:auto}
.topbar{position:sticky;top:0}
.topbar .brand a{font-size:16px;font-weight:650;color:inherit;text-decoration:none;display:block}
.pg{display:block;max-width:860px;margin:0 auto;padding:20px 18px 64px}
.pg a{color:var(--accent-ink)}
.pg .trail{font-size:12.5px;color:var(--muted);margin-bottom:16px}
.pg h1{font-size:30px;line-height:1.15;letter-spacing:-.01em;margin:0 0 4px}
.pg .where{color:var(--ink-2);font-size:14px;margin:0 0 18px}
.pg h2{font-size:15px;margin:30px 0 4px}
.pg .note{font-size:12px;color:var(--muted);margin:0 0 10px}
.pg p{color:var(--ink-2);line-height:1.6;margin:0 0 10px}
.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,340px);gap:18px;align-items:stretch}
.hero.wide{grid-template-columns:minmax(0,1fr) minmax(0,440px)}
.box .lead{margin:18px 0 0;font-size:13.5px}
.box{background:var(--surface);border:1px solid var(--grid);border-radius:14px;padding:18px 20px}
.big{font-size:44px;font-weight:700;letter-spacing:-.02em;line-height:1}
.big-label{font-size:12.5px;color:var(--ink-2);margin-bottom:6px}
.chip{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:999px;font-size:12.5px;
  font-weight:600;vertical-align:middle;background:var(--plane);border:1px solid var(--grid);color:var(--ink-2)}
.trend{display:flex;align-items:flex-end;gap:14px;height:92px;margin-top:20px}
.trend div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;
  height:100%;font-size:11.5px;color:var(--ink-2)}
.trend i{display:block;width:100%;max-width:74px;background:var(--accent);border-radius:5px 5px 0 0;opacity:.45}
.trend div:last-child i{opacity:1}
.trend b{font-size:12.5px;color:var(--ink);margin-bottom:3px}
.trend span{margin-top:4px}
.cta{display:inline-block;margin-top:18px;padding:10px 18px;border-radius:10px;
  background:var(--accent);color:#fff !important;text-decoration:none;font-weight:600}
.cta:hover{filter:brightness(1.08)}
.mapbox{display:flex;flex-direction:column;padding:12px}
.mapbox svg{display:block;width:100%;height:auto;flex:1;max-height:420px}
.mapbox figcaption{font-size:11.5px;color:var(--muted);margin-top:8px;text-align:center}
figure{margin:0}
svg .a{fill:var(--grid);stroke:var(--surface);stroke-width:.6}
svg .on{fill:var(--accent);stroke:var(--ink);stroke-width:1.2}
svg a:hover path{stroke:var(--ink);stroke-width:1.5}
svg .nd{fill:var(--nodata)}
.scale{white-space:nowrap;display:flex;align-items:center;gap:6px;justify-content:center;font-size:11.5px;color:var(--muted);margin-top:8px}
.scale i{width:22px;height:9px;border-radius:2px;display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.card{border:1px solid var(--grid);border-radius:10px;padding:10px 12px;background:var(--surface)}
.card span{display:block;font-size:11.5px;color:var(--ink-2)}
.card strong{font-size:20px;font-weight:650}
.card em{display:block;font-style:normal;font-size:11px;color:var(--muted)}
.bars{background:var(--surface);border:1px solid var(--grid);border-radius:12px;padding:12px 16px}
.bar{display:grid;grid-template-columns:128px 1fr 54px;align-items:center;gap:10px;padding:4px 0;font-size:12.5px}
.bar span{color:var(--ink-2)}
.bar b{text-align:right;font-weight:600}
.track{position:relative;height:16px}
.track i{position:absolute;left:0;top:0;bottom:0;background:var(--accent);border-radius:0 4px 4px 0;min-width:2px}
.track u{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink)}
.key{font-size:11px;color:var(--muted);margin-top:6px}
.key u{display:inline-block;width:2px;height:10px;background:var(--ink);vertical-align:middle;margin-right:5px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.pg h3{font-size:13.5px;margin:14px 0 2px}
.rk{display:flex;justify-content:space-between;gap:10px;padding:6px 0;font-size:13px;border-bottom:1px solid var(--grid)}
.rk:last-child{border:0}.rk a{text-decoration:none}.rk b{font-weight:600;white-space:nowrap}
.pg table{border-collapse:collapse;width:100%;font-size:13px}
.pg th,.pg td{padding:7px 10px;border-bottom:1px solid var(--grid);text-align:right;white-space:nowrap;
  font-variant-numeric:tabular-nums}
.pg th{position:sticky;top:0;background:var(--surface);font-weight:600;border-bottom-color:var(--baseline)}
.pg th:first-child,.pg td:first-child,.pg td.t,.pg th.t{text-align:left;white-space:normal}
.pg td.t{color:var(--ink-2)}
.pg tr:hover td{background:var(--plane)}
.scroll{overflow:auto;max-height:640px;border:1px solid var(--grid);border-radius:12px;background:var(--surface)}
ul.links{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px}
ul.links a{display:block;padding:5px 11px;border:1px solid var(--grid);border-radius:8px;
  background:var(--surface);text-decoration:none;font-size:13px}
ul.links a:hover{border-color:var(--accent)}
.pg footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--grid);font-size:11.5px;
  color:var(--muted);line-height:1.6}
@media (max-width:720px){
  .hero,.hero.wide,.two{grid-template-columns:1fr}
  .pg h1{font-size:25px}.big{font-size:38px}
  .bar{grid-template-columns:104px 1fr 50px}
  .topbar .sub{display:none}
}
"""


# ------------------------------------------------------------------ SVG maps

def rings(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        for ring in poly:
            yield ring


def svg_map(feats, width, cls_of, href_of=None, title_of=None, last=None, step=2):
    """Tiny inline map. Coordinates are snapped to whole units of the viewBox
    and points closer than `step` units to the previous one are dropped: far
    below what the eye can see at this size, and it keeps the pages light."""
    xs = [p[0] for f in feats for r in rings(f["geometry"]) for p in r]
    ys = [p[1] for f in feats for r in rings(f["geometry"]) for p in r]
    if not xs:
        return ""
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    k = math.cos(math.radians((miny + maxy) / 2))   # longitude degrees are narrower
    w_deg, h_deg = max((maxx - minx) * k, 1e-9), max(maxy - miny, 1e-9)
    scale = min(width / w_deg, width * 1.25 / h_deg)   # never taller than 1.25 x width
    W, H = max(int(w_deg * scale), 1), max(int(h_deg * scale), 1)

    def path(f):
        out = []
        for ring in rings(f["geometry"]):
            pts = []
            for x, y in ring:
                p = (round((x - minx) * k * scale), round((maxy - y) * scale))
                if not pts or abs(p[0] - pts[-1][0]) + abs(p[1] - pts[-1][1]) >= step:
                    pts.append(p)
            if len(pts) >= 3:
                out.append("M" + " ".join("%d %d" % p for p in pts) + "Z")
        return "".join(out)

    parts = []
    ordered = sorted(feats, key=lambda f: f is last)   # draw the highlighted shape on top
    for f in ordered:
        d = path(f)
        if not d:
            continue
        t = title_of(f) if title_of else None
        shape = '<path class="%s" d="%s"%s' % (cls_of(f), d, ">" if t else "/>")
        if t:
            shape += "<title>%s</title></path>" % e(t)
        href = href_of(f) if href_of else None
        parts.append('<a href="%s">%s</a>' % (href, shape) if href else shape)
    return ('<svg viewBox="-3 -3 %d %d" role="img" fill-rule="evenodd">%s</svg>'
            % (W + 6, H + 6, "".join(parts)))


# ------------------------------------------------------------------ pieces

def cards(items):
    """items: (label, value, reference-line or None); None values are dropped."""
    return '<div class="grid">%s</div>' % "".join(
        '<div class="card"><span>%s</span><strong>%s</strong>%s</div>'
        % (e(l), e(v), "<em>%s</em>" % e(r) if r else "")
        for l, v, r in items if v is not None)


def bars(rows, ref_name):
    """rows: (label, value %, reference % or None). Horizontal bars with a tick
    at the reference value, like the charts in the map's detail panel."""
    rows = [r for r in rows if r[1] is not None]
    if not rows:
        return ""
    top = max(max(v, ref or 0) for _, v, ref in rows) * 1.05 or 1
    out = "".join(
        '<div class="bar"><span>%s</span><div class="track"><i style="width:%.1f%%"></i>%s</div>'
        '<b>%s</b></div>' % (
            e(l), 100 * v / top,
            '<u style="left:%.1f%%" title="%s: %s"></u>' % (100 * ref / top, e(ref_name), pct(ref))
            if ref is not None else "", pct(v))
        for l, v, ref in rows)
    return '<div class="bars">%s<div class="key"><u></u>%s average</div></div>' % (out, e(ref_name))


def trend(a):
    pts = [(y, a.get(k)) for y, k in (("2013", "pop2013"), ("2018", "pop2018"), ("2023", "pop2023"))]
    pts = [(y, v) for y, v in pts if v]
    if len(pts) < 2:
        return ""
    top = max(v for _, v in pts)
    return '<div class="trend">%s</div>' % "".join(
        '<div><b>%s</b><i style="height:%d%%"></i><span>%s</span></div>'
        % (num(v), max(6, round(70 * v / top)), y) for y, v in pts)


def page(path, title, desc, crumbs, body, map_href):
    """crumbs: [(label, url-or-None)] - also emitted as BreadcrumbList JSON-LD."""
    url = SITE + path
    trail = " › ".join(
        '<a href="%s">%s</a>' % (u, e(l)) if u else e(l) for l, u in crumbs)
    ld = {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": l,
             "item": SITE + (u or path)} for i, (l, u) in enumerate(crumbs)],
    }
    out = """<!DOCTYPE html>
<html lang="en-NZ">
<head>
%s
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s</title>
<meta name="description" content="%s">
<link rel="canonical" href="%s">
<meta property="og:type" content="website">
<meta property="og:site_name" content="%s">
<meta property="og:title" content="%s">
<meta property="og:description" content="%s">
<meta property="og:url" content="%s">
<meta property="og:image" content="%s/og-card.png">
<meta name="twitter:card" content="summary_large_image">
%s
<link rel="stylesheet" href="/css/style.css">
<style>%s</style>
<script type="application/ld+json">%s</script>
</head>
<body>
%s
<header class="topbar">
  <div class="brand"><a href="/">%s</a><span class="sub">every suburb · 2013–2023 · NZDep2023</span></div>
  <div class="topbar-right"><a class="btn" href="%s" style="text-decoration:none">Interactive map</a></div>
</header>
<main class="pg">
<nav class="trail" aria-label="Breadcrumb">%s</nav>
%s
<footer>Figures are from the Stats NZ 2023 Census (licensed CC BY 4.0) and other public
sources, adapted by this site: percentages and regional figures are our own calculations.
Areas are Stats NZ “SA2” statistical areas, which only approximate suburbs. General
information only. <a href="/#sources">Sources &amp; privacy</a></footer>
</main>
</body>
</html>
""" % (GTM_HEAD, e(title), e(desc), url, NAME, e(title), e(desc), url, SITE, ICON, CSS,
       json.dumps(ld, ensure_ascii=False), GTM_BODY, NAME, map_href, trail, body)
    dest = DOCS / path.strip("/") / "index.html"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(out)


def sentence(parts):
    return ", ".join(p for p in parts if p)


def people_sections(a, ref, ref_name):
    """age + ethnicity + travel bars for a suburb or a region, against its parent."""
    age = bars([(k.replace("-", "–") + " years" if k != "65+" else "65 and over",
                 v["pct"], ref["age"][k]["pct"]) for k, v in a["age"].items()], ref_name)
    eth = bars(sorted(((k, v["pct"], ref["ethnicity"][k]["pct"])
                       for k, v in a["ethnicity"].items() if v["pct"] is not None),
                      key=lambda r: -r[1]), ref_name)
    travel = bars([(k, v["pct"], ref["travel"][k]["pct"]) for k, v in a["travel"].items()], ref_name)
    out = ""
    if age or eth:
        out += '<div class="two">'
        if age:
            out += "<div><h2>Age</h2><p class=\"note\">Share of residents, 2023.</p>%s</div>" % age
        if eth:
            out += ("<div><h2>Ethnicity</h2><p class=\"note\">People can identify with more than "
                    "one group, so shares add to more than 100%%.</p>%s</div>" % eth)
        out += "</div>"
    if travel:
        out += ("<h2>Getting to work</h2><p class=\"note\">Main way of travelling to work, as a "
                "share of employed people who stated one, 2023.</p>%s" % travel)
    return out


# ------------------------------------------------------------------ pages

def suburb_page(s, reg, peers, feats):
    rs, ss = reg["slug"], slug(s["name"])
    path = "/%s/%s/" % (rs, ss)
    rn = reg["name"]
    where = s["board"] + (" Local Board" if reg["board_label"] == "Local board" else "")
    pop = num(s["pop2023"])
    title = "%s population and demographics, 2023 Census | %s" % (s["name"], rn)
    desc = sentence([
        "%s (%s, %s) had %s residents at the 2023 Census" % (s["name"], where, rn, pop),
        s["pop_change_pct"] is not None and "%s since 2018" % signed(s["pop_change_pct"]),
        s["median_age"] is not None and "median age %.1f" % s["median_age"],
        s["median_income"] is not None and "median income %s" % money(s["median_income"]),
        s["median_rent"] is not None and "median rent %s a week" % money(s["median_rent"]),
    ]) + "."

    # locator: this suburb within its district / local board
    codes = {p["code"] for p in peers} | {s["code"]}
    local = [f for f in feats if f["properties"]["code"] in codes]
    me = next((f for f in local if f["properties"]["code"] == s["code"]), None)
    locator = svg_map(local, 320, lambda f: "on" if f is me else "a", last=me, step=3) if me else ""
    mapbox = ('<figure class="box mapbox">%s<figcaption>%s within %s</figcaption></figure>'
              % (locator, e(s["name"]), e(where))) if locator else ""

    lead = "%s is in %s, %s." % (e(s["name"]), e(where), e(rn))
    if s["pop_change_pct"] is not None:
        lead += " Its population %s %.1f%% between the 2018 and 2023 censuses." % (
            "grew" if s["pop_change_pct"] >= 0 else "fell", abs(s["pop_change_pct"]))
    if s["median_age"] is not None and reg["median_age"] is not None:
        lead += " The median age is %.1f, compared with %.1f across %s." % (
            s["median_age"], reg["median_age"], e(rn))
    # the questions people type into search, answered in a sentence each
    n = e(s["name"])
    qa = [("What is the population of %s?" % n,
           "%s had %s usually resident people at the 2023 Census%s." % (
               n, pop, (", %s %.1f%% from %s in 2018" % (
                   "up" if s["pop_change_pct"] >= 0 else "down", abs(s["pop_change_pct"]),
                   num(s["pop2018"]))) if s["pop_change_pct"] is not None else ""))]
    if s["median_income"] is not None:
        qa.append(("What is the median income in %s?" % n,
                   "The median personal income in %s is %s a year (2023 Census, people aged 15 "
                   "and over)%s." % (n, money(s["median_income"]),
                                     ", compared with %s across %s" % (money(reg["median_income"]), e(rn))
                                     if reg["median_income"] is not None else "")))
    if s["median_rent"] is not None:
        qa.append(("How much is rent in %s?" % n,
                   "Households renting in %s paid a median of %s a week at the 2023 Census%s." % (
                       n, money(s["median_rent"]),
                       (". Newly lodged bonds more recently had a median rent of %s a week"
                        % money(s["bond_rent"])) if s["bond_rent"] is not None else "")))
    if s["median_age"] is not None:
        qa.append(("What is the median age in %s?" % n,
                   "The median age in %s is %.1f years (2023 Census)." % (n, s["median_age"])))
    qa = "<h2>Quick answers</h2>" + "".join("<h3>%s</h3><p>%s</p>" % q for q in qa)
    ref = lambda v, f: None if v is None else "%s %s" % (rn, f(v))
    body = """<h1>%s population and demographics</h1>
<p class="where">%s · %s%s</p>
<div class="hero">
  <div class="box">
    <div class="big-label">Population, 2023 Census</div>
    <div><span class="big">%s</span>%s</div>
    %s
    <p class="lead">%s</p>
    <a class="cta" href="/#%s/%s">Open on the interactive map</a>
  </div>
  %s
</div>
<h2>Income and work</h2>
%s
<h2>Housing</h2>
%s
%s
<h2>Nearby in %s</h2>
<ul class="links">%s</ul>
""" % (
        e(s["name"]), e(where), e(rn),
        (" · part of the wider %s area" % e(s["colloquial"])) if s["colloquial"] else "",
        pop,
        ('<span class="chip">%s since 2018</span>' % signed(s["pop_change_pct"]))
        if s["pop_change_pct"] is not None else "",
        trend(s), lead, rs, ss, mapbox,
        cards([
            ("Median personal income", money(s["median_income"]), ref(reg["median_income"], money)),
            ("Median household income", money(s["median_hh_income"]), ref(reg["median_hh_income"], money)),
            ("Median age", dec1(s["median_age"]), ref(reg["median_age"], dec1)),
            ("Bachelor's degree or higher", pct(s["bachelor_pct"]), ref(reg["bachelor_pct"], pct)),
            ("Unemployment rate", pct(s["unemployment_pct"]), ref(reg["unemployment_pct"], pct)),
            ("Born overseas", pct(s["overseas_born_pct"]), ref(reg["overseas_born_pct"], pct)),
            ("NZDep2023 decile", None if s["dep_decile"] is None else "%d of 10" % s["dep_decile"],
             "10 = most deprived"),
        ]),
        cards([
            ("Own or partly own home", pct(s["home_own_pct"]), ref(reg["home_own_pct"], pct)),
            ("Median weekly rent (census)", money(s["median_rent"]), ref(reg["median_rent"], money)),
            ("Median weekly rent (new bonds)", money(s["bond_rent"]), ref(reg["bond_rent"], money)),
            ("Stand-alone houses", pct(s["separate_house_pct"]), ref(reg["separate_house_pct"], pct)),
            ("Crowded households", pct(s["crowded_pct"]), ref(reg["crowded_pct"], pct)),
            ("Damp homes", pct(s["damp_pct"]), ref(reg["damp_pct"], pct)),
        ]),
        people_sections(s, reg, rn) + qa,
        e(where),
        "".join('<li><a href="/%s/%s/">%s</a></li>' % (rs, slug(p["name"]), e(p["name"]))
                for p in peers if p["code"] != s["code"]) or
        '<li><a href="/%s/">All %s suburbs</a></li>' % (rs, e(rn)),
    )
    page(path, title, desc,
         [("New Zealand", "/"), (rn, "/%s/" % rs), (s["name"], None)], body,
         "/#%s/%s" % (rs, ss))
    return path


def region_page(reg, subs, feats, nz):
    rs, rn = reg["slug"], reg["name"]
    path = "/%s/" % rs
    title = "%s population by suburb, 2023 Census | %s" % (rn, NAME)
    desc = sentence([
        "%s had %s residents at the 2023 Census" % (rn, num(reg["pop2023"])),
        reg["pop_change_pct"] is not None and "%s since 2018" % signed(reg["pop_change_pct"]),
        "Population, age, income and rent for all %d suburbs" % len(subs),
    ]) + "."

    # choropleth of suburb populations; each shape links to its page
    paged = {s["code"]: s for s in subs}
    vals = sorted(s["pop2023"] for s in subs)
    cuts = [vals[int(q * (len(vals) - 1) / 6)] for q in range(1, 6)] if vals else []

    def cls(f):
        s = paged.get(f["properties"]["code"])
        return "nd" if s is None else "c%d" % sum(s["pop2023"] >= c for c in cuts)

    big = svg_map(
        feats, 700, cls, step=4,
        href_of=lambda f: ("/%s/%s/" % (rs, slug(f["properties"]["name"]))
                           if f["properties"]["code"] in paged else None),
        title_of=lambda f: ("%s: %s people" % (f["properties"]["name"],
                                              num(paged[f["properties"]["code"]]["pop2023"]))
                            if f["properties"]["code"] in paged else None))
    scale = ('<div class="scale">Fewer people %s More people</div>'
             % "".join('<i style="background:%s"></i>' % c for c in SEQ6))
    palette = "".join("svg .c%d{fill:%s;stroke:var(--surface);stroke-width:.6}" % (i, c)
                      for i, c in enumerate(SEQ6))

    lead = "%s is home to %.1f%% of New Zealand's population." % (
        e(rn), 100.0 * reg["pop2023"] / nz["pop2023"])
    if reg["pop_change_pct"] is not None:
        lead += " It %s %.1f%% between the 2018 and 2023 censuses." % (
            "grew" if reg["pop_change_pct"] >= 0 else "shrank", abs(reg["pop_change_pct"]))
    # the two lists people most often search for
    def ranked(heading, note, items, value):
        return '<div><h2>%s</h2><p class="note">%s</p><div class="bars">%s</div></div>' % (
            e(heading), e(note), "".join(
                '<div class="rk"><a href="/%s/%s/">%d. %s</a><b>%s</b></div>'
                % (rs, slug(s["name"]), i + 1, e(s["name"]), value(s))
                for i, s in enumerate(items)))
    biggest = sorted(subs, key=lambda s: -s["pop2023"])[:10]
    growing = sorted((s for s in subs if s["pop_change_pct"] is not None
                      and (s["pop2018"] or 0) >= 500),
                     key=lambda s: -s["pop_change_pct"])[:10]
    ranks = '<div class="two">%s%s</div>' % (
        ranked("Largest suburbs in %s" % rn, "By usually resident population, 2023 Census.",
               biggest, lambda s: num(s["pop2023"])),
        ranked("Fastest-growing suburbs in %s" % rn,
               "Population change 2018 to 2023, suburbs with at least 500 people in 2018.",
               growing, lambda s: signed(s["pop_change_pct"]))) if len(subs) >= 10 else ""
    ref = lambda v, f: None if v is None else "NZ %s" % f(v)
    rows = "".join(
        '<tr><td><a href="/%s/%s/">%s</a></td><td class="t">%s</td><td>%s</td><td>%s</td>'
        '<td>%s</td><td>%s</td><td>%s</td></tr>' % (
            rs, slug(s["name"]), e(s["name"]), e(s["board"]), num(s["pop2023"]),
            signed(s["pop_change_pct"]) or "", dec1(s["median_age"]) or "",
            money(s["median_income"]) or "", money(s["median_rent"]) or "")
        for s in sorted(subs, key=lambda s: s["name"]))
    body = """<style>%s</style>
<h1>%s population by suburb</h1>
<p class="where">%s · %d suburbs and localities</p>
<div class="hero wide">
  <div class="box">
    <div class="big-label">Population, 2023 Census</div>
    <div><span class="big">%s</span>%s</div>
    %s
    <p class="lead">%s</p>
    <a class="cta" href="/#%s">Open on the interactive map</a>
  </div>
  <figure class="box mapbox">%s%s<figcaption>Suburbs of %s by population. Select one for its profile.</figcaption></figure>
</div>
<h2>Key figures</h2>
<p class="note">2023 Census. Regional medians are estimates built from the suburb medians.</p>
%s
%s
<h2>All suburbs in %s</h2>
<div class="scroll"><table>
<tr><th>Suburb</th><th class="t">%s</th><th>Population</th><th>Since 2018</th><th>Median age</th><th>Median income</th><th>Weekly rent</th></tr>
%s
</table></div>
""" % (
        palette, e(rn), e(reg["island"]), len(subs), num(reg["pop2023"]),
        ('<span class="chip">%s since 2018</span>' % signed(reg["pop_change_pct"]))
        if reg["pop_change_pct"] is not None else "",
        trend(reg), lead, rs, big, scale, e(rn),
        cards([
            ("Median personal income", money(reg["median_income"]), ref(nz["median_income"], money)),
            ("Median household income", money(reg["median_hh_income"]), ref(nz["median_hh_income"], money)),
            ("Median age", dec1(reg["median_age"]), ref(nz["median_age"], dec1)),
            ("Median weekly rent", money(reg["median_rent"]), ref(nz["median_rent"], money)),
            ("Own or partly own home", pct(reg["home_own_pct"]), ref(nz["home_own_pct"], pct)),
            ("Bachelor's degree or higher", pct(reg["bachelor_pct"]), ref(nz["bachelor_pct"], pct)),
            ("Unemployment rate", pct(reg["unemployment_pct"]), ref(nz["unemployment_pct"], pct)),
            ("Born overseas", pct(reg["overseas_born_pct"]), ref(nz["overseas_born_pct"], pct)),
        ]),
        people_sections(reg, nz, "New Zealand") + ranks,
        e(rn), e(reg["board_label"]), rows)
    page(path, title, desc, [("New Zealand", "/"), (rn, None)], body, "/#" + rs)
    return path


def main():
    nz = json.loads((DATA / "nz.json").read_text())
    paths = ["/"]
    n = 0
    for reg in nz["regions"]:
        old = DOCS / reg["slug"]
        if old.exists():
            shutil.rmtree(old)   # regenerate cleanly; these folders hold only generated pages
        d = DATA / "r" / reg["slug"]
        subs = [s for s in json.loads((d / "suburbs.json").read_text())["suburbs"]
                if (s["pop2023"] or 0) >= MIN_POP]
        feats = json.loads((d / "geo.geojson").read_text())["features"]
        paths.append(region_page(reg, subs, feats, nz["nz"]))
        by_board = {}
        for s in subs:
            by_board.setdefault(s["board"], []).append(s)
        for s in subs:
            peers = sorted(by_board[s["board"]], key=lambda p: p["name"])
            paths.append(suburb_page(s, reg, peers, feats))
            n += 1
    (DOCS / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "".join("<url><loc>%s%s</loc><lastmod>%s</lastmod></url>\n"
                % (SITE, p, nz["generated"]) for p in paths) + "</urlset>\n")
    (DOCS / "robots.txt").write_text("User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n" % SITE)
    print("wrote %d region pages, %d suburb pages, sitemap.xml (%d urls), robots.txt"
          % (len(nz["regions"]), n, len(paths)))


if __name__ == "__main__":
    main()
