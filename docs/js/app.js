/* Bootstrap: load data, wire views, search, theme. */
"use strict";

(async function () {
  const state = { view: "map", selected: null };
  let DATA, GEO, byCode;

  // ---------------------------------------------------------------- theme
  const themeBtn = document.getElementById("theme-toggle");
  themeBtn.addEventListener("click", () => {
    const cur = Palette.dark();
    document.documentElement.setAttribute("data-theme", cur ? "light" : "dark");
    MapView.refreshTheme();
    if (state.selected) Panel.show(byCode[state.selected], DATA.region); // re-ink charts
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.getAttribute("data-theme")) MapView.refreshTheme();
  });

  // ---------------------------------------------------------------- data
  try {
    [DATA, GEO] = await Promise.all([
      fetch("data/suburbs.json").then(r => { if (!r.ok) throw new Error("suburbs.json " + r.status); return r.json(); }),
      fetch("data/auckland.geojson").then(r => { if (!r.ok) throw new Error("auckland.geojson " + r.status); return r.json(); }),
    ]);
  } catch (err) {
    document.getElementById("loading").textContent =
      "Failed to load data files (" + err.message + "). Run `python3 build.py` first, and serve the site/ directory.";
    return;
  }
  byCode = Object.fromEntries(DATA.suburbs.map(s => [s.code, s]));

  // ---------------------------------------------------------------- select
  function select(code, zoom = true) {
    state.selected = code;
    MapView.select(code, zoom);
    if (code && byCode[code]) Panel.show(byCode[code], DATA.region);
    else Panel.hide();
  }

  Panel.init(() => { state.selected = null; MapView.select(null, false); });
  MapView.init(GEO, code => select(code, false));
  Table.init(DATA.suburbs, code => { setView("map"); select(code, true); });
  renderAbout();
  document.getElementById("loading").classList.add("hide");

  // ---------------------------------------------------------------- tabs
  function setView(v) {
    state.view = v;
    document.querySelectorAll(".tab").forEach(t => {
      const on = t.dataset.view === v;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on);
    });
    document.querySelectorAll(".view").forEach(s =>
      s.classList.toggle("active", s.id === "view-" + v));
    if (v === "map") MapView.resize();
    if (v === "table") Table.refresh(); // view was hidden at init: row window was computed at 0 height
  }
  window.addEventListener("resize", () => { if (state.view === "table") Table.refresh(); });
  document.querySelectorAll(".tab").forEach(t =>
    t.addEventListener("click", () => setView(t.dataset.view)));

  // ---------------------------------------------------------------- search
  const input = document.getElementById("search-input");
  const list = document.getElementById("search-results");
  let focusIdx = -1, matches = [];

  function renderMatches() {
    if (!matches.length) { list.hidden = true; return; }
    list.innerHTML = matches.map((s, i) =>
      `<li data-code="${s.code}" class="${i === focusIdx ? "focused" : ""}">${s.name}` +
      `<span class="hint">${s.colloquial ? s.colloquial + " · " : ""}${s.board}</span></li>`).join("");
    list.hidden = false;
  }
  function choose(code) {
    list.hidden = true; input.value = byCode[code].name;
    setView("map"); select(code, true);
  }
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    focusIdx = -1;
    if (q.length < 2) { matches = []; list.hidden = true; return; }
    matches = DATA.suburbs.filter(s =>
      s.name.toLowerCase().includes(q) || (s.colloquial || "").toLowerCase().includes(q)
    ).slice(0, 12);
    renderMatches();
  });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { focusIdx = Math.min(focusIdx + 1, matches.length - 1); renderMatches(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { focusIdx = Math.max(focusIdx - 1, 0); renderMatches(); e.preventDefault(); }
    else if (e.key === "Enter" && matches.length) choose(matches[Math.max(focusIdx, 0)].code);
    else if (e.key === "Escape") list.hidden = true;
  });
  list.addEventListener("mousedown", e => {
    const li = e.target.closest("li[data-code]");
    if (li) choose(li.dataset.code);
  });
  document.addEventListener("click", e => {
    if (!document.getElementById("search").contains(e.target)) list.hidden = true;
  });

  // ---------------------------------------------------------------- about
  function renderAbout() {
    const src = DATA.sources || {};
    const row = (name, what) => src[name] ? `<tr><td>${what}</td>
      <td>${src[name].source}</td><td>${src[name].downloaded}</td></tr>` : "";
    document.getElementById("about-body").innerHTML = `
      <h2>About the data</h2>
      <p>This site profiles every <strong>Statistical Area 2 (SA2)</strong> in the Auckland
      region using 2023 Census data joined to the NZDep2023 Index of Socioeconomic
      Deprivation. It is a static site — everything you see was produced by a build script
      (<code>build.py</code>) on the date shown below, with no live queries.</p>

      <h3>Sources</h3>
      <table>
        <tr><th>Dataset</th><th>Source</th><th>Downloaded</th></tr>
        ${row("census_sa2_part1.csv", "Census 2023, individuals part 1 (population, age, ethnicity)")}
        ${row("census_sa2_part2.csv", "Census 2023, individuals part 2 (income, qualifications, home ownership)")}
        ${row("geographic_areas_2023.csv", "SA2 → region / local board / SA3 concordance")}
        ${row("sa2_2023_clipped_generalised.geojson", "SA2 2023 boundaries (generalised, clipped to coastline)")}
        ${row("NZDep2023_WgtAvSA2.xlsx", "NZDep2023 SA2-level index, University of Otago")}
      </table>
      <p>Census tables and boundaries are © Stats NZ, licensed under
      <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. NZDep2023 is
      produced by the Department of Public Health, University of Otago, Wellington.
      Site generated on <strong>${DATA.generated}</strong>.</p>

      <h3>SA2s are not quite suburbs</h3>
      <p>Statistical Area 2 is the Stats NZ geography that most closely approximates suburbs,
      but the fit is imperfect: <strong>large suburbs are split</strong> across several SA2s
      (e.g. “Ponsonby East” / “Ponsonby West”), and <strong>some SA2s merge</strong> a few small
      localities. The official SA2 name is the source of truth everywhere on this site. Where an
      SA2 belongs to a broader commonly-named area, the “part of” field shows the official
      <em>SA3</em> name that groups it (e.g. Ponsonby West → Ponsonby) — it is never a guess,
      and it is blank where no unambiguous grouping exists.</p>

      <h3>Ethnicity is multi-response</h3>
      <p>People can and do identify with more than one ethnic group, so the six group shares
      <strong>intentionally sum to more than 100%</strong>. Shares are calculated against the
      number of people who <em>stated</em> an ethnicity. They are never normalised to 100%, and
      ethnicity is never shown as a pie chart, because the groups overlap.</p>

      <h3>Random rounding &amp; suppression</h3>
      <p>Stats NZ applies <strong>fixed random rounding to base 3</strong> to all census counts
      to protect confidentiality. Small-area figures therefore may not add up to published
      totals — this is by design and has not been “corrected”. Cells that Stats NZ suppresses
      entirely appear as <strong>“S”</strong> and are never interpolated or estimated. A handful
      of water-only SA2s (inlets, oceanic areas) appear in the table but not on the map, because
      the coastline-clipped boundary file has no land to draw for them.</p>

      <h3>Reading NZDep2023 the right way round</h3>
      <p>NZDep2023 deciles run from <strong>1 = least deprived</strong> to
      <strong>10 = most deprived</strong>. Deciles are national: a decile-10 area is among the
      most deprived 10% of small areas in New Zealand. NZDep measures the socioeconomic position
      of an <strong>area</strong>, not of any individual living there. The SA2-level file used
      here (<code>NZDep2023_WgtAvSA2</code>) is Otago’s population-weighted average of SA1
      scores; non-residential areas have no score.</p>

      <h3>Other definitions</h3>
      <p>Population is the census usually resident population. Income, qualifications and home
      ownership are for people aged 15+; “owns home” includes homes held in a family trust;
      qualification shares are of people who stated one. Regional medians (age, income) are
      population-weighted medians of SA2 medians, because Stats NZ does not publish region-level
      medians in this dataset. The University of Otago website blocks automated downloads, so the
      build fetches NZDep2023 from the Internet Archive’s capture of the official file when the
      direct download is refused — the file is byte-identical to Otago’s release of 31 October 2024.</p>

      <h3>Colour scales</h3>
      <p>Continuous metrics use a single-hue blue scale (light = low, dark = high — reversed in
      dark mode so low values recede). Population change uses a blue↔red diverging scale with a
      neutral midpoint at zero. No red-green pairings are used anywhere.</p>`;
  }

  // keyboard: Escape closes panel
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && state.selected) { select(null); }
  });
})();
