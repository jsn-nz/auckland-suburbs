/* Map view: MapLibre GL choropleth over a subtle Carto raster basemap
   (light/dark aware, labels drawn above the fills). Hover tooltip, click to
   open the detail panel, legend rebuilt per metric + theme. */
"use strict";

const MapView = (() => {
  let map, geojson, metric = "pop2023", selectCb;
  let hoveredCode = null;
  const bboxByCode = {};

  const CARTO_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>';
  const tiles = kind => ["a", "b", "c", "d"].map(s =>
    `https://${s}.basemaps.cartocdn.com/${kind}/{z}/{x}/{y}@2x.png`);

  function baseStyle() {
    const dark = Palette.dark();
    return {
      version: 8,
      sources: {
        base: { type: "raster", tiles: tiles(dark ? "dark_nolabels" : "light_nolabels"),
                tileSize: 256, attribution: CARTO_ATTR },
        labels: { type: "raster", tiles: tiles(dark ? "dark_only_labels" : "light_only_labels"),
                  tileSize: 256 },
        sa2: { type: "geojson", data: geojson, promoteId: "code" },
      },
      layers: [
        { id: "base", type: "raster", source: "base",
          paint: { "raster-opacity": dark ? 0.85 : 0.7 } },
        { id: "sa2-fill", type: "fill", source: "sa2",
          paint: { "fill-color": fillColorExpr(), "fill-opacity": 0.78 } },
        { id: "sa2-line", type: "line", source: "sa2",
          paint: { "line-color": dark ? "rgba(255,255,255,0.25)" : "rgba(11,11,11,0.22)",
                   "line-width": 0.5 } },
        { id: "sa2-hover", type: "line", source: "sa2",
          paint: { "line-color": dark ? "#ffffff" : "#0b0b0b", "line-width": 1.6 },
          filter: ["==", ["get", "code"], "__none__"] },
        { id: "sa2-selected", type: "line", source: "sa2",
          paint: { "line-color": dark ? "#ffffff" : "#0b0b0b", "line-width": 2.5 },
          filter: ["==", ["get", "code"], "__none__"] },
        { id: "labels", type: "raster", source: "labels",
          paint: { "raster-opacity": dark ? 0.9 : 0.95 } },
      ],
    };
  }

  function values() {
    return geojson.features.map(f => f.properties[metric]);
  }

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
    if (m.multi) html += `<div class="direction">Multi-response — groups overlap</div>`;

    if (sc.kind === "decile") {
      html += `<div class="legend-strip">` +
        sc.colors.map((c, i) => `<span style="background:${c}" title="Decile ${i + 1}"></span>`).join("") +
        `</div><div class="legend-strip-labels"><span>1 least</span><span>10 most deprived</span></div>`;
    } else {
      const f = m.fmt;
      const rows = [];
      for (let i = 0; i < sc.colors.length; i++) {
        const lo = i === 0 ? null : sc.thresholds[i - 1];
        const hi = i === sc.colors.length - 1 ? null : sc.thresholds[i];
        let lab;
        if (lo == null) lab = "< " + f(hi);
        else if (hi == null) lab = "≥ " + f(lo);
        else lab = f(lo) + " – " + f(hi);
        rows.push(`<div class="legend-row"><span class="legend-swatch" style="background:${sc.colors[i]}"></span>${lab}</div>`);
      }
      html += rows.join("");
    }
    html += `<div class="legend-row"><span class="legend-swatch" style="background:${Palette.noData()}"></span>No data / suppressed</div>`;
    box.innerHTML = html;
  }

  function computeBboxes() {
    let all = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of geojson.features) {
      const b = [Infinity, Infinity, -Infinity, -Infinity];
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
      all = [Math.min(all[0], b[0]), Math.min(all[1], b[1]),
             Math.max(all[2], b[2]), Math.max(all[3], b[3])];
    }
    return all;
  }

  function init(geo, onSelect) {
    geojson = geo;
    selectCb = onSelect;
    const auckland = computeBboxes();

    map = new maplibregl.Map({
      container: "map",
      style: baseStyle(),
      bounds: auckland,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
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
        <div class="tt-val">${m.short}: <strong>${raw == null ? "no data / suppressed" : m.fmt(raw)}</strong></div>`;
      tooltip.hidden = false;
      const r = document.getElementById("map").getBoundingClientRect();
      let x = e.point.x + 12, y = e.point.y + 12;
      if (x + 250 > r.width) x = e.point.x - 250;
      if (y + 70 > r.height) y = e.point.y - 70;
      tooltip.style.transform = `translate(${x}px, ${y}px)`;
    });
    map.on("mouseleave", "sa2-fill", () => {
      map.getCanvas().style.cursor = "";
      tooltip.hidden = true;
      hoveredCode = null;
      map.setFilter("sa2-hover", ["==", ["get", "code"], "__none__"]);
    });
    map.on("click", "sa2-fill", e => selectCb(e.features[0].properties.code, false));

    document.getElementById("metric-select").addEventListener("change", e => {
      metric = e.target.value;
      map.setPaintProperty("sa2-fill", "fill-color", fillColorExpr());
      renderLegend();
    });
    populateMetricSelect();
    renderLegend();
  }

  function populateMetricSelect() {
    const sel = document.getElementById("metric-select");
    const groups = {};
    for (const [k, m] of Object.entries(Palette.METRICS))
      (groups[m.group] = groups[m.group] || []).push([k, m]);
    sel.innerHTML = Object.entries(groups).map(([g, items]) =>
      `<optgroup label="${g}">` +
      items.map(([k, m]) => `<option value="${k}">${m.label}</option>`).join("") +
      `</optgroup>`).join("");
    sel.value = metric;
  }

  let selectedCode = null;
  function select(code, zoom) {
    selectedCode = code;
    map.setFilter("sa2-selected", ["==", ["get", "code"], code || "__none__"]);
    if (code && zoom && bboxByCode[code]) {
      map.fitBounds(bboxByCode[code], { padding: 90, maxZoom: 13.5, duration: 700 });
    }
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

  return { init, select, refreshTheme, resize };
})();
