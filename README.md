# NZ suburb profiles

Interactive static site profiling every SA2 in New Zealand, region by region:
2023 Census (Stats NZ) joined to NZDep2023 (University of Otago). The map opens
on the 16 regions (plus the Chatham Islands); picking one loads its suburbs.

## Rebuild the data

Needs: `STATS_NZ_API_KEY` in the environment or in `.env` (free key from
https://datafinder.stats.govt.nz/my/api/), Python 3.9+ with `openpyxl`
(`pip3 install --user openpyxl`), and `mapshaper` (`npm install -g mapshaper`).

```
python3 build.py            # uses cached downloads in data/raw/
python3 build.py --force    # re-download everything
python3 enrich.py           # Wikipedia/Commons photos + descriptions (cached)
```

Outputs, under `docs/data/`:

- `nz.json` + `nz.geojson` — the regions (same record shape as a suburb, built by
  aggregating their SA2s) and the national reference values
- `index.json` — every SA2's name / region / district, for the search box
- `r/<region>/suburbs.json`, `geo.geojson`, `schools.json` — one folder per
  region, loaded when that region is opened
- `extras.json` — Wikipedia photos + blurbs (Auckland only so far)

The build aborts loudly if a download fails or a schema changes — it never
falls back to hardcoded figures.

## Serve the site

```
cd docs && python3 -m http.server 8092
```

Then open http://localhost:8092. (Any static file server works; the only
external requests at view time are the OpenFreeMap basemap tiles, fonts and
sprites - no API key needed.)

## Layout

- `build.py` — the whole data pipeline (downloads, verification, join, simplify)
- `enrich.py` — Wikipedia/Wikimedia Commons matching for suburb photos + blurbs
- `data/raw/` — cached source downloads + `manifest.json` (download dates)
- `docs/` — the static site (vanilla JS + vendored MapLibre GL)

Data caveats (multi-response ethnicity, random rounding, suppression,
SA2-vs-suburb, NZDep direction) are documented on the site's
“About the data” page.
