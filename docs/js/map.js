/* Map view: MapLibre GL choropleth over an OpenFreeMap vector basemap
   (light/dark aware, labels drawn above the fills). Hover tooltip, click to
   open the detail panel, legend rebuilt per metric + theme.

   The map shows one "level" at a time: the 16 regions of NZ, or the suburbs
   (SA2s) of one region. setData() swaps levels; everything else is shared. */
"use strict";

const MapView = (() => {
  let map, geojson, metric = "pop2023", selectCb;
  let hoveredCode = null;
  let level = {};            // {exclude: [codes left out of the fit], hint, bold}
  let bboxByCode = {}, allBounds = null;
  let focusBoard = null;     // district / local board being highlighted, if any
  const NONE = ["==", ["get", "code"], "__none__"];

  // Basemap: OpenFreeMap vector tiles (no API key). BASEMAPS comes from
  // vendor/basemap-styles.js. The basemap's own layers are split so the
  // choropleth sits above land/roads but below every label.
  function baseStyle() {
    const dark = Palette.dark();
    const base = JSON.parse(JSON.stringify(BASEMAPS[dark ? "dark" : "light"]));
    const areaLayers = [
      { id: "sa2-fill", type: "fill", source: "sa2",
        paint: { "fill-color": fillColorExpr(), "fill-opacity": fillOpacityExpr() } },
      { id: "sa2-line", type: "line", source: "sa2",
        paint: { "line-color": dark ? "rgba(255,255,255,0.25)" : "rgba(11,11,11,0.22)",
                 "line-width": level.bold ? 1 : 0.5 } },
      { id: "sa2-hover", type: "line", source: "sa2",
        paint: { "line-color": dark ? "#ffffff" : "#0b0b0b", "line-width": 1.6 },
        filter: NONE },
      { id: "sa2-selected", type: "line", source: "sa2",
        paint: { "line-color": dark ? "#ffffff" : "#0b0b0b", "line-width": 2.5 },
        filter: NONE },
    ];
    return {
      ...base,
      sources: { ...base.sources, sa2: { type: "geojson", data: geojson, promoteId: "code" } },
      layers: [
        ...base.layers.filter(l => l.type !== "symbol"),
        ...areaLayers,
        ...base.layers.filter(l => l.type === "symbol"),
      ],
    };
  }

  function values() {
    return geojson.features.map(f => f.properties[metric]);
  }
  // a metric is offered only where this level has data for it
  // (e.g. flood-plain land exists for Auckland suburbs only)
  const available = m => geojson.features.some(f => f.properties[m] != null);

  // with a district picked, the rest of the region fades back
  const fillOpacityExpr = () => focusBoard
    ? ["case", ["==", ["get", "board"], focusBoard], 0.82, 0.22] : 0.78;

  function fillColorExpr() {
    const sc = Palette.scale(metric, values());
    const step = ["step", ["get", metric], sc.colors[0]];
    sc.thresholds.forEach((t, i) => step.push(t, sc.colors[i + 1]));
    return ["case",
      ["==", ["get", metric], null], Palette.noData(),
      step];
  }

  function renderLegend() {
    const sc = Palette.scale(metric, values());
    const m = Palette.METRICS[metric];
    const box = document.getElementById("legend");
    let html = `<h3>${m.label}</h3>`;
    if (m.note) html += `<div class="direction">${m.note}</div>`;
    if (m.multi) html += `<div class="direction">Multi-response: groups overlap</div>`;

    if (sc.kind === "decile") {
      html += `<div class="legend-strip">` +
        sc.colors.map((c, i) => `<span style="background:${c}" title="Decile ${i + 1}"></span>`).join("") +
        `</div><div class="legend-strip-labels"><span>1 least</span><span>10 most deprived</span></div>`;
    } else {
      const f = m.fmt;
      const vals = values().filter(v => v != null);
      const min = vals.length ? Math.min(...vals) : null;
      const rows = [];
      for (let i = 0; i < sc.colors.length; i++) {
        const lo = i === 0 ? null : sc.thresholds[i - 1];
        const hi = i === sc.colors.length - 1 ? null : sc.thresholds[i];
        // skip the open "< t0" bin when no value can fall in it
        if (lo == null && min != null && hi != null && min >= hi) continue;
        let lab;
        if (lo == null) lab = "< " + f(hi);
        else if (hi == null) lab = "≥ " + f(lo);
        else lab = f(lo) + " – " + f(hi);
        rows.push(`<div class="legend-row"><span class="legend-swatch" style="background:${sc.colors[i]}"></span>${lab}</div>`);
      }
      html += rows.join("");
    }
    html += `<div class="legend-row"><span class="legend-swatch" style="background:${Palette.noData()}"></span>No data / suppressed</div>`;
    // always-visible way into the sources / privacy dialog (the copy in the
    // attribution strip collapses behind the (i) button once the map is moved)
    html += `<a href="#" data-legal class="legend-legal">Sources &amp; privacy</a>`;
    box.innerHTML = html;
  }

  const grow = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
                          Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  const EMPTY = [Infinity, Infinity, -Infinity, -Infinity];

  function computeBboxes() {
    bboxByCode = {};
    let all = EMPTY;
    const skip = new Set(level.exclude || []);
    for (const f of geojson.features) {
      const b = [...EMPTY];
      const scan = coords => {
        for (const c of coords) {
          if (typeof c[0] === "number") {
            if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1];
            if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1];
          } else scan(c);
        }
      };
      scan(f.geometry.coordinates);
      bboxByCode[f.properties.code] = b;
      if (!skip.has(f.properties.code)) all = grow(all, b);
    }
    allBounds = all;
    return all;
  }

  /* Where to land when a region is opened by clicking it on the national map:
     the built-up part of the district / local board under the click. Takes the
     suburbs nearest that district's population centre until they hold 85% of
     its people, so Christchurch City lands on the city, not Banks Peninsula. */
  function boundsAround(pt) {
    let best = null, bestSize = Infinity, nearest = null, nearestD = Infinity;
    for (const f of geojson.features) {
      const b = bboxByCode[f.properties.code];
      const inside = pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3];
      const size = (b[2] - b[0]) * (b[3] - b[1]);
      if (inside && size < bestSize) { best = f; bestSize = size; }
      const d = ((b[0] + b[2]) / 2 - pt[0]) ** 2 + ((b[1] + b[3]) / 2 - pt[1]) ** 2;
      if (d < nearestD) { nearest = f; nearestD = d; }
    }
    const hit = best || nearest;
    if (!hit) return null;
    const mid = f => { const b = bboxByCode[f.properties.code]; return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
    const peers = geojson.features.filter(f => f.properties.board === hit.properties.board);
    const pop = f => f.properties.pop2023 || 0;
    const total = peers.reduce((a, f) => a + pop(f), 0);
    let picked = peers;
    if (total > 0) {
      const cx = peers.reduce((a, f) => a + mid(f)[0] * pop(f), 0) / total;
      const cy = peers.reduce((a, f) => a + mid(f)[1] * pop(f), 0) / total;
      const k = Math.cos(cy * Math.PI / 180);   // longitude degrees are shorter than latitude ones
      const dist = f => ((mid(f)[0] - cx) * k) ** 2 + (mid(f)[1] - cy) ** 2;
      const sorted = peers.filter(f => pop(f) > 0).sort((p, q) => dist(p) - dist(q));
      picked = [];
      let acc = 0;
      for (const f of sorted) { picked.push(f); acc += pop(f); if (acc >= 0.85 * total) break; }
    }
    let b = EMPTY;
    for (const f of picked) b = grow(b, bboxByCode[f.properties.code]);
    // generous margin: show the town or city with its surroundings, not edge to edge
    const dx = (b[2] - b[0]) * 0.45, dy = (b[3] - b[1]) * 0.45;
    return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
  }

  function init(geo, onSelect, opts) {
    geojson = geo;
    level = opts || {};
    selectCb = onSelect;
    const bounds = computeBboxes();
    populateMetricSelect();

    map = new maplibregl.Map({
      container: "map",
      style: baseStyle(),
      bounds,
      fitBoundsOptions: { padding: 24 },
      attributionControl: {
        compact: true,
        customAttribution: '<a href="#" data-legal>Sources &amp; privacy</a>',
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    const tooltip = document.getElementById("map-tooltip");
    map.on("mousemove", "sa2-fill", e => {
      const f = e.features[0];
      map.getCanvas().style.cursor = "pointer";
      if (hoveredCode !== f.properties.code) {
        hoveredCode = f.properties.code;
        map.setFilter("sa2-hover", ["==", ["get", "code"], hoveredCode]);
      }
      const m = Palette.METRICS[metric];
      const raw = f.properties[metric];
      tooltip.innerHTML = `<div class="tt-name">${f.properties.name}</div>
        <div class="tt-val">${m.short}: <strong>${raw == null ? "no data / suppressed" : m.fmt(raw)}</strong></div>
        ${level.hint ? `<div class="tt-hint">${level.hint}</div>` : ""}`;
      tooltip.hidden = false;
      const r = document.getElementById("map").getBoundingClientRect();
      let x = e.point.x + 12, y = e.point.y + 12;
      if (x + 250 > r.width) x = e.point.x - 250;
      if (y + 90 > r.height) y = e.point.y - 90;
      tooltip.style.transform = `translate(${x}px, ${y}px)`;
    });
    map.on("mouseleave", "sa2-fill", () => {
      map.getCanvas().style.cursor = "";
      tooltip.hidden = true;
      hoveredCode = null;
      map.setFilter("sa2-hover", NONE);
    });
    map.on("movestart", () => { tooltip.hidden = true; });   // no stale tooltip after a zoom
    map.on("click", "sa2-fill", e =>
      selectCb(e.features[0].properties.code, false, [e.lngLat.lng, e.lngLat.lat]));

    document.getElementById("metric-select").addEventListener("change", e => {
      setMetric(e.target.value);
      document.dispatchEvent(new CustomEvent("metricchange", { detail: metric }));
    });
    renderLegend();
  }

  /* swap the map to another level (NZ regions <-> one region's suburbs) */
  function setData(geo, opts) {
    geojson = geo;
    level = opts || {};
    selectedCode = null;
    hoveredCode = null;
    focusBoard = null;
    document.getElementById("map-tooltip").hidden = true;
    const bounds = computeBboxes();
    populateMetricSelect();
    const apply = () => {
      map.getSource("sa2").setData(geojson);
      map.setPaintProperty("sa2-fill", "fill-color", fillColorExpr());
      map.setPaintProperty("sa2-fill", "fill-opacity", fillOpacityExpr());
      map.setPaintProperty("sa2-line", "line-width", level.bold ? 1 : 0.5);
      map.setFilter("sa2-selected", NONE);
      map.setFilter("sa2-hover", NONE);
    };
    try { apply(); } catch (e) { map.once("load", apply); }
    // arriving from a click on the national map: land on the part of the
    // region that was clicked (its district), not the whole region
    const near = level.focus && boundsAround(level.focus);
    if (near) map.fitBounds(near, { padding: 40, maxZoom: 10.5, duration: 1200 });
    else map.fitBounds(bounds, { padding: 24, duration: 700 });
    renderLegend();
  }

  function populateMetricSelect() {
    const sel = document.getElementById("metric-select");
    if (!available(metric)) {
      metric = "pop2023";
      document.dispatchEvent(new CustomEvent("metricchange", { detail: metric }));
    }
    const groups = {};
    for (const [k, m] of Object.entries(Palette.METRICS))
      if (available(k)) (groups[m.group] = groups[m.group] || []).push([k, m]);
    sel.innerHTML = Object.entries(groups).map(([g, items]) =>
      `<optgroup label="${g}">` +
      items.map(([k, m]) => `<option value="${k}">${m.label}</option>`).join("") +
      `</optgroup>`).join("");
    sel.value = metric;
  }

  let selectedCode = null;
  function select(code, zoom) {
    selectedCode = code;
    const apply = () => {
      map.setFilter("sa2-selected", ["==", ["get", "code"], code || "__none__"]);
      if (!code || !zoom || !bboxByCode[code]) return;
      const b = bboxByCode[code];
      if (zoom === "auto") {
        // clicked on the map: if the suburb is only a speck at this zoom (a
        // city seen from region level), move in until it and its neighbours
        // are readable; if it is already a decent size, leave the view alone
        const p1 = map.project([b[0], b[1]]), p2 = map.project([b[2], b[3]]);
        const px = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
        // a gentle step: at most two zoom levels per click, and only for specks
        if (px < 45) {
          map.easeTo({
            center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2],
            zoom: Math.min(map.getZoom() + Math.min(Math.log2(90 / Math.max(px, 3)), 2), 12.5),
            duration: 1100,
          });
        }
      } else {
        map.fitBounds(b, { padding: 90, maxZoom: 13.5, duration: 700 });
      }
    };
    try { apply(); } catch (e) { map.once("load", apply); }  // deep link before style load
  }

  /* highlight + zoom to one district / local board of the current region
     (null = whole region). zoom=false only changes the highlight. */
  function zoomToBoard(board, zoom = true) {
    focusBoard = board || null;
    const paint = () => map.setPaintProperty("sa2-fill", "fill-opacity", fillOpacityExpr());
    try { paint(); } catch (e) { map.once("load", paint); }
    if (!zoom) return;
    let b = EMPTY;
    if (board) {
      for (const f of geojson.features)
        if (f.properties.board === board) b = grow(b, bboxByCode[f.properties.code]);
    }
    if (!board || b[0] === Infinity) b = allBounds;
    map.fitBounds(b, { padding: 40, maxZoom: 13, duration: 700 });
  }

  function refreshTheme() {
    if (!map) return;
    map.setStyle(baseStyle());  // rebuilds sources + layers for the new theme
    map.once("styledata", () => {
      if (selectedCode) map.setFilter("sa2-selected", ["==", ["get", "code"], selectedCode]);
    });
    renderLegend();
  }

  const resize = () => map && map.resize();

  function setMetric(m) {
    if (!Palette.METRICS[m] || !available(m)) return;
    metric = m;
    document.getElementById("metric-select").value = m;
    if (map) {
      const apply = () => map.setPaintProperty("sa2-fill", "fill-color", fillColorExpr());
      try { apply(); } catch (e) { map.once("load", apply); }  // deep link before style load
    }
    renderLegend();
  }
  const getMetric = () => metric;

  return { init, setData, select, zoomToBoard, refreshTheme, resize, setMetric, getMetric };
})();
