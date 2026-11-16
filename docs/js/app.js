/* Bootstrap: load data, wire navigation, search, theme.

   Two levels share one map / panel:
     "nz"          the 16 regions (+ Chatham Islands) of New Zealand
     <region slug> the suburbs (SA2s) of one region, loaded on demand
   The small national bundle (data/nz.json, nz.geojson, index.json) loads up
   front; each region's files (data/r/<slug>/…) load when you first open it. */
"use strict";

(async function () {
  const state = { level: null, selected: null, board: "" };
  let NZ, NZGEO, INDEX, regionBySlug, ctxNZ;
  let cur = null;                 // the loaded bundle for the region being shown
  const bundles = {};             // slug -> Promise<bundle>
  let mapReady = false, navToken = 0, applyingHash = false;
  const $ = id => document.getElementById(id);
  const SITE = "NZ Census";

  // ---------------------------------------------------------------- theme
  $("theme-toggle").addEventListener("click", () => {
    const cur_ = Palette.dark();
    document.documentElement.setAttribute("data-theme", cur_ ? "light" : "dark");
    MapView.refreshTheme();
    Panel.refresh(); // re-ink charts
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.getAttribute("data-theme")) MapView.refreshTheme();
  });

  // ---------------------------------------------------------------- data
  const getJSON = url => fetch(url).then(r => {
    if (!r.ok) throw new Error(url.split("/").pop() + " " + r.status);
    return r.json();
  });
  const optional = url => getJSON(url).catch(() => ({}));
  const slug = s => s.toLowerCase()
    .replace(/[āä]/g, "a").replace(/[ēë]/g, "e").replace(/[īï]/g, "i")
    .replace(/[ōö]/g, "o").replace(/[ūü]/g, "u")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function veil(text) {
    const el = $("loading");
    if (text == null) { el.classList.add("hide"); return; }
    el.textContent = text;
    el.classList.toggle("soft", mapReady);
    el.classList.remove("hide");
  }

  try {
    [NZ, NZGEO, INDEX] = await Promise.all([
      getJSON("data/nz.json"), getJSON("data/nz.geojson"), getJSON("data/index.json"),
    ]);
  } catch (err) {
    veil("Failed to load data files (" + err.message + "). Run `python3 build.py` first, and serve the docs/ directory.");
    return;
  }
  regionBySlug = Object.fromEntries(NZ.regions.map(r => [r.slug, r]));
  // national search index: every suburb, plus the districts they sit in
  INDEX = INDEX.map(([name, code, region, board, colloquial]) =>
    ({ name, code, region, board, colloquial, slug: slug(name) }));
  const districts = [...new Map(INDEX
    .filter(x => !x.board.startsWith("Area Outside"))
    .map(x => [x.region + "|" + x.board, { board: x.board, region: x.region }])).values()];

  // panel context for region profiles: peers = regions, reference = all of NZ
  ctxNZ = {
    region: NZ.nz, suburbs: NZ.regions, extras: {}, schools: {}, meta: NZ.meta || {},
    kind: "region", noun: "region", refName: "New Zealand", refLabel: "NZ",
    onSelect: s => go({ region: s, profile: true }),
    onClose: () => {},
  };

  function loadRegion(s) {
    if (!bundles[s]) {
      const rec = regionBySlug[s];
      const dir = "data/r/" + s + "/";
      bundles[s] = Promise.all([
        getJSON(dir + "suburbs.json"), getJSON(dir + "geo.geojson"),
        optional(dir + "schools.json"),
        // Wikipedia photos + blurbs exist for Auckland only so far
        s === "auckland" ? optional("data/extras.json") : Promise.resolve({}),
      ]).then(([data, geo, schools, extras]) => {
        const b = {
          slug: s, rec, geo, suburbs: data.suburbs,
          byCode: Object.fromEntries(data.suburbs.map(x => [x.code, x])),
          boards: [...new Set(data.suburbs.map(x => x.board))]
            .filter(x => !x.startsWith("Area Outside")).sort(),
        };
        b.ctx = {
          region: data.region, suburbs: data.suburbs, extras, schools, meta: NZ.meta || {},
          kind: "suburb", noun: "suburb", refName: rec.name, refLabel: "Region",
          boardLabel: rec.board_label,
          onSelect: code => select(code, true),
          onClose: () => { state.selected = null; MapView.select(null, false); updateHash(); },
        };
        return b;
      }).catch(err => { delete bundles[s]; throw err; });
    }
    return bundles[s];
  }

  // ---------------------------------------------------------------- levels
  function showOnMap(geo, opts) {
    if (mapReady) { MapView.setData(geo, opts); return; }
    MapView.init(geo, (code, zoom, point) => {
      if (state.level === "nz") go({ region: code, focus: point });
      else select(code, "auto");   // zooms in only if the suburb is tiny on screen
    }, opts);
    mapReady = true;
  }

  function enterNZ() {
    state.level = "nz"; cur = null; state.selected = null; state.board = "";
    Panel.hide();
    showOnMap(NZGEO, { exclude: ["chatham-islands"], bold: true,
                       hint: "Click to explore its suburbs" });
    syncControls();
  }

  function enterRegion(b, focus) {
    state.level = b.slug; cur = b; state.selected = null; state.board = "";
    Panel.hide();
    showOnMap(b.geo, { focus });   // focus = where on the NZ map the region was clicked
    syncControls();
  }

  /* the one way to move around: {region, suburb, board, metric, profile, focus} */
  async function go(t) {
    const my = ++navToken;
    const target = t.region || "nz";
    let changed = false;
    if (target !== state.level) {
      if (target === "nz") enterNZ();
      else {
        veil("Loading " + regionBySlug[target].name + "…");
        let b;
        try { b = await loadRegion(target); }
        catch (err) {
          if (my === navToken) veil("Couldn’t load " + regionBySlug[target].name + " (" + err.message + ").");
          return;
        }
        if (my !== navToken) return;   // a newer navigation won
        enterRegion(b, t.focus);
        veil(null);
      }
      changed = true;
    }
    if (t.metric) MapView.setMetric(t.metric);
    if (state.level !== "nz") {
      const board = t.board || "";
      if (t.suburb && cur.byCode[t.suburb]) {
        setBoard(board, false);
        select(t.suburb, true);
      } else {
        if (state.selected) select(null);
        setBoard(board, !!board || !changed);
        if (t.profile) showProfile();
      }
    }
    updateHash(changed);
  }

  function setBoard(board, zoom) {
    state.board = board;
    $("board-select").value = board;
    MapView.zoomToBoard(board || null, zoom);
  }

  function showProfile() {
    state.selected = null;
    MapView.select(null, false);
    Panel.show(cur.rec, ctxNZ);
    updateHash();
  }

  // ---------------------------------------------------------------- select
  function select(code, zoom = true) {
    state.selected = code;
    MapView.select(code, zoom);
    if (code && cur && cur.byCode[code]) Panel.show(cur.byCode[code], cur.ctx);
    else Panel.hide();
    updateHash();
  }

  // ---------------------------------------------------------------- controls
  const regionSel = $("region-select");
  const islands = [...new Set(NZ.regions.map(r => r.island))];
  regionSel.innerHTML = `<option value="">Choose a region…</option>` +
    islands.map(isl => `<optgroup label="${isl}">` +
      NZ.regions.filter(r => r.island === isl)
        .map(r => `<option value="${r.slug}">${r.name}</option>`).join("") +
      `</optgroup>`).join("");

  function syncControls() {
    const nz = state.level === "nz";
    regionSel.value = nz ? "" : state.level;
    $("crumb-nz").disabled = nz;
    $("nav-hint").hidden = !nz;
    $("region-profile").hidden = nz;
    const bSel = $("board-select");
    const show = !nz && cur.boards.length > 1;
    bSel.hidden = $("board-sep").hidden = !show;
    if (show) {
      bSel.setAttribute("aria-label", cur.rec.board_label);
      bSel.innerHTML = `<option value="">All of ${cur.rec.name}</option>` +
        cur.boards.map(b => `<option>${b}</option>`).join("");
    }
    document.title = nz ? "New Zealand population by suburb: 2023 Census map | " + SITE
                        : cur.rec.name + " suburbs | " + SITE;
  }

  regionSel.addEventListener("change", () => go({ region: regionSel.value || null }));
  $("crumb-nz").addEventListener("click", () => go({}));
  $("brand-home").addEventListener("click", e => { e.preventDefault(); go({}); });
  $("board-select").addEventListener("change", e => setBoard(e.target.value, true));
  $("region-profile").addEventListener("click", showProfile);

  // ---------------------------------------------------------------- search
  // one box for the whole country: regions, districts / local boards, suburbs
  const input = $("search-input");
  const list = $("search-results");
  let focusIdx = -1, matches = [];

  function findMatches(q) {
    const out = [];
    NZ.regions.filter(r => r.name.toLowerCase().includes(q)).slice(0, 3).forEach(r =>
      out.push({ kind: "Region", label: r.name, hint: r.n_areas + " suburbs",
                 target: { region: r.slug } }));
    districts.filter(d => d.board.toLowerCase().includes(q)).slice(0, 4).forEach(d =>
      out.push({ kind: regionBySlug[d.region].board_label, label: d.board,
                 hint: regionBySlug[d.region].name,
                 target: { region: d.region, board: d.board } }));
    const subs = INDEX.filter(s =>
      s.name.toLowerCase().includes(q) || (s.colloquial || "").toLowerCase().includes(q));
    subs.sort((a, b) => a.name.toLowerCase().startsWith(q) === b.name.toLowerCase().startsWith(q)
      ? 0 : a.name.toLowerCase().startsWith(q) ? -1 : 1);
    subs.slice(0, 12 - out.length).forEach(s =>
      out.push({ label: s.name,
                 hint: (s.colloquial ? s.colloquial + " · " : "") + s.board + " · " + regionBySlug[s.region].name,
                 target: { region: s.region, suburb: s.code } }));
    return out;
  }
  function renderMatches() {
    if (!matches.length) { list.hidden = true; return; }
    list.innerHTML = matches.map((m, i) =>
      `<li data-i="${i}" class="${i === focusIdx ? "focused" : ""}">` +
      (m.kind ? `<span class="kind">${m.kind}</span>` : "") + m.label +
      `<span class="hint">${m.hint}</span></li>`).join("");
    list.hidden = false;
  }
  function choose(m) {
    list.hidden = true; input.value = m.label;
    go(m.target);
  }
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    focusIdx = -1;
    if (q.length < 2) { matches = []; list.hidden = true; return; }
    matches = findMatches(q);
    renderMatches();
  });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { focusIdx = Math.min(focusIdx + 1, matches.length - 1); renderMatches(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { focusIdx = Math.max(focusIdx - 1, 0); renderMatches(); e.preventDefault(); }
    else if (e.key === "Enter" && matches.length) choose(matches[Math.max(focusIdx, 0)]);
    else if (e.key === "Escape") list.hidden = true;
  });
  list.addEventListener("mousedown", e => {
    const li = e.target.closest("li[data-i]");
    if (li) choose(matches[+li.dataset.i]);
  });
  document.addEventListener("click", e => {
    if (!$("search").contains(e.target)) list.hidden = true;
  });

  // ---------------------------------------------------------------- legal
  // The one place for everything the licences and the Privacy Act 2020 ask
  // for: who the data belongs to and what was changed (CC BY 4.0 attribution),
  // what the figures can't tell you, and what is collected about visitors.
  // Opened from the "Sources & privacy" link in the map's attribution strip.
  const CONTACT = "";   // email shown for privacy requests; the line is omitted while empty

  function initLegal() {
    const dlg = $("legal");
    const dates = Object.values(NZ.sources || {}).map(s => s.downloaded).filter(Boolean).sort();
    const by = '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';
    $("legal-body").innerHTML = `
      <h2>Sources &amp; privacy</h2>

      <h3>Where the data comes from</h3>
      <ul>
        <li><strong>Census 2013, 2018 and 2023, area boundaries, building consents</strong>:
          <a href="https://www.stats.govt.nz/" target="_blank" rel="noopener">Stats NZ</a>,
          licensed ${by}.</li>
        <li><strong>NZDep2023 deprivation index</strong>: Department of Public Health,
          University of Otago, Wellington.</li>
        <li><strong>Rents from new bonds</strong>: Tenancy Services, Ministry of Business,
          Innovation and Employment, ${by}.</li>
        <li><strong>Schools and Equity Index</strong>: Ministry of Education, ${by}.</li>
        <li><strong>Flood plains (Auckland)</strong>: Auckland Council open data.</li>
        <li><strong>Base map</strong>: ©
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>
          contributors, via OpenMapTiles and OpenFreeMap.</li>
        <li><strong>Photos and descriptions</strong>: Wikipedia (CC BY-SA 4.0) and Wikimedia
          Commons; each photo credits its author and licence.</li>
      </ul>
      <p>This site has adapted that data: percentages, regional totals and regional medians are
      our own calculations, and boundaries are simplified. It is an independent project, not
      produced or endorsed by Stats NZ or any other source.
      ${dates.length ? `Data downloaded ${dates[0]}${dates[dates.length - 1] !== dates[0] ? " to " + dates[dates.length - 1] : ""}.` : ""}</p>

      <h3>Browse by region</h3>
      <p>${NZ.regions.map(r => `<a href="/${r.slug}/">${r.name}</a>`).join(" · ")}</p>

      <h3>Reading the figures</h3>
      <p>General information only, not financial, property or legal advice, and provided
      without warranty. Areas are Stats NZ “SA2” statistical areas, which only approximate
      suburbs. Census counts are randomly rounded by Stats NZ, and “S” marks figures it has
      suppressed. Regional medians and regional deprivation scores are estimates built from
      the areas inside each region. Flood-plain shares show how much of an area's land is in a
      modelled flood plain; they say nothing about any individual property.</p>

      <h3>Privacy</h3>
      <p>There are no accounts or forms here and we don't ask for your name or contact details.
      We use Google Analytics (loaded through Google Tag Manager) to count visits. It sets
      cookies and collects usage information such as the pages viewed, your approximate
      location (from your IP address) and your device and browser type. Google holds this for
      us, possibly on servers outside New Zealand, and we use it only as overall visitor
      statistics. You can block it with your browser's cookie or tracking settings or Google's
      <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">opt-out add-on</a>;
      the site works the same without it. Map tiles and photos load from OpenFreeMap and
      Wikimedia, which see your IP address as any website does.</p>
      <p>Under the Privacy Act 2020 you can ask what information is held about you and ask for
      it to be corrected${CONTACT ? `. Email <a href="mailto:${CONTACT}">${CONTACT}</a>` : ""}.</p>`;
    document.addEventListener("click", e => {
      if (e.target.closest("[data-legal]")) { e.preventDefault(); dlg.showModal(); }
      else if (e.target === dlg) dlg.close();          // click on the backdrop
    });
    $("legal-close").addEventListener("click", () => dlg.close());
    // the static region / suburb pages link here as /#sources
    if (location.hash === "#sources") {
      history.replaceState(null, "", location.pathname + location.search);
      dlg.showModal();
    }
  }

  // keyboard: Escape closes panel
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && state.selected) { select(null); }
  });

  // ------------------------------------------------ shareable URLs
  // #canterbury                         -> that region's suburbs
  // #canterbury/riccarton               -> that suburb selected + zoomed
  // #canterbury/riccarton/median_rent   -> plus that choropleth metric
  // #canterbury/m/median_rent           -> region + metric, nothing selected
  // #m/median_rent                      -> all of NZ, that metric
  // #takanini-north[/metric]            -> old Auckland-era links still resolve
  function currentHash() {
    const m = MapView.getMetric();
    const parts = [];
    if (state.level !== "nz") parts.push(state.level);
    const sel = state.selected && cur && cur.byCode[state.selected];
    if (sel) parts.push(slug(sel.name));
    if (m !== "pop2023") parts.push(...(sel ? [m] : ["m", m]));
    return parts.length ? "#" + parts.join("/") : "";
  }

  function updateHash(push) {
    if (applyingHash || !state.level) return;
    const h = currentHash();
    if (h === location.hash) return;
    history[push ? "pushState" : "replaceState"](null, "", h || location.pathname + location.search);
  }

  function parseHash() {
    let raw = location.hash.replace(/^#/, "");
    try { raw = decodeURIComponent(raw); } catch (e) { /* keep raw */ }
    const parts = raw.split("/").filter(Boolean);
    const t = {};
    let rest = parts;
    if (parts[0] && regionBySlug[parts[0]]) { t.region = parts[0]; rest = parts.slice(1); }
    if (rest[0] === "m") { t.metric = rest[1]; return t; }
    if (rest[0]) {
      const hit = INDEX.find(x => x.slug === rest[0] && (!t.region || x.region === t.region));
      if (hit) { t.region = hit.region; t.suburb = hit.code; }
      if (rest[1]) t.metric = rest[1];
    }
    return t;
  }

  async function applyHash() {
    if (state.level && location.hash === currentHash()) return;
    const t = parseHash();
    if (!t.metric) t.metric = "pop2023";
    applyingHash = true;
    try { await go(t); } finally { applyingHash = false; }
    updateHash(false);   // canonicalise (e.g. old #suburb links gain their region)
  }

  // ---------------------------------------------------------------- start
  Panel.init();
  initLegal();
  document.addEventListener("metricchange", () => updateHash(false));
  window.addEventListener("hashchange", applyHash);
  window.addEventListener("popstate", applyHash);
  await applyHash();
  if (state.level) veil(null);
})();
