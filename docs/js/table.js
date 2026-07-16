/* Table view: all SA2 rows, virtualised scrolling, sortable columns,
   name/board/decile filters, CSV export of the current filtered view. */
"use strict";

const Table = (() => {
  const ROW_H = 33;
  let suburbs = [], filtered = [], onRowClick;
  let sortKey = "name", sortDir = 1;

  const COLS = [
    { key: "name", label: "Suburb (SA2)", txt: true, get: s => s.name },
    { key: "colloquial", label: "Part of", txt: true, get: s => s.colloquial },
    { key: "board", label: "Local board", txt: true, get: s => s.board },
    { key: "pop2023", label: "Pop 2023", get: s => s.pop2023, fmt: Palette.fmtInt },
    { key: "pop_change_pct", label: "Δ 2018–23", get: s => s.pop_change_pct, fmt: Palette.fmtPctSigned },
    { key: "median_age", label: "Median age", get: s => s.median_age, fmt: Palette.fmtAge },
    { key: "age0", label: "0–14 %", get: s => s.age["0-14"].pct, fmt: Palette.fmtPct },
    { key: "age15", label: "15–29 %", get: s => s.age["15-29"].pct, fmt: Palette.fmtPct },
    { key: "age30", label: "30–64 %", get: s => s.age["30-64"].pct, fmt: Palette.fmtPct },
    { key: "age65", label: "65+ %", get: s => s.age["65+"].pct, fmt: Palette.fmtPct },
    { key: "ethE", label: "European %", get: s => s.ethnicity.European.pct, fmt: Palette.fmtPct },
    { key: "ethM", label: "Māori %", get: s => s.ethnicity["Māori"].pct, fmt: Palette.fmtPct },
    { key: "ethP", label: "Pacific %", get: s => s.ethnicity.Pacific.pct, fmt: Palette.fmtPct },
    { key: "ethA", label: "Asian %", get: s => s.ethnicity.Asian.pct, fmt: Palette.fmtPct },
    { key: "ethMe", label: "MELAA %", get: s => s.ethnicity.MELAA.pct, fmt: Palette.fmtPct },
    { key: "ethO", label: "Other %", get: s => s.ethnicity.Other.pct, fmt: Palette.fmtPct },
    { key: "median_income", label: "Median income", get: s => s.median_income, fmt: Palette.fmtDollar },
    { key: "median_hh_income", label: "HH income", get: s => s.median_hh_income, fmt: Palette.fmtDollar },
    { key: "median_rent", label: "Rent /wk", get: s => s.median_rent, fmt: Palette.fmtDollar },
    { key: "bachelor_pct", label: "Bachelor+ %", get: s => s.bachelor_pct, fmt: Palette.fmtPct },
    { key: "home_own_pct", label: "Own home %", get: s => s.home_own_pct, fmt: Palette.fmtPct },
    { key: "unemployment_pct", label: "Unemp %", get: s => s.unemployment_pct, fmt: Palette.fmtPct },
    { key: "overseas_born_pct", label: "Overseas-born %", get: s => s.overseas_born_pct, fmt: Palette.fmtPct },
    { key: "travel_pt", label: "PT commute %", get: s => s.travel["Public transport"].pct, fmt: Palette.fmtPct },
    { key: "travel_wfh", label: "WFH %", get: s => s.travel["Work from home"].pct, fmt: Palette.fmtPct },
    { key: "damp_pct", label: "Damp %", get: s => s.damp_pct, fmt: Palette.fmtPct },
    { key: "crowded_pct", label: "Crowded %", get: s => s.crowded_pct, fmt: Palette.fmtPct },
    { key: "same_home_5y_pct", label: "Same home 5y %", get: s => s.same_home_5y_pct, fmt: Palette.fmtPct },
    { key: "dep_decile", label: "NZDep decile", get: s => s.dep_decile, fmt: v => v == null ? "—" : String(v) },
    { key: "dep_score", label: "NZDep score", get: s => s.dep_score, fmt: v => v == null ? "—" : String(v) },
    { key: "code", label: "SA2 code", txt: true, get: s => s.code },
  ];
  const colByKey = Object.fromEntries(COLS.map(c => [c.key, c]));

  function init(data, rowClickCb) {
    suburbs = data;
    onRowClick = rowClickCb;

    // header
    const head = document.getElementById("table-head");
    head.innerHTML = "<tr>" + COLS.map(c =>
      `<th class="${c.txt ? "txt" : ""}" data-key="${c.key}">${c.label}<span class="arrow"></span></th>`
    ).join("") + "</tr>";
    head.querySelectorAll("th").forEach(th => th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = colByKey[k].txt ? 1 : -1; }
      apply();
    }));

    // filters
    const boards = [...new Set(suburbs.map(s => s.board))].sort();
    const bSel = document.getElementById("tbl-filter-board");
    bSel.innerHTML = `<option value="">All local boards</option>` +
      boards.map(b => `<option>${b}</option>`).join("");
    const dMin = document.getElementById("tbl-decile-min");
    const dMax = document.getElementById("tbl-decile-max");
    dMin.innerHTML = Array.from({ length: 10 }, (_, i) => `<option>${i + 1}</option>`).join("");
    dMax.innerHTML = dMin.innerHTML;
    dMin.value = "1"; dMax.value = "10";

    ["input", "change"].forEach(ev => {
      document.getElementById("tbl-filter-name").addEventListener(ev, apply);
      bSel.addEventListener(ev, apply);
      dMin.addEventListener(ev, apply);
      dMax.addEventListener(ev, apply);
    });
    document.getElementById("tbl-export").addEventListener("click", exportCsv);
    document.getElementById("table-scroll").addEventListener("scroll", renderRows);
    document.getElementById("table-body").addEventListener("click", e => {
      const tr = e.target.closest("tr[data-code]");
      if (tr && onRowClick) onRowClick(tr.dataset.code);
    });
    apply();
  }

  function apply() {
    const q = document.getElementById("tbl-filter-name").value.trim().toLowerCase();
    const board = document.getElementById("tbl-filter-board").value;
    let lo = +document.getElementById("tbl-decile-min").value;
    let hi = +document.getElementById("tbl-decile-max").value;
    if (lo > hi) [lo, hi] = [hi, lo];
    const fullRange = lo === 1 && hi === 10;

    filtered = suburbs.filter(s => {
      if (q && !(s.name.toLowerCase().includes(q) || (s.colloquial || "").toLowerCase().includes(q))) return false;
      if (board && s.board !== board) return false;
      if (!fullRange && (s.dep_decile == null || s.dep_decile < lo || s.dep_decile > hi)) return false;
      return true;
    });

    const col = colByKey[sortKey];
    filtered.sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;           // nulls always last
      if (vb == null) return -1;
      return (col.txt ? String(va).localeCompare(String(vb)) : va - vb) * sortDir;
    });

    document.querySelectorAll("#table-head th .arrow").forEach(a => a.textContent = "");
    const th = document.querySelector(`#table-head th[data-key="${sortKey}"] .arrow`);
    if (th) th.textContent = sortDir === 1 ? "▲" : "▼";
    document.getElementById("tbl-count").textContent =
      `${filtered.length} of ${suburbs.length} areas`;
    renderRows();
  }

  /* windowed rendering: only rows near the viewport get DOM */
  function renderRows() {
    const scroller = document.getElementById("table-scroll");
    const body = document.getElementById("table-body");
    const headH = 35;
    const top = scroller.scrollTop;
    const viewH = scroller.clientHeight;
    const first = Math.max(0, Math.floor((top - headH) / ROW_H) - 8);
    const last = Math.min(filtered.length, Math.ceil((top + viewH) / ROW_H) + 8);

    const padTop = first * ROW_H;
    const padBottom = (filtered.length - last) * ROW_H;
    const cells = s => COLS.map(c => {
      const v = c.get(s);
      const isSupp = v == null && !c.txt;
      return `<td class="${c.txt ? "txt" : ""}${isSupp ? " suppressed" : ""}">` +
        (c.txt ? (v || "") : c.fmt(v)) + "</td>";
    }).join("");

    body.innerHTML =
      `<tr style="height:${padTop}px"><td colspan="${COLS.length}" style="padding:0;border:0"></td></tr>` +
      filtered.slice(first, last).map(s =>
        `<tr data-code="${s.code}" style="height:${ROW_H}px" title="Show ${s.name} on the map">${cells(s)}</tr>`
      ).join("") +
      `<tr style="height:${padBottom}px"><td colspan="${COLS.length}" style="padding:0;border:0"></td></tr>`;
  }

  function exportCsv() {
    const header = COLS.map(c => `"${c.label.replace(/"/g, '""')}"`).join(",");
    const lines = filtered.map(s => COLS.map(c => {
      const v = c.get(s);
      if (v == null) return c.txt ? "" : "S";
      return typeof v === "number" ? v : `"${String(v).replace(/"/g, '""')}"`;
    }).join(","));
    const blob = new Blob(["﻿" + [header, ...lines].join("\r\n")],
      { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "auckland-suburbs-filtered.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return { init, refresh: () => renderRows() };
})();
