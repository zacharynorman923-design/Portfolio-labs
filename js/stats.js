/* =========================================================================
   Portfolio Labs — statistics engine
   -------------------------------------------------------------------------
   Pure functions that turn aligned daily closes + target weights into a
   backtested value path and the risk/return metrics PortfoliosLab-style
   tools report: CAGR, volatility, Sharpe, Sortino, Calmar, max drawdown,
   VaR / CVaR, beta / alpha, correlations, and a bootstrapped Monte Carlo.

   Conventions: returns are simple (not log). Ratios are computed from
   MONTHLY returns (standard, and less noisy than daily) then annualised.
   ========================================================================= */

const TRADING_DAYS = 252;

/* ------------------------------ tiny stats ------------------------------ */
const S = {
  mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; },
  std(a) { // sample standard deviation
    if (a.length < 2) return 0;
    const m = S.mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
  },
  percentile(sorted, p) { // sorted ascending, p in [0,1]
    if (!sorted.length) return NaN;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  },
};

/* --------------------- align multiple price series ---------------------- */
/* seriesMap: { SYM: [{date, close}...] }. Returns common (intersection)
   dates ascending + a parallel closes array per symbol. */
function alignSeries(seriesMap, symbols) {
  const maps = {};
  symbols.forEach(s => {
    const m = {};
    (seriesMap[s] || []).forEach(p => { m[p.date] = p.close; });
    maps[s] = m;
  });
  // intersection of dates
  let common = null;
  symbols.forEach(s => {
    const ds = Object.keys(maps[s]);
    if (common === null) common = new Set(ds);
    else common = new Set(ds.filter(d => common.has(d)));
  });
  const dates = Array.from(common || []).sort();
  const closes = {};
  symbols.forEach(s => { closes[s] = dates.map(d => maps[s][d]); });
  const out = { dates, closes };
  // when points carry an unadjusted price too, align that in parallel
  if (symbols.some(s => (seriesMap[s] || []).some(p => p.rawClose != null))) {
    out.raw = {};
    symbols.forEach(s => {
      const m = {};
      (seriesMap[s] || []).forEach(p => { m[p.date] = p.rawClose != null ? p.rawClose : p.close; });
      out.raw[s] = dates.map(d => m[d]);
    });
  }
  return out;
}

/* ------------------- dividend-adjusted (total return) ------------------- *
   Free daily feeds quote PRICE only, so a distribution shows up as a drop in
   the series and the payout itself is never counted. This rebuilds a
   total-return index assuming each dividend is reinvested on its ex-date:

     TR[0] = P[0]
     TR[i] = TR[i-1] * (P[i] + D[i]) / P[i-1]

   the standard reinvested-distribution series. Returns a new closes array of
   the same length; raw prices are left untouched for display. */
function applyDividends(dates, closes, divs) {
  if (!divs || !divs.length || !closes.length) return closes.slice();

  /* Credit each dividend to the first trading day on or after its ex-date.
     Matching dates exactly would silently drop any dividend whose ex-date
     lands on a holiday or weekend — which understates total return. */
  const ds = divs.slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const perDay = new Array(closes.length).fill(0);
  let di = 0;
  for (let i = 0; i < dates.length && di < ds.length; i++) {
    while (di < ds.length && ds[di].date <= dates[i]) { perDay[i] += ds[di].amount; di++; }
  }

  const out = new Array(closes.length);
  out[0] = closes[0];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    out[i] = prev > 0 ? out[i - 1] * ((closes[i] + perDay[i]) / prev) : out[i - 1];
  }
  return out;
}

/* Restrict aligned data to the last N years (0 = keep all). */
function sliceYears(aligned, years) {
  if (!years || !aligned.dates.length) return aligned;
  const last = new Date(aligned.dates[aligned.dates.length - 1]);
  const from = new Date(last); from.setFullYear(from.getFullYear() - years);
  const fromStr = from.toISOString().slice(0, 10);
  let i = 0; while (i < aligned.dates.length && aligned.dates[i] < fromStr) i++;
  const dates = aligned.dates.slice(i);
  const closes = {};
  Object.keys(aligned.closes).forEach(s => { closes[s] = aligned.closes[s].slice(i); });
  const out = { dates, closes };
  // carry the raw (unadjusted) prices along when total-return mode built them
  if (aligned.raw) {
    out.raw = {};
    Object.keys(aligned.raw).forEach(s => { out.raw[s] = aligned.raw[s].slice(i); });
  }
  return out;
}

/* ------------------------- backtest a portfolio ------------------------- */
/* weights: {SYM: fraction}. rebalance: 'none'|'month'|'quarter'|'year'.
   Returns { dates, values } where values start at `start` (default 10000)
   and reflect buy-and-hold drift with periodic rebalancing to target. */
