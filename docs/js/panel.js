/* Detail panel: photo + description (Wikipedia/Wikimedia Commons, attributed),
   header, year toggle (2013/2018/2023) for the census-history charts and cards,
   ethnicity/age/travel bar charts with regional reference ticks, work & housing
   stat cards, NZDep decile strip, similar suburbs. Every value is printed, not
   just drawn. Suppressed cells render as "S", never estimated. */
"use strict";

const Panel = (() => {
  let el, body, ctx;           // ctx = {region, suburbs, extras, onSelect, onClose}
  let year = "2023";
  let current = null;
  let rankCache = {};
  let simCache = {};
  let zStats = null;

  function init(context) {
    ctx = context;
    el = document.getElementById("panel");
    body = document.getElementById("panel-body");
    document.getElementById("panel-close").addEventListener("click", () => {
      hide(); if (ctx.onClose) ctx.onClose();
    });
    body.addEventListener("click", e => {
      const yb = e.target.closest("[data-year]");
      if (yb) { year = yb.dataset.year; render(); }
      const sim = e.target.closest("[data-goto]");
      if (sim && ctx.onSelect) ctx.onSelect(sim.dataset.goto);
    });
  }

  const esc = s => String(s).replace(/[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ------------------------------------------------ ranks & similarity */
  function rank(key, get, value) {
    if (value == null) return null;
    if (!rankCache[key]) {
      rankCache[key] = ctx.suburbs.map(get).filter(v => v != null);
    }
    const arr = rankCache[key];
    return { n: arr.filter(v => v > value).length + 1, of: arr.length };
  }
  const rankTxt = r => r ? ` · #${r.n} of ${r.of}` : "";

  const SIM_DIMS = [
    s => s.median_income, s => s.median_age, s => s.home_own_pct,
    s => s.dep_score, s => s.median_rent, s => s.overseas_born_pct,
    ...["European", "Māori", "Pacific", "Asian"].map(k => (s => s.ethnicity[k].pct)),
  ];
  function similar(s0) {
    if (simCache[s0.code]) return simCache[s0.code];
    if (!zStats) {
      zStats = SIM_DIMS.map(get => {
        const v = ctx.suburbs.map(get).filter(x => x != null);
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1;
        return { mean, sd };
      });
    }
    const vec = s => SIM_DIMS.map((get, i) => {
      const v = get(s);
      return v == null ? null : (v - zStats[i].mean) / zStats[i].sd;
    });
    const v0 = vec(s0);
    const scored = [];
    for (const s of ctx.suburbs) {
      if (s.code === s0.code || (s.pop2023 || 0) < 100) continue;
      const v = vec(s);
      let d = 0, n = 0;
      for (let i = 0; i < v.length; i++)
        if (v[i] != null && v0[i] != null) { d += (v[i] - v0[i]) ** 2; n++; }
      if (n >= 7) scored.push([Math.sqrt(d / n), s]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    return (simCache[s0.code] = scored.slice(0, 3).map(x => x[1]));
  }

  /* ------------------------------------------------ chart primitive */
  function barChart(rows, opts) {
    const W = 340, labelW = opts.labelW || 62, valueW = 46, barH = 18, gap = 10, padT = 4;
    const plotW = W - labelW - valueW - 8;
    const H = padT + rows.length * (barH + gap);
    const max = Math.max(
      ...rows.map(r => r.value ?? 0),
      ...rows.map(r => r.ref ?? 0), 0) * 1.06 || 1;
    const x = v => (v / max) * plotW;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opts.aria)}">`;
    rows.forEach((r, i) => {
      const y = padT + i * (barH + gap);
      const cy = y + barH / 2;
      s += `<text x="${labelW - 6}" y="${cy + 4}" text-anchor="end" font-size="11.5"
              fill="var(--ink-2)">${esc(r.label)}</text>`;
      const tick = (r.ref != null)
        ? `<rect x="${labelW + x(r.ref) - 1}" y="${y - 2}" width="2" height="${barH + 4}"
             fill="var(--ink)" opacity="0.85"><title>Auckland average: ${esc(r.refFmt)}</title></rect>`
        : "";
      if (r.value == null) {
        s += `<text x="${labelW + 4}" y="${cy + 4}" font-size="11.5" font-style="italic"
                fill="var(--muted)">S — suppressed</text>` + tick;
      } else {
        const w = Math.max(x(r.value), 1.5);
        const rr = Math.min(4, w);
        s += `<path d="M${labelW},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr}
                v${barH - 2 * rr} a${rr},${rr} 0 0 1 ${-rr},${rr} h${-(w - rr)} z"
                fill="var(--accent)">
                <title>${esc(r.label)}: ${esc(r.fmt)}${r.count != null ? ` (${r.count.toLocaleString("en-NZ")} people)` : ""}</title>
              </path>` + tick;
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
  const signTxt = (d, unit, fmt) => d == null ? "" :
    (d >= 0 ? "+" : "−") + fmt(Math.abs(d)) + unit + " vs region";

  function depStrip(s) {
    const colors = Palette.decile10();
    if (s.dep_decile == null) {
      return `<p class="dep-caption suppressed">No NZDep2023 score — Stats NZ does not
        publish one for this area (typically non-residential: inlets, islands, ports).</p>`;
    }
    const cells = colors.map((c, i) => {
      const d = i + 1;
      const cur = d === s.dep_decile;
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

  /* ------------------------------------------------ header pieces */
  function photoBlock(ex) {
    if (!ex || !ex.img) return "";
    const attr = ex.artist ? `${ex.artist}${ex.license ? " · " + ex.license : ""}`
      : (ex.license || "Wikimedia Commons");
    return `<figure class="p-photo">
      <img src="${esc(ex.img)}" alt="" loading="lazy">
      <figcaption><a href="${esc(ex.img_page || "#")}" target="_blank" rel="noopener">
        Photo: ${esc(attr)}</a></figcaption>
    </figure>`;
  }

  function descBlock(s, ex) {
    if (ex && ex.desc) {
      return `<p class="p-desc">${esc(ex.desc)}
        <a href="${esc(ex.wiki || "#")}" target="_blank" rel="noopener" class="p-desc-src">—
        Wikipedia (CC BY-SA)</a></p>`;
    }
    const pop = s.pop2023 == null ? null : s.pop2023.toLocaleString("en-NZ");
    return `<p class="p-desc p-desc-gen">${esc(s.name)} is a statistical area (SA2) in the
      ${esc(s.board)} Local Board area${pop ? `, home to about ${pop} people at the 2023 Census` : ""}.</p>`;
  }

  /* ------------------------------------------------ year-aware getters */
  function yearData(s) {
    if (year === "2023") {
      return {
        eth: k => s.ethnicity[k], age: k => s.age[k],
        median_age: s.median_age, median_income: s.median_income,
        home_own_pct: s.home_own_pct, bachelor_pct: s.bachelor_pct,
        refEth: k => ctx.region.ethnicity[k], refAge: k => ctx.region.age[k],
        ref: m => ctx.region[m],
      };
    }
    const h = s.hist[year], rh = ctx.region.hist[year];
    return {
      eth: k => ({ n: null, pct: h.ethnicity[k] }), age: k => ({ n: null, pct: h.age[k] }),
      median_age: h.median_age, median_income: h.median_income,
      home_own_pct: h.home_own_pct, bachelor_pct: h.bachelor_pct,
      refEth: k => rh.ethnicity[k], refAge: k => rh.age[k],
      ref: m => rh[m],
    };
  }

  /* ------------------------------------------------ main render */
  function render() {
    const s = current;
    if (!s) return;
    const ex = (ctx.extras || {})[s.code];
    const yd = yearData(s);
    const ETH_ORDER = ["European", "Māori", "Pacific", "Asian", "MELAA", "Other"];
    const AGE_LBL = { "0-14": "0–14", "15-29": "15–29", "30-64": "30–64", "65+": "65+" };

    const chg = s.pop_change_pct;
    const chgHtml = chg == null ? `<small class="suppressed">change 2018–23: S</small>`
      : `<small class="${chg >= 0 ? "delta-up" : "delta-down"}">${Palette.fmtPctSigned(chg)} since 2018</small>`;
    const popHist = ["2013", "2018", "2023"].map(y =>
      `${y}: ${Palette.fmtInt(y === "2023" ? s.pop2023 : y === "2018" ? s.pop2018 : s.pop2013)}`).join(" · ");

    const ethRows = ETH_ORDER.map(k => ({
      label: k, value: yd.eth(k).pct, count: yd.eth(k).n,
      fmt: Palette.fmtPct(yd.eth(k).pct),
      ref: yd.refEth(k), refFmt: Palette.fmtPct(yd.refEth(k)),
    }));
    const ageRows = Object.keys(AGE_LBL).map(k => ({
      label: AGE_LBL[k], value: yd.age(k).pct, count: yd.age(k).n,
      fmt: Palette.fmtPct(yd.age(k).pct),
      ref: yd.refAge(k), refFmt: Palette.fmtPct(yd.refAge(k)),
    }));
    const travelRows = Object.entries(s.travel).map(([k, v]) => ({
      label: k, value: v.pct, count: v.n, fmt: Palette.fmtPct(v.pct),
      ref: ctx.region.travel[k], refFmt: Palette.fmtPct(ctx.region.travel[k]),
    }));

    const dAge = yd.median_age == null ? null : yd.median_age - yd.ref("median_age");
    const dInc = yd.median_income == null ? null : yd.median_income - yd.ref("median_income");
    const dBach = yd.bachelor_pct == null ? null : yd.bachelor_pct - yd.ref("bachelor_pct");
    const dOwn = yd.home_own_pct == null ? null : yd.home_own_pct - yd.ref("home_own_pct");
    const yearBtns = ["2013", "2018", "2023"].map(y =>
      `<button class="year-btn ${y === year ? "active" : ""}" data-year="${y}">${y}</button>`).join("");

    const rInc = year === "2023" ? rank("median_income", x => x.median_income, s.median_income) : null;
    const rRent = rank("median_rent", x => x.median_rent, s.median_rent);
    const rHh = rank("median_hh_income", x => x.median_hh_income, s.median_hh_income);

    const sims = similar(s);

    body.innerHTML = `
      ${photoBlock(ex)}
      <h2>${esc(s.name)}</h2>
      <p class="p-sub">${esc(s.board)} Local Board · SA2 ${esc(s.code)}</p>
      ${s.colloquial ? `<p class="p-colloquial">Part of the wider “${esc(s.colloquial)}” area (SA3)</p>` : ""}
      ${descBlock(s, ex)}
      <div class="p-pop">${Palette.fmtInt(s.pop2023)} ${chgHtml}</div>
      <div class="footnote">Usually resident population · ${esc(popHist)}${s.on_map === false
        ? " · water-only area, not drawn on the map" : ""}</div>

      <div class="year-toggle" role="group" aria-label="Census year">${yearBtns}
        <span class="year-note">census year for the charts below</span></div>

      <section>
        <h4>Age distribution <span class="h4-year">${year}</span></h4>
        ${barChart(ageRows, { aria: "Age distribution vs Auckland average" })}
        <div class="chart-key"><span class="key-tick"></span> Auckland average (${year})
          ${yd.median_age != null ? `&nbsp;·&nbsp; Median age <strong>&nbsp;${Palette.fmtAge(yd.median_age)}</strong>` : ""}</div>
      </section>

      <section>
        <h4>Income · education · housing (aged 15+) <span class="h4-year">${year}</span></h4>
        <div class="stat-grid">
          ${statCard("Median personal income", Palette.fmtDollar(yd.median_income),
              "Region " + Palette.fmtDollar(yd.ref("median_income")) + rankTxt(rInc),
              signTxt(dInc, "", v => "$" + Math.round(v).toLocaleString("en-NZ")))}
          ${statCard("Bachelor’s degree or higher", Palette.fmtPct(yd.bachelor_pct),
              "Region " + Palette.fmtPct(yd.ref("bachelor_pct")),
              signTxt(dBach, " pts", v => v.toFixed(1)))}
          ${statCard("Own or partly own home", Palette.fmtPct(yd.home_own_pct),
              "Region " + Palette.fmtPct(yd.ref("home_own_pct")),
              signTxt(dOwn, " pts", v => v.toFixed(1)))}
          ${statCard("Median age", Palette.fmtAge(yd.median_age),
              "Region " + Palette.fmtAge(yd.ref("median_age")),
              signTxt(dAge, " yrs", v => v.toFixed(1)))}
        </div>
      </section>

      <section>
        <h4>Getting to work <span class="h4-year">2023</span></h4>
        <p class="h4-note">Main means of travel to work — share of employed people who stated one.</p>
        ${barChart(travelRows, { aria: "Travel to work vs Auckland average", labelW: 104 })}
        <div class="chart-key"><span class="key-tick"></span> Auckland average</div>
      </section>

      <section>
        <h4>Work &amp; mobility <span class="h4-year">2023</span></h4>
        <div class="stat-grid">
          ${statCard("Unemployment rate", Palette.fmtPct(s.unemployment_pct),
              "Region " + Palette.fmtPct(ctx.region.unemployment_pct))}
          ${statCard("Born overseas", Palette.fmtPct(s.overseas_born_pct),
              "Region " + Palette.fmtPct(ctx.region.overseas_born_pct))}
          ${statCard("Same home as 5 years ago", Palette.fmtPct(s.same_home_5y_pct),
              "Region " + Palette.fmtPct(ctx.region.same_home_5y_pct))}
          ${statCard("Speak te reo Māori", Palette.fmtPct(s.te_reo_pct),
              "Region " + Palette.fmtPct(ctx.region.te_reo_pct))}
        </div>
      </section>

      <section>
        <h4>Ethnicity — share of people who stated an ethnicity <span class="h4-year">${year}</span></h4>
        <p class="h4-note">Multi-response: people can identify with several groups, so shares
          sum to more than 100%. Never normalised.</p>
        ${barChart(ethRows, { aria: "Ethnicity shares vs Auckland average" })}
        <div class="chart-key"><span class="key-tick"></span> Auckland average (${year})</div>
      </section>

      <section>
        <h4>Homes &amp; households <span class="h4-year">2023</span></h4>
        <div class="stat-grid">
          ${statCard("Median weekly rent", Palette.fmtDollar(s.median_rent),
              "Region " + Palette.fmtDollar(ctx.region.median_rent) + rankTxt(rRent),
              "renting households")}
          ${statCard("Median household income", Palette.fmtDollar(s.median_hh_income),
              "Region " + Palette.fmtDollar(ctx.region.median_hh_income) + rankTxt(rHh))}
          ${statCard("Homes damp (at least sometimes)", Palette.fmtPct(s.damp_pct),
              "Region " + Palette.fmtPct(ctx.region.damp_pct))}
          ${statCard("Mould over A4 size", Palette.fmtPct(s.mould_pct),
              "Region " + Palette.fmtPct(ctx.region.mould_pct))}
          ${statCard("Crowded households", Palette.fmtPct(s.crowded_pct),
              "Region " + Palette.fmtPct(ctx.region.crowded_pct))}
          ${statCard("Stand-alone houses", Palette.fmtPct(s.separate_house_pct),
              "Region " + Palette.fmtPct(ctx.region.separate_house_pct))}
        </div>
      </section>

      <section>
        <h4>NZDep2023 deprivation</h4>
        ${depStrip(s)}
      </section>

      ${sims.length ? `<section>
        <h4>Statistically similar suburbs</h4>
        <p class="h4-note">Nearest neighbours on income, age, tenure, rent, deprivation and
          ethnic mix — not geography.</p>
        <div class="sim-chips">${sims.map(t =>
          `<button class="sim-chip" data-goto="${t.code}">${esc(t.name)}
             <span>${esc(t.board)}</span></button>`).join("")}</div>
      </section>` : ""}

      <p class="footnote">Counts are randomly rounded to base 3 by Stats NZ, so figures may not
        sum exactly. “S” = suppressed. “Own or partly own” includes family trusts (not asked
        separately in 2013). Regional medians are population-weighted medians of SA2 medians.</p>`;
    el.hidden = false;
  }

  function show(s) { current = s; render(); body.scrollTop = 0; }
  function hide() { el.hidden = true; current = null; }
  function refresh() { if (current && !el.hidden) render(); }

  return { init, show, hide, refresh };
})();
