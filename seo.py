#!/usr/bin/env python3
"""
Static, crawlable pages for search engines.

The interactive map is a single page that routes on #fragments, which search
engines do not index. This script reads the data build.py already produced
(docs/data/) and writes plain HTML pages with the same figures:

  docs/<region>/index.html            one per region, listing its suburbs
  docs/<region>/<suburb>/index.html   one per populated suburb (SA2)
  docs/sitemap.xml, docs/robots.txt

Every page links to its spot on the interactive map (/#region/suburb).
Nothing here is invented: suppressed or missing figures are simply left out.

Run after build.py:  python3 seo.py
"""
import html
import json
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


def gtm_snippets():
    """Reuse the analytics tags from the main page so they stay in one place."""
    src = (DOCS / "index.html").read_text()
    head = re.search(r"<!-- Google Tag Manager -->.*?<!-- End Google Tag Manager -->", src, re.S)
    body = re.search(r"<!-- Google Tag Manager \(noscript\) -->.*?"
                     r"<!-- End Google Tag Manager \(noscript\) -->", src, re.S)
    return (head.group(0) if head else ""), (body.group(0) if body else "")


GTM_HEAD, GTM_BODY = gtm_snippets()
_icon = re.search(r'<link rel="icon"[^>]*>', (DOCS / "index.html").read_text())
ICON = _icon.group(0) if _icon else ""

CSS = """
body{display:block;height:auto}
.pg{display:block;max-width:780px;margin:0 auto;padding:22px 18px 60px}
.pg a{color:var(--accent-ink)}
.pg .crumbs{font-size:12.5px;color:var(--muted);margin-bottom:14px}
.pg h1{font-size:26px;line-height:1.2;margin:0 0 6px}
.pg h2{font-size:16px;margin:28px 0 8px}
.pg p{color:var(--ink-2);line-height:1.6;margin:0 0 10px}
.pg .cta{display:inline-block;margin:10px 0 4px;padding:9px 16px;border-radius:9px;
  background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
.pg .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.pg .card{border:1px solid var(--grid);border-radius:10px;padding:9px 11px;background:var(--surface)}
.pg .card span{display:block;font-size:11.5px;color:var(--ink-2)}
.pg .card strong{font-size:19px}
.pg table{border-collapse:collapse;width:100%;font-size:13px;background:var(--surface)}
.pg th,.pg td{padding:6px 9px;border-bottom:1px solid var(--grid);text-align:right;white-space:nowrap}
.pg th:first-child,.pg td:first-child{text-align:left;white-space:normal}
.pg .scroll{overflow-x:auto;border:1px solid var(--grid);border-radius:10px}
.pg ul.links{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px}
.pg ul.links a{display:block;padding:4px 10px;border:1px solid var(--grid);border-radius:8px;
  background:var(--surface);text-decoration:none;font-size:13px}
.pg footer{margin-top:36px;font-size:11.5px;color:var(--muted);line-height:1.6}
"""


def page(path, title, desc, crumbs, body):
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
<main class="pg">
<nav class="crumbs" aria-label="Breadcrumb">%s</nav>
%s
<footer>Figures are from the Stats NZ 2023 Census (licensed CC BY 4.0) and other public
sources, adapted by this site: percentages and regional figures are our own calculations.
Areas are Stats NZ “SA2” statistical areas, which only approximate suburbs. General
information only. <a href="/#sources">Sources &amp; privacy</a></footer>
</main>
</body>
</html>
""" % (GTM_HEAD, e(title), e(desc), url, NAME, e(title), e(desc), url, SITE, ICON, CSS,
       json.dumps(ld, ensure_ascii=False), GTM_BODY, trail, body)
    dest = DOCS / path.strip("/") / "index.html"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(out)


def cards(items):
    return '<div class="grid">%s</div>' % "".join(
        '<div class="card"><span>%s</span><strong>%s</strong></div>' % (e(l), e(v))
        for l, v in items if v is not None)


def sentence(parts):
    return ", ".join(p for p in parts if p)


def suburb_page(s, reg, peers):
    rs, ss = reg["slug"], slug(s["name"])
    path = "/%s/%s/" % (rs, ss)
    where = s["board"] + (" Local Board" if reg["board_label"] == "Local board" else "")
    pop = num(s["pop2023"])
    title = "%s population and demographics, 2023 Census | %s" % (s["name"], reg["name"])
    desc = sentence([
        "%s (%s, %s) had %s residents at the 2023 Census" % (s["name"], where, reg["name"], pop),
        s["pop_change_pct"] is not None and "%s since 2018" % signed(s["pop_change_pct"]),
        s["median_age"] is not None and "median age %.1f" % s["median_age"],
        s["median_income"] is not None and "median income %s" % money(s["median_income"]),
        s["median_rent"] is not None and "median rent %s a week" % money(s["median_rent"]),
    ]) + "."
    eth = [(k, v["pct"]) for k, v in s["ethnicity"].items() if v["pct"] is not None]
    eth.sort(key=lambda x: -x[1])
    body = """<h1>%s population and demographics</h1>
