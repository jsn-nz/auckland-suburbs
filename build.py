#!/usr/bin/env python3
"""
Auckland suburb profiles - data pipeline.

Downloads (if not already present in data/raw/):
  1. Stats NZ 2023 Census totals by topic for individuals by SA2, parts 1 & 2
     (Datafinder layers 120897 / 120898) + their column lookup tables
     (documents 25543 / 25542) - CSV via WFS. Requires STATS_NZ_API_KEY.
  2. Geographic Areas Table 2023 (Datafinder table 111243) - meshblock-level
     concordance used to map SA2 -> region / local board / SA3.
  3. Statistical Area 2 2023 Clipped (generalised) boundaries
     (Datafinder layer 111206) as WGS84 GeoJSON.
  4. NZDep2023 SA2-level index (NZDep2023_WgtAvSA2.xlsx, University of Otago).
     Otago's WAF blocks non-browser clients; falls back to the Internet
     Archive's byte-identical capture of the same official file.

Then filters to Auckland region, joins everything on SA2 2023 code (never
name), computes derived metrics, and emits:
  docs/data/auckland.geojson - simplified geometry + core choropleth metrics
  docs/data/suburbs.json     - full per-SA2 detail + regional reference values

Data-correctness rules honoured here:
  * Ethnicity is multi-response: shares are computed against "total stated"
    and intentionally sum to >100%. Never normalised.
  * Counts are randomly rounded to base 3 by Stats NZ; not "fixed".
  * Suppressed cells arrive as -999 and become null; never estimated.
  * NZDep2023 decile 1 = LEAST deprived, 10 = most deprived.
  * If a download fails or the schema doesn't match expectations, the script
    aborts loudly. It never substitutes hardcoded figures.

Re-run:  python3 build.py           (uses cached raw files)
         python3 build.py --force   (re-downloads everything)
"""
import csv
import io
import json
import os
import subprocess
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "docs" / "data"
SUPPRESSED = -999  # Stats NZ confidentiality sentinel in these layers

csv.field_size_limit(sys.maxsize)

# ---------------------------------------------------------------- downloads

DATAFINDER = "https://datafinder.stats.govt.nz"

SOURCES = {
    "census_sa2_part1.csv": {
        "url": DATAFINDER + "/services;key={key}/wfs/layer-120897"
               "?service=WFS&version=2.0.0&request=GetFeature"
               "&typeNames=layer-120897&outputFormat=csv",
        "desc": "2023 Census totals by topic for individuals by SA2 - part 1 (layer 120897)",
    },
    "census_sa2_part2.csv": {
        "url": DATAFINDER + "/services;key={key}/wfs/layer-120898"
               "?service=WFS&version=2.0.0&request=GetFeature"
               "&typeNames=layer-120898&outputFormat=csv",
        "desc": "2023 Census totals by topic for individuals by SA2 - part 2 (layer 120898)",
    },
    "census_sa2_part1_lookup.csv": {
        "url": DATAFINDER + "/services/api/v1/documents/25543/versions/27388/download/?key={key}",
        "desc": "Part 1 column lookup table (document 25543)",
    },
    "census_sa2_part2_lookup.csv": {
        "url": DATAFINDER + "/services/api/v1/documents/25542/versions/27344/download/?key={key}",
        "desc": "Part 2 column lookup table (document 25542)",
    },
    "geographic_areas_2023.csv": {
        "url": DATAFINDER + "/services;key={key}/wfs/table-111243"
               "?service=WFS&version=2.0.0&request=GetFeature"
               "&typeNames=table-111243&outputFormat=csv",
        "desc": "Geographic Areas Table 2023 (table 111243)",
    },
    "sa2_2023_clipped_generalised.geojson": {
        "url": DATAFINDER + "/services;key={key}/wfs/layer-111206"
               "?service=WFS&version=2.0.0&request=GetFeature"
               "&typeNames=layer-111206&outputFormat=application/json"
               "&srsName=urn:ogc:def:crs:EPSG::4326",
        "desc": "Statistical Area 2 2023 Clipped (generalised) boundaries (layer 111206)",
    },
}

