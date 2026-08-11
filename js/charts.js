/* =========================================================================
   Portfolio Labs — inline SVG charts (no chart library)
   -------------------------------------------------------------------------
   Each function renders into a container element. SVGs use a viewBox and
   scale to 100% width; colours come from CSS classes so they adapt to the
   light/dark theme. Series colours are passed in explicitly.
   ========================================================================= */

const SVGNS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Map a domain [min,max] to a pixel range [a,b] with min↦a and max↦b. */
function scaler(min, max, a, b) {
  if (max === min) max = min + 1;
  return v => a + (b - a) * ((v - min) / (max - min));
}

/* Nice year tick indices across a date array. */
function yearTicks(dates, maxTicks = 6) {
  const ticks = [];
  let lastYear = null;
  dates.forEach((d, i) => { const y = d.slice(0, 4); if (y !== lastYear) { ticks.push({ i, label: y }); lastYear = y; } });
  if (ticks.length <= maxTicks) return ticks;
  const step = Math.ceil(ticks.length / maxTicks);
  return ticks.filter((_, k) => k % step === 0);
}

/* ------------------------------ growth line ----------------------------- */
/* series: [{dates, values, color, label}]. Shared date axis (index-based).
   `log` toggles a log value axis (better for long compounding). */
function growthChart(el, series, opts = {}) {
  const W = 860, H = 340, P = { t: 16, r: 16, b: 30, l: 56 };
  const dates = series[0].dates;
  if (!dates || dates.length < 2) { el.innerHTML = ''; return; }
  const log = !!opts.log;
  const tx = (v) => log ? Math.log(v) : v;
  let min = Infinity, max = -Infinity;
  series.forEach(s => s.values.forEach(v => { if (v < min) min = v; if (v > max) max = v; }));
  if (log) { min = Math.max(min, 1e-6); }
  const pad = (max - min) * 0.06 || 1;
  const yMin = tx(Math.max(min - pad, log ? min * 0.9 : min - pad));
  const yMax = tx(max + pad);
  const X = scaler(0, dates.length - 1, P.l, W - P.r);
  const Y = scaler(yMin, yMax, H - P.b, P.t);

  // gridlines (5 rows)
  let grid = '';
  const rows = 5;
  for (let k = 0; k <= rows; k++) {
    const vy = yMin + (yMax - yMin) * k / rows;
    const y = Y(vy);
    const val = log ? Math.exp(vy) : vy;
    grid += `<line class="c-grid" x1="${P.l}" y1="${y.toFixed(1)}" x2="${W - P.r}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="c-axis" x="${P.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${FMT.money(val, 0)}</text>`;
  }
  // x ticks
  let xt = '';
  yearTicks(dates).forEach(t => {
    const x = X(t.i);
    xt += `<text class="c-axis" x="${x.toFixed(1)}" y="${H - 10}" text-anchor="middle">${t.label}</text>`;
  });
  // lines
  let paths = '';
  series.forEach(s => {
    let d = '';
    s.values.forEach((v, i) => { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(tx(Math.max(v, 1e-6))).toFixed(1); });
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
  });

  el.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Portfolio growth">`
    + grid + xt + paths + `</svg>`;
}

/* ---------------------------- drawdown (underwater) --------------------- */
/* `overlay` optionally draws a second portfolio's drawdown as a line on the
   same axes, so two allocations can be compared underwater. */
function drawdownChart(el, dates, dd, overlay) {
  const W = 860, H = 200, P = { t: 12, r: 16, b: 26, l: 56 };
  if (!dd || dd.length < 2) { el.innerHTML = ''; return; }
  const min = Math.min(...dd, ...(overlay && overlay.dd ? overlay.dd : []), -0.0001);
  const X = scaler(0, dd.length - 1, P.l, W - P.r);
  const Y = scaler(min, 0, H - P.b, P.t);
  let area = 'M' + X(0).toFixed(1) + ' ' + Y(0).toFixed(1);
  dd.forEach((v, i) => { area += 'L' + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); });
  area += 'L' + X(dd.length - 1).toFixed(1) + ' ' + Y(0).toFixed(1) + 'Z';
  let grid = '';
  [0, 0.5, 1].forEach(f => {
    const v = min * f, y = Y(v);
    grid += `<line class="c-grid" x1="${P.l}" y1="${y.toFixed(1)}" x2="${W - P.r}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="c-axis" x="${P.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${FMT.pct(v, 0)}</text>`;
  });
  let xt = '';
  yearTicks(dates).forEach(t => { xt += `<text class="c-axis" x="${X(t.i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${t.label}</text>`; });
  let over = '';
  if (overlay && overlay.dd && overlay.dd.length === dd.length) {
    let d = '';
    overlay.dd.forEach((v, i) => { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); });
    over = `<path d="${d}" fill="none" stroke="${overlay.color || 'var(--accent-2)'}" stroke-width="1.6"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Drawdowns">`
    + grid + `<path d="${area}" fill="var(--down-soft)" stroke="var(--down)" stroke-width="1.2"/>` + over + xt + `</svg>`;
}