<p>%s is a statistical area in %s, %s. At the 2023 Census it had <strong>%s</strong>
usually resident people%s.%s</p>
<a class="cta" href="/#%s/%s">Open %s on the interactive map</a>
<h2>Key figures (2023 Census)</h2>
%s
<h2>Housing</h2>
%s
%s
<h2>Nearby in %s</h2>
<ul class="links">%s</ul>
""" % (
        e(s["name"]), e(s["name"]), e(where), e(reg["name"]), pop,
        (" (%s since 2018)" % signed(s["pop_change_pct"])) if s["pop_change_pct"] is not None else "",
        (" It is part of the wider %s area." % e(s["colloquial"])) if s["colloquial"] else "",
        rs, ss, e(s["name"]),
        cards([
            ("Population 2023", pop), ("Population 2018", num(s["pop2018"])),
            ("Population 2013", num(s["pop2013"])),
            ("Median age", s["median_age"] is not None and "%.1f" % s["median_age"] or None),
            ("Median personal income", money(s["median_income"])),
            ("Median household income", money(s["median_hh_income"])),
            ("Bachelor's degree or higher", pct(s["bachelor_pct"])),
            ("Unemployment rate", pct(s["unemployment_pct"])),
            ("Born overseas", pct(s["overseas_born_pct"])),
            ("NZDep2023 decile (10 = most deprived)",
             None if s["dep_decile"] is None else str(s["dep_decile"])),
        ]),
        cards([
            ("Own or partly own home", pct(s["home_own_pct"])),
            ("Median weekly rent (census)", money(s["median_rent"])),
            ("Median weekly rent (new bonds)", money(s["bond_rent"])),
            ("Stand-alone houses", pct(s["separate_house_pct"])),
            ("Crowded households", pct(s["crowded_pct"])),
            ("Damp homes", pct(s["damp_pct"])),
        ]),
        ("<h2>Ethnicity</h2><p>Share of people who stated an ethnicity. People can identify "
         "with more than one group, so these add to more than 100%%.</p>%s"
         % cards([(k, pct(v)) for k, v in eth])) if eth else "",
        e(where),
        "".join('<li><a href="/%s/%s/">%s</a></li>' % (rs, slug(p["name"]), e(p["name"]))
                for p in peers if p["code"] != s["code"]) or
        '<li><a href="/%s/">All %s suburbs</a></li>' % (rs, e(reg["name"])),
    )
    page(path, title, desc,
         [("New Zealand", "/"), (reg["name"], "/%s/" % rs), (s["name"], None)], body)
    return path


def region_page(reg, subs):
    rs = reg["slug"]
    path = "/%s/" % rs
    title = "%s population by suburb, 2023 Census | %s" % (reg["name"], NAME)
    desc = sentence([
        "%s had %s residents at the 2023 Census" % (reg["name"], num(reg["pop2023"])),
        reg["pop_change_pct"] is not None and "%s since 2018" % signed(reg["pop_change_pct"]),
        "Population, age, income and rent for all %d suburbs" % len(subs),
    ]) + "."
    rows = "".join(
        '<tr><td><a href="/%s/%s/">%s</a></td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (
            rs, slug(s["name"]), e(s["name"]), num(s["pop2023"]),
            signed(s["pop_change_pct"]) or "",
            ("%.1f" % s["median_age"]) if s["median_age"] is not None else "",
            money(s["median_income"]) or "")
        for s in sorted(subs, key=lambda s: s["name"]))
    body = """<h1>%s population by suburb</h1>
<p>%s had <strong>%s</strong> usually resident people at the 2023 Census%s, across %d
suburbs and localities.</p>
<a class="cta" href="/#%s">Open %s on the interactive map</a>
<h2>Key figures (2023 Census)</h2>
%s
<h2>Suburbs in %s</h2>
<div class="scroll"><table>
<tr><th>Suburb</th><th>Population 2023</th><th>Change since 2018</th><th>Median age</th><th>Median income</th></tr>
%s
</table></div>
""" % (
        e(reg["name"]), e(reg["name"]), num(reg["pop2023"]),
        (" (%s since 2018)" % signed(reg["pop_change_pct"])) if reg["pop_change_pct"] is not None else "",
        len(subs), rs, e(reg["name"]),
        cards([
            ("Population 2023", num(reg["pop2023"])), ("Population 2018", num(reg["pop2018"])),
            ("Median age (estimate)", "%.1f" % reg["median_age"]),
            ("Median personal income (estimate)", money(reg["median_income"])),
            ("Median weekly rent (estimate)", money(reg["median_rent"])),
            ("Own or partly own home", pct(reg["home_own_pct"])),
            ("Bachelor's degree or higher", pct(reg["bachelor_pct"])),
            ("Born overseas", pct(reg["overseas_born_pct"])),
        ]),
        e(reg["name"]), rows)
    page(path, title, desc, [("New Zealand", "/"), (reg["name"], None)], body)
    return path


def main():
    nz = json.loads((DATA / "nz.json").read_text())
    paths = ["/"]
    n = 0
    for reg in nz["regions"]:
        old = DOCS / reg["slug"]
        if old.exists():
            shutil.rmtree(old)   # regenerate cleanly; these folders hold only generated pages
        subs = [s for s in json.loads(
            (DATA / "r" / reg["slug"] / "suburbs.json").read_text())["suburbs"]
            if (s["pop2023"] or 0) >= MIN_POP]
        paths.append(region_page(reg, subs))
        by_board = {}
        for s in subs:
            by_board.setdefault(s["board"], []).append(s)
        for s in subs:
            peers = sorted(by_board[s["board"]], key=lambda p: p["name"])[:40]
            paths.append(suburb_page(s, reg, peers))
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