NZDEP_FILE = "NZDep2023_WgtAvSA2.xlsx"
NZDEP_LIVE = ("https://www.otago.ac.nz/__data/assets/excel_doc/0024/593142/"
              "NZDep2023_WgtAvSA2.xlsx")
NZDEP_ARCHIVE = ("https://web.archive.org/web/20241130120032id_/" + NZDEP_LIVE)


def die(msg):
    sys.exit("\nBUILD ABORTED: " + msg + "\nNothing was emitted. Fix the issue and re-run.")


def load_api_key():
    key = os.environ.get("STATS_NZ_API_KEY")
    if not key:
        env = ROOT / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("STATS_NZ_API_KEY="):
                    key = line.split("=", 1)[1].strip()
    if not key:
        die("STATS_NZ_API_KEY not set (env var or .env file). Get a free key at "
            "https://datafinder.stats.govt.nz/my/api/")
    return key


def fetch(url, dest, min_bytes=1000):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            data = r.read()
    except Exception as e:
        raise RuntimeError("download failed: %s (%s)" % (url.split("?")[0], e))
    if len(data) < min_bytes or data[:5] in (b"<!DOC", b"<html"):
        raise RuntimeError("unexpected response (HTML error page or too small) from "
                           + url.split("?")[0])
    dest.write_bytes(data)
    return len(data)


def download_all(force=False):
    RAW.mkdir(parents=True, exist_ok=True)
    key = load_api_key()
    manifest = {}
    mpath = RAW / "manifest.json"
    if mpath.exists():
        manifest = json.loads(mpath.read_text())

    for name, src in SOURCES.items():
        dest = RAW / name
        if dest.exists() and not force:
            print("  cached   %s" % name)
            continue
        print("  fetching %s ..." % name)
        try:
            n = fetch(src["url"].format(key=key), dest)
        except RuntimeError as e:
            die(str(e))
        manifest[name] = {"downloaded": date.today().isoformat(),
                          "bytes": n, "source": src["desc"]}

    dest = RAW / NZDEP_FILE
    if not dest.exists() or force:
        print("  fetching %s ..." % NZDEP_FILE)
        used = NZDEP_LIVE
        try:
            n = fetch(NZDEP_LIVE, dest, min_bytes=50000)
        except RuntimeError:
            print("           otago.ac.nz blocked the request; using the Internet "
                  "Archive capture of the same file")
            used = NZDEP_ARCHIVE
            try:
                n = fetch(NZDEP_ARCHIVE, dest, min_bytes=50000)
            except RuntimeError as e:
                die(str(e))
        manifest[NZDEP_FILE] = {"downloaded": date.today().isoformat(),
                                "bytes": n,
                                "source": "NZDep2023 SA2 weighted averages, "
                                          "University of Otago (" + used + ")"}
    else:
        print("  cached   %s" % NZDEP_FILE)

    for name in list(SOURCES) + [NZDEP_FILE]:
        manifest.setdefault(name, {"downloaded": date.today().isoformat(),
                                   "bytes": (RAW / name).stat().st_size,
                                   "source": SOURCES.get(name, {}).get("desc", NZDEP_LIVE)})
    mpath.write_text(json.dumps(manifest, indent=2))
    return manifest

# ------------------------------------------------------------ column checks

