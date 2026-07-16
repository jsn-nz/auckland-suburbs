# Auckland suburb profiles

Interactive static site profiling every SA2 in the Auckland region:
2023 Census (Stats NZ) joined to NZDep2023 (University of Otago).

## Rebuild the data

Needs: `STATS_NZ_API_KEY` in the environment or in `.env` (free key from
https://datafinder.stats.govt.nz/my/api/), Python 3.9+ with `openpyxl`
(`pip3 install --user openpyxl`), and `mapshaper` (`npm install -g mapshaper`).

```
python3 build.py            # uses cached downloads in data/raw/
python3 build.py --force    # re-download everything
python3 enrich.py           # Wikipedia/Commons photos + descriptions (cached)
```

Outputs `docs/data/auckland.geojson` (simplified geometry + choropleth metrics)
and `docs/data/suburbs.json` (full per-SA2 detail + regional reference values).
The build aborts loudly if a download fails or a schema changes — it never
falls back to hardcoded figures.

## Serve the site

```
cd docs && python3 -m http.server 8092
```

Then open http://localhost:8092. (Any static file server works; the only
external requests at view time are the Carto basemap tiles.)

## Layout

- `build.py` — the whole data pipeline (downloads, verification, join, simplify)
- `enrich.py` — Wikipedia/Wikimedia Commons matching for suburb photos + blurbs
- `data/raw/` — cached source downloads + `manifest.json` (download dates)
- `docs/` — the static site (vanilla JS + vendored MapLibre GL)

Data caveats (multi-response ethnicity, random rounding, suppression,
SA2-vs-suburb, NZDep direction) are documented on the site's
“About the data” page.
