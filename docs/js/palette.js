/* Colour ramps + metric definitions.
   Ramps follow the dataviz palette: sequential = one hue (blue) light->dark;
   diverging = blue <-> red with a neutral grey midpoint; never red-green.
   In dark mode sequential ramps flip so "low" recedes toward the dark surface.
   NZDep: decile 1 = LEAST deprived (light), 10 = most deprived (dark). */
"use strict";

const Palette = (() => {
  // blue sequential steps 100..700
  const BLUE = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7",
                "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];
  const SEQ6 = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
  const DECILE10 = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#5598e7",
                    "#3987e5", "#2a78d6", "#1c5cab", "#184f95", "#0d366b"];
  // diverging: red (decline) <-> neutral <-> blue (growth)
  const DIV7_LIGHT = ["#b02a2a", "#e34948", "#f0a2a1", "#f0efec", "#86b6ef", "#2a78d6", "#184f95"];
  const DIV7_DARK  = ["#b02a2a", "#e34948", "#f0a2a1", "#383835", "#86b6ef", "#2a78d6", "#184f95"];

  const dark = () => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t) return t === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const noData = () => dark() ? "#3a3a37" : "#e8e7e2";
  const seq6 = () => dark() ? [...SEQ6].reverse() : SEQ6;
  const decile10 = () => dark() ? [...DECILE10].reverse() : DECILE10;
  const div7 = () => dark() ? DIV7_DARK : DIV7_LIGHT;

  // ---------- formatting
  const fmtInt = v => v == null ? "S" : Math.round(v).toLocaleString("en-NZ");
  const fmtPct = v => v == null ? "S" : v.toFixed(1) + "%";
  const fmtPctSigned = v => v == null ? "S" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  const fmtAge = v => v == null ? "S" : v.toFixed(1);
  const fmtDollar = v => v == null ? "S" : "$" + Math.round(v).toLocaleString("en-NZ");
  const fmtDecile = v => v == null ? "No data" : String(v);

  // ---------- metrics available on the map (property names match auckland.geojson)
  const METRICS = {
    dep_decile: { label: "NZDep2023 deprivation decile", short: "NZDep decile",
                  kind: "decile", fmt: fmtDecile, group: "Deprivation & housing",
                  note: "1 = least deprived · 10 = most deprived (area measure)" },
    home_own_pct: { label: "Home ownership rate (15+)", short: "Home ownership", kind: "seq", fmt: fmtPct, group: "Deprivation & housing" },
    median_rent: { label: "Median weekly rent", short: "Median rent", kind: "seq", fmt: fmtDollar, group: "Deprivation & housing" },
    crowded_pct: { label: "Crowded households %", short: "Crowded households", kind: "seq", fmt: fmtPct, group: "Deprivation & housing" },
    damp_pct: { label: "Damp homes %", short: "Damp homes", kind: "seq", fmt: fmtPct, group: "Deprivation & housing" },
    mould_pct: { label: "Homes with mould %", short: "Mould", kind: "seq", fmt: fmtPct, group: "Deprivation & housing" },
    separate_house_pct: { label: "Stand-alone houses %", short: "Stand-alone houses", kind: "seq", fmt: fmtPct, group: "Deprivation & housing" },

    pop2023: { label: "Population (2023)", short: "Population", kind: "seq", fmt: fmtInt, group: "People" },
    pop_change_pct: { label: "Population change 2018–2023", short: "Pop. change 2018–23",
                      kind: "div", fmt: fmtPctSigned, group: "People" },
    median_age: { label: "Median age", short: "Median age", kind: "seq", fmt: fmtAge, group: "People" },
    overseas_born_pct: { label: "Overseas-born %", short: "Overseas-born", kind: "seq", fmt: fmtPct, group: "People" },
    same_home_5y_pct: { label: "Same home as 5 years ago %", short: "Same home 5 yrs", kind: "seq", fmt: fmtPct, group: "People" },
    te_reo_pct: { label: "Te reo Māori speakers %", short: "Te reo speakers", kind: "seq", fmt: fmtPct, group: "People" },

    median_income: { label: "Median personal income (15+)", short: "Median income", kind: "seq", fmt: fmtDollar, group: "Work & income" },
    median_hh_income: { label: "Median household income", short: "Household income", kind: "seq", fmt: fmtDollar, group: "Work & income" },
    unemployment_pct: { label: "Unemployment rate", short: "Unemployment", kind: "seq", fmt: fmtPct, group: "Work & income" },
    travel_pt: { label: "Commute by public transport %", short: "PT commute", kind: "seq", fmt: fmtPct, group: "Work & income" },
    travel_wfh: { label: "Work from home %", short: "Work from home", kind: "seq", fmt: fmtPct, group: "Work & income" },
    travel_active: { label: "Walk or cycle to work %", short: "Walk/cycle commute", kind: "seq", fmt: fmtPct, group: "Work & income" },

    eth_European: { label: "European (% of stated)", short: "European", kind: "seq", fmt: fmtPct, multi: true, group: "Ethnicity" },
    "eth_Māori": { label: "Māori (% of stated)", short: "Māori", kind: "seq", fmt: fmtPct, multi: true, group: "Ethnicity" },
    eth_Pacific: { label: "Pacific Peoples (% of stated)", short: "Pacific", kind: "seq", fmt: fmtPct, multi: true, group: "Ethnicity" },
    eth_Asian: { label: "Asian (% of stated)", short: "Asian", kind: "seq", fmt: fmtPct, multi: true, group: "Ethnicity" },
    eth_MELAA: { label: "MELAA (% of stated)", short: "MELAA", kind: "seq", fmt: fmtPct, multi: true, group: "Ethnicity" },
    eth_Other: { label: "Other ethnicity (% of stated)", short: "Other ethnicity", kind: "seq", fmt: fmtPct, multi: true, group: "Ethnicity" },
  };

  // quantile thresholds -> 6 classes, snapped to "nice" values
  function quantileBins(values) {
    const v = values.filter(x => x != null).sort((a, b) => a - b);
    if (!v.length) return [];
    const qs = [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].map(q => v[Math.floor(q * (v.length - 1))]);
    const range = v[v.length - 1] - v[0];
    const step = Math.pow(10, Math.floor(Math.log10(range / 6 || 1)));
    const nice = qs.map(t => Math.round(t / step) * step);
    return [...new Set(nice)]; // dedupe if data is tight
  }

  const DIV_THRESHOLDS = [-10, -5, -1, 1, 5, 10]; // % change bins around 0

  // Build {colors, thresholds} for a metric given the current theme + data values
  function scale(metricKey, values) {
    const m = METRICS[metricKey];
    if (m.kind === "decile") {
      return { kind: "decile", colors: decile10(), thresholds: [2, 3, 4, 5, 6, 7, 8, 9, 10] };
    }
    if (m.kind === "div") {
      return { kind: "div", colors: div7(), thresholds: DIV_THRESHOLDS };
    }
    const t = quantileBins(values);
    return { kind: "seq", colors: seq6().slice(0, t.length + 1), thresholds: t };
  }

  return { METRICS, scale, noData, dark, decile10, seq6, div7,
           fmtInt, fmtPct, fmtPctSigned, fmtAge, fmtDollar, fmtDecile };
})();