# Column code -> (lookup Year, lookup Variable1, lookup Variable1_category).
# Verified against the published lookup tables at build time; the build stops
# if the lookup no longer agrees (i.e. Stats NZ re-issued the layer).
PART1_COLS = {
    "VAR_1_2":   ("2018", "Census usually resident population count", "Total"),
    "VAR_1_3":   ("2023", "Census usually resident population count", "Total"),
    "VAR_1_69":  ("2023", "Age", "Median"),
    "VAR_1_80":  ("2023", "Age (life cycle groups)", "Under 15 years"),
    "VAR_1_81":  ("2023", "Age (life cycle groups)", "15-29 years"),
    "VAR_1_82":  ("2023", "Age (life cycle groups)", "30-64 years"),
    "VAR_1_83":  ("2023", "Age (life cycle groups)", "65 years and over"),
    "VAR_1_84":  ("2023", "Age (life cycle groups)", "Total"),
    "VAR_1_158": ("2023", "Ethnicity (total responses)", "European"),
    "VAR_1_159": ("2023", "Ethnicity (total responses)", "Māori"),
    "VAR_1_160": ("2023", "Ethnicity (total responses)", "Pacific Peoples"),
    "VAR_1_161": ("2023", "Ethnicity (total responses)", "Asian"),
    "VAR_1_162": ("2023", "Ethnicity (total responses)",
                  "Middle Eastern/Latin American/African"),
    "VAR_1_163": ("2023", "Ethnicity (total responses)", "Other Ethnicity"),
    "VAR_1_168": ("2023", "Ethnicity (total responses)", "Total stated"),
}
PART2_COLS = {
    "VAR_2_13":  ("2023", "Individual home ownership", "Hold in a family trust"),
    "VAR_2_14":  ("2023", "Individual home ownership", "Own or partly own"),
    "VAR_2_18":  ("2023", "Individual home ownership", "Total stated"),
    "VAR_2_245": ("2023", "Highest qualification",
                  "Bachelor degree and Level 7 qualification"),
    "VAR_2_246": ("2023", "Highest qualification", "Post-graduate and honours degrees"),
    "VAR_2_247": ("2023", "Highest qualification", "Masters degree"),
    "VAR_2_248": ("2023", "Highest qualification", "Doctorate degree"),
    "VAR_2_252": ("2023", "Highest qualification", "Total stated"),
    "VAR_2_404": ("2023", "Total personal income", "Median ($)"),
}


def verify_lookup(lookup_csv, expected):
    with open(lookup_csv, encoding="utf-8-sig") as f:
        rows = {r["Column_name"]: r for r in csv.DictReader(f)}
    for col, (year, var, cat) in expected.items():
        r = rows.get(col)
        if r is None or r["Year"] != year or r["Variable1"] != var \
                or r["Variable1_category"] != cat:
            got = ("%s | %s | %s" % (r["Year"], r["Variable1"],
                   r["Variable1_category"])) if r else "column missing"
            die("lookup table %s no longer matches for %s.\n  expected: %s | %s | %s"
                "\n  got:      %s\nStats NZ may have re-issued the layer; the column "
                "map in build.py needs re-verifying." % (
                    lookup_csv.name, col, year, var, cat, got))

# ---------------------------------------------------------------- parsing


def val(row, idx, col):
    """Parse one census cell -> float, or None when suppressed/blank."""
    v = row[idx[col]]
    if v in ("", "S", None):
        return None
    f = float(v)
    if f < 0:  # -999 confidential; treat any sentinel as suppressed
        return None
    return f


def read_census(path, cols):
    out = {}
    with open(path) as f:
        r = csv.reader(f)
        hdr = next(r)
        idx = {h: i for i, h in enumerate(hdr)}
        for need in ["SA22023_V1_00", "SA22023_V1_00_NAME"] + list(cols):
            if need not in idx:
                die("column %s missing from %s - schema changed" % (need, path.name))
        for row in r:
            code = row[idx["SA22023_V1_00"]]
            out[code] = {c: val(row, idx, c) for c in cols}
            out[code]["name"] = row[idx["SA22023_V1_00_NAME"]]
    return out


def read_geo_areas(path):
    """meshblock rows -> SA2 code -> {region, local board (modal), SA3 name}."""
    from collections import Counter, defaultdict
    boards = defaultdict(Counter)
    regions = defaultdict(Counter)
    sa3 = {}
    names = {}
    with open(path) as f:
        r = csv.DictReader(f)
        for need in ("SA22023_code", "REGC2023_name", "TALB2023_name", "SA32023_name"):
            if need not in r.fieldnames:
                die("column %s missing from geographic areas table - schema changed" % need)
        for row in r:
            code = row["SA22023_code"]
            regions[code][row["REGC2023_name"]] += 1
            boards[code][row["TALB2023_name"]] += 1
            sa3[code] = row["SA32023_name"]
            names[code] = row["SA22023_name"]
    return {code: {
        "region": regions[code].most_common(1)[0][0],
        "board": boards[code].most_common(1)[0][0].replace(" Local Board Area", ""),
        "sa3": sa3[code],
        "name": names[code],
    } for code in regions}


