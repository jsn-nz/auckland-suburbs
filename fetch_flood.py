#!/usr/bin/env python3
"""Fetch Auckland Council Flood Plains polygons (ArcGIS FeatureServer, paged)
into data/raw/flood_plains.geojson. ~10m simplification keeps it manageable —
we only use it for %-of-area-in-flood-plain, not for display."""
import json
import urllib.request
import urllib.parse
from pathlib import Path

RAW = Path(__file__).resolve().parent / "data" / "raw"
BASE = ("https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/"
        "Flood_Plains/FeatureServer/0/query")

feats = []
offset = 0
while True:
    # NOTE: maxAllowableOffset below ~0.0001 makes this server return null
    # geometries, and coarser tolerances gut the narrow stream flood plains,
    # so we take full detail (~400MB, one-time - only the computed percentages
    # are kept after build).
    q = urllib.parse.urlencode({
        "where": "1=1", "outFields": "OBJECTID", "f": "geojson",
        "orderByFields": "OBJECTID", "resultOffset": offset,
        "resultRecordCount": 1000,
    })
    req = urllib.request.Request(BASE + "?" + q, headers={"User-Agent": "Mozilla/5.0"})
    d = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                d = json.load(r)
            break
        except Exception as e:
            print("  page at offset %d failed (%s), retry %d" % (offset, e, attempt + 1),
                  flush=True)
            import time
            time.sleep(5 * (attempt + 1))
    if d is None:
        raise SystemExit("flood plains download kept failing at offset %d" % offset)
    batch = d.get("features", [])
    feats.extend(batch)
    print("fetched", len(feats), flush=True)
    if len(batch) < 1000:
        break
    offset += 1000

out = RAW / "flood_plains.geojson"
out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
print("wrote %s (%d features, %.1f MB)" % (out, len(feats),
      out.stat().st_size / 1e6))