function backtest(aligned, weights, rebalance = 'year', start = 10000) {
  const { dates, closes } = aligned;
  const syms = Object.keys(weights).filter(s => weights[s] > 0 && closes[s]);
  const total = syms.reduce((s, k) => s + weights[k], 0) || 1;
  const w = {}; syms.forEach(s => w[s] = weights[s] / total);
  if (!dates.length || !syms.length) return { dates: [], values: [] };

  const periodKey = (d) => {
    const dt = new Date(d);
    if (rebalance === 'month')   return dt.getFullYear() + '-' + dt.getMonth();
    if (rebalance === 'quarter') return dt.getFullYear() + '-Q' + Math.floor(dt.getMonth() / 3);
    if (rebalance === 'year')    return '' + dt.getFullYear();
    return 'all';
  };

  const shares = {};
  const setTarget = (value, i) => { syms.forEach(s => shares[s] = (w[s] * value) / closes[s][i]); };
  setTarget(start, 0);
  let key = periodKey(dates[0]);
  const values = new Array(dates.length);

  for (let i = 0; i < dates.length; i++) {
    if (rebalance !== 'none') {
      const k = periodKey(dates[i]);
      if (k !== key) { // new period -> rebalance to target using current value
        let v = 0; syms.forEach(s => v += shares[s] * closes[s][i]);
        setTarget(v, i);
        key = k;
      }
    }
    let v = 0; syms.forEach(s => v += shares[s] * closes[s][i]);
    values[i] = v;
  }
  return { dates, values };
}

/* --------------------- returns & resampling helpers --------------------- */
function dailyReturns(values) {
  const r = [];
  for (let i = 1; i < values.length; i++) r.push(values[i] / values[i - 1] - 1);
  return r;
}

/* Collapse a daily value path to end-of-month points -> monthly returns. */
function monthlyReturns(dates, values) {
  const ends = [];
  for (let i = 0; i < dates.length; i++) {
    const cur = dates[i].slice(0, 7);
    const nxt = i + 1 < dates.length ? dates[i + 1].slice(0, 7) : null;
    if (nxt !== cur) ends.push({ date: dates[i], value: values[i] });
  }
  const rets = [];
  for (let i = 1; i < ends.length; i++) rets.push({ date: ends[i].date, r: ends[i].value / ends[i - 1].value - 1 });
  return rets;
}

/* Calendar-year returns from a daily value path. */
function yearlyReturns(dates, values) {
  const byYear = {};
  for (let i = 0; i < dates.length; i++) {
    const y = dates[i].slice(0, 4);
    if (!byYear[y]) byYear[y] = { first: values[i], last: values[i] };
    byYear[y].last = values[i];
  }
  return Object.keys(byYear).sort().map(y => ({ year: y, r: byYear[y].last / byYear[y].first - 1 }));
}

/* Drawdown series (fraction below running peak) + max drawdown. */
function drawdown(values) {
  let peak = -Infinity, maxDD = 0;
  const dd = values.map(v => {
    if (v > peak) peak = v;
    const d = v / peak - 1;
    if (d < maxDD) maxDD = d;
    return d;
  });
  return { series: dd, maxDD };
}

/* --------------------------- headline metrics --------------------------- */
function metrics(dates, values, opts = {}) {
  const rf = opts.rf != null ? opts.rf : 0.03; // annual risk-free
  const out = {};
  if (values.length < 2) return out;

  const years = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / (365.25 * 864e5);
  out.years = years;
  out.startDate = dates[0];
  out.endDate = dates[dates.length - 1];
  out.startValue = values[0];
  out.endValue = values[values.length - 1];
  out.totalReturn = values[values.length - 1] / values[0] - 1;
  out.cagr = years > 0 ? Math.pow(values[values.length - 1] / values[0], 1 / years) - 1 : 0;

  const mr = monthlyReturns(dates, values).map(x => x.r);
  const mMean = S.mean(mr), mStd = S.std(mr);
  out.volatility = mStd * Math.sqrt(12);            // annualised volatility
  out.annReturnArith = mMean * 12;

  const rfM = rf / 12;
  out.sharpe = mStd > 0 ? ((mMean - rfM) / mStd) * Math.sqrt(12) : 0;

  const downside = mr.filter(r => r < rfM).map(r => r - rfM);
  const dStd = downside.length ? Math.sqrt(downside.reduce((s, x) => s + x * x, 0) / mr.length) : 0;
  out.sortino = dStd > 0 ? ((mMean - rfM) / dStd) * Math.sqrt(12) : 0;

  const dd = drawdown(values);
  out.maxDrawdown = dd.maxDD;
  out.ddSeries = dd.series;
  out.calmar = dd.maxDD < 0 ? out.cagr / Math.abs(dd.maxDD) : 0;

  const yr = yearlyReturns(dates, values);
  out.yearly = yr;
  if (yr.length) {
    out.bestYear = yr.reduce((a, b) => b.r > a.r ? b : a);
    out.worstYear = yr.reduce((a, b) => b.r < a.r ? b : a);
  }
  out.positiveMonths = mr.length ? mr.filter(r => r > 0).length / mr.length : 0;

  // Historical monthly VaR / CVaR at 95%
  const sorted = mr.slice().sort((a, b) => a - b);
  const q = S.percentile(sorted, 0.05);
  out.var95 = -q;
  const tail = sorted.filter(r => r <= q);
  out.cvar95 = tail.length ? -S.mean(tail) : -q;

  out.monthly = mr;
  return out;
}