def read_nzdep(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)
    hdr = next(rows)
    expect = ("SA22023_code", "SA22023_name", "SA2_average_NZDep2023",
              "SA2_average_NZDep2023_score")
    if tuple(hdr[:4]) != expect:
        die("NZDep2023 xlsx header changed: got %s, expected %s" % (hdr[:4], expect))
    out = {}
    for r in rows:
        if r[0] is None:
            continue
        code = str(r[0])
        decile = int(r[2]) if r[2] is not None else None
        score = int(r[3]) if r[3] is not None else None
        if decile is not None and not 1 <= decile <= 10:
            die("NZDep decile out of range for SA2 %s: %s" % (code, decile))
        out[code] = {"decile": decile, "score": score}
    return out

# ---------------------------------------------------------------- derive


def pct(n, d):
    if n is None or d is None or d == 0:
        return None
    return round(100.0 * n / d, 1)


def weighted_median(pairs):
    """pairs of (value, weight); population-weighted median of SA2 medians."""
    pairs = sorted((p for p in pairs if p[0] is not None and p[1]), key=lambda p: p[0])
    total = sum(w for _, w in pairs)
    if not total:
        return None
    acc = 0
    for v, w in pairs:
        acc += w
        if acc >= total / 2.0:
            return v
    return pairs[-1][0]