/* ------------------------------- donut ---------------------------------- */
/* slices: [{label, value, color}] (values need not be normalised). */
function donut(el, slices) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const R = 78, r = 48, cx = 90, cy = 90;
  let a0 = -Math.PI / 2, arcs = '';
  slices.forEach(s => {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const xi1 = cx + r * Math.cos(a1), yi1 = cy + r * Math.sin(a1);
    const xi0 = cx + r * Math.cos(a0), yi0 = cy + r * Math.sin(a0);
    if (frac > 0.9999) { // full circle needs two arcs
      arcs += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${s.color}" stroke-width="${R - r}"/>`;
    } else {
      arcs += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} `
        + `L${xi1.toFixed(2)} ${yi1.toFixed(2)} A${r} ${r} 0 ${large} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z" `
        + `fill="${s.color}"/>`;
    }
    a0 = a1;
  });
  const legend = slices.map(s =>
    `<div class="lg-row"><span class="lg-dot" style="background:${s.color}"></span>`
    + `<span class="lg-name">${esc(s.label)}</span>`
    + `<span class="lg-val">${FMT.pct(s.value / total, 1)}</span></div>`).join('');
  el.innerHTML =
    `<div class="donut-wrap"><svg viewBox="0 0 180 180" class="donut-svg" role="img" aria-label="Allocation">${arcs}</svg>`
    + `<div class="donut-legend">${legend}</div></div>`;
}

/* --------------------------- correlation heatmap ------------------------ */
function heatmap(el, M, labels) {
  const n = labels.length;
  const cell = 46, pad = 62, size = pad + n * cell + 8;
  const color = (v) => {
    // -1 (blue) .. 0 (neutral) .. +1 (warm)
    if (v >= 0) { const t = v; return `rgba(229,88,107,${(0.12 + t * 0.72).toFixed(3)})`; }
    const t = -v; return `rgba(53,99,233,${(0.12 + t * 0.72).toFixed(3)})`;
  };
  let cells = '';
  for (let i = 0; i < n; i++) {
    cells += `<text class="c-axis hm-lab" x="${pad - 8}" y="${pad + i * cell + cell / 2 + 4}" text-anchor="end">${esc(labels[i])}</text>`;
    cells += `<text class="c-axis hm-lab" x="${pad + i * cell + cell / 2}" y="${pad - 8}" text-anchor="middle">${esc(labels[i])}</text>`;
    for (let j = 0; j < n; j++) {
      const v = M[i][j];
      const x = pad + j * cell, y = pad + i * cell;
      cells += `<rect x="${x}" y="${y}" width="${cell - 3}" height="${cell - 3}" rx="5" fill="${color(v)}"/>`;
      cells += `<text class="hm-val" x="${x + (cell - 3) / 2}" y="${y + (cell - 3) / 2 + 4}" text-anchor="middle">${v.toFixed(2)}</text>`;
    }
  }
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" class="heatmap" `
    + `style="width:${size}px;max-width:100%;height:auto" role="img" aria-label="Correlation matrix">${cells}</svg>`;
}