/* Beta / alpha / correlation of portfolio vs a benchmark value path. */
function relativeMetrics(dates, values, bDates, bValues, rf = 0.03) {
  // align on month-ends both share
  const pm = monthlyReturns(dates, values);
  const bm = monthlyReturns(bDates, bValues);
  const bMap = {}; bm.forEach(x => bMap[x.date.slice(0, 7)] = x.r);
  const pairs = [];
  pm.forEach(x => { const k = x.date.slice(0, 7); if (bMap[k] != null) pairs.push([x.r, bMap[k]]); });
  if (pairs.length < 6) return {};
  const rfM = rf / 12;
  const p = pairs.map(x => x[0] - rfM), b = pairs.map(x => x[1] - rfM);
  const mb = S.mean(b), mp = S.mean(p);
  let cov = 0, varb = 0;
  for (let i = 0; i < b.length; i++) { cov += (b[i] - mb) * (p[i] - mp); varb += (b[i] - mb) * (b[i] - mb); }
  cov /= (b.length - 1); varb /= (b.length - 1);
  const beta = varb > 0 ? cov / varb : 0;
  const alpha = (mp - beta * mb) * 12; // annualised
  // correlation
  const sp = S.std(pairs.map(x => x[0])), sbb = S.std(pairs.map(x => x[1]));
  const corr = (sp > 0 && sbb > 0) ? cov / (sp * sbb) : 0;
  return { beta, alpha, correlation: corr };
}

/* -------------------- correlation matrix of holdings -------------------- */
/* Monthly-return correlation between each pair of aligned holdings. */
function correlationMatrix(aligned, syms) {
  const rets = {};
  syms.forEach(s => {
    rets[s] = monthlyReturns(aligned.dates, aligned.closes[s]).map(x => x.r);
  });
  const n = Math.min(...syms.map(s => rets[s].length));
  const M = syms.map(() => syms.map(() => 0));
  for (let i = 0; i < syms.length; i++) {
    for (let j = 0; j < syms.length; j++) {
      const a = rets[syms[i]].slice(-n), b = rets[syms[j]].slice(-n);
      const ma = S.mean(a), mb = S.mean(b);
      let cov = 0, va = 0, vb = 0;
      for (let k = 0; k < n; k++) { cov += (a[k] - ma) * (b[k] - mb); va += (a[k] - ma) ** 2; vb += (b[k] - mb) ** 2; }
      M[i][j] = (va > 0 && vb > 0) ? cov / Math.sqrt(va * vb) : (i === j ? 1 : 0);
    }
  }
  return M;
}

/* ------------------------------ Monte Carlo ----------------------------- */
/* Bootstraps the portfolio's own historical MONTHLY returns to project the
   next `years`, optionally with a recurring monthly contribution. Returns
   percentile time-paths + terminal-value stats + probability of >= goal. */
function monteCarlo(monthlyHist, opts) {
  const years = opts.years || 20;
  const initial = opts.initial != null ? opts.initial : 10000;
  const monthly = opts.monthly || 0;
  const nPaths = opts.paths || 1500;
  const goal = opts.goal || 0;
  const seed = opts.seed || 12345;
  const months = Math.round(years * 12);
  const hist = monthlyHist.filter(r => isFinite(r));
  if (hist.length < 6) return null;

  const rng = mulberry32(seed);
  const pickIdx = () => Math.floor(rng() * hist.length);

  // percentile bands sampled yearly for a readable fan chart
  const bandMonths = [];
  for (let m = 0; m <= months; m += 12) bandMonths.push(m);
  if (bandMonths[bandMonths.length - 1] !== months) bandMonths.push(months);
  const snapshots = bandMonths.map(() => new Array(nPaths));
  const terminals = new Array(nPaths);

  for (let p = 0; p < nPaths; p++) {
    let v = initial, snapI = 0;
    if (bandMonths[0] === 0) snapshots[snapI++][p] = v;
    for (let m = 1; m <= months; m++) {
      v = v * (1 + hist[pickIdx()]) + monthly;
      if (v < 0) v = 0;
      if (snapI < bandMonths.length && bandMonths[snapI] === m) snapshots[snapI++][p] = v;
    }
    terminals[p] = v;
  }

  const pct = [0.1, 0.25, 0.5, 0.75, 0.9];
  const bands = snapshots.map(col => {
    const sorted = col.slice().sort((a, b) => a - b);
    const o = {}; pct.forEach(q => o['p' + Math.round(q * 100)] = S.percentile(sorted, q));
    return o;
  });
  const sortedT = terminals.slice().sort((a, b) => a - b);
  const contributions = initial + monthly * months;
  const reachGoal = goal > 0 ? terminals.filter(v => v >= goal).length / nPaths : null;

  return {
    years, months: bandMonths, bands,
    median: S.percentile(sortedT, 0.5),
    p10: S.percentile(sortedT, 0.1),
    p90: S.percentile(sortedT, 0.9),
    worst: sortedT[0], best: sortedT[sortedT.length - 1],
    contributions, reachGoal, goal,
  };
}