def build():
    force = "--force" in sys.argv
    print("downloading raw data ->", RAW)
    manifest = download_all(force)

    print("verifying column lookup tables against the published definitions")
    verify_lookup(RAW / "census_sa2_part1_lookup.csv", PART1_COLS)
    verify_lookup(RAW / "census_sa2_part2_lookup.csv", PART2_COLS)

    print("reading census part 1 / part 2")
    p1 = read_census(RAW / "census_sa2_part1.csv", PART1_COLS)
    p2 = read_census(RAW / "census_sa2_part2.csv", PART2_COLS)
    print("reading geographic areas concordance")
    geo = read_geo_areas(RAW / "geographic_areas_2023.csv")
    print("reading NZDep2023")
    dep = read_nzdep(RAW / NZDEP_FILE)

    akl_codes = sorted(c for c, g in geo.items() if g["region"] == "Auckland Region")
    if not 500 <= len(akl_codes) <= 700:
        die("expected roughly 500-700 Auckland SA2s, got %d - concordance filter "
            "looks wrong" % len(akl_codes))
    print("Auckland region SA2s: %d" % len(akl_codes))

    missing = [c for c in akl_codes if c not in p1 or c not in p2]
    if missing:
        die("%d Auckland SA2s missing from census layers, e.g. %s" %
            (len(missing), missing[:5]))

    suburbs = []
    for code in akl_codes:
        a, b, g = p1[code], p2[code], geo[code]
        d = dep.get(code, {"decile": None, "score": None})
        pop23, pop18 = a["VAR_1_3"], a["VAR_1_2"]
        eth_stated = a["VAR_1_168"]
        age_total = a["VAR_1_84"]
        own_num = (None if (b["VAR_2_13"] is None or b["VAR_2_14"] is None)
                   else b["VAR_2_13"] + b["VAR_2_14"])
        bach = [b["VAR_2_245"], b["VAR_2_246"], b["VAR_2_247"], b["VAR_2_248"]]
        bach_num = None if any(x is None for x in bach) else sum(bach)
        sa3 = g["sa3"]
        s = {
            "code": code,
            "name": g["name"],
            "board": g["board"],
            # colloquial grouping: official SA3 2023 name, only where it
            # differs from the SA2 name (i.e. this SA2 is part of a broader
            # commonly-named area). Otherwise blank - never guessed.
            "colloquial": sa3 if sa3 != g["name"] else "",
            "pop2023": None if pop23 is None else int(pop23),
            "pop2018": None if pop18 is None else int(pop18),
            "pop_change_pct": pct((pop23 - pop18) if (pop23 is not None and pop18 is not None) else None, pop18),
            "median_age": a["VAR_1_69"],
            "age": {  # counts + shares of the age-group total
                "0-14":  {"n": a["VAR_1_80"], "pct": pct(a["VAR_1_80"], age_total)},
                "15-29": {"n": a["VAR_1_81"], "pct": pct(a["VAR_1_81"], age_total)},
                "30-64": {"n": a["VAR_1_82"], "pct": pct(a["VAR_1_82"], age_total)},
                "65+":   {"n": a["VAR_1_83"], "pct": pct(a["VAR_1_83"], age_total)},
            },
            # multi-response: shares of people who stated an ethnicity;
            # groups overlap so these intentionally sum to >100%
            "ethnicity": {
                "European": {"n": a["VAR_1_158"], "pct": pct(a["VAR_1_158"], eth_stated)},
                "Māori":    {"n": a["VAR_1_159"], "pct": pct(a["VAR_1_159"], eth_stated)},
                "Pacific":  {"n": a["VAR_1_160"], "pct": pct(a["VAR_1_160"], eth_stated)},
                "Asian":    {"n": a["VAR_1_161"], "pct": pct(a["VAR_1_161"], eth_stated)},
                "MELAA":    {"n": a["VAR_1_162"], "pct": pct(a["VAR_1_162"], eth_stated)},
                "Other":    {"n": a["VAR_1_163"], "pct": pct(a["VAR_1_163"], eth_stated)},
            },
            "eth_stated": None if eth_stated is None else int(eth_stated),
            "median_income": b["VAR_2_404"],
            "bachelor_pct": pct(bach_num, b["VAR_2_252"]),
            "home_own_pct": pct(own_num, b["VAR_2_18"]),
            "dep_decile": d["decile"],   # 1 = least deprived, 10 = most
            "dep_score": d["score"],
        }
        suburbs.append(s)

    n_dep = sum(1 for s in suburbs if s["dep_decile"] is not None)
    print("SA2s with an NZDep2023 decile: %d / %d (rest are non-residential "
          "areas such as inlets/islands/ports)" % (n_dep, len(suburbs)))

    # ---- regional reference values (aggregated from the Auckland SA2 rows)
    def total(key_fn):
        vals = [key_fn(s) for s in suburbs]
        return sum(v for v in vals if v is not None)

    reg_pop23 = total(lambda s: s["pop2023"])
    reg_pop18 = total(lambda s: s["pop2018"])
    reg_eth_stated = total(lambda s: s["eth_stated"])
    reg_age_total = total(lambda s: sum(a["n"] for a in s["age"].values())
                          if all(a["n"] is not None for a in s["age"].values()) else None)
    region = {
        "pop2023": reg_pop23,
        "pop_change_pct": pct(reg_pop23 - reg_pop18, reg_pop18),
        # population-weighted median of SA2 medians (no region-level medians
        # are published in this dataset) - labelled as derived in the UI
        "median_age": weighted_median([(s["median_age"], s["pop2023"]) for s in suburbs]),
        "median_income": weighted_median([(s["median_income"], s["pop2023"]) for s in suburbs]),
        "ethnicity": {k: pct(total(lambda s, k=k: s["ethnicity"][k]["n"]), reg_eth_stated)
                      for k in ("European", "Māori", "Pacific", "Asian", "MELAA", "Other")},
        "age": {k: pct(total(lambda s, k=k: s["age"][k]["n"]), reg_age_total)
                for k in ("0-14", "15-29", "30-64", "65+")},
        "bachelor_pct": pct(
            sum(p2[s["code"]]["VAR_2_245"] + p2[s["code"]]["VAR_2_246"] +
                p2[s["code"]]["VAR_2_247"] + p2[s["code"]]["VAR_2_248"]
                for s in suburbs if s["bachelor_pct"] is not None),
            sum(p2[s["code"]]["VAR_2_252"] for s in suburbs
                if s["bachelor_pct"] is not None)),
        "home_own_pct": pct(
            sum(p2[s["code"]]["VAR_2_13"] + p2[s["code"]]["VAR_2_14"]
                for s in suburbs if s["home_own_pct"] is not None),
            sum(p2[s["code"]]["VAR_2_18"] for s in suburbs
                if s["home_own_pct"] is not None)),
    }

    OUT.mkdir(parents=True, exist_ok=True)

    # ---- geometry: filter to Auckland, attach core metrics, simplify
    print("filtering boundaries + attaching choropleth metrics")
    fc = json.loads((RAW / "sa2_2023_clipped_generalised.geojson").read_text())
    by_code = {s["code"]: s for s in suburbs}
    feats = []
    for f in fc["features"]:
        code = f["properties"].get("SA22023_V1_00")
        s = by_code.get(code)
        if s is None:
            continue
        f["properties"] = {
            "code": code, "name": s["name"], "board": s["board"],
            "dep_decile": s["dep_decile"], "median_age": s["median_age"],
            "median_income": s["median_income"], "pop2023": s["pop2023"],
            "pop_change_pct": s["pop_change_pct"], "home_own_pct": s["home_own_pct"],
            **{"eth_" + k: v["pct"] for k, v in s["ethnicity"].items()},
        }
        feats.append(f)
    have = {f["properties"]["code"] for f in feats}
    no_geom = [s for s in suburbs if s["code"] not in have]
    # The clipped boundary layer intentionally drops SA2s that are entirely
    # water (inlets/oceanic/bays). Those stay in suburbs.json but can't be
    # drawn. Anything populated going missing means the wrong layer.
    bad = [s for s in no_geom if (s["pop2023"] or 0) > 100]
    if bad:
        die("boundary file is missing populated Auckland SA2s: %s - wrong "
            "boundary layer?" % [(s["code"], s["name"]) for s in bad])
    for s in suburbs:
        s["on_map"] = s["code"] in have
    if no_geom:
        print("  %d water-only SA2s have no clipped geometry (kept in table, "
              "not on map): %s" % (len(no_geom),
              ", ".join(s["name"] for s in no_geom)))

    (OUT / "suburbs.json").write_text(json.dumps({
        "generated": date.today().isoformat(),
        "sources": manifest,
        "region": region,
        "suburbs": suburbs,
    }, ensure_ascii=False, separators=(",", ":")))
    print("wrote docs/data/suburbs.json (%d suburbs)" % len(suburbs))
    pre = OUT / "auckland_full.geojson"
    pre.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                              ensure_ascii=False, separators=(",", ":")))
    size_before = pre.stat().st_size

    print("simplifying with mapshaper (15%%, shapes preserved)")
    final = OUT / "auckland.geojson"
    try:
        subprocess.run(
            ["mapshaper", str(pre), "-simplify", "15%", "keep-shapes",
             "-o", "precision=0.00001", "format=geojson", "force", str(final)],
            check=True, capture_output=True, text=True)
    except FileNotFoundError:
        die("mapshaper not found - install with: npm install -g mapshaper")
    except subprocess.CalledProcessError as e:
        die("mapshaper failed:\n" + e.stderr)
    size_after = final.stat().st_size
    pre.unlink()
    print("geometry size: %.1f MB before -> %.1f MB after simplification"
          % (size_before / 1e6, size_after / 1e6))
    total_out = size_after + (OUT / "suburbs.json").stat().st_size
    print("total payload (auckland.geojson + suburbs.json): %.2f MB" % (total_out / 1e6))
    if size_after > 3_000_000:
        print("WARNING: geometry still over 3 MB - consider a lower simplify %")
    print("done.")


if __name__ == "__main__":
    build()