/* ------------------------- Monte Carlo fan chart ------------------------ */
function fanChart(el, mc, opts = {}) {
  const W = 860, H = 320, P = { t: 16, r: 16, b: 30, l: 64 };
  if (!mc) { el.innerHTML = ''; return; }
  const xs = mc.months.map(m => m / 12);
  const maxYr = xs[xs.length - 1] || 1;
  let max = 0; mc.bands.forEach(b => { if (b.p90 > max) max = b.p90; });
  const X = scaler(0, maxYr, P.l, W - P.r);
  const Y = scaler(0, max * 1.05, H - P.b, P.t);
  const band = (lo, hi, fill) => {
    let d = 'M' + X(xs[0]).toFixed(1) + ' ' + Y(mc.bands[0][hi]).toFixed(1);
    for (let i = 1; i < xs.length; i++) d += 'L' + X(xs[i]).toFixed(1) + ' ' + Y(mc.bands[i][hi]).toFixed(1);
    for (let i = xs.length - 1; i >= 0; i--) d += 'L' + X(xs[i]).toFixed(1) + ' ' + Y(mc.bands[i][lo]).toFixed(1);
    return `<path d="${d}Z" fill="${fill}"/>`;
  };
  let median = 'M';
  mc.bands.forEach((b, i) => { median += (i ? 'L' : '') + X(xs[i]).toFixed(1) + ' ' + Y(b.p50).toFixed(1); });
  let grid = '';
  for (let k = 0; k <= 5; k++) {
    const v = max * 1.05 * k / 5, y = Y(v);
    grid += `<line class="c-grid" x1="${P.l}" y1="${y.toFixed(1)}" x2="${W - P.r}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="c-axis" x="${P.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${FMT.money(v, 0)}</text>`;
  }
  let xt = '';
  const yStep = maxYr <= 10 ? 2 : (maxYr <= 20 ? 4 : 5);
  for (let yy = 0; yy <= maxYr + 0.001; yy += yStep) xt += `<text class="c-axis" x="${X(yy).toFixed(1)}" y="${H - 10}" text-anchor="middle">${Math.round(yy)}y</text>`;
  let goalLine = '';
  if (mc.goal > 0 && mc.goal <= max * 1.05) {
    const gy = Y(mc.goal);
    goalLine = `<line x1="${P.l}" y1="${gy.toFixed(1)}" x2="${W - P.r}" y2="${gy.toFixed(1)}" stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="5 4"/>`
      + `<text class="c-axis" x="${W - P.r}" y="${(gy - 5).toFixed(1)}" text-anchor="end" fill="var(--accent)">goal ${FMT.money(mc.goal, 0)}</text>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Monte Carlo projection">`
    + grid
    + band('p10', 'p90', 'var(--mc-outer)')
    + band('p25', 'p75', 'var(--mc-inner)')
    + `<path d="${median}" fill="none" stroke="var(--accent)" stroke-width="2.4"/>`
    + goalLine + xt + `</svg>`;
}

/* ------------------------- yearly returns bars -------------------------- */
function yearBars(el, yearly) {
  const W = 860, H = 200, P = { t: 14, r: 12, b: 26, l: 46 };
  if (!yearly || !yearly.length) { el.innerHTML = ''; return; }
  const vals = yearly.map(y => y.r);
  const max = Math.max(0.02, ...vals), min = Math.min(-0.02, ...vals);
  const X = scaler(0, yearly.length, P.l, W - P.r);
  const Y = scaler(min, max, H - P.b, P.t);
  const bw = (X(1) - X(0)) * 0.66;
  let bars = '', zero = Y(0);
  yearly.forEach((y, i) => {
    const x = X(i) + (X(1) - X(0) - bw) / 2;
    const yy = Y(Math.max(0, y.r)), hh = Math.abs(Y(y.r) - zero);
    bars += `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, hh).toFixed(1)}" rx="2" fill="${y.r >= 0 ? 'var(--up)' : 'var(--down)'}"/>`;
    bars += `<text class="c-axis" x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${y.year.slice(2)}</text>`;
  });
  const grid = `<line class="c-grid" x1="${P.l}" y1="${zero.toFixed(1)}" x2="${W - P.r}" y2="${zero.toFixed(1)}"/>`
    + `<text class="c-axis" x="${P.l - 8}" y="${(Y(max) + 3.5).toFixed(1)}" text-anchor="end">${FMT.pct(max, 0)}</text>`
    + `<text class="c-axis" x="${P.l - 8}" y="${(Y(min) + 3.5).toFixed(1)}" text-anchor="end">${FMT.pct(min, 0)}</text>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Annual returns">${grid}${bars}</svg>`;
}
