/* Detail panel: header, ethnicity + age bar charts (SVG, with regional
   reference ticks), stat cards, NZDep decile strip. Every value is printed,
   not just drawn. Suppressed cells render as "S", never estimated. */
"use strict";

const Panel = (() => {
  let el, body, onClose;

  function init(closeCb) {
    el = document.getElementById("panel");
    body = document.getElementById("panel-body");
    onClose = closeCb;
    document.getElementById("panel-close").addEventListener("click", () => {
      hide(); if (onClose) onClose();
    });
  }

  const esc = s => String(s).replace(/[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* Horizontal bar chart with a reference tick per row (regional average).
     Bars: 18px thick, rounded data-end (4px), square at the left baseline.
     Text wears ink tokens, never the series colour. */
  function barChart(rows, opts) {
    const W = 340, labelW = 62, valueW = 46, barH = 18, gap = 10, padT = 4;
    const plotW = W - labelW - valueW - 8;
    const H = padT + rows.length * (barH + gap);
    const max = Math.max(
      ...rows.map(r => r.value ?? 0),
      ...rows.map(r => r.ref ?? 0), opts.min100 ? 100 : 0) * 1.06 || 1;
    const x = v => (v / max) * plotW;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opts.aria)}">`;
    rows.forEach((r, i) => {
      const y = padT + i * (barH + gap);
      const cy = y + barH / 2;
      s += `<text x="${labelW - 6}" y="${cy + 4}" text-anchor="end" font-size="11.5"
              fill="var(--ink-2)">${esc(r.label)}</text>`;
      if (r.value == null) {
        s += `<text x="${labelW + 4}" y="${cy + 4}" font-size="11.5" font-style="italic"
                fill="var(--muted)">S — suppressed</text>`;
        if (r.ref != null) {
          const rx = labelW + x(r.ref);
          s += `<rect x="${rx - 1}" y="${y - 2}" width="2" height="${barH + 4}" fill="var(--ink)"
                  opacity="0.85"><title>Auckland average: ${esc(r.refFmt)}</title></rect>`;
        }
      } else {
        const w = Math.max(x(r.value), 1.5);
        const rr = Math.min(4, w);
        s += `<path d="M${labelW},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr}
                v${barH - 2 * rr} a${rr},${rr} 0 0 1 ${-rr},${rr} h${-(w - rr)} z"
                fill="var(--accent)">
                <title>${esc(r.label)}: ${esc(r.fmt)}${r.count != null ? ` (${r.count.toLocaleString("en-NZ")} people)` : ""}</title>
              </path>`;
        if (r.ref != null) {
          const rx = labelW + x(r.ref);
          s += `<rect x="${rx - 1}" y="${y - 2}" width="2" height="${barH + 4}" fill="var(--ink)"
                  opacity="0.85"><title>Auckland average: ${esc(r.refFmt)}</title></rect>`;
        }
        // value label drawn last with a surface halo so a nearby reference
        // tick can never strike through the number
        s += `<text x="${labelW + w + 5}" y="${cy + 4}" font-size="11.5" font-weight="600"
                fill="var(--ink)" stroke="var(--surface)" stroke-width="3"
                paint-order="stroke" stroke-linejoin="round">${esc(r.fmt)}</text>`;
      }
    });
    s += "</svg>";
    return s;
  }

  function statCard(label, value, refText, delta) {
    return `<div class="stat-card">
      <div class="s-label">${esc(label)}</div>
      <div class="s-value">${esc(value)}</div>
      <div class="s-ref">${esc(refText)}${delta ? " · " + esc(delta) : ""}</div>
    </div>`;
  }

  function depStrip(s) {
    const colors = Palette.decile10();
    if (s.dep_decile == null) {
      return `<p class="dep-caption suppressed">No NZDep2023 score — Stats NZ does not
        publish one for this area (typically non-residential: inlets, islands, ports).</p>`;
    }
    const cells = colors.map((c, i) => {
      const d = i + 1;
      const cur = d === s.dep_decile;
      // pick label ink by fill luminance: first half of the light->dark ramp is light
      const lightFill = Palette.dark() ? i >= 5 : i < 5;
      return `<div class="dep-cell ${cur ? "current" : ""} ${cur && lightFill ? "light-fill" : ""}"
        style="background:${c}" title="Decile ${d}">${cur ? d : ""}</div>`;
    }).join("");
    const side = s.dep_decile <= 3 ? "among Auckland’s least deprived areas"
      : s.dep_decile <= 5 ? "less deprived than the national midpoint"
      : s.dep_decile <= 7 ? "more deprived than the national midpoint"
      : "among the most deprived areas";
    return `
      <div class="dep-strip">${cells}</div>
      <div class="dep-strip-labels"><span>1 · least deprived</span><span>10 · most deprived</span></div>
      <p class="dep-caption"><strong>Decile ${s.dep_decile} of 10</strong>
        (score ${s.dep_score.toLocaleString("en-NZ")}) — ${side}.</p>
      <p class="dep-note">NZDep2023 measures the <strong>area</strong>, not the individuals living
        in it. Deciles are national: decile 10 = the most deprived 10% of NZ small areas.</p>`;
  }

  function show(s, region) {
    const ETH_ORDER = ["European", "Māori", "Pacific", "Asian", "MELAA", "Other"];
    const AGE_ORDER = ["0-14", "15-29", "30-64", "65+"];
    const chg = s.pop_change_pct;
    const chgHtml = chg == null ? `<small class="suppressed">change 2018–23: S</small>`
      : `<small class="${chg >= 0 ? "delta-up" : "delta-down"}">${Palette.fmtPctSigned(chg)} since 2018
         (${Palette.fmtInt(s.pop2018)})</small>`;

    const ethRows = ETH_ORDER.map(k => ({
      label: k, value: s.ethnicity[k].pct, count: s.ethnicity[k].n,
      fmt: Palette.fmtPct(s.ethnicity[k].pct),
      ref: region.ethnicity[k], refFmt: Palette.fmtPct(region.ethnicity[k]),
    }));
    const ageRows = AGE_ORDER.map(k => ({
      label: k === "0-14" ? "0–14" : k === "15-29" ? "15–29" : k === "30-64" ? "30–64" : "65+",
      value: s.age[k].pct, count: s.age[k].n, fmt: Palette.fmtPct(s.age[k].pct),
      ref: region.age[k], refFmt: Palette.fmtPct(region.age[k]),
    }));

    const dAge = s.median_age == null ? null : s.median_age - region.median_age;
    const dInc = s.median_income == null ? null : s.median_income - region.median_income;
    const dBach = s.bachelor_pct == null ? null : s.bachelor_pct - region.bachelor_pct;
    const dOwn = s.home_own_pct == null ? null : s.home_own_pct - region.home_own_pct;
    const sign = (d, unit, fmt) => d == null ? "" :
      (d >= 0 ? "+" : "−") + fmt(Math.abs(d)) + unit + " vs region";

    body.innerHTML = `
      <h2>${esc(s.name)}</h2>
      <p class="p-sub">${esc(s.board)} Local Board · SA2 ${esc(s.code)}</p>
      ${s.colloquial ? `<p class="p-colloquial">Part of the wider “${esc(s.colloquial)}” area (SA3)</p>` : ""}
      <div class="p-pop">${Palette.fmtInt(s.pop2023)} ${chgHtml}</div>
      <div class="footnote">Usually resident population, Census 2023${s.on_map === false
        ? " · water-only area, not drawn on the map" : ""}</div>

      <section>
        <h4>Ethnicity — share of people who stated an ethnicity</h4>
        <p class="h4-note">Multi-response: people can identify with several groups, so shares
          sum to more than 100%. Never normalised.</p>
        ${barChart(ethRows, { aria: "Ethnicity shares vs Auckland average", min100: false })}
        <div class="chart-key"><span class="key-tick"></span> Auckland regional average</div>
      </section>

      <section>
        <h4>Age distribution</h4>
        <p class="h4-note">Share of the ${s.pop2023 == null ? "" : "area’s "}population in each band.</p>
        ${barChart(ageRows, { aria: "Age distribution vs Auckland average", min100: false })}
        <div class="chart-key"><span class="key-tick"></span> Auckland regional average
          ${s.median_age != null ? `&nbsp;·&nbsp; Median age <strong>&nbsp;${Palette.fmtAge(s.median_age)}</strong>` : ""}</div>
      </section>

      <section>
        <h4>Income · education · housing (aged 15+)</h4>
        <div class="stat-grid">
          ${statCard("Median personal income", Palette.fmtDollar(s.median_income),
              "Region " + Palette.fmtDollar(region.median_income),
              sign(dInc, "", v => "$" + Math.round(v).toLocaleString("en-NZ")))}
          ${statCard("Bachelor’s degree or higher", Palette.fmtPct(s.bachelor_pct),
              "Region " + Palette.fmtPct(region.bachelor_pct),
              sign(dBach, " pts", v => v.toFixed(1)))}
          ${statCard("Own or partly own home", Palette.fmtPct(s.home_own_pct),
              "Region " + Palette.fmtPct(region.home_own_pct),
              sign(dOwn, " pts", v => v.toFixed(1)))}
          ${statCard("Median age", Palette.fmtAge(s.median_age),
              "Region " + Palette.fmtAge(region.median_age),
              sign(dAge, " yrs", v => v.toFixed(1)))}
        </div>
        <p class="footnote">“Own or partly own” includes homes held in a family trust.
          Regional medians are population-weighted medians of SA2 medians (Stats NZ does not
          publish region-level medians in this dataset).</p>
      </section>

      <section>
        <h4>NZDep2023 deprivation</h4>
        ${depStrip(s)}
      </section>

      <p class="footnote">Counts are randomly rounded to base 3 by Stats NZ, so figures may not
        sum exactly. “S” = suppressed for confidentiality.</p>`;
    el.hidden = false;
  }

  function hide() { el.hidden = true; }

  return { init, show, hide };
})();
